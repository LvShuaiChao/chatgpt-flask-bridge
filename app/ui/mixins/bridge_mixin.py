import time
import traceback
import uuid

import server
from log_utils import append_log

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
    PENDING_ASSISTANT_STATUSES,
)
from app.models import (
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
from app.utils.bridge_payload import build_gui_push_payload
from app.utils.page_status import page_url_from
from app.utils.trace_log import kv_line, make_send_trace_id
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import (
    QApplication,
    QTableWidgetItem,
)


class BridgeMixin:
    BRIDGE_STATUS_UI_MIN_INTERVAL_MS = 500
    STATUS_APPLY_DEBOUNCE_MS = 180
    STATUS_APPLY_DEDUP_SEC = 1.5
    STATUS_APPLY_MIN_INTERVAL_SEC = 1.0
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
    def _enqueue_upload_before_send_command(
        self,
        session,
        payload,
        target_client_id,
    ):
        target_client_id = (target_client_id or "").strip()
        if not target_client_id:
            self._append_log(
                "[UPLOAD_BEFORE_SEND][SKIP] reason=empty_target_client_id",
                echo=True,
            )
            return False

        target_page_instance_id = (
            (payload.get("target_page_instance_id") or "").strip()
        )
        target_conversation_id = (
            (payload.get("conversation_id") or "").strip()
        )

        queued = server.enqueue_control_command(
            command="start_upload",
            target_client_id=target_client_id,
            target_page_instance_id=target_page_instance_id,
            target_conversation_id=target_conversation_id,
            payload={
                "source": "gui-send-before-message",
                "session_id": session.session_id if session else "",
                "turn_id": payload.get("turn_id") or "",
                "reset_before_start": True,
                "force_restart": True,
                "require_all_success": True,
                "block_next_chat_on_failed": True,
            },
        )

        if not queued:
            self._append_log(
                "[UPLOAD_BEFORE_SEND][FAILED] reason=enqueue_failed "
                f"session_id={(session.session_id if session else '-')} "
                f"client_id={target_client_id or '-'} "
                f"page_instance_id={target_page_instance_id or '-'} "
                f"conversation_id={target_conversation_id or '-'}",
                echo=True,
            )
            return False

        message_id = ""
        if isinstance(queued, dict):
            message_id = (queued.get("id") or "").strip()

        self._append_log(
            "[UPLOAD_BEFORE_SEND][QUEUED] "
            f"session_id={(session.session_id if session else '-')} "
            f"client_id={target_client_id or '-'} "
            f"page_instance_id={target_page_instance_id or '-'} "
            f"conversation_id={target_conversation_id or '-'} "
            f"command_message_id={message_id or '-'}",
            echo=True,
        )

        if not message_id:
            self._append_log(
                "[UPLOAD_BEFORE_SEND][WARN] reason=missing_command_message_id",
                echo=True,
            )
            return False
        return message_id

    def _pop_pending_upload_send(self, control_message_id):
        key = str(control_message_id or "").strip()
        if not key:
            return None
        pending = getattr(self, "_pending_upload_sends", {}).pop(key, None)
        return pending

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
        if not server.is_server_running():
            return 0
        try:
            return int((server.get_bridge_status() or {}).get("queue_length") or 0)
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
        server.attach_external_request_bridge(session_id, bridge_message_id, turn_id)
        self._message_to_session[bridge_message_id] = session_id
        self._message_to_turn[bridge_message_id] = turn_id
        pending_sends = getattr(self, "_pending_send_requests", None)
        if pending_sends is None:
            pending_sends = {}
            self._pending_send_requests = pending_sends
        pending_sends[bridge_message_id] = {
            "session_id": session_id,
            "turn_id": turn_id,
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "created_at": time.time(),
        }

    def _prepare_chat_send_from_pending(self, session, pending):
        """从 pending 解析发送上下文（不改 payload 入队顺序）。"""
        payload = dict(pending.get("payload") or {})
        raw_user_text = (pending.get("raw_user_text") or "").strip()
        turn_id = (pending.get("turn_id") or "").strip()
        user_message_id = (pending.get("user_message_id") or "").strip()
        assistant_message_id = (pending.get("assistant_message_id") or "").strip()
        reuse_user_message_id = (pending.get("reuse_user_message_id") or "").strip()
        from_pending_bootstrap = bool(pending.get("from_pending_bootstrap"))
        source = (pending.get("source") or "direct").strip()
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
            "raw_user_text": raw_user_text,
            "turn_id": turn_id,
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "reuse_user_message_id": reuse_user_message_id,
            "from_pending_bootstrap": from_pending_bootstrap,
            "source": source,
            "suppress_system_message": suppress_system_message,
            "is_bootstrap": is_bootstrap,
            "existing_user_message": existing_user_message,
            "trace_id": trace_id,
        }

    def _patch_chat_send_target_payload(self, session, payload):
        """入队前补全 target_client_id / url（与原先内联逻辑一致）。"""
        if (payload.get("target_client_id") or "").strip():
            return
        remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
        bound_client = (remote_now.get("client_id") or "").strip()
        if bound_client:
            payload["target_client_id"] = bound_client
            bound_url = (
                remote_now.get("conversation_url") or remote_now.get("url") or ""
            ).strip()
            if bound_url:
                payload["target_page_url"] = bound_url
            return
        if not self._session_is_local_new_chat_flow(session):
            live_client = (
                self._last_bridge_status.get("tampermonkey_client_id") or ""
            ).strip()
            if live_client:
                self._remember_session_page_from_client(session, live_client)

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
        raw_user_text = ctx["raw_user_text"]
        turn_id = ctx["turn_id"]
        user_message_id = ctx["user_message_id"]
        assistant_message_id = ctx["assistant_message_id"]
        reuse_user_message_id = ctx["reuse_user_message_id"]
        from_pending_bootstrap = ctx["from_pending_bootstrap"]
        source = ctx["source"]
        suppress_system_message = ctx["suppress_system_message"]
        is_bootstrap = ctx["is_bootstrap"]
        existing_user_message = ctx["existing_user_message"]
        trace_id = ctx["trace_id"]

        target_client = (payload.get("target_client_id") or "").strip() or "-"
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
            text_len=len(raw_user_text),
            queue_before=queue_before,
        )
        self._append_log(
            "[SEND_EXEC] "
            f"session_id={session.session_id} "
            f"message_id={user_message_id or '-'} "
            f"source={source} "
            f"text_len={len(raw_user_text)} "
            f"target_client={target_client} "
            f"target_conv={target_conv}",
            echo=True,
        )
        if hasattr(self, "dump_top_level_windows"):
            self.dump_top_level_windows("before_queue_process")
        try:
            msg = server.push_message(payload)
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
            (msg.get("message_id") or msg.get("id") or "").strip()
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
            target_client = (payload.get("target_client_id") or "").strip()
            target_instance = (payload.get("target_page_instance_id") or "").strip()
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
            session.title = raw_user_text[:20] + (
                "…" if len(raw_user_text) > 20 else ""
            )

        count_before_enqueue = self._session_visible_message_count(session)
        if existing_user_message is not None:
            existing_user_message.bridge_message_id = bridge_message_id
            existing_user_message.turn_id = turn_id
            existing_user_message.status = "sending"
            existing_user_message.content = raw_user_text
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
                    "content": raw_user_text,
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
                existing_assistant.status = "waiting"
                existing_assistant.content = ASSISTANT_WAIT_TEXT

        session.has_pending_reply = True
        session.pending_reply_since = time.time()
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
            if hasattr(self, "_apply_default_compose_message_if_empty"):
                self._apply_default_compose_message_if_empty()
        self._focus_message_input_later()
        self._append_log(
            "[CHAT_QUEUE][SEND_OK] "
            f"session_id={session.session_id} "
            f"source={source} "
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

    def _on_upload_before_send_control_done(self, control_message_id):
        pending = self._pop_pending_upload_send(control_message_id)
        if not pending:
            return
        session_id = (pending.get("session_id") or "").strip()
        session = self._sessions.get(session_id)
        if session is None:
            self._append_log(
                f"[UPLOAD_BEFORE_SEND][DONE_NO_SESSION] "
                f"control_message_id={control_message_id} session_id={session_id}",
                echo=True,
            )
            return
        self._append_log(
            f"[UPLOAD_BEFORE_SEND][UPLOAD_DONE_SEND] "
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

    def _on_upload_before_send_control_failed(self, control_message_id, detail=""):
        pending = self._pop_pending_upload_send(control_message_id)
        if not pending:
            return
        session_id = (pending.get("session_id") or "").strip()
        raw_user_text = (pending.get("raw_user_text") or "").strip()
        from_pending_bootstrap = bool(pending.get("from_pending_bootstrap"))
        reason_text = (detail or "").strip() or "未返回具体原因"
        self._append_log(
            f"[UPLOAD_BEFORE_SEND][CANCEL_SEND] "
            f"control_message_id={control_message_id} "
            f"session_id={session_id} reason={reason_text}",
            echo=True,
        )
        if (
            raw_user_text
            and not from_pending_bootstrap
            and session_id == self._current_session_id
        ):
            self.message_edit.setPlainText(raw_user_text)
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
        if not server.is_server_running():
            return "", "", "", "请先启动桥接服务"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
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
                    remote.get("conversation_url") or remote.get("url") or ""
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
            target_client_id, getattr(self, "_last_bridge_status", None)
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
            "source": "gui-manual-upload",
            "session_id": session.session_id if session else "",
            "reset_before_start": True,
            "force_restart": True,
            "require_all_success": True,
            "block_next_chat_on_failed": block_next_chat_on_failed,
        }
        try:
            queued = server.enqueue_control_command(
                command="start_upload",
                target_client_id=cid,
                target_page_instance_id=pins,
                target_conversation_id=conv,
                payload=payload,
            )
        except Exception as error:
            detail = (
                f"[UPLOAD_TRIGGER][FAILED] reason=exception {error}\n"
                f"{traceback.format_exc()}"
            )
            self._append_log(detail, echo=True)
            return False
        if not queued:
            self._append_log(
                "[UPLOAD_TRIGGER][FAILED] reason=enqueue_returned_falsy",
                echo=True,
            )
            return False
        message_id = ""
        if isinstance(queued, dict):
            message_id = (queued.get("id") or "").strip()
        self._append_log(
            "[UPLOAD_TRIGGER][QUEUED] "
            f"session_id={(session.session_id if session else '-')} "
            f"client_id={cid} "
            f"page_instance_id={pins} "
            f"conversation_id={conv} "
            f"command_message_id={message_id or '-'} "
            f"block_next_chat_on_failed={block_next_chat_on_failed}",
            echo=True,
        )
        return True

    def _pending_reply_age_seconds(self, session):
        if session is None:
            return 0.0
        since = float(getattr(session, "pending_reply_since", 0) or 0)
        if since <= 0:
            for message in reversed(session.messages):
                if not getattr(message, "visible_in_chat", True):
                    continue
                if message.role != "assistant":
                    continue
                status = (message.status or "").strip()
                text = (message.content or "").strip()
                if status in PENDING_ASSISTANT_STATUSES or text in ASSISTANT_WAIT_TEXTS:
                    since = float(getattr(message, "created_at", 0) or 0)
                    break
        if since <= 0:
            return 0.0
        return max(0.0, time.time() - since)

    def _should_clear_pending_reply(self, session, reason, page_state):
        age = self._pending_reply_age_seconds(session)
        reason = (reason or "").strip()
        page_state = (page_state or "").strip().lower()

        if reason in ("ack_received", "snapshot_applied", "send_failed"):
            return True

        if reason == "bridge_status_tick":
            if age < 60:
                return False
            if page_state == "idle":
                return False

        if age >= 120:
            return True

        return False

    def _clear_stale_pending_reply_if_bound_page_idle(self, session, reason=""):
        """
        清理陈旧的等待占位。不得仅凭 bridge_status_tick + idle 在发送后短时间内清掉 pending。
        """
        if session is None:
            return False

        if not self._session_has_pending_assistant_reply(session):
            return False

        response_ready, response_msg = self._check_bound_client_response_ready(session)
        response_state = self._session_bound_response_state(session)
        state = (response_state.get("response_state") or "").strip().lower()
        age = self._pending_reply_age_seconds(session)
        reason_key = (reason or "").strip()

        force_clear = reason_key in ("ack_received", "snapshot_applied", "send_failed")

        if not self._should_clear_pending_reply(session, reason_key, state):
            if reason_key == "bridge_status_tick" and age < 60:
                if self._is_debug_mode_enabled():
                    self._append_log(
                        "[PENDING_REPLY][KEEP] "
                        f"session_id={session.session_id} "
                        f"reason=too_new age={age:.1f} state={state or '-'}",
                        echo=True,
                    )
            elif reason_key != "bridge_status_tick":
                self._append_log(
                    "[PENDING_REPLY][KEEP] "
                    f"session_id={session.session_id} "
                    f"reason={reason_key or '-'} "
                    f"age={age:.1f} "
                    f"response_ready={response_ready} "
                    f"response_msg={response_msg or '-'} "
                    f"state={state or '-'}",
                    echo=True,
                )
            return False

        if (
            not force_clear
            and (
                not response_ready
                or bool(response_state.get("is_responding"))
                or state in ("generating", "waiting", "pending", "queued")
            )
            and age < 120
        ):
            if reason_key != "bridge_status_tick":
                self._append_log(
                    "[PENDING_REPLY][KEEP] "
                    f"session_id={session.session_id} "
                    f"reason={reason_key or '-'} "
                    f"age={age:.1f} "
                    f"response_ready={response_ready} "
                    f"response_msg={response_msg or '-'} "
                    f"state={state or '-'}",
                    echo=True,
                )
            return False

        cleared = 0

        for message in reversed(session.messages):
            if not getattr(message, "visible_in_chat", True):
                continue

            if message.role != "assistant":
                continue

            bridge_id = (getattr(message, "bridge_message_id", "") or "").strip()
            if bridge_id and hasattr(self, "_is_finalized") and self._is_finalized(bridge_id):
                continue

            status = (message.status or "").strip()
            text = (message.content or "").strip()

            if status in PENDING_ASSISTANT_STATUSES or text in ASSISTANT_WAIT_TEXTS:
                message.role = "error"
                message.status = "已重置"
                message.content = (
                    "上一条回复的本地等待状态已重置。"
                    "如果网页中已有回复，请点击「同步网页对话」刷新完整内容。"
                )

                if bridge_id:
                    self._finalize_bridge(bridge_id)
                    if hasattr(self, "_ack_success_message_ids"):
                        self._ack_success_message_ids.discard(bridge_id)

                cleared += 1
                break

        if getattr(session, "has_pending_reply", False):
            session.has_pending_reply = False
            session.pending_reply_since = 0
            cleared += 1

        if cleared <= 0:
            return False

        if hasattr(self, "_mark_session_waiting_finished"):
            self._mark_session_waiting_finished(
                session, reason="clear_stale_pending"
            )

        session.updated_at = time.time()

        log_tag = "[PENDING_REPLY][CLEARED_STALE]"
        if age >= 120:
            log_tag = "[PENDING_REPLY][TIMEOUT]"
        self._append_log(
            f"{log_tag} "
            f"session_id={session.session_id} "
            f"reason={reason_key or '-'} "
            f"state={state or '-'} "
            f"age={age:.1f} "
            f"cleared={cleared}",
            echo=True,
        )

        self._add_system_message(
            "检测到当前绑定页面已空闲，但本地仍残留“等待回复”状态，已自动重置。"
            "如需网页里的完整回复，请点击「同步网页对话」。"
        )

        if session.session_id == self._current_session_id:
            self._render_session_chat(session, force_bottom=True)

        self._refresh_session_list(select_session_id=self._current_session_id)
        self._save_sessions_to_disk()

        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()

        return True

    def _update_upload_action_buttons_state(self):
        if not hasattr(self, "trigger_upload_btn") or not hasattr(
            self, "upload_and_send_btn"
        ):
            return

        session = self._current_session()
        server_running = server.is_server_running()

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

    def _on_trigger_upload_clicked(self):
        self._append_log("[UPLOAD_TRIGGER][CLICK]", echo=True)

        if not server.is_server_running():
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
        if not server.is_server_running():
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
        busy_reason = self._session_send_busy_reason(session)

        if busy_reason == "pending_reply":
            self._clear_stale_pending_reply_if_bound_page_idle(
                session,
                reason="upload_and_send",
            )
            busy_reason = self._session_send_busy_reason(session)

        if busy_reason:
            self._add_system_message(
                f"当前会话正忙（{busy_reason}），请等待完成后再使用上传并发送。"
            )
            self._append_log(
                f"[UPLOAD_AND_SEND][BLOCKED] reason=session_busy detail={busy_reason}",
                echo=True,
            )
            return
        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            self._add_system_message(
                response_msg or "当前绑定页面暂不可发送，请稍后再试。"
            )
            self._append_log(
                "[UPLOAD_AND_SEND][BLOCKED] reason=response_not_ready",
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
        send_result = self._push_message_text(
            session,
            content,
            force_upload_before_send=True,
            source="upload_and_send",
        )
        if isinstance(send_result, dict) and send_result.get("ok"):
            reason = send_result.get("reason") or ""
            if reason == "waiting_upload_done":
                self._append_log("[UPLOAD_AND_SEND][WAIT_UPLOAD_DONE]", echo=True)
            else:
                self._append_log("[UPLOAD_AND_SEND][SEND_QUEUED]", echo=True)
        else:
            reason = (
                (send_result or {}).get("reason")
                if isinstance(send_result, dict)
                else send_result
            )
            self._append_log(
                f"[UPLOAD_AND_SEND][BLOCKED] reason=send_not_queued detail={reason}",
                echo=True,
            )

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
        message.status = (status or "").strip()
        session.updated_at = time.time()
        return True

    def _init_bridge_status_aggregation(self):
        self._bridge_status_dirty = False
        self._pending_bridge_status_for_flush = None
        timer = QTimer(self)
        timer.setSingleShot(True)
        timer.timeout.connect(self._flush_aggregated_bridge_status)
        self._bridge_status_flush_timer = timer

    def _on_bridge_status_signal(self, status):
        self._pending_bridge_status_for_flush = status
        self._bridge_status_dirty = True
        if not self._bridge_status_flush_timer.isActive():
            self._bridge_status_flush_timer.start(
                self.BRIDGE_STATUS_UI_MIN_INTERVAL_MS
            )

    def _flush_aggregated_bridge_status(self):
        self._bridge_status_dirty = False
        status = getattr(self, "_pending_bridge_status_for_flush", None)
        if status is None:
            return
        self._schedule_status_apply_throttled(status, reason="status_signal", delay_ms=500)

    def _is_debug_mode_enabled(self):
        return bool(
            getattr(self, "_debug_mode_enabled", False)
            or getattr(self, "debug_mode_enabled", False)
            or getattr(self, "_debug_mode", False)
            or getattr(self, "debug_mode", False)
        )

    def _should_show_gui_log_line(self, line):
        text = str(line or "")

        if self._is_debug_mode_enabled():
            return True

        noisy_markers = (
            "[TM][HEARTBEAT]",
            "[TM_ACTIVITY][CLASSIFY]",
            "[BRIDGE][POLL][REQUEST]",
            "[STATUS_APPLY][STEP]",
            "[TM_SELECTOR][ITEM]",
            "[PAGE_RELATION_DISPLAY]",
            "[PERF][STATUS_APPLY]",
        )

        for marker in noisy_markers:
            if marker in text:
                return False

        if "[BRIDGE][POLL][NO_MESSAGE]" in text:
            noisy_reasons = (
                "reason=queue_empty",
                "reason=home_bootstrap_only",
                "reason=client_busy",
                "reason=no_message",
            )
            for reason in noisy_reasons:
                if reason in text:
                    return False

        return True

    def _make_light_status_signature(self, status=None):
        status = status or getattr(self, "_last_bridge_status", None) or {}
        summary = self._tm_summary_for_session()
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        current_info = self._find_focused_tm_page(status)
        bound_client = (remote.get("client_id") or "").strip()
        bound_conv = self._remote_conversation_id(remote) or ""
        active_client = ((current_info or {}).get("client_id") or "").strip()
        active_conv = self._client_conversation_id(current_info) or ""
        pages = self._extract_tm_pages_from_status(status)
        online_count = summary.get("online_clients", 0)
        total_count = summary.get("total_clients", 0)
        last_focus_at = int(float(status.get("last_focused_tm_page_at") or 0))
        return "|".join([
            str(len(pages)),
            str(online_count),
            str(total_count),
            str(active_client),
            str(active_conv),
            str(bound_client),
            str(bound_conv),
            str(last_focus_at),
        ])

    def _make_tm_clients_signature(self, clients):
        parts = []
        for client in clients or []:
            if not isinstance(client, dict):
                continue
            parts.append("|".join([
                str(client.get("client_id", "")),
                str(client.get("page_instance_id", "")),
                str(client.get("conversation_id", "")),
                str(
                    client.get("url")
                    or client.get("page_url")
                    or client.get("normalized_url")
                    or ""
                ),
                str(client.get("visible") or client.get("visibility_state") or ""),
                str(
                    client.get("focus")
                    or client.get("has_focus")
                    or client.get("focused")
                    or ""
                ),
                str(client.get("responding") or client.get("is_responding") or ""),
                str(client.get("input") or client.get("can_accept_input") or ""),
                str(client.get("state") or client.get("response_state") or ""),
            ]))
        return "\n".join(sorted(parts))

    def _schedule_status_apply_throttled(self, status=None, reason="unknown", delay_ms=300):
        reason = reason or "unknown"
        noisy_reasons = {
            "heartbeat",
            "poll",
            "poll_request",
            "poll_no_message",
            "activity_classify",
            "queue_empty",
            "client_busy",
            "status_signal",
            "status_timer",
            "deferred_bridge_status",
        }

        now = time.time()
        status = status or {}

        if reason in noisy_reasons:
            new_sig = self._make_light_status_signature(status)
            old_sig = getattr(self, "_last_light_status_signature", "")
            if new_sig == old_sig:
                return
        else:
            new_sig = ""

        last_at = getattr(self, "_last_status_apply_schedule_at", 0.0)
        elapsed = now - last_at

        if elapsed < 1.0:
            self._pending_status_payload = status
            self._pending_status_apply_reason = reason

            if not getattr(self, "_delayed_status_apply_timer_active", False):
                self._delayed_status_apply_timer_active = True
                remaining_ms = max(80, int((1.0 - elapsed) * 1000))

                def run_delayed_status_apply():
                    self._delayed_status_apply_timer_active = False
                    pending_status = getattr(self, "_pending_status_payload", None)
                    pending_reason = getattr(
                        self, "_pending_status_apply_reason", "delayed_status_apply"
                    )
                    self._pending_status_payload = None
                    self._pending_status_apply_reason = ""

                    if pending_status is None and server.is_server_running():
                        pending_status = server.get_bridge_status()

                    if pending_status is not None:
                        if pending_reason in noisy_reasons:
                            sig = self._make_light_status_signature(pending_status)
                            self._last_light_status_signature = sig
                        self._last_status_apply_schedule_at = time.time()
                        self._schedule_status_apply(
                            status=pending_status,
                            reason=pending_reason,
                            delay_ms=0,
                            force=True,
                        )

                QTimer.singleShot(remaining_ms, run_delayed_status_apply)

            return

        if reason in noisy_reasons:
            self._last_light_status_signature = new_sig

        self._last_status_apply_schedule_at = now
        self._schedule_status_apply(status=status, reason=reason, delay_ms=delay_ms)

    def _debug_status_step(self, text):
        if not self._is_debug_mode_enabled():
            return
        self._append_log(text)

    def _schedule_status_apply_after_session_switch(self):
        if getattr(self, "_pending_after_switch_status_apply", False):
            return
        self._pending_after_switch_status_apply = True
        QTimer.singleShot(350, self._run_after_switch_status_apply)

    def _run_after_switch_status_apply(self):
        self._pending_after_switch_status_apply = False
        now = time.time()
        if now - getattr(self, "_last_session_switch_status_apply_at", 0.0) < 0.5:
            return
        self._last_session_switch_status_apply_at = now
        self._schedule_status_apply(reason="session_switch_delayed", delay_ms=0)

    def _schedule_status_apply(self, status=None, reason="unknown", delay_ms=None, force=False):
        reason = reason or "unknown"
        if not force and reason in self.LIGHTWEIGHT_STATUS_REASONS:
            new_sig = self._make_light_status_signature(status)
            if new_sig == getattr(self, "_last_light_status_signature", ""):
                return
            self._last_light_status_signature = new_sig
            now = time.time()
            if now - getattr(self, "_last_status_apply_at", 0.0) < self.STATUS_APPLY_MIN_INTERVAL_SEC:
                return
        if getattr(self, "_session_switching", False) and not force:
            self._pending_after_switch_status_apply = True
            if status is not None:
                self._pending_status_payload = status
            return
        if status is not None:
            self._pending_status_payload = status
        self._pending_status_apply_reason = reason
        if force:
            self._status_apply_pending = False
            payload = status
            if payload is None:
                payload = getattr(self, "_pending_status_payload", None)
            if payload is None and server.is_server_running():
                payload = server.get_bridge_status()
            self._apply_bridge_status(payload or {}, reason=reason, force=True)
            return
        delay = self.STATUS_APPLY_DEBOUNCE_MS if delay_ms is None else max(0, int(delay_ms))
        if getattr(self, "_status_apply_pending", False):
            return
        self._status_apply_pending = True
        QTimer.singleShot(delay, self._run_scheduled_status_apply)

    def _resolve_bridge_status_payload(self, status=None):
        if isinstance(status, dict) and status:
            return status

        if server.is_server_running():
            live_status = server.get_bridge_status()
            if isinstance(live_status, dict) and live_status:
                return live_status

        if isinstance(status, dict):
            return status

        return {}

    def _run_scheduled_status_apply(self):
        self._status_apply_pending = False
        reason = getattr(self, "_pending_status_apply_reason", "unknown")
        self._current_status_apply_reason = reason
        self._pending_status_apply_reason = ""

        status = getattr(self, "_pending_status_payload", None)
        self._pending_status_payload = None

        status = self._resolve_bridge_status_payload(status)
        self._apply_bridge_status(status, reason=reason)

    def _build_status_snapshot_key(self, status):
        status = status or {}
        summary = self._tm_summary_for_session()
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        current_info = self._find_focused_tm_page(status)
        bound_info, bound_state, _bound_reason = self._resolve_bound_page_info(status=status)
        current_client = ((current_info or {}).get("client_id") or "").strip()
        current_conv = self._client_conversation_id(current_info) or ""
        bound_client = (remote.get("client_id") or "").strip()
        if not bound_client and isinstance(bound_info, dict):
            bound_client = (bound_info.get("client_id") or "").strip()
        bound_conv = self._remote_conversation_id(remote) or ""
        if not bound_conv and isinstance(bound_info, dict):
            bound_conv = self._client_conversation_id(bound_info) or ""
        target = self._sync_target_snapshot(
            status=status, bound_info=bound_info, current_info=current_info
        )
        target_client = (target.get("client_id") or "").strip()
        target_conv = (target.get("conversation_id") or "").strip()
        active_matches_bound = bool(
            target.get("active_matches_bound")
            if target.get("active_matches_bound") is not None
            else False
        )
        return "|".join([
            str(current_client or "-"),
            str(current_conv or "-"),
            str(bound_client or "-"),
            str(bound_conv or "-"),
            str(target_client or "-"),
            str(target_conv or "-"),
            str(bound_state or "-"),
            str(active_matches_bound),
            str(summary.get("online_clients", 0)),
            str(summary.get("total_clients", 0)),
            str(bool(status.get("server_running"))),
            str(summary.get("bound_online")),
            str(self._current_session_id or "-"),
        ])

    def _render_status_summary(self, status):
        status = status or {}
        host, port = self._service_host_port_for_display(status)
        last_seen = status.get("tampermonkey_last_seen")
        page_url = self._tampermonkey_page_url or status.get("tampermonkey_page_url") or "-"
        if status.get("tampermonkey_online"):
            tm_text = "在线"
        elif last_seen:
            tm_text = "离线"
        else:
            tm_text = "未连接"
        lines = [
            f"服务运行：{'是' if status.get('server_running') else '否'}",
            f"监听地址：{host}:{port}",
            f"油猴状态：{tm_text}",
            f"最后心跳：{self._format_ts(last_seen)}",
            f"油猴 client_id：{status.get('tampermonkey_client_id') or '-'}",
            f"全局绑定 client_id：{status.get('bound_client_id') or '-'}",
            f"本对话绑定 client_id：{self._session_bound_client_id() or '-'}",
            f"已知 ChatGPT 页面数：{len(status.get('tampermonkey_clients') or [])}",
        ]
        summary = self._tm_summary_for_session()
        lines.extend([
            f"油猴在线：{summary.get('online_clients', 0)} / 总 {summary.get('total_clients', 0)}",
            f"会话页在线：{summary.get('online_conversation_clients', 0)}",
            f"首页在线：{summary.get('online_home_clients', 0)}",
            f"绑定在线：{summary.get('bound_online')}",
            f"活跃 client：{summary.get('active_client_id') or '-'}",
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
        summary_text = "\n".join(lines)
        if hasattr(self, "_is_log_tab_visible") and self._is_log_tab_visible():
            if hasattr(self, "status_log_edit") and self.status_log_edit is not None:
                self.status_log_edit.setPlainText(summary_text)
        return summary_text
    @staticmethod
    def _refresh_status_chip(label, state=""):
        state = state or ""
        if label.property("state") == state:
            return
        label.setProperty("state", state)
        style = label.style()
        style.unpolish(label)
        style.polish(label)

    def _flush_suspended_status_apply(self):
        self._status_apply_suspended_timer_active = False
        status = getattr(self, "_pending_status_payload", None)
        self._pending_status_payload = None
        if status is None and server.is_server_running():
            status = server.get_bridge_status()
        self._schedule_status_apply(
            status or {},
            reason="status_after_session_switch_suspend",
            delay_ms=0,
        )

    def _flush_deferred_bridge_status(self):
        self._bridge_status_defer_timer_active = False
        pending = getattr(self, "_deferred_bridge_status", None)
        self._deferred_bridge_status = None
        if pending is not None:
            self._schedule_status_apply_throttled(
                pending, reason="deferred_bridge_status", delay_ms=500
            )

    def _apply_bridge_status(self, status, reason="", force=False):
        status = self._resolve_bridge_status_payload(status)

        if not reason:
            reason = getattr(self, "_pending_status_apply_reason", "") or ""

        suspend_until = float(getattr(self, "_suspend_status_ui_until", 0.0) or 0.0)
        now = time.time()
        if not force and suspend_until > now:
            self._pending_status_payload = status
            if not getattr(self, "_status_apply_suspended_timer_active", False):
                self._status_apply_suspended_timer_active = True
                delay_ms = max(50, int((suspend_until - now) * 1000) + 50)
                QTimer.singleShot(delay_ms, self._flush_suspended_status_apply)
            return

        if getattr(self, "_session_switching", False) and not force:
            self._pending_after_switch_status_apply = True
            if status:
                self._pending_status_payload = status
            return
        now = time.time()
        if (
            not force
            and now - getattr(self, "_last_status_apply_at", 0.0)
            < self.STATUS_APPLY_MIN_INTERVAL_SEC
        ):
            return
        if not force:
            snapshot_key = self._build_status_snapshot_key(status)
            if snapshot_key == getattr(self, "_last_status_snapshot_key", ""):
                now = time.time()
                if now - getattr(self, "_last_status_apply_at", 0.0) < self.STATUS_APPLY_DEDUP_SEC:
                    return
            self._last_status_snapshot_key = snapshot_key

        now_ms = int(time.time() * 1000)
        last_ms = getattr(self, "_last_bridge_status_ui_apply_ms", 0)
        interval = self.BRIDGE_STATUS_UI_MIN_INTERVAL_MS
        if not force and now_ms - last_ms < interval:
            self._deferred_bridge_status = status
            if not getattr(self, "_bridge_status_defer_timer_active", False):
                self._bridge_status_defer_timer_active = True
                delay = max(1, interval - (now_ms - last_ms))
                QTimer.singleShot(delay, self._flush_deferred_bridge_status)
            return

        if getattr(self, "_applying_bridge_status", False):
            self._pending_bridge_status = status
            return

        self._current_status_apply_reason = reason or getattr(
            self, "_pending_status_apply_reason", ""
        )
        self._last_status_apply_at = time.time()
        self._last_bridge_status_ui_apply_ms = now_ms
        self._applying_bridge_status = True
        try:
            self._apply_bridge_status_impl(status)
        except Exception as error:
            detail = f"刷新桥接状态失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
        finally:
            self._applying_bridge_status = False
            pending = getattr(self, "_pending_bridge_status", None)
            self._pending_bridge_status = None
            if pending is not None:
                QTimer.singleShot(
                    0,
                    lambda s=pending: self._schedule_status_apply(s, reason="pending_replay"),
                )

    def _is_job_scheduler_panel_visible(self):
        tabs = getattr(self, "chat_sub_tabs", None)
        if tabs is not None:
            return tabs.currentIndex() == getattr(self, "CHAT_SUB_TAB_CURSOR_FLOW", 1)
        edit = getattr(self, "cursor_task_log_edit", None)
        return edit is not None and edit.isVisible()

    def _has_active_job_from_status(self, status):
        status = status or {}
        job_scheduler_data = status.get("job_scheduler") or {}
        if job_scheduler_data.get("active_job"):
            return True
        if getattr(self, "_active_job_id", ""):
            return True
        return False

    def _apply_bridge_status_impl(self, status):
        status = status or {}
        self._last_bridge_status = status
        apply_t0 = time.perf_counter()
        service_ms = 0
        summary_ms = 0
        live_page_ms = 0
        bound_page_ms = 0
        selector_ms = 0
        tm_table_ms = 0
        job_panel_ms = 0
        session_list_ms = 0
        apply_reason = (
            getattr(self, "_current_status_apply_reason", "")
            or getattr(self, "_pending_status_apply_reason", "")
            or ""
        )
        skip_heavy_ui = apply_reason in (
            "session_switch",
            "session_switch_delayed",
        ) or getattr(self, "_session_switching", False)
        self._debug_status_step("[STATUS_APPLY][STEP] start")
        t_service = time.perf_counter()
        server_running = bool(status.get("server_running"))
        if server_running:
            service_url = (
                status.get("server_url")
                or server.get_server_url()
                or ""
            )
            self.status_label.setText("服务：运行中")
            if service_url:
                self.status_label.setToolTip(f"服务地址：{service_url}")
                self.statusBar().showMessage(f"服务运行中 {service_url}")
            else:
                self.status_label.setToolTip("")
                self.statusBar().showMessage("服务运行中")
            self._server_start_failed = False
            self._server_start_error = ""
            self._refresh_status_chip(self.status_label, "ok")
        elif getattr(self, "_server_start_failed", False):
            self.status_label.setText("服务：启动失败")
            self.status_label.setToolTip("")
            self.statusBar().showMessage("服务启动失败")
            self._refresh_status_chip(self.status_label, "error")
        else:
            self.status_label.setText("服务：停止")
            self.status_label.setToolTip("")
            self.statusBar().showMessage("服务已停止")
            self._refresh_status_chip(self.status_label, "error")
        service_ms = int((time.perf_counter() - t_service) * 1000)
        self._debug_status_step("[STATUS_APPLY][STEP] service_label")
        t_summary = time.perf_counter()
        last_seen = status.get("tampermonkey_last_seen")
        last_seen_text = self._format_ts(last_seen)
        summary = self._tm_summary_for_session()
        display_online, display_total = self._tm_display_counts_from_status(
            status, summary=summary
        )
        summary_for_chip = dict(summary)
        summary_for_chip["online_clients"] = display_online
        summary_for_chip["total_clients"] = display_total
        monkey_stats = self._collect_monkey_window_binding_stats(status)
        if last_seen is None and display_total <= 0:
            self.tm_online_label.setText("油猴：未连接")
            self._refresh_status_chip(self.tm_online_label, "")
            self.tm_online_label.setToolTip("")
        else:
            chip_text, chip_state = self._format_tm_online_chip_text(summary_for_chip)
            self.tm_online_label.setText(chip_text)
            self._refresh_status_chip(self.tm_online_label, chip_state or "")
        if last_seen is not None or display_total > 0:
            recent_focus_id = self._recent_focus_home_client_id(status)
            bound_client_id = (self._session_bound_client_id() or "").strip()
            if not bound_client_id:
                bind_detail = "当前对话未绑定页面"
                bound_state_text = "unbound"
            else:
                bound_info = self._client_info_by_id(bound_client_id, status=status)
                bound_online = bool(
                    bound_info and self._tm_page_is_online_simple(bound_info)
                )
                if bound_online:
                    bind_detail = f"绑定 client={bound_client_id}，状态=在线"
                    bound_state_text = "online"
                else:
                    bind_detail = f"绑定 client={bound_client_id}，状态=离线"
                    bound_state_text = "offline"
            tooltip_lines = [
                f"最后全局心跳：{last_seen_text}",
                f"在线 {display_online} / 总 {display_total}",
                f"会话页 {summary.get('online_conversation_clients', 0)} / "
                f"首页 {summary.get('online_home_clients', 0)}",
                f"最近焦点首页：{recent_focus_id or '-'}",
                f"当前对话绑定：{bind_detail}",
                f"bound_state={bound_state_text}",
                f"活跃 client={summary.get('active_client_id') or '-'}",
            ]
            self.tm_online_label.setToolTip("\n".join(tooltip_lines))
        self._update_tm_blank_home_label(status, monkey_stats)
        if hasattr(self, "update_monkey_binding_summary"):
            self.update_monkey_binding_summary(status, monkey_stats=monkey_stats)
        self._log_tm_status_summary(summary)
        self._log_bind_mismatch_if_needed(summary)
        ctrl_q = status.get("control_queue_length", 0)
        current_q = self._current_session_queue_size()
        total_q = self._total_session_queue_size()
        self.tm_queue_label.setText(
            f"队列：当前 {current_q} / 总 {total_q} / 控制 {ctrl_q}"
        )
        summary_ms = int((time.perf_counter() - t_summary) * 1000)
        self._debug_status_step("[STATUS_APPLY][STEP] tm_summary")
        live_url = status.get("tampermonkey_page_url") if summary.get("online_clients") else None
        t_live = time.perf_counter()
        self._update_live_page_display(live_url, summary=summary)
        live_page_ms = int((time.perf_counter() - t_live) * 1000)
        self._debug_status_step("[STATUS_APPLY][STEP] live_page")
        QTimer.singleShot(0, lambda s=status: self._try_finish_pending_auto_bind(s))
        QTimer.singleShot(0, lambda s=status: self._try_finish_waiting_bound_conversations(s))
        QTimer.singleShot(0, lambda: self._check_bootstrap_claim_timeouts())
        QTimer.singleShot(0, lambda s=status: self._sync_bound_session_urls_from_clients(s))
        QTimer.singleShot(0, lambda s=status: self._poll_wait_conversation_sync_requests(s))
        QTimer.singleShot(0, lambda s=status: self._auto_bind_current_session_if_needed(s))
        t_bound = time.perf_counter()
        self._update_bound_page_display(summary=summary)
        bound_page_ms = int((time.perf_counter() - t_bound) * 1000)
        self._debug_status_step("[STATUS_APPLY][STEP] bound_page")
        if skip_heavy_ui:
            if self._is_debug_mode_enabled():
                self._append_log(
                    "[STATUS_APPLY][SKIP_HEAVY] "
                    f"reason={apply_reason or 'session_switch'} "
                    "skip=page_selector,tm_table",
                    echo=False,
                )
        else:
            clients = list(self._extract_tm_pages_from_status(status))
            clients_sig = self._make_tm_clients_signature(clients)
            old_clients_sig = getattr(self, "_last_tm_clients_signature", "")
            if clients_sig != old_clients_sig:
                self._last_tm_clients_signature = clients_sig
            t_selector = time.perf_counter()
            self._refresh_tm_page_selector(status)
            selector_ms = int((time.perf_counter() - t_selector) * 1000)
            self._debug_status_step("[STATUS_APPLY][STEP] page_selector")
            if clients_sig != old_clients_sig:
                if hasattr(self, "_is_tm_pages_table_visible") and self._is_tm_pages_table_visible():
                    t_tm = time.perf_counter()
                    self._render_tampermonkey_clients(status)
                    tm_table_ms = int((time.perf_counter() - t_tm) * 1000)
                self._debug_status_step("[STATUS_APPLY][STEP] tm_table")
            elif self._is_debug_mode_enabled():
                self._append_log(
                    "[STATUS_APPLY][SKIP] tm_table unchanged",
                    echo=False,
                )
        inbound_items = status.get("recent_inbound") or []
        outbound_items = status.get("recent_outbound") or []
        self._handle_inbound_events(inbound_items)
        if hasattr(self, "_is_log_tab_visible") and self._is_log_tab_visible():
            self._render_inbound_log(inbound_items)
            self._render_outbound(outbound_items)
            self._render_status_summary(status)
        elif hasattr(self, "_mark_log_subtabs_pending_refresh"):
            self._mark_log_subtabs_pending_refresh()
        self._debug_status_step("[STATUS_APPLY][STEP] status_summary")
        self._update_tampermonkey_settings_labels(status)
        self._update_service_settings_status()
        self._refresh_cursor_bridge_status(status.get("cursor_bridge"))
        if hasattr(self, "_refresh_job_scheduler_panel"):
            if self._is_job_scheduler_panel_visible() or self._has_active_job_from_status(status):
                t_job = time.perf_counter()
                self._refresh_job_scheduler_panel(status.get("job_scheduler"))
                job_panel_ms = int((time.perf_counter() - t_job) * 1000)
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

    def _handle_open_url_result_event(self, item, payload, kind):
        url = payload.get("url") or ""
        detail = payload.get("detail") or ""
        if kind == "open_url_success":
            self._append_log(f"[打开网页] 成功：{url} {detail}".strip())
        else:
            self._append_log(f"[打开网页] 失败：{url} {detail}".strip())

    def _handle_command_result_event(self, item, payload, kind):
        page_url = payload.get("page_url") or ""
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
            if pending_key and pending_key in getattr(
                self, "_pending_upload_sends", {}
            ):
                self._on_upload_before_send_control_failed(
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
            f"{mismatch_payload.get('bind_request_id') or mismatch_payload.get('launch_token') or '-'} "
            f"client_id={item.get('client_id') or '-'} "
            f"page_instance_id={mismatch_payload.get('page_instance_id') or '-'}"
        )

    def _resolve_inbound_session_binding(self, item, payload, kind):
        session, turn_id, bridge_id = self._resolve_inbound_binding(item)
        if session is not None and turn_id:
            return session, turn_id, bridge_id
        if kind not in ("send_success", "send_message_result", "assistant_message"):
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
            "[CHAT_SEND][ACK] "
            f"request_id={bridge_id or '-'} "
            f"session_id={session.session_id} "
            f"ok={'true' if ok else 'false'} "
            f"status={(payload.get('status') or payload.get('reason') or '-')}",
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
                message.status = "已发送" if ok else "发送失败"
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
        text = (payload.get("content") or payload.get("text") or "").strip()
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
        self._append_log(
            "[CHAT_SEND][ACK] "
            f"request_id={bridge_id or '-'} "
            f"session_id={session.session_id} "
            f"ok={'true' if success else 'false'} "
            f"detail={detail_text or '-'}",
            echo=True,
        )
        if success:
            self._append_log(
                "[CHAT_SEND][BROWSER_SENT] "
                f"request_id={bridge_id or '-'} "
                f"session_id={session.session_id}",
                echo=True,
            )
        ack_status = (
            "sent"
            if success
            else f"发送失败({detail_text or 'unknown'})"
        )
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
                target_user.status = (
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
                self._ack_success_message_ids.add(bridge_id)
                self._set_reply_waiting(session, turn_id)
            report_client = (item.get("client_id") or "").strip()
            if report_client:
                remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
                if not remote_now.get("bootstrap_in_progress"):
                    self._remember_session_page_from_client(
                        session, report_client
                    )
                self._update_bound_page_display()
        else:
            self._ack_success_message_ids.discard(bridge_id)
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote_now.get("bootstrap_in_progress"):
                session.remote_chatgpt = {
                    **remote_now,
                    "bootstrap_in_progress": False,
                }
                self._save_sessions_to_disk()
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
        self._ack_success_message_ids.discard(bridge_id)
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
            target_user.status = "发送失败"
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

    def _handle_assistant_reply_event(
        self, item, payload, session, turn_id, bridge_id
    ):
        if self._is_finalized(bridge_id):
            return
        text = (payload.get("text") or payload.get("content") or "").strip()
        if self._upsert_assistant_reply_from_bridge(
            session,
            turn_id,
            bridge_id,
            text,
            render_reason="assistant_reply",
        ):
            self._finalize_bridge(bridge_id)
            self._ack_success_message_ids.discard(bridge_id)
            report_client = (item.get("client_id") or "").strip()
            if report_client:
                self._remember_session_page_from_client(
                    session, report_client
                )
                self._update_bound_page_display()
            if getattr(self, "_auto_sync_conversation_after_reply", False):
                self._schedule_auto_sync_conversation(
                    session, request_reason="auto_after_reply"
                )
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
        self._ack_success_message_ids.discard(bridge_id)
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
            pending = (
                getattr(self, "_pending_upload_sends", {}).get(str(control_message_id))
                if control_message_id
                else None
            )
            if pending:
                self._on_upload_before_send_control_done(control_message_id)
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
            return
        self._append_log(
            f"[控制完成] command={command or '-'} client_id={client_id}",
            echo=True,
        )

    def _handle_inbound_events(self, items):
        for item in items:
            event_key = (
                item.get("event_id") or item.get("id") or self._make_inbound_key(item)
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
            page_url = payload.get("page_url") or ""
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

    def _render_inbound_log(self, items):
        if not items:
            self.event_log_edit.setPlainText("（暂无回传）")
            return
        lines = []
        for item in reversed(items):
            kind = item.get("kind", "?")
            if kind in ("open_url_success", "open_url_failed"):
                continue
            if kind == "ack" and not self._log_ack_events:
                continue
            if kind == "assistant_reply" and not self._log_assistant_reply_events:
                continue
            if kind == "send_failed" and not self._log_send_failed_events:
                continue
            ts = self._format_ts(item.get("time"))
            payload = item.get("payload") or {}
            event_id = item.get("event_id") or item.get("id") or "-"
            message_id = item.get("message_id") or "-"
            session_id = item.get("session_id") or "-"
            turn_id = item.get("turn_id") or "-"
            client_id = item.get("client_id") or "-"
            page_hint = ""
            if client_id and client_id != "-":
                pinfo = self._client_info_from_status(client_id)
                if pinfo:
                    page_hint = (
                        f" page_type={pinfo.get('page_type') or '-'} "
                        f"conv={pinfo.get('conversation_id') or '-'}"
                    )
            id_part = (
                f"event_id={event_id} message_id={message_id} "
                f"session_id={session_id} turn_id={turn_id} client_id={client_id}{page_hint}"
            )
            if self._show_raw_payload or self._debug_mode:
                lines.append(f"[{ts}] {kind} {id_part} payload={payload}")
            else:
                text = (
                    payload.get("text")
                    or payload.get("detail")
                    or payload.get("reason")
                    or ""
                )
                lines.append(f"[{ts}] {kind} {id_part} {text}")
        if not lines:
            self.event_log_edit.setPlainText("（暂无回传，或被调试过滤规则隐藏）")
            return
        self.event_log_edit.setPlainText("\n".join(lines))
    def _render_outbound(self, items):
        self.outbound_table.setRowCount(0)
        for item in reversed(items):
            if item.get("type") == "command":
                content = (
                    f"command:{item.get('command', '?')} "
                    f"{item.get('url', '')}"
                )
            else:
                content = item.get("content", "")
            target_client = (item.get("target_client_id") or "").strip()
            target_page = (item.get("target_page_url") or "").strip()
            if target_client or target_page:
                page_short = self._short_page_display(target_page) if target_page else "-"
                content = f"[→{target_client or '?'} @ {page_short}] {content}"
            if len(content) > 80:
                content = content[:80] + "..."
            row = self.outbound_table.rowCount()
            self.outbound_table.insertRow(row)
            ts = self._format_ts(
                item.get("acked_at")
                or item.get("delivered_at")
                or item.get("created_at")
            )
            message_id = item.get("id") or ""
            short_id = message_id[:8] + "…" if message_id else "-"
            self.outbound_table.setItem(row, 0, QTableWidgetItem(ts))
            self.outbound_table.setItem(row, 1, QTableWidgetItem(short_id))
            self.outbound_table.setItem(row, 2, QTableWidgetItem(item.get("status", "")))
            self.outbound_table.setItem(row, 3, QTableWidgetItem(content))
    def _refresh_status_tick(self):
        if server.is_server_running():
            status = server.get_bridge_status()
            self._schedule_status_apply_throttled(
                status=status,
                reason="status_timer",
                delay_ms=500,
            )

    def _append_log(self, message, echo=False):
        line = append_log(message, source="GUI", echo=echo)
        check_text = line or str(message or "")
        if not self._should_show_gui_log_line(check_text):
            return line
        if hasattr(self, "_append_runtime_log_line_to_ui"):
            self._append_runtime_log_line_to_ui(line)
        return line
    def _update_running_ui(self, running):
        if hasattr(self, "enable_lan_access_cb"):
            self.enable_lan_access_cb.setEnabled(not running)
        self.port_edit.setEnabled(not running)
        # 服务按钮不要再禁用成灰色。
        # 重复点击由 _start_server / _stop_server 内部提示“已运行”或“未运行”。
        self.settings_start_btn.setEnabled(True)
        self.settings_stop_btn.setEnabled(True)
        self.chat_quick_start_btn.setEnabled(True)
        self.chat_quick_stop_btn.setEnabled(True)
    def _parse_port(self):
        raw = self.port_edit.text().strip()
        try:
            port = int(raw)
        except ValueError:
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
        server.set_debug_mode(self._debug_mode)
        try:
            result = server.start_server(bind_host, port)
        except Exception as error:
            detail = (
                f"服务启动失败：{error}\n"
                f"host={bind_host} port={port}\n"
                f"{traceback.format_exc()}"
            )
            self._server_start_failed = True
            self._server_start_error = str(error)
            self._append_log(detail, echo=True)
            self._add_system_message(f"服务启动失败：{error}")
            self._update_running_ui(False)
            self._update_service_settings_status()
            return

        if result.get("ok"):
            actual_port = result.get("port")
            if actual_port and int(actual_port) != int(port):
                self.port_edit.setText(str(actual_port))
                self._port_text = str(actual_port)
                self._settings.setValue("port", str(actual_port))
            self._server_start_failed = False
            self._server_start_error = ""
            self._update_running_ui(True)
            QTimer.singleShot(
                200,
                lambda: self._schedule_status_apply(
                    server.get_bridge_status(),
                    reason="server_started",
                    force=True,
                ),
            )
            self._update_service_settings_status()
            self._save_app_settings()
            message = result.get("message") or server.get_server_url()
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
            self._server_start_failed = True
            self._server_start_error = message
            self._append_log(message, echo=True)
            self._add_system_message(message)
            self._update_running_ui(False)
            self._update_service_settings_status()
    def _stop_server(self):
        try:
            stopped = server.stop_server()
        except Exception as error:
            detail = f"服务停止失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"服务停止失败：{error}")
            return
        if stopped:
            self._server_start_failed = False
            self._server_start_error = ""
            self._update_running_ui(False)
            self._schedule_status_apply(
                server.get_bridge_status(),
                reason="server_stopped",
                force=True,
            )
            self._update_service_settings_status()
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
        client_info = self._client_info_by_id(client_id, self._last_bridge_status)
        if not isinstance(client_info, dict):
            return True, ""
        if client_info.get("is_responding"):
            return False, "当前 ChatGPT 页面仍在回答，请等待回复完成后再发送。"
        can_accept_input = bool(client_info.get("can_accept_input", True))
        if not can_accept_input:
            state = (client_info.get("response_state") or "unknown").strip() or "unknown"
            return False, f"当前 ChatGPT 页面暂不可发送（state={state}），请稍后重试。"
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
        if self._session_has_pending_assistant_reply(session):
            return "pending_reply"
        response_state = self._session_bound_response_state(session)
        if bool(response_state.get("is_responding")):
            return "responding"
        state = (response_state.get("response_state") or "").strip().lower()
        if state in ("generating", "waiting", "pending", "queued"):
            return state
        if self._pending_auto_bind_session_id == session.session_id:
            return "waiting_bind"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        if bind_state in (
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
            BIND_STATE_WAITING_BOUND_CONVERSATION,
        ):
            return bind_state.lower()
        if bind_state == BIND_STATE_PREBOUND_HOME:
            client_id = (
                remote.get("prebound_home_client_id") or remote.get("client_id") or ""
            ).strip()
            item = self._client_info_by_id(client_id) if client_id else None
            if isinstance(item, dict) and self._is_prebound_home_page(item):
                return "prebound_home_wait_conversation"
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
        if not hasattr(self, "status_log_edit"):
            return
        self._render_status_summary(getattr(self, "_last_bridge_status", {}) or {})

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
            existing.status = "已加入队列"
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

    def _push_message(self, *, skip_upload_before_send=False, button="send"):
        try:
            return self._push_message_impl(
                skip_upload_before_send=skip_upload_before_send,
                button=button,
            )
        finally:
            if hasattr(self, "dump_top_level_windows"):
                self.dump_top_level_windows("after_send")

    def _push_message_impl(self, *, skip_upload_before_send=False, button="send"):
        if hasattr(self, "dump_top_level_windows"):
            self.dump_top_level_windows("before_send")
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return None
        content = self.message_edit.toPlainText().strip()
        if not content:
            self._add_system_message("请输入要发送的内容。")
            return None
        session = self._ensure_current_session()
        queue_len = (
            len(self._session_send_queue(session.session_id))
            if session is not None
            else 0
        )
        self._append_log(
            "[SEND_CLICK] "
            f"message_len={len(content)} "
            f"session_id={(session.session_id if session else '-')} "
            f"queue_len={queue_len} "
            f"button={button}",
            echo=True,
        )
        trace_id = make_send_trace_id(session.session_id if session else "")
        self._set_active_send_trace_id(trace_id)
        self._append_log(
            "[CHAT_SEND][CLICK] "
            + kv_line(
                trace_id=trace_id,
                button=button,
                session_id=(session.session_id if session else "-"),
                session_title=repr(getattr(session, "title", "") if session else ""),
                text_len=len(content),
                has_text="true" if content.strip() else "false",
            ),
            echo=True,
        )
        self._append_log(
            "[SEND][CLICK] "
            + kv_line(
                trace_id=trace_id,
                button=button,
                session_id=(session.session_id if session else "-"),
                session_title=repr(getattr(session, "title", "") if session else ""),
                text_len=len(content),
                has_text="true" if content.strip() else "false",
            ),
            echo=True,
        )
        remote_click = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        self._append_log(
            "[SEND][CLICK_SIMPLE] "
            f"session_id={(session.session_id if session else '-')} "
            f"bound_client_id={(remote_click.get('client_id') or '-')} "
            f"bound_conversation_id={(self._remote_conversation_id(remote_click) or '-')}",
            echo=True,
        )

        turn_id = str(uuid.uuid4())
        local_message_id = str(uuid.uuid4())
        pending_assistant_message_id = str(uuid.uuid4())
        setattr(self, "_pending_send_turn_id", turn_id)
        setattr(self, "_pending_send_user_message_id", local_message_id)
        setattr(self, "_pending_send_assistant_message_id", pending_assistant_message_id)

        count_before = self._session_visible_message_count(session)
        self._append_log(
            "[CHAT_SEND][LOCAL_APPEND_BEFORE] "
            f"session_id={session.session_id} "
            f"count_before={count_before} "
            f"message_id={local_message_id}",
            echo=True,
        )
        self._append_message_to_session(
            session.session_id,
            {
                "role": "user",
                "content": content,
                "message_id": local_message_id,
                "turn_id": turn_id,
                "status": "准备发送",
                "source": "local_send",
                "created_at": time.time(),
            },
        )
        if getattr(self, "_show_assistant_placeholder", True):
            self._append_message_to_session(
                session.session_id,
                {
                    "role": "assistant",
                    "content": ASSISTANT_WAIT_TEXT,
                    "message_id": pending_assistant_message_id,
                    "turn_id": turn_id,
                    "status": "waiting",
                    "parent_message_id": local_message_id,
                    "source": "local_placeholder",
                },
            )
            session.has_pending_reply = True
            session.pending_reply_since = time.time()
            if hasattr(self, "_mark_session_waiting_started"):
                self._mark_session_waiting_started(
                    session, reason="send_click_local_placeholder"
                )
        count_after = self._session_visible_message_count(session)
        self._append_log(
            "[CHAT_SEND][LOCAL_APPEND_AFTER] "
            f"session_id={session.session_id} "
            f"count_before={count_before} "
            f"count_after={count_after} "
            f"message_id={local_message_id}",
            echo=True,
        )
        self._save_sessions_to_disk()
        if hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=True,
                reason="send_click_local_append",
            )
        if self._auto_clear_input_after_send:
            self.message_edit.clear()
            if hasattr(self, "_apply_default_compose_message_if_empty"):
                self._apply_default_compose_message_if_empty()

        def _blocked(
            status,
            reason,
            *,
            enqueue=False,
            system_msg="",
            hint="",
            render_reason="send_blocked_keep_local_message",
        ):
            self._append_log(
                "[SEND][BLOCK] "
                + kv_line(trace_id=trace_id, reason=reason, action=render_reason),
                echo=True,
            )
            self._update_local_user_message_status(
                session,
                local_message_id,
                status,
                detail=reason,
            )
            if enqueue:
                self._enqueue_user_message_for_session(
                    session, content, reuse_message_id=local_message_id
                )
            if hasattr(self, "_render_current_chat_messages"):
                self._render_current_chat_messages(
                    force_bottom=True,
                    reason=render_reason,
                )
            if system_msg:
                self._add_system_message(system_msg)
            if hint:
                self._set_tm_action_hint(hint)
            self._apply_chat_bind_visual_state()
            return None

        self._recover_stuck_bootstrap_sessions()
        busy_reason = self._session_send_busy_reason(session)
        if busy_reason:
            if busy_reason == "waiting_conversation_created":
                return _blocked(
                    "等待发送",
                    busy_reason,
                    system_msg="正在创建 ChatGPT 对话，请稍候…",
                    render_reason="send_busy_waiting_conversation",
                )
            if busy_reason == "prebound_home_wait_conversation":
                client_id = (
                    normalize_remote_chatgpt(session.remote_chatgpt).get("client_id")
                    or ""
                ).strip()
                item = self._find_tm_client_by_client_id(client_id) if client_id else None
                if isinstance(item, dict):
                    self._begin_wait_conversation_page_for_sync(
                        session, item, request_reason="send_wait_conversation"
                    )
                return _blocked(
                    "等待发送",
                    busy_reason,
                    enqueue=True,
                    system_msg=(
                        "当前绑定的是 ChatGPT 首页，请新建或进入一个对话后消息将自动发送。"
                    ),
                    render_reason="send_prebound_home_enqueued",
                )
            hint = ""
            if busy_reason == "pending_reply":
                hint = "已加入发送队列，等待当前回复结束后自动发送。"
            elif busy_reason in (
                "responding",
                "generating",
                "waiting",
                "pending",
                "queued",
            ):
                hint = "已加入发送队列，等待页面空闲后自动发送。"
            else:
                hint = (
                    f"已加入发送队列（{len(self._session_send_queue(session.session_id))} 条等待发送）。"
                )
            return _blocked(
                "已加入队列",
                busy_reason,
                enqueue=True,
                hint=hint,
                render_reason="send_busy_enqueued_local_message",
            )

        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            reason = response_msg or "bound_page_not_ready"
            return _blocked(
                "等待发送",
                reason,
                enqueue=True,
                render_reason="response_not_ready_keep_local_message",
            )

        if self._bind_each_chat_to_page:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)
            has_conversation = bool((remote.get("conversation_id") or "").strip())
            needs_reopen_wait = (
                remote.get("enabled")
                and has_conversation
                and bind_state not in (BIND_STATE_PREBOUND_HOME, BIND_STATE_WAITING_HOME)
                and not self._session_has_sendable_bound_page(remote)
            )
            if needs_reopen_wait:
                conversation_id = self._remote_conversation_id(remote) or "-"
                self._update_local_user_message_status(
                    session,
                    local_message_id,
                    "等待发送",
                    detail="wait_bind_page_online",
                )
                self._append_log(
                    "[SEND][WAIT_BIND_PAGE] "
                    f"session_id={session.session_id} "
                    f"turn_id={turn_id} "
                    f"conversation_id={conversation_id} "
                    f"pending_user_message_id={local_message_id}",
                    echo=True,
                )
                reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                    session,
                    content,
                    user_message_id=local_message_id,
                )
                if reopen_result is False:
                    self._refresh_session_list(select_session_id=session.session_id)
                    if hasattr(self, "_render_current_chat_messages"):
                        self._render_current_chat_messages(
                            force_bottom=True,
                            reason="send_wait_bind_page_failed",
                        )
                    else:
                        self._render_session_chat(session)
                    self._save_sessions_to_disk()
                    self._apply_chat_bind_visual_state()
                    return None
            else:
                reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                    session, content
                )
                if reopen_result is False:
                    self._update_local_user_message_status(
                        session,
                        local_message_id,
                        "等待发送",
                        detail="reopen_bind_page_failed",
                    )
                    if hasattr(self, "_render_current_chat_messages"):
                        self._render_current_chat_messages(
                            force_bottom=True,
                            reason="send_reopen_failed_keep_local_message",
                        )
                    self._apply_chat_bind_visual_state()
                    return None

        if self._bind_each_chat_to_page and self._session_needs_first_message_bind(
            session
        ):
            ready, reason = self._prepare_first_message_binding(session, content)
            if not ready:
                if reason == "__WAITING_HOME_PENDING__":
                    self._update_local_user_message_status(
                        session,
                        local_message_id,
                        "等待发送",
                        detail=reason,
                    )
                    if hasattr(self, "_render_current_chat_messages"):
                        self._render_current_chat_messages(
                            force_bottom=True,
                            reason="send_first_bind_waiting_home",
                        )
                    self._save_sessions_to_disk()
                    return None
                if reason:
                    return _blocked(
                        "等待发送",
                        reason,
                        system_msg=reason,
                        render_reason="send_first_bind_not_ready",
                    )
                return _blocked(
                    "目标不可用",
                    "first_message_bind_not_ready",
                    render_reason="send_first_bind_blocked",
                )

        send_decision, send_reason, _, _ = self.resolve_send_decision(
            session, content=content
        )
        if send_decision == "blocked":
            return _blocked(
                "目标不可用",
                send_reason or "send_decision_blocked",
                system_msg=send_reason or "当前没有可用 ChatGPT 页面，消息已保留在本地。",
                hint=send_reason or "当前没有可用 ChatGPT 页面，消息已保留在本地。",
                render_reason="send_decision_blocked_keep_local_message",
            )

        try:
            return self._push_message_text(
                session,
                content,
                skip_upload_before_send=skip_upload_before_send,
                trace_id=trace_id,
                button=button,
                reuse_user_message_id=local_message_id,
                reuse_turn_id=turn_id,
                reuse_assistant_message_id=pending_assistant_message_id,
            )
        finally:
            self._set_active_send_trace_id("")
            setattr(self, "_pending_send_turn_id", "")
            setattr(self, "_pending_send_user_message_id", "")
            setattr(self, "_pending_send_assistant_message_id", "")

    def _flush_pending_bootstrap_message(self, session, text):
        text = (text or "").strip()
        if not text or session is None:
            return
        if not server.is_server_running():
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
        skip_upload_before_send=False,
        force_upload_before_send=False,
        trace_id="",
        button="send",
        reuse_turn_id="",
        reuse_assistant_message_id="",
    ):
        trace_id = (trace_id or self._get_active_send_trace_id() or "").strip()
        if trace_id:
            self._set_active_send_trace_id(trace_id)
        raw_user_text = content.strip()
        if not raw_user_text:
            return {"ok": False, "reason": "empty_text", "retryable": False}
        final_prompt = raw_user_text
        reuse_user_message_id = (reuse_user_message_id or "").strip()
        existing_user_message = self._find_session_message_by_id(
            session, reuse_user_message_id
        )
        turn_id = (
            (existing_user_message.turn_id or "").strip()
            if existing_user_message is not None
            else (reuse_turn_id or "").strip()
        ) or str(uuid.uuid4())
        user_message_id = (
            reuse_user_message_id if existing_user_message is not None else str(uuid.uuid4())
        )
        assistant_message_id = (reuse_assistant_message_id or "").strip() or str(uuid.uuid4())
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)
        is_bootstrap = bind_state == BIND_STATE_PREBOUND_HOME
        if bind_state == BIND_STATE_PREBOUND_HOME:
            client_id = (
                remote.get("prebound_home_client_id") or remote.get("client_id") or ""
            ).strip()
            page_instance_id = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            self._append_log(
                f"[SEND][BOOTSTRAP] session_id={session.session_id} "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
                f"text_len={len(raw_user_text)} pending={from_pending_bootstrap}"
            )
            self._append_log(
                f"[NEW_SESSION][FIRST_SEND] session_id={session.session_id} "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
                f"text_len={len(raw_user_text)}"
            )
        send_decision, send_reason, target_item, send_detail = self.resolve_send_decision(
            session, content=raw_user_text
        )
        if send_decision == "blocked":
            block_reason = send_reason or "send_decision_blocked"
            self._append_log(
                "[SEND][BLOCK] "
                + kv_line(
                    trace_id=trace_id or "-",
                    reason=block_reason,
                    step="resolve_send_decision",
                ),
                echo=True,
            )
            if reuse_user_message_id:
                self._update_local_user_message_status(
                    session,
                    reuse_user_message_id,
                    "目标不可用",
                    detail=block_reason,
                )
                if hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="push_text_send_decision_blocked",
                    )
            if not suppress_system_message:
                self._add_system_message(
                    send_reason or "当前无法发送到 ChatGPT 页面。"
                )
            self._apply_chat_bind_visual_state()
            return {"ok": False, "reason": block_reason, "retryable": True}

        self._rebind_current_session_to_online_client_if_needed()
        self._log_send_bind_check(session, action="before_send", trace_id=trace_id)

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        target_conversation_id = (remote.get("conversation_id") or "").strip()
        target_client_id = (send_detail.get("client_id") or "").strip()
        target_page_url = (send_detail.get("url") or "").strip()
        allowed = send_decision in ("allowed", "queued")
        reason = send_reason
        if send_decision == "queued":
            self._append_log(
                "[SEND][QUEUE] "
                f"client_id={target_client_id or '-'} "
                f"conversation_id={target_conversation_id or '-'} "
                f"reason={send_reason or '-'}",
                echo=True,
            )
        if not target_client_id and isinstance(target_item, dict):
            target_client_id = (target_item.get("client_id") or "").strip()
            target_page_url = page_url_from(target_item)
        if not target_conversation_id and target_page_url:
            target_conversation_id = parse_conversation_id(target_page_url) or ""
        if not target_page_url and target_conversation_id:
            fallback_url = f"https://chatgpt.com/c/{target_conversation_id}"
            self._append_log(
                "[SEND][TARGET_URL][FALLBACK] "
                + kv_line(
                    trace_id=trace_id or "-",
                    from_conv=target_conversation_id,
                    fallback_url=fallback_url,
                ),
                echo=True,
            )
            target_page_url = fallback_url
        if not target_client_id:
            self._append_log(
                "[SEND][TARGET_RESOLVE][FAIL] "
                + kv_line(trace_id=trace_id or "-", reason="no_bound_client"),
                echo=True,
            )
        else:
            if self._is_debug_mode_enabled():
                self._append_log(
                    "[SEND][TARGET_RESOLVE] "
                    + kv_line(
                        trace_id=trace_id or "-",
                        session_id=session.session_id,
                        target_client=target_client_id or "-",
                        target_conv=target_conversation_id or "-",
                        target_url=target_page_url or "-",
                        target_source="session.remote_chatgpt",
                        allow="true" if allowed else "false",
                        decision_reason=reason or "-",
                        remote_raw=repr(remote),
                    ),
                    echo=True,
                )
            else:
                self._append_log(
                    "[SEND][TARGET_RESOLVE] "
                    + kv_line(
                        trace_id=trace_id or "-",
                        session_id=session.session_id,
                        target_client=target_client_id or "-",
                        target_conv=target_conversation_id or "-",
                        allow="true" if allowed else "false",
                        decision_reason=reason or "-",
                    ),
                    echo=True,
                )
        if not allowed:
            block_reason = reason or "no_online_page"
            self._append_log(
                "[SEND][BLOCK] "
                + kv_line(trace_id=trace_id or "-", reason=block_reason),
                echo=True,
            )
            if reuse_user_message_id:
                offline_reasons = (
                    "no_online_page",
                    "bound_page_offline",
                    "selected_page_offline",
                )
                status_text = (
                    "目标离线"
                    if block_reason in offline_reasons
                    else "等待发送"
                )
                self._update_local_user_message_status(
                    session,
                    reuse_user_message_id,
                    status_text,
                    detail=block_reason,
                )
                if block_reason in offline_reasons or block_reason in (
                    "pending_reply",
                    "responding",
                    "generating",
                ):
                    self._enqueue_user_message_for_session(
                        session,
                        raw_user_text,
                        reuse_message_id=reuse_user_message_id,
                    )
                if hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="push_text_page_not_allowed",
                    )
            if not suppress_system_message:
                if block_reason in ("no_online_page", "bound_page_offline"):
                    self._add_system_message(
                        "没有在线 ChatGPT 页面，请先打开或刷新目标网页。"
                    )
                else:
                    self._add_system_message(reason)
            self._apply_chat_bind_visual_state()
            return {"ok": False, "reason": block_reason, "retryable": True}

        target_client_id, target_page_url, allowed, verify_reason = (
            self._verify_send_target_binding(
                session, target_client_id, target_page_url
            )
        )
        if verify_reason:
            self._append_log(
                "[SEND][VERIFY] "
                + kv_line(trace_id=trace_id or "-", reason=verify_reason),
                echo=True,
            )
        if not allowed:
            verify_block = verify_reason or "send_target_verify_failed"
            self._append_log(
                "[SEND][BLOCK] "
                + kv_line(
                    trace_id=trace_id or "-",
                    reason=verify_block,
                    step="verify_send_target_binding",
                ),
                echo=True,
            )
            if reuse_user_message_id:
                self._update_local_user_message_status(
                    session,
                    reuse_user_message_id,
                    "等待发送",
                    detail=verify_block,
                )
                self._enqueue_user_message_for_session(
                    session,
                    raw_user_text,
                    reuse_message_id=reuse_user_message_id,
                )
                if hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="push_text_verify_binding_failed",
                    )
            if not suppress_system_message:
                self._add_system_message(verify_reason or "发送前绑定校验失败。")
            self._apply_chat_bind_visual_state()
            return {
                "ok": False,
                "reason": verify_block,
                "retryable": True,
            }

        if is_bootstrap:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            page_instance_id = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            self._append_log(
                f"[发送][BOOTSTRAP] 目标 client_id={target_client_id} "
                f"page_instance_id={page_instance_id or '-'} "
                f"page={self._short_page_display(target_page_url)}"
            )
        payload = self._build_bridge_send_payload(
            session=session,
            turn_id=turn_id,
            raw_user_text=raw_user_text,
            final_prompt=final_prompt,
            target_client_id=target_client_id,
            target_page_url=target_page_url,
            is_bootstrap=is_bootstrap,
            trace_id=trace_id,
        )
        if target_client_id and target_page_url:
            conversation_id = (payload.get("conversation_id") or "").strip()
            self._append_log(
                f"[发送] 目标 client_id={target_client_id} "
                f"conversation_id={conversation_id or '-'} "
                f"bootstrap={is_bootstrap} "
                f"url={self._short_page_display(target_page_url)}"
            )
        needs_upload_before_send = (
            force_upload_before_send
            or getattr(self, "_upload_before_send_enabled", False)
        ) and not skip_upload_before_send

        if needs_upload_before_send:
            control_message_id = self._enqueue_upload_before_send_command(
                session=session,
                payload=payload,
                target_client_id=target_client_id,
            )

            if not control_message_id:
                if reuse_user_message_id:
                    self._update_local_user_message_status(
                        session,
                        reuse_user_message_id,
                        "发送失败",
                        detail="upload_before_send_enqueue_failed",
                    )
                    if hasattr(self, "_render_current_chat_messages"):
                        self._render_current_chat_messages(
                            force_bottom=True,
                            reason="push_text_upload_enqueue_failed",
                        )
                if not suppress_system_message:
                    self._add_system_message(
                        "发送前上传命令入队失败，已取消本次发送。"
                    )
                self._apply_chat_bind_visual_state()
                return {
                    "ok": False,
                    "reason": "upload_before_send_enqueue_failed",
                    "retryable": True,
                }

            control_key = str(control_message_id)
            if not hasattr(self, "_pending_upload_sends"):
                self._pending_upload_sends = {}
            self._pending_upload_sends[control_key] = {
                "session_id": session.session_id,
                "payload": payload,
                "raw_user_text": raw_user_text,
                "turn_id": turn_id,
                "user_message_id": user_message_id,
                "assistant_message_id": assistant_message_id,
                "from_pending_bootstrap": from_pending_bootstrap,
                "reuse_user_message_id": reuse_user_message_id,
                "source": source,
                "suppress_system_message": suppress_system_message,
            }
            self._append_log(
                f"[UPLOAD_BEFORE_SEND][WAIT_UPLOAD_DONE] "
                f"control_message_id={control_key} "
                f"session_id={session.session_id} turn_id={turn_id}",
                echo=True,
            )
            if not suppress_system_message:
                self._add_system_message(
                    "已开始发送前上传，上传成功后会自动发送文本。"
                )
            self._apply_chat_bind_visual_state()
            if hasattr(self, "_update_upload_action_buttons_state"):
                self._update_upload_action_buttons_state()
            return {
                "ok": True,
                "reason": "waiting_upload_done",
                "control_message_id": control_key,
                "turn_id": turn_id,
            }

        return self._execute_queued_chat_send(
            session,
            {
                "payload": payload,
                "raw_user_text": raw_user_text,
                "turn_id": turn_id,
                "user_message_id": user_message_id,
                "assistant_message_id": assistant_message_id,
                "from_pending_bootstrap": from_pending_bootstrap,
                "reuse_user_message_id": reuse_user_message_id,
                "source": source,
                "suppress_system_message": suppress_system_message,
            },
        )
    def _copy_last_reply(self):
        session = self._current_session()
        text = self._last_assistant_text(session)
        if not text:
            self._add_system_message("当前没有可复制的 ChatGPT 回复。")
            return
        QApplication.clipboard().setText(text)
        self._add_system_message("已复制最后一条 ChatGPT 回复。")

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
        server.complete_gui_dispatch(action_id, result)

    def _external_api_sessions_summary(self):
        total = 0
        bound_online = 0
        bound_offline = 0
        unbound = 0
        status = self._last_bridge_status or {}
        for session in self._sessions.values():
            total += 1
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._effective_bind_state(session)
            if bind_state == BIND_STATE_UNBOUND or not remote.get("enabled"):
                unbound += 1
                continue
            if bind_state == BIND_STATE_BOUND_OFFLINE:
                bound_offline += 1
                continue
            if bind_state == BIND_STATE_BOUND_CONVERSATION:
                client_id = (remote.get("client_id") or "").strip()
                online = False
                for item in status.get("tampermonkey_clients") or []:
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
        self._save_sessions_to_disk()
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
        page_url = (payload.get("page_url") or "").strip()
        conversation_id = (payload.get("conversation_id") or "").strip()
        page_instance_id = (payload.get("page_instance_id") or "").strip()
        if not conversation_id and page_url:
            conversation_id = parse_conversation_id(page_url) or ""
        if not page_url and conversation_id:
            page_url = f"https://chatgpt.com/c/{conversation_id}"
        if not any([client_id, page_url, conversation_id, page_instance_id]):
            return {
                "ok": False,
                "error": "缺少页面身份信息（client_id / page_url / conversation_id / page_instance_id）",
                "code": "EMPTY_TEXT",
            }
        client_info = None
        if client_id:
            client_info = self._client_info_from_status(client_id)
        if not isinstance(client_info, dict):
            client_info = {}
        client_info["client_id"] = client_id
        if page_url:
            client_info["page_url"] = page_url
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
        self._save_sessions_to_disk()
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        return {
            "ok": True,
            "session_id": session.session_id,
            "bound_client_id": (remote.get("client_id") or "").strip(),
            "bound_page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "bound_conversation_id": self._remote_conversation_id(remote),
            "bound_url": (
                remote.get("conversation_url")
                or remote.get("url")
                or page_url
                or ""
            ).strip(),
            "bind_state": self._remote_bind_state(remote) or "bound",
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
            self._save_sessions_to_disk()
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
            return server.count_user_turns(session) >= force_limit

        def finish_force_new(previous_session):
            prev_count = server.count_user_turns(previous_session)
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
            self._save_sessions_to_disk()
            return session

        if new_session:
            session = self._create_session(select=False)
            session.remote_chatgpt = default_remote_chatgpt()
            self._external_client_last_session[client_name] = session.session_id
            session_meta["new_session_created"] = True
            session_meta["new_session_reason"] = "new_session"
            self._save_sessions_to_disk()
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
            self._save_sessions_to_disk()
            return session, session_meta

        return None, session_meta

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

    def _resolve_bridge_push_target_fields(
        self,
        session,
        *,
        target_page_url: str,
        is_bootstrap: bool,
    ):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)
        conversation_id = (remote.get("conversation_id") or "").strip()
        page_instance_id = ""
        bind_request_id = ""
        if is_bootstrap:
            page_instance_id = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            bind_request_id = self._session_bind_request_id(remote)
        elif bind_state == BIND_STATE_BOUND_CONVERSATION and target_page_url:
            if not conversation_id:
                conversation_id = parse_conversation_id(target_page_url) or ""
            page_instance_id = (remote.get("page_instance_id") or "").strip()
        return conversation_id, page_instance_id, bind_request_id

    def _build_bridge_send_payload(
        self,
        *,
        session,
        turn_id,
        raw_user_text,
        final_prompt,
        target_client_id,
        target_page_url,
        is_bootstrap,
        trace_id="",
    ):
        conversation_id, page_instance_id, bind_request_id = (
            self._resolve_bridge_push_target_fields(
                session,
                target_page_url=target_page_url,
                is_bootstrap=is_bootstrap,
            )
        )
        return build_gui_push_payload(
            session_id=session.session_id,
            turn_id=turn_id,
            content=final_prompt,
            raw_content=raw_user_text,
            trace_id=trace_id,
            target_client_id=target_client_id,
            url=target_page_url,
            conversation_id=conversation_id,
            page_instance_id=page_instance_id,
            bootstrap_conversation=is_bootstrap,
            bind_request_id=bind_request_id,
            launch_token=bind_request_id,
        )

    def _external_api_chat_send(self, payload):
        if not server.is_server_running():
            return {
                "ok": False,
                "error": "服务未启动",
                "code": "INTERNAL_ERROR",
            }
        text = (payload.get("text") or "").strip()
        if not text:
            return {"ok": False, "error": "text 不能为空", "code": "EMPTY_TEXT"}

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
                idle_home = self._find_idle_chatgpt_home_client(
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
        raw_user_text = content.strip()
        if not raw_user_text:
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
            raw_user_text=raw_user_text,
            final_prompt=raw_user_text,
            target_client_id=target_client_id,
            target_page_url=target_page_url,
            is_bootstrap=is_bootstrap,
        )

        try:
            msg = server.push_message(payload)
        except Exception as error:
            detail = f"消息入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            return {
                "ok": False,
                "error": str(error),
                "code": "INTERNAL_ERROR",
            }

        bridge_message_id = (
            (msg.get("message_id") or msg.get("id") or "").strip()
            if isinstance(msg, dict)
            else ""
        )
        if not bridge_message_id:
            return {
                "ok": False,
                "error": "服务端未返回 bridge_message_id",
                "code": "INTERNAL_ERROR",
            }

        server.attach_external_request_bridge(
            session.session_id, bridge_message_id, turn_id
        )
        self._message_to_session[bridge_message_id] = session.session_id
        self._message_to_turn[bridge_message_id] = turn_id
        if is_bootstrap:
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
            session.remote_chatgpt = {
                **remote_now,
                "bind_state": BIND_STATE_WAITING_CONVERSATION_CREATED,
                "bootstrap_in_progress": True,
                "bootstrap_message_id": bridge_message_id,
                "bootstrap_started_at": time.time(),
                "client_id": (payload.get("target_client_id") or "").strip()
                or (remote_now.get("client_id") or ""),
                "page_instance_id": (payload.get("target_page_instance_id") or "").strip()
                or (remote_now.get("page_instance_id") or ""),
            }
            session.updated_at = time.time()
        self._append_session_message(
            session,
            "user",
            raw_user_text,
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
        self._save_sessions_to_disk()
        return {
            "ok": True,
            "bridge_message_id": bridge_message_id,
            "turn_id": turn_id,
        }

    def closeEvent(self, event):
        if hasattr(self, "_save_splitter_sizes_now"):
            self._save_splitter_sizes_now()
        elif hasattr(self, "_save_chat_splitter_sizes"):
            self._save_chat_splitter_sizes()
        self._save_sessions_to_disk()
        self._save_app_settings()
        if server.is_server_running():
            try:
                server.stop_server()
            except Exception as error:
                detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"
                self._append_log(detail, echo=True)
        event.accept()
