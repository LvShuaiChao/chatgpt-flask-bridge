from app.server import set_debug_mode

import traceback

from app.utils.log_utils import append_log, set_log_runtime_options

from app.constants import (
    CHAT_SESSIONS_DIR,
    DEFAULT_APP_SETTINGS,
)
# 无设置页 UI 的布尔项：仅用 DEFAULT_APP_SETTINGS 固定值，不写入 QSettings。
_ACTIVE_FIXED_BOOL_SETTING_ATTRS = (
    "remember_window_geometry",
    "remember_window_position",
    "restore_main_tab",
    "restore_chat_tab",
    "show_top_status_bar",
    "debug_mode",
    "mirror_log_to_console",
    "include_log_callsite",
    "auto_clear_input_after_send",
    "auto_name_new_chat",
    "show_timestamp",
    "show_assistant_placeholder",
)
# legacy cleanup only: 不再生成 self._xxx，仅保留 key 用于清理旧 QSettings。
_LEGACY_CLEANUP_ONLY_BOOL_SETTING_ATTRS = (
    "show_raw_payload",
    "log_ack_events",
    "log_assistant_reply_events",
    "log_send_failed_events",
)
_FIXED_BOOL_SETTING_ATTRS = (
    *_ACTIVE_FIXED_BOOL_SETTING_ATTRS,
    *_LEGACY_CLEANUP_ONLY_BOOL_SETTING_ATTRS,
)

FIXED_BRIDGE_BEHAVIOR_SETTINGS = {
    "bind_each_chat_to_page": True,
    # legacy cleanup only: 当前已无运行时消费者，保留 key 用于清理旧 QSettings。
    "auto_open_bound_page_when_missing": True,
    "auto_bind_unbound_page": True,
    # legacy cleanup only: 当前已无运行时消费者，保留 key 用于清理旧 QSettings。
    "sync_full_conversation_enabled": True,
    # legacy cleanup only: 当前已无运行时消费者，保留 key 用于清理旧 QSettings。
    "auto_sync_conversation_on_bind": False,
    # legacy cleanup only: 当前已无运行时消费者，保留 key 用于清理旧 QSettings。
    "auto_sync_conversation_after_reply": False,
    # legacy cleanup only: 当前已无运行时消费者，保留 key 用于清理旧 QSettings。
    "sync_conversation_mode": "replace",
    "sync_conversation_max_messages": 200,
}


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

    def _apply_fixed_bool_settings_from_defaults(self):
        defaults = DEFAULT_APP_SETTINGS
        for key in _ACTIVE_FIXED_BOOL_SETTING_ATTRS:
            setattr(self, f"_{key}", bool(defaults.get(key, False)))

    def _remove_legacy_bool_qsettings(self):
        if not hasattr(self, "_settings"):
            return
        for key in _FIXED_BOOL_SETTING_ATTRS:
            self._settings.remove(key)

    def _apply_fixed_bridge_behavior_settings(self):
        fixed = FIXED_BRIDGE_BEHAVIOR_SETTINGS
        self._bind_each_chat_to_page = bool(fixed["bind_each_chat_to_page"])
        self._auto_bind_unbound_page = bool(fixed["auto_bind_unbound_page"])
        self._sync_conversation_max_messages = int(
            fixed["sync_conversation_max_messages"]
        )

    def _remove_fixed_bridge_behavior_qsettings(self):
        if not hasattr(self, "_settings"):
            return
        for key in FIXED_BRIDGE_BEHAVIOR_SETTINGS:
            self._settings.remove(key)

    def _apply_fixed_service_settings(self):
        self._port_text = "5000"
        self._auto_start_server = True

    def _remove_fixed_service_qsettings(self):
        if not hasattr(self, "_settings"):
            return
        # host / enable_lan_access 当前已固定为 127.0.0.1，不再生成 self._host / self._enable_lan_access；
        # 这里保留 key，仅用于清理历史 QSettings。
        for key in (
            "host",
            "enable_lan_access",
            "port",
            "auto_start_server",
            "default_compose_message",
        ):
            self._settings.remove(key)

    def _load_ui_and_bind_settings_from_qsettings(self):
        defaults = DEFAULT_APP_SETTINGS
        self._chat_font_pt = self._safe_int(
            self._settings.value("font_size", defaults["font_size"]),
            defaults["font_size"],
            min_value=8,
            max_value=48,
            name="font_size",
        )
        self._apply_fixed_bool_settings_from_defaults()
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
        self._apply_fixed_bridge_behavior_settings()

    def _force_ui_settings_to_defaults(self):
        defaults = DEFAULT_APP_SETTINGS
        self._port_text = str(defaults.get("port", "5000"))
        self._auto_start_server = bool(defaults.get("auto_start_server", True))
        self._debug_mode = bool(defaults.get("debug_mode", False))
        self._mirror_log_to_console = bool(defaults.get("mirror_log_to_console", False))
        self._include_log_callsite = bool(defaults.get("include_log_callsite", False))
        self._chat_font_pt = int(defaults.get("font_size", 11))
        self._enter_send_mode = str(
            defaults.get("enter_send_mode", "enter_send")
        )
        self._force_new_session_after_turns = int(
            defaults.get("force_new_session_after_turns", 0)
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
        self._auto_clear_input_after_send = bool(
            defaults.get("auto_clear_input_after_send", True)
        )
        self._auto_name_new_chat = bool(defaults.get("auto_name_new_chat", True))
        self._show_timestamp = bool(defaults.get("show_timestamp", True))
        self._show_assistant_placeholder = bool(
            defaults.get("show_assistant_placeholder", True)
        )
        self._apply_fixed_bridge_behavior_settings()
    def _resolve_listen_host(self):
        return "127.0.0.1"

    def _load_app_settings_values(self):
        defaults = DEFAULT_APP_SETTINGS
        try:
            self._apply_fixed_service_settings()
            self._chat_sessions_path = str(CHAT_SESSIONS_DIR)
            self._save_chat_history = True
            self._load_ui_and_bind_settings_from_qsettings()
        except Exception as error:
            detail = f"加载设置失败，已使用默认值：{error}\n{traceback.format_exc()}"
            append_log(detail, source="GUI", echo=True)
            defaults = DEFAULT_APP_SETTINGS
            self._apply_fixed_service_settings()
            self._force_ui_settings_to_defaults()
            self._chat_sessions_path = defaults["chat_sessions_path"]
            self._save_chat_history = defaults["save_chat_history"]
        set_debug_mode(self._debug_mode)
        set_log_runtime_options(
            verbose=self._debug_mode,
            mirror_to_console=self._mirror_log_to_console,
            include_callsite=self._include_log_callsite,
        )
    def _read_settings_from_widgets(self):
        self._apply_fixed_service_settings()
        self._chat_sessions_path = str(CHAT_SESSIONS_DIR)
        self._save_chat_history = True
        set_log_runtime_options(
            verbose=self._debug_mode,
            mirror_to_console=self._mirror_log_to_console,
            include_callsite=self._include_log_callsite,
        )
        self._apply_fixed_bridge_behavior_settings()

    def _save_app_settings(self):
        self._read_settings_from_widgets()
        self._apply_fixed_bridge_behavior_settings()
        self._remove_fixed_bridge_behavior_qsettings()
        self._apply_fixed_service_settings()
        self._remove_fixed_service_qsettings()
        self._settings.setValue("font_size", self._chat_font_pt)
        self._remove_legacy_bool_qsettings()
        self._settings.setValue(
            "force_new_session_after_turns",
            int(self._force_new_session_after_turns or 0),
        )
        set_debug_mode(self._debug_mode)
        self._save_ui_settings()
    def _update_input_placeholder(self):
        edit = getattr(self, "message_edit", None)
        if edit is None:
            return
        if getattr(self, "_enter_send_mode", "enter_send") == "ctrl_enter_send":
            edit.setPlaceholderText("输入消息，Ctrl+Enter 发送，Enter 换行")
        else:
            edit.setPlaceholderText("输入消息，Enter 发送，Shift+Enter 换行")

    def _set_settings_hint(self, text):
        text = text or ""
        if text:
            self.statusBar().showMessage(text, 8000)

    def _set_tm_action_hint(self, text):
        self._tm_action_hint_base = (text or "").strip()
        if hasattr(self, "_apply_tm_action_hint_with_waiting"):
            self._apply_tm_action_hint_with_waiting()
            return
        text = self._tm_action_hint_base
        if text == getattr(self, "_last_tm_action_hint_text", None):
            return
        self._last_tm_action_hint_text = text
        self._set_settings_hint(text)
        if text:
            self.statusBar().showMessage(text, 8000)
