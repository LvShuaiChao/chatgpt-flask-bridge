"""页面绑定主 mixin：组合继承与跨 mixin 调度入口。"""

from app.server import cancel_message, get_message_state, get_tm_online_summary, is_server_running

import time

from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import PageRegistry
from app.utils.page_status import (
    evaluate_page_capability,
    explain_page_decision,
    is_page_online,
    log_page_decision_fields,
    page_url_from,
    read_snapshot_identity,
)
from app.ui.mixins.ui_status_compact_mixin import UiStatusCompactMixin
from app.ui.mixins.page_auto_bind_mixin import PageAutoBindMixin
from app.ui.mixins.page_binding_diagnostics_mixin import PageBindingDiagnosticsMixin
from app.ui.mixins.page_binding_display_mixin import PageBindingDisplayMixin
from app.ui.mixins.page_binding_state_mixin import PageBindingStateMixin
from app.ui.mixins.page_open_close_mixin import PageOpenCloseMixin
from app.ui.mixins.page_registry_refresh_mixin import PageRegistryRefreshMixin
from app.ui.mixins.page_selector_mixin import PageSelectorMixin
from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin
from app.ui.mixins.page_sync_mixin import PageSyncMixin
from app.ui.mixins.page_tm_client_mixin import PageTmClientMixin
from PyQt5.QtCore import QTimer


class PageBindMixin(
    PageRegistryRefreshMixin,
    UiStatusCompactMixin,
    PageBindingDiagnosticsMixin,
    PageBindingDisplayMixin,
    PageSyncMixin,
    PageBindingStateMixin,
    PageSelectorMixin,
    PageOpenCloseMixin,
    PageAutoBindMixin,
    PageSendTargetMixin,
    PageTmClientMixin,
):
    def _tm_summary_for_session(self, session=None):
        session = session or self._current_session()
        bound_client_id = ""
        bound_conversation_id = ""
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote_binding_enabled(remote):
                bound_client_id = (remote.get("client_id") or "").strip()
                bound_conversation_id = self._remote_conversation_id(remote)
        summary = get_tm_online_summary(
            bound_client_id=bound_client_id or None,
            bound_conversation_id=bound_conversation_id or None,
        )
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote_binding_enabled(remote):
                summary["bound"] = {
                    "client_id": bound_client_id,
                    "page_instance_id": (remote.get("page_instance_id") or "").strip(),
                    "conversation_id": bound_conversation_id or "",
                    "url": (remote.get("url") or "").strip(),
                }
        if "active" not in summary:
            summary["active"] = {
                "client_id": "",
                "conversation_id": "",
            }
        reg = getattr(self, "page_registry", None)
        if isinstance(reg, PageRegistry):
            reg_summary = reg.summary()
            summary["online_clients"] = reg_summary.get("online_count", 0)
            summary["total_clients"] = reg_summary.get("total_count", 0)
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote_binding_enabled(remote) and not summary.get("bound_page_type"):
                summary["bound_page_type"] = (remote.get("page_type") or "").strip()
            if self._remote_bind_state(remote) == BIND_STATE_PREBOUND_HOME:
                summary["bound_page_type"] = "home"
        return summary






    def _last_focused_tm_page(self, status=None):
        page, _age = self._find_last_focused_tm_page(status=status)
        return page


    def _refresh_current_chat_panel(self):
        session = self._current_session()
        if session:
            self._render_session_chat(session, force_bottom=True)
        elif hasattr(self, "_clear_chat_widgets"):
            self._clear_chat_widgets()

    def _get_active_trace_id(self, attr_name, log_prefix):
        value = getattr(self, attr_name, "")
        if value is None:
            return ""
        if callable(value):
            self._append_log(
                f"[{log_prefix}][TRACE_ID_INVALID] {attr_name} is callable, ignored"
            )
            return ""
        return str(value).strip()

    def _set_active_trace_id(self, attr_name, trace_id, log_prefix):
        if trace_id is None:
            setattr(self, attr_name, "")
            return
        if callable(trace_id):
            self._append_log(
                f"[{log_prefix}][TRACE_ID_INVALID] trying to set callable trace_id, ignored"
            )
            setattr(self, attr_name, "")
            return
        setattr(self, attr_name, str(trace_id).strip())

    def _get_active_send_trace_id(self):
        return self._get_active_trace_id("_active_send_trace_id_value", "SEND")

    def _set_active_send_trace_id(self, trace_id):
        self._set_active_trace_id("_active_send_trace_id_value", trace_id, "SEND")

    def _get_active_sync_trace_id(self):
        return self._get_active_trace_id("_active_sync_trace_id_value", "SYNC")

    def _set_active_sync_trace_id(self, trace_id):
        self._set_active_trace_id("_active_sync_trace_id_value", trace_id, "SYNC")

    def _elide_middle(self, text, max_len=42):
        value = str(text or "").strip()
        if len(value) <= max_len:
            return value
        keep = max(6, (max_len - 3) // 2)
        return value[:keep] + "..." + value[-keep:]

    def _resolve_manual_bind_candidate(self, status=None):
        """
        解析手动绑定候选页：仅使用可用页面列表当前选中项（UserRole dict）。
        在线判断与下拉框 [在线] 展示一致。
        """
        del status
        item = None
        source = ""
        if hasattr(self, "_get_selected_tm_page_from_combo"):
            item = self._get_selected_tm_page_from_combo()
        elif hasattr(self, "_get_tm_page_combo_selection"):
            item = self._get_tm_page_combo_selection()
        if item:
            source = "page_combo"

        if not isinstance(item, dict):
            return None, source, "no_page_selected"

        normalized = self._normalize_tm_page_for_binding(item)
        bind_candidate = dict(item)
        bind_candidate.update(normalized)
        bindable, reason = self._tm_client_bindable(
            bind_candidate, for_manual_ui=True
        )
        if not bindable:
            return None, source, reason or "missing_page_identity"

        if normalized.get("url"):
            bind_candidate["url"] = normalized["url"]
        return bind_candidate, source, ""




    LAST_FOCUSED_TM_PAGE_MAX_AGE_SEC = 60

    def _page_item_float(self, item, field, default=0.0, *, context=""):
        del context
        from app.utils.safe_parse import safe_float_field

        return safe_float_field(item, field, default)

    def _pick_current_page_client_info(self, status=None):
        status = status or self._bridge_ui.last_bridge_status or {}
        active_client_id = read_snapshot_identity(status, "active")["client_id"]
        for cid in (active_client_id,):
            cid = (cid or "").strip()
            info = self._client_info_by_id(cid, status=status)
            if isinstance(info, dict) and is_page_online(info):
                return info
        focus_candidates = []
        for item in self._iter_tm_clients(status, online_only=True):
            if item.get("has_focus"):
                return item
            focus_candidates.append(
                (
                    self._page_item_float(
                        item,
                        "last_focus_at",
                        0,
                        context="_pick_current_page_client_info",
                    ),
                    self._page_item_float(
                        item,
                        "last_seen",
                        0,
                        context="_pick_current_page_client_info",
                    ),
                    item,
                )
            )
        focus_candidates.sort(key=lambda row: (row[0], row[1]), reverse=True)
        if focus_candidates and focus_candidates[0][0] > 0:
            return focus_candidates[0][2]
        if focus_candidates:
            return focus_candidates[0][2]
        return None

    def _resolve_bound_page_info(self, status=None, snapshot=None):
        if getattr(self, "_in_resolve_bound_page_info", False):
            return self._resolve_bound_page_info_session_only(status=status)
        self._in_resolve_bound_page_info = True
        try:
            return self._resolve_bound_page_info_impl(
                status=status, snapshot=snapshot
            )
        finally:
            self._in_resolve_bound_page_info = False

    def _resolve_bound_page_info_session_only(self, status=None):
        """重入保护：页面列表提取过程中勿再查在线页。"""
        status = status or self._bridge_ui.last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if not remote_binding_enabled(remote):
            return None, "unbound", "session_unbound"
        client_id = (remote.get("client_id") or "").strip()
        return {
            "client_id": client_id,
            "page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "conversation_id": (remote.get("conversation_id") or "").strip(),
            "url": ((remote.get("url") or "").strip()).strip(),
            "page_type": (remote.get("page_type") or "").strip(),
        }, "offline", "reentrant_session_only"

    def _resolve_bound_page_info_impl(self, status=None, snapshot=None):
        from app.utils.page_command import resolve_bound_page_in_registry
        from app.utils.page_status import PageRegistry, binding_from_session

        status = status or self._bridge_ui.last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if not remote_binding_enabled(remote):
            return None, "unbound", "session_unbound"

        client_id = (remote.get("client_id") or "").strip()
        page_instance_id = (remote.get("page_instance_id") or "").strip()
        fallback_info = {
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": (remote.get("conversation_id") or "").strip(),
            "url": ((remote.get("url") or "").strip()).strip(),
            "page_type": (remote.get("page_type") or "").strip(),
            "page_no": (remote.get("page_no") or remote.get("temp_page_id") or "").strip(),
            "page_display_id": (
                remote.get("page_display_id")
                or remote.get("temp_page_id")
                or remote.get("page_no")
                or ""
            ).strip(),
        }

        reg = getattr(self, "page_registry", None)
        if not isinstance(reg, PageRegistry) or not reg.matches_status(status):
            reg = PageRegistry.from_bridge_status(status)
        binding = binding_from_session(session)
        resolved = resolve_bound_page_in_registry(
            reg,
            binding,
            allow_same_conversation=bool((binding.get("conversation_id") or "").strip()),
        )
        page = resolved.get("page")
        matched_by = (resolved.get("matched_by") or "none").strip()
        online = bool(resolved.get("online"))
        reason_code = (resolved.get("reason_code") or "").strip()

        if page is not None:
            raw = page._raw if isinstance(getattr(page, "_raw", None), dict) else {}
            bound_info = dict(raw) if raw else {
                **fallback_info,
                "client_id": page.client_id or client_id,
                "page_instance_id": page.page_instance_id or page_instance_id,
                "conversation_id": page.conversation_id or fallback_info["conversation_id"],
                "url": page.url or fallback_info["url"],
                "page_type": page.page_type or fallback_info["page_type"],
            }
            if hasattr(self, "_append_log"):
                page_type = (bound_info.get("page_type") or "-").strip() or "-"
                page_conv = (bound_info.get("conversation_id") or "-").strip() or "-"
                self._append_log(
                    "[BOUND_PAGE][RESOLVE] "
                    f"matched_by={matched_by or 'none'} "
                    f"page_type={page_type} "
                    f"conversation_id={page_conv} "
                    f"online={'true' if online else 'false'}",
                    echo=False,
                )
            if online:
                return bound_info, "online", ""
            return bound_info, "offline", reason_code or "bound_client_offline"

        if client_id or page_instance_id:
            return fallback_info, "offline", reason_code or "bound_info_missing"
        return None, "unbound", reason_code or "not_bound"



    def _check_tm_send_prerequisites(self, session):
        if not self._bind_each_chat_to_page:
            return True, ""
        summary = self._tm_summary_for_session(session)
        online = int(summary.get("online_clients") or 0)
        if online <= 0:
            return False, "油猴离线，请先打开 ChatGPT 页面并确认脚本在线。"
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bind_state = self._remote_bind_state(remote)
        if bind_state == BIND_STATE_WAITING_HOME:
            return (
                False,
                "正在等待 ChatGPT 首页上线，首条消息将在页面上线后自动发送。",
            )
        if bind_state == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return (
                False,
                "绑定的 ChatGPT 对话页未打开，正在自动打开原对话页面...",
            )
        if bind_state == BIND_STATE_WAITING_CONVERSATION_CREATED:
            return (
                False,
                "首条消息已发送，正在等待 ChatGPT 创建并绑定新对话页。",
            )
        if self._session_has_wrong_existing_conversation_bind(session):
            return (
                False,
                "当前对话错误绑定到已有 ChatGPT 对话页。请点击“绑定所选页面”覆盖后重新发送，"
                "以通过空白首页创建新对话。",
            )
        if not remote_binding_enabled(remote):
            return False, "请先发送消息以连接 ChatGPT 页面。"
        bind_state = self._effective_bind_state(session)
        if bind_state == BIND_STATE_UNBOUND:
            return False, "请先发送消息以连接 ChatGPT 页面。"
        if bind_state == BIND_STATE_BOUND_OFFLINE:
            if self._remote_bind_state(remote) == BIND_STATE_PREBOUND_HOME:
                return (
                    False,
                    "预绑定首页已离线，正在重新选择空闲首页或打开新的 ChatGPT 首页。",
                )
            if (remote.get("conversation_id") or "").strip():
                return (
                    False,
                    "绑定的 ChatGPT 对话页离线，正在自动打开原对话页面...",
                )
            return (
                False,
                "绑定的 ChatGPT 对话页离线，请打开该页面或重新绑定同一对话页。",
            )
        if bind_state == BIND_STATE_PREBOUND_HOME:
            user_count = self._session_user_message_count(session)
            if user_count > 0:
                self._append_log(
                    f"[BIND][STALE_PREBOUND_HOME] session_id={session.session_id} "
                    f"user_count={user_count} reason=prebound_home_has_user_messages"
                )
                return (
                    False,
                    "当前对话的首页预绑定状态异常，请重置绑定后重新发送。",
                )
            return True, ""
        if bind_state == BIND_STATE_BOUND_CONVERSATION:
            bound_conv = (remote.get("conversation_id") or "").strip()
            if not bound_conv:
                return False, "绑定页面缺少 conversation_id，请重新绑定当前对话页。"
            return True, ""
        return True, ""
    def _make_inbound_key(self, item):
        kind = item.get("kind", "")
        message_id = item.get("message_id") or ""
        payload = item.get("payload") or {}
        text = (
            payload.get("text")
            or payload.get("detail")
            or payload.get("reason")
            or str(payload)
        )
        return f"{kind}|{message_id}|{text}"
    def _is_finalized(self, bridge_message_id):
        return bool(
            bridge_message_id
            and bridge_message_id in self._bridge_msg.finalized_bridge_message_ids
        )
    def _finalize_bridge(self, bridge_message_id):
        if bridge_message_id:
            self._bridge_msg.finalized_bridge_message_ids.add(bridge_message_id)
    def _bootstrap_state_created_at(self, state, bridge_id=""):
        raw = state.get("created_at") if isinstance(state, dict) else None
        try:
            return float(raw or 0)
        except (TypeError, ValueError) as error:
            if hasattr(self, "_append_log"):
                self._append_log(
                    "[BOOTSTRAP][STATE_CREATED_AT_INVALID] "
                    f"bridge_id={bridge_id or '-'} "
                    f"value={raw!r} "
                    f"error_type={type(error).__name__} "
                    f"error={error}",
                    echo=True,
                )
            return 0.0
    def _session_has_retryable_unclaimed_bootstrap(self, session):
        if session is None:
            return False
        now = time.time()
        for message in session.messages:
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = get_message_state(bridge_id)
            if not state:
                continue
            if not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = self._bootstrap_state_created_at(state, bridge_id)
            if now - created_at >= self.BOOTSTRAP_CLAIM_TIMEOUT_SECONDS:
                return True
        return False
    def _bootstrap_retry_user_text(self, session):
        if session is None:
            return ""
        now = time.time()
        for message in session.messages:
            if message.role != "user":
                continue
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = get_message_state(bridge_id)
            if not state or not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = self._bootstrap_state_created_at(state, bridge_id)
            if now - created_at < self.BOOTSTRAP_CLAIM_TIMEOUT_SECONDS:
                continue
            text = (message.content or "").strip()
            if text:
                return text
        return ""
    def _cancel_retryable_bootstrap(self, session):
        if session is None:
            return False
        cancelled = False
        now = time.time()
        for message in session.messages:
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = get_message_state(bridge_id)
            if not state:
                continue
            if not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = self._bootstrap_state_created_at(state, bridge_id)
            if now - created_at < self.BOOTSTRAP_CLAIM_TIMEOUT_SECONDS:
                continue
            turn_id = (message.turn_id or "").strip()
            cancel_message(bridge_id, "bootstrap_not_claimed_timeout")
            self._finalize_bridge(bridge_id)
            if message.role == "user":
                message.ui_status = "发送超时"
            if message.role == "assistant" and turn_id:
                self._set_reply_error(
                    session,
                    turn_id,
                    "上一个 ChatGPT 首页未取走消息，已自动打开新的首页并重新发送。",
                    "发送超时",
                )
            cancelled = True

        if cancelled:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            old_client = (
                remote.get("client_id") or remote.get("prebound_home_client_id") or "-"
            )
            self._append_log(
                f"[AUTO_BIND][BOOTSTRAP_RETRY] session_id={session.session_id} "
                f"old_client={old_client} reason=bootstrap_not_claimed_timeout"
            )
            session.remote_chatgpt = {
                **default_remote_chatgpt(),
                "bind_state": BIND_STATE_UNBOUND,
            }
            session.updated_at = time.time()
            self._save_sessions_to_disk()
            self._apply_chat_bind_visual_state()
            if hasattr(self, "schedule_page_registry_refresh"):
                self.schedule_page_registry_refresh(reason="bootstrap_cancel")

        return cancelled
    def _retry_bootstrap_after_claim_timeout(self, session):
        user_text = self._bootstrap_retry_user_text(session)
        if not user_text:
            return False
        if not self._cancel_retryable_bootstrap(session):
            return False
        self._add_system_message(
            "上一个 ChatGPT 首页未取走消息，已自动打开新的首页并重新发送。"
        )
        ready, reason = self._prepare_first_message_binding(session, user_text)
        if ready:
            self._push_message_text(session, user_text, from_pending_bootstrap=True)
            return True
        if reason == "__WAITING_HOME_PENDING__":
            return True
        if reason:
            self._add_system_message(reason)
        return False
    def _check_bootstrap_claim_timeouts(self):
        for session in self._sessions.values():
            if not self._session_has_retryable_unclaimed_bootstrap(session):
                continue
            self._retry_bootstrap_after_claim_timeout(session)
    def _load_saved_page_url(self):
        from app.utils.bridge_payload import load_qsettings_last_url

        raw = load_qsettings_last_url(self._settings)
        if isinstance(raw, str) and self._is_persistable_page_url(raw):
            return raw.strip()
        return None

    def _persist_page_url(self, url):
        from app.utils.bridge_payload import persist_qsettings_last_url

        if not self._is_persistable_page_url(url):
            return
        self._saved_page_url = url.strip()
        persist_qsettings_last_url(self._settings, self._saved_page_url)

















    def _hint_after_manual_bind(self, client_info):
        profile = self._tm_client_sync_profile(client_info)
        if profile.get("sync_ok") or profile.get("sync_readable"):
            if profile.get("send_now_available") or profile.get("send_requestable"):
                return "当前对话已绑定所选页面"
            return "已绑定；可同步读取网页对话，发送需等待生成结束。"
        if not profile.get("online"):
            return (
                "已绑定所选页面；绑定页当前离线，打开该页面后可恢复同步。"
            )
        return (
            "已绑定但绑定页当前无法读取快照；请打开绑定对话页后再同步。"
        )

    def _on_bind_current_page(self):
        """绑定所选页面：只读取一次 selected_page，后续绑定流程不再重读 combo。"""
        session = self._ensure_current_session()
        combo = getattr(self, "tm_page_combo", None)
        combo_index = combo.currentIndex() if combo is not None else -1
        combo_text = combo.currentText() if combo is not None else ""
        combo_count = combo.count() if combo is not None else 0
        self._append_log(
            "[BIND][CLICK] "
            f"combo_index={combo_index} "
            f"combo_text={combo_text!r} "
            f"combo_count={combo_count}",
            echo=True,
        )

        selected_page = (
            self._get_selected_tm_page_from_combo()
            if hasattr(self, "_get_selected_tm_page_from_combo")
            else None
        )
        if not isinstance(selected_page, dict):
            combo = getattr(self, "tm_page_combo", None)
            combo_index = combo.currentIndex() if combo is not None else -1
            combo_text = combo.currentText() if combo is not None else ""
            self._append_log(
                "[BIND][FAILED] reason_code=no_selected_page "
                f"combo_index={combo_index} "
                f"combo_text={combo_text!r}",
                echo=True,
            )
            self._set_tm_action_hint(
                "未选择可绑定页面，请先在页面列表中选择一个 ChatGPT 页面。"
            )
            self._add_system_message(
                "未选择可绑定页面，请先在页面列表中选择一个 ChatGPT 页面。"
            )
            return

        if not hasattr(self, "_bind_selected_page_to_current_session"):
            self._append_log(
                "[BIND][FAILED] reason_code=missing_bind_handler "
                "error_type=RuntimeError error=missing_bind_handler "
                "traceback=-",
                echo=True,
            )
            return

        ok = self._bind_selected_page_to_current_session(
            selected_page=selected_page
        )
        if not ok:
            return

        self._set_tm_action_hint(self._hint_after_manual_bind(selected_page))
        self._append_log(
            "[BIND][MANUAL][SUCCESS] "
            f"session_id={session.session_id} "
            f"page_no={selected_page.get('page_no') or '-'} "
            f"client_id={selected_page.get('client_id') or '-'} "
            f"page_instance_id={selected_page.get('page_instance_id') or '-'} "
            f"conversation_id={selected_page.get('conversation_id') or '-'} "
            f"url={selected_page.get('url') or '-'}",
            echo=True,
        )

        normalized = self._normalize_tm_page_for_binding(selected_page)
        page_type = (
            normalized.get("page_type")
            or selected_page.get("page_type")
            or ""
        ).strip()
        conversation_id_after_bind = (
            normalized.get("conversation_id")
            or self._remote_conversation_id(
                normalize_remote_chatgpt(session.remote_chatgpt)
            )
        )
        if page_type == "home" and not conversation_id_after_bind:
            self._set_tm_action_hint(
                "已预绑定 ChatGPT 首页。发送第一条消息后会自动创建并绑定新对话。"
            )
            self._apply_chat_bind_visual_state()
            if hasattr(self, "schedule_page_registry_refresh"):
                self.schedule_page_registry_refresh(reason="manual_bind_home")
            return
        profile = self._tm_client_sync_profile(selected_page)
        if conversation_id_after_bind and profile.get("sync_ok"):
            self._set_tm_action_hint("同步中...")
            self._sync_after_manual_bind_existing_conversation(
                session, selected_page
            )
        elif conversation_id_after_bind:
            self._apply_chat_bind_visual_state()

    def _sync_after_manual_bind_existing_conversation(self, session, client_info):
        if session is None:
            return

        conversation_id = self._client_conversation_id(client_info)
        page_url = page_url_from(client_info)
        client_id = (client_info.get("client_id") or "").strip()
        page_instance_id = (client_info.get("page_instance_id") or "").strip()

        if not conversation_id:
            conversation_id = parse_conversation_id(page_url)

        if not conversation_id:
            self._append_log(
                "[BIND][MANUAL_ATTACH][SYNC_SKIP] reason=no_conversation_id"
            )
            return

        sync_key = (
            f"{session.session_id}|{client_id}|{conversation_id}|manual_attach_sync"
        )
        now = time.time()
        if (
            sync_key == getattr(self, "_last_manual_attach_sync_key", "")
            and now - getattr(self, "_last_manual_attach_sync_at", 0.0) < 5.0
        ):
            self._append_log(
                "[BIND][MANUAL_ATTACH][SYNC_SKIP_DUPLICATE] "
                f"session_id={session.session_id} client_id={client_id or '-'}"
            )
            return
        self._last_manual_attach_sync_key = sync_key
        self._last_manual_attach_sync_at = now

        self._append_log(
            "[BIND][MANUAL_ATTACH_EXISTING_CONVERSATION] "
            f"session_id={session.session_id} "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"conversation_id={conversation_id} "
            f"page_url={page_url or '-'}"
        )
        self._append_log(
            "[BIND][MANUAL_ATTACH][SYNC_REQUEST] "
            f"session_id={session.session_id} "
            f"client_id={client_id or '-'} "
            f"conversation_id={conversation_id}"
        )

        QTimer.singleShot(
            300,
            lambda: self.request_sync_conversation(
                session,
                reason="manual_bind_existing",
            ),
        )

    def _get_wait_conversation_sync_requests(self):
        pending = getattr(self, "_wait_conversation_sync_by_session", None)
        if not isinstance(pending, dict):
            pending = {}
            self._wait_conversation_sync_by_session = pending
        return pending




    def resolve_send_decision(self, session, content="", status=None):
        """薄适配：委托 resolve_page_action，返回 (decision, reason, target_page, detail)。"""
        del content
        plan = self.resolve_page_action(
            session, action="send", status=status, user_initiated=True
        )
        return plan.as_send_decision_tuple()

    def request_send_message(self, session, content="", source="gui", status=None):
        """统一发送入口：返回 ok/decision/target 等，供 GUI / 外部 API / 队列恢复共用。"""
        content_text = (content or "").strip()
        if not content_text:
            return {
                "ok": False,
                "reason": "empty_text",
                "decision": "blocked",
                "code": "EMPTY_TEXT",
            }
        if not is_server_running():
            return {
                "ok": False,
                "reason": "请先启动服务",
                "decision": "blocked",
                "code": "INTERNAL_ERROR",
            }

        if hasattr(self, "_rebind_current_session_to_online_client_if_needed"):
            self._rebind_current_session_to_online_client_if_needed()

        if hasattr(self, "_session_send_busy_reason"):
            busy_reason = self._session_send_busy_reason(session)
            if busy_reason:
                if busy_reason in (
                    "waiting_home",
                    "prebound_home_wait_conversation",
                ) and hasattr(self, "_begin_wait_conversation_page_for_sync"):
                    remote_busy = normalize_remote_chatgpt(session.remote_chatgpt)
                    client_id = (remote_busy.get("client_id") or "").strip()
                    item = (
                        self._find_tm_client_by_client_id(client_id)
                        if client_id and hasattr(self, "_find_tm_client_by_client_id")
                        else None
                    )
                    if isinstance(item, dict):
                        self._begin_wait_conversation_page_for_sync(
                            session, item, request_reason="send_wait_conversation"
                        )
                self._append_log(
                    "[SEND][REQUEST][BUSY] "
                    f"session_id={(session.session_id if session else '-')} "
                    f"source={source or '-'} reason={busy_reason}",
                    echo=True,
                )
                return {
                    "ok": False,
                    "reason": busy_reason,
                    "decision": "queued",
                    "detail": {"reason_code": busy_reason, "send_decision": "queued"},
                    "code": "SEND_BUSY",
                    "enqueue": True,
                }

        if hasattr(self, "_check_bound_client_response_ready"):
            response_ready, response_msg = self._check_bound_client_response_ready(
                session
            )
            if not response_ready:
                reason = response_msg or "bound_page_not_ready"
                self._append_log(
                    "[SEND][REQUEST][NOT_READY] "
                    f"session_id={(session.session_id if session else '-')} "
                    f"source={source or '-'} reason={reason}",
                    echo=True,
                )
                return {
                    "ok": False,
                    "reason": reason,
                    "decision": "queued",
                    "detail": {"reason_code": reason, "send_decision": "queued"},
                    "code": "BIND_PAGE_NOT_READY",
                    "enqueue": True,
                }

        if (
            self._bind_each_chat_to_page
            and hasattr(self, "_session_needs_first_message_bind")
            and hasattr(self, "_prepare_first_message_binding")
            and self._session_needs_first_message_bind(session)
        ):
            ready, bind_reason = self._prepare_first_message_binding(
                session, content_text
            )
            if not ready:
                if bind_reason == "__WAITING_HOME_PENDING__":
                    return {
                        "ok": False,
                        "reason": bind_reason,
                        "decision": "queued",
                        "detail": {
                            "reason_code": bind_reason,
                            "send_decision": "queued",
                        },
                        "code": "WAITING_HOME",
                        "enqueue": False,
                    }
                return {
                    "ok": False,
                    "reason": bind_reason or "first_message_bind_not_ready",
                    "decision": "blocked",
                    "detail": {
                        "reason_code": bind_reason or "first_message_bind_not_ready",
                        "send_decision": "blocked",
                    },
                    "code": "NO_AVAILABLE_CHATGPT_PAGE",
                }

        decision, send_reason, target_page, detail = self.resolve_send_decision(
            session, content=content_text, status=status
        )
        if decision == "blocked":
            reason = send_reason or detail.get("reason_code") or "send_blocked"
            code = "BIND_PAGE_OFFLINE"
            if "未找到" in reason or "没有" in reason:
                code = "NO_AVAILABLE_CHATGPT_PAGE"
            elif "离线" in reason or "未连接" in reason:
                code = "BIND_PAGE_OFFLINE"
            self._append_log(
                "[SEND][REQUEST][BLOCKED] "
                f"session_id={(session.session_id if session else '-')} "
                f"source={source or '-'} reason={reason}",
                echo=True,
            )
            return {
                "ok": False,
                "reason": reason,
                "decision": decision,
                "detail": detail,
                "code": code,
            }

        target_client_id = (detail.get("client_id") or "").strip()
        if not target_client_id and isinstance(target_page, dict):
            target_client_id = (target_page.get("client_id") or "").strip()
        target_page_instance_id = (detail.get("page_instance_id") or "").strip()
        if not target_page_instance_id and isinstance(target_page, dict):
            target_page_instance_id = (target_page.get("page_instance_id") or "").strip()
        target_conversation_id = (detail.get("conversation_id") or "").strip()
        if not target_conversation_id and isinstance(target_page, dict):
            target_conversation_id = self._client_conversation_id(target_page)
        target_page_url = ((detail.get("url") or "") or "").strip()
        if not target_page_url and isinstance(target_page, dict):
            target_page_url = page_url_from(target_page)

        if hasattr(self, "_verify_send_target_binding") and hasattr(
            self, "_debug_logging_enabled"
        ) and self._debug_logging_enabled():
            _v_client, _v_url, _verify_ok, verify_reason = self._verify_send_target_binding(
                session, target_client_id, target_page_url
            )
            if verify_reason:
                self._append_log(
                    f"[SEND][VERIFY][DEBUG] session_id={(session.session_id if session else '-')} "
                    f"reason={verify_reason} note=resolve_page_action_is_authoritative",
                    echo=False,
                )

        self._append_log(
            "[SEND][REQUEST] "
            f"session_id={(session.session_id if session else '-')} "
            f"source={source or '-'} decision={decision} "
            f"client_id={target_client_id or '-'} "
            f"url={target_page_url or '-'}",
            echo=True,
        )
        return {
            "ok": True,
            "decision": decision,
            "reason": send_reason,
            "client_id": target_client_id,
            "page_instance_id": target_page_instance_id,
            "conversation_id": target_conversation_id,
            "url": target_page_url,
            "page": target_page,
            "detail": detail,
            "content": content_text,
            "message_source": source,
        }

    def _compose_send_payload(
        self,
        session,
        *,
        turn_id,
        content,
        raw_content="",
        client_id="",
        url="",
        page_instance_id="",
        conversation_id="",
        target_source="",
        bind_request_id="",
        bootstrap_conversation=False,
        target_page_id="",
        trace_id="",
        allow_same_conversation_fallback=False,
        cap_page=None,
    ):
        """入队 payload：只使用已 resolve 的 target，不从 remote_chatgpt 静默补全。"""
        from app.utils.bridge_payload import build_gui_push_payload

        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()
        conversation_id = (conversation_id or "").strip()
        url = (url or "").strip()
        bind_request_id = (bind_request_id or "").strip()
        if not bind_request_id and hasattr(self, "_session_bind_request_id"):
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_request_id = self._session_bind_request_id(remote)

        if isinstance(cap_page, dict) and cap_page:
            cap_page = dict(cap_page)
            cap_page.setdefault("client_id", client_id)
            cap_page.setdefault("page_instance_id", page_instance_id)
            cap_page.setdefault("conversation_id", conversation_id)
            cap_page.setdefault("url", url)
        else:
            cap_page = {
                "client_id": client_id,
                "page_instance_id": page_instance_id,
                "conversation_id": conversation_id,
                "url": url,
            }
        cap = evaluate_page_capability(cap_page, action="send")
        cap_dict = cap.to_dict()
        decision_dict = explain_page_decision(cap_page, action="send")
        if isinstance(decision_dict, dict):
            cap_dict.update(decision_dict)

        del allow_same_conversation_fallback
        payload = build_gui_push_payload(
            session_id=session.session_id,
            turn_id=turn_id,
            content=content or raw_content,
            trace_id=trace_id,
            client_id=client_id,
            url=url,
            conversation_id=conversation_id,
            page_instance_id=page_instance_id,
            bootstrap_conversation=bootstrap_conversation,
            bind_request_id=bind_request_id,
            target_page_id=target_page_id,
        )
        from app.utils.target_sources import canonical_target_source

        ts = canonical_target_source(target_source)
        if ts:
            payload["target_source"] = ts

        self._append_log(
            "[SEND][PAYLOAD_TARGET] "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"url={url or '-'} "
            f"target_source={target_source or '-'} "
            f"send_requestable={'yes' if cap.send_requestable else 'no'} "
            f"send_now_available={'yes' if cap.send_now_available else 'no'} "
            f"send_queueable={'yes' if cap.send_queueable else 'no'} "
            + log_page_decision_fields(cap_dict),
            echo=True,
        )
        return payload


