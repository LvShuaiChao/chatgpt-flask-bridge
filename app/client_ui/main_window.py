"""通过 BridgeClient 调用 /api/v1/* 的轻量聊天 GUI。"""

from __future__ import annotations

import os
from typing import Any, Callable, Optional

from PyQt5.QtCore import QObject, QSettings, Qt, QThread, QTimer, pyqtSignal
from PyQt5.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app.ui.chat_view_helpers import create_bubble_row_widget, schedule_scroll_to_bottom
from app.ui.widgets.chat_bubble import ChatBubble, SystemBubble
from app.utils.text_utils import format_ts
from app.ui.widgets.chat_input import ChatInput
from bridge_client import BridgeApiError, BridgeClient, ConnectionDiagnostics

SETTINGS_ORG = "ChatGPTPageBridge"
SETTINGS_APP = "BridgeClientGUI"


class _TaskWorker(QObject):
    """在后台线程执行 callable，结果通过信号回主线程。"""

    result = pyqtSignal(object)
    error = pyqtSignal(str, str)
    finished = pyqtSignal()

    def __init__(self, fn: Callable[[], Any]):
        super().__init__()
        self._fn = fn

    def run(self) -> None:
        try:
            self.result.emit(self._fn())
        except BridgeApiError as exc:
            self.error.emit(exc.code or "", str(exc))
        except Exception as exc:
            self.error.emit("", str(exc))
        finally:
            self.finished.emit()


class BridgeClientMainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Bridge API 客户端")
        self.resize(920, 720)
        self.setMinimumSize(720, 520)

        self._settings = QSettings(SETTINGS_ORG, SETTINGS_APP)
        self._client: Optional[BridgeClient] = None
        self._session_id = ""
        self._sending = False
        self._active_threads: list[QThread] = []
        self._pending_assistant_bubble: Optional[ChatBubble] = None
        self._last_diag: Optional[ConnectionDiagnostics] = None

        self._build_ui()
        self._apply_style()
        self._load_settings()
        self._rebuild_client()
        QTimer.singleShot(400, self._run_diagnose)

    # ------------------------------------------------------------------ UI
    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)

        self.main_tabs = QTabWidget()
        self.chat_page = self._build_chat_page()
        self.conn_page = self._build_connection_page()
        self.main_tabs.addTab(self.chat_page, "聊天")
        self.main_tabs.addTab(self.conn_page, "连接")
        root.addWidget(self.main_tabs, stretch=1)

        status_row = QHBoxLayout()
        self.status_chip = QLabel("未检测")
        self.status_chip.setObjectName("StatusChip")
        self.status_chip.setProperty("state", "warn")
        status_row.addWidget(self.status_chip)
        status_row.addStretch()
        self.refresh_status_btn = QPushButton("刷新状态")
        self.refresh_status_btn.clicked.connect(self._run_diagnose)
        status_row.addWidget(self.refresh_status_btn)
        root.addLayout(status_row)

    def _build_chat_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)

        session_row = QHBoxLayout()
        session_row.addWidget(QLabel("会话:"))
        self.session_combo = QComboBox()
        self.session_combo.setMinimumWidth(220)
        self.session_combo.currentIndexChanged.connect(self._on_session_combo_changed)
        session_row.addWidget(self.session_combo, stretch=1)
        self.new_session_btn = QPushButton("新建会话")
        self.new_session_btn.clicked.connect(self._on_new_session)
        session_row.addWidget(self.new_session_btn)
        self.reload_sessions_btn = QPushButton("刷新列表")
        self.reload_sessions_btn.clicked.connect(self._run_list_sessions)
        session_row.addWidget(self.reload_sessions_btn)
        layout.addLayout(session_row)

        self.chat_scroll = QScrollArea()
        self.chat_scroll.setWidgetResizable(True)
        self.chat_scroll.setFrameShape(QFrame.NoFrame)
        self.chat_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        chat_host = QWidget()
        self.chat_list_layout = QVBoxLayout(chat_host)
        self.chat_list_layout.setContentsMargins(4, 4, 4, 4)
        self.chat_list_layout.setSpacing(10)
        self.chat_list_layout.addStretch()
        self.chat_scroll.setWidget(chat_host)
        layout.addWidget(self.chat_scroll, stretch=1)

        input_row = QHBoxLayout()
        self.chat_input = ChatInput(main_window=self)
        self.chat_input.setPlaceholderText("输入消息后 Enter 发送，Shift+Enter 换行…")
        self.chat_input.setMinimumHeight(72)
        self.chat_input.setMaximumHeight(140)
        self.chat_input.send_requested.connect(self._on_send)
        input_row.addWidget(self.chat_input, stretch=1)
        self.send_btn = QPushButton("发送")
        self.send_btn.setObjectName("PrimaryButton")
        self.send_btn.clicked.connect(self._on_send)
        self.send_btn.setMinimumWidth(80)
        input_row.addWidget(self.send_btn)
        layout.addLayout(input_row)

        return page

    def _build_connection_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(10)

        form_box = QGroupBox("服务地址")
        form = QFormLayout(form_box)
        self.url_edit = QLineEdit()
        self.url_edit.setPlaceholderText("http://127.0.0.1:5000")
        form.addRow("Base URL:", self.url_edit)
        self.token_edit = QLineEdit()
        self.token_edit.setEchoMode(QLineEdit.Password)
        self.token_edit.setPlaceholderText("可选，或环境变量 CHATGPT_PAGE_BRIDGE_TOKEN")
        form.addRow("Token:", self.token_edit)
        self.timeout_spin = QDoubleSpinBox()
        self.timeout_spin.setRange(10, 600)
        self.timeout_spin.setDecimals(0)
        self.timeout_spin.setSuffix(" 秒")
        form.addRow("等待超时:", self.timeout_spin)
        layout.addWidget(form_box)

        opts_box = QGroupBox("发送选项")
        opts_layout = QVBoxLayout(opts_box)
        self.async_check = QCheckBox("使用异步 send + 轮询（不用 /chat/ask 长连接）")
        self.no_open_home_check = QCheckBox("无可用页面时不自动打开 ChatGPT 首页")
        opts_layout.addWidget(self.async_check)
        opts_layout.addWidget(self.no_open_home_check)
        layout.addWidget(opts_box)

        btn_row = QHBoxLayout()
        self.apply_conn_btn = QPushButton("应用并检测")
        self.apply_conn_btn.setObjectName("PrimaryButton")
        self.apply_conn_btn.clicked.connect(self._on_apply_connection)
        btn_row.addWidget(self.apply_conn_btn)
        self.detail_status_btn = QPushButton("详细状态")
        self.detail_status_btn.clicked.connect(self._run_full_status)
        btn_row.addWidget(self.detail_status_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)

        self.diag_edit = QTextEdit()
        self.diag_edit.setReadOnly(True)
        self.diag_edit.setPlaceholderText("点击「应用并检测」查看连接诊断…")
        layout.addWidget(self.diag_edit, stretch=1)

        hint = QLabel(
            "本窗口通过 bridge_client 调用主 GUI 已启动的桥接服务；"
            "请先运行 python gui.py 并在设置中启动服务。"
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #666; font-size: 12px;")
        layout.addWidget(hint)
        return page

    def _apply_style(self) -> None:
        self.setStyleSheet(
            """
            QMainWindow { background: #f0f2f5; }
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
            }
            QTabBar::tab:selected {
                background: #ffffff;
                color: #111;
                font-weight: 600;
            }
            QPushButton {
                background: #ffffff;
                color: #333;
                border: 1px solid #d0d5dd;
                border-radius: 6px;
                padding: 5px 12px;
                min-height: 22px;
            }
            QPushButton:hover { background: #f5f6f8; }
            QPushButton#PrimaryButton {
                background: #2563eb;
                color: #ffffff;
                border: 1px solid #1d4ed8;
                font-weight: 600;
            }
            QPushButton#PrimaryButton:hover { background: #1d4ed8; }
            QPushButton#PrimaryButton:disabled {
                background: #93b4f5;
                border-color: #93b4f5;
                color: #eef2ff;
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
            QFrame#ChatBubble[bubbleRole="user"] {
                background: #dbeafe;
                border: 1px solid #93c5fd;
                border-radius: 10px;
            }
            QFrame#ChatBubble[bubbleRole="assistant"] {
                background: #f3f4f6;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QFrame#ChatBubble[bubbleRole="error"] {
                background: #fef2f2;
                border: 1px solid #fecaca;
                border-radius: 10px;
            }
            QFrame#SystemBubble {
                background: #f9fafb;
                border: 1px dashed #d1d5db;
                border-radius: 8px;
                color: #6b7280;
            }
            """
        )

    # ----------------------------------------------------------- settings
    def _load_settings(self) -> None:
        default_url = os.environ.get(
            "CHATGPT_PAGE_BRIDGE_URL", "http://127.0.0.1:5000"
        )
        self.url_edit.setText(
            self._settings.value("base_url", default_url, type=str)
        )
        default_token = os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")
        self.token_edit.setText(
            self._settings.value("token", default_token, type=str)
        )
        self.timeout_spin.setValue(
            float(self._settings.value("timeout", 120, type=float))
        )
        self.async_check.setChecked(
            self._settings.value("use_async", False, type=bool)
        )
        self.no_open_home_check.setChecked(
            self._settings.value("no_open_home", False, type=bool)
        )
        saved_session = self._settings.value("session_id", "", type=str)
        if saved_session:
            self._session_id = saved_session

    def _save_settings(self) -> None:
        self._settings.setValue("base_url", self.url_edit.text().strip())
        self._settings.setValue("token", self.token_edit.text().strip())
        self._settings.setValue("timeout", self.timeout_spin.value())
        self._settings.setValue("use_async", self.async_check.isChecked())
        self._settings.setValue("no_open_home", self.no_open_home_check.isChecked())
        self._settings.setValue("session_id", self._session_id)

    def _rebuild_client(self) -> None:
        url = self.url_edit.text().strip() or "http://127.0.0.1:5000"
        token = self.token_edit.text().strip()
        timeout = float(self.timeout_spin.value())
        self._client = BridgeClient(
            base_url=url,
            token=token or None,
            default_timeout=timeout,
            http_timeout=timeout + 30,
        )

    # ---------------------------------------------------------- threading
    def _run_in_thread(
        self,
        fn: Callable[[], Any],
        on_result: Callable[[Any], None],
        *,
        on_error: Optional[Callable[[str, str], None]] = None,
    ) -> None:
        thread = QThread(self)
        worker = _TaskWorker(fn)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)

        def _cleanup() -> None:
            if thread in self._active_threads:
                self._active_threads.remove(thread)

        worker.result.connect(on_result)
        worker.error.connect(on_error or self._on_task_error)
        worker.finished.connect(thread.quit)
        worker.finished.connect(worker.deleteLater)
        thread.finished.connect(_cleanup)
        thread.finished.connect(thread.deleteLater)
        self._active_threads.append(thread)
        thread.start()

    def _set_widgets_enabled(self, widgets, enabled):
        for widget in widgets or []:
            if widget is not None:
                widget.setEnabled(enabled)

    def _run_client_task(
        self,
        task,
        on_result,
        *,
        busy_widgets=None,
        on_error=None,
        error_message_prefix="任务失败",
    ):
        client = self._client
        if client is None:
            self._add_system_message("桥接客户端未初始化。")
            return

        widgets = list(busy_widgets or [])
        self._set_widgets_enabled(widgets, False)

        def wrapped_result(result):
            self._set_widgets_enabled(widgets, True)
            on_result(result)

        def wrapped_error(code, message):
            self._set_widgets_enabled(widgets, True)
            if on_error:
                on_error(code, message)
                return
            self._add_system_message(f"{error_message_prefix}：{message}")

        self._run_in_thread(task, wrapped_result, on_error=wrapped_error)

    def _on_task_error(self, code: str, message: str) -> None:
        prefix = f"[{code}] " if code else ""
        self._add_system_message(f"错误：{prefix}{message}")
        self._set_sending(False)

    # -------------------------------------------------------- connection
    def _on_apply_connection(self) -> None:
        self._save_settings()
        self._rebuild_client()
        self._run_diagnose()
        self._run_list_sessions()

    def _run_diagnose(self) -> None:
        client = self._client
        if client is None:
            return
        self.refresh_status_btn.setEnabled(False)
        self.apply_conn_btn.setEnabled(False)

        def task() -> ConnectionDiagnostics:
            return client.diagnose_connection()

        def on_result(diag: ConnectionDiagnostics) -> None:
            self._last_diag = diag
            self._update_status_chip(diag)
            self.diag_edit.setPlainText("\n".join(diag.summary_lines()))
            self.refresh_status_btn.setEnabled(True)
            self.apply_conn_btn.setEnabled(True)
            if not diag.health_ok:
                self._add_system_message(
                    "无法连接桥接服务，请确认主 GUI 已启动服务。"
                )
            elif not diag.chat_api_ok:
                self._add_system_message(
                    "服务已连接，但 /api/v1/chat/ask 不可用，请重启主 GUI 加载最新 server.py。"
                )

        self._run_in_thread(task, on_result, on_error=self._on_diagnose_error)

    def _on_diagnose_error(self, _code: str, message: str) -> None:
        self.refresh_status_btn.setEnabled(True)
        self.apply_conn_btn.setEnabled(True)
        self.status_chip.setText(f"检测失败：{message[:60]}")
        self.status_chip.setProperty("state", "error")
        self.status_chip.style().unpolish(self.status_chip)
        self.status_chip.style().polish(self.status_chip)

    def _update_status_chip(self, diag: ConnectionDiagnostics) -> None:
        if diag.health_ok and diag.chat_api_ok:
            tm = diag.tm_online_clients
            self.status_chip.setText(
                f"已连接 · 油猴在线 {tm} · {self._client.base_url if self._client else ''}"
            )
            self.status_chip.setProperty("state", "ok")
        elif diag.health_ok:
            self.status_chip.setText("已连接 · 聊天 API 不可用")
            self.status_chip.setProperty("state", "warn")
        else:
            self.status_chip.setText("未连接服务")
            self.status_chip.setProperty("state", "error")
        self.status_chip.style().unpolish(self.status_chip)
        self.status_chip.style().polish(self.status_chip)

    def _run_full_status(self) -> None:
        client = self._client
        if client is None:
            return

        def task() -> str:
            data = client.status()
            lines = [
                f"服务: {data.get('server', '-')}",
                f"油猴在线: {data.get('tampermonkey_online', '-')}",
            ]
            tm = data.get("tm") or {}
            queues = data.get("queues") or {}
            sessions = data.get("sessions") or {}
            lines.append(
                f"油猴客户端: 在线 {tm.get('online_clients', 0)} | "
                f"首页 {tm.get('online_home_clients', 0)} | "
                f"对话页 {tm.get('online_conversation_clients', 0)}"
            )
            lines.append(
                f"队列: chat={queues.get('chat_queue', 0)} "
                f"control={queues.get('control_queue', 0)} "
                f"waiting={queues.get('waiting', 0)}"
            )
            lines.append(
                f"会话: 共 {sessions.get('total', 0)} | "
                f"绑定在线 {sessions.get('bound_online', 0)} | "
                f"未绑定 {sessions.get('unbound', 0)}"
            )
            if data.get("_legacy_status"):
                lines.insert(1, "（旧版 /api/status，会话统计可能不完整）")
            return "\n".join(lines)

        def on_result(text: str) -> None:
            self.diag_edit.setPlainText(text)

        def on_err(_code: str, msg: str) -> None:
            self.diag_edit.setPlainText(f"获取状态失败：{msg}")

        self._run_client_task(
            task,
            on_result,
            busy_widgets=[self.detail_status_btn],
            on_error=on_err,
            error_message_prefix="获取状态失败",
        )

    def _run_list_sessions(self) -> None:
        client = self._client
        if client is None:
            return

        self._run_client_task(
            lambda: client.list_sessions(),
            self._populate_session_combo,
            busy_widgets=[self.reload_sessions_btn],
            error_message_prefix="获取会话列表失败",
        )

    def _populate_session_combo(self, items: list[dict[str, Any]]) -> None:
        current = self._session_id
        self.session_combo.blockSignals(True)
        self.session_combo.clear()
        self.session_combo.addItem("（自动新建会话）", "")
        for item in items:
            sid = str(item.get("session_id") or "")
            title = str(item.get("title") or "新对话")
            bind = str(item.get("bind_state") or "")
            label = f"{title}  [{sid[:8]}…]" if sid else title
            if bind:
                label = f"{label} · {bind}"
            self.session_combo.addItem(label, sid)
        idx = 0
        if current:
            found = self.session_combo.findData(current, Qt.UserRole)
            if found >= 0:
                idx = found
        self.session_combo.setCurrentIndex(idx)
        self.session_combo.blockSignals(False)
        self._on_session_combo_changed()

    def _on_session_combo_changed(self) -> None:
        data = self.session_combo.currentData(Qt.UserRole)
        self._session_id = str(data or "")
        self._save_settings()

    def _on_new_session(self) -> None:
        client = self._client
        if client is None:
            return

        def on_result(session: dict[str, Any]) -> None:
            sid = str(session.get("session_id") or "")
            if sid:
                self._session_id = sid
                self._save_settings()
                self._add_system_message(f"已创建会话 {sid[:8]}…")
            self._run_list_sessions()

        self._run_client_task(
            lambda: client.create_session("Bridge 客户端对话"),
            on_result,
            busy_widgets=[self.new_session_btn],
            error_message_prefix="创建会话失败",
        )

    # -------------------------------------------------------------- chat
    def _format_ts(self) -> str:
        return format_ts()

    def _scroll_to_bottom(self) -> None:
        schedule_scroll_to_bottom(self.chat_scroll)

    def _add_bubble_row(self, bubble: QWidget, *, role: str) -> None:
        row = create_bubble_row_widget(bubble, role)
        insert_index = max(0, self.chat_list_layout.count() - 1)
        self.chat_list_layout.insertWidget(insert_index, row)
        self._scroll_to_bottom()

    def _add_system_message(self, text: str) -> None:
        bubble = SystemBubble(text, self._format_ts())
        self._add_bubble_row(bubble, role="system")

    def _add_user_message(self, text: str) -> None:
        bubble = ChatBubble("user", text, self._format_ts())
        self._add_bubble_row(bubble, role="user")

    def _add_assistant_placeholder(self) -> ChatBubble:
        bubble = ChatBubble("assistant", "正在等待回复…", self._format_ts(), "等待中")
        self._add_bubble_row(bubble, role="assistant")
        return bubble

    def _can_send(self) -> bool:
        if self._sending:
            return False
        if self._last_diag and not self._last_diag.health_ok:
            self._add_system_message("请先连接桥接服务（见「连接」页）。")
            return False
        if self._last_diag and not self._last_diag.chat_api_ok:
            self._add_system_message("聊天 API 不可用，无法发送。")
            return False
        return True

    def _set_sending(self, sending: bool) -> None:
        self._sending = sending
        self.send_btn.setEnabled(not sending)
        self.chat_input.setEnabled(not sending)

    def _ask_kwargs(self) -> dict[str, Any]:
        return {
            "session_id": self._session_id,
            "auto_create_session": not self._session_id,
            "auto_open_home": not self.no_open_home_check.isChecked(),
            "timeout": float(self.timeout_spin.value()),
        }

    def _on_send(self) -> None:
        text = self.chat_input.toPlainText().strip()
        if not text or not self._can_send():
            return
        client = self._client
        if client is None:
            return

        self.chat_input.clear()
        self._add_user_message(text)
        self._pending_assistant_bubble = self._add_assistant_placeholder()
        self._set_sending(True)

        kwargs = self._ask_kwargs()
        use_async = self.async_check.isChecked()

        def task() -> str:
            if use_async:
                return client.send_and_wait(text, **kwargs)
            return client.ask(text, **kwargs)

        def on_result(reply: str) -> None:
            if self._pending_assistant_bubble is not None:
                self._pending_assistant_bubble.set_text(reply or "（空回复）", "")
            self._pending_assistant_bubble = None
            self._set_sending(False)
            new_sid = kwargs.get("session_id") or ""
            if not new_sid and client:
                try:
                    sessions = client.list_sessions()
                    if sessions:
                        latest = max(
                            sessions,
                            key=lambda s: float(s.get("updated_at") or 0),
                        )
                        new_sid = str(latest.get("session_id") or "")
                except BridgeApiError as error:
                    self._add_system_message(f"刷新会话列表失败：{error}")
            if new_sid and new_sid != self._session_id:
                self._session_id = new_sid
                self._save_settings()
                self._run_list_sessions()

        def on_err(code: str, message: str) -> None:
            if self._pending_assistant_bubble is not None:
                self._pending_assistant_bubble.set_error(message, code or "错误")
            self._pending_assistant_bubble = None
            self._set_sending(False)

        self._run_in_thread(task, on_result, on_error=on_err)
