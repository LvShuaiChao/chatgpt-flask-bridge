"""绑定字段清理、归一化与统一写入入口。"""

import time
from urllib.parse import urlparse

import server

from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_UNBOUND,
    normalize_remote_chatgpt,
    write_session_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from




class PageBindingStateMixin:
    def _clear_session_binding(self, session_id, *, reason=""):
        if not session_id:
            self._append_log(
                "[BIND][CLEAR][SKIP] reason=missing_session_id",
                echo=True,
            )
            return False
        session = self._get_session_by_id(session_id)
        if session is None:
            self._append_log(
                f"[BIND][CLEAR][SKIP] session_id={session_id} reason=session_not_found",
                echo=True,
            )
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip()
        old_page_instance_id = (remote.get("page_instance_id") or "").strip()
        old_conversation_id = (remote.get("conversation_id") or "").strip()
        old_url = (
            (remote.get("conversation_url") or remote.get("url") or "").strip()
        )

        write_session_remote_chatgpt(
            session,
            enabled=False,
            bind_state=BIND_STATE_UNBOUND,
            url="",
            conversation_id="",
            client_id="",
            page_instance_id="",
            page_type="",
            last_seen=0,
        )
        self._purge_session_binding_caches(session_id)
        if getattr(self, "_pending_auto_bind_session_id", "") == session_id:
            if hasattr(self, "_clear_pending_auto_bind"):
                self._clear_pending_auto_bind()

        if server.is_server_running():
            server.clear_session_binding(session_id, client_id=old_client_id)

        self._append_log(
            "[BIND][CLEAR][SESSION] "
            f"session_id={session_id} "
            f"reason={reason or '-'} "
            f"old_client_id={old_client_id or '-'} "
            f"old_page_instance_id={old_page_instance_id or '-'} "
            f"old_conversation_id={old_conversation_id or '-'} "
            f"old_url={old_url or '-'}",
            echo=True,
        )
        self._save_sessions_to_disk()
        return True

    def _purge_session_binding_caches(self, session_id):
        if not session_id:
            return
        getattr(self, "_last_bound_page_seen_by_session", {}).pop(session_id, None)
        getattr(self, "_last_session_bind_display_state", {}).pop(session_id, None)
        logged = getattr(self, "_last_session_bind_logged_pair", None)
        if isinstance(logged, dict):
            logged.pop(session_id, None)
        log_at = getattr(self, "_last_session_bind_state_log_at", None)
        if isinstance(log_at, dict):
            keys_to_drop = [
                key for key in log_at if isinstance(key, tuple) and key[0] == session_id
            ]
            for key in keys_to_drop:
                log_at.pop(key, None)

    def _clear_pending_web_sync_for_session(self, session_id):
        if not session_id:
            return 0
        removed = 0
        pending_map = getattr(self, "_pending_web_sync_requests", None)
        if isinstance(pending_map, dict):
            for request_id in list(pending_map.keys()):
                item = pending_map.get(request_id) or {}
                if item.get("session_id") == session_id:
                    pending_map.pop(request_id, None)
                    removed += 1
        sync_map = getattr(self, "_pending_sync_requests", None)
        if isinstance(sync_map, dict):
            for message_id in list(sync_map.keys()):
                item = sync_map.get(message_id) or {}
                if item.get("session_id") == session_id:
                    sync_map.pop(message_id, None)
                    removed += 1
        self._append_log(
            f"[WEB_SYNC][PENDING_CLEAR] session_id={session_id} removed={removed}",
            echo=True,
        )
        return removed

    def _gc_orphan_bindings(self):
        session_ids = set(self._sessions.keys())
        removed = 0
        if server.is_server_running():
            orphans = server.gc_orphan_session_bindings(session_ids)
            for item in orphans:
                removed += 1
                self._append_log(
                    "[BIND][GC][ORPHAN_REMOVED] "
                    f"session_id={item.get('session_id') or '-'} "
                    f"client_id={item.get('client_id') or '-'} "
                    f"conversation_id={item.get('conversation_id') or '-'} "
                    f"url={item.get('url') or '-'}",
                    echo=True,
                )
        for bridge_id, sid in list(self._message_to_session.items()):
            if sid and sid not in session_ids:
                self._message_to_session.pop(bridge_id, None)
                self._message_to_turn.pop(bridge_id, None)
                removed += 1
        return removed

    def _refresh_current_session_binding_display(self):
        session = self._current_session()
        if session is not None:
            self._fix_session_remote_url_from_conversation(session)
        self._update_current_session_url_display()
        self._update_bound_page_display()
        self._update_sync_target_display()
        self._apply_chat_bind_visual_state()

    def _fix_session_remote_url_from_conversation(self, session, *, echo=True):
        """conversation_id 已存在但 URL 仍为 xz_bind_token 时自动修复。"""
        if session is None:
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return False
        conversation_id = self._remote_conversation_id(remote)
        if not conversation_id:
            return False
        url = (
            remote.get("conversation_url")
            or remote.get("url")
            or remote.get("page_url")
            or ""
        ).strip()
        if "xz_bind_token=" not in url:
            return False
        new_url = f"https://chatgpt.com/c/{conversation_id}"
        remote["url"] = new_url
        remote["bind_state"] = BIND_STATE_BOUND_CONVERSATION
        remote["page_type"] = "conversation"
        session.remote_chatgpt = remote
        session.updated_at = time.time()
        self._save_sessions_to_disk()
        if echo:
            self._append_log(
                "[BIND][FIX_URL_FROM_CONVERSATION] "
                f"session_id={session.session_id} "
                f"conversation_id={conversation_id} "
                f"new_url={new_url}",
                echo=True,
            )
        return True

    def _update_session_binding_from_normalized_page(
        self, session, normalized, *, reason="manual_bind"
    ):
        if session is None:
            self._append_log(
                "[BIND][WRITE][SKIP] reason=session_is_none",
                echo=True,
            )
            return False
        normalized = self._normalize_tm_page_for_binding(normalized)
        if not normalized.get("client_id") and not (
            normalized.get("url") or normalized.get("page_url")
        ):
            self._append_log(
                "[BIND][WRITE][SKIP] reason=invalid_normalized_page",
                echo=True,
            )
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_url = self._remote_conversation_url(remote) if remote.get("enabled") else ""
        old_conversation_id = self._remote_conversation_id(remote) or ""
        old_client_id = (remote.get("client_id") or "").strip()
        self._append_log(
            "[BIND][WRITE][BEFORE] "
            f"session_id={session.session_id} "
            f"reason={reason or '-'} "
            f"old_url={old_url or '-'} "
            f"old_conversation_id={old_conversation_id or '-'} "
            f"old_client_id={old_client_id or '-'}",
            echo=True,
        )

        new_conversation_id = (normalized.get("conversation_id") or "").strip()
        new_url = (normalized.get("url") or normalized.get("page_url") or "").strip()
        if (
            new_conversation_id
            and old_url
            and "xz_bind_token=" in old_url
            and "/c/" not in old_url
        ):
            self._append_log(
                "[BIND][REPLACE_PREBOUND_HOME] "
                f"session_id={session.session_id} "
                f"old_url={old_url} "
                f"new_url={new_url or '-'} "
                f"conversation_id={new_conversation_id}",
                echo=True,
            )

        ok = self.set_bound_page(
            session,
            normalized,
            reason=reason or "update_binding_from_normalized",
            silent=True,
            allow_existing_conversation_for_new_session=True,
        )

        remote_after = normalize_remote_chatgpt(session.remote_chatgpt)
        new_url_after = self._remote_conversation_url(remote_after) if remote_after.get("enabled") else ""
        self._append_log(
            "[BIND][WRITE][AFTER] "
            f"session_id={session.session_id} "
            f"new_url={new_url_after or '-'} "
            f"new_conversation_id={self._remote_conversation_id(remote_after) or '-'} "
            f"new_client_id={(remote_after.get('client_id') or '-')} "
            f"bind_state={self._remote_bind_state(remote_after) or '-'} "
            f"ok={'yes' if ok else 'no'}",
            echo=True,
        )
        if ok:
            self._save_sessions_to_disk()
            self._refresh_session_list(select_session_id=session.session_id)
            self._refresh_current_session_binding_display()
            if hasattr(self, "_update_sync_target_display"):
                self._update_sync_target_display()
            self._apply_chat_bind_visual_state()
        return ok

    def set_bound_page(
        self,
        session,
        page,
        *,
        reason="",
        silent=False,
        allow_existing_conversation_for_new_session=False,
    ):
        """统一绑定写入入口：client_id + page_instance_id + conversation_id + url。"""
        if session is None:
            self._append_log("[BIND][SET_BOUND_PAGE][SKIP] reason=session_is_none", echo=True)
            return False
        if not isinstance(page, dict):
            self._append_log(
                f"[BIND][SET_BOUND_PAGE][SKIP] session_id={session.session_id} reason=invalid_page",
                echo=True,
            )
            return False
        norm = self._normalize_tm_page_for_binding(page)
        bind_item = dict(page)
        bind_item.update(norm)
        url = (norm.get("url") or norm.get("page_url") or page_url_from(page) or "").strip()
        if url:
            bind_item["url"] = url
        self._append_log(
            "[BIND][SET_BOUND_PAGE] "
            f"session_id={session.session_id} "
            f"reason={reason or '-'} "
            f"client_id={(norm.get('client_id') or '-')} "
            f"page_instance_id={(norm.get('page_instance_id') or '-')} "
            f"conversation_id={(norm.get('conversation_id') or '-')} "
            f"url={url or '-'}",
            echo=not silent,
        )
        return self._bind_page_to_session(
            session,
            bind_item,
            silent=silent,
            allow_existing_conversation_for_new_session=allow_existing_conversation_for_new_session,
        )

    def _bind_page_to_session(
        self,
        session,
        client_info,
        silent=False,
        allow_existing_conversation_for_new_session=False,
    ):
        if not isinstance(client_info, dict):
            client_info = {
                "client_id": str(client_info or "").strip(),
                "url": "",
            }
        norm = self._normalize_tm_page_for_binding(client_info)
        if norm:
            client_info = dict(client_info)
            client_info.update(norm)
            if norm.get("url") or norm.get("page_url"):
                client_info["url"] = norm.get("url") or norm.get("page_url")
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
            or client_info.get("page_url")
            or client_info.get("conversation_url")
            or ""
        ).strip()
        conversation_id = (
            client_info.get("conversation_id")
            or parse_conversation_id(page_url)
            or ""
        ).strip()
        page_type = (client_info.get("page_type") or "").strip()
        if not page_type:
            if conversation_id:
                page_type = "conversation"
            elif page_url and self._is_bindable_chatgpt_url(page_url):
                try:
                    path = urlparse(page_url).path or "/"
                    page_type = "home" if path in ("", "/") else "conversation"
                except ValueError as exc:
                    self._append_log(
                        f"[BIND][PAGE_TYPE_PARSE_FAIL] url={page_url!r} error={exc!r}",
                        echo=True,
                    )
                    page_type = ""
        if conversation_id:
            return self._bind_conversation_to_session(
                session,
                client_info,
                silent=silent,
                allow_existing_conversation_for_new_session=allow_existing_conversation_for_new_session,
            )
        if page_type == "home" or page_type != "conversation":
            return self._prebound_home_bind_to_session(session, client_info, silent=silent)
        return self._bind_conversation_to_session(
            session,
            client_info,
            silent=silent,
            allow_existing_conversation_for_new_session=allow_existing_conversation_for_new_session,
        )
