"""本地 reset 占位污染时，同步应强制覆盖而非 snapshot_unchanged 跳过。"""
import unittest
from unittest.mock import MagicMock

from app.constants import PERSIST_PENDING_RESET_MESSAGE
from app.models import ChatMessage, ChatSession, default_remote_chatgpt
from app.ui.mixins.page_sync_mixin import PageSyncMixin


class _SyncHost(PageSyncMixin):
    def __init__(self, session):
        self.logs = []
        self._sessions = {session.session_id: session}
        self._current_session_id = session.session_id
        self._last_applied_snapshot_sig_by_session = {}
        self._bridge_ui = type("BridgeUi", (), {"last_bridge_status": {}})()

    def _append_log(self, message, **kwargs):
        self.logs.append(message)

    def _normalize_synced_message_text(self, text):
        return str(text or "").strip()

    def _message_fingerprint(self, role, text):
        return (role, self._normalize_synced_message_text(text))


class TestResetPlaceholderSync(unittest.TestCase):
    def test_session_has_reset_placeholder_errors(self):
        session = ChatSession(
            session_id="s1",
            title="t",
            created_at=1,
            updated_at=1,
            remote_chatgpt=default_remote_chatgpt(),
            messages=[
                ChatMessage(role="assistant", content=PERSIST_PENDING_RESET_MESSAGE),
            ],
        )
        host = _SyncHost(session)
        self.assertTrue(host._session_has_reset_placeholder_errors(session))

    def test_local_messages_match_web_snapshot_ignores_reset_errors(self):
        session = ChatSession(
            session_id="s1",
            title="t",
            created_at=1,
            updated_at=1,
            remote_chatgpt=default_remote_chatgpt(),
            messages=[
                ChatMessage(role="user", content="hello"),
                ChatMessage(role="assistant", content=PERSIST_PENDING_RESET_MESSAGE),
            ],
        )
        host = _SyncHost(session)
        web = [
            {"role": "user", "text": "hello"},
            {"role": "assistant", "text": "real reply"},
        ]
        self.assertFalse(host._local_messages_match_web_snapshot(session, web))

    def test_empty_web_removes_reset_errors(self):
        session = ChatSession(
            session_id="s1",
            title="t",
            created_at=1,
            updated_at=1,
            remote_chatgpt=default_remote_chatgpt(),
            messages=[
                ChatMessage(role="user", content="hello"),
                ChatMessage(role="assistant", content=PERSIST_PENDING_RESET_MESSAGE),
            ],
        )
        host = _SyncHost(session)
        host._schedule_save_sessions_to_disk = MagicMock()
        host._refresh_local_conversation_after_sync = MagicMock(return_value=True)

        ok, msg = host._sync_session_messages_from_web_snapshot("s1", [])
        self.assertTrue(ok)
        self.assertIn("清理", msg)
        self.assertEqual(len(session.messages), 1)
        self.assertEqual(session.messages[0].content, "hello")
