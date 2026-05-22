"""assistant_busy 的 ack 不应 finalize 出站消息，应进入 waiting_reply。"""
import importlib
from collections import deque
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def mq_module():
    import app.server.message_queue as mq

    return importlib.reload(mq)


def test_handle_ack_assistant_busy_keeps_waiting(mq_module, monkeypatch):
    logged = []
    mq_module._log = lambda msg, tag="", level=None: logged.append(msg)
    waiting = {
        "message_id": "mid-busy",
        "type": "chat",
        "session_id": "sess-1",
        "turn_id": "turn-1",
        "delivered_to": "tm-1",
        "delivered_at": 1.0,
        "message_status": "delivered",
    }
    monkeypatch.setattr(
        mq_module.st,
        "_outbound_waiting",
        {"mid-busy": waiting},
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
    ext = MagicMock()
    monkeypatch.setattr(mq_module, "ext", ext, raising=False)

    result = mq_module._handle_ack(
        {
            "client_id": "tm-1",
            "message_id": "mid-busy",
            "success": False,
            "detail": "send_not_confirmed:assistant_busy",
        }
    )
    assert result == {"ok": True}
    assert waiting.get("message_status") == "waiting_reply"
    assert not waiting.get("finalized_at")
    assert any("[BRIDGE][ACK][BUSY_WAIT]" in line for line in logged)
