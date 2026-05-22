"""GUI 同步卡住修复：_append_log(level=) 与 sync_target_state 一致性。"""
import unittest
from unittest.mock import MagicMock, patch

from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.mixins.page_binding_diagnostics_mixin import PageBindingDiagnosticsMixin
from app.ui.mixins.page_sync_mixin import PageSyncMixin


class _AppendLogHost(BridgeMixin):
    def __init__(self):
        self._ui_lines = []

    def _should_show_gui_log_line(self, line, level=None):
        return True

    def _append_runtime_log_line_to_ui(self, line):
        self._ui_lines.append(line)


class _SnapshotHost(PageSyncMixin):
    def _tm_page_is_online_simple(self, page):
        return bool(page.get("online"))

    def _tm_client_sync_profile(self, item, **kwargs):
        return {"conversation_syncable": True, "online": True}

    def _short_page_label(self, item):
        return item.get("client_id", "")

    def _remote_conversation_id(self, remote):
        return (remote or {}).get("conversation_id") or ""


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
        snap = host._build_sync_target_snapshot_from_decision(
            session=MagicMock(),
            remote={"enabled": True, "client_id": "c1"},
            page={"client_id": "c1", "online": True},
            source="bound_page",
            block_reason="",
            detail={"conversation_syncable": True, "online": True},
            status={"active": {"client_id": "other", "conversation_id": ""}},
            allowed=True,
        )
        self.assertTrue(snap.get("allowed"))
        self.assertTrue(snap.get("sync_readable"))
        self.assertTrue(snap.get("conversation_syncable"))


class TestStatusSummarySyncTargetState(unittest.TestCase):
    def test_summary_available_when_conversation_syncable(self):
        host = PageBindingDiagnosticsMixin()
        host._append_log = MagicMock()
        host._last_tm_summary_log_key = None
        from app.ui.main_window_state import init_main_window_states

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
