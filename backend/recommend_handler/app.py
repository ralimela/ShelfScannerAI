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
PROXY_SUBSET_SIZE = 15

MODE_INSTRUCTIONS = {
    "preference": "The reader wants books closest to their established taste. Prioritize candidates with the LOWEST distance to their similarity signal.",
    "novelty": "The reader explicitly wants to try something OUTSIDE their usual taste today. Prioritize candidates with the HIGHEST distance to their similarity signal - a genuine stretch, not their usual pick. Still never recommend anything touching their avoid-themes below. Justify why it's a worthwhile stretch, not merely different.",
}

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
- Mention estimated completion time when a candidate's estimatedHours is provided
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


def build_recommendation_prompt(candidates_with_signals, taste_profile, mode, constraints, exploration_mode, reading_pace):
    history_label = "own reading history" if mode == "established" else "stated preferences, via a curated catalog standing in for history"
    return f"""
AVAILABLE BOOKS (extracted from bookshelf photo), each with a similarity signal
from the reader's {history_label}:
{json.dumps(candidates_with_signals, indent=2)}

USER TASTE PROFILE:
{json.dumps(taste_profile, indent=2)}

READER'S PACE:
{json.dumps(reading_pace)}
Each available book's "estimatedHours" (when not null) is pageCount / this reader's
average pages-per-hour. Mention expected completion time when it's notably fast or
slow for this reader. If estimatedHours is null, there isn't enough pace data yet -
don't invent a number.

CONSTRAINTS:
{json.dumps(constraints or {}, indent=2)}

READING INTENT FOR THIS REQUEST:
{MODE_INSTRUCTIONS[exploration_mode]}
Themes to avoid, regardless of intent: {json.dumps(taste_profile.get("avoidThemes", []))}

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


def _has_preferences(taste_profile):
    return bool(
        taste_profile.get("favoriteAuthors")
        or taste_profile.get("favoriteGenres")
        or taste_profile.get("writingStylePrefs")
    )


def _preference_text(taste_profile):
    parts = []
    if taste_profile.get("favoriteAuthors"):
        parts.append(f"Favorite authors: {', '.join(taste_profile['favoriteAuthors'])}.")
    if taste_profile.get("favoriteGenres"):
        parts.append(f"Favorite genres: {', '.join(taste_profile['favoriteGenres'])}.")
    if taste_profile.get("writingStylePrefs"):
        parts.append(f"Writing style preferences: {', '.join(taste_profile['writingStylePrefs'])}.")
    return " ".join(parts)


def _filter_disliked_genres(candidates, disliked_genres):
    disliked_lower = {g.lower() for g in disliked_genres or []}
    if not disliked_lower:
        return list(candidates)
    return [
        c
        for c in candidates
        if not (set(g.lower() for g in c.get("genres") or []) & disliked_lower)
    ]


def _resolve_user_id(event, fallback_user_id):
    """/me/recommend carries a Cognito authorizer, so API Gateway has already
    verified the bearer token by the time this runs and injected the claims
    here - trust that identity over whatever userId is in the body. The
    anonymous /recommend route has no authorizer attached, so claims is
    always empty there and this falls back to today's body value, unchanged.
    """
    claims = (event.get("requestContext") or {}).get("authorizer", {}).get("claims")
    if claims and claims.get("sub"):
        return claims["sub"], True
    return fallback_user_id, False


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


def _catalog_proxy_work_keys(embedding_literal, limit=PROXY_SUBSET_SIZE):
    sql = """
        SELECT work_key FROM catalog_embeddings
        ORDER BY embedding <=> CAST(:embedding AS vector) ASC
        LIMIT :limit;
    """
    parameters = [
        {"name": "embedding", "value": {"stringValue": embedding_literal}},
        {"name": "limit", "value": {"longValue": limit}},
    ]
    result = rds_data.execute_statement(
        resourceArn=AURORA_CLUSTER_ARN,
        secretArn=AURORA_SECRET_ARN,
        database=AURORA_DATABASE_NAME,
        sql=sql,
        parameters=parameters,
    )
    return [row[0]["stringValue"] for row in result.get("records", [])]


def _nearest_catalog_matches(embedding_literal, work_keys=None, limit=NEAREST_MATCH_LIMIT):
    parameters = [
        {"name": "embedding", "value": {"stringValue": embedding_literal}},
        {"name": "limit", "value": {"longValue": limit}},
    ]
    if work_keys:
        # Named placeholders, not an arrayValue parameter - the RDS Data API
        # flatly rejects array-type parameters (see handoff.md section 16.3).
        # work_keys always come from our own catalog, never user input, so
        # this is safe despite building the placeholder list dynamically.
        placeholders = ", ".join(f":key{i}" for i in range(len(work_keys)))
        parameters += [{"name": f"key{i}", "value": {"stringValue": k}} for i, k in enumerate(work_keys)]
        sql = f"""
            SELECT title, author, embedding <=> CAST(:embedding AS vector) AS distance
            FROM catalog_embeddings
            WHERE work_key IN ({placeholders})
            ORDER BY distance ASC
            LIMIT :limit;
        """
    else:
        sql = """
            SELECT title, author, embedding <=> CAST(:embedding AS vector) AS distance
            FROM catalog_embeddings
            ORDER BY distance ASC
            LIMIT :limit;
        """
    return _nearest_matches(sql, parameters)


def lambda_handler(event, context):
    start = time.monotonic()

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _error(400, "Request body must be valid JSON")

    user_id, _authenticated = _resolve_user_id(event, body.get("userId"))
    candidates = body.get("candidates")

    if not user_id or not candidates or not isinstance(candidates, list):
        return _error(400, "userId and a non-empty candidates list are required")

    session_id = body.get("sessionId") or f"sess_{uuid.uuid4().hex[:12]}"
    constraints = body.get("constraints")
    exploration_mode = body.get("explorationMode")
    if exploration_mode not in MODE_INSTRUCTIONS:
        exploration_mode = "preference"

    user = _get_or_create_user(user_id)
    taste_profile = user.get("tasteProfile", _default_taste_profile())
    raw_reading_pace = user.get("readingPace") or {"avgPagesPerHour": 0, "totalSessions": 0}
    avg_pages_per_hour = float(raw_reading_pace.get("avgPagesPerHour") or 0)
    reading_pace = {
        "avgPagesPerHour": avg_pages_per_hour,
        "totalSessions": int(raw_reading_pace.get("totalSessions") or 0),
    }

    established = _count_user_embeddings(user_id) > 0
    mode = "established" if established else "cold_start"

    filtered_candidates = _filter_disliked_genres(candidates, taste_profile.get("dislikedGenres"))

    if not filtered_candidates:
        processing_time_ms = _elapsed_ms(start)
        scan_sessions_table.put_item(
            Item={
                "sessionId": session_id,
                "userId": user_id,
                "scannedAt": _now_iso(),
                "extractedTitles": [c.get("title") for c in candidates if c.get("title")],
                "recommendedBooks": [],
                "mode": mode,
                "explorationMode": exploration_mode,
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
                    "explorationMode": exploration_mode,
                    "recommendations": [],
                    "tasteProfileUsed": taste_profile,
                    "processingTimeMs": processing_time_ms,
                }
            ),
        }

    proxy_work_keys = None
    if not established and _has_preferences(taste_profile):
        preference_embedding = _embed_text(_preference_text(taste_profile))
        preference_literal = "[" + ",".join(str(v) for v in preference_embedding) + "]"
        proxy_work_keys = _catalog_proxy_work_keys(preference_literal)

    candidates_with_signals = []
    matches_by_title = {}
    for candidate in filtered_candidates:
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
            else _nearest_catalog_matches(embedding_literal, work_keys=proxy_work_keys)
        )
        matches_by_title[title.lower()] = matches

        page_count = candidate.get("pageCount")
        estimated_hours = round(page_count / avg_pages_per_hour, 1) if page_count and avg_pages_per_hour else None

        candidates_with_signals.append(
            {
                "title": title,
                "author": author,
                "pageCount": page_count,
                "genres": genres,
                "nearestMatches": matches,
                "estimatedHours": estimated_hours,
            }
        )

    def _sort_key(c):
        matches = matches_by_title.get(c["title"].lower())
        if not matches:
            return float("inf")
        return matches[0]["distance"]

    candidates_with_signals.sort(key=_sort_key, reverse=(exploration_mode == "novelty"))

    prompt = build_recommendation_prompt(candidates_with_signals, taste_profile, mode, constraints, exploration_mode, reading_pace)
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
                "title": candidate["title"],
                "author": candidate["author"],
                "pageCount": candidate["pageCount"],
                "reasoning": rec.get("reasoning", ""),
                "matchScore": match_score,
                "matchedSignals": rec.get("matchedSignals", []),
                "similarTo": similar_to,
                "estimatedHours": candidate.get("estimatedHours"),
            }
        )

    # Claude's own "rank" field in its JSON response reflects its holistic
    # judgment (which can reasonably disagree with raw matchScore), but the
    # UI shows a numeric match percentage right next to the rank - if the two
    # don't correlate, the list looks broken even when it isn't. Sort and
    # re-rank by matchScore explicitly so position always matches the score
    # shown. Direction mirrors the candidate pre-sort above: "preference"
    # wants the closest match first (descending score), "novelty" wants the
    # most divergent pick first (ascending score - low match = more novel).
    recommendations.sort(key=lambda r: r["matchScore"], reverse=(exploration_mode == "preference"))
    for rank, rec in enumerate(recommendations, start=1):
        rec["rank"] = rank

    processing_time_ms = _elapsed_ms(start)

    scan_sessions_table.put_item(
        Item={
            "sessionId": session_id,
            "userId": user_id,
            "scannedAt": _now_iso(),
            "extractedTitles": [c["title"] for c in candidates_with_signals],
            "recommendedBooks": _dynamo_safe(recommendations),
            "mode": mode,
            "explorationMode": exploration_mode,
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
                "explorationMode": exploration_mode,
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
