"""发送主线：本地轮次 -> 单次 plan -> blocked 处理 / dispatch。"""

from __future__ import annotations

import time
import traceback
import uuid

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
    BOOTSTRAP_CLAIM_UNCLAIMED_WARN_TEXT,
    BOOTSTRAP_CLAIM_WAIT_TEXT,
    BOOTSTRAP_CLAIM_WARN_AFTER_SECONDS,
    BOOTSTRAP_CLAIMED_WAIT_TEXT,
    ASSISTANT_REPLY_PENDING_STATUSES,
)
from app.models import (
    remote_binding_enabled,
    BIND_MODE_CONVERSATION,
    BIND_MODE_HOME_PENDING,
    BIND_MODE_PAGE_CHANNEL,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_HOME,
    derive_bind_mode,
    normalize_remote_chatgpt,
)
from app.utils.page_status import PageActionPlan, PageCapability, page_url_from
from app.utils.send_plan import LocalTurn, SendPlan
from app.utils.trace_log import kv_line, make_send_trace_id


class SendFlowMixin:
    def _schedule_save_sessions_to_disk(self, delay_ms=800):
        """无 SessionMixin 时回退为立即保存（测试桩 / 轻量宿主）。"""
        save_fn = getattr(self, "_save_sessions_to_disk", None)
        if callable(save_fn):
            save_fn()

    def _is_temp_home_bound_state(self, bind_state: str) -> bool:
        from app.models import is_temp_home_bound_state

        return is_temp_home_bound_state(bind_state)

    def _session_bootstrap_message_id(self, session) -> str:
        if session is None:
            return ""
        remote = normalize_remote_chatgpt(getattr(session, "remote_chatgpt", None) or {})
        bridge_id = (remote.get("bootstrap_message_id") or "").strip()
        if bridge_id:
            return bridge_id
        from app.server.message_queue import get_message_state

        for message in reversed(getattr(session, "messages", []) or []):
            if message.role != "user":
                continue
            candidate = (message.bridge_message_id or "").strip()
            if not candidate:
                continue
            state = get_message_state(candidate)
            if state and state.get("bootstrap_conversation"):
                return candidate
        return ""

    def _bootstrap_message_delivery_phase(self, bridge_message_id: str) -> str:
        from app.server.message_queue import get_message_state

        bridge_message_id = (bridge_message_id or "").strip()
        if not bridge_message_id:
            return ""
        state = get_message_state(bridge_message_id)
        if not state or not state.get("bootstrap_conversation"):
            return ""
        status = (state.get("message_status") or "").strip().lower()
        if status in ("failed", "cancelled"):
            return "failed"
        if status == "queued":
            return "queued"
        if status in ("delivered", "acked", "waiting_reply", "replied"):
            return "delivered"
        return ""

    def _session_bootstrap_claim_pending(self, session) -> bool:
        bridge_id = self._session_bootstrap_message_id(session)
        if not bridge_id:
            return False
        return self._bootstrap_message_delivery_phase(bridge_id) == "queued"

    def _bootstrap_waiting_assistant_text(self, session) -> str:
        bridge_id = self._session_bootstrap_message_id(session)
        if not bridge_id:
            return ASSISTANT_WAIT_TEXT
        phase = self._bootstrap_message_delivery_phase(bridge_id)
        if phase == "failed":
            return "发送失败"
        if phase == "delivered":
            return BOOTSTRAP_CLAIMED_WAIT_TEXT
        if phase == "queued":
            elapsed = 0.0
            if hasattr(self, "_session_pending_elapsed_sec"):
                elapsed = float(self._session_pending_elapsed_sec(session) or 0)
            if elapsed >= float(BOOTSTRAP_CLAIM_WARN_AFTER_SECONDS):
                return BOOTSTRAP_CLAIM_UNCLAIMED_WARN_TEXT
            return BOOTSTRAP_CLAIM_WAIT_TEXT
        return ASSISTANT_WAIT_TEXT

    def _sync_bootstrap_waiting_display(self, session, *, force_render: bool = False) -> bool:
        if session is None or not self._session_has_pending_assistant_reply(session):
            return False
        bridge_id = self._session_bootstrap_message_id(session)
        if not bridge_id:
            return False
        desired = self._bootstrap_waiting_assistant_text(session)
        changed = False
        for message in reversed(getattr(session, "messages", []) or []):
            if message.role != "assistant":
                continue
            msg_bridge = (message.bridge_message_id or "").strip()
            if msg_bridge and msg_bridge != bridge_id:
                continue
            text = (message.content or "").strip()
            status = (message.ui_status or "").strip()
            if (
                not msg_bridge
                and text not in ASSISTANT_WAIT_TEXTS
                and status not in ASSISTANT_REPLY_PENDING_STATUSES
            ):
                continue
            if text == desired:
                break
            message.content = desired
            message.ui_status = "等待中"
            session.updated_at = time.time()
            changed = True
            break
        if not changed:
            return False
        if force_render or session.session_id == getattr(self, "_current_session_id", ""):
            if hasattr(self, "_schedule_current_chat_render"):
                self._schedule_current_chat_render(
                    "bootstrap_waiting_display_sync",
                    delay_ms=0,
                    force_bottom=False,
                )
            elif hasattr(self, "_render_current_chat_messages"):
                self._render_current_chat_messages(
                    force_bottom=False,
                    reason="bootstrap_waiting_display_sync",
                )
            elif hasattr(self, "_render_session_chat"):
                self._render_session_chat(session, scroll_policy="keep")
        if hasattr(self, "_refresh_session_list"):
            self._refresh_session_list(select_session_id=session.session_id)
        if hasattr(self, "_schedule_save_sessions_to_disk"):
            self._schedule_save_sessions_to_disk()
        return True

    def _new_local_send_turn(
        self,
        content: str,
        *,
        session=None,
        trace_id: str = "",
        button: str = "send",
    ) -> LocalTurn:
        """仅分配 turn / message id，不写入会话（发送 plan 通过后再 append）。"""
        session = session or self._ensure_current_session()
        trace_id = (trace_id or make_send_trace_id(session.session_id)).strip()
        turn_id = str(uuid.uuid4())
        user_message_id = str(uuid.uuid4())
        assistant_message_id = str(uuid.uuid4())
        return LocalTurn(
            session=session,
            content=content,
            trace_id=trace_id,
            turn_id=turn_id,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
            button=button,
        )

    def _append_local_send_turn(
        self,
        turn: LocalTurn,
        *,
        clear_input: bool = True,
    ) -> dict[str, str] | None:
        """仅用于允许立即 dispatch 到网页的发送，不用于 queued 消息。

        此函数会：
        - 追加 user 消息
        - 创建 assistant waiting 占位
        - 设置 session.has_pending_reply = True
        - 设置 session.reply_waiting_since
        - 调用 _mark_session_waiting_started()

        对于 queued 消息，请使用 _append_local_queued_user_turn()。
        """
        session = turn.session
        content = turn.content
        turn_id = turn.turn_id
        user_message_id = turn.user_message_id
        assistant_message_id = turn.assistant_message_id

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
            wait_text = ASSISTANT_WAIT_TEXT
            remote = normalize_remote_chatgpt(getattr(session, "remote_chatgpt", None) or {})
            bind_state = (
                self._effective_bind_state(session)
                if hasattr(self, "_effective_bind_state")
                else (remote.get("bind_state") or "")
            )
            if self._is_temp_home_bound_state(bind_state):
                wait_text = BOOTSTRAP_CLAIM_WAIT_TEXT
            self._append_message_to_session(
                session.session_id,
                {
                    "role": "assistant",
                    "content": wait_text,
                    "message_id": assistant_message_id,
                    "turn_id": turn_id,
                    "ui_status": "waiting",
                    "parent_message_id": user_message_id,
                    "message_source": "local_placeholder",
                },
            )
            session.has_pending_reply = True
            session.reply_waiting_since = time.time()
            if hasattr(self, "_mark_session_waiting_started"):
                self._mark_session_waiting_started(
                    session, reason="send_click_local_placeholder"
                )

        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()

        if hasattr(self, "_schedule_current_chat_render"):
            self._schedule_current_chat_render(
                "send_click_local_append",
                delay_ms=0,
                force_bottom=True,
            )
        elif hasattr(self, "_render_current_chat_messages"):
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

        return {
            "user_message_id": user_message_id,
            "assistant_message_id": assistant_message_id,
            "turn_id": turn_id,
        }

    def _append_local_queued_user_turn(
        self,
        turn: LocalTurn,
        *,
        clear_input: bool = True,
    ) -> dict[str, str] | None:
        """仅用于 queued 消息：只追加 user 消息，不追加 assistant 占位。

        与 _append_local_send_turn 不同：
        - 不创建 assistant waiting 占位
        - 不设置 session.has_pending_reply
        - 不设置 session.reply_waiting_since
        - 不调用 _mark_session_waiting_started()

        queued 消息在队列中等待，不应产生 pending_reply 阻塞。
        """
        session = turn.session
        content = turn.content
        turn_id = turn.turn_id
        user_message_id = turn.user_message_id

        setattr(self, "_pending_send_turn_id", turn_id)
        setattr(self, "_pending_send_user_message_id", user_message_id)

        self._append_message_to_session(
            session.session_id,
            {
                "role": "user",
                "content": content,
                "message_id": user_message_id,
                "turn_id": turn_id,
                "ui_status": "已加入队列",
                "message_source": "local_queue",
                "bridge_message_id": "",
                "created_at": time.time(),
            },
        )

        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()

        if hasattr(self, "_schedule_current_chat_render"):
            self._schedule_current_chat_render(
                "queue_enqueue_local",
                delay_ms=0,
                force_bottom=True,
            )
        elif hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=True,
                reason="queue_enqueue_local",
            )

        if clear_input and self._auto_clear_input_after_send:
            self.message_edit.clear()
            if hasattr(self, "_ensure_default_chat_input_text"):
                self._ensure_default_chat_input_text()
            if hasattr(self, "_stash_session_compose_draft"):
                self._stash_session_compose_draft(session.session_id)

        return {
            "user_message_id": user_message_id,
            "turn_id": turn_id,
        }

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
        plan.is_bootstrap = self._is_temp_home_bound_state(bind_state)

        if hasattr(self, "_clear_stale_pending_reply_before_send"):
            self._clear_stale_pending_reply_before_send(session)

        if not skip_prebind_checks:
            ensure_page = getattr(
                self, "_ensure_page_for_local_conversation_send", None
            ) or getattr(self, "_ensure_temp_home_bound_for_send", None)
            if self._is_session_unbound(session) and callable(ensure_page):
                ok = ensure_page(session)
                if not ok:
                    plan.decision = "blocked"
                    plan.reason = "auto_open_chatgpt_failed"
                    plan.block_status = "自动打开 ChatGPT 页面失败"
                    plan.system_msg = (
                        "自动打开 ChatGPT 页面失败，请手动打开页面后重试。"
                    )
                    plan.enqueue = False
                    plan.render_reason = "send_auto_open_chatgpt_failed"
                    self._log_send_plan(plan)
                    return plan
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                bind_state = self._effective_bind_state(session)
                plan.is_bootstrap = self._is_temp_home_bound_state(bind_state)

            if self._is_temp_home_bound_state(bind_state):
                temp_plan = self._apply_temp_home_send_plan(plan, session, remote)
                if temp_plan is not None:
                    self._log_send_plan(temp_plan)
                    return temp_plan

            busy_reason = self._session_send_busy_reason(session)
            if busy_reason:
                if busy_reason == "pending_reply":
                    page_action = page_action_plan
                    if page_action is None and hasattr(self, "resolve_page_action"):
                        page_action = self.resolve_page_action(
                            session,
                            action="send",
                            user_initiated=(source or "").strip() == "gui_click",
                        )
                    self._apply_page_action_to_send_plan(plan, page_action)
                    if not plan.client_id:
                        plan.client_id = (
                            remote.get("client_id")
                            or remote.get("prebound_home_client_id")
                            or ""
                        ).strip()
                    if not plan.page_instance_id:
                        plan.page_instance_id = (
                            remote.get("page_instance_id")
                            or remote.get("prebound_home_page_instance_id")
                            or ""
                        ).strip()
                    if not plan.conversation_id:
                        plan.conversation_id = (remote.get("conversation_id") or "").strip()
                    if not plan.url:
                        plan.url = (remote.get("url") or "").strip()
                    page_no = "-"
                    if hasattr(self, "_session_bound_page_no_text"):
                        page_no = (
                            self._session_bound_page_no_text(session) or "-"
                        )
                    if not (plan.client_id or plan.page_instance_id):
                        self._append_log(
                            "[SEND][BLOCKED] "
                            + kv_line(
                                reason="missing_target_for_pending_queue",
                                session_id=session.session_id,
                                bind_state=bind_state or "-",
                                page_no=page_no,
                                client_id=plan.client_id or "-",
                                page_instance_id=plan.page_instance_id or "-",
                                conversation_id=plan.conversation_id or "-",
                            ),
                            echo=True,
                        )
                        plan.decision = "blocked"
                        plan.reason = "missing_target_for_pending_queue"
                        plan.block_status = "目标页信息缺失，请重新绑定页面。"
                        plan.enqueue = False
                        plan.system_msg = plan.block_status
                        plan.render_reason = "send_pending_missing_target"
                        self._log_send_plan(plan)
                        return plan
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
                        if hasattr(self, "_schedule_current_chat_render"):
                            self._schedule_current_chat_render(
                                "send_first_bind_waiting_home",
                                delay_ms=0,
                                force_bottom=True,
                            )
                        elif hasattr(self, "_render_current_chat_messages"):
                            self._render_current_chat_messages(
                                force_bottom=True,
                                reason="send_first_bind_waiting_home",
                            )
                        self._schedule_save_sessions_to_disk()
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
        if page_action is None and hasattr(self, "resolve_bound_page_target"):
            if hasattr(self, "resolve_page_action"):
                page_action = self.resolve_page_action(
                    session,
                    action="send",
                    user_initiated=(source or "").strip() == "gui_click",
                )
        elif page_action is None and hasattr(self, "resolve_page_action"):
            page_action = self.resolve_page_action(session, action="send")
        elif page_action is None:
            # DEPRECATED: resolve_send_decision removed, use resolve_page_action(action="send")
            send_decision, send_reason, target_page, send_detail = ("blocked", "deprecated_resolve_send_decision", None, {})
            page_action = PageActionPlan.from_resolve_result(
                {
                    "action": "send",
                    "decision": send_decision,
                    "reason_code": send_reason,
                    "page": target_page,
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

    def _resolve_temp_home_send_target(self, session, remote=None):
        remote = normalize_remote_chatgpt(remote or session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        temp_page_id = (remote.get("page_display_id") or "").strip()
        result = {
            "matched": False,
            "temp_page_id": temp_page_id,
            "url": "",
            "client_id": "",
            "page_instance_id": "",
            "conversation_id": "",
            "bind_state": bind_state,
            "reason_code": "temp_home_page_not_found",
        }
        if not self._is_temp_home_bound_state(bind_state):
            result["reason_code"] = "not_temp_home_bound"
            return result
        if not temp_page_id:
            return result
        from app.utils.page_command import resolve_bound_page_in_registry
        from app.utils.page_snapshot import PageRegistry, binding_from_session

        status = self._bridge_ui.last_bridge_status or {}
        reg = getattr(self, "page_registry", None)
        if not isinstance(reg, PageRegistry) or not reg.matches_status(status):
            reg = PageRegistry.from_bridge_status(status)
        binding = binding_from_session(session)
        resolved = resolve_bound_page_in_registry(reg, binding)
        page = resolved.get("page")
        if page is None or not resolved.get("online"):
            result["reason_code"] = (resolved.get("reason_code") or "temp_home_page_not_found").strip()
            return result
        raw = page._raw if isinstance(page._raw, dict) else {}
        result.update(
            {
                "matched": True,
                "url": page_url_from(raw) or (page.url or "") or "https://chatgpt.com/",
                "client_id": (raw.get("client_id") or page.client_id or "").strip(),
                "page_instance_id": (
                    raw.get("page_instance_id") or page.page_instance_id or ""
                ).strip(),
                "conversation_id": "",
                "reason_code": "",
                "page_raw": raw,
            }
        )
        return result

    def _log_temp_home_send_target(self, session, temp_info):
        self._append_log(
            "[SEND][TEMP_HOME_TARGET] "
            + kv_line(
                session_id=session.session_id if session else "-",
                temp_page_id=temp_info.get("temp_page_id") or "-",
                matched="true" if temp_info.get("matched") else "false",
                url=temp_info.get("url") or "-",
                decision="allowed" if temp_info.get("matched") else "blocked",
                reason=temp_info.get("reason_code") or "-",
                client_id=temp_info.get("client_id") or "-",
            ),
            echo=True,
        )

    def _apply_temp_home_send_plan(self, plan: SendPlan, session, remote):
        temp_info = self._resolve_temp_home_send_target(session, remote)
        self._log_temp_home_send_target(session, temp_info)
        if not temp_info.get("matched"):
            plan.decision = "blocked"
            plan.reason = temp_info.get("reason_code") or "temp_home_page_not_found"
            plan.block_status = "临时绑定的首页页面未在线或未找到"
            plan.system_msg = plan.block_status
            plan.render_reason = "send_temp_home_target_missing"
            return plan
        raw = temp_info.get("page_raw") or {}
        cap = PageCapability(
            online=True,
            send_decision="allowed",
            reason_code="",
            client_id=temp_info.get("client_id") or "",
            page_instance_id=temp_info.get("page_instance_id") or "",
            conversation_id="",
            url=temp_info.get("url") or "",
            page_type="home",
            prebound_home=True,
        )
        page_action = PageActionPlan(
            action="send",
            decision="allowed",
            target_source="temp_home_page_display_id",
            reason_code="",
            capability=cap,
            page=raw,
        )
        plan.apply_page_action(page_action)
        plan.is_bootstrap = True
        plan.target_page_id = temp_info.get("temp_page_id") or ""
        plan.decision = "allowed"
        plan.reason = ""
        return plan

    def _apply_page_action_to_send_plan(self, plan: SendPlan, page_action) -> None:
        plan.apply_page_action(page_action)

    def _send_plan_cap_page(self, plan: SendPlan) -> dict:
        cap_page: dict = {}
        page_action = plan.page_action
        if page_action is not None:
            if isinstance(page_action.page, dict):
                cap_page.update(page_action.page)
            cap_page.update(page_action.capability.to_dict())
        if not cap_page:
            cap_page = {
                "client_id": plan.client_id,
                "page_instance_id": plan.page_instance_id,
                "conversation_id": plan.conversation_id,
                "url": plan.url,
            }
        return cap_page

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
        plan.enqueue = True
        if busy_reason == "pending_reply":
            plan.block_status = "当前仍在等待上一条回复"
            plan.hint = "上一条回复尚未结束，本条将在回复完成后自动发送。"
            plan.render_reason = "send_waiting_prior_reply"
        else:
            plan.block_status = "已加入队列"
        if busy_reason in (
            "responding",
            "generating",
            "waiting",
            "pending",
            "queued",
        ):
            if not plan.hint:
                plan.hint = "已加入发送队列，等待页面空闲后自动发送。"
        elif busy_reason != "pending_reply":
            plan.hint = (
                f"已加入发送队列（{len(self._session_send_queue(session.session_id))} 条等待发送）。"
            )
        if busy_reason != "pending_reply":
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
                if hasattr(self, "_schedule_current_chat_render"):
                    self._schedule_current_chat_render(
                        "send_reopen_failed_keep_local_message",
                        delay_ms=0,
                        force_bottom=True,
                    )
                elif hasattr(self, "_render_current_chat_messages"):
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
                if hasattr(self, "_schedule_current_chat_render"):
                    self._schedule_current_chat_render(
                        "send_wait_bind_page_failed",
                        delay_ms=0,
                        force_bottom=True,
                    )
                elif hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="send_wait_bind_page_failed",
                    )
                else:
                    self._render_session_chat(session)
                self._schedule_save_sessions_to_disk()
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
            if hasattr(self, "_schedule_current_chat_render"):
                self._schedule_current_chat_render(
                    "send_reopen_failed_keep_local_message",
                    delay_ms=0,
                    force_bottom=True,
                )
            elif hasattr(self, "_render_current_chat_messages"):
                self._render_current_chat_messages(
                    force_bottom=True,
                    reason="send_reopen_failed_keep_local_message",
                )
            self._apply_chat_bind_visual_state()
            plan.stop_after_handle = True
            return plan
        return None

    def _log_send_plan(self, plan: SendPlan) -> None:
        session = plan.session
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        page_no = "-"
        if session and hasattr(self, "_session_bound_page_no_text"):
            page_no = self._session_bound_page_no_text(session) or "-"
        bind_mode = derive_bind_mode(remote)
        if plan.decision == "blocked":
            self._append_log(
                "[SEND][BLOCKED] "
                + kv_line(
                    reason=plan.reason or "-",
                    session_id=session.session_id if session else "-",
                    page_no=page_no,
                ),
                echo=True,
            )
        elif bind_mode in (BIND_MODE_PAGE_CHANNEL, BIND_MODE_HOME_PENDING) or plan.is_bootstrap:
            self._append_log(
                "[SEND][PAGE_CHANNEL] "
                + kv_line(
                    session_id=session.session_id if session else "-",
                    page_no=page_no,
                    page_instance_id=plan.page_instance_id or "-",
                    conversation_id=plan.conversation_id or "-",
                    trace_id=plan.trace_id or "-",
                    decision=plan.decision or "-",
                ),
                echo=True,
            )
        elif bind_mode == BIND_MODE_CONVERSATION or (plan.conversation_id or "").strip():
            self._append_log(
                "[SEND][CONVERSATION] "
                + kv_line(
                    session_id=session.session_id if session else "-",
                    page_no=page_no,
                    conversation_id=plan.conversation_id or remote.get("conversation_id") or "-",
                    trace_id=plan.trace_id or "-",
                    decision=plan.decision or "-",
                ),
                echo=True,
            )
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

    def _handle_send_blocked(
        self, plan: SendPlan, *, messages_appended: bool = True
    ) -> dict | None:
        """blocked / 需本地排队的 queued：更新本地消息状态，不入 server。"""
        if plan.stop_after_handle:
            return None
        session = plan.session
        turn = plan.turn
        if plan.reason == "pending_reply" and plan.enqueue:
            status = plan.block_status or "当前仍在等待上一条回复"
        else:
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
        if not messages_appended:
            hint = (
                plan.system_msg
                or f"目标不可用：{reason}，请刷新页面列表或重新绑定页面"
            )
            if hint and not plan.suppress_system_message:
                self._add_system_message(hint)
            if hasattr(self, "_mark_session_waiting_finished"):
                self._mark_session_waiting_finished(
                    session, reason=f"send_blocked:{reason}"
                )
            self._apply_chat_bind_visual_state()
            return {
                "ok": False,
                "reason": reason,
                "retryable": plan.retryable,
            }
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
        if hasattr(self, "_schedule_current_chat_render"):
            self._schedule_current_chat_render(
                plan.render_reason or "send_plan_render",
                delay_ms=0,
                force_bottom=True,
            )
        elif hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=True,
                reason=plan.render_reason,
            )
        if plan.system_msg and not plan.suppress_system_message:
            self._add_system_message(plan.system_msg)
        if plan.hint:
            self._set_tm_action_hint(plan.hint)
        if getattr(session, "has_pending_reply", False) and plan.decision == "blocked":
            session.has_pending_reply = False
            session.reply_waiting_since = 0
            assistant_id = (turn.assistant_message_id or "").strip()
            for message in reversed(session.messages):
                if (message.message_id or "").strip() != assistant_id:
                    continue
                if message.role != "assistant":
                    continue
                text = (message.content or "").strip()
                msg_status = (message.ui_status or "").strip()
                if text in ASSISTANT_WAIT_TEXTS or msg_status in ASSISTANT_REPLY_PENDING_STATUSES:
                    fail_text = f"发送失败：目标不可用 {reason}"
                    message.content = fail_text
                    message.ui_status = "目标不可用"
                    message.detail = reason
                break
            if hasattr(self, "_mark_session_waiting_finished"):
                self._mark_session_waiting_finished(
                    session, reason=f"send_blocked:{reason}"
                )
            self._schedule_save_sessions_to_disk()
        self._apply_chat_bind_visual_state()
        return {
            "ok": False,
            "reason": reason,
            "retryable": plan.retryable,
        }

    def _fail_local_send_turn(
        self,
        plan: SendPlan,
        *,
        error: Exception | None = None,
        error_message: str = "",
        stage: str = "dispatch",
        local_messages_appended: bool = True,
    ) -> dict:
        """payload 组装或入队异常：更新占位消息并结束 waiting。"""
        session = plan.session
        turn = plan.turn
        err = error_message or (str(error) if error else "unknown")
        err_type = type(error).__name__ if error else "SendError"
        tb = traceback.format_exc() if error else ""
        self._append_log(
            "[SEND][FAILED] "
            + kv_line(
                trace_id=plan.trace_id or "-",
                stage=stage or "-",
                error_type=err_type,
                error=err,
                local_messages_appended=(
                    "true" if local_messages_appended else "false"
                ),
            )
            + (f" traceback={tb}" if tb else ""),
            echo=True,
            level="ERROR",
        )

        if not local_messages_appended:
            if not plan.suppress_system_message:
                self._add_system_message(
                    "发送失败：本地消息创建失败，未发送到网页。"
                )
            if hasattr(self, "_mark_session_waiting_finished"):
                self._mark_session_waiting_finished(
                    session, reason=f"send_failed:{err_type}"
                )
            self._apply_chat_bind_visual_state()
            return {
                "ok": False,
                "reason": err_type,
                "retryable": True,
                "error": err,
            }

        fail_text = "发送失败：payload 组装异常，未发送到网页"
        if stage != "compose_send_payload":
            fail_text = f"发送失败：{err}"

        assistant_id = (turn.assistant_message_id or "").strip()
        user_id = (turn.user_message_id or "").strip()
        if assistant_id and hasattr(self, "_find_session_message_by_id"):
            placeholder = self._find_session_message_by_id(session, assistant_id)
            if placeholder is not None and placeholder.role == "assistant":
                text = (placeholder.content or "").strip()
                status = (placeholder.ui_status or "").strip()
                if status in ASSISTANT_REPLY_PENDING_STATUSES or text in ASSISTANT_WAIT_TEXTS:
                    placeholder.content = fail_text
                    placeholder.ui_status = "发送失败"
                    placeholder.detail = err_type

        if user_id and hasattr(self, "_find_session_message_by_id"):
            if self._find_session_message_by_id(session, user_id) is not None:
                self._update_local_user_message_status(
                    session,
                    user_id,
                    "发送失败",
                    detail=err_type,
                )
        if getattr(session, "has_pending_reply", False):
            session.has_pending_reply = False
            session.reply_waiting_since = 0
        if hasattr(self, "_mark_session_waiting_finished"):
            self._mark_session_waiting_finished(
                session, reason=f"send_failed:{err_type}"
            )
        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()
        if hasattr(self, "_schedule_current_chat_render"):
            self._schedule_current_chat_render(
                f"send_failed_{stage}",
                delay_ms=0,
                force_bottom=True,
            )
        elif hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=True,
                reason=f"send_failed_{stage}",
            )
        self._apply_chat_bind_visual_state()
        return {
            "ok": False,
            "reason": err_type,
            "retryable": True,
            "error": err,
        }

    def _prepare_send_dispatch_payload(self, plan: SendPlan) -> tuple[bool, dict | None]:
        """组装并校验发送 payload；失败时不应已追加本地消息。"""
        session = plan.session
        turn = plan.turn
        self._rebind_current_session_to_online_client_if_needed()

        allow_fallback = False
        if hasattr(self, "is_same_conversation_fallback_enabled"):
            allow_fallback = self.is_same_conversation_fallback_enabled(
                "send", session=session
            )
        try:
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
                target_page_id=plan.target_page_id,
                trace_id=plan.trace_id,
                allow_same_conversation_fallback=allow_fallback,
                cap_page=self._send_plan_cap_page(plan),
            )
        except Exception as exc:
            self._append_log(
                "[SEND][PREPARE][FAIL] "
                + kv_line(
                    trace_id=plan.trace_id or "-",
                    stage="compose_send_payload",
                    error_type=type(exc).__name__,
                    error=str(exc),
                ),
                echo=True,
                level="ERROR",
            )
            return False, None
        if not self._patch_chat_send_target_payload(session, payload):
            return False, None
        try:
            from app.utils.gui_bridge_json_log import log_gui_send_payload_full

            log_gui_send_payload_full(
                trace_id=plan.trace_id,
                session_id=session.session_id,
                turn_id=turn.turn_id,
                user_message_id=turn.user_message_id,
                assistant_message_id=turn.assistant_message_id,
                bridge_message_id="-",
                payload=payload,
            )
        except Exception as exc:
            import traceback

            self._append_log(
                "[GUI][JSON][SEND_PAYLOAD_FULL][LOG_FAILED] "
                f"error_type={type(exc).__name__} error={exc}\n{traceback.format_exc()}",
                echo=True,
                level="ERROR",
            )
        return True, payload

    def _dispatch_send_plan(
        self, plan: SendPlan, *, prepared_payload: dict | None = None
    ) -> dict:
        """allowed/queued 且目标已 resolve：组 payload、上传、入 server 队列。"""
        session = plan.session
        turn = plan.turn

        if prepared_payload is not None:
            payload = prepared_payload
        else:
            ok, payload = self._prepare_send_dispatch_payload(plan)
            if not ok or payload is None:
                self._append_log(
                    "[SEND][BLOCK] "
                    + kv_line(
                        trace_id=plan.trace_id or "-",
                        reason="send_target_incomplete",
                    ),
                    echo=True,
                )
                return self._fail_local_send_turn(
                    plan,
                    error_message="send_target_incomplete",
                    stage="patch_send_target",
                )

        self._append_log(
            "[SEND][DISPATCH] "
            + kv_line(
                trace_id=plan.trace_id or "-",
                client_id=plan.client_id or "-",
                conversation_id=plan.conversation_id or "-",
                source=plan.message_source or "-",
                bootstrap="true" if plan.is_bootstrap else "false",
                target_page_id=plan.target_page_id or "-",
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
            "source": plan.message_source,
            "suppress_system_message": plan.suppress_system_message,
        }

        try:
            result = self._execute_queued_chat_send(session, pending)
        except Exception as exc:
            return self._fail_local_send_turn(
                plan,
                error=exc,
                stage="execute_queued_chat_send",
            )
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
