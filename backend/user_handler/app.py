import json
import os
import time

import boto3

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DYNAMODB_USERS_TABLE = os.environ["DYNAMODB_USERS_TABLE"]
DYNAMODB_HISTORY_TABLE = os.environ["DYNAMODB_HISTORY_TABLE"]

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
users_table = dynamodb.Table(DYNAMODB_USERS_TABLE)
history_table = dynamodb.Table(DYNAMODB_HISTORY_TABLE)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
}


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


def _default_reading_pace():
    return {"avgPagesPerHour": 0, "totalSessions": 0, "lastUpdated": _now_iso()}


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _get_or_create_user(user_id):
    response = users_table.get_item(Key={"userId": user_id})
    item = response.get("Item")
    if item:
        return item

    item = {
        "userId": user_id,
        "createdAt": _now_iso(),
        "tasteProfile": _default_taste_profile(),
        "readingPace": _default_reading_pace(),
        "totalBooksRead": 0,
    }
    users_table.put_item(Item=item)
    return item


def _recent_books(user_id, limit=10):
    response = history_table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("userId").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    books = []
    for entry in response.get("Items", []):
        book_id = entry["sk"].split("#", 1)[0] if "#" in entry.get("sk", "") else entry.get("sk")
        rating = entry.get("rating")
        books.append(
            {
                "bookId": book_id,
                "title": entry.get("title"),
                "author": entry.get("author"),
                "rating": int(rating) if rating is not None else None,
                "readAt": entry.get("readAt"),
            }
        )
    return books


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    path_params = event.get("pathParameters") or {}
    user_id = path_params.get("userId")
    if not user_id:
        return _error(400, "userId is required")

    user = _get_or_create_user(user_id)

    return {
        "statusCode": 200,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(
            {
                "userId": user_id,
                "tasteProfile": user.get("tasteProfile", _default_taste_profile()),
                "readingPace": {
                    "avgPagesPerHour": float(user.get("readingPace", {}).get("avgPagesPerHour", 0)),
                    "totalSessions": int(user.get("readingPace", {}).get("totalSessions", 0)),
                },
                "totalBooksRead": int(user.get("totalBooksRead", 0)),
                "recentBooks": _recent_books(user_id),
            }
        ),
    }


def _error(status_code, message):
    return {
        "statusCode": status_code,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps({"error": message}),
    }
