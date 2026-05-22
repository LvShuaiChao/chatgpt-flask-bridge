"""bridge ack 与 external notify 不得因未定义符号或通知失败而 500。"""
import importlib
from collections import deque

import pytest


@pytest.fixture
def mq_module():
    import app.server.message_queue as mq

    return importlib.reload(mq)


def test_handle_ack_success_does_not_raise_when_notify_missing_mapping(mq_module, monkeypatch):
    logged = []
    mq_module._log = lambda msg, tag="", level=None: logged.append(msg)
    monkeypatch.setattr(
        mq_module.st,
        "_outbound_waiting",
        {
            "mid-1": {
                "message_id": "mid-1",
                "type": "chat",
                "session_id": "sess-1",
                "turn_id": "turn-1",
                "delivered_to": "tm-1",
                "delivered_at": 1.0,
                "message_status": "delivered",
            }
        },
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

    result = mq_module._handle_ack(
        {
            "client_id": "tm-1",
            "message_id": "mid-1",
            "success": True,
            "detail": "已发送到 ChatGPT",
        }
    )
    assert result == {"ok": True}
    waiting = mq_module.st._outbound_waiting["mid-1"]
    assert waiting.get("message_status") == "acked"
    assert waiting.get("acked_at")
    assert not waiting.get("finalized_at")
    assert any("[BRIDGE][ACK][OK]" in line for line in logged)


def test_safe_notify_external_swallows_notify_errors(mq_module, monkeypatch):
    logged = []

    def _boom(*_a, **_k):
        raise RuntimeError("notify boom")

    mq_module._log = lambda msg, tag="", level=None: logged.append(msg)
    monkeypatch.setattr(mq_module, "_notify_external_request_impl", _boom, raising=False)
    ok = mq_module._safe_notify_external_request_from_bridge(
        "mid-2", "send_failed", {"detail": "x"}
    )
    assert ok is False
    assert any("[BRIDGE][EXTERNAL_NOTIFY][FAILED]" in line for line in logged)
    assert any("notify boom" in line for line in logged)
