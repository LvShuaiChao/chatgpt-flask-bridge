import logging
import time
import uuid

logger = logging.getLogger(__name__)

from app.constants import is_invalid_assistant_reply_text
from app.models import ChatMessage


class SessionInboundMixin:
    def _append_session_message(
        self,
        session,
        role,
        content,
        message_id="",
        turn_id="",
        ui_status="",
        created_at=None,
        message_source="",
        bridge_message_id="",
        parent_message_id="",
        visible_in_chat=True,
    ):
        message = ChatMessage(
            role=role,
            content=content,
            created_at=created_at or time.time(),
            message_id=message_id or str(uuid.uuid4()),
            turn_id=turn_id or "",
            ui_status=(ui_status or "").strip(),
            detail="",
            message_source=(message_source or "").strip(),
            bridge_message_id=bridge_message_id or "",
            parent_message_id=parent_message_id or "",
            visible_in_chat=bool(visible_in_chat),
        )
        session.messages.append(message)
        session.updated_at = time.time()
        runtime = self._session_runtime_entry(session)
        raw_messages = runtime.get("all_messages_raw")
        if isinstance(raw_messages, list):
            raw_messages.append(self._message_to_dict(message))
            runtime["message_count"] = len(raw_messages)
        # 裁剪超出上限的旧消息
        session.trim_messages()
        if hasattr(self, "_invalidate_session_runtime"):
            self._invalidate_session_runtime(session, reason="append_session_message")
        return message

    def _find_assistant_by_turn(self, session, turn_id):
        if not session or not turn_id:
            return None
        for message in reversed(session.messages):
            if message.turn_id == turn_id and message.role in ("assistant", "error"):
                return message
        return None

    def _resolve_inbound_binding(self, item):
        bridge_id = (item.get("message_id") or "").strip()
        session_id = (
            self._message_to_session.get(bridge_id) or item.get("session_id") or ""
        ).strip()
        turn_id = (
            self._message_to_turn.get(bridge_id) or item.get("turn_id") or ""
        ).strip()
        if not session_id or not turn_id:
            return None, turn_id, bridge_id
        session = self._sessions.get(session_id)
        if session is None:
            return None, turn_id, bridge_id
        return session, turn_id, bridge_id

    def _on_tm_assistant_reply(self, payload):
        session_id = str(payload.get("session_id") or "").strip()
        turn_id = str(payload.get("turn_id") or "").strip()
        content = str(payload.get("content") or "").strip()
        if not content:
            content = str(
                payload.get("text") or payload.get("assistant_text") or ""
            ).strip()
        bridge_id = str(payload.get("message_id") or "").strip()

        if not content:
            self._append_log("[REPLY][SKIP] reason=empty_content", echo=True)
            return False

        if is_invalid_assistant_reply_text(content):
            self._append_log(
                f"[REPLY][SKIP_INVALID_TEXT] session_id={session_id or '-'} "
                f"turn_id={turn_id or '-'} text={content!r}",
                echo=True,
            )
            return False

        session = self._sessions.get(session_id)
        if session is None:
            self._append_log(
                f"[REPLY][SKIP] reason=session_not_found session_id={session_id or '-'}",
                echo=True,
            )
            return False

        if self._upsert_assistant_reply_from_bridge(
            session,
            turn_id,
            bridge_id,
            content,
            render_reason="tm_assistant_reply",
        ):
            if hasattr(self, "_mark_session_waiting_finished"):
                self._mark_session_waiting_finished(session, reason="tm_assistant_reply")
            session.has_pending_reply = False
            session.reply_waiting_since = 0
            session.pending_sync_requested = False
            session.updated_at = time.time()
            if bridge_id:
                if hasattr(self, "_finalize_bridge"):
                    self._finalize_bridge(bridge_id)
                if hasattr(self, "_bridge_msg"):
                    self._bridge_msg.ack_success_message_ids.discard(bridge_id)
            self._schedule_save_sessions_to_disk()
            if session.session_id == getattr(self, "_current_session_id", ""):
                if hasattr(self, "_schedule_current_chat_render"):
                    self._schedule_current_chat_render(
                        "tm_assistant_reply",
                        delay_ms=0,
                        force_bottom=True,
                    )
                elif hasattr(self, "_render_session_chat"):
                    self._render_session_chat(session, force_bottom=True)
            if hasattr(self, "_refresh_session_list"):
                self._refresh_session_list()
            self._append_log(
                f"[REPLY][APPLIED] session_id={session_id} turn_id={turn_id or '-'} "
                f"content_len={len(content)} updated=true",
                echo=True,
            )
            return True

        updated = False
        for message in session.messages:
            if (
                getattr(message, "role", "") == "assistant"
                and str(getattr(message, "turn_id", "") or "").strip() == turn_id
                and str(getattr(message, "status", "") or "").strip()
                in ("waiting", "sending", "等待回复", "准备发送")
            ):
                message.content = content
                message.ui_status = "done"
                updated = True
                break

        if not updated:
            self._append_message_to_session(
                session.session_id,
                {
                    "role": "assistant",
                    "content": content,
                    "turn_id": turn_id,
                    "source": "tm_assistant_reply",
                    "status": "done",
                    "created_at": time.time(),
                },
            )

        session.has_pending_reply = False
        session.reply_waiting_since = 0
        session.pending_sync_requested = False
        session.updated_at = time.time()
        self._schedule_save_sessions_to_disk()
        if session.session_id == getattr(self, "_current_session_id", ""):
            if hasattr(self, "_schedule_current_chat_render"):
                self._schedule_current_chat_render(
                    "tm_assistant_reply",
                    delay_ms=0,
                    force_bottom=True,
                )
        if hasattr(self, "_refresh_session_list"):
            self._refresh_session_list()
        self._append_log(
            f"[REPLY][APPLIED] session_id={session_id} turn_id={turn_id or '-'} "
            f"content_len={len(content)} updated={updated}",
            echo=True,
        )
        return True

    def _has_assistant_for_turn(self, session, turn_id):
        return self._find_assistant_by_turn(session, turn_id) is not None

    def _migrate_loaded_session_messages(self):
        bridge_turn = dict(self._message_to_turn)
        for session in self._sessions.values():
            for message in session.messages:
                role = message.role
                bridge = message.bridge_message_id
                mid = message.message_id
                source = (message.message_source or "").strip()
                if role in ("user", "assistant") and mid and not bridge:
                    if source in ("local_send", "local_queue", "local_placeholder"):
                        continue
                    message.bridge_message_id = mid
                    bridge = mid
                if role in ("user", "assistant") and bridge and not message.turn_id:
                    if bridge not in bridge_turn:
                        bridge_turn[bridge] = str(uuid.uuid4())
                    message.turn_id = bridge_turn[bridge]
                if message.bridge_message_id:
                    self._message_to_session[message.bridge_message_id] = (
                        session.session_id
                    )
                    if message.turn_id:
                        bridge_turn[message.bridge_message_id] = message.turn_id
            by_bridge = {}
            for message in session.messages:
                bridge = message.bridge_message_id
                if not bridge or message.role not in ("user", "assistant"):
                    continue
                by_bridge.setdefault(bridge, []).append(message)
            for bridge, msgs in by_bridge.items():
                if len(msgs) < 2:
                    continue
                ids = [item.message_id for item in msgs]
                if len(set(ids)) == 1 and ids[0] == bridge:
                    user_msg = next((m for m in msgs if m.role == "user"), None)
                    asst_msg = next((m for m in msgs if m.role == "assistant"), None)
                    if user_msg:
                        user_msg.message_id = str(uuid.uuid4())
                    if asst_msg:
                        asst_msg.message_id = str(uuid.uuid4())
                        if user_msg:
                            asst_msg.parent_message_id = user_msg.message_id
        self._message_to_turn = bridge_turn

