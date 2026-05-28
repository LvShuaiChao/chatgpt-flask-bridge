"""发送目标解析、绑定校验与在线页面选择。"""

import re
import time

from app.constants import BOUND_PAGE_ONLINE_SECONDS, UNBOUND_SESSION_SEND_HINT
from app.utils.page_command import evaluate_sync_poll_freshness
from app.utils.page_status import (
    PageActionPlan,
    can_sync_conversation,
    evaluate_page_capability,
    evaluate_send_page,
    get_page_liveness,
    is_page_online,
    log_page_decision_fields,
    page_url_from,
)
from app.utils.tm_activity import classify_tm_client_activity
from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_TEMP_HOME_BOUND,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_HOME,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import conversation_syncable_from
from app.utils.page_status import bridge_status_online
from app.utils.target_sources import (
    TARGET_SOURCE_BOUND_PAGE,
    TARGET_SOURCE_NO_SESSION,
    canonical_target_source,
    target_source_from,
)


class PageSendTargetMixin:

    @property
    def _bridge_ui(self):
        """兼容测试桩：允许 mixin 在未初始化 MainWindow 状态时运行。"""

        state = self.__dict__.get("_bridge_ui_state")
        if state is not None:
            return state
        from app.ui.main_window_state import BridgeUiState

        state = BridgeUiState()
        self.__dict__["_bridge_ui_state"] = state
        return state

    @_bridge_ui.setter
    def _bridge_ui(self, value):
        self.__dict__["_bridge_ui_state"] = value

    def _page_float_field(self, item, field, default=0.0):
        from app.utils.safe_parse import safe_float_field

        return safe_float_field(item, field, default)

    def _page_instance_recency_key(self, item):
        page_instance_id = (item.get("page_instance_id") or "").strip()
        if not page_instance_id:
            return 0
        numbers = re.findall(r"\d+", page_instance_id)
        if numbers:
            try:
                return int(numbers[0])
            except ValueError as error:
                print(
                    "[PAGE_SEND_TARGET][PAGE_INSTANCE_PARSE_FAILED] "
                    "function=_page_instance_recency_key "
                    f"page_instance_id={page_instance_id!r} "
                    f"client_id={(item.get('client_id') or '-')} "
                    f"error_type={type(error).__name__} "
                    f"error={error}"
                )
                return 0
        return 0

    def _conversation_page_candidate_rank(self, item):
        """同 conversation 多页排序：poll 最新、last_seen 最新、焦点、可见、page_instance 越新越好。"""
        poll_age = self._age_from_ts(item.get("last_poll_at"), context="last_poll_at")
        if poll_age < 0:
            poll_age = self._age_from_ts(item.get("last_seen"), context="last_seen")
        if poll_age < 0:
            poll_age = self._age_from_ts(
                item.get("last_heartbeat_at"),
                context="last_heartbeat_at",
            )
        if poll_age < 0:
            poll_age = 999999.0
        last_seen = self._page_float_field(
            item,
            "last_seen",
            self._page_float_field(item, "last_heartbeat_at", 0.0),
        )
        has_focus = 1 if self._page_has_focus(item) else 0
        visibility = self._normalize_visibility_state(item)
        visible = 1 if visibility == "visible" else 0
        page_instance_recency = self._page_instance_recency_key(item)
        return (-poll_age, last_seen, has_focus, visible, page_instance_recency)

    def _pick_best_conversation_page(self, conversation_id, status=None):
        """按 conversation_id 选最新在线、可对话页（sync/send 共用）。"""
        conversation_id = (conversation_id or "").strip()
        if not conversation_id:
            return None
        status = status or self._bridge_ui.last_bridge_status or {}
        from app.utils.page_snapshot import PageRegistry
        from app.utils.page_status import find_online_fallback_page_for_binding

        reg = getattr(self, "page_registry", None)
        if not isinstance(reg, PageRegistry) or not reg.matches_status(status):
            reg = PageRegistry.from_bridge_status(status)
        binding = {"conversation_id": conversation_id}
        fallback, _matched_by = find_online_fallback_page_for_binding(
            reg,
            binding,
            require_conversation_syncable=True,
        )
        if fallback is not None:
            raw = fallback._raw if isinstance(fallback._raw, dict) else {}
            if raw:
                return dict(raw)
        candidates = []
        for item in self._iter_tm_clients(status, online_only=False):
            if not isinstance(item, dict):
                continue
            if self._client_conversation_id(item) != conversation_id:
                continue
            if not self._tm_page_is_online_simple(item):
                continue
            if not (conversation_syncable_from(item) or can_sync_conversation(item)):
                continue
            candidates.append(item)
        if not candidates:
            return None
        candidates.sort(key=self._conversation_page_candidate_rank, reverse=True)
        return dict(candidates[0])

    def _session_bound_identity(self, remote):
        from app.utils.page_binding_identity import remote_binding_identity

        return remote_binding_identity(remote)

    def _session_bound_client_id(self, session=None):
        from app.utils.page_binding_identity import session_bound_client_id

        if session is None and hasattr(self, "_current_session"):
            session = self._current_session()
        return session_bound_client_id(session)

    def _page_matches_bound_identity(self, item, remote):
        if not isinstance(item, dict):
            return False
        identity = self._session_bound_identity(remote)
        bound_client_id = identity["client_id"]
        if not bound_client_id:
            return False
        item_client_id = (item.get("client_id") or "").strip()
        if item_client_id != bound_client_id:
            return False
        bound_page_instance_id = identity["page_instance_id"]
        if bound_page_instance_id:
            item_page_instance_id = (item.get("page_instance_id") or "").strip()
            if item_page_instance_id != bound_page_instance_id:
                return False
        bound_conversation_id = identity["conversation_id"]
        if bound_conversation_id:
            item_conversation_id = self._client_conversation_id(item) or ""
            if item_conversation_id and item_conversation_id != bound_conversation_id:
                return False
        return True

    MANUAL_SET_BOUND_PAGE_REASONS = frozenset(
        {
            "manual_bind",
            "bind_current_page",
            "bind_current_tm_client",
            "manual_bind_existing",
        }
    )

    AUTO_RELINK_FRESH_PAGE_REASONS = frozenset(
        {
            "auto_relink_fresh_page",
            "before_send_relink",
            "before_send_offline_fallback",
            "before_sync_relink",
        }
    )

    AUTO_BIND_MISMATCH_BLOCK_TYPES = frozenset(
        {
            "different_conversation",
            "same_conversation_different_page",
        }
    )

    def _is_manual_set_bound_page_reason(self, reason):
        text = (reason or "").strip()
        if not text:
            return False
        if text in self.MANUAL_SET_BOUND_PAGE_REASONS:
            return True
        return text.startswith("manual_bind")

    def _current_tm_page_identity(self, status=None):
        status = status or self._bridge_ui.last_bridge_status or {}
        manual_page = (
            self._get_manual_current_tm_page(status=status)
            if hasattr(self, "_get_manual_current_tm_page")
            else None
        )
        if isinstance(manual_page, dict):
            return {
                "client_id": (manual_page.get("client_id") or "").strip(),
                "page_instance_id": (manual_page.get("page_instance_id") or "").strip(),
                "conversation_id": (manual_page.get("conversation_id") or "").strip(),
            }
        live_client = (read_snapshot_identity(status, "active")["client_id"] or "").strip()
        if live_client:
            item = self._find_tm_client_by_client_id(live_client, status=status)
            if isinstance(item, dict):
                return {
                    "client_id": live_client,
                    "page_instance_id": (item.get("page_instance_id") or "").strip(),
                    "conversation_id": (self._client_conversation_id(item) or "").strip(),
                }
        return {
            "client_id": "",
            "page_instance_id": "",
            "conversation_id": "",
        }

    def _bound_vs_current_mismatch_type(self, session, *, status=None):
        if session is None:
            return ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return ""
        bound_conv = (self._remote_conversation_id(remote) or "").strip()
        bound_client = (remote.get("client_id") or "").strip()
        bound_instance = (remote.get("page_instance_id") or "").strip()
        current = self._current_tm_page_identity(status=status)
        cur_conv = (current.get("conversation_id") or "").strip()
        cur_client = (current.get("client_id") or "").strip()
        cur_instance = (current.get("page_instance_id") or "").strip()
        if bound_conv and cur_conv and bound_conv != cur_conv:
            return "different_conversation"
        if not bound_conv and not cur_conv:
            return ""
        if bound_conv and cur_conv == bound_conv:
            if bound_instance and cur_instance and bound_instance != cur_instance:
                return "same_conversation_different_page"
            if bound_client and cur_client and bound_client != cur_client:
                return "same_conversation_different_page"
        return ""

    def _should_block_automatic_bind_actions(self, session, *, status=None, bind_reason=""):
        if (bind_reason or "").strip() in self.AUTO_RELINK_FRESH_PAGE_REASONS:
            return False, ""
        if not getattr(self, "_bind_each_chat_to_page", True):
            return False, ""
        mismatch = self._bound_vs_current_mismatch_type(session, status=status)
        if mismatch in self.AUTO_BIND_MISMATCH_BLOCK_TYPES:
            return True, mismatch
        return False, ""

    def _log_sync_target_blocked(self, session, mismatch_type, *, status=None):
        if not hasattr(self, "_append_log"):
            return
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        current = self._current_tm_page_identity(status=status)
        self._append_log(
            "[SYNC][TARGET_BLOCKED] "
            "reason=bound_current_mismatch_require_manual_bind "
            f"mismatch_type={mismatch_type or '-'} "
            f"bound_client_id={(remote.get('client_id') or '-')} "
            f"bound_page_instance_id={(remote.get('page_instance_id') or '-')} "
            f"bound_conversation_id={(self._remote_conversation_id(remote) or '-')} "
            f"current_client_id={(current.get('client_id') or '-')} "
            f"current_page_instance_id={(current.get('page_instance_id') or '-')} "
            f"current_conversation_id={(current.get('conversation_id') or '-')}",
            echo=True,
            level="WARNING",
        )
        hint = (
            "绑定页与当前浏览页不一致，请点击「绑定所选页面」后再同步或发送。"
        )
        if hasattr(self, "_set_tm_action_hint"):
            self._set_tm_action_hint(hint)

    def _log_action_target_selected(self, session, target, *, action="sync", force=False):
        if not isinstance(target, dict):
            return
        session_id = session.session_id if session else "-"
        client_id = (target.get("client_id") or "").strip()
        page_instance_id = (target.get("page_instance_id") or "").strip()
        conversation_id = (target.get("conversation_id") or "").strip()
        throttle_key = (
            f"{session_id}|{action}|{client_id}|{page_instance_id}|{conversation_id}"
        )
        now = time.time()
        log_at = getattr(self, "_action_target_selected_log_at", None)
        if not isinstance(log_at, dict):
            log_at = {}
            self._action_target_selected_log_at = log_at
        last_at = float(log_at.get(throttle_key) or 0)
        if not force and last_at > 0 and (now - last_at) < 5.0:
            return
        log_at[throttle_key] = now
        self._append_log(
            "[SYNC][TARGET_SELECTED] "
            f"action={action} "
            f"session_id={session_id} "
            f"source={target.get('source') or '-'} "
            f"target_client_id={target.get('client_id') or '-'} "
            f"target_page_instance_id={target.get('page_instance_id') or '-'} "
            f"target_conversation_id={target.get('conversation_id') or '-'} "
            f"target_url={target.get('url') or '-'} "
            f"online={'true' if target.get('online') else 'false'} "
            f"conversation_syncable={'true' if target.get('conversation_syncable') else 'false'}",
            echo=True,
        )

    def _bound_session_page_key(self, remote):
        remote = normalize_remote_chatgpt(remote)
        client_id = (remote.get("client_id") or "").strip()
        page_instance_id = (remote.get("page_instance_id") or "").strip()
        if client_id and page_instance_id:
            return f"{client_id}|{page_instance_id}"
        return ""

    def _log_selected_page_mismatch_bound_session(self, session, *, action, selected_key, bound_key):
        if not hasattr(self, "_append_log"):
            return
        self._append_log(
            f"[PAGE_ACTION][SELECTED_PAGE_MISMATCH] action={action} "
            f"session_id={(session.session_id if session else '-')} "
            f"selected_page_key={selected_key or '-'} bound_page_key={bound_key or '-'} "
            f"reason=selected_page_mismatch_bound_session",
            echo=True,
            level="WARNING",
        )

    def _read_gui_selected_page_key(self):
        if hasattr(self, "_selected_tm_page_key"):
            return (self._selected_tm_page_key() or "").strip()
        return ""

    def _selected_page_mismatch_blocks_action_deprecated(self, session, action, *, status=None):
        """GUI 当前选择页与会话绑定页不一致时阻断 send/sync/copy（不静默覆盖绑定）。"""
        action = (action or "").strip()
        if action in ("sync",):
            action = "sync_conversation"
        if action not in ("send", "sync_conversation", "copy_last", "upload"):
            return False, ""
        if not getattr(self, "_bind_each_chat_to_page", True):
            return False, ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if not remote_binding_enabled(remote):
            return False, ""
        bound_key = self._bound_session_page_key(remote)
        if not bound_key:
            return False, ""
        selected_key = self._read_gui_selected_page_key()
        if not selected_key or selected_key == bound_key:
            return False, ""
        self._log_selected_page_mismatch_bound_session(
            session,
            action=action,
            selected_key=selected_key,
            bound_key=bound_key,
        )
        return True, "selected_page_mismatch_bound_session"

    def _page_action_blocked_result(
        self,
        session,
        *,
        action,
        reason_code,
        status=None,
        capability_detail=None,
    ):
        del status
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        identity = self._session_bound_identity(remote)
        detail = dict(capability_detail or {})
        detail.setdefault("reason_code", reason_code)
        detail.setdefault("client_id", identity["client_id"])
        detail.setdefault("page_instance_id", identity["page_instance_id"])
        detail.setdefault("conversation_id", identity["conversation_id"])
        detail.setdefault("url", identity["url"])
        return {
            "decision": "blocked",
            "page": None,
            "source": "",
            "reason_code": reason_code,
            "client_id": identity["client_id"],
            "page_instance_id": identity["page_instance_id"],
            "conversation_id": identity["conversation_id"],
            "url": identity["url"],
            "online": False,
            "send_decision": "blocked",
            "action": action,
            "page_liveness": "offline",
            "capability_detail": detail,
        }

    def _page_action_from_resolved_target(
        self,
        session,
        *,
        action,
        resolved,
        status=None,
    ):
        action = (action or "").strip() or "send"
        if action == "sync":
            action = "sync_conversation"
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        identity = self._session_bound_identity(remote)
        bind_state = self._remote_bind_state(remote)
        expected_conversation_id = identity["conversation_id"]
        if self._is_temp_home_bound_state(bind_state):
            expected_conversation_id = ""
        item = resolved.get("item") if isinstance(resolved, dict) else None
        if not isinstance(item, dict):
            return self._page_action_blocked_result(
                session,
                action=action,
                reason_code=self._blocked_reason_for_unresolved_target(session),
                status=status,
            )
        source = canonical_target_source(
            (resolved.get("source") or resolved.get("source") or "").strip()
        )
        if not source:
            source = (
                TARGET_SOURCE_BOUND_PAGE
                if identity["client_id"]
                else TARGET_SOURCE_NO_SESSION
            )
        client_id = (resolved.get("client_id") or item.get("client_id") or "").strip()
        page_instance_id = (
            (resolved.get("page_instance_id") or item.get("page_instance_id") or "").strip()
        )
        conversation_id = (
            (resolved.get("conversation_id") or self._client_conversation_id(item) or "").strip()
        )
        url = (resolved.get("url") or page_url_from(item) or "").strip()
        matched_by = (resolved.get("matched_by") or "").strip()
        bound = self._page_matches_bound_identity(item, remote) if identity["client_id"] else False
        cap = evaluate_page_capability(
            item,
            action=action if action != "copy_last" else "sync",
            bound=bound,
            expected_client_id=identity["client_id"] if matched_by == "exact" else "",
            expected_page_instance_id=identity["page_instance_id"] if matched_by == "exact" else "",
            expected_conversation_id=expected_conversation_id,
        )
        send_decision = cap.send_decision
        online = bool(cap.online or is_page_online(item))
        reason_code = cap.reason_code
        page_liveness = cap.page_liveness

        if (
            reason_code == "prebound_home_wait_conversation"
            and not (
                action == "send" and self._is_temp_home_bound_state(bind_state)
            )
        ):
            decision = "blocked"
            allowed = False
        elif action == "send":
            if send_decision == "allowed":
                decision = "allowed"
                allowed = True
            elif send_decision == "queued":
                decision = "queued"
                allowed = True
            else:
                decision = "blocked"
                allowed = False
                reason_code = reason_code or send_decision or "send_blocked"
        elif action in ("sync_conversation", "copy_last"):
            if action == "sync_conversation":
                page_snap = resolved.get("page") if isinstance(resolved, dict) else None
                poll_target = page_snap if page_snap is not None else item
                poll_ok, poll_code, _poll_reason = evaluate_sync_poll_freshness(
                    poll_target,
                    now=time.time(),
                )
            else:
                poll_ok, poll_code = True, ""
            if can_sync_conversation(item) and poll_ok:
                decision = "allowed"
                allowed = True
            else:
                decision = "blocked"
                allowed = False
                reason_code = poll_code or reason_code or "not_conversation_syncable"
        elif action == "upload":
            if send_decision == "allowed":
                decision = "allowed"
                allowed = True
            else:
                decision = "blocked"
                allowed = False
                reason_code = reason_code or "upload_not_allowed"
        else:
            decision = "blocked"
            allowed = False
            reason_code = reason_code or f"unsupported_action:{action}"

        result = {
            "decision": decision,
            "page": item,
            "source": source,
            "reason_code": reason_code if not allowed else "",
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": url,
            "online": online,
            "send_decision": send_decision,
            "action": action,
            "page_liveness": page_liveness or get_page_liveness(item),
            "capability_detail": cap.to_dict(),
        }
        return result

    def resolve_page_action(
        self,
        session,
        action,
        status=None,
        selected_page=None,
        *,
        user_initiated=True,
    ):
        """
        统一页面动作判定入口（send / sync_conversation / copy_last）。
        UI 按钮态、执行路径、日志均应以本函数返回的 decision 为准。
        """
        del selected_page
        action = (action or "").strip() or "send"
        if action == "sync":
            action = "sync_conversation"
        status = status or self._bridge_ui.last_bridge_status or {}

        mismatch, mismatch_reason = self._selected_page_mismatch_blocks_action_deprecated(
            session, action, status=status
        )
        if mismatch:
            blocked = self._page_action_blocked_result(
                session,
                action=action,
                reason_code=mismatch_reason,
                status=status,
            )
            return self._finalize_page_action_result(session, action, blocked)

        resolved = self._resolve_conversation_action_target(
            session,
            action=action,
            status=status,
            log_target_selected=bool(user_initiated),
        )
        if not isinstance(resolved, dict):
            from app.utils.page_command import resolve_page_command_target
            from app.utils.page_snapshot import PageRegistry

            cmd_map = {
                "send": "send_message",
                "upload": "start_upload",
                "copy_last": "copy_last_message",
                "sync_conversation": "sync_conversation",
            }
            cmd = cmd_map.get(action, action)
            reg = PageRegistry.from_bridge_status(status)
            target_fail = resolve_page_command_target(session, cmd, reg)
            fail_reason_code = (
                (target_fail.get("reason_code") or "").strip()
                or (target_fail.get("reason") or "").strip()
                or self._blocked_reason_for_unresolved_target(session)
            )
            cap_detail = {}
            if (target_fail.get("reason_code") or "").strip():
                cap_detail["reason_code"] = target_fail.get("reason_code")
            blocked = self._page_action_blocked_result(
                session,
                action=action,
                reason_code=fail_reason_code,
                status=status,
                capability_detail=cap_detail,
            )
            return self._finalize_page_action_result(session, action, blocked)

        result = self._page_action_from_resolved_target(
            session, action=action, resolved=resolved, status=status
        )
        plan = self._finalize_page_action_result(session, action, result)
        if hasattr(self, "_append_log") and (
            not hasattr(self, "_is_debug_mode_enabled") or self._is_debug_mode_enabled()
        ):
            debug_on = (
                hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled()
            )
            self._append_log(
                "[PAGE_ACTION][DECIDE] "
                f"action={action} "
                f"session_id={(session.session_id if session else '-')} "
                f"decision={plan.decision or '-'} "
                f"allowed={'yes' if plan.allowed else 'no'} "
                f"source={plan.source or '-'} "
                f"reason_code={plan.reason_code or '-'} "
                + log_page_decision_fields(
                    plan.capability.to_dict(),
                    compact=not debug_on,
                ),
                echo=True,
            )
        return plan

    def resolve_bound_page_target(
        self,
        session,
        action,
        *,
        status=None,
        user_initiated=False,
        relink=True,
    ):
        """
        发送/同步共用的绑定页解析：基于最新 PageRegistry，支持同会话新鲜页兜底与自动换绑。
        """
        from app.utils.page_command import resolve_bound_page_in_registry
        from app.utils.page_snapshot import PageRegistry, binding_from_session

        action = (action or "").strip() or "send"
        if action == "sync":
            action = "sync_conversation"
        status = status or self._bridge_ui.last_bridge_status or {}
        if user_initiated and hasattr(self, "refresh_page_registry"):
            try:
                self.refresh_page_registry(reason=f"before_{action}", status=status)
                status = self._bridge_ui.last_bridge_status or status
            except Exception as exc:
                if hasattr(self, "_append_log"):
                    self._append_log(
                        "[BOUND_PAGE][REFRESH][FAILED] "
                        f"action={action} "
                        f"error_type={type(exc).__name__} error={exc}",
                        echo=True,
                        level="ERROR",
                    )
        reg = getattr(self, "page_registry", None)
        if not isinstance(reg, PageRegistry) or not reg.matches_status(status):
            reg = PageRegistry.from_bridge_status(status)
            self.page_registry = reg

        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        binding = binding_from_session(session)
        allow_same_conversation = bool((binding.get("conversation_id") or "").strip())
        if action == "sync_conversation":
            relink = False
        resolved = resolve_bound_page_in_registry(
            reg,
            binding,
            allow_same_conversation=allow_same_conversation,
        )
        page = resolved.get("page")
        matched_by = (resolved.get("matched_by") or "none").strip()
        online = bool(resolved.get("online"))
        last_poll_at = float(resolved.get("last_poll_at") or 0.0)
        reason_code = (resolved.get("reason_code") or "").strip()

        session_id = session.session_id if session else "-"
        if hasattr(self, "_append_log"):
            page_type = "-"
            page_conv = "-"
            if page is not None:
                raw = page._raw if isinstance(getattr(page, "_raw", None), dict) else {}
                page_type = (raw.get("page_type") or getattr(page, "page_type", "") or "-").strip() or "-"
                page_conv = (
                    raw.get("conversation_id") or getattr(page, "conversation_id", "") or "-"
                ).strip() or "-"
            self._append_log(
                "[BOUND_PAGE][RESOLVE] "
                f"session_id={session_id} "
                f"action={action} "
                f"remote_client_id={(remote.get('client_id') or '-')} "
                f"remote_page_instance_id={(remote.get('page_instance_id') or '-')} "
                f"remote_conversation_id={(self._remote_conversation_id(remote) or '-')} "
                f"matched_by={matched_by or 'none'} "
                f"page_type={page_type} "
                f"conversation_id={page_conv} "
                f"online={'true' if online else 'false'} "
                f"last_poll_at={last_poll_at:.3f} "
                f"reason_code={reason_code or '-'}",
                echo=user_initiated,
            )
        if action == "sync_conversation":
            bound_conv = self._remote_conversation_id(remote) or ""
            bound_instance = (remote.get("page_instance_id") or "").strip()
            if bound_conv:
                for candidate in reg.get_by_conversation_id(bound_conv):
                    if candidate is None:
                        continue
                    candidate_instance = (candidate.page_instance_id or "").strip()
                    if candidate_instance and candidate_instance != bound_instance:
                        self._append_log(
                            "[SYNC][SAME_CONVERSATION_REJECTED] "
                            f"bound_page_instance_id={bound_instance or '-'} "
                            f"candidate_page_instance_id={candidate_instance or '-'} "
                            f"conversation_id={bound_conv or '-'}",
                            echo=user_initiated,
                        )

        if resolved.get("offline_fallback") and page is not None and hasattr(self, "_append_log"):
            fb_raw = page._raw if isinstance(getattr(page, "_raw", None), dict) else {}
            self._append_log(
                "[BOUND_PAGE][OFFLINE_FALLBACK_FOUND] "
                f"session_id={session_id} "
                f"old_client_id={(remote.get('client_id') or '-')} "
                f"old_page_instance_id={(remote.get('page_instance_id') or '-')} "
                f"old_page_no={str(remote.get('page_no') or remote.get('page_display_id') or '-')} "
                f"old_conversation_id={(self._remote_conversation_id(remote) or '-')} "
                f"new_client_id={(fb_raw.get('client_id') or getattr(page, 'client_id', '') or '-')} "
                f"new_page_instance_id={(fb_raw.get('page_instance_id') or getattr(page, 'page_instance_id', '') or '-')} "
                f"new_page_no={str(fb_raw.get('page_no') or '-')} "
                f"new_url={page_url_from(fb_raw) or '-'} "
                f"reason={matched_by or 'same_conversation'}",
                echo=user_initiated,
            )

        if (
            relink
            and page is not None
            and bool(resolved.get("relink_needed"))
        ):
            item = page._raw if isinstance(page._raw, dict) else {}
            if isinstance(item, dict):
                old_client = (remote.get("client_id") or "").strip()
                old_instance = (remote.get("page_instance_id") or "").strip()
                old_page_no = (
                    remote.get("page_no")
                    or remote.get("page_display_id")
                    or remote.get("temp_page_id")
                    or ""
                )
                old_conv = self._remote_conversation_id(remote) or ""
                relink_reason = (
                    "before_send_offline_fallback"
                    if resolved.get("offline_fallback") and action == "send"
                    else (
                        "before_send_relink"
                        if action == "send"
                        else "before_sync_relink"
                    )
                )
                if resolved.get("offline_fallback") and hasattr(self, "_append_log"):
                    self._append_log(
                        "[BOUND_PAGE][OFFLINE_FALLBACK_REBIND] "
                        f"session_id={session_id} "
                        f"old_client_id={old_client or '-'} "
                        f"old_page_instance_id={old_instance or '-'} "
                        f"old_page_no={str(old_page_no or '-')} "
                        f"old_conversation_id={old_conv or '-'} "
                        f"new_client_id={(item.get('client_id') or '-')} "
                        f"new_page_instance_id={(item.get('page_instance_id') or '-')} "
                        f"new_page_no={str(item.get('page_no') or '-')} "
                        f"new_url={page_url_from(item) or '-'} "
                        f"reason={relink_reason}",
                        echo=True,
                    )
                if hasattr(self, "_relink_session_binding_from_tm_page"):
                    self._relink_session_binding_from_tm_page(
                        session, item, reason=relink_reason
                    )
                elif hasattr(self, "set_bound_page"):
                    self.set_bound_page(
                        session,
                        item,
                        reason="auto_relink_fresh_page",
                        silent=True,
                    )
                if hasattr(self, "_refresh_current_session_binding_display"):
                    self._refresh_current_session_binding_display()
                if hasattr(self, "_refresh_tm_page_selector"):
                    self._refresh_tm_page_selector(
                        status=status,
                        reason="offline_fallback_rebind",
                    )
                if hasattr(self, "_append_log") and not resolved.get("offline_fallback"):
                    display_id = str(item.get("page_no") or "-")
                    self._append_log(
                        "[BOUND_PAGE][RELINK_TO_FRESH_PAGE] "
                        f"old_client_id={old_client or '-'} "
                        f"old_page_instance_id={old_instance or '-'} "
                        f"new_client_id={(item.get('client_id') or '-')} "
                        f"new_page_instance_id={(item.get('page_instance_id') or '-')} "
                        f"page_no={display_id} "
                        f"conversation_id={(item.get('conversation_id') or '-')}",
                        echo=True,
                    )
                binding = binding_from_session(session)
                resolved = resolve_bound_page_in_registry(
                    reg, binding, allow_same_conversation=allow_same_conversation
                )
                page = resolved.get("page")
                matched_by = (resolved.get("matched_by") or "exact").strip()
                online = bool(resolved.get("online"))
                reason_code = (resolved.get("reason_code") or "").strip()

        if page is None or not online:
            if hasattr(self, "_append_log"):
                bound_conv_log = (
                    (binding.get("conversation_id") or "").strip()
                    or self._remote_conversation_id(remote)
                    or ""
                )
                if bound_conv_log:
                    self._append_log(
                        "[BOUND_PAGE][OFFLINE_FALLBACK_MISS] "
                        f"session_id={session_id} "
                        f"old_client_id={(remote.get('client_id') or '-')} "
                        f"old_page_instance_id={(remote.get('page_instance_id') or '-')} "
                        f"old_page_no={str(remote.get('page_no') or remote.get('page_display_id') or '-')} "
                        f"old_conversation_id={bound_conv_log} "
                        f"reason={reason_code or 'bound_page_offline'}",
                        echo=user_initiated,
                    )
        from app.utils.page_command import registry_resolve_to_gui_bound_result

        result = registry_resolve_to_gui_bound_result(resolved)
        if result.get("ok") and isinstance(result.get("target"), dict):
            self._log_action_target_selected(
                session, result["target"], action=action, force=user_initiated
            )
        return result

    def _resolve_conversation_action_target(
        self,
        session,
        *,
        action="send",
        status=None,
        log_target_selected=False,
        user_initiated=False,
    ):
        """委托 resolve_bound_page_target（与 sync/send 共用）。"""
        resolved = self.resolve_bound_page_target(
            session,
            action,
            status=status,
            user_initiated=bool(log_target_selected or user_initiated),
            relink=True,
        )
        if not isinstance(resolved, dict) or not resolved.get("ok"):
            if hasattr(self, "_append_log"):
                reason = "-"
                if isinstance(resolved, dict):
                    reason = (resolved.get("reason") or resolved.get("reason_code") or "-").strip() or "-"
                self._append_log(
                    "[SYNC][TARGET_BLOCKED] "
                    f"reason=resolve_bound_page_target_failed "
                    f"action={action or '-'} "
                    f"detail_reason={reason}",
                    echo=True,
                    level="WARNING",
                )
            return None
        return resolved.get("target")

    def _send_target_result(self, client_id="", page_url="", ok=False, reason=""):
        return (
            (client_id or "").strip(),
            (page_url or "").strip(),
            bool(ok),
            str(reason or ""),
        )

    def _send_target_ok(self, client_id, page_url, reason=""):
        return self._send_target_result(client_id, page_url, True, reason)

    def _send_target_blocked(self, reason):
        return self._send_target_result("", "", False, reason)

    def _is_queueable_chatgpt_client(self, client_info, expected_conversation_id=""):
        if not isinstance(client_info, dict):
            return False
        decision, _reason = evaluate_send_page(
            client_info, expected_conversation_id=expected_conversation_id
        )
        return decision in ("allowed", "queued")

    def _client_sendable_for_bridge(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return False, {
                "send_decision": "blocked",
                "reason": "missing_client_id",
                "client_id": "",
            }
        info = self._client_info_from_status(client_id)
        if not isinstance(info, dict):
            return False, {
                "send_decision": "blocked",
                "reason": "client_missing",
                "client_id": client_id,
            }
        profile = self._tm_client_sync_profile(info)
        decision, reason = evaluate_send_page(info)
        detail = dict(profile)
        detail.update(
            {
                "send_decision": decision,
                "reason": reason,
                "client_id": client_id,
                "url": page_url_from(info),
            }
        )
        if not detail.get("online"):
            return False, detail
        detail["send_queueable"] = decision == "queued"
        detail["send_requestable"] = bool(
            detail.get("send_requestable")
            or decision in ("allowed", "queued")
        )
        return bool(detail.get("send_requestable")), detail
    def _find_online_client_for_remote(self, remote, bridge_status=None):
        remote = normalize_remote_chatgpt(remote)
        status = bridge_status if bridge_status is not None else self._bridge_ui.last_bridge_status

        bound_client_id = (remote.get("client_id") or "").strip()
        bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
        bound_conversation_id = self._remote_conversation_id(remote)
        bound_url = page_url_from(remote)

        if not bound_conversation_id:
            return None

        now = time.time()
        candidates = []
        for item in self._iter_tm_clients(status, online_only=False):
            if not isinstance(item, dict):
                continue

            item_client_id = (item.get("client_id") or "").strip()
            item_page_instance_id = (item.get("page_instance_id") or "").strip()
            item_url = page_url_from(item)
            item_conversation_id = self._client_conversation_id(item)
            if not item_conversation_id or item_conversation_id != bound_conversation_id:
                continue

            last_seen = float(
                item.get("last_seen") or item.get("last_heartbeat_at") or 0
            )
            seen_age = max(0.0, now - last_seen) if last_seen > 0 else 999999.0

            if not is_page_online(item, now=now):
                continue

            score = 0
            score += 500
            if bound_client_id and item_client_id == bound_client_id:
                score += 100
            if bound_page_instance_id and item_page_instance_id == bound_page_instance_id:
                score += 80
            bound_url_base = bound_url.split("#")[0] if bound_url else ""
            item_url_base = item_url.split("#")[0] if item_url else ""
            if bound_url_base and item_url_base and bound_url_base == item_url_base:
                score += 60

            activity = classify_tm_client_activity(item)
            tier = {
                "active_focused": 4,
                "active_visible": 3,
                "active_hidden": 2,
                "online_unknown": 1,
                "stale_hidden": 0,
                "offline": 0,
            }.get(activity, 0)
            poll_ts = self._page_float_field(
                item,
                "last_poll_at",
                self._page_float_field(item, "last_seen", 0.0),
            )
            is_sendable = self._is_queueable_chatgpt_client(
                item, expected_conversation_id=bound_conversation_id
            )
            freshness = 2 if seen_age <= BOUND_PAGE_ONLINE_SECONDS else 1

            candidates.append(
                (
                    1 if is_sendable else 0,
                    freshness,
                    score,
                    tier,
                    last_seen,
                    poll_ts,
                    item,
                )
            )

        if not candidates:
            return None

        candidates.sort(
            key=lambda row: (row[0], row[1], row[2], row[3], row[4], row[5]),
            reverse=True,
        )
        return dict(candidates[0][6])
    def _session_has_sendable_bound_page(self, remote):
        remote = normalize_remote_chatgpt(remote)
        candidate = self._find_online_client_for_remote(remote)
        if not candidate:
            return False
        expected = self._remote_conversation_id(remote)
        return self._is_queueable_chatgpt_client(candidate, expected)
    def _session_bound_page_has_mismatch(self, session, bridge_status=None):
        if session is None:
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return False
        conversation_id = self._remote_conversation_id(remote)
        if not conversation_id:
            return False
        status = bridge_status if bridge_status is not None else self._bridge_ui.last_bridge_status
        bound_client_id = (remote.get("client_id") or "").strip()
        bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
        for item in self._iter_tm_clients(status, online_only=True):
            item_client_id = (item.get("client_id") or "").strip()
            item_page_instance_id = (item.get("page_instance_id") or "").strip()
            same_client = bool(bound_client_id and item_client_id == bound_client_id)
            same_page_instance = bool(
                bound_page_instance_id and item_page_instance_id == bound_page_instance_id
            )
            if not (same_client or same_page_instance):
                continue
            item_conv = self._client_conversation_id(item) or ""
            if item_conv and item_conv != conversation_id:
                return True
        return False
    def _try_auto_bind_online_page(self, session):
        if self._session_is_local_new_chat_flow(session):
            idle_home = self._find_idle_chatgpt_home_client(
                session_id=(session.session_id if session else "") or "",
                require_user_visible=True,
            )
            if idle_home:
                client_id = (idle_home.get("client_id") or "").strip()
                page_instance_id = (idle_home.get("page_instance_id") or "").strip()
                self._append_log(
                    f"[AUTO_BIND][USE_IDLE_HOME] session_id={session.session_id} "
                    f"client_id={client_id} page_instance_id={page_instance_id or '-'}"
                )
                return self._prebound_home_bind_to_session(
                    session, idle_home, silent=True
                )
            return False

        status = self._bridge_ui.last_bridge_status or {}
        client_info = self._pick_auto_bind_client(
            status, (session.session_id if session else "") or ""
        )
        if not client_info and bridge_status_online(status):
            for page in status.get("pages") or []:
                if not isinstance(page, dict) or not self._tm_page_is_online_simple(page):
                    continue
                client_info = dict(page)
                break
        if not client_info:
            return False
        return self.set_bound_page(
            session, client_info, reason="bind_current_tm_client", silent=True
        )
    def _rebind_current_session_to_online_client_if_needed(self):
        if not self._bind_each_chat_to_page:
            return False

        session = self._current_session()
        if session is None:
            return False

        if self._session_is_local_new_chat_flow(session):
            return False

        blocked, mismatch_type = self._should_block_automatic_bind_actions(session)
        if blocked:
            self._log_sync_target_blocked(session, mismatch_type)
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        bound_client_id = (remote.get("client_id") or "").strip()

        if bind_state == BIND_STATE_PREBOUND_HOME:
            if self._session_has_prebound_home_online(remote):
                return False
            self._append_log(
                "[自动换绑] 预绑定首页离线，不会换绑到其他 conversation 页面。"
            )
            return False

        if bound_client_id and self._is_client_online(bound_client_id):
            if remote_binding_enabled(remote) and self._session_has_sendable_bound_page(remote):
                return False

        status = self._bridge_ui.last_bridge_status or {}
        bound_info, bound_state, _bound_reason = self._resolve_bound_page_info(
            status=status
        )
        if bound_state == "online" and isinstance(bound_info, dict):
            resolved_client_id = (bound_info.get("client_id") or "").strip()
            if resolved_client_id and resolved_client_id != bound_client_id:
                if not self._is_manual_set_bound_page_reason("auto_rebind_bound_info"):
                    if hasattr(self, "_append_log"):
                        self._append_log(
                            "[BIND][SET_BOUND_PAGE][SKIP] "
                            "reason=auto_rebind_bound_info_blocked "
                            f"session_id={session.session_id}",
                            echo=False,
                        )
            return False
        live_client_id = (read_snapshot_identity(status, "active")["client_id"] or "").strip()
        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        bound_conversation_url = page_url_from(remote)
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(bound_conversation_url)
        bound_url_base = bound_conversation_url.split("#")[0] if bound_conversation_url else ""
        lock_conversation = bool(
            remote_binding_enabled(remote)
            and bind_state == BIND_STATE_BOUND_CONVERSATION
            and bound_conversation_id
        )

        candidates = []
        for item in status.get("pages") or []:
            if not isinstance(item, dict):
                continue

            client_id = (item.get("client_id") or "").strip()
            page_url = page_url_from(item)

            if not client_id:
                continue

            if not is_page_online(item):
                continue

            if not self._is_bindable_chatgpt_url(page_url):
                continue

            if self._is_client_bound_to_other_session(item, session.session_id):
                continue

            page_type = (item.get("page_type") or "").strip()
            conversation_id = self._client_conversation_id(item)

            if lock_conversation:
                if conversation_id != bound_conversation_id:
                    continue

            score = 0
            if client_id == live_client_id:
                score += 100
            if (
                bound_conversation_id
                and conversation_id
                and conversation_id == bound_conversation_id
            ):
                score += 500
                if lock_conversation and bound_url_base:
                    page_base = page_url.split("#")[0]
                    if page_base == bound_url_base:
                        score += 20
            if conversation_id:
                score += 50
            if page_type == "conversation":
                score += 30
            if item.get("has_focus"):
                score += 20

            last_seen = self._page_float_field(item, "last_seen", 0.0)
            candidates.append((score, last_seen, item))

        if not candidates:
            if lock_conversation:
                self._append_log(
                    "[自动换绑] 绑定页面离线，未找到同会话在线页面，请打开绑定页面。"
                )
            else:
                self._append_log("[自动换绑] 没有找到可用的在线 ChatGPT 页面。")
            return False

        candidates.sort(key=lambda row: (row[0], row[1]), reverse=True)
        client_info = dict(candidates[0][2])

        page_type = (client_info.get("page_type") or "").strip()
        if lock_conversation or page_type == "conversation":
            ok = self._bind_conversation_to_session(session, client_info, silent=True)
        else:
            ok = False
        if ok:
            self._append_log(
                "[REOPEN][MATCH_BY_CONVERSATION] "
                f"session_id={session.session_id} "
                f"conversation_id={bound_conversation_id or '-'} "
                f"client_id={client_info.get('client_id') or '-'}"
            )
            self._append_log(
                "[自动换绑] "
                f"old_client_id={bound_client_id or '-'} "
                f"new_client_id={client_info.get('client_id') or '-'} "
                f"url={page_url_from(client_info) or '-'}"
            )
            if hasattr(self, "schedule_page_registry_refresh"):
                self.schedule_page_registry_refresh(reason="reopen_match_conversation")
            self._schedule_save_sessions_to_disk()

        return ok
    def _resolve_target_page_for_session(self, session):
        session_id = (session.session_id if session else "") or ""
        remote_early = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if self._remote_bind_state(remote_early) == BIND_STATE_WAITING_HOME:
            return (
                "",
                "",
                False,
                "正在等待 ChatGPT 首页上线，首条消息将在页面上线后自动发送。",
            )
        if self._remote_bind_state(remote_early) == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return (
                "",
                "",
                False,
                "绑定的 ChatGPT 对话页离线，需要重新打开原对话页面。",
            )
        if self._auto_bind.pending_session_id == session_id:
            return (
                "",
                "",
                False,
                "当前对话正在等待新打开的 ChatGPT 页面上线并自动绑定，请稍后再发送。",
            )

        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        status = self._bridge_ui.last_bridge_status or {}
        enabled = bool(remote_binding_enabled(remote))
        bind_state = self._remote_bind_state(remote)
        client_id = (remote.get("client_id") or "").strip()
        page_url = page_url_from(remote)

        if bind_state in (BIND_STATE_PREBOUND_HOME, BIND_STATE_TEMP_HOME_BOUND):
            home_client = self._find_prebound_home_client(remote)
            if home_client:
                home_url = page_url_from(home_client) or page_url or CHATGPT_HOME_URL
                home_id = (
                    client_id
                    or remote.get("prebound_home_client_id")
                    or home_client.get("client_id")
                    or ""
                ).strip()
                return (
                    home_id,
                    home_url,
                    True,
                    "临时首页绑定在线，首条消息将通过首页创建对话。",
                )
            return (
                "",
                "",
                False,
                "临时绑定的首页已离线，正在等待页面上线或重新打开 ChatGPT 首页。",
            )

        if not enabled or not page_url:
            if bind_state == BIND_STATE_UNBOUND:
                return (
                    "",
                    "",
                    False,
                    UNBOUND_SESSION_SEND_HINT,
                )

            if self._session_has_wrong_existing_conversation_bind(session):
                return (
                    "",
                    "",
                    False,
                    "当前对话错误绑定到已有 ChatGPT 对话页。请点击“绑定所选页面”覆盖后重新发送。",
                )

            if (
                self._is_new_local_session_without_remote_conversation(session)
                and self._auto_bind_unbound_page
            ):
                return (
                    "",
                    "",
                    False,
                    UNBOUND_SESSION_SEND_HINT,
                )

            if self._auto_bind_unbound_page and self._try_auto_bind_online_page(
                session
            ):
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                client_id = (remote.get("client_id") or "").strip()
                page_url = page_url_from(remote)
                if client_id:
                    ok_send, _ = self._client_sendable_for_bridge(client_id)
                    if ok_send:
                        return self._send_target_ok(
                            client_id, page_url, "已自动绑定在线 ChatGPT 页面。"
                        )

            return self._send_target_blocked("当前对话未绑定 ChatGPT 页面。")

        if enabled and bind_state == BIND_STATE_BOUND_CONVERSATION:
            page_action = self.resolve_page_action(
                session, action="send", user_initiated=False
            )
            if page_action.decision in ("allowed", "queued"):
                return self._send_target_ok(
                    page_action.client_id,
                    page_action.url,
                    page_action.reason_code or "绑定页面在线。",
                )
            blocked = page_action.reason_code or "send_blocked"
            return self._send_target_blocked(
                self._send_target_blocked_user_message(blocked) or blocked
            )

        return self._send_target_blocked(
            "绑定页面未在线，请先打开当前对话绑定页面，或重新绑定所选页面。"
        )
    def _verify_send_target_binding(
        self,
        session,
        target_client_id,
        target_page_url,
        *,
        target_page_instance_id="",
        target_conversation_id="",
    ):
        """轻量校验：仅核对已解析目标与 session 绑定是否一致，不重新决策。"""
        if not self._bind_each_chat_to_page:
            return self._send_target_ok(target_client_id, target_page_url, "")

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return self._send_target_ok(target_client_id, target_page_url, "")

        reason = self._send_binding_verify_blocked_reason(
            session,
            target_client_id=target_client_id,
            url=target_page_url,
            target_page_instance_id=target_page_instance_id,
            target_conversation_id=target_conversation_id,
        )
        if reason:
            return self._send_target_blocked(reason)
        return self._send_target_ok(target_client_id, target_page_url, "")

    def is_same_conversation_fallback_enabled(self, action="", session=None):
        """强绑定模式：禁止同 conversation / 其它页面 fallback。"""
        del action, session
        return False

    def _send_binding_verify_blocked_reason(
        self,
        session,
        *,
        target_client_id="",
        url="",
        target_page_instance_id="",
        target_conversation_id="",
    ):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if not remote_binding_enabled(remote):
            return ""
        bound_client = (remote.get("client_id") or "").strip()
        bound_instance = (remote.get("page_instance_id") or "").strip()
        bound_conv = self._remote_conversation_id(remote) or ""
        target_client_id = (target_client_id or "").strip()
        target_page_instance_id = (target_page_instance_id or "").strip()
        target_conv = (target_conversation_id or "").strip() or (
            parse_conversation_id(url) or ""
        )
        if not target_conv:
            return "missing_target_conversation_id"
        if bound_conv and target_conv != bound_conv:
            return "conversation_id_mismatch"
        if bound_client and target_client_id and target_client_id != bound_client:
            return "client_id_mismatch"
        if (
            bound_instance
            and target_page_instance_id
            and target_page_instance_id != bound_instance
        ):
            return "page_instance_id_mismatch"
        return ""

    def _apply_send_binding_verify_to_page_action(self, session, page_action):
        if not isinstance(page_action, dict):
            return page_action
        if (page_action.get("decision") or "").strip() not in ("allowed", "queued"):
            return page_action
        page = page_action.get("page") if isinstance(page_action.get("page"), dict) else {}
        target_src = canonical_target_source(
            target_source_from(page_action) or (page_action.get("source") or "")
        )
        if target_src not in (TARGET_SOURCE_BOUND_PAGE, ""):
            out = dict(page_action)
            out["decision"] = "blocked"
            out["reason_code"] = "non_bound_source"
            detail = dict(out.get("capability_detail") or {})
            detail["reason_code"] = "non_bound_source"
            out["capability_detail"] = detail
            return out
        reason = self._send_binding_verify_blocked_reason(
            session,
            target_client_id=(page.get("client_id") or page_action.get("client_id") or "").strip(),
            url=(page.get("url") or page_action.get("url") or "").strip(),
            target_page_instance_id=(
                (page.get("page_instance_id") or page_action.get("page_instance_id") or "").strip()
            ),
            target_conversation_id=(
                (page.get("conversation_id") or page_action.get("conversation_id") or "").strip()
            ),
        )
        if not reason:
            return page_action
        out = dict(page_action)
        out["decision"] = "blocked"
        out["reason_code"] = reason
        detail = dict(out.get("capability_detail") or {})
        detail["reason_code"] = reason
        out["capability_detail"] = detail
        return out

    def _blocked_reason_for_unresolved_target(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bound_client = (remote.get("client_id") or "").strip()
        bound_instance = (remote.get("page_instance_id") or "").strip()
        conversation_id = self._remote_conversation_id(remote) or ""
        status = self._bridge_ui.last_bridge_status or {}
        if conversation_id and not bound_client:
            return "no_bound_page_for_conversation"
        if bound_client:
            # If the exact bound page instance is missing but another page with the same
            # conversation is online, show a more actionable blocked reason.
            try:
                if conversation_id and bound_instance:
                    exact, _matched_by = self._find_page_by_bound_identity(
                        remote,
                        status=status,
                        allow_fallback=False,
                    )
                    if not exact:
                        for item in self._iter_tm_clients(status, online_only=False):
                            if not isinstance(item, dict):
                                continue
                            if (item.get("client_id") or "").strip() != bound_client:
                                continue
                            if self._client_conversation_id(item) != conversation_id:
                                continue
                            if not self._tm_page_is_online_simple(item):
                                continue
                            return "bound_page_instance_lost_same_conversation_online"
            except Exception:
                # Fall back to generic reason if host does not implement helper methods.
                pass
            return "bound_page_offline"
        return "no_target_page"

    def _send_target_blocked_user_message(self, reason):
        reason = (reason or "").strip()
        hints = {
            "bound_page_instance_lost_same_conversation_online": (
                "原绑定页面实例已失效，同对话其它页面在线；请点击「绑定所选页面」固定目标后再发送。"
            ),
            "bound_page_offline": "绑定页面未在线，请先打开或重新绑定对话页。",
            "no_bound_page_for_conversation": "当前对话未绑定具体页面，请先绑定所选页面。",
            "auto_open_chatgpt_failed": (
                "自动打开 ChatGPT 页面失败，请手动打开页面后重试。"
            ),
        }
        return hints.get(reason, reason or "当前无法发送到目标页面。")

    def _finalize_page_action_result(self, session, action, result):
        act = (action or "").strip()
        if isinstance(result, PageActionPlan):
            result = result.to_dict()
        if act == "send" and hasattr(self, "_apply_send_binding_verify_to_page_action"):
            result = self._apply_send_binding_verify_to_page_action(session, result)
        if isinstance(result, PageActionPlan):
            return result
        return PageActionPlan.from_resolve_result(result if isinstance(result, dict) else {})
