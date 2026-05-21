"""同步网页对话、快照回收与 sync 决策。"""

import hashlib
import re
import time
import traceback
import uuid

import server

from app.constants import ASSISTANT_WAIT_TEXTS, PENDING_ASSISTANT_STATUSES
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    ChatMessage,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import (
    explain_page_decision,
    is_page_syncable,
    log_page_decision_fields,
    page_url_from,
)
from app.utils.trace_log import kv_line, make_sync_trace_id
from PyQt5.QtCore import QTimer




class PageSyncMixin:
    def _sync_target_snapshot(self, status=None, bound_info=None, current_info=None):
        status = status or self._last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bound_client_id = (remote.get("client_id") or "").strip()
        bound_conversation_id = self._remote_conversation_id(remote)
        bind_state = self._remote_bind_state(remote)
        is_prebound_home = bind_state in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        )
        if bound_info is None and bound_client_id:
            bound_info = self._client_info_by_id(bound_client_id, status=status)
        current_info = (
            current_info
            if current_info is not None
            else self._pick_current_page_client_info(status)
        )
        active_client_id = (status.get("active_client_id") or "").strip()
        active_matches_bound = bool(
            active_client_id and bound_client_id and active_client_id == bound_client_id
        )

        def _bound_target_from_remote(reason_suffix="bound_session"):
            page_url = (
                (remote.get("conversation_url") or remote.get("url") or "").strip()
            )
            if not page_url and is_prebound_home:
                page_url = "https://chatgpt.com/"
            conv = bound_conversation_id
            if conv in ("", "-"):
                conv = ""
            return {
                "syncable": False,
                "source": "bound_page",
                "source_label": "已绑定页",
                "short_label": self._short_page_label(
                    bound_info
                    if isinstance(bound_info, dict)
                    else {
                        "client_id": bound_client_id,
                        "conversation_id": conv,
                        "page_url": page_url,
                    }
                ),
                "client_id": bound_client_id,
                "conversation_id": conv,
                "page_url": page_url,
                "page_type": (remote.get("page_type") or "").strip(),
                "reason": reason_suffix,
                "active_matches_bound": active_matches_bound,
            }

        if remote.get("enabled") and bound_client_id:
            expected_conv = bound_conversation_id
            if expected_conv in ("", "-"):
                expected_conv = ""
            sync_item = None
            sync_source = "bound_page"
            if isinstance(bound_info, dict) and self._tm_page_is_online_simple(bound_info):
                sync_item = bound_info
                sync_source = "bound_client"
            if sync_item is None and expected_conv:
                fallback = self._find_online_page_by_conversation_id(
                    expected_conv, status=status
                )
                if isinstance(fallback, dict):
                    sync_item = fallback
                    sync_source = "conversation_relink"
            if isinstance(sync_item, dict):
                profile = self._tm_client_sync_profile(
                    sync_item,
                    expected_conversation_id=expected_conv,
                )
                online = self._tm_page_is_online_simple(sync_item)
                dialog_ready = self._is_dialog_ready_page(sync_item)
                prebound_home = self._is_prebound_home_page(sync_item)
                syncable = dialog_ready
                sync_readable = dialog_ready
                return {
                    "syncable": syncable,
                    "sync_readable": sync_readable,
                    "dialog_ready": dialog_ready,
                    "prebound_home": prebound_home,
                    "sendable": bool(profile.get("sendable")),
                    "input_ok": bool(profile.get("input_ok")),
                    "responding": bool(profile.get("responding")),
                    "online": online,
                    "source": sync_source,
                    "source_label": (
                        "已绑定页"
                        if sync_source == "bound_client"
                        else "同对话在线页"
                    ),
                    "short_label": self._short_page_label(sync_item),
                    "client_id": (sync_item.get("client_id") or bound_client_id).strip(),
                    "conversation_id": (
                        self._client_conversation_id(sync_item) or expected_conv
                    ),
                    "page_url": (
                        sync_item.get("page_url") or sync_item.get("url") or ""
                    ).strip(),
                    "page_type": (sync_item.get("page_type") or "").strip(),
                    "reason": (
                        "bound_page_online"
                        if sync_source == "bound_client"
                        else "conversation_relink_online"
                    ),
                    "active_matches_bound": active_matches_bound,
                }
            return _bound_target_from_remote("bound_page_offline")

        if isinstance(bound_info, dict):
            return _bound_target_from_remote("bound_page_not_syncable")

        if isinstance(current_info, dict) and not remote.get("enabled"):
            profile = self._tm_client_sync_profile(current_info)
            online = self._tm_page_is_online_simple(current_info)
            dialog_ready = self._is_dialog_ready_page(current_info)
            prebound_home = self._is_prebound_home_page(current_info)
            sync_readable = dialog_ready and not prebound_home
            return {
                "syncable": sync_readable,
                "sync_readable": sync_readable,
                "dialog_ready": dialog_ready,
                "prebound_home": prebound_home,
                "sendable": bool(profile.get("sendable")),
                "input_ok": bool(profile.get("input_ok")),
                "responding": bool(profile.get("responding")),
                "online": online,
                "source": "manual_current_page",
                "source_label": "手动选中页",
                "short_label": self._short_page_label(current_info),
                "client_id": (current_info.get("client_id") or "").strip(),
                "conversation_id": self._client_conversation_id(current_info),
                "page_url": (
                    current_info.get("page_url") or current_info.get("url") or ""
                ).strip(),
                "page_type": (current_info.get("page_type") or "").strip(),
                "reason": (
                    "unbound_manual_prebound_home"
                    if prebound_home
                    else "unbound_manual_current_page"
                ),
                "active_matches_bound": active_matches_bound,
            }
        return {
            "syncable": False,
            "source": "none",
            "source_label": "不可用",
            "short_label": "不可用",
            "client_id": "",
            "conversation_id": "",
            "page_url": "",
            "page_type": "",
            "reason": "no_syncable_target",
            "active_matches_bound": active_matches_bound,
        }

    def _format_sync_target_status_text(self, target, profile=None):
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
        dialog_ready = bool(
            target.get("dialog_ready")
            if target.get("dialog_ready") is not None
            else (profile or {}).get("dialog_ready")
        )
        if prebound_home and online:
            return "已绑定首页｜等待进入对话｜不可同步对话"
        if not online:
            reason = (target.get("reason") or (profile or {}).get("reason") or "").strip()
            if reason in ("bound_page_offline", "offline", "no_online_page"):
                return "同步：不可同步（离线）"
            return "同步：不可同步"
        if online and not dialog_ready:
            return "已绑定在线｜等待进入对话页｜不可同步对话"
        queue_size = 0
        if hasattr(self, "_current_session_queue_size"):
            queue_size = int(self._current_session_queue_size() or 0)
        sendable = bool(
            target.get("sendable")
            if target.get("sendable") is not None
            else (profile or {}).get("sendable")
        )
        if sendable:
            return "同步：可同步｜发送：可发送"
        if queue_size > 0:
            return "同步：可同步｜发送：等待队列"
        responding = bool(
            target.get("responding")
            if target.get("responding") is not None
            else (profile or {}).get("responding")
        )
        if responding:
            return "同步：可同步｜发送：等待队列"
        return "同步：可同步｜发送：不可发送"

    def _update_sync_target_display(self):
        if not hasattr(self, "tm_sync_target_label"):
            return
        status = self._last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if not remote.get("enabled"):
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
        bound_info, _bound_state, _bound_reason = self._resolve_bound_page_info(status=status)
        target = self._sync_target_snapshot(status=status, bound_info=bound_info, current_info=current_info)
        sync_readable = bool(target.get("sync_readable") or target.get("syncable"))
        target_profile = None
        target_client_id = (target.get("client_id") or "").strip()
        if target_client_id:
            target_page = self._client_info_by_id(target_client_id, status=status)
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
                    target.get("sync_readable")
                    or target.get("syncable")
                    or self._is_dialog_ready_page(target_page)
                )
        text = self._format_sync_target_status_text(target, target_profile)
        self.tm_sync_target_label.setText(text)
        if sync_readable:
            self._set_tm_action_hint("目标对话页在线，可同步网页对话。")
        elif bool(target.get("prebound_home")):
            if remote.get("enabled"):
                self._set_tm_action_hint(
                    "当前绑定的是首页预绑定页，请打开或新建 ChatGPT 对话后再同步。"
                )
            else:
                self._set_tm_action_hint(
                    "已选中首页页，可预绑定；进入具体对话页后才可同步对话内容。"
                )
        self._refresh_status_chip(
            self.tm_sync_target_label,
            "ok" if sync_readable else ("warn" if bool(target.get("prebound_home")) else "error"),
        )
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
                "page_url": (target.get("page_url") or "").strip(),
                "page_type": (target.get("page_type") or "").strip(),
            }
            if isinstance(bound_info, dict) and target_client_id == (
                bound_info.get("client_id") or ""
            ).strip():
                target_page["page_instance_id"] = (
                    bound_info.get("page_instance_id") or ""
                ).strip()
            elif remote.get("enabled") and target_client_id == (
                remote.get("client_id") or ""
            ).strip():
                target_page["page_instance_id"] = (
                    remote.get("page_instance_id") or ""
                ).strip()
        target_info = target_page
        target_url = self._page_full_url(target_info) if any(
            (target_info.get(k) or "").strip()
            for k in ("client_id", "conversation_id", "page_url")
        ) else ""
        self.tm_sync_target_label.setToolTip(target_url or "不可用")
        sync_status_label = getattr(self, "sync_target_status_label", None)
        target_reason = (target.get("reason") or "").strip()
        target_instance_unknown = bool(
            target_client_id
            and not (target_page.get("page_instance_id") or "").strip()
            and target_reason in ("bound_page_offline", "bound_page_not_syncable")
        )
        if sync_status_label is not None:
            status_parts = [
                self._page_identity_text(
                    target_page, instance_unknown=target_instance_unknown
                ),
                f"同步状态：{'可读取' if sync_readable else '不可用'}",
            ]
            if target_profile:
                status_parts.append(
                    f"发送状态：{'可用' if target_profile.get('sendable') else '不可用'}"
                )
                status_parts.append(
                    f"可输入：{'是' if target_profile.get('input_ok') else '否'}"
                )
                status_parts.append(
                    f"正在生成：{'是' if target_profile.get('responding') else '否'}"
                )
            if not sync_readable:
                status_parts.append(
                    f"不可用原因：{self._sync_target_unavailable_reason_text(target_reason)}"
                )
            sync_status_label.setText("\n".join(status_parts))
        self._set_page_url_edit(
            getattr(self, "sync_target_url_edit", None),
            target_url,
            empty_text="不可用",
        )
        current_url = self._page_full_url(current_info) or "-"
        focused_url = self._page_full_url(focused_info) if isinstance(
            focused_info, dict
        ) else "-"
        bound_url_session = self._page_full_url(bound_info) if isinstance(
            bound_info, dict
        ) else (
            (remote.get("conversation_url") or remote.get("url") or "").strip() or "-"
        )
        if bound_url_session in ("", "-") and remote.get("enabled"):
            bound_url_session = (
                (remote.get("conversation_url") or remote.get("url") or "").strip()
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
            if target_profile and target_profile.get("sendable")
            else ("no" if target_profile else "-")
        )
        target_source = (target.get("source") or "none").strip()
        bound_from_session = (remote.get("client_id") or "").strip() or "-"
        target_client = (target.get("client_id") or "-").strip() or "-"
        if isinstance(focused_info, dict):
            focused_visible = str(
                focused_info.get("visible")
                or focused_info.get("visibility_state")
                or "unknown"
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
        elif remote.get("enabled"):
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
            self._last_page_relation_key = relation_key
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
                    f"syncable={syncable_log}",
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
        if not remote.get("enabled"):
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
            page_url = (payload.get("page_url") or "").strip()
            if page_url:
                remote["conversation_url"] = page_url
                remote["url"] = page_url
            remote["bind_state"] = BIND_STATE_BOUND_CONVERSATION
            remote["page_type"] = "conversation"
            session.remote_chatgpt = remote
            self._save_sessions_to_disk()

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
            "page_url",
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
            conv = parse_conversation_id(payload.get("page_url") or "")
            if conv:
                payload["conversation_id"] = conv
        return payload

    def _handle_conversation_snapshot_inbound(self, item):
        payload = item.get("payload") or {}
        message_id = (item.get("message_id") or "").strip()
        request_id = (payload.get("request_id") or "").strip()
        pending_sync = {}
        if message_id:
            pending_sync = dict(
                getattr(self, "_pending_sync_requests", {}).pop(message_id, {}) or {}
            )
        if not request_id:
            request_id = (pending_sync.get("request_id") or "").strip()
        web_pending = {}
        if request_id:
            web_pending = dict(
                getattr(self, "_pending_web_sync_requests", {}).pop(request_id, {}) or {}
            )
        if not pending_sync and web_pending:
            pending_sync = web_pending
        payload = self._normalize_conversation_snapshot_payload(
            payload, item=item, pending_sync=pending_sync
        )
        btn = getattr(self, "sync_web_conversation_btn", None)
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
            if btn is not None:
                btn.setEnabled(True)
            self._set_tm_action_hint("同步网页对话失败：缺少 session_id。")
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
            if btn is not None:
                btn.setEnabled(True)
            self._set_tm_action_hint("同步网页对话失败：未找到对应对话。")
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
            if btn is not None:
                btn.setEnabled(True)
            if session.session_id == self._current_session_id:
                self._set_tm_action_hint(f"同步失败：{reason}")
            return

        mode = (payload.get("mode") or self._sync_conversation_mode or "merge").strip()
        count = len(web_messages)
        if count <= 0:
            self._append_log(
                "[WEB_SYNC][SNAPSHOT_EMPTY_SKIP] "
                f"reason=empty_snapshot_keep_local_messages "
                f"request_id={request_id or '-'} "
                f"session_id={session_id or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"local_message_count={len(session.messages)}",
                echo=True,
            )
            self._clear_session_sync_running(
                session_id, request_id, reason="empty_snapshot_keep_local"
            )
            if btn is not None:
                btn.setEnabled(True)
            if session.session_id == self._current_session_id:
                self._set_tm_action_hint("同步完成（网页快照为空，已保留本地消息）")
            return

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        sig_conv = conversation_id if conversation_id != "-" else self._remote_conversation_id(remote)
        sig = self._make_web_snapshot_signature(sig_conv, web_messages)
        last_sig_map = getattr(self, "_last_applied_snapshot_sig_by_session", None)
        if last_sig_map is None:
            last_sig_map = {}
            self._last_applied_snapshot_sig_by_session = last_sig_map
        old_sig = last_sig_map.get(session_id)
        if sig == old_sig:
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
            if btn is not None:
                btn.setEnabled(True)
            if session.session_id == self._current_session_id:
                self._set_tm_action_hint("同步完成（网页内容无变化）")
                if hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="snapshot_unchanged_refresh",
                    )
            return
        status = self._last_bridge_status or {}
        current_client_id = (status.get("tampermonkey_client_id") or "").strip()
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
        applied_ok, apply_reason = self._sync_session_messages_from_web_snapshot(
            session_id,
            web_messages,
            mode=mode,
            source="web_snapshot",
        )
        if applied_ok and session.session_id == self._current_session_id and hasattr(
            self, "_render_current_chat_messages"
        ):
            self._render_current_chat_messages(
                force_bottom=True,
                reason="conversation_snapshot_inbound",
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
            if btn is not None:
                btn.setEnabled(True)
            if session.session_id == self._current_session_id:
                self._set_tm_action_hint(f"同步失败：{apply_reason}")
            return
        self._clear_session_sync_running(session_id, request_id, reason="done")
        if btn is not None:
            btn.setEnabled(True)

    def _enqueue_sync_conversation_command(
        self, session, request_reason="manual_button", delay_ms=0
    ):
        if not getattr(self, "_sync_full_conversation_enabled", True):
            return False, "已在设置中关闭「允许从网页同步完整对话」"

        if session is None:
            return False, "当前没有选中的对话"

        if not server.is_server_running():
            return False, "请先启动服务"

        session_id = session.session_id
        if self._is_session_sync_running(session_id):
            self._append_log(
                f"[SYNC][SKIP_DUPLICATE] session_id={session_id} reason=inflight",
                echo=True,
            )
            return False, "同步正在进行中，请稍候"

        status = server.get_bridge_status()
        trace_id = self._get_active_sync_trace_id()
        if not trace_id:
            trace_id = make_sync_trace_id(session.session_id)
            self._set_active_sync_trace_id(trace_id)
        remote_for_resolve = normalize_remote_chatgpt(session.remote_chatgpt)
        self._append_log(
            "[SYNC][CLICK_SIMPLE] "
            f"session_id={session.session_id} "
            f"bound_client_id={(remote_for_resolve.get('client_id') or '-')} "
            f"bound_conversation_id={(self._remote_conversation_id(remote_for_resolve) or '-')}",
            echo=True,
        )
        action_target = self._resolve_conversation_action_target(
            session, action="sync", status=status
        )
        if action_target:
            self._append_log(
                "[SYNC][TARGET_FINAL] "
                f"source={(action_target.get('source') or '-')} "
                f"client_id={(action_target.get('client_id') or '-')} "
                f"page_instance_id={(action_target.get('page_instance_id') or '-')} "
                f"conversation_id={(action_target.get('conversation_id') or '-')} "
                f"url={(action_target.get('url') or '-')} "
                f"online={'true' if action_target.get('online') else 'false'} "
                f"dialog_ready={'true' if action_target.get('dialog_ready') else 'false'}",
                echo=True,
            )
        allowed, target_item, source, block_reason, sync_detail = (
            self.resolve_sync_decision(session, status=status)
        )
        if source == "prebound_home_wait_conversation" and isinstance(target_item, dict):
            self._begin_wait_conversation_page_for_sync(
                session, target_item, request_reason=request_reason
            )
            return False, block_reason or "prebound_home_wait_conversation"
        if not allowed:
            fail_reason = block_reason or sync_detail.get("blocked_reason") or "not_syncable"
            remote_for_block = remote_for_resolve
            online_same_conv = self._count_online_sync_clients_by_conversation_id(
                self._remote_conversation_id(remote_for_block),
                status=status,
            )
            self._append_log(
                "[SYNC][BLOCK] "
                + kv_line(
                    trace_id=trace_id,
                    reason=fail_reason,
                    source=source or "-",
                    bound_client_id=(remote_for_block.get("client_id") or "-"),
                    bound_conversation_id=(
                        self._remote_conversation_id(remote_for_block) or "-"
                    ),
                    online_same_conversation_count=online_same_conv,
                ),
                echo=True,
            )
            self._clear_session_sync_running(session_id, reason=fail_reason)
            hint = block_reason or sync_detail.get("blocked_reason") or ""
            if not hint or hint in ("no_dialog_ready_page", "no_sync_target"):
                hint = (
                    f"无法同步：{log_page_decision_fields(sync_detail)}"
                    if sync_detail
                    else "没有可同步的在线 ChatGPT 对话页，请先打开 /c/ 对话页。"
                )
            self._set_tm_action_hint(hint)
            return False, hint
        profile = self._tm_client_sync_profile(target_item)
        log_context = {
            "targetClientId": (target_item.get("client_id") or "-"),
            "targetConversationId": self._client_conversation_id(target_item) or "-",
            "targetSyncable": True,
        }
        target = self._build_bound_sync_target_payload(
            target_item,
            source=source,
            log_context=log_context,
            profile=profile,
            bound_conversation_id=self._remote_conversation_id(remote_for_resolve),
        )
        reason = source
        client_id = (target.get("client_id") or "").strip()
        conversation_id = (target.get("conversation_id") or "").strip()
        page_instance_id = (target.get("page_instance_id") or "").strip()
        if not conversation_id or conversation_id == "-":
            self._append_log(
                "[SYNC][BLOCK] "
                + kv_line(
                    trace_id=trace_id,
                    reason="missing_conversation_id_for_sync",
                    target_client=client_id or "-",
                    target_source=target.get("source") or "-",
                ),
                echo=True,
            )
            self._clear_session_sync_running(session_id, reason="missing_conversation_id")
            self._set_tm_action_hint("无法同步：目标页缺少 conversation_id。")
            return False, "missing_conversation_id_for_sync"
        target_url = ""
        target_info = self._client_info_by_id(client_id, status=status)
        if target_info:
            target_url = (target_info.get("page_url") or target_info.get("url") or "").strip()
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        is_prebound_home = self._remote_bind_state(remote) in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        )
        self._append_log(
            "[SYNC][TARGET_RESOLVE] "
            + kv_line(
                trace_id=trace_id,
                target_client=client_id or "-",
                target_conv=conversation_id or "-",
                target_url=target_url or "-",
                target_source=target.get("source") or "bound_page",
                is_prebound_home="true" if is_prebound_home else "false",
                reason=reason or "-",
            ),
            echo=True,
        )
        current_client_id = (status.get("tampermonkey_client_id") or "").strip()
        bound_client_id = (remote.get("client_id") or "").strip()
        if current_client_id and bound_client_id and current_client_id != bound_client_id:
            if target.get("source") in ("bound", "bound_page", "auto_rebind_by_conv"):
                self._append_log(
                    "[SYNC][WARN] "
                    + kv_line(
                        trace_id=trace_id,
                        reason="active_page_differs_from_bound_but_target_uses_bound",
                        active_client=current_client_id,
                        bound_client=bound_client_id,
                        target_client=client_id,
                    ),
                    echo=True,
                )
        self._update_sync_target_display()
        request_id = f"sync-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
        self._mark_session_sync_running(session_id, request_id)
        if not hasattr(self, "_pending_web_sync_requests"):
            self._pending_web_sync_requests = {}
        self._pending_web_sync_requests[request_id] = {
            "session_id": session.session_id,
            "client_id": client_id,
            "conversation_id": conversation_id,
            "created_at": time.time(),
            "request_reason": request_reason,
            "trace_id": trace_id,
        }
        self._append_log(
            f"[WEB_SYNC][TARGET] source={target.get('source') or '-'} "
            f"session_id={session.session_id} client_id={client_id or '-'} "
            f"conversation_id={conversation_id or '-'} request_id={request_id}",
            echo=True,
        )
        self._append_log(
            "[SYNC][TARGET_SELECTED] "
            + self._sync_log_context_fields(target.get("log_context"), reason=reason)
        )
        try:
            current_client_id = (status.get("tampermonkey_client_id") or "").strip()
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bound_client_id = (remote.get("client_id") or "").strip()
            conv_id = (remote.get("conversation_id") or "").strip() or parse_conversation_id(
                remote.get("conversation_url") or ""
            )
            target_client_id = (target.get("client_id") or "").strip()
            active_matches_bound = bool(
                current_client_id
                and bound_client_id
                and current_client_id == bound_client_id
            )
            self._append_log(
                "[SYNC_CONVERSATION][START] "
                f"session_id={session.session_id} "
                f"active_client={current_client_id or '-'} "
                f"bound_client={bound_client_id or '-'} "
                f"target_client={target_client_id or '-'} "
                f"conversation_id={conv_id or '-'} "
                f"active_matches_bound={'true' if active_matches_bound else 'false'}",
                echo=True,
            )
            if current_client_id and bound_client_id and current_client_id != bound_client_id:
                if target.get("source") in ("bound", "auto_rebind_by_conv"):
                    self._append_log(
                        "[SYNC_CONVERSATION][ACTIVE_PAGE_MISMATCH] "
                        f"active_client={current_client_id or '-'} "
                        f"bound_client={bound_client_id or '-'} "
                        f"target_client={target_client_id or '-'} "
                        "action=use_bound_page",
                        echo=True,
                    )
        except Exception as error:
            self._append_log(
                "[SYNC_CONVERSATION][START][FAILED] "
                f"session_id={(session.session_id if session else '-')}"
                f" error={error}\n{traceback.format_exc()}",
                echo=True,
            )
        mode = (self._sync_conversation_mode or "merge").strip().lower()
        if mode not in ("merge", "replace"):
            mode = "merge"
        max_messages = int(self._sync_conversation_max_messages or 200)
        if max_messages < 1:
            max_messages = 200

        target_info = self._client_info_by_id(client_id, status=status) or target_item
        target_profile = {}
        if target_info:
            target_profile = self._tm_client_sync_profile(
                target_info,
                expected_client_id=client_id,
                expected_conversation_id=conversation_id,
            )
        self._append_log(
            "[SYNC_CONVERSATION][TARGET] "
            f"source={target.get('source') or 'bound_page'} "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"url={target_url or '-'} "
            f"online={'yes' if self._tm_page_is_online_simple(target_info) else 'no'} "
            f"dialog_ready={'yes' if self._is_dialog_ready_page(target_info) else 'no'} "
            f"sync_readable={'yes' if self._is_dialog_ready_page(target_info) else 'no'} "
            f"sendable={'yes' if target_profile.get('sendable') else 'no'} "
            f"input_ok={'yes' if target_profile.get('input_ok') else 'no'} "
            f"responding={'yes' if target_profile.get('responding') else 'no'} "
            f"state={(target_info.get('response_state') or target_info.get('state') or '-') if target_info else '-'}",
            echo=True,
        )
        visibility = self._normalize_visibility_state(target_info)
        has_focus = bool(self._page_has_focus(target_info)) if target_info else False
        input_ok = bool(profile.get("input_ok", True))
        responding = bool(profile.get("responding"))
        self._append_log(
            "[SYNC_CONVERSATION][TARGET_SIMPLE] "
            f"source={source or '-'} "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"url={target_url or '-'} "
            f"online=True "
            f"input={'yes' if input_ok else 'no'} "
            f"responding={'yes' if responding else 'no'} "
            f"visible={visibility or '-'} "
            f"focus={'yes' if has_focus else 'no'}",
            echo=True,
        )
        payload = {
            "mode": mode,
            "max_messages": max_messages,
            "session_id": session.session_id,
            "conversation_id": conversation_id,
            "target_client_id": client_id,
            "request_id": request_id,
            "source": request_reason or "manual",
            "request_reason": request_reason or "manual",
            "command_type": "read_snapshot",
            "require_input": False,
            "allow_hidden": True,
            "allow_generating": True,
            "allow_while_generating": True,
            "allow_not_focused": True,
            "simple_online_policy": True,
        }

        def _send():
            self._append_log(
                "[SYNC][REQUEST_SENT] "
                + kv_line(
                    trace_id=trace_id,
                    request_id=request_id,
                    target_client=client_id or "-",
                    target_conv=conversation_id or "-",
                ),
                echo=True,
            )
            self._append_log(
                f"[WEB_SYNC][COMMAND_SEND] request_id={request_id} trace_id={trace_id} "
                f"client_id={client_id or '-'} conversation_id={conversation_id or '-'}",
                echo=True,
            )
            self._append_log(
                "[SYNC][REQUEST_EXPORT] "
                + self._sync_log_context_fields(target.get("log_context"), reason=reason)
            )
            queued = server.enqueue_control_command(
                command="sync_conversation",
                target_client_id=client_id,
                target_page_instance_id=page_instance_id,
                target_conversation_id=conversation_id,
                payload=payload,
            )
            self._append_log(
                "[SYNC_CONVERSATION][ENQUEUED_TARGET] "
                f"session_id={session.session_id} "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"target_url={target_url or '-'} "
                f"command_type=read_snapshot "
                f"require_input=false",
                echo=True,
            )
            if queued:
                message_id = ""
                if isinstance(queued, dict):
                    message_id = (
                        queued.get("message_id") or queued.get("id") or ""
                    ).strip()
                if message_id:
                    if not hasattr(self, "_pending_sync_requests"):
                        self._pending_sync_requests = {}
                    self._pending_sync_requests[message_id] = {
                        "session_id": session.session_id,
                        "conversation_id": conversation_id,
                        "target_client_id": client_id,
                        "request_id": request_id,
                    }
                    web_pending = self._pending_web_sync_requests.get(request_id)
                    if isinstance(web_pending, dict):
                        web_pending["message_id"] = message_id
                    QTimer.singleShot(
                        20000,
                        lambda rid=request_id: self._check_web_sync_timeout(rid),
                    )
                self._append_log(
                    "[SYNC_CONVERSATION][COMMAND_PAYLOAD] "
                    f"session_id={session.session_id} "
                    f"conversation_id={conversation_id or '-'} "
                    f"target_client_id={client_id or '-'} "
                    f"message_id={message_id or '-'}",
                    echo=True,
                )
                self._append_log(
                    "[SYNC_CONVERSATION][REQUEST] "
                    f"session_id={session.session_id} "
                    f"client_id={client_id} "
                    f"page_instance_id={page_instance_id or '-'} "
                    f"conversation_id={conversation_id or '-'} "
                    f"mode={mode} max_messages={max_messages} "
                    f"reason={request_reason}",
                    echo=True,
                )
                if request_reason == "manual_button" and session.session_id == (
                    self._current_session_id or ""
                ):
                    self._append_log(
                        "[SYNC_CONVERSATION][REQUESTED] manual_button=true "
                        f"session_id={session.session_id} client_id={client_id} "
                        f"conversation_id={conversation_id or '-'}",
                        echo=True,
                    )
            else:
                self._append_log(
                    f"[SYNC_CONVERSATION][FAILED] reason=enqueue_failed "
                    f"session_id={session.session_id}",
                    echo=True,
                )
                self._clear_session_sync_running(
                    session_id, request_id, reason="enqueue_failed"
                )
                if session.session_id == self._current_session_id:
                    self._set_tm_action_hint("同步失败：命令入队失败。")

        if delay_ms > 0:
            QTimer.singleShot(delay_ms, _send)
        else:
            _send()
        return True, ""

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
            or remote.get("launch_token")
            or item.get("bind_request_id")
            or item.get("launch_token")
            or ""
        ).strip()
        url = self._page_url_from_item(item) or (
            remote.get("conversation_url") or remote.get("url") or "https://chatgpt.com/"
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
            "bound_url": url,
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
        status = status or self._last_bridge_status or {}
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
            old_url = (wait_info.get("bound_url") or "").strip()
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
                self._enqueue_sync_conversation_command(
                    session, request_reason=request_reason, delay_ms=200
                )

    def resolve_sync_decision(self, session, status=None):
        """统一同步决策：返回 (allowed, target_item, source, blocked_reason, detail)。"""
        status = status or self._last_bridge_status or {}
        target_item, source, block_reason = self._resolve_sync_target_simple(
            session, status=status
        )
        detail = explain_page_decision(target_item, action="sync") if target_item else {}
        if source == "prebound_home_wait_conversation" and isinstance(target_item, dict):
            return False, target_item, source, block_reason or "prebound_home_wait_conversation", detail
        if not target_item:
            remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
            detail = {
                "client_id": (remote.get("client_id") or ""),
                "page_instance_id": (remote.get("page_instance_id") or ""),
                "conversation_id": self._remote_conversation_id(remote) or "",
                "url": page_url_from(remote),
                "online": False,
                "syncable": False,
                "blocked_reason": block_reason or "no_sync_target",
            }
            self._append_log(
                "[SYNC][DECISION] " + log_page_decision_fields(detail),
                echo=True,
            )
            return False, None, source, block_reason or "no_sync_target", detail
        syncable = is_page_syncable(target_item)
        detail = explain_page_decision(target_item, action="sync")
        allowed = syncable
        if not allowed:
            block_reason = detail.get("blocked_reason") or block_reason or "not_syncable"
        self._append_log(
            "[SYNC][DECISION] "
            f"source={source or '-'} "
            f"allowed={'true' if allowed else 'false'} "
            + log_page_decision_fields(detail),
            echo=True,
        )
        return allowed, target_item, source, block_reason if not allowed else "", detail

    def _resolve_sync_target_simple(self, session, status=None):
        """可同步目标：与 send 共用 _resolve_conversation_action_target。"""
        status = status or self._last_bridge_status or {}
        target = self._resolve_conversation_action_target(
            session, action="sync", status=status
        )
        if not target:
            return (
                None,
                "no_dialog_ready_page",
                "没有可同步的在线 ChatGPT 对话页，请先打开或进入 /c/ 对话页。",
            )
        source = (target.get("source") or "").strip()
        item = target.get("item")
        if source == "prebound_home_wait_conversation" and isinstance(item, dict):
            return item, source, (
                "当前绑定的是首页预绑定页，请打开/新建对话后再同步。"
            )
        if isinstance(item, dict) and target.get("dialog_ready"):
            mapped_source = {
                "same_conversation_latest": "same_conversation_latest",
                "bound_client": "bound_client_dialog_ready",
                "manual_current_page": "selected_dialog_ready_page",
                "recent_dialog_ready_page": "recent_dialog_ready_page",
            }.get(source, source or "same_conversation_latest")
            return item, mapped_source, ""
        if isinstance(item, dict) and self._tm_page_is_online_simple(item):
            return (
                None,
                "bound_online_not_dialog_ready",
                "绑定页在线，但不是可同步的对话页（需要 /c/<conversation_id>）。",
            )
        return (
            None,
            "no_dialog_ready_page",
            "没有可同步的在线 ChatGPT 对话页，请先打开或进入 /c/ 对话页。",
        )

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
        new_url = normalized.get("url") or normalized.get("page_url") or ""
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
        log_context["targetClientId"] = target_client_id or "-"
        log_context["targetConversationId"] = target_conversation_id or "-"
        syncable = bool(profile.get("syncable") or profile.get("sync_readable"))
        dialog_ready = bool(
            profile.get("dialog_ready")
            if profile.get("dialog_ready") is not None
            else self._is_dialog_ready_page(item)
        )
        log_context["targetSyncable"] = syncable
        return {
            "client_id": target_client_id,
            "conversation_id": target_conversation_id,
            "page_instance_id": self._tm_page_instance_id(item),
            "syncable": syncable,
            "sync_readable": syncable,
            "dialog_ready": dialog_ready,
            "prebound_home": bool(profile.get("prebound_home")),
            "sendable": bool(profile.get("sendable")),
            "input_ok": bool(profile.get("input_ok")),
            "responding": bool(profile.get("responding")),
            "source": source,
            "log_context": log_context,
        }

    def _is_session_sync_running(self, session_id):
        key = self._get_session_sync_key(session_id)
        running = getattr(self, "_sync_inflight_by_session", {})
        return bool(key and running.get(key))

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
        btn = getattr(self, "sync_web_conversation_btn", None)
        if btn is not None and session_id == (self._current_session_id or ""):
            btn.setEnabled(True)

    def _make_web_snapshot_signature(self, conversation_id, messages):
        parts = [str(conversation_id or "")]
        for msg in messages or []:
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role") or "")
            text = str(msg.get("text") or msg.get("content") or "")
            parts.append(role + ":" + str(len(text)) + ":" + text[:64])
        return "\n".join(parts)

    def _sync_bound_web_conversation(self, _checked=False):
        session = self._current_session()
        if session is None:
            self._set_tm_action_hint("当前没有选中的对话。")
            return
        if not getattr(self, "_sync_full_conversation_enabled", True):
            self._set_tm_action_hint("已在设置中关闭「允许从网页同步完整对话」。")
            return

        session_id = session.session_id
        now = time.time()
        last_click_map = getattr(self, "_last_sync_click_at_by_session", None)
        if last_click_map is None:
            last_click_map = {}
            self._last_sync_click_at_by_session = last_click_map
        last_click = float(last_click_map.get(session_id, 0.0) or 0.0)
        if now - last_click < 1.0:
            self._append_log(
                "[SYNC][SKIP_DUPLICATE_CLICK] reason=debounce "
                f"session_id={session_id}",
                echo=True,
            )
            return
        last_click_map[session_id] = now

        if self._is_session_sync_running(session_id):
            self._append_log(
                f"[SYNC][SKIP_DUPLICATE] session_id={session_id} reason=inflight",
                echo=True,
            )
            return

        trace_id = make_sync_trace_id(session.session_id)
        self._set_active_sync_trace_id(trace_id)
        status = self._last_bridge_status or {}
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        current_client = (status.get("tampermonkey_client_id") or "").strip() or "-"
        current_info = self._client_info_by_id(current_client, status=status)
        current_conv = self._client_conversation_id(current_info) or "-"
        bound_client = (remote.get("client_id") or "").strip() or "-"
        bound_conv = self._remote_conversation_id(remote) or "-"
        self._append_log(
            "[SYNC][CLICK] "
            + kv_line(
                trace_id=trace_id,
                button="sync",
                session_id=session.session_id,
                current_client=current_client,
                current_conv=current_conv,
                bound_client=bound_client,
                bound_conv=bound_conv,
            ),
            echo=True,
        )
        self._append_log(
            f"[WEB_SYNC][CLICK] session_id={session.session_id} trace_id={trace_id}",
            echo=True,
        )
        bound_url = (
            (remote.get("conversation_url") or remote.get("url") or "").strip()
            if remote.get("enabled")
            else "-"
        )
        self._append_log(
            "[SYNC_CONVERSATION][CLICK] "
            f"session_id={session.session_id} "
            f"trace_id={trace_id} "
            f"bound_url={bound_url or '-'} "
            f"bound_client_id={bound_client} "
            f"bound_conversation_id={bound_conv} "
            f"current_client={current_client} "
            f"current_conversation_id={current_conv}",
            echo=True,
        )
        btn = getattr(self, "sync_web_conversation_btn", None)
        if btn is not None:
            btn.setEnabled(False)
        self._set_tm_action_hint("正在同步绑定页...")
        try:
            ok, reason = self._enqueue_sync_conversation_command(
                session, request_reason="manual_button"
            )
        finally:
            self._set_active_sync_trace_id("")
        if not ok and reason:
            self._clear_session_sync_running(
                session_id, reason="sync_enqueue_failed"
            )
            self._set_tm_action_hint(f"同步失败：{reason}")
            self._append_log(
                "[SYNC][BLOCK] "
                + kv_line(trace_id=trace_id, reason=reason or "sync_enqueue_failed"),
                echo=True,
            )
            self._append_log(
                f"[WEB_SYNC][CLICK_FAILED] session_id={session.session_id} reason={reason}",
                echo=True,
            )


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
        if message.role == "system":
            return True
        if message.role == "error":
            return True
        if message.role != "assistant":
            return False
        status = (message.status or "").strip()
        if status in PENDING_ASSISTANT_STATUSES:
            return True
        text = (message.content or "").strip()
        if text in ASSISTANT_WAIT_TEXTS:
            return True
        if status in ("发送失败", "读取失败", "空回复") or "失败" in status:
            return True
        return False
    def _existing_message_fingerprints(self, session):
        fingerprints = set()
        for message in session.messages:
            if message.role not in ("user", "assistant"):
                continue
            text = (message.content or "").strip()
            if not text:
                continue
            fingerprints.add(self._message_fingerprint(message.role, text))
        return fingerprints
    def _dedupe_synced_messages_in_session(self, session):
        deduped = []
        fingerprints = set()
        removed = 0
        for message in session.messages:
            role = (message.role or "").strip()
            if role not in ("user", "assistant"):
                deduped.append(message)
                continue
            if self._is_protected_local_message(message):
                deduped.append(message)
                continue
            text = self._normalize_synced_message_text(message.content or "")
            if not text:
                deduped.append(message)
                continue
            fp = self._message_fingerprint(role, text)
            if fp in fingerprints:
                removed += 1
                continue
            fingerprints.add(fp)
            deduped.append(message)
        if removed:
            session.messages = deduped
        return removed
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

        if hasattr(self, "_last_rendered_chat_signature"):
            self._last_rendered_chat_signature = None
            self._last_rendered_session_id = ""

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
        self._update_bound_page_display()
        self._refresh_tm_page_selector()
        self._render_tampermonkey_clients(self._last_bridge_status)
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

        for message in session.messages:
            role = (message.role or "").strip()
            status = (message.status or "").strip()
            text = (message.content or "").strip()

            is_waiting_assistant = (
                role == "assistant"
                and (
                    status in PENDING_ASSISTANT_STATUSES
                    or text in ASSISTANT_WAIT_TEXTS
                )
            )

            if is_waiting_assistant:
                removed += 1
                continue

            if role == "user" and status in PENDING_ASSISTANT_STATUSES:
                message.status = "已同步"

            kept.append(message)

        if removed:
            session.messages = kept

        session.has_pending_reply = False
        session.pending_reply_since = 0
        session.updated_at = time.time()

        self._append_log(
            "[SYNC_CONVERSATION][CLEAR_PENDING] "
            f"session_id={session.session_id} "
            f"removed={removed} "
            f"last_web_role={last_role}",
            echo=True,
        )

        return removed

    def _sync_session_messages_from_web_snapshot(
        self, session_id, web_messages, mode="merge", source="manual"
    ):
        session = self._sessions.get(session_id)
        if session is None:
            self._append_log(
                f"[SYNC_CONVERSATION][FAILED] reason=session_not_found "
                f"session_id={session_id}",
                echo=True,
            )
            return False, "未找到对话"

        mode = (mode or "merge").strip().lower()
        if mode not in ("merge", "replace"):
            mode = "merge"

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
            self._append_log(
                f"[SYNC_CONVERSATION][FAILED] reason=empty_web_snapshot "
                f"session_id={session.session_id}",
                echo=True,
            )
            return False, "网页端没有导出到有效聊天消息，本地内容已保持不变"

        added = 0
        skipped = 0

        if mode == "replace":
            old_count = len(session.messages)
            new_messages = []
            fingerprints = set()
            for item in normalized_web:
                role = item["role"]
                text = item["text"]
                fp = self._message_fingerprint(role, text)
                if fp in fingerprints:
                    skipped += 1
                    continue
                fingerprints.add(fp)
                new_messages.append(
                    ChatMessage(
                        role=role,
                        content=text,
                        created_at=time.time(),
                        message_id=str(uuid.uuid4()),
                        status="已同步",
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
        else:
            fingerprints = self._existing_message_fingerprints(session)
            for item in normalized_web:
                fp = self._message_fingerprint(item["role"], item["text"])
                if fp in fingerprints:
                    skipped += 1
                    continue
                self._append_session_message(
                    session, item["role"], item["text"], status="已同步"
                )
                fingerprints.add(fp)
                added += 1

        if mode == "merge":
            removed_existing = self._dedupe_synced_messages_in_session(session)
            if removed_existing:
                skipped += removed_existing

        self._auto_rename_session_from_messages(session)

        cleared_pending = self._clear_pending_wait_messages_after_web_sync(
            session,
            normalized_web,
        )

        summary = (
            "同步完成"
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
        self._save_sessions_to_disk()
        self._refresh_local_conversation_after_sync(
            session.session_id,
            force_bottom=True,
            reason="snapshot_replaced" if mode == "replace" else "snapshot_applied",
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
        pending = getattr(self, "_pending_web_sync_requests", {}).get(request_id)
        if not pending:
            return
        retry_done = getattr(self, "_web_sync_timeout_retry_done", None)
        if retry_done is None:
            retry_done = set()
            self._web_sync_timeout_retry_done = retry_done
        old_client_id = (pending.get("client_id") or "").strip()
        conversation_id = (pending.get("conversation_id") or "").strip()
        session_id = (pending.get("session_id") or "").strip()
        session = self._get_session_by_id(session_id) if session_id else None

        if request_id not in retry_done and session is not None and conversation_id:
            retry_done.add(request_id)
            status = server.get_bridge_status() if server.is_server_running() else {}
            fresh = self._pick_best_conversation_page(conversation_id, status=status)
            new_client_id = (fresh.get("client_id") or "").strip() if fresh else ""
            if fresh and new_client_id and new_client_id != old_client_id:
                self._relink_session_binding_from_tm_page(
                    session,
                    fresh,
                    reason="sync_timeout_reselect_latest_same_conversation",
                )
                self._append_log(
                    "[WEB_SYNC][TIMEOUT_RETRY] "
                    f"request_id={request_id} "
                    f"old_client_id={old_client_id or '-'} "
                    f"new_client_id={new_client_id or '-'} "
                    f"conversation_id={conversation_id or '-'} "
                    f"reason=reselect_latest_same_conversation",
                    echo=True,
                )
                request_reason = (pending.get("request_reason") or "manual_button").strip()
                self._pending_web_sync_requests.pop(request_id, None)
                message_id = (pending.get("message_id") or "").strip()
                if message_id:
                    getattr(self, "_pending_sync_requests", {}).pop(message_id, None)
                self._clear_session_sync_running(
                    session_id, request_id, reason="timeout_retry"
                )
                self._enqueue_sync_conversation_command(
                    session,
                    request_reason=request_reason,
                    delay_ms=300,
                )
                return

        self._pending_web_sync_requests.pop(request_id, None)
        message_id = (pending.get("message_id") or "").strip()
        if message_id:
            getattr(self, "_pending_sync_requests", {}).pop(message_id, None)
        self._append_log(
            "[WEB_SYNC][TIMEOUT] "
            f"request_id={request_id} "
            f"client_id={old_client_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"reason=target_page_did_not_claim_control_command "
            "hint=请检查目标页面是否仍在 poll，或同会话是否有更新的在线页",
            echo=True,
        )
        if session_id == (self._current_session_id or ""):
            self._set_tm_action_hint("同步超时：目标页未在 20 秒内领取同步命令")
        self._clear_session_sync_running(session_id, request_id, reason="timeout")


    def _schedule_auto_sync_conversation(self, session, request_reason="auto"):
        if not getattr(self, "_sync_full_conversation_enabled", True):
            return
        delay = 800 if request_reason == "auto_after_reply" else 0
        self._enqueue_sync_conversation_command(
            session, request_reason=request_reason, delay_ms=delay
        )

    def _get_session_sync_key(self, session_id):
        return str(session_id or "").strip()


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



    def _session_bound_client_id(self):
        session = self._current_session()
        if not session:
            return ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return ""
        return (remote.get("client_id") or "").strip()
