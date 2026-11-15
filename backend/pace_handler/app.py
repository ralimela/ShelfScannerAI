import json
import os
import time
import uuid
from datetime import datetime
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DYNAMODB_USERS_TABLE = os.environ["DYNAMODB_USERS_TABLE"]
DYNAMODB_PACE_SESSIONS_TABLE = os.environ["DYNAMODB_PACE_SESSIONS_TABLE"]

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
users_table = dynamodb.Table(DYNAMODB_USERS_TABLE)
pace_sessions_table = dynamodb.Table(DYNAMODB_PACE_SESSIONS_TABLE)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}

ROLLING_WINDOW = 20


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _dynamo_safe(value):
    """DynamoDB's boto3 resource API rejects native Python float - it requires
    Decimal. Round-tripping through json with parse_float=Decimal recursively
    converts any floats nested in lists/dicts without hand-walking the structure.
    """
    return json.loads(json.dumps(value), parse_float=Decimal)


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


def _recent_pages_per_hour(user_id, limit=ROLLING_WINDOW - 1):
    response = pace_sessions_table.query(
        KeyConditionExpression=Key("userId").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return [float(item["pagesPerHour"]) for item in response.get("Items", [])]


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    path_params = event.get("pathParameters") or {}
    user_id = path_params.get("userId")
    if not user_id:
        return _error(400, "userId is required")

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _error(400, "Request body must be valid JSON")

    started_at = body.get("startedAt")
    ended_at = body.get("endedAt")
    pages_read = body.get("pagesRead")

    if not started_at or not ended_at or pages_read is None:
        return _error(400, "startedAt, endedAt, and pagesRead are required")

    try:
        started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        ended = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
        pages_read = int(pages_read)
    except (ValueError, TypeError):
        return _error(400, "startedAt/endedAt must be ISO-8601 timestamps and pagesRead an integer")

    duration_minutes = (ended - started).total_seconds() / 60
    if pages_read <= 0 or duration_minutes < 1:
        return _error(400, "pagesRead must be positive and the session must last at least a minute")

    pages_per_hour = pages_read / (duration_minutes / 60)

    _get_or_create_user(user_id)

    previous_rates = _recent_pages_per_hour(user_id)
    rolling_rates = previous_rates + [pages_per_hour]
    avg_pages_per_hour = round(sum(rolling_rates) / len(rolling_rates), 1)

    session_id = f"{started_at}#{uuid.uuid4().hex[:8]}"
    session_item = {
        "userId": user_id,
        "sessionId": session_id,
        "bookId": body.get("bookId"),
        "title": body.get("title"),
        "author": body.get("author"),
        "startedAt": started_at,
        "endedAt": ended_at,
        "durationMinutes": round(duration_minutes, 1),
        "pagesRead": pages_read,
        "pagesPerHour": round(pages_per_hour, 1),
        "createdAt": _now_iso(),
    }
    pace_sessions_table.put_item(Item=_dynamo_safe(session_item))

    users_table.update_item(
        Key={"userId": user_id},
        UpdateExpression=(
            "SET readingPace.avgPagesPerHour = :avg, "
            "readingPace.totalSessions = if_not_exists(readingPace.totalSessions, :zero) + :one, "
            "readingPace.lastUpdated = :now"
        ),
        ExpressionAttributeValues={
            ":avg": Decimal(str(avg_pages_per_hour)),
            ":zero": 0,
            ":one": 1,
            ":now": _now_iso(),
        },
    )

    updated_user = users_table.get_item(Key={"userId": user_id}).get("Item", {})
    reading_pace = updated_user.get("readingPace", {})

    return {
        "statusCode": 200,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(
            {
                "userId": user_id,
                "session": session_item,
                "readingPace": {
                    "avgPagesPerHour": float(reading_pace.get("avgPagesPerHour", avg_pages_per_hour)),
                    "totalSessions": int(reading_pace.get("totalSessions", 0)),
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
