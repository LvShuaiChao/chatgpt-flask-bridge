import logging
import time

logger = logging.getLogger(__name__)

from app.constants import USER_SEND_PENDING_STATUSES


class SessionRuntimeMixin:
    def _session_runtime_entry(self, session_or_id):
        if isinstance(session_or_id, str):
            session_id = (session_or_id or "").strip()
        else:
            session_id = (getattr(session_or_id, "session_id", "") or "").strip()
        if not session_id:
            return {}
        store = getattr(self, "_session_runtime_cache", None)
        if not isinstance(store, dict):
            store = {}
            self._session_runtime_cache = store
        entry = store.get(session_id)
        if not isinstance(entry, dict):
            entry = {}
            store[session_id] = entry
        return entry

    def _session_message_records(self, session):
        if session is None:
            return []
        runtime = self._session_runtime_entry(session)
        raw_messages = runtime.get("all_messages_raw")
        if isinstance(raw_messages, list) and raw_messages:
            return list(raw_messages)
        records = []
        for message in getattr(session, "messages", []) or []:
            try:
                records.append(self._message_to_dict(message))
            except Exception:
                logger.exception(
                    "[SESSION][MESSAGE_RECORD_BUILD_FAILED] session_id=%s",
                    getattr(session, "session_id", "-"),
                )
        return records

    def _session_all_messages_loaded(self, session) -> bool:
        runtime = self._session_runtime_entry(session)
        if runtime.get("all_messages_loaded") is True:
            return True
        raw_messages = runtime.get("all_messages_raw")
        if isinstance(raw_messages, list) and len(raw_messages) == len(
            getattr(session, "messages", []) or []
        ):
            return True
        return False

    def _set_session_messages_from_raw(
        self,
        session,
        raw_messages,
        *,
        visible_tail_count=None,
        all_loaded=False,
    ):
        if session is None:
            return 0
        runtime = self._session_runtime_entry(session)
        source_rows = [
            dict(item)
            for item in (raw_messages or [])
            if isinstance(item, dict)
        ]
        runtime["all_messages_raw"] = source_rows
        runtime["message_count"] = len(source_rows)
        runtime["all_messages_loaded"] = bool(all_loaded)
        if visible_tail_count is None or all_loaded:
            rows_to_load = source_rows
        else:
            keep = max(0, int(visible_tail_count))
            rows_to_load = source_rows[-keep:] if keep else []
        messages = []
        for index, item in enumerate(rows_to_load):
            try:
                normalized_message = self._normalize_legacy_message_dict(item)
                messages.append(self._message_from_dict(normalized_message))
            except Exception as error:
                logger.exception(
                    "[SESSION][MESSAGE_LOAD_FAILED] session_id=%s message_index=%s error_type=%s error=%s",
                    getattr(session, "session_id", "-"),
                    index,
                    type(error).__name__,
                    error,
                )
        session.messages = messages
        session.trim_messages()
        return len(messages)

    def _ensure_session_full_messages_loaded(self, session, *, reason=""):
        if session is None or self._session_all_messages_loaded(session):
            return False
        loaded_count = self._set_session_messages_from_raw(
            session,
            self._session_runtime_entry(session).get("all_messages_raw") or [],
            all_loaded=True,
        )
        self._invalidate_session_runtime(
            session,
            reason=reason or "ensure_full_messages_loaded",
        )
        if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):
            self._append_log(
                "[SESSION][LAZY_LOAD_FULL] "
                f"session_id={session.session_id} "
                f"loaded_count={loaded_count} "
                f"reason={reason or '-'}",
                echo=False,
            )
        return True

    def _session_dirty_ids(self):
        dirty = getattr(self, "_dirty_session_ids", None)
        if not isinstance(dirty, set):
            dirty = set()
            self._dirty_session_ids = dirty
        return dirty

    def _mark_session_dirty(self, session_or_id):
        if isinstance(session_or_id, str):
            session_id = (session_or_id or "").strip()
            session = self._sessions.get(session_id) if session_id else None
        else:
            session = session_or_id
            session_id = (getattr(session, "session_id", "") or "").strip()
        if not session_id:
            return
        self._session_dirty_ids().add(session_id)
        runtime = self._session_runtime_entry(session_id)
        runtime["dirty_at"] = time.time()
        if session is not None:
            runtime["updated_at"] = float(getattr(session, "updated_at", 0) or 0)

    def _truncate_message_text_for_render(self, text):
        value = str(text or "")
        limit = int(getattr(self, "SESSION_RENDER_TEXT_LIMIT", 12000) or 12000)
        if len(value) <= limit:
            return value, False
        notice = f"\n\n[内容较长，已折叠显示前 {limit} 字]"
        keep = max(0, limit - len(notice))
        return f"{value[:keep]}{notice}", True

    def _message_render_text(self, message, session=None):
        plain = getattr(message, "text", "") or getattr(message, "content", "") or ""
        if session is None and hasattr(self, "_current_session"):
            session = self._current_session()
        truncated, clipped = self._truncate_message_text_for_render(plain)
        return truncated, clipped

    def _visible_message_signature(self, message, session=None):
        if session is None and hasattr(self, "_current_session"):
            session = self._current_session()
        render_text, clipped = self._message_render_text(message, session=session)
        return (
            (getattr(message, "message_id", "") or "").strip(),
            (getattr(message, "turn_id", "") or "").strip(),
            (getattr(message, "role", "") or "").strip(),
            render_text,
            bool(clipped),
            (getattr(message, "ui_status", "") or "").strip(),
            (getattr(message, "detail", "") or "").strip(),
            bool(getattr(message, "visible_in_chat", True)),
        )

    def _compute_session_pending_state(self, session):
        from app.models import is_waiting_placeholder_message

        if not session:
            return {
                "has_pending": False,
                "pending_assistant_message_id": "",
                "pending_turn_id": "",
                "pending_reason": "",
                "visible_message_count": 0,
            }
        messages_by_id = {
            (getattr(message, "message_id", "") or "").strip(): message
            for message in getattr(session, "messages", []) or []
            if (getattr(message, "message_id", "") or "").strip()
        }
        visible_count = 0
        pending_message_id = ""
        pending_turn_id = ""
        pending_reason = ""
        has_pending = False
        for message in reversed(getattr(session, "messages", []) or []):
            if not getattr(message, "visible_in_chat", True):
                continue
            visible_count += 1
            if message.role != "assistant":
                continue
            msg_source = (getattr(message, "message_source", "") or "").strip()
            if msg_source in ("queued_placeholder", "local_queue"):
                continue
            bridge_id = (getattr(message, "bridge_message_id", "") or "").strip()
            if bridge_id and hasattr(self, "_is_finalized") and self._is_finalized(bridge_id):
                continue
            if not bridge_id:
                parent_id = (getattr(message, "parent_message_id", "") or "").strip()
                parent = messages_by_id.get(parent_id)
                parent_bridge_id = (
                    (getattr(parent, "bridge_message_id", "") or "").strip()
                    if parent is not None
                    else ""
                )
                parent_source = (
                    (getattr(parent, "message_source", "") or "").strip()
                    if parent is not None
                    else ""
                )
                parent_ui_status = (
                    (getattr(parent, "ui_status", "") or "").strip()
                    if parent is not None
                    else ""
                )
                if (
                    parent is not None
                    and not parent_bridge_id
                    and parent_source in ("local_send", "local_queue")
                ):
                    continue
                if parent is not None and parent_ui_status in USER_SEND_PENDING_STATUSES:
                    continue
                if parent is not None and not parent_bridge_id:
                    parent_send_failed = parent_ui_status in (
                        "发送失败",
                        "failed",
                        "send_failed",
                    )
                    if parent_send_failed:
                        continue
            if is_waiting_placeholder_message(message):
                has_pending = True
                pending_message_id = (getattr(message, "message_id", "") or "").strip()
                pending_turn_id = (getattr(message, "turn_id", "") or "").strip()
                pending_reason = (
                    (getattr(message, "ui_status", "") or "").strip()
                    or "waiting_placeholder"
                )
                break
        return {
            "has_pending": has_pending,
            "pending_assistant_message_id": pending_message_id,
            "pending_turn_id": pending_turn_id,
            "pending_reason": pending_reason,
            "visible_message_count": visible_count,
        }

    def _invalidate_session_runtime(self, session_or_id, *, reason=""):
        if isinstance(session_or_id, str):
            session = self._sessions.get((session_or_id or "").strip())
            session_id = (session_or_id or "").strip()
        else:
            session = session_or_id
            session_id = (getattr(session, "session_id", "") or "").strip()
        if not session_id:
            return {}
        runtime = self._session_runtime_entry(session_id)
        if session is None:
            runtime.pop("pending_cache", None)
            runtime.pop("preview_cache", None)
            runtime.pop("visual_row_signature", None)
            runtime.pop("waiting_preview_suffix", None)
            runtime.pop("chat_fingerprint", None)
            runtime.pop("chat_render_html", None)
            runtime.pop("chat_render_message_count", None)
            runtime.pop("chat_last_full_render_at", None)
            return runtime
        pending_cache = self._compute_session_pending_state(session)
        runtime["pending_cache"] = pending_cache
        runtime["has_pending_reply_cached"] = bool(pending_cache.get("has_pending"))
        runtime["visible_message_count"] = int(pending_cache.get("visible_message_count") or 0)
        if not runtime["has_pending_reply_cached"] and float(
            getattr(session, "reply_waiting_since", 0) or 0
        ) <= 0:
            runtime["waiting_preview_suffix"] = ""
        runtime["preview_cache"] = None
        runtime["visual_row_signature"] = None
        runtime["chat_fingerprint"] = None
        runtime["chat_render_html"] = ""
        runtime["chat_render_message_count"] = None
        runtime["updated_at"] = float(getattr(session, "updated_at", 0) or 0)
        self._mark_session_dirty(session)
        if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):
            now = time.time()
            last_log_at = float(runtime.get("last_invalidate_log_at", 0) or 0)
            if now - last_log_at >= 5.0:
                runtime["last_invalidate_log_at"] = now
                self._append_log(
                    "[SESSION][RUNTIME_INVALIDATE] "
                    f"session_id={session_id} "
                    f"reason={reason or '-'} "
                    f"pending={'1' if runtime['has_pending_reply_cached'] else '0'}",
                    echo=False,
                )
        return runtime

