import logging
import time

logger = logging.getLogger(__name__)

from app.constants import (
    ASSISTANT_WAIT_TEXTS,
    USER_SEND_PENDING_STATUSES,
    PENDING_MISSING_ID_CLEAR_SECONDS,
    PENDING_REPLY_HARD_TIMEOUT_SECONDS,
    PENDING_REPLY_SYNC_AFTER_SECONDS,
    is_assistant_reply_pending_status,
)
from app.models import default_remote_chatgpt, normalize_remote_chatgpt


class SessionPendingMixin:
    def _session_pending_messages_index(self, session):
        return {
            (getattr(message, "message_id", "") or "").strip(): message
            for message in session.messages
            if (getattr(message, "message_id", "") or "").strip()
        }

    def _iter_pending_assistant_messages(self, session):
        from app.models import is_waiting_placeholder_message

        if not session:
            return
        messages_by_id = self._session_pending_messages_index(session)
        for message in reversed(session.messages):
            if not getattr(message, "visible_in_chat", True):
                continue
            if message.role != "assistant":
                continue

            # queued 消息的 assistant 占位不应算 pending
            msg_source = (getattr(message, "message_source", "") or "").strip()
            if msg_source in ("queued_placeholder", "local_queue"):
                continue

            bridge_id = (getattr(message, "bridge_message_id", "") or "").strip()
            if bridge_id and hasattr(self, "_is_finalized") and self._is_finalized(
                bridge_id
            ):
                continue
            if not bridge_id:
                parent_id = (getattr(message, "parent_message_id", "") or "").strip()
                parent = messages_by_id.get(parent_id)
                parent_bridge_id = (
                    (getattr(parent, "bridge_message_id", "") or "").strip()
                    if parent is not None
                    else ""
                )
                parent_source = (
                    (parent.message_source or "").strip()
                    if parent is not None
                    else ""
                )
                parent_ui_status = (
                    (getattr(parent, "ui_status", "") or "").strip()
                    if parent is not None
                    else ""
                )
                # parent 是 queued 消息且没有 bridge_message_id，不算 pending
                if (
                    parent is not None
                    and not parent_bridge_id
                    and parent_source in ("local_send", "local_queue")
                ):
                    continue
                # parent 的 ui_status 是队列状态，不算 pending
                if parent is not None and parent_ui_status in USER_SEND_PENDING_STATUSES:
                    continue
            if is_waiting_placeholder_message(message):
                yield message

    def _get_pending_reply_state(self, session):
        """返回当前 pending assistant 占位快照；无则 None。"""
        for message in self._iter_pending_assistant_messages(session):
            bridge_id = (getattr(message, "bridge_message_id", "") or "").strip()
            since = float(getattr(message, "created_at", 0) or 0)
            if since <= 0:
                since = float(getattr(session, "reply_waiting_since", 0) or 0)
            return {
                "bridge_message_id": bridge_id,
                "turn_id": (getattr(message, "turn_id", "") or "").strip(),
                "assistant_message_id": (
                    getattr(message, "message_id", "") or ""
                ).strip(),
                "parent_message_id": (
                    getattr(message, "parent_message_id", "") or ""
                ).strip(),
                "since": since,
                "message": message,
                "source": (message.message_source or "").strip(),
            }
        return None

    def _pending_reply_age_seconds(self, session, pending=None):
        pending = pending or self._get_pending_reply_state(session)
        if pending:
            since = float(pending.get("since") or 0)
            if since > 0:
                return max(0.0, time.time() - since)
        if session is None:
            return 0.0
        since = float(getattr(session, "reply_waiting_since", 0) or 0)
        if since <= 0:
            return 0.0
        return max(0.0, time.time() - since)

    def _pending_reply_is_actionable(self, session, pending=None):
        """仅当存在有效 bridge_message_id 且未 finalize 时，pending 才可拦截发送。

        queued 消息不应产生 pending_reply 阻塞：
        - assistant.message_source in ("queued_placeholder", "local_queue") 不算 pending
        - 没有 bridge_message_id 的 assistant 不算 actionable pending
        - parent user 的 message_source == "local_queue" 且无 bridge_message_id 不算 pending
        """
        pending = pending or self._get_pending_reply_state(session)
        if not pending:
            return False

        # 检查 assistant 消息的 message_source
        message = pending.get("message")
        if message is not None:
            msg_source = (getattr(message, "message_source", "") or "").strip()
            if msg_source in ("queued_placeholder", "local_queue"):
                return False

        bridge_id = (pending.get("bridge_message_id") or "").strip()
        if not bridge_id:
            return False
        if hasattr(self, "_is_finalized") and self._is_finalized(bridge_id):
            return False

        # 检查 parent user 消息
        parent_id = (pending.get("parent_message_id") or "").strip()
        if parent_id and hasattr(self, "_find_session_message_by_id"):
            parent_msg = self._find_session_message_by_id(session, parent_id)
            if parent_msg is not None:
                parent_source = (getattr(parent_msg, "message_source", "") or "").strip()
                parent_bridge_id = (getattr(parent_msg, "bridge_message_id", "") or "").strip()
                parent_ui_status = (getattr(parent_msg, "ui_status", "") or "").strip()
                # 如果 parent 是 queued 消息且没有 bridge_message_id，不算 actionable
                if parent_source == "local_queue" and not parent_bridge_id:
                    return False
                # 如果 parent 的 ui_status 是队列状态，不算 actionable
                if parent_ui_status in ("已加入队列", "queued"):
                    return False

        return True

    def _bound_page_indicates_idle(self, session):
        state = self._session_bound_response_state(session)
        response_state = (state.get("response_state") or "").strip().lower()
        return (
            bool(state.get("can_accept_input", True))
            and not bool(state.get("is_responding"))
            and response_state == "idle"
        )

    def _bound_page_indicates_busy(self, session):
        """绑定页正在生成/忙碌时不应清理 pending。"""
        state = self._session_bound_response_state(session)
        response_state = (state.get("response_state") or "").strip().lower()
        if bool(state.get("is_responding")):
            return True
        if response_state in ("generating", "assistant_busy"):
            return True
        remote = normalize_remote_chatgpt(
            getattr(session, "remote_chatgpt", None) or default_remote_chatgpt()
        )
        detail = str(remote.get("response_state_reason") or "").strip().lower()
        return "assistant_busy" in detail

    def _maybe_recover_pending_reply(self, session):
        """等待较久时触发 sync_conversation，避免 60s 直接清掉 waiting。"""
        if session is None:
            return False
        if not self._session_has_pending_assistant_reply(session):
            return False
        age = self._pending_reply_age_seconds(session)
        since_session = float(getattr(session, "reply_waiting_since", 0) or 0)
        if since_session > 0:
            age = max(age, max(0.0, time.time() - since_session))
        if age < PENDING_REPLY_SYNC_AFTER_SECONDS:
            return False
        if getattr(session, "pending_sync_requested", False):
            return False
        if hasattr(self, "request_sync_conversation"):
            ok, detail = self.request_sync_conversation(
                session,
                reason="pending_reply_recovery",
            )
            self._append_log(
                "[CHAT][PENDING_SYNC_REQUESTED] "
                f"session_id={session.session_id} "
                f"pending_age={age:.1f} "
                f"ok={'true' if ok else 'false'} "
                f"detail={detail or '-'}",
                echo=True,
            )
        else:
            self._append_log(
                "[CHAT][PENDING_SYNC_REQUESTED] "
                f"session_id={session.session_id} "
                f"pending_age={age:.1f} "
                f"detail=request_sync_conversation_unavailable",
                echo=True,
            )
        session.pending_sync_requested = True
        if hasattr(self, "_schedule_save_sessions_to_disk"):
            self._schedule_save_sessions_to_disk()
        return True

    def _parent_send_failed_status(self, session, pending):
        parent_id = (pending.get("parent_message_id") or "").strip()
        if not parent_id or not hasattr(self, "_find_session_message_by_id"):
            return ""
        parent_msg = self._find_session_message_by_id(session, parent_id)
        if parent_msg is None:
            return ""
        parent_status = (getattr(parent_msg, "ui_status", "") or "").strip().lower()
        if parent_status in ("发送失败", "failed", "send_failed", "timeout", "cancelled"):
            return parent_status or "failed"
        return ""

    def _stale_pending_clear_reason(self, session, pending=None):
        pending = pending or self._get_pending_reply_state(session)
        if pending and self._bound_page_indicates_busy(session):
            return ""
        age = self._pending_reply_age_seconds(session, pending)
        since_session = float(getattr(session, "reply_waiting_since", 0) or 0)
        if since_session > 0:
            age = max(age, max(0.0, time.time() - since_session))

        if pending:
            send_fail = self._parent_send_failed_status(session, pending)
            if send_fail:
                return f"send_status_{send_fail}"

        if not pending:
            if since_session > 0 and age >= PENDING_REPLY_HARD_TIMEOUT_SECONDS:
                return "hard_timeout"
            return ""

        bridge_id = (pending.get("bridge_message_id") or "").strip()
        assistant_id = (pending.get("assistant_message_id") or "").strip()

        if age >= PENDING_MISSING_ID_CLEAR_SECONDS:
            if not bridge_id:
                return "missing_bridge_message_id"
            if not assistant_id:
                return "missing_pending_assistant_message_id"

        if age >= PENDING_REPLY_HARD_TIMEOUT_SECONDS:
            return "hard_timeout"

        if age >= PENDING_REPLY_SYNC_AFTER_SECONDS:
            if not self._pending_reply_is_actionable(session, pending):
                return ""
            return "sync_timeout"

        if self._bound_page_indicates_idle(session) and bridge_id:
            if hasattr(self, "_is_finalized") and self._is_finalized(bridge_id):
                return "page_idle_finalized"
            if (
                hasattr(self, "_bridge_msg")
                and bridge_id
                in getattr(self._bridge_msg, "finalized_bridge_message_ids", set())
            ):
                return "page_idle_finalized"
        return ""

    def _is_stale_pending_reply(self, session, pending=None):
        pending = pending or self._get_pending_reply_state(session)
        if not pending:
            return False
        return bool(self._stale_pending_clear_reason(session, pending))

    def _clear_stale_pending_reply(self, session, *, reason="", force=False):
        if session is None:
            return False
        pending = self._get_pending_reply_state(session)
        has_waiting_flag = float(getattr(session, "reply_waiting_since", 0) or 0) > 0
        has_pending_messages = self._session_has_pending_assistant_reply(session)
        if not pending and not has_waiting_flag and not has_pending_messages:
            return False

        clear_reason = (reason or "").strip()
        if not force:
            if pending:
                clear_reason = clear_reason or self._stale_pending_clear_reason(
                    session, pending
                )
            elif has_pending_messages or has_waiting_flag:
                clear_reason = clear_reason or "missing_bridge_message_id"
            if not clear_reason:
                return False
        elif not clear_reason:
            clear_reason = "forced"

        age = self._pending_reply_age_seconds(session, pending)
        old_turn_id = (pending or {}).get("turn_id") or "-"
        old_assistant_id = (pending or {}).get("assistant_message_id") or "-"
        cleared = 0
        messages_to_clear = []
        if pending and pending.get("message") is not None:
            messages_to_clear.append(pending["message"])
        elif has_pending_messages:
            for message in reversed(list(session.messages)):
                if not getattr(message, "visible_in_chat", True):
                    continue
                if message.role != "assistant":
                    continue
                status = (message.ui_status or "").strip()
                text = (message.content or "").strip()
                if (
                    is_assistant_reply_pending_status(status)
                    or text in ASSISTANT_WAIT_TEXTS
                ):
                    messages_to_clear.append(message)
                    break

        for message in messages_to_clear:
            bridge_id = (getattr(message, "bridge_message_id", "") or "").strip()
            is_bootstrap_stale = False
            if bridge_id:
                try:
                    from app.server.message_queue import get_message_state

                    msg_state = get_message_state(bridge_id)
                    is_bootstrap_stale = bool(
                        msg_state and msg_state.get("bootstrap_conversation")
                    )
                except Exception as exc:
                    self._append_log(
                        "[CHAT][STALE_PENDING_CLEAR][BOOTSTRAP_CHECK_FAILED] "
                        f"bridge_id={bridge_id or '-'} error={exc!r}",
                        echo=True,
                        level="ERROR",
                    )
            from app.constants import BOOTSTRAP_STALE_TIMEOUT_TEXT

            is_timeout_reason = clear_reason in (
                "hard_timeout",
                "timeout",
                "sync_timeout",
                "missing_bridge_message_id",
                "missing_pending_assistant_message_id",
            ) or str(clear_reason).startswith("send_status_")

            if is_bootstrap_stale:
                stale_text = BOOTSTRAP_STALE_TIMEOUT_TEXT
                message.role = "error"
                message.ui_status = "已重置"
            elif is_timeout_reason:
                stale_text = f"等待回复超时：{clear_reason}"
                message.role = "assistant"
                message.ui_status = "timeout"
            else:
                stale_text = (
                    "上一条回复的本地等待状态已重置。"
                    "如果网页中已有回复，请点击「同步网页对话」刷新完整内容。"
                )
                message.role = "error"
                message.ui_status = "已重置"
            message.content = stale_text
            if is_timeout_reason:
                message.detail = stale_text
            if bridge_id and hasattr(self, "_finalize_bridge"):
                self._finalize_bridge(bridge_id)
                if hasattr(self, "_bridge_msg"):
                    self._bridge_msg.ack_success_message_ids.discard(bridge_id)
            cleared += 1
            if not old_turn_id or old_turn_id == "-":
                old_turn_id = (getattr(message, "turn_id", "") or "").strip() or "-"
            if not old_assistant_id or old_assistant_id == "-":
                old_assistant_id = (
                    getattr(message, "message_id", "") or ""
                ).strip() or "-"

        if float(getattr(session, "reply_waiting_since", 0) or 0) > 0:
            session.reply_waiting_since = 0
            cleared += 1

        if getattr(session, "pending_sync_requested", False):
            session.pending_sync_requested = False
            cleared += 1

        if cleared <= 0:
            return False

        if hasattr(self, "_mark_session_waiting_finished"):
            self._mark_session_waiting_finished(
                session, reason=f"clear_stale_pending:{clear_reason}"
            )

        session.updated_at = time.time()
        self._append_log(
            "[CHAT][STALE_PENDING_CLEAR] "
            f"session_id={session.session_id} "
            f"reason={clear_reason} "
            f"pending_age={age:.1f} "
            f"old_turn_id={old_turn_id} "
            f"old_assistant_message_id={old_assistant_id}",
            echo=True,
        )

        if session.session_id == getattr(self, "_current_session_id", None):
            if hasattr(self, "_render_session_chat"):
                self._render_session_chat(session, force_bottom=True)
            elif hasattr(self, "_schedule_current_chat_render"):
                self._schedule_current_chat_render(
                    "stale_pending_clear",
                    delay_ms=0,
                    force_bottom=True,
                )

        if hasattr(self, "_refresh_session_list"):
            self._refresh_session_list(
                select_session_id=getattr(self, "_current_session_id", None)
            )
        if hasattr(self, "_schedule_save_sessions_to_disk"):
            self._schedule_save_sessions_to_disk()
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
        return True

    def _clear_stale_pending_reply_before_send(self, session):
        if session is None:
            return False
        pending = self._get_pending_reply_state(session)
        if pending and self._is_stale_pending_reply(session, pending):
            return self._clear_stale_pending_reply(session, reason="before_send")
        if not pending and self._session_has_pending_assistant_reply(session):
            if not self._pending_reply_is_actionable(session, pending):
                return self._clear_stale_pending_reply(
                    session, reason="before_send", force=True
                )
        if not pending and float(getattr(session, "reply_waiting_since", 0) or 0) > 0:
            since = float(session.reply_waiting_since or 0)
            age = max(0.0, time.time() - since) if since > 0 else 0.0
            if age >= PENDING_REPLY_HARD_TIMEOUT_SECONDS:
                return self._clear_stale_pending_reply(
                    session, reason="timeout", force=True
                )
        return False

    def _clear_stale_pending_reply_before_sync(self, session):
        if session is None:
            return False
        pending = self._get_pending_reply_state(session)
        if not pending:
            return False
        if self._is_stale_pending_reply(session, pending):
            return self._clear_stale_pending_reply(session, reason="before_sync")
        return False

    def _cleanup_stale_pending_on_load(self, session):
        if session is None:
            return False
        pending = self._get_pending_reply_state(session)
        if not pending:
            return False
        if not self._is_stale_pending_reply(session, pending):
            return False
        age = self._pending_reply_age_seconds(session, pending)
        reason = self._stale_pending_clear_reason(session, pending) or "stale_waiting"
        self._append_log(
            "[CHAT][LOAD_CLEAN_STALE_PENDING] "
            f"session_id={session.session_id} "
            f"reason=stale_waiting_on_startup "
            f"pending_age={age:.1f} "
            f"detail={reason}",
            echo=True,
        )
        return self._clear_stale_pending_reply(
            session, reason="stale_waiting_on_startup", force=True
        )

    def _session_bound_response_state(self, session):
        if not session:
            return {
                "is_responding": False,
                "response_state": "unknown",
                "can_accept_input": True,
            }
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        client_id = (
            remote.get("client_id")
            or remote.get("prebound_home_client_id")
            or ""
        ).strip()
        if not client_id:
            return {
                "is_responding": False,
                "response_state": "unknown",
                "can_accept_input": True,
            }
        client_info = self._client_info_by_id(
            client_id, getattr(self._bridge_ui, 'last_bridge_status', None)
        )
        if not isinstance(client_info, dict):
            return {
                "is_responding": False,
                "response_state": "unknown",
                "can_accept_input": True,
            }
        return {
            "is_responding": bool(client_info.get("is_responding", False)),
            "response_state": (
                client_info.get("response_state") or "unknown"
            ).strip() or "unknown",
            "can_accept_input": bool(client_info.get("can_accept_input", True)),
        }

    def _mark_session_pending(self, session_id):
        session = self._sessions.get(session_id)
        if not session:
            return
        session.has_pending_reply = True
        session.reply_waiting_since = time.time()
        if hasattr(self, "_invalidate_session_runtime"):
            self._invalidate_session_runtime(session, reason="mark_session_pending")
        if hasattr(self, "_mark_session_waiting_started"):
            self._mark_session_waiting_started(session, reason="mark_session_pending")
        if hasattr(self, "_update_session_list_item_runtime"):
            self._update_session_list_item_runtime(
                session,
                selected=(session_id == getattr(self, "_current_session_id", "")),
            )

    def _session_has_pending_assistant_reply(self, session):
        if not session:
            return False
        runtime = self._session_runtime_entry(session)
        pending_cache = runtime.get("pending_cache")
        if not isinstance(pending_cache, dict):
            pending_cache = self._compute_session_pending_state(session)
            runtime["pending_cache"] = pending_cache
            runtime["has_pending_reply_cached"] = bool(pending_cache.get("has_pending"))
        return bool(pending_cache.get("has_pending"))

