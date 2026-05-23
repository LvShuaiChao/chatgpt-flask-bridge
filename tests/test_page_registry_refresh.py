"""第二阶段：页面注册表统一刷新与轻量绑定快照。"""



import time
from unittest.mock import MagicMock, patch

import pytest



from app.ui.mixins.page_registry_refresh_mixin import PageRegistryRefreshMixin
from tests.host_states import attach_main_window_states as init_main_window_states





class _RegistryHost(PageRegistryRefreshMixin):

    def __init__(self):

        init_main_window_states(self)
        self._init_page_registry_refresh_state()

        self._logs = []

        self.tm_sync_target_label = MagicMock()

        self.tm_bound_page_label = MagicMock()

        self.tm_online_label = MagicMock()

        self.sync_web_conversation_btn = MagicMock()



    def _set_page_list_refresh_busy(self, _busy):

        pass



    def _set_tm_action_hint(self, _text):

        pass



    def _current_session(self):

        return None



    def _extract_tm_pages_from_status(self, status, *, log_stages=True):

        del log_stages

        return list((status or {}).get("clients") or [])



    def _refresh_tm_page_selector(self, status, *, force_rebuild=False, snapshot=None):

        del snapshot
        self._selector_called = (status, force_rebuild)



    def _render_tampermonkey_clients(self, status=None, *, force=False, snapshot=None):

        del snapshot
        self._table_called = (status, force)



    def _sync_tm_page_list_empty_ui(self):

        pass



    def _tm_summary_for_session(self):

        return {"online_clients": 1, "total_clients": 1}



    def _format_tm_online_chip_text(self, summary):

        return f"在线 {summary.get('online_clients', 0)}", "ok"



    def _refresh_status_chip(self, *_args, **_kwargs):

        pass



    def update_monkey_binding_summary(self, *_args, **_kwargs):

        pass



    def _collect_monkey_window_binding_stats(self, _status):

        return {}



    def _append_log(self, message, echo=False, level=None):

        self._logs.append((message, echo, level))





def test_refresh_does_not_call_sync_decision(monkeypatch):

    host = _RegistryHost()

    monkeypatch.setattr(

        "app.ui.mixins.page_registry_refresh_mixin.is_server_running",

        lambda: True,

    )

    monkeypatch.setattr(

        "app.ui.mixins.page_registry_refresh_mixin.get_bridge_status",

        lambda: {
            "tampermonkey_clients": [
                {
                    "client_id": "c1",
                    "page_instance_id": "p1",
                    "conversation_id": "conv1",
                    "page_type": "conversation",
                    "last_seen": time.time(),
                }
            ]
        },

    )

    host.resolve_sync_decision = MagicMock(side_effect=AssertionError("no sync"))

    host.resolve_page_action = MagicMock(side_effect=AssertionError("no action"))

    host._schedule_status_apply = MagicMock(side_effect=AssertionError("no status"))



    host._do_page_registry_refresh(reason="test")



    messages = [m[0] for m in host._logs]

    assert any("[PAGE_REGISTRY][REFRESH][START]" in line for line in messages)

    assert any("[PAGE_REGISTRY][REFRESH][DONE]" in line for line in messages)

    assert host.page_registry.summary().get("total_count", 0) >= 1





def test_safe_log_survives_append_failure():

    host = _RegistryHost()



    def bad_append(*_args, **_kwargs):

        raise TypeError("level kw broken")



    host._append_log = bad_append

    host.safe_log("hello", level="ERROR")

    # no exception





def test_get_bound_page_snapshot_without_resolve():

    host = _RegistryHost()

    session = MagicMock()

    session.remote_chatgpt = {

        "enabled": True,

        "client_id": "c1",

        "page_instance_id": "p1",

        "conversation_id": "conv1",

    }

    from app.utils.page_status import PageRegistry

    host.page_registry = PageRegistry.from_bridge_status(
        {
            "tampermonkey_clients": [
                {
                    "client_id": "c1",
                    "page_instance_id": "p1",
                    "conversation_id": "conv1",
                    "page_type": "conversation",
                    "last_seen": time.time(),
                    "can_accept_input": True,
                }
            ]
        }
    )



    snap = host.get_bound_page_snapshot(session=session)

    assert snap["found"] is True

    assert snap["online"] is True





def test_command_runtime_timeout(monkeypatch):

    host = _RegistryHost()

    calls = []



    def fake_timer_start(_ms):

        calls.append("start")



    host._page_command_timeout_timer = MagicMock()

    host._page_command_timeout_timer.start = fake_timer_start

    host.start_page_command("sync_conversation", payload={"request_id": "r1"})

    assert host.page_command_runtime["running"] is True

    assert host.page_command_runtime["command"] == "sync_conversation"

    host.timeout_page_command("r1")

    assert host.page_command_runtime["running"] is False





def test_poll_minimal_idle_response(server_module):

    resp = server_module._poll_minimal_idle_response()

    assert resp == {"ok": True, "has_message": False}

    assert "raw_clients_count" not in resp

    assert "pending_total" not in resp





@pytest.fixture

def server_module():
    import app.server as srv

    return srv


