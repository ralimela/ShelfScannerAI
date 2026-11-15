import base64
import io
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import boto3
from PIL import Image

S3_BUCKET_NAME = os.environ["S3_BUCKET_NAME"]
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", AWS_REGION)
BEDROCK_HAIKU_MODEL_ID = os.environ["BEDROCK_HAIKU_MODEL_ID"]

s3 = boto3.client("s3", region_name=AWS_REGION)
rekognition = boto3.client("rekognition", region_name=AWS_REGION)
bedrock_runtime = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

CONTENT_TYPE_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
}


# Rekognition's DetectText has a hard, undocumented-in-the-response cap of
# 100 words per call - it silently truncates past that, with no flag telling
# you it happened. A dense bookshelf photo (many books x several words of
# title/author/publisher text each) can exceed this easily. Rather than
# assume any fixed number of books fits in one call, detect saturation (a
# suspiciously-near-the-cap word count) and adaptively re-split that specific
# region, recursively, until every region comes back comfortably under the
# cap or a depth/size safety limit is hit.
WORD_SATURATION_THRESHOLD = 95
MAX_SPLIT_DEPTH = 3
OVERLAP_FRACTION = 0.08
MIN_SLICE_HEIGHT_PX = 200


def _crop_region(img, top_frac, bottom_frac):
    width, height = img.size
    top_px = max(0, int(height * top_frac))
    bottom_px = min(height, int(height * bottom_frac))
    cropped = img.crop((0, top_px, width, bottom_px))
    buffer = io.BytesIO()
    cropped.convert("RGB").save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def _detect_text_region(img, top_frac=0.0, bottom_frac=1.0, depth=0):
    region_bytes = _crop_region(img, top_frac, bottom_frac)
    response = rekognition.detect_text(Image={"Bytes": region_bytes})
    detections = response["TextDetections"]

    word_count = sum(1 for d in detections if d["Type"] == "WORD")
    lines = [
        (d["DetectedText"], d["Confidence"])
        for d in detections
        if d["Type"] == "LINE" and d["Confidence"] > 80
    ]

    _, full_height = img.size
    region_height_px = (bottom_frac - top_frac) * full_height
    can_split = depth < MAX_SPLIT_DEPTH and region_height_px > (2 * MIN_SLICE_HEIGHT_PX)

    if word_count < WORD_SATURATION_THRESHOLD or not can_split:
        return lines

    # Likely truncated - split into two overlapping halves (overlap avoids
    # losing a line of text that straddles the cut) and recurse on each.
    # Keep this region's own (partial) lines too - cheap safety net in case
    # a child slice's crop boundary happens to cut a line this call still
    # read in full; exact-duplicate lines get merged by the dedupe step below.
    mid_frac = (top_frac + bottom_frac) / 2
    overlap = OVERLAP_FRACTION * (bottom_frac - top_frac)
    first_half = _detect_text_region(img, top_frac, min(bottom_frac, mid_frac + overlap), depth + 1)
    second_half = _detect_text_region(img, max(top_frac, mid_frac - overlap), bottom_frac, depth + 1)
    return lines + first_half + second_half


def extract_lines(image_bytes):
    """Rekognition DetectText (adaptively sliced if needed) -> confidence-
    filtered, deduplicated lines.

    Keeps LINE-type detections with confidence > 80. Original casing is
    preserved (not forced to Title Case) since the LLM consolidation step
    below uses casing as one signal for distinguishing real titles from
    ALL-CAPS publisher imprints, honorifics, etc.
    """
    img = Image.open(io.BytesIO(image_bytes))
    raw_lines = _detect_text_region(img)

    seen = set()
    cleaned_lines = []
    for text, confidence in raw_lines:
        cleaned = text.strip()
        if cleaned not in seen and len(cleaned) > 3:
            seen.add(cleaned)
            cleaned_lines.append((cleaned, confidence))

    return cleaned_lines


# A single bookshelf photo produces far more OCR lines than there are books:
# author names, marketing blurbs ("#1 New York Times bestseller"), publisher
# imprints ("Vintage", "Folger"), honorifics, subtitles, and ISBN/barcode text
# all come back as separate high-confidence LINE detections. Open Library's
# fuzzy title search will confidently match *any* of these fragments to some
# unrelated real book, so every raw line needs consolidating into actual
# book title/author groupings before it's worth searching Open Library at
# all. A small, cheap model is enough for this text-classification task.
CONSOLIDATION_SYSTEM_PROMPT = """
You are cleaning up noisy OCR output from a photo of stacked book spines.
You will be given a list of raw text fragments detected on the spines. Many
fragments are not book titles at all - they may be author names printed
separately from the title, marketing blurbs ("#1 New York Times bestseller"),
publisher or imprint names (e.g. "Vintage", "Folger"), honorifics, subtitles,
or ISBN/barcode text.

Your job: group these fragments into the actual, distinct books they came
from. For each real book you can identify, return its title and author (if
an author fragment is present), and list exactly which of the input fragments
you used to construct that entry, copied verbatim. Discard any fragment that
is not part of a real book title or author - do not invent books that aren't
represented by the fragments, and do not force unrelated fragments into a
book entry.

Two important patterns to watch for:

1. Multiple books by the same author are commonly stacked together. An
   author's name fragment is not "used up" by one book - if you see several
   distinct, plausible title fragments near the same author's name (or near
   scattered honorific/publisher noise for that author, e.g. "His Divine
   Grace", a publisher imprint), create a SEPARATE book entry for each
   distinct title you can identify, reusing that author for all of them.
   Do not limit yourself to one book per author fragment, and do not let a
   title go unrecognized just because its author appears elsewhere in a
   crowded author/honorific/publisher cluster.

2. The same base title can appear more than once with a different part,
   volume, or subtitle marker (e.g. "1: Dreams and Dust" vs "2: After the
   Feast", or "Volume 1" vs "Volume 2") - these are physically different
   books, not a duplicate OCR read of one book. When you see this pattern,
   return a SEPARATE entry for each one, with the part/volume/subtitle
   information appended to the title so they stay distinguishable (e.g.
   "A Dance with Dragons: Dreams and Dust" and "A Dance with Dragons: After
   the Feast").

Return valid JSON only - no preamble, no markdown.

OUTPUT FORMAT:
{
  "books": [
    {"title": "string", "author": "string or null", "sourceLines": ["exact fragment(s) used, verbatim"]}
  ]
}
"""


def build_consolidation_prompt(raw_line_texts):
    return f"""
RAW OCR FRAGMENTS FROM BOOK SPINES:
{json.dumps(raw_line_texts, indent=2)}

Identify the real books represented by these fragments.
"""


def consolidate_titles(raw_line_texts):
    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_HAIKU_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2048,
                "system": CONSOLIDATION_SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": build_consolidation_prompt(raw_line_texts)}],
            }
        ),
    )
    body = json.loads(response["body"].read())
    text = body["content"][0]["text"].strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[len("json"):]
    parsed = json.loads(text.strip())
    return parsed.get("books", [])


def enrich_title(title):
    """Look up a raw extracted title against the Open Library Search API.

    The handoff names `openlibrary.org/api/books`, but that endpoint requires
    known ISBNs (bibkeys) as input, which Rekognition output does not provide.
    `search.json` is Open Library's title-search endpoint and is the correct
    fit here — same free, no-key Open Library API named in the handoff.
    """
    query = urllib.parse.quote(title)
    url = f"https://openlibrary.org/search.json?title={query}&limit=1"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ShelfScannerAI/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return {"title": title, "author": None, "pageCount": None, "genres": [], "matched": False}

    docs = data.get("docs") or []
    if not docs:
        return {"title": title, "author": None, "pageCount": None, "genres": [], "matched": False}

    doc = docs[0]
    authors = doc.get("author_name") or []
    subjects = doc.get("subject") or []
    return {
        "title": doc.get("title", title),
        "author": authors[0] if authors else None,
        "pageCount": doc.get("number_of_pages_median"),
        "genres": subjects[:5],
        "matched": True,
    }


def lambda_handler(event, context):
    start = time.monotonic()

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _error(400, "Request body must be valid JSON")

    user_id = body.get("userId")
    image_b64 = body.get("imageBase64")
    image_type = body.get("imageType", "image/jpeg")

    if not user_id or not image_b64:
        return _error(400, "userId and imageBase64 are required")

    ext = CONTENT_TYPE_EXT.get(image_type)
    if not ext:
        return _error(400, f"Unsupported imageType: {image_type}")

    try:
        image_bytes = base64.b64decode(image_b64)
    except (base64.binascii.Error, ValueError):
        return _error(400, "imageBase64 is not valid base64")

    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    key = f"uploads/{user_id}/{session_id}.{ext}"

    s3.put_object(Bucket=S3_BUCKET_NAME, Key=key, Body=image_bytes, ContentType=image_type)

    raw_lines = extract_lines(image_bytes)

    if not raw_lines:
        return {
            "statusCode": 200,
            "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
            "body": json.dumps(
                {
                    "sessionId": session_id,
                    "extractedTitles": [],
                    "processingTimeMs": _elapsed_ms(start),
                    "message": "No text could be detected in this image. Try a closer, "
                    "well-lit photo with book spines facing the camera.",
                }
            ),
        }

    confidence_by_line = {text: confidence for text, confidence in raw_lines}
    consolidated_books = consolidate_titles([text for text, _ in raw_lines])

    extracted_titles = []
    for book in consolidated_books:
        title = book.get("title")
        if not title:
            continue
        claude_author = book.get("author")
        source_lines = book.get("sourceLines") or []
        confidence = max((confidence_by_line.get(line, 90.0) for line in source_lines), default=90.0)

        enriched = enrich_title(title)
        extracted_titles.append(
            {
                "title": enriched["title"] if enriched["matched"] else title,
                "author": enriched["author"] if (enriched["matched"] and enriched["author"]) else claude_author,
                "pageCount": enriched["pageCount"],
                "genres": enriched["genres"],
                "confidence": round(confidence / 100, 2),
                "matched": enriched["matched"],
            }
        )

    return {
        "statusCode": 200,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(
            {
                "sessionId": session_id,
                "extractedTitles": extracted_titles,
                "processingTimeMs": _elapsed_ms(start),
            }
        ),
    }


def _elapsed_ms(start):
    return int((time.monotonic() - start) * 1000)


def _error(status_code, message):
    return {
        "statusCode": status_code,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps({"error": message}),
    }
