"""_annotate_pages_for_url_dedup 不得经 _resolve_bound_page_info 递归。"""

from types import SimpleNamespace

from app.ui.mixins.page_tm_client_mixin import PageTmClientMixin


class _AnnotateHost(PageTmClientMixin):
    def __init__(self, session=None):
        self._logs = []
        self._resolve_calls = 0
        self._session = session
        self._last_bridge_status = {
            "clients": [
                {
                    "client_id": "tm-1",
                    "url": "https://chatgpt.com/c/conv-a",
                    "online": True,
                    "last_seen": 9999999999,
                }
            ]
        }

    def _append_log(self, message, echo=False):
        self._logs.append((message, echo))

    def _tm_page_is_online_simple(self, item):
        return bool(item.get("online"))

    def _resolve_bound_page_info(self, status=None):
        self._resolve_calls += 1
        return self._extract_tm_pages_from_status(status or self._last_bridge_status)

    def _current_session(self):
        return self._session


def test_annotate_pages_does_not_call_resolve_bound_page_info():
    session = SimpleNamespace(
        remote_chatgpt={
            "enabled": True,
            "client_id": "tm-1",
            "page_instance_id": "inst-1",
            "conversation_id": "conv-a",
        }
    )
    host = _AnnotateHost(session=session)
    pages = [{"client_id": "tm-1", "url": "https://chatgpt.com/c/conv-a", "online": True}]
    host._annotate_pages_for_url_dedup(pages, status=host._last_bridge_status)
    assert host._resolve_calls == 0
    assert pages[0].get("is_bound") is True


def test_resolve_bound_page_info_survives_page_list_extraction():
    from app.ui.mixins.page_bind_mixin import PageBindMixin

    class _MiniBind(PageBindMixin):
        def __init__(self):
            self._in_resolve_bound_page_info = False
            self._last_bridge_status = {
                "clients": [
                    {
                        "client_id": "tm-1",
                        "conversation_id": "conv-a",
                        "url": "https://chatgpt.com/c/conv-a",
                        "online": True,
                        "last_seen": 9999999999,
                    }
                ]
            }

        def _current_session(self):
            return SimpleNamespace(
                remote_chatgpt={
                    "enabled": True,
                    "client_id": "tm-1",
                    "conversation_id": "conv-a",
                }
            )

        def _tm_page_is_online_simple(self, item):
            return bool(item.get("online"))

        def _append_log(self, *args, **kwargs):
            pass

        def _client_info_by_page_identity(self, *args, **kwargs):
            return None

    host = _MiniBind()
    info, state, reason = host._resolve_bound_page_info(status=host._last_bridge_status)
    assert isinstance(info, dict)
    assert state in ("online", "offline")
    assert reason
