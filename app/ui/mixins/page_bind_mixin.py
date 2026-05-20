"""页面绑定主 mixin：UI 事件、同步、显示与入站桥接状态。"""

import hashlib
import re
import time
import traceback
import uuid
from urllib.parse import urlparse

import server

from app.constants import (
    ASSISTANT_WAIT_TEXTS,
    BOUND_PAGE_OFFLINE_GRACE_SECONDS,
    BOUND_PAGE_ONLINE_SECONDS,
    BOUND_PAGE_STALE_SECONDS,
    PENDING_ASSISTANT_STATUSES,
)
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    ChatMessage,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.ui.mixins.page_auto_bind_mixin import PageAutoBindMixin
from app.ui.mixins.page_open_close_mixin import PageOpenCloseMixin
from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin
from app.ui.mixins.page_tm_client_mixin import PageTmClientMixin
from PyQt5.QtCore import QTimer


class PageBindMixin(
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
                bound_conversation_id = (remote.get("conversation_id") or "").strip()
                if not bound_conversation_id:
                    bound_conversation_id = parse_conversation_id(
                        remote.get("conversation_url") or ""
                    )
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
    def _log_send_bind_check(self, session, action="send"):
        summary = self._tm_summary_for_session(session)
        bound_client_id = (summary.get("bound_client_id") or "").strip() or "-"
        bound_conversation_id = (
            summary.get("bound_conversation_id") or ""
        ).strip() or "-"
        bound_online = bool(summary.get("bound_online"))
        active_client_id = (summary.get("active_client_id") or "").strip() or "-"
        active_conversation_id = (
            summary.get("active_conversation_id") or ""
        ).strip() or "-"
        same_client = (
            bound_client_id == active_client_id
            if bound_client_id != "-" and active_client_id != "-"
            else False
        )
        same_conversation = (
            bound_conversation_id == active_conversation_id
            if bound_conversation_id != "-" and active_conversation_id != "-"
            else False
        )
        self._append_log(
            "[SEND][BIND_CHECK] "
            f"bound_client_id={bound_client_id} "
            f"bound_conversation_id={bound_conversation_id} "
            f"bound_online={bound_online} "
            f"active_client_id={active_client_id} "
            f"active_conversation_id={active_conversation_id} "
            f"same_client={same_client} same_conversation={same_conversation} "
            f"action={action}"
        )
        mismatch = self._detect_bind_mismatch(summary)
        if mismatch:
            mismatch_action = "warn"
            if not bound_online:
                mismatch_action = "auto_rebind"
            elif not same_conversation:
                mismatch_action = "block_send"
            self._append_log(
                "[BIND][MISMATCH] "
                f"bound_client_id={mismatch.get('bound_client_id') or '-'} "
                f"bound_conversation_id={mismatch.get('bound_conversation_id') or '-'} "
                f"active_client_id={mismatch.get('active_client_id') or '-'} "
                f"active_conversation_id={mismatch.get('active_conversation_id') or '-'} "
                f"action={mismatch_action}"
            )
    def _log_bind_auto_rebind(self, session, new_client_info, reason=""):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip() or "-"
        old_conversation_id = (remote.get("conversation_id") or "").strip()
        if not old_conversation_id:
            old_conversation_id = parse_conversation_id(
                remote.get("conversation_url") or ""
            )
        new_client_id = (new_client_info.get("client_id") or "").strip() or "-"
        new_conversation_id = self._client_conversation_id(new_client_info) or "-"
        self._append_log(
            "[BIND][AUTO_REBIND] "
            f"old_client_id={old_client_id} old_conversation_id={old_conversation_id or '-'} "
            f"new_client_id={new_client_id} new_conversation_id={new_conversation_id} "
            f"reason={reason or '-'}"
        )
    def _detect_bind_mismatch(self, summary):
        summary = summary or {}
        bound_client_id = (summary.get("bound_client_id") or "").strip()
        bound_conversation_id = (summary.get("bound_conversation_id") or "").strip()
        if not bound_client_id:
            return None
        active_client_id = (summary.get("active_client_id") or "").strip()
        active_conversation_id = (summary.get("active_conversation_id") or "").strip()
        if not active_client_id:
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
                    "reason": "绑定 client 与活跃 client 相同，但 conversation_id 不一致",
                }
            return None
        bound_online = bool(summary.get("bound_online"))
        if bound_online:
            return {
                "bound_client_id": bound_client_id,
                "bound_conversation_id": bound_conversation_id or "-",
                "active_client_id": active_client_id,
                "active_conversation_id": active_conversation_id or "-",
                "reason": "绑定 client 不是最近活跃的油猴页面",
            }
        if summary.get("online_clients", 0) > 0:
            return {
                "bound_client_id": bound_client_id,
                "bound_conversation_id": bound_conversation_id or "-",
                "active_client_id": active_client_id,
                "active_conversation_id": active_conversation_id or "-",
                "reason": "当前活跃页面与绑定页面不是同一 client",
            }
        return None
    def _log_tm_status_summary(self, summary):
        if not isinstance(summary, dict):
            return
        status = self._last_bridge_status or {}
        service_state = "running" if bool(status.get("server_running")) else "stopped"
        current_info = self._pick_current_page_client_info(status)
        current_label = self._short_page_label(current_info) if current_info else "未检测到"
        current_syncable = bool(
            current_info and self._tm_client_sync_profile(current_info).get("syncable")
        )
        bound_info, bound_state, _bound_reason = self._resolve_bound_page_info(status=status)
        bound_label = (
            self._short_page_label(bound_info)
            if isinstance(bound_info, dict)
            else "未绑定"
        )
        target = self._sync_target_snapshot(status=status, bound_info=bound_info, current_info=current_info)
        sync_target_label = target.get("short_label") or "不可用"
        sync_target_state = "ready" if bool(target.get("syncable")) else "unavailable"
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
                f"current_page={current_label}",
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
        mismatch = self._detect_bind_mismatch(summary)
        if not mismatch:
            if hasattr(self, "tm_bind_mismatch_label"):
                self.tm_bind_mismatch_label.setText(" ")
                self.tm_bind_mismatch_label.setProperty("state", "")
            self._set_close_other_pages_enabled(True)
            return
        key = tuple(mismatch.get(field) for field in (
            "bound_client_id",
            "bound_conversation_id",
            "active_client_id",
            "active_conversation_id",
            "reason",
        ))
        if key != getattr(self, "_last_bind_mismatch_log_key", None):
            self._last_bind_mismatch_log_key = key
            self._append_log(
                "[BIND][MISMATCH] "
                f"bound_client_id={mismatch.get('bound_client_id')} "
                f"bound_conversation_id={mismatch.get('bound_conversation_id')} "
                f"active_client_id={mismatch.get('active_client_id')} "
                f"active_conversation_id={mismatch.get('active_conversation_id')} "
                f"reason={mismatch.get('reason')}"
            )
        if hasattr(self, "tm_bind_mismatch_label"):
            bound_online = bool((summary or {}).get("bound_online"))
            state = "warn" if bound_online else "warn"
            text = "当前网页不是绑定网页，同步将使用绑定网页。"
            self.tm_bind_mismatch_label.setText(text)
            self.tm_bind_mismatch_label.setProperty("state", state)
            try:
                self.tm_bind_mismatch_label.style().unpolish(self.tm_bind_mismatch_label)
                self.tm_bind_mismatch_label.style().polish(self.tm_bind_mismatch_label)
            except Exception as error:
                self._append_log(
                    f"[STATUS][HINT_STYLE][FAILED] error={error}\n{traceback.format_exc()}",
                    echo=True,
                )
        self._set_close_other_pages_enabled(False)
        if hasattr(self, "close_other_pages_btn"):
            self.close_other_pages_btn.setToolTip(
                "当前可见页面不是本对话绑定页，请先绑定当前页面后再关闭其他页面。"
            )
    def _set_close_other_pages_enabled(self, enabled):
        if hasattr(self, "close_other_pages_btn"):
            self.close_other_pages_btn.setEnabled(bool(enabled))
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

    def _set_last_sync_target(self, target):
        self._last_sync_target = dict(target or {})
        self._update_sync_target_display()

    @staticmethod
    def _elide_middle(text, max_len=42):
        value = str(text or "").strip()
        if len(value) <= max_len:
            return value
        keep = max(6, (max_len - 3) // 2)
        return value[:keep] + "..." + value[-keep:]

    def _short_page_label(self, info):
        if not isinstance(info, dict):
            return "未检测到"
        page_type = (info.get("page_type") or "").strip()
        page_url = (info.get("page_url") or "").strip()
        conversation_id = (
            info.get("conversation_id")
            or info.get("conv")
            or self._client_conversation_id(info)
            or ""
        ).strip()
        if conversation_id:
            return f"/c/{conversation_id[:8]}..."
        if page_type == "home":
            return "ChatGPT 首页"
        if page_url:
            return self._elide_middle(page_url, 42)
        return "未知页面"

    def _full_page_relation_label(
        self,
        title,
        info,
        *,
        state_text="",
        source_text="",
        syncable=None,
        note_text="",
    ):
        if not info:
            return f"{title}：未检测到"

        page_type = (info.get("page_type") or "").strip()
        page_url = (info.get("page_url") or info.get("url") or "").strip()
        client_id = (info.get("client_id") or "").strip()
        conversation_id = (
            info.get("conversation_id")
            or info.get("conv")
            or self._client_conversation_id(info)
            or ""
        ).strip()

        if page_type == "conversation":
            type_text = "ChatGPT 对话页"
        elif page_type == "home":
            type_text = "ChatGPT 首页"
        else:
            type_text = page_type or "未知页面"

        parts = []
        if state_text:
            parts.append(f"状态={state_text}")
        if source_text:
            parts.append(f"来源={source_text}")
        parts.append(f"类型={type_text}")
        if syncable is not None:
            parts.append(f"可同步={'是' if syncable else '否'}")
        if client_id:
            parts.append(f"client={client_id}")
        if conversation_id:
            parts.append(f"conv={conversation_id}")
        if page_url:
            parts.append(f"url={page_url}")
        if note_text:
            parts.append(f"备注={note_text}")
        return f"{title}：" + " | ".join(parts)

    def _pick_current_page_client_info(self, status=None):
        status = status or self._last_bridge_status or {}
        for key in ("tampermonkey_client_id", "active_client_id"):
            cid = (status.get(key) or "").strip()
            info = self._client_info_by_id(cid, status=status)
            if isinstance(info, dict) and info.get("online"):
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
        matched = self._find_online_client_for_remote(remote, bridge_status=status)
        if isinstance(matched, dict):
            return matched, "online", "matched_by_conversation"
        client_id = (remote.get("client_id") or "").strip()
        bound_info = self._client_info_by_id(client_id, status=status) if client_id else None
        if isinstance(bound_info, dict):
            if bound_info.get("online"):
                return bound_info, "online", "bound_client_online"
            return bound_info, "offline", "bound_client_offline"
        return {
            "client_id": client_id,
            "conversation_id": (remote.get("conversation_id") or "").strip(),
            "page_url": (remote.get("conversation_url") or remote.get("url") or "").strip(),
            "page_type": (remote.get("page_type") or "").strip(),
        }, "offline", "bound_info_missing"

    def _sync_target_snapshot(self, status=None, bound_info=None, current_info=None):
        status = status or self._last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bound_info = bound_info if bound_info is not None else None
        current_info = current_info if current_info is not None else self._pick_current_page_client_info(status)
        active_client_id = (status.get("active_client_id") or "").strip()
        bound_client_id = (remote.get("client_id") or "").strip()
        active_matches_bound = bool(active_client_id and bound_client_id and active_client_id == bound_client_id)
        if remote.get("enabled") and isinstance(bound_info, dict) and bound_info.get("online"):
            return {
                "syncable": True,
                "source": "bound_page",
                "source_label": "已绑定页",
                "short_label": self._short_page_label(bound_info),
                "client_id": (bound_info.get("client_id") or "").strip(),
                "conversation_id": self._client_conversation_id(bound_info),
                "page_url": (bound_info.get("page_url") or bound_info.get("url") or "").strip(),
                "page_type": (bound_info.get("page_type") or "").strip(),
                "reason": "bound_page_online",
                "active_matches_bound": active_matches_bound,
            }
        if isinstance(current_info, dict):
            profile = self._tm_client_sync_profile(current_info)
            if profile.get("syncable"):
                return {
                    "syncable": True,
                    "source": "current_page",
                    "source_label": "当前网页",
                    "short_label": self._short_page_label(current_info),
                    "client_id": (current_info.get("client_id") or "").strip(),
                    "conversation_id": self._client_conversation_id(current_info),
                    "page_url": (current_info.get("page_url") or current_info.get("url") or "").strip(),
                    "page_type": (current_info.get("page_type") or "").strip(),
                    "reason": "fallback_current_page_syncable",
                    "active_matches_bound": active_matches_bound,
                }
        if isinstance(bound_info, dict):
            return {
                "syncable": False,
                "source": "bound_page",
                "source_label": "已绑定页",
                "short_label": self._short_page_label(bound_info),
                "client_id": (bound_info.get("client_id") or "").strip(),
                "conversation_id": self._client_conversation_id(bound_info),
                "page_url": (bound_info.get("page_url") or bound_info.get("url") or "").strip(),
                "page_type": (bound_info.get("page_type") or "").strip(),
                "reason": "bound_page_not_syncable",
                "active_matches_bound": active_matches_bound,
            }
        if isinstance(current_info, dict):
            return {
                "syncable": False,
                "source": "current_page",
                "source_label": "当前网页",
                "short_label": self._short_page_label(current_info),
                "client_id": (current_info.get("client_id") or "").strip(),
                "conversation_id": self._client_conversation_id(current_info),
                "page_url": (current_info.get("page_url") or current_info.get("url") or "").strip(),
                "page_type": (current_info.get("page_type") or "").strip(),
                "reason": "current_page_not_syncable",
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

    def _update_sync_target_display(self):
        if not hasattr(self, "tm_sync_target_label"):
            return
        status = self._last_bridge_status or {}
        current_info = self._pick_current_page_client_info(status)
        bound_info, _bound_state, _bound_reason = self._resolve_bound_page_info(status=status)
        target = self._sync_target_snapshot(status=status, bound_info=bound_info, current_info=current_info)
        syncable = bool(target.get("syncable"))
        text = "同步目标：已就绪" if syncable else "同步目标：不可用"
        self.tm_sync_target_label.setText(text)
        self._refresh_status_chip(self.tm_sync_target_label, "ok" if syncable else "error")
        tooltip = (
            f"target_client_id={(target.get('client_id') or '-')}\n"
            f"target_conversation_id={(target.get('conversation_id') or '-')}\n"
            f"source={(target.get('source') or 'none')}\n"
            f"reason={(target.get('reason') or '-')}"
        )
        self.tm_sync_target_label.setToolTip(tooltip)
        if hasattr(self, "tm_sync_target_relation_label"):
            target_info = {
                "client_id": (target.get("client_id") or "").strip(),
                "conversation_id": (target.get("conversation_id") or "").strip(),
                "page_url": (target.get("page_url") or "").strip(),
                "page_type": (target.get("page_type") or "").strip(),
            }
            if any(target_info.values()):
                self.tm_sync_target_relation_label.setText(
                    self._full_page_relation_label(
                        "同步目标",
                        target_info,
                        source_text=target.get("source_label") or "",
                        state_text=("已就绪" if syncable else "不可用"),
                        syncable=syncable,
                    )
                )
            else:
                self.tm_sync_target_relation_label.setText("同步目标：不可用")
            self.tm_sync_target_relation_label.setToolTip(tooltip)
        status = self._last_bridge_status or {}
        current_info = self._pick_current_page_client_info(status)
        bound_info, _bound_state, _bound_reason = self._resolve_bound_page_info(status=status)
        self._append_log(
            "[PAGE_RELATION_DISPLAY]\n"
            f"current_client={((current_info or {}).get('client_id') or '-').strip() or '-'}\n"
            f"current_conv={self._client_conversation_id(current_info) or '-'}\n"
            f"current_url={((current_info or {}).get('page_url') or (current_info or {}).get('url') or '-').strip() or '-'}\n"
            f"bound_client={((bound_info or {}).get('client_id') or '-').strip() or '-'}\n"
            f"bound_conv={self._client_conversation_id(bound_info) or '-'}\n"
            f"bound_url={((bound_info or {}).get('page_url') or (bound_info or {}).get('url') or '-').strip() or '-'}\n"
            f"target_client={(target.get('client_id') or '-').strip() or '-'}\n"
            f"target_conv={(target.get('conversation_id') or '-').strip() or '-'}\n"
            f"target_url={(target.get('page_url') or '-').strip() or '-'}"
        )
    def _format_tm_online_chip_text(self, summary):
        summary = summary or {}
        online = int(summary.get("online_clients") or 0)
        total = int(summary.get("total_clients") or 0)
        text = f"油猴：在线 {online} / 总 {total}"
        return text, ("ok" if online > 0 else "error")
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
    def _update_live_page_display(self, live_url=None, summary=None):
        summary = summary or self._tm_summary_for_session()
        status = self._last_bridge_status or {}
        client_info = self._pick_current_page_client_info(status)
        show_url = None
        if isinstance(client_info, dict):
            page_url = (client_info.get("page_url") or "").strip()
            if self._is_bindable_chatgpt_url(page_url):
                show_url = page_url
        if show_url is None:
            live = (live_url or "").strip()
            if self._is_bindable_chatgpt_url(live):
                show_url = live
        if show_url:
            self._persist_page_url(show_url)
        self._tampermonkey_page_url = show_url
        page_state = "未检测到"
        chip_state = "warn"
        tooltip_lines = []
        relation_line = "当前网页：未检测到"
        if isinstance(client_info, dict):
            profile = self._tm_client_sync_profile(client_info)
            syncable = bool(profile.get("syncable"))
            page_state = "可同步" if syncable else "不可同步"
            chip_state = "ok" if syncable else "warn"
            relation_line = self._full_page_relation_label(
                "当前网页",
                client_info,
                state_text=page_state,
                syncable=syncable,
            )
            tooltip_lines = [
                f"URL: {(client_info.get('page_url') or '-').strip() or '-'}",
                f"client_id: {(client_info.get('client_id') or '-').strip() or '-'}",
                f"conversation_id: {self._client_conversation_id(client_info) or '-'}",
                f"page_type: {(client_info.get('page_type') or '-').strip() or '-'}",
                f"visible: {(client_info.get('visibility_state') or client_info.get('visible') or '-').strip() or '-'}",
                f"focus: {'yes' if client_info.get('has_focus') else 'no'}",
                f"syncable: {'yes' if syncable else 'no'}",
                f"heartbeat: {self._format_last_seen_ago(client_info.get('last_heartbeat_at'))}",
                f"last_seen: {self._format_last_seen_ago(client_info.get('last_seen'))}",
            ]
        self.tm_live_page_label.setText(f"当前页：{page_state}")
        self._refresh_status_chip(self.tm_live_page_label, chip_state)
        self.tm_live_page_label.setToolTip("\n".join(tooltip_lines))
        if hasattr(self, "tm_current_page_relation_label"):
            self.tm_current_page_relation_label.setText(relation_line)
            self.tm_current_page_relation_label.setToolTip("\n".join(tooltip_lines))
        self._update_sync_target_display()
    def _session_bind_list_state(self, session, bridge_status=None):
        if session is None:
            return "unbound"
        bridge_status = bridge_status if bridge_status is not None else self._last_bridge_status
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )

        if self._session_has_wrong_existing_conversation_bind(session):
            return "bind_mismatch"

        if self._pending_auto_bind_session_id == session.session_id:
            return "waiting_home"

        if bind_state == BIND_STATE_WAITING_HOME:
            return "waiting_home"

        if bind_state == BIND_STATE_WAITING_CONVERSATION_CREATED:
            return "waiting_conversation_created"

        if bind_state == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return "waiting_bound_conversation"

        if bind_state == BIND_STATE_PREBOUND_HOME:
            if self._session_has_prebound_home_online(remote, bridge_status=bridge_status):
                return "prebound_home"
            return "bound_offline"

        if conversation_id:
            if self._session_bound_page_has_mismatch(session, bridge_status=bridge_status):
                raw_state = "bind_mismatch"
            else:
                matched = self._find_online_client_for_remote(
                    remote, bridge_status=bridge_status
                )
                raw_state = self._raw_bound_state_from_match(
                    session, conversation_id, matched
                )
            return self._stable_session_bind_list_state(
                session,
                raw_state,
                conversation_id=conversation_id,
            )

        return "unbound"

    def _raw_bound_state_from_match(self, session, conversation_id, matched_client):
        if session is None:
            return "bound_offline"
        if not conversation_id:
            return "bound_offline"
        if isinstance(matched_client, dict):
            last_seen = float(matched_client.get("last_seen") or 0)
            if last_seen > 0:
                age = max(0.0, time.time() - last_seen)
                cache = {
                    "conversation_id": conversation_id,
                    "client_id": (matched_client.get("client_id") or "").strip(),
                    "page_instance_id": (
                        matched_client.get("page_instance_id") or ""
                    ).strip(),
                    "last_seen_at": time.time(),
                    "last_status": "bound_online",
                }
                self._last_bound_page_seen_by_session[session.session_id] = cache
                if age <= BOUND_PAGE_ONLINE_SECONDS:
                    return "bound_online"
                if age <= BOUND_PAGE_STALE_SECONDS:
                    return "bound_stale"
        return "bound_offline"

    def _stable_session_bind_list_state(self, session, raw_state, conversation_id=""):
        if session is None:
            return raw_state
        prev_display = self._last_session_bind_display_state.get(session.session_id)
        if raw_state == "bound_online":
            self._last_session_bind_display_state[session.session_id] = "bound_online"
            if prev_display != "bound_online":
                self._log_session_bind_state_change(
                    session, raw_state, "bound_online", "raw_online"
                )
            return "bound_online"
        if raw_state == "bound_stale":
            self._last_session_bind_display_state[session.session_id] = "bound_online"
            self._log_session_bind_debounce(
                session,
                raw_state,
                "bound_online",
                reason="stale_within_timeout",
                last_seen_age=self._bound_cache_seen_age(session, conversation_id),
            )
            return "bound_online"
        if raw_state != "bound_offline":
            self._last_session_bind_display_state[session.session_id] = raw_state
            if prev_display != raw_state:
                self._log_session_bind_state_change(
                    session, raw_state, raw_state, "raw_passthrough"
                )
            return raw_state

        cache = self._last_bound_page_seen_by_session.get(session.session_id)
        if (
            isinstance(cache, dict)
            and conversation_id
            and (cache.get("conversation_id") or "").strip() == conversation_id
        ):
            age = max(0.0, time.time() - float(cache.get("last_seen_at") or 0))
            if age <= BOUND_PAGE_OFFLINE_GRACE_SECONDS:
                self._last_session_bind_display_state[session.session_id] = "bound_online"
                self._log_session_bind_debounce(
                    session,
                    "bound_offline",
                    "bound_online",
                    reason="offline_grace",
                    last_seen_age=age,
                )
                return "bound_online"
        self._last_session_bind_display_state[session.session_id] = "bound_offline"
        if prev_display != "bound_offline":
            self._log_session_bind_state_change(
                session,
                "bound_offline",
                "bound_offline",
                "last_seen_timeout",
                last_seen_age=self._bound_cache_seen_age(session, conversation_id),
            )
        return "bound_offline"

    def _bound_cache_seen_age(self, session, conversation_id):
        if session is None:
            return -1.0
        cache = self._last_bound_page_seen_by_session.get(session.session_id)
        if not isinstance(cache, dict):
            return -1.0
        if conversation_id and (cache.get("conversation_id") or "").strip() != conversation_id:
            return -1.0
        last_seen_at = float(cache.get("last_seen_at") or 0)
        if last_seen_at <= 0:
            return -1.0
        return max(0.0, time.time() - last_seen_at)

    def _log_session_bind_state_change(
        self, session, raw_state, display_state, reason, last_seen_age=-1.0
    ):
        if session is None:
            return
        now = time.time()
        state_key = f"{raw_state}->{display_state}:{reason}"
        key = (session.session_id, state_key)
        last_at = self._last_session_bind_state_log_at.get(key, 0.0)
        if now - last_at < 1.0:
            return
        self._last_session_bind_state_log_at[key] = now
        age_text = f"{last_seen_age:.1f}" if last_seen_age >= 0 else "-"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
        self._append_log(
            "[SESSION_BIND_STATE][CHANGE] "
            f"session_id={session.session_id} "
            f"raw={raw_state} display={display_state} "
            f"conversation_id={conversation_id or '-'} "
            f"reason={reason} "
            f"last_seen_age={age_text} "
            f"grace={BOUND_PAGE_OFFLINE_GRACE_SECONDS}"
        )

    def _log_session_bind_debounce(
        self, session, raw_state, display_state, reason, last_seen_age=-1.0
    ):
        if session is None:
            return
        now = time.time()
        key = (session.session_id, raw_state, display_state, reason)
        last_at = self._last_session_bind_debounce_log_at.get(key, 0.0)
        if now - last_at < 10.0:
            return
        self._last_session_bind_debounce_log_at[key] = now
        age_text = f"{last_seen_age:.1f}" if last_seen_age >= 0 else "-"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
        self._append_log(
            "[SESSION_BIND_STATE][DEBOUNCE] "
            f"session_id={session.session_id} "
            f"raw={raw_state} display={display_state} "
            f"conversation_id={conversation_id or '-'} "
            f"reason={reason} "
            f"last_seen_age={age_text} "
            f"grace={BOUND_PAGE_OFFLINE_GRACE_SECONDS}"
        )

    def _session_bind_mismatch_tooltip_reason(self, session, bridge_status=None):
        if session is None:
            return ""
        bridge_status = (
            bridge_status if bridge_status is not None else self._last_bridge_status
        )
        if self._session_has_wrong_existing_conversation_bind(session):
            return (
                "绑定异常原因：当前新建本地对话错误绑定到了已有 ChatGPT 对话页，"
                "与空白首页创建新会话流程冲突。请点击“绑定当前页面”覆盖后从首页重新开始。"
            )
        if self._session_bound_page_has_mismatch(session, bridge_status=bridge_status):
            return (
                "绑定异常原因：当前在线的油猴页面报告的 conversation_id 与"
                "本对话绑定的会话不一致（或绑定 client 仍在但 URL 不匹配）。"
            )
        return ""

    def _current_bind_visual_state(self):
        session = self._current_session()
        if session and self._pending_auto_bind_session_id == session.session_id:
            return "pending_bind"
        if not session:
            return (
                "unbound_required"
                if self._bind_each_chat_to_page
                else "unbound_optional"
            )
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._remote_bind_state(remote) == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return "waiting_bound_reopen"
        if not remote.get("enabled"):
            return (
                "unbound_required"
                if self._bind_each_chat_to_page
                else "unbound_optional"
            )
        list_state = self._session_bind_list_state(session, self._last_bridge_status)
        if list_state == "bound_online":
            return "bound_online"
        if list_state == "prebound_home":
            return "prebound_home"
        if list_state in (
            "waiting_home",
            "waiting_conversation_created",
            "waiting_bound_conversation",
        ):
            return "pending_bind"
        if list_state == "unbound":
            return (
                "unbound_required"
                if self._bind_each_chat_to_page
                else "unbound_optional"
            )
        if list_state == "bind_mismatch":
            return "bound_offline"
        return "bound_offline"

    def _log_chat_area_style(self, state):
        session = self._current_session()
        session_id = (session.session_id if session else "") or "-"
        status = self._last_bridge_status or {}
        bound_info, resolved_bound_state, _bound_reason = self._resolve_bound_page_info(
            status=status
        )
        bound_client_id = ((bound_info or {}).get("client_id") or "").strip()
        active_client_id = (self._tm_summary_for_session(session).get("active_client_id") or "").strip()
        active_info = self._client_info_by_id(active_client_id, status=status)
        active_page_syncable = bool(self._tm_client_sync_profile(active_info).get("syncable"))
        if not bound_client_id:
            bound_state = "unbound"
        else:
            bound_state = "online" if resolved_bound_state == "online" else "offline"
        active_matches_bound = bool(
            bound_client_id and active_client_id and active_client_id == bound_client_id
        )
        style = "yellow"
        if state in ("bound_online", "prebound_home"):
            style = "green"
        elif state == "bound_offline":
            style = "red"
        self._append_log(
            "[CHAT_AREA_STYLE] "
            f"session_id={session_id} "
            f"bound_client={bound_client_id or '-'} "
            f"bound_state={bound_state} "
            f"active_client={active_client_id or '-'} "
            f"active_matches_bound={'true' if active_matches_bound else 'false'} "
            f"active_page_syncable={'true' if active_page_syncable else 'false'} "
            f"style={style}"
        )

    def _apply_chat_bind_visual_state(self):
        state = self._current_bind_visual_state()
        self._log_chat_area_style(state)
        last_state = getattr(self, "_last_chat_bind_visual_state", None)
        if state == last_state:
            return

        self._append_log(f"[CHAT_BIND_VISUAL] old={last_state} new={state}")
        self._last_chat_bind_visual_state = state

        widgets = []
        if hasattr(self, "_chat_panel"):
            widgets.append(self._chat_panel)
        if hasattr(self, "chat_scroll"):
            widgets.append(self.chat_scroll)
        if hasattr(self, "chat_container"):
            widgets.append(self.chat_container)
        for widget in widgets:
            old = widget.property("bindState")
            if old == state:
                continue
            widget.setProperty("bindState", state)
            style = widget.style()
            style.unpolish(widget)
            style.polish(widget)
            widget.update()
    def _update_bound_page_display(self, summary=None):
        summary = summary or self._tm_summary_for_session()
        status = self._last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bind_text = "当前对话：未绑定"
        bind_chip = "warn"
        tooltip_lines = []
        relation_line = "绑定网页：未绑定"
        bound_info, bound_state, bound_reason = self._resolve_bound_page_info(status=status)
        if remote.get("enabled"):
            url = (remote.get("conversation_url") or remote.get("url") or "").strip()
            client_id = (remote.get("client_id") or "").strip()
            conv_id = (remote.get("conversation_id") or "").strip() or parse_conversation_id(url)
            if bound_state == "online":
                bind_text = "当前对话：已绑定在线"
                bind_chip = "ok"
                if bound_reason == "matched_by_conversation" and (
                    (bound_info.get("client_id") or "").strip() != client_id
                ):
                    relation_line = self._full_page_relation_label(
                        "绑定网页",
                        bound_info,
                        state_text="已绑定在线",
                        note_text="已按同会话自动匹配",
                    )
                else:
                    relation_line = self._full_page_relation_label(
                        "绑定网页",
                        bound_info,
                        state_text="已绑定在线",
                    )
            elif bound_state == "offline":
                bind_text = "当前对话：已绑定离线"
                bind_chip = "error"
                relation_line = self._full_page_relation_label(
                    "绑定网页",
                    bound_info,
                    state_text="已绑定离线",
                )
            else:
                bind_text = "当前对话：未绑定"
                bind_chip = "warn"
            tooltip_lines = [
                f"URL: {((bound_info or {}).get('page_url') or url or '-').strip() or '-'}",
                f"client_id: {((bound_info or {}).get('client_id') or client_id or '-').strip() or '-'}",
                f"conversation_id: {self._client_conversation_id(bound_info) or conv_id or '-'}",
                f"online: {'yes' if bound_state == 'online' else 'no'}",
                f"syncable: {'yes' if bool(bound_info and self._tm_client_sync_profile(bound_info).get('syncable')) else 'no'}",
                f"last_seen: {self._format_last_seen_ago((bound_info or {}).get('last_seen'))}",
            ]
        else:
            tooltip_lines = ["URL: -", "client_id: -", "conversation_id: -", "bind_state: unbound"]

        bound_url = (
            remote.get("conversation_url")
            or remote.get("url")
            or ""
        ).strip()

        bound_conversation_id = (
            remote.get("conversation_id")
            or parse_conversation_id(bound_url)
            or ""
        ).strip()

        if isinstance(bound_info, dict):
            if not bound_url:
                bound_url = (
                    bound_info.get("page_url")
                    or bound_info.get("url")
                    or bound_info.get("conversation_url")
                    or ""
                ).strip()
            if not bound_conversation_id:
                bound_conversation_id = (self._client_conversation_id(bound_info) or "").strip()

        current_info = self._pick_current_page_client_info(status)
        current_client_id = ""
        if isinstance(current_info, dict):
            current_client_id = (current_info.get("client_id") or "").strip()

        bound_client_id = ""
        if isinstance(bound_info, dict):
            bound_client_id = (bound_info.get("client_id") or "").strip()
        else:
            bound_client_id = (remote.get("client_id") or "").strip()

        if remote.get("enabled"):
            tooltip_lines.append(f"bound_url: {bound_url or '-'}")
            if current_client_id:
                tooltip_lines.append(f"current_client_id: {current_client_id}")
                is_bound_page = bool(
                    bound_client_id and current_client_id == bound_client_id
                )
                tooltip_lines.append(
                    f"当前选中页是绑定页: {'yes' if is_bound_page else 'no'}"
                )
            if (
                current_client_id
                and bound_client_id
                and current_client_id != bound_client_id
            ):
                tooltip_lines.append(
                    f"注意：当前选中页不是绑定页，current_client_id={current_client_id}"
                )

        can_open_bound_page = bool(
            remote.get("enabled")
            and (bound_url or bound_conversation_id)
        )

        flash_client_id = ""
        if isinstance(bound_info, dict):
            flash_client_id = (bound_info.get("client_id") or "").strip()
        if not flash_client_id:
            flash_client_id = (remote.get("client_id") or "").strip()

        can_flash_bound_page = bool(remote.get("enabled") and flash_client_id)

        self.tm_bound_page_label.setText(bind_text)
        self._refresh_status_chip(self.tm_bound_page_label, bind_chip)
        self.tm_bound_page_label.setToolTip("\n".join(tooltip_lines))
        if hasattr(self, "tm_bound_page_relation_label"):
            self.tm_bound_page_relation_label.setText(relation_line)
            self.tm_bound_page_relation_label.setToolTip("\n".join(tooltip_lines))

        self._set_chat_open_bound_enabled(can_open_bound_page)
        self._set_chat_flash_bound_enabled(can_flash_bound_page)

        if hasattr(self, "chat_open_bound_btn"):
            if can_open_bound_page:
                open_target = bound_url or f"https://chatgpt.com/c/{bound_conversation_id}"
                self.chat_open_bound_btn.setToolTip(
                    "打开当前对话绑定的 ChatGPT 页面\n"
                    f"conversation_id: {bound_conversation_id or '-'}\n"
                    f"url: {open_target or '-'}"
                )
            else:
                self.chat_open_bound_btn.setToolTip(
                    "当前对话没有可打开的绑定页面。请先绑定当前页面。"
                )

        if hasattr(self, "flash_bound_page_btn"):
            if can_flash_bound_page:
                self.flash_bound_page_btn.setToolTip(
                    "定位当前对话已在线的绑定页，让对应浏览器标签页闪烁。"
                )
            else:
                self.flash_bound_page_btn.setToolTip(
                    "当前绑定页不在线，无法定位闪烁；可以先点击“打开绑定页面”。"
                )

        self._apply_chat_bind_visual_state()
        self._update_sync_target_display()
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()

    def _set_chat_open_bound_enabled(self, enabled):
        if hasattr(self, "chat_open_bound_btn"):
            self.chat_open_bound_btn.setEnabled(bool(enabled))
    def _set_chat_flash_bound_enabled(self, enabled):
        if hasattr(self, "flash_bound_page_btn"):
            self.flash_bound_page_btn.setEnabled(bool(enabled))
    def _bind_page_to_session(
        self,
        session,
        client_info,
        silent=False,
        allow_existing_conversation_for_new_session=False,
    ):
        if not isinstance(client_info, dict):
            client_info = {
                "client_id": str(client_info or "").strip(),
                "page_url": "",
            }
        if not allow_existing_conversation_for_new_session:
            rejected, reject_msg = self._reject_bind_existing_conversation_for_new_session(
                session, client_info
            )
            if rejected:
                if not silent:
                    self._add_system_message(reject_msg)
                return False
        page_url = (
            client_info.get("page_url")
            or client_info.get("url")
            or client_info.get("conversation_url")
            or ""
        ).strip()
        page_type = (client_info.get("page_type") or "").strip()
        conversation_id = (
            client_info.get("conversation_id")
            or parse_conversation_id(page_url)
            or ""
        ).strip()
        if not page_type:
            if conversation_id:
                page_type = "conversation"
            elif page_url and self._is_bindable_chatgpt_url(page_url):
                try:
                    path = urlparse(page_url).path or "/"
                    page_type = "home" if path in ("", "/") else "conversation"
                except ValueError:
                    page_type = ""
        if page_type == "home" or (not conversation_id and page_type != "conversation"):
            return self._prebound_home_bind_to_session(session, client_info, silent=silent)
        return self._bind_conversation_to_session(
            session,
            client_info,
            silent=silent,
            allow_existing_conversation_for_new_session=allow_existing_conversation_for_new_session,
        )
    def _resolve_active_bind_target_client(self, status):
        status = status or {}
        clients = status.get("tampermonkey_clients") or []
        online_map = {}
        for item in clients:
            if not isinstance(item, dict):
                continue
            client_id = (item.get("client_id") or "").strip()
            if not client_id or not item.get("online"):
                continue
            online_map[client_id] = item
        for key in ("tampermonkey_client_id", "active_client_id", "current_client_id"):
            candidate_id = (status.get(key) or "").strip()
            if candidate_id and candidate_id in online_map:
                return dict(online_map[candidate_id])
        best_focus_item = None
        best_focus_at = 0.0
        for item in online_map.values():
            if not isinstance(item, dict):
                continue
            if item.get("has_focus"):
                return dict(item)
            focus_at = float(item.get("last_focus_at") or 0)
            if focus_at > best_focus_at:
                best_focus_at = focus_at
                best_focus_item = item
        if isinstance(best_focus_item, dict):
            return dict(best_focus_item)
        return None
    def _on_bind_current_page(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return
        status = server.get_bridge_status()
        if not status.get("tampermonkey_online"):
            self._add_system_message("油猴未在线，无法绑定当前页面。")
            self._append_log("[BIND_CURRENT_PAGE][FAILED] reason=tampermonkey_offline")
            return
        client_info = self._resolve_active_bind_target_client(status)
        if not client_info:
            self._set_tm_action_hint(
                "未检测到当前活跃的 ChatGPT 页面，请先切换到目标 ChatGPT 页面后再点击绑定当前页面。"
            )
            self._add_system_message(
                "未检测到当前活跃的 ChatGPT 页面，请先切换到目标 ChatGPT 页面后再点击绑定当前页面。"
            )
            self._append_log("[BIND_CURRENT_PAGE][FAILED] reason=no_active_chatgpt_page")
            return
        if client_info:
            client_info["page_url"] = (
                client_info.get("page_url")
                or (status.get("tampermonkey_page_url") or "").strip()
            )
        session = self._ensure_current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip() or "-"
        client_id = (client_info.get("client_id") or "").strip() or "-"
        conversation_id = self._client_conversation_id(client_info) or "-"
        page_url = (client_info.get("page_url") or "").strip() or "-"
        self._append_log(
            "[BIND_CURRENT_PAGE][START] "
            f"session_id={session.session_id} "
            f"old_client_id={old_client_id} "
            f"new_client_id={client_id} "
            f"conversation_id={conversation_id} "
            f"page_url={page_url}"
        )
        if self._bind_page_to_session(
            session,
            client_info,
            allow_existing_conversation_for_new_session=True,
        ):
            replaced = old_client_id != "-" and old_client_id != client_id
            if replaced:
                self._set_tm_action_hint("当前对话已重新绑定")
                self._append_log(
                    "[BIND_CURRENT_PAGE][REPLACE] "
                    f"session_id={session.session_id} "
                    f"old_client_id={old_client_id} "
                    f"new_client_id={client_id}"
                )
            else:
                self._set_tm_action_hint("当前对话已绑定当前页面")
            self._append_log(
                "[BIND_CURRENT_PAGE][DONE] "
                f"session_id={session.session_id} "
                f"old_client_id={old_client_id} "
                f"new_client_id={client_id} "
                f"conversation_id={conversation_id} "
                f"page_url={page_url}"
            )
            self._set_tm_action_hint("同步中...")
            self._sync_after_manual_bind_existing_conversation(session, client_info)
            return
        self._append_log("[BIND_CURRENT_PAGE][FAILED] reason=bind_page_to_session_returned_false")

    def _on_bind_selected_tm_page(self):
        """@deprecated 无 UI 按钮绑定；已由「绑定当前页面」(_on_bind_current_page) 替代。"""
        self._append_log(
            "[BIND][SELECTED_PAGE][DEPRECATED_UI_ENTRY] "
            "此函数已不再作为 UI 入口，仅保留兼容。"
        )
        client_id = self._selected_tm_page_client_id()
        if not client_id:
            if hasattr(self, "tm_page_combo") and self.tm_page_combo.count() == 0:
                hint = "暂无已知 ChatGPT 页面，请先打开页面并点击「刷新状态」。"
            else:
                hint = "请先在页面下拉框中选择要绑定的页面。"
            self._set_tm_action_hint(hint)
            self._append_log("[绑定] 未选中页面，已取消。")
            return
        client_info = self._client_info_from_status(client_id)
        if not client_info:
            self._set_tm_action_hint("未找到选中页面的信息，请先刷新页面列表。")
            self._append_log(f"[绑定] 未找到 client_id={client_id} 的页面信息。")
            return
        row = self.tm_pages_table.currentRow()
        if row >= 0:
            row_client = self.tm_pages_table.item(row, 1)
            if row_client and row_client.text().strip() == client_id:
                url_item = self.tm_pages_table.item(row, 8)
                if url_item:
                    full_url = (url_item.toolTip() or url_item.text() or "").strip()
                    if full_url and full_url != "-":
                        client_info["page_url"] = full_url
        session = self._ensure_current_session()
        selected_profile = self._tm_client_sync_profile(client_info)
        self._append_log(
            "[BIND][SELECTED_PAGE] "
            f"currentClientId={(self._last_bridge_status.get('tampermonkey_client_id') or '-') if isinstance(self._last_bridge_status, dict) else '-'} "
            f"boundClientId={(self._session_bound_client_id() or '-')} "
            f"selectedClientId={client_id or '-'} "
            f"conversationId={(self._client_conversation_id(client_info) or '-')} "
            f"visible={selected_profile.get('visibility', '-')} "
            f"activity={selected_profile.get('activity', '-')} "
            f"heartbeatAge={selected_profile.get('heartbeat_age', -1)} "
            f"lastSeenAge={selected_profile.get('last_seen_age', -1)} "
            f"syncable={bool(selected_profile.get('syncable'))}"
        )
        if self._bind_page_to_session(
            session,
            client_info,
            allow_existing_conversation_for_new_session=True,
        ):
            self._set_tm_action_hint(f"已绑定页面 {client_id} 到当前对话。")
            self._set_tm_action_hint("同步中...")
            self._sync_after_manual_bind_existing_conversation(session, client_info)
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

        is_current = session.session_id == self._current_session_id
        if is_current:
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
            role = (item.get("role") or "").strip()
            if role not in ("user", "assistant"):
                continue
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
            return False, "绑定 client_id 与回传页面不一致"

        report_instance = (payload.get("page_instance_id") or "").strip()
        bound_instance = (remote.get("page_instance_id") or "").strip()
        if bound_instance and report_instance and bound_instance != report_instance:
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
    def _handle_conversation_snapshot_inbound(self, item):
        payload = item.get("payload") or {}
        message_id = (item.get("message_id") or "").strip()
        pending_sync = {}
        if message_id:
            pending_sync = dict(
                getattr(self, "_pending_sync_requests", {}).pop(message_id, {}) or {}
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
        if not session_id:
            self._append_log(
                "[SYNC_CONVERSATION][FAILED] reason=missing_session_id "
                f"session_id=- conversation_id={conversation_id or '-'} "
                f"message_id={message_id or '-'}",
                echo=True,
            )
            self._set_tm_action_hint("同步网页对话失败：缺少 session_id。")
            return

        session = self._sessions.get(session_id)
        if session is None:
            self._append_log(
                f"[SYNC_CONVERSATION][FAILED] reason=session_not_found "
                f"session_id={session_id} conversation_id={conversation_id or '-'} "
                f"message_id={message_id or '-'}",
                echo=True,
            )
            self._set_tm_action_hint("同步网页对话失败：未找到对应对话。")
            return

        ok, reason = self._validate_sync_conversation_binding(session, payload)
        if not ok:
            self._append_log(
                f"[SYNC_CONVERSATION][FAILED] session_id={session_id} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={message_id or '-'} reason={reason}",
                echo=True,
            )
            if session.session_id == self._current_session_id:
                self._set_tm_action_hint(f"同步失败：{reason}")
            return

        mode = (payload.get("mode") or self._sync_conversation_mode or "merge").strip()
        count = len(web_messages)
        if count <= 0:
            self._append_log(
                "[SYNC_CONVERSATION][FAILED] reason=empty_messages_from_tm "
                f"session_id={session_id or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={message_id or '-'}",
                echo=True,
            )
            if session.session_id == self._current_session_id:
                self._set_tm_action_hint("绑定成功，但同步失败：网页端没有回传有效消息。")
            return
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        status = self._last_bridge_status or {}
        current_client_id = (status.get("tampermonkey_client_id") or "").strip()
        current_info = self._client_info_by_id(current_client_id, status=status)
        selected_client_id = self._selected_tm_page_client_id()
        selected_info = self._client_info_by_id(selected_client_id, status=status)
        bound_client_id = (remote.get("client_id") or "").strip()
        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(remote.get("conversation_url") or "")
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
            if session.session_id == self._current_session_id:
                self._set_tm_action_hint(f"同步失败：{apply_reason}")
            return
    def _enqueue_sync_conversation_command(
        self, session, request_reason="manual_button", delay_ms=0
    ):
        if not getattr(self, "_sync_full_conversation_enabled", True):
            return False, "已在设置中关闭「允许从网页同步完整对话」"

        if session is None:
            return False, "当前没有选中的对话"

        if not server.is_server_running():
            return False, "请先启动服务"

        status = server.get_bridge_status()
        target, reason = self.resolve_sync_target_for_current_chat(
            session, status=status
        )
        if not target:
            return False, reason or "未找到可同步的 ChatGPT 页面，请打开或刷新对应的 ChatGPT 对话页。"
        client_id = (target.get("client_id") or "").strip()
        conversation_id = (target.get("conversation_id") or "").strip()
        page_instance_id = (target.get("page_instance_id") or "").strip()
        self._set_last_sync_target(
            {
                "client_id": client_id,
                "conversation_id": conversation_id,
                "syncable": bool(target.get("syncable")),
                "source": target.get("source") or "-",
            }
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

        payload = {
            "mode": mode,
            "max_messages": max_messages,
            "session_id": session.session_id,
            "conversation_id": conversation_id,
            "target_client_id": client_id,
            "source": request_reason or "manual",
            "request_reason": request_reason or "manual",
        }

        def _send():
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
            if queued:
                message_id = ""
                if isinstance(queued, dict):
                    message_id = (queued.get("id") or "").strip()
                if message_id:
                    if not hasattr(self, "_pending_sync_requests"):
                        self._pending_sync_requests = {}
                    self._pending_sync_requests[message_id] = {
                        "session_id": session.session_id,
                        "conversation_id": conversation_id,
                        "target_client_id": client_id,
                    }
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
                if session.session_id == self._current_session_id:
                    self._set_tm_action_hint("同步失败：命令入队失败。")

        if delay_ms > 0:
            QTimer.singleShot(delay_ms, _send)
        else:
            _send()
        return True, ""
    def resolve_sync_target_for_current_chat(self, session, status=None):
        status = status or self._last_bridge_status or {}
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bound_client_id = (remote.get("client_id") or "").strip()
        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(
                remote.get("conversation_url") or ""
            )
        current_client_id = (status.get("tampermonkey_client_id") or "").strip()
        selected_client_id = self._selected_tm_page_client_id()
        current_info = self._client_info_by_id(current_client_id, status=status)
        selected_info = self._client_info_by_id(selected_client_id, status=status)
        current_conversation_id = self._client_conversation_id(current_info)
        selected_conversation_id = self._client_conversation_id(selected_info)
        log_context = {
            "currentClientId": current_client_id or "-",
            "currentConversationId": current_conversation_id or "-",
            "boundClientId": bound_client_id or "-",
            "boundConversationId": bound_conversation_id or "-",
            "selectedClientId": selected_client_id or "-",
            "selectedConversationId": selected_conversation_id or "-",
            "targetClientId": "-",
            "targetConversationId": "-",
            "targetSyncable": False,
        }
        self._append_log(
            "[SYNC][TARGET_RESOLVE][START] "
            + self._sync_log_context_fields(log_context, reason="start")
        )
        if not list(self._iter_tm_clients(status, online_only=True)):
            self._append_log(
                "[SYNC][TARGET_RESOLVE][FAILED] "
                + self._sync_log_context_fields(log_context, reason="no_online_pages")
            )
            return None, "没有任何在线 ChatGPT 页面"

        if bound_client_id:
            bound_info = self._client_info_by_id(bound_client_id, status=status)
            bound_profile = self._tm_client_sync_profile(
                bound_info,
                expected_client_id=bound_client_id,
                expected_conversation_id=bound_conversation_id,
            )
            if bound_profile.get("syncable"):
                log_context["targetClientId"] = bound_client_id
                log_context["targetConversationId"] = (
                    bound_conversation_id or self._client_conversation_id(bound_info) or "-"
                )
                log_context["targetSyncable"] = True
                self._append_log(
                    "[SYNC][TARGET_RESOLVE][BOUND_OK] "
                    + self._sync_log_context_fields(log_context, reason="bound_syncable")
                )
                return {
                    "client_id": bound_client_id,
                    "conversation_id": (
                        bound_conversation_id
                        or self._client_conversation_id(bound_info)
                        or ""
                    ),
                    "page_instance_id": self._tm_page_instance_id(bound_info),
                    "syncable": True,
                    "source": "bound",
                    "log_context": log_context,
                }, "bound_ok"
            self._append_log(
                "[SYNC][TARGET_RESOLVE][BOUND_STALE] "
                + self._sync_log_context_fields(
                    log_context, reason=bound_profile.get("reason") or "bound_not_syncable"
                )
            )
            if bound_conversation_id:
                same_conv = self._pick_best_client_for_conversation(
                    bound_conversation_id, status=status
                )
                same_conv_profile = self._tm_client_sync_profile(
                    same_conv, expected_conversation_id=bound_conversation_id
                )
                if same_conv_profile.get("syncable"):
                    self._bind_page_to_session(session, same_conv, silent=True)
                    target_client_id = self._tm_client_id(same_conv)
                    target_conversation_id = (
                        self._client_conversation_id(same_conv) or bound_conversation_id
                    )
                    log_context["targetClientId"] = target_client_id or "-"
                    log_context["targetConversationId"] = target_conversation_id or "-"
                    log_context["targetSyncable"] = True
                    self._append_log(
                        "[SYNC][TARGET_RESOLVE][AUTO_REBIND_BY_CONV] "
                        + self._sync_log_context_fields(
                            log_context, reason="same_conversation_rebind"
                        )
                    )
                    return {
                        "client_id": target_client_id,
                        "conversation_id": target_conversation_id,
                        "page_instance_id": self._tm_page_instance_id(same_conv),
                        "syncable": True,
                        "source": "auto_rebind_by_conv",
                        "log_context": log_context,
                    }, "auto_rebind_by_conv"

        if not bound_conversation_id and current_info:
            current_profile = self._tm_client_sync_profile(current_info)
            if current_profile.get("syncable"):
                self._bind_page_to_session(session, current_info, silent=True)
                log_context["targetClientId"] = current_client_id or "-"
                log_context["targetConversationId"] = (
                    self._client_conversation_id(current_info) or "-"
                )
                log_context["targetSyncable"] = True
                self._append_log(
                    "[SYNC][TARGET_RESOLVE][USE_CURRENT_PAGE] "
                    + self._sync_log_context_fields(log_context, reason="current_syncable")
                )
                return {
                    "client_id": current_client_id,
                    "conversation_id": self._client_conversation_id(current_info) or "",
                    "page_instance_id": self._tm_page_instance_id(current_info),
                    "syncable": True,
                    "source": "current_page",
                    "log_context": log_context,
                }, "use_current_page"

        if selected_info:
            selected_profile = self._tm_client_sync_profile(selected_info)
            if selected_profile.get("syncable"):
                self._bind_page_to_session(session, selected_info, silent=True)
                log_context["targetClientId"] = selected_client_id or "-"
                log_context["targetConversationId"] = (
                    self._client_conversation_id(selected_info) or "-"
                )
                log_context["targetSyncable"] = True
                self._append_log(
                    "[SYNC][TARGET_RESOLVE][USE_SELECTED_PAGE] "
                    + self._sync_log_context_fields(log_context, reason="selected_syncable")
                )
                return {
                    "client_id": selected_client_id,
                    "conversation_id": self._client_conversation_id(selected_info) or "",
                    "page_instance_id": self._tm_page_instance_id(selected_info),
                    "syncable": True,
                    "source": "selected_page",
                    "log_context": log_context,
                }, "use_selected_page"

        fail_reason = "not_found_syncable_target"
        if bound_conversation_id:
            fail_reason = "bound_conversation_not_found_or_not_syncable"
        self._append_log(
            "[SYNC][TARGET_RESOLVE][FAILED] "
            + self._sync_log_context_fields(log_context, reason=fail_reason)
        )
        return (
            None,
            "未找到可同步的 ChatGPT 页面，请打开或刷新对应的 ChatGPT 对话页。",
        )
    def _schedule_auto_sync_conversation(self, session, request_reason="auto"):
        if not getattr(self, "_sync_full_conversation_enabled", True):
            return
        delay = 800 if request_reason == "auto_after_reply" else 0
        self._enqueue_sync_conversation_command(
            session, request_reason=request_reason, delay_ms=delay
        )
    def _sync_bound_web_conversation(self, _checked=False):
        session = self._current_session()
        if session is None:
            self._add_system_message("当前没有选中的对话。")
            return
        if not getattr(self, "_sync_full_conversation_enabled", True):
            self._add_system_message(
                "已在设置中关闭「允许从网页同步完整对话」。"
            )
            return
        self._append_log(
            f"[SYNC_CONVERSATION][CLICK] session_id={session.session_id}", echo=True
        )
        self._set_tm_action_hint("同步中...")
        ok, reason = self._enqueue_sync_conversation_command(
            session, request_reason="manual_button"
        )
        if not ok and reason:
            self._set_tm_action_hint(f"同步失败：{reason}")
    def _session_bound_client_id(self):
        session = self._current_session()
        if not session:
            return ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return ""
        return (remote.get("client_id") or "").strip()

