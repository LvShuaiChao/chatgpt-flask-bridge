"""enqueue_page_command 结构化返回值测试。"""

from unittest.mock import MagicMock, patch

import pytest

from app.ui.main_window_state import BridgeUiState
from app.ui.mixins.bridge_mixin import BridgeMixin
from app.utils.page_snapshot import PageRegistry


class _EnqueueHost(BridgeMixin):
    def __init__(self, status=None):
        self._bridge_ui = BridgeUiState()
        self._bridge_ui.last_bridge_status = status or {}
        self.page_registry = PageRegistry.from_bridge_status(
            self._bridge_ui.last_bridge_status
        )
        self._logs = []

    def _append_log(self, message, echo=False, level=None):
        self._logs.append((message, echo, level))

    def safe_log(self, message, echo=False, level=None):
        return self._append_log(message, echo=echo, level=level)


class _Session:
    def __init__(self, remote):
        self.session_id = "s1"
        self.remote_chatgpt = remote


def _status_with_page():
    import time

    now = time.time()
    return {
        "pages": [
            {
                "client_id": "tm-a",
                "page_instance_id": "inst-1",
                "url": "https://chatgpt.com/c/conv1",
                "conversation_id": "conv1",
                "last_seen": now,
            }
        ]
    }


def test_enqueue_page_command_success():
    host = _EnqueueHost(_status_with_page())
    session = _Session(
        {
            "enabled": True,
            "client_id": "tm-a",
            "page_instance_id": "inst-1",
            "conversation_id": "conv1",
            "url": "https://chatgpt.com/c/conv1",
        }
    )
    with patch(
        "app.ui.mixins.bridge_mixin.server.enqueue_control_command",
        return_value={"ok": True, "message_id": "msg-123", "command": "sync_conversation"},
    ):
        result = host.enqueue_page_command(session, "sync_conversation", payload={"mode": "merge"})
    assert result["ok"] is True
    assert result["message_id"] == "msg-123"
    assert result["target"]["client_id"] == "tm-a"


def test_enqueue_page_command_missing_message_id_not_ok():
    host = _EnqueueHost(_status_with_page())
    session = _Session(
        {
            "enabled": True,
            "client_id": "tm-a",
            "page_instance_id": "inst-1",
            "conversation_id": "conv1",
            "url": "https://chatgpt.com/c/conv1",
        }
    )
    with patch(
        "app.ui.mixins.bridge_mixin.server.enqueue_control_command",
        return_value={"ok": True, "message": {}},
    ):
        result = host.enqueue_page_command(session, "sync_conversation")
    assert result["ok"] is False
    assert result["message_id"] == ""


def test_enqueue_page_command_target_offline():
    host = _EnqueueHost({"pages": []})
    session = _Session(
        {
            "enabled": True,
            "client_id": "missing",
            "page_instance_id": "missing",
            "conversation_id": "conv1",
            "url": "https://chatgpt.com/c/conv1",
        }
    )
    result = host.enqueue_page_command(session, "sync_conversation")
    assert result["ok"] is False
    target = result.get("target") or {}
    assert target.get("reason_code") == "bound_page_offline"
