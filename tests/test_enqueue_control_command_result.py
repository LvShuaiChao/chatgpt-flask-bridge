"""enqueue_control_command 结构化返回值与 GUI 解析一致性。"""

import importlib

import pytest

from app.ui.mixins.bridge_mixin import BridgeMixin


@pytest.fixture
def server_module():
    import server as srv

    return importlib.reload(srv)


def test_enqueue_control_command_success_shape(server_module):
    with server_module._state_lock:
        server_module._control_queue.clear()
    from app.utils.page_status import build_page_key

    server_module._tampermonkey_pages[build_page_key("c1", "p1")] = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-1",
        "page_type": "conversation",
        "last_seen": server_module._now(),
    }
    result = server_module.enqueue_control_command(
        "sync_conversation",
        client_id="c1",
        page_instance_id="p1",
        conversation_id="conv-1",
    )
    assert result.get("ok") is True
    assert result.get("message_id")
    assert isinstance(result.get("message"), dict)
    assert result.get("message", {}).get("command") == "sync_conversation"


def test_enqueue_control_command_failure_shape(server_module):
    result = server_module.enqueue_control_command(
        "",
        client_id="c1",
    )
    assert result.get("ok") is False
    assert result.get("reason") == "missing_command"
    assert result.get("message") is None


def test_normalize_enqueue_result_structured_and_legacy_msg():
    ok, msg, reason = BridgeMixin._normalize_enqueue_result(
        {"ok": True, "message": {"message_id": "m1", "command": "sync_conversation"}}
    )
    assert ok is True
    assert msg.get("message_id") == "m1"
    assert reason == ""

    ok, msg, reason = BridgeMixin._normalize_enqueue_result(
        {"message_id": "m2", "command": "start_upload", "type": "command"}
    )
    assert ok is True
    assert msg.get("message_id") == "m2"
    assert reason == ""

    ok, msg, reason = BridgeMixin._normalize_enqueue_result(
        {"ok": False, "reason": "missing_client_id"}
    )
    assert ok is False
    assert reason == "missing_client_id"
