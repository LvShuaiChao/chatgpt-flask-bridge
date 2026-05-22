import importlib

import pytest


@pytest.fixture
def server_module():
    import server as server_mod
    importlib.reload(server_mod)
    return server_mod


def test_bridge_json_should_log_poll_without_message(server_module):
    assert server_module._bridge_json_should_log("poll", {}, {"has_message": False}) is False
    assert server_module._bridge_json_should_log("poll", {}, {"has_message": True}) is True


def test_bridge_json_should_log_focus_state_report(server_module):
    body = {"event": "focus_state"}
    assert server_module._bridge_json_should_log("report", body, {"ok": True}) is False


def test_bridge_json_should_log_assistant_reply_report(server_module):
    body = {"event": "assistant_reply"}
    assert server_module._bridge_json_should_log("report", body, {"ok": True}) is True


def test_bridge_json_should_log_in_debug_mode(server_module):
    server_module.set_debug_mode(True)
    try:
        assert server_module._bridge_json_should_log("poll", {}, {"has_message": False}) is False
        assert server_module._bridge_json_should_log("poll", {}, {"has_message": True}) is True
    finally:
        server_module.set_debug_mode(False)


def test_bridge_json_should_log_page_heartbeat_report(server_module):
    body = {"event": "page_heartbeat"}
    assert server_module._bridge_json_should_log("report", body, {"ok": True}) is False


