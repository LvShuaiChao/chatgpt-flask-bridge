import html
import json
import re
import sys
import time
import traceback
import uuid
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

import server
from log_utils import append_log, append_exception, clear_log_file, get_log_file_path

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
    CHATGPT_HOME_URL,
    DEFAULT_APP_SETTINGS,
    RUNTIME_DIR,
    SESSIONS_FILE,
    SESSIONS_JSON_VERSION,
    SETTINGS_APP,
    SETTINGS_ORG,
)
from app.models import ChatMessage, ChatSession, default_remote_chatgpt, normalize_remote_chatgpt
from app.url_utils import parse_conversation_id
from app.ui.widgets.bridge_notifier import BridgeNotifier
from app.ui.widgets.chat_bubble import ChatBubble, SystemBubble
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.session_list import SessionListWidget
from PyQt5.QtCore import QObject, QSettings, QUrl, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QDesktopServices, QFont, QKeySequence
from PyQt5.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QShortcut,
    QSizePolicy,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.mixins.chat_render_mixin import ChatRenderMixin
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
        self._processed_inbound_ids = set()
        self._finalized_bridge_message_ids = set()
        self._ack_success_message_ids = set()
        self._reply_bubbles_by_message_id = {}
        self._user_bubbles_by_message_id = {}
        self._tampermonkey_page_url = None
        self._saved_page_url = self._load_saved_page_url()
        self._page_url_from_cache = False
        self._last_bridge_status = {}
        self._auto_bind_known_clients = set()
        self._auto_bind_wait_until = 0
        self._pending_auto_bind_session_id = ""
        self._pending_auto_bind_started_at = 0
        self._pending_auto_bind_until = 0
        self._pending_auto_bind_known_clients = set()
        self._pending_auto_bind_known_page_instances = set()
        self._last_auto_open_url_at = {}
        self._pending_open_session_id = ""
        self._pending_open_url = ""
        self._pending_open_until = 0
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
        if self._auto_start_server and not server.is_server_running():
            QTimer.singleShot(300, self._start_server)

    def _setup_window_shortcuts(self):
        shortcut = QShortcut(QKeySequence.New, self)
        shortcut.setContext(Qt.WindowShortcut)
        shortcut.activated.connect(self._create_new_local_session)
