"""External HTTP API GUI adapter (mount only when external API enabled)."""
from __future__ import annotations

import time
import traceback
import uuid

from app.server.external_api import attach_external_request_bridge, count_user_turns
from app.server import (
    complete_gui_dispatch,
    is_server_running,
    push_message,
)
from app.constants import ASSISTANT_WAIT_TEXT
from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.ui.mixins.system_hotkey_gui_mixin import SystemHotkeyGuiMixin
from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from


class ExternalApiGuiMixin(SystemHotkeyGuiMixin):
    def _handle_external_gui_dispatch(self, action_id, action, payload):
        try:
            if action == "chat_send":
                result = self._external_api_chat_send(payload or {})
            elif action == "sessions_list":
                result = self._external_api_sessions_list()
            elif action == "sessions_create":
                result = self._external_api_sessions_create(payload or {})
            elif action == "sessions_get":
                result = self._external_api_sessions_get(payload or {})
            elif action == "sessions_bind":
                result = self._external_api_sessions_bind(payload or {})
            elif action == "sessions_bind_clear":
                result = self._external_api_sessions_bind_clear(payload or {})
            elif action == "sessions_summary":
                result = self._external_api_sessions_summary()
            elif action == "system_hotkey":
                result = self._execute_system_hotkey_from_gui_payload(
                    payload or {},
                    source="external_api",
                )
            else:
                result = {
                    "ok": False,
                    "error": f"未知 action: {action}",
                    "code": "INTERNAL_ERROR",
                }
        except Exception as error:
            detail = f"{error}\n{traceback.format_exc()}"
            self._append_log(
                f"[EXTERNAL_API][ERROR] action={action} {detail}", echo=True
            )
            result = {
                "ok": False,
                "error": str(error),
                "code": "INTERNAL_ERROR",
            }
        complete_gui_dispatch(action_id, result)

    def _external_api_system_hotkey(self, payload):
        from app.server.system_hotkey import execute_system_hotkey

        combo = str((payload or {}).get("combo") or "").strip()
        if not combo:
            return {
                "ok": False,
                "error": "快捷键不能为空",
                "code": "INVALID_HOTKEY",
            }

        self._append_log(
            f"[SYSTEM_HOTKEY][EXEC] combo={combo}",
            echo=True,
        )
        result = execute_system_hotkey(combo, source="external_api")
        if result.get("ok"):
            self._append_log(
                "[SYSTEM_HOTKEY][DONE] "
                f"combo={result.get('hotkey') or combo} "
                f"keys={result.get('keys')}",
                echo=True,
            )
        else:
            self._append_log(
                "[SYSTEM_HOTKEY][FAILED] "
                f"combo={combo} "
                f"code={result.get('code') or '-'} "
                f"error={result.get('error') or '-'}",
                echo=True,
            )
        return result

    def _external_api_sessions_summary(self):
        total = 0
        bound_online = 0
        bound_offline = 0
        unbound = 0
        status = self._bridge_ui.last_bridge_status or {}
        for session in self._sessions.values():
            total += 1
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._effective_bind_state(session)
            if bind_state == BIND_STATE_UNBOUND or not remote_binding_enabled(remote):
                unbound += 1
                continue
            if bind_state == BIND_STATE_BOUND_OFFLINE:
                bound_offline += 1
                continue
            if bind_state == BIND_STATE_BOUND_CONVERSATION:
                client_id = (remote.get("client_id") or "").strip()
                online = False
                for item in status.get("pages") or []:
                    if (item.get("client_id") or "").strip() == client_id:
                        online = self._tm_page_is_online_simple(item)
                        break
                if online:
                    bound_online += 1
                else:
                    bound_offline += 1
                continue
            if bind_state == BIND_STATE_PREBOUND_HOME:
                if self._session_has_prebound_home_online(remote):
                    bound_online += 1
                else:
                    bound_offline += 1
                continue
            unbound += 1
        return {
            "ok": True,
            "summary": {
                "total": total,
                "bound_online": bound_online,
                "bound_offline": bound_offline,
                "unbound": unbound,
            },
        }

    def _external_api_sessions_list(self):
        items = []
        for session in sorted(
            self._sessions.values(),
            key=lambda s: float(s.updated_at or 0),
            reverse=True,
        ):
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            items.append(
                {
                    "session_id": session.session_id,
                    "title": session.title,
                    "updated_at": session.updated_at,
                    "bind_state": self._effective_bind_state(session),
                    "conversation_id": (remote.get("conversation_id") or "").strip(),
                    "client_id": (remote.get("client_id") or "").strip(),
                }
            )
        return {"ok": True, "sessions": items}

    def _external_api_sessions_create(self, payload):
        title = (payload.get("title") or "新对话").strip() or "新对话"
        session = self._create_session(title=title, select=False)
        session.remote_chatgpt = default_remote_chatgpt()
        self._schedule_save_sessions_to_disk()
        return {"ok": True, "session": self._external_session_payload(session)}

    def _external_api_sessions_get(self, payload):
        session_id = (payload.get("session_id") or "").strip()
        session = self._sessions.get(session_id)
        if not session:
            return {
                "ok": False,
                "error": "会话不存在",
                "code": "SESSION_NOT_FOUND",
            }
        return {"ok": True, "session": self._external_session_payload(session)}

    def _external_session_payload(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        return {
            "session_id": session.session_id,
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "bind_state": self._effective_bind_state(session),
            "remote_chatgpt": dict(remote),
        }

    def _external_api_sessions_bind(self, payload):
        session_id = (payload.get("session_id") or "").strip()
        session = self._sessions.get(session_id)
        if not session:
            return {
                "ok": False,
                "error": "会话不存在",
                "code": "SESSION_NOT_FOUND",
            }
        client_id = (payload.get("client_id") or "").strip()
        page_url = page_url_from(payload)
        conversation_id = (payload.get("conversation_id") or "").strip()
        page_instance_id = (payload.get("page_instance_id") or "").strip()
        if not conversation_id and page_url:
            conversation_id = parse_conversation_id(page_url) or ""
        if not page_url and conversation_id:
            page_url = f"https://chatgpt.com/c/{conversation_id}"
        if not any([client_id, page_url, conversation_id, page_instance_id]):
            return {
                "ok": False,
                "error": "缺少页面身份信息（client_id / url / conversation_id / page_instance_id）",
                "code": "EMPTY_TEXT",
            }
        client_info = None
        if client_id:
            client_info = self._client_info_from_status(client_id)
        if not isinstance(client_info, dict):
            client_info = {}
        client_info["client_id"] = client_id
        if page_url:
            client_info["url"] = page_url
        if conversation_id:
            client_info["conversation_id"] = conversation_id
        if page_instance_id:
            client_info["page_instance_id"] = page_instance_id
        bindable, bind_reason = self._tm_client_bindable(client_info)
        if not bindable:
            return {
                "ok": False,
                "error": bind_reason or "无法识别绑定页面",
                "code": "INVALID_BIND_TARGET",
            }
        if not self.set_bound_page(
            session, client_info, reason="bridge_bind_target", silent=True
        ):
            return {
                "ok": False,
                "error": "绑定失败",
                "code": "BIND_FAILED",
            }
        self._schedule_save_sessions_to_disk()
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        return {
            "ok": True,
            "session_id": session.session_id,
            "bound": {
                "client_id": (remote.get("client_id") or "").strip(),
                "page_instance_id": (remote.get("page_instance_id") or "").strip(),
                "conversation_id": self._remote_conversation_id(remote),
                "url": (page_url_from(remote) or page_url or "").strip(),
            },
            "session": self._external_session_payload(session),
        }

    def _external_api_sessions_bind_clear(self, payload):
        session_id = (payload.get("session_id") or "").strip()
        session = self._sessions.get(session_id)
        if not session:
            return {
                "ok": False,
                "error": "会话不存在",
                "code": "SESSION_NOT_FOUND",
            }
        reason = (payload.get("reason") or "api_clear").strip()
        if hasattr(self, "_clear_session_binding"):
            self._clear_session_binding(session_id, reason=reason)
        else:
            session.remote_chatgpt = default_remote_chatgpt()
            self._schedule_save_sessions_to_disk()
        if hasattr(self, "_clear_pending_web_sync_for_session"):
            self._clear_pending_web_sync_for_session(session_id)
        if session_id == getattr(self, "_current_session_id", ""):
            if hasattr(self, "_refresh_current_session_binding_display"):
                self._refresh_current_session_binding_display()
        return {
            "ok": True,
            "session_id": session_id,
            "bind_state": BIND_STATE_UNBOUND,
            "session": self._external_session_payload(session),
        }

    def _resolve_external_chat_session(self, payload):
        session_id = (payload.get("session_id") or "").strip()
        new_session = bool(payload.get("new_session", False))
        reuse_last_session = bool(payload.get("reuse_last_session", True))
        auto_create_session = bool(payload.get("auto_create_session", True))
        client_name = (payload.get("client_name") or "default").strip() or "default"
        force_limit = int(payload.get("force_new_session_after_turns") or 0)
        if force_limit <= 0:
            force_limit = int(getattr(self, "_force_new_session_after_turns", 0) or 0)

        session_meta = {
            "new_session_created": False,
            "new_session_reason": "",
            "previous_session_id": "",
            "previous_turn_count": 0,
            "force_new_session_after_turns": force_limit,
        }

        if not hasattr(self, "_external_client_last_session"):
            self._external_client_last_session = {}

        def should_force_new(session):
            if force_limit <= 0 or session is None:
                return False
            return count_user_turns(session) >= force_limit

        def finish_force_new(previous_session):
            prev_count = count_user_turns(previous_session)
            session = self._create_session(select=False)
            session.remote_chatgpt = default_remote_chatgpt()
            self._external_client_last_session[client_name] = session.session_id
            session_meta["new_session_created"] = True
            session_meta["new_session_reason"] = "force_new_session_after_turns"
            session_meta["previous_session_id"] = previous_session.session_id
            session_meta["previous_turn_count"] = prev_count
            self._append_session_message(
                previous_session,
                "system",
                "当前会话已达到消息数量上限，后续外部客户端消息将进入新会话。",
            )
            self._append_session_message(
                session,
                "system",
                "已达到当前会话的消息数量上限，已自动创建新的 ChatGPT 对话。",
            )
            self._append_log(
                f"[EXTERNAL_API][FORCE_NEW_SESSION] client_name={client_name} "
                f"previous_session_id={previous_session.session_id} "
                f"previous_turn_count={prev_count} limit={force_limit} "
                f"new_session_id={session.session_id}",
                echo=True,
            )
            self._schedule_save_sessions_to_disk()
            return session

        if new_session:
            session = self._create_session(select=False)
            session.remote_chatgpt = default_remote_chatgpt()
            self._external_client_last_session[client_name] = session.session_id
            session_meta["new_session_created"] = True
            session_meta["new_session_reason"] = "new_session"
            self._schedule_save_sessions_to_disk()
            return session, session_meta

        if session_id:
            session = self._sessions.get(session_id)
            if session is not None:
                if should_force_new(session):
                    return finish_force_new(session), session_meta
                self._external_client_last_session[client_name] = session.session_id
                return session, session_meta
            if not auto_create_session:
                return None, session_meta
            self._append_log(
                f"[EXTERNAL_API] session_id={session_id} 不存在，"
                f"client_name={client_name}，将自动创建新会话",
                echo=True,
            )

        if reuse_last_session:
            last_id = (self._external_client_last_session.get(client_name) or "").strip()
            if last_id:
                session = self._sessions.get(last_id)
                if session is not None:
                    if should_force_new(session):
                        return finish_force_new(session), session_meta
                    return session, session_meta

        if auto_create_session:
            session = self._create_session(select=False)
            session.remote_chatgpt = default_remote_chatgpt()
            self._external_client_last_session[client_name] = session.session_id
            session_meta["new_session_created"] = True
            session_meta["new_session_reason"] = "auto_create"
            self._schedule_save_sessions_to_disk()
            return session, session_meta

        return None, session_meta

    def _external_enqueue_pending_message_response(
        self,
        session,
        text,
        session_meta,
        *,
        error_message,
    ):
        queued = self._enqueue_user_message_for_session(session, text)
        if not queued:
            return {
                "ok": False,
                "error": error_message,
                "code": "INTERNAL_ERROR",
            }

        queue = self._session_send_queue(session.session_id)
        queued_id = ""
        if queue:
            queued_id = (queue[-1].get("message_id") or "").strip()

        return {
            "ok": True,
            "session_id": session.session_id,
            "pending_home": False,
            "pending_queued": True,
            "queued_message_id": queued_id,
            "bridge_message_id": "",
            "turn_id": "",
            **session_meta,
        }

    def _build_bridge_send_payload(
        self,
        *,
        session,
        turn_id,
        content,
        raw_content="",
        target_client_id,
        url,
        page_instance_id="",
        conversation_id="",
        is_bootstrap=False,
        trace_id="",
        target_source="",
        allow_same_conversation_fallback=False,
    ):
        return self._compose_send_payload(
            session,
            turn_id=turn_id,
            content=content or raw_content,
            client_id=target_client_id,
            url=url,
            page_instance_id=page_instance_id,
            conversation_id=conversation_id,
            target_source=target_source,
            bootstrap_conversation=is_bootstrap,
            trace_id=trace_id,
            allow_same_conversation_fallback=allow_same_conversation_fallback,
        )

    def _external_api_chat_send(self, payload):
        if not is_server_running():
            return {
                "ok": False,
                "error": "服务未启动",
                "code": "INTERNAL_ERROR",
            }
        text = (payload.get("content") or "").strip()
        if not text:
            return {"ok": False, "error": "content 不能为空", "code": "EMPTY_TEXT"}

        auto_open_home = bool(payload.get("auto_open_home", True))

        session, session_meta = self._resolve_external_chat_session(payload)
        if session is None:
            session_id = (payload.get("session_id") or "").strip()
            if session_id or not bool(payload.get("auto_create_session", True)):
                return {
                    "ok": False,
                    "error": "会话不存在",
                    "code": "SESSION_NOT_FOUND",
                }
            return {
                "ok": False,
                "error": "无法解析会话",
                "code": "SESSION_NOT_FOUND",
            }

        busy_reason = self._session_send_busy_reason(session)
        if busy_reason:
            return self._external_enqueue_pending_message_response(
                session,
                text,
                session_meta,
                error_message="消息入队失败",
            )
        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            return self._external_enqueue_pending_message_response(
                session,
                text,
                session_meta,
                error_message=response_msg,
            )

        if self._bind_each_chat_to_page:
            reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                session, text
            )
            if reopen_result is False:
                return {
                    "ok": True,
                    "session_id": session.session_id,
                    "pending_bound_reopen": True,
                    "bridge_message_id": "",
                    "turn_id": "",
                    **session_meta,
                }

        if self._bind_each_chat_to_page and self._session_needs_first_message_bind(
            session
        ):
            if not auto_open_home:
                reusable_home = None
                if hasattr(self, "_find_reusable_chatgpt_home_page_for_session"):
                    reusable_home = self._find_reusable_chatgpt_home_page_for_session(
                        session
                    )
                idle_home = reusable_home or self._find_idle_chatgpt_home_client(
                    session_id=session.session_id
                )
                if not idle_home and not self._session_has_sendable_bound_page(
                    normalize_remote_chatgpt(session.remote_chatgpt)
                ):
                    return {
                        "ok": False,
                        "error": "没有可用的 ChatGPT 页面",
                        "code": "NO_AVAILABLE_CHATGPT_PAGE",
                    }
            ready, reason = self._prepare_first_message_binding(session, text)
            if not ready:
                if reason == "__WAITING_HOME_PENDING__":
                    return {
                        "ok": True,
                        "session_id": session.session_id,
                        "pending_home": True,
                        "bridge_message_id": "",
                        "turn_id": "",
                        **session_meta,
                    }
                return {
                    "ok": False,
                    "error": reason or "绑定首页失败",
                    "code": "NO_AVAILABLE_CHATGPT_PAGE",
                }

        send_result = self._external_push_message_text(session, text)
        if not send_result.get("ok"):
            return send_result
        self._external_client_last_session[
            (payload.get("client_name") or "default").strip() or "default"
        ] = session.session_id
        return {
            "ok": True,
            "session_id": session.session_id,
            "bridge_message_id": send_result.get("bridge_message_id") or "",
            "turn_id": send_result.get("turn_id") or "",
            "pending_home": False,
            **session_meta,
        }

    def _external_push_message_text(self, session, content):
        content_text = content.strip()
        if not content_text:
            return {"ok": False, "error": "text 为空", "code": "EMPTY_TEXT"}

        turn_id = str(uuid.uuid4())
        user_message_id = str(uuid.uuid4())
        assistant_message_id = str(uuid.uuid4())
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)
        is_bootstrap = bind_state == BIND_STATE_PREBOUND_HOME

        prereq_ok, prereq_reason = self._check_tm_send_prerequisites(session)
        if not prereq_ok:
            code = "BIND_PAGE_OFFLINE"
            if "离线" in prereq_reason or "未连接" in prereq_reason:
                code = "BIND_PAGE_OFFLINE"
            elif "没有" in prereq_reason or "未找到" in prereq_reason:
                code = "NO_AVAILABLE_CHATGPT_PAGE"
            return {"ok": False, "error": prereq_reason, "code": code}

        self._rebind_current_session_to_online_client_if_needed()
        target_client_id, target_page_url, allowed, reason = (
            self._resolve_target_page_for_session(session)
        )
        if not allowed:
            code = "BIND_PAGE_OFFLINE"
            if "未找到" in (reason or "") or "没有" in (reason or ""):
                code = "NO_AVAILABLE_CHATGPT_PAGE"
            return {"ok": False, "error": reason or "无法解析发送目标", "code": code}

        target_client_id, target_page_url, allowed, verify_reason = (
            self._verify_send_target_binding(
                session, target_client_id, target_page_url
            )
        )
        if not allowed:
            return {
                "ok": False,
                "error": verify_reason or "发送前绑定校验失败",
                "code": "BIND_PAGE_OFFLINE",
            }

        payload = self._build_bridge_send_payload(
            session=session,
            turn_id=turn_id,
            content=content_text,
            target_client_id=target_client_id,
            url=target_page_url,
            page_instance_id=(remote.get("page_instance_id") or "").strip(),
            conversation_id=(remote.get("conversation_id") or "").strip(),
            is_bootstrap=is_bootstrap,
        )

        try:
            msg = push_message(payload)
        except Exception as error:
            detail = f"消息入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            return {
                "ok": False,
                "error": str(error),
                "code": "INTERNAL_ERROR",
            }

        bridge_message_id = (
            (msg.get("message_id") or "").strip()
            if isinstance(msg, dict)
            else ""
        )
        if not bridge_message_id:
            return {
                "ok": False,
                "error": "服务端未返回 bridge_message_id",
                "code": "INTERNAL_ERROR",
            }

        attach_external_request_bridge(
            session.session_id, bridge_message_id, turn_id
        )
        self._message_to_session[bridge_message_id] = session.session_id
        self._message_to_turn[bridge_message_id] = turn_id
        if is_bootstrap:
            from app.utils.bind_runtime import update_bind_runtime

            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
            session.remote_chatgpt = {
                **remote_now,
                "bind_state": BIND_STATE_WAITING_CONVERSATION_CREATED,
                "client_id": (payload.get("client_id") or "").strip()
                or (remote_now.get("client_id") or ""),
                "page_instance_id": (payload.get("page_instance_id") or "").strip()
                or (remote_now.get("page_instance_id") or ""),
            }
            update_bind_runtime(
                self,
                session,
                bootstrap_in_progress=True,
                bootstrap_message_id=bridge_message_id,
                bootstrap_started_at=time.time(),
            )
            session.updated_at = time.time()
        self._append_session_message(
            session,
            "user",
            content_text,
            message_id=user_message_id,
            turn_id=turn_id,
            bridge_message_id=bridge_message_id,
            status="已加入队列",
        )
        if self._show_assistant_placeholder:
            self._append_session_message(
                session,
                "assistant",
                ASSISTANT_WAIT_TEXT,
                message_id=assistant_message_id,
                turn_id=turn_id,
                bridge_message_id=bridge_message_id,
                parent_message_id=user_message_id,
                status="等待中",
            )
        session.has_pending_reply = True
        session.pending_reply_since = time.time()
        if hasattr(self, "_mark_session_waiting_started"):
            self._mark_session_waiting_started(session, reason="bootstrap_queued")
        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()
        return {
            "ok": True,
            "bridge_message_id": bridge_message_id,
            "turn_id": turn_id,
        }

