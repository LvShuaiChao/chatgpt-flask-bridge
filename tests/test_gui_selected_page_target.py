"""GUI 选中页不得覆盖 session 绑定页作为 send/sync 动作目标。"""

import time

from app.models import default_remote_chatgpt
from tests.host_states import attach_main_window_states as init_main_window_states
from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin


class _Session:
    def __init__(self, remote=None):
        self.session_id = "s-gui-target"
        self.remote_chatgpt = remote or default_remote_chatgpt()


class _GuiTargetHost(PageSendTargetMixin):
    def __init__(self, clients, *, combo_index=0):
        init_main_window_states(self)
        pages = list(clients)
        self._bridge_ui.last_bridge_status = {
            "pages": pages,
            "tampermonkey_clients": pages,
        }
        self._logs = []
        self._bind_each_chat_to_page = True
        self._allow_send_same_conversation_fallback = True
        self._current_page_key = ""
        self.tm_page_combo = _FakeCombo(clients, combo_index=combo_index)

    def _append_log(self, text, echo=False, level="INFO"):
        self._logs.append(text)

    def _remote_conversation_id(self, remote):
        return (remote or {}).get("conversation_id") or ""

    def _selected_tm_page_from_combo(self, index=None, status=None):
        del status
        return self.tm_page_combo.page_at(index)

    def _selected_tm_page_key(self):
        page = self.tm_page_combo.page_at(self.tm_page_combo.currentIndex())
        if not isinstance(page, dict):
            return ""
        cid = (page.get("client_id") or "").strip()
        inst = (page.get("page_instance_id") or "").strip()
        return f"{cid}|{inst}" if cid and inst else ""

    def _get_bound_page_key(self, session=None):
        del session
        return "bound-c|bound-p"

    def _age_from_ts(self, ts, context=""):
        del context
        try:
            return max(0.0, time.time() - float(ts))
        except (TypeError, ValueError):
            return -1.0

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
        del online_only
        for item in status.get("tampermonkey_clients") or []:
            if isinstance(item, dict):
                yield item

    def _tm_page_is_online_simple(self, item):
        last_seen = float(item.get("last_seen") or 0)
        return last_seen > 0 and (time.time() - last_seen) < 60

    def _is_prebound_home_page(self, item):
        return (item or {}).get("page_type") == "home"

    def _send_decision_can_request(self, decision):
        return decision in ("allowed", "queued")

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

    def _require_live_action_page(self, page, *, action="action"):
        del action
        if self._tm_page_is_online_simple(page):
            return page, ""
        return None, "page_offline"

    def _find_tm_client_by_client_id(self, client_id, status=None):
        status = status or self._bridge_ui.last_bridge_status
        for item in self._iter_tm_clients(status):
            if (item.get("client_id") or "").strip() == (client_id or "").strip():
                return item
        return None


class _FakeCombo:
    def __init__(self, pages, *, combo_index=0):
        self._pages = [dict(p) for p in pages]
        self._index = combo_index

    def currentIndex(self):
        return self._index

    def page_at(self, index=None):
        if index is None:
            index = self._index
        if index < 0 or index >= len(self._pages):
            return None
        return dict(self._pages[index])


def _page(*, client_id, page_instance_id, conversation_id="conv-1"):
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
        "realtime": True,
        "page_source": "live",
    }


def test_send_prefers_bound_page_over_gui_selection():
    bound = _page(client_id="bound-c", page_instance_id="bound-p")
    selected = _page(client_id="new-c", page_instance_id="new-p", conversation_id="conv-2")
    host = _GuiTargetHost([bound, selected], combo_index=1)
    session = _Session(
        {
            **default_remote_chatgpt(),
            "enabled": True,
            "client_id": "bound-c",
            "page_instance_id": "bound-p",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    target = host._resolve_conversation_action_target(session, action="send")
    assert isinstance(target, dict)
    assert (target.get("client_id") or "").strip() == "bound-c"
    assert (target.get("page_instance_id") or "").strip() == "bound-p"
    assert target.get("target_source") == "bound_page"


def test_gui_selection_differs_blocks_resolve_page_action():
    bound = _page(client_id="bound-c", page_instance_id="bound-p")
    selected = _page(client_id="new-c", page_instance_id="new-p", conversation_id="conv-2")
    host = _GuiTargetHost([bound, selected], combo_index=1)
    session = _Session(
        {
            **default_remote_chatgpt(),
            "enabled": True,
            "client_id": "bound-c",
            "page_instance_id": "bound-p",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "bind_state": "BOUND_CONVERSATION",
        }
    )
    result = host.resolve_page_action(session, action="send")
    assert result.decision == "blocked"
    assert result.reason_code == "selected_page_mismatch_bound_session"
    assert not result.allowed
    assert any("SELECTED_PAGE_MISMATCH" in line for line in host._logs)
