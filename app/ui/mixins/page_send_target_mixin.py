"""发送目标解析、绑定校验与在线页面选择。"""

import re
import time

from app.constants import BOUND_PAGE_ONLINE_SECONDS
from app.utils.page_status import (
    evaluate_page_capability,
    evaluate_send_page,
    explain_page_decision,
    get_page_liveness,
    is_dialog_ready_page,
    is_page_online,
    page_url_from,
)
from app.utils.tm_activity import classify_tm_client_activity
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id


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
            except (TypeError, ValueError):
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
        status = status or self._last_bridge_status or {}
        candidates = []
        for item in self._iter_tm_clients(status, online_only=False):
            if not isinstance(item, dict):
                continue
            if self._client_conversation_id(item) != conversation_id:
                continue
            if not self._tm_page_is_online_simple(item):
                continue
            if not is_dialog_ready_page(item):
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
        dialog_ready = is_dialog_ready_page(item)
        page_liveness = get_page_liveness(item)
        return {
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": url,
            "source": source,
            "online": online,
            "page_liveness": page_liveness,
            "dialog_ready": dialog_ready,
            "item": item,
        }

    def _session_bound_identity(self, remote):
        remote = normalize_remote_chatgpt(remote)
        bound_url = (
            remote.get("conversation_url")
            or remote.get("url")
            or remote.get("page_url")
            or ""
        ).strip()
        return {
            "client_id": (remote.get("client_id") or "").strip(),
            "page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "conversation_id": self._remote_conversation_id(remote) or "",
            "url": bound_url,
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
        status = status or self._last_bridge_status or {}
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
        if not is_dialog_ready_page(item):
            return False, "bound_not_dialog_ready"
        return True, ""

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
            f"dialog_ready={'true' if target.get('dialog_ready') else 'false'}",
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
            "如需固定该页面，请点击绑定当前页面。"
        )
        if hasattr(self, "_set_tm_action_hint"):
            self._set_tm_action_hint(hint)

    def _resolve_conversation_action_target(self, session, *, action="send", status=None):
        """
        为 sync/send 统一解析目标页面。
        绑定窗口（client_id + page_instance_id）优先；同 conversation_id 仅作兜底。
        不在此流程静默 relink，也不使用手动选中页覆盖绑定页。
        """
        status = status or self._last_bridge_status or {}
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        conversation_id = self._remote_conversation_id(remote)
        bound_client_id = (remote.get("client_id") or "").strip()

        if bound_client_id:
            self._log_action_target_bound_check(session, remote, action=action)

        if bound_client_id:
            item = self._find_bound_page_item_for_action(remote, status=status)
            if isinstance(item, dict):
                usable, unusable_reason = self._bound_page_usable_for_action(item, remote)
                if usable:
                    target = self._conversation_action_target_payload(
                        item, source="bound_client"
                    )
                    self._log_action_target_selected(session, target, action=action)
                    return target
                if unusable_reason == "prebound_home":
                    target = {
                        "client_id": bound_client_id,
                        "page_instance_id": (item.get("page_instance_id") or "").strip(),
                        "conversation_id": "",
                        "url": page_url_from(item),
                        "source": "prebound_home_wait_conversation",
                        "online": self._tm_page_is_online_simple(item),
                        "dialog_ready": False,
                        "item": item,
                    }
                    self._log_action_target_selected(session, target, action=action)
                    return target

        fallback_reason = "bound_page_missing_or_offline"
        if conversation_id:
            item = self._pick_best_conversation_page(conversation_id, status=status)
            if isinstance(item, dict):
                target = self._conversation_action_target_payload(
                    item, source="same_conversation_latest_fallback"
                )
                if bound_client_id:
                    self._log_action_target_fallback(
                        session,
                        remote,
                        target,
                        reason=fallback_reason,
                    )
                    self._log_action_target_mismatch(session, remote, target)
                self._log_action_target_selected(session, target, action=action)
                return target

        item = self._get_current_or_recent_online_tm_page(status=status)
        if isinstance(item, dict) and is_dialog_ready_page(item):
            target = self._conversation_action_target_payload(
                item, source="recent_dialog_ready_page"
            )
            self._log_action_target_selected(session, target, action=action)
            return target

        if action == "sync" and bound_client_id:
            item = self._find_bound_page_item_for_action(remote, status=status)
            if isinstance(item, dict) and self._tm_page_is_online_simple(item):
                if self._is_prebound_home_page(item):
                    target = {
                        "client_id": bound_client_id,
                        "page_instance_id": (item.get("page_instance_id") or "").strip(),
                        "conversation_id": "",
                        "url": page_url_from(item),
                        "source": "prebound_home_wait_conversation",
                        "online": True,
                        "dialog_ready": False,
                        "item": item,
                    }
                    self._log_action_target_selected(session, target, action=action)
                    return target

        return None

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
        detail["queueable"] = decision == "queued"
        return decision == "allowed", detail
    def _find_online_client_for_remote(self, remote, bridge_status=None):
        remote = normalize_remote_chatgpt(remote)
        status = bridge_status if bridge_status is not None else self._last_bridge_status

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
        if not remote.get("enabled"):
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
        if not remote.get("enabled"):
            return False
        conversation_id = self._remote_conversation_id(remote)
        if not conversation_id:
            return False
        status = bridge_status if bridge_status is not None else self._last_bridge_status
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

        status = self._last_bridge_status or {}
        client_info = self._pick_auto_bind_client(
            status, (session.session_id if session else "") or ""
        )
        if not client_info and status.get("tampermonkey_online"):
            client_id = (status.get("tampermonkey_client_id") or "").strip()
            client_info = self._client_info_from_status(client_id)
            if client_info:
                client_info = dict(client_info)
                client_info["page_url"] = (
                    client_info.get("page_url")
                    or (status.get("tampermonkey_page_url") or "").strip()
                )
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
            if remote.get("enabled") and self._session_has_sendable_bound_page(remote):
                return False

        status = self._last_bridge_status or {}
        bound_info, bound_state, _bound_reason = self._resolve_bound_page_info(
            status=status
        )
        if bound_state == "online" and isinstance(bound_info, dict):
            resolved_client_id = (bound_info.get("client_id") or "").strip()
            if resolved_client_id and resolved_client_id != bound_client_id:
                self.set_bound_page(
                    session, bound_info, reason="auto_rebind_bound_info", silent=True
                )
                self._update_bound_page_display()
                self._save_sessions_to_disk()
            return False
        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        bound_conversation_url = page_url_from(remote)
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(bound_conversation_url)
        bound_url_base = bound_conversation_url.split("#")[0] if bound_conversation_url else ""
        lock_conversation = bool(
            remote.get("enabled")
            and bind_state == BIND_STATE_BOUND_CONVERSATION
            and bound_conversation_id
        )

        candidates = []
        for item in status.get("tampermonkey_clients") or []:
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
                f"url={client_info.get('page_url') or '-'}"
            )
            self._update_bound_page_display()
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
        if self._pending_auto_bind_session_id == session_id:
            return (
                "",
                "",
                False,
                "当前对话正在等待新打开的 ChatGPT 页面上线并自动绑定，请稍后再发送。",
            )

        if not self._bind_each_chat_to_page:
            status_early = self._last_bridge_status or {}
            fallback_page = self._best_live_conversation_client(status_early)
            if fallback_page:
                fb_client_id = (fallback_page.get("client_id") or "").strip()
                fb_url = page_url_from(fallback_page)
                self._append_log(
                    "[SEND_TARGET][FALLBACK_PICK] "
                    f"session_id={session_id} "
                    f"client_id={fb_client_id or '-'} "
                    f"page_instance_id={(fallback_page.get('page_instance_id') or '-').strip() or '-'} "
                    f"reason=bind_disabled_pick_live_conversation",
                    echo=True,
                )
                return self._send_target_ok(
                    fb_client_id,
                    fb_url,
                    "未启用页面绑定，已选择当前在线会话页面。",
                )
            self._append_log(
                "[SEND_TARGET][FALLBACK_FAIL] "
                f"session_id={session_id} reason=bind_disabled_no_live_conversation",
                echo=True,
            )
            return self._send_target_blocked(
                "未启用页面绑定，且没有可用的在线会话页面。"
            )

        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        status = self._last_bridge_status or {}
        enabled = bool(remote.get("enabled"))
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
                    "当前对话尚未绑定 ChatGPT 页面，请先发送首条消息。",
                )

            if self._session_has_wrong_existing_conversation_bind(session):
                return (
                    "",
                    "",
                    False,
                    "当前对话错误绑定到已有 ChatGPT 对话页。请点击“绑定当前页面”覆盖后重新发送。",
                )

            if (
                self._is_new_local_session_without_remote_conversation(session)
                and self._auto_bind_unbound_page
            ):
                return (
                    "",
                    "",
                    False,
                    "当前对话尚未绑定 ChatGPT 首页，请先发送首条消息。",
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

        bound_conversation_id_early = self._remote_conversation_id(remote)
        if bound_conversation_id_early:
            online_by_conv = self._find_online_page_by_conversation_id(
                bound_conversation_id_early, status=status
            )
            if isinstance(online_by_conv, dict) and self._tm_page_is_online_simple(
                online_by_conv
            ):
                resolved_client_id = (online_by_conv.get("client_id") or "").strip()
                resolved_page_url = page_url_from(online_by_conv) or page_url
                if (
                    resolved_client_id
                    and resolved_client_id != client_id
                    and bind_state != BIND_STATE_PREBOUND_HOME
                ):
                    self.set_bound_page(
                        session,
                        online_by_conv,
                        reason="auto_rebind_online_by_conv",
                        silent=True,
                    )
                    remote = normalize_remote_chatgpt(session.remote_chatgpt)
                    client_id = (remote.get("client_id") or "").strip()
                    resolved_page_url = page_url_from(remote) or resolved_page_url
                return (
                    client_id or resolved_client_id,
                    resolved_page_url or page_url,
                    True,
                    "同对话在线页。",
                )

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
                    (remote.get("conversation_url") or "").strip()
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
                f"activity={stale_detail.get('activity')}"
            )

        bound_conversation_id = self._remote_conversation_id(remote)
        if bound_conversation_id:
            details = self._binding_status_details(session)
            active_conv = (details.get("online_conversation_id") or "").strip()
            if active_conv and active_conv != "-" and active_conv != bound_conversation_id:
                self._append_log(
                    f"[SEND][BLOCK_WRONG_ACTIVE_PAGE] session_id={session_id} "
                    f"bound_conversation_id={bound_conversation_id} "
                    f"active_conversation_id={active_conv} "
                    f"reason=bound_page_offline_reopen_required"
                )

        rebind_attempted = self._rebind_current_session_to_online_client_if_needed()
        if rebind_attempted:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            client_id = (remote.get("client_id") or "").strip()
            page_url = page_url_from(remote)
            matched_client = self._find_online_client_for_remote(remote)
            if matched_client:
                matched_client_id = (matched_client.get("client_id") or "").strip()
                matched_page_url = page_url_from(matched_client)
                if not matched_page_url:
                    matched_page_url = page_url
                return (
                    matched_client_id or client_id,
                    page_url or matched_page_url,
                    True,
                    "绑定页面已自动换绑并在线。",
                )
            ok_send, _ = self._client_sendable_for_bridge(client_id)
            if ok_send:
                return (
                    client_id,
                    page_url,
                    True,
                    "绑定页面已自动换绑并在线。",
                )

        if (
            self._auto_open_bound_page_when_missing
            and not self._pending_auto_bind_session_id
        ):
            open_url = page_url or self._preferred_open_url_for_session(session)
            if self._auto_open_url_once(
                session,
                open_url,
                "自动打开当前对话绑定页面",
            ):
                if rebind_attempted:
                    hint = (
                        "当前绑定页面离线，已尝试自动换绑到在线页面；"
                        "仍未找到可用在线页面，已打开绑定页面，"
                        "请等待油猴上线后重新发送。"
                    )
                else:
                    hint = (
                        "未找到在线 ChatGPT 页面，已打开绑定页面，"
                        "请等待油猴上线后重新发送。"
                    )
                return self._send_target_blocked(hint)
            if rebind_attempted:
                hint = (
                    "当前绑定页面离线，已尝试自动换绑；"
                    "仍未找到在线页面。绑定页面已在近期打开，"
                    "请等待油猴上线后重新发送。"
                )
            else:
                hint = (
                    "未找到在线 ChatGPT 页面。绑定页面已在近期打开，"
                    "请等待油猴上线后重新发送。"
                )
            return self._send_target_blocked(hint)

        if self._allow_fallback_to_any_page:
            fallback_page = self._best_live_conversation_client(status)
            if fallback_page:
                fb_client_id = (fallback_page.get("client_id") or "").strip()
                fb_url = page_url_from(fallback_page)
                self._append_log(
                    "[SEND_TARGET][FALLBACK_PICK] "
                    f"session_id={session_id} "
                    f"client_id={fb_client_id or '-'} "
                    f"page_instance_id={(fallback_page.get('page_instance_id') or '-').strip() or '-'} "
                    f"reason=bound_offline_fallback_live_conversation",
                    echo=True,
                )
                return self._send_target_ok(
                    fb_client_id,
                    fb_url,
                    "绑定页面未在线，已退回当前在线会话页面。",
                )
            self._append_log(
                "[SEND_TARGET][FALLBACK_FAIL] "
                f"session_id={session_id} reason=bound_offline_no_live_conversation",
                echo=True,
            )
            return self._send_target_blocked(
                "绑定页面未在线，也没有可用的在线会话页面。"
            )

        return self._send_target_blocked("绑定页面未打开，请先打开当前对话绑定页面。")
    def _best_live_conversation_client(self, status=None):
        status = status or self._last_bridge_status or {}
        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
        candidates = []
        for item in self._iter_tm_clients(status, online_only=True):
            if not self._is_queueable_chatgpt_client(item):
                continue
            client_id = self._tm_client_id(item)
            score = 0
            if client_id == live_client_id:
                score += 100
            activity = classify_tm_client_activity(item)
            tier = {
                "active_focused": 40,
                "active_visible": 30,
                "active_hidden": 25,
                "online_unknown": 15,
                "stale_hidden": 0,
                "offline": 0,
            }.get(activity, 0)
            score += tier
            if item.get("has_focus"):
                score += 5
            vis = (item.get("visibility_state") or "").strip()
            if vis == "visible":
                score += 3
            last_seen = self._page_float_field(item, "last_seen", 0.0)
            poll_ts = self._page_float_field(item, "last_poll_at", last_seen)
            candidates.append((score, last_seen, poll_ts, item))
        if not candidates:
            return None
        candidates.sort(key=lambda row: (row[0], row[1], row[2]), reverse=True)
        return dict(candidates[0][3])
    def _binding_status_details(self, session=None):
        session = session or self._current_session()
        status = self._last_bridge_status or {}
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        bound_client_id = (remote.get("client_id") or "").strip() or "-"
        bound_conv_id = self._remote_conversation_id(remote) or "-"

        live_client = self._best_live_conversation_client(status)
        online_client_id = "-"
        online_conv_id = "-"
        if live_client:
            online_client_id = (live_client.get("client_id") or "").strip() or "-"
            online_conv_id = self._client_conversation_id(live_client) or "-"

        bind_state = self._remote_bind_state(remote)
        is_prebound_home = bind_state in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        )
        if not remote.get("enabled"):
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
            "online_client_id": online_client_id,
            "online_conversation_id": online_conv_id,
            "bound_client_id": bound_client_id,
            "bound_conversation_id": bound_conv_id,
            "match": match,
            "live_client": live_client,
        }
    def _verify_send_target_binding(self, session, target_client_id, target_page_url):
        """轻量校验：仅核对已解析目标与 session 绑定是否一致，不重新决策。"""
        if not self._bind_each_chat_to_page:
            return self._send_target_ok(target_client_id, target_page_url, "")

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return self._send_target_ok(target_client_id, target_page_url, "")

        expected_client_id = (remote.get("client_id") or "").strip()
        expected_conversation_id = (remote.get("conversation_id") or "").strip()
        target_conversation_id = parse_conversation_id(target_page_url) or ""

        if expected_client_id and target_client_id == expected_client_id:
            return self._send_target_ok(target_client_id, target_page_url, "")

        if expected_conversation_id and target_conversation_id == expected_conversation_id:
            return self._send_target_ok(target_client_id, target_page_url, "")

        return self._send_target_blocked("发送目标与当前绑定页面不一致。")

