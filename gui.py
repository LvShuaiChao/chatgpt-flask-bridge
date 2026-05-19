import sys
import time
import traceback

from PyQt5.QtCore import QObject, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import (
    QApplication,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
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

import server


class BridgeNotifier(QObject):
    log_signal = pyqtSignal(str)
    status_signal = pyqtSignal(dict)


class ChatInput(QTextEdit):
    send_requested = pyqtSignal()

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            if not (event.modifiers() & Qt.ShiftModifier):
                self.send_requested.emit()
                event.accept()
                return
        super().keyPressEvent(event)


class ChatBubble(QFrame):
    def __init__(self, role, text, ts_text, status_text=""):
        super().__init__()

        self.role = role
        self.ts_text = ts_text
        self.status_text = status_text

        self.setObjectName("ChatBubble")
        self.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Minimum)
        self.setMaximumWidth(680)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(6)

        self.header_label = QLabel()
        self.header_label.setObjectName("BubbleHeader")
        layout.addWidget(self.header_label)

        self.body_label = QLabel()
        self.body_label.setWordWrap(True)
        self.body_label.setTextFormat(Qt.PlainText)
        self.body_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.body_label.setObjectName("BubbleBody")
        layout.addWidget(self.body_label)

        self.set_text(text, status_text)
        self._apply_style()

    def _role_name(self):
        if self.role == "user":
            return "你"
        if self.role == "assistant":
            return "ChatGPT"
        if self.role == "error":
            return "错误"
        return "系统"

    def _apply_style(self):
        if self.role == "user":
            self.setStyleSheet(
                """
                QFrame#ChatBubble {
                    background: #d9fdd3;
                    border: 1px solid #b7e4ad;
                    border-radius: 12px;
                }
                QLabel#BubbleHeader {
                    color: #3b6b35;
                    font-size: 12px;
                    font-weight: bold;
                }
                QLabel#BubbleBody {
                    color: #111;
                    font-size: 14px;
                    line-height: 1.35;
                }
                """
            )
        elif self.role == "assistant":
            self.setStyleSheet(
                """
                QFrame#ChatBubble {
                    background: #ffffff;
                    border: 1px solid #dcdfe6;
                    border-radius: 12px;
                }
                QLabel#BubbleHeader {
                    color: #555;
                    font-size: 12px;
                    font-weight: bold;
                }
                QLabel#BubbleBody {
                    color: #111;
                    font-size: 14px;
                    line-height: 1.35;
                }
                """
            )
        elif self.role == "error":
            self.setStyleSheet(
                """
                QFrame#ChatBubble {
                    background: #fdecec;
                    border: 1px solid #f5b5b5;
                    border-radius: 12px;
                }
                QLabel#BubbleHeader {
                    color: #a40000;
                    font-size: 12px;
                    font-weight: bold;
                }
                QLabel#BubbleBody {
                    color: #7a0000;
                    font-size: 14px;
                    line-height: 1.35;
                }
                """
            )
        else:
            self.setStyleSheet(
                """
                QFrame#ChatBubble {
                    background: #f1f3f5;
                    border: 1px solid #d8dce0;
                    border-radius: 12px;
                }
                QLabel#BubbleHeader {
                    color: #666;
                    font-size: 12px;
                    font-weight: bold;
                }
                QLabel#BubbleBody {
                    color: #333;
                    font-size: 13px;
                    line-height: 1.35;
                }
                """
            )

    def set_text(self, text, status_text=None):
        if status_text is not None:
            self.status_text = status_text

        parts = [self._role_name(), self.ts_text]
        if self.status_text:
            parts.append(self.status_text)

        self.header_label.setText(" · ".join(parts))
        self.body_label.setText(text or "")

    def set_error(self, text, status_text="失败"):
        self.role = "error"
        self._apply_style()
        self.set_text(text, status_text)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("ChatGPT 油猴联动聊天窗口")
        self.resize(980, 760)
        self.setMinimumSize(860, 620)

        self._processed_inbound_ids = set()
        self._reply_bubbles_by_message_id = {}
        self._user_bubbles_by_message_id = {}
        self._last_assistant_text = ""

        self._notifier = BridgeNotifier()
        self._notifier.log_signal.connect(self._append_log)
        self._notifier.status_signal.connect(self._apply_bridge_status)
        server.set_log_callback(self._notifier.log_signal.emit)
        server.set_status_callback(self._notifier.status_signal.emit)

        self._build_ui()

        self._status_timer = QTimer(self)
        self._status_timer.timeout.connect(self._refresh_status_tick)
        self._status_timer.start(1000)

        self._add_system_message(
            "请先启动服务，然后刷新 ChatGPT 页面并确认油猴脚本在线。"
        )

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)

        root.addWidget(self._build_top_status_group())

        splitter = QSplitter(Qt.Vertical)
        splitter.addWidget(self._build_chat_group())
        splitter.addWidget(self._build_diagnostics_group())
        splitter.setStretchFactor(0, 4)
        splitter.setStretchFactor(1, 1)
        root.addWidget(splitter, stretch=1)

        self.statusBar().showMessage("未启动服务")

    def _build_top_status_group(self):
        box = QGroupBox("连接状态")
        layout = QVBoxLayout(box)
        layout.setSpacing(8)

        row1 = QHBoxLayout()

        row1.addWidget(QLabel("地址"))
        self.host_edit = QLineEdit("127.0.0.1")
        self.host_edit.setFixedWidth(130)
        row1.addWidget(self.host_edit)

        row1.addSpacing(8)
        row1.addWidget(QLabel("端口"))
        self.port_edit = QLineEdit("5000")
        self.port_edit.setFixedWidth(70)
        row1.addWidget(self.port_edit)

        row1.addSpacing(12)

        self.start_btn = QPushButton("启动服务")
        self.start_btn.clicked.connect(self._start_server)
        row1.addWidget(self.start_btn)

        self.stop_btn = QPushButton("停止服务")
        self.stop_btn.clicked.connect(self._stop_server)
        self.stop_btn.setEnabled(False)
        row1.addWidget(self.stop_btn)

        row1.addSpacing(20)

        self.status_label = QLabel("服务：未启动")
        row1.addWidget(self.status_label)

        row1.addSpacing(20)

        self.tm_online_label = QLabel("油猴：未连接")
        row1.addWidget(self.tm_online_label)

        row1.addSpacing(20)

        self.tm_last_seen_label = QLabel("最后心跳：-")
        row1.addWidget(self.tm_last_seen_label)

        row1.addStretch()
        layout.addLayout(row1)

        row2 = QHBoxLayout()

        self.tm_queue_label = QLabel("待发队列：0")
        row2.addWidget(self.tm_queue_label)

        row2.addSpacing(20)

        self.tm_page_label = QLabel("页面：-")
        self.tm_page_label.setWordWrap(True)
        row2.addWidget(self.tm_page_label, stretch=1)

        layout.addLayout(row2)

        return box

    def _build_chat_group(self):
        box = QGroupBox("对话")
        layout = QVBoxLayout(box)
        layout.setSpacing(8)

        self.chat_scroll = QScrollArea()
        self.chat_scroll.setWidgetResizable(True)
        self.chat_scroll.setFrameShape(QFrame.NoFrame)

        self.chat_container = QWidget()
        self.chat_list_layout = QVBoxLayout(self.chat_container)
        self.chat_list_layout.setContentsMargins(8, 8, 8, 8)
        self.chat_list_layout.setSpacing(10)

        self.chat_bottom_spacer = QWidget()
        self.chat_bottom_spacer.setFixedHeight(1)
        self.chat_list_layout.addWidget(self.chat_bottom_spacer)

        self.chat_scroll.setWidget(self.chat_container)
        layout.addWidget(self.chat_scroll, stretch=1)

        input_row = QHBoxLayout()
        input_row.setSpacing(8)

        self.message_edit = ChatInput()
        self.message_edit.setPlaceholderText("输入消息，按 Enter 发送，Shift + Enter 换行")
        self.message_edit.setFixedHeight(92)
        self.message_edit.setFont(QFont("Microsoft YaHei UI", 10))
        self.message_edit.send_requested.connect(self._push_message)
        input_row.addWidget(self.message_edit, stretch=1)

        button_col = QVBoxLayout()

        self.send_btn = QPushButton("发送")
        self.send_btn.setFixedHeight(34)
        self.send_btn.clicked.connect(self._push_message)
        button_col.addWidget(self.send_btn)

        self.clear_chat_btn = QPushButton("清空对话")
        self.clear_chat_btn.setFixedHeight(30)
        self.clear_chat_btn.clicked.connect(self._clear_chat)
        button_col.addWidget(self.clear_chat_btn)

        self.copy_last_btn = QPushButton("复制回复")
        self.copy_last_btn.setFixedHeight(30)
        self.copy_last_btn.clicked.connect(self._copy_last_reply)
        button_col.addWidget(self.copy_last_btn)

        button_col.addStretch()
        input_row.addLayout(button_col)

        layout.addLayout(input_row)

        return box

    def _build_diagnostics_group(self):
        box = QGroupBox("诊断信息")
        layout = QVBoxLayout(box)

        self.diag_tabs = QTabWidget()
        layout.addWidget(self.diag_tabs)

        self.event_log_edit = QTextEdit()
        self.event_log_edit.setReadOnly(True)
        self.event_log_edit.setFont(QFont("Consolas", 9))
        self.diag_tabs.addTab(self.event_log_edit, "油猴事件")

        self.outbound_table = QTableWidget(0, 4)
        self.outbound_table.setHorizontalHeaderLabels(["时间", "ID", "状态", "内容"])
        self.outbound_table.horizontalHeader().setStretchLastSection(True)
        self.outbound_table.setColumnWidth(0, 80)
        self.outbound_table.setColumnWidth(1, 110)
        self.outbound_table.setColumnWidth(2, 100)
        self.outbound_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.outbound_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.outbound_table.verticalHeader().setVisible(False)
        self.diag_tabs.addTab(self.outbound_table, "发出消息")

        self.log_edit = QTextEdit()
        self.log_edit.setReadOnly(True)
        self.log_edit.setFont(QFont("Consolas", 9))
        self.diag_tabs.addTab(self.log_edit, "运行日志")

        return box

    @staticmethod
    def _format_ts(ts):
        if not ts:
            return "-"
        return time.strftime("%H:%M:%S", time.localtime(ts))

    def _now_text(self):
        return time.strftime("%H:%M:%S", time.localtime())

    def _add_bubble(self, role, text, message_id=None, status_text=""):
        bubble = ChatBubble(role, text, self._now_text(), status_text)

        row = QWidget()
        row_layout = QHBoxLayout(row)
        row_layout.setContentsMargins(0, 0, 0, 0)
        row_layout.setSpacing(8)

        if role == "user":
            row_layout.addStretch()
            row_layout.addWidget(bubble)
        else:
            row_layout.addWidget(bubble)
            row_layout.addStretch()

        insert_index = max(0, self.chat_list_layout.count() - 1)
        self.chat_list_layout.insertWidget(insert_index, row)

        if message_id:
            if role == "user":
                self._user_bubbles_by_message_id[message_id] = bubble
            elif role in ("assistant", "error"):
                self._reply_bubbles_by_message_id[message_id] = bubble

        self._scroll_to_bottom()
        return bubble

    def _add_system_message(self, text):
        self._add_bubble("system", text)

    def _scroll_to_bottom(self):
        QTimer.singleShot(0, self._do_scroll_to_bottom)

    def _do_scroll_to_bottom(self):
        bar = self.chat_scroll.verticalScrollBar()
        bar.setValue(bar.maximum())

    def _set_reply_text(self, message_id, text, status_text="已回复"):
        bubble = None

        if message_id:
            bubble = self._reply_bubbles_by_message_id.get(message_id)

        if bubble is None:
            bubble = self._add_bubble(
                "assistant", text, message_id=message_id, status_text=status_text
            )
        else:
            bubble.role = "assistant"
            bubble._apply_style()
            bubble.set_text(text, status_text)

        self._last_assistant_text = text or ""
        self._scroll_to_bottom()

    def _set_reply_error(self, message_id, text, status_text="失败"):
        bubble = None

        if message_id:
            bubble = self._reply_bubbles_by_message_id.get(message_id)

        if bubble is None:
            bubble = self._add_bubble(
                "error", text, message_id=message_id, status_text=status_text
            )
        else:
            bubble.set_error(text, status_text)

        self._scroll_to_bottom()

    def _set_reply_status(self, message_id, status_text):
        if not message_id:
            return

        bubble = self._reply_bubbles_by_message_id.get(message_id)
        if bubble is None:
            return

        current_text = bubble.body_label.text()
        bubble.set_text(current_text, status_text)

    def _apply_bridge_status(self, status):
        server_running = bool(status.get("server_running"))

        if server_running:
            self.status_label.setText(
                f"服务：运行中（{self.host_edit.text().strip()}:{self.port_edit.text().strip()}）"
            )
            self.statusBar().showMessage("服务运行中")
        else:
            self.status_label.setText("服务：未启动")
            self.statusBar().showMessage("服务未启动")

        if status.get("tampermonkey_online"):
            self.tm_online_label.setText("油猴：在线")
            self.tm_online_label.setStyleSheet("color: #0a7a2f; font-weight: bold;")
        elif status.get("tampermonkey_last_seen"):
            self.tm_online_label.setText("油猴：离线")
            self.tm_online_label.setStyleSheet("color: #a66a00;")
        else:
            self.tm_online_label.setText("油猴：未连接")
            self.tm_online_label.setStyleSheet("")

        self.tm_last_seen_label.setText(
            f"最后心跳：{self._format_ts(status.get('tampermonkey_last_seen'))}"
        )
        self.tm_queue_label.setText(f"待发队列：{status.get('queue_length', 0)}")

        page = status.get("tampermonkey_page_url") or "-"
        if len(page) > 110:
            page = page[:110] + "..."
        self.tm_page_label.setText(f"页面：{page}")

        inbound_items = status.get("recent_inbound") or []
        outbound_items = status.get("recent_outbound") or []

        self._handle_inbound_events(inbound_items)
        self._render_inbound_log(inbound_items)
        self._render_outbound(outbound_items)

    def _handle_inbound_events(self, items):
        for item in items:
            item_id = item.get("id")
            if not item_id:
                continue

            if item_id in self._processed_inbound_ids:
                continue

            self._processed_inbound_ids.add(item_id)

            kind = item.get("kind", "?")
            payload = item.get("payload") or {}
            message_id = item.get("message_id")

            if kind == "ack":
                success = bool(payload.get("success"))
                detail = payload.get("detail") or ""

                if success:
                    self._set_reply_status(message_id, "已发送，等待回复")
                else:
                    self._set_reply_error(
                        message_id,
                        f"发送失败：{detail or '油猴返回失败'}",
                        "发送失败",
                    )

            elif kind == "send_failed":
                detail = payload.get("detail") or payload.get("reason") or str(payload)
                self._set_reply_error(message_id, f"发送失败：{detail}", "发送失败")

            elif kind == "assistant_reply":
                text = payload.get("text") or payload.get("content") or ""
                if text.strip():
                    self._set_reply_text(message_id, text.strip(), "已回复")
                else:
                    self._set_reply_error(
                        message_id, "已收到 assistant_reply，但内容为空。", "空回复"
                    )

            elif kind == "assistant_reply_empty":
                detail = payload.get("detail") or "ChatGPT 已发送，但未读取到回复内容。"
                self._set_reply_error(message_id, detail, "空回复")

            elif kind == "assistant_reply_failed":
                detail = payload.get("detail") or "读取 ChatGPT 回复失败。"
                self._set_reply_error(message_id, detail, "读取失败")

            elif kind == "ack_mismatch":
                detail = payload.get("detail") or str(payload)
                self._add_system_message(f"回执不匹配：{detail}")

            else:
                self._append_event_log_line(kind, payload)

    def _append_event_log_line(self, kind, payload):
        line = f"[{self._now_text()}] {kind} {payload}"
        self.event_log_edit.append(line)

    def _render_inbound_log(self, items):
        if not items:
            self.event_log_edit.setPlainText("（暂无回传）")
            return

        lines = []
        for item in reversed(items):
            ts = self._format_ts(item.get("time"))
            kind = item.get("kind", "?")
            payload = item.get("payload") or {}
            message_id = item.get("message_id") or "-"
            lines.append(f"[{ts}] {kind} message_id={message_id} payload={payload}")

        self.event_log_edit.setPlainText("\n".join(lines))

    def _render_outbound(self, items):
        self.outbound_table.setRowCount(0)

        for item in reversed(items):
            content = item.get("content", "")
            if len(content) > 80:
                content = content[:80] + "..."

            row = self.outbound_table.rowCount()
            self.outbound_table.insertRow(row)

            ts = self._format_ts(
                item.get("acked_at")
                or item.get("delivered_at")
                or item.get("created_at")
            )

            message_id = item.get("id") or ""
            short_id = message_id[:8] + "…" if message_id else "-"

            self.outbound_table.setItem(row, 0, QTableWidgetItem(ts))
            self.outbound_table.setItem(row, 1, QTableWidgetItem(short_id))
            self.outbound_table.setItem(row, 2, QTableWidgetItem(item.get("status", "")))
            self.outbound_table.setItem(row, 3, QTableWidgetItem(content))

    def _refresh_status_tick(self):
        if server.is_server_running():
            self._apply_bridge_status(server.get_bridge_status())

    def _append_log(self, message):
        self.log_edit.append(str(message))

    def _update_running_ui(self, running):
        self.host_edit.setEnabled(not running)
        self.port_edit.setEnabled(not running)
        self.start_btn.setEnabled(not running)
        self.stop_btn.setEnabled(running)

    def _parse_port(self):
        raw = self.port_edit.text().strip()

        try:
            port = int(raw)
        except ValueError:
            self._add_system_message(f"端口错误：{raw} 不是数字。")
            return None

        if not (1 <= port <= 65535):
            self._add_system_message(f"端口错误：{port} 不在 1-65535 范围内。")
            return None

        return port

    def _start_server(self):
        host = self.host_edit.text().strip() or "127.0.0.1"
        port = self._parse_port()

        if port is None:
            return

        try:
            started = server.start_server(host, port)
        except Exception as error:
            detail = f"服务启动失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._add_system_message(f"服务启动失败：{error}")
            return

        if started:
            self._update_running_ui(True)
            self._apply_bridge_status(server.get_bridge_status())
            self._add_system_message(f"服务已启动：http://{host}:{port}")
        else:
            self._add_system_message("服务已经在运行中。")

    def _stop_server(self):
        try:
            stopped = server.stop_server()
        except Exception as error:
            detail = f"服务停止失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._add_system_message(f"服务停止失败：{error}")
            return

        if stopped:
            self._update_running_ui(False)
            self._apply_bridge_status(server.get_bridge_status())
            self._add_system_message("服务已停止。")
        else:
            self._add_system_message("服务当前没有运行。")

    def _push_message(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return

        content = self.message_edit.toPlainText().strip()
        if not content:
            self._add_system_message("请输入要发送的内容。")
            return

        try:
            msg = server.push_message(content)
        except Exception as error:
            detail = f"消息入队失败：{error}\n{traceback.format_exc()}"
            print(detail)
            self._append_log(detail)
            self._add_system_message(f"消息入队失败：{error}")
            return

        message_id = msg.get("id") if isinstance(msg, dict) else None

        self._add_bubble("user", content, message_id=message_id, status_text="已加入队列")
        self._add_bubble(
            "assistant",
            "等待 ChatGPT 回复…",
            message_id=message_id,
            status_text="等待中",
        )

        self.message_edit.clear()

    def _clear_chat(self):
        while self.chat_list_layout.count() > 1:
            item = self.chat_list_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

        self._reply_bubbles_by_message_id.clear()
        self._user_bubbles_by_message_id.clear()
        self._last_assistant_text = ""
        self._add_system_message("对话已清空。")

    def _copy_last_reply(self):
        if not self._last_assistant_text:
            self._add_system_message("当前没有可复制的 ChatGPT 回复。")
            return

        QApplication.clipboard().setText(self._last_assistant_text)
        self._add_system_message("已复制最后一条 ChatGPT 回复。")

    def closeEvent(self, event):
        if server.is_server_running():
            try:
                server.stop_server()
            except Exception as error:
                detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"
                print(detail)
                self._append_log(detail)

        event.accept()


def main():
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)

    app = QApplication(sys.argv)
    app.setFont(QFont("Microsoft YaHei UI", 10))

    window = MainWindow()
    window.show()

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
