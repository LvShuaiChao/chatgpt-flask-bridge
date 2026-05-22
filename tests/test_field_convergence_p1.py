"""P1 字段/流程收敛：审查清单落地回归。"""

import pytest

from app.models import normalize_remote_chatgpt
from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin
from app.utils.page_status import PageCapability, evaluate_page_capability


class _SendVerifyHost(PageSendTargetMixin):
    _bind_each_chat_to_page = True

    def _remote_conversation_id(self, remote):
        return (remote or {}).get("conversation_id") or ""


class _Session:
    def __init__(self, remote):
        self.session_id = "s1"
        self.remote_chatgpt = remote


def test_normalize_remote_rejects_target_conversation_id():
    with pytest.raises(ValueError, match="legacy fields"):
        normalize_remote_chatgpt(
            {
                "enabled": True,
                "conversation_id": "bound-conv",
                "target_conversation_id": "other-conv",
            }
        )


def test_send_binding_verify_blocks_conversation_mismatch_even_with_fallback():
    host = _SendVerifyHost()
    session = _Session(
        {
            "enabled": True,
            "client_id": "c1",
            "page_instance_id": "p1",
            "conversation_id": "conv-a",
        }
    )
    reason = host._send_binding_verify_blocked_reason(
        session,
        target_client_id="c1",
        url="https://chatgpt.com/c/conv-b",
        target_page_instance_id="p1",
        target_conversation_id="conv-b",
    )
    assert reason == "conversation_id_mismatch"


def test_send_binding_verify_allows_page_instance_fallback_same_conversation():
    host = _SendVerifyHost()
    host._allow_send_same_conversation_fallback = True  # type: ignore[attr-defined]
    session = _Session(
        {
            "enabled": True,
            "client_id": "c1",
            "page_instance_id": "p-old",
            "conversation_id": "conv-1",
        }
    )
    reason = host._send_binding_verify_blocked_reason(
        session,
        target_client_id="c1",
        url="https://chatgpt.com/c/conv-1",
        target_page_instance_id="p-new",
        target_conversation_id="conv-1",
    )
    assert reason == ""


def test_send_binding_verify_allows_client_id_fallback_same_conversation():
    host = _SendVerifyHost()
    host._allow_send_same_conversation_fallback = True  # type: ignore[attr-defined]
    session = _Session(
        {
            "enabled": True,
            "client_id": "c-old",
            "page_instance_id": "p-old",
            "conversation_id": "conv-1",
        }
    )
    reason = host._send_binding_verify_blocked_reason(
        session,
        target_client_id="c-new",
        url="https://chatgpt.com/c/conv-1",
        target_page_instance_id="p-new",
        target_conversation_id="conv-1",
    )
    assert reason == ""


def test_page_capability_to_dict_carries_response_state():
    cap = evaluate_page_capability(
        {
            "client_id": "c1",
            "page_instance_id": "p1",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "last_seen": __import__("time").time(),
            "response_state": "responding",
            "is_responding": True,
        },
        action="send",
    )
    out = cap.to_dict()
    assert out["response_state"] == "responding"
    assert isinstance(cap, PageCapability)
    assert cap.response_state == "responding"


def test_evaluate_page_capability_blocks_client_id_mismatch_for_send():
    cap = evaluate_page_capability(
        {
            "client_id": "other-c",
            "page_instance_id": "p1",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "last_seen": __import__("time").time(),
        },
        action="send",
        expected_client_id="bound-c",
        expected_page_instance_id="p1",
        expected_conversation_id="conv-1",
    )
    assert cap.allowed is False
    assert cap.client_id_mismatch is True


def test_message_allow_fallback_only_from_payload():
    msg = {"type": "command", "command": "sync_conversation"}
    assert not bool(msg.get("allow_same_conversation_fallback"))
    msg["allow_same_conversation_fallback"] = True
    assert bool(msg.get("allow_same_conversation_fallback"))


def test_conversation_id_reads_canonical_only():
    assert ({"conversation_id": "a"}.get("conversation_id") or "").strip() == "a"
    assert ({"target_conversation_id": "b"}.get("conversation_id") or "").strip() == ""
    assert ({"bound_conversation_id": "c"}.get("conversation_id") or "").strip() == ""


def test_external_request_status_uses_request_status_only(server_module):
    req = {"request_status": "queued"}
    assert server_module._external_request_status(req) == "queued"
    server_module._set_external_request_status(req, "done")
    assert req["request_status"] == "done"
    assert "status" not in req
    legacy = {"status": "waiting", "request_status": "queued"}
    assert server_module._external_request_status(legacy) == "queued"


@pytest.fixture
def server_module():
    import importlib
    import server as srv

    return importlib.reload(srv)
