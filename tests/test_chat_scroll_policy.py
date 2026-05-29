"""聊天区滚动策略与等待倒计时局部更新测试。"""

import re
import unittest

from app.ui.mixins.chat_render_mixin import (
    CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD,
    _WAITING_ELAPSED_IN_HTML_RE,
    ChatRenderMixin,
)


class _MockScrollBar:
    def __init__(self, value=0, maximum=100):
        self._value = value
        self._maximum = maximum

    def value(self):
        return self._value

    def maximum(self):
        return self._maximum

    def setValue(self, value):
        self._value = max(0, min(int(value), self._maximum))


class _ScrollHost(ChatRenderMixin):
    def __init__(self, *, value=0, maximum=100):
        self._bar = _MockScrollBar(value=value, maximum=maximum)
        self.chat_transcript = _TranscriptStub(self._bar)
        self._chat_scroll_to_bottom_pending = False
        self._logs = []

    def _append_log(self, text, echo=False):
        self._logs.append(text)


class _TranscriptStub:
    def __init__(self, bar):
        self._bar = bar

    def verticalScrollBar(self):
        return self._bar

    def setHtml(self, _doc):
        return None

    def setVisible(self, _visible):
        return None

    def toHtml(self):
        return ""


class ChatScrollPolicyTests(unittest.TestCase):
    def test_is_chat_near_bottom_at_max(self):
        host = _ScrollHost(value=100, maximum=100)
        self.assertTrue(host._is_chat_near_bottom())

    def test_is_chat_near_bottom_far_from_bottom(self):
        host = _ScrollHost(value=0, maximum=500)
        self.assertFalse(host._is_chat_near_bottom())

    def test_is_chat_near_bottom_within_threshold(self):
        host = _ScrollHost(
            value=500 - CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD,
            maximum=500,
        )
        self.assertTrue(host._is_chat_near_bottom())

    def test_resolve_force_bottom_compat(self):
        host = _ScrollHost()
        self.assertEqual(
            host._resolve_chat_scroll_policy(force_bottom=True),
            "force_bottom",
        )
        self.assertEqual(
            host._resolve_chat_scroll_policy(force_bottom=False),
            "auto_if_near_bottom",
        )
        self.assertEqual(
            host._resolve_chat_scroll_policy(scroll_policy="preserve"),
            "preserve",
        )

    def test_capture_and_restore_scroll_ratio(self):
        host = _ScrollHost(value=250, maximum=500)
        ratio = host._capture_chat_scroll_ratio()
        host._bar.setValue(0)
        host._restore_chat_scroll_ratio(ratio)
        self.assertEqual(host._bar.value(), 250)

    def test_waiting_elapsed_html_regex_replaces_all(self):
        html = (
            "<td>等待回复... 00:16</td>"
            "<td>等待 ChatGPT 回复… 01:02</td>"
        )
        new_html = _WAITING_ELAPSED_IN_HTML_RE.sub(r"\1 00:17", html)
        self.assertEqual(
            new_html,
            "<td>等待回复... 00:17</td><td>等待 ChatGPT 回复… 00:17</td>",
        )
        self.assertEqual(len(_WAITING_ELAPSED_IN_HTML_RE.findall(html)), 2)


if __name__ == "__main__":
    unittest.main()
