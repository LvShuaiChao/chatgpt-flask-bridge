"""P0 字段/流程修复回归。"""

import time

import pytest

from app.models import default_remote_chatgpt, normalize_remote_chatgpt
from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin


class _SendVerifyHost(PageSendTargetMixin):
    def __init__(self, *, bind_each=True, allow_fallback=False):
        self._bind_each_chat_to_page = bind_each
        self._allow_send_same_conversation_fallback = allow_fallback
        self._allow_sync_same_conversation_fallback = True
        self._debug_logging_enabled = lambda: False
        self._logs = []

    def _append_log(self, text, echo=False, level="INFO"):
        self._logs.append(text)

    def _remote_bind_state(self, remote):
        return (remote or {}).get("bind_state") or ""

    def _remote_conversation_id(self, remote):
        return (remote or {}).get("conversation_id") or ""


class _Session:
    def __init__(self, remote):
        self.session_id = "s1"
        self.remote_chatgpt = remote


def test_normalize_rejects_legacy_pending_text_fields():
    remote = {
        **default_remote_chatgpt(),
        "pending_bootstrap_text": "hello bootstrap",
        "pending_send_text": "hello send",
    }
    with pytest.raises(ValueError, match="legacy fields"):
        normalize_remote_chatgpt(remote)


def test_send_binding_verify_merged_into_page_action_blocks_mismatch_without_fallback():
    host = _SendVerifyHost(allow_fallback=False)
    session = _Session(
        {
            "enabled": True,
            "client_id": "bound-c",
            "page_instance_id": "bound-p",
            "conversation_id": "conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    page_action = {
        "decision": "allowed",
        "reason": "ready",
        "target": {
            "client_id": "other-c",
            "page_instance_id": "other-p",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
        },
        "page": {
            "client_id": "other-c",
            "page_instance_id": "other-p",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "last_seen": time.time(),
        },
        "target_source": "bound_page",
    }
    merged = host._apply_send_binding_verify_to_page_action(session, page_action)
    assert merged["decision"] == "blocked"
    assert merged["reason_code"] == "client_id_mismatch"


def test_send_binding_verify_blocks_client_mismatch_even_with_legacy_fallback_flag():
    host = _SendVerifyHost(allow_fallback=True)
    session = _Session(
        {
            "enabled": True,
            "client_id": "bound-c",
            "page_instance_id": "bound-p",
            "conversation_id": "conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    page_action = {
        "decision": "allowed",
        "reason": "ready",
        "target": {
            "client_id": "other-c",
            "page_instance_id": "other-p",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
        },
        "page": {
            "client_id": "other-c",
            "page_instance_id": "other-p",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "last_seen": time.time(),
        },
        "target_source": "bound_page",
    }
    merged = host._apply_send_binding_verify_to_page_action(session, page_action)
    assert merged["decision"] == "blocked"
    assert merged["reason_code"] == "client_id_mismatch"


def test_send_binding_verify_blocks_conversation_id_mismatch_even_with_fallback():
    host = _SendVerifyHost(allow_fallback=True)
    session = _Session(
        {
            "enabled": True,
            "client_id": "bound-c",
            "page_instance_id": "bound-p",
            "conversation_id": "conv-1",
        }
    )
    reason = host._send_binding_verify_blocked_reason(
        session,
        target_client_id="bound-c",
        url="https://chatgpt.com/c/conv-2",
        target_page_instance_id="bound-p",
        target_conversation_id="conv-2",
    )
    assert reason == "conversation_id_mismatch"


def test_send_binding_verify_missing_target_conversation_id():
    host = _SendVerifyHost()
    session = _Session(
        {
            "enabled": True,
            "client_id": "bound-c",
            "page_instance_id": "bound-p",
            "conversation_id": "conv-1",
        }
    )
    reason = host._send_binding_verify_blocked_reason(
        session,
        target_client_id="bound-c",
        url="https://chatgpt.com/c/conv-1",
        target_page_instance_id="bound-p",
        target_conversation_id="",
    )
    assert reason == "missing_target_conversation_id"


def test_verify_send_target_binding_blocks_client_mismatch():
    host = _SendVerifyHost(allow_fallback=True)
    session = _Session(
        {
            "enabled": True,
            "client_id": "bound-c",
            "page_instance_id": "bound-p",
            "conversation_id": "conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    _cid, _url, ok, reason = host._verify_send_target_binding(
        session,
        "other-c",
        "https://chatgpt.com/c/conv-1",
        target_page_instance_id="other-p",
        target_conversation_id="conv-1",
    )
    assert ok is False
    assert reason == "client_id_mismatch"


@pytest.fixture
def sync_poll_host():
    from app.ui.mixins.page_sync_mixin import PageSyncMixin

    from tests.host_states import attach_main_window_states as init_main_window_states

    class _Host(PageSyncMixin):
        def __init__(self):
            init_main_window_states(self)
            self._wait_conversation_sync_by_session = {}
            self._bridge_ui.last_bridge_status = {}
            self._current_session_id = ""
            self._sessions = {}
            self._logs = []

        def _append_log(self, text, echo=False, level="INFO"):
            self._logs.append(text)

        def _get_session_by_id(self, sid):
            return self._sessions.get(sid)

        def _set_tm_action_hint(self, text):
            pass

        def _iter_tm_clients(self, status, online_only=True):
            return list((status or {}).get("tampermonkey_clients") or [])

        def _find_tm_client_by_client_id(self, client_id, status=None):
            del status
            for item in self._iter_tm_clients(self._bridge_ui.last_bridge_status):
                if (item.get("client_id") or "").strip() == (client_id or "").strip():
                    return item
            return None

        def _page_url_from_item(self, item):
            return (item or {}).get("url") or ""

        def _client_conversation_id(self, item):
            return (item or {}).get("conversation_id") or ""

        def _is_dialog_ready_page(self, item):
            return bool((item or {}).get("conversation_id"))

        def _relink_session_binding_from_tm_page(self, session, item, *, reason=""):
            return True

        def request_sync_conversation(self, session, **kwargs):
            self._last_sync = kwargs

        def _get_wait_conversation_sync_requests(self):
            return self._wait_conversation_sync_by_session

    return _Host()


def test_poll_wait_conversation_matches_page_instance_not_other_tab(sync_poll_host):
    host = sync_poll_host
    session = _Session({})
    host._sessions["s1"] = session
    host._wait_conversation_sync_by_session["s1"] = {
        "client_id": "c1",
        "page_instance_id": "home-p",
        "bind_token": "tok-abc",
        "started_at": time.time(),
        "url": "https://chatgpt.com/?xz_bind_token=tok-abc",
    }
    host._bridge_ui.last_bridge_status = {
        "tampermonkey_clients": [
            {
                "client_id": "c1",
                "page_instance_id": "wrong-p",
                "conversation_id": "conv-wrong",
                "url": "https://chatgpt.com/c/conv-wrong",
                "last_seen": time.time(),
            },
            {
                "client_id": "c1",
                "page_instance_id": "conv-p",
                "conversation_id": "conv-right",
                "url": "https://chatgpt.com/c/conv-right?xz_bind_token=tok-abc",
                "last_seen": time.time(),
            },
        ]
    }
    host._poll_wait_conversation_sync_requests()
    assert "s1" not in host._wait_conversation_sync_by_session
    assert hasattr(host, "_last_sync")


class _ComposePayloadHost(PageSendTargetMixin):
    def __init__(self, resolved):
        self._resolved = resolved
        self._logs = []

    def _resolve_bridge_push_target_fields(self, session, *, url='', is_bootstrap=False):
        return self._resolved

    def _append_log(self, text, echo=False, level="INFO"):
        self._logs.append(text)

    def is_same_conversation_fallback_enabled(self, action, session=None):
        return True


def test_compose_send_payload_does_not_override_resolved_target_ids():
    from app.ui.mixins.page_bind_mixin import PageBindMixin

    class _Host(PageBindMixin, _ComposePayloadHost):
        pass

    session = _Session(default_remote_chatgpt())
    host = _Host(resolved=("old-conv", "old-instance", "old-bind"))
    payload = host._compose_send_payload(
        session,
        turn_id="t1",
        content="hi",
        raw_content="hi",
        client_id="new-c",
        url="https://chatgpt.com/c/new-conv",
        page_instance_id="new-instance",
        conversation_id="new-conv",
        target_source="bound_page",
    )
    assert payload["conversation_id"] == "new-conv"
    assert payload["page_instance_id"] == "new-instance"
    assert payload["client_id"] == "new-c"
    assert any("[SEND][PAYLOAD_TARGET]" in line for line in host._logs)
