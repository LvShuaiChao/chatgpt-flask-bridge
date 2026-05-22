"""normalize_remote_chatgpt URL 规范化。"""

from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_UNBOUND,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
    remote_binding_active,
)


def test_default_remote_chatgpt_core_fields():
    base = default_remote_chatgpt()
    assert set(base.keys()) == {
        "bind_state",
        "url",
        "conversation_id",
        "client_id",
        "page_instance_id",
        "page_display_id",
        "page_type",
        "page_title",
        "last_seen",
    }


def test_legacy_conversation_id_sets_bound_conversation():
    remote = normalize_remote_chatgpt(
        {
            "conversation_id": "conv-legacy",
            "bind_state": BIND_STATE_UNBOUND,
        }
    )
    assert remote["conversation_id"] == "conv-legacy"
    assert remote["bind_state"] == BIND_STATE_BOUND_CONVERSATION
    assert remote_binding_active(remote)


def test_bound_offline_migrates_to_bound_conversation_when_has_conversation():
    remote = normalize_remote_chatgpt(
        {
            "bind_state": BIND_STATE_BOUND_OFFLINE,
            "conversation_id": "conv-offline",
        }
    )
    assert remote["bind_state"] == BIND_STATE_BOUND_CONVERSATION


def test_bound_offline_without_conversation_migrates_unbound():
    remote = normalize_remote_chatgpt(
        {
            "bind_state": BIND_STATE_BOUND_OFFLINE,
        }
    )
    assert remote["bind_state"] == BIND_STATE_UNBOUND


def test_conversation_id_fills_canonical_url_when_url_empty():
    remote = normalize_remote_chatgpt(
        {
            "conversation_id": "conv-abc",
        }
    )
    assert remote["url"] == "https://chatgpt.com/c/conv-abc"
    assert remote["conversation_id"] == "conv-abc"


def test_strips_enabled_and_duplicate_legacy_ids():
    remote = normalize_remote_chatgpt(
        {
            "enabled": True,
            "prebound_home_client_id": "c-old",
            "reserved_client_id": "c-old",
            "binding": {"client_id": "c-old"},
            "conversation_id": "conv-x",
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
        }
    )
    assert "enabled" not in remote
    assert "prebound_home_client_id" not in remote
    assert "reserved_client_id" not in remote
    assert "binding" not in remote
    assert remote["conversation_id"] == "conv-x"


def test_keeps_page_display_id_page_type_last_seen():
    remote = normalize_remote_chatgpt(
        {
            "page_type": "conversation",
            "page_display_id": "12",
            "last_seen": 99,
            "conversation_id": "conv-x",
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
        }
    )
    assert remote["page_type"] == "conversation"
    assert remote["page_display_id"] == "12"
    assert remote["last_seen"] == 99.0


def test_write_session_rejects_unknown_field():
    from app.models import ChatSession, write_session_remote_chatgpt

    session = ChatSession(
        session_id="s1",
        title="t",
        created_at=0,
        updated_at=0,
        remote_chatgpt=default_remote_chatgpt(),
    )
    write_session_remote_chatgpt(session, totally_unknown_field="x")
    assert "totally_unknown_field" not in session.remote_chatgpt
