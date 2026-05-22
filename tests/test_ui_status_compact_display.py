"""主界面精简状态显示与 debug_mode 切换。"""

import pytest

from app.ui.mixins.ui_builder_mixin import UiBuilderMixin
from app.ui.mixins.ui_status_compact_mixin import UiStatusCompactMixin
from app.ui.main_window_state import init_main_window_states


class _Host(UiStatusCompactMixin, UiBuilderMixin):
    _debug_mode = False

    def __init__(self):
        init_main_window_states(self)

    def _page_is_online_for_ui(self, page):
        return bool(page.get("online"))

    def _page_is_online(self, page):
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

    def _tm_client_sync_profile(self, page):
        return {
            "conversation_syncable": page.get("conversation_syncable"),
            "send_decision": page.get("send_decision"),
            "reason_code": page.get("reason_code"),
            "response_state": page.get("response_state"),
        }


@pytest.fixture
def host():
    return _Host()


def test_short_id_and_url_helpers(host):
    assert host._short_id("abcdef", keep=12) == "abcdef"
    assert host._short_id("a" * 20, keep=12) == ("a" * 12) + "..."
    assert host._shorten_url_for_combo("") == "无URL"
    assert host._shorten_url_for_combo(
        "https://chatgpt.com/c/6a10768a-de10-83a6-8b4d-629fec09c77a"
    ) == "6a10768a-de1..."


def test_compact_page_option_label(host):
    page = {
        "online": True,
        "page_display_id": 2,
        "page_instance_id": "page-1779463753142-zxd2",
        "client_id": "tm-az9mrp8z",
        "conversation_id": "6a10768a-de10-83a6-8b4d-629fec09c77a",
        "url": "https://chatgpt.com/c/6a10768a-de10-83a6-8b4d-629fec09c77a",
    }
    label = host._format_tm_page_option_label(page)
    assert label.startswith("[在线][未绑定] 页面ID:2 | ")
    assert "chatgpt.com" in label
    assert "tm-az9mrp8z" not in label
    assert "page-1779463753142" not in label


def test_compact_page_combo_tooltip_has_full_fields(host):
    page = {
        "online": True,
        "page_display_id": 2,
        "client_id": "tm-az9mrp8z",
        "page_instance_id": "page-abc",
        "conversation_id": "conv-full-id",
        "url": "https://chatgpt.com/c/conv-full-id",
        "conversation_syncable": True,
        "send_now_available": False,
        "send_queueable": False,
        "send_requestable": False,
    }
    tip = host._format_compact_page_combo_tooltip(page)
    assert "页面 ID：2" in tip or "页面 ID: 2" in tip
    assert "https://chatgpt.com/c/conv-full-id" in tip
    assert "未绑定" in tip
    assert "https://chatgpt.com/c/conv-full-id" in tip


def test_compact_online_chip(host):
    text, state = host._format_compact_tm_online_chip(
        {"online_clients": 15, "total_clients": 20}
    )
    assert text == "页面：在线 15 / 总 20"
    assert state == "ok"


def test_compact_sync_and_send_chips(host):
    target = {
        "conversation_id": "conv-1",
        "page_type": "conversation",
        "online": True,
        "send_decision": "allowed",
    }
    sync_text, _ = host._format_compact_sync_chip(target, {})
    send_text, _ = host._format_compact_send_chip(target, {})
    assert sync_text == "同步：可同步"
    assert send_text == "发送：可发送"


def test_debug_mode_tooltip_includes_tech_ids(host):
    page = {
        "online": True,
        "page_display_id": 2,
        "client_id": "tm-1",
        "page_instance_id": "page-x",
        "conversation_id": "conv-1",
        "url": "https://chatgpt.com/c/conv-1",
    }
    host._debug_mode = True
    label = host._format_tm_page_option_label(page)
    assert label == "[在线][未绑定] 页面ID:2 | https://chatgpt.com/c/conv-1"
    tip = host._format_tm_page_option_tooltip(page)
    assert "client_id: tm-1" in tip
    assert "page_instance_id: page-x" in tip
