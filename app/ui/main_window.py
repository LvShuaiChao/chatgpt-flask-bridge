import traceback

import server

from app.constants import (
    SETTINGS_APP,
    SETTINGS_ORG,
)
from app.ui.widgets.bridge_notifier import BridgeNotifier
from PyQt5.QtCore import QSettings, Qt, QTimer
from PyQt5.QtGui import QKeySequence
from PyQt5.QtWidgets import (
    QApplication,
    QMainWindow,
    QShortcut,
)

from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.mixins.chat_session_mixin import ChatSessionMixin
from app.ui.mixins.chat_render_mixin import ChatRenderMixin
from app.ui.mixins.cursor_bridge_mixin import CursorBridgeMixin
from app.ui.mixins.job_scheduler_mixin import JobSchedulerMixin
from app.ui.mixins.log_tab_mixin import LogTabMixin
from app.ui.mixins.page_bind_mixin import PageBindMixin
from app.ui.mixins.session_mixin import SessionMixin
from app.ui.mixins.settings_mixin import SettingsMixin
from app.ui.mixins.ui_builder_mixin import UiBuilderMixin


class MainWindow(
    QMainWindow,
    SettingsMixin,
    UiBuilderMixin,
    SessionMixin,
    ChatSessionMixin,
    ChatRenderMixin,
    PageBindMixin,
    BridgeMixin,
    CursorBridgeMixin,
    JobSchedulerMixin,
    LogTabMixin,
):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ChatGPT 油猴联动聊天窗口")
        self.resize(1080, 780)
        self.setMinimumSize(900, 620)
        self._settings = QSettings(SETTINGS_ORG, SETTINGS_APP)
        self._sessions = {}
        self._tab_session_ids = []
        self._current_session_id = None
        self._message_to_session = {}
        self._message_to_turn = {}
        self._session_send_queues = {}
        self._external_client_last_session = {}
        self._processed_inbound_ids = set()
        self._pending_upload_sends = {}
        self._pending_web_sync_requests = {}
        self._web_sync_hard_timed_out_request_ids = set()
        self._pending_sync_requests = {}
        self._pending_chat_render = None
        self._pending_send_requests = {}
        self._web_sync_timeout_retry_done = set()
        self._finalized_bridge_message_ids = set()
        self._ack_success_message_ids = set()
        self._tampermonkey_page_url = None
        self._saved_page_url = self._load_saved_page_url()
        self._last_bridge_status = {}
        self._server_start_failed = False
        self._server_start_error = ""
        self._auto_bind_known_clients = set()
        self._auto_bind_wait_until = 0
        self._pending_auto_bind_session_id = ""
        self._pending_auto_bind_until = 0
        self._pending_auto_bind_known_clients = set()
        self._pending_auto_bind_known_page_instances = set()
        self._last_bound_page_seen_by_session = {}
        self._last_session_bind_display_state = {}
        self._last_session_bind_logged_pair = {}
        self._last_session_bind_state_log_at = {}
        self._last_auto_open_url_at = {}
        self._list_refreshing = False
        self._applying_bridge_status = False
        self._pending_bridge_status = None
        self._status_apply_pending = False
        self._pending_status_payload = None
        self._pending_status_apply_reason = ""
        self._last_status_apply_at = 0.0
        self._last_status_snapshot_key = ""
        self._last_light_status_signature = ""
        self._last_status_apply_schedule_at = 0.0
        self._last_tm_clients_signature = ""
        self._last_page_selector_key = ""
        self._manual_current_tm_page = None
        self._manual_current_tm_client_id = ""
        self._manual_current_tm_page_instance_id = ""
        self._manual_current_tm_conversation_id = ""
        self._manual_current_tm_url = ""
        self._tm_page_selector_refreshing = False
        self._last_chat_area_style_key = ""
        self._last_page_relation_key = ""
        self._last_bind_mismatch_key = ""
        self._last_bind_mismatch_at = 0.0
        self._last_bind_mismatch_ui_key = ""
        self._pending_log_lines = []
        self._log_flush_scheduled = False
        self._log_tab_load_pending = False
        self._session_switching = False
        self._pending_after_switch_status_apply = False
        self._last_session_switch_status_apply_at = 0.0
        self._current_status_apply_reason = ""
        self._load_app_settings_values()
        server.set_debug_mode(self._debug_mode)
        self._notifier = BridgeNotifier()
        self._notifier.log_signal.connect(self._append_log)
        self._init_bridge_status_aggregation()
        self._notifier.status_signal.connect(self._on_bridge_status_signal)
        server.set_log_callback(self._notifier.log_signal.emit)
        server.set_status_callback(self._notifier.status_signal.emit)
        server.set_external_gui_dispatch(self._notifier.external_dispatch_signal.emit)
        self._notifier.external_dispatch_signal.connect(self._handle_external_gui_dispatch)
        self._build_ui()
        self._setup_window_shortcuts()
        self._load_sessions_from_disk()
        if self._restore_chat_tab:
            saved_session_id = self._settings.value("current_session_id")
            if saved_session_id and saved_session_id in self._sessions:
                self._current_session_id = saved_session_id
        self._restore_ui_settings()
        self._update_bound_page_display()
        self._ensure_session_order()
        self._refresh_session_list()
        if not self._sessions:
            self._create_session(select=True)
        elif self._current_session_id and self._current_session_id in self._sessions:
            self._select_session(self._current_session_id, save=False)
        elif self._tab_session_ids:
            self._select_session(self._tab_session_ids[0], save=False)
        else:
            first_id = next(iter(self._sessions))
            self._select_session(first_id, save=False)
        self._status_timer = QTimer(self)
        self._status_timer.timeout.connect(self._refresh_status_tick)
        self._status_timer.start(1000)
        QTimer.singleShot(0, self._refresh_cursor_bridge_status)
        QTimer.singleShot(400, self._load_runtime_log_if_visible)
        QTimer.singleShot(
            0,
            lambda: self._render_current_chat_messages(
                force_bottom=True,
                reason="startup_initial",
            ),
        )
        QTimer.singleShot(
            120,
            lambda: self._render_current_chat_messages(
                force_bottom=True,
                reason="startup_after_show",
            ),
        )
        if self._auto_start_server and not server.is_server_running():
            QTimer.singleShot(300, self._start_server)

    def showEvent(self, event):
        super().showEvent(event)
        if hasattr(self, "_flush_pending_chat_render"):
            QTimer.singleShot(0, self._flush_pending_chat_render)
        if hasattr(self, "_render_current_chat_messages"):
            QTimer.singleShot(
                50,
                lambda: self._render_current_chat_messages(
                    force_bottom=True,
                    reason="show_event",
                ),
            )

    def closeEvent(self, event):
        if hasattr(self, "_save_splitter_sizes_now"):
            self._save_splitter_sizes_now()
        self._save_sessions_to_disk()
        self._save_app_settings()
        if server.is_server_running():
            try:
                server.stop_server()
            except Exception as error:
                detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"
                self._append_log(detail, echo=True)
        event.accept()

    def dump_top_level_windows(self, tag: str):
        rows = []
        for widget in QApplication.topLevelWidgets():
            parent = widget.parent()
            rows.append(
                {
                    "class": type(widget).__name__,
                    "objectName": widget.objectName(),
                    "title": widget.windowTitle(),
                    "visible": widget.isVisible(),
                    "parent": type(parent).__name__ if parent else None,
                }
            )
        self._append_log(
            f"[WINDOW_DUMP][{tag}] visible_top_level_windows={rows}",
            echo=True,
        )
        for row in rows:
            if not row.get("visible"):
                continue
            if row.get("class") == type(self).__name__:
                continue
            title = (row.get("title") or "").strip().lower()
            parent_missing = row.get("parent") is None
            title_suspect = title in ("", "python", "tk")
            if parent_missing or title_suspect:
                self._append_log(
                    f"[WINDOW_DUMP][SUSPECT][{tag}] {row}",
                    echo=True,
                )

    def _setup_window_shortcuts(self):
        shortcut = QShortcut(QKeySequence.New, self)
        shortcut.setContext(Qt.WindowShortcut)
        shortcut.activated.connect(self._create_new_local_session)
