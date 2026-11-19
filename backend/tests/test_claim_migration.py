from boto3.dynamodb.conditions import Key


def _taste_profile(**overrides):
    profile = {
        "favoriteAuthors": [],
        "favoriteGenres": [],
        "dislikedGenres": [],
        "preferredPacing": None,
        "preferredLength": None,
        "writingStylePrefs": [],
        "avoidThemes": [],
        "lastUpdated": "2026-01-01T00:00:00Z",
    }
    profile.update(overrides)
    return profile


def test_claim_migrates_profile_history_and_pace(auth_app):
    auth_app.users_table.put_item(
        Item={
            "userId": "guest-1",
            "createdAt": "2026-01-01T00:00:00Z",
            "tasteProfile": _taste_profile(favoriteAuthors=["Frank Herbert"], favoriteGenres=["sci-fi"]),
            "readingPace": {"avgPagesPerHour": 42, "totalSessions": 3, "lastUpdated": "2026-01-01T00:00:00Z"},
            "totalBooksRead": 2,
        }
    )
    auth_app.history_table.put_item(
        Item={"userId": "guest-1", "sk": "book1#2026-01-01T00:00:00Z", "title": "Dune"}
    )
    auth_app.pace_sessions_table.put_item(
        Item={"userId": "guest-1", "sessionId": "2026-01-01T00:00:00Z#abc", "pagesPerHour": 42}
    )

    result = auth_app.claim_anonymous_data("guest-1", "cognito-sub-123")

    assert result == {"claimed": True, "booksRead": 2, "paceSessions": 1, "historyRows": 1}

    authenticated = auth_app.users_table.get_item(Key={"userId": "cognito-sub-123"})["Item"]
    assert authenticated["tasteProfile"]["favoriteAuthors"] == ["Frank Herbert"]
    assert authenticated["totalBooksRead"] == 2

    assert "Item" not in auth_app.users_table.get_item(Key={"userId": "guest-1"})

    migrated_history = auth_app.history_table.query(
        KeyConditionExpression=Key("userId").eq("cognito-sub-123")
    )["Items"]
    assert len(migrated_history) == 1
    assert migrated_history[0]["title"] == "Dune"

    old_history = auth_app.history_table.query(KeyConditionExpression=Key("userId").eq("guest-1"))["Items"]
    assert old_history == []

    # book_embeddings re-key went through the RDS Data API stub
    assert len(auth_app.rds_data.calls) == 1
    assert "UPDATE book_embeddings" in auth_app.rds_data.calls[0]["sql"]


def test_claim_is_idempotent_and_handles_a_never_claimed_id(auth_app):
    result_first = auth_app.claim_anonymous_data("never-existed", "cognito-sub-456")
    assert result_first == {"claimed": False, "booksRead": 0, "paceSessions": 0, "historyRows": 0}

    # Claiming again (e.g. a double-click on the frontend) must not error,
    # and must not touch the authenticated account's data.
    result_second = auth_app.claim_anonymous_data("never-existed", "cognito-sub-456")
    assert result_second["claimed"] is False


def test_claiming_own_authenticated_id_is_a_safe_no_op(auth_app):
    # Guards against ever deleting an account's own just-written data if the
    # frontend accidentally sends its own id as anonymousUserId.
    auth_app.users_table.put_item(
        Item={
            "userId": "cognito-sub-999",
            "createdAt": "2026-01-01T00:00:00Z",
            "tasteProfile": _taste_profile(),
            "readingPace": {"avgPagesPerHour": 0, "totalSessions": 0, "lastUpdated": "2026-01-01T00:00:00Z"},
            "totalBooksRead": 5,
        }
    )

    result = auth_app.claim_anonymous_data("cognito-sub-999", "cognito-sub-999")

    assert result["claimed"] is False
    still_there = auth_app.users_table.get_item(Key={"userId": "cognito-sub-999"})["Item"]
    assert still_there["totalBooksRead"] == 5


def test_claim_merges_into_an_existing_authenticated_profile(auth_app):
    auth_app.users_table.put_item(
        Item={
            "userId": "cognito-sub-789",
            "createdAt": "2026-01-01T00:00:00Z",
            "tasteProfile": _taste_profile(favoriteAuthors=["Ursula K. Le Guin"]),
            "readingPace": {"avgPagesPerHour": 0, "totalSessions": 0, "lastUpdated": "2026-01-01T00:00:00Z"},
            "totalBooksRead": 1,
        }
    )
    auth_app.users_table.put_item(
        Item={
            "userId": "guest-2",
            "createdAt": "2026-01-02T00:00:00Z",
            "tasteProfile": _taste_profile(favoriteAuthors=["Frank Herbert"], favoriteGenres=["sci-fi"]),
            "readingPace": {"avgPagesPerHour": 55, "totalSessions": 5, "lastUpdated": "2026-01-02T00:00:00Z"},
            "totalBooksRead": 3,
        }
    )

    result = auth_app.claim_anonymous_data("guest-2", "cognito-sub-789")

    merged = auth_app.users_table.get_item(Key={"userId": "cognito-sub-789"})["Item"]
    assert set(merged["tasteProfile"]["favoriteAuthors"]) == {"Ursula K. Le Guin", "Frank Herbert"}
    assert merged["tasteProfile"]["favoriteGenres"] == ["sci-fi"]
    assert merged["totalBooksRead"] == 4  # 1 (existing) + 3 (guest)
    # The guest side had more logged pace sessions, so its rolling average wins
    # outright rather than being blended into a misleading number.
    assert merged["readingPace"]["totalSessions"] == 5
    assert merged["readingPace"]["avgPagesPerHour"] == 55
    assert result["claimed"] is True
