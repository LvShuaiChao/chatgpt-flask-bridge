"""GUI 同步卡住修复：_append_log(level=) 与 sync_target_state 一致性。"""
import unittest
from unittest.mock import MagicMock, patch

from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.mixins.page_binding_diagnostics_mixin import PageBindingDiagnosticsMixin
from app.ui.mixins.page_sync_mixin import PageSyncMixin
from app.models import ChatSession
from app.utils.page_status import PageActionPlan, PageCapability


class _AppendLogHost(BridgeMixin):
    def __init__(self):
        self._ui_lines = []

    def _should_show_gui_log_line(self, line, level=None):
        return True

    def _append_runtime_log_line_to_ui(self, line):
        self._ui_lines.append(line)


class _SnapshotHost(PageSyncMixin):
    def __init__(self):
        self.logs = []
        self.hints = []
        self.refreshed = []
        self.saved = False
        self._current_session_id = ""
        self._sessions = {}
        self._bridge_ui = type("BridgeUi", (), {"last_bridge_status": {}})()

    def _tm_page_is_online_simple(self, page):
        return bool(page.get("online"))

    def _tm_client_sync_profile(self, item, **kwargs):
        return {"conversation_syncable": True, "online": True}

    def _short_page_label(self, item):
        return item.get("client_id", "")

    def _remote_conversation_id(self, remote):
        return (remote or {}).get("conversation_id") or ""

    def _append_log(self, message, **kwargs):
        self.logs.append(message)

    def _save_sessions_to_disk(self):
        self.saved = True

    def _schedule_save_sessions_to_disk(self):
        self._save_sessions_to_disk()

    def _clear_pending_wait_messages_after_web_sync(self, session, normalized_web):
        return 0

    def _refresh_local_conversation_after_sync(self, session_id, **kwargs):
        self.refreshed.append((session_id, kwargs))
        return True

    def _auto_rename_session_from_messages(self, session):
        return None

    def _set_tm_action_hint(self, text):
        self.hints.append(text)


class TestAppendLogLevelCompat(unittest.TestCase):
    def test_append_log_accepts_level_and_extra_kwargs(self):
        host = _AppendLogHost()
        with patch("app.ui.mixins.bridge_mixin.append_log", return_value="line") as mock_append:
            host._append_log("hello", echo=True, level="WARNING")
            host._append_log("world", tag="x", category="y", severity="z")
            self.assertEqual(mock_append.call_args_list[0].kwargs["level"], "WARNING")
            self.assertEqual(mock_append.call_args_list[1].kwargs["level"], "INFO")


class TestSyncTargetSnapshotAllowed(unittest.TestCase):
    def test_allowed_true_sets_sync_readable(self):
        host = _SnapshotHost()
        session = MagicMock()
        session.remote_chatgpt = {"enabled": True, "client_id": "c1"}
        host._current_session = MagicMock(return_value=session)
        host.resolve_page_action = MagicMock(
            return_value=PageActionPlan(
                action="sync_conversation",
                decision="allowed",
                target_source="bound_page",
                reason_code="",
                capability=PageCapability(
                    online=True,
                    conversation_syncable=True,
                ),
                page={"client_id": "c1", "online": True},
            )
        )
        snap = host._sync_target_snapshot(
            status={"active": {"client_id": "other", "conversation_id": ""}},
        )
        self.assertTrue(snap.get("sync_readable"))
        self.assertTrue(snap.get("conversation_syncable"))
        host.resolve_page_action.assert_called_once()

    def test_snapshot_sync_preserves_repeated_identical_messages(self):
        host = _SnapshotHost()
        session = ChatSession(
            session_id="s1",
            title="t",
            created_at=0,
            updated_at=0,
        )
        host._sessions = {"s1": session}
        host._current_session_id = "s1"

        ok, _ = host._sync_session_messages_from_web_snapshot(
            "s1",
            [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "reply one"},
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "reply two"},
            ],
            source="test",
        )

        self.assertTrue(ok)
        self.assertEqual(
            [(message.role, message.content) for message in session.messages],
            [
                ("user", "hello"),
                ("assistant", "reply one"),
                ("user", "hello"),
                ("assistant", "reply two"),
            ],
        )


class TestStatusSummarySyncTargetState(unittest.TestCase):
    def test_summary_available_when_conversation_syncable(self):
        host = PageBindingDiagnosticsMixin()
        host._append_log = MagicMock()
        host._last_tm_summary_log_key = None
        from tests.host_states import attach_main_window_states as init_main_window_states

        init_main_window_states(host)
        host._bridge_ui.last_bridge_status = {"server_running": True}
        host._find_focused_tm_page = lambda status: {}
        host._page_full_url = lambda info: "url"
        host._tm_client_sync_profile = lambda info: {"sync_readable": False}
        host._resolve_bound_page_info = lambda status=None: ({}, "bound", "")
        host._sync_target_snapshot = lambda **kwargs: {
            "conversation_syncable": True,
            "sync_readable": True,
            "allowed": True,
            "short_label": "x",
            "active_matches_bound": False,
        }
        host._log_tm_status_summary({"online_clients": 1, "total_clients": 1})
        logged = host._append_log.call_args[0][0]
        self.assertIn("sync_target_state=available", logged)


if __name__ == "__main__":
    unittest.main()
