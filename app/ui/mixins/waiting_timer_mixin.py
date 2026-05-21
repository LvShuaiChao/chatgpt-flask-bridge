import re
import time

from PyQt5.QtCore import QTimer

from app.constants import ASSISTANT_WAIT_TEXTS, PENDING_ASSISTANT_STATUSES


_WAITING_ELAPSED_SUFFIX_RE = re.compile(
    r"(?:\s*[\(\（]?已等待\s*)?\d{2}:\d{2}\s*[\)\）]?$"
)


class WaitingTimerMixin:
    def _init_waiting_elapsed_timer(self):
        self._waiting_tick_log_at = {}
        self._tm_action_hint_base = ""
        self._waiting_timer = QTimer(self)
        self._waiting_timer.setInterval(1000)
        self._waiting_timer.timeout.connect(self._refresh_waiting_elapsed_ui)
        self._waiting_timer.start()

    @staticmethod
    def _format_elapsed_mmss(total_seconds):
        total_seconds = max(0, int(total_seconds))
        minutes = total_seconds // 60
        seconds = total_seconds % 60
        return f"{minutes:02d}:{seconds:02d}"

    def _iter_all_chat_sessions(self):
        sessions = getattr(self, "_sessions", None)
        if not isinstance(sessions, dict):
            return []
        return list(sessions.values())

    def _mark_session_waiting_started(self, session, reason=""):
        if session is None:
            return
        if getattr(session, "waiting_for_reply", False):
            since_ts = float(getattr(session, "waiting_since_ts", 0) or 0)
            if since_ts > 0:
                return
        since_ts = float(getattr(session, "pending_reply_since", 0) or 0)
        if since_ts <= 0:
            since_ts = time.time()
        session.waiting_for_reply = True
        session.waiting_since_ts = since_ts
        session.waiting_elapsed_sec = max(0, int(time.time() - since_ts))
        if not getattr(session, "pending_reply_since", 0):
            session.pending_reply_since = since_ts
        self._append_log(
            "[CHAT][WAITING_START] "
            f"session_id={session.session_id} "
            f"reason={reason or '-'} "
            f"waiting_since_ts={session.waiting_since_ts}",
            echo=True,
        )

    def _mark_session_waiting_finished(self, session, reason=""):
        if session is None:
            return
        was_waiting = bool(getattr(session, "waiting_for_reply", False))
        old_elapsed = 0
        since_ts = float(getattr(session, "waiting_since_ts", 0) or 0)
        if since_ts > 0:
            old_elapsed = max(0, int(time.time() - since_ts))
        elif was_waiting:
            old_elapsed = int(getattr(session, "waiting_elapsed_sec", 0) or 0)

        session.waiting_for_reply = False
        session.waiting_since_ts = 0
        session.waiting_elapsed_sec = 0

        if was_waiting or since_ts > 0:
            self._append_log(
                "[CHAT][WAITING_END] "
                f"session_id={session.session_id} "
                f"reason={reason or '-'} "
                f"elapsed_sec={old_elapsed}",
                echo=True,
            )

    def _sync_session_waiting_timer(self, session, reason=""):
        if session is None:
            return
        has_pending = False
        if hasattr(self, "_session_has_pending_assistant_reply"):
            has_pending = self._session_has_pending_assistant_reply(session)
        if has_pending:
            self._mark_session_waiting_started(session, reason=reason or "sync_pending")
        else:
            if getattr(session, "waiting_for_reply", False):
                self._mark_session_waiting_finished(
                    session, reason=reason or "sync_idle"
                )

    def _restore_waiting_timers_after_load(self):
        for session in self._iter_all_chat_sessions():
            self._sync_session_waiting_timer(session, reason="load_sessions")

    def _strip_waiting_elapsed_suffix(self, text):
        return _WAITING_ELAPSED_SUFFIX_RE.sub("", (text or "").strip()).strip()

    def _waiting_reply_display_base(self, text):
        cleaned = self._strip_waiting_elapsed_suffix(text)
        if not cleaned or cleaned in ASSISTANT_WAIT_TEXTS:
            return "等待回复..."
        if cleaned.endswith("…"):
            return cleaned[:-1] + "..."
        return cleaned

    def _is_pending_wait_display_message(self, message):
        if message is None:
            return False
        status = (getattr(message, "status", "") or "").strip()
        text = (getattr(message, "content", "") or "").strip()
        if status in PENDING_ASSISTANT_STATUSES:
            return True
        if text in ASSISTANT_WAIT_TEXTS:
            return True
        return False

    def _display_text_for_message(self, message, session):
        plain = getattr(message, "text", "") or getattr(message, "content", "") or ""
        if not session or not getattr(session, "waiting_for_reply", False):
            return plain
        if not self._is_pending_wait_display_message(message):
            return plain
        base = self._waiting_reply_display_base(plain)
        elapsed = self._format_elapsed_mmss(
            getattr(session, "waiting_elapsed_sec", 0) or 0
        )
        return f"{base} {elapsed}"

    def _format_waiting_status_text(self, base_text, session):
        base_text = (base_text or "").strip()
        if not session or not getattr(session, "waiting_for_reply", False):
            return base_text
        elapsed = self._format_elapsed_mmss(
            getattr(session, "waiting_elapsed_sec", 0) or 0
        )
        if not base_text:
            return f"已等待 {elapsed}"
        if "已等待" in base_text:
            base_text = self._strip_waiting_elapsed_suffix(base_text)
            if "已等待" in base_text:
                base_text = re.sub(r"已等待\s*\d{2}:\d{2}", "", base_text).strip()
        if base_text.endswith("。"):
            return f"{base_text}已等待 {elapsed}"
        return f"{base_text}。已等待 {elapsed}"

    def _session_waiting_preview_suffix(self, session):
        if not session or not getattr(session, "waiting_for_reply", False):
            return ""
        return self._format_elapsed_mmss(
            getattr(session, "waiting_elapsed_sec", 0) or 0
        )

    def _maybe_log_waiting_tick(self, session, elapsed):
        if not getattr(self, "_debug_mode", False):
            return
        session_id = (session.session_id or "").strip()
        now_ts = time.time()
        last_at = float(self._waiting_tick_log_at.get(session_id, 0) or 0)
        if now_ts - last_at < 10:
            return
        self._waiting_tick_log_at[session_id] = now_ts
        self._append_log(
            "[CHAT][WAITING_TICK] "
            f"session_id={session_id} "
            f"elapsed_sec={elapsed}",
            echo=False,
        )

    def _refresh_session_list_item_waiting_text(self, session):
        if not hasattr(self, "_refresh_session_list"):
            return
        self._refresh_session_list(select_session_id=session.session_id)

    def _refresh_current_chat_waiting_text(self, session):
        if session is None:
            return
        if session.session_id != getattr(self, "_current_session_id", None):
            return
        if hasattr(self, "_render_session_chat"):
            self._render_session_chat(session, force_bottom=False)
        elif hasattr(self, "_render_current_chat_messages"):
            self._render_current_chat_messages(
                force_bottom=False,
                reason="waiting_elapsed_tick",
            )

    def _refresh_status_bar_waiting_text(self):
        if not hasattr(self, "_apply_tm_action_hint_with_waiting"):
            return
        self._apply_tm_action_hint_with_waiting()

    def _set_tm_action_hint(self, text):
        self._tm_action_hint_base = (text or "").strip()
        self._apply_tm_action_hint_with_waiting()

    def _apply_tm_action_hint_with_waiting(self):
        text = (getattr(self, "_tm_action_hint_base", "") or "").strip()
        session = None
        if hasattr(self, "_current_session"):
            session = self._current_session()
        if session and getattr(session, "waiting_for_reply", False):
            text = self._format_waiting_status_text(text, session)
        if text == getattr(self, "_last_tm_action_hint_text", None):
            return
        self._last_tm_action_hint_text = text
        if text:
            self.statusBar().showMessage(text, 8000)

    def _refresh_waiting_elapsed_ui(self):
        current_session_id = getattr(self, "_current_session_id", None)
        now_ts = time.time()
        changed = False
        any_waiting = False
        current_session = None

        for session in self._iter_all_chat_sessions():
            if not getattr(session, "waiting_for_reply", False):
                continue

            any_waiting = True
            since_ts = float(getattr(session, "waiting_since_ts", 0) or 0)
            if since_ts <= 0:
                if hasattr(self, "_sync_session_waiting_timer"):
                    self._sync_session_waiting_timer(
                        session, reason="waiting_tick_resync"
                    )
                continue

            elapsed = max(0, int(now_ts - since_ts))
            if getattr(session, "waiting_elapsed_sec", -1) != elapsed:
                session.waiting_elapsed_sec = elapsed
                changed = True
                self._maybe_log_waiting_tick(session, elapsed)

            if session.session_id == current_session_id:
                current_session = session

        if not any_waiting:
            self._waiting_tick_log_at.clear()
            return

        if changed:
            if hasattr(self, "_refresh_session_list"):
                self._refresh_session_list(select_session_id=current_session_id)
            if current_session is not None:
                self._refresh_current_chat_waiting_text(current_session)
            self._refresh_status_bar_waiting_text()
