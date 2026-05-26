"""生成中占位文案不得作为 assistant_reply 写入 inbound。"""
import importlib
from collections import deque
from unittest.mock import MagicMock

import pytest

from app.constants import is_invalid_assistant_reply_text


@pytest.fixture
def mq_module():
    import app.server.message_queue as mq

    return importlib.reload(mq)


@pytest.mark.parametrize(
    "text",
    [
        "正在思考",
        "已思考 12 秒",
        "已思考几秒",
        "已思考 几秒",
        "已思考 4m 54s",
        "已思考若干秒",
        "Thought for 4m 54s",
    ],
)
def test_is_invalid_assistant_reply_text_thinking_placeholders(text):
    assert is_invalid_assistant_reply_text(text) is True


@pytest.mark.parametrize(
    "text",
    [
        "4+4=8",
        "已思考后，答案是 8",
    ],
)
def test_is_invalid_assistant_reply_text_keeps_real_answers(text):
    assert is_invalid_assistant_reply_text(text) is False


@pytest.mark.parametrize(
    "text",
    [
        "Unusual activity has been detected from your device. Try again later.",
        "Unusual activity has been detected from your device. Try again later. (41f195f6-aa95-43c3-9993-2f6d1539196b)",
    ],
)
def test_chatgpt_platform_error_is_not_invalid_assistant_reply(text):
    assert is_invalid_assistant_reply_text(text) is False


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


def test_handle_assistant_reply_rejects_thinking_duration_placeholder(
    mq_module, monkeypatch
):
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
            "message_id": "mid-1b",
            "session_id": "sess-1",
            "turn_id": "turn-1",
            "content": "已思考 4m 54s",
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
