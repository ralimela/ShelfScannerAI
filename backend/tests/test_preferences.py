def test_preference_edit_replaces_lists_and_cleans_input(user_app):
    existing = {
        "favoriteAuthors": ["Stephen King"],
        "favoriteGenres": ["Horror"],
        "dislikedGenres": ["Romance"],
        "writingStylePrefs": ["Atmospheric dread"],
        "avoidThemes": [],
        "preferredPacing": None,
        "preferredLength": None,
    }
    updated = user_app._apply_onboarding(
        existing,
        {
            "favoriteGenres": ["  Horror ", "horror", "Science   Fiction", "", 42],
            "writingStylePrefs": ["x" * 500],
        },
    )

    assert updated["favoriteGenres"] == ["Horror", "Science Fiction"]
    assert updated["writingStylePrefs"] == ["x" * 120]
    # Fields not sent are left exactly as they were.
    assert updated["favoriteAuthors"] == ["Stephen King"]
    assert updated["dislikedGenres"] == ["Romance"]


def test_preference_list_is_capped(user_app):
    updated = user_app._apply_onboarding(None, {"avoidThemes": [f"theme {i}" for i in range(100)]})
    assert len(updated["avoidThemes"]) == 40
