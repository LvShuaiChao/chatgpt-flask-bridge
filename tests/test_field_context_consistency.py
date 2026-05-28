import pytest

from app.models import normalize_remote_chatgpt
from app.server.message_queue import _poll_response
from app.ui.mixins.session_mixin import SessionMixin
from app.utils.bridge_payload import normalize_inbound_push_payload
from app.utils.legacy_cleanup import (
    BRIDGE_REQUEST_ALLOWED_FIELDS,
    POLL_RESPONSE_ALLOWED_FIELDS,
    QUEUE_MESSAGE_ALLOWED_FIELDS,
    REMOTE_CHATGPT_ALLOWED_FIELDS,
    SESSION_MESSAGE_ALLOWED_FIELDS,
    assert_no_legacy_fields,
    reject_legacy_fields,
)


class _SessionHost(SessionMixin):
    pass


def test_chat_message_dict_allows_canonical_fields():
    item = {
        "message_id": "m1",
        "turn_id": "t1",
        "role": "assistant",
        "content": "hello",
        "created_at": 1.0,
        "ui_status": "done",
        "detail": "",
        "message_source": "bridge",
        "bridge_message_id": "b1",
        "parent_message_id": "p1",
        "visible_in_chat": True,
    }
    assert_no_legacy_fields(
        item,
        owner="test_chat_message_dict",
        allowed_fields=SESSION_MESSAGE_ALLOWED_FIELDS,
        strict_unknown=True,
    )


def test_chat_message_dict_migrates_legacy_fields_before_load():
    host = _SessionHost()
    msg = host._message_from_dict(
        {
            "role": "user",
            "content": "hello",
            "status": "queued",
            "source": "direct",
            "request_id": "req-1",
            "visible": False,
        }
    )
    assert msg.ui_status == "queued"
    assert msg.message_source == "direct"
    assert msg.bridge_message_id == "req-1"
    assert msg.visible_in_chat is False


def test_chat_message_dict_rejects_legacy_fields_after_normalize():
    with pytest.raises(ValueError, match="status"):
        assert_no_legacy_fields(
            {"role": "assistant", "content": "x", "status": "queued"},
            owner="test_chat_message_legacy",
            allowed_fields=SESSION_MESSAGE_ALLOWED_FIELDS,
            strict_unknown=True,
        )


def test_remote_chatgpt_dict_migrates_page_no_and_temp_page_id():
    remote = normalize_remote_chatgpt(
        {
            "bind_state": "TEMP_HOME_BOUND",
            "client_id": "c1",
            "page_instance_id": "p1",
            "temp_page_id": "7",
            "page_no": "7",
            "url": "https://chatgpt.com/",
        }
    )
    assert remote["page_display_id"] == "7"
    assert_no_legacy_fields(
        remote,
        owner="test_remote_chatgpt_dict",
        allowed_fields=REMOTE_CHATGPT_ALLOWED_FIELDS,
        strict_unknown=True,
    )


def test_bridge_poll_body_rejects_legacy_page_url():
    err = reject_legacy_fields(
        {
            "action": "poll",
            "client_id": "c1",
            "page_instance_id": "p1",
            "page_url": "https://chatgpt.com/c/x",
        },
        context="test_poll_body",
        allowed_fields=BRIDGE_REQUEST_ALLOWED_FIELDS,
        strict_unknown=True,
    )
    assert err is not None
    body, _ = err
    assert "page_url" in body["legacy_fields"]


def test_bridge_ack_body_allows_standard_fields():
    err = reject_legacy_fields(
        {
            "action": "ack",
            "client_id": "c1",
            "page_instance_id": "p1",
            "message_id": "m1",
            "success": True,
            "detail": "ok",
        },
        context="test_ack_body",
        allowed_fields=BRIDGE_REQUEST_ALLOWED_FIELDS,
        strict_unknown=True,
    )
    assert err is None


def test_assistant_reply_body_allows_standard_fields():
    err = reject_legacy_fields(
        {
            "action": "assistant_reply",
            "event": "assistant_reply",
            "client_id": "c1",
            "page_instance_id": "p1",
            "message_id": "m1",
            "session_id": "s1",
            "turn_id": "t1",
            "role": "assistant",
            "content": "done",
            "content_len": 4,
            "url": "https://chatgpt.com/c/test",
            "response_state": "idle",
            "created_at": 1.0,
        },
        context="test_assistant_reply_body",
        allowed_fields=BRIDGE_REQUEST_ALLOWED_FIELDS,
        strict_unknown=True,
    )
    assert err is None


def test_queue_chat_message_rejects_request_id():
    with pytest.raises(ValueError, match="request_id"):
        assert_no_legacy_fields(
            {
                "message_id": "m1",
                "type": "chat",
                "content": "hi",
                "request_id": "legacy",
            },
            owner="test_queue_chat_message",
            allowed_fields=QUEUE_MESSAGE_ALLOWED_FIELDS,
            strict_unknown=True,
        )


def test_control_command_message_allows_canonical_fields():
    assert_no_legacy_fields(
        {
            "message_id": "m1",
            "type": "command",
            "command": "open_url",
            "message_status": "queued",
            "created_at": 1.0,
            "url": "https://chatgpt.com/",
            "active": True,
        },
        owner="test_control_command_message",
        allowed_fields=QUEUE_MESSAGE_ALLOWED_FIELDS,
        strict_unknown=True,
    )


def test_poll_response_allows_page_no_only_for_poll_context():
    resp = _poll_response(
        {
            "message_id": "m1",
            "type": "chat",
            "content": "hi",
            "url": "https://chatgpt.com/c/x",
            "client_id": "c1",
            "page_instance_id": "p1",
            "conversation_id": "conv1",
            "message_status": "queued",
            "bind_request_id": "bind1",
        },
        retry=False,
    )
    assert_no_legacy_fields(
        resp,
        owner="test_poll_response",
        allowed_fields=POLL_RESPONSE_ALLOWED_FIELDS,
        strict_unknown=True,
    )


def test_gui_push_payload_allows_trace_and_target_page_id():
    normalized = normalize_inbound_push_payload(
        {
            "content": "hello",
            "session_id": "s1",
            "turn_id": "t1",
            "trace_id": "trace-1",
            "bootstrap_conversation": True,
            "bind_request_id": "bind-1",
            "target_page_id": "9",
        }
    )
    assert normalized["trace_id"] == "trace-1"
    assert normalized["bind_request_id"] == "bind-1"
    assert normalized["target_page_id"] == "9"
