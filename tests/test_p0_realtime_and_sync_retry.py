"""P0：动作页 live 门禁与打开页面后同步重试。"""
import time

import pytest

from app.models import default_remote_chatgpt
from tests.host_states import attach_main_window_states as init_main_window_states
from app.ui.mixins.page_selector_mixin import PageSelectorMixin
from app.ui.mixins.page_sync_mixin import PageSyncMixin


class _RealtimeHost(PageSelectorMixin):
    def _tm_page_is_online_simple(self, page):
        return bool(page.get("online", True))


class _SyncRetryHost(PageSyncMixin):
    def __init__(self, *, status, session, resolve_results):
        init_main_window_states(self)
        self._bridge_ui.last_bridge_status = status
        self._sessions = {"s1": session}
        self._resolve_results = list(resolve_results)
        self._logs = []
        self._sync_calls = 0

    def _append_log(self, text, echo=False, level="INFO"):
        self._logs.append(text)

    def _append_debug_log(self, text, echo=False):
        self._logs.append(text)

    def _sync_dispatch_target_still_valid(self, **kwargs):
        return False, "stale_instance"

    def resolve_sync_decision(self, session, status=None):
        if self._resolve_results:
            return self._resolve_results.pop(0)
        return False, None, "", "no_target", {}

    def request_sync_conversation(self, session, **kwargs):
        self._sync_calls += 1
        return True, ""

    def _clear_session_sync_running(self, session_id, reason=""):
        pass

    def _log_sync_failed_after_clear(self, session_id, reason):
        pass

    def _finish_sync_progress(self, **kwargs):
        pass

    def _remote_conversation_id(self, remote):
        return (remote or {}).get("conversation_id") or ""


class _Session:
    def __init__(self, remote):
        self.session_id = "s1"
        self.remote_chatgpt = remote


@pytest.mark.skip(reason="_is_realtime_action_page 已移除，live 门禁改由 page_command / PageRegistry 承担")
def test_realtime_action_page_rejects_display_cache():
    pass


def test_sync_retry_re_resolves_after_stale_expected_ctx():
    now = time.time()
    new_page = {
        "client_id": "c1",
        "page_instance_id": "p-new",
        "conversation_id": "conv-1",
        "url": "https://chatgpt.com/c/conv-1",
        "last_seen": now,
    }
    session = _Session({**default_remote_chatgpt(), "conversation_id": "conv-1"})
    status = {"pages": [new_page]}
    host = _SyncRetryHost(
        status=status,
        session=session,
        resolve_results=[
            (True, new_page, "bound_page", "", {}),
        ],
    )
    host._simple_sync_retry_after_open(
        "s1",
        attempts_left=1,
        expected_ctx={
            "client_id": "c1",
            "page_instance_id": "p-old",
            "conversation_id": "conv-1",
        },
    )
    assert host._sync_calls == 1
    assert not any("[SYNC][RETRY_SKIP_STALE_TARGET]" in line for line in host._logs)
