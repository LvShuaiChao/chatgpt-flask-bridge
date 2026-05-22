"""GUI 重启后不应恢复等待回复计时与 local_placeholder waiting 状态。"""
import json
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    PERSIST_PENDING_RESET_MESSAGE,
    STARTUP_PENDING_RESET_MESSAGE,
)
from app.models import ChatMessage, ChatSession, default_remote_chatgpt
from app.ui.mixins.chat_session_mixin import ChatSessionMixin
from app.ui.mixins.session_mixin import SessionMixin


class _StartupHost(ChatSessionMixin, SessionMixin):
    def __init__(self, tmp_path):
        self._sessions = {}
        self._current_session_id = ""
        self._tab_session_ids = []
        self._message_to_session = {}
        self._message_to_turn = {}
        self._save_chat_history = True
        self._chat_sessions_path = str(tmp_path)
        self._append_log = MagicMock()
        self._bridge_msg = MagicMock(finalized_bridge_message_ids=set())
        self._bridge_ui = MagicMock(last_bridge_status={})
        self._settings = MagicMock()
        self._settings.value.return_value = None
        self._refresh_session_list = MagicMock()
        self._render_current_chat_messages = MagicMock()


def _waiting_session(*, pending_since=None):
    now = time.time()
    session = ChatSession(
        session_id="s-wait",
        title="等待测试",
        created_at=now,
        updated_at=now,
        remote_chatgpt=default_remote_chatgpt(),
    )
    session.pending_reply_since = pending_since or (now - 73)
    session.messages = [
        ChatMessage(role="user", content="hi", message_id="u1", turn_id="t1"),
        ChatMessage(
            role="assistant",
            content=ASSISTANT_WAIT_TEXT,
            message_id="a1",
            turn_id="t1",
            ui_status="waiting",
            message_source="local_placeholder",
            parent_message_id="u1",
        ),
    ]
    return session


def test_clear_runtime_waiting_state_on_startup():
    host = _StartupHost(Path("/tmp/unused"))
    session = _waiting_session()
    assert host._clear_runtime_waiting_state_on_startup(session) is True
    assert float(session.pending_reply_since or 0) <= 0
    assistant = session.messages[-1]
    assert assistant.ui_status == "failed"
    assert STARTUP_PENDING_RESET_MESSAGE in assistant.content
    assert host._session_has_pending_assistant_reply(session) is False


def test_normalize_session_for_persistence_strips_runtime_pending():
    host = _StartupHost(Path("/tmp/unused"))
    session = _waiting_session()
    data = host._normalize_session_for_persistence(session)
    assert float(data.get("pending_reply_since") or 0) <= 0
    assistant = data["messages"][-1]
    assert assistant["ui_status"] == "failed"
    assert PERSIST_PENDING_RESET_MESSAGE in assistant["content"]
    assert float(session.pending_reply_since or 0) > 0
    assert session.messages[-1].ui_status == "waiting"


def test_load_sessions_from_disk_clears_waiting(tmp_path):
    host = _StartupHost(tmp_path)
    session = _waiting_session()
    payload = {
        "version": 2,
        "current_session_id": session.session_id,
        "tab_order": [session.session_id],
        "sessions": [host._session_to_dict(session)],
        "message_to_session": {},
        "message_to_turn": {},
        "finalized_bridge_message_ids": [],
    }
    sessions_file = tmp_path / "chat_sessions.json"
    sessions_file.write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )
    host._load_sessions_from_disk()
    loaded = host._sessions[session.session_id]
    assert float(loaded.pending_reply_since or 0) <= 0
    assistant = loaded.messages[-1]
    assert assistant.ui_status == "failed"
    assert STARTUP_PENDING_RESET_MESSAGE in assistant.content
    assert host._session_has_pending_assistant_reply(loaded) is False
    saved_raw = json.loads(sessions_file.read_text(encoding="utf-8"))
    saved_session = saved_raw["sessions"][0]
    assert float(saved_session.get("pending_reply_since") or 0) <= 0
    saved_assistant = saved_session["messages"][-1]
    assert saved_assistant["ui_status"] == "failed"
