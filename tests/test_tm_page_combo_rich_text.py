"""页面下拉：精简标签与 tooltip。"""

import pytest

from app.ui.mixins.ui_builder_mixin import UiBuilderMixin
from app.ui.mixins.ui_status_compact_mixin import UiStatusCompactMixin


class _Host(UiStatusCompactMixin, UiBuilderMixin):
    _debug_mode = False

    def _page_is_online(self, page):
        return bool(page.get("online"))

    def _page_is_online_for_ui(self, page):
        return bool(page.get("online"))

    def _page_full_url(self, page):
        return page.get("url") or ""

    def _page_chatgpt_conversation_id(self, page):
        return page.get("conversation_id") or ""

    def _client_conversation_id(self, page):
        return page.get("conversation_id") or ""

    def _is_debug_mode_enabled(self):
        return bool(self._debug_mode)

    def _current_session(self):
        return None


@pytest.fixture
def host():
    return _Host()


def test_format_tm_page_option_label_compact(host):
    page = {
        "online": True,
        "page_display_id": 3,
        "client_id": "tm-1",
        "url": "https://chatgpt.com/c/abc",
    }
    text = host._format_tm_page_option_label(page)
    assert text == "[在线][未绑定] 页面ID:3 | https://chatgpt.com/c/abc"
    assert "tm-1" not in text


def test_format_tm_page_option_tooltip(host):
    page = {
        "online": True,
        "page_display_id": 2,
        "client_id": "tm-az9mrp8z",
        "page_instance_id": "page-abc",
        "conversation_id": "conv-full-id",
        "url": "https://chatgpt.com/c/conv-full-id",
    }
    tip = host._format_tm_page_option_tooltip(page)
    assert "页面ID: 2" in tip
    assert "绑定: 未绑定" in tip
    assert "client_id" not in tip


def test_format_tm_page_option_tooltip_verbose_includes_tech_ids(host):
    host._debug_mode = True
    page = {
        "online": True,
        "page_display_id": 2,
        "client_id": "tm-az9mrp8z",
        "page_instance_id": "page-abc",
        "conversation_id": "conv-full-id",
        "url": "https://chatgpt.com/c/conv-full-id",
    }
    tip = host._format_tm_page_option_tooltip(page)
    assert "client_id: tm-az9mrp8z" in tip
    assert "page_instance_id: page-abc" in tip
