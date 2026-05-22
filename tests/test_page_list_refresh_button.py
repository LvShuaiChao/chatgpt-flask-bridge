"""聊天页「刷新页面列表」按钮与共享刷新逻辑。"""



from unittest.mock import MagicMock, patch



import pytest



from app.ui.main_window_state import BridgeUiState, PageSelectorState
from app.ui.mixins.page_open_close_mixin import PageOpenCloseMixin
from app.ui.mixins.page_registry_refresh_mixin import PageRegistryRefreshMixin





class _RefreshHost(PageRegistryRefreshMixin, PageOpenCloseMixin):

    def __init__(self):

        self._init_page_registry_refresh_state()
        self._bridge_ui = BridgeUiState()
        self._page_selector = PageSelectorState()
        self._page_selector.refresh_in_progress = False

        self._page_selector.refresh_last_ms = 0

        self._last_tm_pages_table_signature = "old"

        self.tm_pages_table = MagicMock()

        self.tm_pages_table.isVisible.return_value = False

        self._logs = []

        self._scheduled = []



    def safe_log(self, message, echo=False, level=None):

        self._logs.append((message, echo, level))



    def _append_log(self, message, echo=False, level=None):

        self._logs.append((message, echo, level))



    def schedule_page_registry_refresh(self, reason="auto"):

        self._scheduled.append(reason)

        self._do_page_registry_refresh(reason=reason)



    def _set_tm_action_hint(self, _text):

        pass



    def _extract_tm_pages_from_status(self, status, *, log_stages=True):

        del log_stages

        return list((status or {}).get("clients") or [])



    def _iter_tm_clients(self, status=None):

        status = status or {}

        for item in status.get("clients") or []:

            yield item



    def _refresh_tm_page_selector(self, status, *, force_rebuild=False, snapshot=None):
        del status, snapshot
        self._selector_force_rebuild = force_rebuild



    def _update_live_page_display(self, *args, **kwargs):
        pass



    def _update_manual_current_page_display(self):

        raise AssertionError("must not call _update_manual_current_page_display")



    def _update_bound_page_display(self):

        raise AssertionError("must not call _update_bound_page_display")



    def render_page_combo(
        self, registry=None, reason="render", *, skip_rebuild=False, force=False, snapshot=None
    ):
        del registry, skip_rebuild, force, snapshot
        self._render_reason = reason



    def _sync_tm_page_list_empty_ui(self):

        pass



    def _render_tampermonkey_clients(self, status=None, *, force=False, snapshot=None):
        del status, snapshot
        self._render_force = force



    def _schedule_status_apply(self, status, reason="", force=False):

        raise AssertionError("must not call _schedule_status_apply")



    def _set_page_list_refresh_busy(self, _busy):

        pass



    def render_header_chips(self, registry=None, reason="render"):

        del registry, reason



    def render_page_selector(self, registry=None, reason="render"):

        del registry, reason



    def render_binding_panel(self, registry=None, reason="render"):

        del registry, reason



    def render_command_buttons(self, reason="render"):

        del reason





def test_refresh_logs_start_done_and_schedules_registry(monkeypatch):

    host = _RefreshHost()

    monkeypatch.setattr(

        "app.ui.mixins.page_registry_refresh_mixin.is_server_running",

        lambda: True,

    )

    monkeypatch.setattr(

        "app.ui.mixins.page_registry_refresh_mixin.get_bridge_status",

        lambda: {"clients": [{"client_id": "c1"}]},

    )



    host.schedule_page_registry_refresh(reason="manual_chat_refresh")



    messages = [line for line, _echo, _lvl in host._logs]

    assert any(
        "[PAGE_REGISTRY][REFRESH][START] reason=manual_chat_refresh" in line
        for line in messages
    )

    assert any(
        "[PAGE_REGISTRY][REFRESH][DONE]" in line
        and "reason=manual_chat_refresh" in line
        for line in messages
    )

    assert host._scheduled == ["manual_chat_refresh"]

    assert getattr(host, "_render_reason", "") == "manual_chat_refresh"





def test_manual_button_refresh_logs_start_done(monkeypatch):

    host = _RefreshHost()

    monkeypatch.setattr(

        "app.ui.mixins.page_registry_refresh_mixin.is_server_running",

        lambda: True,

    )

    monkeypatch.setattr(

        "app.ui.mixins.page_registry_refresh_mixin.get_bridge_status",

        lambda: {"clients": [{"client_id": "c1"}]},

    )



    host.refresh_page_registry(reason="manual_button", force=True)



    messages = [line for line, _echo, _lvl in host._logs]

    assert any(
        "[PAGE_REGISTRY][REFRESH][START] reason=manual_button" in line
        for line in messages
    )

    assert any(
        "[PAGE_REGISTRY][REFRESH][DONE]" in line and "reason=manual_button" in line
        for line in messages
    )
    assert any("total_pages=" in line for line in messages)





def test_refresh_pending_while_in_progress():

    host = _RefreshHost()

    host._page_registry_refresh_in_progress = True

    PageRegistryRefreshMixin.schedule_page_registry_refresh(host, reason="manual")

    assert host._page_registry_refresh_pending is True

    assert host._logs == []





def test_refresh_failed_logs_error(monkeypatch):

    host = _RefreshHost()

    monkeypatch.setattr(

        "app.ui.mixins.page_registry_refresh_mixin.is_server_running",

        lambda: True,

    )

    monkeypatch.setattr(

        "app.ui.mixins.page_registry_refresh_mixin.get_bridge_status",

        lambda: (_ for _ in ()).throw(RuntimeError("boom")),

    )



    host._do_page_registry_refresh(reason="test")



    messages = [line for line, _echo, _lvl in host._logs]

    assert any("[PAGE_REGISTRY][REFRESH][FAILED]" in line for line in messages)

    assert any("error_type=RuntimeError" in line for line in messages)


