"""绑定冲突检测与诊断日志。"""

import time
import traceback

from app.models import (
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    normalize_remote_chatgpt,
)
from app.utils.trace_log import kv_line, page_type_label


class PageBindingDiagnosticsMixin:
    def _log_send_bind_check(self, session, action="send", *, trace_id=""):
        trace_id = (trace_id or self._get_active_send_trace_id() or "").strip()
        summary = self._tm_summary_for_session(session)
        status = self._last_bridge_status or {}
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bind_state = self._remote_bind_state(remote)
        is_prebound_home = bind_state in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        )
        bound_client_id = (summary.get("bound_client_id") or "").strip()
        bound_conversation_id = (summary.get("bound_conversation_id") or "").strip()
        bound_url = self._remote_conversation_url(remote) if remote.get("enabled") else ""
        if not bound_url and bound_client_id:
            bound_info = self._client_info_by_id(bound_client_id, status=status)
            if bound_info:
                bound_url = (bound_info.get("page_url") or bound_info.get("url") or "").strip()
        bound_page_type = page_type_label(
            summary.get("bound_page_type") or remote.get("page_type"),
            bound_conversation_id,
            bound_url,
        )
        bound_online = bool(summary.get("bound_online"))
        active_client_id = (summary.get("active_client_id") or "").strip()
        active_conversation_id = (summary.get("active_conversation_id") or "").strip()
        active_info = (
            self._client_info_by_id(active_client_id, status=status) if active_client_id else None
        )
        active_url = ""
        if active_info:
            active_url = (active_info.get("page_url") or active_info.get("url") or "").strip()
        active_page_type = page_type_label(
            (active_info or {}).get("page_type"),
            active_conversation_id,
            active_url,
        )
        bound_is_home = not (bound_conversation_id or "").strip()
        same_client = bool(
            bound_client_id and active_client_id and bound_client_id == active_client_id
        )
        same_conversation = bool(
            (bound_conversation_id and active_conversation_id and bound_conversation_id == active_conversation_id)
            or is_prebound_home
            or bound_is_home
        )
        decision = "allow_send"
        reason = "bound_matches_active_or_no_mismatch"
        if not remote.get("enabled"):
            decision = "warn_only"
            reason = "session_not_bound_to_remote"
        elif is_prebound_home:
            decision = "allow_prebound_home"
            reason = "prebound_home_can_create_conversation"
        elif not bound_client_id:
            decision = "block_send"
            reason = "no_bound_client"
        elif not bound_online:
            decision = "block_send"
            reason = "bound_page_offline"
        mismatch = self._detect_bind_mismatch(summary, session=session)
        if mismatch:
            if is_prebound_home:
                decision = "allow_prebound_home"
                reason = "prebound_home_waiting_conversation_created"
            elif not bound_online:
                decision = "block_send"
                reason = "bound_page_offline"
            elif bound_client_id and active_client_id and bound_client_id != active_client_id:
                decision = "warn_only" if bound_online else "block_send"
                reason = "bound_client_differs_from_active_client"
            elif (
                bound_conversation_id
                and active_conversation_id
                and bound_conversation_id != active_conversation_id
            ):
                decision = "block_send"
                reason = "bound_conversation_differs_from_active_conversation"
            else:
                decision = "warn_only"
                reason = mismatch.get("reason_code") or "bind_mismatch"
        self._append_log(
            "[SEND][BIND_CHECK] "
            + kv_line(
                trace_id=trace_id or "-",
                session_id=(session.session_id if session else "-"),
                bound_client=bound_client_id or "-",
                bound_conv=bound_conversation_id or "-",
                bound_url=bound_url or "-",
                bound_page_type=bound_page_type,
                bound_state=bind_state or "-",
                bound_online="true" if bound_online else "false",
                active_client=active_client_id or "-",
                active_conv=active_conversation_id or "-",
                active_url=active_url or "-",
                active_page_type=active_page_type,
                same_client="true" if same_client else "false",
                same_conversation="true" if same_conversation else "false",
                is_prebound_home="true" if is_prebound_home else "false",
                decision=decision,
                reason=reason,
                action=action,
            )
        )
        if mismatch:
            if decision == "block_send":
                mismatch_action = "block_send"
            elif decision == "allow_prebound_home":
                mismatch_action = "allow_prebound_home"
            elif not bound_online:
                mismatch_action = "auto_rebind"
            else:
                mismatch_action = "warn_only"
            self._append_log(
                "[BIND][MISMATCH] "
                + kv_line(
                    trace_id=trace_id or "-",
                    bound_client=mismatch.get("bound_client_id") or "-",
                    bound_conv=mismatch.get("bound_conversation_id") or "-",
                    active_client=mismatch.get("active_client_id") or "-",
                    active_conv=mismatch.get("active_conversation_id") or "-",
                    decision=mismatch_action,
                    reason=mismatch.get("reason_code") or reason,
                )
            )
    def _log_bind_auto_rebind(self, session, new_client_info, reason=""):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip() or "-"
        old_conversation_id = self._remote_conversation_id(remote)
        new_client_id = (new_client_info.get("client_id") or "").strip() or "-"
        new_conversation_id = self._client_conversation_id(new_client_info) or "-"
        self._append_log(
            "[BIND][AUTO_REBIND] "
            f"old_client_id={old_client_id} old_conversation_id={old_conversation_id or '-'} "
            f"new_client_id={new_client_id} new_conversation_id={new_conversation_id} "
            f"reason={reason or '-'}"
        )
    def _detect_bind_mismatch(self, summary, session=None):
        summary = summary or {}
        bound_client_id = (summary.get("bound_client_id") or "").strip()
        bound_conversation_id = (summary.get("bound_conversation_id") or "").strip()
        if not bound_client_id:
            return None
        active_client_id = (summary.get("active_client_id") or "").strip()
        active_conversation_id = (summary.get("active_conversation_id") or "").strip()
        if not active_client_id:
            return None
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)
            if bind_state in (
                BIND_STATE_PREBOUND_HOME,
                BIND_STATE_WAITING_HOME,
                BIND_STATE_WAITING_CONVERSATION_CREATED,
            ):
                return None
        if not bound_conversation_id or bound_conversation_id == "-":
            if bound_client_id != active_client_id:
                return None
        if bound_client_id == active_client_id:
            if (
                bound_conversation_id
                and active_conversation_id
                and bound_conversation_id != active_conversation_id
            ):
                return {
                    "bound_client_id": bound_client_id,
                    "bound_conversation_id": bound_conversation_id,
                    "active_client_id": active_client_id,
                    "active_conversation_id": active_conversation_id,
                    "reason_code": "bound_conversation_mismatch",
                    "reason": "绑定 client 与活跃 client 相同，但 conversation_id 不一致",
                    "severity": "warn",
                }
            return None
        bound_online = bool(summary.get("bound_online"))
        if bound_online:
            return {
                "bound_client_id": bound_client_id,
                "bound_conversation_id": bound_conversation_id or "-",
                "active_client_id": active_client_id,
                "active_conversation_id": active_conversation_id or "-",
                "reason_code": "active_page_not_bound_but_bound_online",
                "reason": "当前焦点页不是绑定页，但绑定页在线",
                "severity": "info",
            }
        if summary.get("online_clients", 0) > 0:
            return {
                "bound_client_id": bound_client_id,
                "bound_conversation_id": bound_conversation_id or "-",
                "active_client_id": active_client_id,
                "active_conversation_id": active_conversation_id or "-",
                "reason_code": "bound_offline_active_other_page",
                "reason": "绑定页离线，当前活跃页不是绑定页",
                "severity": "warn",
            }
        return None
    def _log_tm_status_summary(self, summary):
        if not isinstance(summary, dict):
            return
        status = self._last_bridge_status or {}
        service_state = "running" if bool(status.get("server_running")) else "stopped"
        current_info = self._find_focused_tm_page(status)
        current_label = self._page_full_url(current_info) or "未检测到焦点网页"
        current_syncable = bool(
            current_info
            and self._tm_client_sync_profile(current_info).get("sync_readable")
        )
        bound_info, bound_state, _bound_reason = self._resolve_bound_page_info(status=status)
        bound_label = self._page_full_url(bound_info) if isinstance(bound_info, dict) else "未绑定"
        target = self._sync_target_snapshot(status=status, bound_info=bound_info, current_info=current_info)
        sync_target_label = self._page_full_url(target) or target.get("short_label") or "不可用"
        sync_target_state = (
            "ready"
            if bool(target.get("sync_readable") or target.get("syncable"))
            else "unavailable"
        )
        active_matches_bound = bool(
            target.get("active_matches_bound")
            if target.get("active_matches_bound") is not None
            else False
        )
        key = (
            service_state,
            summary.get("online_clients"),
            summary.get("total_clients"),
            current_label,
            current_syncable,
            bound_label,
            bound_state,
            sync_target_label,
            sync_target_state,
            active_matches_bound,
        )
        if key == getattr(self, "_last_tm_summary_log_key", None):
            return
        self._last_tm_summary_log_key = key
        line = "\n".join(
            [
                "[STATUS_SUMMARY]",
                f"service={service_state}",
                f"online={summary.get('online_clients', 0)}",
                f"total={summary.get('total_clients', 0)}",
                f"focused_page={current_label}",
                f"current_syncable={'true' if current_syncable else 'false'}",
                f"bound_page={bound_label}",
                f"bound_state={bound_state}",
                f"sync_target={sync_target_label}",
                f"sync_target_state={sync_target_state}",
                f"active_matches_bound={'true' if active_matches_bound else 'false'}",
            ]
        )
        self._append_log(line)
    def _log_bind_mismatch_if_needed(self, summary):
        manual_hint = self._manual_bound_identity_mismatch_text()
        if manual_hint:
            ui_key = manual_hint
            if ui_key != getattr(self, "_last_bind_mismatch_ui_key", ""):
                self._last_bind_mismatch_ui_key = ui_key
                if hasattr(self, "tm_bind_mismatch_label"):
                    self.tm_bind_mismatch_label.setText(manual_hint)
                    self.tm_bind_mismatch_label.setProperty("state", "warn")
                    if hasattr(self, "_sync_bridge_status_panel_height"):
                        self._sync_bridge_status_panel_height()
            return

        session = self._current_session()
        mismatch = self._detect_bind_mismatch(summary, session=session)
        if not mismatch:
            self._last_bind_mismatch_key = ""
            self._last_bind_mismatch_ui_key = ""
            if hasattr(self, "tm_bind_mismatch_label"):
                self.tm_bind_mismatch_label.setText(" ")
                self.tm_bind_mismatch_label.setProperty("state", "")
            if hasattr(self, "_sync_bridge_status_panel_height"):
                self._sync_bridge_status_panel_height()
            self._set_close_other_pages_enabled(True)
            return
        mismatch_key = "|".join([
            str(mismatch.get("bound_client_id") or "-"),
            str(mismatch.get("bound_conversation_id") or "-"),
            str(mismatch.get("active_client_id") or "-"),
            str(mismatch.get("active_conversation_id") or "-"),
            str(mismatch.get("reason_code") or "-"),
            str(mismatch.get("severity") or "-"),
        ])
        now = time.time()
        last_key = getattr(self, "_last_bind_mismatch_key", "")
        last_at = getattr(self, "_last_bind_mismatch_at", 0.0)
        if mismatch_key != last_key or now - last_at >= 5.0:
            self._last_bind_mismatch_key = mismatch_key
            self._last_bind_mismatch_at = now
            self._append_log(
                "[BIND][MISMATCH] "
                f"bound_client_id={mismatch.get('bound_client_id')} "
                f"bound_conversation_id={mismatch.get('bound_conversation_id')} "
                f"active_client_id={mismatch.get('active_client_id')} "
                f"active_conversation_id={mismatch.get('active_conversation_id')} "
                f"reason_code={mismatch.get('reason_code') or '-'} "
                f"severity={mismatch.get('severity') or '-'} "
                f"reason={mismatch.get('reason')}"
            )
        if hasattr(self, "tm_bind_mismatch_label"):
            reason_code = (mismatch.get("reason_code") or "").strip()
            bound_online = bool((summary or {}).get("bound_online"))
            if reason_code == "active_page_not_bound_but_bound_online":
                if bound_online:
                    text = "焦点页不是绑定网页，同步将使用绑定网页。"
                    state = "warn"
                else:
                    text = (
                        "绑定页当前离线；已保留绑定关系，打开绑定页后可恢复同步。"
                    )
                    state = "warn"
            elif reason_code == "bound_offline_active_other_page":
                text = (
                    "绑定页当前离线；已保留绑定关系，打开绑定页后可恢复同步。"
                )
                state = "warn"
            elif reason_code == "bound_conversation_mismatch":
                text = "当前焦点页与绑定页的 conversation_id 不一致，请检查绑定状态。"
                state = "warn"
            else:
                text = "当前焦点页与绑定页不一致，请检查绑定状态。"
                state = (mismatch.get("severity") or "warn").strip()
                if state not in ("warn", "error", "info"):
                    state = "warn"
            ui_key = f"{mismatch_key}|{text}|{state}"
            if ui_key != getattr(self, "_last_bind_mismatch_ui_key", ""):
                self._last_bind_mismatch_ui_key = ui_key
                self.tm_bind_mismatch_label.setText(text)
                self.tm_bind_mismatch_label.setProperty("state", state)
                if (mismatch.get("severity") or "").strip() != "info":
                    try:
                        self.tm_bind_mismatch_label.style().unpolish(self.tm_bind_mismatch_label)
                        self.tm_bind_mismatch_label.style().polish(self.tm_bind_mismatch_label)
                    except Exception as error:
                        self._append_log(
                            f"[STATUS][HINT_STYLE][FAILED] error={error}\n{traceback.format_exc()}",
                            echo=True,
                        )
            if hasattr(self, "_sync_bridge_status_panel_height"):
                self._sync_bridge_status_panel_height()
        reason_code = (mismatch.get("reason_code") or "").strip()
        if reason_code == "active_page_not_bound_but_bound_online":
            self._set_close_other_pages_enabled(True)
        else:
            self._set_close_other_pages_enabled(False)
            if hasattr(self, "close_other_pages_btn"):
                if reason_code == "bound_offline_active_other_page":
                    tip = (
                        "绑定页离线，无法确认要保留的页面；"
                        "为避免误关所有在线页面，已禁用「关闭其他页面」。"
                    )
                else:
                    tip = "当前焦点页不是绑定页，已禁用「关闭其他页面」。"
                self.close_other_pages_btn.setToolTip(tip)
    def _set_close_other_pages_enabled(self, enabled):
        if hasattr(self, "close_other_pages_btn"):
            # 不再通过 disabled 表示不可用，避免按钮变灰；点击后走原有前置检查。
            self.close_other_pages_btn.setEnabled(True)
            if enabled:
                self.close_other_pages_btn.setToolTip(
                    "关闭除当前对话绑定页以外的其他在线 ChatGPT 页面；"
                    "如果绑定页离线，将自动取消。"
                )
    def _sync_log_context_fields(self, context, *, reason="-"):
        context = context or {}
        return (
            f"currentClientId={context.get('currentClientId') or '-'} "
            f"currentConversationId={context.get('currentConversationId') or '-'} "
            f"boundClientId={context.get('boundClientId') or '-'} "
            f"boundConversationId={context.get('boundConversationId') or '-'} "
            f"selectedClientId={context.get('selectedClientId') or '-'} "
            f"selectedConversationId={context.get('selectedConversationId') or '-'} "
            f"targetClientId={context.get('targetClientId') or '-'} "
            f"targetConversationId={context.get('targetConversationId') or '-'} "
            f"targetSyncable={context.get('targetSyncable')} "
            f"reason={reason or '-'}"
        )

    def _maybe_log_conversation_id_mismatch(self, page):
        if not isinstance(page, dict):
            return

        url = self._page_full_url(page)
        url_id = self._extract_chatgpt_conversation_id_from_url(url)
        field_id = str(page.get("conversation_id") or "").strip()
        if not (url_id and field_id and url_id != field_id):
            return

        client_id = str(page.get("client_id") or "").strip()
        page_instance_id = str(page.get("page_instance_id") or "").strip()
        key = (client_id, page_instance_id, url_id, field_id)
        logged = getattr(self, "_conv_mismatch_logged_keys", None)
        if logged is None:
            logged = set()
            self._conv_mismatch_logged_keys = logged
        if key in logged:
            return
        logged.add(key)
        old_url = (
            f"https://chatgpt.com/c/{field_id}"
            if field_id
            else (page.get("page_url") or page.get("url") or "")
        )
        self._append_log(
            "[PAGE_SYNC][STALE_URL] "
            f"old_url={old_url} new_url={url} "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'}",
            echo=False,
        )
        self._append_log(
            "[TM_PAGE][CONVERSATION_ID_MISMATCH] "
            f"url_id={url_id} "
            f"field_id={field_id} "
            f"client_id={client_id} "
            f"url={url}",
            echo=False,
        )

    def _manual_bound_identity_mismatch_text(self, status=None):
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if not remote.get("enabled"):
            return ""

        manual_page = self._get_manual_current_tm_page(status=status)
        if not isinstance(manual_page, dict):
            return ""

        status = status or self._last_bridge_status or {}
        bound_info, bound_state, _ = self._resolve_bound_page_info(status=status)
        bound_page = bound_info if isinstance(bound_info, dict) else {
            "client_id": (remote.get("client_id") or "").strip(),
            "page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "conversation_id": self._remote_conversation_id(remote),
            "page_url": (remote.get("conversation_url") or remote.get("url") or "").strip(),
        }
        if not (bound_page.get("client_id") or bound_page.get("conversation_id")):
            return ""

        same, mode, detail = self._pages_same_identity(manual_page, bound_page)
        if same:
            if mode in ("client_conversation", "conversation_only"):
                return f"手动页与绑定页：{detail}"
            return ""

        manual_client = (manual_page.get("client_id") or "-").strip() or "-"
        manual_inst = (manual_page.get("page_instance_id") or "-").strip() or "-"
        bound_client = (bound_page.get("client_id") or "-").strip() or "-"
        bound_inst = (bound_page.get("page_instance_id") or "").strip()
        if not bound_inst:
            bound_inst = "未知" if bound_state != "online" else "-"
        suffix = f"；{detail}" if detail else ""
        return (
            "手动页与绑定页不一致"
            f"{suffix}；"
            f"手动页：{manual_client} | {manual_inst} | "
            f"绑定页：{bound_client} | {bound_inst} | "
            "点击「绑定当前页面」后才会更新绑定关系"
        )

    def _sync_target_unavailable_reason_text(self, reason):
        reason_map = {
            "bound_page_offline": "绑定网页离线",
            "bound_page_not_syncable": "绑定页不可同步",
            "no_syncable_target": "无可用同步目标",
            "unbound_fallback_current_page": "未绑定，回退到当前页",
            "poll_stale": "目标页面轮询已过期，请刷新或激活该 ChatGPT 页面",
            "stale_hidden": "目标页面处于后台且轮询不新鲜",
            "input_unavailable": "目标页面当前不可输入（不影响同步读取）",
            "not_readable": "绑定页当前不可读取快照",
            "client_mismatch": "绑定 client_id 与当前页面不一致",
            "conversation_mismatch": "绑定 conversation_id 与当前页面不一致",
            "not_conversation_page": "目标不是 ChatGPT 对话页",
            "missing_conversation_id": "目标页面缺少 conversation_id",
            "prebound_home_not_dialog": "当前是首页预绑定页，需进入 /c/ 对话",
            "prebound_home_wait_conversation": "等待首页进入具体对话页",
            "bound_online_not_dialog_ready": "绑定页在线但不是可同步的对话页",
            "no_dialog_ready_page": "没有可同步的在线对话页",
        }
        return reason_map.get((reason or "").strip(), (reason or "未知").strip() or "未知")


