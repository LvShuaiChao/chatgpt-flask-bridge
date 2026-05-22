"""页面绑定/上传/同步固定默认值与 QSettings 遗留键清理。"""

from app.constants import DEFAULT_APP_SETTINGS
from app.ui.mixins.settings_mixin import (
    FIXED_BRIDGE_BEHAVIOR_SETTINGS,
    SettingsMixin,
)


class _FakeQSettings:
    def __init__(self, data=None):
        self._data = dict(data or {})
        self._removed = []

    def value(self, key, default=None):
        if key in self._data:
            return self._data[key]
        return default

    def setValue(self, key, value):
        self._data[key] = value

    def remove(self, key):
        self._removed.append(key)
        self._data.pop(key, None)


class _SettingsStub(SettingsMixin):
    def __init__(self, settings_data=None):
        self._settings = _FakeQSettings(settings_data)
        self._host = "127.0.0.1"
        self._enable_lan_access = False
        self._port_text = "5000"
        self._auto_start_server = False
        self._chat_font_pt = 11
        self._debug_mode = False
        self._mirror_log_to_console = True
        self._include_log_callsite = True
        self._force_new_session_after_turns = 0

    def _read_settings_from_widgets(self):
        pass

    def _save_bool_settings(self):
        pass

    def _save_ui_settings(self):
        pass


def test_fixed_bridge_keys_not_in_default_app_settings():
    for key in FIXED_BRIDGE_BEHAVIOR_SETTINGS:
        assert key not in DEFAULT_APP_SETTINGS


def test_load_overrides_legacy_qsettings():
    legacy = {
        key: (not value if isinstance(value, bool) else 999)
        for key, value in FIXED_BRIDGE_BEHAVIOR_SETTINGS.items()
    }
    stub = _SettingsStub(legacy)
    stub._load_ui_and_bind_settings_from_qsettings()
    for key, value in FIXED_BRIDGE_BEHAVIOR_SETTINGS.items():
        assert getattr(stub, f"_{key}") == value


def test_save_removes_fixed_keys_from_qsettings():
    stub = _SettingsStub(
        {
            "bind_each_chat_to_page": False,
            "sync_conversation_max_messages": 200,
            "sync_conversation_mode": "replace",
        }
    )
    stub._save_app_settings()
    for key in FIXED_BRIDGE_BEHAVIOR_SETTINGS:
        assert key in stub._settings._removed
        assert key not in stub._settings._data
