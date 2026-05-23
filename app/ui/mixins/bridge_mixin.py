from app.server.external_api import attach_external_request_bridge
from app.server import (
    cancel_message,
    complete_gui_dispatch,
    enqueue_control_command,
    get_bridge_status,
    get_message_state,
    get_server_port,
    get_server_public_host,
    get_server_url,
    get_tm_online_summary,
    is_server_running,
    push_close_other_pages,
    push_close_page,
    push_message,
    push_open_url,
    set_debug_mode,
    set_external_gui_dispatch,
    set_log_callback,
    set_status_callback,
    start_server,
    stop_server,
)

import time
import traceback
import uuid

from app.utils.log_utils import append_log

from PyQt5.QtWidgets import QFileDialog

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
    PENDING_ASSISTANT_STATUSES,
)
from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_HOME,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.ui.status_scheduler import StatusScheduler
from app.utils.bridge_payload import build_gui_push_payload
from app.utils.page_status import page_url_from, read_snapshot_identity
from app.utils.trace_log import kv_line, make_send_trace_id
from app.utils.page_status import bridge_status_online
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import (
    QApplication,
    QTableWidgetItem,
)


class BridgeMixin:
    @staticmethod
    def _normalize_enqueue_result(enqueue_result):
        """统一解析 enqueue_control_command 返回值（结构化 / 裸 msg / 旧 bool）。"""
        if isinstance(enqueue_result, dict):
            if "ok" in enqueue_result:
                ok = bool(enqueue_result.get("ok"))
                msg = enqueue_result.get("message")
                if not isinstance(msg, dict) and enqueue_result.get("message_id"):
                    msg = enqueue_result
                reason = (enqueue_result.get("reason") or "").strip()
                return ok, msg, reason
            if enqueue_result.get("message_id") and enqueue_result.get("command"):
                return True, enqueue_result, ""
            return bool(enqueue_result), enqueue_result, ""
        return bool(enqueue_result), enqueue_result, ""

    def enqueue_page_command(self, session, command, payload=None):
        """统一页面命令入队：先 resolve_page_command_target，再 enqueue_control_command。"""
        from app.utils.page_command import resolve_page_command_target
        from app.utils.page_status import PageRegistry

        command = (command or "").strip()
        registry = getattr(self, "page_registry", None)
        if not isinstance(registry, PageRegistry):
            status = self._bridge_ui.last_bridge_status or {}
            if is_server_running() and not status:
                status = get_bridge_status() or {}
            registry = PageRegistry.from_bridge_status(status)

        target = resolve_page_command_target(session, command, registry)
        log_fn = getattr(self, "safe_log", None) or self._append_log
        log_fn(
            "[PAGE_COMMAND][TARGET] "
            f"command={command} "
            f"ok={'yes' if target.get('ok') else 'no'} "
            f"reason_code={target.get('reason_code') or '-'} "
            f"client_id={target.get('client_id') or '-'} "
            f"page_instance_id={target.get('page_instance_id') or '-'}",
            echo=False,
        )
        if not target.get("ok"):
            return {
                "ok": False,
                "message_id": "",
                "command": command,
                "target": target,
                "reason_code": target.get("reason_code") or target.get("reason") or "",
            }

        body = dict(payload) if isinstance(payload, dict) else {}
        body["url"] = target.get("url") or ""
        enqueue_result = enqueue_control_command(
            command=command,
            client_id=target.get("client_id") or "",
            page_instance_id=target.get("page_instance_id") or "",
            conversation_id=target.get("conversation_id") or "",
            payload=body,
        )
        ok, msg, enqueue_reason = self._normalize_enqueue_result(enqueue_result)
        message_id = ""
        if isinstance(msg, dict):
            message_id = (msg.get("message_id") or "").strip()
        if ok and not message_id:
            ok = False
            enqueue_reason = enqueue_reason or "missing_message_id"
        if ok:
            log_fn(
                "[PAGE_COMMAND][ENQUEUE_OK] "
                f"command={command} message_id={message_id}",
                echo=True,
            )
        else:
            log_fn(
                "[PAGE_COMMAND][ENQUEUE_FAILED] "
                f"command={command} reason={enqueue_reason or '-'}",
                echo=True,
                level="WARNING",
            )
        return {
            "ok": ok,
            "message_id": message_id,
            "command": command,
            "target": target,
            "reason": enqueue_reason or "",
        }

    STATUS_SCHEDULER_INTERVAL_MS = 150
    LIGHTWEIGHT_STATUS_REASONS = frozenset({
        "heartbeat",
        "poll",
        "poll_request",
        "poll_no_message",
        "activity_classify",
        "queue_empty",
        "client_busy",
        "status_timer",
        "status_signal",
        "deferred_bridge_status",
    })
    def _enqueue_upload_then_send_command(
        self,
        session,
        payload,
        target_client_id,
    ):
        target_client_id = (target_client_id or "").strip()
        if not target_client_id:
            self._append_log(
                "[UPLOAD_THEN_SEND][SKIP] reason=empty_target_client_id",
                echo=True,
            )
            return False

        target_page_instance_id = (
            (payload.get("page_instance_id") or "").strip()
        )
        target_conversation_id = (
            (payload.get("conversation_id") or "").strip()
        )

        enqueue_result = enqueue_control_command(
            command="start_upload",
            client_id=target_client_id,
            page_instance_id=target_page_instance_id,
            conversation_id=target_conversation_id,
            payload={
                "source": "gui-send-before-message",
                "session_id": session.session_id if session else "",
                "turn_id": payload.get("turn_id") or "",
                "require_all_success": True,
                "block_next_chat_on_failed": True,
            },
        )
        queued, queued_msg, enqueue_reason = self._normalize_enqueue_result(
            enqueue_result
        )

        if not queued:
            self._append_log(
                "[UPLOAD_BEFORE_SEND][FAILED] reason=enqueue_failed "
                f"enqueue_reason={enqueue_reason or '-'} "
                f"session_id={(session.session_id if session else '-')} "
                f"client_id={target_client_id or '-'} "
                f"page_instance_id={target_page_instance_id or '-'} "
                f"conversation_id={target_conversation_id or '-'}",
                echo=True,
            )
            return False

        message_id = ""
        if isinstance(queued_msg, dict):
            message_id = (
                (queued_msg.get("message_id") or "") or ""
            ).strip()
        if not message_id and isinstance(enqueue_result, dict):
            message_id = (enqueue_result.get("message_id") or "").strip()

        self._append_log(
            "[TM_CONTROL][START_UPLOAD][QUEUE] "
            f"target_client_id={target_client_id or '-'} "
            "command=start_upload "
            f"session_id={(session.session_id if session else '-')} "
            f"page_instance_id={target_page_instance_id or '-'} "
            f"conversation_id={target_conversation_id or '-'} "
            f"command_message_id={message_id or '-'}",
            echo=True,
        )

        if not message_id:
            self._append_log(
                "[UPLOAD_THEN_SEND][WARN] reason=missing_command_message_id",
                echo=True,
            )
            return False
        if hasattr(self, "start_page_command"):
            self.start_page_command(
                "start_upload",
                payload={"message_id": message_id},
            )
        return message_id

    def _pop_pending_upload_send(self, control_message_id):
        key = str(control_message_id or "").strip()
        if not key:
            return None
        store = getattr(self, "_bridge_msg", None)
        if store is None:
            return None
        return store.pending_upload_sends.pop(key, None)

    def _read_bridge_queue_length(
        self,
        *,
        trace_id="",
        session_id="",
        message_id="",
        target_client="",
        target_conv="",
        warn_tag="",
        reason="",
    ):
        if not is_server_running():
            return 0
        try:
            return int((get_bridge_status() or {}).get("queue_length") or 0)
        except Exception as exc:
            self._append_log(
                f"{warn_tag} "
                + kv_line(
                    trace_id=trace_id or "-",
                    session_id=session_id or "-",
                    message_id=message_id or "-",
                    target_client=target_client,
                    target_conv=target_conv,
                    reason=reason,
                    error_type=type(exc).__name__,
                    error=str(exc),
                )
                + f"\n{traceback.format_exc()}",
                echo=True,
            )
            return -1

    def _register_pending_send_request(
        self,
        bridge_message_id,
        *,
        session_id,
        turn_id,
        user_message_id,
        assistant_message_id,
    ):
        attach_external_request_bridge(session_id, bridge_message_id, turn_id)
        self._message_to_session[bridge_message_id] = session_id
        self._message_to_turn[bridge_message_id] = turn_id
        pending_sends = getattr(self, "_pending_send_requests", None)
        if pending_sends is None:
            pending_sends = {}
            self._bridge_msg.pending_send_requests = pending_sends
        pending_sends[bridge_message_id] = {
            "session_id": session_id,
            "turn_id": turn_id,
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "created_at": time.time(),
        }

    _PENDING_ENVELOPE_KEYS = frozenset(
        {
            "payload",
            "content",
            "raw_content",
            "turn_id",
            "user_message_id",
            "assistant_message_id",
            "reuse_user_message_id",
            "from_pending_bootstrap",
            "source",
            "suppress_system_message",
            "refresh_send_target",
        }
    )

    def _prepare_chat_send_from_pending(self, session, pending):
        """从 pending 解析发送上下文（不改 payload 入队顺序）。"""
        from app.utils.legacy_cleanup import LEGACY_FIELD_NAMES

        pending = pending if isinstance(pending, dict) else {}
        envelope_legacy = sorted(
            k
            for k in pending.keys()
            if k in LEGACY_FIELD_NAMES and k not in self._PENDING_ENVELOPE_KEYS
        )
        if envelope_legacy:
            raise ValueError(f"legacy fields in pending: {envelope_legacy}")
        payload = dict(pending.get("payload") or {})
        payload_legacy = sorted(set(payload.keys()) & LEGACY_FIELD_NAMES)
        if payload_legacy:
            raise ValueError(f"legacy fields in pending payload: {payload_legacy}")
        if pending.get("refresh_send_target"):
            for drop_key in ("client_id", "page_instance_id", "conversation_id", "url"):
                payload.pop(drop_key, None)
        raw_content = (pending.get("content") or pending.get("raw_content") or "").strip()
        turn_id = (pending.get("turn_id") or "").strip()
        user_message_id = (pending.get("user_message_id") or "").strip()
        assistant_message_id = (pending.get("assistant_message_id") or "").strip()
        reuse_user_message_id = (pending.get("reuse_user_message_id") or "").strip()
        from_pending_bootstrap = bool(pending.get("from_pending_bootstrap"))
        message_source = (pending.get("source") or "direct").strip()
        suppress_system_message = bool(pending.get("suppress_system_message"))
        bind_state = self._effective_bind_state(session)
        is_bootstrap = bind_state == BIND_STATE_PREBOUND_HOME
        existing_user_message = self._find_session_message_by_id(
            session, reuse_user_message_id
        )
        trace_id = (
            payload.get("trace_id")
            or (
                self._get_active_send_trace_id()
                if hasattr(self, "_get_active_send_trace_id")
                else ""
            )
            or ""
        ).strip()
        return {
            "payload": payload,
            "content": raw_content,
            "raw_content": raw_content,
            "turn_id": turn_id,
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "reuse_user_message_id": reuse_user_message_id,
            "from_pending_bootstrap": from_pending_bootstrap,
            "source": message_source,
            "suppress_system_message": suppress_system_message,
            "is_bootstrap": is_bootstrap,
            "existing_user_message": existing_user_message,
            "trace_id": trace_id,
        }

    def _patch_chat_send_target_payload(self, session, payload):
        """入队前校验 target 字段。

        正式对话页必须有 conversation_id。
        临时首页绑定 / bootstrap 首条发送不要求 conversation_id。
        """
        from app.models import is_temp_home_bound_state

        payload = payload if isinstance(payload, dict) else {}
        remote = normalize_remote_chatgpt(
            getattr(session, "remote_chatgpt", None) or {}
        )
        raw_bind_state = str(remote.get("bind_state") or "").strip()
        effective_bind_state = ""
        if hasattr(self, "_effective_bind_state"):
            effective_bind_state = str(self._effective_bind_state(session) or "").strip()

        bootstrap = bool(payload.get("bootstrap_conversation"))
        is_temp_home = (
            bootstrap
            or is_temp_home_bound_state(raw_bind_state)
            or is_temp_home_bound_state(effective_bind_state)
        )

        client_id = str(payload.get("client_id") or "").strip()
        page_instance_id = str(payload.get("page_instance_id") or "").strip()
        conversation_id = str(payload.get("conversation_id") or "").strip()
        target_page_id = str(
            payload.get("target_page_id")
            or remote.get("target_page_id")
            or remote.get("temp_page_id")
            or remote.get("page_display_id")
            or getattr(session, "bound_page_id", None)
            or ""
        ).strip()
        url = page_url_from(payload) or str(
            payload.get("url") or payload.get("conversation_url") or ""
        ).strip()

        missing = []

        if not client_id:
            missing.append("client_id")
        if not page_instance_id:
            missing.append("page_instance_id")
        if not url:
            missing.append("url")

        if is_temp_home:
            if not target_page_id:
                missing.append("target_page_id")

            payload["bootstrap_conversation"] = True
            payload["target_page_id"] = target_page_id
            payload["conversation_id"] = ""
            payload["url"] = url or "https://chatgpt.com/"
            mode = "temp_home"
        else:
            if not conversation_id:
                missing.append("conversation_id")

            payload["bootstrap_conversation"] = False
            payload["conversation_id"] = conversation_id
            mode = "conversation"

        if missing:
            self._append_log(
                "[SEND][PATCH_TARGET][FAIL] "
                f"mode={mode} "
                f"missing_fields={','.join(missing)} "
                f"bind_state={raw_bind_state or '-'} "
                f"effective_bind_state={effective_bind_state or '-'} "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'} "
                f"target_page_id={target_page_id or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"url={url or '-'}",
                echo=True,
            )
            return False

        self._append_log(
            "[SEND][PATCH_TARGET][OK] "
            f"mode={mode} "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"target_page_id={target_page_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"url={payload.get('url') or '-'} "
            f"bootstrap={'true' if payload.get('bootstrap_conversation') else 'false'}",
            echo=True,
        )
        return True

    def _log_chat_queue_event(self, tag, *, trace_id="-", **fields):
        self._append_log(
            tag + " " + kv_line(trace_id=trace_id or "-", **fields),
            echo=True,
        )

    def _execute_queued_chat_send(self, session, pending):
        """上传成功后：将暂存的聊天 payload 入队并更新会话 UI。"""
        try:
            return self._execute_queued_chat_send_impl(session, pending)
        finally:
            if hasattr(self, "dump_top_level_windows"):
                self.dump_top_level_windows("after_queue_process")

    def _execute_queued_chat_send_impl(self, session, pending):
        ctx = self._prepare_chat_send_from_pending(session, pending)
        payload = ctx["payload"]
        raw_content = ctx["content"]
        turn_id = ctx["turn_id"]
        user_message_id = ctx["user_message_id"]
        assistant_message_id = ctx["assistant_message_id"]
        reuse_user_message_id = ctx["reuse_user_message_id"]
        from_pending_bootstrap = ctx["from_pending_bootstrap"]
        message_source = ctx["source"]
        suppress_system_message = ctx["suppress_system_message"]
        is_bootstrap = ctx["is_bootstrap"]
        existing_user_message = ctx["existing_user_message"]
        trace_id = ctx["trace_id"]

        target_client = (payload.get("client_id") or "").strip() or "-"
        target_conv = (payload.get("conversation_id") or "").strip() or "-"
        queue_before = self._read_bridge_queue_length(
            trace_id=trace_id,
            session_id=session.session_id,
            message_id=user_message_id,
            target_client=target_client,
            target_conv=target_conv,
            warn_tag="[CHAT_QUEUE][BEFORE_PUT][WARN]",
            reason="queue_before_read_failed",
        )
        self._log_chat_queue_event(
            "[CHAT_QUEUE][BEFORE_PUT]",
            trace_id=trace_id,
            target_client=target_client,
            target_conv=target_conv,
            text_len=len(raw_content),
            queue_before=queue_before,
        )
        self._append_log(
            "[SEND_EXEC] "
            f"session_id={session.session_id} "
            f"message_id={user_message_id or '-'} "
            f"message_source={message_source} "
            f"text_len={len(raw_content)} "
            f"target_client={target_client} "
            f"target_conv={target_conv}",
            echo=True,
        )
        if hasattr(self, "dump_top_level_windows"):
            self.dump_top_level_windows("before_queue_process")
        from app.utils.gui_bridge_json_log import log_gui_send_payload_full

        log_gui_send_payload_full(
            trace_id=trace_id,
            session_id=session.session_id,
            turn_id=turn_id,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
            payload=payload,
        )
        try:
            msg = push_message(payload)
        except Exception as error:
            detail = traceback.format_exc()
            self._append_log(
                "[CHAT_QUEUE][PUT_FAIL] "
                + kv_line(
                    trace_id=trace_id or "-",
                    reason="push_message_exception",
                    exception=repr(error),
                    target_client=target_client,
                    target_conv=target_conv,
                )
                + f"\n{detail}",
                echo=True,
            )
            if not suppress_system_message:
                self._add_system_message(f"消息入队失败：{error}")
            return {"ok": False, "reason": str(error), "retryable": False}

        self._patch_chat_send_target_payload(session, payload)

        bridge_message_id = (
            (msg.get("message_id") or "").strip()
            if isinstance(msg, dict)
            else None
        )
        queue_after = self._read_bridge_queue_length(
            trace_id=trace_id,
            session_id=session.session_id,
            message_id=user_message_id,
            target_client=target_client,
            target_conv=target_conv,
            warn_tag="[CHAT_QUEUE][PUT_OK][WARN]",
            reason="queue_after_read_failed",
        )
        if not bridge_message_id:
            self._append_log(
                "[CHAT_QUEUE][PUT_FAIL] "
                + kv_line(
                    trace_id=trace_id or "-",
                    reason="missing_bridge_message_id",
                    target_client=target_client,
                    target_conv=target_conv,
                ),
                echo=True,
            )
            if not suppress_system_message:
                self._add_system_message("服务端未返回 bridge_message_id，无法跟踪回复。")
            return {
                "ok": False,
                "reason": "missing_bridge_message_id",
                "retryable": False,
            }
        self._log_chat_queue_event(
            "[CHAT_QUEUE][PUT_OK]",
            trace_id=trace_id,
            message_id=bridge_message_id,
            target_client=target_client,
            target_conv=target_conv,
            queue_after=queue_after,
        )

        self._register_pending_send_request(
            bridge_message_id,
            session_id=session.session_id,
            turn_id=turn_id,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
        )

        if is_bootstrap:
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
            target_client = (payload.get("client_id") or "").strip()
            target_instance = (payload.get("page_instance_id") or "").strip()
            session.remote_chatgpt = {
                **remote_now,
                "bind_state": BIND_STATE_WAITING_CONVERSATION_CREATED,
                "bootstrap_in_progress": True,
                "bootstrap_message_id": bridge_message_id,
                "bootstrap_started_at": time.time(),
                "client_id": target_client or (remote_now.get("client_id") or ""),
                "page_instance_id": target_instance
                or (remote_now.get("page_instance_id") or ""),
            }
            session.updated_at = time.time()
            self._append_log(
                "[SEND][BOOTSTRAP_START] "
                f"session_id={session.session_id} "
                f"bridge_message_id={bridge_message_id} "
                f"client_id={target_client or '-'} "
                f"page_instance_id={target_instance or '-'}"
            )
            self._append_log(
                f"[BIND][WAITING_CONVERSATION_CREATED] session_id={session.session_id} "
                f"bridge_message_id={bridge_message_id}"
            )

        if self._auto_name_new_chat and session.title == "新对话":
            session.title = raw_content[:20] + (
                "…" if len(raw_content) > 20 else ""
            )

        count_before_enqueue = self._session_visible_message_count(session)
        if existing_user_message is not None:
            existing_user_message.bridge_message_id = bridge_message_id
            existing_user_message.turn_id = turn_id
            existing_user_message.ui_status = "sending"
            existing_user_message.content = raw_content
            session.updated_at = time.time()
            count_after_enqueue = self._session_visible_message_count(session)
            self._append_log(
                "[CHAT_SEND][LOCAL_APPEND_AFTER] "
                f"session_id={session.session_id} "
                f"count_before={count_before_enqueue} "
                f"count_after={count_after_enqueue} "
                f"request_id={bridge_message_id} "
                f"reused_user_message_id={user_message_id}",
                echo=True,
            )
            self._append_log(
                "[CHAT_SEND][ENQUEUED] "
                f"request_id={bridge_message_id} "
                f"session_id={session.session_id} "
                f"message_id={user_message_id} "
                f"turn_id={turn_id}",
                echo=True,
            )
        else:
            self._append_log(
                "[CHAT_SEND][LOCAL_APPEND_BEFORE] "
                f"session_id={session.session_id} "
                f"count_before={count_before_enqueue} "
                f"request_id={bridge_message_id}",
                echo=True,
            )
            appended = self._append_message_to_session(
                session.session_id,
                {
                    "role": "user",
                    "content": raw_content,
                    "message_id": user_message_id,
                    "turn_id": turn_id,
                    "bridge_message_id": bridge_message_id,
                    "request_id": bridge_message_id,
                    "status": "sending",
                    "source": "local_send",
                },
            )
            count_after_enqueue = self._session_visible_message_count(session)
            self._append_log(
                "[CHAT_SEND][LOCAL_APPEND_AFTER] "
                f"session_id={session.session_id} "
                f"count_before={count_before_enqueue} "
                f"count_after={count_after_enqueue} "
                f"request_id={bridge_message_id} "
                f"appended={'true' if appended else 'false'}",
                echo=True,
            )
            self._append_log(
                "[CHAT_SEND][ENQUEUED] "
                f"request_id={bridge_message_id} "
                f"session_id={session.session_id} "
                f"message_id={user_message_id} "
                f"turn_id={turn_id}",
                echo=True,
            )

        if self._show_assistant_placeholder:
            existing_assistant = self._find_assistant_by_turn(session, turn_id)
            if existing_assistant is None:
                self._append_message_to_session(
                    session.session_id,
                    {
                        "role": "assistant",
                        "content": ASSISTANT_WAIT_TEXT,
                        "message_id": assistant_message_id,
                        "turn_id": turn_id,
                        "bridge_message_id": bridge_message_id,
                        "parent_message_id": user_message_id,
                        "status": "waiting",
                        "source": "local_placeholder",
                    },
                )
            else:
                existing_assistant.bridge_message_id = bridge_message_id
                existing_assistant.ui_status = "waiting"
                existing_assistant.content = ASSISTANT_WAIT_TEXT

        session.has_pending_reply = True
        session.reply_waiting_since = time.time()
        if hasattr(self, "_mark_session_waiting_started"):
            self._mark_session_waiting_started(session, reason="send_queued")
        self._refresh_session_list(select_session_id=session.session_id)
        if hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=True,
                reason="chat_send_enqueued",
            )
        else:
            self._render_session_chat(session, force_bottom=True)
        self._save_sessions_to_disk()

        if self._auto_clear_input_after_send and not from_pending_bootstrap:
            self.message_edit.clear()
            if hasattr(self, "_stash_session_compose_draft"):
                self._stash_session_compose_draft(session.session_id)
        self._focus_message_input_later()
        self._append_log(
            "[CHAT_QUEUE][SEND_OK] "
            f"session_id={session.session_id} "
            f"message_source={message_source} "
            f"message_id={reuse_user_message_id or user_message_id} "
            f"bridge_message_id={bridge_message_id}",
            echo=True,
        )
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
        return {
            "ok": True,
            "bridge_message_id": bridge_message_id,
            "turn_id": turn_id,
        }

    def _on_upload_then_send_control_done(self, control_message_id):
        pending = self._pop_pending_upload_send(control_message_id)
        if not pending:
            return
        session_id = (pending.get("session_id") or "").strip()
        session = self._sessions.get(session_id)
        if session is None:
            self._append_log(
                f"[UPLOAD_THEN_SEND][DONE_NO_SESSION] "
                f"control_message_id={control_message_id} session_id={session_id}",
                echo=True,
            )
            return
        self._append_log(
            f"[UPLOAD_THEN_SEND][UPLOAD_DONE_SEND] "
            f"control_message_id={control_message_id} session_id={session_id}",
            echo=True,
        )
        result = self._execute_queued_chat_send(session, pending)
        if isinstance(result, dict) and result.get("ok"):
            self._add_system_message("上传完成，文本已加入发送队列。")
        elif isinstance(result, dict):
            self._add_system_message(
                f"上传完成，但文本入队失败：{result.get('reason') or '未知原因'}"
            )

    def _on_upload_then_send_control_failed(self, control_message_id, detail=""):
        pending = self._pop_pending_upload_send(control_message_id)
        if not pending:
            return
        session_id = (pending.get("session_id") or "").strip()
        raw_content = (pending.get("content") or "").strip()
        from_pending_bootstrap = bool(pending.get("from_pending_bootstrap"))
        reason_text = (detail or "").strip() or "未返回具体原因"
        self._append_log(
            f"[UPLOAD_THEN_SEND][CANCEL_SEND] "
            f"control_message_id={control_message_id} "
            f"session_id={session_id} reason={reason_text}",
            echo=True,
        )
        if (
            raw_content
            and not from_pending_bootstrap
            and session_id == self._current_session_id
        ):
            self.message_edit.setPlainText(raw_content)
            self._focus_message_input_later()
        self._add_system_message(f"上传失败，已取消发送：{reason_text}")
        self._apply_chat_bind_visual_state()

    def _strict_targets_for_upload_command(self, session):
        """
        解析用于 start_upload 严格定向的 client / page_instance / conversation。
        返回 (target_client_id, page_instance_id, conversation_id, err)。
        err 非空表示当前不允许从 GUI 触发上传。
        """
        if session is None:
            return "", "", "", "没有当前会话"
        if not is_server_running():
            return "", "", "", "请先启动桥接服务"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return "", "", "", "当前对话未启用远程 ChatGPT 联动"
        bind_eff = self._effective_bind_state(session)
        if bind_eff != BIND_STATE_BOUND_CONVERSATION:
            return (
                "",
                "",
                "",
                f"上传仅适用于已绑定且在线的对话页（当前状态：{bind_eff}）",
            )
        target_client_id = (remote.get("client_id") or "").strip()
        page_instance_id = (remote.get("page_instance_id") or "").strip()
        conv = (remote.get("conversation_id") or "").strip()
        if not conv:
            conv = (
                parse_conversation_id(
                    (remote.get("url") or "").strip()
                )
                or ""
            ).strip()
        if not target_client_id:
            return "", "", "", "缺少绑定页面的 client_id"
        if not page_instance_id:
            return "", "", "", "缺少 page_instance_id，请重新绑定对话页面"
        if not conv:
            return "", "", "", "缺少 conversation_id，请打开已绑定的 ChatGPT 对话页"
        info = self._client_info_by_id(
            target_client_id, getattr(self._bridge_ui, "last_bridge_status", None)
        )
        if not isinstance(info, dict):
            return "", "", "", "无法从桥接状态解析绑定页面信息"
        if not self._tm_page_is_online_simple(info):
            return "", "", "", "当前绑定页面离线，请打开对应浏览器标签页"
        if not bool(info.get("upload_bridge_supported")):
            return (
                "",
                "",
                "",
                "绑定页面油猴脚本不支持 start_upload，请更新 Tampermonkey 脚本并刷新 ChatGPT 页面",
            )
        return target_client_id, page_instance_id, conv, ""

    def _trigger_upload_for_current_bound_page(
        self, block_next_chat_on_failed=True
    ):
        """
        向当前绑定的油猴页面下发 start_upload 控制命令。
        只负责触发上传，不负责发送文本。
        """
        session = self._current_session()
        cid, pins, conv, err = self._strict_targets_for_upload_command(session)
        if err:
            self._add_system_message(err)
            self._append_log(
                f"[UPLOAD_TRIGGER][FAILED] reason=precheck {err}",
                echo=True,
            )
            return False
        self._append_log(
            "[UPLOAD_TRIGGER][TARGET] "
            f"client_id={cid or '-'} "
            f"page_instance_id={pins or '-'} "
            f"conversation_id={conv or '-'}",
            echo=True,
        )
        self._add_system_message(
            "上传命令将发送到绑定页："
            f"client_id={cid}，page_instance_id={pins}，conversation_id={conv}。"
        )
        current_client_id = (self._selected_tm_page_client_id() or "").strip()
        if current_client_id and current_client_id != cid:
            self._add_system_message(
                "注意：当前选中的页面不是绑定页，上传命令会发送到当前会话的绑定页。"
                "如果当前页面没有反应，请点击「定位绑定页」查看。"
            )
            self._append_log(
                "[UPLOAD_TRIGGER][TARGET_NOT_CURRENT] "
                f"current_client_id={current_client_id} target_client_id={cid}",
                echo=True,
            )
        payload = {
            "source": "python_gui",
            "session_id": session.session_id if session else "",
            "require_all_success": True,
            "block_next_chat_on_failed": block_next_chat_on_failed,
        }
        try:
            enqueue_result = enqueue_control_command(
                command="start_upload",
                client_id=cid,
                page_instance_id=pins,
                conversation_id=conv,
                payload=payload,
            )
        except Exception as error:
            detail = (
                f"[UPLOAD_TRIGGER][FAILED] reason=exception {error}\n"
                f"{traceback.format_exc()}"
            )
            self._append_log(detail, echo=True)
            return False
        queued, queued_msg, enqueue_reason = self._normalize_enqueue_result(
            enqueue_result
        )
        if not queued:
            self._append_log(
                "[UPLOAD_TRIGGER][FAILED] reason=enqueue_returned_falsy "
                f"enqueue_reason={enqueue_reason or '-'}",
                echo=True,
            )
            return False
        message_id = ""
        if isinstance(queued_msg, dict):
            message_id = ((queued_msg.get("message_id") or "") or "").strip()
        self._append_log(
            "[TM_CONTROL][START_UPLOAD][QUEUE] "
            f"target_client_id={cid} "
            "command=start_upload "
            f"session_id={(session.session_id if session else '-')} "
            f"page_instance_id={pins} "
            f"conversation_id={conv} "
            f"command_message_id={message_id or '-'} "
            f"block_next_chat_on_failed={block_next_chat_on_failed}",
            echo=True,
        )
        return True

    def _clear_stale_pending_reply_if_bound_page_idle(self, session, reason=""):
        """桥接状态 tick / ack / 发送失败等场景下清理 stale pending。"""
        if session is None or not hasattr(self, "_clear_stale_pending_reply"):
            return False
        if hasattr(self, "_maybe_recover_pending_reply"):
            self._maybe_recover_pending_reply(session)
        reason_key = (reason or "").strip()
        if reason_key in ("ack_received", "snapshot_applied", "send_failed"):
            if not self._is_stale_pending_reply(session):
                return False
            return self._clear_stale_pending_reply(session, reason=reason_key)
        if reason_key == "before_send":
            return self._clear_stale_pending_reply_before_send(session)
        if reason_key == "before_sync":
            return self._clear_stale_pending_reply_before_sync(session)
        if self._is_stale_pending_reply(session):
            return self._clear_stale_pending_reply(
                session, reason=reason_key or "bridge_status_tick"
            )
        return False

    def _update_upload_action_buttons_state(self):
        if not hasattr(self, "trigger_upload_btn") or not hasattr(
            self, "upload_and_send_btn"
        ):
            return

        session = self._current_session()
        server_running = is_server_running()

        # 不再通过 disabled 表示不可用，避免按钮变灰。
        # 点击后仍然走原有前置检查，给出明确失败原因。
        self.trigger_upload_btn.setEnabled(True)
        self.upload_and_send_btn.setEnabled(True)
        if hasattr(self, "send_to_cursor_btn"):
            self.send_to_cursor_btn.setEnabled(True)

        if session is None:
            self.trigger_upload_btn.setToolTip("当前没有会话，点击后会提示无法触发上传。")
            self.upload_and_send_btn.setToolTip("当前没有会话，点击后会提示无法上传并发送。")
            return

        _, _, _, err = self._strict_targets_for_upload_command(session)
        target_ready = bool(server_running and not err)

        response_ready = True
        response_msg = ""
        if target_ready:
            response_ready, response_msg = self._check_bound_client_response_ready(
                session
            )

        busy_reason = self._session_send_busy_reason(session)
        is_busy = bool(busy_reason)

        if not server_running:
            self.trigger_upload_btn.setToolTip("服务未启动，点击后会提示请先启动服务。")
            self.upload_and_send_btn.setToolTip("服务未启动，点击后会提示请先启动服务。")
            return

        if err:
            self.trigger_upload_btn.setToolTip(f"当前可能无法触发上传：{err}")
            self.upload_and_send_btn.setToolTip(f"当前不能上传并发送：{err}")
            return

        if not response_ready:
            tip = response_msg or "当前绑定页面仍在回答或暂不可接收输入。"
            self.trigger_upload_btn.setToolTip(f"当前可能无法触发上传：{tip}")
            self.upload_and_send_btn.setToolTip(f"当前不能上传并发送：{tip}")
            return

        if is_busy:
            self.trigger_upload_btn.setToolTip(
                f"当前会话状态：{busy_reason}。点击后会再次检查。"
            )
            self.upload_and_send_btn.setToolTip(
                f"当前会话正在处理上一条消息：{busy_reason}。点击后会给出阻断原因。"
            )
            return

        self.trigger_upload_btn.setToolTip(
            "向当前绑定的油猴页面下发 start_upload，只上传工具箱队列中的文件，不发送文字。"
        )
        self.upload_and_send_btn.setToolTip(
            "先触发油猴上传工具箱队列中的文件，成功后再发送输入框文字。"
        )

    def _register_local_upload_file_path(self, path: str):
        """将 GUI 选择的本地文件登记到 Flask，供油猴 poll 拉取并下载上传。"""
        from app.server.upload_files import register_upload_file

        session = self._current_session()
        if session is None:
            self._add_system_message("没有当前会话，无法登记本地文件。")
            return None

        path_text = (path or "").strip()
        if not path_text:
            self._add_system_message("文件路径为空，无法登记。")
            return None

        remote = getattr(session, "remote_chatgpt", None) or {}
        if hasattr(remote, "to_dict"):
            remote = remote.to_dict()
        if not isinstance(remote, dict):
            remote = {}

        try:
            entry = register_upload_file(
                path_text,
                session_id=session.session_id,
                client_id=(remote.get("client_id") or "").strip(),
                page_instance_id=(remote.get("page_instance_id") or "").strip(),
                base_url=get_server_url() if is_server_running() else None,
            )
        except (FileNotFoundError, ValueError, OSError) as error:
            self._append_log(
                "[UPLOAD_FILES][REGISTER][FAILED] "
                f"path={path_text} error_type={type(error).__name__} error={error}",
                echo=True,
            )
            self._add_system_message(f"登记本地文件失败：{error}")
            return None

        self._append_log(
            "[UPLOAD_FILES][REGISTER][OK] "
            f"file_id={entry.get('file_id') or '-'} "
            f"name={entry.get('name') or '-'} "
            f"session_id={session.session_id}",
            echo=True,
        )
        self._add_system_message(
            f"已登记本地文件：{entry.get('name') or path_text}。"
            "请在 ChatGPT 页油猴工具箱点击「开始上传」。"
        )
        return entry

    def _pick_and_register_upload_file_for_session(self):
        if not is_server_running():
            self._add_system_message("请先启动服务，再添加本地文件。")
            return None

        path, _ = QFileDialog.getOpenFileName(
            self,
            "选择要上传到 ChatGPT 的本地文件",
            "",
            "所有文件 (*);;ZIP 压缩包 (*.zip)",
        )
        if not path:
            return None
        return self._register_local_upload_file_path(path)

    def _on_trigger_upload_clicked(self):
        self._append_log("[UPLOAD_TRIGGER][CLICK]", echo=True)

        if not is_server_running():
            self._add_system_message("请先启动服务。")
            self._append_log(
                "[UPLOAD_TRIGGER][FAILED] reason=server_not_running",
                echo=True,
            )
            return

        session = self._current_session()
        if session is None:
            self._add_system_message("没有当前会话，无法触发上传。")
            self._append_log(
                "[UPLOAD_TRIGGER][FAILED] reason=no_current_session",
                echo=True,
            )
            return

        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            self._add_system_message(
                response_msg or "当前绑定页面暂不可上传，请等待 ChatGPT 回复完成后再试。"
            )
            self._append_log(
                "[UPLOAD_TRIGGER][BLOCKED] "
                f"reason=response_not_ready detail={response_msg or '-'}",
                echo=True,
            )
            return

        busy_reason = self._session_send_busy_reason(session)
        if busy_reason == "pending_reply":
            self._clear_stale_pending_reply_if_bound_page_idle(
                session,
                reason="manual_trigger_upload",
            )
            busy_reason = self._session_send_busy_reason(session)

        if busy_reason and busy_reason != "pending_reply":
            self._add_system_message(
                f"当前会话状态仍不可上传：{busy_reason}。"
                "请先同步网页对话或等待绑定状态恢复。"
            )
            self._append_log(
                f"[UPLOAD_TRIGGER][BLOCKED] reason=session_busy detail={busy_reason}",
                echo=True,
            )
            return

        if busy_reason == "pending_reply":
            self._append_log(
                "[UPLOAD_TRIGGER][PENDING_REPLY_BYPASS] "
                f"session_id={session.session_id} "
                "本地仍有 pending_reply，但绑定页已空闲，继续触发上传",
                echo=True,
            )

        ok = self._trigger_upload_for_current_bound_page(
            block_next_chat_on_failed=False
        )

        if ok:
            self._add_system_message(
                "已向绑定页发送 start_upload，请等待油猴完成工具箱上传。"
            )
            self.statusBar().showMessage(
                "已下发上传指令，请等待油猴侧完成上传",
                5000,
            )
        else:
            self._add_system_message(
                "触发上传失败，请查看日志中的 [UPLOAD_TRIGGER][FAILED] 详情。"
            )

    def _on_upload_and_send_clicked(self):
        self._append_log("[UPLOAD_AND_SEND][CLICK] button=upload_and_send", echo=True)
        if not is_server_running():
            self._add_system_message("请先启动服务。")
            self._append_log(
                "[UPLOAD_AND_SEND][BLOCKED] reason=server_not_running",
                echo=True,
            )
            return
        content = self.message_edit.toPlainText().strip()
        if not content:
            self._append_log(
                "[UPLOAD_AND_SEND][EMPTY_TEXT_TO_UPLOAD_ONLY] 输入框为空，自动退化为只触发上传",
                echo=True,
            )
            self._add_system_message("输入框为空，已按「只触发上传」处理。")
            self._on_trigger_upload_clicked()
            return
        session = self._ensure_current_session()
        if hasattr(self, "resolve_page_action"):
            upload_action = self.resolve_page_action(session, action="upload")
            if upload_action.decision == "blocked":
                upload_reason = upload_action.reason_code or "upload_blocked"
                self._add_system_message(str(upload_reason))
                self._append_log(
                    f"[UPLOAD_AND_SEND][BLOCKED] reason=upload decision=blocked "
                    f"detail={upload_reason}",
                    echo=True,
                )
                return
        busy_reason = self._session_send_busy_reason(session)

        if busy_reason == "pending_reply":
            self._clear_stale_pending_reply_if_bound_page_idle(
                session,
                reason="upload_and_send",
            )
            busy_reason = self._session_send_busy_reason(session)

        hard_block_reasons = {
            "waiting_bind",
            "waiting_home",
            "prebound_home_wait_conversation",
            "bind_state_waiting_home",
            "bind_state_waiting_conversation_created",
            "bind_state_waiting_bound_conversation",
        }
        if busy_reason in hard_block_reasons:
            self._add_system_message(
                f"当前会话正忙（{busy_reason}），请等待完成后再使用上传并发送。"
            )
            self._append_log(
                f"[UPLOAD_AND_SEND][BLOCKED] reason=session_busy detail={busy_reason}",
                echo=True,
            )
            return
        _, _, _, pre_err = self._strict_targets_for_upload_command(session)
        if pre_err:
            self._add_system_message(pre_err)
            self._append_log(
                f"[UPLOAD_AND_SEND][BLOCKED] reason=precheck {pre_err}",
                echo=True,
            )
            return
        turn = self._new_local_send_turn(
            content, session=session, trace_id="", button="upload_and_send"
        )
        plan = self._build_send_plan(
            turn,
            suppress_system_message=False,
            source="upload_and_send",
            skip_prebind_checks=True,
        )
        if plan.decision in ("blocked",) or not plan.allows_dispatch():
            reason = plan.reason or plan.block_status or "send_blocked"
            self._add_system_message(
                self._send_target_blocked_user_message(reason)
                if hasattr(self, "_send_target_blocked_user_message")
                else str(reason)
            )
            self._append_log(
                f"[UPLOAD_AND_SEND][BLOCKED] reason=send_plan detail={reason}",
                echo=True,
            )
            return
        prep_ok, payload = self._prepare_send_dispatch_payload(plan)
        if not prep_ok or payload is None:
            self._append_log(
                "[UPLOAD_AND_SEND][BLOCKED] reason=send_payload_incomplete",
                echo=True,
            )
            return
        if not self._append_local_send_turn(turn, clear_input=False):
            self._append_log(
                "[UPLOAD_AND_SEND][BLOCKED] reason=local_append_failed",
                echo=True,
            )
            return
        control_message_id = self._enqueue_upload_then_send_command(
            session=session,
            payload=payload,
            client_id=plan.client_id,
        )
        if not control_message_id:
            self._append_log(
                "[UPLOAD_AND_SEND][BLOCKED] reason=upload_enqueue_failed",
                echo=True,
            )
            return
        pending = {
            "session_id": session.session_id,
            "payload": payload,
            "content": plan.content,
            "turn_id": turn.turn_id,
            "user_message_id": turn.user_message_id,
            "assistant_message_id": turn.assistant_message_id,
            "from_pending_bootstrap": plan.from_pending_bootstrap,
            "reuse_user_message_id": turn.user_message_id,
            "source": plan.message_source,
            "suppress_system_message": plan.suppress_system_message,
            "chain": "upload_and_send",
        }
        store = getattr(self, "_bridge_msg", None)
        if store is not None:
            store.pending_upload_sends[str(control_message_id)] = pending
        self._append_log("[UPLOAD_AND_SEND][WAIT_UPLOAD_DONE]", echo=True)
        self._add_system_message("已开始上传，上传成功后会自动发送文本。")

    def _find_session_message_by_id(self, session, message_id):
        if session is None:
            return None
        target_id = (message_id or "").strip()
        if not target_id:
            return None
        for message in session.messages:
            if (message.message_id or "").strip() == target_id:
                return message
        return None

    def _set_user_message_status(self, session, message_id, status):
        message = self._find_session_message_by_id(session, message_id)
        if message is None:
            return False
        if message.role != "user":
            return False
        message.ui_status = (status or "").strip()
        session.updated_at = time.time()
        return True

    def _init_status_scheduler(self):
        self._status_scheduler = StatusScheduler(
            self,
            self._flush_scheduled_bridge_status,
            interval_ms=self.STATUS_SCHEDULER_INTERVAL_MS,
        )

    def _on_bridge_status_signal(self, status):
        self._bridge_ui.pending_status_apply_reason = "status_signal"
        self._status_scheduler.submit(status)

    def _is_debug_mode_enabled(self):
        return bool(
            getattr(self, "_debug_mode_enabled", False)
            or getattr(self, "debug_mode_enabled", False)
            or getattr(self, "_debug_mode", False)
            or getattr(self, "debug_mode", False)
        )

    def _should_show_gui_log_line(self, line, level=None):
        from app.utils.gui_logging import parse_level_from_log_line, should_show_gui_log

        return should_show_gui_log(
            str(line or ""),
            level=level or parse_level_from_log_line(str(line or "")),
            debug_mode=self._is_debug_mode_enabled(),
        )

    def _make_tm_clients_signature(self, clients):
        parts = []
        for client in clients or []:
            if not isinstance(client, dict):
                continue
            parts.append("|".join([
                str(client.get("client_id", "")),
                str(client.get("page_instance_id", "")),
                str(client.get("conversation_id", "")),
                str(page_url_from(client) or ""),
                str(client.get("visibility_state") or ""),
                str(
                    client.get("focus")
                    or client.get("has_focus")
                    or client.get("focused")
                    or ""
                ),
                str(client.get("response_state") or client.get("is_responding") or ""),
                str(client.get("can_accept_input") or ""),
                str(client.get("response_state") or ""),
            ]))
        return "\n".join(sorted(parts))

    def _debug_status_step(self, text):
        if not self._is_debug_mode_enabled():
            return
        self._append_log(text)

    def _schedule_status_apply_after_session_switch(self):
        if self._bridge_ui.pending_after_switch_status_apply:
            return
        self._bridge_ui.pending_after_switch_status_apply = True
        QTimer.singleShot(350, self._run_after_switch_status_apply)

    def _run_after_switch_status_apply(self):
        self._bridge_ui.pending_after_switch_status_apply = False
        now = time.time()
        if now - self._bridge_ui.last_session_switch_status_apply_at < 0.5:
            return
        self._bridge_ui.last_session_switch_status_apply_at = now
        self._schedule_status_apply(reason="session_switch_delayed", force=True)

    def _schedule_status_apply(self, status=None, reason="unknown", delay_ms=None, force=False):
        del delay_ms
        reason = reason or "unknown"
        self._bridge_ui.pending_status_apply_reason = reason
        if getattr(self._session_ui, "switching", False) and not force:
            self._bridge_ui.pending_after_switch_status_apply = True
            if status is not None:
                self._status_scheduler.submit(status)
            return
        payload = status
        if payload is None and is_server_running():
            payload = get_bridge_status()
        if force:
            self._status_scheduler.flush_now(payload)
        elif payload is not None:
            self._status_scheduler.submit(payload)
        elif is_server_running():
            self._status_scheduler.submit(get_bridge_status())

    def _resolve_bridge_status_payload(self, status=None):
        if isinstance(status, dict) and status:
            return status

        if is_server_running():
            live_status = get_bridge_status()
            if isinstance(live_status, dict) and live_status:
                return live_status

        if isinstance(status, dict):
            return status

        return {}

    def _flush_scheduled_bridge_status(self, status):
        """StatusScheduler 统一 flush：chip 每次更新，页面列表仅 fingerprint 变化时重建。"""
        status = self._resolve_bridge_status_payload(status)
        reason = (
            self._bridge_ui.pending_status_apply_reason
            or self._bridge_ui.current_status_apply_reason
            or ""
        )
        self._bridge_ui.pending_status_apply_reason = ""
        self._bridge_ui.current_status_apply_reason = reason

        suspend_until = float(getattr(self, "_suspend_status_ui_until", 0.0) or 0.0)
        now = time.time()
        if suspend_until > now:
            self._status_scheduler.submit(status)
            delay_ms = max(50, int((suspend_until - now) * 1000) + 50)
            QTimer.singleShot(
                delay_ms,
                lambda: self._status_scheduler.flush_now(status),
            )
            return

        if getattr(self._session_ui, "switching", False):
            self._bridge_ui.pending_after_switch_status_apply = True
            self._status_scheduler.submit(status)
            return

        light_status = reason in self.LIGHTWEIGHT_STATUS_REASONS
        tm_snapshot = None
        if hasattr(self, "build_tm_page_snapshot"):
            tm_snapshot = self.build_tm_page_snapshot(
                status, log_stages=not light_status
            )

        try:
            self._apply_bridge_status_impl(
                status,
                tm_snapshot=tm_snapshot,
                refresh_page_list=False,
            )
        except Exception as error:
            detail = f"刷新桥接状态失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            return

        if tm_snapshot is not None:
            fp = tm_snapshot.fingerprint
            if fp != self._page_selector.last_fingerprint:
                self._page_selector.last_fingerprint = fp
                self._refresh_page_list_from_snapshot(status, tm_snapshot)
        elif not light_status:
            self._refresh_page_list_from_snapshot(status, None)

    def _refresh_page_list_from_snapshot(self, status, tm_snapshot):
        if getattr(self._session_ui, "switching", False):
            QTimer.singleShot(
                300,
                lambda s=status, snap=tm_snapshot: self._refresh_page_list_from_snapshot(
                    s, snap
                ),
            )
            return
        reason = self._bridge_ui.current_status_apply_reason or "status_flush"
        if hasattr(self, "should_schedule_page_registry_refresh"):
            self.should_schedule_page_registry_refresh(status, reason=reason)
        elif hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason=reason, status=status)

    def _apply_bridge_status(self, status, reason="", force=False):
        """兼容入口，统一走 StatusScheduler。"""
        if reason:
            self._bridge_ui.pending_status_apply_reason = reason
        self._schedule_status_apply(status=status, reason=reason or "direct", force=force)

    def _render_status_summary(self, status):
        status = status or {}
        host, port = self._service_host_port_for_display(status)
        pages = status.get("pages") or []
        last_seen_vals = [
            float(p.get("last_seen") or 0)
            for p in pages
            if isinstance(p, dict) and p.get("last_seen")
        ]
        last_seen = max(last_seen_vals) if last_seen_vals else None
        summary = self._tm_summary_for_session()
        active = read_snapshot_identity(summary, "active")
        active_client_id = active["client_id"]
        active_info = (
            self._client_info_by_id(active_client_id, status=status)
            if active_client_id
            else None
        )
        page_url = page_url_from(active_info) if active_info else "-"
        if bridge_status_online(status):
            tm_text = "在线"
        else:
            tm_text = "未连接"
        lines = [
            f"服务运行：{'是' if status.get('server_running') else '否'}",
            f"监听地址：{host}:{port}",
            f"油猴状态：{tm_text}",
            f"最后心跳：{self._format_ts(last_seen)}",
            f"油猴 client_id：{active_client_id or '-'}",
            f"全局绑定 client_id：{read_snapshot_identity(status, 'bound')['client_id'] or '-'}",
            f"本对话绑定 client_id：{self._session_bound_client_id() or '-'}",
            f"已知 ChatGPT 页面数：{self._status_summary_page_count(status)}",
        ]
        lines.extend([
            f"油猴在线：{summary.get('online_clients', 0)} / 总 {summary.get('total_clients', 0)}",
            f"会话页在线：{summary.get('online_conversation_clients', 0)}",
            f"首页在线：{summary.get('online_home_clients', 0)}",
            f"绑定在线：{summary.get('bound_online')}",
            f"活跃 client：{active_client_id or '-'}",
        ])
        current_queue = self._current_session_queue_size()
        total_queue = self._total_session_queue_size()
        lines.extend([
            f"聊天队列：当前 {current_queue} / 总 {total_queue}",
            f"待发队列：{status.get('queue_length', 0)}",
            f"控制命令队列：{status.get('control_queue_length', 0)}",
            f"控制命令等待：{status.get('control_waiting_count', 0)}",
            f"入站事件数：{status.get('inbound_count', 0)}",
            f"当前油猴页面：{page_url}",
            f"本对话绑定页面：{self._bound_conversation_url() or '未绑定'}",
        ])
        waiting_acks = status.get("waiting_acks") or []
        if not waiting_acks and status.get("waiting_ack"):
            waiting_acks = [status.get("waiting_ack")]
        if waiting_acks:
            lines.append(f"等待回执消息数：{len(waiting_acks)}")
            for waiting in waiting_acks[:5]:
                lines.append(
                    f"  · {waiting.get('id', '?')[:8]}… "
                    f"status={waiting.get('status', '?')} "
                    f"delivered_to={waiting.get('delivered_to', '-')}"
                )
        return "\n".join(lines)
    @staticmethod
    def _refresh_status_chip(label, state=""):
        state = state or ""
        if label.property("state") == state:
            return
        label.setProperty("state", state)
        style = label.style()
        style.unpolish(label)
        style.polish(label)

    def _refresh_page_selector_after_heavy_skip(self, status=None):
        del status
        if getattr(self._session_ui, "switching", False):
            QTimer.singleShot(
                300,
                lambda: self._refresh_page_selector_after_heavy_skip(),
            )
            return
        self._pending_page_selector_refresh = False
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="after_heavy_skip")

    def _apply_bridge_status_impl(
        self, status, *, tm_snapshot=None, refresh_page_list=True
    ):
        status = status or {}
        self._bridge_ui.last_bridge_status = status
        apply_reason = self._bridge_ui.current_status_apply_reason or ""
        light_status_apply = apply_reason in self.LIGHTWEIGHT_STATUS_REASONS
        skip_heavy_ui = apply_reason in (
            "session_switch",
            "session_switch_delayed",
        ) or getattr(self._session_ui, "switching", False)
        if tm_snapshot is None and hasattr(self, "build_tm_page_snapshot"):
            tm_snapshot = self.build_tm_page_snapshot(
                status, log_stages=not light_status_apply
            )
        apply_t0 = time.perf_counter()
        service_ms = 0
        summary_ms = 0
        live_page_ms = 0
        bound_page_ms = 0
        selector_ms = 0
        tm_table_ms = 0
        job_panel_ms = 0
        session_list_ms = 0
        self._debug_status_step("[STATUS_APPLY][STEP] start")
        t_service = time.perf_counter()
        server_running = bool(status.get("server_running"))
        if server_running:
            service_url = (
                status.get("server_url")
                or get_server_url()
                or ""
            )
            self.status_label.setText("服务：运行中")
            if service_url:
                self.status_label.setToolTip(f"服务地址：{service_url}")
                self.statusBar().showMessage(f"服务运行中 {service_url}")
            else:
                self.status_label.setToolTip("")
                self.statusBar().showMessage("服务运行中")
            self._server_ui.start_failed = False
            self._server_ui.start_error = ""
            self._refresh_status_chip(self.status_label, "ok")
        elif getattr(self._server_ui, "start_failed", False):
            self.status_label.setText("服务：启动失败")
            self.status_label.setToolTip("")
            self.statusBar().showMessage("服务启动失败")
            self._refresh_status_chip(self.status_label, "error")
        else:
            self.status_label.setText("服务：未启动")
            self.status_label.setToolTip("")
            self.statusBar().showMessage("服务已停止")
            self._refresh_status_chip(self.status_label, "error")
        service_ms = int((time.perf_counter() - t_service) * 1000)
        self._debug_status_step("[STATUS_APPLY][STEP] service_label")
        t_summary = time.perf_counter()
        pages = status.get("pages") or []
        last_seen_vals = [
            float(p.get("last_seen") or 0)
            for p in pages
            if isinstance(p, dict) and p.get("last_seen")
        ]
        last_seen_text = self._format_ts(max(last_seen_vals)) if last_seen_vals else "-"
        summary = self._tm_summary_for_session()
        display_online, display_total = self._tm_display_counts_from_status(
            status, summary=summary, snapshot=tm_snapshot
        )
        summary_for_chip = dict(summary)
        summary_for_chip["online_clients"] = display_online
        summary_for_chip["total_clients"] = display_total
        monkey_stats = self._collect_monkey_window_binding_stats(status)
        if not last_seen_vals and display_total <= 0:
            self.tm_online_label.setText("页面：在线 0")
            self._refresh_status_chip(self.tm_online_label, "")
            self.tm_online_label.setToolTip("")
        else:
            if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():
                chip_text, chip_state = self._format_compact_tm_online_chip(summary_for_chip)
            else:
                chip_text, chip_state = self._format_tm_online_chip_text(summary_for_chip)
            self.tm_online_label.setText(chip_text)
            self._refresh_status_chip(self.tm_online_label, chip_state or "")
        if hasattr(self, "_apply_top_status_chip_visibility"):
            self._apply_top_status_chip_visibility()
        if last_seen_vals or display_total > 0:
            verbose_tm_tip = (
                hasattr(self, "_is_ui_verbose_status_enabled")
                and self._is_ui_verbose_status_enabled()
            )
            if verbose_tm_tip:
                bound_client_id = (self._session_bound_client_id() or "").strip()
                if not bound_client_id:
                    bind_detail = "当前对话未绑定页面"
                else:
                    bound_info = self._client_info_by_id(
                        bound_client_id, status=status, snapshot=tm_snapshot
                    )
                    bound_online = bool(
                        bound_info and self._tm_page_is_online_simple(bound_info)
                    )
                    bind_detail = (
                        "绑定页在线" if bound_online else "绑定页离线"
                    )
                self.tm_online_label.setToolTip(
                    "\n".join(
                        [
                            f"油猴页面在线统计",
                            f"在线 {display_online} / 总 {display_total}",
                            f"最后全局心跳：{last_seen_text}",
                            f"当前对话绑定：{bind_detail}",
                            "完整连接信息请点击「详情」。",
                        ]
                    )
                )
            else:
                self.tm_online_label.setToolTip(
                    f"油猴页面在线统计\n"
                    f"在线 {display_online} / 总 {display_total}\n"
                    f"最后全局心跳：{last_seen_text}\n"
                    f"完整连接信息请点击「详情」。"
                )
        self._status_apply_safe("log_tm_status_summary", self._log_tm_status_summary, summary)
        self._status_apply_safe(
            "log_bind_mismatch_if_needed", self._log_bind_mismatch_if_needed, summary
        )
        summary_ms = int((time.perf_counter() - t_summary) * 1000)
        self._debug_status_step("[STATUS_APPLY][STEP] tm_summary")
        light_status_apply = apply_reason in self.LIGHTWEIGHT_STATUS_REASONS
        if not light_status_apply:
            QTimer.singleShot(0, lambda s=status: self._try_finish_pending_auto_bind(s))
            QTimer.singleShot(0, lambda s=status: self._try_finish_waiting_bound_conversations(s))
            QTimer.singleShot(0, lambda: self._check_bootstrap_claim_timeouts())
            QTimer.singleShot(0, lambda s=status: self._sync_bound_session_urls_from_clients(s))
            QTimer.singleShot(0, lambda s=status: self._poll_wait_conversation_sync_requests(s))
            QTimer.singleShot(0, lambda s=status: self._auto_bind_current_session_if_needed(s))
        self._debug_status_step("[STATUS_APPLY][STEP] page_registry_deferred")
        if skip_heavy_ui:
            self._pending_page_selector_refresh = True
            QTimer.singleShot(
                300,
                lambda: self._refresh_page_selector_after_heavy_skip(),
            )
            if self._is_debug_mode_enabled():
                self._append_log(
                    "[STATUS_APPLY][SKIP_HEAVY] "
                    f"reason={apply_reason or 'session_switch'} "
                    "skip=page_selector,tm_table "
                    "pending_page_selector_refresh=True",
                    echo=False,
                )
        elif refresh_page_list:
            registry_reason = apply_reason or "status_apply"
            if hasattr(self, "should_schedule_page_registry_refresh"):
                self.should_schedule_page_registry_refresh(
                    status, reason=registry_reason
                )
            elif hasattr(self, "schedule_page_registry_refresh"):
                self.schedule_page_registry_refresh(
                    reason=registry_reason, status=status
                )
            self._debug_status_step("[STATUS_APPLY][STEP] page_registry_scheduled")
        inbound_items = status.get("recent_inbound") or []
        self._handle_inbound_events(inbound_items)
        self._debug_status_step("[STATUS_APPLY][STEP] status_summary")
        self._refresh_cursor_bridge_status(status.get("cursor_bridge"))
        if not skip_heavy_ui and hasattr(self, "_session_list_visual_signature"):
            new_list_sig = self._session_list_visual_signature()
            old_list_sig = getattr(self, "_last_session_list_status_tick_signature", None)
            if new_list_sig != old_list_sig:
                self._last_session_list_status_tick_signature = new_list_sig
                t_list = time.perf_counter()
                self._refresh_session_list(select_session_id=self._current_session_id)
                session_list_ms = int((time.perf_counter() - t_list) * 1000)
        self._recover_stuck_bootstrap_sessions()
        for session in list(self._sessions.values()):
            if self._session_send_queue(session.session_id):
                self._try_send_next_queued_message(session)
        current_session = self._current_session()
        if (
            current_session is not None
            and self._session_has_pending_assistant_reply(current_session)
        ):
            self._clear_stale_pending_reply_if_bound_page_idle(
                current_session,
                reason="bridge_status_tick",
            )
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
        self._debug_status_step("[STATUS_APPLY][STEP] done")
        total_ms = int((time.perf_counter() - apply_t0) * 1000)
        if self._is_debug_mode_enabled():
            self._append_log(
                "[PERF][STATUS_APPLY] "
                f"service_ms={service_ms} "
                f"summary_ms={summary_ms} "
                f"live_page_ms={live_page_ms} "
                f"bound_page_ms={bound_page_ms} "
                f"selector_ms={selector_ms} "
                f"tm_table_ms={tm_table_ms} "
                f"job_panel_ms={job_panel_ms} "
                f"session_list_ms={session_list_ms} "
                f"total_ms={total_ms}",
                echo=False,
            )
    def _handle_report_unknown_event(self, item, payload):
        bridge_id = item.get("message_id") or "-"
        waiting_ids = payload.get("waiting_message_ids") or []
        self._append_log(
            f"[回传未知] message_id={bridge_id} event={payload.get('event') or '-'} "
            f"client_id={item.get('client_id') or '-'} "
            f"waiting_message_ids={waiting_ids}"
        )

    def _handle_report_mismatch_event(self, item, payload):
        bridge_id = item.get("message_id") or "-"
        self._append_log(
            f"[回传不匹配] message_id={bridge_id} "
            f"session_id={item.get('session_id') or '-'} "
            f"turn_id={item.get('turn_id') or '-'} "
            f"event={payload.get('event') or '-'} "
            f"owner_client_id={payload.get('owner_client_id') or '-'} "
            f"report_client_id={payload.get('report_client_id') or item.get('client_id') or '-'}"
        )

    def _handle_ack_mismatch_or_ignored_event(self, item, payload, kind):
        if kind == "ack_mismatch":
            bridge_id = item.get("message_id") or "-"
            self._append_log(
                f"[ACK不匹配] message_id={bridge_id} "
                f"session_id={item.get('session_id') or '-'} "
                f"turn_id={item.get('turn_id') or '-'} "
                f"detail={payload.get('detail') or '-'} "
                f"owner_client_id={payload.get('owner_client_id') or '-'} "
                f"report_client_id={payload.get('report_client_id') or item.get('client_id') or '-'}"
            )
            if hasattr(self, "_note_sync_ack_mismatch"):
                self._note_sync_ack_mismatch((item.get("message_id") or "").strip())

    def _handle_open_url_result_event(self, item, payload, kind):
        url = payload.get("url") or ""
        detail = payload.get("detail") or ""
        if kind == "open_url_success":
            self._append_log(f"[打开网页] 成功：{url} {detail}".strip())
        else:
            self._append_log(f"[打开网页] 失败：{url} {detail}".strip())

    def _handle_command_result_event(self, item, payload, kind):
        page_url = (payload.get("url") or "")
        detail = (
            payload.get("detail")
            or payload.get("reason")
            or payload.get("error")
            or ""
        )
        command = (payload.get("command") or "").strip()
        client_id = item.get("client_id") or "-"
        if kind == "close_page_success":
            self._append_log(
                f"[关闭页面] 成功 client_id={client_id} {page_url} {detail}".strip()
            )
            return
        if kind == "close_page_failed":
            self._append_log(
                f"[关闭页面] 失败 client_id={client_id} {page_url} {detail}".strip()
            )
            return
        if command == "start_upload":
            if not detail:
                result_obj = payload.get("result")
                if isinstance(result_obj, dict):
                    detail = (
                        (result_obj.get("reason") or "")
                        or (result_obj.get("detail") or "")
                    ).strip() or detail
            control_message_id = (item.get("message_id") or "").strip()
            pending_key = str(control_message_id)
            store = getattr(self, "_bridge_msg", None)
            pending_map = (
                store.pending_upload_sends if store is not None else {}
            )
            if pending_key and pending_key in pending_map:
                self._on_upload_then_send_control_failed(
                    control_message_id, detail
                )
            else:
                self._append_log(
                    f"[上传] 失败 client_id={client_id} reason={detail or '-'}",
                    echo=True,
                )
                self._add_system_message(
                    f"上传失败：{detail or '未返回具体原因，请查看油猴日志'}"
                )
            if hasattr(self, "fail_page_command"):
                self.fail_page_command(control_message_id, detail or "upload_failed")
            return
        self._append_log(
            f"[命令] 失败 command={command or '-'} client_id={client_id} {detail}".strip(),
            echo=True,
        )

    def _handle_conversation_created_event(self, item, payload):
        conv_session = self._resolve_session_for_conversation_created(item)
        if conv_session is not None:
            report_client = (item.get("client_id") or "").strip()
            self._apply_conversation_created_binding(
                conv_session, payload, client_id=report_client
            )
            if hasattr(self, "_try_send_next_queued_message"):
                self._try_send_next_queued_message(conv_session)
            return
        mismatch_payload = item.get("payload") or {}
        self._append_log(
            f"[BIND][MISMATCH] reason=conversation_created_no_session "
            f"message_id={(item.get('message_id') or '-')[:8]} "
            f"bind_request_id="
            f"{mismatch_payload.get('bind_request_id') or '-'} "
            f"client_id={item.get('client_id') or '-'} "
            f"page_instance_id={mismatch_payload.get('page_instance_id') or '-'}"
        )

    def _resolve_inbound_session_binding(self, item, payload, kind):
        session, turn_id, bridge_id = self._resolve_inbound_binding(item)
        if session is not None and turn_id:
            return session, turn_id, bridge_id
        if kind not in (
            "send_success",
            "send_message_result",
            "assistant_message",
            "assistant_reply",
        ):
            return session, turn_id, bridge_id
        session_id = (
            item.get("session_id") or payload.get("session_id") or ""
        ).strip()
        session = self._sessions.get(session_id) if session_id else None
        turn_id = (item.get("turn_id") or payload.get("turn_id") or "").strip()
        bridge_id = (item.get("message_id") or "").strip()
        return session, turn_id, bridge_id

    def _handle_send_result_event(self, item, payload, session, turn_id, bridge_id, kind):
        ok = bool(payload.get("ok", payload.get("success", True)))
        self._append_log(
            "[SEND][ACK] "
            f"request_id={bridge_id or '-'} "
            f"session_id={session.session_id} "
            f"ok={'true' if ok else 'false'} "
            f"message_status={(payload.get('message_status') or payload.get('reason') or '-')}",
            echo=True,
        )
        status_text = "sent" if ok else "发送失败"
        if hasattr(self, "_update_message_status_by_request_id"):
            updated = self._update_message_status_by_request_id(
                session.session_id,
                bridge_id,
                status_text,
                turn_id=turn_id,
            )
        else:
            updated = False
            for message in reversed(session.messages):
                if message.role != "user":
                    continue
                if (message.turn_id or "").strip() != (turn_id or "").strip():
                    if bridge_id and (message.bridge_message_id or "").strip() != bridge_id:
                        continue
                message.ui_status = "已发送" if ok else "发送失败"
                updated = True
                break
        if not updated:
            self._append_log(
                "[CHAT_MESSAGE][APPEND_FAILED] "
                f"reason=ack_no_user_message session_id={session.session_id} "
                f"request_id={bridge_id or '-'}",
                echo=True,
            )
        if session.session_id == self._current_session_id and hasattr(
            self, "_render_current_chat_messages"
        ):
            self._render_current_chat_messages(
                force_bottom=True,
                reason="send_success",
            )

    def _handle_assistant_message_event(
        self, item, payload, session, turn_id, bridge_id
    ):
        text = (payload.get("content") or "").strip()
        if self._upsert_assistant_reply_from_bridge(
            session,
            turn_id,
            bridge_id,
            text,
            render_reason="assistant_message",
        ):
            if bridge_id:
                self._finalize_bridge(bridge_id)

    def _handle_ack_event(self, item, payload, session, turn_id, bridge_id):
        success = bool(payload.get("success"))
        detail = (
            payload.get("detail")
            or payload.get("reason")
            or ""
        )
        detail_text = str(detail).strip().replace("\n", " ")
        detail_lower = detail_text.lower()
        is_assistant_busy = "assistant_busy" in detail_lower
        self._append_log(
            "[SEND][ACK] "
            f"request_id={bridge_id or '-'} "
            f"session_id={session.session_id} "
            f"ok={'true' if success else 'false'} "
            f"detail={detail_text or '-'}",
            echo=True,
        )
        if success:
            self._append_log(
                "[BRIDGE][ACK][OK] "
                f"request_id={bridge_id or '-'} "
                f"session_id={session.session_id} "
                f"detail={detail_text or '-'}",
                echo=True,
            )
            self._append_log(
                "[CHAT_SEND][BROWSER_SENT] "
                f"request_id={bridge_id or '-'} "
                f"session_id={session.session_id}",
                echo=True,
            )
        if success:
            ack_status = "sent"
        elif is_assistant_busy:
            ack_status = "已发送（ChatGPT 正在生成，等待回复）"
        else:
            ack_status = f"发送失败({detail_text or 'unknown'})"
        if hasattr(self, "_update_message_status_by_request_id"):
            self._update_message_status_by_request_id(
                session.session_id,
                bridge_id,
                ack_status,
                turn_id=turn_id,
            )
        else:
            target_user = None
            for message in reversed(session.messages):
                if message.role != "user":
                    continue
                if (message.turn_id or "").strip() == (turn_id or "").strip():
                    target_user = message
                    break
                if bridge_id and (message.bridge_message_id or "").strip() == bridge_id:
                    target_user = message
                    break
            if target_user is not None:
                target_user.ui_status = (
                    "已发送"
                    if success
                    else f"发送失败({detail_text or 'unknown'})"
                )
        if self._is_finalized(bridge_id):
            if session.session_id == self._current_session_id and hasattr(
                self, "_render_current_chat_messages"
            ):
                self._render_current_chat_messages(
                    force_bottom=True,
                    reason="ack_finalized",
                )
            return
        if success:
            if self._has_assistant_for_turn(session, turn_id):
                self._bridge_msg.ack_success_message_ids.add(bridge_id)
                self._set_reply_waiting(session, turn_id)
            report_client = (item.get("client_id") or "").strip()
            if report_client:
                remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
                if not remote_now.get("bootstrap_in_progress"):
                    self._remember_session_page_from_client(
                        session, report_client
                    )
                self.schedule_page_registry_refresh(reason="send_ack_success")
        else:
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote_now.get("bootstrap_in_progress"):
                session.remote_chatgpt = {
                    **remote_now,
                    "bootstrap_in_progress": False,
                }
                self._save_sessions_to_disk()
            if is_assistant_busy:
                self._append_log(
                    "[BRIDGE][ACK][BUSY_CONTINUE] "
                    f"request_id={bridge_id or '-'} "
                    f"session_id={session.session_id} "
                    f"detail={detail_text or '-'}",
                    echo=True,
                )
                if self._has_assistant_for_turn(session, turn_id):
                    self._set_reply_waiting(session, turn_id)
            else:
                self._bridge_msg.ack_success_message_ids.discard(bridge_id)
                if self._has_assistant_for_turn(session, turn_id):
                    self._set_reply_error(
                        session,
                        turn_id,
                        f"发送失败：{detail_text or '油猴返回失败'}",
                        "发送失败",
                    )
                self._finalize_bridge(bridge_id)
        if session.session_id == self._current_session_id and hasattr(
            self, "_render_current_chat_messages"
        ):
            self._render_current_chat_messages(
                force_bottom=True,
                reason="ack",
            )

    def _handle_send_failed_event(self, item, payload, session, turn_id, bridge_id):
        if not self._has_assistant_for_turn(
            session, turn_id
        ) or self._is_finalized(bridge_id):
            return
        self._bridge_msg.ack_success_message_ids.discard(bridge_id)
        remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state_now = self._remote_bind_state(remote_now)
        if (
            remote_now.get("bootstrap_in_progress")
            or bind_state_now == BIND_STATE_WAITING_CONVERSATION_CREATED
            or (
                bind_state_now == BIND_STATE_PREBOUND_HOME
                and not (remote_now.get("conversation_id") or "").strip()
            )
        ):
            session.remote_chatgpt = {
                **default_remote_chatgpt(),
                "bind_state": BIND_STATE_UNBOUND,
            }
            session.updated_at = time.time()
            self._save_sessions_to_disk()
            self._append_log(
                "[BIND][BOOTSTRAP_FAILED_RESET] "
                f"session_id={session.session_id} "
                f"message_id={bridge_id[:8] if bridge_id else '-'} "
                f"reason={payload.get('reason') or payload.get('detail') or '-'}"
            )
        detail = (
            payload.get("detail")
            or payload.get("reason")
            or str(payload)
        )
        reason_labels = {
            "target_client_id_mismatch": "目标 client_id 与当前页面不一致",
            "conversation_id_mismatch": "目标会话与当前页面不一致",
            "target_page_url_mismatch": "目标页面 URL 与当前页面不一致",
            "not_conversation_page": "当前页面不是 ChatGPT 对话页",
            "not_home_page": "bootstrap 要求 ChatGPT 首页",
            "bootstrap_target_not_home": "bootstrap 只能发送到 ChatGPT 首页",
            "home_already_has_conversation": "首页不应已有 conversation_id",
            "bootstrap_target_has_conversation": "首页不应已有 conversation_id",
            "target_page_instance_id_mismatch": "预绑定首页 page_instance_id 不一致",
            "bind_request_id_mismatch": "绑定令牌与当前页面不一致",
            "conversation_created_timeout": "首条消息已发送，但未检测到新对话页",
        }
        if payload.get("reason") in reason_labels:
            detail = reason_labels[payload["reason"]]
        self._set_reply_error(
            session, turn_id, f"发送失败：{detail}", "发送失败"
        )
        target_user = None
        for message in reversed(session.messages):
            if (
                message.role == "user"
                and (message.turn_id or "").strip() == (turn_id or "").strip()
            ):
                target_user = message
                break
        if target_user is not None:
            target_user.ui_status = "发送失败"
            session.updated_at = time.time()
            failed_text = (target_user.content or "").strip()
            if failed_text and hasattr(self, "message_input"):
                self.message_input.setPlainText(failed_text)
            elif failed_text and hasattr(self, "message_edit"):
                self.message_edit.setPlainText(failed_text)
        self._add_system_message_once(
            "消息发送失败，请检查绑定页面后重试。已将失败消息恢复到输入框。",
            dedupe_seconds=10,
        )
        self._finalize_bridge(bridge_id)
        self._try_send_next_queued_message(session)

    def _upsert_assistant_reply_from_bridge(
        self,
        session,
        turn_id,
        bridge_id,
        text,
        *,
        render_reason,
    ):
        text = (text or "").strip()
        invalid_texts = ("姝ｅ湪鎬濊€?", "姝ｅ湪鐢熸垚", "鎬濊€冧腑", "鍥炲瀹屾垚")
        if text in invalid_texts:
            session_id = session.session_id if session else ""
            self._append_log(
                f"[REPLY][SKIP_INVALID_TEXT] session_id={session_id or '-'} "
                f"turn_id={turn_id or '-'} text={text!r}",
                echo=True,
            )
            return False
        session_id = session.session_id if session else ""
        count_before = self._session_visible_message_count(session)
        self._append_log(
            "[CHAT_REPLY][RECV] "
            f"request_id={bridge_id or '-'} "
            f"session_id={session_id} "
            f"content_len={len(text)} "
            f"count_before={count_before}",
            echo=True,
        )
        if not text:
            self._append_log(
                "[CHAT_REPLY][APPEND_FAILED] "
                f"reason=empty_reply session_id={session_id} "
                f"request_id={bridge_id or '-'}",
                echo=True,
            )
            return False

        self._append_log(
            "[CHAT_REPLY][APPEND_BEFORE] "
            f"session_id={session_id} "
            f"count_before={count_before} "
            f"request_id={bridge_id or '-'}",
            echo=True,
        )
        if self._has_assistant_for_turn(session, turn_id):
            self._set_reply_text(session, turn_id, text, "已回复")
            count_after = self._session_visible_message_count(session)
            self._append_log(
                "[CHAT_REPLY][APPLY] "
                f"mode=update_placeholder "
                f"session_id={session_id} "
                f"turn_id={turn_id or '-'} "
                f"request_id={bridge_id or '-'} "
                f"content_len={len(text)} "
                f"count_before={count_before} "
                f"count_after={count_after}",
                echo=True,
            )
        else:
            appended = self._append_message_to_session(
                session.session_id,
                {
                    "role": "assistant",
                    "content": text,
                    "turn_id": turn_id,
                    "status": "done",
                    "source": "web_reply",
                    "bridge_message_id": bridge_id,
                    "request_id": bridge_id,
                },
            )
            count_after = self._session_visible_message_count(session)
            self._append_log(
                "[CHAT_REPLY][APPLY] "
                f"mode=append_new "
                f"session_id={session_id} "
                f"turn_id={turn_id or '-'} "
                f"request_id={bridge_id or '-'} "
                f"content_len={len(text)} "
                f"count_before={count_before} "
                f"count_after={count_after} "
                f"appended={'true' if appended else 'false'}",
                echo=True,
            )
            if count_after <= count_before:
                self._append_log(
                    "[CHAT_MESSAGE][APPEND_FAILED] "
                    f"reason=reply_count_not_increased session_id={session_id} "
                    f"request_id={bridge_id or '-'}",
                    echo=True,
                )

        if session.session_id == self._current_session_id and hasattr(
            self, "_render_current_chat_messages"
        ):
            self._render_current_chat_messages(
                force_bottom=True,
                reason=render_reason or "assistant_reply_recv",
            )
        elif session.session_id == self._current_session_id:
            self._render_session_chat(session, force_bottom=True)
        self._save_sessions_to_disk()
        return True

    def _handle_assistant_reply_event(
        self, item, payload, session, turn_id, bridge_id
    ):
        if self._is_finalized(bridge_id):
            return
        merged = dict(payload or {})
        merged.setdefault("session_id", item.get("session_id") or session.session_id)
        merged.setdefault("turn_id", item.get("turn_id") or turn_id)
        merged.setdefault("message_id", bridge_id or item.get("message_id") or "")
        if hasattr(self, "_on_tm_assistant_reply"):
            if self._on_tm_assistant_reply(merged):
                report_client = (item.get("client_id") or "").strip()
                if report_client:
                    self._remember_session_page_from_client(
                        session, report_client
                    )
                    self.schedule_page_registry_refresh(reason="assistant_reply")
                self._try_send_next_queued_message(session)
                return
        text = (
            payload.get("content") or payload.get("text") or payload.get("assistant_text") or ""
        ).strip()
        if text in ("正在思考", "正在生成", "思考中", "回复完成"):
            self._append_log(
                f"[REPLY][SKIP_INVALID_TEXT] session_id={session.session_id} "
                f"turn_id={turn_id or '-'} text={text!r}",
                echo=True,
            )
            return
        if self._upsert_assistant_reply_from_bridge(
            session,
            turn_id,
            bridge_id,
            text,
            render_reason="assistant_reply",
        ):
            self._append_log(
                "[REPLY][APPLIED] "
                f"session_id={session.session_id} "
                f"turn_id={turn_id or '-'} "
                f"bridge_message_id={bridge_id or '-'} "
                f"content_len={len(text)} updated=true",
                echo=True,
            )
            if hasattr(self, "_mark_session_waiting_finished"):
                self._mark_session_waiting_finished(
                    session, reason="assistant_reply"
                )
            self._finalize_bridge(bridge_id)
            self._bridge_msg.ack_success_message_ids.discard(bridge_id)
            report_client = (item.get("client_id") or "").strip()
            if report_client:
                self._remember_session_page_from_client(
                    session, report_client
                )
                self.schedule_page_registry_refresh(reason="assistant_reply")
            self._try_send_next_queued_message(session)
        else:
            self._set_reply_error(
                session, turn_id, "ChatGPT 返回了空回复。", "空回复"
            )
            self._finalize_bridge(bridge_id)
            self._try_send_next_queued_message(session)

    def _handle_assistant_reply_failed_event(
        self, item, payload, session, turn_id, bridge_id, kind
    ):
        if not self._has_assistant_for_turn(
            session, turn_id
        ) or self._is_finalized(bridge_id):
            return
        self._bridge_msg.ack_success_message_ids.discard(bridge_id)
        detail = (
            payload.get("reason")
            or payload.get("detail")
            or payload.get("error_message")
            or ""
        )
        if not detail:
            if kind == "assistant_reply_empty":
                detail = "ChatGPT 已发送，但未读取到回复内容。"
            else:
                detail = "读取 ChatGPT 回复失败。"
        busy = payload.get("busy")
        busy_reason = payload.get("busy_reason") or ""
        if busy:
            detail = f"{detail}（busy={busy_reason or 'yes'}）"
        elapsed = payload.get("elapsed_ms")
        if elapsed is not None:
            detail = f"{detail}（等待 {elapsed}ms）"
        prefix = "读取回复失败："
        if not str(detail).startswith(prefix) and kind == "assistant_reply_failed":
            detail = f"{prefix}{detail}"
        status_text = "读取失败" if kind == "assistant_reply_failed" else "空回复"
        self._set_reply_error(session, turn_id, detail, status_text)
        self._finalize_bridge(bridge_id)
        self._try_send_next_queued_message(session)

    def _handle_bound_message_event(self, item, payload, kind):
        session, turn_id, bridge_id = self._resolve_inbound_session_binding(
            item, payload, kind
        )
        if session is None:
            return
        if kind in ("send_success", "send_message_result"):
            self._handle_send_result_event(
                item, payload, session, turn_id, bridge_id, kind
            )
            return
        if kind == "assistant_message":
            self._handle_assistant_message_event(
                item, payload, session, turn_id, bridge_id
            )
            return
        if kind == "ack":
            self._handle_ack_event(item, payload, session, turn_id, bridge_id)
            return
        if kind == "send_failed":
            self._handle_send_failed_event(
                item, payload, session, turn_id, bridge_id
            )
            return
        if kind == "assistant_reply":
            self._handle_assistant_reply_event(
                item, payload, session, turn_id, bridge_id
            )
            return
        if kind in ("assistant_reply_empty", "assistant_reply_failed"):
            self._handle_assistant_reply_failed_event(
                item, payload, session, turn_id, bridge_id, kind
            )

    def _handle_control_done_event(self, item, payload):
        client_id = item.get("client_id") or "-"
        command = (payload.get("command") or "").strip()
        if command == "start_upload":
            control_message_id = (item.get("message_id") or "").strip()
            store = getattr(self, "_bridge_msg", None)
            pending = None
            if control_message_id and store is not None:
                pending = store.pending_upload_sends.get(str(control_message_id))
            if pending:
                self._on_upload_then_send_control_done(control_message_id)
            else:
                result = payload.get("result") or {}
                if not isinstance(result, dict):
                    result = {}
                upload_status = result.get("upload_status") or {}
                if not isinstance(upload_status, dict):
                    upload_status = {}
                success = int(result.get("success", 0) or 0)
                failed = int(result.get("failed", 0) or 0)
                attached = int(upload_status.get("attached", 0) or 0)
                total = int(upload_status.get("total", 0) or 0)
                self._append_log(
                    "[上传] 完成 "
                    f"client_id={client_id} "
                    f"success={success} failed={failed} "
                    f"attached={attached} total={total}",
                    echo=True,
                )
                self._add_system_message(
                    f"上传完成：成功 {success} 个，失败 {failed} 个，"
                    f"已挂载 {attached} 个，总数 {total}。"
                )
            if hasattr(self, "finish_page_command"):
                self.finish_page_command(control_message_id)
            return
        self._append_log(
            f"[控制完成] command={command or '-'} client_id={client_id}",
            echo=True,
        )

    def _handle_inbound_events(self, items):
        for item in items:
            event_key = (
                item.get("event_id") or item.get("message_id") or self._make_inbound_key(item)
            )
            if event_key in self._processed_inbound_ids:
                continue
            self._processed_inbound_ids.add(event_key)
            self._handle_inbound_event(item)

    def _handle_inbound_event(self, item):
        kind = item.get("kind", "?")
        payload = item.get("payload") or {}
        if kind == "report_unknown":
            self._handle_report_unknown_event(item, payload)
            return
        if kind == "report_mismatch":
            self._handle_report_mismatch_event(item, payload)
            return
        if kind in ("ack_mismatch", "report_ignored"):
            self._handle_ack_mismatch_or_ignored_event(item, payload, kind)
            return
        if kind in ("open_url_success", "open_url_failed"):
            self._handle_open_url_result_event(item, payload, kind)
            return
        if kind == "close_page_requested":
            client_id = item.get("client_id") or "-"
            self._append_log(f"[关闭页面] 已向页面发送关闭请求 client_id={client_id}")
            return
        if kind == "close_page_still_open":
            page_url = (payload.get("url") or "")
            detail = payload.get("detail") or ""
            client_id = item.get("client_id") or "-"
            self._append_log(
                f"[关闭页面] 页面仍在运行 client_id={client_id} {page_url} {detail}".strip()
            )
            self._set_settings_hint(
                "页面仍在运行，浏览器可能拦截了 window.close()"
            )
            return
        if kind == "control_done":
            self._handle_control_done_event(item, payload)
            return
        if kind in ("close_page_success", "close_page_failed", "command_failed"):
            self._handle_command_result_event(item, payload, kind)
            return
        if kind == "conversation_snapshot":
            self._handle_conversation_snapshot_inbound(item)
            return
        if kind == "conversation_created":
            self._handle_conversation_created_event(item, payload)
            return
        self._handle_bound_message_event(item, payload, kind)

    def _refresh_status_tick(self):
        if is_server_running():
            self._schedule_status_apply(
                status=get_bridge_status(),
                reason="status_timer",
            )

    def _status_apply_safe(self, step_name, fn, *args, **kwargs):
        """状态刷新子步骤隔离：诊断/展示失败不阻断主 UI 更新。"""
        try:
            return fn(*args, **kwargs)
        except Exception as error:
            detail = (
                "[STATUS_APPLY][STEP_ERROR] "
                f"step={step_name} "
                f"error_type={type(error).__name__} "
                f"error={error}\n{traceback.format_exc()}"
            )
            self._append_log(detail, echo=True, level="ERROR")
            return None

    def _append_log(self, message, echo=False, level=None, **kwargs):
        # 兼容 level= / tag= / category= / severity= 等扩展参数，避免 TypeError 中断刷新。
        del kwargs
        level_text = str(level or "INFO").strip().upper() or "INFO"
        if level_text not in ("TRACE", "DEBUG", "INFO", "WARNING", "ERROR"):
            level_text = "INFO"
        line = append_log(message, source="GUI", echo=echo, level=level_text)
        check_text = line or str(message or "")
        if not self._should_show_gui_log_line(check_text, level=level_text):
            return line
        if hasattr(self, "_append_runtime_log_line_to_ui"):
            self._append_runtime_log_line_to_ui(line)
        return line
    def _update_running_ui(self, running):
        del running

    def _parse_port(self):
        raw = str(getattr(self, "_port_text", None) or "5000").strip()
        try:
            port = int(raw)
        except ValueError as error:
            self._append_log(
                "[SERVER][PORT_INVALID] "
                f"raw={raw!r} error_type={type(error).__name__} error={error}",
                echo=True,
                level="ERROR",
            )
            self._set_settings_hint(f"端口错误：{raw} 不是数字。")
            return None
        if not (1 <= port <= 65535):
            self._set_settings_hint(f"端口错误：{port} 不在 1-65535 范围内。")
            return None
        return port
    def _start_server(self):
        bind_host = self._resolve_listen_host()
        port = self._parse_port()
        if port is None:
            return
        self._read_settings_from_widgets()
        set_debug_mode(self._debug_mode)
        try:
            result = start_server(bind_host, port)
        except Exception as error:
            detail = (
                f"服务启动失败：{error}\n"
                f"host={bind_host} port={port}\n"
                f"{traceback.format_exc()}"
            )
            self._server_ui.start_failed = True
            self._server_ui.start_error = str(error)
            self._append_log(detail, echo=True)
            self._add_system_message(f"服务启动失败：{error}")
            self._update_running_ui(False)
            return

        if result.get("ok"):
            actual_port = result.get("port")
            if actual_port and int(actual_port) != int(port):
                self._port_text = str(actual_port)
                self._settings.setValue("port", str(actual_port))
            self._server_ui.start_failed = False
            self._server_ui.start_error = ""
            self._update_running_ui(True)
            QTimer.singleShot(
                200,
                lambda: self._schedule_status_apply(
                    get_bridge_status(),
                    reason="server_started",
                    force=True,
                ),
            )
            QTimer.singleShot(
                500,
                lambda: self.schedule_page_registry_refresh(
                    reason="server_started"
                ),
            )
            self._save_app_settings()
            message = result.get("message") or get_server_url()
            self._append_log(message, echo=True)
            if result.get("fallback_used"):
                self._add_system_message(
                    f"默认端口 {result.get('configured_port')} 不可用，"
                    f"已自动切换到 {actual_port}。\n"
                    f"油猴请填写：{result.get('bridge_url')}"
                )
        elif result.get("already_running"):
            self._add_system_message("服务已经在运行中。")
        else:
            message = result.get("message") or "服务启动失败。"
            self._server_ui.start_failed = True
            self._server_ui.start_error = message
            self._append_log(message, echo=True)
            self._add_system_message(message)
            self._update_running_ui(False)
    def _stop_server(self):
        try:
            stopped = stop_server()
        except Exception as error:
            detail = f"服务停止失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"服务停止失败：{error}")
            return
        if stopped:
            self._server_ui.start_failed = False
            self._server_ui.start_error = ""
            self._update_running_ui(False)
            self._schedule_status_apply(
                get_bridge_status(),
                reason="server_stopped",
                force=True,
            )
            self._add_system_message("服务已停止。")
        else:
            self._add_system_message("服务当前没有运行。")

    def _check_bound_client_response_ready(self, session):
        if session is None:
            return True, ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        client_id = (
            remote.get("client_id")
            or remote.get("prebound_home_client_id")
            or ""
        ).strip()
        if not client_id:
            return True, ""
        client_info = self._client_info_by_id(client_id, self._bridge_ui.last_bridge_status)
        if not isinstance(client_info, dict):
            return True, ""
        if client_info.get("is_responding"):
            return True, ""
        can_accept_input = bool(client_info.get("can_accept_input", True))
        if not can_accept_input:
            return True, ""
        return True, ""

    def _session_send_queue(self, session_id):
        sid = (session_id or "").strip()
        if not sid:
            return []
        if not hasattr(self, "_session_send_queues") or not isinstance(
            self._session_send_queues, dict
        ):
            self._session_send_queues = {}
        return self._session_send_queues.setdefault(sid, [])

    def _session_send_busy_reason(self, session):
        if session is None:
            return ""
        if hasattr(self, "_clear_stale_pending_reply_before_send"):
            self._clear_stale_pending_reply_before_send(session)
        pending = (
            self._get_pending_reply_state(session)
            if hasattr(self, "_get_pending_reply_state")
            else None
        )
        if pending and hasattr(self, "_pending_reply_is_actionable"):
            if self._pending_reply_is_actionable(session, pending):
                return "pending_reply"
        elif self._session_has_pending_assistant_reply(session):
            if hasattr(self, "_clear_stale_pending_reply_before_send"):
                self._clear_stale_pending_reply_before_send(session)
            pending = (
                self._get_pending_reply_state(session)
                if hasattr(self, "_get_pending_reply_state")
                else None
            )
            if pending and hasattr(self, "_pending_reply_is_actionable"):
                if self._pending_reply_is_actionable(session, pending):
                    return "pending_reply"
        response_state = self._session_bound_response_state(session)
        if bool(response_state.get("is_responding")):
            return "responding"
        state = (response_state.get("response_state") or "").strip().lower()
        if state in ("generating", "waiting", "pending", "queued"):
            return state
        if self._auto_bind.pending_session_id == session.session_id:
            return "waiting_bind"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        if bind_state in (
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
            BIND_STATE_WAITING_BOUND_CONVERSATION,
        ):
            return bind_state.lower()
        if self._is_temp_home_bound_state(bind_state):
            temp_page_id = (
                remote.get("temp_page_id")
                or remote.get("page_display_id")
                or remote.get("page_no")
                or ""
            ).strip()
            if temp_page_id and hasattr(self, "_resolve_temp_home_send_target"):
                temp_info = self._resolve_temp_home_send_target(session, remote)
                if temp_info.get("matched"):
                    return ""
            elif temp_page_id and hasattr(self, "_find_page_by_display_id"):
                page = self._find_page_by_display_id(temp_page_id)
                if isinstance(page, dict) and page.get("online"):
                    return ""
            return "temp_home_page_not_found"
        return ""

    def _current_session_queue_size(self):
        session = self._current_session()
        if session is None:
            return 0
        return len(self._session_send_queue(session.session_id))

    def _total_session_queue_size(self):
        queues = getattr(self, "_session_send_queues", {})
        if not isinstance(queues, dict):
            return 0
        total = 0
        for items in queues.values():
            if isinstance(items, list):
                total += len(items)
        return total

    def _update_queue_badge(self):
        return

    def _enqueue_user_message_for_session(self, session, text, reuse_message_id=""):
        if session is None:
            return False
        text = str(text or "").strip()
        if not text:
            return False
        queue = self._session_send_queue(session.session_id)
        reuse_message_id = (reuse_message_id or "").strip()
        existing = (
            self._find_session_message_by_id(session, reuse_message_id)
            if reuse_message_id
            else None
        )
        message_id = reuse_message_id if existing is not None else str(uuid.uuid4())
        item = {
            "message_id": message_id,
            "text": text,
            "created_at": time.time(),
        }
        queue.append(item)
        if existing is None:
            self._append_message_to_session(
                session.session_id,
                {
                    "role": "user",
                    "content": text,
                    "message_id": message_id,
                    "created_at": item["created_at"],
                    "status": "已加入队列",
                    "source": "local_queue",
                },
            )
        else:
            existing.ui_status = "已加入队列"
            existing.content = text
            session.updated_at = time.time()
        self._append_log(
            "[CHAT_QUEUE][ENQUEUE] "
            f"session_id={session.session_id} "
            f"message_id={message_id} "
            f"queue_size={len(queue)} "
            f"text_len={len(text)}",
            echo=True,
        )
        self._set_tm_action_hint(
            f"当前对话正在处理上一条消息，已加入队列：{len(queue)} 条等待发送。"
        )
        if hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=True,
                reason="queue_enqueue",
            )
        elif hasattr(self, "_refresh_local_conversation_after_sync"):
            self._refresh_local_conversation_after_sync(
                session.session_id,
                force_bottom=True,
                reason="queue_enqueue",
            )
        self._save_sessions_to_disk()
        self._update_queue_badge()
        return True

    def _try_send_next_queued_message(self, session):
        if session is None:
            return False
        if hasattr(self, "dump_top_level_windows"):
            self.dump_top_level_windows("before_queue_process")
        queue = self._session_send_queue(session.session_id)
        busy_reason = self._session_send_busy_reason(session)
        if busy_reason:
            self._append_log(
                "[CHAT_QUEUE][WAIT] "
                f"session_id={session.session_id} "
                f"reason={busy_reason} "
                f"queue_size={len(queue)}",
                echo=True,
            )
            return False
        if not queue:
            if getattr(self, "_debug_mode", False):
                self._append_log(
                    f"[CHAT_QUEUE][EMPTY] session_id={session.session_id}",
                    echo=False,
                )
            QTimer.singleShot(100, self._update_queue_badge)
            return False
        item = queue.pop(0)
        text = str(item.get("text") or "").strip()
        message_id = str(item.get("message_id") or "").strip()
        if not text:
            self._append_log(
                "[CHAT_QUEUE][SKIP_EMPTY] "
                f"session_id={session.session_id} "
                f"message_id={message_id or '-'}",
                echo=True,
            )
            self._update_queue_badge()
            return self._try_send_next_queued_message(session)
        self._append_log(
            "[CHAT_QUEUE][DEQUEUE_SEND] "
            f"session_id={session.session_id} "
            f"message_id={message_id or '-'} "
            f"queue_left={len(queue)} "
            f"text_len={len(text)}",
            echo=True,
        )
        self._set_tm_action_hint(f"正在发送队列中的下一条消息，剩余 {len(queue)} 条。")
        if message_id:
            self._set_user_message_status(session, message_id, "正在发送")
        self._refresh_local_conversation_after_sync(
            session.session_id,
            force_bottom=True,
            reason="queue_dequeue_send",
        )
        result = self._push_message_text(
            session,
            text,
            reuse_user_message_id=message_id,
            suppress_system_message=True,
            source="queue",
        )
        if not isinstance(result, dict):
            result = {"ok": False, "reason": "unknown"}
        if not result.get("ok"):
            reason = (result.get("reason") or "send_failed").strip() or "send_failed"
            retryable = bool(result.get("retryable", True))
            if retryable:
                queue.insert(0, item)
                if message_id:
                    self._set_user_message_status(session, message_id, "已加入队列")
            else:
                if message_id:
                    self._set_user_message_status(session, message_id, "发送失败")
            self._append_log(
                "[CHAT_QUEUE][SEND_FAILED] "
                f"session_id={session.session_id} "
                f"message_id={message_id or '-'} "
                f"reason={reason} "
                f"queue_left={len(queue)}",
                echo=True,
            )
            self._refresh_local_conversation_after_sync(
                session.session_id,
                force_bottom=True,
                reason="queue_send_failed",
            )
            self._update_queue_badge()
            return retryable
        self._update_queue_badge()
        return True

    def _push_message(self, *, button="send"):
        try:
            return self._push_message_impl(button=button)
        finally:
            if hasattr(self, "dump_top_level_windows"):
                self.dump_top_level_windows("after_send")

    def _push_message_impl(self, *, button="send"):
        if hasattr(self, "dump_top_level_windows"):
            self.dump_top_level_windows("before_send")
        if not is_server_running():
            self._add_system_message("请先启动服务。")
            return None
        content = self.message_edit.toPlainText().strip()
        if not content:
            self._add_system_message("请输入要发送的内容。")
            return None
        session = self._ensure_current_session()
        if hasattr(self, "_clear_stale_pending_reply_before_send"):
            self._clear_stale_pending_reply_before_send(session)
        trace_id = make_send_trace_id(session.session_id if session else "")
        self._set_active_send_trace_id(trace_id)
        self._append_log(
            "[SEND][CLICK] "
            + kv_line(
                trace_id=trace_id,
                button=button,
                session_id=session.session_id,
                text_len=len(content),
            ),
            echo=True,
        )
        self._recover_stuck_bootstrap_sessions()
        plan = None
        local_append_ids = None
        try:
            turn = self._new_local_send_turn(
                content, session=session, trace_id=trace_id, button=button
            )
            plan = self._build_send_plan(turn, source="gui_click")
            if plan.stop_after_handle:
                return None
            if plan.decision == "blocked" or not plan.allows_dispatch():
                return self._handle_send_blocked(plan, messages_appended=False)
            if plan.decision == "queued" and plan.enqueue:
                local_append_ids = self._append_local_send_turn(
                    turn, clear_input=True
                )
                if not local_append_ids:
                    if not plan.suppress_system_message:
                        self._add_system_message(
                            "发送失败：本地消息创建失败，未发送到网页。"
                        )
                    return {
                        "ok": False,
                        "reason": "local_append_failed",
                        "retryable": True,
                    }
                return self._handle_send_blocked(plan, messages_appended=True)
            prep_ok, prepared_payload = self._prepare_send_dispatch_payload(plan)
            if not prep_ok or prepared_payload is None:
                return self._fail_local_send_turn(
                    plan,
                    error_message="send_target_incomplete",
                    stage="patch_send_target",
                    local_messages_appended=False,
                )
            local_append_ids = self._append_local_send_turn(turn, clear_input=True)
            if not local_append_ids:
                if not plan.suppress_system_message:
                    self._add_system_message(
                        "发送失败：本地消息创建失败，未发送到网页。"
                    )
                return {
                    "ok": False,
                    "reason": "local_append_failed",
                    "retryable": True,
                }
            return self._dispatch_send_plan(
                plan, prepared_payload=prepared_payload
            )
        except Exception as exc:
            if plan is not None and hasattr(self, "_fail_local_send_turn"):
                return self._fail_local_send_turn(
                    plan,
                    error=exc,
                    stage="push_message_impl",
                    local_messages_appended=bool(local_append_ids),
                )
            raise
        finally:
            self._set_active_send_trace_id("")
            setattr(self, "_pending_send_turn_id", "")
            setattr(self, "_pending_send_user_message_id", "")
            setattr(self, "_pending_send_assistant_message_id", "")

    def _flush_pending_bootstrap_message(self, session, text):
        text = (text or "").strip()
        if not text or session is None:
            return
        if not is_server_running():
            self._add_system_message("请先启动服务。")
            return
        if self._session_has_pending_assistant_reply(session):
            self._append_log(
                f"[SEND][BOOTSTRAP] 跳过：session={session.session_id} 仍有未完成回复"
            )
            return
        self._push_message_text(session, text, from_pending_bootstrap=True)

    def _push_message_text(
        self,
        session,
        content,
        from_pending_bootstrap=False,
        reuse_user_message_id="",
        suppress_system_message=False,
        source="direct",
        trace_id="",
        button="send",
        reuse_turn_id="",
        reuse_assistant_message_id="",
        page_action_plan=None,
    ):
        """队列/bootstrap/上传并发送：单次 plan，不重复 resolve。"""
        content_text = (content or "").strip()
        if not content_text:
            return {"ok": False, "reason": "empty_text", "retryable": False}
        turn = self._local_turn_from_reuse(
            session,
            content_text,
            trace_id=trace_id,
            turn_id=reuse_turn_id,
            user_message_id=reuse_user_message_id,
            assistant_message_id=reuse_assistant_message_id,
            button=button,
        )
        plan = self._build_send_plan(
            turn,
            from_pending_bootstrap=from_pending_bootstrap,
            suppress_system_message=suppress_system_message,
            source=source,
            skip_prebind_checks=True,
            page_action_plan=page_action_plan,
        )
        if plan.stop_after_handle:
            return {"ok": False, "reason": plan.reason or "deferred", "retryable": True}
        if plan.decision == "blocked" or (
            plan.decision == "queued" and plan.enqueue
        ):
            return self._handle_send_blocked(plan)
        if not plan.allows_dispatch():
            return self._handle_send_blocked(plan)
        return self._dispatch_send_plan(plan)

    def _copy_last_reply(self):
        session = self._current_session()
        text = self._last_assistant_text(session)
        if not text:
            self._add_system_message("当前没有可复制的 ChatGPT 回复。")
            return
        QApplication.clipboard().setText(text)
        self._add_system_message("已复制最后一条 ChatGPT 回复。")

    def _handle_external_gui_dispatch(self, action_id, action, payload):
        from app.server.runtime_state import complete_gui_dispatch
        if action == "system_hotkey":
            combo = str((payload or {}).get("combo") or "").strip().lower()
            if combo != "ctrl+alt+i":
                result = {
                    "ok": False,
                    "error": f"不允许的快捷键: {combo}",
                    "code": "INVALID_HOTKEY",
                }
            else:
                try:
                    import pyautogui
                    self._append_log("[SYSTEM_HOTKEY][EXEC] combo=ctrl+alt+i", echo=True)
                    pyautogui.hotkey("ctrl", "alt", "i", interval=0.04)
                    self._append_log("[SYSTEM_HOTKEY][DONE] combo=ctrl+alt+i", echo=True)
                    result = {
                        "ok": True,
                        "combo": "ctrl+alt+i",
                        "keys": ["ctrl", "alt", "i"],
                    }
                except Exception as error:
                    import traceback
                    detail = f"{error}\n{traceback.format_exc()}"
                    self._append_log(f"[SYSTEM_HOTKEY][ERROR] {detail}", echo=True)
                    result = {
                        "ok": False,
                        "error": str(error),
                        "code": "INTERNAL_ERROR",
                    }
            complete_gui_dispatch(action_id, result)
            return
        complete_gui_dispatch(
            action_id,
            {
                "ok": False,
                "error": "外部 API 未启用",
                "code": "DISABLED",
            },
        )

