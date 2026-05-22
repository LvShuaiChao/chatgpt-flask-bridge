import importlib

import pytest

from app.constants import DEBUG_FULL_BRIDGE_JSON


@pytest.fixture
def server_module():
    import server as server_mod
    importlib.reload(server_mod)
    return server_mod


def test_bridge_json_should_log_poll_always_when_full_json_enabled(server_module):
    assert DEBUG_FULL_BRIDGE_JSON is True
    assert server_module._bridge_json_should_log("poll", {}, {"has_message": False}) is True
    assert server_module._bridge_json_should_log("poll", {}, {"has_message": True}) is True


def test_bridge_json_should_log_ack(server_module):
    assert server_module._bridge_json_should_log("ack", {}, {"ok": True}) is True


def test_bridge_json_should_log_focus_state_report_quiet(server_module):
    body = {"event": "focus_state"}
    assert server_module._bridge_json_should_log("report", body, {"ok": True}) is False


def test_bridge_json_should_log_assistant_reply_report(server_module):
    body = {"event": "assistant_reply"}
    assert server_module._bridge_json_should_log("report", body, {"ok": True}) is True


def test_bridge_json_should_log_conversation_snapshot_report(server_module):
    body = {"event": "conversation_snapshot"}
    assert server_module._bridge_json_should_log("report", body, {"ok": True}) is True


def test_bridge_json_should_log_page_heartbeat_report(server_module):
    body = {"event": "page_heartbeat"}
    assert server_module._bridge_json_should_log("report", body, {"ok": True}) is False


def test_dumps_full_json_no_truncation(server_module):
    from app.utils.json_log import dumps_full_json_for_log

    long_text = "x" * 5000
    dumped = dumps_full_json_for_log({"content": long_text, "message_id": "m1"})
    assert long_text in dumped
    assert "truncated" not in dumped
