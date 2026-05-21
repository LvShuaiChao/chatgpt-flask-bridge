"""页面绑定主 mixin：组合继承与跨 mixin 调度入口。"""

import time

import server

from app.models import (
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
from app.utils.page_status import (
    evaluate_send_page,
    explain_page_decision,
    is_page_online,
    log_page_decision_fields,
)
from app.ui.mixins.page_auto_bind_mixin import PageAutoBindMixin
from app.ui.mixins.page_binding_diagnostics_mixin import PageBindingDiagnosticsMixin
from app.ui.mixins.page_binding_display_mixin import PageBindingDisplayMixin
from app.ui.mixins.page_binding_state_mixin import PageBindingStateMixin
from app.ui.mixins.page_open_close_mixin import PageOpenCloseMixin
from app.ui.mixins.page_selector_mixin import PageSelectorMixin
from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin
from app.ui.mixins.page_sync_mixin import PageSyncMixin
from app.ui.mixins.page_tm_client_mixin import PageTmClientMixin
from PyQt5.QtCore import Qt, QTimer


class PageBindMixin(
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
            if remote.get("enabled"):
                bound_client_id = (remote.get("client_id") or "").strip()
                bound_conversation_id = self._remote_conversation_id(remote)
        summary = server.get_tm_online_summary(
            bound_client_id=bound_client_id or None,
            bound_conversation_id=bound_conversation_id or None,
        )
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote.get("enabled") and not summary.get("bound_page_type"):
                summary["bound_page_type"] = (remote.get("page_type") or "").strip()
            if (
                remote.get("enabled")
                and not summary.get("bound_conversation_id")
                and bound_conversation_id
            ):
                summary["bound_conversation_id"] = bound_conversation_id
            if self._remote_bind_state(remote) == BIND_STATE_PREBOUND_HOME:
                summary["bound_page_type"] = "home"
                summary["bound_online"] = self._session_has_prebound_home_online(
                    remote
                )
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

    def _get_active_send_trace_id(self):
        value = getattr(self, "_active_send_trace_id_value", "")
        if value is None:
            return ""
        if callable(value):
            self._append_log(
                "[SEND][TRACE_ID_INVALID] _active_send_trace_id_value is callable, ignored"
            )
            return ""
        return str(value).strip()

    def _set_active_send_trace_id(self, trace_id):
        if trace_id is None:
            self._active_send_trace_id_value = ""
            return
        if callable(trace_id):
            self._append_log(
                "[SEND][TRACE_ID_INVALID] trying to set callable trace_id, ignored"
            )
            self._active_send_trace_id_value = ""
            return
        self._active_send_trace_id_value = str(trace_id).strip()

    def _get_active_sync_trace_id(self):
        value = getattr(self, "_active_sync_trace_id_value", "")
        if value is None:
            return ""
        if callable(value):
            self._append_log(
                "[SYNC][TRACE_ID_INVALID] _active_sync_trace_id_value is callable, ignored"
            )
            return ""
        return str(value).strip()

    def _set_active_sync_trace_id(self, trace_id):
        if trace_id is None:
            self._active_sync_trace_id_value = ""
            return
        if callable(trace_id):
            self._append_log(
                "[SYNC][TRACE_ID_INVALID] trying to set callable trace_id, ignored"
            )
            self._active_sync_trace_id_value = ""
            return
        self._active_sync_trace_id_value = str(trace_id).strip()

    def _elide_middle(text, max_len=42):
        value = str(text or "").strip()
        if len(value) <= max_len:
            return value
        keep = max(6, (max_len - 3) // 2)
        return value[:keep] + "..." + value[-keep:]

    def _resolve_manual_bind_candidate(self, status=None):
        """
        解析手动绑定候选页。
        绑定只要求能定位到一个页面，不要求页面当前可同步。
        """
        status = status or self._last_bridge_status or {}
        item = None
        source = ""

        item = self._get_manual_current_tm_page(status=status)
        if item:
            source = "manual_current_page"

        if not item:
            selector = getattr(self, "tm_page_combo", None)
            if selector is not None and selector.count() > 0:
                idx = selector.currentIndex()
                if idx >= 0:
                    if hasattr(self, "_tm_page_combo_page_from_index"):
                        item = self._tm_page_combo_page_from_index(idx)
                    if not isinstance(item, dict):
                        data = selector.itemData(idx, Qt.UserRole)
                        if isinstance(data, dict):
                            item = data
                        else:
                            item = self._find_tm_client_by_client_id(data, status=status)
                    if item:
                        source = "page_combo"

        if not item:
            item = self._current_focused_tm_page(status)
            if item:
                source = "focused_page"

        if not item:
            item = self._last_focused_tm_page(status)
            if item:
                source = "last_focused_page"

        if not item:
            item = self._current_bound_tm_page(status)
            if item:
                source = "bound_page"

        if not isinstance(item, dict):
            return None, source, "no_page_selected"

        normalized = self._normalize_tm_page_for_binding(item)
        bindable, reason = self._tm_client_bindable(normalized)
        if not bindable:
            return None, source, reason or "missing_page_identity"

        item = dict(item)
        item.update(normalized)
        if normalized.get("page_url"):
            item["url"] = normalized["page_url"]
        return item, source, ""




    LAST_FOCUSED_TM_PAGE_MAX_AGE_SEC = 60

    def _pick_current_page_client_info(self, status=None):
        status = status or self._last_bridge_status or {}
        for key in ("tampermonkey_client_id", "active_client_id"):
            cid = (status.get(key) or "").strip()
            info = self._client_info_by_id(cid, status=status)
            if isinstance(info, dict) and is_page_online(info):
                return info
        focus_candidates = []
        for item in self._iter_tm_clients(status, online_only=True):
            if item.get("has_focus"):
                return item
            focus_candidates.append(
                (float(item.get("last_focus_at") or 0), float(item.get("last_seen") or 0), item)
            )
        focus_candidates.sort(key=lambda row: (row[0], row[1]), reverse=True)
        if focus_candidates and focus_candidates[0][0] > 0:
            return focus_candidates[0][2]
        if focus_candidates:
            return focus_candidates[0][2]
        return None

    def _resolve_bound_page_info(self, status=None):
        status = status or self._last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if not remote.get("enabled"):
            return None, "unbound", "session_unbound"
        bound_conversation_id = self._remote_conversation_id(remote)
        if bound_conversation_id:
            matched = self._find_online_page_by_conversation_id(
                bound_conversation_id, status=status
            )
            if isinstance(matched, dict) and self._tm_page_is_online_simple(matched):
                return matched, "online", "matched_by_conversation"
        client_id = (remote.get("client_id") or "").strip()
        bound_info = self._client_info_by_id(client_id, status=status) if client_id else None
        if isinstance(bound_info, dict):
            if self._tm_page_is_online_simple(bound_info):
                return bound_info, "online", "bound_client_online"
            return bound_info, "offline", "bound_client_offline"
        return {
            "client_id": client_id,
            "conversation_id": (remote.get("conversation_id") or "").strip(),
            "page_url": (remote.get("conversation_url") or remote.get("url") or "").strip(),
            "page_type": (remote.get("page_type") or "").strip(),
        }, "offline", "bound_info_missing"



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
                "当前对话错误绑定到已有 ChatGPT 对话页。请点击“绑定当前页面”覆盖后重新发送，"
                "以通过空白首页创建新对话。",
            )
        if not remote.get("enabled"):
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
            and bridge_message_id in self._finalized_bridge_message_ids
        )
    def _finalize_bridge(self, bridge_message_id):
        if bridge_message_id:
            self._finalized_bridge_message_ids.add(bridge_message_id)
    def _session_has_retryable_unclaimed_bootstrap(self, session):
        if session is None:
            return False
        now = time.time()
        for message in session.messages:
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = server.get_message_state(bridge_id)
            if not state:
                continue
            if not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = float(state.get("created_at") or 0)
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
            state = server.get_message_state(bridge_id)
            if not state or not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = float(state.get("created_at") or 0)
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
            state = server.get_message_state(bridge_id)
            if not state:
                continue
            if not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = float(state.get("created_at") or 0)
            if now - created_at < self.BOOTSTRAP_CLAIM_TIMEOUT_SECONDS:
                continue
            turn_id = (message.turn_id or "").strip()
            server.cancel_message(bridge_id, "bootstrap_not_claimed_timeout")
            self._finalize_bridge(bridge_id)
            if message.role == "user":
                message.status = "发送超时"
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
            self._update_bound_page_display()

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
        raw = self._settings.value("last_page_url", "")
        if isinstance(raw, str) and self._is_persistable_page_url(raw):
            return raw.strip()
        return None
    def _persist_page_url(self, url):
        if not self._is_persistable_page_url(url):
            return
        self._saved_page_url = url.strip()
        self._settings.setValue("last_page_url", self._saved_page_url)

















    def _hint_after_manual_bind(self, session, client_info):
        profile = self._tm_client_sync_profile(client_info)
        if profile.get("sync_readable") or profile.get("syncable"):
            if profile.get("sendable"):
                return "当前对话已绑定当前页面"
            return "已绑定；可同步读取网页对话，发送需等待生成结束。"
        if not profile.get("online"):
            return (
                "已绑定当前页面；绑定页当前离线，打开该页面后可恢复同步。"
            )
        return (
            "已绑定但绑定页当前无法读取快照；请打开绑定对话页后再同步。"
        )

    def _on_bind_current_page(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return
        session = self._ensure_current_session()
        status = server.get_bridge_status()
        selector = getattr(self, "tm_page_combo", None)
        selected_index = selector.currentIndex() if selector is not None else -1
        selected_client_id = ""
        if selector is not None and selected_index >= 0:
            data = selector.itemData(selected_index, Qt.UserRole)
            if isinstance(data, dict):
                selected_client_id = (data.get("client_id") or "").strip()
            else:
                selected_client_id = str(data or "").strip()
        combo_client_id = ""
        if selector is not None and selected_index >= 0:
            combo_client_id = selected_client_id
        self._append_log(
            "[BIND][MANUAL][CLICK] "
            f"session_id={session.session_id} "
            f"combo_index={selected_index} "
            f"combo_client_id={combo_client_id or '-'}",
            echo=True,
        )
        client_info, source, fail_reason = self._resolve_manual_bind_candidate(status)
        if not client_info:
            self._set_tm_action_hint(
                "未选择可绑定页面，请先在「可用页面列表」中选择一个 ChatGPT 页面。"
            )
            self._add_system_message(
                "未选择可绑定页面，请先在「可用页面列表」中选择一个 ChatGPT 页面。"
            )
            self._append_log(
                "[BIND][MANUAL][FAILED] "
                f"reason={fail_reason or 'no_page_selected'} "
                f"session_id={session.session_id} "
                f"source={source or '-'}",
                echo=True,
            )
            return
        normalized = self._normalize_tm_page_for_binding(client_info)
        if not normalized.get("client_id") and not normalized.get("page_url"):
            self._append_log(
                "[BIND][MANUAL][FAILED] reason=invalid_candidate "
                f"session_id={session.session_id}",
                echo=True,
            )
            self._set_tm_action_hint("未选择可绑定页面。")
            return
        self._append_log(
            "[BIND][MANUAL][CANDIDATE] "
            f"source={source or '-'} "
            f"client_id={normalized.get('client_id') or '-'} "
            f"page_instance_id={normalized.get('page_instance_id') or '-'} "
            f"conversation_id={normalized.get('conversation_id') or '-'} "
            f"url={normalized.get('page_url') or '-'} "
            f"page_type={normalized.get('page_type') or '-'}",
            echo=True,
        )
        active_client_id = (normalized.get("client_id") or "").strip()
        active_conversation_id = (normalized.get("conversation_id") or "").strip() or "-"
        active_page_instance_id = (normalized.get("page_instance_id") or "").strip()
        bind_key = (
            f"{session.session_id}|{active_client_id}|"
            f"{active_conversation_id}|{active_page_instance_id}"
        )
        now = time.time()
        last_key = getattr(self, "_last_bind_current_page_key", "")
        last_at = getattr(self, "_last_bind_current_page_at", 0.0)
        if bind_key == last_key and now - last_at < 2.0:
            self._append_log(
                "[BIND][MANUAL][SKIP_DUPLICATE] "
                f"session_id={session.session_id} client_id={active_client_id or '-'} "
                f"conversation_id={active_conversation_id}",
                echo=True,
            )
            return
        self._last_bind_current_page_key = bind_key
        self._last_bind_current_page_at = now
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip() or "-"
        old_conversation_id = self._remote_conversation_id(remote) or "-"
        old_bound_url = self._remote_conversation_url(remote) if remote.get("enabled") else ""
        client_id = active_client_id or "-"
        conversation_id = active_conversation_id
        page_url = (normalized.get("page_url") or "").strip() or "-"
        same_binding = (
            remote.get("enabled")
            and old_client_id == active_client_id
            and old_conversation_id == active_conversation_id
            and active_conversation_id not in ("", "-")
        )
        url_needs_fix = (
            active_conversation_id not in ("", "-")
            and old_bound_url
            and "xz_bind_token=" in old_bound_url
            and "/c/" not in old_bound_url
        )
        if same_binding and not url_needs_fix:
            self._append_log(
                "[BIND][MANUAL][SKIP_ALREADY_BOUND] "
                f"session_id={session.session_id} client_id={active_client_id or '-'} "
                f"conversation_id={active_conversation_id}",
                echo=True,
            )
            self._set_tm_action_hint(self._hint_after_manual_bind(session, client_info))
            if hasattr(self, "_schedule_status_apply"):
                self._schedule_status_apply(
                    reason="bind_already_bound", delay_ms=200
                )
            return
        if self._update_session_binding_from_normalized_page(
            session,
            normalized,
            reason="manual_bind",
        ):
            hint = self._hint_after_manual_bind(session, client_info)
            self._set_tm_action_hint(hint)
            if old_client_id != "-" and old_client_id != client_id:
                self._append_log(
                    "[BIND][MANUAL][REPLACE] "
                    f"session_id={session.session_id} "
                    f"old_client_id={old_client_id} "
                    f"new_client_id={client_id}",
                    echo=True,
                )
            self._append_log(
                "[BIND][MANUAL][SUCCESS] "
                f"session_id={session.session_id} "
                f"client_id={client_id} "
                f"page_instance_id={active_page_instance_id or '-'} "
                f"conversation_id={conversation_id} "
                f"url={page_url} "
                f"bind_source={source or 'manual'}",
                echo=True,
            )
            conversation_id_after_bind = (
                normalized.get("conversation_id")
                or self._remote_conversation_id(
                    normalize_remote_chatgpt(session.remote_chatgpt)
                )
            )
            profile = self._tm_client_sync_profile(client_info)
            if conversation_id_after_bind and profile.get("syncable"):
                self._set_tm_action_hint("同步中...")
                self._sync_after_manual_bind_existing_conversation(session, client_info)
            elif conversation_id_after_bind:
                self._update_bound_page_display()
                self._apply_chat_bind_visual_state()
                self._refresh_session_list(select_session_id=session.session_id)
            else:
                self._append_log(
                    "[BIND][MANUAL][PREBOUND_HOME_DONE] "
                    f"session_id={session.session_id} "
                    f"client_id={client_id} "
                    f"page_url={page_url}",
                    echo=True,
                )
                self._update_bound_page_display()
                self._apply_chat_bind_visual_state()
                self._refresh_session_list(select_session_id=session.session_id)
            return
        self._append_log(
            "[BIND][MANUAL][FAILED] "
            f"reason=bind_page_to_session_returned_false "
            f"session_id={session.session_id} "
            f"source={source or '-'}",
            echo=True,
        )

    def _sync_after_manual_bind_existing_conversation(self, session, client_info):
        if session is None:
            return

        conversation_id = self._client_conversation_id(client_info)
        page_url = (client_info.get("page_url") or "").strip()
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

        if getattr(self, "_sync_full_conversation_enabled", True):
            QTimer.singleShot(
                300,
                lambda: self._enqueue_sync_conversation_command(
                    session,
                    request_reason="manual_bind_existing",
                ),
            )
    def _update_session_binding_from_tm_page(self, session, item, *, reason=""):
        return self._relink_session_binding_from_tm_page(session, item, reason=reason)

    def _get_wait_conversation_sync_requests(self):
        pending = getattr(self, "_wait_conversation_sync_by_session", None)
        if not isinstance(pending, dict):
            pending = {}
            self._wait_conversation_sync_by_session = pending
        return pending




    def resolve_send_decision(self, session, content="", status=None):
        """统一发送决策：返回 (decision, reason, target_page, detail)。decision: allowed|queued|blocked。"""
        status = status or self._last_bridge_status or {}
        prereq_ok, prereq_reason = self._check_tm_send_prerequisites(session)
        if not prereq_ok:
            detail = {"blocked_reason": prereq_reason, "send_decision": "blocked"}
            self._append_log(
                f"[SEND][DECISION] allowed=false reason={prereq_reason}",
                echo=True,
            )
            return "blocked", prereq_reason, None, detail

        target_client_id, target_page_url, allowed, reason = (
            self._resolve_target_page_for_session(session)
        )
        target_item = None
        action_target = self._resolve_conversation_action_target(
            session, action="send", status=status
        )
        if isinstance(action_target, dict) and isinstance(
            action_target.get("item"), dict
        ):
            target_item = action_target["item"]
            target_client_id = (action_target.get("client_id") or target_client_id).strip()
            target_page_url = (action_target.get("url") or target_page_url).strip()
            allowed = True
            reason = reason or "same_conversation_latest"
        elif target_client_id:
            target_item = self._find_tm_client_by_client_id(
                target_client_id, status=status
            )
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        expected_conv = self._remote_conversation_id(remote)
        if not target_item and expected_conv:
            target_item = self._find_online_page_by_conversation_id(
                expected_conv, status=status
            )
        if not isinstance(target_item, dict):
            detail = explain_page_decision({}, action="send")
            detail["blocked_reason"] = reason or "no_target_page"
            self._append_log(
                "[SEND][DECISION] " + log_page_decision_fields(detail),
                echo=True,
            )
            return "blocked", reason or "no_target_page", None, detail

        decision, send_reason = evaluate_send_page(
            target_item, expected_conversation_id=expected_conv
        )
        detail = explain_page_decision(target_item, action="send")
        detail["target_client_id"] = target_client_id
        detail["target_page_url"] = target_page_url
        detail["reason"] = send_reason or reason
        detail["send_decision"] = decision
        bind_state = self._remote_bind_state(remote)
        bootstrap_allow_reasons = {
            "prebound_home_wait_conversation",
            "missing_conversation_id",
            "not_conversation_page",
            "not_conversation_url",
        }
        bootstrap_bind_states = {
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        }
        if not allowed:
            decision = "blocked"
            send_reason = reason or send_reason or "target_not_allowed"
            detail["reason"] = send_reason
            detail["send_decision"] = decision
        elif decision == "blocked" and allowed:
            if (
                send_reason in bootstrap_allow_reasons
                and bind_state in bootstrap_bind_states
            ):
                self._append_log(
                    "[SEND_DECISION][BOOTSTRAP_ALLOW] "
                    f"session_id={(session.session_id if session else '-')} "
                    f"bind_state={bind_state} "
                    f"send_reason={send_reason} "
                    f"target_reason={reason or '-'}",
                    echo=True,
                )
                decision = "allowed"
                send_reason = reason or send_reason or "target_resolved"
                detail["reason"] = send_reason
                detail["send_decision"] = decision
            else:
                self._append_log(
                    "[SEND_DECISION][BLOCKED_KEEP] "
                    f"session_id={(session.session_id if session else '-')} "
                    f"bind_state={bind_state} "
                    f"send_reason={send_reason} "
                    f"target_allowed=true target_reason={reason or '-'}",
                    echo=True,
                )
        elif decision == "blocked":
            send_reason = reason or send_reason
            detail["reason"] = send_reason
        self._append_log(
            f"[SEND_DECISION][FINAL] decision={decision} allowed={allowed} "
            + log_page_decision_fields(detail),
            echo=True,
        )
        return decision, send_reason, target_item, detail




