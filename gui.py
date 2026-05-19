import sys
import time

from PyQt5.QtCore import QObject, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import (
    QApplication,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSplitter,
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


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("油猴联动服务端")
        self.resize(900, 680)
        self.setMinimumSize(780, 580)

        self._notifier = BridgeNotifier()
        self._notifier.log_signal.connect(self._append_log)
        self._notifier.status_signal.connect(self._apply_bridge_status)
        server.set_log_callback(self._notifier.log_signal.emit)
        server.set_status_callback(self._notifier.status_signal.emit)

        self._build_ui()

        self._status_timer = QTimer(self)
        self._status_timer.timeout.connect(self._refresh_status_tick)
        self._status_timer.start(1000)

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)

        root.addWidget(self._build_conn_group())
        root.addWidget(self._build_tampermonkey_group())

        splitter_h = QSplitter(Qt.Horizontal)
        splitter_h.addWidget(self._build_send_group())
        splitter_h.addWidget(self._build_inbound_group())
        splitter_h.setStretchFactor(0, 1)
        splitter_h.setStretchFactor(1, 1)
        root.addWidget(splitter_h, stretch=2)

        root.addWidget(self._build_outbound_group(), stretch=1)
        root.addWidget(self._build_log_group(), stretch=1)

        hint = QLabel("流程：启动服务 → 打开 ChatGPT 并启用 client.user.js → 在此发送消息 → 油猴自动填入并回执。")
        hint.setStyleSheet("color: #555;")
        hint.setWordWrap(True)
        root.addWidget(hint)

    def _build_conn_group(self):
        box = QGroupBox("服务连接")
        layout = QVBoxLayout(box)

        row = QHBoxLayout()
        row.addWidget(QLabel("地址"))
        self.host_edit = QLineEdit("127.0.0.1")
        self.host_edit.setFixedWidth(140)
        row.addWidget(self.host_edit)

        row.addSpacing(12)
        row.addWidget(QLabel("端口"))
        self.port_edit = QLineEdit("5000")
        self.port_edit.setFixedWidth(80)
        row.addWidget(self.port_edit)

        row.addSpacing(20)
        self.status_label = QLabel("服务：未启动")
        row.addWidget(self.status_label)
        row.addStretch()
        layout.addLayout(row)

        btn_row = QHBoxLayout()
        self.start_btn = QPushButton("启动服务")
        self.start_btn.clicked.connect(self._start_server)
        btn_row.addWidget(self.start_btn)

        self.stop_btn = QPushButton("停止服务")
        self.stop_btn.clicked.connect(self._stop_server)
        self.stop_btn.setEnabled(False)
        btn_row.addWidget(self.stop_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)

        return box

    def _build_tampermonkey_group(self):
        box = QGroupBox("油猴连接状态")
        layout = QVBoxLayout(box)

        row1 = QHBoxLayout()
        self.tm_online_label = QLabel("油猴：未知")
        self.tm_last_seen_label = QLabel("最后心跳：-")
        row1.addWidget(self.tm_online_label)
        row1.addSpacing(24)
        row1.addWidget(self.tm_last_seen_label)
        row1.addStretch()
        layout.addLayout(row1)

        self.tm_queue_label = QLabel("待发队列：0")
        layout.addWidget(self.tm_queue_label)

        self.tm_page_label = QLabel("页面：-")
        self.tm_page_label.setWordWrap(True)
        layout.addWidget(self.tm_page_label)

        return box

    def _build_send_group(self):
        box = QGroupBox("发送到油猴 → ChatGPT")
        layout = QVBoxLayout(box)

        self.message_edit = QTextEdit()
        self.message_edit.setPlaceholderText("输入要发送到 ChatGPT 的消息…")
        self.message_edit.setPlainText("你好，这是一条来自服务端的测试消息。")
        layout.addWidget(self.message_edit)

        btn_row = QHBoxLayout()
        send_btn = QPushButton("发送消息")
        send_btn.clicked.connect(self._push_message)
        btn_row.addWidget(send_btn)

        clear_btn = QPushButton("清空输入")
        clear_btn.clicked.connect(self._clear_input)
        btn_row.addWidget(clear_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)

        return box

    def _build_inbound_group(self):
        box = QGroupBox("油猴回传（回执 / 事件）")
        layout = QVBoxLayout(box)

        self.inbound_edit = QTextEdit()
        self.inbound_edit.setReadOnly(True)
        self.inbound_edit.setFont(QFont("Consolas", 9))
        self.inbound_edit.setPlainText("（暂无回传）")
        layout.addWidget(self.inbound_edit)

        return box

    def _build_outbound_group(self):
        box = QGroupBox("最近发出的消息")
        layout = QVBoxLayout(box)

        self.outbound_table = QTableWidget(0, 4)
        self.outbound_table.setHorizontalHeaderLabels(["时间", "ID", "状态", "内容"])
        self.outbound_table.horizontalHeader().setStretchLastSection(True)
        self.outbound_table.setColumnWidth(0, 80)
        self.outbound_table.setColumnWidth(1, 90)
        self.outbound_table.setColumnWidth(2, 80)
        self.outbound_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.outbound_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.outbound_table.verticalHeader().setVisible(False)
        layout.addWidget(self.outbound_table)

        return box

    def _build_log_group(self):
        box = QGroupBox("运行日志")
        layout = QVBoxLayout(box)

        self.log_edit = QTextEdit()
        self.log_edit.setReadOnly(True)
        self.log_edit.setFont(QFont("Consolas", 9))
        layout.addWidget(self.log_edit)

        return box

    @staticmethod
    def _format_ts(ts):
        if not ts:
            return "-"
        return time.strftime("%H:%M:%S", time.localtime(ts))

    def _apply_bridge_status(self, status):
        if status["server_running"]:
            self.status_label.setText(
                f"服务：运行中（{self.host_edit.text().strip()}:{self.port_edit.text().strip()}）"
            )
        else:
            self.status_label.setText("服务：未启动")

        if status["tampermonkey_online"]:
            self.tm_online_label.setText("油猴：在线")
            self.tm_online_label.setStyleSheet("color: #0a7a2f; font-weight: bold;")
        elif status["tampermonkey_last_seen"]:
            self.tm_online_label.setText("油猴：离线")
            self.tm_online_label.setStyleSheet("color: #a66a00;")
        else:
            self.tm_online_label.setText("油猴：未连接")
            self.tm_online_label.setStyleSheet("")

        self.tm_last_seen_label.setText(f"最后心跳：{self._format_ts(status['tampermonkey_last_seen'])}")
        self.tm_queue_label.setText(f"待发队列：{status['queue_length']}")

        page = status.get("tampermonkey_page_url") or "-"
        if len(page) > 120:
            page = page[:120] + "..."
        self.tm_page_label.setText(f"页面：{page}")

        self._render_inbound(status.get("recent_inbound") or [])
        self._render_outbound(status.get("recent_outbound") or [])

    def _render_inbound(self, items):
        if not items:
            self.inbound_edit.setPlainText("（暂无回传）")
            return

        lines = []
        for item in reversed(items):
            ts = self._format_ts(item.get("time"))
            kind = item.get("kind", "?")
            payload = item.get("payload") or {}
            lines.append(f"[{ts}] {kind} {payload}")
        self.inbound_edit.setPlainText("\n".join(lines))

    def _render_outbound(self, items):
        self.outbound_table.setRowCount(0)
        for item in reversed(items):
            content = item.get("content", "")
            if len(content) > 60:
                content = content[:60] + "..."

            row = self.outbound_table.rowCount()
            self.outbound_table.insertRow(row)
            self.outbound_table.setItem(
                row, 0, QTableWidgetItem(self._format_ts(item.get("acked_at") or item.get("delivered_at") or item.get("created_at")))
            )
            self.outbound_table.setItem(row, 1, QTableWidgetItem((item.get("id") or "")[:8] + "…"))
            self.outbound_table.setItem(row, 2, QTableWidgetItem(item.get("status", "")))
            self.outbound_table.setItem(row, 3, QTableWidgetItem(content))

    def _refresh_status_tick(self):
        if server.is_server_running():
            self._apply_bridge_status(server.get_bridge_status())

    def _append_log(self, message):
        self.log_edit.append(message)

    def _update_running_ui(self, running):
        self.host_edit.setEnabled(not running)
        self.port_edit.setEnabled(not running)
        self.start_btn.setEnabled(not running)
        self.stop_btn.setEnabled(running)

    def _parse_port(self):
        try:
            port = int(self.port_edit.text().strip())
        except ValueError:
            QMessageBox.critical(self, "端口错误", "端口必须是数字。")
            return None
        if not (1 <= port <= 65535):
            QMessageBox.critical(self, "端口错误", "端口范围应为 1–65535。")
            return None
        return port

    def _start_server(self):
        host = self.host_edit.text().strip() or "127.0.0.1"
        port = self._parse_port()
        if port is None:
            return

        if server.start_server(host, port):
            self._update_running_ui(True)
            self._apply_bridge_status(server.get_bridge_status())
        else:
            QMessageBox.warning(self, "提示", "服务已在运行中。")

    def _stop_server(self):
        if server.stop_server():
            self._update_running_ui(False)
            self._apply_bridge_status(server.get_bridge_status())

    def _push_message(self):
        if not server.is_server_running():
            QMessageBox.warning(self, "提示", "请先启动服务。")
            return

        content = self.message_edit.toPlainText().strip()
        if not content:
            QMessageBox.warning(self, "提示", "请输入要发送的内容。")
            return

        server.push_message(content)

    def _clear_input(self):
        self.message_edit.clear()

    def closeEvent(self, event):
        if server.is_server_running():
            server.stop_server()
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
