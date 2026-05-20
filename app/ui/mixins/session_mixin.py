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
    PENDING_ASSISTANT_STATUSES,
    RUNTIME_DIR,
    SESSIONS_FILE,
    SESSIONS_JSON_VERSION,
    SESSION_BIND_LIST_STYLES,
    SETTINGS_APP,
    SETTINGS_ORG,
)
from app.models import (
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_HOME,
    ChatMessage,
    ChatSession,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.ui.widgets.bridge_notifier import BridgeNotifier
from app.ui.widgets.chat_bubble import ChatBubble, SystemBubble
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.session_list import SessionListWidget
from app.ui.widgets.session_list_item import SessionListItemWidget
from PyQt5.QtCore import QObject, QSettings, QSize, QUrl, Qt, QTimer, pyqtSignal
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


class SessionMixin:
    def _create_session(self, title="新对话", select=False, auto_open_chatgpt=False):
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

    def _create_new_local_session(self):
        session = self._create_session(select=True)
        session.remote_chatgpt = default_remote_chatgpt()
        self._append_log(
            f"[CHAT][NEW_LOCAL_SESSION] session_id={session.session_id} "
            f"action=create_only open_browser=False"
        )
        self._append_session_message(
            session,
            "system",
            "已新建本地对话。\n"
            "输入内容并点击发送后，将自动选择空闲 ChatGPT 首页或打开新首页。",
        )
        self._render_session_chat(session)
        self._save_sessions_to_disk()
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
    def _select_session(self, session_id, save=True):
        if session_id not in self._sessions:
            return
        self._current_session_id = session_id
        session = self._sessions[session_id]
        session.has_pending_reply = False
        self._render_session_chat(session)
        self._refresh_session_list(select_session_id=session_id)
        self._update_current_session_title(session)
        self._update_bound_page_display()
        self._refresh_tm_page_selector()
        self._render_tampermonkey_clients(self._last_bridge_status)
        if save:
            self._save_sessions_to_disk()
    def _session_display_title(self, session):
        title = session.title or "新对话"
        if session.has_pending_reply:
            return f"{title} *"
        return title
    def _session_list_subtitle(self, session):
        ts = time.strftime("%H:%M", time.localtime(session.updated_at or time.time()))

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._remote_bind_state(remote) == BIND_STATE_WAITING_HOME:
            return f"{ts} · 等待首页上线..."
        if self._pending_auto_bind_session_id == session.session_id:
            return f"{ts} · 等待绑定..."

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if remote.get("enabled") and (remote.get("client_id") or "").strip():
            has_chat = any(
                m.visible_in_chat and m.role in ("user", "assistant")
                for m in session.messages
            )
            if not has_chat:
                return f"{ts} · 已绑定 ChatGPT 页面"

        for message in reversed(session.messages):
            if not message.visible_in_chat:
                continue

            if message.role not in ("user", "assistant"):
                continue

            text = (message.content or "").strip().replace("\n", " ")
            if not text:
                continue

            if text in ASSISTANT_WAIT_TEXTS:
                return f"{ts} · 等待回复..."

            if len(text) > 36:
                text = text[:36] + "…"

            return f"{ts} · {text}"

        return ts
    def _session_list_item_text(self, session):
        return f"{self._session_display_title(session)}\n{self._session_list_subtitle(session)}"

    def _session_list_title_text(self, session):
        return session.title or "新对话"

    def _session_has_pending_assistant_reply(self, session):
        if session.has_pending_reply:
            return True
        for message in reversed(session.messages):
            if not message.visible_in_chat:
                continue
            if message.role != "assistant":
                continue
            status = (message.status or "").strip()
            if status in PENDING_ASSISTANT_STATUSES:
                return True
            text = (message.content or "").strip()
            if text in ASSISTANT_WAIT_TEXTS:
                return True
        return False

    def _session_preview_text(self, session):
        ts = time.strftime("%H:%M", time.localtime(session.updated_at or time.time()))
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._remote_bind_state(remote) == BIND_STATE_WAITING_HOME:
            return f"{ts} · 等待首页上线..."
        if self._pending_auto_bind_session_id == session.session_id:
            return f"{ts} · 等待绑定..."
        if remote.get("enabled") and (remote.get("client_id") or "").strip():
            has_chat = any(
                m.visible_in_chat and m.role in ("user", "assistant")
                for m in session.messages
            )
            if not has_chat:
                return f"{ts} · 已绑定 ChatGPT 页面"
        for message in reversed(session.messages):
            if not message.visible_in_chat:
                continue
            if message.role not in ("user", "assistant"):
                continue
            text = (message.content or "").strip().replace("\n", " ")
            if not text:
                continue
            if text in ASSISTANT_WAIT_TEXTS:
                return f"{ts} · 等待回复..."
            if len(text) > 36:
                text = text[:36] + "…"
            return f"{ts} · {text}"
        return ts

    def _session_list_visual_signature(self):
        self._ensure_session_order()
        rows = []
        for sid in self._tab_session_ids:
            session = self._sessions.get(sid)
            if not session:
                continue
            bind_state = self._session_bind_list_state(session, self._last_bridge_status)
            preview = self._session_preview_text(session)
            pending = self._session_has_pending_assistant_reply(session)
            rows.append((
                sid,
                self._session_list_title_text(session),
                preview,
                bind_state,
                pending,
                sid == self._current_session_id,
            ))
        return tuple(rows)

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
                remote.get("conversation_url") or remote.get("url") or ""
            )
        page_url = (
            remote.get("conversation_url")
            or remote.get("url")
            or ""
        ).strip()
        if bind_state == "unbound" and not remote.get("enabled"):
            lines.append("发送首条消息时将自动选择空闲 ChatGPT 首页或打开新首页。")
        else:
            lines.extend([
                f"client_id：{client_id or '-'}",
                f"page_instance_id：{page_instance_id or '-'}",
                f"conversation_id：{conversation_id or '-'}",
                f"url：{page_url or '-'}",
            ])
            client_info = self._client_info_by_id(client_id) if client_id else None
            if client_info:
                lines.append(
                    f"最后在线：{self._format_last_seen_ago(client_info.get('last_seen'))}"
                )
                lines.append(
                    f"最近焦点：{self._format_last_seen_ago(client_info.get('last_focus_at'))}"
                )
            elif remote.get("last_seen"):
                lines.append(
                    f"最后记录：{self._format_ts(remote.get('last_seen'))}"
                )
        if self._session_has_pending_assistant_reply(session):
            lines.append("消息状态：等待回复")
        return "\n".join(lines)

    def _apply_session_list_item_widget(self, item, session, *, selected=False):
        bind_state = self._session_bind_list_state(session, self._last_bridge_status)
        widget = self.session_list.itemWidget(item)
        if widget is None:
            widget = SessionListItemWidget()
            self.session_list.setItemWidget(item, widget)
        widget.apply_state(
            title=self._session_list_title_text(session),
            subtitle=self._session_preview_text(session),
            bind_state=bind_state,
            pending_reply=self._session_has_pending_assistant_reply(session),
            selected=selected,
            tooltip=self._session_list_item_tooltip(session, bind_state),
        )
        widget.adjustSize()
        hint = widget.sizeHint()
        height = max(hint.height(), 72)
        item.setSizeHint(QSize(hint.width(), height))

    def _update_session_list_item_bind_state(self, session_id):
        if not hasattr(self, "session_list"):
            return
        index = self._list_index_for_session(session_id)
        if index < 0:
            return
        item = self.session_list.item(index)
        session = self._sessions.get(session_id)
        if not item or not session:
            return
        selected = session_id == self._current_session_id
        self._apply_session_list_item_widget(item, session, selected=selected)

    def _session_list_signature(self):
        return self._session_list_visual_signature()
    def _update_current_session_title(self, session=None):
        if not hasattr(self, "current_session_title"):
            return
        session = session or self._current_session()
        if not session:
            self.current_session_title.setText("新对话")
            return
        self.current_session_title.setText(self._session_display_title(session))
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
    def _apply_session_search_filter(self):
        if not hasattr(self, "session_list"):
            return
        needle = (self._session_search_text or "").strip().lower()
        for index in range(self.session_list.count()):
            item = self.session_list.item(index)
            if not item:
                continue
            session_id = item.data(Qt.UserRole)
            session = self._sessions.get(session_id)
            if not session:
                item.setHidden(True)
                continue
            if not needle:
                item.setHidden(False)
                continue
            title = self._session_list_title_text(session).lower()
            preview = self._session_preview_text(session).lower()
            bind_state = self._session_bind_list_state(session, self._last_bridge_status)
            status_label = SESSION_BIND_LIST_STYLES.get(bind_state, {}).get("label", "")
            item.setHidden(
                needle not in title
                and needle not in preview
                and needle not in status_label.lower()
            )
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
                    self._list_refreshing = True
                    self.session_list.blockSignals(True)
                    self.session_list.setCurrentRow(list_index)
                    self.session_list.blockSignals(False)
                    self._list_refreshing = False
            return

        structure_same = (
            old_sig
            and len(old_sig) == len(new_sig)
            and all(old_row[0] == new_row[0] for old_row, new_row in zip(old_sig, new_sig))
        )

        self._list_refreshing = True
        self.session_list.blockSignals(True)

        if structure_same:
            for index, row in enumerate(new_sig):
                session_id = row[0]
                session = self._sessions.get(session_id)
                item = self.session_list.item(index)
                if not item or not session:
                    continue
                self._apply_session_list_item_widget(
                    item,
                    session,
                    selected=(session_id == self._current_session_id),
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
                    selected=(session_id == self._current_session_id),
                )

        if target_id:
            list_index = self._list_index_for_session(target_id)
            if list_index >= 0:
                self.session_list.setCurrentRow(list_index)
        self._apply_session_search_filter()
        self.session_list.blockSignals(False)
        self._list_refreshing = False
        self._last_session_list_visual_signature = new_sig
        self._last_session_list_signature = new_sig
    def _on_session_search_changed(self, text):
        self._session_search_text = text or ""
        self._apply_session_search_filter()
    def _on_session_list_changed(self, current, previous):
        if self._list_refreshing or current is None:
            return
        session_id = current.data(Qt.UserRole)
        if not session_id or session_id == self._current_session_id:
            return
        self._select_session(session_id)
    def _on_session_list_reordered(self, parent, start, end, destination, row):
        if self._session_search_text.strip():
            return
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
                "发送消息后会自动记录页面；也可先点击「绑定当前」"
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
    def _delete_session_by_id(self, session_id):
        if session_id not in self._sessions:
            return
        if len(self._tab_session_ids) <= 1:
            self._clear_current_session()
            return
        list_index = self._list_index_for_session(session_id)
        for message_id, sid in list(self._message_to_session.items()):
            if sid == session_id:
                del self._message_to_session[message_id]
        if session_id in self._tab_session_ids:
            self._tab_session_ids.remove(session_id)
        del self._sessions[session_id]
        next_index = min(max(list_index, 0), len(self._tab_session_ids) - 1)
        next_id = self._tab_session_ids[next_index]
        self._select_session(next_id)
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
    def _clear_current_session(self):
        session = self._current_session()
        if not session:
            return
        for bridge_id, sid in list(self._message_to_session.items()):
            if sid == session.session_id:
                del self._message_to_session[bridge_id]
                self._message_to_turn.pop(bridge_id, None)
                self._finalized_bridge_message_ids.discard(bridge_id)
                self._ack_success_message_ids.discard(bridge_id)
        session.messages.clear()
        session.updated_at = time.time()
        session.has_pending_reply = False
        self._append_session_message(session, "system", "当前对话已清空。")
        self._render_session_chat(session)
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
        status="",
        created_at=None,
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
            status=status or "",
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
                if role in ("user", "assistant") and mid and not bridge:
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
        self._refresh_session_list(select_session_id=self._current_session_id)
    @staticmethod
    def _message_to_dict(message):
        return {
            "message_id": message.message_id,
            "turn_id": message.turn_id,
            "role": message.role,
            "content": message.content,
            "created_at": message.created_at,
            "status": message.status,
            "bridge_message_id": message.bridge_message_id,
            "parent_message_id": message.parent_message_id,
            "visible_in_chat": message.visible_in_chat,
        }
    @staticmethod
    def _message_from_dict(data):
        content = data.get("content")
        if content is None:
            content = data.get("text", "")
        return ChatMessage(
            role=data.get("role", "system"),
            content=content,
            created_at=float(data.get("created_at", time.time())),
            message_id=data.get("message_id", ""),
            turn_id=data.get("turn_id", ""),
            status=data.get("status", ""),
            bridge_message_id=data.get("bridge_message_id", ""),
            parent_message_id=data.get("parent_message_id", ""),
            visible_in_chat=bool(data.get("visible_in_chat", True)),
        )
    def _session_to_dict(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
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
            "has_pending_reply": session.has_pending_reply,
            "messages": [self._message_to_dict(item) for item in session.messages],
        }
    def _session_from_dict(self, data):
        messages = [
            self._message_from_dict(item) for item in (data.get("messages") or [])
        ]
        remote = normalize_remote_chatgpt(data.get("remote_chatgpt") or {})
        return ChatSession(
            session_id=data.get("session_id") or str(uuid.uuid4()),
            title=data.get("title") or "新对话",
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            task_type=data.get("task_type", ""),
            context_mode=data.get("context_mode", ""),
            summary=data.get("summary", ""),
            pinned_context=data.get("pinned_context", ""),
            remote_chatgpt=remote,
            messages=messages,
            has_pending_reply=bool(data.get("has_pending_reply")),
        )
    def _save_sessions_to_disk(self):
        if not self._save_chat_history:
            return
        try:
            data_dir = Path(self._chat_sessions_path or RUNTIME_DIR)
            data_dir.mkdir(parents=True, exist_ok=True)
            sessions_file = data_dir / "chat_sessions.json"
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
                    self._finalized_bridge_message_ids
                ),
            }
            sessions_file.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception as error:
            detail = f"保存对话记录失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
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
        except Exception as error:
            detail = f"加载对话记录失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._sessions = {}
            session = self._create_session(select=False)
            self._append_session_message(
                session,
                "system",
                "对话记录加载失败，已创建新对话。请查看运行日志了解详情。",
            )
            return
        self._sessions = {}
        for item in payload.get("sessions") or []:
            session = self._session_from_dict(item)
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
        self._finalized_bridge_message_ids = set(finalized)
        self._migrate_loaded_session_messages()
    def _restore_ui_settings(self):
        if self._remember_window_geometry:
            geometry = self._settings.value("geometry")
            if geometry is not None:
                self.restoreGeometry(geometry)
            window_state = self._settings.value("window_state")
            if window_state is not None and self._remember_window_position:
                self.restoreState(window_state)
        if self._restore_main_tab:
            main_tab_index = int(self._settings.value("main_tab_index", 0))
            if 0 <= main_tab_index < self.main_tabs.count():
                self.main_tabs.setCurrentIndex(main_tab_index)
        self._update_service_settings_status()
        self._update_tampermonkey_settings_labels()
    def _save_ui_settings(self):
        if self._remember_window_geometry:
            self._settings.setValue("geometry", self.saveGeometry())
        if self._remember_window_position:
            self._settings.setValue("window_state", self.saveState())
        self._settings.setValue("main_tab_index", self.main_tabs.currentIndex())
        self._settings.setValue("tab_session_ids", self._tab_session_ids)
        if self._current_session_id:
            self._settings.setValue("current_session_id", self._current_session_id)
        if self._saved_page_url:
            self._settings.setValue("last_page_url", self._saved_page_url)
