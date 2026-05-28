"""legacy_cleanup：仅拒绝旧绑定/发送链路字段。"""

import pytest

from app.utils.legacy_cleanup import (
    LEGACY_FIELD_NAMES,
    assert_no_legacy_fields,
    reject_legacy_fields,
)


def test_reject_legacy_fields_allows_id_status():
    err = reject_legacy_fields(
        {"content": "x", "id": "m1", "status": "queued"},
        context="api",
        migrate=False,
    )
    assert err is None


def test_reject_legacy_fields_migrate_flag_raises():
    with pytest.raises(ValueError, match="migration is disabled"):
        reject_legacy_fields({"target_client_id": "c1"}, context="api", migrate=True)


def test_reject_legacy_fields_returns_400_for_target_client_id():
    err = reject_legacy_fields(
        {"content": "x", "target_client_id": "c1"},
        context="api",
        migrate=False,
    )
    assert err is not None
    body, status = err
    assert status == 400
    assert body["error"] == "legacy_fields_not_allowed"
    assert "target_client_id" in body["legacy_fields"]


def test_reject_legacy_fields_returns_400_for_raw_user_text():
    err = reject_legacy_fields(
        {"content": "x", "raw_user_text": "legacy"},
        context="api",
        migrate=False,
    )
    assert err is not None
    body, status = err
    assert "raw_user_text" in body["legacy_fields"]


def test_reject_legacy_target_source_values():
    err = reject_legacy_fields(
        {"content": "x", "target_source": "bound"},
        context="api",
        migrate=False,
    )
    assert err is not None
    body, status = err
    assert "target_source=bound" in body["legacy_fields"]


def test_assert_no_legacy_fields_raises_for_target_url():
    with pytest.raises(ValueError, match="legacy fields still exist"):
        assert_no_legacy_fields({"target_url": "https://x"}, owner="save")


def test_assert_no_legacy_fields_passes_canonical():
    assert_no_legacy_fields(
        {
            "message_id": "m1",
            "message_status": "queued",
            "client_id": "c1",
            "content": "hi",
        },
        owner="bridge",
    )


def test_legacy_field_names_binding_aliases_only():
    for key in (
        "target_client_id",
        "target_page_instance_id",
        "page_url",
        "bound_client_id",
        "chatgpt_url",
    ):
        assert key in LEGACY_FIELD_NAMES
    for key in ("id", "status", "message", "prompt"):
        assert key not in LEGACY_FIELD_NAMES
