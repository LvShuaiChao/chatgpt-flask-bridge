"""字段统一修复：remote_chatgpt 持久化、bind_state、消息与发送能力语义。"""

from app.models import (
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_HOME,
    REMOTE_CHATGPT_PERSISTENT_KEYS,
    _REMOTE_NORMALIZE_KEYS,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.ui.mixins.session_mixin import SessionMixin
from app.models import ChatMessage


def test_remote_normalize_keys_cover_persistent_bind_flow_fields():
    flow_keys = {
        "bind_request_id",
        "bind_started_at",
        "pending_bootstrap_content",
        "pending_send_content",
        "pending_send_message_id",
        "reopen_started_at",
    }
    assert flow_keys <= set(REMOTE_CHATGPT_PERSISTENT_KEYS)
    assert flow_keys <= set(_REMOTE_NORMALIZE_KEYS)


def test_normalize_remote_chatgpt_keeps_bind_flow_fields():
    remote = normalize_remote_chatgpt(
        {
            "bind_state": BIND_STATE_WAITING_HOME,
            "bind_request_id": "tok-abc",
            "bind_started_at": 123.0,
            "pending_bootstrap_content": "hello",
            "pending_send_content": "world",
            "pending_send_message_id": "msg-1",
            "reopen_started_at": 456.0,
        }
    )
    assert remote["bind_request_id"] == "tok-abc"
    assert remote["bind_started_at"] == 123.0
    assert remote["pending_bootstrap_content"] == "hello"
    assert remote["pending_send_content"] == "world"
    assert remote["pending_send_message_id"] == "msg-1"
    assert remote["reopen_started_at"] == 456.0


def test_waiting_bound_conversation_distinct_from_unbound():
    assert BIND_STATE_WAITING_BOUND_CONVERSATION != BIND_STATE_UNBOUND
    remote = normalize_remote_chatgpt(
        {
            "bind_state": BIND_STATE_WAITING_BOUND_CONVERSATION,
            "conversation_id": "conv-wait",
            "pending_send_content": "queued text",
        }
    )
    assert remote["bind_state"] == BIND_STATE_WAITING_BOUND_CONVERSATION
    assert remote["conversation_id"] == "conv-wait"
    assert remote["pending_send_content"] == "queued text"


def test_message_to_dict_uses_canonical_fields_only():
    host = SessionMixin()
    data = host._message_to_dict(
        ChatMessage(
            role="user",
            content="hi",
            ui_status="sending",
            message_source="local_send",
            bridge_message_id="bridge-1",
            visible_in_chat=False,
        )
    )
    for legacy in ("status", "source", "visible", "request_id", "text"):
        assert legacy not in data
    assert data["ui_status"] == "sending"
    assert data["message_source"] == "local_send"
    assert data["bridge_message_id"] == "bridge-1"
    assert data["visible_in_chat"] is False


def test_normalize_legacy_message_visible_in_chat_priority():
    item = SessionMixin._normalize_legacy_message_dict(
        {"visible_in_chat": False, "visible": True}
    )
    assert item["visible_in_chat"] is False
    assert "visible" not in item


def test_send_decision_queued_is_not_send_now():
    from app.utils.page_status import PageCapability

    cap = PageCapability(send_decision="queued")
    assert cap.send_requestable is True
    assert cap.send_now_available is False
    assert cap.send_queueable is True
