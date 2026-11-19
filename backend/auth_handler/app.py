import json
import os
import time

import boto3
from boto3.dynamodb.conditions import Key

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DYNAMODB_USERS_TABLE = os.environ["DYNAMODB_USERS_TABLE"]
DYNAMODB_HISTORY_TABLE = os.environ["DYNAMODB_HISTORY_TABLE"]
DYNAMODB_PACE_SESSIONS_TABLE = os.environ["DYNAMODB_PACE_SESSIONS_TABLE"]
DYNAMODB_SCAN_SESSIONS_TABLE = os.environ["DYNAMODB_SCAN_SESSIONS_TABLE"]
AURORA_CLUSTER_ARN = os.environ["AURORA_CLUSTER_ARN"]
AURORA_SECRET_ARN = os.environ["AURORA_SECRET_ARN"]
AURORA_DATABASE_NAME = os.environ["AURORA_DATABASE_NAME"]

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
users_table = dynamodb.Table(DYNAMODB_USERS_TABLE)
history_table = dynamodb.Table(DYNAMODB_HISTORY_TABLE)
pace_sessions_table = dynamodb.Table(DYNAMODB_PACE_SESSIONS_TABLE)
scan_sessions_table = dynamodb.Table(DYNAMODB_SCAN_SESSIONS_TABLE)

rds_data = boto3.client("rds-data", region_name=AWS_REGION)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}


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


def _default_reading_pace():
    return {"avgPagesPerHour": 0, "totalSessions": 0, "lastUpdated": _now_iso()}


def _dedupe_append(existing_list, new_items):
    result = list(existing_list or [])
    for item in new_items or []:
        if item and item not in result:
            result.append(item)
    return result


def _merge_taste_profiles(authenticated_profile, anonymous_profile):
    """Merges a guest's taste profile into an already-existing authenticated
    profile - dedupe-append per list field, the same idiom used elsewhere
    for merging inferred feedback signals - so a returning user who already
    had an account never loses what they'd already told it.
    """
    merged = dict(authenticated_profile or _default_taste_profile())
    for field in ("favoriteAuthors", "favoriteGenres", "dislikedGenres", "writingStylePrefs", "avoidThemes"):
        merged[field] = _dedupe_append(merged.get(field), anonymous_profile.get(field))
    for field in ("preferredPacing", "preferredLength"):
        if not merged.get(field) and anonymous_profile.get(field):
            merged[field] = anonymous_profile[field]
    merged["lastUpdated"] = _now_iso()
    return merged


def _merge_reading_pace(authenticated_pace, anonymous_pace):
    """A rolling average can't be correctly averaged-of-averages without the
    underlying per-session data, so the side with more logged sessions wins
    outright rather than producing a blended number that misrepresents pace.
    """
    authenticated_pace = authenticated_pace or _default_reading_pace()
    anonymous_pace = anonymous_pace or _default_reading_pace()
    if int(anonymous_pace.get("totalSessions", 0)) > int(authenticated_pace.get("totalSessions", 0)):
        return anonymous_pace
    return authenticated_pace


def _requeue_items_under_new_key(table, key_field, old_user_id, new_user_id, sort_key_field):
    """Query everything under old_user_id, batch-write copies under
    new_user_id, batch-delete the originals. Shared pattern for
    ReadingHistory (userId + sk) and PaceSessions (userId + sessionId).
    """
    response = table.query(KeyConditionExpression=Key(key_field).eq(old_user_id))
    items = response.get("Items", [])
    if not items:
        return 0

    with table.batch_writer() as batch:
        for item in items:
            new_item = dict(item)
            new_item[key_field] = new_user_id
            batch.put_item(Item=new_item)
        for item in items:
            batch.delete_item(Key={key_field: old_user_id, sort_key_field: item[sort_key_field]})

    return len(items)


def _requeue_scan_sessions(old_user_id, new_user_id):
    response = scan_sessions_table.query(
        IndexName="userId-index",
        KeyConditionExpression=Key("userId").eq(old_user_id),
    )
    items = response.get("Items", [])
    for item in items:
        scan_sessions_table.update_item(
            Key={"sessionId": item["sessionId"]},
            UpdateExpression="SET userId = :new",
            ExpressionAttributeValues={":new": new_user_id},
        )
    return len(items)


def _rekey_embeddings(old_user_id, new_user_id):
    rds_data.execute_statement(
        resourceArn=AURORA_CLUSTER_ARN,
        secretArn=AURORA_SECRET_ARN,
        database=AURORA_DATABASE_NAME,
        sql="UPDATE book_embeddings SET user_id = :new WHERE user_id = :old;",
        parameters=[
            {"name": "new", "value": {"stringValue": new_user_id}},
            {"name": "old", "value": {"stringValue": old_user_id}},
        ],
    )


def claim_anonymous_data(anonymous_user_id, authenticated_user_id):
    """Idempotent: safe to call twice, and a clean no-op if the anonymous id
    never existed or was already claimed. Returns a summary used for the
    frontend's one-time "we brought over your data" confirmation.
    """
    if not anonymous_user_id or anonymous_user_id == authenticated_user_id:
        return {"claimed": False, "booksRead": 0, "paceSessions": 0, "historyRows": 0}

    anonymous_response = users_table.get_item(Key={"userId": anonymous_user_id})
    anonymous_user = anonymous_response.get("Item")
    if not anonymous_user:
        return {"claimed": False, "booksRead": 0, "paceSessions": 0, "historyRows": 0}

    authenticated_response = users_table.get_item(Key={"userId": authenticated_user_id})
    authenticated_user = authenticated_response.get("Item")

    merged_profile = _merge_taste_profiles(
        (authenticated_user or {}).get("tasteProfile"),
        anonymous_user.get("tasteProfile", _default_taste_profile()),
    )
    merged_pace = _merge_reading_pace(
        (authenticated_user or {}).get("readingPace"),
        anonymous_user.get("readingPace"),
    )
    merged_books_read = int((authenticated_user or {}).get("totalBooksRead", 0)) + int(
        anonymous_user.get("totalBooksRead", 0)
    )

    users_table.put_item(
        Item={
            "userId": authenticated_user_id,
            "createdAt": (authenticated_user or {}).get("createdAt", _now_iso()),
            "tasteProfile": merged_profile,
            "readingPace": merged_pace,
            "totalBooksRead": merged_books_read,
        }
    )

    history_count = _requeue_items_under_new_key(
        history_table, "userId", anonymous_user_id, authenticated_user_id, "sk"
    )
    pace_count = _requeue_items_under_new_key(
        pace_sessions_table, "userId", anonymous_user_id, authenticated_user_id, "sessionId"
    )
    _requeue_scan_sessions(anonymous_user_id, authenticated_user_id)
    _rekey_embeddings(anonymous_user_id, authenticated_user_id)

    # The anonymous id is now "used up" - if it's ever seen again on an old
    # anonymous route, it lazily recreates as a fresh empty guest profile,
    # which is the correct behavior.
    users_table.delete_item(Key={"userId": anonymous_user_id})

    return {
        "claimed": True,
        "booksRead": int(anonymous_user.get("totalBooksRead", 0)),
        "paceSessions": pace_count,
        "historyRows": history_count,
    }


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    claims = (event.get("requestContext") or {}).get("authorizer", {}).get("claims") or {}
    authenticated_user_id = claims.get("sub")
    if not authenticated_user_id:
        return _error(401, "A valid signed-in session is required")

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _error(400, "Request body must be valid JSON")

    result = claim_anonymous_data(body.get("anonymousUserId"), authenticated_user_id)

    return {
        "statusCode": 200,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps({"userId": authenticated_user_id, **result}),
    }


def _error(status_code, message):
    return {
        "statusCode": status_code,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps({"error": message}),
    }
