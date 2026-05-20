import os
import traceback

import server
from log_utils import get_log_file_path

from app.models import normalize_remote_chatgpt
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.elided_label import ElidedLabel
from app.ui.widgets.session_list import SessionListWidget
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QCheckBox,
    QComboBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSpinBox,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QPlainTextEdit,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class UiBuilderMixin:
    CHAT_SUB_TAB_CHAT = 0
    CHAT_SUB_TAB_CURSOR_FLOW = 1
    CURSOR_FLOW_TAB_TITLE_BASE = "Cursor 动作编排"

    def _restore_chat_splitter_sizes(self):
        splitter = getattr(self, "chat_splitter", None)
        if splitter is None:
            return
        raw = self._settings.value("ui/chat_splitter_sizes", "")
        if raw:
            parts = [part.strip() for part in str(raw).split(",") if part.strip()]
            if len(parts) == 2:
                try:
                    left = int(parts[0])
                    right = int(parts[1])
                except ValueError as error:
                    self._append_log(
                        "[UI_SPLITTER][RESTORE_FAILED] "
                        f"invalid={raw} error={error}\n{traceback.format_exc()}",
                        echo=True,
                    )
                else:
                    left = max(190, min(260, left))
                    if right >= 300:
                        splitter.setSizes([left, right])
                        self._append_log(
                            f"[UI_SPLITTER][RESTORE] chat_splitter sizes={[left, right]}"
                        )
                        return
        default_sizes = [220, 1000]
        splitter.setSizes(default_sizes)
        self._append_log(
            f"[UI_SPLITTER][DEFAULT] chat_splitter sizes={default_sizes}"
        )

    def _save_chat_splitter_sizes(self, *args):
        splitter = getattr(self, "chat_splitter", None)
        if splitter is None:
            return
        sizes = splitter.sizes()
        if len(sizes) != 2:
            return
        left = max(190, min(260, int(sizes[0])))
        right = int(sizes[1])
        if left <= 0 or right <= 0:
            return
        value = f"{left},{right}"
        self._settings.setValue("ui/chat_splitter_sizes", value)
        self._settings.sync()
        self._append_log(f"[UI_SPLITTER][SAVE] chat_splitter sizes={[left, right]}")

    def _restore_chat_sub_tab_index(self):
        tabs = getattr(self, "chat_sub_tabs", None)
        if tabs is None:
            return
        try:
            index = int(self._settings.value("ui/chat_sub_tab_index", 0) or 0)
        except (TypeError, ValueError) as error:
            self._append_log(
                "[UI_CHAT_SUB_TAB][RESTORE_FAILED] "
                f"error={error}\n{traceback.format_exc()}",
                echo=True,
            )
            index = 0
        if 0 <= index < tabs.count():
            tabs.setCurrentIndex(index)
        self._update_cursor_flow_tab_title_indicator()

    def _save_chat_sub_tab_index(self):
        tabs = getattr(self, "chat_sub_tabs", None)
        if tabs is None:
            return
        self._settings.setValue("ui/chat_sub_tab_index", int(tabs.currentIndex()))
        self._settings.sync()

    def _on_chat_sub_tab_changed(self, index):
        self._save_chat_sub_tab_index()
        self._update_cursor_flow_tab_title_indicator()
        if int(index) == self.CHAT_SUB_TAB_CURSOR_FLOW:
            if hasattr(self, "_refresh_job_scheduler_panel"):
                self._refresh_job_scheduler_panel()

    def _focus_cursor_flow_tab(self):
        tabs = getattr(self, "chat_sub_tabs", None)
        if tabs is None:
            return
        tabs.setCurrentIndex(self.CHAT_SUB_TAB_CURSOR_FLOW)
        if hasattr(self, "task_detail_panel"):
            self.task_detail_panel.setVisible(True)
            btn = getattr(self, "task_detail_toggle_btn", None)
            if btn is not None:
                btn.setText("收起")

    def _update_cursor_flow_tab_title_indicator(self, job=None):
        tabs = getattr(self, "chat_sub_tabs", None)
        if tabs is None or tabs.count() <= self.CHAT_SUB_TAB_CURSOR_FLOW:
            return
        base = self.CURSOR_FLOW_TAB_TITLE_BASE
        show_star = False
        if job is None and hasattr(self, "_get_current_job_snapshot"):
            job = self._get_current_job_snapshot()
        if job:
            status = (job.get("status") or "").strip()
            terminal = {"cursor_done", "cursor_failed", "cancelled"}
            show_star = status not in terminal
        on_chat_tab = tabs.currentIndex() == self.CHAT_SUB_TAB_CHAT
        title = f"{base} *" if show_star and on_chat_tab else base
        tabs.setTabText(self.CHAT_SUB_TAB_CURSOR_FLOW, title)

    def _set_button_role(self, button, role):
        if button is None:
            return
        button.setProperty("btnRole", role)
        button.style().unpolish(button)
        button.style().polish(button)

    def _create_tm_ghost_button(self, text, handler, *, danger=False, tooltip=""):
        btn = QPushButton(text)
        btn.setObjectName("DangerButton" if danger else "PrimaryButton")
        if tooltip:
            btn.setToolTip(tooltip)
        btn.clicked.connect(handler)
        btn.setFixedHeight(30)
        btn.setMinimumHeight(30)
        btn.setMaximumHeight(30)
        btn.setEnabled(True)
        return btn

    def _tm_action_button_specs(self):
        return {
            "open_chatgpt": {
                "text": "打开 ChatGPT",
                "handler": self._on_open_chatgpt_home,
                "danger": False,
                "tooltip": "打开 ChatGPT 首页",
            },
            "bind_current": {
                "text": "绑定当前页面",
                "handler": self._on_bind_current_page,
                "danger": False,
                "tooltip": (
                    "把当前浏览器最近活跃的 ChatGPT 页面绑定到左侧当前本地对话。"
                    "请先切换到目标 ChatGPT 页面，再点击本按钮。"
                ),
            },
            "open_bound": {
                "text": "打开绑定页面",
                "handler": self._on_open_bound_chatgpt_page,
                "danger": False,
                "tooltip": "打开当前对话绑定的 ChatGPT 页面",
            },
            "flash_bound": {
                "text": "定位绑定页",
                "handler": self._flash_bound_chatgpt_page,
                "danger": False,
                "tooltip": (
                    "让当前绑定的 ChatGPT 标签页边框、标题和 favicon 同时闪烁，"
                    "方便确认对应关系"
                ),
            },
            "sync_web": {
                "text": "同步网页对话",
                "handler": self._sync_bound_web_conversation,
                "danger": False,
                "tooltip": "从绑定的 ChatGPT 网页读取完整对话并同步到当前 GUI 聊天窗口",
            },
            "close_bound": {
                "text": "关闭绑定页面",
                "handler": self._on_close_bound_tm_page,
                "danger": True,
                "tooltip": "关闭当前对话绑定的 ChatGPT 页面",
            },
            "close_other": {
                "text": "关闭其他 ChatGPT 页面",
                "handler": self._on_close_other_tm_pages,
                "danger": True,
                "tooltip": (
                    "关闭除当前对话绑定页以外的其他在线 ChatGPT 页面；"
                    "如果绑定页离线，将自动取消。"
                ),
            },
        }

    def _create_tm_action_button_from_spec(self, spec_key, specs=None, object_name=""):
        specs = specs or self._tm_action_button_specs()
        spec = specs[spec_key]
        btn = self._create_tm_ghost_button(
            spec["text"],
            spec["handler"],
            danger=spec["danger"],
            tooltip=spec["tooltip"],
        )
        if object_name:
            btn.setObjectName(object_name)
        elif spec["danger"]:
            btn.setObjectName("DangerButton")
        else:
            btn.setObjectName("PrimaryButton")
        btn.setEnabled(True)
        return btn

    def _ensure_tm_action_buttons(self):
        if getattr(self, "_tm_action_buttons_ready", False):
            return
        self._tm_action_buttons_ready = True
        specs = self._tm_action_button_specs()
        self.open_chatgpt_btn = self._create_tm_action_button_from_spec(
            "open_chatgpt", specs
        )
        self.bind_current_page_btn = self._create_tm_action_button_from_spec(
            "bind_current", specs
        )
        self.chat_open_bound_btn = self._create_tm_action_button_from_spec(
            "open_bound", specs
        )
        self.flash_bound_page_btn = self._create_tm_action_button_from_spec(
            "flash_bound", specs, object_name="flash_bound_page_btn"
        )
        self.sync_web_conversation_btn = self._create_tm_action_button_from_spec(
            "sync_web", specs, object_name="sync_web_conversation_btn"
        )
        self.close_bound_page_btn = self._create_tm_action_button_from_spec(
            "close_bound", specs
        )
        self.close_other_pages_btn = self._create_tm_action_button_from_spec(
            "close_other", specs
        )
        self._apply_tm_action_button_roles()

    def _apply_tm_action_button_roles(self):
        for btn in (
            self.open_chatgpt_btn,
            self.bind_current_page_btn,
            self.chat_open_bound_btn,
            self.flash_bound_page_btn,
            self.sync_web_conversation_btn,
        ):
            btn.setObjectName("PrimaryButton")
            btn.setEnabled(True)
        for btn in (self.close_bound_page_btn, self.close_other_pages_btn):
            btn.setObjectName("DangerButton")
            btn.setEnabled(True)

    def _build_tm_action_buttons(
        self, layout, *, include_page_selector=False
    ):
        self._ensure_tm_action_buttons()
        layout.setSpacing(6)
        row = QHBoxLayout()
        row.setSpacing(6)
        for btn in (
            self.open_chatgpt_btn,
            self.bind_current_page_btn,
            self.chat_open_bound_btn,
            self.flash_bound_page_btn,
            self.sync_web_conversation_btn,
        ):
            row.addWidget(btn)
        row.addStretch()
        for btn in (self.close_bound_page_btn, self.close_other_pages_btn):
            row.addWidget(btn)
        layout.addLayout(row)
        if include_page_selector:
            if not hasattr(self, "tm_page_combo"):
                self.tm_page_combo = QComboBox()
                self.tm_page_combo.setMinimumWidth(180)
                self.tm_page_combo.setSizePolicy(
                    QSizePolicy.Expanding, QSizePolicy.Fixed
                )
                self.tm_page_combo.setToolTip(
                    "显示当前检测到的 ChatGPT 页面状态（不用于选择绑定目标）"
                )
            if not hasattr(self, "tm_page_count_label"):
                self.tm_page_count_label = QLabel("在线 0 / 总 0")
                self.tm_page_count_label.setObjectName("StatusChip")
            self.tm_page_count_label.setWordWrap(False)
            self.tm_page_count_label.setFixedHeight(30)
            self.tm_page_count_label.setMinimumHeight(30)
            self.tm_page_count_label.setMaximumHeight(30)
            self.tm_page_count_label.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
            self.tm_page_combo.setFixedHeight(30)
            self.tm_page_combo.setMinimumHeight(30)
            self.tm_page_combo.setMaximumHeight(30)
    def _build_tm_debug_action_buttons(self, layout):
        specs = self._tm_action_button_specs()
        debug_specs = [
            ("open_chatgpt", specs["open_chatgpt"]),
            ("open_bound", specs["open_bound"]),
            ("flash_bound", specs["flash_bound"]),
            ("sync_web", specs["sync_web"]),
            ("bind_current", specs["bind_current"]),
            (
                "close_selected",
                {
                    "text": "关闭选中页面",
                    "handler": self._on_close_selected_tm_page,
                    "danger": True,
                    "tooltip": "",
                },
            ),
            ("close_other", specs["close_other"]),
            (
                "close_bound_debug",
                {
                    "text": "关闭当前绑定页面",
                    "handler": self._on_close_bound_tm_page,
                    "danger": True,
                    "tooltip": specs["close_bound"]["tooltip"],
                },
            ),
        ]
        layout.setSpacing(6)
        for _key, spec in debug_specs:
            layout.addWidget(
                self._create_tm_ghost_button(
                    spec["text"],
                    spec["handler"],
                    danger=spec["danger"],
                    tooltip=spec["tooltip"],
                )
            )
    def _tm_page_combo_label(self, item):
        client_id = (item.get("client_id") or "").strip() or "-"
        page_type = (item.get("page_type") or "").strip() or "页面"
        profile = self._tm_client_sync_profile(item)
        state_tag_map = {
            "syncable": "[可同步]",
            "stale": "[不可同步]",
            "online": "[在线]",
            "offline": "[离线]",
        }
        online_tag = state_tag_map.get(profile.get("state"), "[离线]")
        if page_type == "conversation":
            type_text = "对话页"
        elif page_type == "home":
            type_text = "首页"
        else:
            type_text = page_type
        conv = self._short_conv_id(self._client_conversation_id(item))
        path_hint = self._short_page_label(item)
        last_focus_ago = self._format_last_seen_ago(item.get("last_focus_at"))
        if last_focus_ago and last_focus_ago != "-":
            focus_text = f"焦点{last_focus_ago}"
        else:
            focus_text = self._format_last_seen_ago(item.get("last_seen"))
        return (
            f"{online_tag} {type_text} | {client_id} | {path_hint} | {focus_text}"
        )

    def _tm_page_combo_tooltip(self, item):
        client_id = (item.get("client_id") or "").strip() or "-"
        page_url = (item.get("page_url") or "").strip() or "-"
        conv = self._client_conversation_id(item) or "-"
        profile = self._tm_client_sync_profile(item)
        return "\n".join([
            f"client_id: {client_id}",
            f"conversation_id: {conv}",
            f"url: {page_url}",
            f"page_type: {(item.get('page_type') or '-').strip() or '-'}",
            f"visibility: {profile.get('visibility') or '-'}",
            f"has_focus: {'yes' if item.get('has_focus') else 'no'}",
            f"last_focus: {self._format_last_seen_ago(item.get('last_focus_at'))}",
            f"heartbeat: {self._format_last_seen_ago(item.get('last_seen'))}",
        ])
    def _tm_page_combo_sort_key(self, item):
        profile = self._tm_client_sync_profile(item)
        state_rank = {
            "syncable": 3,
            "online": 2,
            "stale": 1,
            "offline": 0,
        }.get(profile.get("state"), 0)
        page_type = (item.get("page_type") or "").strip()
        conv_rank = 1 if page_type == "conversation" else 0
        last_seen = float(item.get("last_seen") or 0)
        return (state_rank, conv_rank, last_seen)

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
            idx = self.tm_page_combo.count()
            self.tm_page_combo.addItem(label, client_id)
            self.tm_page_combo.setItemData(
                idx, self._tm_page_combo_tooltip(item), Qt.ToolTipRole
            )
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
    def _tampermonkey_bridge_url_text(self, host, port):
        host = (host or "").strip() or "127.0.0.1"
        port = (port or "").strip() or "5000"
        if host in ("0.0.0.0", "::"):
            return (
                f"油猴接口（本机）：http://127.0.0.1:{port}/api/bridge\n"
                f"油猴接口（局域网）：http://<本机局域网IP>:{port}/api/bridge"
            )
        return f"油猴接口：http://{host}:{port}/api/bridge"

    def _tampermonkey_bridge_hint_text(self, host):
        host = (host or "").strip() or "127.0.0.1"
        lines = [
            "请在油猴菜单「浏览器桥接 · 设置」中填写与上方一致的地址。"
        ]
        if host in ("127.0.0.1", "localhost", "::1"):
            lines.append("当前监听本机地址，仅本机浏览器可用。")
        elif host in ("0.0.0.0", "::"):
            lines.append(
                "当前监听全部网卡。局域网浏览器请填写本机局域网 IP，"
                "例如 http://192.168.1.20:端口/api/bridge。"
            )
        else:
            lines.append(f"当前监听 {host}，请确保油猴中的地址可从浏览器访问。")
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
                status.get("server_host") or server.get_server_public_host(),
                str(status.get("server_port")),
            )
        if server.is_server_running():
            return server.get_server_public_host(), str(server.get_server_port() or "")
        bind_host = self._resolve_listen_host()
        port = self._port_text or self.port_edit.text().strip()
        if bind_host in ("0.0.0.0", "::"):
            display_host = "127.0.0.1"
        else:
            display_host = bind_host or "127.0.0.1"
        return display_host, port

    def _update_tampermonkey_settings_labels(self, status=None):
        status = status or self._last_bridge_status or {}
        host, port = self._service_host_port_for_display(status)
        self.tm_bridge_url_label.setText(
            self._tampermonkey_bridge_url_text(host, port)
        )
        if hasattr(self, "tm_bridge_hint_label"):
            self.tm_bridge_hint_label.setText(
                self._tampermonkey_bridge_hint_text(host)
            )
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
        self.main_tabs.setObjectName("MainTabs")
        self.chat_page = self._build_chat_page()
        self.log_page = self._build_log_page()
        self.settings_page = self._build_settings_page()
        self.main_tabs.addTab(self.chat_page, "聊天")
        self.main_tabs.addTab(self.log_page, "日志")
        self.main_tabs.addTab(self.settings_page, "设置")
        root.addWidget(self.main_tabs, stretch=1)
        if hasattr(self, "_init_log_tab_state"):
            self._init_log_tab_state()
        self.main_tabs.currentChanged.connect(self._on_main_tab_changed)
        self.statusBar().showMessage("未启动服务")
        self._apply_app_style()
        self._sync_page_url_detail_widgets()
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
            QTabWidget#MainTabs::pane {
                margin-top: 0px;
                padding: 0px;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                top: -1px;
            }
            QTabWidget#MainTabs QTabBar::tab {
                padding: 7px 16px;
                margin-right: 2px;
            }
            QTabWidget#LogSubTabs::pane {
                margin-top: 0px;
                padding: 4px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                top: -1px;
            }
            QTabWidget#LogSubTabs QTabBar::tab {
                padding: 6px 14px;
                margin-right: 2px;
            }
            QTabWidget#ChatSubTabs::pane {
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                background: #ffffff;
                top: -1px;
            }
            QTabWidget#ChatSubTabs QTabBar::tab {
                min-width: 120px;
                min-height: 30px;
                padding: 6px 14px;
                border: 1px solid #d1d5db;
                border-bottom: none;
                background: #f8fafc;
                color: #374151;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                margin-right: 2px;
            }
            QTabWidget#ChatSubTabs QTabBar::tab:selected {
                background: #2563eb;
                color: #ffffff;
                border-color: #1d4ed8;
                font-weight: 600;
            }
            QTabWidget#ChatSubTabs QTabBar::tab:hover:!selected {
                background: #eff6ff;
                color: #1d4ed8;
            }
            QLabel#LogSectionTitle {
                font-size: 13px;
                font-weight: 700;
                color: #111827;
                padding: 0px;
                margin: 0px;
            }
            QPlainTextEdit#RuntimeLogText {
                font-family: Consolas, Monaco, monospace;
                font-size: 12px;
                border: 1px solid #d1d5db;
                background: #ffffff;
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
                background: #2563eb;
                color: #ffffff;
                border: 1px solid #1d4ed8;
                border-radius: 6px;
                padding: 5px 12px;
                min-height: 28px;
                font-size: 13px;
                font-weight: 600;
            }
            QPushButton:hover {
                background: #1d4ed8;
                color: #ffffff;
                border: 1px solid #1e40af;
            }
            QPushButton:pressed {
                background: #1e40af;
                color: #ffffff;
                border: 1px solid #1e3a8a;
            }
            QPushButton:disabled {
                background: #3b82f6;
                color: #ffffff;
                border: 1px solid #2563eb;
            }
            QPushButton[btnRole="blueSolid"],
            QPushButton[btnRole="blueGraySolid"],
            QPushButton[btnRole="primary"],
            QPushButton[btnRole="action"],
            QPushButton[btnRole="bluePrimary"],
            QPushButton[btnRole="secondary"] {
                background: #2563eb;
                color: #ffffff;
                border: 1px solid #1d4ed8;
                font-weight: 600;
            }
            QPushButton[btnRole="blueSolid"]:hover,
            QPushButton[btnRole="blueGraySolid"]:hover,
            QPushButton[btnRole="primary"]:hover,
            QPushButton[btnRole="action"]:hover,
            QPushButton[btnRole="bluePrimary"]:hover,
            QPushButton[btnRole="secondary"]:hover {
                background: #1d4ed8;
                color: #ffffff;
                border-color: #1e40af;
            }
            QPushButton[btnRole="blueSolid"]:pressed,
            QPushButton[btnRole="blueGraySolid"]:pressed,
            QPushButton[btnRole="primary"]:pressed,
            QPushButton[btnRole="action"]:pressed,
            QPushButton[btnRole="bluePrimary"]:pressed,
            QPushButton[btnRole="secondary"]:pressed {
                background: #1e40af;
                color: #ffffff;
                border-color: #1e3a8a;
            }
            QPushButton[btnRole="blueSolid"]:disabled,
            QPushButton[btnRole="blueGraySolid"]:disabled,
            QPushButton[btnRole="primary"]:disabled,
            QPushButton[btnRole="action"]:disabled,
            QPushButton[btnRole="bluePrimary"]:disabled,
            QPushButton[btnRole="secondary"]:disabled {
                background: #3b82f6;
                color: #ffffff;
                border: 1px solid #2563eb;
            }
            QPushButton[btnRole="redSolid"],
            QPushButton[btnRole="danger"],
            QPushButton[btnRole="dangerPrimary"] {
                background: #dc2626;
                color: #ffffff;
                border: 1px solid #b91c1c;
                font-weight: 600;
            }
            QPushButton[btnRole="redSolid"]:hover,
            QPushButton[btnRole="danger"]:hover,
            QPushButton[btnRole="dangerPrimary"]:hover {
                background: #b91c1c;
                color: #ffffff;
            }
            QPushButton[btnRole="redSolid"]:pressed,
            QPushButton[btnRole="danger"]:pressed,
            QPushButton[btnRole="dangerPrimary"]:pressed {
                background: #991b1b;
                color: #ffffff;
            }
            QPushButton[btnRole="redSolid"]:disabled,
            QPushButton[btnRole="danger"]:disabled,
            QPushButton[btnRole="dangerPrimary"]:disabled {
                background: #ef4444;
                color: #ffffff;
                border: 1px solid #dc2626;
            }
            QPushButton#PrimaryButton,
            QPushButton#GhostButton,
            QPushButton#CompactButton,
            QPushButton#PrimaryButtonCompact,
            QPushButton#NewSessionButton,
            QPushButton#CopySessionUrlButton,
            QPushButton#OpenSessionUrlButton,
            QPushButton#CopyCurrentLogButton {
                background: #2563eb;
                color: #ffffff;
                border: 1px solid #1d4ed8;
                border-radius: 6px;
                padding: 5px 12px;
                font-weight: 600;
            }
            QPushButton#PrimaryButton:hover,
            QPushButton#GhostButton:hover,
            QPushButton#CompactButton:hover,
            QPushButton#PrimaryButtonCompact:hover,
            QPushButton#NewSessionButton:hover,
            QPushButton#CopySessionUrlButton:hover,
            QPushButton#OpenSessionUrlButton:hover,
            QPushButton#CopyCurrentLogButton:hover {
                background: #1d4ed8;
                color: #ffffff;
            }
            QPushButton#PrimaryButton:pressed,
            QPushButton#GhostButton:pressed,
            QPushButton#CompactButton:pressed,
            QPushButton#PrimaryButtonCompact:pressed,
            QPushButton#NewSessionButton:pressed,
            QPushButton#CopySessionUrlButton:pressed,
            QPushButton#OpenSessionUrlButton:pressed,
            QPushButton#CopyCurrentLogButton:pressed {
                background: #1e40af;
                color: #ffffff;
            }
            QPushButton#PrimaryButton:disabled,
            QPushButton#GhostButton:disabled,
            QPushButton#CompactButton:disabled,
            QPushButton#PrimaryButtonCompact:disabled,
            QPushButton#NewSessionButton:disabled,
            QPushButton#CopySessionUrlButton:disabled,
            QPushButton#OpenSessionUrlButton:disabled,
            QPushButton#CopyCurrentLogButton:disabled {
                background: #3b82f6;
                color: #ffffff;
                border: 1px solid #2563eb;
            }
            QPushButton#PrimaryButtonCompact {
                font-size: 12px;
                padding: 0px 10px;
                min-height: 42px;
            }
            QPushButton#GhostButton {
                padding: 4px 10px;
            }
            QPushButton#CompactButton {
                padding: 3px 10px;
                min-height: 20px;
                font-size: 12px;
            }
            QPushButton#NewSessionButton {
                padding: 8px 12px;
                border-radius: 8px;
            }
            QPushButton#CopyCurrentLogButton {
                min-height: 28px;
                padding: 4px 12px;
            }
            QPushButton#CopySessionUrlButton,
            QPushButton#OpenSessionUrlButton {
                min-height: 26px;
                padding: 3px 10px;
            }
            QPushButton#DangerButton,
            QPushButton#DangerGhostButton {
                background: #dc2626;
                color: #ffffff;
                border: 1px solid #b91c1c;
                border-radius: 6px;
                padding: 5px 12px;
                font-weight: 600;
            }
            QPushButton#DangerButton:hover,
            QPushButton#DangerGhostButton:hover {
                background: #b91c1c;
                color: #ffffff;
            }
            QPushButton#DangerButton:pressed,
            QPushButton#DangerGhostButton:pressed {
                background: #991b1b;
                color: #ffffff;
            }
            QPushButton#DangerButton:disabled,
            QPushButton#DangerGhostButton:disabled {
                background: #ef4444;
                color: #ffffff;
                border: 1px solid #dc2626;
            }
            QPushButton#DangerGhostButton {
                padding: 4px 10px;
            }
            QPushButton#WarningButton {
                background: #f97316;
                color: #ffffff;
                border: 1px solid #ea580c;
                border-radius: 6px;
                padding: 5px 12px;
                font-weight: 600;
            }
            QPushButton#WarningButton:hover {
                background: #ea580c;
                color: #ffffff;
            }
            QPushButton#WarningButton:pressed {
                background: #c2410c;
                color: #ffffff;
            }
            QPushButton#WarningButton:disabled {
                background: #fb923c;
                color: #ffffff;
                border: 1px solid #f97316;
            }
            QPushButton#SuccessButton {
                background: #16a34a;
                color: #ffffff;
                border: 1px solid #15803d;
                border-radius: 6px;
                padding: 5px 12px;
                font-weight: 600;
            }
            QPushButton#SuccessButton:hover {
                background: #15803d;
                color: #ffffff;
            }
            QPushButton#SuccessButton:pressed {
                background: #166534;
                color: #ffffff;
            }
            QPushButton#SuccessButton:disabled {
                background: #22c55e;
                color: #ffffff;
                border: 1px solid #16a34a;
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
            QLabel#StatusChip[state="info"] {
                background: #eff6ff;
                border-color: #bfdbfe;
                color: #1d4ed8;
            }
            QLabel#StatusBadgeOk {
                background: #dcfce7;
                color: #166534;
                border: 1px solid #86efac;
                border-radius: 6px;
                padding: 4px 10px;
            }
            QLabel#StatusBadgeWarn {
                background: #fef3c7;
                color: #92400e;
                border: 1px solid #fcd34d;
                border-radius: 6px;
                padding: 4px 10px;
            }
            QLabel#StatusBadgeError {
                background: #fee2e2;
                color: #991b1b;
                border: 1px solid #fca5a5;
                border-radius: 6px;
                padding: 4px 10px;
            }
            QLabel#StatusBadgeNeutral {
                background: #f3f4f6;
                color: #374151;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                padding: 4px 10px;
            }
            QLabel#TmBindMismatchHint {
                color: #8d6e00;
                font-size: 12px;
                padding: 0px 4px;
            }
            QLabel#TmBindMismatchHint[state="info"] {
                color: #1d4ed8;
            }
            QLabel#TmBindMismatchHint[state="warn"] {
                color: #8d6e00;
            }
            QLabel#TmBindMismatchHint[state="error"] {
                color: #b71c1c;
            }
            QLabel#StatusRelationLine {
                color: #5b6472;
                font-size: 12px;
                padding: 0px 4px;
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
                background: #ffffff;
                border: 1px solid #b7e4c7;
            }
            QWidget#ChatPanel[bindState="bound_offline"] {
                background: #ffffff;
                border: 1px solid #fca5a5;
            }
            QWidget#ChatPanel[bindState="unbound_optional"] {
                background: #ffffff;
                border: 1px solid #e5e7eb;
            }
            QWidget#ChatPanel[bindState="unbound_required"] {
                background: #ffffff;
                border: 1px solid #fcd34d;
            }
            QWidget#ChatPanel[bindState="pending_bind"],
            QWidget#ChatPanel[bindState="waiting_bound_reopen"] {
                background: #ffffff;
                border: 1px solid #fcd34d;
            }
            QWidget#ChatPanel[bindState="prebound_home"] {
                background: #ffffff;
                border: 1px solid #b7e4c7;
            }
            QWidget#StatusDetailPanel {
                background: #f8fafc;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
            }
            QLabel#ChatBindWarning {
                background: #fef2f2;
                color: #991b1b;
                border: 1px solid #fecaca;
                border-radius: 6px;
                padding: 4px 8px;
                font-size: 12px;
            }
            QWidget#JobTaskBar {
                background: #eff6ff;
                border: 1px solid #bfdbfe;
                border-radius: 8px;
            }
            QLabel#JobTaskBarStatus {
                color: #1e3a8a;
                font-size: 12px;
                font-weight: 600;
            }
            QWidget#SessionSidebar {
                background: #f3f4f6;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QWidget#CurrentSessionHeader {
                background: transparent;
            }
            QLabel#CurrentSessionTitle {
                color: #111827;
                font-size: 15px;
                font-weight: 600;
                padding: 0px 4px;
            }
            QLabel#CurrentSessionUrlLabel {
                font-size: 12px;
                color: #475569;
                background: #f8fafc;
                border: 1px solid #e5e7eb;
                border-radius: 6px;
                padding: 4px 8px;
            }
            QListWidget#SessionList {
                background: #f3f4f6;
                border: none;
                outline: none;
            }
            QListWidget#SessionList::item {
                border: none;
                background: transparent;
                padding: 0px;
                margin: 0px;
            }
            QListWidget#SessionList::item:selected {
                background: transparent;
                border: none;
            }
            QWidget#SessionListItem {
                background: transparent;
                border: none;
            }
            QFrame#SessionCard {
                background: #fff7ed;
                border: 1px solid #fed7aa;
                border-radius: 8px;
            }
            QFrame#SessionCard[currentSession="true"] {
                background: #ecfdf5;
                border: 1px solid #86efac;
            }
            QFrame#SessionCard:hover {
                background: #f8fafc;
                border-color: #93c5fd;
            }
            QFrame#SessionCard[currentSession="true"]:hover {
                background: #dcfce7;
                border-color: #4ade80;
            }
            QFrame#SessionListLeftBar[currentSession="true"] {
                background: #22c55e;
                min-width: 5px;
                max-width: 5px;
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
                font-size: 11px;
                padding: 1px 6px;
                border-radius: 6px;
            }
            QLabel#SessionPendingDot {
                color: #2563eb;
                font-size: 14px;
                background: transparent;
            }
            QLabel#SessionCurrentBadge {
                font-size: 10px;
                font-weight: 600;
            }
            QLineEdit#SessionSearchInput {
                background: #ffffff;
                border: 1px solid #d8dce3;
                border-radius: 8px;
                padding: 6px 10px;
            }
            QWidget#ChatPage {
                background: #f8fafc;
            }
            QWidget#ChatHeaderBlock {
                background: #ffffff;
                border: none;
            }
            QScrollArea#ChatScrollArea {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QScrollArea#ChatScrollArea[bindState="bound_online"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QScrollArea#ChatScrollArea[bindState="bound_offline"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QScrollArea#ChatScrollArea[bindState="unbound_optional"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QScrollArea#ChatScrollArea[bindState="unbound_required"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QScrollArea#ChatScrollArea[bindState="pending_bind"],
            QScrollArea#ChatScrollArea[bindState="waiting_bound_reopen"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QScrollArea#ChatScrollArea[bindState="prebound_home"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QWidget#ChatViewport {
                background: #f7f8fa;
            }
            QWidget#ChatViewport[bindState="bound_online"],
            QWidget#ChatViewport[bindState="bound_offline"],
            QWidget#ChatViewport[bindState="unbound_optional"],
            QWidget#ChatViewport[bindState="unbound_required"],
            QWidget#ChatViewport[bindState="pending_bind"],
            QWidget#ChatViewport[bindState="waiting_bound_reopen"],
            QWidget#ChatViewport[bindState="prebound_home"] {
                background: #f7f8fa;
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
            QWidget#TaskStatusBar {
                background: #f8fafc;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
            }
            QLabel#TaskStatusSummary {
                font-size: 12px;
                color: #111827;
            }
            QWidget#TaskDetailPanel {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
            }
            QScrollArea#TaskDetailScroll {
                background: transparent;
                border: none;
            }
            QWidget#TaskDetailContent {
                background: #ffffff;
            }
            QFrame#TaskCard {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
            }
            QLabel#TaskCardTitle {
                font-size: 13px;
                font-weight: 700;
                color: #111827;
            }
            QLabel#TaskFieldName {
                font-size: 12px;
                font-weight: 600;
                color: #374151;
            }
            QLabel#TaskFieldValue {
                font-size: 12px;
                color: #111827;
            }
            QLabel#TaskFlowLabel {
                font-size: 12px;
                color: #111827;
            }
            QLabel#TaskHintLabel {
                font-size: 12px;
                color: #6b7280;
            }
            QPlainTextEdit#JobLogText {
                background: #111827;
                color: #d1d5db;
                border: 1px solid #374151;
                border-radius: 8px;
                padding: 8px;
                font-family: Consolas, Monaco, monospace;
                font-size: 12px;
            }
            """
        )
    def _build_chat_page(self):
        page = QWidget()
        page.setObjectName("ChatPage")
        page_layout = QVBoxLayout(page)
        page_layout.setContentsMargins(8, 6, 8, 8)
        page_layout.setSpacing(8)

        self._chat_status_group = self._build_chat_status_bar()
        self.bridge_status_panel = QFrame()
        self.bridge_status_panel.setObjectName("BridgeStatusPanel")
        self.bridge_status_panel.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        panel_layout = QVBoxLayout(self.bridge_status_panel)
        panel_layout.setContentsMargins(8, 4, 8, 4)
        panel_layout.setSpacing(0)
        panel_layout.addWidget(self._chat_status_group)
        page_layout.addWidget(self.bridge_status_panel, 0)
        self.bridge_status_panel.setVisible(self._show_top_status_bar)
        self._sync_bridge_status_panel_height()

        tool_col = QVBoxLayout()
        tool_col.setSpacing(4)
        self._build_tm_action_buttons(
            tool_col,
            include_page_selector=False,
        )
        page_layout.addLayout(tool_col, 0)

        self._chat_panel = self._build_chat_panel()
        page_layout.addWidget(self._chat_panel, 1)
        return page

    def _on_toggle_status_detail(self):
        panel = getattr(self, "tm_status_detail_panel", None)
        btn = getattr(self, "toggle_status_detail_btn", None)
        if panel is None or btn is None:
            return
        visible = not panel.isVisible()
        panel.setVisible(visible)
        btn.setText("收起" if visible else "详情")
        self._sync_bridge_status_panel_height()

    def _sync_bridge_status_panel_height(self):
        panel = getattr(self, "bridge_status_panel", None)
        if panel is None:
            return
        base_h = 44
        detail_panel = getattr(self, "tm_status_detail_panel", None)
        if detail_panel is not None and detail_panel.isVisible():
            base_h += detail_panel.sizeHint().height() + 6
        mismatch = getattr(self, "tm_bind_mismatch_label", None)
        if mismatch is not None and (mismatch.text() or "").strip():
            base_h += 24
        h = max(48, base_h)
        panel.setFixedHeight(h)
        panel.setMinimumHeight(h)
        panel.setMaximumHeight(16777215)

    def _build_log_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 6, 8, 8)
        layout.setSpacing(6)

        self.log_tabs = QTabWidget()
        self.log_tabs.setObjectName("LogSubTabs")
        layout.addWidget(self.log_tabs, stretch=1)

        self.run_log_page = QWidget()
        run_log_layout = QVBoxLayout(self.run_log_page)
        run_log_layout.setContentsMargins(0, 0, 0, 0)
        run_log_layout.setSpacing(6)

        run_log_toolbar = QHBoxLayout()
        run_log_toolbar.setContentsMargins(0, 0, 0, 0)
        run_log_toolbar.setSpacing(6)
        self.refresh_log_btn = QPushButton("刷新日志")
        self.refresh_log_btn.setObjectName("PrimaryButton")
        self.refresh_log_btn.setToolTip("从 log.txt 重新加载最近 1000 行（后台线程）")
        self.refresh_log_btn.clicked.connect(self._on_refresh_log_clicked)
        run_log_toolbar.addWidget(self.refresh_log_btn)
        self.copy_current_log_btn = QPushButton("复制日志")
        self.copy_current_log_btn.setObjectName("CopyCurrentLogButton")
        self.copy_current_log_btn.setToolTip(
            "复制当前选中的日志子页内容（运行日志、油猴事件、发出消息、服务状态、任务日志）"
        )
        self.copy_current_log_btn.clicked.connect(self._copy_current_log_tab_text)
        run_log_toolbar.addWidget(self.copy_current_log_btn)
        self.clear_runtime_log_btn = QPushButton("清空运行日志")
        self.clear_runtime_log_btn.setObjectName("DangerButton")
        self.clear_runtime_log_btn.clicked.connect(self._clear_runtime_log)
        run_log_toolbar.addWidget(self.clear_runtime_log_btn)
        self.open_log_dir_btn = QPushButton("打开日志目录")
        self.open_log_dir_btn.setObjectName("PrimaryButton")
        self.open_log_dir_btn.setToolTip("在资源管理器中打开 log.txt 所在目录")
        self.open_log_dir_btn.clicked.connect(self._on_open_log_dir_clicked)
        run_log_toolbar.addWidget(self.open_log_dir_btn)
        run_log_toolbar.addStretch(1)
        run_log_layout.addLayout(run_log_toolbar)

        filter_row = QHBoxLayout()
        filter_row.setContentsMargins(0, 0, 0, 0)
        filter_row.setSpacing(6)
        self.log_filter_edit = QLineEdit()
        self.log_filter_edit.setPlaceholderText("过滤运行日志（300ms 防抖）")
        self.log_filter_edit.setClearButtonEnabled(True)
        self.log_filter_edit.textChanged.connect(
            lambda: self._log_filter_timer.start(300)
        )
        filter_row.addWidget(self.log_filter_edit, stretch=1)
        run_log_layout.addLayout(filter_row)

        self.log_edit = QPlainTextEdit()
        self.log_edit.setFont(QFont("Consolas", 9))
        self._configure_runtime_log_edit(self.log_edit)
        run_log_layout.addWidget(self.log_edit, stretch=1)
        self.log_tabs.addTab(self.run_log_page, "运行日志")

        self.event_log_page = QWidget()
        event_log_layout = QVBoxLayout(self.event_log_page)
        event_log_layout.setContentsMargins(0, 0, 0, 0)
        event_log_layout.setSpacing(6)
        event_log_toolbar = QHBoxLayout()
        event_log_toolbar.setContentsMargins(0, 0, 0, 0)
        event_log_toolbar.setSpacing(6)
        self.clear_event_log_btn = QPushButton("清空油猴事件")
        self.clear_event_log_btn.setObjectName("DangerButton")
        self.clear_event_log_btn.clicked.connect(
            lambda: self._clear_log_widget(self.event_log_edit, "油猴事件")
        )
        event_log_toolbar.addWidget(self.clear_event_log_btn)
        event_log_toolbar.addStretch(1)
        event_log_layout.addLayout(event_log_toolbar)
        self.event_log_edit = QPlainTextEdit()
        self.event_log_edit.setReadOnly(True)
        self.event_log_edit.setLineWrapMode(QPlainTextEdit.NoWrap)
        self.event_log_edit.setMaximumBlockCount(500)
        self.event_log_edit.setFont(QFont("Consolas", 9))
        event_log_layout.addWidget(self.event_log_edit, stretch=1)
        self.log_tabs.addTab(self.event_log_page, "油猴事件")
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
        self.status_log_edit = QPlainTextEdit()
        self.status_log_edit.setReadOnly(True)
        self.status_log_edit.setLineWrapMode(QPlainTextEdit.NoWrap)
        self.status_log_edit.setMaximumBlockCount(200)
        self.status_log_edit.setFont(QFont("Consolas", 9))
        self.log_tabs.addTab(self.status_log_edit, "服务状态")

        self.job_log_page = QWidget()
        job_log_layout = QVBoxLayout(self.job_log_page)
        job_log_layout.setContentsMargins(0, 0, 0, 0)
        job_log_layout.setSpacing(6)
        job_log_toolbar = QHBoxLayout()
        job_log_toolbar.setContentsMargins(0, 0, 0, 0)
        job_log_toolbar.setSpacing(6)
        self.clear_job_log_btn = QPushButton("清空任务日志")
        self.clear_job_log_btn.setObjectName("DangerButton")
        self.clear_job_log_btn.clicked.connect(
            lambda: self._clear_log_widget(self.job_log_edit, "任务日志")
        )
        job_log_toolbar.addWidget(self.clear_job_log_btn)
        job_log_toolbar.addStretch(1)
        job_log_layout.addLayout(job_log_toolbar)
        self.job_log_edit = QPlainTextEdit()
        self.job_log_edit.setObjectName("JobLogText")
        self.job_log_edit.setReadOnly(True)
        self.job_log_edit.setLineWrapMode(QPlainTextEdit.WidgetWidth)
        self.job_log_edit.setMaximumBlockCount(2000)
        self.job_log_edit.setFont(QFont("Consolas", 9))
        job_log_layout.addWidget(self.job_log_edit, stretch=1)
        self.log_tabs.addTab(self.job_log_page, "任务日志")

        return page

    def _copy_current_log_tab_text(self):
        log_tabs = getattr(self, "log_tabs", None)
        if log_tabs is None:
            self._set_tm_action_hint("未找到日志页。")
            self._append_log("[LOG_COPY][FAILED] reason=no_log_tabs", echo=True)
            return

        if hasattr(self, "_is_runtime_log_subtab_active") and self._is_runtime_log_subtab_active():
            if hasattr(self, "_on_copy_log_clicked"):
                self._on_copy_log_clicked()
            return

        if (
            log_tabs.currentWidget() is getattr(self, "log_edit", None)
            and hasattr(self, "_on_copy_log_clicked")
        ):
            self._on_copy_log_clicked()
            return

        current_widget = log_tabs.currentWidget()
        if current_widget is None:
            self._set_tm_action_hint("未找到当前日志页。")
            self._append_log("[LOG_COPY][FAILED] reason=no_current_widget", echo=True)
            return

        text = ""

        if isinstance(current_widget, QTableWidget):
            headers = []
            for col in range(current_widget.columnCount()):
                header_item = current_widget.horizontalHeaderItem(col)
                headers.append((header_item.text() if header_item else "").strip())
            lines = []
            if any(headers):
                lines.append("\t".join(headers))
            for row in range(current_widget.rowCount()):
                row_cells = []
                for col in range(current_widget.columnCount()):
                    item = current_widget.item(row, col)
                    row_cells.append((item.text() if item else "").replace("\t", " ").strip())
                lines.append("\t".join(row_cells))
            text = "\n".join(lines)
        else:
            text_widget = None
            if hasattr(current_widget, "toPlainText"):
                text_widget = current_widget
            else:
                plain_children = current_widget.findChildren(QPlainTextEdit)
                if plain_children:
                    text_widget = plain_children[0]
                if text_widget is None:
                    text_children = current_widget.findChildren(QTextEdit)
                    if text_children:
                        text_widget = text_children[0]
            if text_widget is None:
                self._set_tm_action_hint("当前日志页没有可复制的文本。")
                self._append_log("[LOG_COPY][FAILED] reason=no_text_widget", echo=True)
                return
            text = text_widget.toPlainText()

        if not (text or "").strip():
            self._set_tm_action_hint("当前日志为空。")
            self._append_log("[LOG_COPY][EMPTY]", echo=True)
            return

        QApplication.clipboard().setText(text)

        tab_name = log_tabs.tabText(log_tabs.currentIndex())
        self._set_tm_action_hint(f"已复制当前日志，共 {len(text)} 个字符。")
        self._append_log(
            f"[LOG_COPY][DONE] tab={tab_name} chars={len(text)}",
            echo=True,
        )

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
        self.settings_tabs = QTabWidget()
        layout.addWidget(self.settings_tabs, 1)
        # --- 服务设置
        (
            self.service_scroll,
            self.service_tab,
            self.service_layout,
        ) = self._create_scroll_tab()
        service_form_host = QWidget()
        service_form_host.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        service_form = QFormLayout(service_form_host)
        service_form.setFieldGrowthPolicy(QFormLayout.ExpandingFieldsGrow)
        self.enable_lan_access_cb = QCheckBox("允许局域网访问（监听 0.0.0.0）")
        self.enable_lan_access_cb.setChecked(self._enable_lan_access)
        self.enable_lan_access_cb.toggled.connect(self._on_enable_lan_access_changed)
        self.listen_host_label = QLabel()
        self.listen_host_label.setWordWrap(True)
        self._update_listen_host_label()
        self.port_edit = QLineEdit(self._port_text)
        self.port_edit.setFixedWidth(80)
        service_form.addRow("局域网访问", self.enable_lan_access_cb)
        service_form.addRow("监听地址", self.listen_host_label)
        service_form.addRow("端口 port", self.port_edit)
        self.auto_start_server_cb = QCheckBox("启动 GUI 时自动启动服务")
        self.auto_start_server_cb.setChecked(self._auto_start_server)
        service_form.addRow("", self.auto_start_server_cb)
        service_btn_row = QHBoxLayout()
        self.settings_start_btn = QPushButton("启动服务")
        self.settings_stop_btn = QPushButton("停止服务")
        self.settings_restart_btn = QPushButton("重启服务并应用")
        self.settings_start_btn.setObjectName("PrimaryButton")
        self.settings_stop_btn.setObjectName("DangerButton")
        self.settings_restart_btn.setObjectName("PrimaryButton")
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
        self.service_layout.addWidget(service_form_host)
        self.service_layout.addStretch(1)
        self.settings_tabs.addTab(self.service_scroll, "服务设置")
        # --- 油猴设置
        (
            self.tampermonkey_scroll,
            self.tampermonkey_tab,
            self.tampermonkey_layout,
        ) = self._create_scroll_tab()
        tm_form_host = QWidget()
        tm_form_host.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        tm_form = QFormLayout(tm_form_host)
        tm_form.setFieldGrowthPolicy(QFormLayout.ExpandingFieldsGrow)
        self.tm_bridge_url_label = QLabel("-")
        self.tm_bridge_url_label.setWordWrap(True)
        self.tm_bridge_url_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        self.tm_bridge_hint_label = QLabel("-")
        self.tm_bridge_hint_label.setWordWrap(True)
        self.tm_bridge_hint_label.setStyleSheet("color: #666;")
        self.tm_bridge_hint_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        self.tm_client_id_label = QLabel("-")
        self.tm_client_id_label.setWordWrap(True)
        self.tm_last_seen_settings_label = QLabel("-")
        self.tm_last_seen_settings_label.setWordWrap(True)
        self.tm_page_settings_label = QLabel("-")
        self.tm_page_settings_label.setWordWrap(True)
        self.tm_page_settings_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        tm_form.addRow("接口地址", self.tm_bridge_url_label)
        tm_form.addRow("配置说明", self.tm_bridge_hint_label)
        tm_form.addRow("client_id", self.tm_client_id_label)
        tm_form.addRow("最后心跳", self.tm_last_seen_settings_label)
        tm_form.addRow("页面 URL", self.tm_page_settings_label)
        tm_diag_row = QHBoxLayout()
        self.check_tm_btn = QPushButton("检查油猴连接")
        self.check_tm_btn.setObjectName("PrimaryButton")
        self.tm_refresh_pages_btn = QPushButton("刷新页面列表")
        self.tm_refresh_pages_btn.setObjectName("PrimaryButton")
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
        for widget in (
            self.bind_each_chat_to_page_cb,
            self.auto_open_bound_page_when_missing_cb,
            self.allow_fallback_to_any_page_cb,
            self.auto_bind_unbound_page_cb,
        ):
            bind_layout.addWidget(widget)
        upload_link_group = QGroupBox("上传联动")
        upload_link_layout = QVBoxLayout(upload_link_group)
        self.upload_before_send_enabled_cb = QCheckBox(
            "发送消息前先触发油猴上传当前队列"
        )
        self.upload_before_send_enabled_cb.setToolTip(
            "开启后，GUI 点击发送时会先向绑定的 ChatGPT 页面下发 start_upload 命令；"
            "油猴上传成功后再发送文本。若上传失败，将阻止本条消息裸发。"
        )
        upload_link_layout.addWidget(self.upload_before_send_enabled_cb)
        bind_layout.addWidget(upload_link_group)
        sync_group = QGroupBox("网页对话同步")
        sync_layout = QVBoxLayout(sync_group)
        self.sync_full_conversation_enabled_cb = QCheckBox(
            "允许从网页同步完整对话"
        )
        self.auto_sync_conversation_on_bind_cb = QCheckBox(
            "绑定 ChatGPT 页面后自动同步网页历史"
        )
        self.auto_sync_conversation_after_reply_cb = QCheckBox(
            "每次收到回复后自动同步网页对话（可能较慢）"
        )
        sync_mode_row = QHBoxLayout()
        sync_mode_row.addWidget(QLabel("同步模式"))
        self.sync_conversation_mode_combo = QComboBox()
        self.sync_conversation_mode_combo.addItem("安全合并（只补缺失）", "merge")
        self.sync_conversation_mode_combo.addItem("以网页为准（完全覆盖本地聊天）", "replace")
        self.sync_conversation_mode_combo.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Fixed
        )
        sync_mode_row.addWidget(self.sync_conversation_mode_combo, stretch=1)
        sync_max_row = QHBoxLayout()
        sync_max_row.addWidget(QLabel("最多同步条数"))
        self.sync_conversation_max_messages_spin = QSpinBox()
        self.sync_conversation_max_messages_spin.setRange(10, 2000)
        self.sync_conversation_max_messages_spin.setSingleStep(10)
        sync_max_row.addWidget(self.sync_conversation_max_messages_spin)
        sync_max_row.addStretch()
        for widget in (
            self.sync_full_conversation_enabled_cb,
            self.auto_sync_conversation_on_bind_cb,
            self.auto_sync_conversation_after_reply_cb,
        ):
            sync_layout.addWidget(widget)
        sync_layout.addLayout(sync_mode_row)
        sync_layout.addLayout(sync_max_row)
        bind_layout.addWidget(sync_group)
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
        self.tm_pages_table.setMinimumHeight(180)
        self.tm_pages_table.setMaximumHeight(260)
        self.tm_pages_table.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.tm_pages_table.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
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
        self.tampermonkey_layout.addWidget(tm_form_host)
        self.tampermonkey_layout.addStretch(1)
        self.settings_tabs.addTab(self.tampermonkey_scroll, "油猴设置")
        # --- 调试设置（日志清理；聊天/调试行为固定为 DEFAULT_APP_SETTINGS）
        (
            self.debug_scroll,
            self.debug_tab,
            self.debug_layout,
        ) = self._create_scroll_tab()
        debug_form_host = QWidget()
        debug_form_host.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        debug_form = QFormLayout(debug_form_host)
        debug_form.setFieldGrowthPolicy(QFormLayout.ExpandingFieldsGrow)
        cursor_group = QGroupBox("Cursor 联动测试")
        cursor_layout = QVBoxLayout(cursor_group)
        cursor_btn_row = QHBoxLayout()
        self.cursor_cli_test_btn = QPushButton("测试 Cursor CLI")
        self.cursor_cli_test_btn.setObjectName("PrimaryButton")
        self.cursor_cli_test_btn.setToolTip(
            "调用 cursor-agent --version，检测 Python 是否可以找到 Cursor CLI"
        )
        self.cursor_send_test_task_btn = QPushButton("发送 Cursor 测试任务")
        self.cursor_send_test_task_btn.setObjectName("PrimaryButton")
        self.cursor_send_test_task_btn.setToolTip(
            "向本地 server.py 的 Cursor 任务队列发送一条只读测试任务"
        )
        self.cursor_open_task_dir_btn = QPushButton("打开任务目录")
        self.cursor_open_task_dir_btn.setObjectName("PrimaryButton")
        self.cursor_open_task_dir_btn.setToolTip(
            "打开当前项目下的 .cursor_tasks/inbox 目录"
        )
        cursor_btn_row.addWidget(self.cursor_cli_test_btn)
        cursor_btn_row.addWidget(self.cursor_send_test_task_btn)
        cursor_btn_row.addWidget(self.cursor_open_task_dir_btn)
        cursor_btn_row.addStretch()
        cursor_layout.addLayout(cursor_btn_row)
        self.cursor_status_label = QLabel("Cursor 状态：未测试")
        self.cursor_status_label.setWordWrap(True)
        self.cursor_status_label.setStyleSheet("color: #555;")
        cursor_layout.addWidget(self.cursor_status_label)
        self.cursor_cli_test_btn.clicked.connect(self._on_test_cursor_cli_clicked)
        self.cursor_send_test_task_btn.clicked.connect(
            self._on_send_cursor_test_task_clicked
        )
        self.cursor_open_task_dir_btn.clicked.connect(
            self._on_open_cursor_task_dir_clicked
        )
        debug_form.addRow("", cursor_group)
        self.log_file_path_label = QLabel(f"日志文件：{get_log_file_path()}")
        self.log_file_path_label.setWordWrap(True)
        self.log_file_path_label.setStyleSheet("color: #555;")
        debug_form.addRow("", self.log_file_path_label)
        self.debug_layout.addWidget(debug_form_host)
        self.debug_layout.addStretch(1)
        self.settings_tabs.addTab(self.debug_scroll, "调试设置")
        self._sync_settings_widgets_from_values()
        bottom_row = QHBoxLayout()
        self.apply_settings_btn = QPushButton("应用设置")
        self.apply_settings_btn.setObjectName("PrimaryButton")
        self.save_settings_btn = QPushButton("保存设置")
        self.save_settings_btn.setObjectName("PrimaryButton")
        self.reset_settings_btn = QPushButton("恢复默认设置")
        self.reset_settings_btn.setObjectName("WarningButton")
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
        outer.setContentsMargins(4, 4, 4, 4)
        outer.setSpacing(4)
        top_row = QHBoxLayout()
        top_row.setSpacing(6)
        self.status_label = QLabel("服务：未启动")
        self.status_label.setObjectName("StatusChip")
        self.tm_online_label = QLabel("油猴：在线 0 / 总 0")
        self.tm_online_label.setObjectName("StatusChip")
        self.tm_blank_home_label = QLabel("空白页：0/0｜可用0｜已绑0")
        self.tm_blank_home_label.setObjectName("StatusChip")
        self.tm_current_page_label = QLabel("当前页：未检测到")
        self.tm_current_page_label.setObjectName("StatusChip")
        self.tm_bound_page_label = QLabel("绑定页：未绑定")
        self.tm_bound_page_label.setObjectName("StatusChip")
        self.tm_sync_target_label = QLabel("同步：不可用")
        self.tm_sync_target_label.setObjectName("StatusChip")
        self.tm_queue_label = QLabel("队列：0 / 0 / 0")
        self.tm_queue_label.setObjectName("StatusChip")
        self.tm_live_page_label = self.tm_current_page_label
        self.cursor_bridge_status_label = QLabel("Cursor：未连接")
        self.cursor_bridge_status_label.setObjectName("StatusBadgeNeutral")
        self.cursor_bridge_status_label.setToolTip("Cursor Bridge 状态：未连接")
        self.job_status_chip = QLabel("任务：空闲")
        self.job_status_chip.setObjectName("StatusChip")
        self.job_status_chip.setToolTip(
            "当前任务调度状态；点击切换到「Cursor 动作编排」页查看详情"
        )
        self.job_status_chip.setCursor(Qt.PointingHandCursor)
        self.job_status_chip.mousePressEvent = lambda _event: self._on_job_status_chip_clicked()
        for chip in (
            self.status_label,
            self.tm_online_label,
            self.tm_blank_home_label,
            self.tm_current_page_label,
            self.tm_bound_page_label,
            self.tm_sync_target_label,
            self.tm_queue_label,
            self.job_status_chip,
        ):
            chip.setWordWrap(False)
            chip.setFixedHeight(30)
            chip.setMinimumHeight(30)
            chip.setMaximumHeight(30)
            chip.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        self.cursor_bridge_status_label.setWordWrap(False)
        self.cursor_bridge_status_label.setFixedHeight(30)
        self.cursor_bridge_status_label.setMinimumHeight(30)
        self.cursor_bridge_status_label.setMaximumHeight(30)
        self.cursor_bridge_status_label.setSizePolicy(
            QSizePolicy.Fixed, QSizePolicy.Fixed
        )
        top_row.addWidget(self.status_label)
        top_row.addWidget(self.tm_online_label)
        top_row.addWidget(self.tm_blank_home_label)
        top_row.addWidget(self.tm_current_page_label)
        top_row.addWidget(self.tm_bound_page_label)
        top_row.addWidget(self.tm_sync_target_label)
        top_row.addWidget(self.tm_queue_label)
        top_row.addWidget(self.cursor_bridge_status_label)
        top_row.addWidget(self.job_status_chip)
        top_row.addStretch()
        self.toggle_status_detail_btn = QPushButton("详情")
        self.toggle_status_detail_btn.setObjectName("PrimaryButton")
        self.toggle_status_detail_btn.setFixedHeight(30)
        self.toggle_status_detail_btn.setMinimumHeight(30)
        self.toggle_status_detail_btn.setMaximumHeight(30)
        self.toggle_status_detail_btn.clicked.connect(self._on_toggle_status_detail)
        top_row.addWidget(self.toggle_status_detail_btn)
        self.chat_quick_start_btn = QPushButton("启动")
        self.chat_quick_start_btn.setObjectName("PrimaryButton")
        self.chat_quick_start_btn.setFixedWidth(48)
        self.chat_quick_start_btn.setFixedHeight(30)
        self.chat_quick_start_btn.clicked.connect(self._start_server)
        top_row.addWidget(self.chat_quick_start_btn)
        self.chat_quick_stop_btn = QPushButton("停止")
        self.chat_quick_stop_btn.setObjectName("DangerButton")
        self.chat_quick_stop_btn.setFixedWidth(48)
        self.chat_quick_stop_btn.setFixedHeight(30)
        self.chat_quick_stop_btn.clicked.connect(self._stop_server)
        self.chat_quick_stop_btn.setEnabled(True)
        top_row.addWidget(self.chat_quick_stop_btn)
        outer.addLayout(top_row)

        self.tm_bind_mismatch_label = ElidedLabel(" ")
        self.tm_bind_mismatch_label.setObjectName("TmBindMismatchHint")
        self.tm_bind_mismatch_label.setFixedHeight(22)
        self.tm_bind_mismatch_label.setMinimumHeight(22)
        self.tm_bind_mismatch_label.setMaximumHeight(22)
        outer.addWidget(self.tm_bind_mismatch_label)

        self.tm_status_detail_panel = QWidget()
        self.tm_status_detail_panel.setObjectName("StatusDetailPanel")
        detail_layout = QVBoxLayout(self.tm_status_detail_panel)
        detail_layout.setContentsMargins(8, 8, 8, 8)
        detail_layout.setSpacing(4)

        self.monkey_window_summary_label = QLabel("窗口统计：总数 0｜新建 0｜已绑定 0｜未绑定 0")
        self.monkey_window_summary_label.setObjectName("StatusRelationLine")
        self.monkey_window_summary_label.setWordWrap(True)
        self.monkey_binding_summary_label = QLabel("绑定明细：已绑定：—｜未绑定：—")
        self.monkey_binding_summary_label.setObjectName("StatusRelationLine")
        self.monkey_binding_summary_label.setWordWrap(True)
        detail_layout.addWidget(self.monkey_window_summary_label)
        detail_layout.addWidget(self.monkey_binding_summary_label)

        page_row = QHBoxLayout()
        page_row.setSpacing(6)
        page_label = QLabel("页面")
        page_label.setObjectName("StatusChip")
        page_label.setFixedHeight(30)
        if not hasattr(self, "tm_page_count_label"):
            self.tm_page_count_label = QLabel("在线 0 / 总 0")
            self.tm_page_count_label.setObjectName("StatusChip")
        self.tm_page_count_label.setFixedHeight(30)
        if not hasattr(self, "tm_page_combo"):
            self.tm_page_combo = QComboBox()
            self.tm_page_combo.setMinimumWidth(180)
            self.tm_page_combo.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
            self.tm_page_combo.setToolTip(
                "显示当前检测到的 ChatGPT 页面状态（不用于选择绑定目标）"
            )
        self.tm_page_combo.setFixedHeight(30)
        page_row.addWidget(page_label)
        page_row.addWidget(self.tm_page_count_label)
        page_row.addWidget(self.tm_page_combo, stretch=1)
        detail_layout.addLayout(page_row)

        self.tm_current_page_relation_label = QLabel("当前网页：未检测到")
        self.tm_current_page_relation_label.setObjectName("StatusRelationLine")
        self.tm_current_page_relation_label.setWordWrap(True)
        self.tm_current_page_relation_label.setTextInteractionFlags(
            Qt.TextSelectableByMouse
        )
        self.tm_bound_page_relation_label = QLabel("绑定网页：未绑定")
        self.tm_bound_page_relation_label.setObjectName("StatusRelationLine")
        self.tm_bound_page_relation_label.setWordWrap(True)
        self.tm_bound_page_relation_label.setTextInteractionFlags(
            Qt.TextSelectableByMouse
        )
        self.tm_sync_target_relation_label = QLabel("同步目标：不可用")
        self.tm_sync_target_relation_label.setObjectName("StatusRelationLine")
        self.tm_sync_target_relation_label.setWordWrap(True)
        self.tm_sync_target_relation_label.setTextInteractionFlags(
            Qt.TextSelectableByMouse
        )
        for rel in (
            self.tm_current_page_relation_label,
            self.tm_bound_page_relation_label,
            self.tm_sync_target_relation_label,
        ):
            rel.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            detail_layout.addWidget(rel)

        self.open_live_page_btn = QPushButton("打开")
        self.open_live_page_btn.setObjectName("PrimaryButton")
        self.open_live_page_btn.setVisible(False)

        self.tm_status_detail_panel.setVisible(False)
        outer.addWidget(self.tm_status_detail_panel)
        return bar

    def _on_job_status_chip_clicked(self):
        if hasattr(self, "_focus_cursor_flow_tab"):
            self._focus_cursor_flow_tab()

    def _build_cursor_flow_tab(self, cursor_layout):
        """Cursor 动作编排页：设置、动作按钮、任务状态与日志。"""
        settings_frame = QFrame()
        settings_frame.setObjectName("CursorFlowSettings")
        settings_layout = QVBoxLayout(settings_frame)
        settings_layout.setContentsMargins(0, 0, 0, 0)
        settings_layout.setSpacing(8)
        settings_layout.addWidget(
            QLabel("Cursor 发送设置", objectName="TaskCardTitle")
        )

        row1 = QHBoxLayout()
        row1.setSpacing(8)
        delivery_label = QLabel("发送方式：")
        delivery_label.setObjectName("InputHint")
        row1.addWidget(delivery_label)
        if not hasattr(self, "delivery_mode_combo"):
            self.delivery_mode_combo = QComboBox()
            self.delivery_mode_combo.addItem("直接发送", "auto_send")
            self.delivery_mode_combo.addItem("弹窗确认后发送", "manual_confirm")
            self.delivery_mode_combo.setCurrentIndex(0)
        self.delivery_mode_combo.setToolTip(
            "manual_confirm：Cursor 插件收到任务后弹窗确认；"
            "auto_send：插件收到后直接发送给 Cursor Agent"
        )
        row1.addWidget(self.delivery_mode_combo)
        row1.addSpacing(12)
        cursor_cmd_label = QLabel("Cursor 操作：")
        cursor_cmd_label.setObjectName("InputHint")
        row1.addWidget(cursor_cmd_label)
        if not hasattr(self, "cursor_command_combo"):
            self.cursor_command_combo = QComboBox()
            self.cursor_command_combo.addItem("发送到当前 Cursor Chat", "send_message")
            self.cursor_command_combo.addItem("新建 Cursor Chat", "new_chat")
            self.cursor_command_combo.addItem(
                "新建 Cursor Chat 并发送", "new_chat_and_send"
            )
            self.cursor_command_combo.setCurrentIndex(0)
        self.cursor_command_combo.setToolTip(
            "send_message：发送到当前 Cursor Chat；"
            "new_chat：仅新建 Chat；"
            "new_chat_and_send：新建 Chat 并发送输入框原文"
        )
        row1.addWidget(self.cursor_command_combo)
        row1.addStretch()
        settings_layout.addLayout(row1)

        row2 = QHBoxLayout()
        row2.setSpacing(8)
        prompt_label = QLabel("内容模式：")
        prompt_label.setObjectName("InputHint")
        row2.addWidget(prompt_label)
        if not hasattr(self, "prompt_mode_combo"):
            self.prompt_mode_combo = QComboBox()
            self.prompt_mode_combo.addItem("原文发送", "raw")
            self.prompt_mode_combo.addItem("包装成 Cursor 指令", "wrapped")
            self.prompt_mode_combo.setCurrentIndex(0)
        self.prompt_mode_combo.setToolTip(
            "raw：content 为输入框原文；wrapped：由 Cursor 插件按元数据包装后发送"
        )
        row2.addWidget(self.prompt_mode_combo)
        row2.addSpacing(12)
        submit_label = QLabel("提交方式：")
        submit_label.setObjectName("InputHint")
        row2.addWidget(submit_label)
        if not hasattr(self, "submit_mode_combo"):
            self.submit_mode_combo = QComboBox()
            self.submit_mode_combo.addItem("填入并按回车发送", "enter")
            self.submit_mode_combo.addItem("只填入输入框，不发送", "paste_only")
            self.submit_mode_combo.setCurrentIndex(0)
        self.submit_mode_combo.setVisible(True)
        row2.addWidget(self.submit_mode_combo)
        row2.addStretch()
        settings_layout.addLayout(row2)
        cursor_layout.addWidget(settings_frame)

        actions_label = QLabel("Cursor 动作", objectName="TaskCardTitle")
        cursor_layout.addWidget(actions_label)
        btn_height = 32
        action_row1 = QHBoxLayout()
        action_row1.setSpacing(6)
        if not hasattr(self, "trigger_upload_btn"):
            self.trigger_upload_btn = QPushButton("触发上传")
            self.trigger_upload_btn.setObjectName("PrimaryButton")
            self.trigger_upload_btn.clicked.connect(self._on_trigger_upload_clicked)
        if not hasattr(self, "upload_and_send_btn"):
            self.upload_and_send_btn = QPushButton("上传并发送")
            self.upload_and_send_btn.setObjectName("PrimaryButton")
            self.upload_and_send_btn.clicked.connect(self._on_upload_and_send_clicked)
        if not hasattr(self, "send_to_cursor_btn"):
            self.send_to_cursor_btn = QPushButton("发送到 Cursor")
            self.send_to_cursor_btn.setObjectName("PrimaryButton")
            self.send_to_cursor_btn.clicked.connect(self._on_send_to_cursor_clicked)
        for btn in (
            self.trigger_upload_btn,
            self.upload_and_send_btn,
            self.send_to_cursor_btn,
        ):
            btn.setFixedHeight(btn_height)
            btn.setMinimumHeight(btn_height)
            btn.setMaximumHeight(btn_height)
            btn.setEnabled(True)
        self.trigger_upload_btn.setToolTip(
            "仅向当前绑定的油猴页面下发 start_upload，不发送聊天文字"
        )
        self.upload_and_send_btn.setToolTip(
            "先向绑定页面上传工具箱队列中的文件，成功后再发送输入框中的文字"
        )
        self.send_to_cursor_btn.setToolTip(
            "将输入框内容通过 /api/cursor/tasks/create 发送到 Cursor Bridge 任务队列"
        )
        action_row1.addWidget(self.trigger_upload_btn)
        action_row1.addWidget(self.upload_and_send_btn)
        action_row1.addWidget(self.send_to_cursor_btn)
        action_row1.addStretch()
        for btn in (
            self.trigger_upload_btn,
            self.upload_and_send_btn,
            self.send_to_cursor_btn,
        ):
            btn.setObjectName("PrimaryButton")
            btn.style().unpolish(btn)
            btn.style().polish(btn)
        cursor_layout.addLayout(action_row1)

        if hasattr(self, "_build_job_task_ui"):
            self._build_job_task_ui(cursor_layout)

    def _build_chat_panel(self):
        panel = QWidget()
        panel.setObjectName("ChatPanel")
        panel.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(12, 10, 12, 12)
        layout.setSpacing(10)
        self.chat_splitter = QSplitter(Qt.Horizontal)
        self.chat_splitter.setObjectName("ChatSplitter")
        self.chat_splitter.setChildrenCollapsible(False)
        self.chat_splitter.setHandleWidth(6)
        self.chat_splitter.setStyleSheet(
            """
            QSplitter::handle {
                background: #d8dee9;
            }
            QSplitter::handle:horizontal {
                width: 6px;
            }
            QSplitter::handle:hover {
                background: #9ca3af;
            }
            """
        )
        self.session_sidebar = QWidget()
        self.session_sidebar.setObjectName("SessionSidebar")
        self.session_sidebar.setMinimumWidth(190)
        self.session_sidebar.setMaximumWidth(260)
        self.session_sidebar.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Expanding)
        sidebar_layout = QVBoxLayout(self.session_sidebar)
        sidebar_layout.setContentsMargins(10, 10, 10, 10)
        sidebar_layout.setSpacing(8)
        self.new_session_btn = QPushButton("新建对话")
        self.new_session_btn.setObjectName("PrimaryButton")
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
        self.session_list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.session_list.setUniformItemSizes(True)
        self.session_list.setSpacing(4)
        self.session_list.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
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
        self.delete_session_btn.setObjectName("DangerButton")
        self.delete_session_btn.setToolTip("删除当前选中的对话（Delete）")
        self.delete_session_btn.setFixedHeight(34)
        self.delete_session_btn.clicked.connect(self._delete_current_session)
        self.rename_session_btn = QPushButton("重命名")
        self.rename_session_btn.setObjectName("PrimaryButton")
        self.rename_session_btn.setToolTip("重命名当前选中的对话")
        self.rename_session_btn.setFixedHeight(34)
        self.rename_session_btn.clicked.connect(self._rename_current_session)
        sidebar_btn_row.addWidget(self.delete_session_btn, 1)
        sidebar_btn_row.addWidget(self.rename_session_btn, 1)
        sidebar_layout.addLayout(sidebar_btn_row)
        chat_area = QWidget()
        chat_area.setObjectName("ChatMainArea")
        chat_area.setMinimumWidth(600)
        chat_area.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        chat_area_layout = QVBoxLayout(chat_area)
        chat_area_layout.setContentsMargins(0, 0, 0, 0)
        chat_area_layout.setSpacing(0)

        self.chat_sub_tabs = QTabWidget()
        self.chat_sub_tabs.setObjectName("ChatSubTabs")
        self.chat_sub_tabs.setDocumentMode(True)
        self.chat_tab = QWidget()
        self.chat_tab.setObjectName("ChatSubTabChat")
        self.cursor_flow_tab = QWidget()
        self.cursor_flow_tab.setObjectName("ChatSubTabCursorFlow")
        self.chat_sub_tabs.addTab(self.chat_tab, "聊天")
        self.chat_sub_tabs.addTab(
            self.cursor_flow_tab, self.CURSOR_FLOW_TAB_TITLE_BASE
        )
        self.chat_sub_tabs.currentChanged.connect(self._on_chat_sub_tab_changed)

        chat_tab_layout = QVBoxLayout(self.chat_tab)
        chat_tab_layout.setContentsMargins(0, 0, 0, 0)
        chat_tab_layout.setSpacing(6)

        header_block = QWidget()
        header_block.setObjectName("ChatHeaderBlock")
        header_block.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        header_layout = QVBoxLayout(header_block)
        header_layout.setContentsMargins(0, 0, 0, 0)
        header_layout.setSpacing(4)

        self.current_session_title = QLabel("新对话")
        self.current_session_title.setObjectName("CurrentSessionTitle")
        self.current_session_title.setFixedHeight(26)
        header_layout.addWidget(self.current_session_title)

        url_row_widget = QWidget()
        url_row_widget.setFixedHeight(28)
        url_row_widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        url_row = QHBoxLayout(url_row_widget)
        url_row.setContentsMargins(0, 0, 0, 0)
        url_row.setSpacing(6)
        self.current_session_url_label = QLabel("绑定网址：未绑定 ChatGPT 页面")
        self.current_session_url_label.setObjectName("CurrentSessionUrlLabel")
        self.current_session_url_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.current_session_url_label.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Fixed
        )
        self.copy_session_url_btn = QPushButton("复制网址")
        self.copy_session_url_btn.setObjectName("CopySessionUrlButton")
        self.copy_session_url_btn.setFixedHeight(28)
        self.copy_session_url_btn.clicked.connect(self._copy_current_session_url)
        self._set_button_role(self.copy_session_url_btn, "blueGraySolid")
        self.open_session_url_btn = QPushButton("打开网址")
        self.open_session_url_btn.setObjectName("OpenSessionUrlButton")
        self.open_session_url_btn.setFixedHeight(28)
        self.open_session_url_btn.clicked.connect(self._open_current_session_url)
        self._set_button_role(self.open_session_url_btn, "blueGraySolid")
        url_row.addWidget(self.current_session_url_label, 1)
        url_row.addWidget(self.copy_session_url_btn, 0)
        url_row.addWidget(self.open_session_url_btn, 0)
        header_layout.addWidget(url_row_widget)

        self.chat_bind_warning_label = QLabel("")
        self.chat_bind_warning_label.setObjectName("ChatBindWarning")
        self.chat_bind_warning_label.setWordWrap(True)
        self.chat_bind_warning_label.setMaximumHeight(34)
        self.chat_bind_warning_label.setVisible(False)
        header_layout.addWidget(self.chat_bind_warning_label)
        chat_tab_layout.addWidget(header_block, 0)

        self.chat_scroll = QScrollArea()
        self.chat_scroll.setObjectName("ChatScrollArea")
        self.chat_scroll.setWidgetResizable(True)
        self.chat_scroll.setFrameShape(QFrame.NoFrame)
        self.chat_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.chat_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.chat_scroll.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.chat_container = QWidget()
        self.chat_container.setObjectName("ChatViewport")
        self.chat_container.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        self.chat_list_layout = QVBoxLayout(self.chat_container)
        self.chat_list_layout.setContentsMargins(20, 18, 20, 18)
        self.chat_list_layout.setSpacing(11)
        self.chat_list_layout.setAlignment(Qt.AlignTop)
        self.empty_state_widget = QWidget()
        self.empty_state_widget.setObjectName("ChatEmptyState")
        self.empty_state_widget.setVisible(False)
        self.empty_state_widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.chat_list_layout.addWidget(self.empty_state_widget)
        self.chat_bottom_spacer = QWidget()
        self.chat_bottom_spacer.setObjectName("ChatBottomSpacer")
        self.chat_bottom_spacer.setFixedHeight(0)
        self.chat_bottom_spacer.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.chat_list_layout.addWidget(self.chat_bottom_spacer, 0)
        self.chat_scroll.setWidget(self.chat_container)
        chat_tab_layout.addWidget(self.chat_scroll, 1)

        input_block = QWidget()
        input_block.setObjectName("ChatInputBlock")
        input_block.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        input_block.setMinimumHeight(132)
        input_block.setMaximumHeight(158)
        self.chat_input_panel = input_block
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
        self.send_btn.setFixedSize(72, 96)
        self.send_btn.clicked.connect(self._push_message)
        self.send_btn.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        self.send_btn.setEnabled(True)
        compose_row.addWidget(self.send_btn, 0, Qt.AlignVCenter)
        input_layout.addLayout(compose_row)
        bottom_action_row = QHBoxLayout()
        bottom_action_row.setSpacing(8)
        self.input_hint_label = QLabel()
        self.input_hint_label.setObjectName("InputHint")
        self._update_input_hint_label()
        bottom_action_row.addWidget(self.input_hint_label)
        bottom_action_row.addStretch(1)
        self.clear_session_btn = QPushButton("清空当前对话")
        self.clear_session_btn.setObjectName("DangerButton")
        self.clear_session_btn.clicked.connect(self._clear_current_session)
        bottom_action_row.addWidget(self.clear_session_btn)
        self.copy_last_btn = QPushButton("复制最后回复")
        self.copy_last_btn.setObjectName("PrimaryButton")
        self.copy_last_btn.clicked.connect(self._copy_last_reply)
        bottom_action_row.addWidget(self.copy_last_btn)
        input_layout.addLayout(bottom_action_row)
        chat_tab_layout.addWidget(input_block, 0)

        cursor_flow_layout = QVBoxLayout(self.cursor_flow_tab)
        cursor_flow_layout.setContentsMargins(10, 10, 10, 10)
        cursor_flow_layout.setSpacing(10)
        self._build_cursor_flow_tab(cursor_flow_layout)

        chat_area_layout.addWidget(self.chat_sub_tabs, stretch=1)
        self.chat_splitter.addWidget(self.session_sidebar)
        self.chat_splitter.addWidget(chat_area)
        self.chat_splitter.setStretchFactor(0, 0)
        self.chat_splitter.setStretchFactor(1, 1)
        self.chat_splitter.setSizes([220, 1200])
        self.chat_splitter.splitterMoved.connect(self._save_chat_splitter_sizes)
        self._restore_chat_splitter_sizes()
        layout.addWidget(self.chat_splitter, 1)
        return panel
