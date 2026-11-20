import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
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
# Stated preferences start out dominant and share weight with reading history
# as it grows: weight = K / (K + books read), never below the floor, so what a
# reader explicitly told us keeps counting no matter how much they've logged.
PREFERENCE_PRIOR_WEIGHT = 2
PREFERENCE_WEIGHT_FLOOR = 0.2

MODE_INSTRUCTIONS = {
    "preference": "The reader wants books closest to their established taste. Prioritize candidates with the HIGHEST matchScore.",
    "novelty": "The reader explicitly wants to try something OUTSIDE their usual taste today. Prioritize candidates with the LOWEST matchScore - a genuine stretch, not their usual pick. Still never recommend anything touching their avoid-themes below. Justify why it's a worthwhile stretch, not merely different.",
}

# Adapted from ShelfScannerAI_Handoff.md section 8, "Prompt 1 — Recommendation Agent"
RECOMMENDATION_SYSTEM_PROMPT = """
You are a personal reading companion with deep knowledge of literature,
author writing styles, narrative structures, and reader psychology.

Your job is to analyze a list of available books against a reader's personal
taste profile and recommend the best matches with clear, specific reasoning.
Each available book comes with two similarity signals:
- nearestFromHistory: the closest books the reader has actually finished
- nearestFromPreferences: the closest books from a curated catalog chosen to
  match the preferences the reader stated
These are blended into matchScore; preferenceWeight (0-1) says how much the
stated preferences count for this reader right now. Respect both: a reader's
explicitly stated tastes matter even after they've logged books.

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
    history_note = (
        "The reader has finished books, so nearestFromHistory is populated."
        if mode == "established"
        else "The reader hasn't logged any books yet, so only nearestFromPreferences is populated."
    )
    return f"""
AVAILABLE BOOKS (extracted from bookshelf photo), each with similarity signals.
{history_note}
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
references the specific similar book(s) in its signals and/or the stated
preferences in the taste profile - not generic praise. Only include books you can make a strong case
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


def _normalize_title(title):
    return re.sub(r"[^a-z0-9]", "", (title or "").lower())


def _without_self(matches, title):
    """A book already in the history or catalog being searched is always its
    own nearest neighbor - that's not a similarity signal, so drop it."""
    key = _normalize_title(title)
    return [m for m in matches if _normalize_title(m["title"]) != key][:NEAREST_MATCH_LIMIT]


def blend_signals(history_matches, preference_matches, books_read):
    history_best = history_matches[0] if history_matches else None
    preference_best = preference_matches[0] if preference_matches else None

    if history_best and preference_best:
        weight = max(PREFERENCE_WEIGHT_FLOOR, PREFERENCE_PRIOR_WEIGHT / (PREFERENCE_PRIOR_WEIGHT + max(books_read, 1)))
    elif preference_best:
        weight = 1.0
    else:
        weight = 0.0

    history_part = (1 - weight) * (1 - history_best["distance"]) if history_best else 0
    preference_part = weight * (1 - preference_best["distance"]) if preference_best else 0
    if history_best and preference_best:
        similar_to = history_best if history_part >= preference_part else preference_best
    else:
        similar_to = history_best or preference_best

    return {
        "matchScore": round(max(0, history_part + preference_part), 2),
        "preferenceWeight": round(weight, 2),
        "similarTo": similar_to,
    }


def score_candidate(user_id, embedding_literal, title, established, proxy_work_keys, books_read):
    history_matches = (
        _without_self(_nearest_history_matches(user_id, embedding_literal, limit=NEAREST_MATCH_LIMIT + 1), title)
        if established
        else []
    )
    # Cold-start readers with no stated preferences fall back to the whole
    # catalog; established readers without preferences use history alone.
    use_preferences = proxy_work_keys is not None or not established
    preference_matches = (
        _without_self(
            _nearest_catalog_matches(embedding_literal, work_keys=proxy_work_keys, limit=NEAREST_MATCH_LIMIT + 1),
            title,
        )
        if use_preferences
        else []
    )
    return {
        "nearestFromHistory": history_matches,
        "nearestFromPreferences": preference_matches,
        **blend_signals(history_matches, preference_matches, books_read),
    }


def lambda_handler(event, context):
    start = time.monotonic()

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _error(400, "Request body must be valid JSON")

    if (event.get("resource") or "").endswith("/chat"):
        return _handle_chat(event, body, start)
    return _handle_recommend(event, body, start)


def _handle_recommend(event, body, start):
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

    books_read = _count_user_embeddings(user_id)
    established = books_read > 0
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
                    "blendedWithPreferences": False,
                    "tasteProfileUsed": taste_profile,
                    "processingTimeMs": processing_time_ms,
                }
            ),
        }

    proxy_work_keys = None
    if _has_preferences(taste_profile):
        preference_embedding = _embed_text(_preference_text(taste_profile))
        preference_literal = "[" + ",".join(str(v) for v in preference_embedding) + "]"
        proxy_work_keys = _catalog_proxy_work_keys(preference_literal)

    candidates_with_signals = []
    signals_by_title = {}
    for candidate in filtered_candidates:
        title = candidate.get("title")
        if not title:
            continue
        author = candidate.get("author")
        genres = candidate.get("genres") or []

        embedding_text = f"{title} by {author or 'Unknown'}. Genres: {', '.join(genres)}"
        embedding = _embed_text(embedding_text)
        embedding_literal = "[" + ",".join(str(v) for v in embedding) + "]"

        signal = score_candidate(user_id, embedding_literal, title, established, proxy_work_keys, books_read)
        signals_by_title[title.lower()] = signal

        page_count = candidate.get("pageCount")
        estimated_hours = round(page_count / avg_pages_per_hour, 1) if page_count and avg_pages_per_hour else None

        candidates_with_signals.append(
            {
                "title": title,
                "author": author,
                "pageCount": page_count,
                "genres": genres,
                "matchScore": signal["matchScore"],
                "preferenceWeight": signal["preferenceWeight"],
                "nearestFromHistory": signal["nearestFromHistory"],
                "nearestFromPreferences": signal["nearestFromPreferences"],
                "estimatedHours": estimated_hours,
            }
        )

    candidates_with_signals.sort(key=lambda c: c["matchScore"], reverse=(exploration_mode == "preference"))

    prompt = build_recommendation_prompt(candidates_with_signals, taste_profile, mode, constraints, exploration_mode, reading_pace)
    claude_output = _invoke_claude(RECOMMENDATION_SYSTEM_PROMPT, prompt)

    candidates_by_title = {c["title"].lower(): c for c in candidates_with_signals}
    recommendations = []
    for rec in claude_output.get("recommendations", []):
        rec_title = rec.get("title", "")
        candidate = candidates_by_title.get(rec_title.lower())
        if not candidate:
            continue  # drop anything Claude hallucinated that wasn't in the scanned candidates

        signal = signals_by_title[rec_title.lower()]
        recommendations.append(
            {
                "title": candidate["title"],
                "author": candidate["author"],
                "pageCount": candidate["pageCount"],
                "reasoning": rec.get("reasoning", ""),
                "matchScore": signal["matchScore"],
                "matchedSignals": rec.get("matchedSignals", []),
                "similarTo": signal["similarTo"],
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
                "blendedWithPreferences": established and proxy_work_keys is not None,
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


# ---------------------------------------------------------------------------
# Chat agent: POST /chat and /me/chat
# ---------------------------------------------------------------------------

CHAT_MAX_MESSAGES = 12
CHAT_MAX_MESSAGE_CHARS = 2000
CHAT_MAX_TOOL_ROUNDS = 4
CHAT_MAX_BOOKS_PER_CALL = 6
CHAT_MAX_PICKS = 5
CATALOG_SEARCH_LIMIT = 5
HISTORY_PROMPT_LIMIT = 40

CHAT_TOOLS = [
    {
        "name": "evaluate_books",
        "description": (
            "Evaluate specific books against this reader. Use whenever the reader names books they're "
            "considering, or you want to check particular titles. For each book returns: canonical title "
            "and author, pageCount, genres, matchScore (0-1, blending similarity to the reader's finished "
            "books with similarity to their stated preferences; preferenceWeight says how much the "
            "preferences count), nearestFromHistory and nearestFromPreferences (the closest books behind "
            "each signal), similarTo (the single most relevant one), estimatedHours at their reading pace, "
            "alreadyRead, dislikedGenre (set if it falls in a genre they dislike), and found (false if no "
            "matching book could be looked up)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "books": {
                    "type": "array",
                    "maxItems": CHAT_MAX_BOOKS_PER_CALL,
                    "items": {
                        "type": "object",
                        "properties": {"title": {"type": "string"}, "author": {"type": "string"}},
                        "required": ["title"],
                    },
                }
            },
            "required": ["books"],
        },
    },
    {
        "name": "search_catalog",
        "description": (
            "Search a curated catalog of about 445 well-known books by a natural-language description "
            "(mood, theme, style, genre, length). Use for open-ended requests where the reader hasn't named "
            "specific books. Returns the top matches the reader hasn't already read, evaluated in the same "
            "format as evaluate_books."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to look for, e.g. 'short atmospheric horror with a small-town setting'",
                }
            },
            "required": ["query"],
        },
    },
]

CHAT_SYSTEM_PROMPT = """
You are the reading companion inside ShelfScannerAI. The reader is chatting with you to
decide what to read next - usually choosing between a few books they have in mind,
sometimes asking something open-ended.

You know this reader through the profile below. Ground every recommendation in it:
reference specific books they've finished and how they rated them, their favorite
genres and authors, and the styles they're drawn to. The preferences they stated
themselves matter as much as what they've read - never drop them just because they've
logged a few books. Never give generic praise.

TOOLS
- evaluate_books: call it whenever the reader names books, even one. Never judge a named
  book without evaluating it first in this turn.
- search_catalog: call it for open-ended requests where no specific books are named.
Scores and reading times come only from tool results - never invent a matchScore or an
hour estimate. Treat constraints the reader states (length, mood, content) as real
requirements: check them against the tool data, and if a book misses one, say so plainly
instead of softening it. If a book is alreadyRead or has a dislikedGenre, say so plainly. If a book
wasn't found, say you couldn't find it rather than guessing.

STYLE
- Warm, direct, and brief: usually 2-4 short paragraphs. Plain text only - no markdown,
  no bullet lists, no headings.
- Lead with a clear answer to what they asked, e.g. which book to read first and why.
- If the request is too ambiguous to act on, ask one short clarifying question.

OUTPUT
Your final message must be ONLY a JSON object - no preamble, no code fences:
{"reply": "your conversational answer", "picks": [{"title": "exact title as returned by a tool", "reasoning": "1-2 sentences specific to this reader", "matchedSignals": ["short signal"]}]}
- picks: the books you actually recommend, in the order you recommend them, at most 5,
  and only books a tool returned in this turn. They're shown as numbered cards in that
  order, so it must agree with your reply. Leave out books you're advising against
  (e.g. ones that miss a stated constraint), and use [] when asking a question or when
  nothing fits.
"""


def _reading_history(user_id):
    result = rds_data.execute_statement(
        resourceArn=AURORA_CLUSTER_ARN,
        secretArn=AURORA_SECRET_ARN,
        database=AURORA_DATABASE_NAME,
        sql="""
            SELECT title, author, rating FROM book_embeddings
            WHERE user_id = :user_id
            ORDER BY rating DESC NULLS LAST
            LIMIT :limit;
        """,
        parameters=[
            {"name": "user_id", "value": {"stringValue": user_id}},
            {"name": "limit", "value": {"longValue": HISTORY_PROMPT_LIMIT}},
        ],
    )
    return [
        {
            "title": row[0].get("stringValue"),
            "author": row[1].get("stringValue"),
            "rating": row[2].get("longValue"),
        }
        for row in result.get("records", [])
    ]


class ReaderContext:
    """Everything one chat request knows about the reader, loaded once and
    shared by every tool call in the turn."""

    def __init__(self, user_id, authenticated=False):
        user = _get_or_create_user(user_id)
        self.user_id = user_id
        self.authenticated = authenticated
        self.taste_profile = user.get("tasteProfile") or _default_taste_profile()
        raw_pace = user.get("readingPace") or {}
        self.avg_pages_per_hour = float(raw_pace.get("avgPagesPerHour") or 0)
        self.total_sessions = int(raw_pace.get("totalSessions") or 0)
        self.history = _reading_history(user_id)
        self.history_keys = {_normalize_title(b["title"]) for b in self.history}
        self.established = bool(self.history)
        self.books_read = max(int(user.get("totalBooksRead") or 0), len(self.history))
        # With no history and no stated preferences, similarity would only
        # measure closeness to *some* catalog book - not this reader - so the
        # agent gets no score at all rather than a misleading one.
        self.has_taste_signal = self.established or _has_preferences(self.taste_profile)
        self.evaluated = {}
        self._proxy_work_keys = None
        self._proxy_loaded = False

    def proxy_work_keys(self):
        if not self._proxy_loaded:
            self._proxy_loaded = True
            if _has_preferences(self.taste_profile):
                embedding = _embed_text(_preference_text(self.taste_profile))
                self._proxy_work_keys = _catalog_proxy_work_keys(_vector_literal(embedding))
        return self._proxy_work_keys


def _vector_literal(embedding):
    return "[" + ",".join(str(v) for v in embedding) + "]"


def _lookup_open_library(title, author=None):
    fallback = {"title": title, "author": author, "pageCount": None, "genres": [], "found": False}
    attempts = [{"title": title, "author": author}] if author else []
    attempts.append({"title": title})
    for query in attempts:
        params = {**query, "limit": "1", "fields": "title,author_name,number_of_pages_median,subject"}
        url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode(params)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ShelfScannerAI/1.0"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                docs = json.loads(resp.read().decode("utf-8")).get("docs") or []
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return fallback
        if docs:
            doc = docs[0]
            authors = doc.get("author_name") or []
            return {
                "title": doc.get("title") or title,
                "author": authors[0] if authors else author,
                "pageCount": doc.get("number_of_pages_median"),
                "genres": (doc.get("subject") or [])[:5],
                "found": True,
            }
    return fallback


def evaluate_book(ctx, requested_title, requested_author=None):
    info = _lookup_open_library(requested_title, requested_author)
    disliked = {g.lower() for g in ctx.taste_profile.get("dislikedGenres") or []}
    disliked_genre = next((g for g in info["genres"] if g.lower() in disliked), None)

    if ctx.has_taste_signal:
        embedding_text = f"{info['title']} by {info['author'] or 'Unknown'}. Genres: {', '.join(info['genres'])}"
        literal = _vector_literal(_embed_text(embedding_text))
        signal = score_candidate(
            ctx.user_id, literal, info["title"], ctx.established, ctx.proxy_work_keys(), ctx.books_read
        )
    else:
        signal = {
            "matchScore": None,
            "preferenceWeight": None,
            "nearestFromHistory": [],
            "nearestFromPreferences": [],
            "similarTo": None,
        }

    page_count = info["pageCount"]
    return {
        "requestedTitle": requested_title,
        "title": info["title"],
        "author": info["author"],
        "found": info["found"],
        "pageCount": page_count,
        "genres": info["genres"],
        "matchScore": signal["matchScore"],
        "preferenceWeight": signal["preferenceWeight"],
        "nearestFromHistory": signal["nearestFromHistory"],
        "nearestFromPreferences": signal["nearestFromPreferences"],
        "similarTo": signal["similarTo"],
        "estimatedHours": round(page_count / ctx.avg_pages_per_hour, 1)
        if page_count and ctx.avg_pages_per_hour
        else None,
        "alreadyRead": _normalize_title(info["title"]) in ctx.history_keys,
        "dislikedGenre": disliked_genre,
    }


def _evaluate_many(ctx, books):
    ctx.proxy_work_keys()  # resolve once before fanning out to threads
    with ThreadPoolExecutor(max_workers=CHAT_MAX_BOOKS_PER_CALL) as pool:
        return list(pool.map(lambda b: evaluate_book(ctx, b["title"], b.get("author")), books))


def _search_catalog_titles(query, exclude_keys, limit=CATALOG_SEARCH_LIMIT):
    result = rds_data.execute_statement(
        resourceArn=AURORA_CLUSTER_ARN,
        secretArn=AURORA_SECRET_ARN,
        database=AURORA_DATABASE_NAME,
        sql="""
            SELECT title, author FROM catalog_embeddings
            ORDER BY embedding <=> CAST(:embedding AS vector) ASC
            LIMIT :limit;
        """,
        parameters=[
            {"name": "embedding", "value": {"stringValue": _vector_literal(_embed_text(query))}},
            {"name": "limit", "value": {"longValue": limit + len(exclude_keys)}},
        ],
    )
    books = []
    for row in result.get("records", []):
        title = row[0].get("stringValue")
        if _normalize_title(title) in exclude_keys:
            continue
        books.append({"title": title, "author": row[1].get("stringValue")})
    return books[:limit]


def run_chat_tool(ctx, name, tool_input):
    if name == "evaluate_books":
        books = [
            {"title": str(b["title"]), "author": b.get("author")}
            for b in tool_input.get("books") or []
            if isinstance(b, dict) and b.get("title")
        ][:CHAT_MAX_BOOKS_PER_CALL]
    elif name == "search_catalog":
        query = str(tool_input.get("query") or "").strip()
        if not query:
            return {"error": "query is required"}
        books = _search_catalog_titles(query, ctx.history_keys)
    else:
        return {"error": f"Unknown tool: {name}"}

    results = _evaluate_many(ctx, books)
    for evaluation in results:
        ctx.evaluated[_normalize_title(evaluation["title"])] = evaluation
        ctx.evaluated.setdefault(_normalize_title(evaluation["requestedTitle"]), evaluation)
    return {"books": results}


def sanitize_chat_messages(raw_messages):
    """Keep the recent user/assistant text turns, in the strictly alternating,
    user-first, user-last shape the Anthropic Messages API requires."""
    if not isinstance(raw_messages, list):
        return None
    cleaned = []
    for message in raw_messages[-CHAT_MAX_MESSAGES:]:
        if not isinstance(message, dict):
            continue
        role, content = message.get("role"), message.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
            continue
        text = content.strip()[:CHAT_MAX_MESSAGE_CHARS]
        if cleaned and cleaned[-1]["role"] == role:
            cleaned[-1]["content"] += "\n\n" + text
        else:
            cleaned.append({"role": role, "content": text})
    while cleaned and cleaned[0]["role"] != "user":
        cleaned.pop(0)
    if not cleaned or cleaned[-1]["role"] != "user":
        return None
    return cleaned


def parse_final_answer(text):
    """The model is told to answer with a bare JSON object; fall back to
    treating the whole message as the reply if it didn't."""
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            parsed = json.loads(text[start : end + 1])
            if isinstance(parsed, dict) and isinstance(parsed.get("reply"), str):
                return parsed
        except json.JSONDecodeError:
            pass
    return {"reply": text.strip(), "picks": []}


def build_picks(raw_picks, evaluated):
    """Only books a tool actually evaluated this turn can become picks, and
    their scores/hours come from that evaluation, never from the model.

    Unlike /recommend, picks keep the model's order rather than being sorted
    by matchScore: in chat the reader states constraints (length, mood) that
    a taste-similarity score knows nothing about, so the reply's ranking is
    the one the cards have to agree with."""
    picks, seen = [], set()
    for pick in raw_picks if isinstance(raw_picks, list) else []:
        if not isinstance(pick, dict):
            continue
        evaluation = evaluated.get(_normalize_title(pick.get("title")))
        if not evaluation or not evaluation["found"]:
            continue
        key = _normalize_title(evaluation["title"])
        if key in seen:
            continue
        seen.add(key)
        signals = pick.get("matchedSignals") if isinstance(pick.get("matchedSignals"), list) else []
        picks.append(
            {
                "title": evaluation["title"],
                "author": evaluation["author"],
                "pageCount": evaluation["pageCount"],
                "reasoning": str(pick.get("reasoning") or ""),
                "matchScore": evaluation["matchScore"],
                "matchedSignals": [s for s in signals if isinstance(s, str)][:4],
                "similarTo": evaluation["similarTo"],
                "estimatedHours": evaluation["estimatedHours"],
            }
        )
    picks = picks[:CHAT_MAX_PICKS]
    for rank, pick in enumerate(picks, start=1):
        pick["rank"] = rank
    return picks


def build_chat_system_prompt(ctx):
    if ctx.history:
        history_lines = "\n".join(
            f"- {b['title']} by {b['author'] or 'unknown'}"
            + (f" - rated {b['rating']}/5" if b["rating"] is not None else "")
            for b in ctx.history
        )
        history_block = f"Books they've finished (highest rated first):\n{history_lines}"
    else:
        history_block = (
            "They haven't logged any finished books yet, so matchScore comes entirely from their "
            "stated preferences (via a curated catalog chosen to match them)."
        )
    pace_block = (
        f"{round(ctx.avg_pages_per_hour)} pages/hour over {ctx.total_sessions} timed sessions"
        if ctx.avg_pages_per_hour
        else "No reading-pace data yet, so estimatedHours will be null."
    )
    prompt = (
        CHAT_SYSTEM_PROMPT
        + "\nREADER PROFILE\n"
        + f"Taste profile: {json.dumps(ctx.taste_profile, default=str)}\n"
        + f"Reading pace: {pace_block}\n"
        + history_block
    )
    if not ctx.has_taste_signal:
        prompt += "\n\n" + build_new_reader_guidance(ctx.authenticated)
    return prompt


def build_new_reader_guidance(authenticated):
    next_step = (
        "set their preferences on the Profile page"
        if authenticated
        else "create a free account and set their preferences on the Profile page"
    )
    return f"""NEW READER - NO TASTE DATA YET
This reader has no finished books and no stated preferences, so tools return
matchScore: null and no similar books. Ignore everything above about grounding
in their profile; there is nothing to ground in. Never imply a personal match.
- If their message gives taste context (books or authors they loved, a mood, a
  genre, what they're in the mood for), use it: give a confident suggestion and
  explain how each book connects to what they told you.
- If it gives no context, still give a short, useful answer based on the books
  themselves (tone, length, what kind of reader each suits), then ask one quick
  question, like a book they've really loved lately.
- End the reply with one friendly, non-pushy sentence suggesting they {next_step}
  so future suggestions are matched to their taste."""


def _invoke_claude_with_tools(system_prompt, messages):
    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_CLAUDE_MODEL_ID,
        body=json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1500,
                "system": system_prompt,
                "tools": CHAT_TOOLS,
                "messages": messages,
            }
        ),
    )
    return json.loads(response["body"].read())


def _handle_chat(event, body, start):
    user_id, authenticated = _resolve_user_id(event, body.get("userId"))
    messages = sanitize_chat_messages(body.get("messages"))
    if not user_id or not messages:
        return _error(400, "userId and a messages list ending with a user message are required")

    ctx = ReaderContext(user_id, authenticated)
    system_prompt = build_chat_system_prompt(ctx)
    conversation = [dict(m) for m in messages]

    final_text = None
    for _ in range(CHAT_MAX_TOOL_ROUNDS):
        response = _invoke_claude_with_tools(system_prompt, conversation)
        content = response.get("content", [])
        if response.get("stop_reason") != "tool_use":
            final_text = "".join(block.get("text", "") for block in content if block.get("type") == "text")
            break

        conversation.append({"role": "assistant", "content": content})
        tool_results = []
        for block in content:
            if block.get("type") != "tool_use":
                continue
            try:
                output = run_chat_tool(ctx, block.get("name"), block.get("input") or {})
            except Exception as exc:  # an external lookup failing shouldn't sink the whole reply
                print(f"chat tool {block.get('name')} failed: {exc!r}")
                output = {"error": "That lookup failed. Continue without it and tell the reader."}
            tool_results.append(
                {"type": "tool_result", "tool_use_id": block["id"], "content": json.dumps(output, default=str)}
            )
        conversation.append({"role": "user", "content": tool_results})

    if final_text is None:
        parsed = {
            "reply": "I ran out of steps working through that one. Try naming the specific books you're choosing between.",
            "picks": [],
        }
    else:
        parsed = parse_final_answer(final_text)

    return {
        "statusCode": 200,
        "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
        "body": json.dumps(
            {
                "reply": parsed["reply"],
                "picks": build_picks(parsed.get("picks"), ctx.evaluated),
                "mode": "established" if ctx.established else "cold_start",
                "hasTasteSignal": ctx.has_taste_signal,
                "processingTimeMs": _elapsed_ms(start),
            }
        ),
    }
