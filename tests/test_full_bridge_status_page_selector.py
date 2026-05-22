"""页面下拉框完整 bridge status 兜底与空列表文案。"""

from unittest.mock import MagicMock

import pytest

from app.ui.mixins.ui_page_selector_mixin import UiPageSelectorMixin
from app.ui.main_window_state import init_main_window_states


class _PageSelectorHost(UiPageSelectorMixin):
    def __init__(self):
        init_main_window_states(self)
        self._bridge_ui.last_bridge_status = {}
        self._logs = []
        self.tm_page_combo = MagicMock()
        self.tm_page_combo.count.return_value = 0
        self.tm_page_empty_label = MagicMock()
        self.refresh_page_list_btn = MagicMock()
        self.bind_current_page_btn = MagicMock()

    def _append_log(self, message, echo=False):
        self._logs.append(message)

    def _tm_summary_for_session(self):
        return {"online_clients": 13, "total_clients": 13}


def test_bridge_status_has_page_sources():
    host = _PageSelectorHost()
    assert host._bridge_status_has_page_sources({"pages": []}) is True
    assert host._bridge_status_has_page_sources({"server_running": True}) is False
    assert host._bridge_status_has_page_sources(None) is False


def test_full_bridge_status_fetches_live_when_lightweight(monkeypatch):
    host = _PageSelectorHost()
    live = {"pages": [{"client_id": "c1"}]}
    monkeypatch.setattr(
        "app.ui.mixins.ui_page_selector_mixin.is_server_running", lambda: True
    )
    monkeypatch.setattr(
        "app.ui.mixins.ui_page_selector_mixin.get_bridge_status", lambda: live
    )
    result = host._full_bridge_status_for_page_selector({"server_running": True})
    assert result is live
    assert host._bridge_ui.last_bridge_status is live


def test_sync_empty_ui_shows_placeholder_when_no_pages(monkeypatch):
    host = _PageSelectorHost()
    host.tm_page_combo.count.return_value = 0
    host._sync_tm_page_list_empty_ui()
    hint = host.tm_page_empty_label.setText.call_args[0][0]
    assert "暂无可用页面" in hint
    assert "ChatGPT" in hint


def test_sync_empty_ui_shows_no_pages_when_offline():
    host = _PageSelectorHost()
    host.tm_page_combo.count.return_value = 0
    host._bridge_ui.last_bridge_status = {"bridge_url": "http://127.0.0.1:5000/api/bridge"}
    host._sync_tm_page_list_empty_ui()
    hint = host.tm_page_empty_label.setText.call_args[0][0]
    assert "暂无可用页面" in hint
    assert "http://127.0.0.1:5000/api/bridge" in hint


def test_sync_empty_ui_keeps_refresh_enabled_and_bind_disabled_without_pages():
    host = _PageSelectorHost()
    host.tm_page_combo.count.return_value = 0
    host._page_registry_refresh_in_progress = False
    host._sync_tm_page_list_empty_ui()
    host.refresh_page_list_btn.setEnabled.assert_called_with(True)
    host.refresh_page_list_btn.setVisible.assert_called_with(True)
    host.bind_current_page_btn.setEnabled.assert_called_with(False)
    host.bind_current_page_btn.setVisible.assert_called_with(True)


def test_sync_empty_ui_enables_bind_when_pages_available():
    host = _PageSelectorHost()
    host.tm_page_combo.count.return_value = 2
    online_page = {"client_id": "c1", "last_seen": __import__("time").time()}
    host._get_selected_tm_page_from_combo = MagicMock(return_value=online_page)
    host._page_is_online_for_ui = MagicMock(return_value=True)
    host._sync_tm_page_list_empty_ui()
    host.bind_current_page_btn.setEnabled.assert_called_with(True)
