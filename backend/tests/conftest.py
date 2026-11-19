import importlib.util
import os
from pathlib import Path

import pytest
from moto import mock_aws

BACKEND_DIR = Path(__file__).resolve().parent.parent


def load_handler_module(name, handler_dir):
    """Every handler lives in its own backend/<name>_handler/app.py, so the
    module name "app" collides across them - load each under a unique name
    via its file path instead of a plain `import app`.
    """
    spec = importlib.util.spec_from_file_location(name, BACKEND_DIR / handler_dir / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StubRdsData:
    """moto does not mock the RDS Data API at all - this stands in for the
    one call auth_handler makes (re-keying book_embeddings) so tests cover
    the DynamoDB re-keying logic without needing a real Aurora cluster.
    """

    def __init__(self):
        self.calls = []

    def execute_statement(self, **kwargs):
        self.calls.append(kwargs)
        return {"records": []}


@pytest.fixture
def aws_credentials(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SECURITY_TOKEN", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")


@pytest.fixture
def auth_app(aws_credentials, monkeypatch):
    monkeypatch.setenv("DYNAMODB_USERS_TABLE", "test-users")
    monkeypatch.setenv("DYNAMODB_HISTORY_TABLE", "test-history")
    monkeypatch.setenv("DYNAMODB_PACE_SESSIONS_TABLE", "test-pace-sessions")
    monkeypatch.setenv("DYNAMODB_SCAN_SESSIONS_TABLE", "test-scan-sessions")
    monkeypatch.setenv("AURORA_CLUSTER_ARN", "arn:aws:rds:us-east-1:123456789012:cluster:test")
    monkeypatch.setenv("AURORA_SECRET_ARN", "arn:aws:secretsmanager:us-east-1:123456789012:secret:test")
    monkeypatch.setenv("AURORA_DATABASE_NAME", "test")

    with mock_aws():
        import boto3

        dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        dynamodb.create_table(
            TableName="test-users",
            AttributeDefinitions=[{"AttributeName": "userId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "userId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        dynamodb.create_table(
            TableName="test-history",
            AttributeDefinitions=[
                {"AttributeName": "userId", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "userId", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        dynamodb.create_table(
            TableName="test-pace-sessions",
            AttributeDefinitions=[
                {"AttributeName": "userId", "AttributeType": "S"},
                {"AttributeName": "sessionId", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "userId", "KeyType": "HASH"},
                {"AttributeName": "sessionId", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        dynamodb.create_table(
            TableName="test-scan-sessions",
            AttributeDefinitions=[
                {"AttributeName": "sessionId", "AttributeType": "S"},
                {"AttributeName": "userId", "AttributeType": "S"},
            ],
            KeySchema=[{"AttributeName": "sessionId", "KeyType": "HASH"}],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "userId-index",
                    "KeySchema": [{"AttributeName": "userId", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
            BillingMode="PAY_PER_REQUEST",
        )

        module = load_handler_module("auth_app_module", "auth_handler")
        module.rds_data = StubRdsData()
        yield module


@pytest.fixture
def user_app(aws_credentials, monkeypatch):
    monkeypatch.setenv("DYNAMODB_USERS_TABLE", "test-users")
    monkeypatch.setenv("DYNAMODB_HISTORY_TABLE", "test-history")
    monkeypatch.setenv("DYNAMODB_PACE_SESSIONS_TABLE", "test-pace-sessions")
    return load_handler_module("user_app_module", "user_handler")
