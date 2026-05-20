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


class UiBuilderMixin:
    def _create_tm_ghost_button(self, text, handler, *, danger=False, tooltip=""):
        btn = QPushButton(text)
        btn.setObjectName("DangerGhostButton" if danger else "GhostButton")
        if tooltip:
            btn.setToolTip(tooltip)
        btn.clicked.connect(handler)
        return btn
    def _ensure_tm_action_buttons(self):
        if getattr(self, "_tm_action_buttons_ready", False):
            return
        self._tm_action_buttons_ready = True
        self.open_chatgpt_btn = self._create_tm_ghost_button(
            "打开 ChatGPT",
            self._on_open_chatgpt_home,
            tooltip="打开 ChatGPT 首页",
        )
        self.open_new_chat_btn = self._create_tm_ghost_button(
            "打开新对话",
            self._on_open_new_chatgpt_tab,
            tooltip="打开新的 ChatGPT 页面",
        )
        self.refresh_status_btn = self._create_tm_ghost_button(
            "刷新状态",
            self._on_refresh_tm_pages,
            tooltip="刷新 GUI 中的油猴页面列表和连接状态（不刷新浏览器页面）",
        )
        self.reload_bound_page_btn = self._create_tm_ghost_button(
            "刷新绑定网页",
            self._on_reload_bound_tm_page,
            tooltip="刷新当前对话绑定的 ChatGPT 页面",
        )
        self.bind_current_page_btn = self._create_tm_ghost_button(
            "绑定当前页面",
            self._on_bind_current_page,
            tooltip="将油猴最近活跃页面绑定到当前对话",
        )
        self.bind_selected_page_btn = self._create_tm_ghost_button(
            "绑定选中页面",
            self._on_bind_selected_tm_page,
            tooltip="绑定下拉框或设置页表格中选中的页面",
        )
        self.unbind_page_btn = self._create_tm_ghost_button(
            "解除绑定",
            self._on_unbind_current_page,
            tooltip="解除当前对话的 ChatGPT 页面绑定",
        )
        self.chat_open_bound_btn = self._create_tm_ghost_button(
            "打开绑定页面",
            self._on_open_bound_chatgpt_page,
            tooltip="打开当前对话绑定的 ChatGPT 页面",
        )
        self.flash_bound_page_btn = self._create_tm_ghost_button(
            "闪烁绑定页",
            self._flash_bound_chatgpt_page,
            tooltip="在绑定的 ChatGPT 页面上闪烁提示，便于定位对应网页",
        )
        self.flash_bound_page_btn.setObjectName("flash_bound_page_btn")
        self.close_bound_page_btn = self._create_tm_ghost_button(
            "关闭绑定页面",
            self._on_close_bound_tm_page,
            danger=True,
            tooltip="关闭当前对话绑定的 ChatGPT 页面",
        )
        self.close_other_pages_btn = self._create_tm_ghost_button(
            "关闭其他 ChatGPT 页面",
            self._on_close_other_tm_pages,
            danger=True,
            tooltip="关闭除当前绑定页面以外的其他 ChatGPT 页面",
        )
    def _build_tm_action_buttons(
        self, layout, *, include_page_selector=False, include_view_logs=False
    ):
        self._ensure_tm_action_buttons()
        layout.setSpacing(6)
        row1 = QHBoxLayout()
        row1.setSpacing(6)
        for btn in (
            self.open_chatgpt_btn,
            self.open_new_chat_btn,
            self.refresh_status_btn,
            self.reload_bound_page_btn,
        ):
            row1.addWidget(btn)
        if include_view_logs:
            row1.addStretch()
            if not hasattr(self, "view_logs_btn"):
                self.view_logs_btn = QPushButton("日志")
                self.view_logs_btn.setObjectName("GhostButton")
                self.view_logs_btn.setToolTip("切换到日志页")
                self.view_logs_btn.clicked.connect(self._show_log_tab)
            row1.addWidget(self.view_logs_btn)
        layout.addLayout(row1)
        if include_page_selector:
            row2 = QHBoxLayout()
            row2.setSpacing(6)
            if not hasattr(self, "tm_page_combo"):
                self.tm_page_combo = QComboBox()
                self.tm_page_combo.setMinimumWidth(180)
                self.tm_page_combo.setSizePolicy(
                    QSizePolicy.Expanding, QSizePolicy.Fixed
                )
                self.tm_page_combo.setToolTip(
                    "选择要绑定的在线 ChatGPT 页面（用于「绑定选中页面」）"
                )
            page_label = QLabel("页面")
            page_label.setObjectName("StatusChip")
            row2.addWidget(page_label)
            if not hasattr(self, "tm_page_count_label"):
                self.tm_page_count_label = QLabel("在线 0 / 总 0")
                self.tm_page_count_label.setObjectName("StatusChip")
            row2.addWidget(self.tm_page_count_label)
            row2.addWidget(self.tm_page_combo, stretch=1)
            for btn in (
                self.bind_current_page_btn,
                self.bind_selected_page_btn,
                self.unbind_page_btn,
                self.chat_open_bound_btn,
                self.flash_bound_page_btn,
                self.close_bound_page_btn,
                self.close_other_pages_btn,
            ):
                row2.addWidget(btn)
            layout.addLayout(row2)
    def _build_tm_debug_action_buttons(self, layout):
        specs = [
            ("打开 ChatGPT", self._on_open_chatgpt_home, False, "打开 ChatGPT 首页"),
            ("打开新对话", self._on_open_new_chatgpt_tab, False, "打开新 ChatGPT 标签页"),
            (
                "打开绑定页面",
                self._on_open_bound_chatgpt_page,
                False,
                "打开当前对话绑定的页面",
            ),
            (
                "闪烁绑定页",
                self._flash_bound_chatgpt_page,
                False,
                "在绑定的 ChatGPT 页面上闪烁提示",
            ),
            ("绑定当前页面", self._on_bind_current_page, False, ""),
            ("绑定选中页面", self._on_bind_selected_tm_page, False, ""),
            ("解除绑定", self._on_unbind_current_page, False, ""),
            ("关闭选中页面", self._on_close_selected_tm_page, True, ""),
            ("关闭其他 ChatGPT 页面", self._on_close_other_tm_pages, True, ""),
            ("关闭当前绑定页面", self._on_close_bound_tm_page, True, ""),
        ]
        layout.setSpacing(6)
        for text, handler, danger, tooltip in specs:
            layout.addWidget(
                self._create_tm_ghost_button(
                    text, handler, danger=danger, tooltip=tooltip
                )
            )
    def _tm_page_combo_label(self, item):
        client_id = (item.get("client_id") or "").strip() or "-"
        page_type = (item.get("page_type") or "").strip() or "-"
        online_tag = "[在线]" if item.get("online") else "[离线]"
        conv = self._short_conv_id(self._client_conversation_id(item))
        visibility = (
            item.get("visibility_state") or item.get("visible") or "-"
        ).strip()
        focus = "yes" if item.get("has_focus") else "no"
        last_focus_ago = self._format_last_seen_ago(item.get("last_focus_at"))
        heartbeat_ago = self._format_last_seen_ago(item.get("last_seen"))
        return (
            f"{online_tag} {page_type} | {client_id} | conv={conv} | "
            f"{visibility} | focus={focus} | 最近焦点={last_focus_ago} | "
            f"心跳={heartbeat_ago}"
        )
    def _tm_page_combo_sort_key(self, item):
        online_rank = 1 if item.get("online") else 0
        page_type = (item.get("page_type") or "").strip()
        conv_rank = 1 if page_type == "conversation" else 0
        last_seen = float(item.get("last_seen") or 0)
        return (online_rank, conv_rank, last_seen)

    def _tm_page_selector_signature(self, clients):
        rows = []
        for item in clients:
            rows.append((
                item.get("client_id") or "",
                item.get("page_instance_id") or "",
                item.get("page_type") or "",
                item.get("conversation_id") or "",
                item.get("online"),
                item.get("visible") or item.get("visibility_state") or "",
                item.get("has_focus"),
                int(float(item.get("last_seen") or 0)),
            ))
        return tuple(rows)

    def _refresh_tm_page_selector(self, summary=None):
        if not hasattr(self, "tm_page_combo"):
            return
        summary = summary or self._tm_summary_for_session()
        clients = list(self._last_bridge_status.get("tampermonkey_clients") or [])
        clients.sort(key=self._tm_page_combo_sort_key, reverse=True)
        if hasattr(self, "tm_page_count_label"):
            self.tm_page_count_label.setText(
                f"在线 {summary.get('online_clients', 0)} / 总 {summary.get('total_clients', 0)}"
            )
        signature = self._tm_page_selector_signature(clients)
        if getattr(self, "_last_tm_page_selector_signature", None) == signature:
            return
        self._last_tm_page_selector_signature = signature
        keep_id = ""
        if self.tm_page_combo.currentIndex() >= 0:
            keep_id = (self.tm_page_combo.currentData(Qt.UserRole) or "").strip()
        session_bound = self._session_bound_client_id()
        self.tm_page_combo.blockSignals(True)
        self.tm_page_combo.clear()
        for item in clients:
            client_id = (item.get("client_id") or "").strip()
            if not client_id:
                continue
            label = self._tm_page_combo_label(item)
            self.tm_page_combo.addItem(label, client_id)
        select_id = ""
        for candidate in (keep_id, session_bound):
            if not candidate:
                continue
            if self.tm_page_combo.findData(candidate, Qt.UserRole) >= 0:
                select_id = candidate
                break
        if select_id:
            idx = self.tm_page_combo.findData(select_id, Qt.UserRole)
            self.tm_page_combo.setCurrentIndex(idx)
        elif self.tm_page_combo.count() > 0:
            self.tm_page_combo.setCurrentIndex(0)
        self.tm_page_combo.blockSignals(False)
    def _selected_tm_page_client_id(self):
        if hasattr(self, "tm_page_combo") and self.tm_page_combo.count() > 0:
            client_id = self.tm_page_combo.currentData(Qt.UserRole)
            if client_id:
                return str(client_id).strip()
        return self._selected_tm_client_id_from_table()
    def _selected_tm_client_id_from_table(self):
        if not hasattr(self, "tm_pages_table"):
            return ""
        row = self.tm_pages_table.currentRow()
        if row < 0:
            return ""
        item = self.tm_pages_table.item(row, 1)
        return (item.text() if item else "").strip()
    def _update_input_placeholder(self):
        if self._enter_send_mode == "ctrl_enter_send":
            self.message_edit.setPlaceholderText("输入消息…")
        else:
            self.message_edit.setPlaceholderText("输入消息…")
        self._update_input_hint_label()
    def _update_input_hint_label(self):
        if not hasattr(self, "input_hint_label"):
            return
        if self._enter_send_mode == "ctrl_enter_send":
            self.input_hint_label.setText("Ctrl + Enter 发送，Shift + Enter 换行")
        else:
            self.input_hint_label.setText("Enter 发送，Shift + Enter 换行")
    def _update_tampermonkey_settings_labels(self, status=None):
        status = status or self._last_bridge_status or {}
        host = self._host or self.host_edit.text().strip()
        port = self._port_text or self.port_edit.text().strip()
        self.tm_bridge_url_label.setText(f"油猴接口：http://{host}:{port}/api/bridge")
        global_bound = status.get("bound_client_id") or "-"
        session_bound = self._session_bound_client_id() or "-"
        session = self._current_session()
        bind_detail = self._binding_status_details(session)
        self.tm_client_id_label.setText(
            f"最近心跳 client_id：{status.get('tampermonkey_client_id') or '-'}\n"
            f"全局绑定 client_id：{global_bound}\n"
            f"本对话绑定 client_id：{session_bound}\n"
            f"当前在线 client_id：{bind_detail['online_client_id']}\n"
            f"当前在线 conversation_id：{bind_detail['online_conversation_id']}\n"
            f"本对话绑定 conversation_id：{bind_detail['bound_conversation_id']}\n"
            f"绑定一致性：{bind_detail['match']}"
        )
        self.tm_last_seen_settings_label.setText(
            f"最后心跳：{self._format_ts(status.get('tampermonkey_last_seen'))}"
        )
        live = (
            status.get("tampermonkey_page_url")
            if status.get("tampermonkey_online")
            else "-"
        )
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if remote.get("enabled"):
            bound_parts = [
                remote.get("conversation_url") or "-",
                f"client_id={remote.get('client_id') or '-'}",
                f"type={remote.get('page_type') or '-'}",
                f"conv={remote.get('conversation_id') or '-'}",
            ]
            bound = " | ".join(bound_parts)
        else:
            bound = "未绑定"
        self.tm_page_settings_label.setText(
            f"最近活跃油猴页面：{live}\n"
            f"本对话绑定页面：{bound}\n"
            f"在线/绑定 client：{bind_detail['online_client_id']} / "
            f"{bind_detail['bound_client_id']} | "
            f"conv：{bind_detail['online_conversation_id']} / "
            f"{bind_detail['bound_conversation_id']} | {bind_detail['match']}"
        )
    def _on_tm_table_selection_changed(self):
        client_id = self._selected_tm_client_id_from_table()
        if not client_id or not hasattr(self, "tm_page_combo"):
            return
        idx = self.tm_page_combo.findData(client_id, Qt.UserRole)
        if idx >= 0:
            self.tm_page_combo.setCurrentIndex(idx)
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)
        self.main_tabs = QTabWidget()
        self.chat_page = self._build_chat_page()
        self.log_page = self._build_log_page()
        self.settings_page = self._build_settings_page()
        self.main_tabs.addTab(self.chat_page, "聊天")
        self.main_tabs.addTab(self.log_page, "日志")
        self.main_tabs.addTab(self.settings_page, "设置")
        root.addWidget(self.main_tabs, stretch=1)
        self.statusBar().showMessage("未启动服务")
        self._apply_app_style()
    def _apply_app_style(self):
        self.setStyleSheet(
            """
            QMainWindow {
                background: #f0f2f5;
            }
            QTabWidget::pane {
                border: 1px solid #e0e3e8;
                border-radius: 8px;
                background: #ffffff;
                top: -1px;
            }
            QTabBar::tab {
                background: #e8eaed;
                color: #444;
                padding: 8px 18px;
                margin-right: 2px;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                min-height: 20px;
            }
            QTabBar::tab:selected {
                background: #ffffff;
                color: #111;
                font-weight: 600;
            }
            QTabBar::tab:hover:!selected {
                background: #dfe3e8;
            }
            QPushButton {
                background: #ffffff;
                color: #333;
                border: 1px solid #d0d5dd;
                border-radius: 6px;
                padding: 5px 12px;
                min-height: 22px;
            }
            QPushButton:hover {
                background: #f5f6f8;
            }
            QPushButton:pressed {
                background: #ebedf0;
            }
            QPushButton:disabled {
                color: #aaa;
                background: #f5f5f5;
            }
            QPushButton#PrimaryButton {
                background: #2563eb;
                color: #ffffff;
                border: 1px solid #1d4ed8;
                font-weight: 600;
            }
            QPushButton#PrimaryButton:hover {
                background: #1d4ed8;
            }
            QPushButton#PrimaryButton:pressed {
                background: #1e40af;
            }
            QPushButton#PrimaryButton:disabled {
                background: #93b4f5;
                border-color: #93b4f5;
                color: #eef2ff;
            }
            QPushButton#GhostButton {
                background: transparent;
                border: 1px solid #d8dce3;
                color: #555;
                padding: 4px 10px;
            }
            QPushButton#GhostButton:hover {
                background: #f3f4f6;
            }
            QPushButton#DangerGhostButton {
                background: transparent;
                border: 1px solid #f0c4c4;
                color: #b42318;
                padding: 4px 10px;
            }
            QPushButton#DangerGhostButton:hover {
                background: #fef3f2;
            }
            QPushButton#NewSessionButton {
                background: #ffffff;
                border: 1px solid #d5d9e0;
                border-radius: 8px;
                font-weight: 600;
                padding: 8px 12px;
            }
            QPushButton#NewSessionButton:hover {
                background: #f3f4f6;
            }
            QPushButton#CompactButton {
                padding: 3px 10px;
                min-height: 20px;
                font-size: 12px;
            }
            QLabel#StatusChip {
                background: #eef0f3;
                border: 1px solid #e2e5ea;
                border-radius: 8px;
                padding: 4px 10px;
                color: #444;
                font-size: 12px;
            }
            QLabel#StatusChip[state="ok"] {
                background: #e8f5e9;
                border-color: #c8e6c9;
                color: #1b5e20;
            }
            QLabel#StatusChip[state="warn"] {
                background: #fff8e1;
                border-color: #ffe082;
                color: #8d6e00;
            }
            QLabel#StatusChip[state="error"] {
                background: #ffebee;
                border-color: #ef9a9a;
                color: #b71c1c;
            }
            QLabel#TmBindMismatchHint {
                color: #b71c1c;
                font-size: 12px;
                padding: 2px 6px;
            }
            QWidget#ChatStatusBar {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
            }
            QWidget#ChatPanel {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QWidget#ChatPanel[bindState="bound_online"] {
                background: #f3fbf5;
                border: 1px solid #b7e4c7;
            }
            QWidget#ChatPanel[bindState="bound_offline"] {
                background: #fffaf0;
                border: 1px solid #f3d08a;
            }
            QWidget#ChatPanel[bindState="unbound_optional"] {
                background: #ffffff;
                border: 1px solid #e5e7eb;
            }
            QWidget#ChatPanel[bindState="unbound_required"] {
                background: #fff5f5;
                border: 1px solid #f3b3b3;
            }
            QWidget#ChatPanel[bindState="pending_bind"] {
                background: #fffbeb;
                border: 1px solid #f0d060;
            }
            QWidget#ChatPanel[bindState="prebound_home"] {
                background: #f3fbf5;
                border: 1px solid #b7e4c7;
            }
            QWidget#SessionSidebar {
                background: #f3f4f6;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QLabel#CurrentSessionTitle {
                color: #111827;
                font-size: 15px;
                font-weight: 600;
                padding: 2px 4px 8px 4px;
            }
            QListWidget#SessionList {
                background: transparent;
                border: none;
                outline: none;
                padding: 4px;
            }
            QListWidget#SessionList::item {
                border: none;
                padding: 0px;
                margin: 2px 0;
                background: transparent;
            }
            QListWidget#SessionList::item:selected {
                background: transparent;
                border: none;
            }
            QWidget#SessionListItem {
                border-radius: 8px;
                border: 1px solid #e5e7eb;
                border-left: 4px solid #9ca3af;
                background: #ffffff;
            }
            QWidget#SessionListItem[bindState="bound_online"] {
                background: #eefaf1;
                border: 1px solid #b7e4c7;
                border-left: 4px solid #22c55e;
            }
            QWidget#SessionListItem[bindState="bound_offline"] {
                background: #fff1f2;
                border: 1px solid #fecdd3;
                border-left: 4px solid #ef4444;
            }
            QWidget#SessionListItem[bindState="prebound_home"] {
                background: #eff6ff;
                border: 1px solid #bfdbfe;
                border-left: 4px solid #3b82f6;
            }
            QWidget#SessionListItem[bindState="waiting_home"],
            QWidget#SessionListItem[bindState="waiting_conversation_created"] {
                background: #fffbeb;
                border: 1px solid #fde68a;
                border-left: 4px solid #f59e0b;
            }
            QWidget#SessionListItem[bindState="unbound"] {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-left: 4px solid #9ca3af;
            }
            QWidget#SessionListItem[bindState="bind_mismatch"] {
                background: #fef2f2;
                border: 1px solid #ef4444;
                border-left: 4px solid #dc2626;
            }
            QWidget#SessionListItem[selected="true"][bindState="bound_online"] {
                border: 2px solid #16a34a;
            }
            QWidget#SessionListItem[selected="true"][bindState="bound_offline"] {
                border: 2px solid #dc2626;
            }
            QWidget#SessionListItem[selected="true"][bindState="prebound_home"] {
                border: 2px solid #2563eb;
            }
            QWidget#SessionListItem[selected="true"][bindState="waiting_home"],
            QWidget#SessionListItem[selected="true"][bindState="waiting_conversation_created"] {
                border: 2px solid #d97706;
            }
            QWidget#SessionListItem[selected="true"][bindState="unbound"] {
                border: 2px solid #6b7280;
            }
            QWidget#SessionListItem[selected="true"][bindState="bind_mismatch"] {
                border: 2px solid #dc2626;
            }
            QLabel#SessionItemTitle {
                color: #111827;
                font-size: 14px;
                font-weight: 600;
                background: transparent;
            }
            QLabel#SessionItemSubtitle {
                color: #6b7280;
                font-size: 12px;
                background: transparent;
            }
            QLabel#SessionBindStatusLabel {
                color: #4b5563;
                font-size: 11px;
                background: transparent;
            }
            QWidget#SessionListItem[bindState="bound_online"] QLabel#SessionBindStatusLabel {
                color: #14532d;
            }
            QWidget#SessionListItem[bindState="bound_offline"] QLabel#SessionBindStatusLabel,
            QWidget#SessionListItem[bindState="bind_mismatch"] QLabel#SessionBindStatusLabel {
                color: #7f1d1d;
            }
            QWidget#SessionListItem[bindState="prebound_home"] QLabel#SessionBindStatusLabel {
                color: #1e3a8a;
            }
            QWidget#SessionListItem[bindState="waiting_home"] QLabel#SessionBindStatusLabel,
            QWidget#SessionListItem[bindState="waiting_conversation_created"] QLabel#SessionBindStatusLabel {
                color: #78350f;
            }
            QLabel#SessionPendingDot {
                color: #3b82f6;
                font-size: 10px;
                background: transparent;
            }
            QLabel#SessionCurrentBadge {
                color: #6b7280;
                font-size: 10px;
                font-weight: 600;
                background: transparent;
                padding-top: 2px;
            }
            QLineEdit#SessionSearchInput {
                background: #ffffff;
                border: 1px solid #d8dce3;
                border-radius: 8px;
                padding: 6px 10px;
            }
            QScrollArea#ChatScrollArea {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QScrollArea#ChatScrollArea[bindState="bound_online"] {
                background: #f6fff8;
                border: 1px solid #c8ead2;
            }
            QScrollArea#ChatScrollArea[bindState="bound_offline"] {
                background: #fffaf0;
                border: 1px solid #f3d08a;
            }
            QScrollArea#ChatScrollArea[bindState="unbound_optional"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QScrollArea#ChatScrollArea[bindState="unbound_required"] {
                background: #fff7f7;
                border: 1px solid #f3b3b3;
            }
            QScrollArea#ChatScrollArea[bindState="pending_bind"] {
                background: #fffbeb;
                border: 1px solid #f0d060;
            }
            QScrollArea#ChatScrollArea[bindState="prebound_home"] {
                background: #f6fff8;
                border: 1px solid #c8ead2;
            }
            QWidget#ChatViewport {
                background: #f7f8fa;
            }
            QWidget#ChatViewport[bindState="bound_online"] {
                background: #f6fff8;
            }
            QWidget#ChatViewport[bindState="bound_offline"] {
                background: #fffaf0;
            }
            QWidget#ChatViewport[bindState="unbound_optional"] {
                background: #f7f8fa;
            }
            QWidget#ChatViewport[bindState="unbound_required"] {
                background: #fff7f7;
            }
            QWidget#ChatViewport[bindState="pending_bind"] {
                background: #fffbeb;
            }
            QWidget#ChatViewport[bindState="prebound_home"] {
                background: #f6fff8;
            }
            QLabel#EmptyTitle {
                color: #6b7280;
                font-size: 16px;
                font-weight: 600;
            }
            QLabel#EmptySubtitle {
                color: #9ca3af;
                font-size: 13px;
            }
            QFrame#SystemBubble {
                background: #eef0f3;
                border: none;
                border-radius: 8px;
            }
            QLabel#SystemBubbleBody {
                color: #666;
                font-size: 12px;
                background: transparent;
            }
            QFrame#ChatBubble[bubbleRole="user"] {
                background: #dcf8c6;
                border: 1px solid #c5e8b0;
                border-radius: 12px;
            }
            QFrame#ChatBubble[bubbleRole="assistant"] {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
            }
            QFrame#ChatBubble[bubbleRole="error"] {
                background: #fef2f2;
                border: 1px solid #fecaca;
                border-radius: 10px;
            }
            QLabel#BubbleHeader {
                color: #555;
            }
            QFrame#ChatBubble[bubbleRole="user"] QLabel#BubbleHeader {
                color: #3b6b35;
            }
            QFrame#ChatBubble[bubbleRole="error"] QLabel#BubbleBody {
                color: #7f1d1d;
            }
            QLabel#BubbleBody {
                color: #111;
            }
            QWidget#ChatInputBlock {
                background: transparent;
            }
            QTextEdit#MessageInput {
                background: #ffffff;
                border: 1px solid #d5d9e0;
                border-radius: 10px;
                padding: 10px 12px;
                color: #111;
            }
            QTextEdit#MessageInput:focus {
                border: 1px solid #2563eb;
            }
            QLabel#InputHint {
                color: #9ca3af;
                font-size: 12px;
            }
            """
        )
    def _build_chat_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)
        tool_col = QVBoxLayout()
        tool_col.setSpacing(4)
        self._build_tm_action_buttons(
            tool_col, include_page_selector=True, include_view_logs=True
        )
        layout.addLayout(tool_col)
        self._chat_status_group = self._build_chat_status_bar()
        layout.addWidget(self._chat_status_group)
        self._chat_panel = self._build_chat_panel()
        layout.addWidget(self._chat_panel, stretch=1)
        return page
    def _build_log_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(0, 0, 0, 0)
        self.log_tabs = QTabWidget()
        layout.addWidget(self.log_tabs)
        self.log_edit = QTextEdit()
        self.log_edit.setReadOnly(True)
        self.log_edit.setFont(QFont("Consolas", 9))
        self.log_tabs.addTab(self.log_edit, "运行日志")
        self.event_log_edit = QTextEdit()
        self.event_log_edit.setReadOnly(True)
        self.event_log_edit.setFont(QFont("Consolas", 9))
        self.log_tabs.addTab(self.event_log_edit, "油猴事件")
        self.outbound_table = QTableWidget(0, 4)
        self.outbound_table.setHorizontalHeaderLabels(["时间", "ID", "状态", "内容"])
        self.outbound_table.horizontalHeader().setStretchLastSection(True)
        self.outbound_table.setColumnWidth(0, 80)
        self.outbound_table.setColumnWidth(1, 110)
        self.outbound_table.setColumnWidth(2, 100)
        self.outbound_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.outbound_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.outbound_table.verticalHeader().setVisible(False)
        self.log_tabs.addTab(self.outbound_table, "发出消息")
        self.status_log_edit = QTextEdit()
        self.status_log_edit.setReadOnly(True)
        self.status_log_edit.setFont(QFont("Consolas", 9))
        self.log_tabs.addTab(self.status_log_edit, "服务状态")
        return page
    def _build_settings_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)
        self.settings_tabs = QTabWidget()
        layout.addWidget(self.settings_tabs, stretch=1)
        # --- 服务设置
        service_page = QWidget()
        service_form = QFormLayout(service_page)
        self.host_edit = QLineEdit(self._host)
        self.port_edit = QLineEdit(self._port_text)
        self.port_edit.setFixedWidth(80)
        service_form.addRow("地址 host", self.host_edit)
        service_form.addRow("端口 port", self.port_edit)
        self.auto_start_server_cb = QCheckBox("启动 GUI 时自动启动服务")
        self.auto_start_server_cb.setChecked(self._auto_start_server)
        service_form.addRow("", self.auto_start_server_cb)
        service_btn_row = QHBoxLayout()
        self.settings_start_btn = QPushButton("启动服务")
        self.settings_stop_btn = QPushButton("停止服务")
        self.settings_restart_btn = QPushButton("重启服务并应用")
        self.settings_start_btn.clicked.connect(self._start_server)
        self.settings_stop_btn.clicked.connect(self._stop_server)
        self.settings_restart_btn.clicked.connect(self._restart_server_with_settings)
        service_btn_row.addWidget(self.settings_start_btn)
        service_btn_row.addWidget(self.settings_stop_btn)
        service_btn_row.addWidget(self.settings_restart_btn)
        service_btn_row.addStretch()
        service_form.addRow("操作", service_btn_row)
        self.settings_service_status_label = QLabel("当前状态：未启动")
        self.settings_service_status_label.setWordWrap(True)
        service_form.addRow("状态", self.settings_service_status_label)
        self.settings_tabs.addTab(service_page, "服务设置")
        # --- 油猴设置
        tm_page = QWidget()
        tm_form = QFormLayout(tm_page)
        self.tm_bridge_url_label = QLabel("-")
        self.tm_bridge_url_label.setWordWrap(True)
        self.tm_client_id_label = QLabel("-")
        self.tm_last_seen_settings_label = QLabel("-")
        self.tm_page_settings_label = QLabel("-")
        self.tm_page_settings_label.setWordWrap(True)
        tm_form.addRow("接口地址", self.tm_bridge_url_label)
        tm_form.addRow("client_id", self.tm_client_id_label)
        tm_form.addRow("最后心跳", self.tm_last_seen_settings_label)
        tm_form.addRow("页面 URL", self.tm_page_settings_label)
        tm_diag_row = QHBoxLayout()
        self.check_tm_btn = QPushButton("检查油猴连接")
        self.tm_refresh_pages_btn = QPushButton("刷新页面列表")
        self.check_tm_btn.clicked.connect(self._on_check_tampermonkey)
        self.tm_refresh_pages_btn.clicked.connect(self._on_refresh_tm_pages)
        tm_diag_row.addWidget(self.check_tm_btn)
        tm_diag_row.addWidget(self.tm_refresh_pages_btn)
        tm_diag_row.addStretch()
        tm_form.addRow("诊断", tm_diag_row)
        bind_group = QGroupBox("页面绑定")
        bind_layout = QVBoxLayout(bind_group)
        self.bind_each_chat_to_page_cb = QCheckBox(
            "每个对话绑定独立 ChatGPT 页面（严格模式）"
        )
        self.auto_open_bound_page_when_missing_cb = QCheckBox(
            "绑定页面不存在或离线时，发送前自动打开页面"
        )
        self.allow_fallback_to_any_page_cb = QCheckBox(
            "绑定页面离线时，允许退回任意在线页面发送"
        )
        self.auto_bind_unbound_page_cb = QCheckBox(
            "未绑定但检测到在线页面时，自动绑定到当前对话"
        )
        self.auto_open_and_bind_on_new_chat_cb = QCheckBox(
            "（已停用）新建对话时自动打开 ChatGPT 页面"
        )
        self.auto_open_and_bind_on_new_chat_cb.setEnabled(False)
        self.auto_open_and_bind_on_new_chat_cb.setToolTip(
            "首条消息发送时会自动选择空闲首页或打开新首页，新建对话不再自动打开浏览器。"
        )
        for widget in (
            self.bind_each_chat_to_page_cb,
            self.auto_open_bound_page_when_missing_cb,
            self.allow_fallback_to_any_page_cb,
            self.auto_bind_unbound_page_cb,
            self.auto_open_and_bind_on_new_chat_cb,
        ):
            bind_layout.addWidget(widget)
        tm_form.addRow("", bind_group)
        self.tm_pages_table = QTableWidget(0, 10)
        self.tm_pages_table.setHorizontalHeaderLabels(
            [
                "状态",
                "client_id",
                "page_instance_id",
                "页面类型",
                "会话ID",
                "可见",
                "焦点/最近焦点",
                "最后心跳",
                "URL",
                "本对话绑定",
            ]
        )
        self.tm_pages_table.horizontalHeader().setStretchLastSection(True)
        self.tm_pages_table.setColumnWidth(0, 40)
        self.tm_pages_table.setColumnWidth(1, 100)
        self.tm_pages_table.setColumnWidth(2, 120)
        self.tm_pages_table.setColumnWidth(3, 72)
        self.tm_pages_table.setColumnWidth(4, 100)
        self.tm_pages_table.setColumnWidth(5, 40)
        self.tm_pages_table.setColumnWidth(6, 40)
        self.tm_pages_table.setColumnWidth(7, 72)
        self.tm_pages_table.setColumnWidth(8, 200)
        self.tm_pages_table.setColumnWidth(9, 72)
        self.tm_pages_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.tm_pages_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.tm_pages_table.verticalHeader().setVisible(False)
        self.tm_pages_table.itemSelectionChanged.connect(
            self._on_tm_table_selection_changed
        )
        tm_form.addRow("ChatGPT 页面", self.tm_pages_table)
        tm_adv_group = QGroupBox("高级调试操作")
        tm_adv_group.setCheckable(True)
        tm_adv_group.setChecked(False)
        tm_adv_layout = QHBoxLayout(tm_adv_group)
        self._build_tm_debug_action_buttons(tm_adv_layout)
        tm_adv_layout.addStretch()
        tm_form.addRow("", tm_adv_group)
        self.settings_tabs.addTab(tm_page, "油猴设置")
        # --- 调试设置（日志清理；聊天/调试行为固定为 DEFAULT_APP_SETTINGS）
        debug_page = QWidget()
        debug_form = QFormLayout(debug_page)
        debug_btn_row = QHBoxLayout()
        self.clear_runtime_log_btn = QPushButton("清空运行日志")
        self.clear_event_log_btn = QPushButton("清空油猴事件")
        self.clear_runtime_log_btn.clicked.connect(self._clear_runtime_log)
        self.clear_event_log_btn.clicked.connect(
            lambda: self._clear_log_widget(self.event_log_edit, "油猴事件")
        )
        debug_btn_row.addWidget(self.clear_runtime_log_btn)
        debug_btn_row.addWidget(self.clear_event_log_btn)
        debug_form.addRow("", debug_btn_row)
        self.log_file_path_label = QLabel(f"日志文件：{get_log_file_path()}")
        self.log_file_path_label.setWordWrap(True)
        self.log_file_path_label.setStyleSheet("color: #555;")
        debug_form.addRow("", self.log_file_path_label)
        self.settings_tabs.addTab(debug_page, "调试设置")
        self._sync_settings_widgets_from_values()
        bottom_row = QHBoxLayout()
        self.apply_settings_btn = QPushButton("应用设置")
        self.save_settings_btn = QPushButton("保存设置")
        self.reset_settings_btn = QPushButton("恢复默认设置")
        self.apply_settings_btn.clicked.connect(
            lambda: self._apply_settings(immediate_only=True)
        )
        self.save_settings_btn.clicked.connect(self._on_save_settings_clicked)
        self.reset_settings_btn.clicked.connect(self._reset_settings_to_default)
        bottom_row.addWidget(self.apply_settings_btn)
        bottom_row.addWidget(self.save_settings_btn)
        bottom_row.addWidget(self.reset_settings_btn)
        bottom_row.addStretch()
        layout.addLayout(bottom_row)
        self.settings_hint_label = QLabel("")
        self.settings_hint_label.setWordWrap(True)
        self.settings_hint_label.setStyleSheet("color: #555;")
        layout.addWidget(self.settings_hint_label)
        return page
    def _build_chat_status_bar(self):
        bar = QWidget()
        bar.setObjectName("ChatStatusBar")
        outer = QVBoxLayout(bar)
        outer.setContentsMargins(10, 6, 10, 6)
        outer.setSpacing(4)
        top_row = QHBoxLayout()
        top_row.setSpacing(8)
        self.status_label = QLabel("服务：未启动")
        self.status_label.setObjectName("StatusChip")
        top_row.addWidget(self.status_label)
        self.tm_online_label = QLabel("油猴：未连接")
        self.tm_online_label.setObjectName("StatusChip")
        top_row.addWidget(self.tm_online_label)
        self.tm_queue_label = QLabel("队列：0")
        self.tm_queue_label.setObjectName("StatusChip")
        top_row.addWidget(self.tm_queue_label)
        top_row.addStretch()
        self.chat_quick_start_btn = QPushButton("启动")
        self.chat_quick_start_btn.setObjectName("CompactButton")
        self.chat_quick_start_btn.setFixedWidth(48)
        self.chat_quick_start_btn.clicked.connect(self._start_server)
        top_row.addWidget(self.chat_quick_start_btn)
        self.chat_quick_stop_btn = QPushButton("停止")
        self.chat_quick_stop_btn.setObjectName("CompactButton")
        self.chat_quick_stop_btn.setFixedWidth(48)
        self.chat_quick_stop_btn.clicked.connect(self._stop_server)
        self.chat_quick_stop_btn.setEnabled(False)
        top_row.addWidget(self.chat_quick_stop_btn)
        outer.addLayout(top_row)
        live_row = QHBoxLayout()
        live_row.setSpacing(6)
        self.tm_live_page_label = QLabel("当前油猴页面：-")
        self.tm_live_page_label.setObjectName("StatusChip")
        self.tm_live_page_label.setTextFormat(Qt.RichText)
        self.tm_live_page_label.setTextInteractionFlags(Qt.TextBrowserInteraction)
        self.tm_live_page_label.setOpenExternalLinks(False)
        self.tm_live_page_label.linkActivated.connect(self._open_tampermonkey_page)
        live_row.addWidget(self.tm_live_page_label, stretch=1)
        self.open_live_page_btn = QPushButton("打开")
        self.open_live_page_btn.setObjectName("CompactButton")
        self.open_live_page_btn.setFixedWidth(48)
        self.open_live_page_btn.setEnabled(False)
        self.open_live_page_btn.clicked.connect(lambda: self._open_tampermonkey_page())
        live_row.addWidget(self.open_live_page_btn)
        outer.addLayout(live_row)
        bound_row = QHBoxLayout()
        bound_row.setSpacing(6)
        self.tm_bound_page_label = QLabel("绑定页面：未绑定")
        self.tm_bound_page_label.setObjectName("StatusChip")
        self.tm_bound_page_label.setTextFormat(Qt.RichText)
        self.tm_bound_page_label.setTextInteractionFlags(Qt.TextBrowserInteraction)
        self.tm_bound_page_label.setOpenExternalLinks(False)
        self.tm_bound_page_label.linkActivated.connect(self._on_open_bound_chatgpt_page)
        bound_row.addWidget(self.tm_bound_page_label, stretch=1)
        outer.addLayout(bound_row)
        self.tm_bind_mismatch_label = QLabel("")
        self.tm_bind_mismatch_label.setObjectName("TmBindMismatchHint")
        self.tm_bind_mismatch_label.setWordWrap(True)
        self.tm_bind_mismatch_label.setVisible(False)
        outer.addWidget(self.tm_bind_mismatch_label)
        bar.setVisible(self._show_top_status_bar)
        for widget in (
            self.tm_live_page_label,
            self.tm_bound_page_label,
            self.open_live_page_btn,
        ):
            widget.setVisible(self._show_page_url)
        return bar
    def _build_chat_panel(self):
        panel = QWidget()
        panel.setObjectName("ChatPanel")
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(12, 10, 12, 12)
        layout.setSpacing(10)
        splitter = QSplitter(Qt.Horizontal)
        splitter.setObjectName("ChatSplitter")
        sidebar = QWidget()
        sidebar.setObjectName("SessionSidebar")
        sidebar.setMinimumWidth(220)
        sidebar.setMaximumWidth(280)
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(10, 10, 10, 10)
        sidebar_layout.setSpacing(8)
        self.new_session_btn = QPushButton("新建对话")
        self.new_session_btn.setObjectName("NewSessionButton")
        self.new_session_btn.setToolTip("新建本地对话 (Ctrl+N)")
        self.new_session_btn.clicked.connect(self._create_new_local_session)
        sidebar_layout.addWidget(self.new_session_btn)
        self.session_search_edit = QLineEdit()
        self.session_search_edit.setObjectName("SessionSearchInput")
        self.session_search_edit.setPlaceholderText("搜索对话…")
        self.session_search_edit.textChanged.connect(self._on_session_search_changed)
        sidebar_layout.addWidget(self.session_search_edit)
        self.session_list = SessionListWidget()
        self.session_list.setObjectName("SessionList")
        self.session_list.setSpacing(2)
        self.session_list.setDragDropMode(QAbstractItemView.InternalMove)
        self.session_list.setDefaultDropAction(Qt.MoveAction)
        self.session_list.setContextMenuPolicy(Qt.CustomContextMenu)
        self.session_list.customContextMenuRequested.connect(
            self._on_session_list_context_menu
        )
        self.session_list.delete_requested.connect(self._delete_current_session)
        self.session_list.currentItemChanged.connect(self._on_session_list_changed)
        self.session_list.itemDoubleClicked.connect(self._on_session_list_double_clicked)
        self.session_list.model().rowsMoved.connect(self._on_session_list_reordered)
        sidebar_layout.addWidget(self.session_list, stretch=1)
        sidebar_btn_row = QHBoxLayout()
        sidebar_btn_row.setSpacing(6)
        self.delete_session_btn = QPushButton("删除对话")
        self.delete_session_btn.setObjectName("DangerGhostButton")
        self.delete_session_btn.setToolTip("删除当前选中的对话（Delete）")
        self.delete_session_btn.clicked.connect(self._delete_current_session)
        sidebar_btn_row.addWidget(self.delete_session_btn)
        self.rename_session_btn = QPushButton("重命名")
        self.rename_session_btn.setObjectName("GhostButton")
        self.rename_session_btn.clicked.connect(self._rename_current_session)
        sidebar_btn_row.addWidget(self.rename_session_btn)
        sidebar_layout.addLayout(sidebar_btn_row)
        chat_area = QWidget()
        chat_area.setObjectName("ChatMainArea")
        chat_layout = QVBoxLayout(chat_area)
        chat_layout.setContentsMargins(0, 0, 0, 0)
        chat_layout.setSpacing(10)
        self.current_session_title = QLabel("新对话")
        self.current_session_title.setObjectName("CurrentSessionTitle")
        chat_layout.addWidget(self.current_session_title)
        self.chat_scroll = QScrollArea()
        self.chat_scroll.setObjectName("ChatScrollArea")
        self.chat_scroll.setWidgetResizable(True)
        self.chat_scroll.setFrameShape(QFrame.NoFrame)
        self.chat_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.chat_container = QWidget()
        self.chat_container.setObjectName("ChatViewport")
        self.chat_list_layout = QVBoxLayout(self.chat_container)
        self.chat_list_layout.setContentsMargins(20, 18, 20, 18)
        self.chat_list_layout.setSpacing(11)
        self.empty_state_widget = QWidget()
        self.empty_state_widget.setObjectName("ChatEmptyState")
        self.empty_state_widget.setVisible(False)
        self.chat_list_layout.addWidget(self.empty_state_widget)
        self.chat_bottom_spacer = QWidget()
        self.chat_bottom_spacer.setFixedHeight(1)
        self.chat_list_layout.addWidget(self.chat_bottom_spacer)
        self.chat_scroll.setWidget(self.chat_container)
        chat_layout.addWidget(self.chat_scroll, stretch=1)
        input_block = QWidget()
        input_block.setObjectName("ChatInputBlock")
        input_layout = QVBoxLayout(input_block)
        input_layout.setContentsMargins(0, 4, 0, 0)
        input_layout.setSpacing(6)
        compose_row = QHBoxLayout()
        compose_row.setSpacing(8)
        self.message_edit = ChatInput(self)
        self.message_edit.setObjectName("MessageInput")
        self._update_input_placeholder()
        self.message_edit.setFixedHeight(96)
        self.message_edit.setFont(QFont("Microsoft YaHei UI", 10))
        self.message_edit.send_requested.connect(self._push_message)
        compose_row.addWidget(self.message_edit, stretch=1)
        self.send_btn = QPushButton("发送")
        self.send_btn.setObjectName("PrimaryButton")
        self.send_btn.setFixedSize(90, 96)
        self.send_btn.clicked.connect(self._push_message)
        compose_row.addWidget(self.send_btn)
        input_layout.addLayout(compose_row)
        tools_row = QHBoxLayout()
        tools_row.setSpacing(8)
        self.input_hint_label = QLabel()
        self.input_hint_label.setObjectName("InputHint")
        self._update_input_hint_label()
        tools_row.addWidget(self.input_hint_label)
        tools_row.addStretch()
        self.clear_session_btn = QPushButton("清空当前对话")
        self.clear_session_btn.setObjectName("DangerGhostButton")
        self.clear_session_btn.clicked.connect(self._clear_current_session)
        tools_row.addWidget(self.clear_session_btn)
        self.copy_last_btn = QPushButton("复制最后回复")
        self.copy_last_btn.setObjectName("GhostButton")
        self.copy_last_btn.clicked.connect(self._copy_last_reply)
        tools_row.addWidget(self.copy_last_btn)
        input_layout.addLayout(tools_row)
        chat_layout.addWidget(input_block)
        splitter.addWidget(sidebar)
        splitter.addWidget(chat_area)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([250, 730])
        layout.addWidget(splitter, stretch=1)
        return panel
