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
from PyQt5.QtGui import QDesktopServices, QFont
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
    QSizePolicy,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class SettingsMixin:
    @staticmethod
    def _qsettings_bool(value, default):
        if isinstance(value, bool):
            return value
        if value is None:
            return bool(default)
        return str(value).lower() in ("1", "true", "yes", "on")
    def _load_ui_and_bind_settings_from_qsettings(self):
        defaults = DEFAULT_APP_SETTINGS
        self._chat_font_pt = int(self._settings.value("font_size", defaults["font_size"]))
        self._remember_window_geometry = self._qsettings_bool(
            self._settings.value("remember_window_geometry"),
            defaults["remember_window_geometry"],
        )
        self._remember_window_position = self._qsettings_bool(
            self._settings.value("remember_window_position"),
            defaults["remember_window_position"],
        )
        self._restore_main_tab = self._qsettings_bool(
            self._settings.value("restore_main_tab"),
            defaults["restore_main_tab"],
        )
        self._restore_chat_tab = self._qsettings_bool(
            self._settings.value("restore_chat_tab"),
            defaults["restore_chat_tab"],
        )
        self._show_page_url = self._qsettings_bool(
            self._settings.value("show_page_url"),
            defaults["show_page_url"],
        )
        self._show_top_status_bar = self._qsettings_bool(
            self._settings.value("show_top_status_bar"),
            defaults["show_top_status_bar"],
        )
        self._debug_mode = self._qsettings_bool(
            self._settings.value("debug_mode"),
            defaults["debug_mode"],
        )
        self._show_raw_payload = self._qsettings_bool(
            self._settings.value("show_raw_payload"),
            defaults["show_raw_payload"],
        )
        self._log_ack_events = self._qsettings_bool(
            self._settings.value("log_ack_events"),
            defaults["log_ack_events"],
        )
        self._log_assistant_reply_events = self._qsettings_bool(
            self._settings.value("log_assistant_reply_events"),
            defaults["log_assistant_reply_events"],
        )
        self._log_send_failed_events = self._qsettings_bool(
            self._settings.value("log_send_failed_events"),
            defaults["log_send_failed_events"],
        )
        self._enter_send_mode = str(
            self._settings.value("enter_send_mode", defaults["enter_send_mode"])
        )
        self._auto_clear_input_after_send = self._qsettings_bool(
            self._settings.value("auto_clear_input_after_send"),
            defaults["auto_clear_input_after_send"],
        )
        self._auto_scroll_to_bottom = self._qsettings_bool(
            self._settings.value("auto_scroll_to_bottom"),
            defaults["auto_scroll_to_bottom"],
        )
        self._auto_name_new_chat = self._qsettings_bool(
            self._settings.value("auto_name_new_chat"),
            defaults["auto_name_new_chat"],
        )
        self._show_timestamp = self._qsettings_bool(
            self._settings.value("show_timestamp"),
            defaults["show_timestamp"],
        )
        self._show_assistant_placeholder = self._qsettings_bool(
            self._settings.value("show_assistant_placeholder"),
            defaults["show_assistant_placeholder"],
        )
        self._bind_each_chat_to_page = self._qsettings_bool(
            self._settings.value("bind_each_chat_to_page"),
            defaults["bind_each_chat_to_page"],
        )
        self._auto_bind_unbound_page = self._qsettings_bool(
            self._settings.value("auto_bind_unbound_page"),
            defaults["auto_bind_unbound_page"],
        )
        self._auto_open_bound_page_when_missing = self._qsettings_bool(
            self._settings.value("auto_open_bound_page_when_missing"),
            defaults["auto_open_bound_page_when_missing"],
        )
        self._allow_fallback_to_any_page = self._qsettings_bool(
            self._settings.value("allow_fallback_to_any_page"),
            defaults["allow_fallback_to_any_page"],
        )
        self._auto_open_and_bind_on_new_chat = self._qsettings_bool(
            self._settings.value("auto_open_and_bind_on_new_chat"),
            defaults["auto_open_and_bind_on_new_chat"],
        )
    def _force_ui_settings_to_defaults(self):
        defaults = DEFAULT_APP_SETTINGS
        self._chat_font_pt = int(defaults["font_size"])
        self._remember_window_geometry = bool(defaults["remember_window_geometry"])
        self._remember_window_position = bool(defaults["remember_window_position"])
        self._restore_main_tab = bool(defaults["restore_main_tab"])
        self._restore_chat_tab = bool(defaults["restore_chat_tab"])
        self._show_page_url = bool(defaults["show_page_url"])
        self._show_top_status_bar = bool(defaults["show_top_status_bar"])
    def _load_app_settings_values(self):
        defaults = DEFAULT_APP_SETTINGS
        try:
            self._host = str(self._settings.value("host", defaults["host"]))
            self._port_text = str(self._settings.value("port", defaults["port"]))
            self._auto_start_server = self._qsettings_bool(
                self._settings.value("auto_start_server"),
                defaults["auto_start_server"],
            )
            self._chat_sessions_path = str(RUNTIME_DIR)
            self._save_chat_history = True
            self._load_ui_and_bind_settings_from_qsettings()
        except Exception as error:
            detail = f"加载设置失败，已使用默认值：{error}\n{traceback.format_exc()}"
            append_log(detail, source="GUI", echo=True)
            defaults = DEFAULT_APP_SETTINGS
            self._host = defaults["host"]
            self._port_text = str(defaults["port"])
            self._auto_start_server = defaults["auto_start_server"]
            self._force_ui_settings_to_defaults()
            self._chat_sessions_path = defaults["chat_sessions_path"]
            self._save_chat_history = defaults["save_chat_history"]
    def _read_settings_from_widgets(self):
        self._host = self.host_edit.text().strip() or "127.0.0.1"
        self._port_text = self.port_edit.text().strip() or "5000"
        self._auto_start_server = self.auto_start_server_cb.isChecked()
        if hasattr(self, "bind_each_chat_to_page_cb"):
            self._bind_each_chat_to_page = (
                self.bind_each_chat_to_page_cb.isChecked()
            )
            self._auto_open_bound_page_when_missing = (
                self.auto_open_bound_page_when_missing_cb.isChecked()
            )
            self._allow_fallback_to_any_page = (
                self.allow_fallback_to_any_page_cb.isChecked()
            )
            self._auto_bind_unbound_page = self.auto_bind_unbound_page_cb.isChecked()
            self._auto_open_and_bind_on_new_chat = (
                self.auto_open_and_bind_on_new_chat_cb.isChecked()
            )
        self._chat_sessions_path = str(RUNTIME_DIR)
        self._save_chat_history = True
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
        self._settings.setValue(
            "bind_each_chat_to_page", self._bind_each_chat_to_page
        )
        self._settings.setValue(
            "auto_open_bound_page_when_missing",
            self._auto_open_bound_page_when_missing,
        )
        self._settings.setValue(
            "allow_fallback_to_any_page", self._allow_fallback_to_any_page
        )
        self._settings.setValue("auto_bind_unbound_page", self._auto_bind_unbound_page)
        self._settings.setValue(
            "auto_open_and_bind_on_new_chat",
            self._auto_open_and_bind_on_new_chat,
        )
        self._save_ui_settings()
    def _apply_settings(self, immediate_only=False):
        self._read_settings_from_widgets()
        server.set_debug_mode(self._debug_mode)
        if self._chat_status_group is not None:
            self._chat_status_group.setVisible(self._show_top_status_bar)
        if hasattr(self, "tm_live_page_label"):
            for widget in (
                self.tm_live_page_label,
                self.tm_bound_page_label,
                self.open_live_page_btn,
            ):
                widget.setVisible(self._show_page_url)
        session = self._current_session()
        if session:
            self._render_session_chat(session)
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
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
        ui_setting_keys = {
            "font_size",
            "remember_window_geometry",
            "remember_window_position",
            "restore_main_tab",
            "restore_chat_tab",
            "show_page_url",
            "show_top_status_bar",
        }
        for key, value in DEFAULT_APP_SETTINGS.items():
            if key in ui_setting_keys:
                continue
            if key == "port":
                self._port_text = str(value)
            else:
                setattr(self, f"_{key}", value)
        self._force_ui_settings_to_defaults()
        self._sync_settings_widgets_from_values()
        self._apply_settings(immediate_only=True)
        self._save_app_settings()
        self._set_settings_hint("已恢复默认设置。")
    def _sync_settings_widgets_from_values(self):
        self.host_edit.setText(self._host)
        self.port_edit.setText(self._port_text)
        self.auto_start_server_cb.setChecked(self._auto_start_server)
        if hasattr(self, "bind_each_chat_to_page_cb"):
            self.bind_each_chat_to_page_cb.setChecked(self._bind_each_chat_to_page)
            self.auto_open_bound_page_when_missing_cb.setChecked(
                self._auto_open_bound_page_when_missing
            )
            self.allow_fallback_to_any_page_cb.setChecked(
                self._allow_fallback_to_any_page
            )
            self.auto_bind_unbound_page_cb.setChecked(self._auto_bind_unbound_page)
            self.auto_open_and_bind_on_new_chat_cb.setChecked(
                self._auto_open_and_bind_on_new_chat
            )
        self._update_input_placeholder()
    def _set_settings_hint(self, text):
        self.settings_hint_label.setText(text or "")
    def _set_tm_action_hint(self, text):
        text = (text or "").strip()
        self._set_settings_hint(text)
        if text:
            self.statusBar().showMessage(text, 8000)
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
    def _clear_log_widget(self, widget, name):
        widget.clear()
        self._append_log(f"已清空{name}。")
        self._set_settings_hint(f"已清空{name}。")
    def _clear_runtime_log(self):
        clear_log_file()
        if hasattr(self, "log_edit") and self.log_edit is not None:
            self.log_edit.clear()
        self._append_log("已清空 log.txt。")
        self._set_settings_hint("已清空 log.txt。")
    def _on_save_settings_clicked(self):
        self._save_app_settings()
        self._apply_settings(immediate_only=False)
        self._set_settings_hint("设置已保存。")
    def _show_log_tab(self):
        index = self.main_tabs.indexOf(self.log_page)
        if index >= 0:
            self.main_tabs.setCurrentIndex(index)
