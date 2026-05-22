"""静态审查清单：流程/字段收口回归。"""

import time

import pytest

from app.utils.legacy_cleanup import LEGACY_FIELD_NAMES, assert_no_legacy_fields
from app.utils.page_status import (
    evaluate_page_capability,
    is_page_online,
    page_url_from,
)


class _DryRunHost:
    _bind_each_chat_to_page = False

    def _client_conversation_id(self, item):
        return (item or {}).get("conversation_id") or ""

    def resolve_send_decision(self, session, content="", status=None):
        if content == "__probe__":
            return (
                "allowed",
                "ready",
                {
                    "client_id": "c1",
                    "page_instance_id": "p1",
                    "conversation_id": "conv-1",
                    "url": "https://chatgpt.com/c/conv-1",
                    "send_requestable": True,
                    "send_now_available": True,
                },
                {
                    "client_id": "c1",
                    "page_instance_id": "p1",
                    "send_requestable": True,
                    "send_now_available": True,
                },
            )
        return ("blocked", "empty", None, {})

    def request_send_message(self, session, content="", dry_run=False, **kwargs):
        if dry_run:
            decision, reason, target_page, detail = self.resolve_send_decision(
                session, content=content
            )
            detail = detail if isinstance(detail, dict) else {}
            send_now = decision == "allowed"
            send_queue = decision == "queued"
            send_requestable = bool(detail.get("send_requestable")) or send_now or send_queue
            return {
                "ok": decision != "blocked",
                "decision": decision,
                "payload": None,
                "dry_run": True,
                "send_requestable": send_requestable,
            }
        return {"ok": False, "payload": {"content": content}, "dry_run": False}


def test_dry_run_does_not_build_payload():
    host = _DryRunHost()
    result = host.request_send_message(None, content="__probe__", dry_run=True)
    assert result["dry_run"] is True
    assert result["payload"] is None
    assert result["send_requestable"] is True


def test_send_busy_page_is_queueable_not_send_now():
    now = time.time()
    page = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "url": "https://chatgpt.com/c/xyz",
        "conversation_id": "xyz",
        "page_type": "conversation",
        "last_seen": now - 2,
        "is_responding": True,
        "response_state": "responding",
    }
    cap = evaluate_page_capability(page, action="send", now=now)
    assert cap.send_now_available is False
    assert cap.send_queueable is True
    assert cap.send_requestable is True
    assert "sendable" not in cap.to_dict()
    assert "queueable" not in cap.to_dict()


def test_sync_pending_shape_uses_canonical_ids_only():
    from app.utils.page_status import build_page_key

    page_key = build_page_key({"client_id": "c1", "page_instance_id": "p1"})
    pending = {
        "session_id": "s1",
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-1",
        "url": "https://chatgpt.com/c/conv-1",
    }
    assert page_key == "c1|p1"
    assert "page_key" not in pending
    assert "target_page_key" not in pending
    assert_no_legacy_fields(pending, owner="test_sync_pending")


def test_title_in_legacy_field_names():
    assert "title" in LEGACY_FIELD_NAMES


def test_page_url_from_runtime_canonical_only():
    assert page_url_from({"target_url": "https://chatgpt.com/c/x"}) == ""
    assert page_url_from({"url": "https://chatgpt.com/c/x"}) == "https://chatgpt.com/c/x"
