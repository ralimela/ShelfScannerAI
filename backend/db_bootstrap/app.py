import json
import os
import time
import urllib.request

import boto3

AURORA_CLUSTER_ARN = os.environ["AURORA_CLUSTER_ARN"]
AURORA_SECRET_ARN = os.environ["AURORA_SECRET_ARN"]
AURORA_DATABASE_NAME = os.environ["AURORA_DATABASE_NAME"]

rds_data = boto3.client("rds-data")

BOOTSTRAP_SQL = [
    "CREATE EXTENSION IF NOT EXISTS vector;",
    """
    CREATE TABLE IF NOT EXISTS book_embeddings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        book_id TEXT NOT NULL,
        title TEXT,
        author TEXT,
        rating INTEGER,
        embedding vector(1024),
        embedded_at TIMESTAMP,
        UNIQUE (user_id, book_id)
    );
    """,
]


def _execute_with_retry(sql, max_attempts=12, delay_seconds=20):
    """A freshly-created Aurora Serverless v2 cluster can take a minute or two to
    accept its first Data API call after the instance reports available — retry
    through the DatabaseResumingException / BadRequestException window instead
    of failing the whole CloudFormation stack on a race.
    """
    last_error = None
    for attempt in range(max_attempts):
        try:
            rds_data.execute_statement(
                resourceArn=AURORA_CLUSTER_ARN,
                secretArn=AURORA_SECRET_ARN,
                database=AURORA_DATABASE_NAME,
                sql=sql,
            )
            return
        except (
            rds_data.exceptions.DatabaseResumingException,
            rds_data.exceptions.BadRequestException,
        ) as exc:
            last_error = exc
            if attempt < max_attempts - 1:
                time.sleep(delay_seconds)
    raise last_error


def lambda_handler(event, context):
    request_type = event.get("RequestType")
    physical_id = event.get("PhysicalResourceId", "shelfscannerai-db-bootstrap")

    try:
        if request_type in ("Create", "Update"):
            for statement in BOOTSTRAP_SQL:
                _execute_with_retry(statement)
        _send_response(event, context, "SUCCESS", physical_id)
    except Exception as exc:  # noqa: BLE001 - CFN custom resources must always signal back
        _send_response(event, context, "FAILED", physical_id, reason=str(exc))


def _send_response(event, context, status, physical_id, reason=None):
    body = json.dumps(
        {
            "Status": status,
            "Reason": reason or f"See CloudWatch log stream: {context.log_stream_name}",
            "PhysicalResourceId": physical_id,
            "StackId": event["StackId"],
            "RequestId": event["RequestId"],
            "LogicalResourceId": event["LogicalResourceId"],
            "Data": {},
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        url=event["ResponseURL"],
        data=body,
        method="PUT",
        headers={"Content-Type": "", "Content-Length": str(len(body))},
    )
    urllib.request.urlopen(req)
