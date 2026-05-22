"""设置页（服务状态 + 油猴连接）与桥接地址展示文案。"""
import os

from app.server import get_server_port, get_server_public_host, is_server_running
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

class UiSettingsPageMixin:
    def _tampermonkey_bridge_url_text(self, host, port):
        host = (host or "").strip() or "127.0.0.1"
        port = (port or "").strip() or "5000"
        return f"油猴接口：http://{host}:{port}/api/bridge"

    def _tampermonkey_bridge_hint_text(self, host):
        host = (host or "").strip() or "127.0.0.1"
        lines = [
            "请在油猴菜单「浏览器桥接 · 设置」中填写与上方一致的地址。",
            "服务固定监听 127.0.0.1:5000，仅本机浏览器可用。",
        ]
        token = (os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN") or "").strip()
        if host not in ("127.0.0.1", "localhost", "::1") and not token:
            lines.append(
                "警告：未设置 CHATGPT_PAGE_BRIDGE_TOKEN，Bridge 可能被局域网访问，建议设置 API Token。"
            )
        return "\n".join(lines)

    def _service_host_port_for_display(self, status=None):
        status = status or {}
        if status.get("server_running") and status.get("server_port"):
            return (
                status.get("server_host") or get_server_public_host(),
                str(status.get("server_port")),
            )
        if is_server_running():
            return get_server_public_host(), str(get_server_port() or "")
        return "127.0.0.1", str(getattr(self, "_port_text", None) or "5000")

    def _create_scroll_tab(self):
        """创建设置子页用的纵向可滚动区域，返回 scroll_area、content_widget、content_layout。"""
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        content_widget = QWidget()
        content_widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        content_layout = QVBoxLayout(content_widget)
        content_layout.setContentsMargins(8, 8, 8, 8)
        content_layout.setSpacing(8)
        scroll_area.setWidget(content_widget)
        return scroll_area, content_widget, content_layout

    def _build_settings_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)

        self.settings_scroll, self.settings_tab, self.settings_layout = (
            self._create_scroll_tab()
        )
        self.settings_layout.setContentsMargins(12, 10, 12, 10)
        self.settings_layout.setSpacing(10)

        ops_group, ops_layout = self._make_group_vbox("服务状态")
        ops_layout.setContentsMargins(10, 8, 10, 8)
        ops_layout.setSpacing(8)
        self.settings_service_status_label = QLabel("当前状态：未启动")
        self.settings_service_status_label.setWordWrap(True)
        self.settings_service_status_label.setStyleSheet("color: #333;")
        ops_layout.addWidget(self.settings_service_status_label)
        self.settings_service_hint_label = QLabel("")
        self.settings_service_hint_label.setWordWrap(True)
        self.settings_service_hint_label.setStyleSheet("color: #555;")
        ops_layout.addWidget(self.settings_service_hint_label)
        self.settings_layout.addWidget(ops_group)

        tm_conn_group, tm_conn_layout = self._make_group_vbox("油猴连接")
        tm_conn_layout.setContentsMargins(10, 8, 10, 8)
        tm_conn_layout.setSpacing(8)
        host, port = self._service_host_port_for_display()
        self.tampermonkey_bridge_url_label = QLabel(
            self._tampermonkey_bridge_url_text(host, port)
        )
        self.tampermonkey_bridge_url_label.setWordWrap(True)
        self.tampermonkey_bridge_url_label.setTextInteractionFlags(
            Qt.TextSelectableByMouse
        )
        tm_conn_layout.addWidget(self.tampermonkey_bridge_url_label)
        self.tampermonkey_bridge_hint_label = QLabel(
            self._tampermonkey_bridge_hint_text(host)
        )
        self.tampermonkey_bridge_hint_label.setWordWrap(True)
        self.tampermonkey_bridge_hint_label.setStyleSheet("color: #555;")
        tm_conn_layout.addWidget(self.tampermonkey_bridge_hint_label)
        tm_check_row = QHBoxLayout()
        tm_check_row.setSpacing(8)
        self.check_tampermonkey_btn = QPushButton("检测连接")
        self.check_tampermonkey_btn.setObjectName("PrimaryButton")
        self.check_tampermonkey_btn.setFixedHeight(32)
        self.check_tampermonkey_btn.clicked.connect(self._on_check_tampermonkey)
        tm_check_row.addWidget(self.check_tampermonkey_btn)
        tm_check_row.addStretch(1)
        tm_conn_layout.addLayout(tm_check_row)
        self.settings_layout.addWidget(tm_conn_group)
        self.settings_layout.addStretch(1)

        layout.addWidget(self.settings_scroll, 1)
        self._update_tampermonkey_settings_labels()
        return page

    def _update_tampermonkey_settings_labels(self, status=None):
        """刷新油猴设置页中的桥接接口地址与说明。"""
        if not hasattr(self, "tampermonkey_bridge_url_label"):
            return
        status = status if isinstance(status, dict) else {}
        host, port = self._service_host_port_for_display(status)
        self.tampermonkey_bridge_url_label.setText(
            self._tampermonkey_bridge_url_text(host, port)
        )
        if hasattr(self, "tampermonkey_bridge_hint_label"):
            self.tampermonkey_bridge_hint_label.setText(
                self._tampermonkey_bridge_hint_text(host)
            )
