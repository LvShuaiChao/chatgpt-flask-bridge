"""bridge_mixin pending 暂存字段：只使用 raw_content。"""

import pytest

from app.ui.mixins.bridge_mixin import BridgeMixin


class _PendingHost(BridgeMixin):
    def _effective_bind_state(self, session):
        return ""

    def _find_session_message_by_id(self, session, message_id):
        return None


def test_prepare_chat_send_from_pending_reads_raw_content():
    host = _PendingHost()
    pending = {
        "payload": {"trace_id": "t1"},
        "raw_content": "hello from raw_content",
        "turn_id": "turn-1",
    }
    ctx = host._prepare_chat_send_from_pending(session=None, pending=pending)
    assert ctx["raw_content"] == "hello from raw_content"
    assert "raw_user_text" not in ctx


def test_prepare_chat_send_from_pending_rejects_legacy_raw_user_text():
    host = _PendingHost()
    pending = {
        "payload": {},
        "raw_user_text": "legacy text",
    }
    with pytest.raises(ValueError, match="legacy fields"):
        host._prepare_chat_send_from_pending(session=None, pending=pending)


def test_prepare_chat_send_from_pending_message_source():
    host = _PendingHost()
    pending = {
        "payload": {},
        "raw_content": "hello",
        "message_source": "local_queue",
    }
    ctx = host._prepare_chat_send_from_pending(session=None, pending=pending)
    assert ctx["message_source"] == "local_queue"
    assert "source" not in ctx
