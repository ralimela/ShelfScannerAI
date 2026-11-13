import json
import os
import time

import boto3
from botocore.exceptions import ClientError

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", AWS_REGION)
DYNAMODB_USERS_TABLE = os.environ["DYNAMODB_USERS_TABLE"]
DYNAMODB_BOOKS_TABLE = os.environ["DYNAMODB_BOOKS_TABLE"]
DYNAMODB_HISTORY_TABLE = os.environ["DYNAMODB_HISTORY_TABLE"]
BEDROCK_CLAUDE_MODEL_ID = os.environ["BEDROCK_CLAUDE_MODEL_ID"]
BEDROCK_TITAN_EMBED_MODEL_ID = os.environ["BEDROCK_TITAN_EMBED_MODEL_ID"]
AURORA_CLUSTER_ARN = os.environ["AURORA_CLUSTER_ARN"]
AURORA_SECRET_ARN = os.environ["AURORA_SECRET_ARN"]
AURORA_DATABASE_NAME = os.environ["AURORA_DATABASE_NAME"]

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
users_table = dynamodb.Table(DYNAMODB_USERS_TABLE)
books_table = dynamodb.Table(DYNAMODB_BOOKS_TABLE)
history_table = dynamodb.Table(DYNAMODB_HISTORY_TABLE)

bedrock_runtime = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
rds_data = boto3.client("rds-data", region_name=AWS_REGION)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

BOOKS_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days, per handoff.md section 6

# Verbatim from ShelfScannerAI_Handoff.md section 8, "Prompt 2 — Feedback Signal Extractor"
FEEDBACK_SYSTEM_PROMPT = """
You are analyzing a reader's post-book feedback to extract structured taste signals.
These signals will update their permanent taste profile for future recommendations.

Extract what they liked and disliked at the level of:
- Writing style (prose density, sentence structure, voice)
- Narrative structure (pacing, timeline, POV)
- Themes and subject matter
- Author traits

Return valid JSON only — no preamble.

OUTPUT FORMAT:
{
  "likedElements": ["list of specific liked elements"],
  "dislikedElements": ["list of specific disliked elements"],
  "authorStyleRating": 1-5,
  "wouldRecommendSimilar": true/false,
  "tasteProfileUpdates": {
    "addToPreferred": ["element to add to preferences"],
    "addToAvoided": ["element to add to avoid list"],
    "writingStyleSignals": ["new signals to track"]
  }
}
"""


def build_feedback_prompt(feedback_text, book_metadata, existing_profile):
    return f"""
BOOK: {book_metadata['title']} by {book_metadata['author']}
GENRE: {', '.join(book_metadata.get('genres', []))}

READER FEEDBACK:
"{feedback_text}"

EXISTING TASTE PROFILE:
{json.dumps(existing_profile, indent=2)}

Extract taste signals from this feedback and suggest updates to the profile.
"""


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


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


def _get_book_metadata(book_id, fallback_title, fallback_author, fallback_genres):
    response = books_table.get_item(Key={"bookId": book_id})
    item = response.get("Item")
    if item:
        return {
            "title": item.get("title", fallback_title or book_id),
            "author": item.get("author", fallback_author),
            "genres": item.get("genres", fallback_genres or []),
        }

    metadata = {
        "title": fallback_title or book_id,
        "author": fallback_author,
        "genres": fallback_genres or [],
    }

    try:
        books_table.put_item(
            Item={
                "bookId": book_id,
                "title": metadata["title"],
                "author": metadata["author"],
                "genres": metadata["genres"],
                "cachedAt": _now_iso(),
                "ttl": int(time.time()) + BOOKS_CACHE_TTL_SECONDS,
            }
        )
    except ClientError:
        pass  # best-effort cache fill — feedback processing should not fail over this

    return metadata


def _invoke_claude(system_prompt, user_prompt):
    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_CLAUDE_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1024,
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


def _upsert_embedding(user_id, book_id, title, author, rating, embedding, max_attempts=3, delay_seconds=5):
    embedding_literal = "[" + ",".join(str(value) for value in embedding) + "]"
    sql = """
        INSERT INTO book_embeddings (user_id, book_id, title, author, rating, embedding, embedded_at)
        VALUES (:user_id, :book_id, :title, :author, :rating, CAST(:embedding AS vector), now())
        ON CONFLICT (user_id, book_id) DO UPDATE SET
            title = EXCLUDED.title,
            author = EXCLUDED.author,
            rating = EXCLUDED.rating,
            embedding = EXCLUDED.embedding,
            embedded_at = EXCLUDED.embedded_at;
    """
    parameters = [
        {"name": "user_id", "value": {"stringValue": user_id}},
        {"name": "book_id", "value": {"stringValue": book_id}},
        {"name": "title", "value": {"stringValue": title} if title else {"isNull": True}},
        {"name": "author", "value": {"stringValue": author} if author else {"isNull": True}},
        {"name": "rating", "value": {"longValue": int(rating)}},
        {"name": "embedding", "value": {"stringValue": embedding_literal}},
    ]

    last_error = None
    for attempt in range(max_attempts):
        try:
            rds_data.execute_statement(
                resourceArn=AURORA_CLUSTER_ARN,
                secretArn=AURORA_SECRET_ARN,
                database=AURORA_DATABASE_NAME,
                sql=sql,
                parameters=parameters,
            )
            return
        except (rds_data.exceptions.DatabaseResumingException, rds_data.exceptions.BadRequestException) as exc:
            last_error = exc
            if attempt < max_attempts - 1:
                time.sleep(delay_seconds)
    raise last_error


def _dedupe_append(existing_list, new_items):
    result = list(existing_list or [])
    for item in new_items or []:
        if item and item not in result:
            result.append(item)
    return result


def _merge_taste_profile(existing_profile, signals, book_metadata, rating):
    profile = dict(existing_profile or _default_taste_profile())
    updates = signals.get("tasteProfileUpdates", {})

    profile["writingStylePrefs"] = _dedupe_append(
        profile.get("writingStylePrefs"),
        list(updates.get("addToPreferred", [])) + list(updates.get("writingStyleSignals", [])),
    )
    profile["avoidThemes"] = _dedupe_append(profile.get("avoidThemes"), updates.get("addToAvoided", []))

    if signals.get("authorStyleRating", 0) >= 4 and book_metadata.get("author"):
        profile["favoriteAuthors"] = _dedupe_append(profile.get("favoriteAuthors"), [book_metadata["author"]])

    profile["lastUpdated"] = _now_iso()
    return profile


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _error(400, "Request body must be valid JSON")

    user_id = body.get("userId")
    book_id = body.get("bookId")
    rating = body.get("rating")
    feedback_text = body.get("feedbackText")

    if not user_id or not book_id or not feedback_text or rating is None:
        return _error(400, "userId, bookId, rating, and feedbackText are required")

    if not isinstance(rating, int) or not (1 <= rating <= 5):
        return _error(400, "rating must be an integer from 1 to 5")

    finished_at = body.get("finishedAt") or _now_iso()
    started_at = body.get("startedAt")

    user = _get_or_create_user(user_id)
    existing_profile = user.get("tasteProfile", _default_taste_profile())

    book_metadata = _get_book_metadata(
        book_id, body.get("title"), body.get("author"), body.get("genres")
    )

    prompt = build_feedback_prompt(feedback_text, book_metadata, existing_profile)
    signals = _invoke_claude(FEEDBACK_SYSTEM_PROMPT, prompt)

    updated_profile = _merge_taste_profile(existing_profile, signals, book_metadata, rating)

    users_table.update_item(
        Key={"userId": user_id},
        UpdateExpression="SET tasteProfile = :profile ADD totalBooksRead :one",
        ExpressionAttributeValues={":profile": updated_profile, ":one": 1},
    )

    history_table.put_item(
        Item={
            "userId": user_id,
            "sk": f"{book_id}#{finished_at}",
            "title": book_metadata["title"],
            "author": book_metadata["author"],
            "rating": rating,
            "feedbackText": feedback_text,
            "tasteSignals": signals,
            "readAt": finished_at,
            "startedAt": started_at,
        }
    )

    embedding_input = (
        f"{book_metadata['title']} by {book_metadata['author']}. Reader feedback: {feedback_text}"
    )
    embedding = _embed_text(embedding_input)
    _upsert_embedding(
        user_id, book_id, book_metadata["title"], book_metadata["author"], rating, embedding
    )

    return {
        "statusCode": 200,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(
            {
                "success": True,
                "tasteProfileUpdated": True,
                "extractedSignals": {
                    "likedElements": signals.get("likedElements", []),
                    "dislikedElements": signals.get("dislikedElements", []),
                    "authorStyleRating": signals.get("authorStyleRating"),
                },
            }
        ),
    }


def _error(status_code, message):
    return {
        "statusCode": status_code,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps({"error": message}),
    }
