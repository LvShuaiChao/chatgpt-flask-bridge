"""页面下拉 / 绑定行分段配色数据。"""

import pytest
from PyQt5.QtGui import QColor

from app.ui.mixins.ui_builder_mixin import UiBuilderMixin
from app.ui.mixins.ui_status_compact_mixin import UiStatusCompactMixin
from app.ui.page_display_segments import (
    COLOR_BIND_BOUND,
    COLOR_BIND_UNBOUND,
    COLOR_ONLINE,
    COLOR_PAGE_ID,
    COLOR_URL,
    bind_tag_color,
    liveness_tag_color,
    segment_color,
)


class _BridgeUiStub:
    last_bridge_status = {}


class _Host(UiStatusCompactMixin, UiBuilderMixin):
    _debug_mode = False
    _bridge_ui = _BridgeUiStub()

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
        return False

    def _current_session(self):
        return None


@pytest.fixture
def host():
    return _Host()


def test_tm_page_option_display_segments_roles(host):
    page = {
        "online": True,
        "page_display_id": 3,
        "url": "https://chatgpt.com/c/abc",
    }
    segments = host._tm_page_option_display_segments(page)
    roles = [seg["role"] for seg in segments]
    assert roles == ["liveness", "bind", "page_id", "separator", "url"]
    assert segments[2]["text"] == " 页面ID:3"
    assert segments[0]["tag"] == "在线"
    assert segments[4].get("elide") is True


def test_format_bound_page_line_segments(host):
    segments = host._format_bound_page_line_segments(
        2, url="https://chatgpt.com/c/x"
    )
    assert segments[1]["text"] == "页面ID:2"
    assert segments[1]["role"] == "page_id"
    assert segments[3]["role"] == "url"


def test_segment_colors_distinct():
    online = liveness_tag_color("在线")
    offline = liveness_tag_color("离线")
    page_id = segment_color({"role": "page_id"})
    url = segment_color({"role": "url"})
    assert online.name() != page_id.name()
    assert url.name() != page_id.name()
    assert offline.name() != online.name()
    assert bind_tag_color("已绑定").name() != bind_tag_color("未绑定").name()


def test_segment_colors_match_gui_tampermonkey_palette():
    assert segment_color({"role": "page_id"}).name() == QColor(COLOR_PAGE_ID).name()
    assert liveness_tag_color("在线").name() == QColor(COLOR_ONLINE).name()
    assert bind_tag_color("已绑定").name() == QColor(COLOR_BIND_BOUND).name()
    assert bind_tag_color("未绑定").name() == QColor(COLOR_BIND_UNBOUND).name()
    assert segment_color({"role": "url"}).name() == QColor(COLOR_URL).name()
    assert bind_tag_color("已绑定在线").name() == QColor(COLOR_BIND_BOUND).name()


def test_format_current_session_header_segments(host):
    segments = host._format_current_session_header_segments(None)
    assert segments[-1]["role"] == "page_id"
    assert segments[-1]["text"] == "页面ID：-"


def test_session_list_bind_status_segments(host):
    from app.models import ChatSession

    session = ChatSession(
        session_id="s1",
        title="test",
        created_at=0.0,
        updated_at=0.0,
    )
    segments = host._session_list_bind_status_segments(session, "bound_online")
    assert segments[-1]["role"] == "bind"
    assert segments[-1]["tag"] == "已绑定在线"
    roles = [seg["role"] for seg in segments]
    assert "bind" in roles
