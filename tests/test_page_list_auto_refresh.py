"""页面列表自动刷新与 page_url_from 导入修复。"""

from unittest.mock import MagicMock, patch

import pytest

from app.ui.main_window_state import PageSelectorState
from app.ui.mixins.page_binding_display_mixin import PageBindingDisplayMixin
from app.ui.mixins.page_open_close_mixin import PageOpenCloseMixin
from app.ui.mixins.page_registry_refresh_mixin import PageRegistryRefreshMixin


class _AutoRefreshHost(PageRegistryRefreshMixin, PageOpenCloseMixin):
    def __init__(self, *, combo_count=0, online=13, total=13, server_running=True):
        self._init_page_registry_refresh_state()
        self._page_selector = PageSelectorState()
        self._page_selector.refresh_in_progress = False
        self._page_selector.refresh_last_ms = 0
        self._page_selector.auto_refresh_failed = False
        self._logs = []
        self._refresh_called = False
        self._online = online
        self._total = total
        self._server_running = server_running
        self.tm_page_combo = MagicMock()
        self.tm_page_combo.count.return_value = combo_count

    def _append_log(self, message, echo=False):
        self._logs.append(message)

    def _tm_summary_for_session(self):
        return {
            "online_clients": self._online,
            "total_clients": self._total,
        }

    def schedule_page_registry_refresh(self, reason="auto"):
        self._refresh_called = True

    def _on_refresh_tm_pages(self):
        self._refresh_called = True


class _ShortLabelHost(PageBindingDisplayMixin):
    def _client_conversation_id(self, _info):
        return ""

    def _elide_middle(self, text, _max_len):
        return text


def test_auto_refresh_schedules_registry_when_server_running(monkeypatch):
    host = _AutoRefreshHost(combo_count=0, online=13, total=13)
    monkeypatch.setattr(
        "app.ui.mixins.page_open_close_mixin.server.is_server_running",
        lambda: host._server_running,
    )
    host._auto_refresh_tm_pages_if_needed("ui_ready")
    assert host._refresh_called is True


def test_auto_refresh_skips_when_server_stopped(monkeypatch):
    host = _AutoRefreshHost(combo_count=3, online=13, total=13, server_running=False)
    monkeypatch.setattr(
        "app.ui.mixins.page_open_close_mixin.server.is_server_running",
        lambda: False,
    )
    host._auto_refresh_tm_pages_if_needed("ui_ready")
    assert host._refresh_called is False


def test_short_page_label_uses_page_url_from():
    host = _ShortLabelHost()
    label = host._short_page_label(
        {"page_type": "conversation", "url": "https://chatgpt.com/c/abc123"}
    )
    assert "chatgpt.com" in label


def test_page_binding_display_imports_page_url_from():
    import app.ui.mixins.page_binding_display_mixin as mod

    assert "page_url_from" in mod.__dict__
