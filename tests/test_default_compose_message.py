"""default_compose_message 已移除；DEFAULT_CHAT_INPUT_TEXT 为输入框默认文案。"""

from app.constants import DEFAULT_APP_SETTINGS, DEFAULT_CHAT_INPUT_TEXT
from app.ui.mixins.settings_mixin import SettingsMixin
from app.ui.mixins.ui_chat_panel_mixin import UiChatPanelMixin
from PyQt5.QtWidgets import QApplication, QTextEdit


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


class _SaveSettingsStub(SettingsMixin):
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
        self._sync_conversation_max_messages = 30
        self._sync_conversation_mode = "replace"

    def _read_settings_from_widgets(self):
        pass

    def _save_bool_settings(self):
        pass

    def _save_ui_settings(self):
        pass


def test_constants_no_default_compose_message():
    assert "default_compose_message" not in DEFAULT_APP_SETTINGS


def test_save_app_settings_removes_legacy_key():
    stub = _SaveSettingsStub({"default_compose_message": "你好"})
    stub._save_app_settings()
    assert "default_compose_message" in stub._settings._removed
    assert stub._settings.value("default_compose_message") is None


class _FakeInput:
    def __init__(self, text=""):
        self._text = text

    def toPlainText(self):
        return self._text

    def setPlainText(self, text):
        self._text = text

    def textCursor(self):
        return self

    def movePosition(self, *_args, **_kwargs):
        return None

    def setTextCursor(self, _cursor):
        return None


class _ComposeInputStub(UiChatPanelMixin):
    def __init__(self, *, use_qt=False):
        self._session_compose_drafts = {}
        if use_qt:
            app = QApplication.instance()
            if app is None:
                QApplication([])
            self.message_edit = QTextEdit()
        else:
            self.message_edit = _FakeInput()


def test_default_chat_input_text_constant():
    assert DEFAULT_CHAT_INPUT_TEXT == "你好"


def test_ensure_default_chat_input_text_only_when_empty():
    host = _ComposeInputStub()
    host._ensure_default_chat_input_text()
    assert host.message_edit.toPlainText() == "你好"
    host.message_edit.setPlainText("自定义")
    host._ensure_default_chat_input_text()
    assert host.message_edit.toPlainText() == "自定义"


def test_restore_session_compose_input_respects_draft():
    host = _ComposeInputStub()
    host._session_compose_drafts["s1"] = "草稿内容"
    host._restore_session_compose_input("s1")
    assert host.message_edit.toPlainText() == "草稿内容"


def test_restore_session_compose_input_falls_back_to_default():
    host = _ComposeInputStub()
    host.message_edit.setPlainText("")
    host._restore_session_compose_input("s2")
    assert host.message_edit.toPlainText() == "你好"
