"""自动绑定、首页预绑定、bootstrap 与对话创建绑定。"""

import time
import traceback
import uuid

import server
from log_utils import append_log

from app.constants import (
    ASSISTANT_WAIT_TEXTS,
    CHATGPT_HOME_URL,
    PENDING_ASSISTANT_STATUSES,
    TM_POLL_FRESH_SECONDS,
)
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.tm_activity import classify_tm_client_activity
from PyQt5.QtCore import QTimer


class PageAutoBindMixin:
    IDLE_HOME_FRESH_SECONDS = float(TM_POLL_FRESH_SECONDS)
    BOOTSTRAP_CLAIM_TIMEOUT_SECONDS = 5.0
    REOPEN_BOUND_CONVERSATION_TIMEOUT_SECONDS = 45
    BOOTSTRAP_CREATE_TIMEOUT_SECONDS = 90.0

    def _session_has_prebound_home_online(self, remote, bridge_status=None):
        remote = normalize_remote_chatgpt(remote)
        if self._remote_bind_state(remote) != BIND_STATE_PREBOUND_HOME:
            return False
        client_id = (
            remote.get("prebound_home_client_id") or remote.get("client_id") or ""
        ).strip()
        page_instance_id = (
            remote.get("prebound_home_page_instance_id")
            or remote.get("page_instance_id")
            or ""
        ).strip()
        if not client_id:
            return False
        status = bridge_status if bridge_status is not None else self._last_bridge_status
        for item in self._iter_tm_clients(status, online_only=True, page_type="home"):
            if self._tm_client_id(item) != client_id:
                continue
            if page_instance_id and self._tm_page_instance_id(item) != page_instance_id:
                continue
            page_url = self._tm_page_url(item)
            if not self._is_bindable_chatgpt_url(page_url):
                continue
            poll_ts = float(item.get("last_poll_at") or item.get("last_seen") or 0)
            if poll_ts and (time.time() - poll_ts) <= self.IDLE_HOME_FRESH_SECONDS:
                return True
        return False
    def _find_prebound_home_client(self, remote):
        remote = normalize_remote_chatgpt(remote)
        client_id = (
            remote.get("prebound_home_client_id") or remote.get("client_id") or ""
        ).strip()
        page_instance_id = (
            remote.get("prebound_home_page_instance_id")
            or remote.get("page_instance_id")
            or ""
        ).strip()
        for item in self._iter_tm_clients(self._last_bridge_status, online_only=True, page_type="home"):
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
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
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

        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )

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
        if not remote.get("enabled"):
            return False
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
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
            client_info.get("page_url")
            or client_info.get("url")
            or client_info.get("conversation_url")
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
        last_focus_at = float(item.get("last_focus_at") or 0)
        last_seen = float(item.get("last_seen") or 0)
        poll_ts = float(item.get("last_poll_at") or item.get("last_seen") or 0)
        poll_age = time.time() - poll_ts if poll_ts else 999999.0
        poll_fresh = 1 if poll_age <= float(TM_POLL_FRESH_SECONDS) else 0
        client_id = (item.get("client_id") or "").strip()
        page_instance_id = (item.get("page_instance_id") or "").strip()
        known_clients = getattr(self, "_pending_auto_bind_known_clients", set()) or set()
        known_instances = (
            getattr(self, "_pending_auto_bind_known_page_instances", set()) or set()
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
    @staticmethod
    def _idle_home_selection_reason(item):
        visible = (
            item.get("visibility_state") or item.get("visible") or ""
        ).strip()
        activity = classify_tm_client_activity(item)
        if activity == "active_focused" or item.get("has_focus"):
            return "focused_home"
        if float(item.get("last_focus_at") or 0) > 0:
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
            remote.get("bind_request_id") or remote.get("launch_token") or ""
        ).strip()

    def _resolve_session_for_conversation_created(self, item):
        payload = item.get("payload") or {}
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
            or payload.get("launch_token")
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
                    remote.get("prebound_home_page_instance_id") or ""
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
                    or remote.get("prebound_home_client_id")
                    or remote.get("reserved_client_id")
                    or ""
                ).strip()
                if bound_client == client_id:
                    return session

        return None
    def _idle_home_skip_reason(self, item, status=None):
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
        if self._is_home_client_used_by_any_session(client_id, page_instance_id):
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
        return ""
    def _recent_focus_home_client_id(self, status=None):
        status = status or self._last_bridge_status or {}
        best_id = ""
        best_focus_at = 0.0
        best_has_focus = False
        for item in status.get("tampermonkey_clients") or []:
            if not isinstance(item, dict) or not item.get("online"):
                continue
            if (item.get("page_type") or "").strip() != "home":
                continue
            client_id = (item.get("client_id") or "").strip()
            if not client_id:
                continue
            last_focus_at = float(item.get("last_focus_at") or 0)
            has_focus = bool(item.get("has_focus"))
            if has_focus and not best_has_focus:
                best_id = client_id
                best_focus_at = last_focus_at
                best_has_focus = True
                continue
            if has_focus == best_has_focus and last_focus_at > best_focus_at:
                best_id = client_id
                best_focus_at = last_focus_at
        return best_id
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

        poll_ts = float(item.get("last_poll_at") or item.get("last_seen") or 0)
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
        page_url = (client_info.get("page_url") or "").strip()
        if not self._is_bindable_chatgpt_url(page_url):
            return True
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return True
        return False
    def _home_client_has_pending_bridge_work(self, client_id, page_instance_id, status=None):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()
        status = status or self._last_bridge_status or {}

        for waiting in status.get("waiting_acks") or []:
            if not isinstance(waiting, dict):
                continue
            if not waiting.get("bootstrap_conversation"):
                continue
            message_id = (waiting.get("id") or "").strip()
            if message_id and self._is_finalized(message_id):
                continue
            target_client = (
                waiting.get("target_client_id") or waiting.get("delivered_to") or ""
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
            if not remote.get("bootstrap_in_progress"):
                continue
            home_client = (
                remote.get("prebound_home_client_id") or remote.get("client_id") or ""
            ).strip()
            home_instance = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            if home_client != client_id:
                continue
            if page_instance_id and home_instance and home_instance != page_instance_id:
                continue
            return True

        return False
    def _is_home_client_used_by_any_session(self, client_id, page_instance_id):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()

        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)

            prebound_client = (remote.get("prebound_home_client_id") or "").strip()
            prebound_instance = (
                remote.get("prebound_home_page_instance_id") or ""
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
                reserved_client = (remote.get("reserved_client_id") or "").strip()
                reserved_instance = (
                    remote.get("reserved_page_instance_id") or ""
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
                    status_text = (message.status or "").strip()
                    if status_text in PENDING_ASSISTANT_STATUSES:
                        return True
                    if message.content in ASSISTANT_WAIT_TEXTS:
                        return True

        return False
    def _find_idle_chatgpt_home_client(self, status=None, session_id=""):
        status = status or self._last_bridge_status or {}
        session_id = (session_id or "").strip()
        candidates = []
        for item in self._iter_tm_clients(status, online_only=True, page_type="home"):
            client_id = self._tm_client_id(item)
            skip_reason = self._idle_home_skip_reason(item, status)
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
            last_focus_at = float(item.get("last_focus_at") or 0)
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
            selected.get("visibility_state") or selected.get("visible") or ""
        ).strip()
        reason = self._idle_home_selection_reason(selected)
        self._append_log(
            f"[AUTO_BIND][SELECT_IDLE_HOME] session_id={session_id or '-'} "
            f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
            f"has_focus={bool(selected.get('has_focus'))} "
            f"last_focus_at={float(selected.get('last_focus_at') or 0):.3f} "
            f"visible={visible or '-'} "
            f"last_seen={float(selected.get('last_seen') or 0):.3f} "
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
            state = server.get_message_state(bridge_id)
            if not state or not state.get("bootstrap_conversation"):
                continue
            status = (state.get("status") or "").strip()
            if status not in ("queued", "cancelled"):
                return True
            if bridge_id in self._ack_success_message_ids:
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
        if remote.get("bootstrap_in_progress"):
            return False
        if self._session_has_claimed_or_acked_bootstrap(session):
            return False
        return True
    def _session_needs_first_message_bind(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        conversation_id = (remote.get("conversation_id") or "").strip()
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
            self._pending_auto_bind_session_id
            and self._pending_auto_bind_session_id != session_id
        ):
            self._append_log(
                f"[AUTO_BIND][REPLACE] old={self._pending_auto_bind_session_id} "
                f"new={session_id}"
            )

        status = self._last_bridge_status or {}
        clients = status.get("tampermonkey_clients") or []
        self._pending_auto_bind_session_id = session_id
        self._pending_auto_bind_until = time.time() + 30
        self._pending_auto_bind_known_clients = {
            (item.get("client_id") or "").strip()
            for item in clients
            if isinstance(item, dict) and (item.get("client_id") or "").strip()
        }
        self._pending_auto_bind_known_page_instances = {
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
                "launch_token": bind_request_id,
                "bind_started_at": time.time(),
            }
            self._save_sessions_to_disk()
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)

        url = f"{CHATGPT_HOME_URL}?xz_bind_token={bind_request_id}"
        opened = self._open_url_in_browser(url, "发送首条消息时打开 ChatGPT 首页")
        method = "system_browser"
        result = "success" if opened else "failed"
        if not opened and server.is_server_running():
            self._push_open_url(url, active=True, label="发送首条消息时打开 ChatGPT 首页")
            method = "bridge_command"
            result = "queued"

        pending_text = (
            normalize_remote_chatgpt(session.remote_chatgpt).get("pending_bootstrap_text")
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
    def _prepare_first_message_binding(self, session, text):
        if self._session_has_wrong_existing_conversation_bind(session):
            self._append_log(
                f"[BIND][RESET_WRONG_CONVERSATION] session_id={session.session_id} "
                f"reason=new_local_session_cannot_keep_existing_conversation"
            )
            session.remote_chatgpt = default_remote_chatgpt()
            session.updated_at = time.time()
            self._save_sessions_to_disk()

        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bind_state = self._remote_bind_state(remote)

        if (
            bind_state == BIND_STATE_PREBOUND_HOME
            and not self._session_has_prebound_home_online(remote)
        ):
            old_client = (
                remote.get("client_id") or remote.get("prebound_home_client_id") or "-"
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
            self._save_sessions_to_disk()
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)

        if not self._session_needs_first_message_bind(session):
            return True, ""

        if bind_state == BIND_STATE_WAITING_HOME:
            pending = (remote.get("pending_bootstrap_text") or "").strip()
            if pending:
                return (
                    False,
                    "正在等待 ChatGPT 首页上线，首条消息将在页面上线后自动发送。",
                )
            return False, "正在等待 ChatGPT 首页上线，请稍候。"

        idle_home = self._find_idle_chatgpt_home_client(
            session_id=session.session_id if session else ""
        )
        if idle_home:
            client_id = (idle_home.get("client_id") or "").strip()
            page_instance_id = (idle_home.get("page_instance_id") or "").strip()
            visible = (
                idle_home.get("visibility_state") or idle_home.get("visible") or ""
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
                f"last_focus_at={float(idle_home.get('last_focus_at') or 0):.3f} "
                f"visible={visible or '-'} reason={reason}"
            )
            self._add_system_message(
                "已使用空闲 ChatGPT 首页发送首条消息，等待创建新对话..."
            )
            return True, ""

        now = time.time()
        bind_request_id = uuid.uuid4().hex
        session.remote_chatgpt = {
            **default_remote_chatgpt(),
            "bind_state": BIND_STATE_WAITING_HOME,
            "bind_request_id": bind_request_id,
            "launch_token": bind_request_id,
            "bind_started_at": now,
            "pending_bootstrap_text": text,
            "pending_bootstrap_created_at": now,
            "opened_home_at": now,
        }
        self._save_sessions_to_disk()
        self._start_waiting_home_on_send(session)
        self._add_system_message(
            "未发现空闲 ChatGPT 首页，正在打开新的 ChatGPT 首页..."
        )
        return False, "__WAITING_HOME_PENDING__"
    def _bound_conversation_target_url(self, remote):
        return self._chatgpt_url_from_remote(remote)
    def _open_bound_conversation_url(self, target_url, reopen_request_id=""):
        url = (target_url or "").strip()
        if not url:
            return False
        request_id = (reopen_request_id or "").strip()
        if request_id:
            clean_url = url.split("#")[0]
            url = f"{clean_url}#xz_reopen_token={request_id}"
        return self._open_page_once(url, "打开绑定的 ChatGPT 对话页")
    def _prepare_bound_conversation_reopen_if_needed(
        self, session, text, user_message_id=""
    ):
        if not self._bind_each_chat_to_page or session is None:
            return True

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
        if not conversation_id or not remote.get("enabled"):
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
                "pending_send_text": pending_text
                or (remote_now.get("pending_send_text") or ""),
                "pending_send_message_id": (user_message_id or "").strip()
                or (remote_now.get("pending_send_message_id") or ""),
                "pending_send_created_at": time.time(),
            }
            session.updated_at = time.time()
            self._save_sessions_to_disk()
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
            "pending_send_text": pending_text,
            "pending_send_message_id": (user_message_id or "").strip(),
            "pending_send_created_at": now if pending_text else 0,
            "reopen_request_id": reopen_request_id,
            "reopen_started_at": now,
            "reopen_target_url": target_url,
        }
        session.updated_at = now
        self._save_sessions_to_disk()
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
    def _flush_pending_bound_send_message(self, session, text):
        text = (text or "").strip()
        if not text or session is None:
            return
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return
        if self._session_has_pending_assistant_reply(session):
            self._append_log(
                f"[REOPEN][FLUSH_SKIP] session_id={session.session_id} "
                f"reason=pending_assistant_reply"
            )
            return
        self._push_message_text(session, text)
    def _try_finish_waiting_bound_conversations(self, status):
        status = status or self._last_bridge_status or {}
        now = time.time()
        for session in list(self._sessions.values()):
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if self._remote_bind_state(remote) != BIND_STATE_WAITING_BOUND_CONVERSATION:
                continue

            started = float(remote.get("reopen_started_at") or 0)
            if started and (
                now - started > self.REOPEN_BOUND_CONVERSATION_TIMEOUT_SECONDS
            ):
                self._append_log(
                    f"[BIND][REOPEN_BOUND_TIMEOUT] session_id={session.session_id} "
                    f"conversation_id={remote.get('conversation_id') or '-'} "
                    f"pending_text_len={len((remote.get('pending_send_text') or '').strip())}"
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
                self._save_sessions_to_disk()
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
                self._update_bound_page_display()
                self._apply_chat_bind_visual_state()
                continue

            expected_conversation_id = (
                (remote.get("conversation_id") or "").strip()
                or parse_conversation_id(
                    remote.get("conversation_url") or remote.get("url") or ""
                )
            )
            client_info = None
            for item in self._iter_tm_clients(status, online_only=True):
                page_type = (item.get("page_type") or "").strip()
                actual_conversation_id = (
                    (item.get("conversation_id") or "").strip()
                    or parse_conversation_id((item.get("page_url") or "").strip())
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

            pending_text = (remote.get("pending_send_text") or "").strip()
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
                    "pending_send_text": "",
                    "pending_send_message_id": "",
                    "pending_send_created_at": 0,
                    "reopen_request_id": "",
                    "reopen_started_at": 0,
                    "reopen_target_url": "",
                }
                session.updated_at = time.time()
                self._save_sessions_to_disk()
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
                    "pending_send_text": "",
                    "pending_send_message_id": "",
                    "pending_send_created_at": 0,
                    "reopen_request_id": "",
                    "reopen_started_at": 0,
                    "reopen_target_url": "",
                }
                session.updated_at = time.time()
                self._save_sessions_to_disk()
            self._refresh_session_list(select_session_id=self._current_session_id)
            self._update_bound_page_display()
            self._apply_chat_bind_visual_state()
    def _prebound_home_bind_to_session(
        self, session, client_info, silent=False, reserve_reason=""
    ):
        if not isinstance(client_info, dict):
            return False
        page_url = (
            client_info.get("page_url")
            or client_info.get("url")
            or CHATGPT_HOME_URL
        ).strip()
        client_id = (client_info.get("client_id") or "").strip()
        page_instance_id = (client_info.get("page_instance_id") or "").strip()
        if not client_id:
            self._add_system_message("缺少 client_id，无法预绑定首页。")
            return False
        if self._is_home_client_used_by_any_session(client_id, page_instance_id):
            self._add_system_message("该 ChatGPT 首页已被其他对话占用。")
            return False
        if not self._is_bindable_chatgpt_url(page_url):
            self._add_system_message("该 URL 不是可绑定的 ChatGPT 首页。")
            return False
        remote_prev = normalize_remote_chatgpt(session.remote_chatgpt)
        client_bind_token = (
            client_info.get("bind_request_id")
            or client_info.get("launch_token")
            or ""
        ).strip()
        session_bind_token = self._session_bind_request_id(remote_prev)
        if session_bind_token and client_bind_token:
            if client_bind_token != session_bind_token:
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
        session.remote_chatgpt = {
            "enabled": True,
            "bind_state": BIND_STATE_PREBOUND_HOME,
            "conversation_id": "",
            "conversation_url": page_url,
            "url": page_url,
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "page_type": "home",
            "page_title": (client_info.get("page_title") or "").strip(),
            "last_seen": float(client_info.get("last_seen") or time.time()),
            "prebound_home_client_id": client_id,
            "prebound_home_page_instance_id": page_instance_id,
            "reserved_client_id": client_id,
            "reserved_page_instance_id": page_instance_id,
            "reserved_at": now,
            "bind_request_id": bind_request_id,
            "launch_token": bind_request_id,
            "bind_started_at": float(remote_prev.get("bind_started_at") or now),
            "created_from_home": True,
            "bootstrap_in_progress": False,
        }
        session.updated_at = time.time()
        if server.is_server_running():
            server.set_bound_client_id(client_id, session.session_id)
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        self._refresh_tm_page_selector()
        self._render_tampermonkey_clients(self._last_bridge_status)
        if silent:
            self._set_settings_hint("已预绑定 ChatGPT 首页到当前对话。")
        else:
            self._add_system_message(
                "已预绑定 ChatGPT 首页。发送第一条消息后，"
                "将自动创建并绑定新的 ChatGPT 对话。"
            )
        self._append_log(
            f"[绑定][PREBOUND_HOME] session={session.session_id[:8]}… "
            f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
            f"url={page_url}"
        )
        return True
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
            client_info.get("page_url")
            or client_info.get("url")
            or client_info.get("conversation_url")
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
        if not client_id:
            self._add_system_message("缺少 client_id，无法绑定。")
            return False
        if not conversation_id:
            self._add_system_message("缺少 conversation_id，无法正式绑定对话页。")
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip()
        old_conversation_id = (remote.get("conversation_id") or "").strip()
        if not old_conversation_id:
            old_conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
        session.remote_chatgpt = {
            "enabled": True,
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
            "conversation_id": conversation_id,
            "conversation_url": conversation_url,
            "url": conversation_url,
            "client_id": client_id,
            "page_instance_id": (client_info.get("page_instance_id") or "").strip(),
            "page_type": "conversation",
            "page_title": (client_info.get("page_title") or "").strip(),
            "last_seen": float(client_info.get("last_seen") or time.time()),
            "prebound_home_client_id": remote.get("prebound_home_client_id") or "",
            "prebound_home_page_instance_id": remote.get(
                "prebound_home_page_instance_id"
            )
            or "",
            "created_from_home": bool(remote.get("created_from_home")),
            "bootstrap_in_progress": False,
        }
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
        if server.is_server_running():
            server.set_bound_client_id(client_id, session.session_id)
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        self._refresh_tm_page_selector()
        self._render_tampermonkey_clients(self._last_bridge_status)
        if silent:
            self._set_settings_hint("已绑定 ChatGPT 对话页到当前对话。")
        else:
            self._add_system_message(
                f"已绑定 ChatGPT 对话页。conversation_id={conversation_id}"
            )
        self._append_log(
            f"[绑定][CONVERSATION] session={session.session_id[:8]}… "
            f"client_id={client_id} conversation_id={conversation_id} "
            f"url={conversation_url or page_url}"
        )
        if self._auto_sync_conversation_on_bind:
            self._schedule_auto_sync_conversation(
                session, request_reason="auto_on_bind"
            )
        return True
    def _apply_conversation_created_binding(self, session, payload, client_id=""):
        if session is None:
            return
        conversation_id = (payload.get("conversation_id") or "").strip()
        page_url = (payload.get("url") or "").strip()
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
        session.remote_chatgpt = {
            "enabled": True,
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
            "conversation_id": conversation_id,
            "conversation_url": page_url,
            "url": page_url,
            "client_id": bound_client_id,
            "page_instance_id": page_instance_id,
            "page_type": "conversation",
            "page_title": remote.get("page_title") or "",
            "last_seen": time.time(),
            "prebound_home_client_id": remote.get("prebound_home_client_id") or "",
            "prebound_home_page_instance_id": remote.get(
                "prebound_home_page_instance_id"
            )
            or "",
            "bind_request_id": bind_request_id,
            "launch_token": bind_request_id,
            "bind_started_at": float(remote.get("bind_started_at") or 0),
            "created_from_home": True,
            "bootstrap_in_progress": False,
            "pending_bootstrap_text": "",
            "pending_bootstrap_created_at": 0,
            "bootstrap_message_id": "",
            "bootstrap_started_at": 0,
            "opened_home_at": 0,
        }
        session.updated_at = time.time()
        if server.is_server_running() and bound_client_id:
            server.set_bound_client_id(bound_client_id, session.session_id)
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        self._add_system_message(
            f"已自动创建并绑定 ChatGPT 对话：conversation_id={conversation_id}"
        )
        bind_request_id = self._session_bind_request_id(remote)
        report_bind = (
            payload.get("bind_request_id") or payload.get("launch_token") or ""
        ).strip()
        message_id = (payload.get("message_id") or "").strip()
        self._append_log(
            f"[BIND][CONVERSATION_CREATED] session_id={session.session_id} "
            f"message_id={message_id[:8] if message_id else '-'} "
            f"conversation_id={conversation_id} source=bootstrap_home "
            f"bind_request_id={bind_request_id or report_bind or '-'} "
            f"client_id={bound_client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"url={page_url or '-'}"
        )

    def _mark_latest_pending_assistant_error(self, session, text, status_text):
        if session is None:
            return False
        for message in reversed(getattr(session, "messages", [])):
            if getattr(message, "role", "") != "assistant":
                continue
            current_status = (getattr(message, "status", "") or "").strip()
            current_text = (getattr(message, "content", "") or "").strip()
            if current_status in PENDING_ASSISTANT_STATUSES or current_text in ASSISTANT_WAIT_TEXTS:
                message.role = "error"
                message.content = (text or "").strip()
                message.status = (status_text or "失败").strip()
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
            started_at = float(
                remote.get("bootstrap_started_at")
                or remote.get("bind_started_at")
                or 0
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
                f"[BIND][BOOTSTRAP_TIMEOUT_RESET] session_id={session.session_id} "
                f"elapsed={elapsed:.1f}"
            )
            self._mark_latest_pending_assistant_error(
                session,
                "创建 ChatGPT 对话超时，请重新发送。",
                "创建超时",
            )

        if changed:
            self._save_sessions_to_disk()
            self._refresh_session_list(select_session_id=self._current_session_id)
            if self._current_session():
                self._render_session_chat(self._current_session())
    def _is_client_bound_to_other_session(self, client_info, current_session_id):
        if not isinstance(client_info, dict):
            return False

        client_id = (client_info.get("client_id") or "").strip()
        page_instance_id = (client_info.get("page_instance_id") or "").strip()
        page_url = (client_info.get("page_url") or "").strip()

        for session_id, session in self._sessions.items():
            if session_id == current_session_id:
                continue

            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote.get("enabled"):
                continue

            bound_client_id = (remote.get("client_id") or "").strip()
            bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
            bound_url = (remote.get("conversation_url") or "").strip()

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
    def _candidate_matches_remote(self, client_info, remote):
        if not isinstance(client_info, dict):
            return False

        remote = normalize_remote_chatgpt(remote)

        current_url = (remote.get("conversation_url") or "").strip()
        current_conv = (remote.get("conversation_id") or "").strip()

        page_url = (client_info.get("page_url") or "").strip()
        candidate_conv = (client_info.get("conversation_id") or "").strip()

        if not candidate_conv:
            candidate_conv = parse_conversation_id(page_url)

        if current_conv and candidate_conv and current_conv == candidate_conv:
            return True

        if current_url and page_url and current_url == page_url:
            return True

        if not current_conv and not current_url:
            return True

        return False
    def _pick_auto_bind_client(self, status, current_session_id, remote=None):
        status = status or {}
        if not (status.get("tampermonkey_clients") or []):
            return None

        session = self._sessions.get(current_session_id) if current_session_id else None
        is_new_chat_flow = self._session_is_local_new_chat_flow(session)

        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
        within_wait_window = time.time() <= getattr(self, "_auto_bind_wait_until", 0)
        prefer_home = bool(getattr(self, "_pending_auto_bind_session_id", "")) or is_new_chat_flow

        candidates = []
        for item in self._iter_tm_clients(status, online_only=True, bindable_only=True):
            client_id = self._tm_client_id(item)
            page_url = self._tm_page_url(item)
            page_type = (item.get("page_type") or "").strip()
            conversation_id = self._tm_client_conversation_id(item)

            if self._is_client_bound_to_other_session(item, current_session_id):
                continue

            if is_new_chat_flow:
                if page_type != "home":
                    self._append_log(
                        f"[AUTO_BIND][SKIP_EXISTING_CONVERSATION] "
                        f"session_id={current_session_id} client_id={client_id} "
                        f"conversation_id={conversation_id or '-'} "
                        f"reason=new_session_only_allows_home"
                    )
                    continue
                if conversation_id:
                    self._append_log(
                        f"[AUTO_BIND][SKIP] session={current_session_id[:8]} "
                        f"client_id={client_id} conversation_id={conversation_id} "
                        f"reason=home_candidate_has_conversation_id"
                    )
                    continue

            if remote is not None and remote.get("enabled"):
                if not self._candidate_matches_remote(item, remote):
                    continue

            is_new = (
                1
                if within_wait_window
                and client_id
                and client_id not in self._auto_bind_known_clients
                else 0
            )
            is_home = 1 if prefer_home and page_type == "home" else 0
            is_live = 1 if client_id == live_client_id else 0
            has_focus = 1 if item.get("has_focus") else 0
            last_seen = float(item.get("last_seen") or 0)

            candidates.append((is_new, is_home, is_live, has_focus, last_seen, item))

        if not candidates:
            return None

        candidates.sort(
            key=lambda row: (row[0], row[1], row[2], row[3], row[4]),
            reverse=True,
        )
        return dict(candidates[0][5])
    def _auto_bind_current_session_if_needed(self, status):
        if self._pending_auto_bind_session_id:
            return False
        if not getattr(self, "_auto_bind_unbound_page", True):
            return False

        status = status or {}
        if not status.get("tampermonkey_online"):
            return False

        session = self._current_session()
        if session is None:
            session = self._ensure_current_session()

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._session_is_local_new_chat_flow(session):
            return False
        if self._remote_bind_state(remote) == BIND_STATE_UNBOUND:
            return False
        if self._remote_bind_state(remote) == BIND_STATE_WAITING_HOME:
            return False
        if self._remote_bind_state(remote) == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return False

        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        if bound_conversation_id and not self._session_bound_page_online(
            session, status
        ):
            return False

        bound_client_id = (remote.get("client_id") or "").strip()
        rebind_offline = False

        if remote.get("enabled") and bound_client_id:
            if self._is_client_online(bound_client_id):
                if self._session_has_sendable_bound_page(remote):
                    return False
            if self._rebind_current_session_to_online_client_if_needed():
                return True
            rebind_offline = True
            client_info = self._pick_auto_bind_client(
                status,
                session.session_id,
                remote=remote,
            )
        else:
            client_info = self._pick_auto_bind_client(
                status,
                session.session_id,
                remote=None,
            )

        if not client_info:
            return False

        page_type = (client_info.get("page_type") or "").strip()
        if page_type == "conversation" or self._client_conversation_id(client_info):
            if self._session_is_local_new_chat_flow(session):
                ok = False
            else:
                ok = self._bind_conversation_to_session(session, client_info, silent=True)
        elif page_type == "home" and not (remote.get("enabled") and bound_client_id):
            ok = self._prebound_home_bind_to_session(session, client_info, silent=True)
        else:
            ok = self._prebound_home_bind_to_session(session, client_info, silent=True)
        if ok:
            action = "自动换绑" if rebind_offline else "自动绑定"
            self._append_log(
                f"[{action}] "
                f"session={session.session_id[:8]}… "
                f"old_client_id={bound_client_id or '-'} "
                f"new_client_id={client_info.get('client_id') or '-'} "
                f"page_type={page_type or '-'} "
                f"url={client_info.get('page_url') or '-'}"
            )

        return ok
    def _mark_auto_bind_waiting(self):
        clients = self._last_bridge_status.get("tampermonkey_clients") or []
        self._auto_bind_known_clients = {
            (item.get("client_id") or "").strip()
            for item in clients
            if isinstance(item, dict) and (item.get("client_id") or "").strip()
        }
        self._auto_bind_wait_until = time.time() + 30
    def _clear_pending_auto_bind(self):
        self._pending_auto_bind_session_id = ""
        self._pending_auto_bind_until = 0
        self._pending_auto_bind_known_clients.clear()
        self._pending_auto_bind_known_page_instances.clear()
    def _try_finish_pending_auto_bind(self, status):
        session_id = self._pending_auto_bind_session_id
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
        if now > self._pending_auto_bind_until:
            self._append_log(f"[AUTO_BIND][TIMEOUT] session_id={session_id}")
            if session_id == self._current_session_id:
                self._add_system_message(
                    "等待 ChatGPT 首页上线超时。请确认页面是否打开并且油猴脚本在线，"
                    "或手动点击「绑定当前页面」。"
                )
            session.remote_chatgpt = {
                **remote,
                "bind_state": BIND_STATE_UNBOUND,
                "pending_bootstrap_text": "",
                "pending_bootstrap_created_at": 0,
                "opened_home_at": 0,
            }
            self._save_sessions_to_disk()
            self._clear_pending_auto_bind()
            self._refresh_session_list(select_session_id=self._current_session_id)
            self._apply_chat_bind_visual_state()
            return

        if remote.get("enabled") and (remote.get("client_id") or "").strip():
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
                item.get("bind_request_id") or item.get("launch_token") or ""
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
                    client_id not in self._pending_auto_bind_known_clients
                )
                is_new_instance = (
                    page_instance_id
                    and page_instance_id
                    not in self._pending_auto_bind_known_page_instances
                )
                if not is_new_client and not is_new_instance:
                    continue
            if self._is_home_client_used_by_any_session(client_id, page_instance_id):
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
            normalize_remote_chatgpt(session.remote_chatgpt).get("pending_bootstrap_text")
            or remote.get("pending_bootstrap_text")
            or ""
        ).strip()
        session.remote_chatgpt = {
            **normalize_remote_chatgpt(session.remote_chatgpt),
            "pending_bootstrap_text": "",
            "pending_bootstrap_created_at": 0,
            "opened_home_at": 0,
        }
        matched_token = (
            selected.get("bind_request_id")
            or selected.get("launch_token")
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
        self._save_sessions_to_disk()
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        if pending_text:
            self._flush_pending_bootstrap_message(session, pending_text)
    def _sync_bound_session_urls_from_clients(self, status):
        client_map = {}
        for item in self._iter_tm_clients(status, online_only=True):
            client_id = self._tm_client_id(item)
            if client_id:
                client_map[client_id] = item

        changed = False
        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote.get("enabled"):
                continue
            session_conversation_id = (remote.get("conversation_id") or "").strip()
            if not session_conversation_id:
                session_conversation_id = parse_conversation_id(
                    remote.get("conversation_url") or remote.get("url") or ""
                )
            client_id = (remote.get("client_id") or "").strip()
            if not client_id:
                continue
            item = client_map.get(client_id)
            if not item:
                continue
            page_url = (item.get("page_url") or "").strip()
            if not self._is_bindable_chatgpt_url(page_url):
                continue
            client_conversation_id = (item.get("conversation_id") or "").strip()
            if not client_conversation_id:
                client_conversation_id = parse_conversation_id(page_url)
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
            old_url = (remote.get("conversation_url") or "").strip()
            if page_url.split("#")[0] == old_url.split("#")[0]:
                continue
            conversation_id = client_conversation_id or remote.get("conversation_id", "")
            session.remote_chatgpt = {
                **remote,
                "conversation_url": page_url,
                "url": page_url,
                "conversation_id": conversation_id,
                "page_type": (item.get("page_type") or remote.get("page_type") or "").strip(),
                "page_title": (item.get("page_title") or remote.get("page_title") or "").strip(),
                "last_seen": float(item.get("last_seen") or time.time()),
            }
            session.updated_at = time.time()
            changed = True
            self._append_log(
                f"[AUTO_BIND][UPDATE_URL] session_id={session.session_id} "
                f"client_id={client_id} old={old_url or '-'} new={page_url}"
            )
        if changed:
            self._save_sessions_to_disk()
            if self._current_session():
                self._update_bound_page_display()

