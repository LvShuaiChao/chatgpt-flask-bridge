import time

from PyQt5.QtCore import QTimer


class SessionReplyFlashMixin:
    REPLY_DONE_FLASH_SECONDS = 4.0
    REPLY_DONE_FLASH_INTERVAL_MS = 260

    def _session_reply_done_flash_until(self, session):
        if session is None:
            return 0.0
        try:
            return float(getattr(session, "_reply_done_flash_until", 0) or 0)
        except (TypeError, ValueError) as error:
            if hasattr(self, "_append_log"):
                self._append_log(
                    "[REPLY_FLASH][INVALID_UNTIL] "
                    f"session_id={getattr(session, 'session_id', '-') } "
                    f"value={getattr(session, '_reply_done_flash_until', None)!r} "
                    f"error_type={type(error).__name__} error={error}",
                    echo=True,
                )
            return 0.0

    def _session_reply_done_flash_active(self, session):
        return self._session_reply_done_flash_until(session) > time.time()

    def _session_reply_done_flash_phase(self, session):
        if not self._session_reply_done_flash_active(session):
            return 0
        interval = max(80, int(getattr(self, "REPLY_DONE_FLASH_INTERVAL_MS", 260)))
        return 1 + int((time.time() * 1000) // interval) % 2

    def _mark_session_reply_done_flash(self, session, *, reason=""):
        if session is None:
            return

        now = time.time()
        until = now + float(getattr(self, "REPLY_DONE_FLASH_SECONDS", 4.0) or 4.0)
        setattr(session, "_reply_done_flash_until", until)

        if hasattr(self, "_append_log"):
            self._append_log(
                "[REPLY_FLASH][START] "
                f"session_id={getattr(session, 'session_id', '-') } "
                f"reason={reason or '-'} "
                f"until={until:.3f}",
                echo=False,
            )

        if hasattr(self, "_refresh_session_list"):
            self._refresh_session_list(
                select_session_id=getattr(self, "_current_session_id", "") or session.session_id
            )

        self._sync_current_reply_done_flash_visual()
        self._start_reply_done_flash_timer()

    def _start_reply_done_flash_timer(self):
        timer = getattr(self, "_reply_done_flash_timer", None)
        if timer is None:
            timer = QTimer(self)
            timer.setInterval(int(getattr(self, "REPLY_DONE_FLASH_INTERVAL_MS", 260)))
            timer.timeout.connect(self._on_reply_done_flash_timer_tick)
            self._reply_done_flash_timer = timer

        if not timer.isActive():
            timer.start()

    def _on_reply_done_flash_timer_tick(self):
        now = time.time()
        active = False

        for session in getattr(self, "_sessions", {}).values():
            until = self._session_reply_done_flash_until(session)
            if until > now:
                active = True
                continue
            if until > 0:
                setattr(session, "_reply_done_flash_until", 0)

        if hasattr(self, "_refresh_session_list"):
            self._refresh_session_list(
                select_session_id=getattr(self, "_current_session_id", "") or None
            )

        self._sync_current_reply_done_flash_visual()

        if not active:
            timer = getattr(self, "_reply_done_flash_timer", None)
            if timer is not None and timer.isActive():
                timer.stop()

    def _sync_current_reply_done_flash_visual(self):
        transcript = getattr(self, "chat_transcript", None)
        if transcript is None:
            return

        session = self._current_session() if hasattr(self, "_current_session") else None
        active = self._session_reply_done_flash_active(session)
        phase = self._session_reply_done_flash_phase(session)

        new_flash = "true" if active else "false"
        new_phase = str(phase)

        if (
            transcript.property("replyFlash") == new_flash
            and transcript.property("replyFlashPhase") == new_phase
        ):
            return

        transcript.setProperty("replyFlash", new_flash)
        transcript.setProperty("replyFlashPhase", new_phase)

        style = transcript.style()
        if style is not None:
            style.unpolish(transcript)
            style.polish(transcript)

        transcript.update()
        viewport = transcript.viewport()
        if viewport is not None:
            viewport.update()

