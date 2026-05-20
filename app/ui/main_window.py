
import server

from app.constants import (
    SETTINGS_APP,
    SETTINGS_ORG,
)
from app.ui.widgets.bridge_notifier import BridgeNotifier
from PyQt5.QtCore import QSettings, Qt, QTimer
from PyQt5.QtGui import QKeySequence
from PyQt5.QtWidgets import (
    QMainWindow,
    QShortcut,
)

from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.mixins.chat_render_mixin import ChatRenderMixin
from app.ui.mixins.cursor_bridge_mixin import CursorBridgeMixin
from app.ui.mixins.page_bind_mixin import PageBindMixin
from app.ui.mixins.session_mixin import SessionMixin
from app.ui.mixins.settings_mixin import SettingsMixin
from app.ui.mixins.ui_builder_mixin import UiBuilderMixin


class MainWindow(
    QMainWindow,
    SettingsMixin,
    UiBuilderMixin,
    SessionMixin,
    ChatRenderMixin,
    PageBindMixin,
    BridgeMixin,
    CursorBridgeMixin,
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
        self._finalized_bridge_message_ids = set()
        self._ack_success_message_ids = set()
        self._reply_bubbles_by_message_id = {}
        self._user_bubbles_by_message_id = {}
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
        self._last_session_bind_state_log_at = {}
        self._last_session_bind_debounce_log_at = {}
        self._last_auto_open_url_at = {}
        self._list_refreshing = False
        self._session_search_text = ""
        self._applying_bridge_status = False
        self._pending_bridge_status = None
        self._load_app_settings_values()
        server.set_debug_mode(self._debug_mode)
        self._notifier = BridgeNotifier()
        self._notifier.log_signal.connect(self._append_log)
        self._notifier.status_signal.connect(self._apply_bridge_status)
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
        if self._auto_start_server and not server.is_server_running():
            QTimer.singleShot(300, self._start_server)

    def _setup_window_shortcuts(self):
        shortcut = QShortcut(QKeySequence.New, self)
        shortcut.setContext(Qt.WindowShortcut)
        shortcut.activated.connect(self._create_new_local_session)
