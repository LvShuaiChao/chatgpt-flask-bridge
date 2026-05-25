"""绑定冲突检测与诊断日志。"""

import time

from app.models import (
    remote_binding_enabled,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import read_snapshot_identity


FOCUS_SYNC_HINT_DEFAULT = "当前同步目标：绑定网页；焦点页仅用于辅助判断。"


class PageBindingDiagnosticsMixin:
    def _detect_bind_mismatch(self, summary, session=None):
        summary = summary or {}
        bound = read_snapshot_identity(summary, "bound")
        active = read_snapshot_identity(summary, "active")
        bound_client_id = bound["client_id"]
        bound_conversation_id = bound["conversation_id"]
        if not bound_client_id:
            return None
        active_client_id = active["client_id"]
        active_conversation_id = active["conversation_id"]
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
                    "bound": {
                        "client_id": bound_client_id,
                        "conversation_id": bound_conversation_id,
                    },
                    "active": {
                        "client_id": active_client_id,
                        "conversation_id": active_conversation_id,
                    },
                    "reason_code": "bound_conversation_mismatch",
                    "severity": "warn",
                }
            return None
        bound_online = bool(summary.get("bound_online"))
        if bound_online:
            return {
                "bound": {
                    "client_id": bound_client_id,
                    "conversation_id": bound_conversation_id or "-",
                },
                "active": {
                    "client_id": active_client_id,
                    "conversation_id": active_conversation_id or "-",
                },
                "reason_code": "active_page_not_bound_but_bound_online",
                "severity": "info",
            }
        if summary.get("online_clients", 0) > 0:
            return {
                "bound": {
                    "client_id": bound_client_id,
                    "conversation_id": bound_conversation_id or "-",
                },
                "active": {
                    "client_id": active_client_id,
                    "conversation_id": active_conversation_id or "-",
                },
                "reason_code": "bound_offline_active_other_page",
                "severity": "warn",
            }
        return None
    def _log_tm_status_summary(self, summary):
        if not isinstance(summary, dict):
            return
        status = self._bridge_ui.last_bridge_status or {}
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
        sync_target_state = "available" if bool(
            target.get("allowed")
            or target.get("conversation_syncable")
            or target.get("sync_readable")
        ) else "unavailable"
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
    def _set_focus_sync_hint(self, text=None, level="warning"):
        final_text = (text or "").strip()
        if not final_text:
            final_text = "焦点页不是绑定网页，同步将使用绑定网页。"
        ui_key = f"{final_text}|{level}"
        if ui_key != getattr(self, "_last_focus_sync_hint_ui_key", ""):
            self._last_focus_sync_hint_ui_key = ui_key
            self._append_log(
                f"[UI][FOCUS_SYNC_HINT] text={final_text} level={level}"
            )

    def _compute_focus_sync_hint_text(self, summary=None):
        summary = summary or {}
        status = self._bridge_ui.last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)

        manual_hint = self._manual_bound_identity_mismatch_text(status=status)
        if manual_hint:
            return manual_hint, "warning"

        bound = read_snapshot_identity(summary, "bound")
        bound_client_id = bound["client_id"]
        if not bound_client_id and not remote_binding_enabled(remote):
            return (
                "尚未绑定 ChatGPT 页面，请先从可用页面列表选择页面并绑定。",
                "warning",
            )

        active = read_snapshot_identity(summary, "active")
        active_client_id = active["client_id"]
        focused_info = self._find_focused_tm_page(status)
        if not active_client_id and not focused_info:
            return (
                "浏览器页面未获得焦点，操作本软件时属正常情况；同步仍使用绑定网页。",
                "warning",
            )

        mismatch = self._detect_bind_mismatch(summary, session=session)
        if mismatch:
            reason_code = (mismatch.get("reason_code") or "").strip()
            bound_online = bool(summary.get("bound_online"))
            if reason_code == "active_page_not_bound_but_bound_online":
                if bound_online:
                    return "焦点页不是绑定网页，同步将使用绑定网页。", "warning"
                return (
                    "绑定页当前离线；已保留绑定关系，打开绑定页后可恢复同步。",
                    "warning",
                )
            if reason_code == "bound_offline_active_other_page":
                return (
                    "绑定页当前离线；已保留绑定关系，打开绑定页后可恢复同步。",
                    "warning",
                )
            if reason_code == "bound_conversation_mismatch":
                return (
                    "当前焦点页与绑定页的 conversation_id 不一致，请检查绑定状态。",
                    "warning",
                )
            return "当前焦点页与绑定页不一致，请检查绑定状态。", "warning"

        if bound_client_id and active_client_id and bound_client_id == active_client_id:
            return "焦点页为当前绑定网页，同步将使用该网页。", "ok"

        return FOCUS_SYNC_HINT_DEFAULT, "ok"

    def _refresh_focus_sync_hint(self, summary=None):
        if summary is None:
            summary = self._tm_summary_for_session()
        text, level = self._compute_focus_sync_hint_text(summary)
        self._set_focus_sync_hint(text, level=level)

    def _log_bind_mismatch_if_needed(self, summary):
        summary = summary or {}
        manual_hint = self._manual_bound_identity_mismatch_text()
        if manual_hint:
            ui_key = manual_hint
            if ui_key != self._bind_display.last_bind_mismatch_ui_key:
                self._bind_display.last_bind_mismatch_ui_key = ui_key
            self._refresh_focus_sync_hint(summary)
            return

        session = self._current_session()
        mismatch = self._detect_bind_mismatch(summary, session=session)
        if not mismatch:
            self._bind_display.last_bind_mismatch_key = ""
            self._bind_display.last_bind_mismatch_ui_key = ""
            self._set_close_other_pages_enabled(True)
            self._refresh_focus_sync_hint(summary)
            return
        mismatch_bound = read_snapshot_identity(mismatch, "bound")
        mismatch_active = read_snapshot_identity(mismatch, "active")
        mismatch_key = "|".join([
            str(mismatch_bound["client_id"] or "-"),
            str(mismatch_bound["conversation_id"] or "-"),
            str(mismatch_active["client_id"] or "-"),
            str(mismatch_active["conversation_id"] or "-"),
            str(mismatch.get("reason_code") or "-"),
            str(mismatch.get("severity") or "-"),
        ])
        now = time.time()
        last_key = self._bind_display.last_bind_mismatch_key
        last_at = self._bind_display.last_bind_mismatch_at
        if mismatch_key != last_key or now - last_at >= 5.0:
            self._bind_display.last_bind_mismatch_key = mismatch_key
            self._bind_display.last_bind_mismatch_at = now
            self._append_log(
                "[BIND][MISMATCH] "
                f"bound_client_id={mismatch_bound['client_id'] or '-'} "
                f"bound_conversation_id={mismatch_bound['conversation_id'] or '-'} "
                f"active_client_id={mismatch_active['client_id'] or '-'} "
                f"active_conversation_id={mismatch_active['conversation_id'] or '-'} "
                f"reason_code={mismatch.get('reason_code') or '-'} "
                f"severity={mismatch.get('severity') or '-'}"
            )
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
        self._refresh_focus_sync_hint(summary)
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
        url_id = parse_conversation_id(url) or ''
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
            else (page.get("url") or page.get("url") or "")
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
        if not remote_binding_enabled(remote):
            return ""

        manual_page = self._get_manual_current_tm_page(status=status)
        if not isinstance(manual_page, dict):
            return ""

        status = status or self._bridge_ui.last_bridge_status or {}
        bound_info, bound_state, _ = self._resolve_bound_page_info(status=status)
        bound_page = bound_info if isinstance(bound_info, dict) else {
            "client_id": (remote.get("client_id") or "").strip(),
            "page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "conversation_id": self._remote_conversation_id(remote),
            "url": ((remote.get("url") or "").strip()).strip(),
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
            "所选页与绑定页不一致"
            f"{suffix}；"
            f"所选页：{manual_client} | {manual_inst} | "
            f"绑定页：{bound_client} | {bound_inst} | "
            "点击「绑定所选页面」后才会更新绑定关系"
        )

