"""Standalone, manually-run catalog ingestion for ShelfScannerAI's cold-start
recommendation path. Pulls a curated spread of books from Open Library's bulk
subjects endpoint, embeds each via Titan, and stores the vectors in
catalog_embeddings on Aurora via the RDS Data API.

Not a Lambda/custom resource on purpose: ~400-500 sequential books, each
needing an Open Library call + a Titan embed call + a Data API insert, risks
Lambda's 15-minute cap and is painful to resume mid-failure as a CloudFormation
custom resource. This script is safely re-runnable instead - it skips any
work_key already present in catalog_embeddings before spending a Bedrock call
on it.

Run manually:
    AURORA_CLUSTER_ARN=... AURORA_SECRET_ARN=... AURORA_DATABASE_NAME=shelfscanner \
    AWS_REGION=us-east-1 python backend/scripts/ingest_catalog.py

The Aurora cluster must be running first (aws rds start-db-cluster if stopped -
the Data API does not auto-start a fully-stopped cluster).
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import boto3

# Open Library titles span many languages/scripts; Windows consoles default to
# a narrow codepage (cp1252) that can't encode most of them, crashing print()
# mid-run. Force UTF-8 with a safe fallback instead of failing on book N.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
AURORA_CLUSTER_ARN = os.environ["AURORA_CLUSTER_ARN"]
AURORA_SECRET_ARN = os.environ["AURORA_SECRET_ARN"]
AURORA_DATABASE_NAME = os.environ["AURORA_DATABASE_NAME"]
BEDROCK_TITAN_EMBED_MODEL_ID = os.environ.get("BEDROCK_TITAN_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")

bedrock_runtime = boto3.client("bedrock-runtime", region_name=AWS_REGION)
rds_data = boto3.client("rds-data", region_name=AWS_REGION)

SUBJECTS = [
    "fiction",
    "mystery_and_detective_stories",
    "science_fiction",
    "fantasy",
    "romance",
    "historical_fiction",
    "horror",
    "biography",
    "young_adult_fiction",
]
SUBJECT_LIMIT = 60
REQUEST_HEADERS = {"User-Agent": "ShelfScannerAI/1.0"}
EMBEDDING_TEXT_MAX_CHARS = 1500
REQUEST_DELAY_SECONDS = 0.3


def _fetch_json(url):
    req = urllib.request.Request(url, headers=REQUEST_HEADERS)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _existing_work_keys():
    result = rds_data.execute_statement(
        resourceArn=AURORA_CLUSTER_ARN,
        secretArn=AURORA_SECRET_ARN,
        database=AURORA_DATABASE_NAME,
        sql="SELECT work_key FROM catalog_embeddings;",
    )
    return {row[0]["stringValue"] for row in result.get("records", [])}


def _extract_description(work_detail):
    description = work_detail.get("description")
    if isinstance(description, dict):
        return description.get("value", "")
    if isinstance(description, str):
        return description
    return ""


def _embed_text(text):
    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_TITAN_EMBED_MODEL_ID,
        body=json.dumps({"inputText": text, "dimensions": 1024, "normalize": True}),
    )
    body = json.loads(response["body"].read())
    return body["embedding"]


def _upsert_catalog_embedding(work_key, title, author, subjects, description, embedding, max_attempts=3, delay_seconds=5):
    embedding_literal = "[" + ",".join(str(value) for value in embedding) + "]"
    sql = """
        INSERT INTO catalog_embeddings (work_key, title, author, subjects, description, embedding, ingested_at)
        VALUES (:work_key, :title, :author, :subjects, :description, CAST(:embedding AS vector), now())
        ON CONFLICT (work_key) DO NOTHING;
    """
    parameters = [
        {"name": "work_key", "value": {"stringValue": work_key}},
        {"name": "title", "value": {"stringValue": title}},
        {"name": "author", "value": {"stringValue": author} if author else {"isNull": True}},
        {"name": "subjects", "value": {"stringValue": json.dumps(subjects)}},
        {"name": "description", "value": {"stringValue": description} if description else {"isNull": True}},
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


def main():
    seen_work_keys = _existing_work_keys()
    print(f"{len(seen_work_keys)} work(s) already in catalog_embeddings - will be skipped.")

    candidates = []
    for subject in SUBJECTS:
        url = f"https://openlibrary.org/subjects/{subject}.json?limit={SUBJECT_LIMIT}"
        try:
            data = _fetch_json(url)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            print(f"[subject:{subject}] FAILED to fetch subject listing: {exc}")
            continue

        for work in data.get("works", []):
            work_key = work.get("key")
            if not work_key or work_key in seen_work_keys:
                continue
            seen_work_keys.add(work_key)
            authors = ", ".join(a["name"] for a in work.get("authors", []) if a.get("name"))
            subjects = [subject] + list(work.get("subject", []))[:4]
            candidates.append(
                {
                    "work_key": work_key,
                    "title": work.get("title", "Untitled"),
                    "author": authors or None,
                    "subjects": subjects,
                }
            )

    total = len(candidates)
    print(f"{total} new candidate work(s) to ingest across {len(SUBJECTS)} subjects.")

    inserted = 0
    for i, candidate in enumerate(candidates, start=1):
        work_key = candidate["work_key"]
        title = candidate["title"]
        label = f"[{i}/{total}] {title}"

        try:
            time.sleep(REQUEST_DELAY_SECONDS)
            work_detail = _fetch_json(f"https://openlibrary.org{work_key}.json")
            description = _extract_description(work_detail)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            print(f"{label} - skipped (detail fetch failed: {exc})")
            continue

        embedding_text = (
            f"{title} by {candidate['author'] or 'Unknown'}. "
            f"Genres: {', '.join(candidate['subjects'])}. {description}"
        )[:EMBEDDING_TEXT_MAX_CHARS]

        try:
            embedding = _embed_text(embedding_text)
            _upsert_catalog_embedding(
                work_key, title, candidate["author"], candidate["subjects"], description, embedding
            )
        except Exception as exc:  # noqa: BLE001 - log and keep going, one bad book shouldn't kill the run
            print(f"{label} - skipped (embed/insert failed: {exc})")
            continue

        inserted += 1
        status = "embedded+inserted" if description else "embedded+inserted (no description, title/genres only)"
        print(f"{label} - {status}")

    result = rds_data.execute_statement(
        resourceArn=AURORA_CLUSTER_ARN,
        secretArn=AURORA_SECRET_ARN,
        database=AURORA_DATABASE_NAME,
        sql="SELECT count(*) FROM catalog_embeddings;",
    )
    final_count = result["records"][0][0]["longValue"]
    print(f"Done. Inserted {inserted} new row(s) this run. catalog_embeddings now has {final_count} total row(s).")


if __name__ == "__main__":
    main()
