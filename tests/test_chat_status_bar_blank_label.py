"""顶部状态栏：空白页 chip 已移除，仅保留核心状态块。"""

import pytest

pytest.importorskip("PyQt5.QtWidgets")

from app.ui.mixins.ui_builder_mixin import UiBuilderMixin


class _SettingsStub:
    def value(self, key, default=None):
        return default


@pytest.fixture(scope="module")
def qapp():
    from PyQt5.QtWidgets import QApplication

    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app


class _Host(UiBuilderMixin):
    STATUS_DETAIL_EXPANDED_SETTING_KEY = "status_detail_expanded"

    def __init__(self):
        self._log_lines = []
        self._settings = _SettingsStub()
        self._show_top_status_bar = True

    @staticmethod
    def _qsettings_bool(value, default):
        return bool(default)

    def _append_log(self, line, echo=False):
        self._log_lines.append(line)

    def _start_server(self):
        pass

    def _stop_server(self):
        pass

    def show_bridge_detail_dialog(self, source="top_bar"):
        pass

    def _on_open_chatgpt_home(self):
        pass

    def _on_bind_current_page(self):
        pass

    def _on_open_bound_chatgpt_page(self):
        pass

    def __getattr__(self, name):
        if name.startswith("_on_") or name.startswith("_sync_"):
            return lambda *args, **kwargs: None
        raise AttributeError(name)


def test_status_bar_build_twice_without_error(qapp):
    host = _Host()
    bar1 = host._build_chat_status_bar()
    bar2 = host._build_chat_status_bar()
    assert bar1 is not None
    assert bar2 is not None


def test_top_status_bar_has_no_blank_home_or_queue_chips(qapp):
    host = _Host()
    host._build_chat_status_bar()
    assert not hasattr(host, "tm_blank_home_label")
    assert not hasattr(host, "tm_queue_label")
    assert not hasattr(host, "job_status_chip")
    assert hasattr(host, "status_label")
    assert hasattr(host, "tm_online_label")
    assert hasattr(host, "tm_bound_page_label")
    assert hasattr(host, "tm_sync_target_label")
    assert hasattr(host, "cursor_bridge_status_label")


def test_collect_monkey_stats_without_blank_home_label_widget(qapp):
    from app.ui.mixins.page_tm_client_mixin import PageTmClientMixin

    class _Updater(_Host, PageTmClientMixin):
        def _collect_monkey_window_binding_stats(self, status=None):
            return {
                "blank_home_total": 2,
                "blank_home_online": 2,
                "blank_home_available": 2,
                "blank_home_bound": 0,
                "blank_home_available_labels": [],
                "blank_home_bound_labels": [],
            }

    host = _Updater()
    host._build_chat_status_bar()
    stats = host._collect_monkey_window_binding_stats()
    assert stats["blank_home_total"] == 2
    assert not hasattr(host, "_update_tm_blank_home_label")
