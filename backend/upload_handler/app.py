import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import boto3

S3_BUCKET_NAME = os.environ["S3_BUCKET_NAME"]
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

s3 = boto3.client("s3", region_name=AWS_REGION)
rekognition = boto3.client("rekognition", region_name=AWS_REGION)

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


def extract_lines(bucket, key):
    """Rekognition DetectText -> confidence-filtered, deduplicated lines.

    Mirrors the extraction logic from the ShelfScannerAI handoff (Section 5):
    keep LINE-type detections with confidence > 80, title-case and dedupe.
    """
    response = rekognition.detect_text(Image={"S3Object": {"Bucket": bucket, "Name": key}})

    lines = [
        (block["DetectedText"], block["Confidence"])
        for block in response["TextDetections"]
        if block["Type"] == "LINE" and block["Confidence"] > 80
    ]

    seen = set()
    titles = []
    for text, confidence in lines:
        cleaned = text.strip().title()
        if cleaned not in seen and len(cleaned) > 3:
            seen.add(cleaned)
            titles.append((cleaned, confidence))

    return titles


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

    raw_titles = extract_lines(S3_BUCKET_NAME, key)

    if not raw_titles:
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

    extracted_titles = []
    for cleaned_title, confidence in raw_titles:
        enriched = enrich_title(cleaned_title)
        extracted_titles.append(
            {
                "title": enriched["title"],
                "author": enriched["author"],
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
