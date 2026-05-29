import re
import time
import traceback

from PyQt5.QtCore import QTimer

from app.constants import (
    ASSISTANT_WAIT_TEXTS,
    REPLY_WAKE_MAX_COUNT,
)
from app.server import is_server_running
from app.server.control_commands import push_focus_page
from app.utils.tm_activity import (
    describe_reply_wait_page_hint,
    reply_wait_page_metrics,
    should_wake_page_for_reply_wait,
)


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

    def _session_pending_elapsed_sec(self, session) -> int:
        since_ts = float(getattr(session, "reply_waiting_since", 0) or 0)
        if since_ts <= 0:
            return 0
        return max(0, int(time.time() - since_ts))

    def _session_is_waiting_reply(self, session) -> bool:
        return float(getattr(session, "reply_waiting_since", 0) or 0) > 0

    def _iter_all_chat_sessions(self):
        sessions = getattr(self, "_sessions", None)
        if not isinstance(sessions, dict):
            return []
        return list(sessions.values())

    def _mark_session_waiting_started(self, session, reason=""):
        if session is None:
            return
        if self._session_is_waiting_reply(session):
            return
        session.reply_waiting_since = time.time()
        session.reply_wake_count = 0
        session.last_reply_wake_at = 0
        self._append_log(
            "[CHAT][WAITING_START] "
            f"session_id={session.session_id} "
            f"reason={reason or '-'} "
            f"reply_waiting_since={session.reply_waiting_since}",
            echo=True,
        )

    def _mark_session_waiting_finished(self, session, reason=""):
        if session is None:
            return
        was_waiting = self._session_is_waiting_reply(session)
        old_elapsed = self._session_pending_elapsed_sec(session) if was_waiting else 0
        session.reply_waiting_since = 0
        session.reply_wake_count = 0
        session.last_reply_wake_at = 0
        if was_waiting:
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
            if self._session_is_waiting_reply(session):
                self._mark_session_waiting_finished(
                    session, reason=reason or "sync_idle"
                )

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
        from app.models import is_waiting_placeholder_message

        return is_waiting_placeholder_message(message)

    def _bound_page_info_for_reply_wait(self, session):
        if session is None or not hasattr(self, "_resolve_bound_page_info"):
            return None
        status = getattr(getattr(self, "_bridge_ui", None), "last_bridge_status", None) or {}
        bound_info, bound_state, _reason = self._resolve_bound_page_info(status=status)
        if not isinstance(bound_info, dict) or not bound_info:
            return None
        if bound_state in ("offline", "unbound", "missing"):
            return None
        return bound_info

    def _reply_wait_page_hint_for_session(self, session, *, waking=False):
        bound_info = self._bound_page_info_for_reply_wait(session)
        wake_count = int(getattr(session, "reply_wake_count", 0) or 0)
        return describe_reply_wait_page_hint(
            bound_info,
            wake_count=wake_count,
            max_wake_count=REPLY_WAKE_MAX_COUNT,
            waking=waking,
        )

    def _session_still_waiting_assistant_body(self, session) -> bool:
        if session is None:
            return False
        if hasattr(self, "_session_has_pending_assistant_reply"):
            return self._session_has_pending_assistant_reply(session)
        return self._session_is_waiting_reply(session)

    def _maybe_wake_bound_page_for_reply_wait(self, session):
        if session is None or not self._session_is_waiting_reply(session):
            return
        if not self._session_still_waiting_assistant_body(session):
            return
        if not is_server_running():
            return

        wait_seconds = float(self._session_pending_elapsed_sec(session))
        wake_count = int(getattr(session, "reply_wake_count", 0) or 0)
        last_wake_at = float(getattr(session, "last_reply_wake_at", 0) or 0)

        bound_info = self._bound_page_info_for_reply_wait(session)
        if not bound_info:
            return

        should_wake, block_reason = should_wake_page_for_reply_wait(
            bound_info,
            wait_seconds=wait_seconds,
            wake_count=wake_count,
            last_wake_at=last_wake_at,
        )
        if not should_wake:
            return

        metrics = reply_wait_page_metrics(bound_info)
        remote = getattr(session, "remote_chatgpt", None) or {}
        if not isinstance(remote, dict):
            remote = {}
        page_id = (
            (bound_info.get("page_no") or bound_info.get("page_display_id") or "")
        )
        client_id = (bound_info.get("client_id") or remote.get("client_id") or "").strip()
        page_instance_id = (
            bound_info.get("page_instance_id") or remote.get("page_instance_id") or ""
        ).strip()
        conversation_id = (
            (bound_info.get("conversation_id") or "")
            or (getattr(session, "conversation_id", "") or "")
        ).strip()
        session_id = (session.session_id or "").strip()

        self._append_log(
            "[TM_WAKE][REPLY_WAIT][START] "
            f"session_id={session_id} "
            f"conversation_id={conversation_id or '-'} "
            f"page_id={page_id or '-'} "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"wait_seconds={wait_seconds:.1f} "
            f"poll_age={metrics.get('poll_age', -1):.1f} "
            f"heartbeat_age={metrics.get('heartbeat_age', -1):.1f} "
            f"visibility_state={metrics.get('visibility_state') or '-'} "
            f"has_focus={'true' if metrics.get('has_focus') else 'false'} "
            f"wake_count={wake_count}",
            echo=True,
        )

        session.last_reply_wake_at = time.time()
        session.reply_wake_count = wake_count + 1

        ok = False
        fail_reason = ""
        try:
            if hasattr(self, "enqueue_page_command"):
                result = self.enqueue_page_command(session, "focus_self")
                ok = bool(isinstance(result, dict) and result.get("ok"))
                if not ok:
                    fail_reason = (
                        (result.get("reason") or "")
                        or (result.get("reason_code") or "")
                        or "enqueue_focus_self_failed"
                    )
            elif client_id:
                msg = push_focus_page(
                    client_id,
                    page_instance_id=page_instance_id,
                    conversation_id=conversation_id,
                    url=(bound_info.get("url") or "").strip() or None,
                )
                ok = msg is not None
                if not ok:
                    fail_reason = "push_focus_page_returned_none"
            else:
                fail_reason = "missing_client_id"
        except Exception as error:
            fail_reason = f"{type(error).__name__}: {error}"
            self._append_log(
                "[TM_WAKE][REPLY_WAIT][FAILED] "
                f"session_id={session_id} "
                f"conversation_id={conversation_id or '-'} "
                f"page_id={page_id or '-'} "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'} "
                f"reason={fail_reason}\n{traceback.format_exc()}",
                echo=True,
                level="ERROR",
            )
            return

        if ok:
            self._append_log(
                "[TM_WAKE][REPLY_WAIT][OK] "
                f"session_id={session_id} "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'} "
                f"wake_count={session.reply_wake_count}",
                echo=True,
            )
        else:
            session.reply_wake_count = max(0, int(session.reply_wake_count or 0) - 1)
            self._append_log(
                "[TM_WAKE][REPLY_WAIT][FAILED] "
                f"session_id={session_id} "
                f"conversation_id={conversation_id or '-'} "
                f"page_id={page_id or '-'} "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'} "
                f"reason={fail_reason or 'unknown'}",
                echo=True,
                level="WARNING",
            )

    def _format_waiting_status_text(self, base_text, session):
        base_text = (base_text or "").strip()
        if not session or not self._session_is_waiting_reply(session):
            return base_text
        elapsed = self._format_elapsed_mmss(self._session_pending_elapsed_sec(session))
        page_hint = self._reply_wait_page_hint_for_session(session)
        if not base_text:
            return f"等待回复 {elapsed}｜{page_hint}" if page_hint else f"已等待 {elapsed}"
        if "已等待" in base_text:
            base_text = self._strip_waiting_elapsed_suffix(base_text)
            if "已等待" in base_text:
                base_text = re.sub(r"已等待\s*\d{2}:\d{2}", "", base_text).strip()
        if "等待回复" in base_text:
            base_text = re.sub(
                r"等待回复\s*\d{2}:\d{2}(?:\s*｜[^｜]+)?$",
                "",
                base_text,
            ).strip()
        prefix = "等待回复" if "等待" in base_text or not base_text else base_text
        if prefix and prefix != "等待回复":
            line = f"{prefix} {elapsed}"
        else:
            line = f"等待回复 {elapsed}"
        if page_hint:
            line = f"{line}｜{page_hint}"
        return line

    def _session_waiting_preview_suffix(self, session):
        if not session or not self._session_is_waiting_reply(session):
            return ""
        return self._format_elapsed_mmss(self._session_pending_elapsed_sec(session))

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

    def _refresh_current_chat_waiting_text(self, session):
        if session is None:
            return
        if session.session_id != getattr(self, "_current_session_id", None):
            return
        if hasattr(self, "_update_waiting_status_label"):
            self._update_waiting_status_label(session)

    def _refresh_status_bar_waiting_text(self):
        if not hasattr(self, "_apply_tm_action_hint_with_waiting"):
            return
        self._apply_tm_action_hint_with_waiting()

    def _apply_tm_action_hint_with_waiting(self):
        text = (getattr(self, "_tm_action_hint_base", "") or "").strip()
        session = None
        if hasattr(self, "_current_session"):
            session = self._current_session()
        if session and self._session_is_waiting_reply(session):
            text = self._format_waiting_status_text(text, session)
        if text == getattr(self, "_last_tm_action_hint_text", None):
            return
        self._last_tm_action_hint_text = text
        if text:
            self.statusBar().showMessage(text, 8000)

    def _refresh_waiting_elapsed_ui(self):
        current_session_id = getattr(self, "_current_session_id", None)
        now_ts = time.time()
        any_waiting = False
        current_session = None
        touched_session_ids = []

        for session in self._iter_all_chat_sessions():
            since_ts = float(getattr(session, "reply_waiting_since", 0) or 0)
            if since_ts <= 0:
                continue

            any_waiting = True
            elapsed = max(0, int(now_ts - since_ts))
            if hasattr(self, "_maybe_recover_pending_reply"):
                self._maybe_recover_pending_reply(session)
            if hasattr(self, "_maybe_wake_bound_page_for_reply_wait"):
                self._maybe_wake_bound_page_for_reply_wait(session)
            self._maybe_log_waiting_tick(session, elapsed)
            touched_session_ids.append(session.session_id)
            runtime_getter = getattr(self, "_session_runtime_entry", None)
            if callable(runtime_getter):
                runtime = runtime_getter(session)
                last_elapsed = int(runtime.get("last_waiting_elapsed_sec") or -1)
                if last_elapsed != elapsed:
                    runtime["last_waiting_elapsed_sec"] = elapsed
                    runtime["preview_cache"] = None
                    runtime["visual_row_signature"] = None
                    if hasattr(self, "_update_session_list_item_runtime"):
                        self._update_session_list_item_runtime(
                            session,
                            selected=(session.session_id == current_session_id),
                        )

            if session.session_id == current_session_id:
                current_session = session

        if not any_waiting:
            self._waiting_tick_log_at.clear()
            if current_session_id and hasattr(self, "_update_waiting_status_label"):
                self._update_waiting_status_label(None)
            return

        if current_session is not None:
            self._refresh_current_chat_waiting_text(current_session)
        self._refresh_status_bar_waiting_text()
