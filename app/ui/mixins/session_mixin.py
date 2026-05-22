import json
import logging
import time
import traceback
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)


from app.constants import (
    ASSISTANT_WAIT_TEXTS,
    PENDING_ASSISTANT_STATUSES,
    RUNTIME_DIR,
    SESSIONS_FILE,
    SESSIONS_JSON_VERSION,
    SESSION_BIND_LIST_STYLES,
    UNBOUND_SESSION_SEND_HINT,
)
from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    ChatMessage,
    ChatSession,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.legacy_cleanup import assert_no_legacy_fields
from app.ui.widgets.session_list_item import (
    SESSION_LIST_ITEM_HEIGHT,
    SessionListItemWidget,
)
from PyQt5.QtCore import QSize, Qt, QTimer
from PyQt5.QtGui import QTextCursor
from PyQt5.QtWidgets import (
    QInputDialog,
    QListWidgetItem,
    QMenu,
)


class SessionMixin:
    def _message_input_widget(self):
        widget = getattr(self, "message_input", None)
        if widget is not None:
            return widget
        return getattr(self, "message_edit", None)

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
        from app.constants import DEFAULT_APP_SETTINGS

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

    def _render_pending_chat_if_needed(self):
        if hasattr(self, "_flush_pending_chat_render"):
            self._flush_pending_chat_render()
            return
        session_id = getattr(self, "_pending_chat_render_session_id", "")
        if not session_id:
            return
        if session_id != getattr(self, "_current_session_id", ""):
            self._bridge_msg.pending_chat_render_session_id = ""
            return
        if not self._is_chat_view_visible():
            return
        session = self._sessions.get(session_id)
        if session is None:
            self._bridge_msg.pending_chat_render_session_id = ""
            return
        self._bridge_msg.pending_chat_render_session_id = ""
        self._render_session_chat(session, force_bottom=True)

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
                if hasattr(self, "_render_current_chat_messages"):
                    QTimer.singleShot(
                        0,
                        lambda: self._render_current_chat_messages(
                            force_bottom=True,
                            reason="select_same_session",
                        ),
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
            self._bridge_msg.pending_chat_render_session_id = session_id
            chat_rendered = False
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
    def _session_display_title(self, session):
        title = session.title or "新对话"
        if session.has_pending_reply:
            return f"{title} *"
        return title

    @staticmethod
    def _is_default_session_title(title):
        value = str(title or "").strip()
        return value in ("", "新对话", "新的对话", "New chat")

    @staticmethod
    def _compact_session_title_from_text(text, max_len=24):
        value = str(text or "")
        value = value.replace("\r\n", "\n").replace("\r", "\n")
        value = " ".join(value.split())
        value = value.strip()
        if not value:
            return ""
        if len(value) > max_len:
            return value[:max_len] + "…"
        return value

    def _first_visible_chat_message_text(self, session, *, prefer_user=True):
        if session is None:
            return ""
        roles = ("user", "assistant") if prefer_user else ("assistant", "user")
        for role in roles:
            for message in session.messages:
                if not getattr(message, "visible_in_chat", True):
                    continue
                if message.role != role:
                    continue
                text = str(message.content or "").strip()
                if not text:
                    continue
                if text in ASSISTANT_WAIT_TEXTS:
                    continue
                return text
        return ""

    def _latest_visible_chat_message_text(self, session):
        if session is None:
            return ""
        for message in reversed(session.messages):
            if not getattr(message, "visible_in_chat", True):
                continue
            if message.role not in ("user", "assistant"):
                continue
            text = str(message.content or "").strip()
            if not text:
                continue
            if text in ASSISTANT_WAIT_TEXTS:
                return ""
            return text
        return ""

    def _last_assistant_text(self, session):
        if session is None:
            return ""
        for message in reversed(session.messages):
            if not getattr(message, "visible_in_chat", True):
                continue
            if message.role != "assistant":
                continue
            status = (message.ui_status or "").strip()
            if status in PENDING_ASSISTANT_STATUSES:
                continue
            text = str(message.content or "")
            if not text.strip():
                continue
            if text.strip() in ASSISTANT_WAIT_TEXTS:
                continue
            return text
        return ""

    def _auto_rename_session_from_messages(self, session, *, force=False):
        if session is None:
            return False
        if not force and not self._is_default_session_title(session.title):
            return False
        text = self._first_visible_chat_message_text(session, prefer_user=True)
        title = self._compact_session_title_from_text(text, max_len=24)
        if not title:
            return False
        old_title = session.title
        session.title = title
        session.updated_at = time.time()
        self._append_log(
            "[SESSION_TITLE][AUTO_FROM_MESSAGES] "
            f"session_id={session.session_id} "
            f"old={old_title or '-'} "
            f"new={title}"
        )
        return True

    def _session_list_title_text(self, session):
        if session is None:
            return "新对话"
        if self._is_default_session_title(session.title):
            text = self._first_visible_chat_message_text(session, prefer_user=True)
            title = self._compact_session_title_from_text(text, max_len=24)
            if title:
                return title
        return session.title or "新对话"

    def _session_has_pending_assistant_reply(self, session):
        if not session:
            return False

        messages_by_id = {
            (getattr(message, "message_id", "") or "").strip(): message
            for message in session.messages
            if (getattr(message, "message_id", "") or "").strip()
        }

        for message in reversed(session.messages):
            if not getattr(message, "visible_in_chat", True):
                continue

            if message.role != "assistant":
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
                    (parent.message_source or "").strip()
                    if parent is not None
                    else ""
                )
                if (
                    parent is not None
                    and not parent_bridge_id
                    and parent_source in ("local_send", "local_queue")
                ):
                    continue

            status = (message.ui_status or "").strip()
            if status in PENDING_ASSISTANT_STATUSES:
                return True

            text = (message.content or "").strip()
            if text in ASSISTANT_WAIT_TEXTS:
                return True

        return False

    def _session_bound_response_state(self, session):
        if not session:
            return {
                "is_responding": False,
                "response_state": "unknown",
                "can_accept_input": True,
            }
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        client_id = (
            remote.get("client_id")
            or remote.get("prebound_home_client_id")
            or ""
        ).strip()
        if not client_id:
            return {
                "is_responding": False,
                "response_state": "unknown",
                "can_accept_input": True,
            }
        client_info = self._client_info_by_id(
            client_id, getattr(self._bridge_ui, 'last_bridge_status', None)
        )
        if not isinstance(client_info, dict):
            return {
                "is_responding": False,
                "response_state": "unknown",
                "can_accept_input": True,
            }
        return {
            "is_responding": bool(client_info.get("is_responding", False)),
            "response_state": (
                client_info.get("response_state") or "unknown"
            ).strip() or "unknown",
            "can_accept_input": bool(client_info.get("can_accept_input", True)),
        }

    def _session_preview_text(self, session):
        ts = time.strftime("%H:%M", time.localtime(session.updated_at or time.time()))
        response_state = self._session_bound_response_state(session)
        has_pending = self._session_has_pending_assistant_reply(session)
        remote = normalize_remote_chatgpt(session.remote_chatgpt)

        bind_list_state = self._session_bind_list_state(
            session,
            getattr(self._bridge_ui, 'last_bridge_status', None),
        )

        if self._remote_bind_state(remote) == BIND_STATE_WAITING_HOME:
            return f"{ts} · 等待首页上线..."

        if self._auto_bind.pending_session_id == session.session_id:
            return f"{ts} · 等待绑定..."

        if has_pending:
            elapsed = ""
            if hasattr(self, "_session_waiting_preview_suffix"):
                elapsed = self._session_waiting_preview_suffix(session)
            if elapsed:
                return f"{ts} · 等待回复 {elapsed}"
            return f"{ts} · 等待回复..."

        if response_state["is_responding"]:
            return f"{ts} · 正在回答..."

        if bind_list_state == "bound_offline":
            return f"{ts} · 已绑定离线"

        if bind_list_state == "bind_mismatch":
            return f"{ts} · 绑定异常"

        if bind_list_state == "prebound_home":
            return f"{ts} · 等待进入对话"

        if bind_list_state == "waiting_bound_conversation":
            return f"{ts} · 等待打开绑定页"

        if bind_list_state == "waiting_conversation_created":
            return f"{ts} · 创建中"

        text = self._latest_visible_chat_message_text(session)
        if text:
            text = text.replace("\n", " ")
            if len(text) > 36:
                text = text[:36] + "…"
            return f"{ts} · {text}"

        if bind_list_state == "bound_online":
            return f"{ts} · 已绑定在线"

        if remote_binding_enabled(remote) and (remote.get("client_id") or "").strip():
            return f"{ts} · 已绑定离线"

        return ts

    def _session_list_visual_signature(self):
        self._ensure_session_order()
        rows = []
        for sid in self._tab_session_ids:
            session = self._sessions.get(sid)
            if not session:
                continue
            bind_state = self._session_bind_list_state(session, self._bridge_ui.last_bridge_status)
            preview = self._session_preview_text(session)
            pending = self._session_has_pending_assistant_reply(session)
            rows.append((
                sid,
                self._session_list_title_text(session),
                preview,
                bind_state,
                pending,
            ))
        return tuple(rows)

    def _session_item_is_current(self, session_id):
        current_id = getattr(self, "_current_session_id", "") or ""
        return bool(session_id) and session_id == current_id

    def _format_current_session_header_text(self, session=None):
        if hasattr(self, "_format_current_session_header_with_page_id"):
            return self._format_current_session_header_with_page_id(session)
        if session is None:
            return "当前会话：新对话"
        title = self._session_display_title(session) if hasattr(self, "_session_display_title") else ""
        if not title or title == "新对话":
            return "当前会话：新对话"
        return f"当前会话：{title}"

    def _log_session_current_badge_refresh(self, session_id, is_current, title=""):
        if not hasattr(self, "_append_log"):
            return
        self._append_log(
            "[SESSION][CURRENT_BADGE_REFRESH] "
            f"session_id={session_id or '-'} "
            f"title={title or '-'} "
            f"is_current={'true' if is_current else 'false'}",
            echo=False,
        )

    def _refresh_session_list_current_badges(self, session_ids=None):
        if not hasattr(self, "session_list"):
            return
        current_id = getattr(self, "_current_session_id", "") or ""
        if session_ids is None:
            session_ids = []
            for index in range(self.session_list.count()):
                item = self.session_list.item(index)
                if item is None:
                    continue
                sid = item.data(Qt.UserRole) or ""
                if sid:
                    session_ids.append(sid)
        seen = set()
        for session_id in session_ids:
            if session_id in seen:
                continue
            seen.add(session_id)
            is_current = session_id == current_id
            index = self._list_index_for_session(session_id)
            if index < 0:
                continue
            item = self.session_list.item(index)
            if item is None:
                continue
            widget = self.session_list.itemWidget(item)
            prev_current = None
            if widget is not None:
                state = getattr(widget, "_last_apply_state", None)
                if isinstance(state, dict):
                    prev_current = bool(state.get("is_current"))
            badge_updated = False
            if widget is not None and hasattr(widget, "set_is_current_fast"):
                badge_updated = bool(widget.set_is_current_fast(is_current))
            if not badge_updated:
                session = self._sessions.get(session_id)
                if session is not None:
                    self._apply_session_list_item_widget(
                        item,
                        session,
                        selected=is_current,
                    )
            if prev_current is not None and prev_current == is_current:
                continue
            session = self._sessions.get(session_id)
            badge_title = "-"
            if session is not None and hasattr(self, "_session_list_title_text"):
                badge_title = self._session_list_title_text(session)
            self._log_session_current_badge_refresh(
                session_id, is_current, badge_title
            )

    def _set_session_item_selected_fast(self, session_id, selected):
        is_current = self._session_item_is_current(session_id)
        index = self._list_index_for_session(session_id)
        if index < 0:
            return
        item = self.session_list.item(index)
        if item is None:
            return
        widget = self.session_list.itemWidget(item)
        if widget is not None and hasattr(widget, "set_selected_fast"):
            if widget.set_selected_fast(selected, is_current=is_current):
                return
        session = self._sessions.get(session_id)
        if session is None:
            return
        self._apply_session_list_item_widget(
            item,
            session,
            selected=selected,
        )

    def _refresh_session_list_selection_only(
        self, current_session_id, previous_session_id=None
    ):
        if not hasattr(self, "session_list"):
            return
        self._page_cmd.list_refreshing = True
        self.session_list.blockSignals(True)
        try:
            current_index = self._list_index_for_session(current_session_id)
            if current_index >= 0 and self.session_list.currentRow() != current_index:
                self.session_list.setCurrentRow(current_index)
            changed_ids = []
            if previous_session_id:
                changed_ids.append(previous_session_id)
            if current_session_id:
                changed_ids.append(current_session_id)
            seen = set()
            for sid in changed_ids:
                if sid in seen:
                    continue
                seen.add(sid)
                self._set_session_item_selected_fast(
                    sid,
                    selected=(sid == current_session_id),
                )
        finally:
            self.session_list.blockSignals(False)
            self._page_cmd.list_refreshing = False

    def _force_session_list_repaint_now(self):
        session_list = getattr(self, "session_list", None)
        if session_list is None:
            return
        viewport = session_list.viewport()
        if viewport is not None:
            viewport.update()

    def _update_current_session_title_fast(self, session):
        label = getattr(self, "current_session_title", None)
        if label is None:
            return
        label.setText(self._format_current_session_header_text(session))

    def _session_list_item_tooltip(self, session, bind_state):
        style = SESSION_BIND_LIST_STYLES.get(
            bind_state, SESSION_BIND_LIST_STYLES["unbound"]
        )
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        title = self._session_list_title_text(session)
        lines = [
            f"标题：{title}",
            f"绑定状态：{style['label']}",
        ]
        bridge_status = getattr(self._bridge_ui, 'last_bridge_status', None)
        client_id = (
            remote.get("client_id")
            or remote.get("prebound_home_client_id")
            or ""
        ).strip()
        page_instance_id = (
            remote.get("page_instance_id")
            or remote.get("prebound_home_page_instance_id")
            or ""
        ).strip()
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                (remote.get("url") or "").strip()
            )
        page_url = (remote.get("url") or "").strip()
        if bind_state == "bind_mismatch":
            reason = self._session_bind_mismatch_tooltip_reason(session, bridge_status)
            if reason:
                lines.append(reason)
        if bind_state == "unbound" and not remote_binding_enabled(remote):
            lines.append(UNBOUND_SESSION_SEND_HINT)
        elif remote_binding_enabled(remote):
            from app.constants import STATUS_DETAIL_TECH_HINT

            page_display_id = "-"
            if hasattr(self, "_session_bound_page_display_id_text"):
                page_display_id = self._session_bound_page_display_id_text(
                    session, status=bridge_status
                )
            if page_url:
                lines.append(f"绑定页 URL：{page_url}")
            if page_display_id and page_display_id != "-":
                lines.append(f"页面 ID：{page_display_id}")
            lines.append(STATUS_DETAIL_TECH_HINT)
        verbose = (
            hasattr(self, "_is_ui_verbose_status_enabled")
            and self._is_ui_verbose_status_enabled()
        )
        if verbose and remote_binding_enabled(remote):
            lines.extend([
                f"client_id：{client_id or '-'}",
                f"page_instance_id：{page_instance_id or '-'}",
                f"conversation_id：{conversation_id or '-'}",
            ])
            client_info = (
                self._client_info_by_id(client_id, bridge_status)
                if client_id
                else None
            )
            if client_info:
                focus_txt = "是" if client_info.get("has_focus") else "否"
                lines.append(f"focus：{focus_txt}")
                lines.append(
                    f"last_seen：{self._format_last_seen_ago(client_info.get('last_seen'))}"
                )
        if self._session_has_pending_assistant_reply(session):
            elapsed = ""
            if hasattr(self, "_session_waiting_preview_suffix"):
                elapsed = self._session_waiting_preview_suffix(session)
            if elapsed:
                lines.append(f"消息状态：等待回复 {elapsed}")
            else:
                lines.append("消息状态：等待回复")
        else:
            response_state = self._session_bound_response_state(session)
            if response_state["is_responding"]:
                lines.append("消息状态：正在回答")
            elif response_state["response_state"] == "idle":
                lines.append("消息状态：空闲可发送")
        return "\n".join(lines)

    def _apply_session_list_item_widget(self, item, session, *, selected=False):
        bind_state = self._session_bind_list_state(session, self._bridge_ui.last_bridge_status)
        is_current = self._session_item_is_current(session.session_id)
        widget = self.session_list.itemWidget(item)
        if widget is None:
            widget = SessionListItemWidget()
            self.session_list.setItemWidget(item, widget)
        status_text = None
        if hasattr(self, "_session_list_bind_status_text"):
            status_text = self._session_list_bind_status_text(session, bind_state)
        widget.apply_state(
            title=self._session_list_title_text(session),
            subtitle=self._session_preview_text(session),
            bind_state=bind_state,
            pending_reply=self._session_has_pending_assistant_reply(session),
            selected=selected,
            is_current=is_current,
            tooltip=self._session_list_item_tooltip(session, bind_state),
            status_text=status_text,
        )
        viewport_w = max(0, self.session_list.viewport().width())
        item_w = viewport_w if viewport_w > 0 else 220
        item.setSizeHint(QSize(item_w, SESSION_LIST_ITEM_HEIGHT))
        widget.setMaximumWidth(16777215)

    def _update_current_session_title(self, session=None):
        if not hasattr(self, "current_session_title"):
            return
        session = session or self._current_session()
        if not session:
            self.current_session_title.setText("当前会话：新对话")
            if hasattr(self, "_update_current_session_url_display"):
                self._update_current_session_url_display()
            return
        if self._is_default_session_title(session.title):
            self._auto_rename_session_from_messages(session)
        self.current_session_title.setText(
            self._format_current_session_header_text(session)
        )
        if hasattr(self, "_update_current_session_url_display"):
            self._update_current_session_url_display()
    def _list_index_for_session(self, session_id):
        for index in range(self.session_list.count()):
            item = self.session_list.item(index)
            if item and item.data(Qt.UserRole) == session_id:
                return index
        return -1
    def _sync_session_order_from_list(self):
        ordered = []
        for index in range(self.session_list.count()):
            item = self.session_list.item(index)
            if not item:
                continue
            session_id = item.data(Qt.UserRole)
            if session_id and session_id in self._sessions:
                ordered.append(session_id)
        if ordered:
            self._tab_session_ids = ordered
    def _ensure_session_order(self):
        valid = [sid for sid in self._tab_session_ids if sid in self._sessions]
        for session_id in self._sessions:
            if session_id not in valid:
                valid.append(session_id)
        self._tab_session_ids = valid
    def _refresh_session_list(self, select_session_id=None):
        if not hasattr(self, "session_list"):
            return
        self._ensure_session_order()
        new_sig = self._session_list_visual_signature()
        old_sig = getattr(self, "_last_session_list_visual_signature", None)
        target_id = select_session_id or self._current_session_id

        if old_sig == new_sig:
            if target_id:
                list_index = self._list_index_for_session(target_id)
                if list_index >= 0 and self.session_list.currentRow() != list_index:
                    self._page_cmd.list_refreshing = True
                    self.session_list.blockSignals(True)
                    self.session_list.setCurrentRow(list_index)
                    self.session_list.blockSignals(False)
                    self._page_cmd.list_refreshing = False
            self._refresh_session_list_current_badges(
                [target_id] if target_id else None
            )
            return

        structure_same = (
            old_sig
            and len(old_sig) == len(new_sig)
            and all(old_row[0] == new_row[0] for old_row, new_row in zip(old_sig, new_sig))
        )

        self._page_cmd.list_refreshing = True
        self.session_list.blockSignals(True)

        if structure_same:
            old_by_id = {}
            if old_sig:
                old_by_id = {row[0]: row for row in old_sig}

            for index, row in enumerate(new_sig):
                session_id = row[0]
                old_row = old_by_id.get(session_id)

                if old_row == row:
                    continue

                session = self._sessions.get(session_id)
                item = self.session_list.item(index)
                if not item or not session:
                    continue

                self._apply_session_list_item_widget(
                    item,
                    session,
                    selected=self._session_item_is_current(session_id),
                )
        else:
            self.session_list.clear()
            for row in new_sig:
                session_id = row[0]
                session = self._sessions.get(session_id)
                if not session:
                    continue
                item = QListWidgetItem()
                item.setData(Qt.UserRole, session_id)
                self.session_list.addItem(item)
                self._apply_session_list_item_widget(
                    item,
                    session,
                    selected=self._session_item_is_current(session_id),
                )

        if target_id:
            list_index = self._list_index_for_session(target_id)
            if list_index >= 0:
                self.session_list.setCurrentRow(list_index)
        self.session_list.blockSignals(False)
        self._page_cmd.list_refreshing = False
        self._last_session_list_visual_signature = new_sig
        self._refresh_session_list_current_badges()

    def _on_session_list_pressed_fast(self, item):
        if self._page_cmd.list_refreshing or item is None:
            return
        session_id = item.data(Qt.UserRole)
        if not session_id:
            return
        if session_id == getattr(self, "_current_session_id", ""):
            self._focus_message_input_later()
            if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):
                self._append_log(
                    f"[SESSION_LIST][CURRENT_CLICK_FOCUS_INPUT] session_id={session_id}",
                    echo=False,
                )
            return
        self._select_session(session_id)

    def _on_session_list_changed(self, current, previous):
        if self._page_cmd.list_refreshing or current is None:
            return
        session_id = current.data(Qt.UserRole)
        if not session_id:
            return
        if session_id == getattr(self, "_current_session_id", ""):
            return
        self._select_session(session_id)
    def _on_session_list_reordered(self, parent, start, end, destination, row):
        self._sync_session_order_from_list()
        self._save_sessions_to_disk()
    def _on_session_list_double_clicked(self, item):
        if not item:
            return
        session_id = item.data(Qt.UserRole)
        if not session_id:
            return
        if session_id != self._current_session_id:
            self._select_session(session_id)
        session = self._sessions.get(session_id)
        if not session:
            return
        self._open_bound_page_for_session(
            session,
            label=f"对话「{session.title}」ChatGPT 页面",
            fallback_live=(session_id == self._current_session_id),
        )
    def _on_session_list_context_menu(self, pos):
        item = self.session_list.itemAt(pos)
        if not item:
            return
        session_id = item.data(Qt.UserRole)
        if not session_id:
            return
        if session_id != self._current_session_id:
            self._select_session(session_id)
        session = self._sessions.get(session_id)
        open_url = self._session_openable_chatgpt_url(session)
        if not open_url and session_id == self._current_session_id:
            open_url = self._live_openable_chatgpt_url()
        menu = QMenu(self)
        open_page_action = menu.addAction("打开 ChatGPT 页面")
        open_page_action.setEnabled(bool(open_url))
        if open_url:
            open_page_action.setToolTip(open_url)
        else:
            open_page_action.setToolTip(
                "发送消息后会自动记录页面；也可先在列表选中页面后点击「绑定所选页面」"
            )
        menu.addSeparator()
        rename_action = menu.addAction("重命名")
        clear_action = menu.addAction("清空对话")
        delete_action = menu.addAction("删除对话")
        action = menu.exec_(self.session_list.mapToGlobal(pos))
        if action == open_page_action:
            if session:
                self._open_bound_page_for_session(
                    session,
                    label=f"对话「{session.title}」ChatGPT 页面",
                    fallback_live=(session_id == self._current_session_id),
                )
        elif action == rename_action:
            self._rename_current_session()
        elif action == clear_action:
            self._clear_current_session()
        elif action == delete_action:
            self._delete_session_by_id(session_id)
    def _delete_current_session(self):
        session = self._current_session()
        if not session:
            return
        self._delete_session_by_id(session.session_id)

    def _select_next_session_after_delete(self, *, deleted_session_id, list_index=-1):
        if not self._tab_session_ids:
            self._current_session_id = None
            if hasattr(self, "_refresh_current_chat_panel"):
                self._refresh_current_chat_panel()
            return ""
        if list_index < 0:
            list_index = self._list_index_for_session(deleted_session_id)
        if list_index < 0:
            list_index = 0
        next_index = min(max(list_index, 0), len(self._tab_session_ids) - 1)
        next_id = self._tab_session_ids[next_index]
        self._select_session(next_id)
        return next_id

    def _delete_session_by_id(self, session_id):
        if session_id not in self._sessions:
            return

        self._append_log(
            f"[SESSION][DELETE][START] session_id={session_id}",
            echo=True,
        )

        was_current = session_id == getattr(self, "_current_session_id", "")
        is_last_session = len(self._tab_session_ids) <= 1

        if hasattr(self, "_clear_session_binding"):
            self._clear_session_binding(session_id, reason="session_deleted")
        if hasattr(self, "_clear_pending_web_sync_for_session"):
            self._clear_pending_web_sync_for_session(session_id)

        list_index = self._list_index_for_session(session_id)
        if is_last_session:
            self._clear_current_session()
            next_session_id = getattr(self, "_current_session_id", "") or ""
            self._refresh_session_list(select_session_id=next_session_id or None)
        else:
            for message_id, sid in list(self._message_to_session.items()):
                if sid == session_id:
                    del self._message_to_session[message_id]
                    self._message_to_turn.pop(message_id, None)
            if session_id in self._tab_session_ids:
                self._tab_session_ids.remove(session_id)
            if isinstance(getattr(self, "_session_send_queues", None), dict):
                self._session_send_queues.pop(session_id, None)
            if hasattr(self, "_purge_session_binding_caches"):
                self._purge_session_binding_caches(session_id)
            del self._sessions[session_id]
            if was_current:
                next_session_id = self._select_next_session_after_delete(
                    deleted_session_id=session_id,
                    list_index=list_index,
                )
            else:
                next_session_id = getattr(self, "_current_session_id", "") or ""
            self._refresh_session_list(
                select_session_id=next_session_id or None
            )

        self._append_log(
            f"[SESSION][DELETE][DONE] session_id={session_id}",
            echo=True,
        )

        current_bound_url = ""
        current_session = self._current_session()
        if current_session and hasattr(self, "_current_session_bound_url"):
            current_bound_url, _state = self._current_session_bound_url()
        if hasattr(self, "_refresh_current_session_binding_display"):
            self._refresh_current_session_binding_display()
        if was_current and hasattr(self, "_refresh_current_chat_panel"):
            self._refresh_current_chat_panel()
        self._append_log(
            "[SESSION][DELETE][UI_REFRESH] "
            f"deleted_session_id={session_id} "
            f"next_session_id={next_session_id or '-'} "
            f"current_bound_url={current_bound_url or '-'}",
            echo=True,
        )
        self._save_sessions_to_disk()
    def _rename_current_session(self):
        session = self._current_session()
        if not session:
            return
        title, ok = QInputDialog.getText(
            self, "重命名对话", "对话标题：", text=session.title
        )
        if not ok:
            return
        new_title = title.strip()
        if not new_title:
            self._add_system_message("对话标题不能为空。")
            return
        session.title = new_title
        session.updated_at = time.time()
        self._refresh_session_list(select_session_id=session.session_id)
        self._update_current_session_title(session)
        self._save_sessions_to_disk()
    def _clear_current_session_messages_before_rebind_or_sync(self, reason: str = ""):
        """绑定/同步前清空当前选中会话的聊天记录（不清标题、输入框、上传文件）。"""
        session = self._current_session()
        if not session:
            return 0
        if session.session_id != (self._current_session_id or ""):
            return 0

        reason_text = (reason or "").strip()
        old_message_count = len(session.messages or [])
        auto_bind_reasons = (
            "auto_bind_conversation",
            "auto_bind_before_sync",
            "auto_rebind",
        )
        if old_message_count <= 0 or any(
            token in reason_text for token in auto_bind_reasons
        ):
            if hasattr(self, "_append_log"):
                self._append_log(
                    "[CHAT][CLEAR_SKIP] "
                    "reason=auto_bind_or_empty "
                    f"detail={reason_text or '-'} "
                    f"old_message_count={old_message_count}",
                    echo=False,
                )
            return old_message_count
        if isinstance(getattr(self, "_session_send_queues", None), dict):
            self._session_send_queues.pop(session.session_id, None)
        for bridge_id, sid in list(self._message_to_session.items()):
            if sid == session.session_id:
                del self._message_to_session[bridge_id]
                self._message_to_turn.pop(bridge_id, None)
                self._bridge_msg.finalized_bridge_message_ids.discard(bridge_id)
                self._bridge_msg.ack_success_message_ids.discard(bridge_id)

        session.messages.clear()
        session.updated_at = time.time()
        session.has_pending_reply = False
        session.pending_reply_since = 0
        if hasattr(self, "_mark_session_waiting_finished"):
            self._mark_session_waiting_finished(
                session, reason="clear_before_rebind_or_sync"
            )
        if hasattr(session, "summary"):
            session.summary = ""

        cleared_map = getattr(self, "_session_cleared_for_rebind_sync", None)
        if not isinstance(cleared_map, dict):
            cleared_map = {}
            self._session_cleared_for_rebind_sync = cleared_map
        cleared_map[session.session_id] = {
            "reason": (reason or "").strip(),
            "at": time.time(),
            "old_message_count": old_message_count,
        }

        self._append_log(
            "[CHAT][CLEAR_BEFORE_BIND_OR_SYNC] "
            f"session_id={session.session_id} "
            f"reason={reason or '-'} "
            f"old_message_count={old_message_count}",
            echo=True,
        )

        self._render_session_chat(session, force_bottom=True)
        self._refresh_session_list(select_session_id=session.session_id)
        self._update_current_session_title(session)
        self._save_sessions_to_disk()
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="clear_before_bind_or_sync")
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
        return old_message_count

    def _session_was_cleared_for_rebind_or_sync(self, session_id):
        cleared_map = getattr(self, "_session_cleared_for_rebind_sync", None)
        if not isinstance(cleared_map, dict):
            return False
        return (session_id or "").strip() in cleared_map

    def _sync_failure_text_after_pre_clear(self, session_id, detail=""):
        session = self._sessions.get((session_id or "").strip())
        if session is None:
            return detail or "同步失败"
        if not self._session_was_cleared_for_rebind_or_sync(session.session_id):
            return detail or "同步失败"
        if len(session.messages or []) > 0:
            return detail or "同步失败"
        base = "同步失败，当前会话已清空，请重新点击同步网页对话。"
        if detail:
            return f"{base}（{detail}）"
        return base

    def _log_sync_failed_after_clear(self, session_id, reason="", error=""):
        if not self._session_was_cleared_for_rebind_or_sync(session_id):
            return
        self._append_log(
            "[SYNC][FAILED_AFTER_CLEAR] "
            f"session_id={session_id or '-'} "
            f"reason={reason or '-'} "
            f"error={error or '-'}",
            echo=True,
        )

    def _clear_current_session(self):
        session = self._current_session()
        if not session:
            return
        if isinstance(getattr(self, "_session_send_queues", None), dict):
            self._session_send_queues.pop(session.session_id, None)
        for bridge_id, sid in list(self._message_to_session.items()):
            if sid == session.session_id:
                del self._message_to_session[bridge_id]
                self._message_to_turn.pop(bridge_id, None)
                self._bridge_msg.finalized_bridge_message_ids.discard(bridge_id)
                self._bridge_msg.ack_success_message_ids.discard(bridge_id)
        session.messages.clear()
        session.updated_at = time.time()
        session.has_pending_reply = False
        session.pending_reply_since = 0
        if hasattr(self, "_mark_session_waiting_finished"):
            self._mark_session_waiting_finished(session, reason="clear_session")
        if hasattr(self, "_set_tm_action_hint"):
            self._set_tm_action_hint("当前对话已清空")
        if hasattr(self, "_append_log"):
            self._append_log(
                f"[SESSION][CLEAR] session_id={session.session_id} title={session.title}",
                echo=True,
            )
        self._render_session_chat(session, force_bottom=True)
        self._refresh_session_list(select_session_id=session.session_id)
        self._update_current_session_title(session)
        self._save_sessions_to_disk()
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
        return message
    def _find_assistant_by_turn(self, session, turn_id):
        if not session or not turn_id:
            return None
        for message in reversed(session.messages):
            if message.turn_id == turn_id and message.role in ("assistant", "error"):
                return message
        return None
    def _resolve_inbound_binding(self, item):
        bridge_id = item.get("message_id") or ""
        session_id = (
            self._message_to_session.get(bridge_id) or item.get("session_id") or ""
        )
        turn_id = self._message_to_turn.get(bridge_id) or item.get("turn_id") or ""
        if not bridge_id or not session_id or not turn_id:
            return None, "", bridge_id
        session = self._sessions.get(session_id)
        if session is None:
            return None, "", bridge_id
        return session, turn_id, bridge_id
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
    def _mark_session_pending(self, session_id):
        session = self._sessions.get(session_id)
        if not session:
            return
        session.has_pending_reply = True
        session.pending_reply_since = time.time()
        if hasattr(self, "_mark_session_waiting_started"):
            self._mark_session_waiting_started(session, reason="mark_session_pending")
        self._refresh_session_list(select_session_id=self._current_session_id)
    @staticmethod
    def _message_to_dict(message):
        return {
            "message_id": message.message_id,
            "turn_id": message.turn_id,
            "role": message.role,
            "content": message.content,
            "created_at": message.created_at,
            "ui_status": message.ui_status or "",
            "detail": message.detail or "",
            "message_source": message.message_source or "",
            "bridge_message_id": message.bridge_message_id,
            "parent_message_id": message.parent_message_id,
            "visible_in_chat": message.visible_in_chat,
        }
    def _session_float_field(self, data, field, default=None, *, scope="session"):
        fallback = time.time() if default is None else default
        raw = data.get(field) if isinstance(data, dict) else None
        try:
            return float(raw if raw is not None else fallback)
        except (TypeError, ValueError) as error:
            if hasattr(self, "_append_log"):
                self._append_log(
                    "[SESSION][FLOAT_FIELD_FALLBACK] "
                    f"scope={scope} field={field} value={raw!r} "
                    f"default={fallback!r} "
                    f"error_type={type(error).__name__} error={error}",
                    echo=True,
                )
            try:
                return float(fallback)
            except (TypeError, ValueError) as nested_error:
                if hasattr(self, "_append_log"):
                    self._append_log(
                        "[SESSION][FLOAT_DEFAULT_INVALID] "
                        f"scope={scope} field={field} fallback={fallback!r} "
                        f"error_type={type(nested_error).__name__} error={nested_error}",
                        echo=True,
                    )
                return time.time()

    def _message_from_dict(self, data):
        from app.utils.legacy_cleanup import assert_no_legacy_fields

        item = dict(data) if isinstance(data, dict) else {}
        assert_no_legacy_fields(item, owner="session_message_load")
        content = item.get("content")
        if content is None:
            content = ""
        return ChatMessage(
            role=item.get("role", "system"),
            content=content,
            created_at=self._session_float_field(
                item,
                "created_at",
                scope="message",
            ),
            message_id=item.get("message_id", ""),
            turn_id=item.get("turn_id", ""),
            ui_status=(item.get("ui_status") or "").strip(),
            detail=item.get("detail", ""),
            message_source=(item.get("message_source") or "").strip(),
            bridge_message_id=item.get("bridge_message_id", ""),
            parent_message_id=item.get("parent_message_id", ""),
            visible_in_chat=bool(item.get("visible_in_chat", True)),
        )
    def _session_to_dict(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        assert_no_legacy_fields(remote, owner="GUI save session.remote_chatgpt")
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
            "pending_reply_since": float(session.pending_reply_since or 0),
            "messages": [self._message_to_dict(item) for item in session.messages],
        }
    def _session_from_dict(self, data):
        if not isinstance(data, dict):
            raise ValueError(f"session item must be dict, got {type(data).__name__}")

        messages = []
        for index, item in enumerate(data.get("messages") or []):
            if not isinstance(item, dict):
                self._append_log(
                    f"[SESSION][MESSAGE_SKIP_INVALID_ITEM] "
                    f"session_id={data.get('session_id') or '-'} "
                    f"index={index} type={type(item).__name__}",
                    echo=True,
                )
                continue
            messages.append(self._message_from_dict(item))
        remote = normalize_remote_chatgpt(data.get("remote_chatgpt") or {})
        pending_reply_since = self._session_float_field(data, "pending_reply_since")
        if pending_reply_since <= 0 and bool(data.get("has_pending_reply")):
            pending_reply_since = self._session_float_field(data, "updated_at") or time.time()
        return ChatSession(
            session_id=data.get("session_id") or str(uuid.uuid4()),
            title=data.get("title") or "新对话",
            created_at=self._session_float_field(data, "created_at"),
            updated_at=self._session_float_field(data, "updated_at"),
            task_type=data.get("task_type", ""),
            context_mode=data.get("context_mode", ""),
            summary=data.get("summary", ""),
            pinned_context=data.get("pinned_context", ""),
            remote_chatgpt=remote,
            messages=messages,
            pending_reply_since=pending_reply_since,
        )
    def _save_sessions_to_disk(self):
        if not self._save_chat_history:
            return
        sessions_file = None
        tmp_file = None
        try:
            data_dir = Path(self._chat_sessions_path or RUNTIME_DIR)
            data_dir.mkdir(parents=True, exist_ok=True)
            sessions_file = data_dir / "chat_sessions.json"
            tmp_file = data_dir / "chat_sessions.json.tmp"
            payload = {
                "version": SESSIONS_JSON_VERSION,
                "current_session_id": self._current_session_id,
                "tab_order": list(self._tab_session_ids),
                "sessions": [
                    self._session_to_dict(item) for item in self._sessions.values()
                ],
                "message_to_session": self._message_to_session,
                "message_to_turn": self._message_to_turn,
                "finalized_bridge_message_ids": list(
                    self._bridge_msg.finalized_bridge_message_ids
                ),
            }
            text = json.dumps(payload, ensure_ascii=False, indent=2)
            tmp_file.write_text(text, encoding="utf-8")
            tmp_file.replace(sessions_file)
        except Exception as error:
            detail = (
                "[SESSION][SAVE_FAILED] "
                f"path={sessions_file or '-'} tmp_path={tmp_file or '-'} "
                f"error_type={type(error).__name__} error={error}\n"
                f"{traceback.format_exc()}"
            )
            self._append_log(detail, echo=True)
            if hasattr(self, "_set_tm_action_hint"):
                self._set_tm_action_hint(f"保存对话记录失败：{error}")
            if (
                hasattr(self, "_add_system_message")
                and not getattr(self, "_session_save_failure_notifying", False)
            ):
                self._session_save_failure_notifying = True
                try:
                    self._add_system_message(
                        f"保存对话记录失败，请检查磁盘权限或路径：{error}"
                    )
                finally:
                    self._session_save_failure_notifying = False
    def _load_sessions_from_disk(self):
        data_dir = Path(self._chat_sessions_path or RUNTIME_DIR)
        sessions_file = data_dir / "chat_sessions.json"
        if not sessions_file.exists() and SESSIONS_FILE.exists():
            sessions_file = SESSIONS_FILE
        if not sessions_file.exists():
            return
        try:
            raw = sessions_file.read_text(encoding="utf-8")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError(
                    f"chat_sessions.json 顶层必须是 object，实际是 {type(payload).__name__}"
                )
        except Exception as error:
            detail = f"加载对话记录失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            try:
                broken_file = sessions_file.with_suffix(".json.broken")
                sessions_file.replace(broken_file)
                self._append_log(
                    f"[SESSION][BACKUP_BROKEN] path={broken_file}",
                    echo=True,
                )
            except Exception as backup_error:
                self._append_log(
                    f"[SESSION][BACKUP_BROKEN_FAILED] {backup_error}\n"
                    f"{traceback.format_exc()}",
                    echo=True,
                )
            self._sessions = {}
            session = self._create_session(select=False)
            self._append_session_message(
                session,
                "system",
                "对话记录加载失败，已创建新对话。请查看运行日志了解详情。",
            )
            return
        self._sessions = {}
        for index, item in enumerate(payload.get("sessions") or []):
            if not isinstance(item, dict):
                self._append_log(
                    f"[SESSION][LOAD_SKIP_INVALID_ITEM] index={index} "
                    f"type={type(item).__name__}",
                    echo=True,
                )
                continue
            try:
                session = self._session_from_dict(item)
            except Exception as error:
                self._append_log(
                    "[SESSION][LOAD_ITEM_FAILED] "
                    f"index={index} error_type={type(error).__name__} "
                    f"error={error}\n{traceback.format_exc()}",
                    echo=True,
                )
                continue
            self._sessions[session.session_id] = session
        self._current_session_id = payload.get("current_session_id")
        self._tab_session_ids = list(
            payload.get("tab_order") or payload.get("tab_session_ids") or []
        )
        if not self._tab_session_ids:
            saved_tabs = self._settings.value("tab_session_ids")
            if saved_tabs:
                self._tab_session_ids = [str(item) for item in saved_tabs]
        self._message_to_session = dict(payload.get("message_to_session") or {})
        self._message_to_turn = dict(payload.get("message_to_turn") or {})
        finalized = payload.get("finalized_bridge_message_ids") or payload.get(
            "finalized_message_ids"
        ) or []
        self._bridge_msg.finalized_bridge_message_ids = set(finalized)
        self._migrate_loaded_session_messages()
        self._migrate_loaded_remote_bindings()
        if hasattr(self, "_restore_waiting_timers_after_load"):
            self._restore_waiting_timers_after_load()

    def _migrate_loaded_remote_bindings(self):
        from app.utils.bind_runtime import migrate_transient_from_remote

        changed = False
        for session in self._sessions.values():
            old_remote = dict(session.remote_chatgpt or {})
            old_bind_state = (old_remote.get("bind_state") or "").strip()
            cleaned = migrate_transient_from_remote(self, session, old_remote)
            remote = normalize_remote_chatgpt(cleaned)

            conversation_id = (remote.get("conversation_id") or "").strip()
            conversation_url = (
                (remote.get("url") or "").strip()
            ).strip()

            if not conversation_id and conversation_url:
                conversation_id = parse_conversation_id(conversation_url)

            if conversation_id:
                if not conversation_url:
                    conversation_url = f"https://chatgpt.com/c/{conversation_id}"

                remote["conversation_id"] = conversation_id
                remote["url"] = conversation_url

                new_bind_state = remote.get("bind_state")
                if remote.get("bind_state") in (
                    BIND_STATE_UNBOUND,
                    BIND_STATE_WAITING_HOME,
                    BIND_STATE_PREBOUND_HOME,
                    BIND_STATE_WAITING_CONVERSATION_CREATED,
                    "",
                    None,
                ):
                    remote["bind_state"] = BIND_STATE_BOUND_CONVERSATION
                    new_bind_state = BIND_STATE_BOUND_CONVERSATION

                if remote != old_remote or old_bind_state != new_bind_state:
                    self._append_log(
                        "[SESSION][MIGRATE_REMOTE] "
                        f"session_id={session.session_id} "
                        f"old_bind_state={old_bind_state or '-'} "
                        f"new_bind_state={new_bind_state or '-'} "
                        f"conversation_id={conversation_id} "
                        f"url={conversation_url}"
                    )

            if remote != old_remote:
                session.remote_chatgpt = remote
                changed = True

        if changed:
            self._save_sessions_to_disk()

    def _restore_ui_settings(self):
        if self._remember_window_geometry:
            geometry = self._settings.value("geometry")
            if geometry is not None:
                self.restoreGeometry(geometry)
            window_state = self._settings.value("window_state")
            if window_state is not None and self._remember_window_position:
                self.restoreState(window_state)
        if self._restore_main_tab:
            try:
                main_tab_index = int(self._settings.value("main_tab_index", 0))
            except (TypeError, ValueError) as exc:
                logger.warning(
                    "[UI_SETTINGS][RESTORE][MAIN_TAB_INVALID] error=%s", exc
                )
                main_tab_index = 0
            if 0 <= main_tab_index < self.main_tabs.count():
                self.main_tabs.setCurrentIndex(main_tab_index)
        if hasattr(self, "_restore_chat_sub_tab_index"):
            self._restore_chat_sub_tab_index()
    def _save_ui_settings(self):
        if self._remember_window_geometry:
            self._settings.setValue("geometry", self.saveGeometry())
        if self._remember_window_position:
            self._settings.setValue("window_state", self.saveState())
        if hasattr(self, "_save_splitter_sizes_now"):
            self._save_splitter_sizes_now()
        if hasattr(self, "_save_chat_sub_tab_index"):
            self._save_chat_sub_tab_index()
        self._settings.setValue("main_tab_index", self.main_tabs.currentIndex())
        self._settings.setValue("tab_session_ids", self._tab_session_ids)
        if self._current_session_id:
            self._settings.setValue("current_session_id", self._current_session_id)
        if self._saved_page_url and hasattr(self, "_persist_page_url"):
            self._persist_page_url(self._saved_page_url)
