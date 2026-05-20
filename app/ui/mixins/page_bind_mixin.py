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
    SETTINGS_APP,
    SETTINGS_ORG,
)
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
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


class PageBindMixin:
    IDLE_HOME_FRESH_SECONDS = 3.0
    BOOTSTRAP_CLAIM_TIMEOUT_SECONDS = 5.0

    @staticmethod
    def _remote_bind_state(remote):
        return normalize_remote_chatgpt(remote).get("bind_state") or BIND_STATE_UNBOUND

    def _effective_bind_state(self, session):
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        state = self._remote_bind_state(remote)
        if not remote.get("enabled"):
            return BIND_STATE_UNBOUND
        if state in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        ):
            if self._session_has_prebound_home_online(remote):
                return state
            return BIND_STATE_BOUND_OFFLINE
        if state == BIND_STATE_BOUND_CONVERSATION:
            if self._session_has_sendable_bound_page(remote):
                return BIND_STATE_BOUND_CONVERSATION
            return BIND_STATE_BOUND_OFFLINE
        return state

    def _session_has_prebound_home_online(self, remote):
        remote = normalize_remote_chatgpt(remote)
        if self._remote_bind_state(remote) != BIND_STATE_PREBOUND_HOME:
            return False
        client_id = (
            remote.get("prebound_home_client_id") or remote.get("client_id") or ""
        ).strip()
        page_instance_id = (
            remote.get("prebound_home_page_instance_id")
            or remote.get("page_instance_id")
            or ""
        ).strip()
        if not client_id:
            return False
        for item in self._last_bridge_status.get("tampermonkey_clients") or []:
            if not isinstance(item, dict) or not item.get("online"):
                continue
            if (item.get("client_id") or "").strip() != client_id:
                continue
            if page_instance_id and (
                item.get("page_instance_id") or ""
            ).strip() != page_instance_id:
                continue
            if (item.get("page_type") or "").strip() == "home":
                page_url = (item.get("page_url") or "").strip()
                if self._is_bindable_chatgpt_url(page_url):
                    last_seen = float(item.get("last_seen") or 0)
                    if last_seen and (
                        time.time() - last_seen
                    ) <= self.IDLE_HOME_FRESH_SECONDS:
                        return True
        return False

    def _find_prebound_home_client(self, remote):
        remote = normalize_remote_chatgpt(remote)
        client_id = (
            remote.get("prebound_home_client_id") or remote.get("client_id") or ""
        ).strip()
        page_instance_id = (
            remote.get("prebound_home_page_instance_id")
            or remote.get("page_instance_id")
            or ""
        ).strip()
        for item in self._last_bridge_status.get("tampermonkey_clients") or []:
            if not isinstance(item, dict) or not item.get("online"):
                continue
            if (item.get("client_id") or "").strip() != client_id:
                continue
            if page_instance_id and (
                item.get("page_instance_id") or ""
            ).strip() != page_instance_id:
                continue
            if (item.get("page_type") or "").strip() == "home":
                return dict(item)
        return None

    def _session_user_message_count(self, session):
        if session is None:
            return 0
        return sum(1 for msg in session.messages if msg.role == "user")

    def _idle_home_sort_key(self, item):
        has_focus_score = 1 if item.get("has_focus") else 0
        last_focus_at = float(item.get("last_focus_at") or 0)
        visible = (
            item.get("visibility_state") or item.get("visible") or ""
        ).strip()
        visible_score = 1 if visible == "visible" else 0
        client_id = (item.get("client_id") or "").strip()
        page_instance_id = (item.get("page_instance_id") or "").strip()
        known_clients = getattr(self, "_pending_auto_bind_known_clients", set()) or set()
        known_instances = (
            getattr(self, "_pending_auto_bind_known_page_instances", set()) or set()
        )
        is_new_client = 1 if client_id and client_id not in known_clients else 0
        is_new_instance = (
            1 if page_instance_id and page_instance_id not in known_instances else 0
        )
        is_new_score = 1 if is_new_client or is_new_instance else 0
        last_seen = float(item.get("last_seen") or 0)
        return (
            has_focus_score,
            last_focus_at,
            visible_score,
            is_new_score,
            last_seen,
        )

    @staticmethod
    def _idle_home_selection_reason(item):
        visible = (
            item.get("visibility_state") or item.get("visible") or ""
        ).strip()
        if item.get("has_focus"):
            return "focused_home"
        if float(item.get("last_focus_at") or 0) > 0:
            return "recent_focused_home"
        if visible == "visible":
            return "visible_home"
        return "latest_home"

    @staticmethod
    def _session_bind_request_id(remote):
        remote = normalize_remote_chatgpt(remote)
        return (
            remote.get("bind_request_id") or remote.get("launch_token") or ""
        ).strip()

    def _is_bind_request_id_used_by_other_session(
        self, bind_request_id, exclude_session_id=""
    ):
        bind_request_id = (bind_request_id or "").strip()
        if not bind_request_id:
            return False
        exclude_session_id = (exclude_session_id or "").strip()
        for session in self._sessions.values():
            if exclude_session_id and session.session_id == exclude_session_id:
                continue
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote.get("enabled"):
                continue
            other_token = self._session_bind_request_id(remote)
            if other_token == bind_request_id:
                bind_state = self._remote_bind_state(remote)
                if bind_state in (
                    BIND_STATE_WAITING_HOME,
                    BIND_STATE_PREBOUND_HOME,
                    BIND_STATE_WAITING_CONVERSATION_CREATED,
                ):
                    return True
                if remote.get("bootstrap_in_progress"):
                    return True
        return False

    def _resolve_session_for_conversation_created(self, item):
        payload = item.get("payload") or {}
        bridge_id = (
            item.get("message_id") or payload.get("message_id") or ""
        ).strip()
        if bridge_id:
            session_id = (
                self._message_to_session.get(bridge_id)
                or item.get("session_id")
                or ""
            ).strip()
            if session_id and session_id in self._sessions:
                return self._sessions[session_id]

        bind_token = (
            payload.get("bind_request_id")
            or payload.get("launch_token")
            or ""
        ).strip()
        if bind_token:
            for session in self._sessions.values():
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                expected = self._session_bind_request_id(remote)
                if expected and expected == bind_token:
                    return session

        page_instance_id = (payload.get("page_instance_id") or "").strip()
        if page_instance_id:
            for session in self._sessions.values():
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                bound_instance = (remote.get("page_instance_id") or "").strip()
                prebound_instance = (
                    remote.get("prebound_home_page_instance_id") or ""
                ).strip()
                if bound_instance == page_instance_id:
                    return session
                if prebound_instance == page_instance_id:
                    return session

        client_id = (
            payload.get("client_id") or item.get("client_id") or ""
        ).strip()
        if client_id:
            for session in self._sessions.values():
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                bind_state = self._remote_bind_state(remote)
                if bind_state not in (
                    BIND_STATE_PREBOUND_HOME,
                    BIND_STATE_WAITING_CONVERSATION_CREATED,
                    BIND_STATE_WAITING_HOME,
                ):
                    continue
                bound_client = (
                    remote.get("client_id")
                    or remote.get("prebound_home_client_id")
                    or remote.get("reserved_client_id")
                    or ""
                ).strip()
                if bound_client == client_id:
                    return session

        return None

    def _idle_home_skip_reason(self, item, status=None):
        page_type = (item.get("page_type") or "").strip()
        if page_type != "home":
            return "not_home"
        if self._is_ignored_or_unusable_home_client(item):
            if page_type in ("ignored", "closing", "stale", "other", "unknown"):
                return page_type
            conversation_id = (item.get("conversation_id") or "").strip()
            if conversation_id and conversation_id != "-":
                return "has_conversation"
            return "ignored_page"
        client_id = (item.get("client_id") or "").strip()
        page_instance_id = (item.get("page_instance_id") or "").strip()
        conversation_id = (item.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return "has_conversation"
        if self._is_home_client_used_by_any_session(client_id, page_instance_id):
            return "used_by_other_session"
        if self._home_client_has_pending_bridge_work(
            client_id, page_instance_id, status
        ):
            return "pending_work"
        if not self._is_fresh_idle_home_client(item):
            return "stale_home"
        return ""

    def _recent_focus_home_client_id(self, status=None):
        status = status or self._last_bridge_status or {}
        best_id = ""
        best_focus_at = 0.0
        best_has_focus = False
        for item in status.get("tampermonkey_clients") or []:
            if not isinstance(item, dict) or not item.get("online"):
                continue
            if (item.get("page_type") or "").strip() != "home":
                continue
            client_id = (item.get("client_id") or "").strip()
            if not client_id:
                continue
            last_focus_at = float(item.get("last_focus_at") or 0)
            has_focus = bool(item.get("has_focus"))
            if has_focus and not best_has_focus:
                best_id = client_id
                best_focus_at = last_focus_at
                best_has_focus = True
                continue
            if has_focus == best_has_focus and last_focus_at > best_focus_at:
                best_id = client_id
                best_focus_at = last_focus_at
        return best_id

    def _is_fresh_idle_home_client(self, item):
        if not isinstance(item, dict):
            return False
        now = time.time()
        last_seen = float(item.get("last_seen") or 0)
        age = now - last_seen
        if age > self.IDLE_HOME_FRESH_SECONDS:
            return False

        page_type = (item.get("page_type") or "").strip()
        if page_type != "home":
            return False

        conversation_id = (item.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return False

        client_id = (item.get("client_id") or "").strip()
        if not client_id:
            return False

        return True

    def _is_ignored_or_unusable_home_client(self, client_info):
        if not isinstance(client_info, dict):
            return True
        page_type = (client_info.get("page_type") or "").strip()
        if page_type in ("ignored", "closing", "stale", "other", "unknown"):
            return True
        page_url = (client_info.get("page_url") or "").strip()
        if not self._is_bindable_chatgpt_url(page_url):
            return True
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return True
        return False

    def _home_client_has_pending_bridge_work(self, client_id, page_instance_id, status=None):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()
        status = status or self._last_bridge_status or {}

        for waiting in status.get("waiting_acks") or []:
            if not isinstance(waiting, dict):
                continue
            if not waiting.get("bootstrap_conversation"):
                continue
            message_id = (waiting.get("id") or "").strip()
            if message_id and self._is_finalized(message_id):
                continue
            target_client = (
                waiting.get("target_client_id") or waiting.get("delivered_to") or ""
            ).strip()
            target_instance = (waiting.get("target_page_instance_id") or "").strip()
            if target_client and target_client == client_id:
                return True
            if (
                target_instance
                and page_instance_id
                and target_instance == page_instance_id
            ):
                return True

        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote.get("bootstrap_in_progress"):
                continue
            home_client = (
                remote.get("prebound_home_client_id") or remote.get("client_id") or ""
            ).strip()
            home_instance = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            if home_client != client_id:
                continue
            if page_instance_id and home_instance and home_instance != page_instance_id:
                continue
            return True

        return False

    def _is_home_client_used_by_any_session(self, client_id, page_instance_id):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()

        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)

            prebound_client = (remote.get("prebound_home_client_id") or "").strip()
            prebound_instance = (
                remote.get("prebound_home_page_instance_id") or ""
            ).strip()
            if prebound_client == client_id:
                if not page_instance_id or not prebound_instance:
                    return True
                if prebound_instance == page_instance_id:
                    return True
            if (
                page_instance_id
                and prebound_instance
                and prebound_instance == page_instance_id
            ):
                return True

            bound_client = (remote.get("client_id") or "").strip()
            bound_instance = (remote.get("page_instance_id") or "").strip()
            if bind_state in (
                BIND_STATE_PREBOUND_HOME,
                BIND_STATE_WAITING_CONVERSATION_CREATED,
                BIND_STATE_WAITING_HOME,
            ):
                if bound_client == client_id:
                    if not page_instance_id or not bound_instance:
                        return True
                    if bound_instance == page_instance_id:
                        return True
                reserved_client = (remote.get("reserved_client_id") or "").strip()
                reserved_instance = (
                    remote.get("reserved_page_instance_id") or ""
                ).strip()
                if reserved_client == client_id:
                    if not page_instance_id or not reserved_instance:
                        return True
                    if reserved_instance == page_instance_id:
                        return True

            if bind_state == BIND_STATE_PREBOUND_HOME and prebound_client == client_id:
                for message in session.messages:
                    bridge_id = (message.bridge_message_id or "").strip()
                    if not bridge_id or message.role not in ("user", "assistant"):
                        continue
                    if self._is_finalized(bridge_id):
                        continue
                    status_text = (message.status or "").strip()
                    if status_text in PENDING_ASSISTANT_STATUSES:
                        return True
                    if message.content in ASSISTANT_WAIT_TEXTS:
                        return True

        return False

    def _find_idle_chatgpt_home_client(self, status=None, session_id=""):
        status = status or self._last_bridge_status or {}
        session_id = (session_id or "").strip()
        clients = status.get("tampermonkey_clients") or []
        candidates = []
        for item in clients:
            if not isinstance(item, dict):
                continue
            client_id = (item.get("client_id") or "").strip()
            page_type = (item.get("page_type") or "").strip()
            if page_type != "home":
                continue
            if not item.get("online"):
                continue
            skip_reason = self._idle_home_skip_reason(item, status)
            if skip_reason:
                if client_id:
                    self._append_log(
                        f"[AUTO_BIND][SKIP_IDLE_HOME] client_id={client_id} "
                        f"reason={skip_reason}"
                    )
                continue
            if not client_id:
                continue
            candidates.append(dict(item))

        if not candidates:
            return None

        focused_home = ""
        recent_focused_home = ""
        best_focus_at = 0.0
        for item in candidates:
            cid = (item.get("client_id") or "").strip()
            if not cid:
                continue
            if item.get("has_focus") and not focused_home:
                focused_home = cid
            last_focus_at = float(item.get("last_focus_at") or 0)
            if last_focus_at > best_focus_at:
                best_focus_at = last_focus_at
                recent_focused_home = cid

        self._append_log(
            f"[AUTO_BIND][IDLE_HOME_CANDIDATES] session_id={session_id or '-'} "
            f"count={len(candidates)} "
            f"focused_home={focused_home or '-'} "
            f"recent_focused_home={recent_focused_home or '-'}"
        )

        candidates.sort(key=self._idle_home_sort_key, reverse=True)
        selected = candidates[0]
        client_id = (selected.get("client_id") or "").strip()
        page_instance_id = (selected.get("page_instance_id") or "").strip()
        visible = (
            selected.get("visibility_state") or selected.get("visible") or ""
        ).strip()
        reason = self._idle_home_selection_reason(selected)
        self._append_log(
            f"[AUTO_BIND][SELECT_IDLE_HOME] session_id={session_id or '-'} "
            f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
            f"has_focus={bool(selected.get('has_focus'))} "
            f"last_focus_at={float(selected.get('last_focus_at') or 0):.3f} "
            f"visible={visible or '-'} "
            f"last_seen={float(selected.get('last_seen') or 0):.3f} "
            f"reason={reason}"
        )
        return selected

    def _session_has_claimed_or_acked_bootstrap(self, session):
        if session is None:
            return False
        for message in session.messages:
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = server.get_message_state(bridge_id)
            if not state or not state.get("bootstrap_conversation"):
                continue
            status = (state.get("status") or "").strip()
            if status not in ("queued", "cancelled"):
                return True
            if bridge_id in self._ack_success_message_ids:
                return True
        return False

    def _prebound_home_is_retryable(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        if self._remote_bind_state(remote) != BIND_STATE_PREBOUND_HOME:
            return False
        if (remote.get("conversation_id") or "").strip():
            return False
        if self._session_has_prebound_home_online(remote):
            return False
        if remote.get("bootstrap_in_progress"):
            return False
        if self._session_has_claimed_or_acked_bootstrap(session):
            return False
        return True

    def _session_needs_first_message_bind(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        conversation_id = (remote.get("conversation_id") or "").strip()
        if conversation_id:
            return False
        bind_state = self._remote_bind_state(remote)
        if bind_state == BIND_STATE_BOUND_CONVERSATION:
            return False
        if bind_state == BIND_STATE_PREBOUND_HOME:
            return self._prebound_home_is_retryable(session)
        return bind_state in (BIND_STATE_UNBOUND, BIND_STATE_WAITING_HOME, "")

    def _start_waiting_home_on_send(self, session):
        session_id = (session.session_id if session else "").strip()
        if not session_id:
            return

        if (
            self._pending_auto_bind_session_id
            and self._pending_auto_bind_session_id != session_id
        ):
            self._append_log(
                f"[AUTO_BIND][REPLACE] old={self._pending_auto_bind_session_id} "
                f"new={session_id}"
            )

        status = self._last_bridge_status or {}
        clients = status.get("tampermonkey_clients") or []
        self._pending_auto_bind_session_id = session_id
        self._pending_auto_bind_started_at = time.time()
        self._pending_auto_bind_until = time.time() + 30
        self._pending_auto_bind_known_clients = {
            (item.get("client_id") or "").strip()
            for item in clients
            if isinstance(item, dict) and (item.get("client_id") or "").strip()
        }
        self._pending_auto_bind_known_page_instances = {
            (item.get("page_instance_id") or "").strip()
            for item in clients
            if isinstance(item, dict) and (item.get("page_instance_id") or "").strip()
        }

        remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_request_id = self._session_bind_request_id(remote_now)
        if not bind_request_id:
            bind_request_id = uuid.uuid4().hex
            session.remote_chatgpt = {
                **remote_now,
                "bind_request_id": bind_request_id,
                "launch_token": bind_request_id,
                "bind_started_at": time.time(),
            }
            self._save_sessions_to_disk()
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)

        url = f"{CHATGPT_HOME_URL}?xz_bind_token={bind_request_id}"
        opened = self._open_url_in_browser(url, "发送首条消息时打开 ChatGPT 首页")
        method = "system_browser"
        result = "success" if opened else "failed"
        if not opened and server.is_server_running():
            self._push_open_url(url, active=True, label="发送首条消息时打开 ChatGPT 首页")
            method = "bridge_command"
            result = "queued"

        pending_text = (
            normalize_remote_chatgpt(session.remote_chatgpt).get("pending_bootstrap_text")
            or ""
        ).strip()
        self._append_log(
            f"[AUTO_BIND][OPEN_HOME_ON_SEND] session_id={session_id} "
            f"bind_request_id={bind_request_id} url={url} "
            f"method={method} result={result} "
            f"reason=no_idle_home pending_text_len={len(pending_text)}"
        )
        self._append_log(
            f"[AUTO_BIND][WAITING_HOME] session_id={session_id} "
            f"pending_text_len={len(pending_text)}"
        )
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._apply_chat_bind_visual_state()

    def _prepare_first_message_binding(self, session, text):
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bind_state = self._remote_bind_state(remote)

        if (
            bind_state == BIND_STATE_PREBOUND_HOME
            and not self._session_has_prebound_home_online(remote)
        ):
            old_client = (
                remote.get("client_id") or remote.get("prebound_home_client_id") or "-"
            )
            self._append_log(
                f"[AUTO_BIND][RELEASE_STALE_HOME] session_id={session.session_id} "
                f"client_id={old_client} reason=prebound_home_offline"
            )
            session.remote_chatgpt = {
                **default_remote_chatgpt(),
                "bind_state": BIND_STATE_UNBOUND,
            }
            session.updated_at = time.time()
            self._save_sessions_to_disk()
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)

        if not self._session_needs_first_message_bind(session):
            return True, ""

        if bind_state == BIND_STATE_WAITING_HOME:
            pending = (remote.get("pending_bootstrap_text") or "").strip()
            if pending:
                return (
                    False,
                    "正在等待 ChatGPT 首页上线，首条消息将在页面上线后自动发送。",
                )
            return False, "正在等待 ChatGPT 首页上线，请稍候。"

        idle_home = self._find_idle_chatgpt_home_client(
            session_id=session.session_id if session else ""
        )
        if idle_home:
            client_id = (idle_home.get("client_id") or "").strip()
            page_instance_id = (idle_home.get("page_instance_id") or "").strip()
            visible = (
                idle_home.get("visibility_state") or idle_home.get("visible") or ""
            ).strip()
            reason = self._idle_home_selection_reason(idle_home)
            if not self._prebound_home_bind_to_session(
                session, idle_home, silent=True, reserve_reason=reason
            ):
                return False, "预绑定空闲 ChatGPT 首页失败，请重试或手动绑定。"
            self._append_log(
                f"[AUTO_BIND][RESERVE_IDLE_HOME] session_id={session.session_id} "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
                f"has_focus={bool(idle_home.get('has_focus'))} "
                f"last_focus_at={float(idle_home.get('last_focus_at') or 0):.3f} "
                f"visible={visible or '-'} reason={reason}"
            )
            self._add_system_message(
                "已使用空闲 ChatGPT 首页发送首条消息，等待创建新对话..."
            )
            return True, ""

        now = time.time()
        bind_request_id = uuid.uuid4().hex
        session.remote_chatgpt = {
            **default_remote_chatgpt(),
            "bind_state": BIND_STATE_WAITING_HOME,
            "bind_request_id": bind_request_id,
            "launch_token": bind_request_id,
            "bind_started_at": now,
            "pending_bootstrap_text": text,
            "pending_bootstrap_created_at": now,
            "opened_home_at": now,
        }
        self._save_sessions_to_disk()
        self._start_waiting_home_on_send(session)
        self._add_system_message(
            "未发现空闲 ChatGPT 首页，正在打开新的 ChatGPT 首页..."
        )
        return False, "__WAITING_HOME_PENDING__"

    def _prebound_home_bind_to_session(
        self, session, client_info, silent=False, reserve_reason=""
    ):
        if not isinstance(client_info, dict):
            return False
        page_url = (
            client_info.get("page_url")
            or client_info.get("url")
            or CHATGPT_HOME_URL
        ).strip()
        client_id = (client_info.get("client_id") or "").strip()
        page_instance_id = (client_info.get("page_instance_id") or "").strip()
        if not client_id:
            self._add_system_message("缺少 client_id，无法预绑定首页。")
            return False
        if self._is_home_client_used_by_any_session(client_id, page_instance_id):
            self._add_system_message("该 ChatGPT 首页已被其他对话占用。")
            return False
        if not self._is_bindable_chatgpt_url(page_url):
            self._add_system_message("该 URL 不是可绑定的 ChatGPT 首页。")
            return False
        remote_prev = normalize_remote_chatgpt(session.remote_chatgpt)
        client_bind_token = (
            client_info.get("bind_request_id")
            or client_info.get("launch_token")
            or ""
        ).strip()
        session_bind_token = self._session_bind_request_id(remote_prev)
        if session_bind_token and client_bind_token:
            if client_bind_token != session_bind_token:
                self._append_log(
                    f"[BIND][MISMATCH] reason=bind_request_id_mismatch "
                    f"session_id={session.session_id} "
                    f"expected_token={session_bind_token} "
                    f"actual_token={client_bind_token} client_id={client_id}"
                )
                self._add_system_message(
                    "当前页面不是本会话打开的 ChatGPT 首页，不能用于当前新对话。"
                )
                return False
        now = time.time()
        bind_request_id = session_bind_token or client_bind_token
        session.remote_chatgpt = {
            "enabled": True,
            "bind_state": BIND_STATE_PREBOUND_HOME,
            "conversation_id": "",
            "conversation_url": page_url,
            "url": page_url,
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "page_type": "home",
            "page_title": (client_info.get("page_title") or "").strip(),
            "last_seen": float(client_info.get("last_seen") or time.time()),
            "prebound_home_client_id": client_id,
            "prebound_home_page_instance_id": page_instance_id,
            "reserved_client_id": client_id,
            "reserved_page_instance_id": page_instance_id,
            "reserved_at": now,
            "bind_request_id": bind_request_id,
            "launch_token": bind_request_id,
            "bind_started_at": float(remote_prev.get("bind_started_at") or now),
            "created_from_home": True,
            "bootstrap_in_progress": False,
        }
        session.updated_at = time.time()
        if server.is_server_running():
            server.set_bound_client_id(client_id, session.session_id)
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        self._refresh_tm_page_selector()
        self._render_tampermonkey_clients(self._last_bridge_status)
        if silent:
            self._set_settings_hint("已预绑定 ChatGPT 首页到当前对话。")
        else:
            self._add_system_message(
                "已预绑定 ChatGPT 首页。发送第一条消息后，"
                "将自动创建并绑定新的 ChatGPT 对话。"
            )
        self._append_log(
            f"[绑定][PREBOUND_HOME] session={session.session_id[:8]}… "
            f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
            f"url={page_url}"
        )
        return True

    def _bind_conversation_to_session(self, session, client_info, silent=False):
        if not isinstance(client_info, dict):
            return False
        page_url = (
            client_info.get("page_url")
            or client_info.get("url")
            or client_info.get("conversation_url")
            or ""
        ).strip()
        client_id = (client_info.get("client_id") or "").strip()
        conversation_id = (
            client_info.get("conversation_id") or parse_conversation_id(page_url) or ""
        ).strip()
        if conversation_id:
            conversation_url = f"https://chatgpt.com/c/{conversation_id}"
        else:
            conversation_url = page_url
        bind_check_url = conversation_url or page_url
        if not self._is_bindable_chatgpt_url(bind_check_url):
            self._add_system_message("该 URL 不是可绑定的 ChatGPT 对话页面。")
            return False
        if not client_id:
            self._add_system_message("缺少 client_id，无法绑定。")
            return False
        if not conversation_id:
            self._add_system_message("缺少 conversation_id，无法正式绑定对话页。")
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        session.remote_chatgpt = {
            "enabled": True,
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
            "conversation_id": conversation_id,
            "conversation_url": conversation_url,
            "url": conversation_url,
            "client_id": client_id,
            "page_instance_id": (client_info.get("page_instance_id") or "").strip(),
            "page_type": "conversation",
            "page_title": (client_info.get("page_title") or "").strip(),
            "last_seen": float(client_info.get("last_seen") or time.time()),
            "prebound_home_client_id": remote.get("prebound_home_client_id") or "",
            "prebound_home_page_instance_id": remote.get(
                "prebound_home_page_instance_id"
            )
            or "",
            "created_from_home": bool(remote.get("created_from_home")),
            "bootstrap_in_progress": False,
        }
        session.updated_at = time.time()
        if server.is_server_running():
            server.set_bound_client_id(client_id, session.session_id)
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        self._refresh_tm_page_selector()
        self._render_tampermonkey_clients(self._last_bridge_status)
        if silent:
            self._set_settings_hint("已绑定 ChatGPT 对话页到当前对话。")
        else:
            self._add_system_message(
                f"已绑定 ChatGPT 对话页。conversation_id={conversation_id}"
            )
        self._append_log(
            f"[绑定][CONVERSATION] session={session.session_id[:8]}… "
            f"client_id={client_id} conversation_id={conversation_id} "
            f"url={conversation_url or page_url}"
        )
        return True

    def _apply_conversation_created_binding(self, session, payload, client_id=""):
        if session is None:
            return
        conversation_id = (payload.get("conversation_id") or "").strip()
        page_url = (payload.get("url") or "").strip()
        if conversation_id and not page_url:
            page_url = f"https://chatgpt.com/c/{conversation_id}"
        if not conversation_id:
            conversation_id = parse_conversation_id(page_url)
        if not conversation_id:
            self._append_log("[BIND][CONVERSATION_CREATED] 缺少 conversation_id，已忽略")
            return
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bound_client_id = (
            (payload.get("client_id") or client_id or remote.get("client_id") or "")
        ).strip()
        page_instance_id = (
            payload.get("page_instance_id") or remote.get("page_instance_id") or ""
        ).strip()
        bind_request_id = self._session_bind_request_id(remote)
        session.remote_chatgpt = {
            "enabled": True,
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
            "conversation_id": conversation_id,
            "conversation_url": page_url,
            "url": page_url,
            "client_id": bound_client_id,
            "page_instance_id": page_instance_id,
            "page_type": "conversation",
            "page_title": remote.get("page_title") or "",
            "last_seen": time.time(),
            "prebound_home_client_id": remote.get("prebound_home_client_id") or "",
            "prebound_home_page_instance_id": remote.get(
                "prebound_home_page_instance_id"
            )
            or "",
            "bind_request_id": bind_request_id,
            "launch_token": bind_request_id,
            "bind_started_at": float(remote.get("bind_started_at") or 0),
            "created_from_home": True,
            "bootstrap_in_progress": False,
        }
        session.updated_at = time.time()
        if server.is_server_running() and bound_client_id:
            server.set_bound_client_id(bound_client_id, session.session_id)
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        self._add_system_message(
            f"已自动创建并绑定 ChatGPT 对话：conversation_id={conversation_id}"
        )
        bind_request_id = self._session_bind_request_id(remote)
        report_bind = (
            payload.get("bind_request_id") or payload.get("launch_token") or ""
        ).strip()
        self._append_log(
            f"[BIND][CONVERSATION_CREATED] session_id={session.session_id} "
            f"bind_request_id={bind_request_id or report_bind or '-'} "
            f"message_id={(payload.get('message_id') or '-')[:8]} "
            f"client_id={bound_client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"conversation_id={conversation_id} url={page_url or '-'}"
        )

    @staticmethod
    def _short_page_display(url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return ""
        try:
            parsed = urlparse(raw)
            if parsed.netloc:
                path = parsed.path or ""
                if len(path) > 36:
                    path = path[:36] + "..."
                return f"{parsed.netloc}{path}"
        except ValueError as error:
            append_log(
                f"[URL_FORMAT][ERROR] raw={raw!r} error={error}",
                source="GUI",
                echo=True,
            )
        if len(raw) > 80:
            return raw[:80] + "..."
        return raw
    @staticmethod
    def _format_last_seen_ago(last_seen):
        if not last_seen:
            return "-"
        try:
            seconds = max(0, int(time.time() - float(last_seen)))
        except (TypeError, ValueError):
            return "-"
        if seconds < 1:
            return "刚刚"
        return f"{seconds}秒前"
    @staticmethod
    def _short_conv_id(conversation_id):
        raw = (conversation_id or "").strip()
        if not raw or raw == "-":
            return "-"
        if len(raw) > 12:
            return raw[:12] + "..."
        return raw
    def _tm_summary_for_session(self, session=None):
        session = session or self._current_session()
        bound_client_id = ""
        bound_conversation_id = ""
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote.get("enabled"):
                bound_client_id = (remote.get("client_id") or "").strip()
                bound_conversation_id = (remote.get("conversation_id") or "").strip()
                if not bound_conversation_id:
                    bound_conversation_id = parse_conversation_id(
                        remote.get("conversation_url") or ""
                    )
        summary = server.get_tm_online_summary(
            bound_client_id=bound_client_id or None,
            bound_conversation_id=bound_conversation_id or None,
        )
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote.get("enabled") and not summary.get("bound_page_type"):
                summary["bound_page_type"] = (remote.get("page_type") or "").strip()
            if (
                remote.get("enabled")
                and not summary.get("bound_conversation_id")
                and bound_conversation_id
            ):
                summary["bound_conversation_id"] = bound_conversation_id
            if self._remote_bind_state(remote) == BIND_STATE_PREBOUND_HOME:
                summary["bound_page_type"] = "home"
                summary["bound_online"] = self._session_has_prebound_home_online(
                    remote
                )
        return summary

    def _log_send_bind_check(self, session, action="send"):
        summary = self._tm_summary_for_session(session)
        bound_client_id = (summary.get("bound_client_id") or "").strip() or "-"
        bound_conversation_id = (
            summary.get("bound_conversation_id") or ""
        ).strip() or "-"
        bound_online = bool(summary.get("bound_online"))
        active_client_id = (summary.get("active_client_id") or "").strip() or "-"
        active_conversation_id = (
            summary.get("active_conversation_id") or ""
        ).strip() or "-"
        same_client = (
            bound_client_id == active_client_id
            if bound_client_id != "-" and active_client_id != "-"
            else False
        )
        same_conversation = (
            bound_conversation_id == active_conversation_id
            if bound_conversation_id != "-" and active_conversation_id != "-"
            else False
        )
        self._append_log(
            "[SEND][BIND_CHECK] "
            f"bound_client_id={bound_client_id} "
            f"bound_conversation_id={bound_conversation_id} "
            f"bound_online={bound_online} "
            f"active_client_id={active_client_id} "
            f"active_conversation_id={active_conversation_id} "
            f"same_client={same_client} same_conversation={same_conversation} "
            f"action={action}"
        )
        mismatch = self._detect_bind_mismatch(summary)
        if mismatch:
            mismatch_action = "warn"
            if not bound_online:
                mismatch_action = "auto_rebind"
            elif not same_conversation:
                mismatch_action = "block_send"
            self._append_log(
                "[BIND][MISMATCH] "
                f"bound_client_id={mismatch.get('bound_client_id') or '-'} "
                f"bound_conversation_id={mismatch.get('bound_conversation_id') or '-'} "
                f"active_client_id={mismatch.get('active_client_id') or '-'} "
                f"active_conversation_id={mismatch.get('active_conversation_id') or '-'} "
                f"action={mismatch_action}"
            )

    def _log_bind_auto_rebind(self, session, new_client_info, reason=""):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip() or "-"
        old_conversation_id = (remote.get("conversation_id") or "").strip()
        if not old_conversation_id:
            old_conversation_id = parse_conversation_id(
                remote.get("conversation_url") or ""
            )
        new_client_id = (new_client_info.get("client_id") or "").strip() or "-"
        new_conversation_id = self._client_conversation_id(new_client_info) or "-"
        self._append_log(
            "[BIND][AUTO_REBIND] "
            f"old_client_id={old_client_id} old_conversation_id={old_conversation_id or '-'} "
            f"new_client_id={new_client_id} new_conversation_id={new_conversation_id} "
            f"reason={reason or '-'}"
        )

    def _client_info_by_id(self, client_id, status=None):
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        status = status or self._last_bridge_status or {}
        for item in status.get("tampermonkey_clients") or []:
            if (item.get("client_id") or "").strip() == client_id:
                return item
        return None
    def _format_tm_page_status_line(self, prefix, client_info):
        if not isinstance(client_info, dict):
            return f"{prefix}-"
        url = self._short_page_display((client_info.get("page_url") or "").strip()) or "-"
        client_id = (client_info.get("client_id") or "").strip() or "-"
        page_type = (client_info.get("page_type") or "").strip() or "-"
        conv = self._short_conv_id(self._client_conversation_id(client_info))
        bind_token = (
            client_info.get("bind_request_id") or client_info.get("launch_token") or ""
        ).strip()
        token_part = f"token={bind_token[:8]}…" if len(bind_token) > 8 else (
            f"token={bind_token}" if bind_token else "token=-"
        )
        focus_part = "focus=是" if client_info.get("has_focus") else "focus=否"
        online_text = "在线" if client_info.get("online") else "离线"
        ago = self._format_last_seen_ago(client_info.get("last_seen"))
        return (
            f"{prefix}{url} | client={client_id} | page={page_type} | "
            f"{token_part} | {focus_part} | conv={conv} | {online_text} | {ago}"
        )
    def _detect_bind_mismatch(self, summary):
        summary = summary or {}
        bound_client_id = (summary.get("bound_client_id") or "").strip()
        bound_conversation_id = (summary.get("bound_conversation_id") or "").strip()
        if not bound_client_id:
            return None
        active_client_id = (summary.get("active_client_id") or "").strip()
        active_conversation_id = (summary.get("active_conversation_id") or "").strip()
        if not active_client_id:
            return None
        if bound_client_id == active_client_id:
            if (
                bound_conversation_id
                and active_conversation_id
                and bound_conversation_id != active_conversation_id
            ):
                return {
                    "bound_client_id": bound_client_id,
                    "bound_conversation_id": bound_conversation_id,
                    "active_client_id": active_client_id,
                    "active_conversation_id": active_conversation_id,
                    "reason": "绑定 client 与活跃 client 相同，但 conversation_id 不一致",
                }
            return None
        bound_online = bool(summary.get("bound_online"))
        if bound_online:
            return {
                "bound_client_id": bound_client_id,
                "bound_conversation_id": bound_conversation_id or "-",
                "active_client_id": active_client_id,
                "active_conversation_id": active_conversation_id or "-",
                "reason": "绑定 client 不是最近活跃的油猴页面",
            }
        if summary.get("online_clients", 0) > 0:
            return {
                "bound_client_id": bound_client_id,
                "bound_conversation_id": bound_conversation_id or "-",
                "active_client_id": active_client_id,
                "active_conversation_id": active_conversation_id or "-",
                "reason": "当前活跃页面与绑定页面不是同一 client",
            }
        return None
    def _log_tm_status_summary(self, summary):
        if not isinstance(summary, dict):
            return
        key = (
            summary.get("total_clients"),
            summary.get("online_clients"),
            summary.get("offline_clients"),
            summary.get("online_conversation_clients"),
            summary.get("online_home_clients"),
            summary.get("bound_client_id"),
            summary.get("bound_conversation_id"),
            summary.get("bound_online"),
            summary.get("active_client_id"),
            summary.get("active_conversation_id"),
        )
        if key == getattr(self, "_last_tm_summary_log_key", None):
            return
        self._last_tm_summary_log_key = key
        line = (
            "[TM_STATUS][SUMMARY] "
            f"total_clients={summary.get('total_clients')} "
            f"online_clients={summary.get('online_clients')} "
            f"offline_clients={summary.get('offline_clients')} "
            f"online_conversation_clients={summary.get('online_conversation_clients')} "
            f"online_home_clients={summary.get('online_home_clients')} "
            f"bound_client_id={summary.get('bound_client_id') or '-'} "
            f"bound_conversation_id={summary.get('bound_conversation_id') or '-'} "
            f"bound_online={summary.get('bound_online')} "
            f"active_client_id={summary.get('active_client_id') or '-'} "
            f"active_conversation_id={summary.get('active_conversation_id') or '-'}"
        )
        self._append_log(line)
    def _log_bind_mismatch_if_needed(self, summary):
        mismatch = self._detect_bind_mismatch(summary)
        if not mismatch:
            if hasattr(self, "tm_bind_mismatch_label"):
                self.tm_bind_mismatch_label.setVisible(False)
            return
        key = tuple(mismatch.get(field) for field in (
            "bound_client_id",
            "bound_conversation_id",
            "active_client_id",
            "active_conversation_id",
            "reason",
        ))
        if key != getattr(self, "_last_bind_mismatch_log_key", None):
            self._last_bind_mismatch_log_key = key
            self._append_log(
                "[BIND][MISMATCH] "
                f"bound_client_id={mismatch.get('bound_client_id')} "
                f"bound_conversation_id={mismatch.get('bound_conversation_id')} "
                f"active_client_id={mismatch.get('active_client_id')} "
                f"active_conversation_id={mismatch.get('active_conversation_id')} "
                f"reason={mismatch.get('reason')}"
            )
        if hasattr(self, "tm_bind_mismatch_label"):
            self.tm_bind_mismatch_label.setText(
                "当前在线页面与绑定页面不一致，请绑定当前对话页。"
            )
            self.tm_bind_mismatch_label.setVisible(True)
    def _format_tm_online_chip_text(self, summary):
        summary = summary or {}
        online = int(summary.get("online_clients") or 0)
        conv = int(summary.get("online_conversation_clients") or 0)
        home = int(summary.get("online_home_clients") or 0)
        bound_enabled = bool((summary.get("bound_client_id") or "").strip())
        bound_online = bool(summary.get("bound_online"))
        if online <= 0:
            return "油猴：离线 0 个", "warn"
        parts = [f"油猴：在线 {online} 个", f"会话页 {conv}", f"首页 {home}"]
        recent_focus_id = self._recent_focus_home_client_id()
        if recent_focus_id:
            parts.append(f"最近焦点：首页 {recent_focus_id}")
        if self._bind_each_chat_to_page:
            bind_text = "在线" if (bound_enabled and bound_online) else "离线"
            parts.append(f"绑定：{bind_text}")
        text = "｜".join(parts)
        if bound_enabled and bound_online:
            return text, "ok"
        if self._bind_each_chat_to_page and online > 0:
            return text, "error"
        if online > 0:
            return text, "warn"
        return text, "ok"
    def _check_tm_send_prerequisites(self, session):
        if not self._bind_each_chat_to_page:
            return True, ""
        summary = self._tm_summary_for_session(session)
        online = int(summary.get("online_clients") or 0)
        if online <= 0:
            return False, "油猴离线，请先打开 ChatGPT 页面并确认脚本在线。"
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bind_state = self._remote_bind_state(remote)
        if bind_state == BIND_STATE_WAITING_HOME:
            return (
                False,
                "正在等待 ChatGPT 首页上线，首条消息将在页面上线后自动发送。",
            )
        if not remote.get("enabled"):
            return False, "请先发送消息以连接 ChatGPT 页面。"
        bind_state = self._effective_bind_state(session)
        if bind_state == BIND_STATE_UNBOUND:
            return False, "请先发送消息以连接 ChatGPT 页面。"
        if bind_state == BIND_STATE_BOUND_OFFLINE:
            if self._remote_bind_state(remote) == BIND_STATE_PREBOUND_HOME:
                return (
                    False,
                    "预绑定首页已离线，正在重新选择空闲首页或打开新的 ChatGPT 首页。",
                )
            return (
                False,
                "绑定的 ChatGPT 对话页离线，请打开该页面或重新绑定同一对话页。",
            )
        if bind_state == BIND_STATE_PREBOUND_HOME:
            if remote.get("bootstrap_in_progress"):
                return False, "正在通过首页创建 ChatGPT 对话，请等待完成后再发送。"
            user_count = self._session_user_message_count(session)
            if user_count > 0:
                return (
                    False,
                    "当前对话已发送过首条消息，请等待自动绑定对话页完成。",
                )
            return True, ""
        if bind_state == BIND_STATE_BOUND_CONVERSATION:
            bound_conv = (remote.get("conversation_id") or "").strip()
            if not bound_conv:
                return False, "绑定页面缺少 conversation_id，请重新绑定当前对话页。"
            return True, ""
        return True, ""
    def _make_inbound_key(self, item):
        kind = item.get("kind", "")
        message_id = item.get("message_id") or ""
        payload = item.get("payload") or {}
        text = (
            payload.get("text")
            or payload.get("detail")
            or payload.get("reason")
            or str(payload)
        )
        return f"{kind}|{message_id}|{text}"
    def _is_finalized(self, bridge_message_id):
        return bool(
            bridge_message_id
            and bridge_message_id in self._finalized_bridge_message_ids
        )
    def _finalize_bridge(self, bridge_message_id):
        if bridge_message_id:
            self._finalized_bridge_message_ids.add(bridge_message_id)

    def _session_has_retryable_unclaimed_bootstrap(self, session):
        if session is None:
            return False
        now = time.time()
        for message in session.messages:
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = server.get_message_state(bridge_id)
            if not state:
                continue
            if not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = float(state.get("created_at") or 0)
            if now - created_at >= self.BOOTSTRAP_CLAIM_TIMEOUT_SECONDS:
                return True
        return False

    def _bootstrap_retry_user_text(self, session):
        if session is None:
            return ""
        now = time.time()
        for message in session.messages:
            if message.role != "user":
                continue
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = server.get_message_state(bridge_id)
            if not state or not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = float(state.get("created_at") or 0)
            if now - created_at < self.BOOTSTRAP_CLAIM_TIMEOUT_SECONDS:
                continue
            text = (message.content or "").strip()
            if text:
                return text
        return ""

    def _cancel_retryable_bootstrap(self, session):
        if session is None:
            return False
        cancelled = False
        now = time.time()
        for message in session.messages:
            bridge_id = (message.bridge_message_id or "").strip()
            if not bridge_id:
                continue
            state = server.get_message_state(bridge_id)
            if not state:
                continue
            if not state.get("bootstrap_conversation"):
                continue
            if (state.get("status") or "").strip() != "queued":
                continue
            created_at = float(state.get("created_at") or 0)
            if now - created_at < self.BOOTSTRAP_CLAIM_TIMEOUT_SECONDS:
                continue
            turn_id = (message.turn_id or "").strip()
            server.cancel_message(bridge_id, "bootstrap_not_claimed_timeout")
            self._finalize_bridge(bridge_id)
            if message.role == "user":
                message.status = "发送超时"
            if message.role == "assistant" and turn_id:
                self._set_reply_error(
                    session,
                    turn_id,
                    "上一个 ChatGPT 首页未取走消息，已自动打开新的首页并重新发送。",
                    "发送超时",
                )
            cancelled = True

        if cancelled:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            old_client = (
                remote.get("client_id") or remote.get("prebound_home_client_id") or "-"
            )
            self._append_log(
                f"[AUTO_BIND][BOOTSTRAP_RETRY] session_id={session.session_id} "
                f"old_client={old_client} reason=bootstrap_not_claimed_timeout"
            )
            session.remote_chatgpt = {
                **default_remote_chatgpt(),
                "bind_state": BIND_STATE_UNBOUND,
            }
            session.updated_at = time.time()
            self._save_sessions_to_disk()
            self._apply_chat_bind_visual_state()
            self._update_bound_page_display()

        return cancelled

    def _retry_bootstrap_after_claim_timeout(self, session):
        user_text = self._bootstrap_retry_user_text(session)
        if not user_text:
            return False
        if not self._cancel_retryable_bootstrap(session):
            return False
        self._add_system_message(
            "上一个 ChatGPT 首页未取走消息，已自动打开新的首页并重新发送。"
        )
        ready, reason = self._prepare_first_message_binding(session, user_text)
        if ready:
            self._push_message_text(session, user_text, from_pending_bootstrap=True)
            return True
        if reason == "__WAITING_HOME_PENDING__":
            return True
        if reason:
            self._add_system_message(reason)
        return False

    def _check_bootstrap_claim_timeouts(self):
        for session in self._sessions.values():
            if not self._session_has_retryable_unclaimed_bootstrap(session):
                continue
            self._retry_bootstrap_after_claim_timeout(session)
    @staticmethod
    def _is_persistable_page_url(url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return False
        lower = raw.lower()
        if not (lower.startswith("http://") or lower.startswith("https://")):
            return False
        noisy_fragments = (
            "/backend-api/",
            "/sentinel/",
            "frame.html",
            "/oauth",
            "challenge-platform",
        )
        if any(fragment in lower for fragment in noisy_fragments):
            return False
        return True
    def _load_saved_page_url(self):
        raw = self._settings.value("last_page_url", "")
        if isinstance(raw, str) and self._is_persistable_page_url(raw):
            return raw.strip()
        return None
    def _persist_page_url(self, url):
        if not self._is_persistable_page_url(url):
            return
        self._saved_page_url = url.strip()
        self._settings.setValue("last_page_url", self._saved_page_url)
    def _set_page_link_label(self, label, prefix, url, open_btn=None):
        if not url:
            label.setText(f"{prefix}-")
            label.setToolTip("")
            if open_btn is not None:
                open_btn.setEnabled(False)
            return
        display = self._short_page_display(url)
        href = html.escape(url, quote=True)
        text = html.escape(display)
        label.setText(
            f'{prefix}<a href="{href}" style="color:#1565c0; text-decoration: underline;">{text}</a>'
        )
        label.setToolTip(url)
        if open_btn is not None:
            open_btn.setEnabled(True)
    def _update_live_page_display(self, live_url=None, summary=None):
        summary = summary or self._tm_summary_for_session()
        status = self._last_bridge_status or {}
        active_id = (summary.get("active_client_id") or "").strip()
        client_info = self._client_info_by_id(active_id, status)
        if client_info is None and live_url:
            live_client_id = (status.get("tampermonkey_client_id") or "").strip()
            client_info = self._client_info_by_id(live_client_id, status)
        if client_info is None:
            for item in status.get("tampermonkey_clients") or []:
                if item.get("online"):
                    client_info = item
                    break
        show_url = None
        if isinstance(client_info, dict):
            page_url = (client_info.get("page_url") or "").strip()
            if self._is_bindable_chatgpt_url(page_url):
                show_url = page_url
        if show_url is None:
            live = (live_url or "").strip()
            if self._is_bindable_chatgpt_url(live):
                show_url = live
        if show_url:
            self._persist_page_url(show_url)
        self._tampermonkey_page_url = show_url
        if client_info:
            line = self._format_tm_page_status_line("当前油猴页面：", client_info)
            session = self._current_session()
            if session:
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                session_token = self._session_bind_request_id(remote)
                live_token = (
                    client_info.get("bind_request_id")
                    or client_info.get("launch_token")
                    or ""
                ).strip()
                bind_state_raw = self._remote_bind_state(remote)
                if (
                    session_token
                    and live_token
                    and live_token != session_token
                    and bind_state_raw
                    in (BIND_STATE_WAITING_HOME, BIND_STATE_PREBOUND_HOME)
                ):
                    line = (
                        f"{line}｜"
                        "<span style='color:#c62828'>"
                        "当前页面不是本会话打开的 ChatGPT 首页，不能用于当前新对话"
                        "</span>"
                    )
            self.tm_live_page_label.setText(line)
            self.tm_live_page_label.setToolTip((client_info.get("page_url") or "").strip())
            if hasattr(self, "open_live_page_btn"):
                self.open_live_page_btn.setEnabled(bool(show_url))
            return
        self._set_page_link_label(
            self.tm_live_page_label, "当前油猴页面：", show_url, self.open_live_page_btn
        )
    def _is_client_online(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return False
        for item in self._last_bridge_status.get("tampermonkey_clients") or []:
            if (item.get("client_id") or "").strip() == client_id:
                return bool(item.get("online"))
        return False
    def _client_conversation_id(self, client_info):
        if not isinstance(client_info, dict):
            return ""
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return conversation_id
        page_url = (client_info.get("page_url") or "").strip()
        return parse_conversation_id(page_url)
    def _is_sendable_chatgpt_client(self, client_info, expected_conversation_id=""):
        if not isinstance(client_info, dict):
            return False

        client_id = (client_info.get("client_id") or "").strip()
        if not client_id:
            return False

        if not client_info.get("online"):
            return False

        page_url = (client_info.get("page_url") or "").strip()
        if not page_url or page_url == "-":
            return False
        if not self._is_bindable_chatgpt_url(page_url):
            return False

        try:
            parsed = urlparse(page_url)
            path = parsed.path or "/"
            if not path.startswith("/c/"):
                return False
        except ValueError:
            return False

        page_type = (client_info.get("page_type") or "").strip()
        if page_type in ("-", "home", "ignored"):
            return False

        raw_conversation_id = (client_info.get("conversation_id") or "").strip()
        if raw_conversation_id == "-":
            return False

        conversation_id = self._client_conversation_id(client_info)
        if not conversation_id:
            return False

        expected_conversation_id = (expected_conversation_id or "").strip()
        if expected_conversation_id and conversation_id != expected_conversation_id:
            return False

        return True
    def _find_online_client_for_remote(self, remote):
        remote = normalize_remote_chatgpt(remote)

        bound_client_id = (remote.get("client_id") or "").strip()
        bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
        bound_url = (remote.get("conversation_url") or "").strip()
        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(bound_url)

        if not bound_conversation_id:
            return None

        candidates = []
        for item in self._last_bridge_status.get("tampermonkey_clients") or []:
            if not isinstance(item, dict):
                continue

            if not self._is_sendable_chatgpt_client(item, bound_conversation_id):
                continue

            item_client_id = (item.get("client_id") or "").strip()
            item_page_instance_id = (item.get("page_instance_id") or "").strip()
            item_url = (item.get("page_url") or "").strip()
            item_conversation_id = self._client_conversation_id(item)

            score = 0
            if bound_client_id and item_client_id == bound_client_id:
                score += 100
            if bound_page_instance_id and item_page_instance_id == bound_page_instance_id:
                score += 80
            if bound_url and item_url == bound_url:
                score += 60
            if bound_conversation_id and item_conversation_id == bound_conversation_id:
                score += 50

            if score <= 0:
                continue

            visible_score = 1 if item.get("visible") == "visible" else 0
            focus_score = 1 if item.get("has_focus") else 0
            last_seen = float(item.get("last_seen") or 0)

            candidates.append((score, visible_score, focus_score, last_seen, item))

        if not candidates:
            return None

        candidates.sort(key=lambda row: (row[0], row[1], row[2], row[3]), reverse=True)
        return dict(candidates[0][4])
    def _session_has_sendable_bound_page(self, remote):
        return self._find_online_client_for_remote(remote) is not None
    def _current_bind_visual_state(self):
        session = self._current_session()
        if (
            session
            and self._pending_auto_bind_session_id == session.session_id
        ):
            return "pending_bind"
        if not session:
            return "unbound_required" if self._bind_each_chat_to_page else "unbound_optional"
        bind_state = self._effective_bind_state(session)
        if bind_state == BIND_STATE_PREBOUND_HOME:
            return "prebound_home"
        if bind_state == BIND_STATE_BOUND_CONVERSATION:
            return "bound_online"
        if bind_state == BIND_STATE_BOUND_OFFLINE:
            return "bound_offline"
        if self._bind_each_chat_to_page:
            return "unbound_required"
        return "unbound_optional"
    def _apply_chat_bind_visual_state(self):
        state = self._current_bind_visual_state()
        widgets = []
        if hasattr(self, "_chat_panel"):
            widgets.append(self._chat_panel)
        if hasattr(self, "chat_scroll"):
            widgets.append(self.chat_scroll)
        if hasattr(self, "chat_container"):
            widgets.append(self.chat_container)
        for widget in widgets:
            widget.setProperty("bindState", state)
            style = widget.style()
            style.unpolish(widget)
            style.polish(widget)
    def _has_online_bindable_chatgpt_page(self):
        if self._live_openable_chatgpt_url():
            return True
        status = self._last_bridge_status or {}
        for item in status.get("tampermonkey_clients") or []:
            if not isinstance(item, dict):
                continue
            if not item.get("online"):
                continue
            page_url = (item.get("page_url") or "").strip()
            if self._is_bindable_chatgpt_url(page_url):
                return True
        return False
    def _try_auto_bind_online_page(self, session):
        status = self._last_bridge_status or {}
        client_info = self._pick_auto_bind_client(
            status, (session.session_id if session else "") or ""
        )
        if not client_info and status.get("tampermonkey_online"):
            client_id = (status.get("tampermonkey_client_id") or "").strip()
            client_info = self._client_info_from_status(client_id)
            if client_info:
                client_info = dict(client_info)
                client_info["page_url"] = (
                    client_info.get("page_url")
                    or (status.get("tampermonkey_page_url") or "").strip()
                )
        if not client_info:
            return False
        return self._bind_page_to_session(session, client_info, silent=True)
    def _rebind_current_session_to_online_client_if_needed(self):
        if not self._bind_each_chat_to_page:
            return False

        session = self._current_session()
        if session is None:
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        bound_client_id = (remote.get("client_id") or "").strip()

        if bind_state == BIND_STATE_PREBOUND_HOME:
            if self._session_has_prebound_home_online(remote):
                return False
            self._append_log(
                "[自动换绑] 预绑定首页离线，不会换绑到其他 conversation 页面。"
            )
            return False

        if bound_client_id and self._is_client_online(bound_client_id):
            if remote.get("enabled") and self._session_has_sendable_bound_page(remote):
                return False

        status = self._last_bridge_status or {}
        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        bound_conversation_url = (remote.get("conversation_url") or "").strip()
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(bound_conversation_url)
        bound_url_base = bound_conversation_url.split("#")[0] if bound_conversation_url else ""
        lock_conversation = bool(
            remote.get("enabled")
            and bind_state == BIND_STATE_BOUND_CONVERSATION
            and bound_conversation_id
        )

        candidates = []
        for item in status.get("tampermonkey_clients") or []:
            if not isinstance(item, dict):
                continue

            client_id = (item.get("client_id") or "").strip()
            page_url = (item.get("page_url") or "").strip()

            if not client_id:
                continue

            if not item.get("online"):
                continue

            if not self._is_bindable_chatgpt_url(page_url):
                continue

            if self._is_client_bound_to_other_session(item, session.session_id):
                continue

            page_type = (item.get("page_type") or "").strip()
            conversation_id = self._client_conversation_id(item)

            if lock_conversation:
                if conversation_id != bound_conversation_id:
                    continue
                if bound_url_base:
                    page_base = page_url.split("#")[0]
                    if page_base != bound_url_base:
                        continue

            score = 0
            if client_id == live_client_id:
                score += 100
            if (
                bound_conversation_id
                and conversation_id
                and conversation_id == bound_conversation_id
            ):
                score += 200
            if conversation_id:
                score += 50
            if page_type == "conversation":
                score += 30
            if item.get("has_focus"):
                score += 20

            last_seen = float(item.get("last_seen") or 0)
            candidates.append((score, last_seen, item))

        if not candidates:
            if lock_conversation:
                self._append_log(
                    "[自动换绑] 绑定页面离线，未找到同会话在线页面，请打开绑定页面。"
                )
            else:
                self._append_log("[自动换绑] 没有找到可用的在线 ChatGPT 页面。")
            return False

        candidates.sort(key=lambda row: (row[0], row[1]), reverse=True)
        client_info = dict(candidates[0][2])

        page_type = (client_info.get("page_type") or "").strip()
        if lock_conversation or page_type == "conversation":
            ok = self._bind_conversation_to_session(session, client_info, silent=True)
        else:
            ok = False
        if ok:
            self._append_log(
                "[自动换绑] "
                f"old_client_id={bound_client_id or '-'} "
                f"new_client_id={client_info.get('client_id') or '-'} "
                f"url={client_info.get('page_url') or '-'}"
            )
            self._update_bound_page_display()
            self._save_sessions_to_disk()

        return ok
    def _open_or_queue_url(self, url, label=""):
        target = (url or "").strip()
        if not target:
            self._append_log("[打开网页] URL 为空，已取消。")
            return False

        self._mark_auto_bind_waiting()

        if self._open_url_in_browser(target, label):
            self._append_log(
                f"[打开网页] 已通过系统浏览器打开：{label or target}"
            )
            return True

        if server.is_server_running():
            msg = self._push_open_url(target, active=True, label=label)
            if msg is not None:
                self._append_log(
                    f"[打开网页] 系统浏览器打开失败，已通过油猴队列打开："
                    f"{label or target}"
                )
                return True

        self._append_log(f"[打开网页] 打开失败：{target}")
        return False
    def _auto_open_url_once(self, session, url, label="", interval=20):
        target = (url or "").strip()
        if not target:
            return False

        session_id = session.session_id if session else "-"
        key = f"{session_id}|{target}"
        now = time.time()
        last_open_at = self._last_auto_open_url_at.get(key, 0)

        if now - last_open_at < interval:
            self._append_log(
                f"[打开网页] 跳过重复自动打开，{interval} 秒内已打开过：{target}"
            )
            return False

        self._last_auto_open_url_at[key] = now
        self._mark_auto_bind_waiting()

        if self._open_url_in_browser(target, label):
            self._append_log(
                f"[打开网页] 已通过系统浏览器打开：{label or target}"
            )
            return True

        if server.is_server_running():
            msg = self._push_open_url(target, active=True, label=label)
            if msg is not None:
                self._append_log(
                    f"[打开网页] 已通过油猴队列打开：{label or target}"
                )
                return True

        self._append_log(f"[打开网页] 打开失败：{target}")
        return False
    def _open_page_once(self, open_url, label):
        return self._open_or_queue_url(open_url, label)
    def _preferred_open_url_for_session(self, session):
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )

        history_url = self._chatgpt_url_from_remote(remote)
        if self._is_bindable_chatgpt_url(history_url):
            return history_url

        saved = (self._saved_page_url or "").strip()
        if self._is_bindable_chatgpt_url(saved):
            return saved

        live = self._live_openable_chatgpt_url()
        if self._is_bindable_chatgpt_url(live):
            return live

        return CHATGPT_HOME_URL
    def _resolve_target_page_for_session(self, session):
        session_id = (session.session_id if session else "") or ""
        remote_early = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if self._remote_bind_state(remote_early) == BIND_STATE_WAITING_HOME:
            return (
                "",
                "",
                False,
                "正在等待 ChatGPT 首页上线，首条消息将在页面上线后自动发送。",
            )
        if self._pending_auto_bind_session_id == session_id:
            return (
                "",
                "",
                False,
                "当前对话正在等待新打开的 ChatGPT 页面上线并自动绑定，请稍后再发送。",
            )

        if not self._bind_each_chat_to_page:
            return (
                "",
                "",
                True,
                "未启用页面绑定，使用任意在线页面。",
            )

        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        enabled = bool(remote.get("enabled"))
        bind_state = self._remote_bind_state(remote)
        client_id = (remote.get("client_id") or "").strip()
        page_url = (remote.get("conversation_url") or remote.get("url") or "").strip()

        if bind_state == BIND_STATE_PREBOUND_HOME:
            home_client = self._find_prebound_home_client(remote)
            if home_client:
                home_url = (home_client.get("page_url") or page_url or CHATGPT_HOME_URL).strip()
                home_id = (home_client.get("client_id") or client_id).strip()
                return (
                    home_id,
                    home_url,
                    True,
                    "预绑定首页在线，首条消息将通过首页创建对话。",
                )
            return (
                "",
                "",
                False,
                "预绑定首页已离线，正在重新选择空闲首页或打开新的 ChatGPT 首页。",
            )

        if not enabled or not page_url:
            if bind_state == BIND_STATE_UNBOUND:
                return (
                    "",
                    "",
                    False,
                    "当前对话尚未绑定 ChatGPT 页面，请先发送首条消息。",
                )

            if self._auto_bind_unbound_page and self._try_auto_bind_online_page(
                session
            ):
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                client_id = (remote.get("client_id") or "").strip()
                page_url = (remote.get("conversation_url") or "").strip()
                if client_id and self._is_client_online(client_id):
                    return client_id, page_url, True, "已自动绑定在线 ChatGPT 页面。"

            return "", "", False, "当前对话未绑定 ChatGPT 页面。"

        matched_client = self._find_online_client_for_remote(remote)
        if matched_client:
            matched_client_id = (matched_client.get("client_id") or "").strip()
            matched_page_url = (matched_client.get("page_url") or "").strip()
            if not matched_page_url:
                matched_page_url = page_url
            if matched_client_id and matched_client_id != client_id:
                self._bind_page_to_session(session, matched_client, silent=True)
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                client_id = (remote.get("client_id") or "").strip()
                page_url = (
                    (remote.get("conversation_url") or "").strip()
                    or matched_page_url
                )
            return (
                matched_client_id or client_id,
                page_url or matched_page_url,
                True,
                "绑定页面在线。",
            )

        if self._is_client_online(client_id):
            return client_id, page_url, True, "绑定页面在线。"

        rebind_attempted = self._rebind_current_session_to_online_client_if_needed()
        if rebind_attempted:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            client_id = (remote.get("client_id") or "").strip()
            page_url = (remote.get("conversation_url") or "").strip()
            matched_client = self._find_online_client_for_remote(remote)
            if matched_client:
                matched_client_id = (matched_client.get("client_id") or "").strip()
                matched_page_url = (matched_client.get("page_url") or "").strip()
                if not matched_page_url:
                    matched_page_url = page_url
                return (
                    matched_client_id or client_id,
                    page_url or matched_page_url,
                    True,
                    "绑定页面已自动换绑并在线。",
                )
            if client_id and self._is_client_online(client_id):
                return (
                    client_id,
                    page_url,
                    True,
                    "绑定页面已自动换绑并在线。",
                )

        if (
            self._auto_open_bound_page_when_missing
            and not self._pending_auto_bind_session_id
        ):
            open_url = page_url or self._preferred_open_url_for_session(session)
            if self._auto_open_url_once(
                session,
                open_url,
                "自动打开当前对话绑定页面",
            ):
                if rebind_attempted:
                    hint = (
                        "当前绑定页面离线，已尝试自动换绑到在线页面；"
                        "仍未找到可用在线页面，已打开绑定页面，"
                        "请等待油猴上线后重新发送。"
                    )
                else:
                    hint = (
                        "未找到在线 ChatGPT 页面，已打开绑定页面，"
                        "请等待油猴上线后重新发送。"
                    )
                return "", "", False, hint
            if rebind_attempted:
                hint = (
                    "当前绑定页面离线，已尝试自动换绑；"
                    "仍未找到在线页面。绑定页面已在近期打开，"
                    "请等待油猴上线后重新发送。"
                )
            else:
                hint = (
                    "未找到在线 ChatGPT 页面。绑定页面已在近期打开，"
                    "请等待油猴上线后重新发送。"
                )
            return "", "", False, hint

        if self._allow_fallback_to_any_page:
            return (
                "",
                "",
                True,
                "绑定页面未在线，按设置退回任意在线页面发送。",
            )

        return "", "", False, "绑定页面未打开，请先打开当前对话绑定页面。"
    def _best_live_conversation_client(self, status=None):
        status = status or self._last_bridge_status or {}
        clients = status.get("tampermonkey_clients") or []
        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
        candidates = []
        for item in clients:
            if not isinstance(item, dict):
                continue
            if not self._is_sendable_chatgpt_client(item):
                continue
            client_id = (item.get("client_id") or "").strip()
            score = 0
            if client_id == live_client_id:
                score += 100
            if item.get("has_focus"):
                score += 30
            if item.get("visible") == "visible":
                score += 20
            last_seen = float(item.get("last_seen") or 0)
            candidates.append((score, last_seen, item))
        if not candidates:
            return None
        candidates.sort(key=lambda row: (row[0], row[1]), reverse=True)
        return dict(candidates[0][2])
    def _binding_status_details(self, session=None):
        session = session or self._current_session()
        status = self._last_bridge_status or {}
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        bound_client_id = (remote.get("client_id") or "").strip() or "-"
        bound_conv_id = (remote.get("conversation_id") or "").strip()
        if not bound_conv_id:
            bound_conv_id = parse_conversation_id(
                remote.get("conversation_url") or ""
            )
        bound_conv_id = bound_conv_id or "-"

        live_client = self._best_live_conversation_client(status)
        online_client_id = "-"
        online_conv_id = "-"
        if live_client:
            online_client_id = (live_client.get("client_id") or "").strip() or "-"
            online_conv_id = self._client_conversation_id(live_client) or "-"

        if not remote.get("enabled"):
            match = "未绑定"
        elif bound_client_id == "-" or online_client_id == "-":
            match = "无法比对"
        elif (
            bound_client_id == online_client_id
            and bound_conv_id == online_conv_id
        ):
            match = "一致"
        else:
            match = "不一致"

        return {
            "online_client_id": online_client_id,
            "online_conversation_id": online_conv_id,
            "bound_client_id": bound_client_id,
            "bound_conversation_id": bound_conv_id,
            "match": match,
            "live_client": live_client,
        }
    def _verify_send_target_binding(self, session, target_client_id, target_page_url):
        if not self._bind_each_chat_to_page:
            return target_client_id, target_page_url, True, ""

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return target_client_id, target_page_url, True, ""

        bind_state = self._effective_bind_state(session)
        if bind_state == BIND_STATE_PREBOUND_HOME:
            prebound_client = (
                remote.get("prebound_home_client_id") or remote.get("client_id") or ""
            ).strip()
            prebound_instance = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            target_client_id = (target_client_id or prebound_client).strip()
            if target_client_id != prebound_client:
                return (
                    "",
                    "",
                    False,
                    "目标页面不是当前对话预绑定的 ChatGPT 首页。",
                )
            home_client = self._find_prebound_home_client(remote)
            if not home_client:
                return (
                    "",
                    "",
                    False,
                    "预绑定的 ChatGPT 首页离线，请重新打开首页。",
                )
            home_url = (home_client.get("page_url") or target_page_url or CHATGPT_HOME_URL).strip()
            if prebound_instance and (
                home_client.get("page_instance_id") or ""
            ).strip() != prebound_instance:
                return (
                    "",
                    "",
                    False,
                    "预绑定首页的 page_instance_id 不一致，请重新绑定首页。",
                )
            return target_client_id, home_url, True, ""

        bound_client_id = (remote.get("client_id") or "").strip()
        bound_conv_id = (remote.get("conversation_id") or "").strip()
        if not bound_conv_id:
            bound_conv_id = parse_conversation_id(
                remote.get("conversation_url") or ""
            )
        bound_url = (remote.get("conversation_url") or "").strip()

        target_client_id = (target_client_id or "").strip()
        target_page_url = (target_page_url or "").strip()

        client_info = None
        if target_client_id:
            client_info = self._client_info_from_status(target_client_id)

        if client_info and client_info.get("online"):
            online_conv = self._client_conversation_id(client_info)
            online_url = (client_info.get("page_url") or "").strip()
            if bound_conv_id and online_conv and bound_conv_id != online_conv:
                live = self._find_online_client_for_remote(remote)
                if live:
                    live_id = (live.get("client_id") or "").strip()
                    live_url = (live.get("page_url") or "").strip()
                    if live_id and live_id != bound_client_id:
                        self._log_bind_auto_rebind(
                            session, live, reason="conversation_mismatch"
                        )
                        self._bind_page_to_session(session, live, silent=True)
                        self._update_bound_page_display()
                        return (
                            live_id,
                            live_url or target_page_url,
                            True,
                            "发送前已自动换绑到同会话在线页面。",
                        )
                return (
                    "",
                    "",
                    False,
                    "当前在线页面的 conversation_id 与绑定不一致，请先绑定当前页面。",
                )
            if bound_url and online_url:
                same_url = bound_url.split("#")[0] == online_url.split("#")[0]
                same_conversation = bool(
                    bound_conv_id and online_conv and bound_conv_id == online_conv
                )
                if not same_url and not same_conversation:
                    return (
                        "",
                        "",
                        False,
                        "当前在线页面 URL 与绑定页面不一致，请先绑定当前页面。",
                    )
            return target_client_id, target_page_url, True, ""

        if bound_client_id and not self._is_client_online(bound_client_id):
            live = self._find_online_client_for_remote(remote)
            if live:
                live_id = (live.get("client_id") or "").strip()
                live_url = (live.get("page_url") or "").strip()
                self._log_bind_auto_rebind(session, live, reason="bound_offline")
                self._bind_page_to_session(session, live, silent=True)
                self._update_bound_page_display()
                return (
                    live_id,
                    live_url or bound_url,
                    True,
                    "绑定页面离线，发送前已自动换绑到同会话在线页面。",
                )
            details = self._binding_status_details(session)
            if details.get("live_client"):
                live = details["live_client"]
                live_id = (live.get("client_id") or "").strip()
                live_conv = self._client_conversation_id(live)
                if bound_conv_id and live_conv and bound_conv_id != live_conv:
                    return (
                        "",
                        "",
                        False,
                        "当前在线页面与绑定页面不一致，请先绑定当前页面。",
                    )
                self._log_bind_auto_rebind(
                    session, live, reason="bound_offline_live_mismatch"
                )
                self._bind_page_to_session(session, live, silent=True)
                self._update_bound_page_display()
                live_url = (live.get("page_url") or "").strip()
                return (
                    live_id,
                    live_url or bound_url,
                    True,
                    "绑定页面离线，发送前已自动换绑到当前在线 conversation 页面。",
                )
            return (
                "",
                "",
                False,
                "绑定的 client_id 不在线，且未找到可用的同会话在线页面。",
            )

        return target_client_id, target_page_url, True, ""
    def _update_bound_page_display(self, summary=None):
        summary = summary or self._tm_summary_for_session()
        session = self._current_session()
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if not self._bind_each_chat_to_page:
            hint = "页面绑定功能未启用，当前使用任意在线页面发送"
            url = self._session_openable_chatgpt_url(session)
            if url:
                client_id = (remote.get("client_id") or "").strip()
                online = self._session_has_sendable_bound_page(remote)
                status_text = "在线" if online else "离线"
                bind_note = "已绑定" if remote.get("enabled") else "已关联"
                short = self._short_page_display(url)
                self.tm_bound_page_label.setText(
                    f"{hint} | {bind_note}：{short} | client_id：{client_id or '-'} | {status_text}"
                )
                self.tm_bound_page_label.setToolTip(url)
                self._set_chat_open_bound_enabled(True)
                self._set_chat_flash_bound_enabled(bool(client_id))
            else:
                live = self._live_openable_chatgpt_url()
                if live:
                    self.tm_bound_page_label.setText(
                        f"{hint} | 可打开当前在线页面：{self._short_page_display(live)}"
                    )
                    self.tm_bound_page_label.setToolTip(live)
                    self._set_chat_open_bound_enabled(True)
                    self._set_chat_flash_bound_enabled(bool(client_id))
                else:
                    self.tm_bound_page_label.setText(hint)
                    self.tm_bound_page_label.setToolTip("")
                    self._set_chat_open_bound_enabled(False)
                    self._set_chat_flash_bound_enabled(False)
            self._apply_chat_bind_visual_state()
            return

        if remote.get("enabled"):
            bind_state = self._effective_bind_state(session)
            url = (
                remote.get("conversation_url") or remote.get("url") or ""
            ).strip()
            client_id = (remote.get("client_id") or "").strip()
            bound_info = self._client_info_by_id(client_id) or {
                "client_id": client_id,
                "page_url": url,
                "page_type": remote.get("page_type") or "",
                "conversation_id": remote.get("conversation_id") or "",
                "last_seen": remote.get("last_seen"),
                "online": bind_state
                in (BIND_STATE_PREBOUND_HOME, BIND_STATE_BOUND_CONVERSATION),
            }
            if bind_state == BIND_STATE_PREBOUND_HOME:
                prefix = "预绑定首页："
                hint = (
                    "发送第一条消息后将自动创建并绑定 ChatGPT 对话。"
                )
            elif bind_state == BIND_STATE_BOUND_CONVERSATION:
                conv = (remote.get("conversation_id") or "").strip()
                prefix = "绑定对话页："
                hint = f"conversation_id={conv or '-'}"
            elif bind_state == BIND_STATE_BOUND_OFFLINE:
                if self._remote_bind_state(remote) == BIND_STATE_PREBOUND_HOME:
                    prefix = "预绑定首页："
                    hint = "预绑定首页已离线，正在重新选择空闲首页或打开新的 ChatGPT 首页。"
                else:
                    prefix = "绑定对话页："
                    hint = "对话页离线，请打开绑定的 ChatGPT 对话页。"
            else:
                prefix = "绑定页面："
                hint = ""
            line = self._format_tm_page_status_line(prefix, bound_info)
            session_token = self._session_bind_request_id(remote)
            if session_token:
                line = f"{line}｜bind_request_id={session_token[:12]}…"
            if hint:
                line = f"{line}｜{hint}"
            if session and session_token and bound_info:
                live_token = (
                    bound_info.get("bind_request_id")
                    or bound_info.get("launch_token")
                    or ""
                ).strip()
                bind_state_raw = self._remote_bind_state(remote)
                if (
                    bind_state_raw in (BIND_STATE_WAITING_HOME, BIND_STATE_PREBOUND_HOME)
                    and live_token
                    and live_token != session_token
                ):
                    line = (
                        f"{line}｜"
                        "<span style='color:#c62828'>"
                        "当前页面不是本会话打开的 ChatGPT 首页，不能用于当前新对话"
                        "</span>"
                    )
            self.tm_bound_page_label.setText(line)
            self.tm_bound_page_label.setToolTip(
                f"{url}\n绑定状态={bind_state}\nclient_id={client_id or '-'}\n"
                f"bind_request_id={session_token or '-'}\n"
                f"online={bind_state in (BIND_STATE_PREBOUND_HOME, BIND_STATE_BOUND_CONVERSATION)}"
            )
            self._set_chat_open_bound_enabled(
                bind_state
                in (BIND_STATE_PREBOUND_HOME, BIND_STATE_BOUND_CONVERSATION)
            )
            self._set_chat_flash_bound_enabled(bool(client_id))
        else:
            if self._has_online_bindable_chatgpt_page():
                live = self._live_openable_chatgpt_url()
                short = self._short_page_display(live) if live else "-"
                self.tm_bound_page_label.setText(
                    f"绑定页面：未绑定 | 检测到在线页面：{short}，等待自动绑定"
                )
                self.tm_bound_page_label.setToolTip(live or "")
            else:
                self.tm_bound_page_label.setText(
                    "绑定页面：未绑定（等待自动绑定，或在设置中关闭页面绑定）"
                )
                self.tm_bound_page_label.setToolTip("")
            self._set_chat_open_bound_enabled(False)
            self._set_chat_flash_bound_enabled(False)

        self._apply_chat_bind_visual_state()
    def _set_chat_open_bound_enabled(self, enabled):
        if hasattr(self, "chat_open_bound_btn"):
            self.chat_open_bound_btn.setEnabled(bool(enabled))
    def _set_chat_flash_bound_enabled(self, enabled):
        if hasattr(self, "flash_bound_page_btn"):
            self.flash_bound_page_btn.setEnabled(bool(enabled))
    @staticmethod
    def _is_bindable_chatgpt_url(url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return False
        if not PageBindMixin._is_persistable_page_url(raw):
            return False
        try:
            parsed = urlparse(raw)
        except ValueError:
            return False
        host = (parsed.netloc or "").lower()
        if host not in (
            "chatgpt.com",
            "www.chatgpt.com",
            "chat.openai.com",
            "www.chat.openai.com",
        ):
            return False
        path = parsed.path or "/"
        if path in ("", "/"):
            return True
        if path.startswith("/c/"):
            return True
        return False
    def _is_client_bound_to_other_session(self, client_info, current_session_id):
        if not isinstance(client_info, dict):
            return False

        client_id = (client_info.get("client_id") or "").strip()
        page_instance_id = (client_info.get("page_instance_id") or "").strip()
        page_url = (client_info.get("page_url") or "").strip()

        for session_id, session in self._sessions.items():
            if session_id == current_session_id:
                continue

            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote.get("enabled"):
                continue

            bound_client_id = (remote.get("client_id") or "").strip()
            bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
            bound_url = (remote.get("conversation_url") or "").strip()

            if client_id and bound_client_id and client_id == bound_client_id:
                return True

            if (
                page_instance_id
                and bound_page_instance_id
                and page_instance_id == bound_page_instance_id
            ):
                return True

            if page_url and bound_url and page_url == bound_url:
                return True

        return False
    def _candidate_matches_remote(self, client_info, remote):
        if not isinstance(client_info, dict):
            return False

        remote = normalize_remote_chatgpt(remote)

        current_url = (remote.get("conversation_url") or "").strip()
        current_conv = (remote.get("conversation_id") or "").strip()

        page_url = (client_info.get("page_url") or "").strip()
        candidate_conv = (client_info.get("conversation_id") or "").strip()

        if not candidate_conv:
            candidate_conv = parse_conversation_id(page_url)

        if current_conv and candidate_conv and current_conv == candidate_conv:
            return True

        if current_url and page_url and current_url == page_url:
            return True

        if not current_conv and not current_url:
            return True

        return False
    def _client_matches_session_rebind(self, remote, client_info):
        return self._candidate_matches_remote(client_info, remote)
    def _pick_auto_bind_client(self, status, current_session_id, remote=None):
        status = status or {}
        clients = status.get("tampermonkey_clients") or []
        if not clients:
            return None

        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
        within_wait_window = time.time() <= getattr(self, "_auto_bind_wait_until", 0)
        prefer_home = bool(getattr(self, "_pending_auto_bind_session_id", ""))

        candidates = []
        for item in clients:
            if not isinstance(item, dict):
                continue

            client_id = (item.get("client_id") or "").strip()
            page_url = (item.get("page_url") or "").strip()

            if not client_id:
                continue

            if not item.get("online"):
                continue

            if not self._is_bindable_chatgpt_url(page_url):
                continue

            if self._is_client_bound_to_other_session(item, current_session_id):
                continue

            if remote is not None and remote.get("enabled"):
                if not self._candidate_matches_remote(item, remote):
                    continue

            is_new = (
                1
                if within_wait_window
                and client_id
                and client_id not in self._auto_bind_known_clients
                else 0
            )
            page_type = (item.get("page_type") or "").strip()
            is_home = 1 if prefer_home and page_type == "home" else 0
            is_live = 1 if client_id == live_client_id else 0
            has_focus = 1 if item.get("has_focus") else 0
            last_seen = float(item.get("last_seen") or 0)

            candidates.append((is_new, is_home, is_live, has_focus, last_seen, item))

        if not candidates:
            return None

        candidates.sort(
            key=lambda row: (row[0], row[1], row[2], row[3], row[4]),
            reverse=True,
        )
        return dict(candidates[0][5])
    def _auto_bind_current_session_if_needed(self, status):
        if self._pending_auto_bind_session_id:
            return False
        if not getattr(self, "_auto_bind_unbound_page", True):
            return False

        status = status or {}
        if not status.get("tampermonkey_online"):
            return False

        session = self._current_session()
        if session is None:
            session = self._ensure_current_session()

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._remote_bind_state(remote) == BIND_STATE_UNBOUND:
            return False
        if self._remote_bind_state(remote) == BIND_STATE_WAITING_HOME:
            return False

        bound_client_id = (remote.get("client_id") or "").strip()
        rebind_offline = False

        if remote.get("enabled") and bound_client_id:
            if self._is_client_online(bound_client_id):
                if self._session_has_sendable_bound_page(remote):
                    return False
            if self._rebind_current_session_to_online_client_if_needed():
                return True
            rebind_offline = True
            client_info = self._pick_auto_bind_client(
                status,
                session.session_id,
                remote=remote,
            )
        else:
            client_info = self._pick_auto_bind_client(
                status,
                session.session_id,
                remote=None,
            )

        if not client_info:
            return False

        page_type = (client_info.get("page_type") or "").strip()
        if page_type == "home" and not (remote.get("enabled") and bound_client_id):
            ok = self._prebound_home_bind_to_session(session, client_info, silent=True)
        elif page_type == "conversation" or self._client_conversation_id(client_info):
            ok = self._bind_conversation_to_session(session, client_info, silent=True)
        else:
            ok = self._prebound_home_bind_to_session(session, client_info, silent=True)
        if ok:
            action = "自动换绑" if rebind_offline else "自动绑定"
            self._append_log(
                f"[{action}] "
                f"session={session.session_id[:8]}… "
                f"old_client_id={bound_client_id or '-'} "
                f"new_client_id={client_info.get('client_id') or '-'} "
                f"page_type={page_type or '-'} "
                f"url={client_info.get('page_url') or '-'}"
            )

        return ok
    def _mark_auto_bind_waiting(self):
        clients = self._last_bridge_status.get("tampermonkey_clients") or []
        self._auto_bind_known_clients = {
            (item.get("client_id") or "").strip()
            for item in clients
            if isinstance(item, dict) and (item.get("client_id") or "").strip()
        }
        self._auto_bind_wait_until = time.time() + 30
    def _clear_pending_auto_bind(self):
        self._pending_auto_bind_session_id = ""
        self._pending_auto_bind_started_at = 0
        self._pending_auto_bind_until = 0
        self._pending_auto_bind_known_clients.clear()
        self._pending_auto_bind_known_page_instances.clear()
    def _try_finish_pending_auto_bind(self, status):
        session_id = self._pending_auto_bind_session_id
        if not session_id:
            return

        session = self._sessions.get(session_id)
        if not session:
            self._clear_pending_auto_bind()
            return

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._remote_bind_state(remote) != BIND_STATE_WAITING_HOME:
            self._clear_pending_auto_bind()
            return

        now = time.time()
        if now > self._pending_auto_bind_until:
            self._append_log(f"[AUTO_BIND][TIMEOUT] session_id={session_id}")
            if session_id == self._current_session_id:
                self._add_system_message(
                    "等待 ChatGPT 首页上线超时。请确认页面是否打开并且油猴脚本在线，"
                    "或手动点击「绑定当前页面」。"
                )
            session.remote_chatgpt = {
                **remote,
                "bind_state": BIND_STATE_UNBOUND,
                "pending_bootstrap_text": "",
                "pending_bootstrap_created_at": 0,
                "opened_home_at": 0,
            }
            self._save_sessions_to_disk()
            self._clear_pending_auto_bind()
            self._refresh_session_list(select_session_id=self._current_session_id)
            self._apply_chat_bind_visual_state()
            return

        if remote.get("enabled") and (remote.get("client_id") or "").strip():
            bind_state_now = self._remote_bind_state(
                normalize_remote_chatgpt(session.remote_chatgpt)
            )
            if bind_state_now == BIND_STATE_PREBOUND_HOME:
                self._clear_pending_auto_bind()
                return

        expected_token = self._session_bind_request_id(remote)
        clients = (status or {}).get("tampermonkey_clients") or []
        candidates = []
        for item in clients:
            if not isinstance(item, dict):
                continue
            client_id = (item.get("client_id") or "").strip()
            page_instance_id = (item.get("page_instance_id") or "").strip()
            page_type = (item.get("page_type") or "").strip()
            if not client_id or not item.get("online"):
                continue
            if page_type != "home":
                continue
            if self._is_ignored_or_unusable_home_client(item):
                continue
            actual_token = (
                item.get("bind_request_id") or item.get("launch_token") or ""
            ).strip()
            if expected_token:
                if actual_token != expected_token:
                    self._append_log(
                        f"[AUTO_BIND][SKIP_HOME_TOKEN_MISMATCH] session_id={session_id} "
                        f"expected_token={expected_token} "
                        f"actual_token={actual_token or '-'} client_id={client_id}"
                    )
                    continue
            else:
                is_new_client = (
                    client_id not in self._pending_auto_bind_known_clients
                )
                is_new_instance = (
                    page_instance_id
                    and page_instance_id
                    not in self._pending_auto_bind_known_page_instances
                )
                if not is_new_client and not is_new_instance:
                    continue
            if self._is_home_client_used_by_any_session(client_id, page_instance_id):
                continue
            if self._home_client_has_pending_bridge_work(
                client_id, page_instance_id, status
            ):
                continue
            candidates.append(item)

        if not candidates:
            return

        candidates.sort(key=self._idle_home_sort_key, reverse=True)
        selected = candidates[0]
        client_id = (selected.get("client_id") or "").strip()
        page_instance_id = (selected.get("page_instance_id") or "").strip()
        reason = self._idle_home_selection_reason(selected)
        ok = self._prebound_home_bind_to_session(
            session, selected, silent=True, reserve_reason=reason
        )
        if not ok:
            return

        pending_text = (
            normalize_remote_chatgpt(session.remote_chatgpt).get("pending_bootstrap_text")
            or remote.get("pending_bootstrap_text")
            or ""
        ).strip()
        session.remote_chatgpt = {
            **normalize_remote_chatgpt(session.remote_chatgpt),
            "pending_bootstrap_text": "",
            "pending_bootstrap_created_at": 0,
            "opened_home_at": 0,
        }
        matched_token = (
            selected.get("bind_request_id")
            or selected.get("launch_token")
            or expected_token
            or ""
        ).strip()
        self._append_log(
            f"[AUTO_BIND][WAITING_HOME_MATCH] session_id={session_id} "
            f"bind_request_id={matched_token or '-'} "
            f"client_id={client_id} page_instance_id={page_instance_id or '-'}"
        )
        if session_id == self._current_session_id:
            self._add_system_message(
                "已预绑定新打开的 ChatGPT 首页，正在发送首条消息..."
            )
        self._clear_pending_auto_bind()
        self._save_sessions_to_disk()
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        if pending_text:
            self._flush_pending_bootstrap_message(session, pending_text)
    def _sync_bound_session_urls_from_clients(self, status):
        clients = (status or {}).get("tampermonkey_clients") or []
        client_map = {}
        for item in clients:
            if not isinstance(item, dict) or not item.get("online"):
                continue
            client_id = (item.get("client_id") or "").strip()
            if client_id:
                client_map[client_id] = item

        changed = False
        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote.get("enabled"):
                continue
            client_id = (remote.get("client_id") or "").strip()
            if not client_id:
                continue
            item = client_map.get(client_id)
            if not item:
                continue
            page_url = (item.get("page_url") or "").strip()
            if not self._is_bindable_chatgpt_url(page_url):
                continue
            old_url = (remote.get("conversation_url") or "").strip()
            if page_url == old_url:
                continue
            conversation_id = (item.get("conversation_id") or "").strip()
            if not conversation_id:
                conversation_id = parse_conversation_id(page_url)
            session.remote_chatgpt = {
                **remote,
                "conversation_url": page_url,
                "conversation_id": conversation_id or remote.get("conversation_id", ""),
                "page_type": (item.get("page_type") or remote.get("page_type") or "").strip(),
                "page_title": (item.get("page_title") or remote.get("page_title") or "").strip(),
                "last_seen": float(item.get("last_seen") or time.time()),
            }
            session.updated_at = time.time()
            changed = True
            self._append_log(
                f"[AUTO_BIND][UPDATE_URL] session_id={session.session_id} "
                f"client_id={client_id} old={old_url or '-'} new={page_url}"
            )
        if changed:
            self._save_sessions_to_disk()
            if self._current_session():
                self._update_bound_page_display()
    def _bind_page_to_session(self, session, client_info, silent=False):
        if not isinstance(client_info, dict):
            client_info = {
                "client_id": str(client_info or "").strip(),
                "page_url": "",
            }
        page_url = (
            client_info.get("page_url")
            or client_info.get("url")
            or client_info.get("conversation_url")
            or ""
        ).strip()
        page_type = (client_info.get("page_type") or "").strip()
        conversation_id = (
            client_info.get("conversation_id")
            or parse_conversation_id(page_url)
            or ""
        ).strip()
        if not page_type:
            if conversation_id:
                page_type = "conversation"
            elif page_url and self._is_bindable_chatgpt_url(page_url):
                try:
                    path = urlparse(page_url).path or "/"
                    page_type = "home" if path in ("", "/") else "conversation"
                except ValueError:
                    page_type = ""
        if page_type == "home" or (not conversation_id and page_type != "conversation"):
            return self._prebound_home_bind_to_session(session, client_info, silent=silent)
        return self._bind_conversation_to_session(session, client_info, silent=silent)
    def _client_info_from_status(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        for item in self._last_bridge_status.get("tampermonkey_clients") or []:
            if (item.get("client_id") or "").strip() == client_id:
                return dict(item)
        return {"client_id": client_id, "page_url": ""}
    def _on_bind_current_page(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return
        status = server.get_bridge_status()
        if not status.get("tampermonkey_online"):
            self._add_system_message("油猴未在线，无法绑定当前页面。")
            return
        client_id = (status.get("tampermonkey_client_id") or "").strip()
        client_info = self._client_info_from_status(client_id)
        if client_info:
            client_info["page_url"] = (
                client_info.get("page_url")
                or (status.get("tampermonkey_page_url") or "").strip()
            )
        else:
            client_info = {
                "client_id": client_id,
                "page_url": (status.get("tampermonkey_page_url") or "").strip(),
            }
        session = self._ensure_current_session()
        if self._bind_page_to_session(session, client_info):
            self._set_tm_action_hint("已绑定当前页面到本对话。")
    def _on_bind_selected_tm_page(self):
        client_id = self._selected_tm_page_client_id()
        if not client_id:
            if hasattr(self, "tm_page_combo") and self.tm_page_combo.count() == 0:
                hint = "暂无已知 ChatGPT 页面，请先打开页面并点击「刷新状态」。"
            else:
                hint = "请先在页面下拉框中选择要绑定的页面。"
            self._set_tm_action_hint(hint)
            self._append_log("[绑定] 未选中页面，已取消。")
            return
        client_info = self._client_info_from_status(client_id)
        if not client_info:
            self._set_tm_action_hint("未找到选中页面的信息，请先刷新页面列表。")
            self._append_log(f"[绑定] 未找到 client_id={client_id} 的页面信息。")
            return
        row = self.tm_pages_table.currentRow()
        if row >= 0:
            row_client = self.tm_pages_table.item(row, 1)
            if row_client and row_client.text().strip() == client_id:
                url_item = self.tm_pages_table.item(row, 8)
                if url_item:
                    full_url = (url_item.toolTip() or url_item.text() or "").strip()
                    if full_url and full_url != "-":
                        client_info["page_url"] = full_url
        session = self._ensure_current_session()
        if self._bind_page_to_session(session, client_info):
            self._set_tm_action_hint(f"已绑定页面 {client_id} 到当前对话。")
    def _on_unbind_current_page(self):
        session = self._current_session()
        if session is None:
            self._add_system_message("当前没有选中的对话。")
            return
        session.remote_chatgpt = default_remote_chatgpt()
        self._save_sessions_to_disk()
        self._update_bound_page_display()
        self._apply_chat_bind_visual_state()
        self._render_tampermonkey_clients(self._last_bridge_status)
        self._add_system_message("已解除本对话的 ChatGPT 页面绑定。")
        self._set_tm_action_hint("已解除绑定。")
    def _open_url_in_browser(self, url, label=""):
        target = (url or "").strip()
        if not target or target == "-":
            return False
        qurl = QUrl(target)
        if not qurl.isValid():
            self._add_system_message(f"页面地址无效：{target}")
            return False
        if QDesktopServices.openUrl(qurl):
            self._append_log(f"[打开浏览器] {label or target}")
            return True
        try:
            if webbrowser.open(target):
                self._append_log(f"[打开浏览器] {label or target}")
                return True
        except Exception as error:
            detail = f"打开页面失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"打开页面失败：{error}")
            return False
        return False
    def _open_tampermonkey_page(self, url=None):
        target = (url or self._tampermonkey_page_url or "").strip()
        if not target or target == "-":
            self._add_system_message("当前没有可打开的 ChatGPT 页面地址。")
            return
        if self._open_url_in_browser(target, target):
            return
        self._add_system_message(f"无法打开页面：{target}")
    def _chatgpt_url_from_remote(self, remote):
        remote = normalize_remote_chatgpt(remote)
        url = (remote.get("conversation_url") or "").strip()
        if url and self._is_bindable_chatgpt_url(url):
            return url
        conversation_id = (remote.get("conversation_id") or "").strip()
        if conversation_id:
            return f"https://chatgpt.com/c/{conversation_id}"
        return ""
    def _session_openable_chatgpt_url(self, session):
        if session is None:
            return ""
        return self._chatgpt_url_from_remote(session.remote_chatgpt)
    def _live_openable_chatgpt_url(self):
        status = self._last_bridge_status or {}
        if not status.get("tampermonkey_online"):
            return ""
        url = (status.get("tampermonkey_page_url") or "").strip()
        if self._is_bindable_chatgpt_url(url):
            return url
        return ""
    def _session_bound_conversation_url(self, session):
        if session is None:
            return ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return ""
        return self._chatgpt_url_from_remote(remote)
    def _bound_conversation_url(self):
        return self._session_bound_conversation_url(self._current_session())
    def _remember_session_page_from_client(self, session, client_id):
        if session is None:
            return
        client_id = (client_id or "").strip()
        if not client_id:
            return
        client_info = self._client_info_from_status(client_id)
        if not client_info:
            return
        page_url = (client_info.get("page_url") or "").strip()
        if not self._is_bindable_chatgpt_url(page_url):
            return
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bound_client = (remote.get("client_id") or "").strip()
        if remote.get("enabled") and bound_client and bound_client != client_id:
            bound_conv = (remote.get("conversation_id") or "").strip()
            if not bound_conv:
                bound_conv = parse_conversation_id(
                    remote.get("conversation_url") or ""
                )
            new_conv = self._client_conversation_id(client_info)
            if not (bound_conv and new_conv and bound_conv == new_conv):
                return
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(page_url)
        page_type = (client_info.get("page_type") or "").strip()
        if conversation_id or page_type == "conversation":
            session.remote_chatgpt = {
                **remote,
                "enabled": True,
                "bind_state": BIND_STATE_BOUND_CONVERSATION,
                "conversation_id": conversation_id,
                "conversation_url": page_url,
                "url": page_url,
                "client_id": client_id,
                "page_instance_id": (client_info.get("page_instance_id") or "").strip(),
                "page_type": "conversation",
                "page_title": (client_info.get("page_title") or "").strip(),
                "last_seen": time.time(),
                "bootstrap_in_progress": False,
            }
        else:
            session.remote_chatgpt = {
                **remote,
                "enabled": bool(remote.get("enabled")),
                "last_seen": time.time(),
            }
        self._save_sessions_to_disk()
    def _open_bound_page_for_session(self, session, label="", fallback_live=False):
        url = self._session_openable_chatgpt_url(session)
        if not url and fallback_live:
            url = self._live_openable_chatgpt_url()
            if url and session is not None:
                cid = (self._last_bridge_status.get("tampermonkey_client_id") or "").strip()
                if cid:
                    self._remember_session_page_from_client(session, cid)
        if not url:
            self._add_system_message(
                "该对话尚无已知的 ChatGPT 页面。请先发送一条消息，或点击「绑定当前」。"
            )
            return False
        return self._open_page_once(url, label or "打开 ChatGPT 页面")
    def _push_open_url(self, url, active=True, label=""):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return None
        target = (url or "").strip()
        if not target:
            self._add_system_message("URL 为空，无法下发打开命令。")
            return None
        status = server.get_bridge_status()
        if not status.get("tampermonkey_online"):
            self._append_log(
                "[打开网页] 警告：油猴当前离线，命令已入队，需有已加载脚本的 ChatGPT 标签页在线后才会执行。"
            )
        try:
            msg = server.push_open_url(target, active=active)
        except Exception as error:
            detail = f"open_url 入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"打开网页命令入队失败：{error}")
            return None
        short_id = (msg.get("id") or "")[:8]
        desc = label or target
        self._append_log(f"[打开网页] 已下发 ({short_id}…) {desc}")
        return msg
    def _on_open_chatgpt_home(self):
        self._mark_auto_bind_waiting()
        label = "ChatGPT 首页"
        if self._open_url_in_browser(CHATGPT_HOME_URL, label):
            self._set_settings_hint("已在默认浏览器中打开 ChatGPT 首页。")
            self._append_log("[打开网页] 已通过系统浏览器打开 ChatGPT 首页。")
            return
        if server.is_server_running():
            msg = self._push_open_url(CHATGPT_HOME_URL, active=True, label=label)
            if msg is not None:
                self._set_settings_hint("系统浏览器打开失败，已通过油猴尝试打开 ChatGPT。")
                return
        self._add_system_message(
            "无法打开 ChatGPT。请检查默认浏览器，或确认服务和油猴在线。"
        )
    def _on_open_new_chatgpt_tab(self):
        self._mark_auto_bind_waiting()
        label = "新 ChatGPT 标签页"
        if self._open_url_in_browser(CHATGPT_HOME_URL, label):
            self._set_settings_hint("已在默认浏览器中打开新的 ChatGPT 页面。")
            self._append_log("[打开网页] 已通过系统浏览器打开新的 ChatGPT 页面。")
            return
        if server.is_server_running():
            msg = self._push_open_url(CHATGPT_HOME_URL, active=True, label=label)
            if msg is not None:
                self._set_settings_hint("系统浏览器打开失败，已通过油猴尝试打开新页面。")
                return
        self._add_system_message(
            "无法打开新 ChatGPT 页面。请检查默认浏览器，或确认服务和油猴在线。"
        )
    def _on_open_bound_chatgpt_page(self, _url=None):
        self._mark_auto_bind_waiting()
        session = self._current_session()
        if session is None:
            self._add_system_message("当前没有选中的对话。")
            return
        self._open_bound_page_for_session(
            session, label="当前对话 ChatGPT 页面", fallback_live=True
        )

    def _flash_bound_chatgpt_page(self):
        session = self._current_session()
        if not session:
            self._append_log(
                "[BIND][FLASH] 当前没有选中的 GUI 对话", echo=True
            )
            self._add_system_message("当前没有选中的 GUI 对话。")
            return

        if not server.is_server_running():
            self._append_log("[BIND][FLASH] 服务未启动", echo=True)
            self._add_system_message("请先启动服务。")
            return

        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        client_id = (remote.get("client_id") or remote.get("bound_client_id") or "").strip()
        page_instance_id = (remote.get("page_instance_id") or "").strip()
        conversation_id = (remote.get("conversation_id") or "").strip()
        page_type = (remote.get("page_type") or "").strip()
        url = (remote.get("url") or remote.get("page_url") or remote.get("conversation_url") or "").strip()

        if not client_id:
            self._append_log(
                "[BIND][FLASH] 当前 GUI 对话尚未绑定 ChatGPT 页面", echo=True
            )
            self._add_system_message("当前 GUI 对话尚未绑定 ChatGPT 页面。")
            return

        status = server.get_bridge_status()
        client_info = self._client_info_by_id(client_id, status=status)

        if not client_info or not client_info.get("online"):
            self._append_log(
                f"[BIND][FLASH] 绑定页面离线 client_id={client_id} "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
            self._add_system_message("绑定的 ChatGPT 页面当前离线，无法闪烁定位。")
            return

        conv_short = conversation_id
        if len(conv_short) > 16:
            conv_short = conv_short[:16] + "…"
        overlay_message = (
            "当前页面已绑定到 GUI 对话\n"
            f"client={client_id}\n"
            f"conversation={conv_short or '-'}"
        )

        ok = server.enqueue_control_command(
            command="flash_page",
            target_client_id=client_id,
            target_page_instance_id=page_instance_id,
            target_conversation_id=conversation_id,
            payload={
                "title": "GUI 已定位此 ChatGPT 页面",
                "message": overlay_message,
                "duration_ms": 3500,
                "blink_count": 6,
                "page_type": page_type,
                "url": url,
                "client_id": client_id,
                "conversation_id": conversation_id,
            },
        )

        if ok:
            self._append_log(
                f"[BIND][FLASH] 已发送闪烁命令 "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
            self._add_system_message("已向绑定的 ChatGPT 页面发送闪烁定位命令。")
        else:
            self._append_log(
                f"[BIND][FLASH][ERROR] 闪烁命令发送失败 client_id={client_id}",
                echo=True,
            )
            self._add_system_message("闪烁定位命令发送失败，请查看日志。")
    def _session_bound_client_id(self):
        session = self._current_session()
        if not session:
            return ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return ""
        return (remote.get("client_id") or "").strip()
    def _render_tampermonkey_clients(self, status=None):
        status = status or {}
        clients = status.get("tampermonkey_clients") or []
        session_bound_id = self._session_bound_client_id()
        self.tm_pages_table.setRowCount(0)
        for item in clients:
            row = self.tm_pages_table.rowCount()
            self.tm_pages_table.insertRow(row)
            client_id = item.get("client_id") or "-"
            full_url = item.get("page_url") or ""
            display_url = item.get("pathname") or self._short_page_display(full_url) or "-"
            if len(display_url) > 80:
                display_url = display_url[:80] + "..."
            page_instance_id = item.get("page_instance_id") or "-"
            if len(page_instance_id) > 24:
                page_instance_id = page_instance_id[:24] + "…"
            page_type = item.get("page_type") or "-"
            conversation_id = item.get("conversation_id") or "-"
            if len(conversation_id) > 16:
                conversation_id = conversation_id[:16] + "…"
            visibility = item.get("visibility_state") or "-"
            has_focus = "是" if item.get("has_focus") else "否"
            last_focus = self._format_last_seen_ago(item.get("last_focus_at"))
            last_seen = self._format_ts(item.get("last_seen"))
            online_text = "在线" if item.get("online") else "离线"
            is_bound = "是" if session_bound_id and client_id == session_bound_id else "否"
            online_item = QTableWidgetItem(online_text)
            if item.get("online"):
                online_item.setForeground(Qt.darkGreen)
            else:
                online_item.setForeground(Qt.gray)
            self.tm_pages_table.setItem(row, 0, online_item)
            self.tm_pages_table.setItem(row, 1, QTableWidgetItem(client_id))
            self.tm_pages_table.setItem(row, 2, QTableWidgetItem(page_instance_id))
            self.tm_pages_table.setItem(row, 3, QTableWidgetItem(page_type))
            self.tm_pages_table.setItem(row, 4, QTableWidgetItem(conversation_id))
            self.tm_pages_table.setItem(row, 5, QTableWidgetItem(visibility))
            focus_text = f"{has_focus}/{last_focus}"
            self.tm_pages_table.setItem(row, 6, QTableWidgetItem(focus_text))
            self.tm_pages_table.setItem(row, 7, QTableWidgetItem(last_seen))
            url_item = QTableWidgetItem(display_url)
            url_item.setToolTip(full_url)
            self.tm_pages_table.setItem(row, 8, url_item)
            bound_item = QTableWidgetItem(is_bound)
            if is_bound == "是":
                bound_item.setForeground(Qt.darkGreen)
            self.tm_pages_table.setItem(row, 9, bound_item)
    def _on_refresh_tm_pages(self):
        if not server.is_server_running():
            self._set_tm_action_hint("请先启动服务。")
            return
        status = server.get_bridge_status()
        self._apply_bridge_status(status)
        count = len(status.get("tampermonkey_clients") or [])
        self._set_tm_action_hint(f"已刷新，共 {count} 个页面。")
    def _on_reload_bound_tm_page(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            self._append_log("[刷新网页] 服务未启动，无法刷新绑定页面。")
            return
        client_id = self._session_bound_client_id()
        if not client_id:
            self._add_system_message(
                "当前对话未绑定在线 ChatGPT 页面，无法刷新绑定网页。"
            )
            self._append_log("[刷新网页] 当前对话未绑定 client_id。")
            return
        try:
            msg = server.push_reload_page(client_id)
        except Exception as error:
            detail = f"reload_self 入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"刷新绑定网页失败：{error}")
            return
        short_id = (msg.get("id") or "")[:8]
        self._append_log(
            f"[刷新网页] 已向绑定页面下发 reload_self ({short_id}…) "
            f"client_id={client_id}"
        )
        self._set_settings_hint(f"已向绑定页面 {client_id} 下发刷新命令。")
    def _enqueue_close_page(self, client_id, label=""):
        if not server.is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            return None
        client_id = (client_id or "").strip()
        if not client_id:
            self._append_log("[关闭页面] 未指定 client_id。")
            return None
        try:
            msg = server.push_close_page(client_id)
        except Exception as error:
            detail = f"close_self 入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            return None
        short_id = (msg.get("id") or "")[:8]
        desc = label or client_id
        self._append_log(f"[关闭页面] 已下发 close_self ({short_id}…) {desc}")
        return msg
    def _on_close_selected_tm_page(self):
        client_id = self._selected_tm_page_client_id()
        if not client_id:
            self._set_tm_action_hint(
                "请先在页面下拉框或设置页表格中选择要关闭的页面。"
            )
            self._append_log("[关闭页面] 未选中页面，已取消。")
            return
        self._enqueue_close_page(client_id, label=f"选中页面 {client_id}")
        self._set_tm_action_hint(f"已向 {client_id} 下发关闭命令。")
    def _on_close_other_tm_pages(self):
        if not server.is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            self._set_tm_action_hint("请先启动服务。")
            return
        except_id = self._session_bound_client_id()
        if not except_id:
            self._set_tm_action_hint("当前对话未绑定页面，无法关闭其他页面。")
            self._append_log("[关闭页面] 当前对话未绑定 client_id，已取消。")
            return
        try:
            msgs = server.push_close_other_pages(except_id)
        except Exception as error:
            detail = f"批量关闭页面失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._set_tm_action_hint(f"关闭其他页面失败：{error}")
            return
        self._append_log(
            f"[关闭页面] 已关闭其他页面，保留绑定 {except_id}，共下发 {len(msgs)} 条命令。"
        )
        self._set_tm_action_hint(
            f"已向除 {except_id} 外的 {len(msgs)} 个在线页面下发关闭命令。"
        )
    def _on_close_bound_tm_page(self):
        if not server.is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            self._set_tm_action_hint("请先启动服务。")
            return
        client_id = self._session_bound_client_id()
        if not client_id:
            self._set_tm_action_hint("当前对话未绑定在线 ChatGPT 页面。")
            self._append_log("[关闭页面] 当前对话未绑定 client_id，已取消。")
            return
        self._enqueue_close_page(client_id, label=f"绑定页面 {client_id}")
        self._set_tm_action_hint(f"已向绑定页面 {client_id} 下发关闭命令。")
