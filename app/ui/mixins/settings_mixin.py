import traceback

import server
from log_utils import append_log, clear_log_file

from app.constants import (
    DEFAULT_APP_SETTINGS,
    RUNTIME_DIR,
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
        self._force_new_session_after_turns = int(
            self._settings.value(
                "force_new_session_after_turns",
                defaults["force_new_session_after_turns"],
            )
            or 0
        )
        self._sync_full_conversation_enabled = self._qsettings_bool(
            self._settings.value("sync_full_conversation_enabled"),
            defaults["sync_full_conversation_enabled"],
        )
        self._auto_sync_conversation_on_bind = self._qsettings_bool(
            self._settings.value("auto_sync_conversation_on_bind"),
            defaults["auto_sync_conversation_on_bind"],
        )
        self._auto_sync_conversation_after_reply = self._qsettings_bool(
            self._settings.value("auto_sync_conversation_after_reply"),
            defaults["auto_sync_conversation_after_reply"],
        )
        self._sync_conversation_max_messages = int(
            self._settings.value(
                "sync_conversation_max_messages",
                defaults["sync_conversation_max_messages"],
            )
            or defaults["sync_conversation_max_messages"]
        )
        mode = str(
            self._settings.value(
                "sync_conversation_mode", defaults["sync_conversation_mode"]
            )
            or defaults["sync_conversation_mode"]
        ).strip().lower()
        self._sync_conversation_mode = mode if mode in ("merge", "replace") else "merge"
    def _force_ui_settings_to_defaults(self):
        defaults = DEFAULT_APP_SETTINGS
        self._chat_font_pt = int(defaults["font_size"])
        self._remember_window_geometry = bool(defaults["remember_window_geometry"])
        self._remember_window_position = bool(defaults["remember_window_position"])
        self._restore_main_tab = bool(defaults["restore_main_tab"])
        self._restore_chat_tab = bool(defaults["restore_chat_tab"])
        self._show_page_url = bool(defaults["show_page_url"])
        self._show_top_status_bar = bool(defaults["show_top_status_bar"])
    def _resolve_listen_host(self):
        if getattr(self, "_enable_lan_access", False):
            return "0.0.0.0"
        return "127.0.0.1"

    def _load_app_settings_values(self):
        defaults = DEFAULT_APP_SETTINGS
        try:
            saved_host = str(self._settings.value("host", defaults["host"])).strip()
            self._enable_lan_access = self._qsettings_bool(
                self._settings.value("enable_lan_access"),
                defaults["enable_lan_access"],
            )
            if saved_host in ("0.0.0.0", "::"):
                self._enable_lan_access = True
            self._host = self._resolve_listen_host()
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
            self._enable_lan_access = defaults["enable_lan_access"]
            self._host = self._resolve_listen_host()
            self._port_text = str(defaults["port"])
            self._auto_start_server = defaults["auto_start_server"]
            self._force_ui_settings_to_defaults()
            self._chat_sessions_path = defaults["chat_sessions_path"]
            self._save_chat_history = defaults["save_chat_history"]
        server.set_debug_mode(self._debug_mode)
    def _read_settings_from_widgets(self):
        if hasattr(self, "enable_lan_access_cb"):
            self._enable_lan_access = self.enable_lan_access_cb.isChecked()
        self._host = self._resolve_listen_host()
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
        if hasattr(self, "sync_full_conversation_enabled_cb"):
            self._sync_full_conversation_enabled = (
                self.sync_full_conversation_enabled_cb.isChecked()
            )
            self._auto_sync_conversation_on_bind = (
                self.auto_sync_conversation_on_bind_cb.isChecked()
            )
            self._auto_sync_conversation_after_reply = (
                self.auto_sync_conversation_after_reply_cb.isChecked()
            )
            self._sync_conversation_max_messages = int(
                self.sync_conversation_max_messages_spin.value()
            )
            mode = self.sync_conversation_mode_combo.currentData()
            self._sync_conversation_mode = (
                mode if mode in ("merge", "replace") else "merge"
            )
        self._chat_sessions_path = str(RUNTIME_DIR)
        self._save_chat_history = True
    def _save_app_settings(self):
        self._read_settings_from_widgets()
        self._settings.setValue("host", self._host)
        self._settings.setValue("enable_lan_access", self._enable_lan_access)
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
        self._settings.setValue(
            "force_new_session_after_turns",
            int(self._force_new_session_after_turns or 0),
        )
        self._settings.setValue(
            "sync_full_conversation_enabled", self._sync_full_conversation_enabled
        )
        self._settings.setValue(
            "auto_sync_conversation_on_bind", self._auto_sync_conversation_on_bind
        )
        self._settings.setValue(
            "auto_sync_conversation_after_reply",
            self._auto_sync_conversation_after_reply,
        )
        self._settings.setValue(
            "sync_conversation_max_messages", int(self._sync_conversation_max_messages)
        )
        self._settings.setValue("sync_conversation_mode", self._sync_conversation_mode)
        self._save_ui_settings()
    def _sync_page_url_detail_widgets(self):
        if not hasattr(self, "tm_live_page_label"):
            return
        if self._show_page_url:
            self._update_live_page_display()
            self._update_bound_page_display()
            return
        self.tm_live_page_label.setText(" ")
        self.tm_bound_page_label.setText(" ")
        if hasattr(self, "tm_bind_mismatch_label"):
            self.tm_bind_mismatch_label.setText(" ")
        if hasattr(self, "open_live_page_btn"):
            self.open_live_page_btn.setEnabled(False)
    def _apply_settings(self, immediate_only=False):
        self._read_settings_from_widgets()
        server.set_debug_mode(self._debug_mode)
        if getattr(self, "bridge_status_panel", None) is not None:
            self.bridge_status_panel.setVisible(self._show_top_status_bar)
        session = self._current_session()
        if session:
            self._render_session_chat(session)
        self._sync_page_url_detail_widgets()
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
        if hasattr(self, "enable_lan_access_cb"):
            self.enable_lan_access_cb.setChecked(self._enable_lan_access)
        self._update_listen_host_label()
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
        if hasattr(self, "sync_full_conversation_enabled_cb"):
            self.sync_full_conversation_enabled_cb.setChecked(
                self._sync_full_conversation_enabled
            )
            self.auto_sync_conversation_on_bind_cb.setChecked(
                self._auto_sync_conversation_on_bind
            )
            self.auto_sync_conversation_after_reply_cb.setChecked(
                self._auto_sync_conversation_after_reply
            )
            self.sync_conversation_max_messages_spin.setValue(
                int(self._sync_conversation_max_messages or 200)
            )
            idx = self.sync_conversation_mode_combo.findData(
                self._sync_conversation_mode
            )
            if idx >= 0:
                self.sync_conversation_mode_combo.setCurrentIndex(idx)
        self._update_input_placeholder()
    def _set_settings_hint(self, text):
        self.settings_hint_label.setText(text or "")
    def _set_tm_action_hint(self, text):
        text = (text or "").strip()
        self._set_settings_hint(text)
        if text:
            self.statusBar().showMessage(text, 8000)
    def _update_listen_host_label(self):
        if not hasattr(self, "listen_host_label"):
            return
        if self._enable_lan_access:
            self.listen_host_label.setText("0.0.0.0（全部网卡，局域网可访问）")
        else:
            self.listen_host_label.setText("127.0.0.1（仅本机）")

    def _on_enable_lan_access_changed(self, _checked=False):
        self._read_settings_from_widgets()
        self._update_listen_host_label()
        if hasattr(self, "tm_bridge_url_label"):
            self._update_tampermonkey_settings_labels(self._last_bridge_status)

    def _update_service_settings_status(self):
        if server.is_server_running():
            service_url = server.get_server_url() or "-"
            bridge_url = server.get_server_bridge_url() or "-"
            self.settings_service_status_label.setText(
                f"当前状态：运行中\n"
                f"服务地址：{service_url}\n"
                f"油猴填写：{bridge_url}"
            )
        elif getattr(self, "_server_start_failed", False):
            message = getattr(self, "_server_start_error", "") or "未知错误"
            self.settings_service_status_label.setText(
                f"当前状态：启动失败\n{message}"
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
