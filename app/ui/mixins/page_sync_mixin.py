"""同步网页对话、快照回收与 sync 决策。"""

from app.server import enqueue_control_command, get_bridge_status, get_message_state, is_server_running

import hashlib
import re
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

from app.constants import ASSISTANT_WAIT_TEXTS, PENDING_ASSISTANT_STATUSES
from app.utils.page_command import evaluate_sync_poll_freshness, is_page_polling_active, resolve_page_command_target
from app.utils.page_snapshot import PageRegistry, binding_from_session
from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    ChatMessage,
    is_reset_placeholder_error_message,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import (
    conversation_syncable_from,
    explain_page_decision,
    log_page_decision_fields,
    page_url_from,
    read_snapshot_identity,
)
from app.utils.page_identity import PageIdentity
from app.utils.trace_log import kv_line, make_sync_trace_id
from PyQt5.QtCore import QTimer


@dataclass
class SyncPlan:
    """一次 sync_conversation 的决策与入队上下文。"""

    session: Any
    session_id: str
    request_reason: str = "manual_button"
    delay_ms: int = 0
    allow_open_url: bool = False
    strict_bound_identity: bool = True
    trace_id: str = ""
    request_id: str = ""
    allowed: bool = False
    target: Dict[str, Any] = field(default_factory=dict)
    target_source: str = ""
    block_reason: str = ""
    mode: str = "merge"
    max_messages: int = 10

    @property
    def identity(self) -> PageIdentity:
        return PageIdentity.from_mapping(self.target)

    @property
    def client_id(self) -> str:
        return self.identity.client_id

    @property
    def page_instance_id(self) -> str:
        return self.identity.page_instance_id

    @property
    def conversation_id(self) -> str:
        return self.identity.conversation_id

    @property
    def url(self) -> str:
        return self.identity.url


class PageSyncMixin:
    def _web_sync_pending_map(self) -> dict:
        ws = getattr(self, "_web_sync", None)
        if ws is not None:
            return ws.pending_requests
        legacy = getattr(self, "_pending_web_sync_requests", None)
        if isinstance(legacy, dict):
            return legacy
        self._pending_web_sync_requests = {}
        return self._pending_web_sync_requests
    def _build_sync_target_snapshot_from_decision(
        self,
        *,
        session,
        remote,
        page,
        source,
        block_reason,
        detail,
        status,
        allowed=None,
    ):
        del session, page, source, block_reason, detail, allowed
        status = status or self._bridge_ui.last_bridge_status or {}
        current = self._current_session() if hasattr(self, "_current_session") else None
        remote = normalize_remote_chatgpt(
            remote if isinstance(remote, dict) else (
                current.remote_chatgpt if current is not None else None
            )
        )
        plan = self.resolve_page_action(
            current,
            action="sync_conversation",
            status=status,
            user_initiated=False,
        )
        short_label = ""
        if isinstance(plan.page, dict) and hasattr(self, "_short_page_label"):
            short_label = self._short_page_label(plan.page)
        return plan.to_sync_target_snapshot(
            remote=remote,
            status=status,
            short_label=short_label,
        )

    def _sync_target_snapshot(self, status=None, bound_info=None, current_info=None):
        del bound_info, current_info
        status = status or self._bridge_ui.last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if session is not None:
            plan = self.resolve_page_action(
                session,
                action="sync_conversation",
                status=status,
                user_initiated=False,
            )
            short_label = ""
            if isinstance(plan.page, dict) and hasattr(self, "_short_page_label"):
                short_label = self._short_page_label(plan.page)
            return plan.to_sync_target_snapshot(
                remote=remote, status=status, short_label=short_label
            )
        # legacy fallback: 无当前 session 时返回空快照，保持原 UI 字段集合。
        return {
            "url_syncable": False,
            "conversation_syncable": False,
            "prebound_home": False,
            "send_now_available": False,
            "send_queueable": False,
            "can_accept_input": False,
            "is_responding": False,
            "online": False,
            "source": "no_session",
            "source_label": "未选择对话",
            "short_label": "不可用",
            "client_id": "",
            "page_instance_id": "",
            "conversation_id": "",
            "url": "",
            "page_type": "",
            "reason_code": "no_session",
            "active_matches_bound": False,
        }

    def _format_sync_target_status_text(self, target, profile=None):
        if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():
            sync_text, _chip = self._format_compact_sync_chip(target, profile)
            send_text, _send_chip = self._format_compact_send_chip(target, profile)
            return f"{sync_text}｜{send_text}"

        online = bool(
            target.get("online")
            if target.get("online") is not None
            else (profile or {}).get("online")
        )
        prebound_home = bool(
            target.get("prebound_home")
            if target.get("prebound_home") is not None
            else (profile or {}).get("prebound_home")
        )
        conversation_syncable = bool(
            target.get("conversation_syncable")
            if target.get("conversation_syncable") is not None
            else (profile or {}).get("conversation_syncable")
        )
        if prebound_home and online:
            return "已绑定首页｜等待进入对话｜不可同步对话"
        if not online:
            reason = (
                target.get("reason_code")
                or target.get("reason")
                or (profile or {}).get("reason_code")
                or (profile or {}).get("reason")
                or ""
            ).strip()
            if reason in ("bound_page_offline", "offline", "no_online_page"):
                return "同步：不可同步（离线）"
            return "同步：不可同步"
        if online and not conversation_syncable:
            return "已绑定在线｜等待进入对话页｜不可同步对话"
        queue_size = 0
        if hasattr(self, "_current_session_queue_size"):
            queue_size = int(self._current_session_queue_size() or 0)
        prof = profile or {}

        def _field(key, default=None):
            if target.get(key) is not None:
                return target.get(key)
            if prof.get(key) is not None:
                return prof.get(key)
            return default

        send_now = bool(_field("send_now_available", False))
        send_queueable = bool(_field("send_queueable", False))
        send_decision = (_field("send_decision") or "").strip()
        send_requestable = (_field("send_decision", "blocked") in ("allowed", "queued"))
        is_responding = bool(_field("is_responding", False))
        sync_line = "同步：可同步"
        if send_now:
            return f"{sync_line}｜发送：可发送"
        if send_queueable or send_decision == "queued":
            return f"{sync_line}｜发送：可排队"
        if is_responding:
            return f"{sync_line}｜发送：等待回复"
        if queue_size > 0:
            return f"{sync_line}｜发送：等待队列"
        if not send_requestable and not send_now and not send_queueable:
            return f"{sync_line}｜发送：不可发送"
        if send_requestable:
            return f"{sync_line}｜发送：等待注入后发送"
        return f"{sync_line}｜发送：不可发送"

    def _update_sync_target_display(self, snapshot=None):
        """轻量展示：绑定页快照，不调用 resolve_sync_decision / resolve_page_action。"""
        if hasattr(self, "_render_sync_target_display_light"):
            self._render_sync_target_display_light()
            return
        if not hasattr(self, "tm_sync_target_label"):
            return
        sync_state = getattr(self, "_sync_progress_state", {}) or {}
        if sync_state.get("running") or sync_state.get("slow_waiting"):
            return
        status = self._bridge_ui.last_bridge_status or {}
        if snapshot is None and hasattr(self, "_get_tm_page_snapshot"):
            snapshot = self._get_tm_page_snapshot(status, log_stages=False)
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if not remote_binding_enabled(remote):
            manual_page = self._get_manual_current_tm_page(status=status)
            current_info = (
                manual_page
                if isinstance(manual_page, dict)
                else self._pick_current_page_client_info(status)
            )
        else:
            current_info = self._pick_current_page_client_info(status)
        focused_info = self._find_focused_tm_page(status)
        last_focus_info, last_focus_age = self._find_last_focused_tm_page(status=status)
        bound_info, _bound_state, _bound_reason = self._resolve_bound_page_info(
            status=status, snapshot=snapshot
        )
        target = self._sync_target_snapshot(status=status, bound_info=bound_info, current_info=current_info)
        sync_readable = bool(
            target.get("conversation_syncable")
            or target.get("sync_readable")
        )
        target_profile = None
        target_client_id = (target.get("client_id") or "").strip()
        if target_client_id:
            target_page = self._client_info_by_id(
                target_client_id, status=status, snapshot=snapshot
            )
            if isinstance(target_page, dict):
                session = self._current_session()
                remote = normalize_remote_chatgpt(
                    session.remote_chatgpt if session else None
                )
                target_profile = self._tm_client_sync_profile(
                    target_page,
                    expected_client_id=(remote.get("client_id") or "").strip(),
                    expected_conversation_id=self._remote_conversation_id(remote),
                )
                sync_readable = bool(
                    target.get("conversation_syncable")
                    or target.get("sync_readable")
                    or target_profile.get("sync_ok")
                    or target_profile.get("sync_readable")
                )
        verbose_status = (
            hasattr(self, "_is_ui_verbose_status_enabled")
            and self._is_ui_verbose_status_enabled()
        )
        if verbose_status:
            text = self._format_sync_target_status_text(target, target_profile)
            self.tm_sync_target_label.setText(text)
            self._refresh_status_chip(
                self.tm_sync_target_label,
                "ok" if sync_readable else (
                    "warn" if bool(target.get("prebound_home")) else "error"
                ),
            )
        else:
            sync_text, sync_chip = self._format_compact_sync_chip(target, target_profile)
            self.tm_sync_target_label.setText(sync_text)
            self._refresh_status_chip(self.tm_sync_target_label, sync_chip or "")
            send_label = getattr(self, "tm_send_label", None)
            if send_label is not None:
                send_text, send_chip = self._format_compact_send_chip(target, target_profile)
                send_label.setText(send_text)
                self._refresh_status_chip(send_label, send_chip or "")
        if sync_readable:
            if verbose_status:
                self._set_tm_action_hint("目标对话页在线，可同步网页对话。")
        elif bool(target.get("prebound_home")):
            if verbose_status:
                if remote_binding_enabled(remote):
                    self._set_tm_action_hint(
                        "当前绑定的是首页预绑定页，请打开或新建 ChatGPT 对话后再同步。"
                    )
                else:
                    self._set_tm_action_hint(
                        "已选中首页页，可预绑定；进入具体对话页后才可同步对话内容。"
                    )
        if hasattr(self, "_refresh_send_target_action_hint"):
            self._refresh_send_target_action_hint(status=status)
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        target_client_id = (target.get("client_id") or "").strip()
        target_page = None
        if target_client_id:
            target_page = self._client_info_by_id(target_client_id, status=status)
        if not isinstance(target_page, dict):
            target_page = {
                "client_id": target_client_id,
                "page_instance_id": "",
                "conversation_id": (target.get("conversation_id") or "").strip(),
                "url": page_url_from(target),
                "page_type": (target.get("page_type") or "").strip(),
            }
            if isinstance(bound_info, dict) and target_client_id == (
                bound_info.get("client_id") or ""
            ).strip():
                target_page["page_instance_id"] = (
                    bound_info.get("page_instance_id") or ""
                ).strip()
            elif remote_binding_enabled(remote) and target_client_id == (
                remote.get("client_id") or ""
            ).strip():
                target_page["page_instance_id"] = (
                    remote.get("page_instance_id") or ""
                ).strip()
        target_info = target_page
        target_url = self._page_full_url(target_info) if any(
            (target_info.get(k) or "").strip()
            for k in ("client_id", "conversation_id", "url")
        ) else ""
        if verbose_status:
            self.tm_sync_target_label.setToolTip(target_url or "不可用")
        elif hasattr(self, "_format_compact_sync_target_tooltip"):
            self.tm_sync_target_label.setToolTip(
                self._format_compact_sync_target_tooltip(
                    target, target_profile, status=status
                )
            )
        else:
            self.tm_sync_target_label.setToolTip("同步与发送能力摘要")
        target_source = (target.get("source") or "none").strip()
        current_url = self._page_full_url(current_info) or "-"
        focused_url = self._page_full_url(focused_info) if isinstance(
            focused_info, dict
        ) else "-"
        bound_url_session = self._page_full_url(bound_info) if isinstance(
            bound_info, dict
        ) else (
            ((remote.get("url") or "").strip()).strip() or "-"
        )
        if bound_url_session in ("", "-") and remote_binding_enabled(remote):
            bound_url_session = (
                ((remote.get("url") or "").strip()).strip()
                or "-"
            )
        target_url_log = self._page_full_url(target_info) or "-"
        current_plugin = self._page_plugin_status_text(current_info)
        current_focus = self._page_focus_text(current_info)
        bound_plugin = self._page_plugin_status_text(bound_info)
        bound_focus = self._page_focus_text(bound_info)
        syncable_log = "yes" if sync_readable else "no"
        sendable_log = (
            "yes"
            if target_profile and target_profile.get("send_now_available")
            else ("no" if target_profile else "-")
        )
        bound_from_session = (remote.get("client_id") or "").strip() or "-"
        target_client = (target.get("client_id") or "-").strip() or "-"
        if isinstance(focused_info, dict):
            focused_visible = str(
                focused_info.get("visibility_state") or "unknown"
            ).lower()
            if focused_visible in ("true", "1", "visible"):
                focused_visible_log = "visible"
            elif focused_visible in ("false", "0", "hidden"):
                focused_visible_log = "hidden"
            else:
                focused_visible_log = focused_visible or "unknown"
            focused_log_fields = (
                f"focused_source=document.hasFocus "
                f"focused_url={focused_url} "
                f"focused_client={(focused_info.get('client_id') or '-').strip() or '-'} "
                f"focused_has_focus=yes "
                f"focused_visible={focused_visible_log} "
                f"focused_input={'yes' if self._page_input_text(focused_info) == '是' else 'no'} "
                f"focused_responding={'yes' if self._page_responding_text(focused_info) == '是' else 'no'} "
                f"focused_syncable={'yes' if self._page_syncable_text(focused_info) == '是' else 'no'}"
            )
        else:
            focused_log_fields = (
                "focused_source=document.hasFocus "
                "focused_url=- "
                "focused_has_focus=no "
                "focused_reason=no_client_reported_focus"
            )
        if isinstance(last_focus_info, dict):
            last_focus_url = self._page_full_url(last_focus_info) or "-"
            last_focus_log = (
                f"last_focused_url={last_focus_url} "
                f"last_focused_age_sec={int(last_focus_age)} "
                f"last_focused_client={(last_focus_info.get('client_id') or '-').strip() or '-'}"
            )
        else:
            last_focus_log = "last_focused_url=- last_focused_expired=yes"
        manual_page = self._get_manual_current_tm_page(status=status)
        current_cid, current_pid, current_conv = self._page_ids_for_log(current_info)
        manual_cid, manual_pid, manual_conv = self._page_ids_for_log(manual_page)
        if isinstance(bound_info, dict):
            bound_cid, bound_pid, bound_conv = self._page_ids_for_log(bound_info)
        elif remote_binding_enabled(remote):
            bound_cid = (remote.get("client_id") or "-").strip() or "-"
            bound_pid = (remote.get("page_instance_id") or "-").strip() or "-"
            bound_conv = self._remote_conversation_id(remote) or "-"
        else:
            bound_cid, bound_pid, bound_conv = "-", "-", "-"
        target_cid, target_pid, target_conv = self._page_ids_for_log(target_info)
        relation_key = "|".join([
            str(current_url or "-"),
            str(focused_url or "-"),
            str(bound_url_session or "-"),
            str(target_url_log or "-"),
            str(current_plugin),
            str(current_focus),
            str(bound_plugin),
            str(bound_focus),
            str(syncable_log),
            str(sendable_log),
            current_cid,
            current_pid,
            current_conv,
            manual_cid,
            manual_pid,
            manual_conv,
            bound_cid,
            bound_pid,
            bound_conv,
            target_cid,
            target_pid,
            target_conv,
            focused_log_fields,
            last_focus_log,
        ])
        if relation_key != getattr(self, "_last_page_relation_key", ""):
            self._bind_display.last_page_relation_key = relation_key
            if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():
                self._append_log(
                    "[PAGE_RELATION_DISPLAY] "
                    f"{focused_log_fields} "
                    f"{last_focus_log} "
                    f"current_url={current_url} "
                    f"current_client_id={current_cid} "
                    f"current_page_instance_id={current_pid} "
                    f"current_conversation_id={current_conv} "
                    f"manual_client_id={manual_cid} "
                    f"manual_page_instance_id={manual_pid} "
                    f"manual_conversation_id={manual_conv} "
                    f"bound_url={bound_url_session} "
                    f"bound_client_id={bound_cid} "
                    f"bound_page_instance_id={bound_pid} "
                    f"bound_conversation_id={bound_conv} "
                    f"target_url={target_url_log} "
                    f"target_client_id={target_cid} "
                    f"target_page_instance_id={target_pid} "
                    f"target_conversation_id={target_conv} "
                    f"current_plugin={current_plugin} "
                    f"current_focus={current_focus} "
                    f"bound_plugin={bound_plugin} "
                    f"bound_focus={bound_focus} "
                    f"syncable={syncable_log} "
                    f"sendable={sendable_log}",
                    echo=False,
                )
        bound_instance_session = (remote.get("page_instance_id") or "").strip() or "-"
        target_instance = (target_page.get("page_instance_id") or "").strip() or "-"
        target_matches_bound = bool(
            bound_from_session != "-"
            and target_client != "-"
            and bound_from_session == target_client
            and (
                not bound_instance_session
                or bound_instance_session == "-"
                or not target_instance
                or target_instance == "-"
                or bound_instance_session == target_instance
            )
        )
        target_mismatch_key = (
            f"{bound_from_session}|{bound_instance_session}|"
            f"{target_client}|{target_instance}|{target_matches_bound}"
        )
        if (
            bound_from_session != "-"
            and target_client != "-"
            and not target_matches_bound
            and target_mismatch_key
            != getattr(self, "_last_page_relation_target_mismatch_key", "")
        ):
            self._last_page_relation_target_mismatch_key = target_mismatch_key
            if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():
                self._append_log(
                    "[PAGE_RELATION_DISPLAY][TARGET_MISMATCH] "
                    + kv_line(
                        reason="target_client_differs_from_bound",
                        bound_source="session.remote_chatgpt",
                        target_source=target_source,
                        bound_client=bound_from_session,
                        target_client=target_client,
                    ),
                    echo=False,
                )

    def _validate_sync_conversation_binding(self, session, payload):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return False, "当前对话未绑定 ChatGPT 页面"

        report_conv = (payload.get("conversation_id") or "").strip()
        bound_conv = (remote.get("conversation_id") or "").strip()
        bind_state = self._remote_bind_state(remote)

        if bound_conv and report_conv and bound_conv != report_conv:
            if bind_state not in (
                BIND_STATE_PREBOUND_HOME,
                BIND_STATE_WAITING_CONVERSATION_CREATED,
            ):
                return False, "绑定会话与网页 conversation_id 不一致"

        report_client = (payload.get("client_id") or "").strip()
        bound_client = (remote.get("client_id") or "").strip()
        if bound_client and report_client and bound_client != report_client:
            if report_conv and bound_conv and report_conv == bound_conv:
                self._append_log(
                    "[SYNC_CONVERSATION][CLIENT_RELINK_ALLOWED] "
                    f"session_id={session.session_id} "
                    f"bound_client={bound_client} "
                    f"report_client={report_client} "
                    f"conversation_id={report_conv}",
                    echo=True,
                )
            else:
                return False, "绑定 client_id 与回传页面不一致"

        report_instance = (payload.get("page_instance_id") or "").strip()
        bound_instance = (remote.get("page_instance_id") or "").strip()
        if bound_instance and report_instance and bound_instance != report_instance:
            if report_conv and bound_conv and report_conv == bound_conv:
                self._append_log(
                    "[SYNC_CONVERSATION][PAGE_INSTANCE_MISMATCH_ALLOWED] "
                    f"session_id={session.session_id} "
                    f"bound_instance={bound_instance} "
                    f"report_instance={report_instance} "
                    f"conversation_id={report_conv}",
                    echo=True,
                )
            else:
                return False, "绑定 page_instance_id 与回传页面不一致"

        if report_conv and not bound_conv and bind_state in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        ):
            remote["conversation_id"] = report_conv
            page_url = page_url_from(payload)
            if page_url:
                remote["url"] = page_url
            remote["bind_state"] = BIND_STATE_BOUND_CONVERSATION
            remote["page_type"] = "conversation"
            session.remote_chatgpt = remote
            self._schedule_save_sessions_to_disk()

        return True, ""

    def _normalize_conversation_snapshot_payload(self, payload, item=None, pending_sync=None):
        payload = dict(payload or {})
        item = item or {}
        pending_sync = pending_sync or {}
        page_meta = payload.get("page") if isinstance(payload.get("page"), dict) else {}
        for key in (
            "session_id",
            "conversation_id",
            "request_id",
            "client_id",
            "page_instance_id",
            "url",
        ):
            if not (payload.get(key) or "").strip():
                alt = (
                    item.get(key)
                    or pending_sync.get(key)
                    or page_meta.get(key)
                    or ""
                )
                if alt:
                    payload[key] = alt
        if not (payload.get("client_id") or "").strip():
            payload["client_id"] = (item.get("client_id") or "").strip()
        if not (payload.get("conversation_id") or "").strip():
            conv = parse_conversation_id(
                page_url_from(payload) or (payload.get("url") or "")
            )
            if conv:
                payload["conversation_id"] = conv
        snapshot_url = (payload.get("url") or "").strip()
        if snapshot_url:
            payload["url"] = snapshot_url
        return payload

    def _handle_conversation_snapshot_inbound(self, item):
        """兼容入口：bridge 入站仍调用此名。"""
        self._handle_sync_snapshot(item)

    def _session_has_reset_placeholder_errors(self, session):
        messages = getattr(session, "messages", None)
        if not isinstance(messages, list):
            return False

        for message in messages:
            if is_reset_placeholder_error_message(message):
                return True

        return False

    def _local_messages_match_web_snapshot(self, session, web_messages):
        messages = getattr(session, "messages", None)
        if not isinstance(messages, list):
            return False

        normalized_local = []
        for message in messages:
            role = str(getattr(message, "role", "") or "").strip().lower()
            if role not in ("user", "assistant"):
                continue

            text = self._normalize_synced_message_text(
                getattr(message, "content", "") or ""
            )
            if not text:
                continue

            normalized_local.append(
                self._message_fingerprint(role, text)
            )

        normalized_web = []
        for item in web_messages or []:
            if not isinstance(item, dict):
                continue

            role = str(item.get("role") or "").strip().lower()
            if role not in ("user", "assistant", "system", "tool"):
                continue

            if role in ("system", "tool"):
                role = "assistant"

            text = self._normalize_synced_message_text(
                item.get("text") or item.get("content") or ""
            )
            if not text:
                continue

            normalized_web.append(
                self._message_fingerprint(role, text)
            )

        return normalized_local == normalized_web

    def _handle_sync_snapshot(self, item):
        payload = item.get("payload") or {}
        message_id = (item.get("message_id") or "").strip()
        request_id = (payload.get("request_id") or "").strip()
        pending_sync = {}
        if message_id:
            pending_sync = dict(
                getattr(self._page_cmd, 'pending_sync_requests', {}).pop(message_id, {}) or {}
            )
        if not request_id:
            request_id = (pending_sync.get("request_id") or "").strip()
        web_pending = {}
        if request_id:
            web_pending = dict(
                self._web_sync.pending_requests.pop(request_id, {}) or {}
            )
        if not pending_sync and web_pending:
            pending_sync = web_pending
        payload = self._normalize_conversation_snapshot_payload(
            payload, item=item, pending_sync=pending_sync
        )
        self._append_log(
            f"[WEB_SYNC][SNAPSHOT_RECEIVED] request_id={request_id or '-'} "
            f"client_id={(payload.get('client_id') or item.get('client_id') or '-')} "
            f"conversation_id={(payload.get('conversation_id') or '-')} "
            f"message_count={len(payload.get('messages') or [])}",
            echo=True,
        )
        session_id = (
            payload.get("session_id")
            or item.get("session_id")
            or pending_sync.get("session_id")
            or ""
        ).strip()
        conversation_id = (
            payload.get("conversation_id")
            or pending_sync.get("conversation_id")
            or ""
        ).strip()
        if not conversation_id:
            session_for_conv = self._sessions.get(session_id) if session_id else None
            if session_for_conv is not None:
                remote = normalize_remote_chatgpt(session_for_conv.remote_chatgpt)
                conversation_id = self._remote_conversation_id(remote)
        web_messages = payload.get("messages")
        if not isinstance(web_messages, list):
            web_messages = []
        if not conversation_id:
            conversation_id = "-"
        total_text_len = 0
        for msg in web_messages:
            if isinstance(msg, dict):
                total_text_len += len(str(msg.get("text") or msg.get("content") or "").strip())
        self._append_log(
            "[SYNC_CONVERSATION][RECV] "
            f"session_id={session_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"count={len(web_messages)} "
            f"total_text_len={total_text_len}",
            echo=True,
        )
        source_client_id = (
            payload.get("client_id") or item.get("client_id") or pending_sync.get("client_id") or ""
        ).strip()
        source_page_instance_id = (payload.get("page_instance_id") or "").strip()

        if not session_id:
            self._append_log(
                "[WEB_SYNC][SNAPSHOT_APPLY_SKIP] "
                f"reason=missing_session_id "
                f"request_id={request_id or '-'} "
                f"session_id=- "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
            self._append_log(
                "[SYNC_CONVERSATION][FAILED] reason=missing_session_id "
                f"session_id=- conversation_id={conversation_id or '-'} "
                f"message_id={message_id or '-'}",
                echo=True,
            )
            self._clear_session_sync_running("", request_id, reason="missing_session_id")
            self._finish_sync_progress(
                session_id="",
                request_id=request_id,
                success=False,
                text=self._sync_failure_text_after_pre_clear(
                    session_id, "缺少 session_id"
                ),
            )
            return

        session = self._sessions.get(session_id)
        if session is None:
            self._append_log(
                "[WEB_SYNC][SNAPSHOT_APPLY_SKIP] "
                f"reason=session_not_found "
                f"request_id={request_id or '-'} "
                f"session_id={session_id} "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
            self._append_log(
                f"[SYNC_CONVERSATION][FAILED] reason=session_not_found "
                f"session_id={session_id} conversation_id={conversation_id or '-'} "
                f"message_id={message_id or '-'}",
                echo=True,
            )
            self._clear_session_sync_running(
                session_id, request_id, reason="session_not_found"
            )
            self._log_sync_failed_after_clear(session_id, "session_not_found")
            self._finish_sync_progress(
                session_id=session_id,
                request_id=request_id,
                success=False,
                text=self._sync_failure_text_after_pre_clear(
                    session_id, "未找到对应对话"
                ),
            )
            return

        ok, reason = self._validate_sync_conversation_binding(session, payload)
        if not ok:
            self._append_log(
                "[WEB_SYNC][SNAPSHOT_APPLY_SKIP] "
                f"reason={reason or 'binding_invalid'} "
                f"request_id={request_id or '-'} "
                f"session_id={session_id} "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
            self._append_log(
                f"[SYNC_CONVERSATION][FAILED] session_id={session_id} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={message_id or '-'} reason={reason}",
                echo=True,
            )
            self._clear_session_sync_running(
                session_id, request_id, reason=reason or "binding_invalid"
            )
            self._log_sync_failed_after_clear(
                session_id, reason or "binding_invalid"
            )
            self._finish_sync_progress(
                session_id=session_id,
                request_id=request_id,
                success=False,
                text=self._sync_failure_text_after_pre_clear(
                    session_id, reason or "绑定校验未通过"
                ),
            )
            if session.session_id == self._current_session_id:
                self._render_session_chat(session, force_bottom=True)
                self._refresh_session_list(select_session_id=session.session_id)
            return

        mode = str(
            payload.get("mode")
            or web_pending.get("mode")
            or pending_sync.get("mode")
            or "merge"
        ).strip()
        if mode not in ("merge", "replace"):
            mode = "merge"
        count = len(web_messages)
        if count <= 0:
            self._append_log(
                "[WEB_SYNC][SNAPSHOT_EMPTY] "
                f"reason=empty_snapshot "
                f"request_id={request_id or '-'} "
                f"session_id={session_id or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"local_message_count={len(session.messages)}",
                echo=True,
            )
            self._clear_session_sync_running(
                session_id, request_id, reason="empty_snapshot"
            )
            empty_text = "同步完成（网页暂无消息）"
            if self._session_was_cleared_for_rebind_or_sync(session_id):
                empty_text = "同步完成（网页暂无消息，本地已清空）"
            self._finish_sync_progress(
                session_id=session_id,
                request_id=request_id,
                success=True,
                text=empty_text,
            )
            if session.session_id == self._current_session_id:
                self._render_session_chat(session, force_bottom=True)
                self._refresh_session_list(select_session_id=session.session_id)
            return

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        sig_conv = conversation_id if conversation_id != "-" else self._remote_conversation_id(remote)
        sig = self._make_web_snapshot_signature(sig_conv, web_messages)
        last_sig_map = getattr(self, "_last_applied_snapshot_sig_by_session", None)
        if last_sig_map is None:
            last_sig_map = {}
            self._last_applied_snapshot_sig_by_session = last_sig_map
        old_sig = last_sig_map.get(session_id)
        local_has_reset_errors = self._session_has_reset_placeholder_errors(session)
        local_matches_web = self._local_messages_match_web_snapshot(session, web_messages)

        if sig == old_sig and local_matches_web and not local_has_reset_errors:
            self._append_log(
                "[WEB_SYNC][SNAPSHOT_APPLY_SKIP] "
                f"reason=snapshot_unchanged "
                f"request_id={request_id or '-'} "
                f"session_id={session_id} "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
            self._append_log(
                f"[SYNC_CONVERSATION][SKIP_APPLY] session_id={session_id} "
                f"reason=snapshot_unchanged count={count}",
                echo=True,
            )
            self._clear_session_sync_running(
                session_id, request_id, reason="snapshot_unchanged"
            )
            self._finish_sync_progress(
                session_id=session_id,
                request_id=request_id,
                success=True,
                text="同步完成（网页内容无变化）",
            )
            if session.session_id == self._current_session_id:
                if hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="snapshot_unchanged_refresh",
                    )
            return

        if sig == old_sig and (local_has_reset_errors or not local_matches_web):
            self._append_log(
                "[WEB_SYNC][FORCE_REAPPLY_UNCHANGED_SNAPSHOT] "
                f"session_id={session_id} "
                f"reason=local_dirty_or_reset_placeholder "
                f"local_has_reset_errors={local_has_reset_errors} "
                f"local_matches_web={local_matches_web} "
                f"message_count={count}",
                echo=True,
            )
        status = self._bridge_ui.last_bridge_status or {}
        current_client_id = (read_snapshot_identity(status, "active")["client_id"] or "").strip()
        current_info = self._client_info_by_id(current_client_id, status=status)
        selected_client_id = self._selected_tm_page_client_id()
        selected_info = self._client_info_by_id(selected_client_id, status=status)
        bound_client_id = (remote.get("client_id") or "").strip()
        bound_conversation_id = self._remote_conversation_id(remote)
        target_client_id = (payload.get("client_id") or bound_client_id or "").strip()
        target_conversation_id = (payload.get("conversation_id") or bound_conversation_id or "").strip()
        recv_context = {
            "currentClientId": current_client_id or "-",
            "currentConversationId": self._client_conversation_id(current_info) or "-",
            "boundClientId": bound_client_id or "-",
            "boundConversationId": bound_conversation_id or "-",
            "selectedClientId": selected_client_id or "-",
            "selectedConversationId": self._client_conversation_id(selected_info) or "-",
            "targetClientId": target_client_id or "-",
            "targetConversationId": target_conversation_id or "-",
            "targetSyncable": bool(count > 0),
        }
        sync_trace_id = (pending_sync.get("trace_id") or web_pending.get("trace_id") or "").strip()
        latest_user_len = 0
        latest_assistant_len = 0
        for msg in reversed(web_messages):
            if not isinstance(msg, dict):
                continue
            role = (msg.get("role") or "").strip().lower()
            text_len = len(str(msg.get("text") or msg.get("content") or "").strip())
            if role == "user" and not latest_user_len:
                latest_user_len = text_len
            elif role == "assistant" and not latest_assistant_len:
                latest_assistant_len = text_len
            if latest_user_len and latest_assistant_len:
                break
        self._append_log(
            "[SYNC][RESULT] "
            + kv_line(
                trace_id=sync_trace_id or "-",
                success="true" if count > 0 else "false",
                message_count=count,
                latest_user_len=latest_user_len,
                latest_assistant_len=latest_assistant_len,
                reason="response_received" if count > 0 else "empty_messages",
            ),
            echo=True,
        )
        self._append_log(
            "[SYNC][RESPONSE_RECEIVED] "
            + self._sync_log_context_fields(recv_context, reason="response_received")
            + " "
            + f"session_id={session_id} "
            + f"message_id={(item.get('message_id') or '-')[:8]} "
            + f"count={count} total_text_len={total_text_len}",
            echo=True,
        )
        self._update_sync_progress(
            session_id=session_id,
            request_id=request_id,
            text=f"已收到网页快照 {count} 条，正在写入本地消息",
        )
        applied_ok, apply_reason = self.merge_conversation_snapshot(
            session_id,
            web_messages,
            mode=mode,
            source="web_snapshot",
        )
        if applied_ok:
            last_sig_map[session_id] = sig
            self._append_log(
                "[WEB_SYNC][SNAPSHOT_APPLY] "
                f"request_id={request_id or '-'} "
                f"session_id={session_id} "
                f"conversation_id={conversation_id or '-'} "
                f"message_count={count} "
                f"source_client_id={source_client_id or '-'} "
                f"source_page_instance_id={source_page_instance_id or '-'}",
                echo=True,
            )
            self._append_log(
                f"[WEB_SYNC][APPLY_OK] request_id={request_id or '-'} "
                f"session_id={session_id} message_count={len(session.messages)}",
                echo=True,
            )
        else:
            self._append_log(
                "[WEB_SYNC][SNAPSHOT_APPLY_SKIP] "
                f"reason={apply_reason or 'apply_failed'} "
                f"request_id={request_id or '-'} "
                f"session_id={session_id} "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
        self._append_log(
            "[SYNC][APPLY_DONE] "
            + self._sync_log_context_fields(recv_context, reason="apply_done")
            + " "
            + f"session_id={session_id} count={count} mode={mode} applied={applied_ok}",
            echo=True,
        )
        if not applied_ok:
            self._append_log(
                "[SYNC_CONVERSATION][FAILED] "
                f"reason={apply_reason or 'apply_failed'} "
                f"session_id={session_id or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={message_id or '-'}",
                echo=True,
            )
            self._clear_session_sync_running(
                session_id, request_id, reason=apply_reason or "apply_failed"
            )
            self._log_sync_failed_after_clear(
                session_id,
                apply_reason or "apply_failed",
                error=apply_reason or "apply_failed",
            )
            self._finish_sync_progress(
                session_id=session_id,
                request_id=request_id,
                success=False,
                text=self._sync_failure_text_after_pre_clear(
                    session_id, apply_reason or "应用网页快照失败"
                ),
            )
            if session.session_id == self._current_session_id:
                self._render_session_chat(session, force_bottom=True)
                self._refresh_session_list(select_session_id=session.session_id)
            return

        sync_state = getattr(self, "_sync_progress_state", {}) or {}
        hard_timed_out = getattr(self._web_sync, 'hard_timed_out_request_ids', set())
        previous_state = ""
        if sync_state.get("slow_waiting"):
            previous_state = "slow_waiting"
        elif request_id and request_id in hard_timed_out:
            previous_state = "hard_timeout"
        elif (
            request_id
            and sync_state.get("request_id") == request_id
            and sync_state.get("finished_success") is False
        ):
            previous_state = "sync_failure"
        if previous_state:
            started_at = float(
                sync_state.get("started_at")
                or web_pending.get("started_at")
                or pending_sync.get("started_at")
                or time.time()
            )
            elapsed_sec = max(0, int(time.time() - started_at))
            self._append_log(
                "[WEB_SYNC][LATE_SNAPSHOT_ACCEPTED] "
                f"request_id={request_id or '-'} "
                f"elapsed_sec={elapsed_sec} "
                f"message_count={count} "
                f"previous_state={previous_state}",
                echo=True,
            )
            hard_timed_out.discard(request_id)

        finish_id = (
            (pending_sync or {}).get("message_id")
            or request_id
            or ""
        )
        if hasattr(self, "finish_page_command"):
            self.finish_page_command(finish_id)
        else:
            self._web_sync.running = False
            self._web_sync.request_id = ""
            self._web_sync.started_at = 0.0
            self._web_sync.timeout_timer_request_id = ""
        self._append_log(
            "[WEB_SYNC][DONE] "
            f"request_id={request_id or '-'} "
            f"message_count={count}",
            echo=True,
        )
        self._clear_session_sync_running(
            session_id, request_id, reason="snapshot_received"
        )
        success_text = (
            apply_reason
            if apply_reason and apply_reason.startswith("同步完成")
            else f"同步完成：网页 {count} 条，本地 {len(session.messages)} 条"
        )
        self._finish_sync_progress(
            session_id=session_id,
            request_id=request_id,
            success=True,
            text=success_text,
        )
        if hasattr(self, "tm_sync_target_label"):
            self.tm_sync_target_label.setText("同步：可同步")
            self.tm_sync_target_label.setProperty("state", "ok")
            self.tm_sync_target_label.style().unpolish(self.tm_sync_target_label)
            self.tm_sync_target_label.style().polish(self.tm_sync_target_label)

    def _pick_fresh_sync_page_for_conversation(
        self, registry: PageRegistry, conversation_id: str, *, now: float | None = None
    ):
        """同 conversation_id 下选 poll 新鲜、可同步的页面。"""
        conversation_id = (conversation_id or "").strip()
        if not conversation_id or not isinstance(registry, PageRegistry):
            return None
        if now is None:
            now = time.time()
        candidates = []
        for page in registry.get_by_conversation_id(conversation_id):
            if not page.online or not page.conversation_syncable:
                continue
            poll_ok, _, _ = evaluate_sync_poll_freshness(page, now=now)
            if not poll_ok:
                continue
            raw = page._raw if isinstance(page._raw, dict) else {}
            poll_ts = float(raw.get("last_poll_at") or raw.get("last_seen") or 0)
            candidates.append((poll_ts, page))
        if not candidates:
            return None
        candidates.sort(key=lambda row: row[0], reverse=True)
        return candidates[0][1]

    def _refresh_sync_bridge_status_and_relink(self, session):
        """手动同步前拉取最新 bridge status，必要时换绑到同会话新鲜页。"""
        status = get_bridge_status() if is_server_running() else {}
        if not isinstance(status, dict):
            status = {}
        if hasattr(self, "_bridge_ui"):
            self._bridge_ui.last_bridge_status = status
        if hasattr(self, "refresh_page_registry_from_status"):
            self.refresh_page_registry_from_status(status)

        remote = normalize_remote_chatgpt(
            getattr(session, "remote_chatgpt", None) if session else None
        )
        if not remote_binding_enabled(remote):
            return status

        now = time.time()
        reg = PageRegistry.from_bridge_status(status, now=now)
        binding = binding_from_session(session)
        result = resolve_page_command_target(
            session,
            "sync_conversation",
            reg,
            now=now,
            allow_same_conversation=False,
        )
        if result.get("ok"):
            return status

        conversation_id = (binding.get("conversation_id") or "").strip()
        old_client_id = (binding.get("client_id") or "").strip()
        old_page_instance_id = (binding.get("page_instance_id") or "").strip()
        if conversation_id:
            fresh_page = self._pick_fresh_sync_page_for_conversation(
                reg, conversation_id, now=now
            )
            if fresh_page is not None and (
                (fresh_page.client_id or "").strip() != old_client_id
                or (fresh_page.page_instance_id or "").strip() != old_page_instance_id
            ):
                self._append_log(
                    "[SYNC][SAME_CONVERSATION_RELINK] "
                    f"old_page_instance_id={old_page_instance_id or '-'} "
                    f"new_page_instance_id={fresh_page.page_instance_id or '-'} "
                    f"conversation_id={conversation_id or '-'}",
                    echo=True,
                )

                if hasattr(self, "set_bound_page"):
                    self.set_bound_page(
                        session,
                        fresh_page._raw
                        if hasattr(fresh_page, "_raw")
                        and isinstance(fresh_page._raw, dict)
                        else {
                            "client_id": fresh_page.client_id,
                            "page_instance_id": fresh_page.page_instance_id,
                            "conversation_id": fresh_page.conversation_id,
                            "url": fresh_page.url,
                            "page_type": "conversation",
                            "online": True,
                            "conversation_syncable": True,
                        },
                        reason="relink_fresh_same_conversation_before_sync",
                        silent=True,
                    )

                return status
        self._append_log(
            "[SYNC][STRICT_BOUND_TARGET] "
            f"session_id={getattr(session, 'session_id', '-') or '-'} "
            f"bound_client_id={old_client_id or '-'} "
            f"bound_page_instance_id={old_page_instance_id or '-'} "
            f"bound_conversation_id={conversation_id or '-'}",
            echo=True,
        )
        return status if isinstance(status, dict) else {}

    def _sync_poll_block_user_hint(self, plan: SyncPlan) -> str:
        reason_code = ""
        if isinstance(plan.target, dict):
            reason_code = (
                plan.target.get("reason_code")
                or plan.target.get("reason_code")
                or ""
            ).strip()
        block_reason = (plan.block_reason or "").strip()
        poll_codes = {
            "bound_page_not_polling",
            "bound_page_poll_stale",
            "bound_page_offline",
            "not_conversation_syncable",
        }
        if reason_code in poll_codes or block_reason in poll_codes:
            return (
                "绑定页面在线状态过期或没有轮询，请刷新页面列表后重新绑定页面。"
            )
        for token in ("poll", "轮询", "离线", "offline"):
            if token in block_reason.lower() or token in (plan.block_reason or "").lower():
                return (
                    "绑定页面在线状态过期或没有轮询，请刷新页面列表后重新绑定页面。"
                )
        return ""

    def _sync_timeout_finish_text(self, message_id: str, pending: dict) -> str:
        message_id = (message_id or "").strip()
        pending = pending if isinstance(pending, dict) else {}
        if pending.get("ack_mismatch"):
            return (
                "网页回传了同步确认，但 message_id 不匹配，快照未被服务端接受。"
                "请刷新页面列表或重新绑定页面后重试。"
            )
        msg = get_message_state(message_id) if message_id else None

        in_control_queue = False
        if message_id:
            from app.server import state as server_state
            from app.utils.bridge_payload import get_bridge_message_id

            with server_state._state_lock:
                for queued in server_state._control_queue:
                    if get_bridge_message_id(queued) == message_id:
                        in_control_queue = True
                        break

        if isinstance(msg, dict):
            status = (msg.get("message_status") or "").strip()
            delivered = bool(
                msg.get("delivered_at")
                or msg.get("delivered_to")
                or status in ("delivered", "acked", "replied", "failed")
            )
            acked = bool(msg.get("acked_at")) or status in ("acked", "replied", "failed")
            if not delivered:
                return (
                    "同步命令已入队，但网页没有领取命令。"
                    "可能是页面轮询停止、page_instance_id 过期或绑定到了旧页面。"
                )
            if acked and status not in ("replied",):
                return (
                    "网页已领取同步命令，但未回传 conversation_snapshot。"
                    "请检查油猴脚本日志是否有 report 报错。"
                )
            if not acked:
                return (
                    "网页已领取同步命令，但未回传 conversation_snapshot。"
                    "请检查油猴脚本是否执行 sync_conversation 报错。"
                )
            return (
                "网页已领取同步命令，但未回传 conversation_snapshot。"
            )

        if in_control_queue or not message_id:
            return "同步命令已入队，但网页没有领取命令。"
        return (
            "同步请求已发送，但网页没有返回结果，"
            "请刷新页面列表或重新绑定页面。"
        )

    def _note_sync_ack_mismatch(self, message_id: str) -> None:
        message_id = (message_id or "").strip()
        if not message_id:
            return
        pending_map = getattr(self._web_sync, "pending_requests", None)
        if not isinstance(pending_map, dict):
            return
        for pending in pending_map.values():
            if not isinstance(pending, dict):
                continue
            if (pending.get("message_id") or "").strip() == message_id:
                pending["ack_mismatch"] = True
                break
        sync_req = getattr(self._page_cmd, "pending_sync_requests", None)
        if isinstance(sync_req, dict) and message_id in sync_req:
            entry = sync_req.get(message_id)
            if isinstance(entry, dict):
                entry["ack_mismatch"] = True

    def _build_sync_plan(
        self,
        session,
        *,
        request_reason="manual_button",
        delay_ms=0,
        allow_open_url=False,
        strict_bound_identity=True,
        status=None,
    ) -> SyncPlan:
        """resolve_page_action(sync_conversation) -> SyncPlan。"""
        session_id = session.session_id
        if status is None:
            reason = (request_reason or "").strip()
            if reason in ("manual_button", "manual"):
                status = self._refresh_sync_bridge_status_and_relink(session)
            else:
                status = get_bridge_status() if is_server_running() else {}
        if not isinstance(status, dict):
            status = {}
        trace_id = self._get_active_sync_trace_id()
        if not trace_id:
            trace_id = make_sync_trace_id(session_id)
            self._set_active_sync_trace_id(trace_id)
        request_id = f"sync-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
        mode = "merge"
        raw_max_messages = getattr(self, "_sync_conversation_max_messages", 10)
        try:
            max_messages = int(raw_max_messages or 10)
        except (TypeError, ValueError) as error:
            self._append_log(
                "[SYNC][PLAN][MAX_MESSAGES_INVALID] "
                f"field=_sync_conversation_max_messages "
                f"raw={raw_max_messages!r} fallback=10 "
                f"error_type={type(error).__name__} error={error}",
                echo=True,
                level="WARNING",
            )
            max_messages = 10
        max_messages = max(1, max_messages)

        allowed, target_page, source, block_reason, detail = (
            self.resolve_sync_decision(session, status=status)
        )
        if not isinstance(detail, dict):
            detail = {}

        target: Dict[str, Any] = {}
        if isinstance(target_page, dict):
            target.update(target_page)
        if isinstance(detail, dict):
            for key, value in detail.items():
                if key not in target or not str(target.get(key) or "").strip():
                    target[key] = value
        client_id = (target.get("client_id") or "").strip()
        page_instance_id = (target.get("page_instance_id") or "").strip()
        conversation_id = (target.get("conversation_id") or "").strip()
        if not conversation_id and isinstance(target_page, dict):
            conversation_id = (self._client_conversation_id(target_page) or "").strip()
            target["conversation_id"] = conversation_id
        target_url = (target.get("url") or "").strip()
        if not target_url and isinstance(target_page, dict):
            target_url = page_url_from(target_page) or ""
        if not target_url and client_id:
            info = self._client_info_by_id(
                client_id, status=status, page_instance_id=page_instance_id
            )
            if info:
                target_url = page_url_from(info) or ""
        if target_url:
            target["url"] = target_url
        if client_id:
            target["client_id"] = client_id
        if page_instance_id:
            target["page_instance_id"] = page_instance_id

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        self._append_log(
            "[SYNC][STRICT_BOUND_TARGET] "
            f"session_id={session_id} "
            f"bound_client_id={(remote.get('client_id') or '-')} "
            f"bound_page_instance_id={(remote.get('page_instance_id') or '-')} "
            f"bound_conversation_id={(self._remote_conversation_id(remote) or '-')}",
            echo=True,
        )
        now_ts = time.time()
        page_for_poll = target_page if isinstance(target_page, dict) else detail
        page_online = bool(page_for_poll.get("online")) if isinstance(page_for_poll, dict) else False
        page_conv_syncable = conversation_syncable_from(page_for_poll) if isinstance(page_for_poll, dict) else False
        page_last_poll_raw = page_for_poll.get("last_poll_at") if isinstance(page_for_poll, dict) else None
        page_last_poll = float(page_last_poll_raw) if page_last_poll_raw is not None else None
        poll_age_sec = round(now_ts - page_last_poll, 1) if isinstance(page_last_poll, (int, float)) and page_last_poll > 0 else None
        has_polling_field = bool(page_for_poll.get("polling") or page_for_poll.get("is_polling") or page_for_poll.get("poll_state")) if isinstance(page_for_poll, dict) else False
        polling_value = page_for_poll.get("polling") if isinstance(page_for_poll, dict) else None
        try:
            polling_active = is_page_polling_active(page_for_poll, now_ts=now_ts, max_age_sec=15.0) if isinstance(page_for_poll, dict) else False
        except Exception as exc:
            print("[SYNC][POLLING_CHECK][ERROR] is_page_polling_active failed: error_type={} error={}".format(type(exc).__name__, exc))
            polling_active = False

        self._append_log(
            "[SYNC][POLLING_CHECK] "
            "session_id={} ".format(session_id)
            + "page_no={} ".format(page_for_poll.get("page_no") or "-")
            + "client_id={} ".format(page_for_poll.get("client_id") or "-")
            + "page_instance_id={} ".format(page_for_poll.get("page_instance_id") or "-")
            + "online={} ".format("true" if page_online else "false")
            + "conversation_syncable={} ".format("true" if page_conv_syncable else "false")
            + "last_poll_at={} ".format(page_last_poll or "-")
            + "poll_age_sec={} ".format(poll_age_sec or "-")
            + "has_polling_field={} ".format("true" if has_polling_field else "false")
            + "polling_value={} ".format(polling_value or "-")
            + "polling_active={} ".format("true" if polling_active else "false")
            + "decision={} ".format("allow" if allowed else "block")
            + "block_reason={}".format(block_reason or "-"),
            echo=True,
        )
        self._append_log(
            "[SYNC][PLAN] "
            "session_id={} ".format(session_id)
            + "allowed={} ".format("true" if allowed else "false")
            + "source={} ".format(source or "-")
            + "matched_by={} ".format(page_for_poll.get("matched_by") or "-")
            + "online={} ".format("true" if page_online else "false")
            + "conversation_syncable={} ".format("true" if page_conv_syncable else "false")
            + "last_poll_at={} ".format(page_last_poll or "-")
            + "poll_age_sec={} ".format(poll_age_sec or "-")
            + "has_polling_field={} ".format("true" if has_polling_field else "false")
            + "polling_value={} ".format(polling_value or "-")
            + "polling_active={} ".format("true" if polling_active else "false")
            + "client_id={} ".format(client_id or "-")
            + "conversation_id={} ".format(conversation_id or "-")
            + "block_reason={}".format(block_reason or "-"),
            echo=True,
        )

        from app.utils.target_sources import (
            TARGET_SOURCE_BOUND_PAGE,
            TARGET_SOURCE_NO_SESSION,
            canonical_target_source,
        )

        target_source = canonical_target_source((source or "").strip()) or (
            TARGET_SOURCE_BOUND_PAGE
            if remote_binding_enabled(remote)
            else TARGET_SOURCE_NO_SESSION
        )

        return SyncPlan(
            session=session,
            session_id=session_id,
            request_reason=request_reason or "manual_button",
            delay_ms=max(0, int(delay_ms or 0)),
            allow_open_url=bool(allow_open_url),
            strict_bound_identity=bool(strict_bound_identity),
            trace_id=trace_id,
            request_id=request_id,
            allowed=bool(allowed),
            target=target,
            target_source=target_source,
            block_reason=(block_reason or "").strip(),
            mode=mode,
            max_messages=max_messages,
        )

    def _sync_prechecks(self, session, session_id: str) -> Tuple[bool, str]:
        if session is None:
            return False, "当前没有选中的对话"
        if hasattr(self, "is_page_command_active") and self.is_page_command_active(
            "sync_conversation"
        ):
            return False, "同步正在进行中，请稍候"
        if getattr(self, "_page_cmd", None) and self._page_cmd.sync_conversation_running:
            if hasattr(self, "_log_reentry_skip"):
                self._log_reentry_skip("sync_conversation")
            elif hasattr(self, "_append_log"):
                self._append_log(
                    "[REENTRY][SKIP] name=sync_conversation reason=already_running",
                    echo=False,
                )
            return False, "同步正在进行中，请稍候"
        if self._is_session_sync_running(session_id):
            self._append_log(
                f"[SYNC][SKIP_DUPLICATE] session_id={session_id} reason=inflight",
                echo=True,
            )
            return False, "同步正在进行中，请稍候"
        if not is_server_running():
            fail_text = "请先启动服务"
            self._set_tm_action_hint(fail_text)
            if session.session_id == self._current_session_id:
                self._render_session_chat(session, force_bottom=True)
                self._refresh_session_list(select_session_id=session.session_id)
            return False, fail_text
        return True, ""

    def request_sync_conversation(
        self,
        session,
        reason="manual_button",
        delay_ms=0,
        allow_open_url=False,
        strict_bound_identity=True,
    ):
        ok, msg = self._sync_prechecks(session, session.session_id if session else "")
        if not ok:
            return False, msg
        if hasattr(self, "_clear_stale_pending_reply_before_sync"):
            self._clear_stale_pending_reply_before_sync(session)
        sync_status = None
        if (reason or "").strip() in ("manual_button", "manual"):
            sync_status = self._refresh_sync_bridge_status_and_relink(session)
        plan = self._build_sync_plan(
            session,
            request_reason=reason,
            delay_ms=delay_ms,
            allow_open_url=allow_open_url,
            strict_bound_identity=strict_bound_identity,
            status=sync_status,
        )
        return self._dispatch_sync_plan(plan)

    def _dispatch_sync_plan(self, plan: SyncPlan) -> Tuple[bool, str]:
        session = plan.session
        session_id = plan.session_id
        trace_id = plan.trace_id

        if isinstance(plan.target, dict) and plan.target:
            self._append_log(
                "[SYNC][TARGET_FINAL] "
                f"source={plan.target_source or '-'} "
                f"client_id={plan.client_id or '-'} "
                f"page_instance_id={plan.page_instance_id or '-'} "
                f"conversation_id={plan.conversation_id or '-'} "
                f"url={plan.url or '-'} "
                f"allowed={'true' if plan.allowed else 'false'}",
                echo=True,
            )

        if plan.block_reason == "prebound_home_wait_conversation" and plan.target:
            self._begin_wait_conversation_page_for_sync(
                session, plan.target, request_reason=plan.request_reason
            )
            return False, plan.block_reason

        if not plan.allowed:
            return self._finish_blocked_sync_plan(plan)

        if not plan.conversation_id:
            self._append_log(
                "[SYNC][BLOCK] "
                + kv_line(
                    trace_id=trace_id,
                    reason="missing_conversation_id_for_sync",
                    target_client=plan.client_id or "-",
                    target_source=plan.target_source or "-",
                ),
                echo=True,
            )
            self._clear_session_sync_running(
                session_id, reason="missing_conversation_id"
            )
            fail_text = "目标页缺少 conversation_id"
            self._set_tm_action_hint(fail_text)
            if session.session_id == self._current_session_id:
                self._render_session_chat(session, force_bottom=True)
                self._refresh_session_list(select_session_id=session.session_id)
            return False, fail_text

        remote_bind = normalize_remote_chatgpt(session.remote_chatgpt)
        if plan.target and not remote_binding_enabled(remote_bind):
            if hasattr(self, "set_bound_page") and not (
                hasattr(self, "_should_block_automatic_bind_actions")
                and self._should_block_automatic_bind_actions(session)[0]
            ):
                self.set_bound_page(
                    session,
                    plan.target,
                    reason="auto_bind_before_sync",
                    silent=True,
                )

        self._register_sync_pending(plan)
        self._update_sync_target_display()

        if plan.delay_ms > 0:
            QTimer.singleShot(plan.delay_ms, lambda p=plan: self._enqueue_sync_from_plan(p))
        else:
            self._enqueue_sync_from_plan(plan)
        return True, ""

    def _finish_blocked_sync_plan(self, plan: SyncPlan) -> Tuple[bool, str]:
        session = plan.session
        session_id = plan.session_id
        status = get_bridge_status()
        block_reason = (
            plan.block_reason
            or (
                plan.target.get("reason_code")
                or ""
            ).strip()
            if isinstance(plan.target, dict)
            else ""
        ) or "not_syncable"

        strict_no_open_codes = {
            "bound_page_offline",
            "bound_page_poll_stale",
            "bound_page_not_polling",
            "not_conversation_syncable",
        }
        if (
            plan.allow_open_url
            and block_reason not in strict_no_open_codes
            and self._simple_sync_open_url(session)
        ):
            self._mark_session_sync_running(session_id, "waiting_open_page")
            self._start_sync_progress(
                session_id,
                "waiting_open_page",
                "已打开绑定网页，正在检测可同步页面",
            )
            QTimer.singleShot(
                1500,
                lambda sid=session_id, ctx=dict(plan.target or {}): self._simple_sync_retry_after_open(
                    sid,
                    expected_ctx=ctx,
                ),
            )
            return False, block_reason or "waiting_open_page"

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if block_reason in strict_no_open_codes:
            self._append_log(
                "[SYNC][BLOCK_STRICT_BOUND] "
                f"reason_code={block_reason or '-'} "
                f"bound_client_id={(remote.get('client_id') or '-')} "
                f"bound_page_instance_id={(remote.get('page_instance_id') or '-')}",
                echo=True,
            )
        online_same_conv = self._count_online_sync_clients_by_conversation_id(
            self._remote_conversation_id(remote),
            status=status,
        )
        self._append_log(
            "[SYNC][BLOCK] "
            + kv_line(
                trace_id=plan.trace_id,
                reason=block_reason,
                source=plan.target_source or "-",
                bound_client_id=(remote.get("client_id") or "-"),
                bound_conversation_id=(self._remote_conversation_id(remote) or "-"),
                online_same_conversation_count=online_same_conv,
            ),
            echo=True,
        )
        self._clear_session_sync_running(session_id, reason=block_reason)
        hint = self._sync_poll_block_user_hint(plan)
        if not hint:
            hint = block_reason or ""
        if not hint or hint in ("no_dialog_ready_page", "no_sync_target"):
            hint = (
                f"无法同步：{log_page_decision_fields(plan.target)}"
                if plan.target
                else "没有可同步的在线 ChatGPT 对话页，请先打开 /c/ 对话页。"
            )
        self._set_tm_action_hint(hint)
        if session.session_id == self._current_session_id:
            self._render_session_chat(session, force_bottom=True)
            self._refresh_session_list(select_session_id=session.session_id)
        return False, hint

    def _register_sync_pending(self, plan: SyncPlan) -> None:
        pending_map = self._web_sync_pending_map()
        pending_map[plan.request_id] = {
            "session_id": plan.session_id,
            "client_id": plan.client_id,
            "page_instance_id": plan.page_instance_id,
            "conversation_id": plan.conversation_id,
            "url": plan.url,
            "target_source": plan.target_source,
            "created_at": time.time(),
            "started_at": time.time(),
            "request_reason": plan.request_reason,
            "trace_id": plan.trace_id,
        }
        self._append_log(
            "[WEB_SYNC][START] "
            f"request_id={plan.request_id} "
            f"session_id={plan.session_id} "
            f"client_id={plan.client_id or '-'} "
            f"conversation_id={plan.conversation_id or '-'}",
            echo=True,
        )

    def _sync_command_payload(self, plan: SyncPlan) -> dict:
        return {
            "mode": plan.mode,
            "max_messages": plan.max_messages,
            "session_id": plan.session_id,
            "conversation_id": plan.conversation_id,
            "client_id": plan.client_id,
            "page_instance_id": plan.page_instance_id,
            "sync_request_id": plan.request_id,
            "request_reason": plan.request_reason or "manual",
            "command_type": "read_snapshot",
            "require_input": False,
            "allow_hidden": True,
            "allow_generating": True,
            "allow_while_generating": True,
            "allow_not_focused": True,
            "simple_online_policy": True,
        }

    def _enqueue_sync_from_plan(self, plan: SyncPlan) -> None:
        session = plan.session
        session_id = plan.session_id
        payload = self._sync_command_payload(plan)
        log_fn = getattr(self, "safe_log", None) or self._append_log

        self._append_log(
            "[SYNC][REQUEST_SENT] "
            + kv_line(
                trace_id=plan.trace_id,
                request_id=plan.request_id,
                target_client=plan.client_id or "-",
                target_conv=plan.conversation_id or "-",
            ),
            echo=True,
        )

        if hasattr(self, "enqueue_page_command"):
            result = self.enqueue_page_command(
                session, "sync_conversation", payload=payload
            )
            if result.get("ok"):
                message_id = (result.get("message_id") or "").strip()
                resolved = result.get("target") or {}
                if resolved.get("client_id"):
                    plan.target["client_id"] = (resolved.get("client_id") or "").strip()
                if resolved.get("page_instance_id"):
                    plan.target["page_instance_id"] = (
                        resolved.get("page_instance_id") or ""
                    ).strip()
                if resolved.get("conversation_id"):
                    plan.target["conversation_id"] = (
                        resolved.get("conversation_id") or ""
                    ).strip()
                self._on_sync_enqueued(plan, message_id)
                return
            enqueue_reason = result.get("reason") or "enqueue_failed"
        else:
            enqueue_result = enqueue_control_command(
                command="sync_conversation",
                client_id=plan.client_id,
                page_instance_id=plan.page_instance_id,
                conversation_id=plan.conversation_id,
                payload=payload,
            )
            queued, queued_msg, enqueue_reason = self._normalize_enqueue_result(
                enqueue_result
            )
            message_id = ""
            if queued and isinstance(queued_msg, dict):
                message_id = (
                    (queued_msg.get("message_id") or "") or ""
                ).strip()
            if queued and message_id:
                self._on_sync_enqueued(plan, message_id)
                return
            if queued and not message_id:
                enqueue_reason = "missing_message_id_after_enqueue"

        log_fn(
            "[WEB_SYNC][FAILED] "
            f"request_id={plan.request_id} reason={enqueue_reason or 'enqueue_failed'}",
            echo=True,
        )
        if hasattr(self, "clear_page_command_runtime"):
            self.clear_page_command_runtime("enqueue_failed")
        else:
            self._clear_web_sync_running(
                session_id=session_id,
                request_id=plan.request_id,
                reason="enqueue_failed",
                finish_text=self._sync_failure_text_after_pre_clear(
                    session_id, enqueue_reason or "命令入队失败"
                ),
                success=False,
            )
        self._set_tm_action_hint(enqueue_reason or "命令入队失败")
        if session.session_id == self._current_session_id:
            self._render_session_chat(session, force_bottom=True)
            self._refresh_session_list(select_session_id=session.session_id)

    def _on_sync_enqueued(self, plan: SyncPlan, message_id: str) -> None:
        session_id = plan.session_id
        pending_map = self._web_sync_pending_map()
        pending = pending_map.get(plan.request_id)
        if isinstance(pending, dict):
            pending.update(
                {
                    "client_id": plan.client_id,
                    "page_instance_id": plan.page_instance_id,
                    "conversation_id": plan.conversation_id,
                    "url": plan.url,
                    "message_id": message_id,
                }
            )

        used_page_command = False
        if hasattr(self, "start_page_command"):
            self.start_page_command(
                "sync_conversation",
                payload={
                    "message_id": message_id,
                    "request_id": plan.request_id,
                    "reason": plan.target_source,
                },
            )
            used_page_command = True
        else:
            self._web_sync.running = True
            self._web_sync.request_id = plan.request_id
            self._web_sync.started_at = time.time()

        self._mark_session_sync_running(session_id, plan.request_id)
        self._start_sync_progress(
            session_id, plan.request_id, "正在向网页发送同步请求"
        )
        self._schedule_sync_timeout(plan.request_id, phase="soft", delay_ms=20000)
        self._schedule_sync_timeout(plan.request_id, phase="hard", delay_ms=45000)
        if not used_page_command:
            self._start_web_sync_timeout_timer(plan.request_id)

        pending_sync = getattr(self, "_page_cmd", None)
        sync_req_map = (
            pending_sync.pending_sync_requests
            if pending_sync is not None
            else getattr(self, "_pending_sync_requests", None)
        )
        if sync_req_map is None:
            sync_req_map = {}
            if pending_sync is not None:
                pending_sync.pending_sync_requests = sync_req_map
            else:
                self._pending_sync_requests = sync_req_map
        sync_req_map[message_id] = {
            "session_id": session_id,
            "conversation_id": plan.conversation_id,
            "client_id": plan.client_id,
            "page_instance_id": plan.page_instance_id,
            "request_id": plan.request_id,
        }

        log_fn = getattr(self, "safe_log", None) or self._append_log
        log_fn(
            "[WEB_SYNC][ENQUEUE_OK] "
            f"request_id={plan.request_id} message_id={message_id}",
            echo=True,
        )
        self._update_sync_progress(
            session_id=session_id,
            request_id=plan.request_id,
            text="同步请求已发送，正在等待网页返回对话快照",
        )

    def _schedule_sync_timeout(
        self, request_id: str, *, phase: str = "soft", delay_ms: int = 20000
    ) -> None:
        request_id = (request_id or "").strip()
        if not request_id:
            return
        QTimer.singleShot(
            max(1000, int(delay_ms)),
            lambda rid=request_id, ph=phase: self._handle_sync_timeout(rid, phase=ph),
        )

    def _handle_sync_timeout(self, request_id: str, *, phase: str = "soft") -> None:
        phase = (phase or "soft").strip().lower()
        if phase == "timer":
            self._on_web_sync_timeout(request_id)
            return
        if phase == "hard":
            self._check_web_sync_hard_timeout(request_id)
            return
        self._notify_sync_soft_timeout(request_id)

    def _notify_sync_soft_timeout(self, request_id: str) -> None:
        request_id = (request_id or "").strip()
        if not request_id:
            return
        pending_map = getattr(self._web_sync, "pending_requests", None)
        if not isinstance(pending_map, dict):
            return
        pending = pending_map.get(request_id)
        if not isinstance(pending, dict):
            return
        if pending.get("soft_notified"):
            return
        still_running = False
        if hasattr(self, "is_page_command_active"):
            still_running = self.is_page_command_active("sync_conversation")
        else:
            still_running = bool(getattr(self._web_sync, "running", False))
        if not still_running:
            return
        pending["soft_notified"] = True
        session_id = (pending.get("session_id") or "").strip()
        finish_text = self._sync_timeout_finish_text(
            (pending.get("message_id") or "").strip(), pending
        )
        self._append_log(
            "[WEB_SYNC][SOFT_TIMEOUT] "
            f"request_id={request_id} "
            f"reason=no_snapshot_or_report_within_20s "
            f"hint={finish_text}",
            echo=True,
        )
        self._update_sync_progress(
            session_id=session_id,
            request_id=request_id,
            text=finish_text,
        )
    def _begin_wait_conversation_page_for_sync(self, session, item, *, request_reason="manual_button"):
        if session is None or not isinstance(item, dict):
            return False, "invalid_session_or_page"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        client_id = (
            (item.get("client_id") or "").strip()
            or (remote.get("prebound_home_client_id") or remote.get("client_id") or "").strip()
        )
        bind_token = (
            remote.get("bind_request_id")
            or item.get("bind_request_id")
            or ""
        ).strip()
        url = self._page_url_from_item(item) or (
            (remote.get("url") or "https://chatgpt.com/").strip()
        )
        self._append_log(
            "[SYNC][PREBOUND_HOME] "
            f"session_id={session.session_id} "
            f"client_id={client_id or '-'} "
            f"url={url or '-'} "
            f"reason=home_page_has_no_conversation_id",
            echo=True,
        )
        self._append_log(
            "[SYNC][WAIT_CONVERSATION_PAGE] "
            f"session_id={session.session_id} "
            f"client_id={client_id or '-'} "
            f"bind_token={bind_token or '-'}",
            echo=True,
        )
        pending = self._get_wait_conversation_sync_requests()
        pending[session.session_id] = {
            "client_id": client_id,
            "bind_token": bind_token,
            "request_reason": request_reason,
            "started_at": time.time(),
            "url": url,
        }
        self._set_tm_action_hint(
            "当前绑定的是首页，等待进入具体对话页后自动同步；"
            "请在该页新建或打开一个 ChatGPT 对话。"
        )
        if hasattr(self, "_open_bound_page_for_session"):
            self._open_bound_page_for_session(
                session, label="wait_conversation_sync", fallback_live=False
            )
        return False, "prebound_home_wait_conversation"

    def _poll_wait_conversation_sync_requests(self, status=None):
        pending = self._get_wait_conversation_sync_requests()
        if not pending:
            return
        status = status or self._bridge_ui.last_bridge_status or {}
        now = time.time()
        timeout_sec = 30.0
        for session_id in list(pending.keys()):
            wait_info = pending.get(session_id) or {}
            session = self._get_session_by_id(session_id)
            if session is None:
                pending.pop(session_id, None)
                continue
            started_at = float(wait_info.get("started_at") or 0)
            if started_at > 0 and (now - started_at) > timeout_sec:
                pending.pop(session_id, None)
                self._append_log(
                    "[SYNC][WAIT_CONVERSATION_PAGE][TIMEOUT] "
                    f"session_id={session_id} elapsed={now - started_at:.1f}s",
                    echo=True,
                )
                if session_id == (self._current_session_id or ""):
                    self._set_tm_action_hint(
                        "等待对话页超时：请先在绑定的 ChatGPT 首页新建或进入一个对话。"
                    )
                continue
            client_id = (wait_info.get("client_id") or "").strip()
            item = self._find_tm_client_by_client_id(client_id, status=status) if client_id else None
            if not isinstance(item, dict) or not self._is_dialog_ready_page(item):
                continue
            old_url = (wait_info.get("url") or "").strip()
            new_url = self._page_url_from_item(item)
            conversation_id = self._client_conversation_id(item)
            self._append_log(
                "[SYNC][PREBOUND_HOME_RESOLVED] "
                f"session_id={session_id} "
                f"old_url={old_url or '-'} "
                f"new_url={new_url or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"client_id={client_id or '-'}",
                echo=True,
            )
            pending.pop(session_id, None)
            self._relink_session_binding_from_tm_page(
                session, item, reason="prebound_home_resolved_for_sync"
            )
            request_reason = (wait_info.get("request_reason") or "manual_button").strip()
            if request_reason.startswith("send_"):
                if hasattr(self, "_try_send_next_queued_message"):
                    self._try_send_next_queued_message(session)
            else:
                self.request_sync_conversation(
                    session, reason=request_reason, delay_ms=200
                )

    def resolve_sync_decision(self, session, status=None):
        """薄适配：委托 resolve_page_action，返回 (allowed, page, source, block_reason, detail)。"""
        plan = self.resolve_page_action(
            session, action="sync_conversation", status=status, user_initiated=True
        )
        return plan.as_sync_decision_tuple()

    def _relink_session_binding_from_tm_page(self, session, item, *, reason=""):
        if session is None:
            self._append_log(
                "[BIND][RELINK][SKIP] reason=session_is_none",
                echo=True,
            )
            return False
        if not isinstance(item, dict):
            self._append_log(
                f"[BIND][RELINK][SKIP] session_id={session.session_id} reason=invalid_page",
                echo=True,
            )
            return False
        normalized = self._normalize_tm_page_for_binding(item)
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip()
        old_page_instance_id = (remote.get("page_instance_id") or "").strip()
        new_client_id = normalized.get("client_id") or ""
        new_page_instance_id = normalized.get("page_instance_id") or ""
        new_conversation_id = normalized.get("conversation_id") or ""
        new_url = normalized.get("url") or ""
        ok = self.set_bound_page(
            session,
            item,
            reason=reason or "relink",
            silent=True,
            allow_existing_conversation_for_new_session=True,
        )
        if ok:
            self._append_log(
                "[BIND][RELINK][SUCCESS] "
                f"session_id={session.session_id} "
                f"reason={reason or '-'} "
                f"old_client_id={old_client_id or '-'} "
                f"new_client_id={new_client_id or '-'} "
                f"old_page_instance_id={old_page_instance_id or '-'} "
                f"new_page_instance_id={new_page_instance_id or '-'} "
                f"conversation_id={new_conversation_id or '-'} "
                f"url={new_url or '-'}",
                echo=True,
            )
        else:
            self._append_log(
                "[BIND][RELINK][FAILED] "
                f"session_id={session.session_id} "
                f"reason={reason or '-'} "
                f"old_client_id={old_client_id or '-'} "
                f"new_client_id={new_client_id or '-'}",
                echo=True,
            )
        return ok

    def _build_bound_sync_target_payload(
        self,
        item,
        *,
        source,
        log_context,
        profile,
        bound_conversation_id="",
    ):
        target_client_id = self._tm_client_id(item)
        target_conversation_id = (
            self._client_conversation_id(item) or bound_conversation_id or ""
        )
        log_context["target_client_id"] = target_client_id or "-"
        log_context["target_conversation_id"] = target_conversation_id or "-"
        conversation_syncable = bool(profile.get("sync_ok"))
        log_context["conversation_syncable"] = conversation_syncable
        return {
            "client_id": target_client_id,
            "conversation_id": target_conversation_id,
            "page_instance_id": self._tm_page_instance_id(item),
            "conversation_syncable": conversation_syncable,
            "url_syncable": bool(profile.get("url_syncable")),
            "prebound_home": bool(profile.get("prebound_home")),
            "send_requestable": (profile.get("send_decision") in ("allowed", "queued")),
            "send_now_available": bool(profile.get("send_now_available")),
            "send_queueable": bool(profile.get("send_queueable")),
            "send_decision": (profile.get("send_decision") or "").strip(),
            "can_accept_input": bool(profile.get("can_accept_input")),
            "is_responding": bool(profile.get("is_responding")),
            "source": source,
            "log_context": log_context,
        }

    def _is_session_sync_running(self, session_id):
        key = self._get_session_sync_key(session_id)
        running = getattr(self, "_sync_inflight_by_session", {})
        return bool(key and running.get(key))

    def _start_web_sync_timeout_timer(self, request_id, timeout_ms=90000):
        request_id = (request_id or "").strip()
        if not request_id:
            return
        self._web_sync.timeout_timer_request_id = request_id
        QTimer.singleShot(
            max(1000, int(timeout_ms)),
            lambda rid=request_id: self._handle_sync_timeout(rid, phase="timer"),
        )

    def _on_web_sync_timeout(self, request_id):
        request_id = (request_id or "").strip()
        if not request_id:
            return
        if request_id != (getattr(self._web_sync, 'timeout_timer_request_id', '') or "").strip():
            return
        if request_id != (getattr(self._web_sync, 'request_id', '') or "").strip():
            return
        pending = getattr(self._web_sync, 'pending_requests', {}).get(request_id)
        if not pending and not getattr(self._web_sync, 'running', False):
            return
        sync_state = getattr(self, "_sync_progress_state", {}) or {}
        if not sync_state.get("running") and not sync_state.get("slow_waiting"):
            if sync_state.get("finished_success") is not None:
                return
        started_at = self._sync_state_float(
            pending or {},
            "started_at",
            getattr(self._web_sync, 'started_at', 0.0) or time.time(),
            context="_on_web_sync_timeout",
        )
        elapsed_ms = max(0, int((time.time() - started_at) * 1000))
        self._append_log(
            "[WEB_SYNC][TIMEOUT] "
            f"request_id={request_id} "
            f"elapsed_ms={elapsed_ms} "
            "reason=no_ack_or_report",
            echo=True,
        )
        session_id = (pending or {}).get("session_id") or ""
        self._clear_web_sync_running(
            session_id=session_id,
            request_id=request_id,
            reason="sync_timeout",
            finish_text=(
                "同步超时：服务端未收到网页返回，请确认绑定页油猴脚本在线。"
            ),
            success=False,
        )

    def _clear_web_sync_running(
        self,
        session_id=None,
        request_id=None,
        reason="unknown",
        finish_text="",
        success=None,
    ):
        rid = (request_id or "").strip()
        current_rid = (getattr(self._web_sync, 'request_id', '') or "").strip()
        if rid and current_rid and rid != current_rid:
            return
        cleared_via_page_command = False
        if hasattr(self, "clear_page_command_runtime"):
            self.clear_page_command_runtime(reason or "clear")
            cleared_via_page_command = True
        if not cleared_via_page_command:
            self._web_sync.running = False
            self._web_sync.request_id = ""
            self._web_sync.started_at = 0.0
            self._web_sync.timeout_timer_request_id = ""
        if rid:
            pending_map = getattr(self._web_sync, 'pending_requests', None)
            if isinstance(pending_map, dict):
                popped = pending_map.pop(rid, None)
                if isinstance(popped, dict):
                    message_id = (popped.get("message_id") or "").strip()
                    if message_id:
                        getattr(self._page_cmd, 'pending_sync_requests', {}).pop(message_id, None)
        self._clear_session_sync_running(session_id, rid or None, reason=reason)
        if finish_text is not None and success is not None:
            self._finish_sync_progress(
                session_id=session_id,
                request_id=rid or None,
                success=bool(success),
                text=finish_text,
            )

    def _clear_session_sync_running(self, session_id, request_id=None, reason="unknown"):
        key = self._get_session_sync_key(session_id)
        running = getattr(self, "_sync_inflight_by_session", {})
        if not key:
            return

        current = running.get(key)
        if not current:
            return

        if request_id:
            current_request_id = str(current.get("request_id") or "")
            if current_request_id and current_request_id != str(request_id):
                return

        running.pop(key, None)
        if not running:
            self._page_cmd.sync_conversation_running = False
        if hasattr(self, "safe_log"):
            self.safe_log(
                "[WEB_SYNC][RUNNING_CLEAR] "
                f"session_id={session_id or '-'} "
                f"request_id={request_id or '-'} "
                f"reason={reason or '-'}",
                echo=False,
            )
        if hasattr(self, "render_command_buttons"):
            self.render_command_buttons(reason="sync_clear")

    def _make_web_snapshot_signature(self, conversation_id, messages):
        parts = [str(conversation_id or "")]
        for msg in messages or []:
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role") or "")
            text = str(msg.get("text") or msg.get("content") or "")
            parts.append(role + ":" + str(len(text)) + ":" + text[:64])
        return "\n".join(parts)

    def _simple_sync_open_url(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        url = self._remote_conversation_url(remote)
        if not url and session is not None:
            url = self._session_openable_chatgpt_url(session)
        if not url:
            conv = self._remote_conversation_id(remote)
            if conv:
                url = f"https://chatgpt.com/c/{conv}"
        if not url:
            return False
        if hasattr(self, "_open_bound_page_for_session"):
            return self._open_bound_page_for_session(
                session,
                label="同步网页对话",
                fallback_live=True,
            )
        return self._open_or_queue_url(url, "同步网页对话")

    def _sync_dispatch_target_still_valid(
        self,
        *,
        expected_ctx=None,
        page=None,
        status=None,
        session=None,
    ):
        """轻量校验：online / client_id / page_instance_id / conversation_id。"""
        del status
        if not isinstance(expected_ctx, dict) or not isinstance(page, dict):
            return False, "invalid_context"
        exp_client = (expected_ctx.get("client_id") or "").strip()
        exp_instance = (expected_ctx.get("page_instance_id") or "").strip()
        exp_conv = (expected_ctx.get("conversation_id") or "").strip()
        got_client = (page.get("client_id") or "").strip()
        got_instance = (page.get("page_instance_id") or "").strip()
        got_conv = (page.get("conversation_id") or "").strip()
        if not is_page_online(page):
            return False, "target_offline"
        if exp_conv and got_conv and exp_conv != got_conv:
            return False, "conversation_mismatch"
        if exp_client and got_client and exp_client != got_client:
            return False, "client_id_mismatch"
        if exp_instance and got_instance and exp_instance != got_instance:
            self._append_log(
                "[SYNC][RETRY_REJECT_NEW_PAGE_INSTANCE] "
                f"expected_page_instance_id={exp_instance or '-'} "
                f"candidate_page_instance_id={got_instance or '-'} "
                f"conversation_id={got_conv or exp_conv or '-'}",
                echo=True,
            )
            return False, "page_instance_mismatch"
        return True, ""

    def _simple_sync_retry_after_open(
        self, session_id, attempts_left=20, expected_ctx=None
    ):
        session = self._sessions.get(session_id)
        if session is None:
            return
        if not isinstance(expected_ctx, dict) or not expected_ctx:
            self._append_log(
                "[SYNC][RETRY_REJECT_NEW_PAGE_INSTANCE] "
                f"session_id={session_id} reason=missing_expected_ctx",
                echo=True,
            )
            self._clear_session_sync_running(session_id, reason="missing_expected_ctx")
            return
        status = get_bridge_status()
        allowed, target_page, source, _block_reason, _sync_detail = (
            self.resolve_sync_decision(session, status=status)
        )
        if allowed and isinstance(target_page, dict) and expected_ctx:
            still_ok, stale_reason = self._sync_dispatch_target_still_valid(
                expected_ctx=expected_ctx,
                page=target_page,
                status=status,
                session=session,
            )
            if not still_ok:
                self._append_log(
                    "[SYNC][RETRY_STALE_TARGET] "
                    f"session_id={session_id} reason={stale_reason or 'expected_ctx_mismatch'} "
                    f"expected_client={(expected_ctx.get('client_id') or '-')} "
                    f"got_client={(target_page.get('client_id') or '-')} "
                    f"expected_instance={(expected_ctx.get('page_instance_id') or '-')} "
                    f"got_instance={(target_page.get('page_instance_id') or '-')}",
                    echo=True,
                )
                allowed = False
                target_page = None
        if allowed and isinstance(target_page, dict):
            self._clear_session_sync_running(session_id, reason="page_detected")
            ok, reason = self.request_sync_conversation(
                session,
                reason="manual_button_opened",
            )
            if ok:
                return
            if reason:
                self._log_sync_failed_after_clear(session_id, reason)
                self._finish_sync_progress(
                    session_id=session_id,
                    request_id="waiting_open_page",
                    success=False,
                    text=self._sync_failure_text_after_pre_clear(session_id, reason),
                )
            return
        if attempts_left <= 0:
            self._clear_session_sync_running(session_id, reason="wait_page_timeout")
            self._log_sync_failed_after_clear(session_id, "wait_page_timeout")
            self._finish_sync_progress(
                session_id=session_id,
                request_id="waiting_open_page",
                success=False,
                text=self._sync_failure_text_after_pre_clear(
                    session_id, "已打开网页，但未检测到可同步的对话页"
                ),
            )
            return
        QTimer.singleShot(
            1500,
            lambda sid=session_id, left=attempts_left - 1, ctx=expected_ctx: self._simple_sync_retry_after_open(
                sid,
                left,
                expected_ctx=ctx,
            ),
        )

    def _sync_state_float(self, mapping, field, default=None, *, context=""):
        del context
        from app.utils.safe_parse import safe_float_field

        if default is None:
            default = time.time()
        return safe_float_field(mapping, field, default)

    def _sync_bound_web_conversation(self, _checked=False):
        session = self._current_session()
        if session is None:
            self._append_log(
                "[SYNC_BUTTON][CLICK_BLOCKED] reason=no_current_session",
                echo=True,
            )
            self._set_tm_action_hint("当前没有选中的对话。")
            return

        session_id = session.session_id
        self._append_log(
            "[SYNC_BUTTON][CLICK] "
            f"session_id={session_id} "
            f"current_session_id={getattr(self, '_current_session_id', '-')}",
            echo=True,
        )

        now = time.time()
        last_click_map = getattr(self, "_last_sync_click_at_by_session", None)
        if last_click_map is None:
            last_click_map = {}
            self._last_sync_click_at_by_session = last_click_map

        last_click = self._sync_state_float(
            last_click_map,
            session_id,
            0.0,
            context="_sync_bound_web_conversation.last_click",
        )

        if now - last_click < 1.0:
            self._append_log(
                "[SYNC][SKIP_DUPLICATE_CLICK] "
                f"reason=debounce session_id={session_id}",
                echo=True,
            )
            return

        last_click_map[session_id] = now

        if self._is_session_sync_running(session_id):
            self._append_log(
                "[SYNC][SKIP_DUPLICATE] "
                f"session_id={session_id} reason=inflight",
                echo=True,
            )
            self._set_tm_action_hint("当前会话正在同步中，请等待完成。")
            return

        btn = getattr(self, "sync_web_conversation_btn", None)
        if btn is not None:
            btn.setEnabled(False)

        self._set_tm_action_hint("正在同步网页对话…")

        try:
            ok, msg = self.request_sync_conversation(
                session,
                reason="manual_button",
                allow_open_url=False,
            )
        except Exception as exc:
            error_text = traceback.format_exc()
            self._append_log(
                "[SYNC_BUTTON][EXCEPTION] "
                f"session_id={session_id} "
                f"error={exc} traceback={error_text}",
                echo=True,
                level="ERROR",
            )
            if btn is not None:
                btn.setEnabled(True)
            self._set_tm_action_hint(f"同步异常：{exc}")
            raise

        self._append_log(
            "[SYNC_BUTTON][RESULT] "
            f"session_id={session_id} ok={ok} msg={msg or '-'}",
            echo=True,
        )

        if not ok:
            if btn is not None:
                btn.setEnabled(True)
            self._set_tm_action_hint(msg or "同步请求未发出。")

    # --- round-2: snapshot merge helpers (moved from page_bind_mixin) ---
    def _message_fingerprint(self, role, text):
        normalized_text = self._normalize_synced_message_text(text)
        normalized = " ".join(normalized_text.split())
        digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
        return f"{role}:{digest}"
    def _normalize_synced_message_text(self, text):
        value = str(text or "")
        value = value.replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
        value = value.strip()
        if not value:
            return ""

        value = re.sub(
            r"^(你说|您说|ChatGPT\s*说|You said|ChatGPT said|Assistant said)\s*[:：]\s*",
            "",
            value,
            flags=re.IGNORECASE,
        )
        drop_lines = {
            "复制",
            "编辑",
            "重试",
            "分享",
            "赞",
            "踩",
            "展开",
            "收起",
            "展开收起",
        }
        lines = []
        for line in value.split("\n"):
            line = line.strip()
            if not line:
                continue
            if line in drop_lines:
                continue
            lines.append(line)
        value = "\n".join(lines)
        value = re.sub(r"\s*(展开收起|展开|收起)\s*$", "", value)
        value = re.sub(r"[ \t]{2,}", " ", value)
        value = re.sub(r"\n{3,}", "\n\n", value)
        return value.strip()
    def _is_protected_local_message(self, message):
        from app.models import is_waiting_placeholder_message

        if message.role == "system":
            return True
        if message.role == "error":
            return True
        if message.role != "assistant":
            return False
        if is_waiting_placeholder_message(message):
            return True
        status = (message.ui_status or "").strip()
        if status in ("发送失败", "读取失败", "空回复") or "失败" in status:
            return True
        return False
    def _refresh_local_conversation_after_sync(
        self, session_id, *, force_bottom=True, reason="sync"
    ):
        session_id = (session_id or "").strip()
        if not session_id:
            self._append_log(
                "[SYNC][LOCAL_REFRESH][FAILED] reason=missing_session_id",
                echo=True,
            )
            return False
        session = self._sessions.get(session_id)
        if session is None:
            self._append_log(
                f"[SYNC][LOCAL_REFRESH][FAILED] reason=session_not_found "
                f"session_id={session_id}",
                echo=True,
            )
            return False

        is_current = session.session_id == self._current_session_id
        if is_current:
            if hasattr(self, "_render_current_chat_messages"):
                self._render_current_chat_messages(
                    force_bottom=force_bottom,
                    reason=reason or "sync_refresh",
                )
            else:
                self._render_session_chat(session, force_bottom=force_bottom)
            self._update_current_session_title(session)

        self._refresh_session_list(select_session_id=session.session_id)
        self._apply_chat_bind_visual_state()
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason=reason or "sync_local_refresh")
        self._append_log(
            "[SYNC][LOCAL_REFRESH][DONE] "
            f"session_id={session.session_id} "
            f"current={is_current} "
            f"message_count={len(session.messages)} "
            f"force_bottom={force_bottom} "
            f"reason={reason}",
            echo=True,
        )
        return True

    def _clear_pending_wait_messages_after_web_sync(self, session, normalized_web):
        if session is None:
            return 0

        if not normalized_web:
            return 0

        last_role = (normalized_web[-1].get("role") or "").strip()
        if last_role != "assistant":
            return 0

        kept = []
        removed = 0

        from app.models import is_waiting_placeholder_message

        for message in session.messages:
            if is_waiting_placeholder_message(message):
                removed += 1
                continue

            role = (message.role or "").strip()
            status = (message.ui_status or "").strip()
            if role == "user" and status in PENDING_ASSISTANT_STATUSES:
                message.ui_status = "已同步"

            kept.append(message)

        if removed:
            session.messages = kept

        session.has_pending_reply = False
        session.pending_reply_since = 0
        if hasattr(self, "_mark_session_waiting_finished"):
            self._mark_session_waiting_finished(
                session, reason="web_sync_cleared_pending"
            )
        session.updated_at = time.time()

        self._append_log(
            "[SYNC_CONVERSATION][CLEAR_PENDING] "
            f"session_id={session.session_id} "
            f"removed={removed} "
            f"last_web_role={last_role}",
            echo=True,
        )

        return removed

    def merge_conversation_snapshot(
        self, session_id, web_messages, *, mode="replace", source="manual"
    ):
        """收到 snapshot 后以网页消息完全覆盖本地会话（replace）。"""
        return self._sync_session_messages_from_web_snapshot(
            session_id,
            web_messages,
            mode=mode,
            source=source,
        )

    def _sync_session_messages_from_web_snapshot(
        self, session_id, web_messages, mode="replace", source="manual"
    ):
        session = self._sessions.get(session_id)
        if session is None:
            self._append_log(
                f"[SYNC_CONVERSATION][FAILED] reason=session_not_found "
                f"session_id={session_id}",
                echo=True,
            )
            return False, "未找到对话"

        mode = "replace"

        web_messages = list(web_messages or [])
        normalized_web = []
        for item in web_messages:
            if not isinstance(item, dict):
                continue
            role = (item.get("role") or "").strip().lower()
            if role not in ("user", "assistant", "system", "tool"):
                continue
            if role in ("system", "tool"):
                role = "assistant"
            raw_text = item.get("text") or item.get("content") or ""
            text = self._normalize_synced_message_text(raw_text)
            if not text:
                continue
            normalized_web.append({"role": role, "text": text})

        if not normalized_web:
            local_has_reset_errors = self._session_has_reset_placeholder_errors(session)

            if local_has_reset_errors:
                old_count = len(session.messages or [])
                session.messages = [
                    message
                    for message in session.messages
                    if not is_reset_placeholder_error_message(message)
                ]
                session.updated_at = time.time()
                self._schedule_save_sessions_to_disk()
                self._refresh_local_conversation_after_sync(
                    session.session_id,
                    force_bottom=True,
                    reason="empty_web_snapshot_removed_reset_errors",
                )
                self._append_log(
                    "[SYNC_CONVERSATION][EMPTY_WEB_REMOVED_RESET_ERRORS] "
                    f"session_id={session.session_id} "
                    f"old_count={old_count} "
                    f"new_count={len(session.messages)}",
                    echo=True,
                )
                return True, "网页暂无有效消息，已清理本地恢复错误占位"

            if not (session.messages or []):
                session.updated_at = time.time()
                self._schedule_save_sessions_to_disk()
                self._refresh_local_conversation_after_sync(
                    session.session_id,
                    force_bottom=True,
                    reason="empty_web_snapshot_after_clear",
                )
                self._append_log(
                    "[SYNC_CONVERSATION][EMPTY_AFTER_CLEAR] "
                    f"session_id={session.session_id}",
                    echo=True,
                )
                return True, "同步完成（网页暂无有效消息，本地保持为空）"

            self._append_log(
                f"[SYNC_CONVERSATION][FAILED] reason=empty_web_snapshot "
                f"session_id={session.session_id}",
                echo=True,
            )
            return False, "网页端没有导出到有效聊天消息"

        added = 0
        skipped = 0

        old_count = len(session.messages)
        new_messages = []
        for item in normalized_web:
            role = item["role"]
            text = item["text"]
            new_messages.append(
                ChatMessage(
                    role=role,
                    content=text,
                    created_at=time.time(),
                    message_id=str(uuid.uuid4()),
                    ui_status="done",
                    message_source="web_sync",
                    visible_in_chat=True,
                )
            )

        session.messages = new_messages
        added = len(new_messages)
        self._append_log(
            "[SYNC_CONVERSATION][REPLACE_LOCAL_WITH_WEB] "
            f"session_id={session.session_id} "
            f"old_count={old_count} "
            f"web_count={len(normalized_web)} "
            f"new_count={len(new_messages)} "
            f"skipped={skipped} "
            f"source={source}",
            echo=True,
        )

        self._auto_rename_session_from_messages(session)

        cleared_pending = self._clear_pending_wait_messages_after_web_sync(
            session,
            normalized_web,
        )

        summary = (
            f"同步完成：网页 {len(normalized_web)} 条，新增 {added} 条，"
            f"跳过 {skipped} 条，本地 {len(session.messages)} 条"
        )
        self._set_tm_action_hint(summary)
        self._append_log(
            "[SYNC_CONVERSATION][SUMMARY] "
            f"session_id={session.session_id} "
            f"mode={mode} "
            f"web_count={len(normalized_web)} "
            f"local_count={len(session.messages)} "
            f"added={added} "
            f"skipped={skipped} "
            f"cleared_pending={cleared_pending}",
            echo=True,
        )
        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()
        self._refresh_local_conversation_after_sync(
            session.session_id,
            force_bottom=True,
            reason="snapshot_replaced",
        )

        self._append_log(
            "[SYNC_CONVERSATION][APPLIED] "
            f"session_id={session.session_id} mode={mode} "
            f"total_web={len(normalized_web)} local_count={len(session.messages)} "
            f"added={added} skipped={skipped} "
            f"source={source}",
            echo=True,
        )
        self._append_log(
            "[SYNC_CONVERSATION][DONE] "
            f"session_id={session.session_id} "
            f"added={added} skipped={skipped} total_web={len(normalized_web)} "
            f"cleared_pending={cleared_pending}",
            echo=True,
        )
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
        return True, summary


    def _check_web_sync_timeout(self, request_id):
        request_id = (request_id or "").strip()
        if not request_id:
            return
        pending = getattr(self._web_sync, 'pending_requests', {}).get(request_id)
        if not pending:
            return
        if pending.get("timeout_phase") == "slow_waiting":
            return
        retry_done = getattr(self._web_sync, 'timeout_retry_done', None)
        if retry_done is None:
            retry_done = set()
            self._web_sync.timeout_retry_done = retry_done
        old_client_id = (pending.get("client_id") or "").strip()
        conversation_id = (pending.get("conversation_id") or "").strip()
        session_id = (pending.get("session_id") or "").strip()
        session = self._get_session_by_id(session_id) if session_id else None

        if request_id not in retry_done and session is not None and conversation_id:
            retry_done.add(request_id)
            self._append_log(
                "[WEB_SYNC][TIMEOUT_RETRY] "
                f"request_id={request_id} "
                f"client_id={old_client_id or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"reason=retry_same_binding_no_relink",
                echo=True,
            )
            request_reason = (pending.get("request_reason") or "manual_button").strip()
            self._web_sync.pending_requests.pop(request_id, None)
            message_id = (pending.get("message_id") or "").strip()
            if message_id:
                getattr(self._page_cmd, 'pending_sync_requests', {}).pop(message_id, None)
            self._clear_session_sync_running(
                session_id, request_id, reason="timeout_retry"
            )
            self.request_sync_conversation(
                session,
                reason=request_reason,
                delay_ms=300,
            )
            return

        pending["timeout_phase"] = "slow_waiting"
        pending["slow_wait_at"] = time.time()
        sync_state = getattr(self, "_sync_progress_state", {}) or {}
        if sync_state.get("request_id") == request_id:
            sync_state["slow_waiting"] = True
            sync_state["running"] = True
            self._sync_progress_state = sync_state
        self._append_log(
            "[WEB_SYNC][SLOW_WAIT] "
            f"request_id={request_id} "
            f"client_id={old_client_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"elapsed_sec=20",
            echo=True,
        )
        self._update_sync_progress(
            session_id=session_id,
            request_id=request_id,
            text="网页响应较慢，继续等待返回对话快照",
        )
        self._schedule_sync_timeout(request_id, phase="hard", delay_ms=40000)

    def _check_web_sync_hard_timeout(self, request_id):
        request_id = (request_id or "").strip()
        if not request_id:
            return
        pending = getattr(self._web_sync, 'pending_requests', {}).get(request_id)
        if not pending:
            return
        old_client_id = (pending.get("client_id") or "").strip()
        conversation_id = (pending.get("conversation_id") or "").strip()
        session_id = (pending.get("session_id") or "").strip()
        started_at = self._sync_state_float(
            pending,
            "started_at",
            time.time(),
            context="_check_web_sync_hard_timeout",
        )
        elapsed_sec = max(0, int(time.time() - started_at))

        self._web_sync.pending_requests.pop(request_id, None)
        message_id = (pending.get("message_id") or "").strip()
        if message_id:
            getattr(self._page_cmd, 'pending_sync_requests', {}).pop(message_id, None)
        hard_timed_out = getattr(self._web_sync, 'hard_timed_out_request_ids', None)
        if hard_timed_out is None:
            hard_timed_out = set()
            self._web_sync.hard_timed_out_request_ids = hard_timed_out
        hard_timed_out.add(request_id)
        finish_text = self._sync_timeout_finish_text(
            (pending.get("message_id") or "").strip(), pending
        )
        msg_state = get_message_state((pending.get("message_id") or "").strip())
        timeout_reason = "target_page_did_not_claim_control_command"
        if isinstance(msg_state, dict):
            st = (msg_state.get("message_status") or "").strip()
            if msg_state.get("delivered_at") or msg_state.get("delivered_to"):
                timeout_reason = (
                    "acked_no_snapshot" if st == "acked" else "delivered_no_ack_or_snapshot"
                )
            elif st == "acked":
                timeout_reason = "acked_no_snapshot"
        self._append_log(
            "[WEB_SYNC][HARD_TIMEOUT] "
            f"request_id={request_id} "
            f"client_id={old_client_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"elapsed_sec={elapsed_sec} "
            f"reason={timeout_reason} "
            f"message_id={(pending.get('message_id') or '-')[:8]} "
            f"hint={finish_text}",
            echo=True,
        )
        self._clear_web_sync_running(
            session_id=session_id,
            request_id=request_id,
            reason="sync_timeout",
            finish_text=self._sync_failure_text_after_pre_clear(
                session_id,
                finish_text,
            ),
            success=False,
        )
        self._log_sync_failed_after_clear(session_id, "hard_timeout")


    def _schedule_auto_sync_conversation(self, session, request_reason="auto"):
        delay = 800 if request_reason == "auto_after_reply" else 0
        self.request_sync_conversation(
            session, reason=request_reason, delay_ms=delay
        )

    def _get_session_sync_key(self, session_id):
        return str(session_id or "").strip()

    def _start_sync_progress(self, session_id, request_id, text):
        session_id = (session_id or "").strip()
        request_id = (request_id or "").strip()
        self._sync_progress_state = {
            "session_id": session_id,
            "request_id": request_id,
            "started_at": time.time(),
            "running": True,
            "slow_waiting": False,
            "finished_success": None,
            "text": text or "正在同步网页对话...",
        }
        panel = getattr(self, "sync_progress_panel", None)
        label = getattr(self, "sync_progress_label", None)
        bar = getattr(self, "sync_progress_bar", None)
        btn = getattr(self, "sync_web_conversation_btn", None)
        if panel is not None:
            panel.setVisible(True)
        if label is not None:
            label.setText(text or "正在同步网页对话...")
        if bar is not None:
            bar.setRange(0, 0)
            bar.setVisible(True)
        if btn is not None and session_id == (self._current_session_id or ""):
            btn.setEnabled(False)
            btn.setText("同步中...")
        if hasattr(self, "tm_sync_target_label"):
            self.tm_sync_target_label.setText("同步：进行中")
            self.tm_sync_target_label.setProperty("state", "info")
            self.tm_sync_target_label.style().unpolish(self.tm_sync_target_label)
            self.tm_sync_target_label.style().polish(self.tm_sync_target_label)
        self._set_tm_action_hint(text or "正在同步网页对话...")
        self._schedule_sync_progress_tick(request_id)

    def _update_sync_progress(self, session_id=None, request_id=None, text=""):
        state = getattr(self, "_sync_progress_state", {}) or {}
        if not state.get("running") and not state.get("slow_waiting"):
            return
        if session_id and state.get("session_id") and session_id != state.get("session_id"):
            return
        if request_id and state.get("request_id") and request_id != state.get("request_id"):
            return
        if text:
            state["text"] = text
            self._sync_progress_state = state
        started_at = self._sync_state_float(
            state,
            "started_at",
            time.time(),
            context="_update_sync_progress",
        )
        elapsed = max(0, int(time.time() - started_at))
        base_text = state.get("text") or "正在同步网页对话..."
        label = getattr(self, "sync_progress_label", None)
        if label is not None:
            label.setText(f"{base_text}，已等待 {elapsed} 秒")
        if text:
            self._set_tm_action_hint(text)

    def _finish_sync_progress(
        self, session_id=None, request_id=None, success=True, text=""
    ):
        state = getattr(self, "_sync_progress_state", {}) or {}
        rid = (request_id or "").strip()
        sid = (session_id or "").strip()
        if sid and state.get("session_id") and sid != state.get("session_id"):
            return
        if rid and state.get("request_id") and rid != state.get("request_id"):
            return
        if not success and not state.get("running"):
            if rid and rid == state.get("request_id"):
                return
        if not success and state.get("finished_success") is True:
            if not rid or rid == state.get("request_id"):
                return
        state["running"] = False
        state["slow_waiting"] = False
        if success:
            state["finished_success"] = True
        elif state.get("finished_success") is not True:
            state["finished_success"] = False
        self._sync_progress_state = state
        panel = getattr(self, "sync_progress_panel", None)
        label = getattr(self, "sync_progress_label", None)
        bar = getattr(self, "sync_progress_bar", None)
        btn = getattr(self, "sync_web_conversation_btn", None)
        final_text = text or ("同步完成" if success else "同步失败")
        if panel is not None:
            panel.setVisible(True)
        if label is not None:
            label.setText(final_text)
        if bar is not None:
            bar.setRange(0, 1)
            bar.setValue(1 if success else 0)
        if btn is not None and (
            not session_id or session_id == (self._current_session_id or "")
        ):
            btn.setEnabled(True)
            btn.setText("同步网页对话")
        if hasattr(self, "tm_sync_target_label"):
            self.tm_sync_target_label.setText(
                "同步：可同步" if success else "同步：失败"
            )
            self.tm_sync_target_label.setProperty("state", "ok" if success else "error")
            self.tm_sync_target_label.style().unpolish(self.tm_sync_target_label)
            self.tm_sync_target_label.style().polish(self.tm_sync_target_label)
        self._set_tm_action_hint(final_text)
        hide_request_id = state.get("request_id") or request_id or ""
        QTimer.singleShot(
            1500,
            lambda rid=hide_request_id: self._hide_sync_progress_if_finished(rid),
        )

    def _hide_sync_progress_if_finished(self, request_id=""):
        state = getattr(self, "_sync_progress_state", {}) or {}
        if state.get("running"):
            return
        if request_id and state.get("request_id") and request_id != state.get("request_id"):
            return
        panel = getattr(self, "sync_progress_panel", None)
        if panel is not None:
            panel.setVisible(False)

    def _schedule_sync_progress_tick(self, request_id=""):
        QTimer.singleShot(
            500,
            lambda rid=request_id: self._sync_progress_tick(rid),
        )

    def _sync_progress_tick(self, request_id=""):
        state = getattr(self, "_sync_progress_state", {}) or {}
        if not state.get("running") and not state.get("slow_waiting"):
            return
        if request_id and state.get("request_id") and request_id != state.get("request_id"):
            return
        self._update_sync_progress(
            session_id=state.get("session_id") or "",
            request_id=state.get("request_id") or "",
            text="",
        )
        self._schedule_sync_progress_tick(state.get("request_id") or "")

    def _mark_session_sync_running(self, session_id, request_id):
        key = self._get_session_sync_key(session_id)
        if not key:
            return
        running = getattr(self, "_sync_inflight_by_session", None)
        if running is None:
            running = {}
            self._sync_inflight_by_session = running
        running[key] = {
            "request_id": str(request_id or ""),
            "started_at": time.time(),
        }
        self._page_cmd.sync_conversation_running = True



    def _session_bound_client_id(self):
        from app.utils.page_binding_identity import session_bound_client_id

        return session_bound_client_id(self._current_session())