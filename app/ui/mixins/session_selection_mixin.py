import logging
import time
import uuid

logger = logging.getLogger(__name__)

from app.constants import DEFAULT_APP_SETTINGS
from app.models import ChatSession, default_remote_chatgpt
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QTextCursor


class SessionSelectionMixin:
    def _focus_message_input(self, *, select_all=False):
        input_widget = self._message_input_widget()
        if input_widget is None:
            if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):
                self._append_log("[CHAT_INPUT][FOCUS_FAILED] reason=no_input_widget", echo=False)
            return

        if hasattr(input_widget, "setReadOnly"):
            input_widget.setReadOnly(False)
        input_widget.setEnabled(True)
        input_widget.setFocus(Qt.OtherFocusReason)

        if select_all and hasattr(input_widget, "selectAll"):
            input_widget.selectAll()

        if hasattr(input_widget, "focus_to_end"):
            input_widget.focus_to_end()
        elif hasattr(input_widget, "moveCursor"):
            input_widget.moveCursor(QTextCursor.End)

        if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):
            self._append_log(
                "[CHAT_INPUT][FOCUS_APPLY] "
                f"has_focus={input_widget.hasFocus()} "
                f"enabled={input_widget.isEnabled()} "
                f"readonly={input_widget.isReadOnly() if hasattr(input_widget, 'isReadOnly') else '-'}",
                echo=False,
            )

    def _focus_message_input_later(self, *, select_all=False):
        QTimer.singleShot(
            0,
            lambda: self._focus_message_input(
                select_all=select_all
            ),
        )
        QTimer.singleShot(
            80,
            lambda: self._focus_message_input(
                select_all=select_all
            ),
        )

    def _create_session(self, title="新对话", select=False):
        now = time.time()
        session = ChatSession(
            session_id=str(uuid.uuid4()),
            title=title,
            created_at=now,
            updated_at=now,
            messages=[],
            remote_chatgpt=default_remote_chatgpt(),
        )
        self._sessions[session.session_id] = session
        if session.session_id not in self._tab_session_ids:
            self._tab_session_ids.append(session.session_id)
        if select:
            self._select_session(session.session_id)
        else:
            self._refresh_session_list()
        self._save_sessions_to_disk()
        return session

    def _auto_open_chatgpt_on_new_session_enabled(self):
        if hasattr(self, "_settings"):
            value = self._settings.value("auto_open_chatgpt_on_new_session")
            if value is not None:
                if isinstance(value, str):
                    return value.strip().lower() in ("1", "true", "yes", "on")
                return bool(value)

        return bool(DEFAULT_APP_SETTINGS.get("auto_open_chatgpt_on_new_session", False))

    def _create_new_local_session(self):
        session = self._create_session(select=True)
        session.remote_chatgpt = default_remote_chatgpt()
        self._append_log(
            f"[SESSION][CREATE_LOCAL_ONLY] session_id={session.session_id} "
            f"title={session.title!r} auto_open_chatgpt=false"
        )
        self._render_session_chat(session, force_bottom=True)
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="session_created")
        if hasattr(self, "_apply_chat_bind_visual_state"):
            self._apply_chat_bind_visual_state()
        if hasattr(self, "_restore_session_compose_input"):
            self._restore_session_compose_input(session.session_id)
        elif hasattr(self, "_ensure_default_chat_input_text"):
            self._ensure_default_chat_input_text()
        self._focus_message_input_later()
        self._save_sessions_to_disk()
        if self._auto_open_chatgpt_on_new_session_enabled():
            if hasattr(self, "_ensure_visible_chatgpt_home_for_new_session"):
                self._ensure_visible_chatgpt_home_for_new_session(session)
        return session

    def _current_session(self):
        if not self._current_session_id:
            return None
        return self._sessions.get(self._current_session_id)

    def _ensure_current_session(self):
        session = self._current_session()
        if session:
            return session
        return self._create_session(select=True)

    def _is_chat_view_visible(self):
        transcript = getattr(self, "chat_transcript", None)
        if transcript is None:
            return False
        if not transcript.isVisible():
            return False
        tabs = getattr(self, "chat_sub_tabs", None)
        if tabs is None:
            return True
        current_text = tabs.tabText(tabs.currentIndex()).strip()
        if current_text and not self._is_chat_tab_title(current_text):
            return False
        return True

    def _is_chat_tab_title(self, text):
        text = (text or "").strip()
        return "聊天" in text or "鑱婂ぉ" in text

    def _log_select_session_deferred_skip(self, phase, reason, session_id, switch_token):
        if not self._is_debug_mode_enabled():
            return
        current_id = getattr(self, "_current_session_id", "") or "-"
        token = getattr(self, "_deferred_session_switch_token", "") or "-"
        self._append_log(
            f"[SELECT_SESSION_{phase}][SKIP] "
            f"reason={reason} "
            f"session_id={session_id} "
            f"current={current_id} "
            f"token={switch_token or '-'} "
            f"current_token={token}",
            echo=False,
        )

    def _select_session(self, session_id, save=True):
        if session_id not in self._sessions:
            return
        old_session_id = getattr(self, "_current_session_id", "")
        if old_session_id == session_id:
            if hasattr(self, "_ensure_default_chat_input_text"):
                self._ensure_default_chat_input_text()
            session = self._sessions.get(session_id)
            if session is not None:
                if hasattr(self, "_render_chat_transcript"):
                    self._render_chat_transcript(session, force_bottom=True)
                if hasattr(self, "_schedule_current_chat_render"):
                    self._schedule_current_chat_render(
                        "select_same_session",
                        delay_ms=0,
                        force_bottom=True,
                    )
            self._focus_message_input_later()
            if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):
                self._append_log(
                    f"[SESSION_SELECT][SAME_SESSION_FOCUS_INPUT] session_id={session_id}",
                    echo=False,
                )
            return

        if old_session_id and hasattr(self, "_stash_session_compose_draft"):
            self._stash_session_compose_draft(old_session_id)

        switch_token = uuid.uuid4().hex
        self._deferred_session_switch_token = switch_token
        self._session_ui.switching = True

        self._current_session_id = session_id
        self._suspend_status_ui_until = time.time() + 0.8
        session = self._sessions[session_id]
        if hasattr(self, "_ensure_session_full_messages_loaded"):
            self._ensure_session_full_messages_loaded(
                session,
                reason="select_session",
            )

        old_session = self._sessions.get(old_session_id) if old_session_id else None
        old_title = (
            self._session_display_title(old_session)
            if old_session is not None and hasattr(self, "_session_display_title")
            else "-"
        )
        new_title = (
            self._session_display_title(session)
            if session is not None and hasattr(self, "_session_display_title")
            else "-"
        )
        if hasattr(self, "_append_log"):
            self._append_log(
                "[SESSION][CURRENT_CHANGED] "
                f"old_session_id={old_session_id or '-'} "
                f"new_session_id={session_id or '-'} "
                f"old_title={old_title or '-'} "
                f"new_title={new_title or '-'}",
                echo=False,
            )

        self._refresh_session_list_selection_only(
            current_session_id=session_id,
            previous_session_id=old_session_id,
        )
        changed_ids = []
        if old_session_id:
            changed_ids.append(old_session_id)
        if session_id:
            changed_ids.append(session_id)
        self._refresh_session_list_current_badges()
        self._update_current_session_title_fast(session)
        self._force_session_list_repaint_now()
        self._sync_current_reply_done_flash_visual()

        QTimer.singleShot(
            350,
            lambda sid=session_id, token=switch_token, should_save=save: self._finish_select_session_deferred(
                sid,
                token,
                should_save,
            ),
        )

    def _finish_select_session_deferred(self, session_id, switch_token, save=True):
        if getattr(self, "_deferred_session_switch_token", "") != switch_token:
            self._log_select_session_deferred_skip(
                "DEFERRED",
                "token_mismatch",
                session_id,
                switch_token,
            )
            return
        if session_id != getattr(self, "_current_session_id", ""):
            self._log_select_session_deferred_skip(
                "DEFERRED",
                "session_changed",
                session_id,
                switch_token,
            )
            return
        session = self._sessions.get(session_id)
        if session is None:
            self._log_select_session_deferred_skip(
                "DEFERRED",
                "session_missing",
                session_id,
                switch_token,
            )
            self._session_ui.switching = False
            return

        session.has_pending_reply = self._session_has_pending_assistant_reply(session)

        t0 = time.perf_counter()
        if self._is_chat_view_visible():
            self._render_session_chat(session, force_bottom=True)
            chat_rendered = True
        else:
            self._bridge_msg.pending_chat_render = {
                "session_id": session_id,
                "force_bottom": True,
                "reason": "select_session_deferred",
                "created_at": time.time(),
            }
            chat_rendered = False
        self._sync_current_reply_done_flash_visual()
        render_ms = int((time.perf_counter() - t0) * 1000)

        QTimer.singleShot(
            300,
            lambda sid=session_id, token=switch_token, render_ms=render_ms, chat_rendered=chat_rendered, should_save=save: self._finish_select_session_deferred_light_ui(
                sid,
                token,
                render_ms,
                chat_rendered,
                should_save,
            ),
        )

    def _finish_select_session_deferred_light_ui(
        self,
        session_id,
        switch_token,
        render_ms,
        chat_rendered,
        save=True,
    ):
        if getattr(self, "_deferred_session_switch_token", "") != switch_token:
            self._log_select_session_deferred_skip(
                "DEFERRED_LIGHT",
                "token_mismatch",
                session_id,
                switch_token,
            )
            return
        if session_id != getattr(self, "_current_session_id", ""):
            self._log_select_session_deferred_skip(
                "DEFERRED_LIGHT",
                "session_changed",
                session_id,
                switch_token,
            )
            return
        session = self._sessions.get(session_id)
        if session is None:
            self._log_select_session_deferred_skip(
                "DEFERRED_LIGHT",
                "session_missing",
                session_id,
                switch_token,
            )
            self._session_ui.switching = False
            return

        if save and hasattr(self, "_settings"):
            self._settings.setValue("current_session_id", session_id)

        t0 = time.perf_counter()

        new_sig = self._session_list_visual_signature()
        old_sig = getattr(self, "_last_session_list_visual_signature", None)
        if new_sig != old_sig:
            self._refresh_session_list(select_session_id=session_id)
        else:
            self._refresh_session_list_current_badges([session_id])
        self._update_current_session_title(session)
        if hasattr(self, "_try_send_next_queued_message"):
            self._try_send_next_queued_message(session)
        if hasattr(self, "_restore_session_compose_input"):
            self._restore_session_compose_input(session_id)
        self._focus_message_input_later()
        light_ms = int((time.perf_counter() - t0) * 1000)

        self._session_ui.switching = False
        if not chat_rendered and hasattr(self, "_flush_pending_chat_render"):
            QTimer.singleShot(0, self._flush_pending_chat_render)
        if self._is_debug_mode_enabled():
            self._append_log(
                "[PERF][SELECT_SESSION_DEFERRED] "
                f"session_id={session_id} "
                f"chat_rendered={chat_rendered} "
                f"render_ms={render_ms} "
                f"light_ms={light_ms} "
                f"list_refreshed={new_sig != old_sig}",
                echo=False,
            )
        if hasattr(self, "_schedule_status_apply_after_session_switch"):
            self._schedule_status_apply_after_session_switch()
        if hasattr(self, "schedule_page_registry_refresh"):
            QTimer.singleShot(
                300,
                lambda: self.schedule_page_registry_refresh(
                    reason="session_switch_finished"
                ),
            )
        elif hasattr(self, "_auto_refresh_tm_pages_if_needed"):
            QTimer.singleShot(
                300,
                lambda: self._auto_refresh_tm_pages_if_needed(
                    "session_switch_finished"
                ),
            )

