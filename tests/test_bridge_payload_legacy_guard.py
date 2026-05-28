"""Guard queue payload validation against legacy field regressions."""

import pytest

from app.utils.bridge_payload import validate_outbound_queue_message


def _canonical_outbound_msg(**payload_extra):
    return {
        "message_id": "msg_test_001",
        "message_status": "queued",
        "client_id": "tm-test",
        "page_instance_id": "page-test",
        "conversation_id": "conv-test",
        "url": "https://chatgpt.com/c/conv-test",
        "payload": {
            "content": "test content",
            **payload_extra,
        },
    }


def test_validate_outbound_queue_message_rejects_payload_request_id():
    msg = _canonical_outbound_msg(request_id="legacy-request-id")

    with pytest.raises(ValueError) as exc:
        validate_outbound_queue_message(msg)

    err = str(exc.value)
    assert "legacy fields still exist before save" in err
    assert "payload.request_id" in err


def test_validate_outbound_queue_message_accepts_current_fields_without_request_id():
    msg = {
        "message_id": "msg_test_002",
        "message_status": "queued",
        "client_id": "tm-test",
        "page_instance_id": "page-test",
        "conversation_id": "conv-test",
        "url": "https://chatgpt.com/c/conv-test",
        "payload": {
            "content": "test content",
            "trace_id": "trace-test",
        },
    }

    out = validate_outbound_queue_message(msg)

    assert out["message_id"] == "msg_test_002"
    assert out["payload"]["content"] == "test content"
    assert "request_id" not in out["payload"]
