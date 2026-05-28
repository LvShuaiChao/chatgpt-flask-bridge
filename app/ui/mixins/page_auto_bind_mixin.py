"""自动绑定、首页预绑定、bootstrap 与对话创建绑定。"""

from app.server import get_bridge_status, get_message_state, is_server_running

import time
import uuid

from app.constants import (
    ASSISTANT_WAIT_TEXTS,
    CHATGPT_HOME_URL,
    ASSISTANT_REPLY_PENDING_STATUSES,
    TM_POLL_FRESH_SECONDS,
)
from app.models import (
    remote_binding_active,
    remote_binding_enabled,
    BIND_MODE_CONVERSATION,
    BIND_MODE_HOME_PENDING,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_TEMP_HOME_BOUND,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
    write_session_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import (
    can_sync_conversation,
    find_reusable_chatgpt_home_page,
    is_page_online,
    is_prebound_home_page,
    is_reusable_chatgpt_home_page,
    page_list_display_id,
    page_url_from,
)
from app.utils.page_snapshot import PageRegistry, pages_from_bridge_status
from app.utils.tm_activity import classify_tm_client_activity


class PageAutoBindMixin:
    IDLE_HOME_FRESH_SECONDS = float(TM_POLL_FRESH_SECONDS)
    BOOTSTRAP_CLAIM_TIMEOUT_SECONDS = 5.0
    REOPEN_BOUND_CONVERSATION_TIMEOUT_SECONDS = 45
    BOOTSTRAP_CREATE_TIMEOUT_SECONDS = 30.0

    def _remote_runtime_get(self, session, remote, key, default=None):
        from app.utils.bind_runtime import get_bind_runtime

        remote = remote if isinstance(remote, dict) else {}
        rt = get_bind_runtime(self, session)
        if hasattr(rt, key):
            val = getattr(rt, key)
            if val not in (None, "", 0, 0.0, False):
                return val
        legacy = remote.get(key, default)
        if legacy not in (None, "", 0, 0.0, False):
            return legacy
        return default

    def _remote_runtime_bool(self, session, remote, key):
        return bool(self._remote_runtime_get(session, remote, key, False))

    def _auto_bind_float_field(self, item, field, default=0.0):
        from app.utils.safe_parse import safe_float_field

        return safe_float_field(item, field, default)

    def _session_has_prebound_home_online(self, remote, bridge_status=None):
        remote = normalize_remote_chatgpt(remote)
        if self._remote_bind_state(remote) != BIND_STATE_PREBOUND_HOME:
            return False
        temp_page_id = (
            (remote.get("temp_page_id") or remote.get("page_display_id") or remote.get("page_no") or "")
            .strip()
        )
        status = bridge_status if bridge_status is not None else self._bridge_ui.last_bridge_status
        from app.utils.page_snapshot import PageRegistry
        from app.utils.page_status import is_page_online

        reg = getattr(self, "page_registry", None)
        if not isinstance(reg, PageRegistry) or not reg.matches_status(status):
            reg = PageRegistry.from_bridge_status(status)

        page_instance_id = (remote.get("page_instance_id") or "").strip()
        client_id = (remote.get("client_id") or "").strip()
        page_no = (remote.get("page_no") or temp_page_id or "").strip()

        if page_instance_id:
            page = reg.get_by_identity(client_id, page_instance_id)
            if page is not None:
                raw = page._raw if isinstance(page._raw, dict) else {}
                if is_page_online(raw):
                    return True

        if temp_page_id:
            page = reg.get_by_page_display_id(temp_page_id)
            if page is not None:
                raw = page._raw if isinstance(page._raw, dict) else {}
                if is_page_online(raw):
                    return True

        if client_id and page_no:
            matches = [
                p
                for p in reg.pages
                if str((p._raw or {}).get("page_no") or p.page_display_id or "").strip() == page_no
                and (p.client_id or "").strip() == client_id
            ]
            if len(matches) == 1:
                raw = matches[0]._raw if isinstance(matches[0]._raw, dict) else {}
                if is_page_online(raw):
                    return True

        if not client_id:
            return False
        for item in self._iter_tm_clients(status, online_only=True):
            if self._tm_client_id(item) != client_id:
                continue
            if page_instance_id and self._tm_page_instance_id(item) != page_instance_id:
                continue
            page_url = self._tm_page_url(item)
            if not self._is_bindable_chatgpt_url(page_url):
                continue
            poll_ts = self._auto_bind_float_field(
                item,
                "last_poll_at",
                self._auto_bind_float_field(item, "last_seen", 0),
            )
            if poll_ts and (time.time() - poll_ts) <= self.IDLE_HOME_FRESH_SECONDS:
                return True
        return False
    def _find_prebound_home_client(self, remote):
        remote = normalize_remote_chatgpt(remote)
        client_id = (
            remote.get("client_id") or ""
        ).strip()
        page_instance_id = (
            remote.get("page_instance_id")
            or remote.get("page_instance_id")
            or ""
        ).strip()
        for item in self._iter_tm_clients(self._bridge_ui.last_bridge_status, online_only=True, page_type="home"):
            if self._tm_client_id(item) != client_id:
                continue
            if page_instance_id and self._tm_page_instance_id(item) != page_instance_id:
                continue
            return dict(item)
        return None
    def _session_user_message_count(self, session):
        if session is None:
            return 0
        return sum(1 for msg in session.messages if msg.role == "user")
    def _is_new_local_session_without_remote_conversation(self, session):
        if not session:
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        conversation_id = self._remote_conversation_id(remote)
        bind_state = self._remote_bind_state(remote)

        if conversation_id:
            return False

        assistant_messages = [
            message
            for message in getattr(session, "messages", [])
            if getattr(message, "role", "") == "assistant"
            and getattr(message, "text", "").strip()
            and (message.content or "").strip() not in ASSISTANT_WAIT_TEXTS
        ]

        return bind_state in (
            BIND_STATE_UNBOUND,
            BIND_STATE_WAITING_HOME,
            BIND_STATE_PREBOUND_HOME,
            "",
            None,
        ) and not assistant_messages
    def _session_has_real_assistant_reply(self, session):
        if session is None:
            return False
        for message in getattr(session, "messages", []):
            if getattr(message, "role", "") != "assistant":
                continue
            text = (getattr(message, "text", "") or getattr(message, "content", "") or "").strip()
            if text and text not in ASSISTANT_WAIT_TEXTS:
                return True
        return False
    def _session_is_local_new_chat_flow(self, session):
        if not session:
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)

        conversation_id = self._remote_conversation_id(remote)

        if conversation_id:
            return False

        if bool(remote.get("created_from_home")):
            return False

        return not self._session_has_real_assistant_reply(session)
    def _session_has_wrong_existing_conversation_bind(self, session):
        if session is None:
            return False
        if not self._session_is_local_new_chat_flow(session):
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return False
        conversation_id = self._remote_conversation_id(remote)
        if not conversation_id:
            return False
        bind_state = self._remote_bind_state(remote)
        if bind_state != BIND_STATE_BOUND_CONVERSATION:
            return False
        return True
    def _reject_bind_existing_conversation_for_new_session(
        self, session, client_info, *, log_prefix="BIND"
    ):
        if not self._session_is_local_new_chat_flow(session):
            return False, ""
        if not isinstance(client_info, dict):
            return False, ""

        page_url = (
            client_info.get("url")
            or client_info.get("url")
            or (client_info.get("url") or "")
            or ""
        ).strip()
        page_type = (client_info.get("page_type") or "").strip()
        conversation_id = (
            client_info.get("conversation_id") or parse_conversation_id(page_url) or ""
        ).strip()
        if not conversation_id and page_type != "conversation":
            if page_url and "/c/" in page_url:
                conversation_id = parse_conversation_id(page_url) or ""
            else:
                return False, ""

        client_id = (client_info.get("client_id") or "").strip()
        session_id = (session.session_id if session else "") or ""
        self._append_log(
            f"[{log_prefix}][REJECT_EXISTING_CONVERSATION] "
            f"session_id={session_id} client_id={client_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"page_type={page_type or '-'} reason=new_local_session"
        )
        return True, (
            "当前 GUI 对话是新建空白对话，不能绑定到已有 ChatGPT 对话页。\n"
            "请使用空白 ChatGPT 首页创建新对话。"
        )
    def _idle_home_sort_key(self, item):
        activity = classify_tm_client_activity(item)
        tier = {
            "active_focused": 500,
            "active_visible": 400,
            "active_hidden": 300,
            "online_unknown": 200,
            "stale_hidden": 50,
            "offline": 0,
        }.get(activity, 0)
        last_focus_at = self._auto_bind_float_field(item, "last_focus_at", 0)
        last_seen = self._auto_bind_float_field(item, "last_seen", 0)
        poll_ts = self._auto_bind_float_field(
            item,
            "last_poll_at",
            self._auto_bind_float_field(item, "last_seen", 0),
        )
        poll_age = time.time() - poll_ts if poll_ts else 999999.0
        poll_fresh = 1 if poll_age <= float(TM_POLL_FRESH_SECONDS) else 0
        client_id = (item.get("client_id") or "").strip()
        page_instance_id = (item.get("page_instance_id") or "").strip()
        known_clients = getattr(self._auto_bind, 'pending_known_clients', set()) or set()
        known_instances = (
            getattr(self._auto_bind, 'pending_known_page_instances', set()) or set()
        )
        is_new_client = 1 if client_id and client_id not in known_clients else 0
        is_new_instance = (
            1 if page_instance_id and page_instance_id not in known_instances else 0
        )
        is_new_score = 1 if is_new_client or is_new_instance else 0
        return (
            tier,
            poll_fresh,
            last_focus_at,
            1 if item.get("has_focus") else 0,
            is_new_score,
            last_seen,
        )
    def _idle_home_selection_reason(self, item):
        visible = (
            item.get("visibility_state") or ""
        ).strip()
        activity = classify_tm_client_activity(item)
        if activity == "active_focused" or item.get("has_focus"):
            return "focused_home"
        if self._auto_bind_float_field(item, "last_focus_at", 0) > 0:
            return "recent_focused_home"
        if activity == "active_visible" or visible == "visible":
            return "visible_home"
        if activity == "active_hidden":
            return "active_hidden_home"
        if activity == "stale_hidden":
            return "stale_hidden_home"
        return "latest_home"
    @staticmethod
    def _session_bind_request_id(remote):
        remote = normalize_remote_chatgpt(remote)
        return (
            remote.get("bind_request_id") or ""
        ).strip()

    def _resolve_session_for_conversation_created(self, item):
        payload = item.get("payload") or {}
        local_sid = (
            (payload.get("local_session_id") or item.get("session_id") or "")
        ).strip()
        if local_sid and local_sid in self._sessions:
            return self._sessions[local_sid]
        bridge_id = (
            item.get("message_id") or payload.get("message_id") or ""
        ).strip()
        if bridge_id:
            session_id = (
                self._message_to_session.get(bridge_id)
                or item.get("session_id")
                or ""
            ).strip()
            if session_id and session_id in self._sessions:
                return self._sessions[session_id]

        bind_token = (
            payload.get("bind_request_id")
            or ""
        ).strip()
        if bind_token:
            for session in self._sessions.values():
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                expected = self._session_bind_request_id(remote)
                if expected and expected == bind_token:
                    return session

        page_instance_id = (payload.get("page_instance_id") or "").strip()
        if page_instance_id:
            for session in self._sessions.values():
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                bound_instance = (remote.get("page_instance_id") or "").strip()
                prebound_instance = (
                    remote.get("page_instance_id") or ""
                ).strip()
                if bound_instance == page_instance_id:
                    return session
                if prebound_instance == page_instance_id:
                    return session

        client_id = (
            payload.get("client_id") or item.get("client_id") or ""
        ).strip()
        if client_id:
            for session in self._sessions.values():
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                bind_state = self._remote_bind_state(remote)
                if bind_state not in (
                    BIND_STATE_PREBOUND_HOME,
                    BIND_STATE_WAITING_CONVERSATION_CREATED,
                    BIND_STATE_WAITING_HOME,
                ):
                    continue
                bound_client = (
                    remote.get("client_id")
                    or remote.get("client_id")
                    or remote.get("client_id")
                    or ""
                ).strip()
                if bound_client == client_id:
                    return session

        return None
    @staticmethod
    def _idle_home_is_user_visible(item):
        """用户是否容易看到该首页（非后台 hidden 标签）。"""
        if not isinstance(item, dict):
            return False
        if item.get("has_focus"):
            return True
        vis = (item.get("visibility_state") or "").strip()
        return vis == "visible"

    def _idle_home_skip_reason(
        self,
        item,
        status=None,
        require_user_visible=False,
        exclude_session_id="",
    ):
        page_type = (item.get("page_type") or "").strip()
        if page_type != "home":
            return "not_home"
        if self._is_ignored_or_unusable_home_client(item):
            if page_type in ("ignored", "closing", "stale", "other", "unknown"):
                return page_type
            conversation_id = (item.get("conversation_id") or "").strip()
            if conversation_id and conversation_id != "-":
                return "has_conversation"
            return "ignored_page"
        client_id = (item.get("client_id") or "").strip()
        page_instance_id = (item.get("page_instance_id") or "").strip()
        conversation_id = (item.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return "has_conversation"
        if self._is_home_client_used_by_any_session(
            client_id,
            page_instance_id,
            exclude_session_id=exclude_session_id,
        ):
            return "used_by_other_session"
        if self._home_client_has_pending_bridge_work(
            client_id, page_instance_id, status
        ):
            return "pending_work"
        activity = classify_tm_client_activity(item)
        if activity == "stale_hidden":
            return "stale_hidden_home"
        if activity == "offline":
            return "offline_home"
        if not self._is_fresh_idle_home_client(item):
            return "stale_home"
        if require_user_visible and not self._idle_home_is_user_visible(item):
            return "hidden_or_background_home"
        return ""
    def _is_fresh_idle_home_client(self, item):
        if not isinstance(item, dict):
            return False
        page_type = (item.get("page_type") or "").strip()
        if page_type != "home":
            return False

        conversation_id = (item.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return False

        client_id = (item.get("client_id") or "").strip()
        if not client_id:
            return False

        poll_ts = self._auto_bind_float_field(
            item,
            "last_poll_at",
            self._auto_bind_float_field(item, "last_seen", 0),
        )
        if not poll_ts:
            return False
        age = time.time() - poll_ts
        if age > self.IDLE_HOME_FRESH_SECONDS:
            return False

        return True
    def _is_ignored_or_unusable_home_client(self, client_info):
        if not isinstance(client_info, dict):
            return True
        page_type = (client_info.get("page_type") or "").strip()
        if page_type in ("ignored", "closing", "stale", "other", "unknown"):
            return True
        page_url = (client_info.get("url") or "").strip()
        if not self._is_bindable_chatgpt_url(page_url):
            return True
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return True
        return False
    def _home_client_has_pending_bridge_work(self, client_id, page_instance_id, status=None):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()
        status = status or self._bridge_ui.last_bridge_status or {}

        for waiting in status.get("waiting_acks") or []:
            if not isinstance(waiting, dict):
                continue
            if not waiting.get("bootstrap_conversation"):
                continue
            message_id = (waiting.get("message_id") or "").strip()
            if message_id and self._is_finalized(message_id):
                continue
            target_client = (
                waiting.get("delivered_to") or ""
            ).strip()
            target_instance = (waiting.get("target_page_instance_id") or "").strip()
            if target_client and target_client == client_id:
                return True
            if (
                target_instance
                and page_instance_id
                and target_instance == page_instance_id
            ):
                return True

        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not self._remote_runtime_bool(session, remote, "bootstrap_in_progress"):
                continue
            home_client = (
                remote.get("client_id") or ""
            ).strip()
            home_instance = (
                remote.get("page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            if home_client != client_id:
                continue
            if page_instance_id and home_instance and home_instance != page_instance_id:
                continue
            return True

        return False
    def _is_home_client_used_by_any_session(
        self, client_id, page_instance_id, exclude_session_id=""
    ):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()
        exclude_session_id = (exclude_session_id or "").strip()

        for session in self._sessions.values():
            if exclude_session_id and session.session_id == exclude_session_id:
                continue
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)

            prebound_client = (remote.get("client_id") or "").strip()
            prebound_instance = (
                remote.get("page_instance_id") or ""
            ).strip()
            if prebound_client == client_id:
                if not page_instance_id or not prebound_instance:
                    return True
                if prebound_instance == page_instance_id:
                    return True
            if (
                page_instance_id
                and prebound_instance
                and prebound_instance == page_instance_id
            ):
                return True

            bound_client = (remote.get("client_id") or "").strip()
            bound_instance = (remote.get("page_instance_id") or "").strip()
            if bind_state in (
                BIND_STATE_PREBOUND_HOME,
                BIND_STATE_WAITING_CONVERSATION_CREATED,
                BIND_STATE_WAITING_HOME,
            ):
                if bound_client == client_id:
                    if not page_instance_id or not bound_instance:
                        return True
                    if bound_instance == page_instance_id:
                        return True
                reserved_client = (remote.get("client_id") or "").strip()
                reserved_instance = (
                    remote.get("page_instance_id") or ""
                ).strip()
                if reserved_client == client_id:
                    if not page_instance_id or not reserved_instance:
                        return True
                    if reserved_instance == page_instance_id:
                        return True

            if bind_state == BIND_STATE_PREBOUND_HOME and prebound_client == client_id:
                for message in session.messages:
                    bridge_id = (message.bridge_message_id or "").strip()
                    if not bridge_id or message.role not in ("user", "assistant"):
                        continue
                    if self._is_finalized(bridge_id):
                        continue
                    status_text = (message.ui_status or "").strip()
                    if status_text in ASSISTANT_REPLY_PENDING_STATUSES:
                        return True
                    if message.content in ASSISTANT_WAIT_TEXTS:
                        return True

        return False
    def _find_idle_chatgpt_home_client(
        self, status=None, session_id="", require_user_visible=False
    ):
        status = status or self._bridge_ui.last_bridge_status or {}
        session_id = (session_id or "").strip()
        candidates = []
        for item in self._iter_tm_clients(status, online_only=True, page_type="home"):
            client_id = self._tm_client_id(item)
            skip_reason = self._idle_home_skip_reason(
                item,
                status,
                require_user_visible=require_user_visible,
                exclude_session_id=session_id,
            )
            if skip_reason:
                if client_id:
                    self._append_log(
                        f"[AUTO_BIND][SKIP_IDLE_HOME] client_id={client_id} "
                        f"reason={skip_reason}"
                    )
                continue
            if not client_id:
                continue
            candidates.append(dict(item))

        if not candidates:
            return None

        focused_home = ""
        recent_focused_home = ""
        best_focus_at = 0.0
        for item in candidates:
            cid = (item.get("client_id") or "").strip()
            if not cid:
                continue
            if item.get("has_focus") and not focused_home:
                focused_home = cid
            last_focus_at = self._auto_bind_float_field(item, "last_focus_at", 0)
            if last_focus_at > best_focus_at:
                best_focus_at = last_focus_at
                recent_focused_home = cid

        self._append_log(
            f"[AUTO_BIND][IDLE_HOME_CANDIDATES] session_id={session_id or '-'} "
            f"count={len(candidates)} "
            f"focused_home={focused_home or '-'} "
            f"recent_focused_home={recent_focused_home or '-'}"
        )

        candidates.sort(key=self._idle_home_sort_key, reverse=True)
        selected = candidates[0]
        client_id = (selected.get("client_id") or "").strip()
        page_instance_id = (selected.get("page_instance_id") or "").strip()
        visible = (
            selected.get("visibility_state") or ""
        ).strip()
        reason = self._idle_home_selection_reason(selected)
        self._append_log(
            f"[AUTO_BIND][SELECT_IDLE_HOME] session_id={session_id or '-'} "
            f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
            f"has_focus={bool(selected.get('has_focus'))} "
            f"last_focus_at={self._auto_bind_float_field(selected, 'last_focus_at', 0):.3f} "
            f"visible={visible or '-'} "
            f"last_seen={self._auto_bind_float_field(selected, 'last_seen', 0):.3f} "
            f"reason={reason}"
        )
        return selected
    def _session_has_claimed_or_acked_bootstrap(self, session):
        if session is None:
            return False
        for message in session.messages:
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = get_message_state(bridge_id)
            if not state or not state.get("bootstrap_conversation"):
                continue
            status = (state.get("status") or "").strip()
            if status not in ("queued", "cancelled"):
                return True
            if bridge_id in self._bridge_msg.ack_success_message_ids:
                return True
        return False
    def _prebound_home_is_retryable(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if self._remote_bind_state(remote) != BIND_STATE_PREBOUND_HOME:
            return False
        if (remote.get("conversation_id") or "").strip():
            return False
        if self._session_has_prebound_home_online(remote):
            return False
        if self._remote_runtime_bool(session, remote, "bootstrap_in_progress"):
            return False
        if self._session_has_claimed_or_acked_bootstrap(session):
            return False
        return True
    def _session_needs_first_message_bind(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        conversation_id = self._remote_conversation_id(remote)
        if conversation_id:
            return False
        bind_state = self._remote_bind_state(remote)
        if bind_state == BIND_STATE_BOUND_CONVERSATION:
            return False
        if bind_state == BIND_STATE_PREBOUND_HOME:
            return self._prebound_home_is_retryable(session)
        return bind_state in (BIND_STATE_UNBOUND, BIND_STATE_WAITING_HOME, "")
    def _start_waiting_home_on_send(self, session):
        session_id = (session.session_id if session else "").strip()
        if not session_id:
            return

        if (
            self._auto_bind.pending_session_id
            and self._auto_bind.pending_session_id != session_id
        ):
            self._append_log(
                f"[AUTO_BIND][REPLACE] old={self._auto_bind.pending_session_id} "
                f"new={session_id}"
            )

        status = self._bridge_ui.last_bridge_status or {}
        clients = status.get("pages") or []
        self._auto_bind.pending_session_id = session_id
        self._auto_bind.pending_until = time.time() + 30
        self._auto_bind.pending_known_clients = {
            (item.get("client_id") or "").strip()
            for item in clients
            if isinstance(item, dict) and (item.get("client_id") or "").strip()
        }
        self._auto_bind.pending_known_page_instances = {
            (item.get("page_instance_id") or "").strip()
            for item in clients
            if isinstance(item, dict) and (item.get("page_instance_id") or "").strip()
        }

        remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_request_id = self._session_bind_request_id(remote_now)
        if not bind_request_id:
            bind_request_id = uuid.uuid4().hex
            session.remote_chatgpt = {
                **remote_now,
                "bind_request_id": bind_request_id,
                "bind_started_at": time.time(),
            }
            self._schedule_save_sessions_to_disk()
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)

        url = f"{CHATGPT_HOME_URL}#xz_bind_token={bind_request_id}"
        opened = self._open_url_in_browser(url, "发送首条消息时打开 ChatGPT 首页")
        method = "system_browser"
        result = "success" if opened else "failed"
        if not opened and is_server_running():
            self._push_open_url(url, active=True, label="发送首条消息时打开 ChatGPT 首页")
            method = "bridge_command"
            result = "queued"

        pending_text = (
            normalize_remote_chatgpt(session.remote_chatgpt).get("pending_bootstrap_content")
            or ""
        ).strip()
        self._append_log(
            f"[AUTO_BIND][OPEN_HOME_ON_SEND] session_id={session_id} "
            f"bind_request_id={bind_request_id} url={url} "
            f"method={method} result={result} "
            f"reason=no_idle_home pending_text_len={len(pending_text)}"
        )
        self._append_log(
            f"[AUTO_BIND][WAITING_HOME] session_id={session_id} "
            f"pending_text_len={len(pending_text)}"
        )
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._apply_chat_bind_visual_state()

    _AUTO_BIND_HOME_WAIT_SEC = 8.0
    _AUTO_BIND_HOME_POLL_SEC = 0.3

    def _is_session_unbound(self, session) -> bool:
        if session is None:
            return True
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        return self._remote_bind_state(remote) == BIND_STATE_UNBOUND

    def _set_auto_open_home_in_progress(self, in_progress: bool, session_id: str = "") -> None:
        if not hasattr(self, "_bind_display"):
            from app.ui.main_window_state import BindDisplayState

            self._bind_display = BindDisplayState()
        self._bind_display.auto_open_home_in_progress = bool(in_progress)
        self._bind_display.auto_open_home_session_id = (
            (session_id or "").strip() if in_progress else ""
        )
        if hasattr(self, "send_btn") and self.send_btn is not None:
            if in_progress:
                self.send_btn.setEnabled(False)
                self.send_btn.setToolTip("正在打开 ChatGPT 页面，请稍等…")
            else:
                self.send_btn.setEnabled(True)
                self.send_btn.setToolTip("")

    def _registry_page_display_ids(self, registry=None) -> set[str]:
        reg = registry
        if not isinstance(reg, PageRegistry):
            status = self._bridge_ui.last_bridge_status or {}
            if is_server_running():
                try:
                    status = get_bridge_status() or status
                except Exception as exc:
                    detail = (
                        f"[AUTO_BIND_HOME][STATUS_FETCH_FAILED] error={exc!r}"
                    )
                    self._append_log(detail, echo=True, level="ERROR")
            reg = PageRegistry.from_bridge_status(status)
        ids: set[str] = set()
        for page in reg.pages:
            raw = page._raw if isinstance(page._raw, dict) else {}
            page_id = str(
                raw.get("page_display_id")
                or raw.get("page_no")
                or getattr(page, "page_display_id", "")
                or ""
            ).strip()
            if page_id:
                ids.add(page_id)
        return ids

    def _find_new_online_chatgpt_home_page(
        self, before_page_ids: set[str], registry=None
    ):
        reg = registry
        if not isinstance(reg, PageRegistry):
            status = self._bridge_ui.last_bridge_status or {}
            if is_server_running():
                try:
                    status = get_bridge_status() or status
                except Exception as exc:
                    self._append_log(
                        f"[AUTO_BIND_HOME][STATUS_FETCH_FAILED] error={exc!r}",
                        echo=True,
                        level="ERROR",
                    )
            reg = PageRegistry.from_bridge_status(status)
        for page in reg.pages:
            raw = page._raw if isinstance(page._raw, dict) else {}
            page_id = str(
                raw.get("page_display_id")
                or raw.get("page_no")
                or getattr(page, "page_display_id", "")
                or ""
            ).strip()
            if not page_id or page_id in before_page_ids:
                continue
            if not is_page_online(raw):
                continue
            if not is_prebound_home_page(raw):
                continue
            conversation_id = (raw.get("conversation_id") or "").strip()
            if conversation_id:
                continue
            return raw
        return None

    def _apply_temp_home_bound_from_page(self, session, page_raw: dict) -> bool:
        if session is None or not isinstance(page_raw, dict):
            return False
        page_display_id = str(
            page_raw.get("page_display_id") or page_raw.get("page_no") or ""
        ).strip()
        client_id = (page_raw.get("client_id") or "").strip()
        page_instance_id = (page_raw.get("page_instance_id") or "").strip()
        page_url = page_url_from(page_raw) or CHATGPT_HOME_URL
        if not page_display_id:
            return False
        write_session_remote_chatgpt(
            session,
            bind_state=BIND_STATE_TEMP_HOME_BOUND,
            bind_mode=BIND_MODE_HOME_PENDING,
            page_display_id=page_display_id,
            temp_page_id=page_display_id,
            page_no=page_display_id,
            url=page_url or CHATGPT_HOME_URL,
            conversation_id="",
            client_id=client_id,
            page_instance_id=page_instance_id,
            page_type="home",
        )
        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()
        if hasattr(self, "_refresh_current_session_binding_display"):
            self._refresh_current_session_binding_display()
        if hasattr(self, "_refresh_session_list"):
            self._refresh_session_list(select_session_id=session.session_id)
        if hasattr(self, "_apply_chat_bind_visual_state"):
            self._apply_chat_bind_visual_state()
        self._append_log(
            "[AUTO_BIND_HOME][SUCCESS] "
            f"session_id={session.session_id} "
            f"bind_state={BIND_STATE_TEMP_HOME_BOUND} "
            f"temp_page_id={page_display_id}",
            echo=True,
        )
        return True

    def _wait_for_existing_temp_home_page_online(
        self, session, temp_page_id: str
    ) -> bool:
        temp_page_id = (temp_page_id or "").strip()
        if not temp_page_id:
            return False
        deadline = time.time() + self._AUTO_BIND_HOME_WAIT_SEC
        while time.time() < deadline:
            status = self._bridge_ui.last_bridge_status or {}
            if is_server_running():
                try:
                    status = get_bridge_status() or status
                    self._bridge_ui.last_bridge_status = status
                except Exception as exc:
                    self._append_log(
                        f"[AUTO_BIND_HOME][POLL_STATUS_FAILED] error={exc!r}",
                        echo=True,
                        level="ERROR",
                    )
            registry = PageRegistry.from_bridge_status(status)
            page = registry.get_by_page_display_id(temp_page_id)
            if page is not None:
                raw = page._raw if isinstance(page._raw, dict) else {}
                if is_page_online(raw) and is_prebound_home_page(raw):
                    return True
            try:
                from PyQt5.QtWidgets import QApplication

                app = QApplication.instance()
                if app is not None:
                    app.processEvents()
            except Exception as exc:
                self._append_log(
                    f"[AUTO_BIND_HOME][PROCESS_EVENTS_FAILED] error={exc!r}",
                    echo=True,
                    level="ERROR",
                )
            time.sleep(self._AUTO_BIND_HOME_POLL_SEC)
        self._append_log(
            "[AUTO_BIND_HOME][TIMEOUT] "
            f"session_id={session.session_id} "
            f"temp_page_id={temp_page_id} "
            f"wait_sec={int(self._AUTO_BIND_HOME_WAIT_SEC)}",
            echo=True,
        )
        return False

    def _wait_for_temp_home_page_after_open(
        self, session, before_page_ids: set[str]
    ) -> bool:
        deadline = time.time() + self._AUTO_BIND_HOME_WAIT_SEC
        while time.time() < deadline:
            status = self._bridge_ui.last_bridge_status or {}
            if is_server_running():
                try:
                    status = get_bridge_status() or status
                    self._bridge_ui.last_bridge_status = status
                except Exception as exc:
                    self._append_log(
                        f"[AUTO_BIND_HOME][POLL_STATUS_FAILED] error={exc!r}",
                        echo=True,
                        level="ERROR",
                    )
            registry = PageRegistry.from_bridge_status(status)
            self.page_registry = registry
            if hasattr(self, "_upgrade_temp_home_sessions_from_registry"):
                self._upgrade_temp_home_sessions_from_registry(registry)
            page_raw = self._find_new_online_chatgpt_home_page(
                before_page_ids, registry=registry
            )
            if page_raw is not None:
                temp_page_id = str(
                    page_raw.get("page_display_id") or page_raw.get("page_no") or ""
                ).strip()
                self._append_log(
                    "[AUTO_BIND_HOME][FOUND] "
                    f"session_id={session.session_id} "
                    f"temp_page_id={temp_page_id or '-'} "
                    f"client_id={(page_raw.get('client_id') or '-')} "
                    f"page_instance_id={(page_raw.get('page_instance_id') or '-')} "
                    f"url={page_url_from(page_raw) or CHATGPT_HOME_URL}",
                    echo=True,
                )
                return self._apply_temp_home_bound_from_page(session, page_raw)
            try:
                from PyQt5.QtWidgets import QApplication

                app = QApplication.instance()
                if app is not None:
                    app.processEvents()
            except Exception as exc:
                self._append_log(
                    f"[AUTO_BIND_HOME][PROCESS_EVENTS_FAILED] error={exc!r}",
                    echo=True,
                    level="ERROR",
                )
            time.sleep(self._AUTO_BIND_HOME_POLL_SEC)
        self._append_log(
            "[AUTO_BIND_HOME][TIMEOUT] "
            f"session_id={session.session_id} "
            f"wait_sec={int(self._AUTO_BIND_HOME_WAIT_SEC)}",
            echo=True,
        )
        return False

    def _get_current_bridge_pages(self):
        """bridge 页面列表（pages / summary.pages）。"""
        status = self._bridge_ui.last_bridge_status or {}
        if is_server_running():
            try:
                status = get_bridge_status() or status
                self._bridge_ui.last_bridge_status = status
            except Exception as exc:
                self._append_log(
                    f"[CHAT_BIND][BRIDGE_STATUS_FAILED] error={exc!r}",
                    echo=True,
                    level="ERROR",
                )
        return pages_from_bridge_status(status)

    def _get_selected_page_id_from_ui(self) -> str:
        if not hasattr(self, "_get_selected_tm_page_from_combo"):
            return ""
        selected = self._get_selected_tm_page_from_combo()
        if not isinstance(selected, dict):
            return ""
        return page_list_display_id(selected)

    def _reusable_home_page_eligible_for_session(self, page, session_id="") -> bool:
        if not isinstance(page, dict):
            return False
        if not is_reusable_chatgpt_home_page(page):
            return False
        client_id = (page.get("client_id") or "").strip()
        page_instance_id = (page.get("page_instance_id") or "").strip()
        if self._is_home_client_used_by_any_session(
            client_id,
            page_instance_id,
            exclude_session_id=session_id,
        ):
            return False
        if self._home_client_has_pending_bridge_work(
            client_id,
            page_instance_id,
            self._bridge_ui.last_bridge_status,
        ):
            return False
        return True

    def _find_reusable_chatgpt_home_page_for_session(self, session):
        pages = self._get_current_bridge_pages()
        session_id = (session.session_id if session else "").strip()
        preferred_page_id = self._get_selected_page_id_from_ui()
        reusable_count = sum(
            1
            for page in pages
            if isinstance(page, dict) and is_reusable_chatgpt_home_page(page)
        )
        self._append_log(
            "[CHAT_BIND][FIND_REUSABLE_HOME] "
            f"selectedPageId={preferred_page_id or '-'} "
            f"totalPages={len(pages)} reusableCount={reusable_count}",
            echo=True,
        )

        def _eligible(page: dict) -> bool:
            return self._reusable_home_page_eligible_for_session(page, session_id)

        return find_reusable_chatgpt_home_page(
            pages,
            preferred_page_id,
            is_eligible=_eligible,
        )

    def _bind_local_conversation_to_temporary_home_page(self, session, page, *, reserve_reason=""):
        if not self._prebound_home_bind_to_session(
            session,
            page,
            silent=True,
            reserve_reason=reserve_reason or "reuse_existing_home",
        ):
            return False
        page_id = page_list_display_id(page)
        page_instance_id = (page.get("page_instance_id") or "").strip()
        self._append_log(
            "[CHAT_BIND][REUSE_HOME_PAGE] "
            f"localConversationId={session.session_id} "
            f"page_id={page_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"url={page_url_from(page) or '-'}",
            echo=True,
        )
        return True

    def _open_new_chatgpt_home_page_for_conversation(self, session) -> bool:
        """无可用复用首页时，打开新的 ChatGPT 首页并等待上报。"""
        bind_display = getattr(self, "_bind_display", None)
        if bind_display is not None and bind_display.auto_open_home_in_progress:
            pending_sid = (bind_display.auto_open_home_session_id or "").strip()
            self._append_log(
                "[AUTO_BIND_HOME][SKIP_DUPLICATE] reason=in_progress "
                f"session_id={session.session_id} pending_session_id={pending_sid or '-'}",
                echo=True,
            )
            if pending_sid == session.session_id:
                before_ids = self._registry_page_display_ids()
                return self._wait_for_temp_home_page_after_open(session, before_ids)
            if hasattr(self, "_add_system_message"):
                self._add_system_message("正在打开 ChatGPT 页面，请稍等。")
            return False

        before_page_ids = self._registry_page_display_ids()
        self._append_log(
            "[AUTO_BIND_HOME][START] "
            f"session_id={session.session_id} "
            f"before_page_ids={sorted(before_page_ids) or []}",
            echo=True,
        )

        self._set_auto_open_home_in_progress(True, session.session_id)
        opened = False
        try:
            if hasattr(self, "_open_or_queue_url"):
                opened = self._open_or_queue_url(
                    CHATGPT_HOME_URL, label="发送时自动打开 ChatGPT 首页"
                )
            elif hasattr(self, "_on_open_chatgpt_home"):
                self._on_open_chatgpt_home()
                opened = True
            else:
                self._append_log(
                    "[AUTO_BIND_HOME][OPEN_FAILED] reason=no_open_handler",
                    echo=True,
                    level="ERROR",
                )
                return False

            self._append_log(
                f"[AUTO_BIND_HOME][OPEN_REQUESTED] opened={'true' if opened else 'false'}",
                echo=True,
            )
            if not opened:
                return False
            return self._wait_for_temp_home_page_after_open(session, before_page_ids)
        except Exception as exc:
            import traceback

            self._append_log(
                f"[AUTO_BIND_HOME][ERROR] session_id={session.session_id} "
                f"error={exc!r}\n{traceback.format_exc()}",
                echo=True,
                level="ERROR",
            )
            return False
        finally:
            self._set_auto_open_home_in_progress(False)

    def _ensure_page_for_local_conversation_send(self, session) -> bool:
        """
        本地对话首条发送前确保 ChatGPT 页面：
        稳定对话绑定 → 已有临时绑定 → 复用在线首页 → 打开新首页。
        """
        if session is None:
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        conversation_id = (remote.get("conversation_id") or "").strip()

        if bind_state == BIND_STATE_BOUND_CONVERSATION and conversation_id:
            return True

        if self._is_temp_home_bound_state(bind_state):
            if hasattr(self, "_resolve_temp_home_send_target"):
                temp_info = self._resolve_temp_home_send_target(session, remote)
                if temp_info.get("matched"):
                    self._append_log(
                        "[CHAT_BIND][REUSE_PENDING_HOME] "
                        f"localConversationId={session.session_id} "
                        f"page_id={temp_info.get('temp_page_id') or '-'} "
                        f"page_instance_id={temp_info.get('page_instance_id') or '-'}",
                        echo=True,
                    )
                    return True
            temp_page_id = (
                remote.get("temp_page_id")
                or remote.get("page_display_id")
                or ""
            ).strip()
            if temp_page_id:
                return self._wait_for_existing_temp_home_page_online(
                    session, temp_page_id
                )

        if bind_state != BIND_STATE_UNBOUND and remote_binding_enabled(remote):
            return True

        reusable_home = self._find_reusable_chatgpt_home_page_for_session(session)
        if reusable_home is not None:
            return self._bind_local_conversation_to_temporary_home_page(
                session,
                reusable_home,
                reserve_reason="reuse_existing_home_for_first_send",
            )

        self._append_log(
            "[CHAT_BIND][OPEN_NEW_HOME] "
            f"reason=no_reusable_home_page localConversationId={session.session_id}",
            echo=True,
        )
        return self._open_new_chatgpt_home_page_for_conversation(session)

    def _ensure_temp_home_bound_for_send(self, session) -> bool:
        """兼容入口：统一走 _ensure_page_for_local_conversation_send。"""
        return self._ensure_page_for_local_conversation_send(session)

    def _prepare_first_message_binding(self, session, text):
        if self._session_has_wrong_existing_conversation_bind(session):
            self._append_log(
                f"[BIND][RESET_WRONG_CONVERSATION] session_id={session.session_id} "
                f"reason=new_local_session_cannot_keep_existing_conversation"
            )
            session.remote_chatgpt = default_remote_chatgpt()
            session.updated_at = time.time()
            self._schedule_save_sessions_to_disk()

        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bind_state = self._remote_bind_state(remote)

        if (
            bind_state == BIND_STATE_PREBOUND_HOME
            and not self._session_has_prebound_home_online(remote)
        ):
            old_client = (
                remote.get("client_id") or remote.get("client_id") or "-"
            )
            self._append_log(
                f"[AUTO_BIND][RELEASE_STALE_HOME] session_id={session.session_id} "
                f"client_id={old_client} reason=prebound_home_offline"
            )
            session.remote_chatgpt = {
                **default_remote_chatgpt(),
                "bind_state": BIND_STATE_UNBOUND,
            }
            session.updated_at = time.time()
            self._schedule_save_sessions_to_disk()
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)

        if not self._session_needs_first_message_bind(session):
            return True, ""

        if bind_state == BIND_STATE_WAITING_HOME:
            pending = (remote.get("pending_bootstrap_content") or "").strip()
            if pending:
                return (
                    False,
                    "正在等待 ChatGPT 首页上线，首条消息将在页面上线后自动发送。",
                )
            self._try_finish_pending_auto_bind(self._bridge_ui.last_bridge_status or {})
            remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
            bind_state = self._remote_bind_state(remote)
            if bind_state == BIND_STATE_WAITING_HOME:
                return False, "正在等待 ChatGPT 首页上线，请稍候。"

        reusable_home = self._find_reusable_chatgpt_home_page_for_session(session)
        if reusable_home is not None:
            if self._bind_local_conversation_to_temporary_home_page(
                session,
                reusable_home,
                reserve_reason="first_send_reuse_home",
            ):
                self._add_system_message(
                    "已复用现有 ChatGPT 首页，发送首条消息后将等待创建新对话..."
                )
                return True, ""

        idle_home = self._find_idle_chatgpt_home_client(
            session_id=session.session_id if session else "",
            require_user_visible=True,
        )
        if idle_home:
            client_id = (idle_home.get("client_id") or "").strip()
            page_instance_id = (idle_home.get("page_instance_id") or "").strip()
            visible = (
                idle_home.get("visibility_state") or ""
            ).strip()
            reason = self._idle_home_selection_reason(idle_home)
            if not self._prebound_home_bind_to_session(
                session, idle_home, silent=True, reserve_reason=reason
            ):
                return False, "预绑定空闲 ChatGPT 首页失败，请重试或手动绑定。"
            self._append_log(
                f"[AUTO_BIND][USE_IDLE_HOME] session_id={session.session_id} "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'}"
            )
            self._append_log(
                f"[AUTO_BIND][RESERVE_IDLE_HOME] session_id={session.session_id} "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
                f"has_focus={bool(idle_home.get('has_focus'))} "
                f"last_focus_at={self._auto_bind_float_field(idle_home, 'last_focus_at', 0):.3f} "
                f"visible={visible or '-'} reason={reason}"
            )
            self._add_system_message(
                "已使用空闲 ChatGPT 首页发送首条消息，等待创建新对话..."
            )
            return True, ""

        if hasattr(self, "_ensure_page_for_local_conversation_send"):
            ok = self._ensure_page_for_local_conversation_send(session)
        elif hasattr(self, "_ensure_temp_home_bound_for_send"):
            ok = self._ensure_temp_home_bound_for_send(session)
        else:
            ok = False
        if ok:
            return True, ""
        return (
            False,
            "自动打开 ChatGPT 页面失败，请手动打开页面后重试。",
        )

    def _ensure_visible_chatgpt_home_for_new_session(self, session):
        """新建本地会话后：绑定用户可见的空闲首页，或通过绑定令牌打开新的可见首页。"""
        if session is None:
            return
        if self._session_has_wrong_existing_conversation_bind(session):
            self._append_log(
                f"[BIND][RESET_WRONG_CONVERSATION] session_id={session.session_id} "
                f"reason=new_local_session_cannot_keep_existing_conversation"
            )
            session.remote_chatgpt = default_remote_chatgpt()
            session.updated_at = time.time()
            self._schedule_save_sessions_to_disk()

        if not self._session_is_local_new_chat_flow(session):
            return

        sid = session.session_id
        reusable_home = self._find_reusable_chatgpt_home_page_for_session(session)
        if reusable_home is not None:
            if self._bind_local_conversation_to_temporary_home_page(
                session,
                reusable_home,
                reserve_reason="new_session_reuse_home",
            ):
                self._append_log(
                    f"[NEW_SESSION][HOME_REUSED] session_id={sid} "
                    f"page_id={page_list_display_id(reusable_home) or '-'}",
                    echo=True,
                )
                self._append_session_message(
                    session,
                    "system",
                    "已复用现有 ChatGPT 首页，可以发送首条消息。",
                )
                self._render_session_chat(session, force_bottom=True)
                if hasattr(self, "schedule_page_registry_refresh"):
                    self.schedule_page_registry_refresh(reason="auto_bind")
                self._apply_chat_bind_visual_state()
                self._schedule_save_sessions_to_disk()
            return

        vhome = self._find_idle_chatgpt_home_client(
            session_id=sid, require_user_visible=True
        )
        if vhome:
            client_id = (vhome.get("client_id") or "").strip()
            page_instance_id = (vhome.get("page_instance_id") or "").strip()
            reason = self._idle_home_selection_reason(vhome)
            if self._prebound_home_bind_to_session(
                session, vhome, silent=True, reserve_reason=reason
            ):
                self._append_log(
                    f"[NEW_SESSION][HOME_READY] session_id={sid} client_id={client_id} "
                    f"page_instance_id={page_instance_id or '-'} reason={reason} "
                    f"user_visible=true"
                )
                self._append_session_message(
                    session,
                    "system",
                    "已准备可见的 ChatGPT 首页，可以发送首条消息。",
                )
                self._render_session_chat(session, force_bottom=True)
                if hasattr(self, "schedule_page_registry_refresh"):
                    self.schedule_page_registry_refresh(reason="auto_bind")
                self._apply_chat_bind_visual_state()
                self._schedule_save_sessions_to_disk()
            return

        hhome = self._find_idle_chatgpt_home_client(
            session_id=sid, require_user_visible=False
        )
        if hhome and not self._idle_home_is_user_visible(hhome):
            cid = (hhome.get("client_id") or "").strip()
            pid = (hhome.get("page_instance_id") or "").strip()
            self._append_log(
                f"[NEW_SESSION][HOME_HIDDEN] client_id={cid} "
                f"page_instance_id={pid or '-'} action=open_visible_bind_token_home"
            )

        open_reason = "no_visible_idle_home" if hhome else "no_idle_home"
        self._append_log(
            f"[NEW_SESSION][OPEN_HOME] session_id={sid} reason={open_reason}"
        )
        now = time.time()
        bind_request_id = uuid.uuid4().hex
        session.remote_chatgpt = {
            **default_remote_chatgpt(),
            "bind_state": BIND_STATE_WAITING_HOME,
            "bind_request_id": bind_request_id,
            "bind_started_at": now,
            "opened_home_at": now,
        }
        session.updated_at = now
        self._schedule_save_sessions_to_disk()
        self._start_waiting_home_on_send(session)
        self._append_session_message(
            session,
            "system",
            "正在打开可见的 ChatGPT 首页（已避免直接使用后台隐藏标签页），"
            "页面就绪后即可发送首条消息。",
        )
        self._render_session_chat(session, force_bottom=True)
        status = (
            get_bridge_status()
            if is_server_running()
            else (self._bridge_ui.last_bridge_status or {})
        )
        self._try_finish_pending_auto_bind(status)
        self._refresh_session_list(select_session_id=sid)
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="auto_bind")
        self._apply_chat_bind_visual_state()

    def _bound_conversation_target_url(self, remote):
        return self._chatgpt_url_from_remote(remote)
    def _open_bound_conversation_url(self, target_url, reopen_request_id=""):
        url = (target_url or "").strip()
        if not url:
            return False
        url = url.split("#", 1)[0]
        self._append_log(
            "[BIND][OPEN_BOUND_CONVERSATION] "
            f"reopen_request_id={reopen_request_id or '-'} url={url}"
        )
        return self._open_page_once(url, "打开绑定的 ChatGPT 对话页")
    def _prepare_bound_conversation_reopen_if_needed(
        self, session, text, user_message_id=""
    ):
        if not self._bind_each_chat_to_page or session is None:
            return True

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = self._remote_conversation_id(remote)
        if not conversation_id or not remote_binding_enabled(remote):
            return True

        bind_state = self._remote_bind_state(remote)
        if bind_state in (BIND_STATE_PREBOUND_HOME, BIND_STATE_WAITING_HOME):
            return True
        if self._session_has_sendable_bound_page(remote):
            return True

        pending_text = (text or "").strip()
        if bind_state == BIND_STATE_WAITING_BOUND_CONVERSATION:
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
            session.remote_chatgpt = {
                **remote_now,
                "pending_send_content": pending_text
                or (remote_now.get("pending_send_content") or ""),
                "pending_send_message_id": (user_message_id or "").strip()
                or (remote_now.get("pending_send_message_id") or ""),
                "pending_send_created_at": time.time(),
            }
            session.updated_at = time.time()
            self._schedule_save_sessions_to_disk()
            if session.session_id == self._current_session_id:
                self._add_system_message_once(
                    "绑定的 ChatGPT 对话页离线，正在自动打开原对话页。该消息会在页面上线后自动发送。",
                    dedupe_seconds=10,
                )
            self._apply_chat_bind_visual_state()
            return False

        target_url = self._bound_conversation_target_url(remote)
        if not target_url:
            return True

        reopen_request_id = (
            remote.get("reopen_request_id") or ""
        ).strip() or uuid.uuid4().hex
        now = time.time()
        session.remote_chatgpt = {
            **remote,
            "bind_state": BIND_STATE_WAITING_BOUND_CONVERSATION,
            "pending_send_content": pending_text,
            "pending_send_message_id": (user_message_id or "").strip(),
            "pending_send_created_at": now if pending_text else 0,
            "reopen_request_id": reopen_request_id,
            "reopen_started_at": now,
            "reopen_target_url": target_url,
        }
        session.updated_at = now
        self._schedule_save_sessions_to_disk()
        opened = self._open_bound_conversation_url(
            target_url, reopen_request_id=reopen_request_id
        )
        self._append_log(
            f"[BIND][REOPEN_BOUND_CONVERSATION] session_id={session.session_id} "
            f"conversation_id={conversation_id} url={target_url} "
            f"reopen_request_id={reopen_request_id} opened={opened} "
            f"pending_text_len={len(pending_text)}"
        )
        if session.session_id == self._current_session_id:
            self._add_system_message_once(
                "绑定的 ChatGPT 对话页离线，正在自动打开原对话页。该消息会在页面上线后自动发送。",
                dedupe_seconds=10,
            )
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._apply_chat_bind_visual_state()
        return False

    def _try_finish_waiting_bound_conversations(self, status):
        status = status or self._bridge_ui.last_bridge_status or {}
        now = time.time()
        for session in list(self._sessions.values()):
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if self._remote_bind_state(remote) != BIND_STATE_WAITING_BOUND_CONVERSATION:
                continue

            started = self._auto_bind_float_field(remote, "reopen_started_at", 0)
            if started and (
                now - started > self.REOPEN_BOUND_CONVERSATION_TIMEOUT_SECONDS
            ):
                self._append_log(
                    f"[BIND][REOPEN_BOUND_TIMEOUT] session_id={session.session_id} "
                    f"conversation_id={remote.get('conversation_id') or '-'} "
                    f"pending_text_len={len((remote.get('pending_send_content') or '').strip())}"
                )
                session.remote_chatgpt = {
                    **remote,
                    "bind_state": BIND_STATE_BOUND_OFFLINE,
                    "reopen_started_at": 0,
                    "reopen_target_url": "",
                }
                session.updated_at = now
                pending_message_id = (remote.get("pending_send_message_id") or "").strip()
                if pending_message_id:
                    self._set_user_message_status(
                        session, pending_message_id, "发送失败"
                    )
                self._schedule_save_sessions_to_disk()
                if session.session_id == self._current_session_id:
                    self._add_system_message_once(
                        "自动打开绑定页面超时，消息未发送。请打开绑定页面后点击重新发送。",
                        dedupe_seconds=10,
                    )
                self._refresh_session_list(
                    select_session_id=self._current_session_id
                )
                if session.session_id == self._current_session_id:
                    self._render_session_chat(session)
                if hasattr(self, "schedule_page_registry_refresh"):
                    self.schedule_page_registry_refresh(reason="auto_bind")
                self._apply_chat_bind_visual_state()
                continue

            expected_conversation_id = (
                (remote.get("conversation_id") or "").strip()
                or parse_conversation_id(
                    (remote.get("url") or "").strip()
                )
            )
            client_info = None
            for item in self._iter_tm_clients(status, online_only=True):
                page_type = (item.get("page_type") or "").strip()
                actual_conversation_id = (
                    (item.get("conversation_id") or "").strip()
                    or parse_conversation_id((item.get("url") or "").strip())
                )
                if page_type != "conversation":
                    self._append_log(
                        "[SEND][WAIT_BOUND_SKIP_CLIENT] "
                        f"reason=not_conversation_page expected={expected_conversation_id or '-'} "
                        f"actual={actual_conversation_id or '-'} "
                        f"client_id={(item.get('client_id') or '-').strip()}"
                    )
                    continue
                if expected_conversation_id and actual_conversation_id != expected_conversation_id:
                    self._append_log(
                        "[SEND][WAIT_BOUND_SKIP_CLIENT] "
                        f"reason=conversation_mismatch expected={expected_conversation_id} "
                        f"actual={actual_conversation_id or '-'} "
                        f"client_id={(item.get('client_id') or '-').strip()}"
                    )
                    continue
                client_info = dict(item)
                break
            if not client_info:
                continue

            pending_text = (remote.get("pending_send_content") or "").strip()
            pending_message_id = (remote.get("pending_send_message_id") or "").strip()
            if not self._bind_conversation_to_session(
                session, client_info, silent=True
            ):
                continue

            self._append_log(
                f"[REOPEN][MATCH] session_id={session.session_id} "
                f"client_id={client_info.get('client_id') or '-'} "
                f"pending_text_len={len(pending_text)}"
            )
            if pending_message_id and pending_text:
                self._push_message_text(
                    session,
                    pending_text,
                    reuse_user_message_id=pending_message_id,
                )
                remote_after_send = normalize_remote_chatgpt(session.remote_chatgpt)
                session.remote_chatgpt = {
                    **remote_after_send,
                    "pending_send_content": "",
                    "pending_send_message_id": "",
                    "pending_send_created_at": 0,
                    "reopen_request_id": "",
                    "reopen_started_at": 0,
                    "reopen_target_url": "",
                }
                session.updated_at = time.time()
                self._schedule_save_sessions_to_disk()
                self._append_log(
                    "[SEND][RESUME_AFTER_BOUND_REOPEN] "
                    f"session_id={session.session_id} "
                    f"user_message_id={pending_message_id} "
                    f"conversation_id={(session.remote_chatgpt or {}).get('conversation_id') or '-'} "
                    f"text_len={len(pending_text)}"
                )
            else:
                session.remote_chatgpt = {
                    **normalize_remote_chatgpt(session.remote_chatgpt),
                    "pending_send_content": "",
                    "pending_send_message_id": "",
                    "pending_send_created_at": 0,
                    "reopen_request_id": "",
                    "reopen_started_at": 0,
                    "reopen_target_url": "",
                }
                session.updated_at = time.time()
                self._schedule_save_sessions_to_disk()
            self._refresh_session_list(select_session_id=self._current_session_id)
            if hasattr(self, "schedule_page_registry_refresh"):
                self.schedule_page_registry_refresh(reason="auto_bind")
            self._apply_chat_bind_visual_state()
            if hasattr(self, "_try_send_next_queued_message"):
                self._try_send_next_queued_message(session)
    def _page_channel_bind_to_session(
        self, session, client_info, silent=False, reserve_reason=""
    ):
        """页面通道绑定：在线页面 + page_no + client_id/page_instance_id，不要求 conversation_id。"""
        return self._prebound_home_bind_to_session(
            session,
            client_info,
            silent=silent,
            reserve_reason=reserve_reason or "page_channel_bind",
        )

    def _maybe_show_home_with_local_history_notice(self, session, page_no=""):
        """绑定首页且本地已有历史时，仅提醒一次。"""
        if session is None:
            return
        # 已升级为对话绑定时禁止显示首页通道提示
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        if bind_state == BIND_STATE_BOUND_CONVERSATION:
            self._append_log(
                "[BIND][HOME_WITH_LOCAL_HISTORY_NOTICE][SKIP] "
                f"reason=already_bound_conversation "
                f"session_id={session.session_id}",
                echo=True,
            )
            return
        user_count = self._session_user_message_count(session)
        if user_count <= 0:
            return
        seen = getattr(self, "_home_with_local_history_notice_sessions", None)
        if not isinstance(seen, set):
            seen = set()
            self._home_with_local_history_notice_sessions = seen
        if session.session_id in seen:
            return
        seen.add(session.session_id)
        self._append_log(
            "[BIND][HOME_WITH_LOCAL_HISTORY_NOTICE] "
            f"session_id={session.session_id} page_no={page_no or '-'}",
            echo=True,
        )
        self._add_system_message(
            "当前绑定的是 ChatGPT 首页页面通道。\n"
            "如果本地会话已有历史，远端新对话不会自动继承这些历史。\n"
            "如需继续同一个远端对话，请绑定对应 /c/... 页面。"
        )

    def _prebound_home_bind_to_session(
        self, session, client_info, silent=False, reserve_reason=""
    ):
        if not isinstance(client_info, dict):
            return False
        page_url = (
            client_info.get("url")
            or client_info.get("url")
            or CHATGPT_HOME_URL
        ).strip()
        client_id = (client_info.get("client_id") or "").strip()
        page_instance_id = (client_info.get("page_instance_id") or "").strip()
        page_no = (
            self._tm_page_no_text(client_info)
            if hasattr(self, "_tm_page_no_text")
            else str(client_info.get("page_no") or "").strip()
        )
        if page_no == "-":
            page_no = ""
        if not client_id and not page_instance_id:
            self._add_system_message("缺少 client_id / page_instance_id，无法绑定页面通道。")
            return False
        if not page_instance_id and page_no:
            self._append_log(
                "[BIND][PAGE_CHANNEL][WARN] "
                f"session_id={session.session_id} "
                f"page_no={page_no} "
                f"reason=missing_page_instance_id fallback=page_no_only",
                echo=True,
                level="WARNING",
            )
        if page_url and not self._is_bindable_chatgpt_url(page_url):
            if not page_instance_id and not client_id:
                self._add_system_message("该 URL 不是可绑定的 ChatGPT 页面。")
                return False
        remote_prev = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (
            remote_prev.get("prebound_home_client_id")
            or remote_prev.get("client_id")
            or ""
        ).strip()
        old_page_instance_id = (
            remote_prev.get("prebound_home_page_instance_id")
            or remote_prev.get("page_instance_id")
            or ""
        ).strip()
        old_bind_state = self._remote_bind_state(remote_prev)
        # 仅在“预绑定主页”语义下才读取旧会话会话号
        old_conversation_id = (remote_prev.get("conversation_id") or "").strip()
        old_url_val = (remote_prev.get("url") or "").strip()
        incoming_url = (page_url or CHATGPT_HOME_URL).strip()
        if old_bind_state == BIND_STATE_BOUND_CONVERSATION:
            if old_conversation_id or "/c/" in old_url_val:
                self._append_log(
                    "[BIND][PREBOUND_HOME_SKIP] "
                    f"reason=already_bound_conversation "
                    f"session_id={session.session_id} "
                    f"old_conversation_id={old_conversation_id or '(from url)'} "
                    f"incoming_url={incoming_url}",
                    echo=True,
                )
                return False
        same_current_home = (
            old_bind_state == BIND_STATE_PREBOUND_HOME
            and old_client_id
            and old_client_id == client_id
            and (
                not page_instance_id
                or not old_page_instance_id
                or old_page_instance_id == page_instance_id
            )
        )
        if same_current_home:
            self._append_log(
                f"[BIND][PREBOUND_HOME_ALREADY_CURRENT] "
                f"session_id={session.session_id} "
                f"client_id={client_id} "
                f"page_instance_id={page_instance_id or '-'} "
                f"reserve_reason={reserve_reason or '-'}"
            )
            if hasattr(self, "schedule_page_registry_refresh"):
                self.schedule_page_registry_refresh(reason="auto_bind")
            self._apply_chat_bind_visual_state()
            self._refresh_session_list(select_session_id=session.session_id)
            if not silent:
                self._add_system_message("当前对话已预绑定该 ChatGPT 首页。")
            return True
        if self._is_home_client_used_by_any_session(
            client_id,
            page_instance_id,
            exclude_session_id=session.session_id,
        ):
            self._add_system_message("该 ChatGPT 首页已被其他对话占用。")
            return False
        client_bind_token = (
            client_info.get("bind_request_id")
            or ""
        ).strip()
        session_bind_token = self._session_bind_request_id(remote_prev)
        if (
            old_bind_state == BIND_STATE_WAITING_HOME
            and session_bind_token
            and client_bind_token != session_bind_token
        ):
            self._append_log(
                f"[BIND][MISMATCH] reason=bind_request_id_mismatch "
                f"session_id={session.session_id} "
                f"expected_token={session_bind_token} "
                f"actual_token={client_bind_token or '-'} client_id={client_id}"
            )
            self._add_system_message(
                "当前页面不是本会话打开的 ChatGPT 首页，不能用于当前新对话。"
            )
            return False
        if session_bind_token and client_bind_token and client_bind_token != session_bind_token:
            self._append_log(
                f"[BIND][MISMATCH] reason=bind_request_id_mismatch "
                f"session_id={session.session_id} "
                f"expected_token={session_bind_token} "
                f"actual_token={client_bind_token} client_id={client_id}"
            )
            self._add_system_message(
                "当前页面不是本会话打开的 ChatGPT 首页，不能用于当前新对话。"
            )
            return False
        now = time.time()
        bind_request_id = session_bind_token or client_bind_token
        temp_page_id = (
            str(client_info.get("page_display_id") or client_info.get("page_no") or page_no or "")
            .strip()
        )
        page_type = (client_info.get("page_type") or "").strip() or "home"
        write_session_remote_chatgpt(
            session,
            bind_state=BIND_STATE_TEMP_HOME_BOUND,
            bind_mode=BIND_MODE_HOME_PENDING,
            conversation_id="",
            url=page_url or CHATGPT_HOME_URL,
            client_id=client_id,
            page_instance_id=page_instance_id,
            page_no=page_no,
            page_display_id=temp_page_id,
            temp_page_id=temp_page_id,
            page_type=page_type,
            page_title=(client_info.get("page_title") or "").strip(),
            last_seen=self._auto_bind_float_field(
                client_info,
                "last_seen",
                time.time(),
            ),
            bind_request_id=bind_request_id,
            bind_started_at=self._auto_bind_float_field(
                remote_prev,
                "bind_started_at",
                now,
            ),
        )
        from app.utils.bind_runtime import update_bind_runtime

        update_bind_runtime(self, session, bootstrap_in_progress=False)
        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()
        self._maybe_show_home_with_local_history_notice(session, page_no=page_no or temp_page_id)
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="prebound_home")
        self._apply_chat_bind_visual_state()
        if silent:
            self._set_settings_hint("已绑定页面通道到当前对话。")
        else:
            self._add_system_message(
                "已绑定页面通道。发送第一条消息后，"
                "将自动创建并绑定新的 ChatGPT 对话。"
            )
        self._append_log(
            "[BIND][PAGE_CHANNEL_BOUND] "
            f"session_id={session.session_id} "
            f"page_no={page_no or temp_page_id or '-'} "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"url={page_url or CHATGPT_HOME_URL} "
            f"reserve_reason={reserve_reason or '-'}",
            echo=True,
        )
        return True

    def _upgrade_temp_home_sessions_from_registry(self, registry=None):
        """页面通道绑定在目标页创建对话后，自动升级为 conversation 绑定。"""
        from app.models import (
            BIND_MODE_CONVERSATION,
            BIND_STATE_BOUND_CONVERSATION,
            write_session_remote_chatgpt,
        )
        from app.url_utils import parse_conversation_id
        from app.utils.page_snapshot import PageRegistry
        from app.utils.page_status import page_url_from

        reg = registry
        if not isinstance(reg, PageRegistry):
            status = self._bridge_ui.last_bridge_status or {}
            reg = PageRegistry.from_bridge_status(status)
        changed = False
        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not self._is_temp_home_bound_state(self._remote_bind_state(remote)):
                continue
            temp_page_id = (
                (remote.get("temp_page_id") or remote.get("page_display_id") or remote.get("page_no") or "")
                .strip()
            )
            bound_client_id = (remote.get("client_id") or "").strip()
            bound_instance_id = (remote.get("page_instance_id") or "").strip()
            old_url = (remote.get("url") or "https://chatgpt.com/").strip()

            page = None
            if bound_client_id and bound_instance_id:
                page = reg.get_by_identity(bound_client_id, bound_instance_id)
            if page is None and temp_page_id:
                page = reg.get_by_page_display_id(temp_page_id)
            if page is None:
                continue

            raw = page._raw if isinstance(page._raw, dict) else {}
            page_url = page_url_from(raw) or (page.url or "")
            conversation_id = (
                (raw.get("conversation_id") or page.conversation_id or "").strip()
                or parse_conversation_id(page_url)
                or ""
            )
            if not conversation_id:
                continue
            conversation_url = page_url if "/c/" in page_url else f"https://chatgpt.com/c/{conversation_id}"
            page_no = temp_page_id or str(remote.get("page_no") or "").strip()
            write_session_remote_chatgpt(
                session,
                bind_state=BIND_STATE_BOUND_CONVERSATION,
                bind_mode=BIND_MODE_CONVERSATION,
                conversation_id=conversation_id,
                url=conversation_url,
                page_type="conversation",
                client_id=(raw.get("client_id") or page.client_id or bound_client_id or "").strip(),
                page_instance_id=(
                    raw.get("page_instance_id") or page.page_instance_id or bound_instance_id or ""
                ).strip(),
                page_no=page_no,
                page_display_id=page_no,
                temp_page_id="",
            )
            session.updated_at = time.time()
            changed = True
            self._append_log(
                "[CHAT_BIND][PROMOTE_HOME_TO_CONVERSATION] "
                f"localConversationId={session.session_id} "
                f"page_id={page_no or '-'} "
                f"conversation_id={conversation_id} "
                f"url={conversation_url}",
                echo=True,
            )
            self._append_log(
                "[BIND][PROMOTE_PAGE_TO_CONVERSATION] "
                f"session_id={session.session_id} "
                f"page_no={page_no or '-'} "
                f"conversation_id={conversation_id} "
                f"old_url={old_url or 'https://chatgpt.com/'} "
                f"new_url={conversation_url}",
                echo=True,
            )
            # 升级提示：从首页页面通道升级为对话绑定
            if session.session_id == self._current_session_id:
                self._add_system_message(
                    "已从首页页面通道升级为 ChatGPT 对话绑定。"
                )
        if changed:
            self._schedule_save_sessions_to_disk()
            if hasattr(self, "_refresh_current_session_binding_display"):
                self._refresh_current_session_binding_display()
            if hasattr(self, "_refresh_session_list"):
                current = self._current_session()
                sid = current.session_id if current else ""
                self._refresh_session_list(select_session_id=sid or None)
        return changed

    def _bind_conversation_to_session(
        self,
        session,
        client_info,
        silent=False,
        allow_existing_conversation_for_new_session=False,
    ):
        if not isinstance(client_info, dict):
            return False
        if not allow_existing_conversation_for_new_session:
            rejected, reject_msg = self._reject_bind_existing_conversation_for_new_session(
                session, client_info
            )
            if rejected:
                if not silent:
                    self._add_system_message(reject_msg)
                return False
        page_url = (
            client_info.get("url")
            or client_info.get("url")
            or (client_info.get("url") or "")
            or ""
        ).strip()
        client_id = (client_info.get("client_id") or "").strip()
        conversation_id = (
            client_info.get("conversation_id") or parse_conversation_id(page_url) or ""
        ).strip()
        if conversation_id:
            conversation_url = f"https://chatgpt.com/c/{conversation_id}"
        else:
            conversation_url = page_url
        bind_check_url = conversation_url or page_url
        if not self._is_bindable_chatgpt_url(bind_check_url):
            self._add_system_message("该 URL 不是可绑定的 ChatGPT 对话页面。")
            return False
        if not client_id and not conversation_id and not page_url:
            self._add_system_message("缺少页面身份信息，无法绑定。")
            return False
        if not conversation_id:
            self._add_system_message("缺少 conversation_id，无法正式绑定对话页。")
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip()
        old_conversation_id = (remote.get("conversation_id") or "").strip()
        binding_identity_changes = (
            not remote_binding_enabled(remote)
            or old_conversation_id != conversation_id
            or old_client_id != client_id
        )
        # 自动绑定不清空聊天区；仅用户主动绑定/切换会话时清空。
        if not old_conversation_id:
            old_conversation_id = parse_conversation_id(
                (remote.get("url") or "").strip()
            )
        page_no = (
            self._tm_page_no_text(client_info)
            if hasattr(self, "_tm_page_no_text")
            else str(client_info.get("page_no") or "").strip()
        )
        if page_no == "-":
            page_no = ""
        write_session_remote_chatgpt(
            session,
            bind_state=BIND_STATE_BOUND_CONVERSATION,
            bind_mode=BIND_MODE_CONVERSATION,
            conversation_id=conversation_id,
            url=conversation_url,
            client_id=client_id,
            page_instance_id=(client_info.get("page_instance_id") or "").strip(),
            page_no=page_no,
            page_type="conversation",
            page_title=(client_info.get("page_title") or "").strip(),
            last_seen=self._auto_bind_float_field(
                client_info,
                "last_seen",
                time.time(),
            ),
        )
        from app.utils.bind_runtime import update_bind_runtime

        update_bind_runtime(self, session, bootstrap_in_progress=False)
        session.updated_at = time.time()
        if (
            old_conversation_id
            and old_conversation_id == conversation_id
            and old_client_id
            and old_client_id != client_id
        ):
            self._append_log(
                "[BIND][RESTORE_OLD_SESSION] "
                f"session_id={session.session_id} "
                f"conversation_id={conversation_id} "
                f"old_client_id={old_client_id} "
                f"new_client_id={client_id} "
                f"url={conversation_url or page_url}"
            )
        self._schedule_save_sessions_to_disk()
        self._refresh_session_list(select_session_id=session.session_id)
        if session.session_id == (self._current_session_id or ""):
            self._update_current_session_title(session)
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="prebound_home")
        self._apply_chat_bind_visual_state()
        if silent:
            self._set_settings_hint("已绑定 ChatGPT 对话页到当前对话。")
        else:
            self._set_settings_hint(
                f"已绑定 ChatGPT 对话页（conversation_id={conversation_id}）"
            )
        self._append_log(
            f"[绑定][CONVERSATION] session={session.session_id[:8]}… "
            f"client_id={client_id} conversation_id={conversation_id} "
            f"url={conversation_url or page_url}"
        )
        return True
    def _apply_conversation_created_binding(self, session, payload, client_id=""):
        if session is None:
            return
        conversation_id = (payload.get("conversation_id") or "").strip()
        page_url = (
            (payload.get("url") or "").strip()
        )
        if conversation_id and not page_url:
            page_url = f"https://chatgpt.com/c/{conversation_id}"
        if not conversation_id:
            conversation_id = parse_conversation_id(page_url)
        if not conversation_id:
            self._append_log("[BIND][CONVERSATION_CREATED] 缺少 conversation_id，已忽略")
            return
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bound_client_id = (
            (payload.get("client_id") or client_id or remote.get("client_id") or "")
        ).strip()
        page_instance_id = (
            payload.get("page_instance_id") or remote.get("page_instance_id") or ""
        ).strip()
        bind_request_id = self._session_bind_request_id(remote)
        page_no = str(
            payload.get("page_no") or remote.get("page_no") or ""
        ).strip()
        if page_no == "-":
            page_no = ""
        write_session_remote_chatgpt(
            session,
            bind_state=BIND_STATE_BOUND_CONVERSATION,
            bind_mode=BIND_MODE_CONVERSATION,
            conversation_id=conversation_id,
            url=page_url,
            client_id=bound_client_id,
            page_instance_id=page_instance_id,
            page_no=page_no,
            page_type="conversation",
            page_title=remote.get("page_title") or "",
            last_seen=time.time(),
            bind_request_id=bind_request_id,
            bind_started_at=self._auto_bind_float_field(remote, "bind_started_at", 0),
            pending_bootstrap_content="",
        )
        from app.utils.bind_runtime import update_bind_runtime

        update_bind_runtime(
            self,
            session,
            bootstrap_in_progress=False,
            pending_bootstrap_created_at=0,
            bootstrap_message_id="",
            bootstrap_started_at=0,
            opened_home_at=0,
        )
        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="auto_bind")
        self._apply_chat_bind_visual_state()
        self._add_system_message("新 ChatGPT 对话已创建并绑定。")
        report_bind = (
            payload.get("bind_request_id") or ""
        ).strip()
        message_id = (payload.get("message_id") or "").strip()
        self._append_log(
            f"[NEW_SESSION][BOUND] session_id={session.session_id} "
            f"conv={conversation_id} client_id={bound_client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"message_id={message_id[:8] if message_id else '-'} "
            f"bind_request_id={bind_request_id or report_bind or '-'} "
            f"url={page_url or '-'}"
        )
        self._append_log(
            f"[BIND][CONVERSATION_CREATED] session_id={session.session_id} "
            f"message_id={message_id[:8] if message_id else '-'} "
            f"conversation_id={conversation_id} source=bootstrap_home "
            f"bind_request_id={bind_request_id or report_bind or '-'} "
            f"client_id={bound_client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"url={page_url or '-'}"
        )
        old_conv = self._remote_conversation_id(remote) or "-"
        self._append_log(
            "[BIND][HOME_TO_CONVERSATION][UPDATED] "
            f"session_id={session.session_id} client_id={bound_client_id or '-'} "
            f"old_conv={old_conv or '-'} new_conv={conversation_id} "
            f"old_url={(remote.get('url') or 'https://chatgpt.com/').strip()} "
            f"new_url={page_url or '-'} "
            f"old_state=prebound_home new_state=bound_online"
        )
        self._refresh_session_list(select_session_id=session.session_id)
        if session.session_id == (self._current_session_id or ""):
            self._render_session_chat(session, force_bottom=True)

    def _mark_latest_pending_assistant_error(self, session, text, status_text):
        if session is None:
            return False
        for message in reversed(getattr(session, "messages", [])):
            if getattr(message, "role", "") != "assistant":
                continue
            current_status = (message.ui_status or "").strip()
            current_text = (getattr(message, "content", "") or "").strip()
            if current_status in ASSISTANT_REPLY_PENDING_STATUSES or current_text in ASSISTANT_WAIT_TEXTS:
                message.role = "error"
                message.content = (text or "").strip()
                message.ui_status = (status_text or "失败").strip()
                session.updated_at = time.time()
                return True
        return False

    def _recover_stuck_bootstrap_sessions(self):
        now = time.time()
        changed = False
        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)
            if bind_state != BIND_STATE_WAITING_CONVERSATION_CREATED:
                continue
            if (remote.get("conversation_id") or "").strip():
                continue
            started_at = self._auto_bind_float_field(
                remote,
                "bootstrap_started_at",
                self._auto_bind_float_field(remote, "bind_started_at", 0),
            )
            if started_at <= 0:
                continue
            elapsed = now - started_at
            if elapsed < float(self.BOOTSTRAP_CREATE_TIMEOUT_SECONDS):
                continue

            session.remote_chatgpt = {
                **default_remote_chatgpt(),
                "bind_state": BIND_STATE_UNBOUND,
            }
            session.updated_at = now
            changed = True

            self._append_log(
                f"[NEW_SESSION][CREATE_TIMEOUT] session_id={session.session_id} "
                f"client_id={(remote.get('client_id') or remote.get('prebound_home_client_id') or '-')} "
                f"page_instance_id={(remote.get('page_instance_id') or remote.get('prebound_home_page_instance_id') or '-')} "
                f"elapsed={elapsed:.1f}s"
            )
            self._append_log(
                f"[BIND][BOOTSTRAP_TIMEOUT_RESET] session_id={session.session_id} "
                f"elapsed={elapsed:.1f}"
            )
            self._mark_latest_pending_assistant_error(
                session,
                "新 ChatGPT 对话创建超时，请点击「打开 ChatGPT」后重试。",
                "创建超时",
            )

        if changed:
            self._schedule_save_sessions_to_disk()
            self._refresh_session_list(select_session_id=self._current_session_id)
            if self._current_session():
                self._render_session_chat(self._current_session())
    def _is_client_bound_to_other_session(self, client_info, current_session_id):
        if not isinstance(client_info, dict):
            return False

        client_id = (client_info.get("client_id") or "").strip()
        page_instance_id = (client_info.get("page_instance_id") or "").strip()
        page_url = (client_info.get("url") or "").strip()

        for session_id, session in self._sessions.items():
            if session_id == current_session_id:
                continue

            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote_binding_enabled(remote):
                continue

            bound_client_id = (remote.get("client_id") or "").strip()
            bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
            bound_url = ((remote.get("url") or "") or "").strip()

            if client_id and bound_client_id and client_id == bound_client_id:
                return True

            if (
                page_instance_id
                and bound_page_instance_id
                and page_instance_id == bound_page_instance_id
            ):
                return True

            if page_url and bound_url and page_url == bound_url:
                return True

        return False
    def _pick_auto_bind_client(self, status, current_session_id, remote=None):
        """当前 conversation_id 对应在线且可同步页面唯一时返回该页，否则 None。"""
        del remote
        status = status or {}
        session = self._sessions.get(current_session_id) if current_session_id else None
        if session is None:
            return None
        remote_norm = normalize_remote_chatgpt(session.remote_chatgpt)
        if remote_binding_active(remote_norm):
            return None
        conversation_id = self._remote_conversation_id(remote_norm)
        if not conversation_id:
            return None
        candidates = []
        for item in self._iter_tm_clients(status, online_only=True, bindable_only=True):
            if self._is_client_bound_to_other_session(item, current_session_id):
                continue
            if (self._tm_client_conversation_id(item) or "").strip() != conversation_id:
                continue
            if not item.get("online"):
                continue
            if not (item.get("conversation_syncable") or can_sync_conversation(item)):
                continue
            candidates.append(item)
        if len(candidates) != 1:
            if len(candidates) > 1:
                self._append_log(
                    f"[AUTO_BIND][MANUAL_HINT] session={current_session_id[:8]} "
                    f"conversation_id={conversation_id} "
                    f"candidate_count={len(candidates)} reason=ambiguous"
                )
            return None
        return dict(candidates[0])

    def _auto_bind_current_session_if_needed(self, status):
        if self._auto_bind.pending_session_id:
            return False
        if not getattr(self, "_auto_bind_unbound_page", True):
            return False
        status = status or {}
        pages = status.get("pages") or []
        if not any(isinstance(p, dict) and p.get("online") for p in pages):
            return False
        session = self._current_session()
        if session is None:
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if remote_binding_enabled(remote):
            return False
        if self._session_is_local_new_chat_flow(session):
            return False
        client_info = self._pick_auto_bind_client(status, session.session_id)
        if not client_info:
            return False
        ok = self._bind_conversation_to_session(session, client_info, silent=True)
        if ok:
            self._append_log(
                f"[自动绑定] session={session.session_id[:8]}… "
                f"client_id={client_info.get('client_id') or '-'} "
                f"conversation_id={self._client_conversation_id(client_info) or '-'}"
            )
        return ok
    def _mark_auto_bind_waiting(self):
        """历史兼容入口：当前自动绑定等待状态由 pending_* 字段维护。"""
        return
    def _clear_pending_auto_bind(self):
        self._auto_bind.pending_session_id = ""
        self._auto_bind.pending_until = 0
        self._auto_bind.pending_known_clients.clear()
        self._auto_bind.pending_known_page_instances.clear()

    def _matching_waiting_home_client_for_session(self, session, status):
        if session is None:
            return None
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._remote_bind_state(remote) not in (
            BIND_STATE_WAITING_HOME,
            BIND_STATE_PREBOUND_HOME,
        ):
            return None
        expected_token = self._session_bind_request_id(remote)
        if not expected_token:
            return None
        candidates = []
        for item in self._iter_tm_clients(status, online_only=True, page_type="home"):
            if self._is_ignored_or_unusable_home_client(item):
                continue
            actual_token = (
                item.get("bind_request_id") or ""
            ).strip()
            if actual_token != expected_token:
                continue
            client_id = self._tm_client_id(item)
            page_instance_id = self._tm_page_instance_id(item)
            if self._is_home_client_used_by_any_session(
                client_id,
                page_instance_id,
                exclude_session_id=session.session_id,
            ):
                continue
            if self._home_client_has_pending_bridge_work(
                client_id, page_instance_id, status
            ):
                continue
            candidates.append(item)
        if not candidates:
            return None
        candidates.sort(key=self._idle_home_sort_key, reverse=True)
        return candidates[0]

    def _recover_pending_auto_bind_from_status(self, status):
        if getattr(self._auto_bind, 'pending_session_id', ''):
            return False
        for session in list(self._sessions.values()):
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if self._remote_bind_state(remote) != BIND_STATE_WAITING_HOME:
                continue
            matched = self._matching_waiting_home_client_for_session(session, status)
            if not matched:
                continue
            self._auto_bind.pending_session_id = session.session_id
            self._auto_bind.pending_until = time.time() + 30
            self._auto_bind.pending_known_clients = set()
            self._auto_bind.pending_known_page_instances = set()
            self._append_log(
                f"[AUTO_BIND][RECOVER_WAITING_HOME] session_id={session.session_id} "
                f"bind_request_id={self._session_bind_request_id(session.remote_chatgpt)} "
                f"client_id={self._tm_client_id(matched) or '-'} "
                f"page_instance_id={self._tm_page_instance_id(matched) or '-'}"
            )
            return True
        return False

    def _repair_token_prebound_home_from_status(self, status):
        changed = False
        for session in list(self._sessions.values()):
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if self._remote_bind_state(remote) != BIND_STATE_PREBOUND_HOME:
                continue
            expected_token = self._session_bind_request_id(remote)
            if not expected_token:
                continue
            current_client = (remote.get("client_id") or "").strip()
            current_instance = (remote.get("page_instance_id") or "").strip()
            current_item = (
                self._client_info_from_status(current_client)
                if current_client
                else None
            )
            current_token = ""
            if current_item:
                current_token = (
                    current_item.get("bind_request_id")
                    or ""
                ).strip()
            if current_token == expected_token:
                continue
            matched = self._matching_waiting_home_client_for_session(session, status)
            if not matched:
                continue
            matched_client = self._tm_client_id(matched)
            matched_instance = self._tm_page_instance_id(matched)
            if matched_client == current_client and (
                not matched_instance or matched_instance == current_instance
            ):
                continue
            self._append_log(
                f"[AUTO_BIND][REPAIR_TOKEN_HOME] session_id={session.session_id} "
                f"bind_request_id={expected_token} "
                f"old_client={current_client or '-'} "
                f"new_client={matched_client or '-'} "
                f"new_page_instance_id={matched_instance or '-'}"
            )
            if self._prebound_home_bind_to_session(
                session, matched, silent=True, reserve_reason="bind_token_recovery"
            ):
                changed = True
        return changed

    def _try_finish_pending_auto_bind(self, status):
        self._repair_token_prebound_home_from_status(status)
        self._recover_pending_auto_bind_from_status(status)
        session_id = self._auto_bind.pending_session_id
        if not session_id:
            return

        session = self._sessions.get(session_id)
        if not session:
            self._clear_pending_auto_bind()
            return

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._remote_bind_state(remote) != BIND_STATE_WAITING_HOME:
            self._clear_pending_auto_bind()
            return

        now = time.time()
        if now > self._auto_bind.pending_until:
            self._append_log(f"[AUTO_BIND][TIMEOUT] session_id={session_id}")
            if session_id == self._current_session_id:
                self._add_system_message(
                    "等待 ChatGPT 首页上线超时。请确认页面是否打开并且油猴脚本在线，"
                    "或手动点击「绑定所选页面」。"
                )
            session.remote_chatgpt = {
                **remote,
                "bind_state": BIND_STATE_UNBOUND,
                "pending_bootstrap_content": "",
                "pending_bootstrap_created_at": 0,
                "opened_home_at": 0,
            }
            self._schedule_save_sessions_to_disk()
            self._clear_pending_auto_bind()
            self._refresh_session_list(select_session_id=self._current_session_id)
            self._apply_chat_bind_visual_state()
            return

        if remote_binding_enabled(remote) and (remote.get("client_id") or "").strip():
            bind_state_now = self._remote_bind_state(
                normalize_remote_chatgpt(session.remote_chatgpt)
            )
            if bind_state_now == BIND_STATE_PREBOUND_HOME:
                self._clear_pending_auto_bind()
                return

        expected_token = self._session_bind_request_id(remote)
        candidates = []
        for item in self._iter_tm_clients(status, online_only=True, page_type="home"):
            client_id = self._tm_client_id(item)
            page_instance_id = self._tm_page_instance_id(item)
            if self._is_ignored_or_unusable_home_client(item):
                continue
            actual_token = (
                item.get("bind_request_id") or ""
            ).strip()
            if expected_token:
                if actual_token != expected_token:
                    self._append_log(
                        f"[AUTO_BIND][SKIP_HOME_TOKEN_MISMATCH] session_id={session_id} "
                        f"expected_token={expected_token} "
                        f"actual_token={actual_token or '-'} client_id={client_id}"
                    )
                    continue
            else:
                is_new_client = (
                    client_id not in self._auto_bind.pending_known_clients
                )
                is_new_instance = (
                    page_instance_id
                    and page_instance_id
                    not in self._auto_bind.pending_known_page_instances
                )
                if not is_new_client and not is_new_instance:
                    continue
            if self._is_home_client_used_by_any_session(
                client_id,
                page_instance_id,
                exclude_session_id=session_id,
            ):
                continue
            if self._home_client_has_pending_bridge_work(
                client_id, page_instance_id, status
            ):
                continue
            candidates.append(item)

        if not candidates:
            return

        candidates.sort(key=self._idle_home_sort_key, reverse=True)
        selected = candidates[0]
        client_id = (selected.get("client_id") or "").strip()
        page_instance_id = (selected.get("page_instance_id") or "").strip()
        reason = self._idle_home_selection_reason(selected)
        ok = self._prebound_home_bind_to_session(
            session, selected, silent=True, reserve_reason=reason
        )
        if not ok:
            return

        pending_text = (
            normalize_remote_chatgpt(session.remote_chatgpt).get("pending_bootstrap_content")
            or remote.get("pending_bootstrap_content")
            or ""
        ).strip()
        session.remote_chatgpt = {
            **normalize_remote_chatgpt(session.remote_chatgpt),
            "pending_bootstrap_content": "",
            "pending_bootstrap_created_at": 0,
            "opened_home_at": 0,
        }
        matched_token = (
            selected.get("bind_request_id")
            or expected_token
            or ""
        ).strip()
        self._append_log(
            f"[AUTO_BIND][WAITING_HOME_MATCH] session_id={session_id} "
            f"bind_request_id={matched_token or '-'} "
            f"client_id={client_id} page_instance_id={page_instance_id or '-'}"
        )
        if session_id == self._current_session_id:
            self._add_system_message(
                "已预绑定新打开的 ChatGPT 首页，正在发送首条消息..."
            )
        self._clear_pending_auto_bind()
        self._schedule_save_sessions_to_disk()
        self._refresh_session_list(select_session_id=self._current_session_id)
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="auto_bind")
        self._apply_chat_bind_visual_state()
        if pending_text:
            self._flush_pending_bootstrap_message(session, pending_text)
        if hasattr(self, "_try_send_next_queued_message"):
            self._try_send_next_queued_message(session)
    def _sync_bound_session_urls_from_clients(self, status):
        client_instance_map = {}
        client_latest_map = {}
        for item in self._iter_tm_clients(status, online_only=True):
            client_id = self._tm_client_id(item)
            page_instance_id = self._tm_page_instance_id(item)
            if client_id:
                client_latest_map[client_id] = item
            if client_id and page_instance_id:
                client_instance_map[(client_id, page_instance_id)] = item

        changed = False
        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote_binding_enabled(remote):
                continue
            bind_state = self._remote_bind_state(remote)
            session_conversation_id = (remote.get("conversation_id") or "").strip()
            if not session_conversation_id:
                session_conversation_id = parse_conversation_id(
                    (remote.get("url") or "").strip()
                )
            client_id = (remote.get("client_id") or "").strip()
            if not client_id:
                prebound_client = (remote.get("client_id") or "").strip()
                if prebound_client:
                    client_id = prebound_client
            if not client_id:
                continue
            page_instance_id = (remote.get("page_instance_id") or "").strip()
            item = None
            if client_id and page_instance_id:
                item = client_instance_map.get((client_id, page_instance_id))
            if item is None and client_id:
                item = client_latest_map.get(client_id)
            if not item:
                continue
            page_url = page_url_from(item)
            if not self._is_bindable_chatgpt_url(page_url):
                continue
            client_conversation_id = (item.get("conversation_id") or "").strip()
            if not client_conversation_id:
                client_conversation_id = parse_conversation_id(page_url)
            client_page_type = (item.get("page_type") or "").strip()
            if (
                bind_state
                in (
                    BIND_STATE_PREBOUND_HOME,
                    BIND_STATE_WAITING_CONVERSATION_CREATED,
                )
                and not session_conversation_id
                and client_page_type == "conversation"
                and client_conversation_id
            ):
                can_update = client_id == (
                    remote.get("client_id") or ""
                ).strip()
                self._append_log(
                    "[BIND][HOME_TO_CONVERSATION][CHECK] "
                    f"session_id={session.session_id} "
                    f"bound_client={client_id} heartbeat_client={client_id} "
                    f"old_bound_conv=- new_heartbeat_conv={client_conversation_id} "
                    f"can_update={'true' if can_update else 'false'} "
                    f"reason=same_client_and_waiting_conversation_created"
                )
                if can_update:
                    old_url = (
                        (remote.get("url") or "").strip()
                    ).strip() or "https://chatgpt.com/"
                    session.remote_chatgpt = {
                        **remote,
                        "bind_state": BIND_STATE_BOUND_CONVERSATION,
                        "conversation_id": client_conversation_id,
                        "url": page_url,
                        "client_id": client_id,
                        "page_instance_id": page_instance_id,
                        "page_type": "conversation",
                        "bootstrap_in_progress": False,
                    }
                    session.updated_at = time.time()
                    changed = True
                    self._append_log(
                        "[BIND][HOME_TO_CONVERSATION][UPDATED] "
                        f"session_id={session.session_id} client_id={client_id} "
                        f"old_conv=- new_conv={client_conversation_id} "
                        f"old_url={old_url} new_url={page_url} "
                        f"old_state=prebound_home new_state=bound_online"
                    )
                    self._append_log(
                        "[SYNC][PREBOUND_HOME_RESOLVED] "
                        f"session_id={session.session_id} "
                        f"old_url={old_url or '-'} "
                        f"new_url={page_url or '-'} "
                        f"conversation_id={client_conversation_id or '-'} "
                        f"client_id={client_id or '-'}",
                        echo=True,
                    )
                    wait_pending = getattr(self, "_wait_conversation_sync_by_session", None)
                    if isinstance(wait_pending, dict):
                        wait_pending.pop(session.session_id, None)
                    continue
                self._append_log(
                    "[BIND][HOME_TO_CONVERSATION][SKIP] "
                    f"session_id={session.session_id} reason=client_not_match_or_not_waiting"
                )
            bind_state = self._remote_bind_state(remote)
            old_conversation_id = (remote.get("conversation_id") or "").strip()
            if bind_state in (
                BIND_STATE_PREBOUND_HOME,
                BIND_STATE_WAITING_HOME,
                BIND_STATE_WAITING_CONVERSATION_CREATED,
            ):
                if old_conversation_id in ("", "-") and client_conversation_id:
                    remote = normalize_remote_chatgpt(
                        {
                            **remote,
                            "conversation_id": client_conversation_id,
                            "url": page_url,
                            "page_instance_id": page_instance_id,
                            "page_type": "conversation",
                            "bind_state": BIND_STATE_BOUND_CONVERSATION,
                            "page_title": (item.get("page_title") or "").strip(),
                            "last_seen": self._auto_bind_float_field(
                                item,
                                "last_seen",
                                time.time(),
                            ),
                        }
                    )
                    session.remote_chatgpt = remote
                    session.updated_at = time.time()
                    changed = True
                    self._append_log(
                        "[BIND][HOME_TO_CONVERSATION] "
                        f"session_id={session.session_id} "
                        f"client_id={client_id} "
                        f"conversation_id={client_conversation_id} "
                        f"url={page_url}"
                    )
                    self._append_log(
                        "[SYNC][PREBOUND_HOME_RESOLVED] "
                        f"session_id={session.session_id} "
                        f"old_url={(remote.get('url') or '-').strip()} "
                        f"new_url={page_url or '-'} "
                        f"conversation_id={client_conversation_id or '-'} "
                        f"client_id={client_id or '-'}",
                        echo=True,
                    )
                    wait_pending = getattr(self, "_wait_conversation_sync_by_session", None)
                    if isinstance(wait_pending, dict):
                        wait_pending.pop(session.session_id, None)
                    if hasattr(self, "_try_send_next_queued_message"):
                        self._try_send_next_queued_message(session)
                    continue
            if session_conversation_id and client_conversation_id:
                if client_conversation_id != session_conversation_id:
                    self._append_log(
                        "[BIND][SKIP_UPDATE_URL] "
                        f"reason=conversation_mismatch "
                        f"session_id={session.session_id} "
                        f"client_id={client_id} "
                        f"old_conversation_id={session_conversation_id} "
                        f"new_conversation_id={client_conversation_id}"
                    )
                    continue
            elif session_conversation_id and not client_conversation_id:
                continue
            old_url = ((remote.get("url") or "").strip()).strip()
            if page_url.split("#")[0] == old_url.split("#")[0]:
                continue
            conversation_id = client_conversation_id or remote.get("conversation_id", "")
            session.remote_chatgpt = {
                **remote,
                "url": page_url,
                "conversation_id": conversation_id,
                "page_type": (item.get("page_type") or remote.get("page_type") or "").strip(),
                "page_title": (item.get("page_title") or remote.get("page_title") or "").strip(),
                "last_seen": self._auto_bind_float_field(
                    item,
                    "last_seen",
                    time.time(),
                ),
            }
            session.updated_at = time.time()
            changed = True
            self._append_log(
                f"[AUTO_BIND][UPDATE_URL] session_id={session.session_id} "
                f"client_id={client_id} old={old_url or '-'} new={page_url}"
            )
        if changed:
            self._schedule_save_sessions_to_disk()
            if self._current_session():
                if hasattr(self, "schedule_page_registry_refresh"):
                    self.schedule_page_registry_refresh(reason="auto_bind")
