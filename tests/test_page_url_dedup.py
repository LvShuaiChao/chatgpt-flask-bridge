"""ChatGPT 页面列表按规范化 URL 去重。"""

from app.ui.mixins.page_tm_client_mixin import PageTmClientMixin


class _DedupHost(PageTmClientMixin):
    def __init__(self):
        self._logs = []

    def _append_log(self, message, echo=False):
        self._logs.append((message, echo))

    def _tm_page_is_online_simple(self, item):
        return bool(item.get("online"))

    def _resolve_bound_page_info(self, status=None):
        return None, "", ""

    def _current_session(self):
        return None


def test_normalize_chatgpt_page_url_strips_query_and_fragment():
    host = _DedupHost()
    url = "HTTPS://ChatGPT.com/c/abc-123/?foo=1#bar"
    assert host._normalize_chatgpt_page_url(url) == "https://chatgpt.com/c/abc-123"


def test_dedupe_same_url_keeps_bound_page():
    host = _DedupHost()
    pages = [
        {
            "client_id": "a",
            "url": "https://chatgpt.com/c/conv-1",
            "title": "duplicate",
            "online": True,
        },
        {
            "client_id": "b",
            "url": "https://chatgpt.com/c/conv-1/",
            "title": "bound winner",
            "online": True,
            "is_bound": True,
        },
    ]
    unique = host._dedupe_chatgpt_pages(pages)
    assert len(unique) == 1
    assert unique[0]["client_id"] == "b"
    assert unique[0]["title"] == "bound winner"


def test_dedupe_empty_url_uses_page_id_fallback():
    host = _DedupHost()
    pages = [
        {"window_id": "w1", "title": "one"},
        {"window_id": "w1", "title": "dup"},
        {"window_id": "w2", "title": "other"},
    ]
    unique = host._dedupe_chatgpt_pages(pages)
    assert len(unique) == 2
