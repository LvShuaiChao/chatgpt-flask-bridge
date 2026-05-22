"""发送主线：本地轮次 -> 单次 plan -> blocked 处理 / dispatch。"""

from __future__ import annotations

import time
import uuid

from app.constants import ASSISTANT_WAIT_TEXT
from app.models import (
    remote_binding_enabled,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_HOME,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import PageActionPlan, page_url_from
from app.utils.send_plan import LocalTurn, SendPlan
from app.utils.trace_log import kv_line, make_send_trace_id


class SendFlowMixin:
    def _create_local_send_turn(
        self,
        content: str,
        *,
        session=None,
        trace_id: str = "",
        button: str = "send",
        clear_input: bool = True,
    ) -> LocalTurn | None:
        """创建本地 user 消息与 assistant 占位，返回 LocalTurn。"""
        session = session or self._ensure_current_session()
        trace_id = (trace_id or make_send_trace_id(session.session_id)).strip()
        turn_id = str(uuid.uuid4())
        user_message_id = str(uuid.uuid4())
        assistant_message_id = str(uuid.uuid4())
        setattr(self, "_pending_send_turn_id", turn_id)
        setattr(self, "_pending_send_user_message_id", user_message_id)
        setattr(self, "_pending_send_assistant_message_id", assistant_message_id)

        self._append_message_to_session(
            session.session_id,
            {
                "role": "user",
                "content": content,
                "message_id": user_message_id,
                "turn_id": turn_id,
                "ui_status": "准备发送",
                "message_source": "local_send",
                "created_at": time.time(),
            },
        )
        if getattr(self, "_show_assistant_placeholder", True):
            self._append_message_to_session(
                session.session_id,
                {
                    "role": "assistant",
                    "content": ASSISTANT_WAIT_TEXT,
                    "message_id": assistant_message_id,
                    "turn_id": turn_id,
                    "ui_status": "waiting",
                    "parent_message_id": user_message_id,
                    "message_source": "local_placeholder",
                },
            )
            session.has_pending_reply = True
            session.pending_reply_since = time.time()
            if hasattr(self, "_mark_session_waiting_started"):
                self._mark_session_waiting_started(
                    session, reason="send_click_local_placeholder"
                )
        self._save_sessions_to_disk()
        if hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=True,
                reason="send_click_local_append",
            )
        if clear_input and self._auto_clear_input_after_send:
            self.message_edit.clear()
            if hasattr(self, "_ensure_default_chat_input_text"):
                self._ensure_default_chat_input_text()
            if hasattr(self, "_stash_session_compose_draft"):
                self._stash_session_compose_draft(session.session_id)
        return LocalTurn(
            session=session,
            content=content,
            trace_id=trace_id,
            turn_id=turn_id,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
            button=button,
        )

    def _local_turn_from_reuse(
        self,
        session,
        content: str,
        *,
        trace_id: str = "",
        turn_id: str = "",
        user_message_id: str = "",
        assistant_message_id: str = "",
        button: str = "send",
    ) -> LocalTurn:
        trace_id = (trace_id or self._get_active_send_trace_id() or "").strip()
        if trace_id:
            self._set_active_send_trace_id(trace_id)
        existing = (
            self._find_session_message_by_id(session, user_message_id)
            if user_message_id
            else None
        )
        resolved_turn = (
            (existing.turn_id or "").strip()
            if existing is not None
            else (turn_id or "").strip()
        ) or str(uuid.uuid4())
        resolved_user = (
            user_message_id
            if existing is not None
            else (user_message_id or "").strip() or str(uuid.uuid4())
        )
        resolved_assistant = (assistant_message_id or "").strip() or str(
            uuid.uuid4()
        )
        return LocalTurn(
            session=session,
            content=content.strip(),
            trace_id=trace_id,
            turn_id=resolved_turn,
            user_message_id=resolved_user,
            assistant_message_id=resolved_assistant,
            button=button,
        )

    def _build_send_plan(
        self,
        turn: LocalTurn,
        *,
        from_pending_bootstrap: bool = False,
        suppress_system_message: bool = False,
        source: str = "direct",
        skip_prebind_checks: bool = False,
        page_action_plan=None,
    ) -> SendPlan:
        """单次 resolve_page_action(send) + 目标解析；GUI 点击前的忙/绑定检查也集中在此。"""
        session = turn.session
        content = turn.content
        plan = SendPlan(
            turn=turn,
            from_pending_bootstrap=from_pending_bootstrap,
            suppress_system_message=suppress_system_message,
            message_source=source,
        )
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)
        plan.is_bootstrap = bind_state == BIND_STATE_PREBOUND_HOME

        if not skip_prebind_checks:
            busy_reason = self._session_send_busy_reason(session)
            if busy_reason:
                plan = self._apply_busy_to_plan(plan, busy_reason)
                self._log_send_plan(plan)
                return plan

            response_ready, response_msg = self._check_bound_client_response_ready(
                session
            )
            if not response_ready:
                plan.decision = "queued"
                plan.reason = response_msg or "bound_page_not_ready"
                plan.block_status = "等待发送"
                plan.enqueue = True
                plan.render_reason = "response_not_ready_keep_local_message"
                self._log_send_plan(plan)
                return plan

            reopen_plan = self._apply_reopen_checks_to_plan(plan, content)
            if reopen_plan is not None:
                self._log_send_plan(reopen_plan)
                return reopen_plan

            if self._bind_each_chat_to_page and self._session_needs_first_message_bind(
                session
            ):
                ready, bind_reason = self._prepare_first_message_binding(
                    session, content
                )
                if not ready:
                    if bind_reason == "__WAITING_HOME_PENDING__":
                        self._update_local_user_message_status(
                            session,
                            turn.user_message_id,
                            "等待发送",
                            detail=bind_reason,
                        )
                        if hasattr(self, "_render_current_chat_messages"):
                            self._render_current_chat_messages(
                                force_bottom=True,
                                reason="send_first_bind_waiting_home",
                            )
                        self._save_sessions_to_disk()
                        plan.stop_after_handle = True
                        self._log_send_plan(plan)
                        return plan
                    plan.decision = "blocked"
                    plan.reason = bind_reason or "first_message_bind_not_ready"
                    plan.block_status = "等待发送" if bind_reason else "目标不可用"
                    plan.system_msg = bind_reason or ""
                    plan.render_reason = (
                        "send_first_bind_not_ready"
                        if bind_reason
                        else "send_first_bind_blocked"
                    )
                    self._log_send_plan(plan)
                    return plan

        page_action = page_action_plan
        if page_action is None and hasattr(self, "resolve_page_action"):
            page_action = self.resolve_page_action(session, action="send")
        elif page_action is None:
            send_decision, send_reason, target_item, send_detail = (
                self.resolve_send_decision(session, content=content)
            )
            page_action = PageActionPlan.from_resolve_result(
                {
                    "action": "send",
                    "decision": send_decision,
                    "reason": send_reason,
                    "target_item": target_item,
                    "capability_detail": send_detail,
                    "client_id": (send_detail or {}).get("client_id", ""),
                    "page_instance_id": (send_detail or {}).get("page_instance_id", ""),
                    "conversation_id": (send_detail or {}).get("conversation_id", ""),
                    "url": (send_detail or {}).get("url", ""),
                    "target_source": (send_detail or {}).get("target_source", ""),
                }
            )
        self._apply_page_action_to_send_plan(plan, page_action)

        if plan.decision == "blocked":
            plan.block_status = "目标不可用"
            plan.system_msg = (
                plan.reason or "当前没有可用 ChatGPT 页面，消息已保留在本地。"
            )
            plan.hint = plan.system_msg
            plan.render_reason = "send_decision_blocked_keep_local_message"
            self._log_send_plan(plan)
            return plan

        if not plan.client_id:
            plan.decision = "blocked"
            plan.reason = plan.reason or "no_bound_client"
            plan.block_status = "目标不可用"
            plan.render_reason = "send_no_target_client"
            self._log_send_plan(plan)
            return plan

        self._log_send_plan(plan)
        return plan

    def _apply_page_action_to_send_plan(self, plan: SendPlan, page_action) -> None:
        plan.apply_page_action(page_action)

    def _apply_busy_to_plan(self, plan: SendPlan, busy_reason: str) -> SendPlan:
        session = plan.session
        turn = plan.turn
        if busy_reason == "waiting_conversation_created":
            plan.decision = "blocked"
            plan.reason = busy_reason
            plan.block_status = "等待发送"
            plan.system_msg = "正在创建 ChatGPT 对话，请稍候…"
            plan.render_reason = "send_busy_waiting_conversation"
            return plan
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
            plan.decision = "queued"
            plan.reason = busy_reason
            plan.block_status = "已加入队列"
            plan.enqueue = True
            plan.system_msg = (
                "当前绑定的是 ChatGPT 首页，请新建或进入一个对话后消息将自动发送。"
            )
            plan.render_reason = "send_prebound_home_enqueued"
            return plan
        plan.decision = "queued"
        plan.reason = busy_reason
        plan.block_status = "已加入队列"
        plan.enqueue = True
        if busy_reason == "pending_reply":
            plan.hint = "已加入发送队列，等待当前回复结束后自动发送。"
        elif busy_reason in (
            "responding",
            "generating",
            "waiting",
            "pending",
            "queued",
        ):
            plan.hint = "已加入发送队列，等待页面空闲后自动发送。"
        else:
            plan.hint = (
                f"已加入发送队列（{len(self._session_send_queue(session.session_id))} 条等待发送）。"
            )
        plan.render_reason = "send_busy_enqueued_local_message"
        return plan

    def _apply_reopen_checks_to_plan(
        self, plan: SendPlan, content: str
    ) -> SendPlan | None:
        if not self._bind_each_chat_to_page:
            reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                plan.session, content
            )
            if reopen_result is False:
                self._update_local_user_message_status(
                    plan.session,
                    plan.turn.user_message_id,
                    "等待发送",
                    detail="reopen_bind_page_failed",
                )
                if hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="send_reopen_failed_keep_local_message",
                    )
                self._apply_chat_bind_visual_state()
                plan.stop_after_handle = True
                return plan
            return None

        session = plan.session
        turn = plan.turn
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        has_conversation = bool((remote.get("conversation_id") or "").strip())
        needs_reopen_wait = (
            remote_binding_enabled(remote)
            and has_conversation
            and bind_state
            not in (BIND_STATE_PREBOUND_HOME, BIND_STATE_WAITING_HOME)
            and not self._session_has_sendable_bound_page(remote)
        )
        if needs_reopen_wait:
            self._update_local_user_message_status(
                session,
                turn.user_message_id,
                "等待发送",
                detail="wait_bind_page_online",
            )
            reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                session,
                content,
                user_message_id=turn.user_message_id,
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
                plan.stop_after_handle = True
                return plan
            return None

        reopen_result = self._prepare_bound_conversation_reopen_if_needed(
            session, content
        )
        if reopen_result is False:
            self._update_local_user_message_status(
                session,
                turn.user_message_id,
                "等待发送",
                detail="reopen_bind_page_failed",
            )
            if hasattr(self, "_render_current_chat_messages"):
                self._render_current_chat_messages(
                    force_bottom=True,
                    reason="send_reopen_failed_keep_local_message",
                )
            self._apply_chat_bind_visual_state()
            plan.stop_after_handle = True
            return plan
        return None

    def _log_send_plan(self, plan: SendPlan) -> None:
        self._append_log(
            "[SEND][PLAN] "
            + kv_line(
                trace_id=plan.trace_id or "-",
                decision=plan.decision or "-",
                reason=plan.reason or "-",
                client_id=plan.client_id or "-",
                conversation_id=plan.conversation_id or "-",
                enqueue="true" if plan.enqueue else "false",
                source=plan.message_source or "-",
            ),
            echo=True,
        )

    def _handle_send_blocked(self, plan: SendPlan) -> dict | None:
        """blocked / 需本地排队的 queued：更新本地消息状态，不入 server。"""
        if plan.stop_after_handle:
            return None
        session = plan.session
        turn = plan.turn
        status = plan.block_status or (
            "已加入队列" if plan.enqueue else "目标不可用"
        )
        reason = plan.reason or "send_blocked"
        self._append_log(
            "[SEND][BLOCK] "
            + kv_line(
                trace_id=plan.trace_id or "-",
                reason=reason,
                status=status,
                step=plan.render_reason or "-",
            ),
            echo=True,
        )
        self._update_local_user_message_status(
            session,
            turn.user_message_id,
            status,
            detail=reason,
        )
        if plan.enqueue:
            self._enqueue_user_message_for_session(
                session,
                plan.content,
                reuse_message_id=turn.user_message_id,
            )
        if hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=True,
                reason=plan.render_reason,
            )
        if plan.system_msg and not plan.suppress_system_message:
            self._add_system_message(plan.system_msg)
        if plan.hint:
            self._set_tm_action_hint(plan.hint)
        self._apply_chat_bind_visual_state()
        return {
            "ok": False,
            "reason": reason,
            "retryable": plan.retryable,
        }

    def _dispatch_send_plan(self, plan: SendPlan) -> dict:
        """allowed/queued 且目标已 resolve：组 payload、上传、入 server 队列。"""
        session = plan.session
        turn = plan.turn
        self._rebind_current_session_to_online_client_if_needed()

        allow_fallback = False
        if hasattr(self, "is_same_conversation_fallback_enabled"):
            allow_fallback = self.is_same_conversation_fallback_enabled(
                "send", session=session
            )
        payload = self._compose_send_payload(
            session,
            turn_id=turn.turn_id,
            content=plan.content,
            client_id=plan.client_id,
            url=plan.url,
            page_instance_id=plan.page_instance_id,
            conversation_id=plan.conversation_id,
            target_source=plan.target_source,
            bootstrap_conversation=plan.is_bootstrap,
            trace_id=plan.trace_id,
            allow_same_conversation_fallback=allow_fallback,
            target_page_snapshot=plan.target_page_snapshot,
        )
        if not self._patch_chat_send_target_payload(session, payload):
            self._append_log(
                "[SEND][BLOCK] "
                + kv_line(
                    trace_id=plan.trace_id or "-",
                    reason="send_target_incomplete",
                ),
                echo=True,
            )
            return {
                "ok": False,
                "reason": "send_target_incomplete",
                "retryable": True,
            }

        self._append_log(
            "[SEND][DISPATCH] "
            + kv_line(
                trace_id=plan.trace_id or "-",
                client_id=plan.client_id or "-",
                conversation_id=plan.conversation_id or "-",
                source=plan.message_source or "-",
                bootstrap="true" if plan.is_bootstrap else "false",
            ),
            echo=True,
        )

        pending = {
            "payload": payload,
            "content": plan.content,
            "turn_id": turn.turn_id,
            "user_message_id": turn.user_message_id,
            "assistant_message_id": turn.assistant_message_id,
            "from_pending_bootstrap": plan.from_pending_bootstrap,
            "reuse_user_message_id": turn.user_message_id,
            "message_source": plan.message_source,
            "suppress_system_message": plan.suppress_system_message,
        }

        result = self._execute_queued_chat_send(session, pending)
        if isinstance(result, dict):
            ok = bool(result.get("ok"))
            self._append_log(
                "[SEND][RESULT] "
                + kv_line(
                    trace_id=plan.trace_id or "-",
                    ok="true" if ok else "false",
                    reason=(result.get("reason") or "-"),
                    bridge_message_id=(result.get("bridge_message_id") or "-"),
                ),
                echo=True,
            )
        return result
