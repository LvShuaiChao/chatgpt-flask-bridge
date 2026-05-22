"""生成中占位文案不得作为 assistant_reply 写入 inbound。"""
import importlib
from collections import deque
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def mq_module():
    import app.server.message_queue as mq

    return importlib.reload(mq)


def test_handle_assistant_reply_rejects_thinking_placeholder(mq_module, monkeypatch):
    logged = []
    inbound = []
    mq_module._log = lambda msg, tag="", level=None: logged.append(msg)
    mq_module._add_inbound = lambda *a, **k: inbound.append((a, k))
    monkeypatch.setattr(mq_module.st, "_outbound_waiting", {}, raising=False)
    monkeypatch.setattr(mq_module.st, "_control_waiting", {}, raising=False)
    monkeypatch.setattr(mq_module.st, "_outbound_queue", deque(), raising=False)
    monkeypatch.setattr(mq_module.st, "_outbound_history", deque(), raising=False)
    monkeypatch.setattr(
        mq_module,
        "_touch_tampermonkey",
        lambda *a, **k: None,
        raising=False,
    )
    monkeypatch.setattr(mq_module, "_notify_status", lambda: None, raising=False)

    result = mq_module._handle_assistant_reply(
        {
            "client_id": "tm-1",
            "message_id": "mid-1",
            "session_id": "sess-1",
            "turn_id": "turn-1",
            "content": "正在思考",
        }
    )

    assert result == {"ok": False, "error": "invalid_assistant_reply_text"}
    assert not inbound
    assert any("[BRIDGE][ASSISTANT_REPLY][SKIP_INVALID_TEXT]" in line for line in logged)


def test_handle_report_assistant_reply_rejects_thinking(mq_module, monkeypatch):
    logged = []
    inbound = []
    waiting = {
        "message_id": "mid-2",
        "type": "chat",
        "session_id": "sess-2",
        "turn_id": "turn-2",
        "client_id": "tm-1",
        "delivered_to": "tm-1",
        "delivered_at": 1.0,
        "message_status": "delivered",
    }
    mq_module._log = lambda msg, tag="", level=None: logged.append(msg)
    mq_module._add_inbound = lambda *a, **k: inbound.append((a, k))
    monkeypatch.setattr(
        mq_module.st,
        "_outbound_waiting",
        {"mid-2": waiting},
        raising=False,
    )
    monkeypatch.setattr(mq_module.st, "_control_waiting", {}, raising=False)
    monkeypatch.setattr(mq_module.st, "_outbound_queue", deque(), raising=False)
    monkeypatch.setattr(mq_module.st, "_outbound_history", deque(), raising=False)
    monkeypatch.setattr(
        mq_module,
        "_touch_tampermonkey",
        lambda *a, **k: None,
        raising=False,
    )
    monkeypatch.setattr(
        mq_module,
        "_safe_notify_external_request_from_bridge",
        lambda *a, **k: True,
        raising=False,
    )
    monkeypatch.setattr(mq_module, "_notify_status", lambda: None, raising=False)
    monkeypatch.setattr(mq_module, "_finalize_message", lambda *a, **k: None, raising=False)
    monkeypatch.setattr(mq_module, "_log_finalized", lambda *a, **k: None, raising=False)
    monkeypatch.setattr(mq_module, "_archive_waiting", lambda *a, **k: None, raising=False)
    monkeypatch.setattr(
        mq_module,
        "log_assistant_reply_recv_full",
        lambda *a, **k: None,
        raising=False,
    )
    monkeypatch.setattr(mq_module, "_job_scheduler", MagicMock(), raising=False)

    result = mq_module._handle_report(
        {
            "client_id": "tm-1",
            "message_id": "mid-2",
            "event": "assistant_reply",
            "payload": {
                "content": "正在思考",
                "text": "正在思考",
            },
        }
    )

    assert result == {"ok": False, "error": "invalid_assistant_reply_text"}
    assert not inbound
    assert any("[BRIDGE][ASSISTANT_REPLY][SKIP_INVALID_TEXT]" in line for line in logged)
