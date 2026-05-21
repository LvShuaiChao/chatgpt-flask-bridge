"""会话消息写入与聊天区刷新。"""

import time
import uuid


class ChatSessionMixin:
    def _get_session_by_id(self, session_id):
        session_id = (session_id or "").strip()
        if not session_id:
            return None
        return self._sessions.get(session_id)

    def _session_visible_message_count(self, session):
        if session is None:
            return 0
        return sum(
            1
            for message in session.messages
            if getattr(message, "visible_in_chat", True)
        )

    def _resolve_session_id_for_request(self, request_id, payload=None):
        request_id = (request_id or "").strip()
        session_id = ""
        if isinstance(payload, dict):
            session_id = (payload.get("session_id") or "").strip()
        if not session_id and request_id:
            pending = getattr(self, "_pending_send_requests", {}).get(request_id) or {}
            session_id = (pending.get("session_id") or "").strip()
        if not session_id and request_id:
            session_id = (self._message_to_session.get(request_id) or "").strip()
        if not session_id:
            session_id = (self._current_session_id() or "").strip()
        return session_id

    def _update_message_status_by_request_id(
        self, session_id, request_id, status, *, turn_id=""
    ):
        session_id = (session_id or "").strip()
        request_id = (request_id or "").strip()
        status = (status or "").strip()
        if not session_id or not request_id:
            self._append_log(
                "[CHAT_MESSAGE][STATUS_SKIP] "
                f"session_id={session_id or '-'} "
                f"request_id={request_id or '-'} "
                f"reason=missing_session_or_request",
                echo=True,
            )
            return False
        session = self._get_session_by_id(session_id)
        if session is None:
            self._append_log(
                "[CHAT_MESSAGE][STATUS_SKIP] "
                f"session_id={session_id} request_id={request_id} "
                f"reason=session_not_found",
                echo=True,
            )
            return False
        turn_id = (turn_id or "").strip()
        for message in reversed(session.messages):
            if message.role != "user":
                continue
            bridge_id = (message.bridge_message_id or "").strip()
            message_id = (message.message_id or "").strip()
            matched = bridge_id == request_id or message_id == request_id
            if not matched and turn_id:
                matched = (message.turn_id or "").strip() == turn_id
            if not matched:
                continue
            message.status = status
            session.updated_at = time.time()
            self._save_sessions_to_disk()
            self._append_log(
                "[CHAT_MESSAGE][STATUS] "
                f"session_id={session_id} request_id={request_id} "
                f"status={status} message_id={message_id[:8] if message_id else '-'}",
                echo=True,
            )
            return True
        self._append_log(
            "[CHAT_MESSAGE][STATUS_FAILED] "
            f"session_id={session_id} request_id={request_id} "
            f"reason=no_matching_user_message turn_id={turn_id or '-'}",
            echo=True,
        )
        return False

    def _append_message_to_session(self, session_id, message):
        session_id = (session_id or "").strip()
        if not session_id:
            self._append_log(
                "[CHAT_MESSAGE][APPEND_SKIP] reason=missing_session_id",
                echo=True,
            )
            return False

        session = self._get_session_by_id(session_id)
        if session is None:
            self._append_log(
                "[CHAT_MESSAGE][APPEND_SKIP] "
                f"session_id={session_id} reason=session_not_found",
                echo=True,
            )
            return False

        if not isinstance(message, dict):
            self._append_log(
                "[CHAT_MESSAGE][APPEND_SKIP] "
                f"session_id={session_id} reason=message_not_dict "
                f"type={type(message).__name__}",
                echo=True,
            )
            return False

        role = (message.get("role") or "").strip()
        content = (message.get("content") or message.get("text") or "").strip()

        if not role or not content:
            self._append_log(
                "[CHAT_MESSAGE][APPEND_FAILED] "
                f"session_id={session_id} reason=empty_role_or_content "
                f"role={role or '-'} content_len={len(content)} "
                f"request_id={(message.get('request_id') or message.get('bridge_message_id') or '-')}",
                echo=True,
            )
            return False

        count_before = self._session_visible_message_count(session)
        created = self._append_session_message(
            session,
            role,
            content,
            message_id=(message.get("message_id") or "").strip() or str(uuid.uuid4()),
            turn_id=(message.get("turn_id") or "").strip(),
            status=(message.get("status") or "").strip(),
            created_at=message.get("created_at"),
            bridge_message_id=(
                (message.get("bridge_message_id") or message.get("request_id") or "")
                .strip()
            ),
            parent_message_id=(message.get("parent_message_id") or "").strip(),
            visible_in_chat=bool(message.get("visible_in_chat", True)),
        )
        count_after = self._session_visible_message_count(session)

        source = (message.get("source") or "-").strip()
        self._append_log(
            "[CHAT_MESSAGE][APPEND] "
            f"session_id={session_id} "
            f"role={role} "
            f"content_len={len(content)} "
            f"source={source} "
            f"count_before={count_before} "
            f"count_after={count_after} "
            f"message_id={(created.message_id or '-')[:8]}",
            echo=True,
        )
        if count_after <= count_before:
            self._append_log(
                "[CHAT_MESSAGE][APPEND_FAILED] "
                f"reason=count_not_increased session_id={session_id} "
                f"request_id={(message.get('request_id') or message.get('bridge_message_id') or '-')}",
                echo=True,
            )
            return False
        self._save_sessions_to_disk()
        return True

    def _update_local_user_message_status(
        self, session, message_id, status, *, detail=""
    ):
        if session is None:
            self._append_log(
                "[CHAT_MESSAGE][STATUS_SKIP] reason=session_none",
                echo=True,
            )
            return False

        message_id = (message_id or "").strip()
        if not message_id:
            self._append_log(
                f"[CHAT_MESSAGE][STATUS_SKIP] session_id={session.session_id} "
                f"reason=missing_message_id",
                echo=True,
            )
            return False

        for message in reversed(session.messages):
            if (message.message_id or "").strip() != message_id:
                continue
            if message.role != "user":
                continue

            message.status = status or ""
            if detail:
                message.detail = detail
            session.updated_at = time.time()

            self._append_log(
                "[CHAT_MESSAGE][STATUS] "
                f"session_id={session.session_id} "
                f"message_id={message_id[:8]} "
                f"status={status or '-'} "
                f"detail={detail or '-'}",
                echo=True,
            )

            self._save_sessions_to_disk()
            return True

        self._append_log(
            "[CHAT_MESSAGE][STATUS_SKIP] "
            f"session_id={session.session_id} "
            f"message_id={message_id[:8]} "
            "reason=message_not_found",
            echo=True,
        )
        return False

    def _count_visible_chat_bubble_widgets(self):
        layout = None
        if hasattr(self, "_chat_messages_layout"):
            layout = self._chat_messages_layout()
        if layout is None:
            layout = getattr(self, "chat_list_layout", None)
        if layout is None:
            return 0
        count = 0
        for index in range(layout.count()):
            item = layout.itemAt(index)
            if item is None or item.spacerItem() is not None:
                continue
            widget = item.widget()
            if widget is not None and widget.objectName() == "ChatBubbleRow":
                count += 1
        return count

    def _ensure_current_session_binding_consistent(self):
        session = self._current_session()
        if session is None:
            return
        if hasattr(self, "_fix_session_remote_url_from_conversation"):
            self._fix_session_remote_url_from_conversation(session, echo=False)
        if hasattr(self, "_refresh_manual_current_page_display"):
            self._refresh_manual_current_page_display()
        if hasattr(self, "_refresh_current_session_binding_display"):
            self._refresh_current_session_binding_display()

    def _render_current_chat_messages(self, *, force_bottom=True, reason=""):
        self._ensure_current_session_binding_consistent()
        session = self._current_session()
        if session is None:
            self._append_log(
                "[CHAT_RENDER][SKIP] reason=no_current_session "
                f"trigger_reason={reason or '-'}",
                echo=True,
            )
            if hasattr(self, "_clear_chat_widgets"):
                self._clear_chat_widgets()
            return False

        visible_messages, _skipped = self._visible_messages_for_render(session)
        if not visible_messages:
            if hasattr(self, "_show_empty_chat_state"):
                self._show_empty_chat_state()
            elif hasattr(self, "_clear_chat_widgets"):
                self._clear_chat_widgets()
            if hasattr(self, "_finish_chat_render_layout"):
                self._finish_chat_render_layout(force_bottom=force_bottom)
            elif hasattr(self, "_adjust_chat_history_height_to_content"):
                self._adjust_chat_history_height_to_content()
            self._append_log(
                "[CHAT_RENDER][EMPTY] "
                f"session_id={session.session_id} "
                f"trigger_reason={reason or '-'}",
                echo=True,
            )
            return False

        bubble_before = self._count_visible_chat_bubble_widgets()
        stale_signature = (
            bubble_before <= 0
            and len(visible_messages) > 0
        )
        if stale_signature:
            self._last_rendered_chat_signature = None
            self._last_rendered_session_id = ""
            force_bottom = True
            self._append_log(
                "[CHAT_RENDER][FORCE] "
                f"session_id={session.session_id} "
                f"reason=stale_signature_or_empty_widgets "
                f"message_count={len(visible_messages)} "
                f"trigger_reason={reason or '-'}",
                echo=True,
            )

        self._render_session_chat(session, force_bottom=force_bottom)
        bubble_after = self._count_visible_chat_bubble_widgets()
        self._append_log(
            "[CHAT_RENDER][CURRENT_DONE] "
            f"session_id={session.session_id} "
            f"count={len(visible_messages)} "
            f"total_messages={len(session.messages)} "
            f"bubbles={bubble_after} "
            f"trigger_reason={reason or '-'}",
            echo=True,
        )
        if bubble_after > 0 and hasattr(self, "_log_chat_render_ui_state"):
            self._log_chat_render_ui_state(
                session, visible_messages, bubble_after
            )
            scroll = None
            if hasattr(self, "_chat_primary_scroll_area"):
                scroll = self._chat_primary_scroll_area()
            else:
                scroll = getattr(self, "chat_scroll", None)
            container = None
            if hasattr(self, "_chat_messages_container"):
                container = self._chat_messages_container()
            else:
                container = getattr(self, "chat_container", None)
            suspicious = False
            if container is not None and container.size().height() <= 0:
                suspicious = True
            if scroll is not None and scroll.viewport() is not None:
                if scroll.viewport().size().height() <= 0:
                    suspicious = True
            if scroll is not None and not scroll.isVisible():
                suspicious = True
            if suspicious and hasattr(self, "_log_chat_render_bubble_geometry"):
                self._log_chat_render_bubble_geometry(bubble_after)
        return bubble_after > 0
