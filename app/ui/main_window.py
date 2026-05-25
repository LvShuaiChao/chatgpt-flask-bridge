from app.server import (
    is_server_running,
    set_debug_mode,
    set_external_gui_dispatch,
    set_log_callback,
    set_status_callback,
    stop_server,
)

import traceback

from app.server.route_flags import enable_external_api

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
from app.ui.mixins.external_api_gui_mixin import ExternalApiGuiMixin
from app.ui.mixins.send_flow_mixin import SendFlowMixin
from app.ui.mixins.chat_session_mixin import ChatSessionMixin
from app.ui.mixins.chat_render_mixin import ChatRenderMixin
from app.ui.mixins.cursor_code_mixin import CursorCodeMixin
from app.ui.mixins.cursor_bridge_mixin import CursorBridgeMixin
from app.ui.mixins.page_bind_mixin import PageBindMixin
from app.ui.mixins.session_mixin import SessionMixin
from app.ui.mixins.settings_mixin import SettingsMixin
from app.ui.mixins.waiting_timer_mixin import WaitingTimerMixin
from app.ui.mixins.ui_builder_mixin import UiBuilderMixin
from app.ui.main_window_state import (
    AutoBindState,
    BindDisplayState,
    BridgeMessageState,
    BridgeUiState,
    PageCommandUiState,
    PageSelectorState,
    ServerUiState,
    SessionUiState,
    WebSyncState,
)


def _main_window_bases():
    bases = [
        SettingsMixin,
        WaitingTimerMixin,
        UiBuilderMixin,
        SessionMixin,
        ChatSessionMixin,
        ChatRenderMixin,
        PageBindMixin,
        SendFlowMixin,
    ]
    if enable_external_api():
        bases.append(ExternalApiGuiMixin)
    bases.extend(
        [
            BridgeMixin,
            CursorBridgeMixin,
            CursorCodeMixin,
        ]
    )
    return tuple(bases)


class MainWindow(QMainWindow, *_main_window_bases()):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ChatGPT 油猴联动聊天窗口")
        self.resize(1080, 780)
        self.setMinimumSize(900, 620)
        self._settings = QSettings(SETTINGS_ORG, SETTINGS_APP)
        self._sessions = {}
        self._tab_session_ids = []
        self._current_session_id = None
        self._session_compose_drafts = {}
        self._message_to_session = {}
        self._message_to_turn = {}
        self._session_send_queues = {}
        self._external_client_last_session = {}
        self._processed_inbound_ids = {}
        self._last_bridge_runtime_cleanup_at = 0.0
        self._bridge_ui = BridgeUiState()
        self._page_selector = PageSelectorState()
        self._web_sync = WebSyncState()
        self._auto_bind = AutoBindState()
        self._bind_display = BindDisplayState()
        self._page_cmd = PageCommandUiState()
        self._bridge_msg = BridgeMessageState()
        self._session_ui = SessionUiState()
        self._server_ui = ServerUiState()
        self._saved_page_url = self._load_saved_page_url()
        self._init_page_registry_refresh_state()
        self._load_app_settings_values()
        set_debug_mode(self._debug_mode)
        self._notifier = BridgeNotifier()
        self._notifier.log_signal.connect(self._append_log)
        self._init_status_scheduler()
        self._notifier.status_signal.connect(self._on_bridge_status_signal)
        set_log_callback(self._notifier.log_signal.emit)
        set_status_callback(self._notifier.status_signal.emit)
        set_external_gui_dispatch(self._notifier.external_dispatch_signal.emit)
        self._notifier.external_dispatch_signal.connect(self._handle_external_gui_dispatch)
        self._build_ui()
        if hasattr(self, "_init_cursor_code_state"):
            self._init_cursor_code_state()
        self._setup_window_shortcuts()
        self._load_sessions_from_disk()
        if self._restore_chat_tab:
            saved_session_id = self._settings.value("current_session_id")
            if saved_session_id and saved_session_id in self._sessions:
                self._current_session_id = saved_session_id
        self._restore_ui_settings()
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="startup")
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
        self._init_waiting_elapsed_timer()
        self._status_timer = QTimer(self)
        self._status_timer.timeout.connect(self._refresh_status_tick)
        self._status_timer.start(1000)
        QTimer.singleShot(0, self._refresh_cursor_bridge_status)
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
        if self._auto_start_server and not is_server_running():
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
        if hasattr(self, "_flush_pending_sessions_save"):
            self._flush_pending_sessions_save()
        else:
            self._save_sessions_to_disk()
        self._save_app_settings()
        if hasattr(self, "_stop_cursor_upgrade_monitor"):
            try:
                self._stop_cursor_upgrade_monitor(wait_ms=3000)
            except Exception as error:
                detail = (
                    f"关闭窗口时停止 Cursor 升级监控失败：{error}\n"
                    f"{traceback.format_exc()}"
                )
                self._append_log(detail, echo=True)
        if is_server_running():
            try:
                stop_server()
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
