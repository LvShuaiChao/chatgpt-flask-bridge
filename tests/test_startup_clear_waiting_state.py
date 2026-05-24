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
    session.reply_waiting_since = pending_since or (now - 73)
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
    assert float(session.reply_waiting_since or 0) <= 0
    assert len(session.messages) == 1
    assert session.messages[0].role == "user"
    assert host._session_has_pending_assistant_reply(session) is False
    log_text = " ".join(
        str(call.args[0]) for call in host._append_log.call_args_list if call.args
    )
    assert "[CHAT][STARTUP_DROP_RUNTIME_PLACEHOLDER]" in log_text


def test_clear_runtime_waiting_state_removes_reset_errors():
    host = _StartupHost(Path("/tmp/unused"))
    now = time.time()
    session = ChatSession(
        session_id="s-reset",
        title="reset",
        created_at=now,
        updated_at=now,
        remote_chatgpt=default_remote_chatgpt(),
    )
    session.messages = [
        ChatMessage(role="user", content="hi", message_id="u1"),
        ChatMessage(
            role="assistant",
            content=PERSIST_PENDING_RESET_MESSAGE,
            message_id="a1",
            ui_status="failed",
        ),
    ]
    assert host._clear_runtime_waiting_state_on_startup(session) is True
    assert len(session.messages) == 1
    assert session.messages[0].role == "user"


def test_normalize_session_for_persistence_strips_runtime_pending():
    host = _StartupHost(Path("/tmp/unused"))
    session = _waiting_session()
    data = host._normalize_session_for_persistence(session)
    assert float(data.get("reply_waiting_since") or 0) <= 0
    assert len(data["messages"]) == 1
    assert data["messages"][0]["role"] == "user"
    assert float(session.reply_waiting_since or 0) > 0
    assert session.messages[-1].ui_status == "waiting"


def test_normalize_session_for_persistence_drops_reset_errors():
    host = _StartupHost(Path("/tmp/unused"))
    now = time.time()
    session = ChatSession(
        session_id="s-persist",
        title="persist",
        created_at=now,
        updated_at=now,
        remote_chatgpt=default_remote_chatgpt(),
    )
    session.messages = [
        ChatMessage(role="user", content="hi", message_id="u1"),
        ChatMessage(
            role="assistant",
            content=STARTUP_PENDING_RESET_MESSAGE,
            message_id="a1",
            ui_status="failed",
        ),
    ]
    data = host._normalize_session_for_persistence(session)
    assert len(data["messages"]) == 1
    assert data["messages"][0]["role"] == "user"


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
    assert float(loaded.reply_waiting_since or 0) <= 0
    assert len(loaded.messages) == 1
    assert loaded.messages[0].role == "user"
    assert host._session_has_pending_assistant_reply(loaded) is False
    saved_raw = json.loads(sessions_file.read_text(encoding="utf-8"))
    saved_session = saved_raw["sessions"][0]
    assert float(saved_session.get("reply_waiting_since") or 0) <= 0
    saved_messages = saved_session["messages"]
    assert len(saved_messages) == 1
    assert saved_messages[0]["role"] == "user"
