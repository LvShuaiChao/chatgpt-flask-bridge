"""绑定 page_instance 失效但同 conversation 在线时的目标解析与阻断原因。"""

import time

from app.models import default_remote_chatgpt
from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin
from app.utils.target_sources import TARGET_SOURCE_SAME_CONVERSATION_REBOUND_AFTER_LOST


class _Session:
    def __init__(self, remote=None):
        self.session_id = "s-bound-inst"
        self.remote_chatgpt = remote or default_remote_chatgpt()


class _BoundInstanceHost(PageSendTargetMixin):
    def __init__(self, clients, *, auto_refresh=True, allow_send_fallback=True):
        self._bridge_ui.last_bridge_status = {"tampermonkey_clients": list(clients)}
        self._logs = []
        self._bind_each_chat_to_page = True
        self._allow_send_same_conversation_fallback = allow_send_fallback
        self._allow_sync_same_conversation_fallback = True
        self._auto_refresh_binding_when_same_conversation_online = auto_refresh
        self._auto_refresh_binding_by_conversation = False
        self._rebound_calls = []

    def _append_log(self, text, echo=False, level="INFO"):
        self._logs.append(text)

    def _remote_conversation_id(self, remote):
        return (remote or {}).get("conversation_id") or ""

    def _age_from_ts(self, ts, context=""):
        del context
        try:
            value = float(ts)
        except (TypeError, ValueError):
            return -1.0
        if value <= 0:
            return -1.0
        return max(0.0, time.time() - value)

    def _session_bound_identity(self, remote):
        remote = remote or {}
        return {
            "client_id": (remote.get("client_id") or "").strip(),
            "page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "conversation_id": self._remote_conversation_id(remote) or "",
            "url": (remote.get("url") or "").strip(),
        }

    def _remote_bind_state(self, remote):
        return (remote or {}).get("bind_state") or ""

    def _client_conversation_id(self, item):
        return (item or {}).get("conversation_id") or ""

    def _iter_tm_clients(self, status, online_only=False):
        for item in status.get("tampermonkey_clients") or []:
            if isinstance(item, dict):
                yield item

    def _tm_page_is_online_simple(self, item):
        last_seen = float(item.get("last_seen") or item.get("last_heartbeat_at") or 0)
        return last_seen > 0 and (time.time() - last_seen) < 60

    def _page_has_focus(self, item):
        return bool((item or {}).get("has_focus"))

    def _normalize_visibility_state(self, item):
        return (item or {}).get("visibility_state") or "visible"

    def _find_page_by_bound_identity(self, remote, *, status=None, allow_fallback=True):
        del allow_fallback
        status = status or self._bridge_ui.last_bridge_status
        bound_client = (remote.get("client_id") or "").strip()
        bound_instance = (remote.get("page_instance_id") or "").strip()
        for item in self._iter_tm_clients(status):
            if (item.get("client_id") or "").strip() != bound_client:
                continue
            if bound_instance and (item.get("page_instance_id") or "").strip() != bound_instance:
                continue
            return item, "exact"
        return None, "missing"

    def _client_info_by_page_identity(self, client_id, page_instance_id, *, status=None):
        status = status or self._bridge_ui.last_bridge_status
        for item in self._iter_tm_clients(status):
            if (item.get("client_id") or "").strip() != (client_id or "").strip():
                continue
            if (item.get("page_instance_id") or "").strip() != (page_instance_id or "").strip():
                continue
            return item
        return None

    def _find_tm_client_by_client_id(self, client_id, status=None):
        status = status or self._bridge_ui.last_bridge_status
        for item in self._iter_tm_clients(status):
            if (item.get("client_id") or "").strip() == (client_id or "").strip():
                return item
        return None

    def _set_tm_action_hint(self, _hint):
        pass

    def set_bound_page(self, session, target_item, reason="", silent=False):
        del reason, silent
        self._rebound_calls.append(dict(target_item))
        remote = dict(session.remote_chatgpt or default_remote_chatgpt())
        remote.update(
            {
                "enabled": True,
                "client_id": (target_item.get("client_id") or "").strip(),
                "page_instance_id": (target_item.get("page_instance_id") or "").strip(),
                "conversation_id": (target_item.get("conversation_id") or "").strip(),
                "url": (target_item.get("url") or "").strip(),
                "bind_state": "BOUND_CONVERSATION",
            }
        )
        session.remote_chatgpt = remote
        return True

    def _schedule_save_sessions_to_disk(self):
        pass

    def _update_bound_page_display(self):
        pass


def _conversation_page(*, client_id, page_instance_id, conversation_id="conv-1"):
    now = time.time()
    return {
        "client_id": client_id,
        "page_instance_id": page_instance_id,
        "conversation_id": conversation_id,
        "url": f"https://chatgpt.com/c/{conversation_id}",
        "page_type": "conversation",
        "last_seen": now,
        "last_poll_at": now,
        "page_display_id": 1,
    }


def test_blocked_reason_same_conversation_when_instance_lost():
    host = _BoundInstanceHost(
        [_conversation_page(client_id="c1", page_instance_id="page-new")],
    )
    session = _Session(
        {
            **default_remote_chatgpt(),
            "enabled": True,
            "client_id": "c1",
            "page_instance_id": "page-old",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    assert host._blocked_reason_for_unresolved_target(session) == (
        "bound_page_instance_lost_same_conversation_online"
    )


def test_resolve_send_auto_refresh_after_instance_lost():
    new_page = _conversation_page(client_id="c1", page_instance_id="page-new")
    host = _BoundInstanceHost([new_page], auto_refresh=True)
    host._bridge_ui.last_bridge_status = {
        "tampermonkey_clients": [new_page],
        "tampermonkey_client_id": "c1",
    }
    session = _Session(
        {
            **default_remote_chatgpt(),
            "enabled": True,
            "client_id": "c1",
            "page_instance_id": "page-old",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    target = host._resolve_conversation_action_target(session, action="send")
    assert target is None
    assert (session.remote_chatgpt.get("page_instance_id") or "").strip() == "page-old"
    assert not host._rebound_calls
    assert any("[SYNC][TARGET_BLOCKED]" in line for line in host._logs)


def test_resolve_send_fallback_without_auto_refresh():
    new_page = _conversation_page(client_id="c1", page_instance_id="page-new")
    host = _BoundInstanceHost([new_page], auto_refresh=False, allow_send_fallback=True)
    host._bridge_ui.last_bridge_status = {
        "tampermonkey_clients": [new_page],
        "tampermonkey_client_id": "c1",
    }
    session = _Session(
        {
            **default_remote_chatgpt(),
            "enabled": True,
            "client_id": "c1",
            "page_instance_id": "page-old",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    target = host._resolve_conversation_action_target(session, action="send")
    assert target is None
    assert (session.remote_chatgpt.get("page_instance_id") or "").strip() == "page-old"
    assert any("[SYNC][TARGET_BLOCKED]" in line for line in host._logs)


def test_blocked_reason_no_bound_when_only_conversation_id():
    host = _BoundInstanceHost(
        [_conversation_page(client_id="c1", page_instance_id="page-new")],
    )
    session = _Session(
        {
            **default_remote_chatgpt(),
            "enabled": True,
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    assert host._blocked_reason_for_unresolved_target(session) == (
        "no_bound_page_for_conversation"
    )


def test_blocked_reason_true_offline_when_no_same_conversation():
    host = _BoundInstanceHost(
        [_conversation_page(client_id="c1", page_instance_id="page-x", conversation_id="other")],
    )
    session = _Session(
        {
            **default_remote_chatgpt(),
            "enabled": True,
            "client_id": "c1",
            "page_instance_id": "page-old",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    assert host._blocked_reason_for_unresolved_target(session) == "bound_page_offline"


def test_user_message_for_instance_lost_reason():
    host = _BoundInstanceHost([])
    msg = host._send_target_blocked_user_message(
        "bound_page_instance_lost_same_conversation_online"
    )
    assert "原绑定页面实例已失效" in msg
    assert "绑定所选页面" in msg
