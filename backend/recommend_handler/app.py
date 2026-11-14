import json
import os
import time
import uuid
from decimal import Decimal

import boto3

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", AWS_REGION)
DYNAMODB_USERS_TABLE = os.environ["DYNAMODB_USERS_TABLE"]
DYNAMODB_SCAN_SESSIONS_TABLE = os.environ["DYNAMODB_SCAN_SESSIONS_TABLE"]
BEDROCK_CLAUDE_MODEL_ID = os.environ["BEDROCK_CLAUDE_MODEL_ID"]
BEDROCK_TITAN_EMBED_MODEL_ID = os.environ["BEDROCK_TITAN_EMBED_MODEL_ID"]
AURORA_CLUSTER_ARN = os.environ["AURORA_CLUSTER_ARN"]
AURORA_SECRET_ARN = os.environ["AURORA_SECRET_ARN"]
AURORA_DATABASE_NAME = os.environ["AURORA_DATABASE_NAME"]

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
users_table = dynamodb.Table(DYNAMODB_USERS_TABLE)
scan_sessions_table = dynamodb.Table(DYNAMODB_SCAN_SESSIONS_TABLE)

bedrock_runtime = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
rds_data = boto3.client("rds-data", region_name=AWS_REGION)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

NEAREST_MATCH_LIMIT = 3

# Adapted from ShelfScannerAI_Handoff.md section 8, "Prompt 1 — Recommendation Agent"
RECOMMENDATION_SYSTEM_PROMPT = """
You are a personal reading companion with deep knowledge of literature,
author writing styles, narrative structures, and reader psychology.

Your job is to analyze a list of available books against a reader's personal
taste profile and recommend the best matches with clear, specific reasoning.
Each available book comes with a similarity signal: the nearest book(s) to it
from either the reader's own reading history, or - for a reader with no
history yet - a curated catalog standing in for their stated preferences.

RULES:
- Always explain WHY a book matches based on the specific similarity signal provided
- Reference the specific similar book(s) listed for that candidate, and the taste profile
- Never give generic recommendations like "it's highly rated"
- Factor in any mood/constraints provided
- Rank by match quality, not popularity
- Only recommend books that appear in the AVAILABLE BOOKS list - never invent a title
- Return valid JSON only - no preamble, no markdown

OUTPUT FORMAT:
{
  "recommendations": [
    {
      "rank": 1,
      "title": "string - must exactly match a title from AVAILABLE BOOKS",
      "author": "string",
      "reasoning": "string - specific, personal, references the similarity signal",
      "matchedSignals": ["signal1", "signal2"]
    }
  ]
}
"""


def build_recommendation_prompt(candidates_with_signals, taste_profile, mode, constraints):
    history_label = "own reading history" if mode == "established" else "stated preferences, via a curated catalog standing in for history"
    return f"""
AVAILABLE BOOKS (extracted from bookshelf photo), each with a similarity signal
from the reader's {history_label}:
{json.dumps(candidates_with_signals, indent=2)}

USER TASTE PROFILE:
{json.dumps(taste_profile, indent=2)}

CONSTRAINTS:
{json.dumps(constraints or {}, indent=2)}

Rank the available books for this reader. For each book, write reasoning that
references the specific similar book(s) listed in its signal and/or the taste
profile - not generic praise. Only include books you can make a strong case
for. Skip poor matches entirely.
"""


def _dynamo_safe(value):
    """DynamoDB's boto3 resource API rejects native Python float - it requires
    Decimal. Round-tripping through json with parse_float=Decimal recursively
    converts any floats nested in lists/dicts without hand-walking the structure.
    """
    return json.loads(json.dumps(value), parse_float=Decimal)


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _elapsed_ms(start):
    return int((time.monotonic() - start) * 1000)


def _default_taste_profile():
    return {
        "favoriteAuthors": [],
        "favoriteGenres": [],
        "dislikedGenres": [],
        "preferredPacing": None,
        "preferredLength": None,
        "writingStylePrefs": [],
        "avoidThemes": [],
        "lastUpdated": _now_iso(),
    }


def _get_or_create_user(user_id):
    response = users_table.get_item(Key={"userId": user_id})
    item = response.get("Item")
    if item:
        return item

    item = {
        "userId": user_id,
        "createdAt": _now_iso(),
        "tasteProfile": _default_taste_profile(),
        "readingPace": {"avgPagesPerHour": 0, "totalSessions": 0, "lastUpdated": _now_iso()},
        "totalBooksRead": 0,
    }
    users_table.put_item(Item=item)
    return item


def _invoke_claude(system_prompt, user_prompt):
    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_CLAUDE_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2048,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            }
        ),
    )
    body = json.loads(response["body"].read())
    text = body["content"][0]["text"].strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[len("json"):]
    return json.loads(text.strip())


def _embed_text(text):
    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_TITAN_EMBED_MODEL_ID,
        body=json.dumps({"inputText": text, "dimensions": 1024, "normalize": True}),
    )
    body = json.loads(response["body"].read())
    return body["embedding"]


def _count_user_embeddings(user_id):
    result = rds_data.execute_statement(
        resourceArn=AURORA_CLUSTER_ARN,
        secretArn=AURORA_SECRET_ARN,
        database=AURORA_DATABASE_NAME,
        sql="SELECT count(*) FROM book_embeddings WHERE user_id = :user_id;",
        parameters=[{"name": "user_id", "value": {"stringValue": user_id}}],
    )
    return int(result["records"][0][0]["longValue"])


def _nearest_matches(sql, parameters):
    result = rds_data.execute_statement(
        resourceArn=AURORA_CLUSTER_ARN,
        secretArn=AURORA_SECRET_ARN,
        database=AURORA_DATABASE_NAME,
        sql=sql,
        parameters=parameters,
    )
    matches = []
    for row in result.get("records", []):
        matches.append(
            {
                "title": row[0].get("stringValue"),
                "author": row[1].get("stringValue"),
                "distance": row[2].get("doubleValue"),
            }
        )
    return matches


def _nearest_history_matches(user_id, embedding_literal, limit=NEAREST_MATCH_LIMIT):
    sql = """
        SELECT title, author, embedding <=> CAST(:embedding AS vector) AS distance
        FROM book_embeddings
        WHERE user_id = :user_id
        ORDER BY distance ASC
        LIMIT :limit;
    """
    parameters = [
        {"name": "user_id", "value": {"stringValue": user_id}},
        {"name": "embedding", "value": {"stringValue": embedding_literal}},
        {"name": "limit", "value": {"longValue": limit}},
    ]
    return _nearest_matches(sql, parameters)


def _nearest_catalog_matches(embedding_literal, limit=NEAREST_MATCH_LIMIT):
    sql = """
        SELECT title, author, embedding <=> CAST(:embedding AS vector) AS distance
        FROM catalog_embeddings
        ORDER BY distance ASC
        LIMIT :limit;
    """
    parameters = [
        {"name": "embedding", "value": {"stringValue": embedding_literal}},
        {"name": "limit", "value": {"longValue": limit}},
    ]
    return _nearest_matches(sql, parameters)


def lambda_handler(event, context):
    start = time.monotonic()

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _error(400, "Request body must be valid JSON")

    user_id = body.get("userId")
    candidates = body.get("candidates")

    if not user_id or not candidates or not isinstance(candidates, list):
        return _error(400, "userId and a non-empty candidates list are required")

    session_id = body.get("sessionId") or f"sess_{uuid.uuid4().hex[:12]}"
    constraints = body.get("constraints")

    user = _get_or_create_user(user_id)
    taste_profile = user.get("tasteProfile", _default_taste_profile())

    established = _count_user_embeddings(user_id) > 0
    mode = "established" if established else "cold_start"

    candidates_with_signals = []
    matches_by_title = {}
    for candidate in candidates:
        title = candidate.get("title")
        if not title:
            continue
        author = candidate.get("author")
        genres = candidate.get("genres") or []

        embedding_text = f"{title} by {author or 'Unknown'}. Genres: {', '.join(genres)}"
        embedding = _embed_text(embedding_text)
        embedding_literal = "[" + ",".join(str(v) for v in embedding) + "]"

        matches = (
            _nearest_history_matches(user_id, embedding_literal)
            if established
            else _nearest_catalog_matches(embedding_literal)
        )
        matches_by_title[title.lower()] = matches

        candidates_with_signals.append(
            {
                "title": title,
                "author": author,
                "pageCount": candidate.get("pageCount"),
                "genres": genres,
                "nearestMatches": matches,
            }
        )

    prompt = build_recommendation_prompt(candidates_with_signals, taste_profile, mode, constraints)
    claude_output = _invoke_claude(RECOMMENDATION_SYSTEM_PROMPT, prompt)

    candidates_by_title = {c["title"].lower(): c for c in candidates_with_signals}
    recommendations = []
    for rec in claude_output.get("recommendations", []):
        rec_title = rec.get("title", "")
        candidate = candidates_by_title.get(rec_title.lower())
        if not candidate:
            continue  # drop anything Claude hallucinated that wasn't in the scanned candidates

        matches = matches_by_title.get(rec_title.lower(), [])
        similar_to = matches[0] if matches else None
        match_score = round(max(0, 1 - matches[0]["distance"]), 2) if matches else 0

        recommendations.append(
            {
                "rank": rec.get("rank", len(recommendations) + 1),
                "title": candidate["title"],
                "author": candidate["author"],
                "pageCount": candidate["pageCount"],
                "reasoning": rec.get("reasoning", ""),
                "matchScore": match_score,
                "matchedSignals": rec.get("matchedSignals", []),
                "similarTo": similar_to,
            }
        )

    processing_time_ms = _elapsed_ms(start)

    scan_sessions_table.put_item(
        Item={
            "sessionId": session_id,
            "userId": user_id,
            "scannedAt": _now_iso(),
            "extractedTitles": [c["title"] for c in candidates_with_signals],
            "recommendedBooks": _dynamo_safe(recommendations),
            "mode": mode,
            "processingTimeMs": processing_time_ms,
        }
    )

    return {
        "statusCode": 200,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(
            {
                "sessionId": session_id,
                "mode": mode,
                "recommendations": recommendations,
                "tasteProfileUsed": taste_profile,
                "processingTimeMs": processing_time_ms,
            }
        ),
    }


def _error(status_code, message):
    return {
        "statusCode": status_code,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps({"error": message}),
    }
