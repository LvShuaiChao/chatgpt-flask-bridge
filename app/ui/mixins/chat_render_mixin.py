import html
import re
import time

from PyQt5.QtCore import QTimer

from app.constants import ASSISTANT_WAIT_TEXT
from app.utils.text_utils import format_ts


MAX_RENDER_MESSAGES_ON_SWITCH = 120
CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD = 32

_WAITING_ELAPSED_IN_HTML_RE = re.compile(
    r"((?:等待回复(?:\.\.\.|…)|等待 ChatGPT 回复(?:\.\.\.|…)))\s+\d{2}:\d{2}"
)


class ChatRenderMixin:
    def _chat_transcript_widget(self):
        return getattr(self, "chat_transcript", None)

    def _chat_scrollbar(self):
        transcript = self._chat_transcript_widget()
        if transcript is None:
            return None
        return transcript.verticalScrollBar()

    def _is_chat_near_bottom(self, threshold=CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD):
        bar = self._chat_scrollbar()
        if bar is None:
            return True
        return bar.maximum() - bar.value() <= max(0, int(threshold))

    def _scroll_chat_to_bottom_once(self):
        bar = self._chat_scrollbar()
        if bar is None:
            return
        bar.setValue(bar.maximum())

    def _schedule_scroll_chat_to_bottom(self):
        if getattr(self, "_chat_scroll_to_bottom_pending", False):
            return
        self._chat_scroll_to_bottom_pending = True

        def run():
            self._chat_scroll_to_bottom_pending = False
            self._scroll_chat_to_bottom_once()

        QTimer.singleShot(0, run)

    def _capture_chat_scroll_ratio(self):
        bar = self._chat_scrollbar()
        if bar is None:
            return None
        max_val = bar.maximum()
        if max_val <= 0:
            return 0.0
        return bar.value() / float(max_val)

    def _restore_chat_scroll_ratio(self, ratio):
        if ratio is None:
            return
        bar = self._chat_scrollbar()
        if bar is None:
            return
        max_val = bar.maximum()
        bar.setValue(int(max(0.0, min(1.0, float(ratio))) * max_val))

    def _resolve_chat_scroll_policy(self, *, scroll_policy=None, force_bottom=None):
        if scroll_policy is not None:
            return scroll_policy
        if force_bottom is None:
            return "auto_if_near_bottom"
        return "force_bottom" if force_bottom else "auto_if_near_bottom"

    def _apply_chat_scroll_policy(
        self,
        scroll_policy,
        *,
        was_near_bottom=None,
        scroll_ratio=None,
    ):
        policy = (scroll_policy or "auto_if_near_bottom").strip()
        if policy == "force_bottom":
            self._schedule_scroll_chat_to_bottom()
            return
        if policy == "auto_if_near_bottom":
            near = (
                was_near_bottom
                if was_near_bottom is not None
                else self._is_chat_near_bottom()
            )
            if near:
                self._schedule_scroll_chat_to_bottom()
            return
        if policy == "preserve":
            if scroll_ratio is not None:
                ratio = scroll_ratio

                def restore():
                    self._restore_chat_scroll_ratio(ratio)

                QTimer.singleShot(0, restore)
            return
        self._append_log(
            "[CHAT_SCROLL][UNKNOWN_POLICY] "
            f"policy={policy!r}",
            echo=False,
        )

    @staticmethod
    def _format_ts(ts):
        return format_ts(ts)

    def _format_message_ts(self, created_at):
        if not getattr(self, "_show_timestamp", True):
            return ""
        return format_ts(created_at)

    def _visible_messages_for_render(self, session):
        visible = [
            message
            for message in getattr(session, "messages", [])
            if getattr(message, "visible_in_chat", True)
        ]
        if len(visible) <= MAX_RENDER_MESSAGES_ON_SWITCH:
            return visible, 0
        skipped = len(visible) - MAX_RENDER_MESSAGES_ON_SWITCH
        return visible[-MAX_RENDER_MESSAGES_ON_SWITCH:], skipped

    def _clear_chat_widgets(self):
        transcript = self._chat_transcript_widget()
        if transcript is not None:
            transcript.clear()
            transcript.setVisible(False)

    def _show_empty_chat_state(self):
        transcript = self._chat_transcript_widget()
        if transcript is None:
            return
        transcript.setHtml(
            "<html><body style='background:#f7f8fa;color:#9ca3af;"
            "font-family:Microsoft YaHei,Segoe UI,sans-serif;text-align:center;"
            "padding-top:42px;'>暂无消息</body></html>"
        )
        transcript.setVisible(True)

    def _html_escape(self, value):
        return html.escape(str(value or ""), quote=True)

    def _message_text_html(self, message, session=None):
        text = self._message_plain_text(message, session=session)
        text = self._html_escape(text)
        return text.replace("\n", "<br>")

    def _message_status_html(self, message, *, align="left"):
        ts = self._html_escape(self._format_message_ts(getattr(message, "created_at", 0)))
        status = self._html_escape(message.ui_status or "")
        detail = self._html_escape(getattr(message, "detail", "") or "")

        parts = []
        if ts:
            parts.append(ts)
        if status:
            parts.append(status)
        if detail:
            parts.append(detail)

        if not parts:
            return ""

        text = " · ".join(parts)
        return (
            f"<div style='color:#9ca3af;font-size:11px;margin-bottom:4px;"
            f"text-align:{align};'>{text}</div>"
        )

    def _role_badge_html(self, text, bg):
        text = self._html_escape(text)
        return (
            "<table border='0' cellspacing='0' cellpadding='0' width='34'>"
            "<tr>"
            f"<td width='34' height='30' align='center' valign='middle' bgcolor='{bg}' "
            "style='color:#ffffff;font-size:12px;font-weight:bold;'>"
            f"{text}"
            "</td>"
            "</tr>"
            "</table>"
        )

    def _assistant_bubble_width(self, message, session=None):
        text = self._message_plain_text(message, session=session).strip()
        text_len = len(text)

        if text_len <= 20:
            return 280
        if text_len <= 80:
            return 520
        return 620

    def _bubble_table_html(self, content, *, bg, border, align="left", width=None):
        width_attr = ""
        if width:
            width_attr = f" width='{int(width)}'"

        return (
            f"<table align='{align}'{width_attr} border='0' cellspacing='0' cellpadding='0'>"
            "<tr>"
            f"<td bgcolor='{bg}' "
            f"style='border:1px solid {border};"
            "padding:8px 12px;"
            "font-size:13px;"
            "line-height:1.55;"
            "color:#111827;'>"
            f"{content}"
            "</td>"
            "</tr>"
            "</table>"
        )

    def _render_session_chat(
        self,
        session,
        *,
        scroll_policy=None,
        force_bottom=None,
    ):
        if session is None:
            return

        current_id = (getattr(self, "_current_session_id", "") or "").strip()
        if session.session_id != current_id:
            return

        self._render_chat_transcript(
            session,
            scroll_policy=scroll_policy,
            force_bottom=force_bottom,
        )
        if hasattr(self, "_refresh_current_conversation_stats"):
            self._refresh_current_conversation_stats(session)
        self._append_log(
            "[CHAT_RENDER][DONE] "
            f"session_id={session.session_id} "
            f"count={len(getattr(session, 'messages', []) or [])} "
            "renderer=transcript",
            echo=False,
        )

    def _schedule_current_chat_render(self, reason="", *, delay_ms=0, force_bottom=False):
        """合并短时间内的重复聊天区渲染请求。"""
        pending = getattr(self, "_chat_render_schedule_pending", None)
        if pending is not None:
            if force_bottom:
                pending["force_bottom"] = True
            self._append_log(
                "[CHAT_RENDER][SKIP_PENDING] "
                f"reason={reason or '-'} "
                f"pending_reason={pending.get('reason') or '-'}",
                echo=False,
            )
            return

        self._append_log(
            "[CHAT_RENDER][SCHEDULE] "
            f"reason={reason or '-'} "
            f"delay_ms={delay_ms} "
            f"force_bottom={force_bottom}",
            echo=False,
        )
        self._chat_render_schedule_pending = {
            "reason": reason or "",
            "force_bottom": bool(force_bottom),
        }

        def _execute_scheduled_chat_render():
            slot = getattr(self, "_chat_render_schedule_pending", None)
            self._chat_render_schedule_pending = None
            if not slot:
                return
            exec_reason = slot.get("reason") or reason or ""
            exec_force = bool(slot.get("force_bottom"))
            self._append_log(
                "[CHAT_RENDER][EXECUTE] "
                f"reason={exec_reason or '-'} "
                f"force_bottom={exec_force}",
                echo=False,
            )
            if hasattr(self, "_render_current_chat_messages"):
                self._render_current_chat_messages(
                    force_bottom=exec_force,
                    reason=exec_reason,
                )

        QTimer.singleShot(max(0, int(delay_ms)), _execute_scheduled_chat_render)

    def _flush_pending_chat_render(self):
        pending = getattr(self._bridge_msg, "pending_chat_render", None) or {}
        session_id = (pending.get("session_id") or "").strip()
        self._bridge_msg.pending_chat_render = None
        if session_id and session_id in self._sessions:
            pending_policy = pending.get("scroll_policy")
            if pending_policy:
                scroll_policy = pending_policy
            elif pending.get("force_bottom", True):
                scroll_policy = "force_bottom"
            else:
                scroll_policy = "auto_if_near_bottom"
            self._render_session_chat(
                self._sessions[session_id],
                scroll_policy=scroll_policy,
            )

    def _log_chat_render_ui_state(self, session, messages):
        transcript = self._chat_transcript_widget()
        scroll_value = "-"
        scroll_max = "-"
        if transcript is not None:
            bar = transcript.verticalScrollBar()
            if bar is not None:
                scroll_value = bar.value()
                scroll_max = bar.maximum()
        self._append_log(
            "[CHAT_RENDER][UI_STATE] "
            f"session_id={(session.session_id if session else '-') } "
            f"message_count={len(messages or [])} "
            f"renderer=transcript "
            f"transcript_visible={transcript.isVisible() if transcript is not None else '-'} "
            f"scroll_value={scroll_value} "
            f"scroll_max={scroll_max}",
            echo=False,
        )

    def _add_system_message(self, text):
        text = (text or "").strip()
        if not text:
            return
        now = time.time()
        last_text = (getattr(self, "_last_system_message_text", "") or "").strip()
        last_at = float(getattr(self, "_last_system_message_at", 0) or 0)
        if last_text == text and (now - last_at) < 5.0:
            return
        self._last_system_message_text = text
        self._last_system_message_at = now
        session = self._ensure_current_session()
        self._append_session_message(session, "system", text)
        if session.session_id == self._current_session_id:
            self._render_session_chat(session, scroll_policy="force_bottom")
        self._refresh_session_list(select_session_id=session.session_id)
        self._schedule_save_sessions_to_disk()

    def _add_system_message_once(self, text, dedupe_seconds=10):
        text = (text or "").strip()
        if not text:
            return
        now = time.time()
        key = (getattr(self, "_current_session_id", "") or "", text)
        cache = getattr(self, "_system_message_once_cache", None)
        if not isinstance(cache, dict):
            cache = {}
            self._system_message_once_cache = cache
        last_at = float(cache.get(key) or 0)
        if (now - last_at) < max(0.0, float(dedupe_seconds or 0)):
            return
        cache[key] = now
        self._add_system_message(text)

    def _log_chat_update_assistant(self, session, turn_id, status, text_len, message_id=""):
        self._append_log(
            "[GUI][CHAT][UPDATE_ASSISTANT] "
            f"session_id={session.session_id} turn_id={turn_id} "
            f"message_id={message_id or '-'} status={status} text_len={text_len}"
        )

    def _update_session_assistant(
        self, session, turn_id, text=None, status=None, role=None, error=False
    ):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        if text is not None:
            target.content = text
        if status is not None:
            target.ui_status = status
        if role is not None:
            target.role = role
        if error:
            target.role = "error"
        session.updated_at = time.time()
        if hasattr(self, "_invalidate_session_runtime"):
            self._invalidate_session_runtime(session, reason="update_session_assistant")
        return True

    def _apply_reply_ui_change(self, session):
        if hasattr(self, "_sync_session_waiting_timer"):
            self._sync_session_waiting_timer(session, reason="reply_ui_change")
        if session.session_id == self._current_session_id:
            self._render_session_chat(session, scroll_policy="auto_if_near_bottom")
        else:
            self._mark_session_pending(session.session_id)
        if hasattr(self, "_update_session_list_item_runtime"):
            self._update_session_list_item_runtime(
                session,
                selected=(session.session_id == getattr(self, "_current_session_id", "")),
            )
        else:
            self._refresh_session_list(select_session_id=self._current_session_id)
        self._schedule_save_sessions_to_disk()
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
        if hasattr(self, "_refresh_current_conversation_stats"):
            self._refresh_current_conversation_stats(session)

    def _set_reply_text(self, session, turn_id, text, status_text="已回复"):
        target = self._find_assistant_by_turn(session, turn_id)
        if not self._update_session_assistant(
            session, turn_id, text=text, status=status_text, role="assistant"
        ):
            return
        msg_id = target.message_id if target else ""
        self._log_chat_update_assistant(session, turn_id, status_text, len(text or ""), msg_id)
        self._apply_reply_ui_change(session)

    def _set_reply_error(self, session, turn_id, text, status_text="失败"):
        target = self._find_assistant_by_turn(session, turn_id)
        if not self._update_session_assistant(
            session, turn_id, text=text, status=status_text, role="error", error=True
        ):
            return
        msg_id = target.message_id if target else ""
        self._log_chat_update_assistant(session, turn_id, status_text, len(text or ""), msg_id)
        self._apply_reply_ui_change(session)

    def _assistant_message_is_waiting_placeholder(self, message):
        """判断 assistant 消息是否仍是等待占位"""
        from app.models import is_waiting_placeholder_message

        return is_waiting_placeholder_message(message)
    def _set_reply_waiting(self, session, turn_id):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        target.role = "assistant"
        target.content = ASSISTANT_WAIT_TEXT
        target.ui_status = "等待中"
        session.updated_at = time.time()
        if hasattr(self, "_mark_session_waiting_started"):
            self._mark_session_waiting_started(session, reason="set_reply_waiting")
        if session.session_id == self._current_session_id:
            self._render_session_chat(session, scroll_policy="force_bottom")
        if hasattr(self, "_update_session_list_item_runtime"):
            self._update_session_list_item_runtime(
                session,
                selected=(session.session_id == getattr(self, "_current_session_id", "")),
            )
        else:
            self._refresh_session_list(select_session_id=session.session_id)
        self._schedule_save_sessions_to_disk()
        return True

    def _patch_waiting_elapsed_in_transcript(self, session):
        return self._update_waiting_status_label(session)

    def _update_waiting_status_label(self, session):
        label = getattr(self, "waiting_status_label", None)
        if label is None:
            return False
        if session is None or not hasattr(self, "_session_is_waiting_reply"):
            label.clear()
            label.setVisible(False)
            return False
        if not self._session_is_waiting_reply(session):
            label.clear()
            label.setVisible(False)
            return False
        text = self._format_waiting_status_text("等待回复", session)
        if label.text() != text:
            label.setText(text)
        label.setVisible(bool(text))
        return True

    def _message_plain_text(self, message, session=None):
        if hasattr(self, "_message_render_text"):
            text, _clipped = self._message_render_text(message, session=session)
            return text
        return getattr(message, "text", "") or getattr(message, "content", "") or ""

    def _render_chat_transcript(
        self,
        session=None,
        *,
        scroll_policy=None,
        force_bottom=None,
    ):
        transcript = self._chat_transcript_widget()
        if transcript is None:
            return
        started_at = time.perf_counter()
        if session is None:
            session = self._current_session()
        policy = self._resolve_chat_scroll_policy(
            scroll_policy=scroll_policy,
            force_bottom=force_bottom,
        )
        was_near_bottom = self._is_chat_near_bottom()
        scroll_ratio = (
            self._capture_chat_scroll_ratio() if policy == "preserve" else None
        )
        messages, skipped = self._visible_messages_for_render(session) if session else ([], 0)
        if not messages:
            self._update_waiting_status_label(session)
            self._show_empty_chat_state()
            return
        fingerprint_rows = []
        for message in messages:
            if hasattr(self, "_visible_message_signature"):
                fingerprint_rows.append(self._visible_message_signature(message, session=session))
            else:
                fingerprint_rows.append(
                    (
                        (getattr(message, "message_id", "") or "").strip(),
                        (getattr(message, "role", "") or "").strip(),
                        getattr(message, "content", "") or "",
                        (getattr(message, "ui_status", "") or "").strip(),
                    )
                )
        chat_fingerprint = (
            (getattr(session, "session_id", "") or "").strip(),
            tuple(fingerprint_rows),
            int(skipped),
        )
        current_id = (getattr(self, "_current_session_id", "") or "").strip()
        if (
            chat_fingerprint == getattr(self, "_last_chat_render_fingerprint", None)
            and current_id == (getattr(self, "_last_chat_render_session_id", "") or "").strip()
        ):
            self._update_waiting_status_label(session)
            self._apply_chat_scroll_policy(
                policy,
                was_near_bottom=was_near_bottom,
                scroll_ratio=scroll_ratio,
            )
            return

        rows = []
        if skipped:
            rows.append(
                "<tr>"
                "<td align='center'>"
                "<table border='0' cellspacing='0' cellpadding='7'>"
                "<tr>"
                "<td bgcolor='#eef2f7' style='border:1px solid #dbe3ee;color:#6b7280;'>"
                f"已折叠较早的 {int(skipped)} 条消息"
                "</td>"
                "</tr>"
                "</table>"
                "</td>"
                "</tr>"
                "<tr><td height='8'></td></tr>"
            )

        for message in messages:
            role = (getattr(message, "role", "") or "").strip().lower()
            content = self._message_text_html(message, session=session)

            if role == "user":
                meta = self._message_status_html(message, align="right")
                badge = self._role_badge_html("我", "#22c55e")
                bubble = self._bubble_table_html(
                    content,
                    bg="#95ec69",
                    border="#7bdc54",
                    align="right",
                    width=None,
                )
                rows.append(
                    "<tr>"
                    "<td align='right' valign='top'>"
                    "<table align='right' border='0' cellspacing='0' cellpadding='0'>"
                    "<tr>"
                    "<td align='right' valign='top'>"
                    f"{meta}{bubble}"
                    "</td>"
                    "<td width='8'></td>"
                    "<td width='42' align='center' valign='top'>"
                    f"{badge}"
                    "</td>"
                    "</tr>"
                    "</table>"
                    "</td>"
                    "</tr>"
                    "<tr><td height='10'></td></tr>"
                )
                continue

            if role == "assistant":
                meta = self._message_status_html(message, align="left")
                badge = self._role_badge_html("AI", "#9ca3af")
                bubble_width = self._assistant_bubble_width(message, session=session)
                bubble = self._bubble_table_html(
                    content,
                    bg="#ffffff",
                    border="#e5e7eb",
                    align="left",
                    width=bubble_width,
                )
                block_width = bubble_width + 52
                rows.append(
                    "<tr>"
                    "<td align='left' valign='top'>"
                    f"<table align='left' width='{block_width}' border='0' cellspacing='0' cellpadding='0'>"
                    "<tr>"
                    "<td width='42' align='center' valign='top'>"
                    f"{badge}"
                    "</td>"
                    "<td width='8'></td>"
                    f"<td width='{bubble_width}' align='left' valign='top'>"
                    f"{meta}{bubble}"
                    "</td>"
                    "</tr>"
                    "</table>"
                    "</td>"
                    "</tr>"
                    "<tr><td height='10'></td></tr>"
                )
                continue

            label = "错误" if role == "error" else "系统"
            ts = self._html_escape(self._format_message_ts(getattr(message, "created_at", 0)))
            time_html = (
                f"<div style='color:#9ca3af;font-size:11px;margin-bottom:4px;'>{ts}</div>"
                if ts
                else ""
            )
            rows.append(
                "<tr>"
                "<td align='center'>"
                f"{time_html}"
                "<table border='0' cellspacing='0' cellpadding='7'>"
                "<tr>"
                "<td bgcolor='#eef2f7' style='border:1px solid #dbe3ee;color:#6b7280;'>"
                f"{self._html_escape(label)}：{content}"
                "</td>"
                "</tr>"
                "</table>"
                "</td>"
                "</tr>"
                "<tr><td height='8'></td></tr>"
            )

        doc = (
            "<html>"
            "<head>"
            "<meta charset='utf-8'>"
            "</head>"
            "<body style='margin:0;padding:10px 12px;background:#f7f8fa;"
            "font-family:Microsoft YaHei,Segoe UI,sans-serif;color:#111827;'>"
            "<table width='100%' border='0' cellspacing='0' cellpadding='0'>"
            f"{''.join(rows)}"
            "</table>"
            "</body>"
            "</html>"
        )

        self._last_chat_render_html = doc
        self._last_chat_render_fingerprint = chat_fingerprint
        self._last_chat_render_session_id = (
            session.session_id if session is not None else ""
        )
        transcript.setHtml(doc)
        transcript.setVisible(True)
        transcript.updateGeometry()
        transcript.viewport().update()
        transcript.update()
        self._apply_chat_scroll_policy(
            policy,
            was_near_bottom=was_near_bottom,
            scroll_ratio=scroll_ratio,
        )
        self._update_waiting_status_label(session)
        cost_ms = int((time.perf_counter() - started_at) * 1000)
        if cost_ms > 120 and hasattr(self, "_append_log"):
            self._append_log(
                "[PERF][CHAT_RENDER] "
                f"session_id={(getattr(session, 'session_id', '') or '-')} "
                f"cost={cost_ms}ms "
                f"message_count={len(messages)}",
                echo=False,
            )
