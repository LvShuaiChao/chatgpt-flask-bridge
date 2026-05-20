import html
import json
import re
import sys
import time
import traceback
import uuid
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

import server
from log_utils import append_log, append_exception, clear_log_file, get_log_file_path

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
    CHATGPT_HOME_URL,
    DEFAULT_APP_SETTINGS,
    RUNTIME_DIR,
    SESSIONS_FILE,
    SESSIONS_JSON_VERSION,
    SETTINGS_APP,
    SETTINGS_ORG,
)
from app.models import ChatMessage, ChatSession, default_remote_chatgpt, normalize_remote_chatgpt
from app.url_utils import parse_conversation_id
from app.ui.widgets.bridge_notifier import BridgeNotifier
from app.ui.widgets.chat_bubble import ChatBubble, SystemBubble
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.session_list import SessionListWidget
from PyQt5.QtCore import QObject, QSettings, QUrl, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QDesktopServices, QFont
from PyQt5.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class ChatRenderMixin:
    @staticmethod
    def _format_ts(ts):
        if not ts:
            return "-"
        return time.strftime("%H:%M:%S", time.localtime(ts))
    def _format_message_ts(self, created_at):
        if not self._show_timestamp:
            return ""
        return time.strftime("%H:%M:%S", time.localtime(created_at))
    def _clear_chat_widgets(self):
        keep = {self.empty_state_widget, self.chat_bottom_spacer}
        index = 0
        while index < self.chat_list_layout.count():
            item = self.chat_list_layout.itemAt(index)
            widget = item.widget() if item else None
            if widget in keep:
                index += 1
                continue
            if widget:
                self.chat_list_layout.removeWidget(widget)
                widget.deleteLater()
                continue
            index += 1
        self._reply_bubbles_by_message_id.clear()
        self._user_bubbles_by_message_id.clear()
    def _session_has_chat_messages(self, session=None):
        session = session or self._current_session()
        if not session:
            return False
        for message in session.messages:
            if message.visible_in_chat and message.role in ("user", "assistant"):
                return True
        return False
    def _update_chat_empty_state(self, session=None):
        if not hasattr(self, "empty_state_widget"):
            return
        # 空对话不显示「还没有消息」占位；仅保留 system 等真实消息气泡
        self.empty_state_widget.setVisible(False)
    def _session_chat_render_signature(self, session):
        rows = []
        for message in session.messages:
            if not message.visible_in_chat:
                continue
            rows.append((
                message.message_id,
                message.role,
                message.content,
                message.status,
            ))
        return tuple(rows)

    def _render_session_chat(self, session):
        self._clear_chat_widgets()
        for message in session.messages:
            if not message.visible_in_chat:
                continue
            self._add_bubble_from_message(message, register_only=False)
        self._update_chat_empty_state(session)
        self._last_rendered_chat_signature = self._session_chat_render_signature(session)
        self._scroll_to_bottom()

    def _update_existing_reply_bubble(self, message):
        if not message or not message.message_id:
            return False
        bubble = self._reply_bubbles_by_message_id.get(message.message_id)
        if bubble is None:
            return False
        if message.role == "error":
            bubble.set_error(message.text, message.status)
        else:
            bubble.set_text(message.text, message.status)
        return True
    def _add_bubble_from_message(self, message, register_only=False):
        ts_text = self._format_message_ts(message.created_at)
        if message.role == "system":
            bubble = SystemBubble(message.text, ts_text)
        else:
            bubble = ChatBubble(
                message.role,
                message.text,
                ts_text,
                message.status,
                body_pt=self._chat_font_pt,
            )
        row = QWidget()
        row_layout = QHBoxLayout(row)
        row_layout.setContentsMargins(0, 0, 0, 0)
        row_layout.setSpacing(8)
        if message.role == "user":
            row_layout.addStretch()
            row_layout.addWidget(bubble)
        elif message.role == "system":
            row_layout.addStretch()
            row_layout.addWidget(bubble)
            row_layout.addStretch()
        elif message.role == "error":
            row_layout.addStretch()
            row_layout.addWidget(bubble)
            row_layout.addStretch()
        else:
            row_layout.addWidget(bubble)
            row_layout.addStretch()
        insert_index = max(0, self.chat_list_layout.count() - 1)
        self.chat_list_layout.insertWidget(insert_index, row)
        if message.message_id:
            if message.role == "user":
                self._user_bubbles_by_message_id[message.message_id] = bubble
            elif message.role in ("assistant", "error"):
                self._reply_bubbles_by_message_id[message.message_id] = bubble
        if not register_only:
            self._update_chat_empty_state()
        return bubble
    def _add_system_message(self, text):
        session = self._ensure_current_session()
        self._append_session_message(session, "system", text)
        if session.session_id == self._current_session_id:
            self._add_bubble_from_message(session.messages[-1])
            self._scroll_to_bottom()
        self._refresh_session_list(select_session_id=session.session_id)
        self._save_sessions_to_disk()
    def _scroll_to_bottom(self):
        if not self._auto_scroll_to_bottom:
            return
        QTimer.singleShot(0, self._do_scroll_to_bottom)
    def _do_scroll_to_bottom(self):
        bar = self.chat_scroll.verticalScrollBar()
        bar.setValue(bar.maximum())
    def _last_assistant_text(self, session=None):
        session = session or self._current_session()
        if not session:
            return ""
        for message in reversed(session.messages):
            if message.role == "assistant" and message.text.strip():
                if message.content.strip() not in ASSISTANT_WAIT_TEXTS:
                    return message.content.strip()
        return ""
    def _log_chat_update_assistant(
        self, session, turn_id, status, text_len, message_id=""
    ):
        self._append_log(
            "[GUI][CHAT][UPDATE_ASSISTANT] "
            f"session_id={session.session_id} turn_id={turn_id} "
            f"message_id={message_id or '-'} status={status} text_len={text_len}"
        )

    def _update_session_assistant(
        self, session, turn_id, text=None, status=None, role=None, error=False
    ):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        if text is not None:
            target.content = text
        if status is not None:
            target.status = status
        if role is not None:
            target.role = role
        if error:
            target.role = "error"
        session.updated_at = time.time()
        return True
    def _apply_session_change(self, session_id, *, force_full_render=False):
        session = self._sessions.get(session_id)
        if not session:
            return
        self._refresh_session_list(select_session_id=self._current_session_id)
        if session_id == self._current_session_id:
            sig = self._session_chat_render_signature(session)
            if (
                not force_full_render
                and getattr(self, "_last_rendered_chat_signature", None) == sig
                and self._reply_bubbles_by_message_id
            ):
                pass
            else:
                self._render_session_chat(session)
        else:
            self._mark_session_pending(session_id)
        self._save_sessions_to_disk()

    def _apply_reply_ui_change(self, session, target):
        if session.session_id == self._current_session_id:
            updated = self._update_existing_reply_bubble(target)
            if not updated:
                self._render_session_chat(session)
            else:
                sig = self._session_chat_render_signature(session)
                self._last_rendered_chat_signature = sig
                self._scroll_to_bottom()
        else:
            self._mark_session_pending(session.session_id)
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._save_sessions_to_disk()

    def _set_reply_text(self, session, turn_id, text, status_text="已回复"):
        target = self._find_assistant_by_turn(session, turn_id)
        if not self._update_session_assistant(
            session, turn_id, text=text, status=status_text, role="assistant"
        ):
            return
        msg_id = target.message_id if target else ""
        self._log_chat_update_assistant(
            session, turn_id, status_text, len(text or ""), msg_id
        )
        self._apply_reply_ui_change(session, target)

    def _set_reply_error(self, session, turn_id, text, status_text="失败"):
        target = self._find_assistant_by_turn(session, turn_id)
        if not self._update_session_assistant(
            session,
            turn_id,
            text=text,
            status=status_text,
            role="error",
            error=True,
        ):
            return
        msg_id = target.message_id if target else ""
        self._log_chat_update_assistant(
            session, turn_id, status_text, len(text or ""), msg_id
        )
        self._apply_reply_ui_change(session, target)
    def _set_reply_waiting(self, session, turn_id):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        target.role = "assistant"
        target.content = ASSISTANT_WAIT_TEXT
        target.status = "等待中"
        session.updated_at = time.time()
        if session.session_id == self._current_session_id:
            bubble = self._reply_bubbles_by_message_id.get(target.message_id)
            if bubble is not None:
                if bubble.role == "error":
                    bubble.role = "assistant"
                    bubble._apply_style()
                bubble.set_text(ASSISTANT_WAIT_TEXT, "等待中")
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._save_sessions_to_disk()
        return True
