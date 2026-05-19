import html
import json
import os
import re
import sys
import time
import traceback
import uuid
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse
from PyQt5.QtCore import QObject, QSettings, QUrl, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QDesktopServices, QFont
from PyQt5.QtWidgets import (

    QApplication,
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFileDialog,
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
    QSizePolicy,
    QSpinBox,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

import server

RUNTIME_DIR = Path(__file__).resolve().parent / "runtime"
SESSIONS_FILE = RUNTIME_DIR / "chat_sessions.json"
SESSIONS_JSON_VERSION = 2
ASSISTANT_WAIT_TEXT = "等待回复…"
ASSISTANT_WAIT_TEXTS = frozenset(
    {
        ASSISTANT_WAIT_TEXT,
        "等待 ChatGPT 回复…",
        "等待回复...",
        "等待 ChatGPT 回复...",
    }
)
CHATGPT_HOME_URL = "https://chatgpt.com/"
SETTINGS_ORG = "TampermonkeyBridge"
SETTINGS_APP = "ChatGUI"
DEFAULT_APP_SETTINGS = {
    "host": "127.0.0.1",
    "port": "5000",
    "auto_start_server": False,
    "font_size": 14,
    "remember_window_geometry": True,
    "remember_window_position": True,
    "restore_main_tab": True,
    "restore_chat_tab": True,
    "show_page_url": True,
    "show_top_status_bar": True,
    "enter_send_mode": "enter_send",
    "auto_clear_input_after_send": True,
    "auto_scroll_to_bottom": True,
    "auto_name_new_chat": True,
    "show_timestamp": True,
    "show_assistant_placeholder": True,
    "chat_sessions_path": str(RUNTIME_DIR),
    "save_chat_history": True,
    "debug_mode": False,
    "show_raw_payload": True,
    "log_ack_events": True,
    "log_assistant_reply_events": True,
    "log_send_failed_events": True,
    "bind_each_chat_to_page": False,
    "auto_open_bound_page_when_missing": True,
    "allow_fallback_to_any_page": False,
}


_CONVERSATION_ID_RE = re.compile(
    r"/c/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)


def _default_remote_chatgpt():
    return {
        "enabled": False,
        "conversation_id": "",
        "conversation_url": "",
        "client_id": "",
        "page_instance_id": "",
        "page_type": "",
        "page_title": "",
        "last_seen": 0,
    }


def _normalize_remote_chatgpt(remote):
    base = _default_remote_chatgpt()
    if not remote:
        return base
    for key in base:
        if key in remote:
            base[key] = remote[key]
    base["enabled"] = bool(remote.get("enabled", False))
    base["last_seen"] = float(remote.get("last_seen", 0) or 0)
    return base


def _parse_conversation_id(url):
    match = _CONVERSATION_ID_RE.search(url or "")
    return match.group(1) if match else ""

@dataclass
class ChatMessage:
    role: str
    content: str
    created_at: float = field(default_factory=time.time)
    message_id: str = ""
    turn_id: str = ""
    status: str = ""
    bridge_message_id: str = ""
    parent_message_id: str = ""
    visible_in_chat: bool = True
    @property
    def text(self):
        return self.content
    @text.setter
    def text(self, value):
        self.content = value

@dataclass
class ChatSession:
    session_id: str
    title: str
    created_at: float
    updated_at: float
    task_type: str = ""
    context_mode: str = ""
    summary: str = ""
    pinned_context: str = ""
    remote_chatgpt: dict = field(default_factory=_default_remote_chatgpt)
    messages: list = field(default_factory=list)
    has_pending_reply: bool = False


class BridgeNotifier(QObject):
    log_signal = pyqtSignal(str)
    status_signal = pyqtSignal(dict)


class ChatInput(QTextEdit):
    send_requested = pyqtSignal()
    def __init__(self, main_window=None):
        super().__init__()
        self._main_window = main_window
    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            mods = event.modifiers()
            mode = "enter_send"
            if self._main_window is not None:
                mode = getattr(self._main_window, "_enter_send_mode", "enter_send")
            if mode == "ctrl_enter_send":
                if (mods & Qt.ControlModifier) and not (mods & Qt.ShiftModifier):
                    self.send_requested.emit()
                    event.accept()
                    return
            elif not (mods & Qt.ShiftModifier):
                self.send_requested.emit()
                event.accept()
                return
        super().keyPressEvent(event)


class SystemBubble(QFrame):
    def __init__(self, text, ts_text=""):
        super().__init__()
        self.ts_text = ts_text
        self.setObjectName("SystemBubble")
        self.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Minimum)
        self.setMaximumWidth(520)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 7, 14, 7)
        self.body_label = QLabel()
        self.body_label.setObjectName("SystemBubbleBody")
        self.body_label.setWordWrap(True)
        self.body_label.setAlignment(Qt.AlignCenter)
        self.body_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        layout.addWidget(self.body_label)
        self.set_text(text)

    def set_text(self, text):
        self.body_label.setText(text or "")


class ChatBubble(QFrame):
    def __init__(self, role, text, ts_text, status_text="", body_pt=14):
        super().__init__()
        self.role = role
        self.ts_text = ts_text
        self.status_text = status_text
        self._body_pt = body_pt
        self.setObjectName("ChatBubble")
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Minimum)
        self.setMinimumWidth(140)
        if role == "error":
            self.setMaximumWidth(520)
        else:
            self.setMaximumWidth(720)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(4)
        self.header_label = QLabel()
        self.header_label.setObjectName("BubbleHeader")
        layout.addWidget(self.header_label)
        self.body_label = QLabel()
        self.body_label.setWordWrap(True)
        self.body_label.setTextFormat(Qt.PlainText)
        self.body_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.body_label.setObjectName("BubbleBody")
        layout.addWidget(self.body_label)
        self.set_text(text, status_text)
        self._apply_style()

    def _role_name(self):
        if self.role == "user":
            return "你"
        if self.role == "assistant":
            return "ChatGPT"
        if self.role == "error":
            return "错误"
        return "系统"

    def _apply_style(self):
        header_pt = max(11, self._body_pt - 2)
        if self.role == "user":
            self.setProperty("bubbleRole", "user")
        elif self.role == "assistant":
            self.setProperty("bubbleRole", "assistant")
        elif self.role == "error":
            self.setProperty("bubbleRole", "error")
        else:
            self.setProperty("bubbleRole", "other")
        self.style().unpolish(self)
        self.style().polish(self)
        self.header_label.setStyleSheet(
            f"font-size: {header_pt}px; background: transparent;"
        )
        self.body_label.setStyleSheet(
            f"font-size: {self._body_pt}px; background: transparent;"
        )

    def set_text(self, text, status_text=None):
        if status_text is not None:
            self.status_text = status_text
        name = html.escape(self._role_name())
        ts = html.escape(self.ts_text or "")
        header_pt = max(11, self._body_pt - 2)
        if self.status_text:
            status = html.escape(self.status_text)
            self.header_label.setTextFormat(Qt.RichText)
            self.header_label.setText(
                f'<span style="font-size:{header_pt}px;font-weight:600;">'
                f"{name} · {ts}</span> "
                f'<span style="color:#9aa0a6;font-weight:normal;">{status}</span>'
            )
        else:
            self.header_label.setTextFormat(Qt.PlainText)
            self.header_label.setText(f"{self._role_name()} · {self.ts_text}")
        self.body_label.setText(text or "")

    def set_error(self, text, status_text="失败"):
        self.role = "error"
        self.setMaximumWidth(520)
        self._apply_style()
        self.set_text(text, status_text)


class MainWindow(QMainWindow):
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
        self._list_refreshing = False
        self._session_search_text = ""
        self._load_app_settings_values()
        self._notifier = BridgeNotifier()
        self._notifier.log_signal.connect(self._append_log)
        self._notifier.status_signal.connect(self._apply_bridge_status)
        server.set_log_callback(self._notifier.log_signal.emit)
        server.set_status_callback(self._notifier.status_signal.emit)
        self._build_ui()
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
            self._start_server()
    # ------------------------------------------------------------------ settings I/O
    def _load_app_settings_values(self):
        defaults = DEFAULT_APP_SETTINGS
        try:
            self._host = str(self._settings.value("host", defaults["host"]))
            self._port_text = str(self._settings.value("port", defaults["port"]))
            self._auto_start_server = bool(
                self._settings.value("auto_start_server", defaults["auto_start_server"])
            )
            self._chat_font_pt = int(
                self._settings.value("font_size", defaults["font_size"])
            )
            self._remember_window_geometry = bool(
                self._settings.value(
                    "remember_window_geometry", defaults["remember_window_geometry"]
                )
            )
            self._remember_window_position = bool(
                self._settings.value(
                    "remember_window_position", defaults["remember_window_position"]
                )
            )
            self._restore_main_tab = bool(
                self._settings.value("restore_main_tab", defaults["restore_main_tab"])
            )
            self._restore_chat_tab = bool(
                self._settings.value("restore_chat_tab", defaults["restore_chat_tab"])
            )
            self._show_page_url = bool(
                self._settings.value("show_page_url", defaults["show_page_url"])
            )
            self._show_top_status_bar = bool(
                self._settings.value("show_top_status_bar", defaults["show_top_status_bar"])
            )
            self._enter_send_mode = str(
                self._settings.value("enter_send_mode", defaults["enter_send_mode"])
            )
            self._auto_clear_input_after_send = bool(
                self._settings.value(
                    "auto_clear_input_after_send",
                    defaults["auto_clear_input_after_send"],
                )
            )
            self._auto_scroll_to_bottom = bool(
                self._settings.value(
                    "auto_scroll_to_bottom", defaults["auto_scroll_to_bottom"]
                )
            )
            self._auto_name_new_chat = bool(
                self._settings.value("auto_name_new_chat", defaults["auto_name_new_chat"])
            )
            self._show_timestamp = bool(
                self._settings.value("show_timestamp", defaults["show_timestamp"])
            )
            self._show_assistant_placeholder = bool(
                self._settings.value(
                    "show_assistant_placeholder",
                    defaults["show_assistant_placeholder"],
                )
            )
            self._chat_sessions_path = str(
                self._settings.value("chat_sessions_path", defaults["chat_sessions_path"])
            )
            self._save_chat_history = bool(
                self._settings.value("save_chat_history", defaults["save_chat_history"])
            )
            self._debug_mode = bool(
                self._settings.value("debug_mode", defaults["debug_mode"])
            )
            self._show_raw_payload = bool(
                self._settings.value("show_raw_payload", defaults["show_raw_payload"])
            )
            self._log_ack_events = bool(
                self._settings.value("log_ack_events", defaults["log_ack_events"])
            )
            self._log_assistant_reply_events = bool(
                self._settings.value(
                    "log_assistant_reply_events", defaults["log_assistant_reply_events"]
                )
            )
            self._log_send_failed_events = bool(
                self._settings.value(
                    "log_send_failed_events", defaults["log_send_failed_events"]
                )
            )
            self._bind_each_chat_to_page = bool(
                self._settings.value(
                    "bind_each_chat_to_page", defaults["bind_each_chat_to_page"]
                )
            )
            self._auto_open_bound_page_when_missing = bool(
                self._settings.value(
                    "auto_open_bound_page_when_missing",
                    defaults["auto_open_bound_page_when_missing"],
                )
            )
            self._allow_fallback_to_any_page = bool(
                self._settings.value(
                    "allow_fallback_to_any_page",
                    defaults["allow_fallback_to_any_page"],
                )
            )
        except Exception as error:
            detail = f"加载设置失败，已使用默认值：{error}\n{traceback.format_exc()}"
            print(detail)
            defaults = DEFAULT_APP_SETTINGS
            self._host = defaults["host"]
            self._port_text = str(defaults["port"])
            self._auto_start_server = defaults["auto_start_server"]
            self._chat_font_pt = int(defaults["font_size"])
            self._remember_window_geometry = defaults["remember_window_geometry"]
            self._remember_window_position = defaults["remember_window_position"]
            self._restore_main_tab = defaults["restore_main_tab"]
            self._restore_chat_tab = defaults["restore_chat_tab"]
            self._show_page_url = defaults["show_page_url"]
            self._show_top_status_bar = defaults["show_top_status_bar"]
            self._enter_send_mode = defaults["enter_send_mode"]
            self._auto_clear_input_after_send = defaults["auto_clear_input_after_send"]
            self._auto_scroll_to_bottom = defaults["auto_scroll_to_bottom"]
            self._auto_name_new_chat = defaults["auto_name_new_chat"]
            self._show_timestamp = defaults["show_timestamp"]
            self._show_assistant_placeholder = defaults["show_assistant_placeholder"]
            self._chat_sessions_path = defaults["chat_sessions_path"]
            self._save_chat_history = defaults["save_chat_history"]
            self._debug_mode = defaults["debug_mode"]
            self._show_raw_payload = defaults["show_raw_payload"]
            self._log_ack_events = defaults["log_ack_events"]
            self._log_assistant_reply_events = defaults["log_assistant_reply_events"]
            self._log_send_failed_events = defaults["log_send_failed_events"]
            self._bind_each_chat_to_page = defaults["bind_each_chat_to_page"]
            self._auto_open_bound_page_when_missing = (
                defaults["auto_open_bound_page_when_missing"]
            )
            self._allow_fallback_to_any_page = defaults["allow_fallback_to_any_page"]
    def _read_settings_from_widgets(self):
        self._host = self.host_edit.text().strip() or "127.0.0.1"
        self._port_text = self.port_edit.text().strip() or "5000"
        self._auto_start_server = self.auto_start_server_cb.isChecked()
        self._chat_font_pt = int(self.font_size_spin.value())
        self._remember_window_geometry = self.remember_geometry_cb.isChecked()
        self._remember_window_position = self.remember_position_cb.isChecked()
        self._restore_main_tab = self.restore_main_tab_cb.isChecked()
        self._restore_chat_tab = self.restore_chat_tab_cb.isChecked()
        self._show_page_url = self.show_page_url_cb.isChecked()
        self._show_top_status_bar = self.show_top_status_bar_cb.isChecked()
        mode_index = self.enter_send_mode_combo.currentIndex()
        self._enter_send_mode = (
            "ctrl_enter_send" if mode_index == 1 else "enter_send"
        )
        self._auto_clear_input_after_send = self.auto_clear_input_cb.isChecked()
        self._auto_scroll_to_bottom = self.auto_scroll_cb.isChecked()
        self._auto_name_new_chat = self.auto_name_chat_cb.isChecked()
        self._show_timestamp = self.show_timestamp_cb.isChecked()
        self._show_assistant_placeholder = self.show_placeholder_cb.isChecked()
        self._chat_sessions_path = self.sessions_path_edit.text().strip() or str(
            RUNTIME_DIR
        )
        self._save_chat_history = self.save_chat_history_cb.isChecked()
        self._debug_mode = self.debug_mode_cb.isChecked()
        self._show_raw_payload = self.show_raw_payload_cb.isChecked()
        self._log_ack_events = self.log_ack_cb.isChecked()
        self._log_assistant_reply_events = self.log_assistant_reply_cb.isChecked()
        self._log_send_failed_events = self.log_send_failed_cb.isChecked()
        self._bind_each_chat_to_page = self.bind_each_chat_cb.isChecked()
        self._auto_open_bound_page_when_missing = (
            self.auto_open_bound_page_cb.isChecked()
        )
        self._allow_fallback_to_any_page = self.allow_fallback_page_cb.isChecked()
    def _save_app_settings(self):
        self._read_settings_from_widgets()
        self._settings.setValue("host", self._host)
        self._settings.setValue("port", self._port_text)
        self._settings.setValue("auto_start_server", self._auto_start_server)
        self._settings.setValue("font_size", self._chat_font_pt)
        self._settings.setValue("remember_window_geometry", self._remember_window_geometry)
        self._settings.setValue("remember_window_position", self._remember_window_position)
        self._settings.setValue("restore_main_tab", self._restore_main_tab)
        self._settings.setValue("restore_chat_tab", self._restore_chat_tab)
        self._settings.setValue("show_page_url", self._show_page_url)
        self._settings.setValue("show_top_status_bar", self._show_top_status_bar)
        self._settings.setValue("enter_send_mode", self._enter_send_mode)
        self._settings.setValue(
            "auto_clear_input_after_send", self._auto_clear_input_after_send
        )
        self._settings.setValue("auto_scroll_to_bottom", self._auto_scroll_to_bottom)
        self._settings.setValue("auto_name_new_chat", self._auto_name_new_chat)
        self._settings.setValue("show_timestamp", self._show_timestamp)
        self._settings.setValue(
            "show_assistant_placeholder", self._show_assistant_placeholder
        )
        self._settings.setValue("chat_sessions_path", self._chat_sessions_path)
        self._settings.setValue("save_chat_history", self._save_chat_history)
        self._settings.setValue("debug_mode", self._debug_mode)
        self._settings.setValue("show_raw_payload", self._show_raw_payload)
        self._settings.setValue("log_ack_events", self._log_ack_events)
        self._settings.setValue(
            "log_assistant_reply_events", self._log_assistant_reply_events
        )
        self._settings.setValue("log_send_failed_events", self._log_send_failed_events)
        self._settings.setValue("bind_each_chat_to_page", self._bind_each_chat_to_page)
        self._settings.setValue(
            "auto_open_bound_page_when_missing",
            self._auto_open_bound_page_when_missing,
        )
        self._settings.setValue(
            "allow_fallback_to_any_page", self._allow_fallback_to_any_page
        )
        self._save_ui_settings()
    def _apply_settings(self, immediate_only=False):
        self._read_settings_from_widgets()
        self.font_size_spin.setValue(self._chat_font_pt)
        if self._chat_status_group is not None:
            self._chat_status_group.setVisible(self._show_top_status_bar)
        if hasattr(self, "tm_live_page_label"):
            for widget in (
                self.tm_live_page_label,
                self.tm_bound_page_label,
                self.open_live_page_btn,
                self.bind_page_btn,
                self.unbind_page_btn,
                self.open_bound_page_btn,
            ):
                widget.setVisible(self._show_page_url)
        session = self._current_session()
        if session:
            self._render_session_chat(session)
        self._update_bound_page_display()
        if self.message_edit.placeholderText():
            self._update_input_placeholder()
        if immediate_only:
            self._set_settings_hint("已应用当前可立即生效的设置。")
            return
        if server.is_server_running():
            self._set_settings_hint(
                "部分设置已应用。host/port 变更需停止服务后重新启动才能生效。"
            )
        else:
            self._set_settings_hint("设置已应用。")
    def _reset_settings_to_default(self):
        for key, value in DEFAULT_APP_SETTINGS.items():
            if key == "font_size":
                self._chat_font_pt = int(value)
            elif key == "port":
                self._port_text = str(value)
            else:
                setattr(self, f"_{key}", value)
        self._sync_settings_widgets_from_values()
        self._apply_settings(immediate_only=True)
        self._save_app_settings()
        self._set_settings_hint("已恢复默认设置。")
    def _sync_settings_widgets_from_values(self):
        self.host_edit.setText(self._host)
        self.port_edit.setText(self._port_text)
        self.auto_start_server_cb.setChecked(self._auto_start_server)
        self.font_size_spin.setValue(self._chat_font_pt)
        self.remember_geometry_cb.setChecked(self._remember_window_geometry)
        self.remember_position_cb.setChecked(self._remember_window_position)
        self.restore_main_tab_cb.setChecked(self._restore_main_tab)
        self.restore_chat_tab_cb.setChecked(self._restore_chat_tab)
        self.show_page_url_cb.setChecked(self._show_page_url)
        self.show_top_status_bar_cb.setChecked(self._show_top_status_bar)
        self.enter_send_mode_combo.setCurrentIndex(
            1 if self._enter_send_mode == "ctrl_enter_send" else 0
        )
        self.auto_clear_input_cb.setChecked(self._auto_clear_input_after_send)
        self.auto_scroll_cb.setChecked(self._auto_scroll_to_bottom)
        self.auto_name_chat_cb.setChecked(self._auto_name_new_chat)
        self.show_timestamp_cb.setChecked(self._show_timestamp)
        self.show_placeholder_cb.setChecked(self._show_assistant_placeholder)
        self.sessions_path_edit.setText(self._chat_sessions_path)
        self.save_chat_history_cb.setChecked(self._save_chat_history)
        self.debug_mode_cb.setChecked(self._debug_mode)
        self.show_raw_payload_cb.setChecked(self._show_raw_payload)
        self.log_ack_cb.setChecked(self._log_ack_events)
        self.log_assistant_reply_cb.setChecked(self._log_assistant_reply_events)
        self.log_send_failed_cb.setChecked(self._log_send_failed_events)
        self.bind_each_chat_cb.setChecked(self._bind_each_chat_to_page)
        self.auto_open_bound_page_cb.setChecked(
            self._auto_open_bound_page_when_missing
        )
        self.allow_fallback_page_cb.setChecked(self._allow_fallback_to_any_page)
        self._update_bind_setting_dependents()
        self._update_input_placeholder()

    def _update_bind_setting_dependents(self, *_args):
        strict_bind = self.bind_each_chat_cb.isChecked()
        self.auto_open_bound_page_cb.setEnabled(strict_bind)
        self.allow_fallback_page_cb.setEnabled(strict_bind)

    def _set_settings_hint(self, text):
        self.settings_hint_label.setText(text or "")
    def _update_input_placeholder(self):
        if self._enter_send_mode == "ctrl_enter_send":
            self.message_edit.setPlaceholderText("输入消息…")
        else:
            self.message_edit.setPlaceholderText("输入消息…")
        self._update_input_hint_label()

    def _update_input_hint_label(self):
        if not hasattr(self, "input_hint_label"):
            return
        if self._enter_send_mode == "ctrl_enter_send":
            self.input_hint_label.setText("Ctrl + Enter 发送，Shift + Enter 换行")
        else:
            self.input_hint_label.setText("Enter 发送，Shift + Enter 换行")
    def _update_tampermonkey_settings_labels(self, status=None):
        status = status or self._last_bridge_status or {}
        host = self._host or self.host_edit.text().strip()
        port = self._port_text or self.port_edit.text().strip()
        self.tm_bridge_url_label.setText(f"油猴接口：http://{host}:{port}/api/bridge")
        global_bound = status.get("bound_client_id") or "-"
        session_bound = self._session_bound_client_id() or "-"
        self.tm_client_id_label.setText(
            f"最近心跳 client_id：{status.get('tampermonkey_client_id') or '-'}\n"
            f"全局绑定 client_id：{global_bound}\n"
            f"本对话绑定 client_id：{session_bound}"
        )
        self.tm_last_seen_settings_label.setText(
            f"最后心跳：{self._format_ts(status.get('tampermonkey_last_seen'))}"
        )
        live = (
            status.get("tampermonkey_page_url")
            if status.get("tampermonkey_online")
            else "-"
        )
        session = self._current_session()
        remote = _normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if remote.get("enabled"):
            bound_parts = [
                remote.get("conversation_url") or "-",
                f"client_id={remote.get('client_id') or '-'}",
                f"type={remote.get('page_type') or '-'}",
                f"conv={remote.get('conversation_id') or '-'}",
            ]
            bound = " | ".join(bound_parts)
        else:
            bound = "未绑定"
        self.tm_page_settings_label.setText(
            f"最近活跃油猴页面：{live}\n本对话绑定页面：{bound}"
        )
        self._render_tampermonkey_clients(status)
    def _update_service_settings_status(self):
        if server.is_server_running():
            host = self.host_edit.text().strip()
            port = self.port_edit.text().strip()
            self.settings_service_status_label.setText(
                f"当前状态：运行中（http://{host}:{port}）"
            )
        else:
            self.settings_service_status_label.setText("当前状态：未启动")
    def _on_check_tampermonkey(self):
        if not server.is_server_running():
            self._set_settings_hint("请先启动服务，再检查油猴连接。")
            return
        status = server.get_bridge_status()
        self._apply_bridge_status(status)
        if status.get("tampermonkey_online"):
            self._set_settings_hint("油猴在线。")
        elif status.get("tampermonkey_last_seen"):
            self._set_settings_hint("油猴离线（曾连接过）。")
        else:
            self._set_settings_hint("油猴未连接。")
    def _restart_server_with_settings(self):
        if server.is_server_running():
            self._stop_server()
        self._start_server()
    def _open_data_directory(self):
        path = Path(self._chat_sessions_path or RUNTIME_DIR)
        try:
            path.mkdir(parents=True, exist_ok=True)
        except Exception as error:
            detail = f"创建数据目录失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._set_settings_hint(f"无法打开数据目录：{error}")
            return
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path.resolve())))
    def _clear_all_sessions(self):
        self._sessions.clear()
        self._tab_session_ids.clear()
        self._message_to_session.clear()
        self._message_to_turn.clear()
        self._finalized_bridge_message_ids.clear()
        self._ack_success_message_ids.clear()
        self._processed_inbound_ids.clear()
        self._create_session(select=True)
        self._save_sessions_to_disk()
        self._set_settings_hint("已清空全部聊天记录。")
        self._add_system_message("已清空全部聊天记录。")
    def _export_sessions_to_file(self, only_current=False):
        if only_current:
            session = self._current_session()
            if not session:
                self._set_settings_hint("没有可导出的当前对话。")
                return
            payload = {"sessions": [self._session_to_dict(session)]}
            default_name = f"{session.title}.json"
        else:
            payload = {
                "sessions": [self._session_to_dict(item) for item in self._sessions.values()]
            }
            default_name = "all_chat_sessions.json"
        path, _ = QFileDialog.getSaveFileName(
            self, "导出对话", default_name, "JSON 文件 (*.json)"
        )
        if not path:
            return
        try:
            Path(path).write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            self._set_settings_hint(f"已导出到：{path}")
            self._append_log(f"对话已导出：{path}")
        except Exception as error:
            detail = f"导出失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._set_settings_hint(f"导出失败：{error}")
    def _clear_log_widget(self, widget, name):
        widget.clear()
        self._append_log(f"已清空{name}。")
        self._set_settings_hint(f"已清空{name}。")
    def _restore_default_layout(self):
        self.resize(1080, 780)
        self._set_settings_hint("已恢复默认窗口大小。")
    # ------------------------------------------------------------------ UI
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)
        self.main_tabs = QTabWidget()
        self.chat_page = self._build_chat_page()
        self.log_page = self._build_log_page()
        self.settings_page = self._build_settings_page()
        self.main_tabs.addTab(self.chat_page, "聊天")
        self.main_tabs.addTab(self.log_page, "日志")
        self.main_tabs.addTab(self.settings_page, "设置")
        root.addWidget(self.main_tabs, stretch=1)
        self.statusBar().showMessage("未启动服务")
        self._apply_app_style()

    def _apply_app_style(self):
        self.setStyleSheet(
            """
            QMainWindow {
                background: #f0f2f5;
            }
            QTabWidget::pane {
                border: 1px solid #e0e3e8;
                border-radius: 8px;
                background: #ffffff;
                top: -1px;
            }
            QTabBar::tab {
                background: #e8eaed;
                color: #444;
                padding: 8px 18px;
                margin-right: 2px;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                min-height: 20px;
            }
            QTabBar::tab:selected {
                background: #ffffff;
                color: #111;
                font-weight: 600;
            }
            QTabBar::tab:hover:!selected {
                background: #dfe3e8;
            }
            QPushButton {
                background: #ffffff;
                color: #333;
                border: 1px solid #d0d5dd;
                border-radius: 6px;
                padding: 5px 12px;
                min-height: 22px;
            }
            QPushButton:hover {
                background: #f5f6f8;
            }
            QPushButton:pressed {
                background: #ebedf0;
            }
            QPushButton:disabled {
                color: #aaa;
                background: #f5f5f5;
            }
            QPushButton#PrimaryButton {
                background: #2563eb;
                color: #ffffff;
                border: 1px solid #1d4ed8;
                font-weight: 600;
            }
            QPushButton#PrimaryButton:hover {
                background: #1d4ed8;
            }
            QPushButton#PrimaryButton:pressed {
                background: #1e40af;
            }
            QPushButton#PrimaryButton:disabled {
                background: #93b4f5;
                border-color: #93b4f5;
                color: #eef2ff;
            }
            QPushButton#GhostButton {
                background: transparent;
                border: 1px solid #d8dce3;
                color: #555;
                padding: 4px 10px;
            }
            QPushButton#GhostButton:hover {
                background: #f3f4f6;
            }
            QPushButton#DangerGhostButton {
                background: transparent;
                border: 1px solid #f0c4c4;
                color: #b42318;
                padding: 4px 10px;
            }
            QPushButton#DangerGhostButton:hover {
                background: #fef3f2;
            }
            QPushButton#NewSessionButton {
                background: #ffffff;
                border: 1px solid #d5d9e0;
                border-radius: 8px;
                font-weight: 600;
                padding: 8px 12px;
            }
            QPushButton#NewSessionButton:hover {
                background: #f3f4f6;
            }
            QPushButton#CompactButton {
                padding: 3px 10px;
                min-height: 20px;
                font-size: 12px;
            }
            QLabel#StatusChip {
                background: #eef0f3;
                border: 1px solid #e2e5ea;
                border-radius: 8px;
                padding: 4px 10px;
                color: #444;
                font-size: 12px;
            }
            QLabel#StatusChip[state="ok"] {
                background: #e8f5e9;
                border-color: #c8e6c9;
                color: #1b5e20;
            }
            QLabel#StatusChip[state="warn"] {
                background: #fff8e1;
                border-color: #ffe082;
                color: #8d6e00;
            }
            QWidget#ChatStatusBar {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
            }
            QWidget#ChatPanel {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QWidget#SessionSidebar {
                background: #f3f4f6;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QLabel#CurrentSessionTitle {
                color: #111827;
                font-size: 15px;
                font-weight: 600;
                padding: 2px 4px 8px 4px;
            }
            QListWidget#SessionList {
                background: transparent;
                border: none;
                outline: none;
                padding: 4px;
            }
            QListWidget#SessionList::item {
                border-radius: 8px;
                padding: 10px 12px;
                margin: 2px 0;
                color: #374151;
            }
            QListWidget#SessionList::item:hover {
                background: #e8eaed;
            }
            QListWidget#SessionList::item:selected {
                background: #ffffff;
                color: #111827;
                border: 1px solid #d8dce3;
            }
            QLineEdit#SessionSearchInput {
                background: #ffffff;
                border: 1px solid #d8dce3;
                border-radius: 8px;
                padding: 6px 10px;
            }
            QScrollArea#ChatScrollArea {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QWidget#ChatViewport {
                background: #f7f8fa;
            }
            QLabel#EmptyTitle {
                color: #6b7280;
                font-size: 16px;
                font-weight: 600;
            }
            QLabel#EmptySubtitle {
                color: #9ca3af;
                font-size: 13px;
            }
            QFrame#SystemBubble {
                background: #eef0f3;
                border: none;
                border-radius: 8px;
            }
            QLabel#SystemBubbleBody {
                color: #666;
                font-size: 12px;
                background: transparent;
            }
            QFrame#ChatBubble[bubbleRole="user"] {
                background: #dcf8c6;
                border: 1px solid #c5e8b0;
                border-radius: 12px;
            }
            QFrame#ChatBubble[bubbleRole="assistant"] {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
            }
            QFrame#ChatBubble[bubbleRole="error"] {
                background: #fef2f2;
                border: 1px solid #fecaca;
                border-radius: 10px;
            }
            QLabel#BubbleHeader {
                color: #555;
            }
            QFrame#ChatBubble[bubbleRole="user"] QLabel#BubbleHeader {
                color: #3b6b35;
            }
            QFrame#ChatBubble[bubbleRole="error"] QLabel#BubbleBody {
                color: #7f1d1d;
            }
            QLabel#BubbleBody {
                color: #111;
            }
            QWidget#ChatInputBlock {
                background: transparent;
            }
            QTextEdit#MessageInput {
                background: #ffffff;
                border: 1px solid #d5d9e0;
                border-radius: 10px;
                padding: 10px 12px;
                color: #111;
            }
            QTextEdit#MessageInput:focus {
                border: 1px solid #2563eb;
            }
            QLabel#InputHint {
                color: #9ca3af;
                font-size: 12px;
            }
            """
        )

    def _build_chat_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)
        tool_row = QHBoxLayout()
        tool_row.setSpacing(8)
        self.open_chatgpt_btn = QPushButton("打开 ChatGPT")
        self.open_new_chat_btn = QPushButton("打开新对话")
        self.chat_open_bound_btn = QPushButton("打开绑定页面")
        self.refresh_pages_btn = QPushButton("刷新页面")
        self.close_bound_page_btn = QPushButton("关闭绑定页面")
        self.close_other_pages_btn = QPushButton("关闭其他页面")
        self.view_logs_btn = QPushButton("日志")
        for btn in (
            self.open_chatgpt_btn,
            self.open_new_chat_btn,
            self.chat_open_bound_btn,
            self.refresh_pages_btn,
            self.view_logs_btn,
        ):
            btn.setObjectName("GhostButton")
        self.close_bound_page_btn.setObjectName("DangerGhostButton")
        self.close_other_pages_btn.setObjectName("DangerGhostButton")
        self.open_chatgpt_btn.setToolTip("打开 ChatGPT 首页")
        self.open_new_chat_btn.setToolTip("打开新的 ChatGPT 页面")
        self.chat_open_bound_btn.setToolTip("打开当前对话绑定的 ChatGPT 页面")
        self.refresh_pages_btn.setToolTip("刷新油猴页面列表和连接状态")
        self.close_bound_page_btn.setToolTip("关闭当前对话绑定的 ChatGPT 页面")
        self.close_other_pages_btn.setToolTip(
            "关闭除当前绑定页面以外的其他 ChatGPT 页面"
        )
        self.view_logs_btn.setToolTip("切换到日志页")
        self.open_chatgpt_btn.clicked.connect(self._on_open_chatgpt_home)
        self.open_new_chat_btn.clicked.connect(self._on_open_new_chatgpt_tab)
        self.chat_open_bound_btn.clicked.connect(self._on_open_bound_chatgpt_page)
        self.refresh_pages_btn.clicked.connect(self._on_refresh_tm_pages)
        self.close_bound_page_btn.clicked.connect(self._on_close_bound_tm_page)
        self.close_other_pages_btn.clicked.connect(self._on_close_other_tm_pages)
        self.view_logs_btn.clicked.connect(self._show_log_tab)
        tool_row.addWidget(self.open_chatgpt_btn)
        tool_row.addWidget(self.open_new_chat_btn)
        tool_row.addWidget(self.chat_open_bound_btn)
        tool_row.addSpacing(12)
        tool_row.addWidget(self.refresh_pages_btn)
        tool_row.addWidget(self.close_bound_page_btn)
        tool_row.addWidget(self.close_other_pages_btn)
        tool_row.addStretch()
        tool_row.addWidget(self.view_logs_btn)
        layout.addLayout(tool_row)
        self._chat_status_group = self._build_chat_status_bar()
        layout.addWidget(self._chat_status_group)
        self._chat_panel = self._build_chat_panel()
        layout.addWidget(self._chat_panel, stretch=1)
        return page
    def _build_log_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        self.log_tabs = QTabWidget()
        layout.addWidget(self.log_tabs)
        self.log_edit = QTextEdit()
        self.log_edit.setReadOnly(True)
        self.log_edit.setFont(QFont("Consolas", 9))
        self.log_tabs.addTab(self.log_edit, "运行日志")
        self.event_log_edit = QTextEdit()
        self.event_log_edit.setReadOnly(True)
        self.event_log_edit.setFont(QFont("Consolas", 9))
        self.log_tabs.addTab(self.event_log_edit, "油猴事件")
        self.outbound_table = QTableWidget(0, 4)
        self.outbound_table.setHorizontalHeaderLabels(["时间", "ID", "状态", "内容"])
        self.outbound_table.horizontalHeader().setStretchLastSection(True)
        self.outbound_table.setColumnWidth(0, 80)
        self.outbound_table.setColumnWidth(1, 110)
        self.outbound_table.setColumnWidth(2, 100)
        self.outbound_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.outbound_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.outbound_table.verticalHeader().setVisible(False)
        self.log_tabs.addTab(self.outbound_table, "发出消息")
        self.status_log_edit = QTextEdit()
        self.status_log_edit.setReadOnly(True)
        self.status_log_edit.setFont(QFont("Consolas", 9))
        self.log_tabs.addTab(self.status_log_edit, "服务状态")
        return page
    def _build_settings_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)
        self.settings_tabs = QTabWidget()
        layout.addWidget(self.settings_tabs, stretch=1)
        # --- 服务设置
        service_page = QWidget()
        service_form = QFormLayout(service_page)
        self.host_edit = QLineEdit(self._host)
        self.port_edit = QLineEdit(self._port_text)
        self.port_edit.setFixedWidth(80)
        service_form.addRow("地址 host", self.host_edit)
        service_form.addRow("端口 port", self.port_edit)
        self.auto_start_server_cb = QCheckBox("启动 GUI 时自动启动服务")
        self.auto_start_server_cb.setChecked(self._auto_start_server)
        service_form.addRow("", self.auto_start_server_cb)
        service_btn_row = QHBoxLayout()
        self.settings_start_btn = QPushButton("启动服务")
        self.settings_stop_btn = QPushButton("停止服务")
        self.settings_restart_btn = QPushButton("重启服务并应用")
        self.settings_start_btn.clicked.connect(self._start_server)
        self.settings_stop_btn.clicked.connect(self._stop_server)
        self.settings_restart_btn.clicked.connect(self._restart_server_with_settings)
        service_btn_row.addWidget(self.settings_start_btn)
        service_btn_row.addWidget(self.settings_stop_btn)
        service_btn_row.addWidget(self.settings_restart_btn)
        service_btn_row.addStretch()
        service_form.addRow("操作", service_btn_row)
        self.settings_service_status_label = QLabel("当前状态：未启动")
        self.settings_service_status_label.setWordWrap(True)
        service_form.addRow("状态", self.settings_service_status_label)
        self.settings_tabs.addTab(service_page, "服务设置")
        # --- 油猴设置
        tm_page = QWidget()
        tm_form = QFormLayout(tm_page)
        self.tm_bridge_url_label = QLabel("-")
        self.tm_bridge_url_label.setWordWrap(True)
        self.tm_client_id_label = QLabel("-")
        self.tm_last_seen_settings_label = QLabel("-")
        self.tm_page_settings_label = QLabel("-")
        self.tm_page_settings_label.setWordWrap(True)
        tm_form.addRow("接口地址", self.tm_bridge_url_label)
        tm_form.addRow("client_id", self.tm_client_id_label)
        tm_form.addRow("最后心跳", self.tm_last_seen_settings_label)
        tm_form.addRow("页面 URL", self.tm_page_settings_label)
        tm_btn_row = QHBoxLayout()
        self.check_tm_btn = QPushButton("检查油猴连接")
        self.settings_open_page_btn = QPushButton("打开 ChatGPT")
        self.settings_open_page_btn.setToolTip(
            "在系统默认浏览器中打开 ChatGPT 首页（不依赖油猴队列）"
        )
        self.settings_open_new_btn = QPushButton("打开新对话")
        self.settings_open_new_btn.setToolTip(
            "优先通过油猴在新标签页打开；失败时改用系统浏览器"
        )
        self.settings_open_bound_btn = QPushButton("打开绑定页面")
        self.settings_open_bound_btn.setToolTip(
            "打开当前对话已关联/绑定的 ChatGPT 页面"
        )
        self.settings_bind_current_btn = QPushButton("绑定当前页面")
        self.settings_unbind_btn = QPushButton("解除绑定")
        self.settings_bind_selected_btn = QPushButton("绑定选中页面")
        self.check_tm_btn.clicked.connect(self._on_check_tampermonkey)
        self.settings_open_page_btn.clicked.connect(self._on_open_chatgpt_home)
        self.settings_open_new_btn.clicked.connect(self._on_open_new_chatgpt_tab)
        self.settings_open_bound_btn.clicked.connect(self._on_open_bound_chatgpt_page)
        self.settings_bind_current_btn.clicked.connect(self._on_bind_current_page)
        self.settings_unbind_btn.clicked.connect(self._on_unbind_current_page)
        self.settings_bind_selected_btn.clicked.connect(self._on_bind_selected_tm_page)
        tm_btn_row.addWidget(self.check_tm_btn)
        tm_btn_row.addWidget(self.settings_open_page_btn)
        tm_btn_row.addWidget(self.settings_open_new_btn)
        tm_btn_row.addWidget(self.settings_open_bound_btn)
        tm_btn_row.addStretch()
        tm_form.addRow("", tm_btn_row)
        tm_bind_row = QHBoxLayout()
        tm_bind_row.addWidget(self.settings_bind_current_btn)
        tm_bind_row.addWidget(self.settings_unbind_btn)
        tm_bind_row.addWidget(self.settings_bind_selected_btn)
        tm_bind_row.addStretch()
        tm_form.addRow("页面绑定", tm_bind_row)
        self.tm_pages_table = QTableWidget(0, 10)
        self.tm_pages_table.setHorizontalHeaderLabels(
            [
                "状态",
                "client_id",
                "page_instance_id",
                "页面类型",
                "会话ID",
                "可见",
                "焦点",
                "最后心跳",
                "URL",
                "本对话绑定",
            ]
        )
        self.tm_pages_table.horizontalHeader().setStretchLastSection(True)
        self.tm_pages_table.setColumnWidth(0, 40)
        self.tm_pages_table.setColumnWidth(1, 100)
        self.tm_pages_table.setColumnWidth(2, 120)
        self.tm_pages_table.setColumnWidth(3, 72)
        self.tm_pages_table.setColumnWidth(4, 100)
        self.tm_pages_table.setColumnWidth(5, 40)
        self.tm_pages_table.setColumnWidth(6, 40)
        self.tm_pages_table.setColumnWidth(7, 72)
        self.tm_pages_table.setColumnWidth(8, 200)
        self.tm_pages_table.setColumnWidth(9, 72)
        self.tm_pages_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.tm_pages_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.tm_pages_table.verticalHeader().setVisible(False)
        tm_form.addRow("ChatGPT 页面", self.tm_pages_table)
        tm_pages_btn_row = QHBoxLayout()
        self.tm_refresh_pages_btn = QPushButton("刷新页面列表")
        self.tm_close_selected_btn = QPushButton("关闭选中页面")
        self.tm_close_others_btn = QPushButton("关闭其他 ChatGPT 页面")
        self.tm_close_bound_btn = QPushButton("关闭当前绑定页面")
        self.tm_refresh_pages_btn.clicked.connect(self._on_refresh_tm_pages)
        self.tm_close_selected_btn.clicked.connect(self._on_close_selected_tm_page)
        self.tm_close_others_btn.clicked.connect(self._on_close_other_tm_pages)
        self.tm_close_bound_btn.clicked.connect(self._on_close_bound_tm_page)
        tm_pages_btn_row.addWidget(self.tm_refresh_pages_btn)
        tm_pages_btn_row.addWidget(self.tm_close_selected_btn)
        tm_pages_btn_row.addWidget(self.tm_close_others_btn)
        tm_pages_btn_row.addWidget(self.tm_close_bound_btn)
        tm_pages_btn_row.addStretch()
        tm_form.addRow("", tm_pages_btn_row)
        self.settings_tabs.addTab(tm_page, "油猴设置")
        # --- 界面设置
        ui_page = QWidget()
        ui_form = QFormLayout(ui_page)
        self.font_size_spin = QSpinBox()
        self.font_size_spin.setRange(11, 20)
        self.font_size_spin.setValue(self._chat_font_pt)
        ui_form.addRow("聊天字号", self.font_size_spin)
        self.remember_geometry_cb = QCheckBox("记住窗口大小")
        self.remember_position_cb = QCheckBox("记住窗口位置")
        self.restore_main_tab_cb = QCheckBox("恢复上次一级选项卡")
        self.restore_chat_tab_cb = QCheckBox("恢复上次选中的对话")
        self.show_page_url_cb = QCheckBox("在聊天页显示页面 URL")
        self.show_top_status_bar_cb = QCheckBox("显示聊天页顶部状态栏")
        ui_form.addRow("", self.remember_geometry_cb)
        ui_form.addRow("", self.remember_position_cb)
        ui_form.addRow("", self.restore_main_tab_cb)
        ui_form.addRow("", self.restore_chat_tab_cb)
        ui_form.addRow("", self.show_page_url_cb)
        ui_form.addRow("", self.show_top_status_bar_cb)
        self.restore_layout_btn = QPushButton("恢复默认窗口大小")
        self.restore_layout_btn.clicked.connect(self._restore_default_layout)
        ui_form.addRow("", self.restore_layout_btn)
        self.settings_tabs.addTab(ui_page, "界面设置")
        # --- 聊天设置
        chat_set_page = QWidget()
        chat_set_form = QFormLayout(chat_set_page)
        self.enter_send_mode_combo = QComboBox()
        self.enter_send_mode_combo.addItems(
            ["Enter 发送，Shift+Enter 换行", "Ctrl+Enter 发送，Enter 换行"]
        )
        chat_set_form.addRow("发送快捷键", self.enter_send_mode_combo)
        self.auto_clear_input_cb = QCheckBox("发送后清空输入框")
        self.auto_scroll_cb = QCheckBox("自动滚动到底部")
        self.auto_name_chat_cb = QCheckBox("首条消息自动命名新对话")
        self.show_timestamp_cb = QCheckBox("显示消息时间戳")
        self.show_placeholder_cb = QCheckBox("显示“等待回复…”占位")
        chat_set_form.addRow("", self.auto_clear_input_cb)
        chat_set_form.addRow("", self.auto_scroll_cb)
        chat_set_form.addRow("", self.auto_name_chat_cb)
        chat_set_form.addRow("", self.show_timestamp_cb)
        chat_set_form.addRow("", self.show_placeholder_cb)
        self.bind_each_chat_cb = QCheckBox(
            "启用每个对话绑定独立 ChatGPT 页面"
        )
        self.auto_open_bound_page_cb = QCheckBox(
            "绑定页面未打开时自动打开"
        )
        self.allow_fallback_page_cb = QCheckBox(
            "绑定页面未打开时允许退回任意在线页面发送"
        )
        chat_set_form.addRow("", self.bind_each_chat_cb)
        chat_set_form.addRow("", self.auto_open_bound_page_cb)
        chat_set_form.addRow("", self.allow_fallback_page_cb)
        self.bind_each_chat_cb.stateChanged.connect(
            self._update_bind_setting_dependents
        )
        self.settings_tabs.addTab(chat_set_page, "聊天设置")
        # --- 数据设置
        data_page = QWidget()
        data_form = QFormLayout(data_page)
        path_row = QHBoxLayout()
        self.sessions_path_edit = QLineEdit(self._chat_sessions_path)
        self.browse_path_btn = QPushButton("浏览…")
        self.browse_path_btn.clicked.connect(self._browse_sessions_path)
        path_row.addWidget(self.sessions_path_edit)
        path_row.addWidget(self.browse_path_btn)
        data_form.addRow("数据目录", path_row)
        self.save_chat_history_cb = QCheckBox("自动保存聊天记录")
        data_form.addRow("", self.save_chat_history_cb)
        data_btn_row = QHBoxLayout()
        self.clear_all_sessions_btn = QPushButton("清空全部对话")
        self.export_current_btn = QPushButton("导出当前对话")
        self.export_all_btn = QPushButton("导出全部对话")
        self.open_data_dir_btn = QPushButton("打开数据目录")
        self.clear_all_sessions_btn.clicked.connect(self._clear_all_sessions)
        self.export_current_btn.clicked.connect(
            lambda: self._export_sessions_to_file(only_current=True)
        )
        self.export_all_btn.clicked.connect(
            lambda: self._export_sessions_to_file(only_current=False)
        )
        self.open_data_dir_btn.clicked.connect(self._open_data_directory)
        data_btn_row.addWidget(self.clear_all_sessions_btn)
        data_btn_row.addWidget(self.export_current_btn)
        data_btn_row.addWidget(self.export_all_btn)
        data_btn_row.addWidget(self.open_data_dir_btn)
        data_form.addRow("", data_btn_row)
        self.settings_tabs.addTab(data_page, "数据设置")
        # --- 调试设置
        debug_page = QWidget()
        debug_form = QFormLayout(debug_page)
        self.debug_mode_cb = QCheckBox("调试模式（油猴事件显示更完整）")
        self.show_raw_payload_cb = QCheckBox("油猴事件中显示完整 payload")
        self.log_ack_cb = QCheckBox("记录 ack 事件")
        self.log_assistant_reply_cb = QCheckBox("记录 assistant_reply 事件")
        self.log_send_failed_cb = QCheckBox("记录 send_failed 事件")
        debug_form.addRow("", self.debug_mode_cb)
        debug_form.addRow("", self.show_raw_payload_cb)
        debug_form.addRow("", self.log_ack_cb)
        debug_form.addRow("", self.log_assistant_reply_cb)
        debug_form.addRow("", self.log_send_failed_cb)
        debug_btn_row = QHBoxLayout()
        self.clear_runtime_log_btn = QPushButton("清空运行日志")
        self.clear_event_log_btn = QPushButton("清空油猴事件")
        self.clear_runtime_log_btn.clicked.connect(
            lambda: self._clear_log_widget(self.log_edit, "运行日志")
        )
        self.clear_event_log_btn.clicked.connect(
            lambda: self._clear_log_widget(self.event_log_edit, "油猴事件")
        )
        debug_btn_row.addWidget(self.clear_runtime_log_btn)
        debug_btn_row.addWidget(self.clear_event_log_btn)
        debug_form.addRow("", debug_btn_row)
        self.settings_tabs.addTab(debug_page, "调试设置")
        self._sync_settings_widgets_from_values()
        bottom_row = QHBoxLayout()
        self.apply_settings_btn = QPushButton("应用设置")
        self.save_settings_btn = QPushButton("保存设置")
        self.reset_settings_btn = QPushButton("恢复默认设置")
        self.apply_settings_btn.clicked.connect(
            lambda: self._apply_settings(immediate_only=True)
        )
        self.save_settings_btn.clicked.connect(self._on_save_settings_clicked)
        self.reset_settings_btn.clicked.connect(self._reset_settings_to_default)
        bottom_row.addWidget(self.apply_settings_btn)
        bottom_row.addWidget(self.save_settings_btn)
        bottom_row.addWidget(self.reset_settings_btn)
        bottom_row.addStretch()
        layout.addLayout(bottom_row)
        self.settings_hint_label = QLabel("")
        self.settings_hint_label.setWordWrap(True)
        self.settings_hint_label.setStyleSheet("color: #555;")
        layout.addWidget(self.settings_hint_label)
        return page
    def _browse_sessions_path(self):
        path = QFileDialog.getExistingDirectory(
            self, "选择聊天记录目录", self.sessions_path_edit.text()
        )
        if path:
            self.sessions_path_edit.setText(path)
    def _on_save_settings_clicked(self):
        self._save_app_settings()
        self._apply_settings(immediate_only=False)
        self._set_settings_hint("设置已保存。")
    def _show_log_tab(self):
        index = self.main_tabs.indexOf(self.log_page)
        if index >= 0:
            self.main_tabs.setCurrentIndex(index)
    def _build_chat_status_bar(self):
        bar = QWidget()
        bar.setObjectName("ChatStatusBar")
        outer = QVBoxLayout(bar)
        outer.setContentsMargins(10, 6, 10, 6)
        outer.setSpacing(4)
        top_row = QHBoxLayout()
        top_row.setSpacing(8)
        self.status_label = QLabel("服务：未启动")
        self.status_label.setObjectName("StatusChip")
        top_row.addWidget(self.status_label)
        self.tm_online_label = QLabel("油猴：未连接")
        self.tm_online_label.setObjectName("StatusChip")
        top_row.addWidget(self.tm_online_label)
        self.tm_queue_label = QLabel("队列：0")
        self.tm_queue_label.setObjectName("StatusChip")
        top_row.addWidget(self.tm_queue_label)
        top_row.addStretch()
        self.chat_quick_start_btn = QPushButton("启动")
        self.chat_quick_start_btn.setObjectName("CompactButton")
        self.chat_quick_start_btn.setFixedWidth(48)
        self.chat_quick_start_btn.clicked.connect(self._start_server)
        top_row.addWidget(self.chat_quick_start_btn)
        self.chat_quick_stop_btn = QPushButton("停止")
        self.chat_quick_stop_btn.setObjectName("CompactButton")
        self.chat_quick_stop_btn.setFixedWidth(48)
        self.chat_quick_stop_btn.clicked.connect(self._stop_server)
        self.chat_quick_stop_btn.setEnabled(False)
        top_row.addWidget(self.chat_quick_stop_btn)
        outer.addLayout(top_row)
        live_row = QHBoxLayout()
        live_row.setSpacing(6)
        self.tm_live_page_label = QLabel("当前油猴页面：-")
        self.tm_live_page_label.setObjectName("StatusChip")
        self.tm_live_page_label.setTextFormat(Qt.RichText)
        self.tm_live_page_label.setTextInteractionFlags(Qt.TextBrowserInteraction)
        self.tm_live_page_label.setOpenExternalLinks(False)
        self.tm_live_page_label.linkActivated.connect(self._open_tampermonkey_page)
        live_row.addWidget(self.tm_live_page_label, stretch=1)
        self.open_live_page_btn = QPushButton("打开")
        self.open_live_page_btn.setObjectName("CompactButton")
        self.open_live_page_btn.setFixedWidth(48)
        self.open_live_page_btn.setEnabled(False)
        self.open_live_page_btn.clicked.connect(lambda: self._open_tampermonkey_page())
        live_row.addWidget(self.open_live_page_btn)
        outer.addLayout(live_row)
        bound_row = QHBoxLayout()
        bound_row.setSpacing(6)
        self.tm_bound_page_label = QLabel("绑定页面：未绑定")
        self.tm_bound_page_label.setObjectName("StatusChip")
        self.tm_bound_page_label.setTextFormat(Qt.RichText)
        self.tm_bound_page_label.setTextInteractionFlags(Qt.TextBrowserInteraction)
        self.tm_bound_page_label.setOpenExternalLinks(False)
        self.tm_bound_page_label.linkActivated.connect(self._on_open_bound_chatgpt_page)
        bound_row.addWidget(self.tm_bound_page_label, stretch=1)
        self.bind_page_btn = QPushButton("绑定当前")
        self.bind_page_btn.setObjectName("CompactButton")
        self.bind_page_btn.setFixedWidth(72)
        self.bind_page_btn.clicked.connect(self._on_bind_current_page)
        bound_row.addWidget(self.bind_page_btn)
        self.unbind_page_btn = QPushButton("解除")
        self.unbind_page_btn.setObjectName("CompactButton")
        self.unbind_page_btn.setFixedWidth(48)
        self.unbind_page_btn.clicked.connect(self._on_unbind_current_page)
        bound_row.addWidget(self.unbind_page_btn)
        self.open_bound_page_btn = QPushButton("打开绑定")
        self.open_bound_page_btn.setObjectName("CompactButton")
        self.open_bound_page_btn.setFixedWidth(72)
        self.open_bound_page_btn.setEnabled(False)
        self.open_bound_page_btn.clicked.connect(self._on_open_bound_chatgpt_page)
        bound_row.addWidget(self.open_bound_page_btn)
        outer.addLayout(bound_row)
        bar.setVisible(self._show_top_status_bar)
        for widget in (
            self.tm_live_page_label,
            self.tm_bound_page_label,
            self.open_live_page_btn,
            self.bind_page_btn,
            self.unbind_page_btn,
            self.open_bound_page_btn,
        ):
            widget.setVisible(self._show_page_url)
        return bar

    def _build_chat_panel(self):
        panel = QWidget()
        panel.setObjectName("ChatPanel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(12, 10, 12, 12)
        layout.setSpacing(10)
        splitter = QSplitter(Qt.Horizontal)
        splitter.setObjectName("ChatSplitter")
        sidebar = QWidget()
        sidebar.setObjectName("SessionSidebar")
        sidebar.setMinimumWidth(220)
        sidebar.setMaximumWidth(280)
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(10, 10, 10, 10)
        sidebar_layout.setSpacing(8)
        self.new_session_btn = QPushButton("新建对话")
        self.new_session_btn.setObjectName("NewSessionButton")
        self.new_session_btn.clicked.connect(lambda: self._create_session(select=True))
        sidebar_layout.addWidget(self.new_session_btn)
        self.session_search_edit = QLineEdit()
        self.session_search_edit.setObjectName("SessionSearchInput")
        self.session_search_edit.setPlaceholderText("搜索对话…")
        self.session_search_edit.textChanged.connect(self._on_session_search_changed)
        sidebar_layout.addWidget(self.session_search_edit)
        self.session_list = QListWidget()
        self.session_list.setObjectName("SessionList")
        self.session_list.setSpacing(2)
        self.session_list.setDragDropMode(QAbstractItemView.InternalMove)
        self.session_list.setDefaultDropAction(Qt.MoveAction)
        self.session_list.setContextMenuPolicy(Qt.CustomContextMenu)
        self.session_list.customContextMenuRequested.connect(
            self._on_session_list_context_menu
        )
        self.session_list.currentItemChanged.connect(self._on_session_list_changed)
        self.session_list.model().rowsMoved.connect(self._on_session_list_reordered)
        sidebar_layout.addWidget(self.session_list, stretch=1)
        sidebar_btn_row = QHBoxLayout()
        sidebar_btn_row.setSpacing(6)
        self.delete_session_btn = QPushButton("删除对话")
        self.delete_session_btn.setObjectName("DangerGhostButton")
        self.delete_session_btn.clicked.connect(self._delete_current_session)
        sidebar_btn_row.addWidget(self.delete_session_btn)
        self.rename_session_btn = QPushButton("重命名")
        self.rename_session_btn.setObjectName("GhostButton")
        self.rename_session_btn.clicked.connect(self._rename_current_session)
        sidebar_btn_row.addWidget(self.rename_session_btn)
        sidebar_layout.addLayout(sidebar_btn_row)
        chat_area = QWidget()
        chat_area.setObjectName("ChatMainArea")
        chat_layout = QVBoxLayout(chat_area)
        chat_layout.setContentsMargins(0, 0, 0, 0)
        chat_layout.setSpacing(10)
        self.current_session_title = QLabel("新对话")
        self.current_session_title.setObjectName("CurrentSessionTitle")
        chat_layout.addWidget(self.current_session_title)
        self.chat_scroll = QScrollArea()
        self.chat_scroll.setObjectName("ChatScrollArea")
        self.chat_scroll.setWidgetResizable(True)
        self.chat_scroll.setFrameShape(QFrame.NoFrame)
        self.chat_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.chat_container = QWidget()
        self.chat_container.setObjectName("ChatViewport")
        self.chat_list_layout = QVBoxLayout(self.chat_container)
        self.chat_list_layout.setContentsMargins(20, 18, 20, 18)
        self.chat_list_layout.setSpacing(11)
        self.empty_state_widget = QWidget()
        self.empty_state_widget.setObjectName("ChatEmptyState")
        empty_layout = QVBoxLayout(self.empty_state_widget)
        empty_layout.setContentsMargins(0, 40, 0, 40)
        empty_layout.addStretch()
        self.empty_title_label = QLabel("还没有消息")
        self.empty_title_label.setObjectName("EmptyTitle")
        self.empty_title_label.setAlignment(Qt.AlignCenter)
        empty_layout.addWidget(self.empty_title_label)
        self.empty_subtitle_label = QLabel("启动服务并输入内容后开始对话")
        self.empty_subtitle_label.setObjectName("EmptySubtitle")
        self.empty_subtitle_label.setAlignment(Qt.AlignCenter)
        empty_layout.addWidget(self.empty_subtitle_label)
        empty_layout.addStretch()
        self.chat_list_layout.addWidget(self.empty_state_widget)
        self.chat_bottom_spacer = QWidget()
        self.chat_bottom_spacer.setFixedHeight(1)
        self.chat_list_layout.addWidget(self.chat_bottom_spacer)
        self.chat_scroll.setWidget(self.chat_container)
        chat_layout.addWidget(self.chat_scroll, stretch=1)
        input_block = QWidget()
        input_block.setObjectName("ChatInputBlock")
        input_layout = QVBoxLayout(input_block)
        input_layout.setContentsMargins(0, 4, 0, 0)
        input_layout.setSpacing(6)
        compose_row = QHBoxLayout()
        compose_row.setSpacing(8)
        self.message_edit = ChatInput(self)
        self.message_edit.setObjectName("MessageInput")
        self._update_input_placeholder()
        self.message_edit.setFixedHeight(96)
        self.message_edit.setFont(QFont("Microsoft YaHei UI", 10))
        self.message_edit.send_requested.connect(self._push_message)
        compose_row.addWidget(self.message_edit, stretch=1)
        self.send_btn = QPushButton("发送")
        self.send_btn.setObjectName("PrimaryButton")
        self.send_btn.setFixedSize(90, 96)
        self.send_btn.clicked.connect(self._push_message)
        compose_row.addWidget(self.send_btn)
        input_layout.addLayout(compose_row)
        tools_row = QHBoxLayout()
        tools_row.setSpacing(8)
        self.input_hint_label = QLabel()
        self.input_hint_label.setObjectName("InputHint")
        self._update_input_hint_label()
        tools_row.addWidget(self.input_hint_label)
        tools_row.addStretch()
        self.clear_session_btn = QPushButton("清空当前对话")
        self.clear_session_btn.setObjectName("DangerGhostButton")
        self.clear_session_btn.clicked.connect(self._clear_current_session)
        tools_row.addWidget(self.clear_session_btn)
        self.copy_last_btn = QPushButton("复制最后回复")
        self.copy_last_btn.setObjectName("GhostButton")
        self.copy_last_btn.clicked.connect(self._copy_last_reply)
        tools_row.addWidget(self.copy_last_btn)
        input_layout.addLayout(tools_row)
        chat_layout.addWidget(input_block)
        splitter.addWidget(sidebar)
        splitter.addWidget(chat_area)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([250, 730])
        layout.addWidget(splitter, stretch=1)
        return panel
    # -------------------------------------------------------------- sessions
    def _create_session(self, title="新对话", select=False):
        now = time.time()
        session = ChatSession(
            session_id=str(uuid.uuid4()),
            title=title,
            created_at=now,
            updated_at=now,
            messages=[],
        )
        self._sessions[session.session_id] = session
        if session.session_id not in self._tab_session_ids:
            self._tab_session_ids.append(session.session_id)
        if select:
            self._select_session(session.session_id)
        else:
            self._refresh_session_list()
        self._save_sessions_to_disk()
        return session
    def _current_session(self):
        if not self._current_session_id:
            return None
        return self._sessions.get(self._current_session_id)
    def _ensure_current_session(self):
        session = self._current_session()
        if session:
            return session
        return self._create_session(select=True)
    def _select_session(self, session_id, save=True):
        if session_id not in self._sessions:
            return
        self._current_session_id = session_id
        session = self._sessions[session_id]
        session.has_pending_reply = False
        self._render_session_chat(session)
        self._refresh_session_list(select_session_id=session_id)
        self._update_current_session_title(session)
        self._update_bound_page_display()
        if save:
            self._save_sessions_to_disk()
    def _session_display_title(self, session):
        title = session.title or "新对话"
        if session.has_pending_reply:
            return f"{title} *"
        return title
    def _session_list_subtitle(self, session):
        ts = time.strftime("%H:%M", time.localtime(session.updated_at or time.time()))
        for message in reversed(session.messages):
            if not message.visible_in_chat:
                continue
            if message.role not in ("user", "assistant", "system"):
                continue
            text = (message.content or "").strip().replace("\n", " ")
            if text:
                if len(text) > 36:
                    text = text[:36] + "…"
                return f"{ts} · {text}"
        return f"{ts} · 还没有消息"
    def _session_list_item_text(self, session):
        return f"{self._session_display_title(session)}\n{self._session_list_subtitle(session)}"
    def _update_current_session_title(self, session=None):
        if not hasattr(self, "current_session_title"):
            return
        session = session or self._current_session()
        if not session:
            self.current_session_title.setText("新对话")
            return
        self.current_session_title.setText(self._session_display_title(session))
    def _list_index_for_session(self, session_id):
        for index in range(self.session_list.count()):
            item = self.session_list.item(index)
            if item and item.data(Qt.UserRole) == session_id:
                return index
        return -1
    def _sync_session_order_from_list(self):
        ordered = []
        for index in range(self.session_list.count()):
            item = self.session_list.item(index)
            if not item:
                continue
            session_id = item.data(Qt.UserRole)
            if session_id and session_id in self._sessions:
                ordered.append(session_id)
        if ordered:
            self._tab_session_ids = ordered
    def _ensure_session_order(self):
        valid = [sid for sid in self._tab_session_ids if sid in self._sessions]
        for session_id in self._sessions:
            if session_id not in valid:
                valid.append(session_id)
        self._tab_session_ids = valid
    def _apply_session_search_filter(self):
        if not hasattr(self, "session_list"):
            return
        needle = (self._session_search_text or "").strip().lower()
        for index in range(self.session_list.count()):
            item = self.session_list.item(index)
            if not item:
                continue
            session_id = item.data(Qt.UserRole)
            session = self._sessions.get(session_id)
            if not session:
                item.setHidden(True)
                continue
            if not needle:
                item.setHidden(False)
                continue
            title = (session.title or "新对话").lower()
            subtitle = self._session_list_subtitle(session).lower()
            item.setHidden(needle not in title and needle not in subtitle)
    def _refresh_session_list(self, select_session_id=None):
        if not hasattr(self, "session_list"):
            return
        self._list_refreshing = True
        self.session_list.blockSignals(True)
        self.session_list.clear()
        self._ensure_session_order()
        for session_id in self._tab_session_ids:
            session = self._sessions.get(session_id)
            if not session:
                continue
            item = QListWidgetItem(self._session_list_item_text(session))
            item.setData(Qt.UserRole, session_id)
            self.session_list.addItem(item)
        target_id = select_session_id or self._current_session_id
        if target_id:
            list_index = self._list_index_for_session(target_id)
            if list_index >= 0:
                self.session_list.setCurrentRow(list_index)
        self._apply_session_search_filter()
        self.session_list.blockSignals(False)
        self._list_refreshing = False
    def _on_session_search_changed(self, text):
        self._session_search_text = text or ""
        self._apply_session_search_filter()
    def _on_session_list_changed(self, current, previous):
        if self._list_refreshing or current is None:
            return
        session_id = current.data(Qt.UserRole)
        if not session_id or session_id == self._current_session_id:
            return
        self._select_session(session_id)
    def _on_session_list_reordered(self, parent, start, end, destination, row):
        if self._session_search_text.strip():
            return
        self._sync_session_order_from_list()
        self._save_sessions_to_disk()
    def _on_session_list_context_menu(self, pos):
        item = self.session_list.itemAt(pos)
        if not item:
            return
        session_id = item.data(Qt.UserRole)
        if not session_id:
            return
        if session_id != self._current_session_id:
            self._select_session(session_id)
        session = self._sessions.get(session_id)
        open_url = self._session_openable_chatgpt_url(session)
        if not open_url and session_id == self._current_session_id:
            open_url = self._live_openable_chatgpt_url()
        menu = QMenu(self)
        open_page_action = menu.addAction("打开 ChatGPT 页面")
        open_page_action.setEnabled(bool(open_url))
        if open_url:
            open_page_action.setToolTip(open_url)
        else:
            open_page_action.setToolTip(
                "发送消息后会自动记录页面；也可先点击「绑定当前」"
            )
        menu.addSeparator()
        rename_action = menu.addAction("重命名")
        clear_action = menu.addAction("清空对话")
        delete_action = menu.addAction("删除对话")
        action = menu.exec_(self.session_list.mapToGlobal(pos))
        if action == open_page_action:
            if session:
                self._open_bound_page_for_session(
                    session,
                    label=f"对话「{session.title}」ChatGPT 页面",
                    fallback_live=(session_id == self._current_session_id),
                )
        elif action == rename_action:
            self._rename_current_session()
        elif action == clear_action:
            self._clear_current_session()
        elif action == delete_action:
            self._delete_session_by_id(session_id)
    def _delete_current_session(self):
        session = self._current_session()
        if not session:
            return
        self._delete_session_by_id(session.session_id)
    def _delete_session_by_id(self, session_id):
        if session_id not in self._sessions:
            return
        if len(self._tab_session_ids) <= 1:
            self._clear_current_session()
            return
        list_index = self._list_index_for_session(session_id)
        for message_id, sid in list(self._message_to_session.items()):
            if sid == session_id:
                del self._message_to_session[message_id]
        if session_id in self._tab_session_ids:
            self._tab_session_ids.remove(session_id)
        del self._sessions[session_id]
        next_index = min(max(list_index, 0), len(self._tab_session_ids) - 1)
        next_id = self._tab_session_ids[next_index]
        self._select_session(next_id)
        self._save_sessions_to_disk()
    def _rename_current_session(self):
        session = self._current_session()
        if not session:
            return
        title, ok = QInputDialog.getText(
            self, "重命名对话", "对话标题：", text=session.title
        )
        if not ok:
            return
        new_title = title.strip()
        if not new_title:
            self._add_system_message("对话标题不能为空。")
            return
        session.title = new_title
        session.updated_at = time.time()
        self._refresh_session_list(select_session_id=session.session_id)
        self._update_current_session_title(session)
        self._save_sessions_to_disk()
    def _clear_current_session(self):
        session = self._current_session()
        if not session:
            return
        for bridge_id, sid in list(self._message_to_session.items()):
            if sid == session.session_id:
                del self._message_to_session[bridge_id]
                self._message_to_turn.pop(bridge_id, None)
                self._finalized_bridge_message_ids.discard(bridge_id)
                self._ack_success_message_ids.discard(bridge_id)
        session.messages.clear()
        session.updated_at = time.time()
        session.has_pending_reply = False
        self._append_session_message(session, "system", "当前对话已清空。")
        self._render_session_chat(session)
        self._refresh_session_list(select_session_id=session.session_id)
        self._update_current_session_title(session)
        self._save_sessions_to_disk()
    def _append_session_message(
        self,
        session,
        role,
        content,
        message_id="",
        turn_id="",
        status="",
        created_at=None,
        bridge_message_id="",
        parent_message_id="",
        visible_in_chat=True,
    ):
        message = ChatMessage(
            role=role,
            content=content,
            created_at=created_at or time.time(),
            message_id=message_id or str(uuid.uuid4()),
            turn_id=turn_id or "",
            status=status or "",
            bridge_message_id=bridge_message_id or "",
            parent_message_id=parent_message_id or "",
            visible_in_chat=bool(visible_in_chat),
        )
        session.messages.append(message)
        session.updated_at = time.time()
        return message
    def _find_assistant_by_turn(self, session, turn_id):
        if not session or not turn_id:
            return None
        for message in reversed(session.messages):
            if message.turn_id == turn_id and message.role in ("assistant", "error"):
                return message
        return None
    def _find_user_by_turn(self, session, turn_id):
        if not session or not turn_id:
            return None
        for message in reversed(session.messages):
            if message.turn_id == turn_id and message.role == "user":
                return message
        return None
    def _session_for_bridge(self, bridge_message_id):
        if not bridge_message_id:
            return None
        session_id = self._message_to_session.get(bridge_message_id)
        if not session_id:
            return None
        return self._sessions.get(session_id)
    def _resolve_inbound_binding(self, item):
        bridge_id = item.get("message_id") or ""
        session_id = (
            self._message_to_session.get(bridge_id) or item.get("session_id") or ""
        )
        turn_id = self._message_to_turn.get(bridge_id) or item.get("turn_id") or ""
        if not bridge_id or not session_id or not turn_id:
            return None, "", bridge_id
        session = self._sessions.get(session_id)
        if session is None:
            return None, "", bridge_id
        return session, turn_id, bridge_id
    def _has_assistant_for_turn(self, session, turn_id):
        return self._find_assistant_by_turn(session, turn_id) is not None
    def _migrate_loaded_session_messages(self):
        bridge_turn = dict(self._message_to_turn)
        for session in self._sessions.values():
            for message in session.messages:
                role = message.role
                bridge = message.bridge_message_id
                mid = message.message_id
                if role in ("user", "assistant") and mid and not bridge:
                    message.bridge_message_id = mid
                    bridge = mid
                if role in ("user", "assistant") and bridge and not message.turn_id:
                    if bridge not in bridge_turn:
                        bridge_turn[bridge] = str(uuid.uuid4())
                    message.turn_id = bridge_turn[bridge]
                if message.bridge_message_id:
                    self._message_to_session[message.bridge_message_id] = (
                        session.session_id
                    )
                    if message.turn_id:
                        bridge_turn[message.bridge_message_id] = message.turn_id
            by_bridge = {}
            for message in session.messages:
                bridge = message.bridge_message_id
                if not bridge or message.role not in ("user", "assistant"):
                    continue
                by_bridge.setdefault(bridge, []).append(message)
            for bridge, msgs in by_bridge.items():
                if len(msgs) < 2:
                    continue
                ids = [item.message_id for item in msgs]
                if len(set(ids)) == 1 and ids[0] == bridge:
                    user_msg = next((m for m in msgs if m.role == "user"), None)
                    asst_msg = next((m for m in msgs if m.role == "assistant"), None)
                    if user_msg:
                        user_msg.message_id = str(uuid.uuid4())
                    if asst_msg:
                        asst_msg.message_id = str(uuid.uuid4())
                        if user_msg:
                            asst_msg.parent_message_id = user_msg.message_id
        self._message_to_turn = bridge_turn
    def _mark_session_pending(self, session_id):
        session = self._sessions.get(session_id)
        if not session:
            return
        session.has_pending_reply = True
        self._refresh_session_list(select_session_id=self._current_session_id)
    # ----------------------------------------------------------- persistence
    @staticmethod
    def _message_to_dict(message):
        return {
            "message_id": message.message_id,
            "turn_id": message.turn_id,
            "role": message.role,
            "content": message.content,
            "created_at": message.created_at,
            "status": message.status,
            "bridge_message_id": message.bridge_message_id,
            "parent_message_id": message.parent_message_id,
            "visible_in_chat": message.visible_in_chat,
        }
    @staticmethod
    def _message_from_dict(data):
        content = data.get("content")
        if content is None:
            content = data.get("text", "")
        return ChatMessage(
            role=data.get("role", "system"),
            content=content,
            created_at=float(data.get("created_at", time.time())),
            message_id=data.get("message_id", ""),
            turn_id=data.get("turn_id", ""),
            status=data.get("status", ""),
            bridge_message_id=data.get("bridge_message_id", ""),
            parent_message_id=data.get("parent_message_id", ""),
            visible_in_chat=bool(data.get("visible_in_chat", True)),
        )
    def _session_to_dict(self, session):
        remote = _normalize_remote_chatgpt(session.remote_chatgpt)
        return {
            "session_id": session.session_id,
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "task_type": session.task_type,
            "context_mode": session.context_mode,
            "summary": session.summary,
            "pinned_context": session.pinned_context,
            "remote_chatgpt": dict(remote),
            "has_pending_reply": session.has_pending_reply,
            "messages": [self._message_to_dict(item) for item in session.messages],
        }
    def _session_from_dict(self, data):
        messages = [
            self._message_from_dict(item) for item in (data.get("messages") or [])
        ]
        remote = _normalize_remote_chatgpt(data.get("remote_chatgpt") or {})
        return ChatSession(
            session_id=data.get("session_id") or str(uuid.uuid4()),
            title=data.get("title") or "新对话",
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            task_type=data.get("task_type", ""),
            context_mode=data.get("context_mode", ""),
            summary=data.get("summary", ""),
            pinned_context=data.get("pinned_context", ""),
            remote_chatgpt=remote,
            messages=messages,
            has_pending_reply=bool(data.get("has_pending_reply")),
        )
    def _save_sessions_to_disk(self):
        if not self._save_chat_history:
            return
        try:
            data_dir = Path(self._chat_sessions_path or RUNTIME_DIR)
            data_dir.mkdir(parents=True, exist_ok=True)
            sessions_file = data_dir / "chat_sessions.json"
            payload = {
                "version": SESSIONS_JSON_VERSION,
                "current_session_id": self._current_session_id,
                "tab_order": list(self._tab_session_ids),
                "sessions": [
                    self._session_to_dict(item) for item in self._sessions.values()
                ],
                "message_to_session": self._message_to_session,
                "message_to_turn": self._message_to_turn,
                "finalized_bridge_message_ids": list(
                    self._finalized_bridge_message_ids
                ),
            }
            sessions_file.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception as error:
            detail = f"保存对话记录失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
    def _load_sessions_from_disk(self):
        data_dir = Path(self._chat_sessions_path or RUNTIME_DIR)
        sessions_file = data_dir / "chat_sessions.json"
        if not sessions_file.exists() and SESSIONS_FILE.exists():
            sessions_file = SESSIONS_FILE
        if not sessions_file.exists():
            return
        try:
            raw = sessions_file.read_text(encoding="utf-8")
            payload = json.loads(raw)
        except Exception as error:
            detail = f"加载对话记录失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._sessions = {}
            session = self._create_session(select=False)
            self._append_session_message(
                session,
                "system",
                "对话记录加载失败，已创建新对话。请查看运行日志了解详情。",
            )
            return
        self._sessions = {}
        for item in payload.get("sessions") or []:
            session = self._session_from_dict(item)
            self._sessions[session.session_id] = session
        self._current_session_id = payload.get("current_session_id")
        self._tab_session_ids = list(
            payload.get("tab_order") or payload.get("tab_session_ids") or []
        )
        if not self._tab_session_ids:
            saved_tabs = self._settings.value("tab_session_ids")
            if saved_tabs:
                self._tab_session_ids = [str(item) for item in saved_tabs]
        self._message_to_session = dict(payload.get("message_to_session") or {})
        self._message_to_turn = dict(payload.get("message_to_turn") or {})
        finalized = payload.get("finalized_bridge_message_ids") or payload.get(
            "finalized_message_ids"
        ) or []
        self._finalized_bridge_message_ids = set(finalized)
        self._migrate_loaded_session_messages()
    def _restore_ui_settings(self):
        if self._remember_window_geometry:
            geometry = self._settings.value("geometry")
            if geometry is not None:
                self.restoreGeometry(geometry)
            window_state = self._settings.value("window_state")
            if window_state is not None and self._remember_window_position:
                self.restoreState(window_state)
        if self._restore_main_tab:
            main_tab_index = int(self._settings.value("main_tab_index", 0))
            if 0 <= main_tab_index < self.main_tabs.count():
                self.main_tabs.setCurrentIndex(main_tab_index)
        self._update_service_settings_status()
        self._update_tampermonkey_settings_labels()
    def _save_ui_settings(self):
        if self._remember_window_geometry:
            self._settings.setValue("geometry", self.saveGeometry())
        if self._remember_window_position:
            self._settings.setValue("window_state", self.saveState())
        self._settings.setValue("main_tab_index", self.main_tabs.currentIndex())
        self._settings.setValue("tab_session_ids", self._tab_session_ids)
        if self._current_session_id:
            self._settings.setValue("current_session_id", self._current_session_id)
        if self._saved_page_url:
            self._settings.setValue("last_page_url", self._saved_page_url)
    # ------------------------------------------------------------- chat view
    @staticmethod
    def _format_ts(ts):
        if not ts:
            return "-"
        return time.strftime("%H:%M:%S", time.localtime(ts))
    def _format_message_ts(self, created_at):
        if not self._show_timestamp:
            return ""
        return time.strftime("%H:%M:%S", time.localtime(created_at))
    def _clear_chat_widgets(self):
        keep = {self.empty_state_widget, self.chat_bottom_spacer}
        index = 0
        while index < self.chat_list_layout.count():
            item = self.chat_list_layout.itemAt(index)
            widget = item.widget() if item else None
            if widget in keep:
                index += 1
                continue
            if widget:
                self.chat_list_layout.removeWidget(widget)
                widget.deleteLater()
                continue
            index += 1
        self._reply_bubbles_by_message_id.clear()
        self._user_bubbles_by_message_id.clear()

    def _session_has_chat_messages(self, session=None):
        session = session or self._current_session()
        if not session:
            return False
        for message in session.messages:
            if message.visible_in_chat and message.role in ("user", "assistant"):
                return True
        return False

    def _update_chat_empty_state(self, session=None):
        if not hasattr(self, "empty_state_widget"):
            return
        self.empty_state_widget.setVisible(
            not self._session_has_chat_messages(session)
        )

    def _render_session_chat(self, session):
        self._clear_chat_widgets()
        for message in session.messages:
            if not message.visible_in_chat:
                continue
            self._add_bubble_from_message(message, register_only=False)
        self._update_chat_empty_state(session)
        self._scroll_to_bottom()

    def _add_bubble_from_message(self, message, register_only=False):
        ts_text = self._format_message_ts(message.created_at)
        if message.role == "system":
            bubble = SystemBubble(message.text, ts_text)
        else:
            bubble = ChatBubble(
                message.role,
                message.text,
                ts_text,
                message.status,
                body_pt=self._chat_font_pt,
            )
        row = QWidget()
        row_layout = QHBoxLayout(row)
        row_layout.setContentsMargins(0, 0, 0, 0)
        row_layout.setSpacing(8)
        if message.role == "user":
            row_layout.addStretch()
            row_layout.addWidget(bubble)
        elif message.role == "system":
            row_layout.addStretch()
            row_layout.addWidget(bubble)
            row_layout.addStretch()
        elif message.role == "error":
            row_layout.addStretch()
            row_layout.addWidget(bubble)
            row_layout.addStretch()
        else:
            row_layout.addWidget(bubble)
            row_layout.addStretch()
        insert_index = max(0, self.chat_list_layout.count() - 1)
        self.chat_list_layout.insertWidget(insert_index, row)
        if message.message_id:
            if message.role == "user":
                self._user_bubbles_by_message_id[message.message_id] = bubble
            elif message.role in ("assistant", "error"):
                self._reply_bubbles_by_message_id[message.message_id] = bubble
        if not register_only:
            self._update_chat_empty_state()
        return bubble
    def _add_system_message(self, text):
        session = self._ensure_current_session()
        self._append_session_message(session, "system", text)
        if session.session_id == self._current_session_id:
            self._add_bubble_from_message(session.messages[-1])
            self._scroll_to_bottom()
        self._refresh_session_list(select_session_id=session.session_id)
        self._save_sessions_to_disk()
    def _scroll_to_bottom(self):
        if not self._auto_scroll_to_bottom:
            return
        QTimer.singleShot(0, self._do_scroll_to_bottom)
    def _do_scroll_to_bottom(self):
        bar = self.chat_scroll.verticalScrollBar()
        bar.setValue(bar.maximum())
    def _last_assistant_text(self, session=None):
        session = session or self._current_session()
        if not session:
            return ""
        for message in reversed(session.messages):
            if message.role == "assistant" and message.text.strip():
                if message.content.strip() not in ASSISTANT_WAIT_TEXTS:
                    return message.content.strip()
        return ""
    def _update_session_assistant(
        self, session, turn_id, text=None, status=None, role=None, error=False
    ):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        if text is not None:
            target.content = text
        if status is not None:
            target.status = status
        if role is not None:
            target.role = role
        if error:
            target.role = "error"
        session.updated_at = time.time()
        return True
    def _apply_session_change(self, session_id):
        session = self._sessions.get(session_id)
        if not session:
            return
        self._refresh_session_list(select_session_id=self._current_session_id)
        if session_id == self._current_session_id:
            self._render_session_chat(session)
        else:
            self._mark_session_pending(session_id)
        self._save_sessions_to_disk()
    def _set_reply_text(self, session, turn_id, text, status_text="已回复"):
        if not self._update_session_assistant(
            session, turn_id, text=text, status=status_text, role="assistant"
        ):
            return
        self._apply_session_change(session.session_id)
    def _set_reply_error(self, session, turn_id, text, status_text="失败"):
        if not self._update_session_assistant(
            session,
            turn_id,
            text=text,
            status=status_text,
            role="error",
            error=True,
        ):
            return
        self._apply_session_change(session.session_id)
    def _set_reply_waiting(self, session, turn_id):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        target.role = "assistant"
        target.content = ASSISTANT_WAIT_TEXT
        target.status = "等待中"
        session.updated_at = time.time()
        if session.session_id == self._current_session_id:
            bubble = self._reply_bubbles_by_message_id.get(target.message_id)
            if bubble is not None:
                if bubble.role == "error":
                    bubble.role = "assistant"
                    bubble._apply_style()
                bubble.set_text(ASSISTANT_WAIT_TEXT, "等待中")
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._save_sessions_to_disk()
        return True
    def _set_reply_status(self, session, turn_id, status_text):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        target.status = status_text
        session.updated_at = time.time()
        if session.session_id == self._current_session_id:
            bubble = self._reply_bubbles_by_message_id.get(target.message_id)
            if bubble is not None:
                bubble.set_text(target.content, status_text)
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._save_sessions_to_disk()
        return True
    # -------------------------------------------------------------- toggles
    @staticmethod
    def _short_page_display(url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return ""
        try:
            parsed = urlparse(raw)
            if parsed.netloc:
                path = parsed.path or ""
                if len(path) > 36:
                    path = path[:36] + "..."
                return f"{parsed.netloc}{path}"
        except ValueError:
            pass
        if len(raw) > 80:
            return raw[:80] + "..."
        return raw
    def _make_inbound_key(self, item):
        kind = item.get("kind", "")
        message_id = item.get("message_id") or ""
        payload = item.get("payload") or {}
        text = (
            payload.get("text")
            or payload.get("detail")
            or payload.get("reason")
            or str(payload)
        )
        return f"{kind}|{message_id}|{text}"
    def _is_finalized(self, bridge_message_id):
        return bool(
            bridge_message_id
            and bridge_message_id in self._finalized_bridge_message_ids
        )
    def _finalize_bridge(self, bridge_message_id):
        if bridge_message_id:
            self._finalized_bridge_message_ids.add(bridge_message_id)
    @staticmethod
    def _is_persistable_page_url(url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return False
        lower = raw.lower()
        if not (lower.startswith("http://") or lower.startswith("https://")):
            return False
        noisy_fragments = (
            "/backend-api/",
            "/sentinel/",
            "frame.html",
            "/oauth",
            "challenge-platform",
        )
        if any(fragment in lower for fragment in noisy_fragments):
            return False
        return True
    def _load_saved_page_url(self):
        raw = self._settings.value("last_page_url", "")
        if isinstance(raw, str) and self._is_persistable_page_url(raw):
            return raw.strip()
        return None
    def _persist_page_url(self, url):
        if not self._is_persistable_page_url(url):
            return
        self._saved_page_url = url.strip()
        self._settings.setValue("last_page_url", self._saved_page_url)
    def _set_page_link_label(self, label, prefix, url, open_btn=None):
        if not url:
            label.setText(f"{prefix}-")
            label.setToolTip("")
            if open_btn is not None:
                open_btn.setEnabled(False)
            return
        display = self._short_page_display(url)
        href = html.escape(url, quote=True)
        text = html.escape(display)
        label.setText(
            f'{prefix}<a href="{href}" style="color:#1565c0; text-decoration: underline;">{text}</a>'
        )
        label.setToolTip(url)
        if open_btn is not None:
            open_btn.setEnabled(True)

    def _update_live_page_display(self, live_url=None):
        live = (live_url or "").strip()
        show_url = live if self._is_bindable_chatgpt_url(live) else None
        if show_url:
            self._persist_page_url(show_url)
        self._tampermonkey_page_url = show_url
        self._set_page_link_label(
            self.tm_live_page_label, "当前油猴页面：", show_url, self.open_live_page_btn
        )

    def _is_client_online(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return False
        for item in self._last_bridge_status.get("tampermonkey_clients") or []:
            if (item.get("client_id") or "").strip() == client_id:
                return bool(item.get("online"))
        return False

    def _resolve_target_page_for_session(self, session):
        if not self._bind_each_chat_to_page:
            return (
                "",
                "",
                True,
                "未启用页面绑定，使用任意在线页面。",
            )

        remote = _normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        enabled = bool(remote.get("enabled"))
        client_id = (remote.get("client_id") or "").strip()
        page_url = (remote.get("conversation_url") or "").strip()

        if not enabled or not page_url:
            return "", "", False, "当前对话未绑定 ChatGPT 页面。"

        if self._is_client_online(client_id):
            return client_id, page_url, True, "绑定页面在线。"

        if self._auto_open_bound_page_when_missing:
            self._open_url_in_browser(page_url, "自动打开当前对话绑定页面")
            self._push_open_url(
                page_url, active=True, label="自动打开当前对话绑定页面"
            )
            return (
                "",
                "",
                False,
                "绑定页面未在线，已尝试自动打开，请等待页面连接后再发送。",
            )

        if self._allow_fallback_to_any_page:
            return (
                "",
                "",
                True,
                "绑定页面未在线，按设置退回任意在线页面发送。",
            )

        return "", "", False, "绑定页面未打开，请先打开当前对话绑定页面。"

    def _update_bound_page_display(self):
        session = self._current_session()
        remote = _normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if not self._bind_each_chat_to_page:
            hint = "页面绑定功能未启用，当前使用任意在线页面发送"
            url = self._session_openable_chatgpt_url(session)
            if url:
                client_id = (remote.get("client_id") or "").strip()
                online = self._is_client_online(client_id) if client_id else False
                status_text = "在线" if online else "离线"
                bind_note = "已绑定" if remote.get("enabled") else "已关联"
                short = self._short_page_display(url)
                self.tm_bound_page_label.setText(
                    f"{hint} | {bind_note}：{short} | client_id：{client_id or '-'} | {status_text}"
                )
                self.tm_bound_page_label.setToolTip(url)
                self.open_bound_page_btn.setEnabled(True)
            else:
                live = self._live_openable_chatgpt_url()
                if live:
                    self.tm_bound_page_label.setText(
                        f"{hint} | 可打开当前在线页面：{self._short_page_display(live)}"
                    )
                    self.tm_bound_page_label.setToolTip(live)
                    self.open_bound_page_btn.setEnabled(True)
                else:
                    self.tm_bound_page_label.setText(hint)
                    self.tm_bound_page_label.setToolTip("")
                    self.open_bound_page_btn.setEnabled(False)
            return

        if remote.get("enabled") and remote.get("conversation_url"):
            url = (remote.get("conversation_url") or "").strip()
            client_id = (remote.get("client_id") or "").strip()
            online = self._is_client_online(client_id) if client_id else False
            status_text = "在线" if online else "离线"
            short = self._short_page_display(url)
            self.tm_bound_page_label.setText(
                f"绑定页面：{short} | client_id：{client_id or '-'} | 状态：{status_text}"
            )
            self.tm_bound_page_label.setToolTip(
                f"{url}\nclient_id={client_id or '-'}"
            )
            self.open_bound_page_btn.setEnabled(True)
        else:
            self.tm_bound_page_label.setText(
                "绑定页面：未绑定（已启用严格绑定，发送前需先绑定）"
            )
            self.tm_bound_page_label.setToolTip("")
            self.open_bound_page_btn.setEnabled(False)

    @staticmethod
    def _is_bindable_chatgpt_url(url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return False
        if not MainWindow._is_persistable_page_url(raw):
            return False
        try:
            parsed = urlparse(raw)
        except ValueError:
            return False
        host = (parsed.netloc or "").lower()
        if host not in (
            "chatgpt.com",
            "www.chatgpt.com",
            "chat.openai.com",
            "www.chat.openai.com",
        ):
            return False
        path = parsed.path or "/"
        if path in ("", "/"):
            return True
        if path.startswith("/c/"):
            return True
        return False

    def _bind_page_to_session(self, session, client_info):
        if not isinstance(client_info, dict):
            client_info = {
                "client_id": str(client_info or "").strip(),
                "page_url": "",
            }
        page_url = (client_info.get("page_url") or "").strip()
        client_id = (client_info.get("client_id") or "").strip()
        if not self._is_bindable_chatgpt_url(page_url):
            self._add_system_message("该 URL 不是可绑定的 ChatGPT 对话页面。")
            return False
        if not client_id:
            self._add_system_message("缺少 client_id，无法绑定。")
            return False
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = _parse_conversation_id(page_url)
        session.remote_chatgpt = {
            "enabled": True,
            "conversation_id": conversation_id,
            "conversation_url": page_url,
            "client_id": client_id,
            "page_instance_id": (client_info.get("page_instance_id") or "").strip(),
            "page_type": (client_info.get("page_type") or "").strip(),
            "page_title": (client_info.get("page_title") or "").strip(),
            "last_seen": time.time(),
        }
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._render_tampermonkey_clients(self._last_bridge_status)
        self._add_system_message("已绑定 ChatGPT 页面到本对话。")
        self._append_log(
            f"[绑定] session={session.session_id[:8]}… "
            f"client_id={client_id} page_type={client_info.get('page_type') or '-'} "
            f"conversation_id={conversation_id or '-'} url={page_url}"
        )
        return True

    def _client_info_from_status(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        for item in self._last_bridge_status.get("tampermonkey_clients") or []:
            if (item.get("client_id") or "").strip() == client_id:
                return dict(item)
        return {"client_id": client_id, "page_url": ""}

    def _on_bind_current_page(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return
        status = server.get_bridge_status()
        if not status.get("tampermonkey_online"):
            self._add_system_message("油猴未在线，无法绑定当前页面。")
            return
        client_id = (status.get("tampermonkey_client_id") or "").strip()
        client_info = self._client_info_from_status(client_id)
        if client_info:
            client_info["page_url"] = (
                client_info.get("page_url")
                or (status.get("tampermonkey_page_url") or "").strip()
            )
        else:
            client_info = {
                "client_id": client_id,
                "page_url": (status.get("tampermonkey_page_url") or "").strip(),
            }
        session = self._ensure_current_session()
        if self._bind_page_to_session(session, client_info):
            self._set_settings_hint("已绑定当前页面到本对话。")

    def _on_bind_selected_tm_page(self):
        client_id = self._selected_tm_client_id()
        if not client_id:
            self._set_settings_hint("请先在页面列表中选中一行。")
            return
        client_info = self._client_info_from_status(client_id)
        if not client_info:
            self._set_settings_hint("未找到选中页面的信息，请先刷新页面列表。")
            return
        row = self.tm_pages_table.currentRow()
        url_item = self.tm_pages_table.item(row, 8)
        if url_item:
            full_url = (url_item.toolTip() or url_item.text() or "").strip()
            if full_url and full_url != "-":
                client_info["page_url"] = full_url
        session = self._ensure_current_session()
        if self._bind_page_to_session(session, client_info):
            self._set_settings_hint(f"已绑定页面 {client_id} 到当前对话。")

    def _on_unbind_current_page(self):
        session = self._current_session()
        if session is None:
            self._add_system_message("当前没有选中的对话。")
            return
        session.remote_chatgpt = _default_remote_chatgpt()
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._render_tampermonkey_clients(self._last_bridge_status)
        self._add_system_message("已解除本对话的 ChatGPT 页面绑定。")
        self._set_settings_hint("已解除绑定。")
    def _open_url_in_browser(self, url, label=""):
        target = (url or "").strip()
        if not target or target == "-":
            return False
        qurl = QUrl(target)
        if not qurl.isValid():
            self._add_system_message(f"页面地址无效：{target}")
            return False
        if QDesktopServices.openUrl(qurl):
            self._append_log(f"[打开浏览器] {label or target}")
            return True
        try:
            if webbrowser.open(target):
                self._append_log(f"[打开浏览器] {label or target}")
                return True
        except Exception as error:
            detail = f"打开页面失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._add_system_message(f"打开页面失败：{error}")
            return False
        return False

    def _open_tampermonkey_page(self, url=None):
        target = (url or self._tampermonkey_page_url or "").strip()
        if not target or target == "-":
            self._add_system_message("当前没有可打开的 ChatGPT 页面地址。")
            return
        if self._open_url_in_browser(target, target):
            return
        self._add_system_message(f"无法打开页面：{target}")

    def _chatgpt_url_from_remote(self, remote):
        remote = _normalize_remote_chatgpt(remote)
        url = (remote.get("conversation_url") or "").strip()
        if url and self._is_bindable_chatgpt_url(url):
            return url
        conversation_id = (remote.get("conversation_id") or "").strip()
        if conversation_id:
            return f"https://chatgpt.com/c/{conversation_id}"
        return ""

    def _session_openable_chatgpt_url(self, session):
        if session is None:
            return ""
        return self._chatgpt_url_from_remote(session.remote_chatgpt)

    def _live_openable_chatgpt_url(self):
        status = self._last_bridge_status or {}
        if not status.get("tampermonkey_online"):
            return ""
        url = (status.get("tampermonkey_page_url") or "").strip()
        if self._is_bindable_chatgpt_url(url):
            return url
        return ""

    def _session_bound_conversation_url(self, session):
        if session is None:
            return ""
        remote = _normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return ""
        return self._chatgpt_url_from_remote(remote)

    def _bound_conversation_url(self):
        return self._session_bound_conversation_url(self._current_session())

    def _remember_session_page_from_client(self, session, client_id):
        if session is None:
            return
        client_id = (client_id or "").strip()
        if not client_id:
            return
        client_info = self._client_info_from_status(client_id)
        if not client_info:
            return
        page_url = (client_info.get("page_url") or "").strip()
        if not self._is_bindable_chatgpt_url(page_url):
            return
        remote = _normalize_remote_chatgpt(session.remote_chatgpt)
        bound_client = (remote.get("client_id") or "").strip()
        if remote.get("enabled") and bound_client and bound_client != client_id:
            return
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = _parse_conversation_id(page_url)
        session.remote_chatgpt = {
            "enabled": bool(remote.get("enabled")),
            "conversation_id": conversation_id,
            "conversation_url": page_url,
            "client_id": client_id,
            "page_instance_id": (client_info.get("page_instance_id") or "").strip(),
            "page_type": (client_info.get("page_type") or "").strip(),
            "page_title": (client_info.get("page_title") or "").strip(),
            "last_seen": time.time(),
        }
        self._save_sessions_to_disk()

    def _open_bound_page_for_session(self, session, label="", fallback_live=False):
        url = self._session_openable_chatgpt_url(session)
        if not url and fallback_live:
            url = self._live_openable_chatgpt_url()
            if url and session is not None:
                cid = (self._last_bridge_status.get("tampermonkey_client_id") or "").strip()
                if cid:
                    self._remember_session_page_from_client(session, cid)
        if not url:
            self._add_system_message(
                "该对话尚无已知的 ChatGPT 页面。请先发送一条消息，或点击「绑定当前」。"
            )
            return False
        if self._open_url_in_browser(url, label or "打开 ChatGPT 页面"):
            return True
        self._push_open_url(
            url,
            active=True,
            label=label or "打开绑定页面",
        )
        return True

    def _push_open_url(self, url, active=True, label=""):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return None
        target = (url or "").strip()
        if not target:
            self._add_system_message("URL 为空，无法下发打开命令。")
            return None
        status = server.get_bridge_status()
        if not status.get("tampermonkey_online"):
            self._append_log(
                "[打开网页] 警告：油猴当前离线，命令已入队，需有已加载脚本的 ChatGPT 标签页在线后才会执行。"
            )
        try:
            msg = server.push_open_url(target, active=active)
        except Exception as error:
            detail = f"open_url 入队失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._add_system_message(f"打开网页命令入队失败：{error}")
            return None
        short_id = (msg.get("id") or "")[:8]
        desc = label or target
        self._append_log(f"[打开网页] 已下发 ({short_id}…) {desc}")
        return msg

    def _on_open_chatgpt_home(self):
        label = "ChatGPT 首页"
        if self._open_url_in_browser(CHATGPT_HOME_URL, label):
            self._set_settings_hint("已在默认浏览器中打开 ChatGPT。")
            return
        if server.is_server_running():
            self._push_open_url(CHATGPT_HOME_URL, active=True, label=label)
            self._set_settings_hint("浏览器打开失败，已通过油猴尝试打开。")
            return
        self._add_system_message(
            "无法打开 ChatGPT。请检查系统默认浏览器，或先启动服务后再试。"
        )

    def _on_open_new_chatgpt_tab(self):
        label = "新 ChatGPT 标签页"
        if server.is_server_running():
            msg = self._push_open_url(CHATGPT_HOME_URL, active=True, label=label)
            if msg is not None:
                self._set_settings_hint("已通过油猴在新标签页打开 ChatGPT。")
                return
        if self._open_url_in_browser(CHATGPT_HOME_URL, label):
            self._set_settings_hint("已在默认浏览器中打开 ChatGPT。")
            return
        self._add_system_message(
            "无法打开新对话。请检查默认浏览器，或先启动服务并确认油猴在线。"
        )

    def _on_open_bound_chatgpt_page(self, _url=None):
        session = self._current_session()
        if session is None:
            self._add_system_message("当前没有选中的对话。")
            return
        self._open_bound_page_for_session(
            session, label="当前对话 ChatGPT 页面", fallback_live=True
        )

    def _bound_bridge_client_id(self, status=None):
        session = self._current_session()
        if session:
            remote = _normalize_remote_chatgpt(session.remote_chatgpt)
            if remote.get("enabled"):
                cid = (remote.get("client_id") or "").strip()
                if cid:
                    return cid
        status = status or self._last_bridge_status or {}
        bound = (status.get("bound_client_id") or "").strip()
        if bound:
            return bound
        return (status.get("tampermonkey_client_id") or "").strip()

    def _session_bound_client_id(self):
        session = self._current_session()
        if not session:
            return ""
        remote = _normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return ""
        return (remote.get("client_id") or "").strip()

    def _render_tampermonkey_clients(self, status=None):
        status = status or {}
        clients = status.get("tampermonkey_clients") or []
        session_bound_id = self._session_bound_client_id()
        self.tm_pages_table.setRowCount(0)
        for item in clients:
            row = self.tm_pages_table.rowCount()
            self.tm_pages_table.insertRow(row)
            client_id = item.get("client_id") or "-"
            full_url = item.get("page_url") or ""
            display_url = item.get("pathname") or self._short_page_display(full_url) or "-"
            if len(display_url) > 80:
                display_url = display_url[:80] + "..."
            page_instance_id = item.get("page_instance_id") or "-"
            if len(page_instance_id) > 24:
                page_instance_id = page_instance_id[:24] + "…"
            page_type = item.get("page_type") or "-"
            conversation_id = item.get("conversation_id") or "-"
            if len(conversation_id) > 16:
                conversation_id = conversation_id[:16] + "…"
            visibility = item.get("visibility_state") or "-"
            has_focus = "是" if item.get("has_focus") else "否"
            last_seen = self._format_ts(item.get("last_seen"))
            online_text = "在线" if item.get("online") else "离线"
            is_bound = "是" if session_bound_id and client_id == session_bound_id else "否"
            online_item = QTableWidgetItem(online_text)
            if item.get("online"):
                online_item.setForeground(Qt.darkGreen)
            else:
                online_item.setForeground(Qt.gray)
            self.tm_pages_table.setItem(row, 0, online_item)
            self.tm_pages_table.setItem(row, 1, QTableWidgetItem(client_id))
            self.tm_pages_table.setItem(row, 2, QTableWidgetItem(page_instance_id))
            self.tm_pages_table.setItem(row, 3, QTableWidgetItem(page_type))
            self.tm_pages_table.setItem(row, 4, QTableWidgetItem(conversation_id))
            self.tm_pages_table.setItem(row, 5, QTableWidgetItem(visibility))
            self.tm_pages_table.setItem(row, 6, QTableWidgetItem(has_focus))
            self.tm_pages_table.setItem(row, 7, QTableWidgetItem(last_seen))
            url_item = QTableWidgetItem(display_url)
            url_item.setToolTip(full_url)
            self.tm_pages_table.setItem(row, 8, url_item)
            bound_item = QTableWidgetItem(is_bound)
            if is_bound == "是":
                bound_item.setForeground(Qt.darkGreen)
            self.tm_pages_table.setItem(row, 9, bound_item)

    def _selected_tm_client_id(self):
        row = self.tm_pages_table.currentRow()
        if row < 0:
            return ""
        item = self.tm_pages_table.item(row, 1)
        return (item.text() if item else "").strip()

    def _on_refresh_tm_pages(self):
        if not server.is_server_running():
            self._set_settings_hint("请先启动服务。")
            return
        status = server.get_bridge_status()
        self._apply_bridge_status(status)
        self._set_settings_hint(f"已刷新，共 {len(status.get('tampermonkey_clients') or [])} 个页面。")

    def _enqueue_close_page(self, client_id, label=""):
        if not server.is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            return None
        client_id = (client_id or "").strip()
        if not client_id:
            self._append_log("[关闭页面] 未指定 client_id。")
            return None
        try:
            msg = server.push_close_page(client_id)
        except Exception as error:
            detail = f"close_self 入队失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            return None
        short_id = (msg.get("id") or "")[:8]
        desc = label or client_id
        self._append_log(f"[关闭页面] 已下发 close_self ({short_id}…) {desc}")
        return msg

    def _on_close_selected_tm_page(self):
        client_id = self._selected_tm_client_id()
        if not client_id:
            self._set_settings_hint("请先在页面列表中选中一行。")
            return
        self._enqueue_close_page(client_id, label=f"选中页面 {client_id}")
        self._set_settings_hint(f"已向 {client_id} 下发关闭命令。")

    def _on_close_other_tm_pages(self):
        if not server.is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            self._set_settings_hint("请先启动服务。")
            return
        except_id = self._session_bound_client_id()
        if not except_id:
            self._add_system_message("请先绑定当前对话页面，再关闭其他页面。")
            self._set_settings_hint("当前对话未绑定页面。")
            return
        try:
            msgs = server.push_close_other_pages(except_id)
        except Exception as error:
            detail = f"批量关闭页面失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._set_settings_hint(f"关闭其他页面失败：{error}")
            return
        self._append_log(
            f"[关闭页面] 已关闭其他页面，保留绑定 {except_id}，共下发 {len(msgs)} 条命令。"
        )
        self._set_settings_hint(
            f"已向除 {except_id} 外的 {len(msgs)} 个在线页面下发关闭命令。"
        )

    def _on_close_bound_tm_page(self):
        if not server.is_server_running():
            self.append_log("[关闭页面] 服务未启动，无法下发命令。")
            self._set_settings_hint("请先启动服务。")
            return
        client_id = self._session_bound_client_id()
        if not client_id:
            self._add_system_message("当前对话未绑定在线 ChatGPT 页面。")
            self._set_settings_hint("当前对话未绑定 client_id。")
            return
        self._enqueue_close_page(client_id, label=f"绑定页面 {client_id}")
        self._set_settings_hint(f"已向绑定页面 {client_id} 下发关闭命令。")

    # ---------------------------------------------------------- bridge events
    def _render_status_summary(self, status):
        status = status or {}
        host = self.host_edit.text().strip() or "127.0.0.1"
        port = self.port_edit.text().strip() or "5000"
        last_seen = status.get("tampermonkey_last_seen")
        page_url = self._tampermonkey_page_url or status.get("tampermonkey_page_url") or "-"
        if status.get("tampermonkey_online"):
            tm_text = "在线"
        elif last_seen:
            tm_text = "离线"
        else:
            tm_text = "未连接"
        lines = [
            f"服务运行：{'是' if status.get('server_running') else '否'}",
            f"监听地址：{host}:{port}",
            f"油猴状态：{tm_text}",
            f"最后心跳：{self._format_ts(last_seen)}",
            f"油猴 client_id：{status.get('tampermonkey_client_id') or '-'}",
            f"全局绑定 client_id：{status.get('bound_client_id') or '-'}",
            f"本对话绑定 client_id：{self._session_bound_client_id() or '-'}",
            f"已知 ChatGPT 页面数：{len(status.get('tampermonkey_clients') or [])}",
            f"待发队列：{status.get('queue_length', 0)}",
            f"入站事件数：{status.get('inbound_count', 0)}",
            f"当前油猴页面：{page_url}",
            f"本对话绑定页面：{self._bound_conversation_url() or '未绑定'}",
        ]
        waiting = status.get("waiting_ack")
        if waiting:
            lines.append(
                f"等待回执消息：{waiting.get('id', '?')[:8]}… "
                f"status={waiting.get('status', '?')} "
                f"delivered_to={waiting.get('delivered_to', '-')}"
            )
        self.status_log_edit.setPlainText("\n".join(lines))
    @staticmethod
    def _refresh_status_chip(label, state=""):
        label.setProperty("state", state or "")
        style = label.style()
        style.unpolish(label)
        style.polish(label)

    def _apply_bridge_status(self, status):
        self._last_bridge_status = status or {}
        server_running = bool(status.get("server_running"))
        if server_running:
            self.status_label.setText("服务：运行中")
            self.statusBar().showMessage("服务运行中")
            self._refresh_status_chip(self.status_label, "ok")
        else:
            self.status_label.setText("服务：未启动")
            self.statusBar().showMessage("服务未启动")
            self._refresh_status_chip(self.status_label, "")
        last_seen = status.get("tampermonkey_last_seen")
        last_seen_text = self._format_ts(last_seen)
        if status.get("tampermonkey_online"):
            self.tm_online_label.setText("油猴：在线")
            self._refresh_status_chip(self.tm_online_label, "ok")
            self.tm_online_label.setToolTip(f"最后心跳：{last_seen_text}")
        elif last_seen:
            self.tm_online_label.setText("油猴：离线")
            self._refresh_status_chip(self.tm_online_label, "warn")
            self.tm_online_label.setToolTip(f"最后心跳：{last_seen_text}")
        else:
            self.tm_online_label.setText("油猴：未连接")
            self._refresh_status_chip(self.tm_online_label, "")
            self.tm_online_label.setToolTip("")
        self.tm_queue_label.setText(f"队列：{status.get('queue_length', 0)}")
        live_url = status.get("tampermonkey_page_url") if status.get("tampermonkey_online") else None
        self._update_live_page_display(live_url)
        self._update_bound_page_display()
        self._render_tampermonkey_clients(status)
        inbound_items = status.get("recent_inbound") or []
        outbound_items = status.get("recent_outbound") or []
        self._handle_inbound_events(inbound_items)
        self._render_inbound_log(inbound_items)
        self._render_outbound(outbound_items)
        self._render_status_summary(status)
        self._update_tampermonkey_settings_labels(status)
        self._update_service_settings_status()
    def _handle_inbound_events(self, items):
        for item in items:
            event_key = (
                item.get("event_id") or item.get("id") or self._make_inbound_key(item)
            )
            if event_key in self._processed_inbound_ids:
                continue
            self._processed_inbound_ids.add(event_key)
            kind = item.get("kind", "?")
            payload = item.get("payload") or {}
            if kind in (
                "ack_mismatch",
                "report_mismatch",
                "report_ignored",
                "report_unknown",
            ):
                continue
            if kind in ("open_url_success", "open_url_failed"):
                url = payload.get("url") or ""
                detail = payload.get("detail") or ""
                if kind == "open_url_success":
                    self._append_log(f"[打开网页] 成功：{url} {detail}".strip())
                else:
                    self._append_log(f"[打开网页] 失败：{url} {detail}".strip())
                continue
            if kind in ("close_page_success", "close_page_failed", "command_failed"):
                page_url = payload.get("page_url") or ""
                detail = payload.get("detail") or ""
                client_id = item.get("client_id") or "-"
                if kind == "close_page_success":
                    self._append_log(
                        f"[关闭页面] 成功 client_id={client_id} {page_url} {detail}".strip()
                    )
                elif kind == "close_page_failed":
                    self._append_log(
                        f"[关闭页面] 失败 client_id={client_id} {page_url} {detail}".strip()
                    )
                else:
                    self._append_log(
                        f"[命令] 失败 client_id={client_id} {detail}".strip()
                    )
                continue
            session, turn_id, bridge_id = self._resolve_inbound_binding(item)
            if session is None or not turn_id:
                continue
            if kind == "ack":
                success = bool(payload.get("success"))
                detail = payload.get("detail") or ""
                if not self._has_assistant_for_turn(session, turn_id):
                    continue
                if self._is_finalized(bridge_id):
                    continue
                if success:
                    self._ack_success_message_ids.add(bridge_id)
                    self._set_reply_waiting(session, turn_id)
                    report_client = (item.get("client_id") or "").strip()
                    if report_client:
                        self._remember_session_page_from_client(
                            session, report_client
                        )
                        self._update_bound_page_display()
                else:
                    self._ack_success_message_ids.discard(bridge_id)
                    self._set_reply_error(
                        session,
                        turn_id,
                        f"发送失败：{detail or '油猴返回失败'}",
                        "发送失败",
                    )
                    self._finalize_bridge(bridge_id)
                continue
            if kind == "send_failed":
                if bridge_id in self._ack_success_message_ids:
                    continue
                if not self._has_assistant_for_turn(
                    session, turn_id
                ) or self._is_finalized(bridge_id):
                    continue
                detail = payload.get("detail") or payload.get("reason") or str(
                    payload
                )
                self._set_reply_error(
                    session, turn_id, f"发送失败：{detail}", "发送失败"
                )
                self._finalize_bridge(bridge_id)
                continue
            if kind == "assistant_reply":
                if self._is_finalized(bridge_id):
                    continue
                if not self._has_assistant_for_turn(session, turn_id):
                    continue
                text = payload.get("text") or payload.get("content") or ""
                if text.strip():
                    self._set_reply_text(session, turn_id, text.strip(), "已回复")
                    self._finalize_bridge(bridge_id)
                    self._ack_success_message_ids.discard(bridge_id)
                    report_client = (item.get("client_id") or "").strip()
                    if report_client:
                        self._remember_session_page_from_client(
                            session, report_client
                        )
                        self._update_bound_page_display()
                else:
                    self._set_reply_error(
                        session, turn_id, "ChatGPT 返回了空回复。", "空回复"
                    )
                    self._finalize_bridge(bridge_id)
                continue
            if kind == "assistant_reply_empty":
                if not self._has_assistant_for_turn(
                    session, turn_id
                ) or self._is_finalized(bridge_id):
                    continue
                if bridge_id in self._ack_success_message_ids:
                    self._set_reply_waiting(session, turn_id)
                    continue
                detail = payload.get("detail") or "ChatGPT 已发送，但未读取到回复内容。"
                self._set_reply_error(session, turn_id, detail, "空回复")
                self._finalize_bridge(bridge_id)
                continue
            if kind == "assistant_reply_failed":
                if not self._has_assistant_for_turn(
                    session, turn_id
                ) or self._is_finalized(bridge_id):
                    continue
                detail = payload.get("detail") or "读取 ChatGPT 回复失败。"
                self._set_reply_error(session, turn_id, detail, "读取失败")
                self._finalize_bridge(bridge_id)
                continue
            continue
    def _render_inbound_log(self, items):
        if not items:
            self.event_log_edit.setPlainText("（暂无回传）")
            return
        lines = []
        for item in reversed(items):
            kind = item.get("kind", "?")
            if kind in ("open_url_success", "open_url_failed"):
                continue
            if kind == "ack" and not self._log_ack_events:
                continue
            if kind == "assistant_reply" and not self._log_assistant_reply_events:
                continue
            if kind == "send_failed" and not self._log_send_failed_events:
                continue
            ts = self._format_ts(item.get("time"))
            payload = item.get("payload") or {}
            event_id = item.get("event_id") or item.get("id") or "-"
            message_id = item.get("message_id") or "-"
            session_id = item.get("session_id") or "-"
            turn_id = item.get("turn_id") or "-"
            client_id = item.get("client_id") or "-"
            page_hint = ""
            if client_id and client_id != "-":
                pinfo = self._client_info_from_status(client_id)
                if pinfo:
                    page_hint = (
                        f" page_type={pinfo.get('page_type') or '-'} "
                        f"conv={pinfo.get('conversation_id') or '-'}"
                    )
            id_part = (
                f"event_id={event_id} message_id={message_id} "
                f"session_id={session_id} turn_id={turn_id} client_id={client_id}{page_hint}"
            )
            if self._show_raw_payload or self._debug_mode:
                lines.append(f"[{ts}] {kind} {id_part} payload={payload}")
            else:
                text = (
                    payload.get("text")
                    or payload.get("detail")
                    or payload.get("reason")
                    or ""
                )
                lines.append(f"[{ts}] {kind} {id_part} {text}")
        if not lines:
            self.event_log_edit.setPlainText("（暂无回传，或被调试过滤规则隐藏）")
            return
        self.event_log_edit.setPlainText("\n".join(lines))
    def _render_outbound(self, items):
        self.outbound_table.setRowCount(0)
        for item in reversed(items):
            if item.get("type") == "command":
                content = (
                    f"command:{item.get('command', '?')} "
                    f"{item.get('url', '')}"
                )
            else:
                content = item.get("content", "")
            target_client = (item.get("target_client_id") or "").strip()
            target_page = (item.get("target_page_url") or "").strip()
            if target_client or target_page:
                page_short = self._short_page_display(target_page) if target_page else "-"
                content = f"[→{target_client or '?'} @ {page_short}] {content}"
            if len(content) > 80:
                content = content[:80] + "..."
            row = self.outbound_table.rowCount()
            self.outbound_table.insertRow(row)
            ts = self._format_ts(
                item.get("acked_at")
                or item.get("delivered_at")
                or item.get("created_at")
            )
            message_id = item.get("id") or ""
            short_id = message_id[:8] + "…" if message_id else "-"
            self.outbound_table.setItem(row, 0, QTableWidgetItem(ts))
            self.outbound_table.setItem(row, 1, QTableWidgetItem(short_id))
            self.outbound_table.setItem(row, 2, QTableWidgetItem(item.get("status", "")))
            self.outbound_table.setItem(row, 3, QTableWidgetItem(content))
    def _refresh_status_tick(self):
        if server.is_server_running():
            self._apply_bridge_status(server.get_bridge_status())
    def _append_log(self, message):
        self.log_edit.append(str(message))
    def _update_running_ui(self, running):
        self.host_edit.setEnabled(not running)
        self.port_edit.setEnabled(not running)
        self.settings_start_btn.setEnabled(not running)
        self.settings_stop_btn.setEnabled(running)
        self.chat_quick_start_btn.setEnabled(not running)
        self.chat_quick_stop_btn.setEnabled(running)
    def _parse_port(self):
        raw = self.port_edit.text().strip()
        try:
            port = int(raw)
        except ValueError:
            self._set_settings_hint(f"端口错误：{raw} 不是数字。")
            return None
        if not (1 <= port <= 65535):
            self._set_settings_hint(f"端口错误：{port} 不在 1-65535 范围内。")
            return None
        return port
    def _start_server(self):
        host = self.host_edit.text().strip() or "127.0.0.1"
        port = self._parse_port()
        if port is None:
            return
        try:
            started = server.start_server(host, port)
        except Exception as error:
            detail = f"服务启动失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._add_system_message(f"服务启动失败：{error}")
            return
        if started:
            self._update_running_ui(True)
            self._apply_bridge_status(server.get_bridge_status())
            self._update_service_settings_status()
            self._add_system_message(f"服务已启动：http://{host}:{port}")
        else:
            self._add_system_message("服务已经在运行中。")
    def _stop_server(self):
        try:
            stopped = server.stop_server()
        except Exception as error:
            detail = f"服务停止失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._add_system_message(f"服务停止失败：{error}")
            return
        if stopped:
            self._update_running_ui(False)
            self._apply_bridge_status(server.get_bridge_status())
            self._update_service_settings_status()
            self._add_system_message("服务已停止。")
        else:
            self._add_system_message("服务当前没有运行。")
    def _push_message(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return
        content = self.message_edit.toPlainText().strip()
        if not content:
            self._add_system_message("请输入要发送的内容。")
            return
        session = self._ensure_current_session()
        raw_user_text = content
        final_prompt = content
        turn_id = str(uuid.uuid4())
        user_message_id = str(uuid.uuid4())
        assistant_message_id = str(uuid.uuid4())
        target_client_id, target_page_url, allowed, reason = (
            self._resolve_target_page_for_session(session)
        )
        self._append_log(f"[发送] {reason}")
        if not allowed:
            self._add_system_message(reason)
            return

        payload = {
            "session_id": session.session_id,
            "turn_id": turn_id,
            "raw_user_text": raw_user_text,
            "final_prompt": final_prompt,
        }
        remote = _normalize_remote_chatgpt(session.remote_chatgpt)
        if target_client_id:
            payload["target_client_id"] = target_client_id
        if target_page_url:
            payload["target_page_url"] = target_page_url
            payload["conversation_url"] = target_page_url
            conversation_id = (remote.get("conversation_id") or "").strip()
            if not conversation_id:
                conversation_id = _parse_conversation_id(target_page_url)
            if conversation_id:
                payload["conversation_id"] = conversation_id
            self._append_log(
                f"[发送] 目标 client_id={target_client_id} "
                f"conversation_id={payload.get('conversation_id') or '-'} "
                f"page={self._short_page_display(target_page_url)}"
            )
        try:
            msg = server.push_message(payload)
        except Exception as error:
            detail = f"消息入队失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._add_system_message(f"消息入队失败：{error}")
            return
        if not target_client_id:
            live_client = (
                self._last_bridge_status.get("tampermonkey_client_id") or ""
            ).strip()
            if live_client:
                self._remember_session_page_from_client(session, live_client)
        bridge_message_id = msg.get("id") if isinstance(msg, dict) else None
        if not bridge_message_id:
            self._add_system_message("服务端未返回 bridge_message_id，无法跟踪回复。")
            return
        self._message_to_session[bridge_message_id] = session.session_id
        self._message_to_turn[bridge_message_id] = turn_id
        if self._auto_name_new_chat and session.title == "新对话":
            session.title = raw_user_text[:20] + (
                "…" if len(raw_user_text) > 20 else ""
            )
        self._append_session_message(
            session,
            "user",
            raw_user_text,
            message_id=user_message_id,
            turn_id=turn_id,
            bridge_message_id=bridge_message_id,
            status="已加入队列",
        )
        if self._show_assistant_placeholder:
            self._append_session_message(
                session,
                "assistant",
                ASSISTANT_WAIT_TEXT,
                message_id=assistant_message_id,
                turn_id=turn_id,
                bridge_message_id=bridge_message_id,
                parent_message_id=user_message_id,
                status="等待中",
            )
        self._refresh_session_list(select_session_id=session.session_id)
        self._render_session_chat(session)
        self._save_sessions_to_disk()
        if self._auto_clear_input_after_send:
            self.message_edit.clear()
    def _copy_last_reply(self):
        session = self._current_session()
        text = self._last_assistant_text(session)
        if not text:
            self._add_system_message("当前没有可复制的 ChatGPT 回复。")
            return
        QApplication.clipboard().setText(text)
        self._add_system_message("已复制最后一条 ChatGPT 回复。")
    def closeEvent(self, event):
        self._save_sessions_to_disk()
        self._save_app_settings()
        if server.is_server_running():
            try:
                server.stop_server()
            except Exception as error:
                detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"
                print(detail)
                self._append_log(detail)
        event.accept()


def main():
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    app = QApplication(sys.argv)
    app.setFont(QFont("Microsoft YaHei UI", 10))
    window = MainWindow()
    window.show()
    if not window._current_session() or not window._current_session().messages:
        window._add_system_message(
            "请先启动服务，然后刷新 ChatGPT 页面并确认油猴脚本在线。"
        )
    sys.exit(app.exec_())
if __name__ == "__main__":
    main()
