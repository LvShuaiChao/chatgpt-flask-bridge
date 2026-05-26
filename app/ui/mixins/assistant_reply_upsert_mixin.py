"""统一助手回复写入（Bridge / External API 共用）。"""
from __future__ import annotations

from app.constants import is_invalid_assistant_reply_text


class AssistantReplyUpsertMixin:
    def _upsert_assistant_reply_from_bridge(
        self,
        session,
        turn_id,
        bridge_id,
        text,
        *,
        render_reason,
    ):
        text = (text or "").strip()
        if is_invalid_assistant_reply_text(text):
            session_id = session.session_id if session else ""
            self._append_log(
                f"[REPLY][SKIP_INVALID_TEXT] session_id={session_id or '-'} "
                f"turn_id={turn_id or '-'} text={text!r}",
                echo=True,
            )
            return False
        session_id = session.session_id if session else ""
        count_before = self._session_visible_message_count(session)
        self._append_log(
            "[CHAT_REPLY][RECV] "
            f"request_id={bridge_id or '-'} "
            f"session_id={session_id} "
            f"content_len={len(text)} "
            f"count_before={count_before}",
            echo=True,
        )
        if not text:
            self._append_log(
                "[CHAT_REPLY][APPEND_FAILED] "
                f"reason=empty_reply session_id={session_id} "
                f"request_id={bridge_id or '-'}",
                echo=True,
            )
            return False

        self._append_log(
            "[CHAT_REPLY][APPEND_BEFORE] "
            f"session_id={session_id} "
            f"count_before={count_before} "
            f"request_id={bridge_id or '-'}",
            echo=True,
        )

        if self._has_assistant_for_turn(session, turn_id):
            self._set_reply_text(session, turn_id, text, "已回复")
            count_after = self._session_visible_message_count(session)
            self._append_log(
                "[CHAT_REPLY][APPLY] "
                f"mode=update_placeholder "
                f"session_id={session_id} "
                f"turn_id={turn_id or '-'} "
                f"request_id={bridge_id or '-'} "
                f"content_len={len(text)} "
                f"count_before={count_before} "
                f"count_after={count_after}",
                echo=True,
            )
        else:
            appended = self._append_message_to_session(
                session.session_id,
                {
                    "role": "assistant",
                    "content": text,
                    "turn_id": turn_id,
                    "status": "done",
                    "source": "web_reply",
                    "bridge_message_id": bridge_id,
                    "request_id": bridge_id,
                },
            )
            count_after = self._session_visible_message_count(session)
            self._append_log(
                "[CHAT_REPLY][APPLY] "
                f"mode=append_new "
                f"session_id={session_id} "
                f"turn_id={turn_id or '-'} "
                f"request_id={bridge_id or '-'} "
                f"content_len={len(text)} "
                f"count_before={count_before} "
                f"count_after={count_after} "
                f"appended={'true' if appended else 'false'}",
                echo=True,
            )
            if count_after <= count_before:
                self._append_log(
                    "[CHAT_MESSAGE][APPEND_FAILED] "
                    f"reason=reply_count_not_increased session_id={session_id} "
                    f"request_id={bridge_id or '-'}",
                    echo=True,
                )

        if hasattr(self, "_mark_session_reply_done_flash"):
            self._mark_session_reply_done_flash(
                session,
                reason=render_reason or "assistant_reply_recv",
            )

        if session.session_id == self._current_session_id:
            if hasattr(self, "_schedule_current_chat_render"):
                self._schedule_current_chat_render(
                    render_reason or "assistant_reply_recv",
                    delay_ms=0,
                    force_bottom=True,
                )
            elif hasattr(self, "_render_current_chat_messages"):
                self._render_current_chat_messages(
                    force_bottom=True,
                    reason=render_reason or "assistant_reply_recv",
                )
        elif session.session_id == self._current_session_id:
            self._render_session_chat(session, force_bottom=True)
        self._schedule_save_sessions_to_disk()
        return True
