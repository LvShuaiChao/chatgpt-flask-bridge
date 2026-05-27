"""PageRegistry 单次解析与缓存（原 TmPageSnapshot 测试迁移）。"""

from types import SimpleNamespace

from app.ui.mixins.page_tm_client_mixin import PageTmClientMixin
from app.utils.page_snapshot import PageRegistry, status_pages_token


class _SnapshotHost(PageTmClientMixin):
    def __init__(self, status):
        self._bridge_ui = SimpleNamespace(last_bridge_status=status)
        self._logs = []
        self.page_registry = None
        self._deprecated_page_list_key_logged = False

    def _append_log(self, message, echo=False):
        self._logs.append(message)

    def _current_session(self):
        return None

    def _tm_page_is_online_simple(self, page):
        return bool(page.get("online"))

    def _page_has_focus(self, page):
        return bool(page.get("has_focus"))

    def _normalize_chatgpt_page_url(self, url):
        return url

    def _choose_better_page_record(self, old, new):
        return new

    def _client_conversation_id(self, item):
        return (item.get("conversation_id") or "").strip()


def _status_with_pages():
    return {
        "server_running": True,
        "pages": [
            {
                "client_id": "c1",
                "page_instance_id": "i1",
                "conversation_id": "conv-a",
                "page_type": "conversation",
                "url": "https://chatgpt.com/c/conv-a",
                "online": True,
                "last_seen": 9999999999,
            },
            {
                "client_id": "c2",
                "page_instance_id": "i2",
                "page_type": "home",
                "url": "https://chatgpt.com/",
                "online": True,
                "last_seen": 9999999998,
            },
        ],
    }


def test_build_tm_page_snapshot_once_per_status():
    host = _SnapshotHost(_status_with_pages())
    reg1 = host.build_tm_page_snapshot(log_stages=False)
    reg2 = host._get_tm_page_snapshot(log_stages=False)
    assert reg1 is reg2
    assert isinstance(reg1, PageRegistry)
    assert reg1.total_count == 2
    assert reg1.conversation_count == 1
    assert reg1.home_count == 1
    assert "conv-a" in reg1.by_conversation_id_dict
    assert len(reg1.by_conversation_id_dict["conv-a"]) == 1


def test_extract_uses_cache_without_rebuild_logs():
    host = _SnapshotHost(_status_with_pages())
    host.build_tm_page_snapshot(log_stages=True)
    fetch_logs = [line for line in host._logs if "[TM_PAGE_LIST][FETCH]" in line]
    assert len(fetch_logs) == 1
    host._extract_tm_pages_from_status(log_stages=True)
    fetch_logs_after = [line for line in host._logs if "[TM_PAGE_LIST][FETCH]" in line]
    assert len(fetch_logs_after) == 1


def test_status_pages_token_changes_when_pages_change():
    s1 = _status_with_pages()
    s2 = dict(s1)
    s2["pages"] = list(s1["pages"]) + [
        {
            "client_id": "c3",
            "page_instance_id": "i3",
            "url": "https://chatgpt.com/",
            "online": True,
        }
    ]
    assert status_pages_token(s1) != status_pages_token(s2)


def test_page_registry_matches_status():
    status = _status_with_pages()
    reg = PageRegistry.from_normalized_dicts(
        status["pages"], status, conversation_id_of=lambda p: (p.get("conversation_id") or "")
    )
    reg.status_token = status_pages_token(status)
    assert reg.matches_status(status)


def test_iter_tm_clients_accepts_prebuilt_snapshot():
    """回归：_client_info_by_page_identity 等路径会传入 snapshot=，启动时不应 TypeError。"""
    status = _status_with_pages()
    host = _SnapshotHost(status)
    registry = host.build_tm_page_snapshot(log_stages=False)
    pages = list(host._iter_tm_clients(status, snapshot=registry))
    assert len(pages) == 2
    assert {p["client_id"] for p in pages} == {"c1", "c2"}
