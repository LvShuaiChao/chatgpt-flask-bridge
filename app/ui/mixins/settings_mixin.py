import time
import traceback

import server
from log_utils import append_log, set_log_runtime_options

from app.constants import (
    DEFAULT_APP_SETTINGS,
    RUNTIME_DIR,
)

BOOL_SETTING_BINDINGS = {
    "remember_window_geometry": "_remember_window_geometry",
    "remember_window_position": "_remember_window_position",
    "restore_main_tab": "_restore_main_tab",
    "restore_chat_tab": "_restore_chat_tab",
    "show_top_status_bar": "_show_top_status_bar",
    "debug_mode": "_debug_mode",
    "show_raw_payload": "_show_raw_payload",
    "mirror_log_to_console": "_mirror_log_to_console",
    "include_log_callsite": "_include_log_callsite",
    "log_ack_events": "_log_ack_events",
    "log_assistant_reply_events": "_log_assistant_reply_events",
    "log_send_failed_events": "_log_send_failed_events",
    "auto_clear_input_after_send": "_auto_clear_input_after_send",
    "auto_name_new_chat": "_auto_name_new_chat",
    "show_timestamp": "_show_timestamp",
    "show_assistant_placeholder": "_show_assistant_placeholder",
    "bind_each_chat_to_page": "_bind_each_chat_to_page",
    "auto_open_bound_page_when_missing": "_auto_open_bound_page_when_missing",
    "allow_fallback_to_any_page": "_allow_fallback_to_any_page",
    "auto_bind_unbound_page": "_auto_bind_unbound_page",
    "upload_before_send_enabled": "_upload_before_send_enabled",
    "sync_full_conversation_enabled": "_sync_full_conversation_enabled",
    "auto_sync_conversation_on_bind": "_auto_sync_conversation_on_bind",
    "auto_sync_conversation_after_reply": "_auto_sync_conversation_after_reply",
}

BOOL_SETTING_SAVE_KEYS = frozenset({
    "remember_window_geometry",
    "remember_window_position",
    "restore_main_tab",
    "restore_chat_tab",
    "show_top_status_bar",
    "debug_mode",
    "show_raw_payload",
    "mirror_log_to_console",
    "include_log_callsite",
    "log_ack_events",
    "log_assistant_reply_events",
    "log_send_failed_events",
    "auto_clear_input_after_send",
    "auto_name_new_chat",
    "show_timestamp",
    "show_assistant_placeholder",
    "bind_each_chat_to_page",
    "auto_open_bound_page_when_missing",
    "allow_fallback_to_any_page",
    "auto_bind_unbound_page",
    "upload_before_send_enabled",
    "sync_full_conversation_enabled",
    "auto_sync_conversation_on_bind",
    "auto_sync_conversation_after_reply",
})


class SettingsMixin:
    @staticmethod
    def _safe_int(value, default, min_value=None, max_value=None, name="unknown"):
        try:
            result = int(value)
        except (TypeError, ValueError) as error:
            append_log(
                "[SETTINGS][SAFE_INT_FALLBACK] "
                "function=_safe_int "
                f"name={name} "
                f"value={value!r} "
                f"default={default!r} "
                f"min_value={min_value!r} "
                f"max_value={max_value!r} "
                f"error_type={type(error).__name__} "
                f"error={error}",
                source="GUI",
                echo=True,
            )
            try:
                result = int(default)
            except (TypeError, ValueError) as default_error:
                append_log(
                    "[SETTINGS][SAFE_INT_DEFAULT_INVALID] "
                    f"name={name} default={default!r} "
                    f"error_type={type(default_error).__name__} error={default_error}",
                    source="GUI",
                    echo=True,
                )
                result = 0
        if min_value is not None:
            result = max(min_value, result)
        if max_value is not None:
            result = min(max_value, result)
        return result

    @staticmethod
    def _qsettings_bool(value, default):
        if isinstance(value, bool):
            return value
        if value is None:
            return bool(default)
        return str(value).lower() in ("1", "true", "yes", "on")
    def _load_bool_settings(self):
        defaults = DEFAULT_APP_SETTINGS
        for key, attr in BOOL_SETTING_BINDINGS.items():
            setattr(
                self,
                attr,
                self._qsettings_bool(
                    self._settings.value(key),
                    defaults[key],
                ),
            )

    def _save_bool_settings(self):
        for key in BOOL_SETTING_SAVE_KEYS:
            attr = BOOL_SETTING_BINDINGS[key]
            self._settings.setValue(key, bool(getattr(self, attr)))

    def _load_ui_and_bind_settings_from_qsettings(self):
        defaults = DEFAULT_APP_SETTINGS
        self._chat_font_pt = self._safe_int(
            self._settings.value("font_size", defaults["font_size"]),
            defaults["font_size"],
            min_value=8,
            max_value=48,
            name="font_size",
        )
        self._load_bool_settings()
        self._enter_send_mode = str(
            self._settings.value("enter_send_mode", defaults["enter_send_mode"])
        )
        self._force_new_session_after_turns = self._safe_int(
            self._settings.value(
                "force_new_session_after_turns",
                defaults["force_new_session_after_turns"],
            ),
            defaults["force_new_session_after_turns"],
            min_value=0,
            max_value=999,
            name="force_new_session_after_turns",
        )
        self._sync_conversation_max_messages = self._safe_int(
            self._settings.value(
                "sync_conversation_max_messages",
                defaults["sync_conversation_max_messages"],
            ),
            defaults["sync_conversation_max_messages"],
            min_value=1,
            max_value=999,
            name="sync_conversation_max_messages",
        )
        mode = str(
            self._settings.value(
                "sync_conversation_mode", defaults["sync_conversation_mode"]
            )
            or defaults["sync_conversation_mode"]
        ).strip().lower()
        default_mode = defaults["sync_conversation_mode"]
        self._sync_conversation_mode = (
            mode if mode in ("merge", "replace") else default_mode
        )
        self._default_compose_message = str(
            self._settings.value(
                "default_compose_message",
                defaults["default_compose_message"],
            )
            or defaults["default_compose_message"]
        )
    def _force_ui_settings_to_defaults(self):
        defaults = DEFAULT_APP_SETTINGS
        self._enable_lan_access = bool(defaults.get("enable_lan_access", False))
        self._host = str(defaults.get("host", "127.0.0.1"))
        self._port_text = str(defaults.get("port", 16666))
        self._auto_start_server = bool(defaults.get("auto_start_server", False))
        self._debug_mode = bool(defaults.get("debug_mode", False))
        self._show_raw_payload = bool(defaults.get("show_raw_payload", False))
        self._mirror_log_to_console = bool(defaults.get("mirror_log_to_console", True))
        self._include_log_callsite = bool(defaults.get("include_log_callsite", True))
        self._bind_each_chat_to_page = bool(
            defaults.get("bind_each_chat_to_page", True)
        )
        self._chat_font_pt = int(defaults.get("font_size", 11))
        self._enter_send_mode = str(
            defaults.get("enter_send_mode", "enter_send")
        )
        self._force_new_session_after_turns = int(
            defaults.get("force_new_session_after_turns", 0)
        )
        self._sync_full_conversation_enabled = bool(
            defaults.get("sync_full_conversation_enabled", True)
        )
        self._auto_sync_conversation_on_bind = bool(
            defaults.get("auto_sync_conversation_on_bind", False)
        )
        self._auto_sync_conversation_after_reply = bool(
            defaults.get("auto_sync_conversation_after_reply", False)
        )
        self._sync_conversation_max_messages = int(
            defaults.get("sync_conversation_max_messages", 30)
        )
        self._sync_conversation_mode = str(
            defaults.get("sync_conversation_mode", "replace")
        )
        self._remember_window_geometry = bool(
            defaults.get("remember_window_geometry", True)
        )
        self._remember_window_position = bool(
            defaults.get("remember_window_position", True)
        )
        self._restore_main_tab = bool(defaults.get("restore_main_tab", True))
        self._restore_chat_tab = bool(defaults.get("restore_chat_tab", True))
        self._show_top_status_bar = bool(defaults.get("show_top_status_bar", True))
        self._log_ack_events = bool(defaults.get("log_ack_events", True))
        self._log_assistant_reply_events = bool(
            defaults.get("log_assistant_reply_events", True)
        )
        self._log_send_failed_events = bool(
            defaults.get("log_send_failed_events", True)
        )
        self._auto_clear_input_after_send = bool(
            defaults.get("auto_clear_input_after_send", True)
        )
        self._auto_name_new_chat = bool(defaults.get("auto_name_new_chat", True))
        self._show_timestamp = bool(defaults.get("show_timestamp", True))
        self._show_assistant_placeholder = bool(
            defaults.get("show_assistant_placeholder", True)
        )
        self._auto_open_bound_page_when_missing = bool(
            defaults.get("auto_open_bound_page_when_missing", True)
        )
        self._allow_fallback_to_any_page = bool(
            defaults.get("allow_fallback_to_any_page", False)
        )
        self._auto_bind_unbound_page = bool(
            defaults.get("auto_bind_unbound_page", True)
        )
        self._upload_before_send_enabled = bool(
            defaults.get("upload_before_send_enabled", False)
        )
        self._default_compose_message = str(
            defaults.get("default_compose_message", "")
        )
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
        set_log_runtime_options(
            verbose=self._debug_mode,
            mirror_to_console=self._mirror_log_to_console,
            include_callsite=self._include_log_callsite,
        )
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
        if hasattr(self, "upload_before_send_enabled_cb"):
            self._upload_before_send_enabled = (
                self.upload_before_send_enabled_cb.isChecked()
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
            default_mode = DEFAULT_APP_SETTINGS["sync_conversation_mode"]
            self._sync_conversation_mode = (
                mode if mode in ("merge", "replace") else default_mode
            )
        self._chat_sessions_path = str(RUNTIME_DIR)
        self._save_chat_history = True
        if hasattr(self, "default_compose_message_edit"):
            self._default_compose_message = (
                self.default_compose_message_edit.toPlainText()
            )
        if hasattr(self, "debug_mode_cb"):
            self._debug_mode = self.debug_mode_cb.isChecked()
        if hasattr(self, "show_raw_payload_cb"):
            self._show_raw_payload = self.show_raw_payload_cb.isChecked()
        if hasattr(self, "mirror_log_to_console_cb"):
            self._mirror_log_to_console = self.mirror_log_to_console_cb.isChecked()
        if hasattr(self, "include_log_callsite_cb"):
            self._include_log_callsite = self.include_log_callsite_cb.isChecked()
        set_log_runtime_options(
            verbose=self._debug_mode,
            mirror_to_console=self._mirror_log_to_console,
            include_callsite=self._include_log_callsite,
        )
    def _save_app_settings(self):
        self._read_settings_from_widgets()
        self._settings.setValue("host", self._host)
        self._settings.setValue("enable_lan_access", self._enable_lan_access)
        self._settings.setValue("port", self._port_text)
        self._settings.setValue("auto_start_server", self._auto_start_server)
        self._settings.setValue("font_size", self._chat_font_pt)
        self._save_bool_settings()
        self._settings.setValue(
            "force_new_session_after_turns",
            int(self._force_new_session_after_turns or 0),
        )
        self._settings.setValue(
            "sync_conversation_max_messages", int(self._sync_conversation_max_messages)
        )
        self._settings.setValue("sync_conversation_mode", self._sync_conversation_mode)
        self._settings.setValue(
            "default_compose_message",
            getattr(self, "_default_compose_message", "") or "",
        )
        server.set_debug_mode(self._debug_mode)
        self._save_ui_settings()
    def _sync_page_url_detail_widgets(self):
        if not hasattr(self, "tm_bound_page_label"):
            return
        self._update_live_page_display()
        self._update_bound_page_display()
    def _apply_settings(self, immediate_only=False):
        self._read_settings_from_widgets()
        server.set_debug_mode(self._debug_mode)
        if getattr(self, "bridge_status_panel", None) is not None:
            self.bridge_status_panel.setVisible(self._show_top_status_bar)
        session = self._current_session()
        if session:
            self._render_session_chat(session)
        self._sync_page_url_detail_widgets()
        if hasattr(self, "_sync_bridge_status_panel_height"):
            self._sync_bridge_status_panel_height()
        self._apply_chat_bind_visual_state()
        if self.message_edit.placeholderText():
            self._update_input_placeholder()
        self._apply_default_compose_message_if_empty()
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
        if hasattr(self, "upload_before_send_enabled_cb"):
            self.upload_before_send_enabled_cb.setChecked(
                self._upload_before_send_enabled
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
        if hasattr(self, "default_compose_message_edit"):
            self.default_compose_message_edit.setPlainText(
                getattr(self, "_default_compose_message", "") or ""
            )
        if hasattr(self, "debug_mode_cb"):
            self.debug_mode_cb.setChecked(self._debug_mode)
        if hasattr(self, "show_raw_payload_cb"):
            self.show_raw_payload_cb.setChecked(self._show_raw_payload)
        if hasattr(self, "mirror_log_to_console_cb"):
            self.mirror_log_to_console_cb.setChecked(self._mirror_log_to_console)
        if hasattr(self, "include_log_callsite_cb"):
            self.include_log_callsite_cb.setChecked(self._include_log_callsite)
    def _default_compose_message_text(self):
        return (getattr(self, "_default_compose_message", "") or "").strip()

    def _apply_default_compose_message_if_empty(self):
        text = self._default_compose_message_text()
        if not text:
            return
        edit = getattr(self, "message_edit", None)
        if edit is None:
            return
        if (edit.toPlainText() or "").strip():
            return
        edit.setPlainText(text)
    def _set_settings_hint(self, text):
        self.settings_hint_label.setText(text or "")
    def _set_tm_action_hint(self, text):
        text = (text or "").strip()
        if text == getattr(self, "_last_tm_action_hint_text", None):
            return
        self._last_tm_action_hint_text = text
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
        self._schedule_status_apply(status, reason="settings_refresh", force=True)
        if status.get("tampermonkey_online"):
            self._set_settings_hint("油猴在线。")
        elif status.get("tampermonkey_last_seen"):
            self._set_settings_hint("油猴离线（曾连接过）。")
        else:
            self._set_settings_hint("油猴未连接。")
        session = self._current_session() if hasattr(self, "_current_session") else None
        if session is not None and hasattr(self, "_try_send_next_queued_message"):
            self._try_send_next_queued_message(session)
    def _restart_server_with_settings(self):
        if server.is_server_running():
            self._stop_server()
        self._start_server()
    def _clear_log_widget(self, widget, name):
        if widget is None:
            msg = f"清空{name}失败：未找到日志控件。"
            self._append_log(f"[LOG_CLEAR][FAILED] name={name} reason=no_widget", echo=True)
            self._set_tm_action_hint(msg)
            return
        try:
            widget.clear()
        except Exception as exc:
            import traceback

            detail = f"{exc}\n{traceback.format_exc()}"
            msg = f"清空{name}失败：{exc}"
            self._append_log(
                f"[LOG_CLEAR][FAILED] name={name} error={detail}",
                echo=True,
            )
            print(f"[LOG_CLEAR][FAILED] name={name} error={detail}")
            self._set_tm_action_hint(msg)
            return
        self._append_log(f"已清空{name}。", echo=True)
        self._set_tm_action_hint(f"已清空{name}")

    def _on_clear_runtime_log_clicked(self):
        now = time.time()
        last_at = float(getattr(self, "_last_clear_log_at", 0.0) or 0.0)
        if now - last_at < 1.0:
            return
        self._last_clear_log_at = now
        self._clear_runtime_log()

    def _clear_runtime_log(self):
        import traceback
        from pathlib import Path

        from log_utils import LOG_FILE, _LOG_LOCK, get_log_file_path

        log_path = get_log_file_path()
        try:
            with _LOG_LOCK:
                path = Path(log_path) if log_path else LOG_FILE
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("", encoding="utf-8")
        except Exception as exc:
            detail = f"{exc}\n{traceback.format_exc()}"
            msg = f"清空运行日志失败：{exc}"
            self._append_log(
                f"[LOG_CLEAR][FAILED] path={log_path} error={detail}",
                echo=True,
            )
            print(f"[LOG_CLEAR][FAILED] path={log_path} error={detail}")
            self._set_tm_action_hint(msg)
            return

        if hasattr(self, "log_edit") and self.log_edit is not None:
            self.log_edit.clear()
        if hasattr(self, "_loaded_log_lines"):
            self._loaded_log_lines = []
        if hasattr(self, "_log_tab_loaded"):
            self._log_tab_loaded = False
        if hasattr(self, "_runtime_log_loaded_once"):
            self._runtime_log_loaded_once = False
        self._append_log("已清空运行日志。", echo=True)
        self._set_tm_action_hint("已清空运行日志")
    def _on_save_settings_clicked(self):
        self._save_app_settings()
        self._apply_settings(immediate_only=False)
        self._set_settings_hint("设置已保存。")
