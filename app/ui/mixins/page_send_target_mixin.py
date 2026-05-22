"""发送目标解析、绑定校验与在线页面选择。"""

import re
import time

from app.constants import BOUND_PAGE_ONLINE_SECONDS, UNBOUND_SESSION_SEND_HINT
from app.utils.page_status import (
    PageActionPlan,
    build_page_key,
    can_sync_conversation,
    evaluate_page_capability,
    evaluate_send_page,
    explain_page_decision,
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
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import conversation_syncable_from
from app.utils.page_snapshot import bridge_status_online
from app.utils.target_sources import (
    TARGET_SOURCE_BOUND_PAGE,
    TARGET_SOURCE_NO_SESSION,
    canonical_target_source,
    target_source_from,
)


class PageSendTargetMixin:

    def _page_float_field(self, item, field, default=0.0):
        raw = item.get(field) if isinstance(item, dict) else None
        try:
            return float(raw if raw not in (None, "") else default)
        except (TypeError, ValueError) as error:
            if (
                hasattr(self, "_is_debug_mode_enabled")
                and self._is_debug_mode_enabled()
                and hasattr(self, "_append_log")
            ):
                self._append_log(
                    "[SEND_TARGET][FLOAT_FIELD_FALLBACK] "
                    f"field={field} value={raw!r} default={default!r} "
                    f"client_id={(item or {}).get('client_id') or '-'} "
                    f"page_instance_id={(item or {}).get('page_instance_id') or '-'} "
                    f"error_type={type(error).__name__} error={error}",
                    echo=False,
                )
            try:
                return float(default)
            except (TypeError, ValueError) as nested_error:
                if hasattr(self, "_append_log"):
                    self._append_log(
                        "[SEND_TARGET][FLOAT_DEFAULT_INVALID] "
                        f"field={field} default={default!r} "
                        f"error_type={type(nested_error).__name__} error={nested_error}",
                        echo=False,
                    )
                return 0.0

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

    def _conversation_action_target_payload(self, item, *, source):
        client_id = (item.get("client_id") or "").strip()
        page_instance_id = (item.get("page_instance_id") or "").strip()
        conversation_id = self._client_conversation_id(item) or ""
        url = page_url_from(item)
        online = self._tm_page_is_online_simple(item)
        conversation_syncable = conversation_syncable_from(item) or can_sync_conversation(item)
        page_liveness = get_page_liveness(item)
        return {
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": url,
            "source": source,
            "target_source": source,
            "online": online,
            "page_liveness": page_liveness,
            "conversation_syncable": conversation_syncable,
            "item": item,
        }

    def _session_bound_identity(self, remote):
        remote = normalize_remote_chatgpt(remote)
        return {
            "client_id": (remote.get("client_id") or "").strip(),
            "page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "conversation_id": self._remote_conversation_id(remote) or "",
            "url": page_url_from(remote),
        }

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

    def _find_bound_page_item_for_action(self, remote, status=None):
        """按会话绑定的 client_id + page_instance_id 查找页面（不跨实例回退）。"""
        identity = self._session_bound_identity(remote)
        bound_client_id = identity["client_id"]
        if not bound_client_id:
            return None
        status = status or self._bridge_ui.last_bridge_status or {}
        bound_page_instance_id = identity["page_instance_id"]
        if bound_page_instance_id and hasattr(self, "_client_info_by_page_identity"):
            item = self._client_info_by_page_identity(
                bound_client_id,
                bound_page_instance_id,
                status=status,
            )
            if isinstance(item, dict):
                return item
            return None
        return self._find_tm_client_by_client_id(bound_client_id, status=status)

    def _bound_page_usable_for_action(self, item, remote):
        if not isinstance(item, dict) or not self._page_matches_bound_identity(item, remote):
            return False, "identity_mismatch"
        if not self._tm_page_is_online_simple(item):
            return False, "bound_page_offline"
        if self._is_prebound_home_page(item):
            return False, "prebound_home"
        if not (conversation_syncable_from(item) or can_sync_conversation(item)):
            return False, "not_conversation_syncable"
        return True, ""

    MANUAL_SET_BOUND_PAGE_REASONS = frozenset(
        {
            "manual_bind",
            "bind_current_page",
            "bind_current_tm_client",
            "manual_bind_existing",
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
        live_client = (status.get("tampermonkey_client_id") or "").strip()
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

    def _should_block_automatic_bind_actions(self, session, *, status=None):
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

    def _explain_page_decision_for_session(self, session, page, action="sync"):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        identity = self._session_bound_identity(remote)
        expected_client_id = identity["client_id"]
        expected_page_instance_id = identity["page_instance_id"]
        expected_conversation_id = identity["conversation_id"]
        bound = False
        if isinstance(page, dict) and expected_client_id:
            bound = self._page_matches_bound_identity(page, remote)
        cap = evaluate_page_capability(
            page,
            action=action,
            bound=bound,
            expected_client_id=expected_client_id,
            expected_page_instance_id=expected_page_instance_id,
            expected_conversation_id=expected_conversation_id,
        )
        detail = cap.to_dict()
        if isinstance(page, dict):
            norm_page = page
            if hasattr(self, "_normalize_tm_page_for_binding"):
                norm_page = self._normalize_tm_page_for_binding(page)
            detail["response_state"] = norm_page.get("response_state") or "unknown"
        return detail

    def _log_action_target_bound_check(self, session, remote, *, action="sync"):
        identity = self._session_bound_identity(remote)
        session_id = session.session_id if session else "-"
        self._append_log(
            "[SYNC][BOUND_TARGET_CHECK] "
            f"action={action} "
            f"session_id={session_id} "
            f"bound_client_id={identity['client_id'] or '-'} "
            f"bound_page_instance_id={identity['page_instance_id'] or '-'} "
            f"bound_conversation_id={identity['conversation_id'] or '-'} "
            f"bound_url={identity['url'] or '-'}",
            echo=True,
        )

    def _log_action_target_selected(self, session, target, *, action="sync"):
        if not isinstance(target, dict):
            return
        session_id = session.session_id if session else "-"
        self._append_log(
            "[SYNC][TARGET_SELECTED] "
            f"action={action} "
            f"session_id={session_id} "
            f"target_source={target.get('source') or '-'} "
            f"target_client_id={target.get('client_id') or '-'} "
            f"target_page_instance_id={target.get('page_instance_id') or '-'} "
            f"target_conversation_id={target.get('conversation_id') or '-'} "
            f"target_url={target.get('url') or '-'} "
            f"online={'true' if target.get('online') else 'false'} "
            f"conversation_syncable={'true' if target.get('conversation_syncable') else 'false'}",
            echo=True,
        )

    def _log_action_target_mismatch(self, session, remote, target):
        if not isinstance(target, dict):
            return
        identity = self._session_bound_identity(remote)
        bound_client = identity["client_id"]
        bound_instance = identity["page_instance_id"]
        target_client = (target.get("client_id") or "").strip()
        target_instance = (target.get("page_instance_id") or "").strip()
        same_conv = bool(
            identity["conversation_id"]
            and (target.get("conversation_id") or "").strip() == identity["conversation_id"]
        )
        if bound_client and target_client == bound_client:
            if bound_instance and target_instance and bound_instance != target_instance:
                mismatch_type = "page_instance_id"
            else:
                return
        elif same_conv:
            mismatch_type = "same_conversation_different_page"
        elif bound_client and target_client != bound_client:
            mismatch_type = "client_id"
        else:
            return
        session_id = session.session_id if session else "-"
        self._append_log(
            "[SYNC][TARGET_MISMATCH] "
            f"session_id={session_id} "
            f"mismatch_type={mismatch_type} "
            f"bound_client_id={bound_client or '-'} "
            f"target_client_id={target_client or '-'} "
            f"bound_page_instance_id={bound_instance or '-'} "
            f"target_page_instance_id={target_instance or '-'} "
            f"conversation_id={identity['conversation_id'] or '-'} "
            f"target_source={target.get('source') or '-'}",
            echo=True,
        )

    def _log_action_target_fallback(self, session, remote, target, *, reason=""):
        if not isinstance(target, dict):
            return
        identity = self._session_bound_identity(remote)
        session_id = session.session_id if session else "-"
        self._append_log(
            "[SYNC][TARGET_FALLBACK] "
            f"session_id={session_id} "
            f"bound_client_id={identity['client_id'] or '-'} "
            f"bound_page_instance_id={identity['page_instance_id'] or '-'} "
            f"bound_conversation_id={identity['conversation_id'] or '-'} "
            f"fallback_client_id={target.get('client_id') or '-'} "
            f"fallback_page_instance_id={target.get('page_instance_id') or '-'} "
            f"fallback_conversation_id={target.get('conversation_id') or '-'} "
            f"reason={reason or 'bound_page_missing_or_offline'}",
            echo=True,
        )
        hint = (
            "绑定页未在线，已临时使用同一对话的其他在线页面同步；"
            "如需固定该页面，请点击绑定所选页面。"
        )
        if hasattr(self, "_set_tm_action_hint"):
            self._set_tm_action_hint(hint)

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

    def _selected_page_mismatch_blocks_action(self, session, action, *, status=None):
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
        blocked_reason,
        status=None,
        capability_detail=None,
    ):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        identity = self._session_bound_identity(remote)
        detail = dict(capability_detail or {})
        detail.setdefault("blocked_reason", blocked_reason)
        detail.setdefault("client_id", identity["client_id"])
        detail.setdefault("page_instance_id", identity["page_instance_id"])
        detail.setdefault("conversation_id", identity["conversation_id"])
        detail.setdefault("url", identity["url"])
        return {
            "decision": "blocked",
            "target": {},
            "target_item": None,
            "target_source": "",
            "blocked_reason": blocked_reason,
            "reason": blocked_reason,
            "client_id": identity["client_id"],
            "page_instance_id": identity["page_instance_id"],
            "conversation_id": identity["conversation_id"],
            "url": identity["url"],
            "online": False,
            "send_decision": "blocked",
            "action": action,
            "page_liveness": "offline",
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
        expected_conversation_id = identity["conversation_id"]
        item = resolved.get("item") if isinstance(resolved, dict) else None
        if not isinstance(item, dict):
            return self._page_action_blocked_result(
                session,
                action=action,
                blocked_reason=self._blocked_reason_for_unresolved_target(session),
                status=status,
            )
        target_source = canonical_target_source(
            (resolved.get("target_source") or resolved.get("source") or "").strip()
        )
        if not target_source:
            target_source = (
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
        page_key = build_page_key(
            {"client_id": client_id, "page_instance_id": page_instance_id}
        )
        bound = self._page_matches_bound_identity(item, remote) if identity["client_id"] else False
        cap = evaluate_page_capability(
            item,
            action=action if action != "copy_last" else "sync",
            bound=bound,
            expected_client_id=identity["client_id"],
            expected_page_instance_id=identity["page_instance_id"],
            expected_conversation_id=expected_conversation_id,
        )
        send_decision = cap.send_decision
        online = bool(cap.online or is_page_online(item))
        blocked_reason = cap.blocked_reason
        page_liveness = cap.page_liveness

        if blocked_reason == "prebound_home_wait_conversation":
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
                blocked_reason = blocked_reason or send_decision or "send_blocked"
        elif action in ("sync_conversation", "copy_last"):
            if can_sync_conversation(item):
                decision = "allowed"
                allowed = True
            else:
                decision = "blocked"
                allowed = False
                blocked_reason = blocked_reason or "not_syncable"
        elif action == "upload":
            if send_decision == "allowed":
                decision = "allowed"
                allowed = True
            else:
                decision = "blocked"
                allowed = False
                blocked_reason = blocked_reason or "upload_not_allowed"
        else:
            decision = "blocked"
            allowed = False
            blocked_reason = blocked_reason or f"unsupported_action:{action}"

        target = {
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": url,
            "target_source": target_source,
            "page_key": page_key,
        }
        result = {
            "decision": decision,
            "target": target,
            "target_item": item,
            "target_source": target_source,
            "blocked_reason": blocked_reason if not allowed else "",
            "reason": blocked_reason if not allowed else (send_decision if action == "send" else ""),
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": url,
            "online": online,
            "send_decision": send_decision,
            "action": action,
            "page_liveness": page_liveness or get_page_liveness(item),
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
        del selected_page, user_initiated
        action = (action or "").strip() or "send"
        if action == "sync":
            action = "sync_conversation"
        status = status or self._bridge_ui.last_bridge_status or {}

        mismatch, mismatch_reason = self._selected_page_mismatch_blocks_action(
            session, action, status=status
        )
        if mismatch:
            blocked = self._page_action_blocked_result(
                session,
                action=action,
                blocked_reason=mismatch_reason,
                status=status,
            )
            return self._finalize_page_action_result(session, action, blocked)

        resolved = self._resolve_conversation_action_target(
            session, action=action, status=status
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
            blocked_reason = (
                (target_fail.get("reason_code") or "").strip()
                or (target_fail.get("reason") or "").strip()
                or self._blocked_reason_for_unresolved_target(session)
            )
            cap_detail = {}
            if (target_fail.get("reason_code") or "").strip():
                cap_detail["reason_code"] = target_fail.get("reason_code")
            if (target_fail.get("reason") or "").strip():
                cap_detail["reason"] = target_fail.get("reason")
            blocked = self._page_action_blocked_result(
                session,
                action=action,
                blocked_reason=blocked_reason,
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
                f"target_source={plan.target_source or '-'} "
                f"blocked_reason={plan.blocked_reason or '-'} "
                + log_page_decision_fields(
                    plan.capability.to_dict(),
                    compact=not debug_on,
                ),
                echo=True,
            )
        return plan

    def _resolve_conversation_action_target(self, session, *, action="send", status=None):
        """仅使用 session.remote_chatgpt 绑定页；无 active/focused/同会话/任意在线兜底。"""
        from app.utils.page_command import resolve_page_command_target
        from app.utils.page_snapshot import PageRegistry

        action = (action or "").strip() or "send"
        if action == "sync":
            action = "sync_conversation"
        status = status or self._bridge_ui.last_bridge_status or {}
        cmd_map = {
            "send": "send_message",
            "upload": "start_upload",
            "copy_last": "copy_last_message",
            "sync_conversation": "sync_conversation",
        }
        cmd = cmd_map.get(action, action)
        reg = PageRegistry.from_bridge_status(status)
        result = resolve_page_command_target(session, cmd, reg)
        page = result.get("page")
        if not result.get("ok") or page is None:
            return None
        item = getattr(page, "_raw", None) or {}
        if not isinstance(item, dict):
            return None
        target = self._conversation_action_target_payload(item, source="bound_page")
        self._log_action_target_selected(session, target, action=action)
        return target

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

    def _is_sendable_chatgpt_client(self, client_info, expected_conversation_id=""):
        if not isinstance(client_info, dict):
            return False
        decision, _reason = evaluate_send_page(
            client_info, expected_conversation_id=expected_conversation_id
        )
        return decision == "allowed"

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
    def _session_bound_page_online(self, session, bridge_status=None):
        if session is None:
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return False
        conversation_id = self._remote_conversation_id(remote)
        if not conversation_id:
            return False
        candidate = self._find_online_client_for_remote(remote, bridge_status=bridge_status)
        if not candidate:
            return False
        return is_page_online(candidate)
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
        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
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
            self._save_sessions_to_disk()

        return ok
    def _preferred_open_url_for_session(self, session):
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )

        history_url = self._chatgpt_url_from_remote(remote)
        if self._is_bindable_chatgpt_url(history_url):
            return history_url

        saved = (self._saved_page_url or "").strip()
        if self._is_bindable_chatgpt_url(saved):
            return saved

        live = self._live_openable_chatgpt_url()
        if self._is_bindable_chatgpt_url(live):
            return live

        return CHATGPT_HOME_URL
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

        remote_early = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if (
            self._bind_each_chat_to_page
            and self._remote_bind_state(remote_early) == BIND_STATE_BOUND_CONVERSATION
            and remote_binding_active(remote_early)
        ):
            page_action = self.resolve_page_action(session, action="send")
            if page_action.decision in ("allowed", "queued"):
                return self._send_target_ok(
                    page_action.client_id,
                    page_action.url,
                    page_action.reason or "",
                )
            blocked = page_action.blocked_reason or page_action.reason or "send_blocked"
            return self._send_target_blocked(
                self._send_target_blocked_user_message(blocked) or blocked
            )

        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        status = self._bridge_ui.last_bridge_status or {}
        enabled = bool(remote_binding_enabled(remote))
        bind_state = self._remote_bind_state(remote)
        client_id = (remote.get("client_id") or "").strip()
        page_url = page_url_from(remote)

        if bind_state == BIND_STATE_PREBOUND_HOME:
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
                    "预绑定首页在线，首条消息将通过首页创建对话。",
                )
            return (
                "",
                "",
                False,
                "预绑定首页已离线，正在重新选择空闲首页或打开新的 ChatGPT 首页。",
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

        bound_info, bound_state, bound_reason = self._resolve_bound_page_info(
            status=status
        )
        if bound_state == "online" and isinstance(bound_info, dict):
            resolved_client_id = (bound_info.get("client_id") or "").strip()
            resolved_page_url = page_url_from(bound_info) or page_url
            if (
                bound_reason == "matched_by_conversation"
                and resolved_client_id
                and resolved_client_id != client_id
                and bind_state != BIND_STATE_PREBOUND_HOME
            ):
                self.set_bound_page(
                    session, bound_info, reason="auto_rebind_bound_info", silent=True
                )
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                client_id = (remote.get("client_id") or "").strip()
                resolved_page_url = (
                    ((remote.get("url") or "") or "").strip()
                    or resolved_page_url
                )
            return (
                client_id or resolved_client_id,
                resolved_page_url or page_url,
                True,
                "绑定页面在线。",
            )

        ok_send, stale_detail = self._client_sendable_for_bridge(client_id)
        if ok_send:
            return self._send_target_ok(client_id, page_url, "绑定页面在线。")
        if client_id and self._is_client_online(client_id) and stale_detail:
            self._append_log(
                f"[SEND][PAGE_ACTIVITY_REJECT] session_id={session_id} "
                f"client_id={client_id or '-'} reason=bound_client_poll_not_fresh "
                f"poll_age={stale_detail.get('poll_age')} "
                f"seen_age={stale_detail.get('seen_age')} "
                f"activity_state={stale_detail.get('activity_state')}"
            )

        bound_conversation_id = self._remote_conversation_id(remote)
        if bound_conversation_id:
            details = self._binding_status_details(session)
            online = details.get("online") if isinstance(details.get("online"), dict) else {}
            active_conv = (online.get("conversation_id") or "").strip()
            if active_conv and active_conv != "-" and active_conv != bound_conversation_id:
                self._append_log(
                    f"[SEND][BLOCK_WRONG_ACTIVE_PAGE] session_id={session_id} "
                    f"bound_conversation_id={bound_conversation_id} "
                    f"active_conversation_id={active_conv} "
                    f"reason=bound_page_offline_reopen_required"
                )

        return self._send_target_blocked(
            "绑定页面未在线，请先打开当前对话绑定页面，或重新绑定所选页面。"
        )
    def _binding_status_details(self, session=None):
        session = session or self._current_session()
        status = self._bridge_ui.last_bridge_status or {}
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        bound_client_id = (remote.get("client_id") or "").strip() or "-"
        bound_conv_id = self._remote_conversation_id(remote) or "-"

        online_client_id = "-"
        online_conv_id = "-"
        live_client = None
        if bound_client_id and bound_client_id != "-":
            for item in status.get("pages") or []:
                if (item.get("client_id") or "").strip() != bound_client_id:
                    continue
                live_client = item
                if self._tm_page_is_online_simple(item):
                    online_client_id = bound_client_id
                    online_conv_id = self._client_conversation_id(item) or "-"
                break

        bind_state = self._remote_bind_state(remote)
        is_prebound_home = bind_state in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        )
        if not remote_binding_enabled(remote):
            match = "未绑定"
        elif is_prebound_home or bound_conv_id in ("", "-"):
            match = "预绑定首页"
        elif bound_client_id == "-" or online_client_id == "-":
            match = "无法比对"
        elif (
            bound_client_id == online_client_id
            and bound_conv_id == online_conv_id
        ):
            match = "一致"
        else:
            match = "不一致"

        return {
            "bound": {
                "client_id": bound_client_id,
                "conversation_id": bound_conv_id,
            },
            "online": {
                "client_id": online_client_id,
                "conversation_id": online_conv_id,
            },
            "match": match,
            "live_client": live_client,
        }
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

    def _same_conversation_fallback_enabled(self, action="", session=None):
        return self.is_same_conversation_fallback_enabled(action, session=session)

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
        target = page_action.get("target") if isinstance(page_action.get("target"), dict) else {}
        target_src = canonical_target_source(
            target_source_from(page_action) or (page_action.get("target_source") or "")
        )
        if target_src not in (TARGET_SOURCE_BOUND_PAGE, ""):
            out = dict(page_action)
            out["decision"] = "blocked"
            out["reason"] = "non_bound_target_source"
            detail = dict(out.get("capability_detail") or {})
            detail["blocked_reason"] = "non_bound_target_source"
            out["capability_detail"] = detail
            out["blocked_reason"] = "non_bound_target_source"
            return out
        reason = self._send_binding_verify_blocked_reason(
            session,
            target_client_id=(target.get("client_id") or "").strip(),
            url=(target.get("url") or "").strip(),
            target_page_instance_id=(target.get("page_instance_id") or "").strip(),
            target_conversation_id=(target.get("conversation_id") or "").strip(),
        )
        if not reason:
            return page_action
        out = dict(page_action)
        out["decision"] = "blocked"
        out["reason"] = reason
        detail = dict(out.get("capability_detail") or {})
        detail["blocked_reason"] = reason
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

