"""_resolve_user_id is duplicated verbatim across user_handler, recommend_handler,
feedback_handler, and pace_handler (matching this project's existing convention of
duplicating small helpers rather than sharing a module across Lambdas). Exercising
it once here via user_handler covers the identical logic in all four.
"""


def test_authenticated_request_uses_verified_claims_over_path_param(user_app):
    event = {
        "requestContext": {"authorizer": {"claims": {"sub": "cognito-sub-abc", "email": "a@example.com"}}},
    }
    user_id, authenticated = user_app._resolve_user_id(event, "some-stale-path-param")

    assert user_id == "cognito-sub-abc"
    assert authenticated is True


def test_anonymous_request_falls_back_to_path_param(user_app):
    event = {"requestContext": {}}
    user_id, authenticated = user_app._resolve_user_id(event, "guest-123")

    assert user_id == "guest-123"
    assert authenticated is False


def test_missing_request_context_falls_back_to_path_param(user_app):
    event = {}
    user_id, authenticated = user_app._resolve_user_id(event, "guest-456")

    assert user_id == "guest-456"
    assert authenticated is False


def test_claims_present_but_no_sub_falls_back_to_path_param(user_app):
    # Defensive: a malformed/partial authorizer context should never silently
    # resolve to None as the "authenticated" user id.
    event = {"requestContext": {"authorizer": {"claims": {"email": "a@example.com"}}}}
    user_id, authenticated = user_app._resolve_user_id(event, "guest-789")

    assert user_id == "guest-789"
    assert authenticated is False
