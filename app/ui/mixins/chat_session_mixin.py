"""会话消息写入与聊天区刷新。"""



import copy

import time

import uuid



from app.constants import PENDING_USER_SEND_STATUSES

from app.models import (

    normalize_remote_chatgpt,

    is_waiting_placeholder_message,

    is_reset_placeholder_error_message,

)

from app.utils.legacy_cleanup import assert_no_remote_chatgpt_invalid_fields





class ChatSessionMixin:

    def _clear_runtime_waiting_state_on_startup(self, session):

        if session is None:

            return False



        changed = False



        if float(getattr(session, "reply_waiting_since", 0) or 0) > 0:

            session.reply_waiting_since = 0

            changed = True



        messages = getattr(session, "messages", None)

        if not isinstance(messages, list):

            return changed



        kept_messages = []

        removed_waiting = 0

        removed_reset_error = 0



        for msg in messages:

            if is_waiting_placeholder_message(msg):

                removed_waiting += 1

                changed = True

                continue



            if is_reset_placeholder_error_message(msg):

                removed_reset_error += 1

                changed = True

                continue



            kept_messages.append(msg)



        if changed:

            session.messages = kept_messages

            session.updated_at = time.time()

            self._append_log(

                "[CHAT][STARTUP_DROP_RUNTIME_PLACEHOLDER] "

                f"session_id={getattr(session, 'session_id', '-')} "

                f"removed_waiting={removed_waiting} "

                f"removed_reset_error={removed_reset_error}",

                echo=True,

            )



        return changed



    def _sanitize_message_dict_for_persistence(self, msg_dict):

        if not isinstance(msg_dict, dict):

            return msg_dict

        item = dict(msg_dict)

        if hasattr(self, "_normalize_legacy_message_dict"):

            item = self._normalize_legacy_message_dict(item)

        role = (item.get("role") or "").strip()

        ui_status = (item.get("ui_status") or "").strip()

        if role == "user" and ui_status in PENDING_USER_SEND_STATUSES:

            item["ui_status"] = ""

        item.pop("status", None)



        if is_waiting_placeholder_message(item):

            item["_drop_runtime_waiting_placeholder_on_persist"] = True

            return None



        if is_reset_placeholder_error_message(item):

            item["_drop_reset_placeholder_error_on_persist"] = True

            return None



        return item



    def _normalize_session_for_persistence(self, session):

        if session is None:

            return {}

        remote = normalize_remote_chatgpt(session.remote_chatgpt)

        assert_no_remote_chatgpt_invalid_fields(
            remote,
            owner="GUI save session.remote_chatgpt",
        )

        message_to_dict = getattr(self, "_message_to_dict", None)

        messages_out = []

        for item in session.messages:

            if callable(message_to_dict):

                msg_dict = message_to_dict(item)

            elif isinstance(item, dict):

                msg_dict = copy.deepcopy(item)

            else:

                msg_dict = {

                    "message_id": getattr(item, "message_id", ""),

                    "turn_id": getattr(item, "turn_id", ""),

                    "role": getattr(item, "role", ""),

                    "content": getattr(item, "content", ""),

                    "created_at": getattr(item, "created_at", 0),

                    "ui_status": getattr(item, "ui_status", "") or "",

                    "detail": getattr(item, "detail", "") or "",

                    "message_source": getattr(item, "message_source", "") or "",

                    "bridge_message_id": getattr(item, "bridge_message_id", ""),

                    "parent_message_id": getattr(item, "parent_message_id", ""),

                    "visible_in_chat": bool(

                        getattr(item, "visible_in_chat", True)

                    ),

                }

            cleaned = self._sanitize_message_dict_for_persistence(msg_dict)

            if cleaned is None:

                continue

            messages_out.append(cleaned)

        compose_draft = ""
        drafts_map = getattr(self, "_session_compose_drafts", None) or {}
        raw_draft = drafts_map.get(session.session_id, "")
        if isinstance(raw_draft, str) and raw_draft.strip():
            compose_draft = raw_draft
        return {

            "session_id": session.session_id,

            "title": session.title,

            "created_at": session.created_at,

            "updated_at": session.updated_at,

            "task_type": session.task_type,

            "context_mode": session.context_mode,

            "summary": session.summary,

            "pinned_context": session.pinned_context,

            "remote_chatgpt": dict(remote),

            "reply_waiting_since": 0,
            "compose_draft": compose_draft,
            "messages": messages_out,

        }



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

            message.ui_status = status

            session.updated_at = time.time()

            self._schedule_save_sessions_to_disk()

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

        content = (message.get("content") or "").strip()



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

            ui_status=(

                (message.get("ui_status") or message.get("status") or "")

                .strip()

            ),

            created_at=message.get("created_at"),

            bridge_message_id=(

                (message.get("bridge_message_id") or message.get("request_id") or "")

                .strip()

            ),

            parent_message_id=(message.get("parent_message_id") or "").strip(),

            message_source=(

                (message.get("message_source") or message.get("source") or "")

                .strip()

            ),

            visible_in_chat=(

                message.get("visible_in_chat")

                if "visible_in_chat" in message

                else bool(message.get("visible", True))

            ),

        )

        count_after = self._session_visible_message_count(session)
        if hasattr(self, "_invalidate_session_runtime"):
            self._invalidate_session_runtime(session, reason="append_message_to_session")



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

        self._schedule_save_sessions_to_disk()

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



            message.ui_status = status or ""

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



            self._schedule_save_sessions_to_disk()

            return True



        self._append_log(

            "[CHAT_MESSAGE][STATUS_SKIP] "

            f"session_id={session.session_id} "

            f"message_id={message_id[:8]} "

            "reason=message_not_found",

            echo=True,

        )

        return False



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



    def _render_current_chat_messages(

        self,

        *,

        scroll_policy=None,

        force_bottom=None,

        reason="",

    ):

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

            if hasattr(self, "_refresh_current_conversation_stats"):

                self._refresh_current_conversation_stats(None)

            return False



        if scroll_policy is None and force_bottom is None:

            scroll_policy = "auto_if_near_bottom"

        elif scroll_policy is None:

            scroll_policy = "force_bottom" if force_bottom else "auto_if_near_bottom"



        visible_messages, _skipped = self._visible_messages_for_render(session)

        if not visible_messages:

            self._render_session_chat(session, scroll_policy=scroll_policy)

            self._append_log(

                "[CHAT_RENDER][EMPTY] "

                f"session_id={session.session_id} "

                f"trigger_reason={reason or '-'}",

                echo=True,

            )

            return False



        self._render_session_chat(session, scroll_policy=scroll_policy)

        if getattr(self._bridge_msg, "pending_chat_render", None):

            return False

        if hasattr(self, "_log_chat_render_ui_state"):

            self._log_chat_render_ui_state(session, visible_messages)

        if hasattr(self, "_refresh_current_conversation_stats"):

            self._refresh_current_conversation_stats(session)

        return True

