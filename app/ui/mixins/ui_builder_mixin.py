import os
import time
import traceback

import server
from app.utils.page_status import get_page_liveness, is_page_online, page_url_from
from app.constants import (
    STATUS_CHIP_SESSION_BIND_PREFIX,
    STATUS_CHIP_SESSION_BIND_TOOLTIP,
    status_chip_text,
)
from app.models import normalize_remote_chatgpt
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.elided_label import ElidedLabel
from app.ui.widgets.no_wheel_combo_box import NoWheelComboBox
from app.ui.widgets.no_wheel_spin_box import NoWheelSpinBox
from app.ui.widgets.no_wheel_tab_widget import NoWheelTabWidget
from app.ui.widgets.session_list import SessionListWidget
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QColor, QBrush, QFont
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
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTextBrowser,
    QPlainTextEdit,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class UiBuilderMixin:
    CHAT_SUB_TAB_CHAT = 0
    CHAT_SUB_TAB_CURSOR_FLOW = 1
    CURSOR_FLOW_TAB_TITLE_BASE = "Cursor 动作编排"
    STATUS_DETAIL_EXPANDED_SETTING_KEY = "ui/status_detail_expanded"
    CHAT_SIDEBAR_MIN_WIDTH = 260
    CHAT_SIDEBAR_DEFAULT_WIDTH = 320
    CHAT_SIDEBAR_MAX_WIDTH = 460
    CHAT_MAIN_MIN_WIDTH = 700
    CHAT_SPLITTER_INVALID_LEFT = 220
    CHAT_SPLITTER_INVALID_RIGHT = 600
    CHAT_SPLITTER_DEFAULT_RIGHT = 1280

    def _make_hint_label(self, text):
        label = QLabel(text)
        label.setWordWrap(True)
        label.setStyleSheet("color: #666;")
        return label

    def _make_button(self, text, object_name="", clicked=None):
        btn = QPushButton(text)
        if object_name:
            btn.setObjectName(object_name)
        if clicked is not None:
            btn.clicked.connect(clicked)
        return btn

    def _make_group_vbox(self, title):
        group = QGroupBox(title)
        layout = QVBoxLayout(group)
        return group, layout

    def _reconnect_button(self, button, slot, *, tag=""):
        if button is None:
            return
        name = button.objectName() or type(button).__name__
        try:
            button.clicked.disconnect(slot)
        except TypeError as error:
            self._append_log(
                f"[UI_BIND] button has no previous connection: "
                f"name={name} tag={tag or '-'} error={error}",
                echo=False,
            )
        button.clicked.connect(slot)

    def _connect_signal_once(self, key, signal, slot):
        bound = getattr(self, "_bound_signal_keys", None)
        if not isinstance(bound, set):
            bound = set()
            self._bound_signal_keys = bound
        if key in bound:
            self._append_log(
                f"[UI_BIND][DUPLICATE] key={key} skipped second connect",
                echo=True,
            )
            return
        signal.connect(slot)
        bound.add(key)

    def _bind_chat_panel_signals(self):
        if getattr(self, "_chat_panel_signals_bound", False):
            return
        self._reconnect_button(
            self.send_btn,
            self._push_message,
            tag="send_btn",
        )
        self._connect_signal_once(
            "message_edit.send_requested",
            self.message_edit.send_requested,
            self._push_message,
        )
        self._reconnect_button(
            self.clear_session_btn,
            self._clear_current_session,
            tag="clear_session_btn",
        )
        self._reconnect_button(
            self.copy_last_btn,
            self._copy_last_reply,
            tag="copy_last_btn",
        )
        bind_send_last = getattr(self, "_bind_send_last_to_cursor_button", None)
        if callable(bind_send_last):
            bind_send_last()
        else:
            self._append_log(
                "[UI_BIND][SKIP] send_last_to_cursor_btn: "
                "CursorBridgeMixin._bind_send_last_to_cursor_button missing",
                echo=True,
            )
        self._reconnect_button(
            self.upload_current_file_btn,
            self._trigger_tm_start_upload,
            tag="upload_current_file_btn",
        )
        if hasattr(self, "_update_upload_current_file_btn_state"):
            self._update_upload_current_file_btn_state()
        self._chat_panel_signals_bound = True

    def _init_splitter_save_timer(self):
        self._splitter_save_timer = QTimer(self)
        self._splitter_save_timer.setSingleShot(True)
        self._splitter_save_timer.timeout.connect(self._save_splitter_sizes_now)

    def _normalize_chat_splitter_sizes(self, sizes):
        min_left = int(getattr(self, "CHAT_SIDEBAR_MIN_WIDTH", 260))
        max_left = int(getattr(self, "CHAT_SIDEBAR_MAX_WIDTH", 460))
        min_right = int(getattr(self, "CHAT_MAIN_MIN_WIDTH", 700))
        invalid_left = int(getattr(self, "CHAT_SPLITTER_INVALID_LEFT", 220))
        invalid_right = int(getattr(self, "CHAT_SPLITTER_INVALID_RIGHT", 600))
        default_left = int(getattr(self, "CHAT_SIDEBAR_DEFAULT_WIDTH", 320))
        default_right = int(getattr(self, "CHAT_SPLITTER_DEFAULT_RIGHT", 1280))
        if not sizes or len(sizes) < 2:
            return [default_left, default_right]
        left = int(sizes[0])
        right = int(sizes[1])
        if left < invalid_left or right < invalid_right:
            return [default_left, default_right]
        left = max(min_left, min(left, max_left))
        right = max(min_right, right)
        return [left, right]

    def _restore_chat_splitter_sizes(self):
        splitter = getattr(self, "chat_splitter", None)
        if splitter is None:
            return
        raw = self._settings.value("ui/chat_splitter_sizes", "")
        if raw:
            parts = [part.strip() for part in str(raw).split(",") if part.strip()]
            if len(parts) == 2:
                try:
                    parsed = [int(parts[0]), int(parts[1])]
                except ValueError as error:
                    self._append_log(
                        "[UI_SPLITTER][RESTORE_FAILED] "
                        f"invalid={raw} error={error}\n{traceback.format_exc()}",
                        echo=True,
                    )
                else:
                    applied = self._normalize_chat_splitter_sizes(parsed)
                    splitter.setSizes(applied)
                    if getattr(self, "_debug_mode", False):
                        self._append_log(
                            "[UI_SPLITTER][RESTORE] "
                            f"raw={raw} applied={applied}"
                        )
                    return
        default_sizes = self._normalize_chat_splitter_sizes(None)
        splitter.setSizes(default_sizes)
        if getattr(self, "_debug_mode", False):
            self._append_log(
                f"[UI_SPLITTER][DEFAULT] chat_splitter sizes={default_sizes}"
            )

    def _schedule_save_chat_splitter_sizes(self, *args):
        timer = getattr(self, "_splitter_save_timer", None)
        if timer is None:
            self._save_splitter_sizes_now()
            return
        timer.start(500)

    def _save_splitter_sizes_now(self):
        splitter = getattr(self, "chat_splitter", None)
        if splitter is None:
            return
        sizes = splitter.sizes()
        if len(sizes) != 2:
            return
        left, right = self._normalize_chat_splitter_sizes(sizes)
        if left <= 0 or right <= 0:
            return
        value = f"{left},{right}"
        self._settings.setValue("ui/chat_splitter_sizes", value)
        if getattr(self, "_debug_mode", False):
            self._append_log(
                "[UI_SPLITTER][SAVE] "
                f"raw={sizes} saved={[left, right]}"
            )

    def _save_chat_splitter_sizes(self):
        self._save_splitter_sizes_now()

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
        tabs = getattr(self, "chat_sub_tabs", None)
        if tabs is not None:
            current_text = tabs.tabText(index).strip()
            if "聊天" in current_text:
                if hasattr(self, "_flush_pending_chat_render"):
                    QTimer.singleShot(30, self._flush_pending_chat_render)
                elif hasattr(self, "_render_pending_chat_if_needed"):
                    QTimer.singleShot(30, self._render_pending_chat_if_needed)
        if int(index) == self.CHAT_SUB_TAB_CURSOR_FLOW:
            if hasattr(self, "_flush_pending_task_log_if_needed"):
                self._flush_pending_task_log_if_needed()
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
                    "把手动选中页或当前焦点页绑定到左侧当前本地对话。"
                    "优先使用「可用页面列表」中的手动选中页；"
                    "若无手动选中页，则使用 document.hasFocus()=true 的焦点页。"
                ),
            },
            "open_bound": {
                "text": "打开绑定页面",
                "handler": self._on_open_bound_chatgpt_page,
                "danger": False,
                "tooltip": "打开当前对话绑定的 ChatGPT 页面",
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
            self.sync_web_conversation_btn,
        ):
            btn.setObjectName("PrimaryButton")
            btn.setEnabled(True)
        for btn in (self.close_bound_page_btn, self.close_other_pages_btn):
            btn.setObjectName("DangerButton")
            btn.setEnabled(True)

    def _build_page_action_row(self):
        """详情区常驻操作按钮（与诊断卡片解耦，普通模式始终可见）。"""
        self._ensure_tm_action_buttons()
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(6)
        for btn in (
            self.open_chatgpt_btn,
            self.sync_web_conversation_btn,
            self.close_bound_page_btn,
            self.close_other_pages_btn,
        ):
            btn.setFixedHeight(30)
            btn.setMinimumHeight(30)
            btn.setMaximumHeight(30)
            row.addWidget(btn)
        row.addStretch()
        return row

    def _build_auto_focus_action_row(self):
        """兼容旧调用：操作按钮已移至 _build_page_action_row。"""
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.addStretch()
        return row

    def _build_manual_focus_action_row(self):
        """兼容旧调用：操作按钮已移至 _build_page_action_row。"""
        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.addStretch()
        return row

    def _ensure_tm_page_combo(self):
        if hasattr(self, "tm_page_combo"):
            return
        self.tm_page_combo = NoWheelComboBox()
        self.tm_page_combo.setObjectName("TmPageCombo")
        self.tm_page_combo.setMinimumWidth(0)
        self.tm_page_combo.setSizeAdjustPolicy(QComboBox.AdjustToContentsOnFirstShow)
        self.tm_page_combo.setMinimumContentsLength(40)
        self.tm_page_combo.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.tm_page_combo.setToolTip(
            "可用页面列表：选择 ChatGPT 页面作为手动选中页（用于绑定等操作）"
        )
        self.tm_page_selector = self.tm_page_combo
        if not getattr(self, "_tm_page_selector_connected", False):
            self.tm_page_combo.currentIndexChanged.connect(
                self._on_tm_page_selector_changed
            )
            self._tm_page_selector_connected = True

    def _ensure_bind_selected_page_button(self):
        if getattr(self, "_bind_selected_page_btn_ready", False):
            return
        self._bind_selected_page_btn_ready = True
        self.bind_selected_page_btn = QPushButton("设为当前页")
        self.bind_selected_page_btn.setToolTip(
            "再次确认「可用页面列表」当前项为手动选中页（下拉选择时已自动生效）"
        )
        self.bind_selected_page_btn.clicked.connect(self._on_bind_selected_tm_page)
        self.set_manual_current_page_btn = self.bind_selected_page_btn

    def _style_tm_page_selector_row_buttons(self):
        self._ensure_tm_action_buttons()
        self._ensure_bind_selected_page_button()
        for page_row_btn in (
            self.bind_current_page_btn,
            self.chat_open_bound_btn,
            self.bind_selected_page_btn,
        ):
            page_row_btn.setObjectName("PrimaryButton")
            page_row_btn.setFixedHeight(28)
            page_row_btn.setMinimumWidth(88)
            page_row_btn.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)

    def _build_tm_page_selector_row(self, parent_layout):
        """页面 [下拉列表] [绑定当前页面] [打开绑定页面] [设为当前页]"""
        self._ensure_tm_action_buttons()
        self._ensure_tm_page_combo()
        self._ensure_bind_selected_page_button()
        self.tm_page_combo.setFixedHeight(28)
        self._style_tm_page_selector_row_buttons()

        if not hasattr(self, "tm_page_empty_label"):
            self.tm_page_empty_label = QLabel("暂无可用页面")
            self.tm_page_empty_label.setObjectName("StatusRelationLine")
            self.tm_page_empty_label.setFixedHeight(20)
            self.tm_page_empty_label.setSizePolicy(
                QSizePolicy.Expanding, QSizePolicy.Fixed
            )
            self.tm_page_empty_label.setVisible(False)

        page_label = QLabel("页面")
        page_label.setObjectName("StatusChip")

        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(8)
        row.addWidget(page_label)
        self.tm_page_combo.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        row.addWidget(self.tm_page_empty_label, 1)
        row.addWidget(self.tm_page_combo, 1)
        row.addWidget(self.bind_current_page_btn, 0, Qt.AlignVCenter)
        row.addWidget(self.chat_open_bound_btn, 0, Qt.AlignVCenter)
        row.addWidget(self.bind_selected_page_btn, 0, Qt.AlignVCenter)
        parent_layout.addLayout(row)
        self._sync_tm_page_list_empty_ui()

    def _build_tm_action_buttons(
        self, layout, *, include_page_selector=False, include_view_logs=False
    ):
        self._ensure_tm_action_buttons()
        layout.setSpacing(6)
        for btn in (
            self.open_chatgpt_btn,
            self.sync_web_conversation_btn,
        ):
            layout.addWidget(btn)
        if include_page_selector:
            self._build_tm_page_selector_row(layout)
        for btn in (
            self.close_bound_page_btn,
            self.close_other_pages_btn,
        ):
            layout.addWidget(btn)
        if include_view_logs:
            layout.addStretch()
            if not hasattr(self, "view_logs_btn"):
                self.view_logs_btn = QPushButton("日志")
                self.view_logs_btn.setObjectName("GhostButton")
                self.view_logs_btn.setToolTip("切换到日志页")
                self.view_logs_btn.clicked.connect(self._show_log_tab)
            layout.addWidget(self.view_logs_btn)

    def _build_tm_debug_action_buttons(self, layout):
        """设置页专属调试操作（主聊天页已有按钮不在此重复创建）。"""
        layout.setSpacing(6)
        layout.addWidget(
            self._create_tm_ghost_button(
                "关闭选中页面",
                self._on_close_selected_tm_page,
                danger=True,
                tooltip="关闭下方页面表格中当前选中的 ChatGPT 页面",
            )
        )
    def _format_tm_page_option_label(
        self,
        page,
        bound_client_id="",
        current_client_id="",
        bound_page_instance_id="",
        bound_conversation_id="",
        resolved_bound_client_id="",
    ):
        if not isinstance(page, dict):
            return "无效页面"

        client_id = str(page.get("client_id") or "").strip()
        page_type = str(page.get("page_type") or "").strip()
        url = self._page_full_url(page) or page_url_from(page)
        if not url:
            conversation_id = self._page_chatgpt_conversation_id(page)
            if conversation_id:
                url = f"https://chatgpt.com/c/{conversation_id}"
            else:
                url = "未知页面 URL"

        visible = str(page.get("visible") or "").strip().lower()
        focus = str(page.get("focus") or "").strip().lower()

        tags = []
        is_online = self._page_is_online(page)
        if is_online:
            tags.append("在线")
        else:
            tags.append("离线")

        item_instance = (page.get("page_instance_id") or "").strip()
        item_conv = (
            self._client_conversation_id(page)
            if hasattr(self, "_client_conversation_id")
            else (page.get("conversation_id") or "").strip()
        )
        is_exact_bound_page = bool(
            bound_page_instance_id
            and item_instance
            and item_instance == bound_page_instance_id
        )
        is_resolved_bound_client = bool(
            resolved_bound_client_id
            and client_id
            and client_id == resolved_bound_client_id
        )
        is_same_conversation = bool(
            bound_conversation_id
            and item_conv
            and item_conv == bound_conversation_id
        )
        if is_exact_bound_page or is_resolved_bound_client:
            tags.append("绑定页")
        elif is_same_conversation:
            tags.append("同对话")
        elif bound_client_id and client_id == bound_client_id:
            tags.append("旧绑定")

        if current_client_id and client_id == current_client_id:
            tags.append("当前会话")
        elif visible == "hidden":
            tags.append("后台")
        elif focus in {"yes", "true", "1"}:
            tags.append("焦点")

        if page_type == "home":
            tags.append("首页")
        elif page_type and page_type != "conversation":
            tags.append(page_type)

        tag_text = "".join(f"[{tag}]" for tag in tags)
        if tag_text:
            return f"{tag_text} {url}"
        return url

    def _tm_page_combo_label(
        self,
        item,
        bound_client_id="",
        current_client_id="",
        bound_page_instance_id="",
        bound_conversation_id="",
        resolved_bound_client_id="",
    ):
        return self._format_tm_page_option_label(
            item,
            bound_client_id=bound_client_id,
            current_client_id=current_client_id,
            bound_page_instance_id=bound_page_instance_id,
            bound_conversation_id=bound_conversation_id,
            resolved_bound_client_id=resolved_bound_client_id,
        )

    TM_PAGE_ITEM_DICT_ROLE = Qt.UserRole + 1

    def _tm_page_combo_client_id_from_data(self, data):
        if isinstance(data, dict):
            return str(data.get("client_id") or "").strip()
        return str(data or "").strip()

    def _tm_page_combo_page_from_index(self, index):
        if not hasattr(self, "tm_page_combo") or index < 0:
            return None
        combo = self.tm_page_combo
        page = combo.itemData(index, self.TM_PAGE_ITEM_DICT_ROLE)
        if isinstance(page, dict):
            return page
        client_id = self._tm_page_combo_client_id_from_data(
            combo.itemData(index, Qt.UserRole)
        )
        if client_id:
            return self._find_tm_client_by_client_id(client_id)
        return None

    def _tm_page_combo_find_index_by_client_id(self, client_id):
        client_id = str(client_id or "").strip()
        if not client_id or not hasattr(self, "tm_page_combo"):
            return -1
        for idx in range(self.tm_page_combo.count()):
            if self._tm_page_combo_client_id_from_data(
                self.tm_page_combo.itemData(idx, Qt.UserRole)
            ) == client_id:
                return idx
        return -1

    def _tm_page_combo_find_index_by_normalized_url(self, normalized_url):
        normalized_url = (
            self._normalize_chatgpt_page_url(normalized_url)
            if hasattr(self, "_normalize_chatgpt_page_url")
            else str(normalized_url or "").strip()
        )
        if not normalized_url or not hasattr(self, "tm_page_combo"):
            return -1
        for idx in range(self.tm_page_combo.count()):
            page = self._tm_page_combo_page_from_index(idx)
            if not isinstance(page, dict):
                continue
            page_url = (
                self._normalize_chatgpt_page_url(
                    str(
                        page.get("url")
                        or page.get("href")
                        or page.get("page_url")
                        or ""
                    )
                )
                if hasattr(self, "_normalize_chatgpt_page_url")
                else str(
                    page.get("url")
                    or page.get("href")
                    or page.get("page_url")
                    or ""
                ).strip()
            )
            if page_url == normalized_url:
                return idx
        return -1

    def _tm_page_combo_find_index_for_page(self, page):
        if not isinstance(page, dict) or not hasattr(self, "tm_page_combo"):
            return -1
        target_instance = (page.get("page_instance_id") or "").strip()
        target_conv = (page.get("conversation_id") or "").strip()
        if not target_conv:
            target_conv = (
                self._client_conversation_id(page) if hasattr(self, "_client_conversation_id") else ""
            )
        target_client = (page.get("client_id") or "").strip()
        target_url = ""
        if hasattr(self, "_normalize_chatgpt_page_url"):
            target_url = self._normalize_chatgpt_page_url(
                str(
                    page.get("url")
                    or page.get("href")
                    or page.get("page_url")
                    or ""
                )
            )
        for idx in range(self.tm_page_combo.count()):
            item_page = self._tm_page_combo_page_from_index(idx)
            if not isinstance(item_page, dict):
                continue
            item_instance = (item_page.get("page_instance_id") or "").strip()
            item_conv = (item_page.get("conversation_id") or "").strip()
            if not item_conv and hasattr(self, "_client_conversation_id"):
                item_conv = self._client_conversation_id(item_page)
            item_client = (item_page.get("client_id") or "").strip()
            if target_instance and item_instance == target_instance:
                return idx
            if (
                target_conv
                and item_conv == target_conv
                and (not target_client or item_client == target_client)
            ):
                return idx
            if target_url and hasattr(self, "_normalize_chatgpt_page_url"):
                item_url = self._normalize_chatgpt_page_url(
                    str(
                        item_page.get("url")
                        or item_page.get("href")
                        or item_page.get("page_url")
                        or ""
                    )
                )
                if item_url == target_url:
                    return idx
        if target_client:
            return self._tm_page_combo_find_index_by_client_id(target_client)
        if target_url:
            return self._tm_page_combo_find_index_by_normalized_url(target_url)
        return -1

    def _pick_tm_page_selector_restore_index(self, pages, session=None):
        if not pages or not hasattr(self, "tm_page_combo"):
            return -1

        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        bound_instance = (remote.get("page_instance_id") or "").strip()
        bound_conv = (
            self._remote_conversation_id(remote)
            if hasattr(self, "_remote_conversation_id")
            else (remote.get("conversation_id") or "").strip()
        )
        bound_client = (remote.get("client_id") or "").strip()
        manual_instance = (
            getattr(self, "_manual_current_tm_page_instance_id", "") or ""
        ).strip()
        manual_conv = (
            getattr(self, "_manual_current_tm_conversation_id", "") or ""
        ).strip()
        manual_client = (getattr(self, "_manual_current_tm_client_id", "") or "").strip()

        resolved_bound_client_id = ""
        if hasattr(self, "_resolve_bound_page_info"):
            bound_info, _bound_state, _bound_reason = self._resolve_bound_page_info()
            if isinstance(bound_info, dict):
                resolved_bound_client_id = (bound_info.get("client_id") or "").strip()

        def page_conv_id(page):
            if hasattr(self, "_client_conversation_id"):
                return self._client_conversation_id(page)
            return (page.get("conversation_id") or "").strip()

        def page_index_in_list(match_fn, *, online_only=False):
            for idx, item in enumerate(pages):
                if not isinstance(item, dict) or not match_fn(item):
                    continue
                if online_only and not self._tm_page_is_online_simple(item):
                    continue
                return idx
            return -1

        def combo_index_for_list_index(list_index):
            if list_index < 0:
                return -1
            target = pages[list_index]
            return self._tm_page_combo_find_index_for_page(target)

        def try_restore(list_index):
            return combo_index_for_list_index(list_index)

        bound_url = ""
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bound_url = (
                self._normalize_chatgpt_page_url(
                    str(
                        remote.get("url")
                        or remote.get("page_url")
                        or remote.get("conversation_url")
                        or ""
                    )
                )
                if hasattr(self, "_normalize_chatgpt_page_url")
                else str(
                    remote.get("url")
                    or remote.get("page_url")
                    or remote.get("conversation_url")
                    or ""
                ).strip()
            )
        if not bound_url:
            bound_url = (
                self._normalize_chatgpt_page_url(
                    getattr(self, "bound_page_url", "")
                )
                if hasattr(self, "_normalize_chatgpt_page_url")
                else str(getattr(self, "bound_page_url", "") or "").strip()
            )
        if bound_url:
            combo_idx = self._tm_page_combo_find_index_by_normalized_url(bound_url)
            if combo_idx >= 0:
                return combo_idx

        if bound_conv:
            list_idx = page_index_in_list(
                lambda p: (
                    page_conv_id(p) == bound_conv
                    and (p.get("page_type") or "").strip() == "conversation"
                ),
                online_only=True,
            )
            combo_idx = try_restore(list_idx)
            if combo_idx >= 0:
                return combo_idx

        if bound_instance:
            list_idx = page_index_in_list(
                lambda p: (p.get("page_instance_id") or "").strip() == bound_instance,
                online_only=True,
            )
            combo_idx = try_restore(list_idx)
            if combo_idx >= 0:
                return combo_idx

        for candidate_client in (resolved_bound_client_id, bound_client):
            if not candidate_client:
                continue
            list_idx = page_index_in_list(
                lambda p, cid=candidate_client: (p.get("client_id") or "").strip() == cid,
                online_only=True,
            )
            combo_idx = try_restore(list_idx)
            if combo_idx >= 0:
                return combo_idx

        if manual_instance:
            list_idx = page_index_in_list(
                lambda p: (p.get("page_instance_id") or "").strip() == manual_instance,
                online_only=True,
            )
            combo_idx = try_restore(list_idx)
            if combo_idx >= 0:
                return combo_idx

        if manual_conv:
            list_idx = page_index_in_list(
                lambda p: page_conv_id(p) == manual_conv,
                online_only=True,
            )
            combo_idx = try_restore(list_idx)
            if combo_idx >= 0:
                return combo_idx

        for candidate_client in (manual_client,):
            if not candidate_client:
                continue
            combo_idx = self._tm_page_combo_find_index_by_client_id(candidate_client)
            if combo_idx >= 0:
                page = self._tm_page_combo_page_from_index(combo_idx)
                if isinstance(page, dict) and self._tm_page_is_online_simple(page):
                    return combo_idx

        if bound_instance:
            list_idx = page_index_in_list(
                lambda p: (p.get("page_instance_id") or "").strip() == bound_instance,
            )
            combo_idx = try_restore(list_idx)
            if combo_idx >= 0:
                return combo_idx

        if bound_conv:
            list_idx = page_index_in_list(
                lambda p: page_conv_id(p) == bound_conv,
            )
            combo_idx = try_restore(list_idx)
            if combo_idx >= 0:
                return combo_idx

        for candidate_client in (manual_client, bound_client):
            if not candidate_client:
                continue
            combo_idx = self._tm_page_combo_find_index_by_client_id(candidate_client)
            if combo_idx >= 0:
                return combo_idx

        return -1

    def _page_is_online(self, item):
        """UI 展示用在线判断（含 recently_seen）；绑定/发送仍用 _tm_page_is_online_simple。"""
        if hasattr(self, "_page_is_online_for_ui"):
            return self._page_is_online_for_ui(item)
        if hasattr(self, "_tm_page_is_online_simple"):
            return self._tm_page_is_online_simple(item)
        if not isinstance(item, dict):
            return False
        client_id = str(item.get("client_id") or "").strip()
        if not client_id:
            return False
        return not self._page_is_stale(item)

    TM_PAGE_COMBO_ONLINE_COLOR = "#16a34a"
    TM_PAGE_COMBO_OFFLINE_COLOR = "#6b7280"

    def _tm_page_combo_apply_item_colors(self, index, page):
        if not hasattr(self, "tm_page_combo") or index < 0:
            return
        if not isinstance(page, dict):
            return

        combo = self.tm_page_combo
        is_online = self._page_is_online_for_ui(page)
        color = (
            self.TM_PAGE_COMBO_ONLINE_COLOR
            if is_online
            else self.TM_PAGE_COMBO_OFFLINE_COLOR
        )
        combo.setItemData(
            index,
            QBrush(QColor(color)),
            Qt.ForegroundRole,
        )
        if hasattr(self, "_append_log"):
            liveness = get_page_liveness(page)
            page_url = (
                page.get("url")
                or page.get("page_url")
                or page.get("normalized_url")
                or "-"
            )
            self._append_log(
                "[PAGE_SELECTOR][ITEM_STYLE] "
                f"index={index} "
                f"client_id={(page.get('client_id') or '-').strip() or '-'} "
                f"url={str(page_url).strip() or '-'} "
                f"liveness={liveness} "
                f"online_for_ui={str(is_online).lower()} "
                f"color={color}",
                echo=False,
            )

    def _refresh_page_combo_current_style(self):
        combo = getattr(self, "tm_page_combo", None)
        if combo is None:
            return
        page = None
        if hasattr(self, "_get_selected_tm_page_from_combo"):
            page = self._get_selected_tm_page_from_combo()
        is_online = (
            self._page_is_online_for_ui(page) if isinstance(page, dict) else False
        )
        color = (
            self.TM_PAGE_COMBO_ONLINE_COLOR
            if is_online
            else self.TM_PAGE_COMBO_OFFLINE_COLOR
        )
        combo.setStyleSheet(
            f"""
            QComboBox#TmPageCombo {{
                color: {color};
            }}
            QComboBox#TmPageCombo QAbstractItemView {{
                background: #ffffff;
                selection-background-color: #2563eb;
                selection-color: #ffffff;
                outline: none;
            }}
            """
        )

    def _tm_page_combo_tooltip(self, item):
        self._maybe_log_conversation_id_mismatch(item)

        full_url = self._page_full_url(item) or "-"
        chatgpt_id = self._page_chatgpt_conversation_id(item) or "-"
        client_id = (item.get("client_id") or "-").strip() or "-"
        page_instance_id = (item.get("page_instance_id") or "-").strip() or "-"
        type_text = self._page_type_text(item)
        visible_text = self._page_visible_text(item)
        focus_text = "有焦点" if self._page_has_focus(item) else "无焦点"
        input_text = self._page_input_text(item)
        responding_text = self._page_responding_text(item)
        syncable_text = self._page_syncable_text(item)
        sendable_text = self._page_sendable_text(item)
        profile = self._tm_client_sync_profile(item)
        blocked = (profile.get("blocked_reason") or profile.get("reason") or "").strip()

        last_seen_text = self._format_last_seen_ago(item.get("last_seen"))

        return (
            f"完整URL：{full_url}\n"
            f"conversation_id：{chatgpt_id}\n"
            f"client_id：{client_id}\n"
            f"page_instance_id：{page_instance_id}\n"
            f"last_seen：{last_seen_text}\n"
            f"页面类型：{type_text}\n"
            f"对话可同步：{syncable_text}\n"
            f"可发送：{sendable_text}\n"
            f"可输入：{input_text}\n"
            f"正在生成：{responding_text}\n"
            f"窗口：{visible_text}（仅展示，不拦截同步）\n"
            f"焦点：{focus_text}（仅展示，不拦截同步）\n"
            f"blocked_reason：{blocked or '-'}"
        )

    def _tm_page_combo_sort_key(self, item):
        profile = self._tm_client_sync_profile(item)
        state_rank = {
            "sendable": 4,
            "syncable": 3,
            "online": 2,
            "stale": 1,
            "offline": 0,
        }.get(profile.get("state"), 0)
        page_type = (item.get("page_type") or "").strip()
        conv_rank = 1 if page_type == "conversation" else 0
        last_seen = float(item.get("last_seen") or 0)
        return (state_rank, conv_rank, last_seen)

    def _tm_page_selector_signature(self, pages):
        now = time.time()
        signature_items = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            last_seen = float(page.get("last_seen") or 0)
            last_seen_bucket = int(last_seen // 2) if last_seen > 0 else 0
            liveness = get_page_liveness(page, now=now)
            page_url = (
                page.get("_normalized_url")
                or (
                    self._normalize_chatgpt_page_url(
                        page.get("url")
                        or page.get("page_url")
                        or page.get("normalized_url")
                        or ""
                    )
                    if hasattr(self, "_normalize_chatgpt_page_url")
                    else (
                        page.get("url")
                        or page.get("page_url")
                        or page.get("normalized_url")
                        or ""
                    )
                )
            )
            signature_items.append(
                (
                    page.get("client_id") or "",
                    page.get("page_instance_id") or "",
                    page.get("conversation_id") or "",
                    page_url,
                    page.get("visible") or page.get("visibility_state") or "",
                    page.get("focus")
                    or page.get("has_focus")
                    or page.get("focused")
                    or "",
                    page.get("responding") or page.get("is_responding") or "",
                    page.get("input") or page.get("can_accept_input") or "",
                    page.get("state") or page.get("response_state") or "",
                    is_page_online(page, now=now),
                    liveness,
                    last_seen_bucket,
                )
            )
        return tuple(signature_items)

    def _sync_tm_page_list_empty_ui(self):
        """无可用页面时用短文案占位，隐藏空白下拉框。"""
        combo = getattr(self, "tm_page_combo", None)
        if combo is None:
            return
        has_pages = combo.count() > 0
        empty_label = getattr(self, "tm_page_empty_label", None)
        if empty_label is not None:
            empty_label.setVisible(not has_pages)
            if not has_pages:
                empty_label.setText("暂无可用页面")
        combo.setVisible(has_pages)
        bind_selected_btn = getattr(
            self,
            "bind_selected_page_btn",
            getattr(self, "set_manual_current_page_btn", None),
        )
        if bind_selected_btn is not None:
            bind_selected_btn.setVisible(has_pages)

    def _update_tm_page_selector_display_state(self, index=-1):
        """自动刷新后仅更新展示/提示，不写入 manual_current_tm_client_id。"""
        combo = getattr(self, "tm_page_combo", None)
        if combo is None:
            return
        self._sync_tm_page_list_empty_ui()
        if combo.count() <= 0:
            return
        if index < 0:
            index = combo.currentIndex()
        if index < 0:
            return
        page = None
        if hasattr(self, "_tm_page_combo_page_from_index"):
            page = self._tm_page_combo_page_from_index(index)
        if isinstance(page, dict) and hasattr(self, "_tm_selector_action_hint_for_page"):
            self._set_tm_action_hint(self._tm_selector_action_hint_for_page(page))
        if hasattr(self, "_refresh_manual_current_page_display"):
            self._refresh_manual_current_page_display()
        if hasattr(self, "_refresh_page_combo_current_style"):
            self._refresh_page_combo_current_style()

    def _refresh_tm_page_selector(self, status=None):
        if not hasattr(self, "tm_page_combo"):
            return
        full_status = status if isinstance(status, dict) else None
        client_keys = (
            "clients",
            "tm_clients",
            "tampermonkey_clients",
            "pages",
            "tm_pages",
        )
        if not full_status or not any(key in full_status for key in client_keys):
            full_status = getattr(self, "_last_bridge_status", None) or {}
        raw_pages = []
        pages = self._extract_tm_pages_from_status(full_status)
        raw_pages = list(getattr(self, "raw_available_pages", None) or [])
        unique_pages = list(getattr(self, "available_pages", None) or pages)
        pages = unique_pages
        has_page_source_keys = any(key in full_status for key in client_keys)

        if not pages and self.tm_page_combo.count() > 0 and not has_page_source_keys:
            self._append_log(
                "[TM_SELECTOR][KEEP_LAST] "
                "reason=empty_status_without_page_source "
                f"combo_count={self.tm_page_combo.count()} "
                f"status_keys={list(full_status.keys())}",
                echo=False,
            )
            self._sync_tm_page_list_empty_ui()
            return
        duplicate_count = max(0, len(raw_pages) - len(unique_pages))
        self._append_log(
            "[TM_SELECTOR][SOURCE] "
            f"status_keys={list((getattr(self, '_last_bridge_status', None) or {}).keys())} "
            f"raw_pages={len(raw_pages)} "
            f"unique_pages={len(unique_pages)} "
            f"duplicate={duplicate_count} "
            f"clients={[p.get('client_id') for p in pages]}",
            echo=False,
        )
        if not pages:
            self._append_log(
                "[TM_SELECTOR][EMPTY] "
                "reason=no_pages_extracted_from_status "
                f"status_keys={list(full_status.keys())}",
                echo=False,
            )
        stored_bound_client_id = self._session_bound_client_id()
        bound_client_id = stored_bound_client_id
        bound_page_instance_id = ""
        bound_conversation_id = ""
        resolved_bound_client_id = ""
        bound_state = ""
        bound_reason = ""
        if hasattr(self, "_resolve_bound_page_info"):
            bound_info, bound_state, bound_reason = self._resolve_bound_page_info(
                status=full_status
            )
            if isinstance(bound_info, dict):
                resolved_bound_client_id = (bound_info.get("client_id") or "").strip()
                bound_page_instance_id = (bound_info.get("page_instance_id") or "").strip()
            session = self._current_session() if hasattr(self, "_current_session") else None
            if session is not None:
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                if hasattr(self, "_remote_conversation_id"):
                    bound_conversation_id = self._remote_conversation_id(remote) or ""
                else:
                    bound_conversation_id = (remote.get("conversation_id") or "").strip()
            self._append_log(
                "[TM_SELECTOR][BOUND_RESOLVE] "
                f"stored_client_id={stored_bound_client_id or '-'} "
                f"resolved_client_id={resolved_bound_client_id or '-'} "
                f"resolved_page_instance_id={bound_page_instance_id or '-'} "
                f"bound_conversation_id={bound_conversation_id or '-'} "
                f"bound_state={bound_state or '-'} "
                f"bound_reason={bound_reason or '-'}",
                echo=False,
            )
        current_client_id = str(
            full_status.get("tampermonkey_client_id") or ""
        ).strip()

        pages.sort(key=self._tm_page_combo_sort_key, reverse=True)
        if hasattr(self, "tm_page_combo") and self.tm_page_combo.count() > 0:
            for item in pages:
                client_id = (item.get("client_id") or "").strip()
                if not client_id:
                    continue
                idx = self._tm_page_combo_find_index_by_client_id(client_id)
                if idx < 0:
                    continue
                old_label = self.tm_page_combo.itemText(idx)
                new_label = self._tm_page_combo_label(
                    item,
                    bound_client_id=bound_client_id,
                    current_client_id=current_client_id,
                    bound_page_instance_id=bound_page_instance_id,
                    bound_conversation_id=bound_conversation_id,
                    resolved_bound_client_id=resolved_bound_client_id,
                )
                if old_label and new_label and old_label != new_label:
                    self._append_log(
                        "[PAGE_SYNC][STALE_URL] "
                        f"old_url={old_label} new_url={new_label} "
                        f"client_id={client_id} "
                        f"page_instance_id={(item.get('page_instance_id') or '-').strip() or '-'}",
                        echo=False,
                    )
        page_selector_key = self._tm_page_selector_signature(pages)
        if page_selector_key == getattr(self, "_last_page_selector_key", ""):
            self._sync_tm_page_list_empty_ui()
            return
        self._last_page_selector_key = page_selector_key
        manual_client_id = (
            getattr(self, "_manual_current_tm_client_id", "") or ""
        ).strip()
        session_bound = stored_bound_client_id
        self._tm_page_selector_refreshing = True
        self.tm_page_combo.setUpdatesEnabled(False)
        self.tm_page_combo.blockSignals(True)

        self.tm_page_combo.clear()

        for item in pages:
            label = self._tm_page_combo_label(
                item,
                bound_client_id=bound_client_id,
                current_client_id=current_client_id,
                bound_page_instance_id=bound_page_instance_id,
                bound_conversation_id=bound_conversation_id,
                resolved_bound_client_id=resolved_bound_client_id,
            )
            idx = self.tm_page_combo.count()
            client_id = (item.get("client_id") or "").strip()
            self.tm_page_combo.addItem(label)
            self.tm_page_combo.setItemData(
                idx,
                client_id if client_id else item,
                Qt.UserRole,
            )
            self.tm_page_combo.setItemData(
                idx, dict(item), self.TM_PAGE_ITEM_DICT_ROLE
            )
            self.tm_page_combo.setItemData(
                idx, self._tm_page_combo_tooltip(item), Qt.ToolTipRole
            )
            self._tm_page_combo_apply_item_colors(idx, item)
            if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():
                self._append_log(
                    "[TM_SELECTOR][ITEM] "
                    f"index={idx} "
                    f"label={label} "
                    f"client_id={(item.get('client_id') or '-').strip() or '-'} "
                    f"page_type={(item.get('page_type') or '-').strip() or '-'} "
                    f"conversation_id={(item.get('conversation_id') or '-').strip() or '-'} "
                    f"visible={(item.get('visible') or '-').strip() or '-'} "
                    f"focus={(item.get('focus') or '-').strip() or '-'} "
                    f"responding={(item.get('responding') or '-').strip() or '-'} "
                    f"state={(item.get('state') or '-').strip() or '-'} "
                    f"input={(item.get('input') or '-').strip() or '-'} "
                    f"url={(item.get('url') or item.get('page_url') or item.get('normalized_url') or '-').strip() or '-'}",
                    echo=False,
                )

        session = self._current_session() if hasattr(self, "_current_session") else None
        restore_index = self._pick_tm_page_selector_restore_index(pages, session=session)
        try:
            if restore_index >= 0:
                self.tm_page_combo.setCurrentIndex(restore_index)
            else:
                self.tm_page_combo.setCurrentIndex(-1)
        finally:
            self._tm_page_selector_refreshing = False
            self.tm_page_combo.blockSignals(False)
            self.tm_page_combo.setUpdatesEnabled(True)

        self._append_log(
            "[PAGE_SELECTOR][AUTO_REFRESH] "
            f"restore_index={restore_index} "
            f"manual_client_id={manual_client_id or '-'} "
            f"session_bound={session_bound or '-'} "
            f"resolved_bound_client_id={resolved_bound_client_id or '-'} "
            f"bound_conversation_id={bound_conversation_id or '-'} "
            f"page_count={self.tm_page_combo.count()} "
            f"reason={'matched' if restore_index >= 0 else 'no_matching_current_page'}",
            echo=False,
        )
        self._update_tm_page_selector_display_state(restore_index)
    def _selected_tm_page_client_id(self):
        if hasattr(self, "tm_page_combo") and self.tm_page_combo.count() > 0:
            client_id = self._tm_page_combo_client_id_from_data(
                self.tm_page_combo.currentData(Qt.UserRole)
            )
            if client_id:
                return client_id
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
        idx = self._tm_page_combo_find_index_by_client_id(client_id)
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
        self.log_page = None
        self.settings_page = self._build_settings_page()

        self.main_tabs.addTab(self.chat_page, "聊天")
        self.main_tabs.addTab(self.settings_page, "设置")

        root.addWidget(self.main_tabs, stretch=1)

        if hasattr(self, "_init_log_tab_state"):
            self._init_log_tab_state()

        self.main_tabs.currentChanged.connect(self._on_main_tab_changed)

        self.statusBar().showMessage("未启动服务")
        self._apply_app_style()
        self._sync_page_url_detail_widgets()
    def _apply_app_style(self):
        from app.ui.styles import APP_STYLESHEET

        self.setStyleSheet(APP_STYLESHEET)

    def _build_chat_page(self):
        page = QWidget()
        page.setObjectName("ChatPage")
        page_layout = QVBoxLayout(page)
        page_layout.setContentsMargins(8, 6, 8, 8)
        page_layout.setSpacing(8)

        self.chat_page = page
        self.chat_page_layout = page_layout

        self._chat_status_group = self._build_chat_status_bar()
        self.bridge_status_panel = QFrame()
        self.bridge_status_panel.setObjectName("BridgeStatusPanel")
        self.bridge_status_panel.setSizePolicy(
            QSizePolicy.Expanding,
            QSizePolicy.Preferred,
        )
        self.bridge_status_panel.setMinimumHeight(0)
        self.bridge_status_panel.setMaximumHeight(16777215)
        panel_layout = QVBoxLayout(self.bridge_status_panel)
        panel_layout.setContentsMargins(8, 4, 8, 4)
        panel_layout.setSpacing(0)
        panel_layout.addWidget(self._chat_status_group)
        page_layout.addWidget(self.bridge_status_panel, 0)
        self.bridge_status_panel.setVisible(self._show_top_status_bar)
        self._sync_bridge_status_panel_height()

        self._chat_panel = self._build_chat_panel()
        page_layout.addWidget(self._chat_panel, 1)
        return page

    def _set_status_detail_expanded(self, visible, *, persist=True):
        panel = getattr(self, "tm_status_detail_panel", None)
        btn = getattr(self, "toggle_status_detail_btn", None)
        if panel is None or btn is None:
            return

        visible = bool(visible)
        panel.setVisible(visible)
        btn.setText("收起" if visible else "详情")
        if persist:
            self._settings.setValue(
                self.STATUS_DETAIL_EXPANDED_SETTING_KEY,
                visible,
            )
            self._settings.sync()

        panel.updateGeometry()

        status_group = getattr(self, "_chat_status_group", None)
        if status_group is not None:
            status_group.updateGeometry()

        bridge_panel = getattr(self, "bridge_status_panel", None)
        if bridge_panel is not None:
            bridge_panel.updateGeometry()

        self._sync_bridge_status_panel_height()
        QTimer.singleShot(0, self._sync_bridge_status_panel_height)

    def _restore_status_detail_expanded(self):
        raw_value = self._settings.value(
            self.STATUS_DETAIL_EXPANDED_SETTING_KEY,
            False,
        )
        visible = self._qsettings_bool(raw_value, False)
        self._set_status_detail_expanded(visible, persist=False)

    def _on_toggle_status_detail(self):
        panel = getattr(self, "tm_status_detail_panel", None)
        if panel is None:
            return
        self._set_status_detail_expanded(
            not panel.isVisible(),
            persist=True,
        )

    def _sync_bridge_status_panel_height(self):
        panel = getattr(self, "bridge_status_panel", None)
        if panel is None:
            return

        detail_panel = getattr(self, "tm_status_detail_panel", None)
        detail_visible = detail_panel is not None and detail_panel.isVisible()

        panel.setMinimumHeight(0)
        panel.setMaximumHeight(16777215)
        panel.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        panel.updateGeometry()

        status_group = getattr(self, "_chat_status_group", None)
        if not detail_visible:
            for widget in (status_group, detail_panel):
                if widget is None:
                    continue
                widget.setMinimumHeight(0)
                widget.setMaximumHeight(16777215)
                widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
                widget.updateGeometry()

        panel_layout = panel.layout()
        if panel_layout is not None:
            panel_layout.invalidate()
            panel_layout.activate()

        if detail_visible:
            for widget in (detail_panel, status_group):
                if widget is None:
                    continue
                widget.setMinimumHeight(0)
                widget.setMaximumHeight(16777215)
                widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
                widget.updateGeometry()

            if detail_panel is not None:
                detail_panel.updateGeometry()

        chat_layout = getattr(self, "chat_page_layout", None)
        if chat_layout is not None:
            chat_layout.invalidate()
            chat_layout.activate()

        chat_page = getattr(self, "chat_page", None)
        if chat_page is not None:
            chat_page.updateGeometry()

        if status_group is not None and status_group.isVisible():
            status_group.updateGeometry()
            required_height = status_group.sizeHint().height()

            panel_layout = panel.layout()
            if panel_layout is not None:
                margins = panel_layout.contentsMargins()
                required_height += margins.top() + margins.bottom()

            panel.setMinimumHeight(max(0, required_height))
            panel.updateGeometry()

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
        self.copy_current_log_btn = QPushButton("复制日志")
        self.copy_current_log_btn.setObjectName("CopyCurrentLogButton")
        self.copy_current_log_btn.setToolTip(
            "复制当前选中的日志子页内容（运行日志、油猴事件、发出消息、服务状态）"
        )
        self.copy_current_log_btn.clicked.connect(self._copy_current_log_tab_text)
        run_log_toolbar.addWidget(self.copy_current_log_btn)
        self.clear_runtime_log_btn = QPushButton("清空运行日志")
        self.clear_runtime_log_btn.setObjectName("DangerButton")
        if not getattr(self, "_clear_log_button_connected", False):
            self.clear_runtime_log_btn.clicked.connect(self._on_clear_runtime_log_clicked)
            self._clear_log_button_connected = True
        run_log_toolbar.addWidget(self.clear_runtime_log_btn)
        run_log_toolbar.addStretch(1)
        run_log_layout.addLayout(run_log_toolbar)

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
        self.service_layout.setContentsMargins(12, 10, 12, 10)
        self.service_layout.setSpacing(10)
        service_root = QWidget()
        service_root.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        service_root_layout = QVBoxLayout(service_root)
        service_root_layout.setContentsMargins(0, 0, 0, 0)
        service_root_layout.setSpacing(10)

        basic_group, basic_layout = self._make_group_vbox("服务基础设置")
        basic_layout.setContentsMargins(10, 8, 10, 8)
        basic_layout.setSpacing(6)
        basic_form_host = QWidget()
        basic_form = QFormLayout(basic_form_host)
        basic_form.setContentsMargins(0, 0, 0, 0)
        basic_form.setSpacing(6)
        basic_form.setFieldGrowthPolicy(QFormLayout.FieldsStayAtSizeHint)
        basic_form.setLabelAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.enable_lan_access_cb = QCheckBox()
        self.enable_lan_access_cb.setToolTip("允许局域网访问（监听 0.0.0.0）")
        self.enable_lan_access_cb.setChecked(self._enable_lan_access)
        self.enable_lan_access_cb.toggled.connect(self._on_enable_lan_access_changed)
        self.listen_host_label = QLabel()
        self.listen_host_label.setWordWrap(True)
        self._update_listen_host_label()
        self.port_edit = QLineEdit(self._port_text)
        self.port_edit.setFixedWidth(80)
        self.port_edit.editingFinished.connect(
            lambda: self._auto_save_service_settings(network_config_changed=True)
        )
        basic_form.addRow("局域网访问", self.enable_lan_access_cb)
        basic_form.addRow("监听地址", self.listen_host_label)
        basic_form.addRow("端口", self.port_edit)
        self.auto_start_server_cb = QCheckBox()
        self.auto_start_server_cb.setToolTip("启动 GUI 时自动启动服务")
        self.auto_start_server_cb.setChecked(self._auto_start_server)
        self.auto_start_server_cb.stateChanged.connect(
            lambda _state: self._auto_save_service_settings(
                network_config_changed=False
            )
        )
        basic_form.addRow("自动启动", self.auto_start_server_cb)
        basic_layout.addWidget(basic_form_host)

        chat_input_group, chat_input_layout = self._make_group_vbox("聊天输入")
        chat_input_layout.setContentsMargins(10, 8, 10, 8)
        chat_input_layout.setSpacing(4)
        self.default_compose_message_edit = QPlainTextEdit()
        self.default_compose_message_edit.setPlaceholderText(
            "例如：请用中文简要回答…"
        )
        self.default_compose_message_edit.setPlainText(
            getattr(self, "_default_compose_message", "") or ""
        )
        self.default_compose_message_edit.setMinimumHeight(120)
        self.default_compose_message_edit.setMaximumHeight(160)
        self.default_compose_message_edit.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Fixed
        )
        chat_input_hint = self._make_hint_label(
            "当底部输入框为空时自动填入（新建对话、切换对话、发送后清空时）；留空表示不填充。"
        )
        hint_font = chat_input_hint.font()
        hint_font.setPointSize(max(hint_font.pointSize() - 1, 8))
        chat_input_hint.setFont(hint_font)
        chat_input_layout.addWidget(self.default_compose_message_edit)
        chat_input_layout.addWidget(chat_input_hint)
        self.default_compose_message_edit.textChanged.connect(
            self._schedule_service_default_message_autosave
        )

        ops_group, ops_layout = self._make_group_vbox("服务操作与状态")
        ops_layout.setContentsMargins(10, 8, 10, 8)
        ops_layout.setSpacing(8)
        service_btn_row = QHBoxLayout()
        service_btn_row.setSpacing(8)
        self.settings_start_btn = QPushButton("启动服务")
        self.settings_stop_btn = QPushButton("停止服务")
        self.settings_restart_btn = QPushButton("重启服务并应用")
        self.settings_start_btn.setObjectName("PrimaryButton")
        self.settings_stop_btn.setObjectName("DangerButton")
        self.settings_restart_btn.setObjectName("PrimaryButton")
        self.settings_start_btn.clicked.connect(self._start_server)
        self.settings_stop_btn.clicked.connect(self._stop_server)
        self.settings_restart_btn.clicked.connect(self._restart_server_with_settings)
        for btn in (
            self.settings_start_btn,
            self.settings_stop_btn,
            self.settings_restart_btn,
        ):
            btn.setEnabled(True)
        service_btn_row.addWidget(self.settings_start_btn)
        service_btn_row.addWidget(self.settings_stop_btn)
        service_btn_row.addWidget(self.settings_restart_btn)
        service_btn_row.addStretch()
        ops_layout.addLayout(service_btn_row)
        self.settings_service_status_label = QLabel("当前状态：未启动")
        self.settings_service_status_label.setWordWrap(True)
        self.settings_service_status_label.setStyleSheet("color: #333;")
        ops_layout.addWidget(self.settings_service_status_label)
        self.settings_service_hint_label = QLabel("")
        self.settings_service_hint_label.setWordWrap(True)
        self.settings_service_hint_label.setStyleSheet("color: #555;")
        ops_layout.addWidget(self.settings_service_hint_label)

        service_root_layout.addWidget(basic_group)
        service_root_layout.addWidget(chat_input_group)
        service_root_layout.addWidget(ops_group)
        self.service_layout.addWidget(service_root)
        self._init_service_settings_autosave_timer()
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
        self.sync_conversation_mode_combo = NoWheelComboBox()
        self.sync_conversation_mode_combo.addItem("安全合并（只补缺失）", "merge")
        self.sync_conversation_mode_combo.addItem("以网页为准（完全覆盖本地聊天）", "replace")
        self.sync_conversation_mode_combo.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Fixed
        )
        sync_mode_row.addWidget(self.sync_conversation_mode_combo, stretch=1)
        sync_max_row = QHBoxLayout()
        sync_max_row.addWidget(QLabel("最多同步条数"))
        self.sync_conversation_max_messages_spin = NoWheelSpinBox()
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
        self.tm_pages_table = QTableWidget(0, 12)
        self.tm_pages_table.setHorizontalHeaderLabels(
            [
                "状态",
                "client_id",
                "page_instance_id",
                "页面类型",
                "会话ID",
                "对话同步",
                "可发送",
                "可见",
                "焦点/最近焦点",
                "最后心跳",
                "URL",
                "本对话绑定",
            ]
        )
        self.tm_pages_table.horizontalHeader().setStretchLastSection(True)
        self.tm_pages_table.setColumnWidth(0, 40)
        self.tm_pages_table.setColumnWidth(1, 88)
        self.tm_pages_table.setColumnWidth(2, 100)
        self.tm_pages_table.setColumnWidth(3, 64)
        self.tm_pages_table.setColumnWidth(4, 88)
        self.tm_pages_table.setColumnWidth(5, 52)
        self.tm_pages_table.setColumnWidth(6, 44)
        self.tm_pages_table.setColumnWidth(7, 40)
        self.tm_pages_table.setColumnWidth(8, 72)
        self.tm_pages_table.setColumnWidth(9, 72)
        self.tm_pages_table.setColumnWidth(10, 160)
        self.tm_pages_table.setColumnWidth(11, 64)
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
        self._sync_settings_widgets_from_values()
        return page
    def _build_chat_status_bar(self):
        bar = QWidget()
        bar.setObjectName("ChatStatusBar")
        outer = QVBoxLayout(bar)
        outer.setContentsMargins(8, 8, 8, 8)
        outer.setSpacing(8)
        top_row = QHBoxLayout()
        top_row.setSpacing(8)
        self.status_label = QLabel("服务：未启动")
        self.status_label.setObjectName("StatusChip")
        self.tm_online_label = QLabel("油猴：在线 0 / 总 0")
        self.tm_online_label.setObjectName("StatusChip")
        self.tm_blank_home_label = QLabel("空白页：0/0｜可用0｜已绑0")
        self.tm_blank_home_label.setObjectName("StatusChip")
        self.tm_bound_page_label = QLabel(
            status_chip_text(STATUS_CHIP_SESSION_BIND_PREFIX, "未绑定")
        )
        self.tm_bound_page_label.setObjectName("StatusChip")
        self.tm_bound_page_label.setToolTip(STATUS_CHIP_SESSION_BIND_TOOLTIP)
        self.tm_sync_target_label = QLabel("同步：不可用")
        self.tm_sync_target_label.setObjectName("StatusChip")
        self.tm_queue_label = QLabel("队列：0 / 0 / 0")
        self.tm_queue_label.setObjectName("StatusChip")
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
        top_row.addWidget(self.tm_bound_page_label)
        top_row.addWidget(self.tm_sync_target_label)
        # 顶部状态栏不再显示“队列”和“任务”两个状态块。
        # 变量保留，避免状态刷新逻辑中 self.tm_queue_label.setText(...)
        # 和 self._update_job_status_chip(...) 报错。
        self.tm_queue_label.setVisible(False)
        self.job_status_chip.setVisible(False)
        top_row.addWidget(self.cursor_bridge_status_label)
        top_row.addStretch(1)

        STATUS_ACTION_BUTTON_WIDTH = 68
        STATUS_ACTION_BUTTON_HEIGHT = 34
        STATUS_ACTION_BUTTON_SPACING = 10
        STATUS_ACTION_BUTTON_COUNT = 3
        STATUS_ACTION_HOST_WIDTH = (
            STATUS_ACTION_BUTTON_WIDTH * STATUS_ACTION_BUTTON_COUNT
            + STATUS_ACTION_BUTTON_SPACING * (STATUS_ACTION_BUTTON_COUNT - 1)
        )
        self.status_action_host = QWidget()
        self.status_action_host.setObjectName("StatusActionHost")
        self.status_action_host.setFixedSize(
            STATUS_ACTION_HOST_WIDTH,
            STATUS_ACTION_BUTTON_HEIGHT,
        )
        self.status_action_host.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)

        status_action_row = QHBoxLayout(self.status_action_host)
        status_action_row.setContentsMargins(0, 0, 0, 0)
        status_action_row.setSpacing(STATUS_ACTION_BUTTON_SPACING)

        def setup_status_action_button(button):
            button.setFixedSize(STATUS_ACTION_BUTTON_WIDTH, STATUS_ACTION_BUTTON_HEIGHT)
            button.setMinimumSize(STATUS_ACTION_BUTTON_WIDTH, STATUS_ACTION_BUTTON_HEIGHT)
            button.setMaximumSize(STATUS_ACTION_BUTTON_WIDTH, STATUS_ACTION_BUTTON_HEIGHT)
            button.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
            return button

        self.toggle_status_detail_btn = QPushButton("详情")
        self.toggle_status_detail_btn.setObjectName("PrimaryButton")
        setup_status_action_button(self.toggle_status_detail_btn)
        self.toggle_status_detail_btn.clicked.connect(self._on_toggle_status_detail)
        status_action_row.addWidget(self.toggle_status_detail_btn)

        self.chat_quick_start_btn = QPushButton("启动")
        self.chat_quick_start_btn.setObjectName("PrimaryButton")
        setup_status_action_button(self.chat_quick_start_btn)
        self.chat_quick_start_btn.clicked.connect(self._start_server)
        self.chat_quick_start_btn.setEnabled(True)
        status_action_row.addWidget(self.chat_quick_start_btn)

        self.chat_quick_stop_btn = QPushButton("停止")
        self.chat_quick_stop_btn.setObjectName("DangerButton")
        setup_status_action_button(self.chat_quick_stop_btn)
        self.chat_quick_stop_btn.clicked.connect(self._stop_server)
        self.chat_quick_stop_btn.setEnabled(True)
        status_action_row.addWidget(self.chat_quick_stop_btn)

        top_row.addWidget(self.status_action_host, 0, Qt.AlignRight | Qt.AlignVCenter)
        outer.addLayout(top_row)

        self.sync_progress_panel = QFrame()
        self.sync_progress_panel.setObjectName("SyncProgressPanel")
        self.sync_progress_panel.setVisible(False)
        sync_progress_layout = QHBoxLayout(self.sync_progress_panel)
        sync_progress_layout.setContentsMargins(8, 4, 8, 4)
        sync_progress_layout.setSpacing(8)
        self.sync_progress_label = QLabel("同步准备中...")
        self.sync_progress_label.setObjectName("SyncProgressLabel")
        self.sync_progress_label.setMinimumWidth(260)
        self.sync_progress_label.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        self.sync_progress_bar = QProgressBar()
        self.sync_progress_bar.setObjectName("SyncProgressBar")
        self.sync_progress_bar.setRange(0, 0)
        self.sync_progress_bar.setTextVisible(False)
        self.sync_progress_bar.setFixedHeight(10)
        self.sync_progress_bar.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        sync_progress_layout.addWidget(self.sync_progress_label)
        sync_progress_layout.addWidget(self.sync_progress_bar, 1)
        outer.addWidget(self.sync_progress_panel)

        self.tm_status_detail_panel = QWidget()
        self.tm_status_detail_panel.setObjectName("StatusDetailPanel")
        self.tm_status_detail_panel.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Preferred
        )
        detail_layout = QVBoxLayout(self.tm_status_detail_panel)
        detail_layout.setContentsMargins(8, 6, 8, 6)
        detail_layout.setSpacing(6)

        page_card = QFrame()
        page_card.setObjectName("StatusInfoCard")
        page_card_layout = QVBoxLayout(page_card)
        page_card_layout.setContentsMargins(8, 5, 8, 5)
        page_card_layout.setSpacing(5)

        self._build_tm_page_selector_row(page_card_layout)

        detail_layout.addWidget(page_card)

        page_action_card = QFrame()
        page_action_card.setObjectName("StatusInfoCard")
        page_action_layout = QVBoxLayout(page_action_card)
        page_action_layout.setContentsMargins(8, 5, 8, 5)
        page_action_layout.setSpacing(5)
        page_action_layout.addLayout(self._build_page_action_row())
        detail_layout.addWidget(page_action_card)
        self.page_action_card = page_action_card

        self.open_live_page_btn = QPushButton("打开")
        self.open_live_page_btn.setObjectName("PrimaryButton")
        self.open_live_page_btn.setVisible(False)

        outer.addWidget(self.tm_status_detail_panel)
        self._restore_status_detail_expanded()
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
        self.chat_splitter.setObjectName("ChatMainSplitter")
        self.chat_splitter.setChildrenCollapsible(False)
        self.chat_splitter.setHandleWidth(4)
        self.session_sidebar = QWidget()
        self.session_sidebar.setObjectName("SessionSidebar")
        self.session_sidebar.setMinimumWidth(self.CHAT_SIDEBAR_MIN_WIDTH)
        self.session_sidebar.setMaximumWidth(self.CHAT_SIDEBAR_MAX_WIDTH)
        self.session_sidebar.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Expanding)
        sidebar_layout = QVBoxLayout(self.session_sidebar)
        sidebar_layout.setContentsMargins(8, 8, 10, 8)
        sidebar_layout.setSpacing(6)
        self.new_session_btn = QPushButton("新建对话")
        self.new_session_btn.setObjectName("PrimaryButton")
        self.new_session_btn.setToolTip("新建本地对话 (Ctrl+N)")
        self.new_session_btn.clicked.connect(self._create_new_local_session)
        sidebar_layout.addWidget(self.new_session_btn)
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
        if hasattr(self.session_list, "fast_select_requested"):
            self.session_list.fast_select_requested.connect(
                self._on_session_list_pressed_fast
            )
        else:
            self.session_list.itemPressed.connect(self._on_session_list_pressed_fast)
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
        sidebar_btn_row.addWidget(self.delete_session_btn)
        sidebar_btn_row.addStretch(1)
        sidebar_layout.addLayout(sidebar_btn_row)
        chat_area = QWidget()
        chat_area.setObjectName("ChatMainArea")
        chat_area.setMinimumWidth(self.CHAT_MAIN_MIN_WIDTH)
        chat_area.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        chat_area_layout = QVBoxLayout(chat_area)
        chat_area_layout.setContentsMargins(0, 0, 0, 0)
        chat_area_layout.setSpacing(0)

        self.chat_sub_tabs = NoWheelTabWidget()
        self.chat_sub_tabs.setObjectName("ChatInnerTabs")
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
        header_block.setMinimumHeight(56)
        header_block.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        header_layout = QVBoxLayout(header_block)
        header_layout.setContentsMargins(0, 0, 0, 0)
        header_layout.setSpacing(6)

        self.current_session_title = QLabel("当前会话：新对话")
        self.current_session_title.setObjectName("CurrentSessionTitle")
        self.current_session_title.setMinimumHeight(28)
        self.current_session_title.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Preferred
        )
        header_layout.addWidget(self.current_session_title)

        url_row_widget = QWidget()
        url_row_widget.setMinimumHeight(36)
        url_row_widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        url_row = QHBoxLayout(url_row_widget)
        url_row.setContentsMargins(8, 6, 8, 6)
        url_row.setSpacing(8)
        self.current_session_url_label = ElidedLabel("绑定网址：未绑定 ChatGPT 页面")
        self.current_session_url_label.setObjectName("CurrentSessionUrlLabel")
        self.current_session_url_label.setWordWrap(False)
        self.current_session_url_label.setMinimumHeight(28)
        self.current_session_url_label.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Preferred
        )
        url_row.addWidget(self.current_session_url_label, 1, Qt.AlignVCenter)
        header_layout.addWidget(url_row_widget)
        chat_tab_layout.addWidget(header_block, 0)

        self.chat_transcript = QTextBrowser()
        self.chat_transcript.setObjectName("ChatTranscript")
        self.chat_transcript.document().setDocumentMargin(0)
        self.chat_transcript.setOpenExternalLinks(False)
        self.chat_transcript.setReadOnly(True)
        self.chat_transcript.setFrameShape(QFrame.NoFrame)
        self.chat_transcript.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.chat_transcript.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.chat_transcript.setSizePolicy(
            QSizePolicy.Expanding,
            QSizePolicy.Expanding,
        )
        self.chat_transcript.setMinimumHeight(180)
        self.chat_transcript.setVisible(True)
        chat_tab_layout.addWidget(self.chat_transcript, 1)

        input_block = QWidget()
        input_block.setObjectName("ChatInputBlock")
        input_block.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        input_block.setMinimumHeight(132)
        input_block.setMaximumHeight(158)
        input_layout = QVBoxLayout(input_block)
        input_layout.setContentsMargins(0, 0, 0, 0)
        input_layout.setSpacing(6)
        compose_row = QHBoxLayout()
        compose_row.setSpacing(8)
        self.message_edit = ChatInput(self)
        self.message_edit.setObjectName("MessageInput")
        self.message_edit.setReadOnly(False)
        self.message_edit.setEnabled(True)
        self.message_edit.setFocusPolicy(Qt.StrongFocus)
        self.message_edit.setToolTip(
            "本地消息输入框。点击后输入消息；Enter 发送，Shift+Enter 换行。"
        )
        self._update_input_placeholder()
        self.message_edit.setFixedHeight(96)
        self.message_edit.setFont(QFont("Microsoft YaHei UI", 10))
        compose_row.addWidget(self.message_edit, stretch=1)
        self.send_btn = QPushButton("发送")
        self.send_btn.setObjectName("PrimaryButton")
        self.send_btn.setFixedSize(72, 96)
        self.send_btn.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        self.send_btn.setEnabled(True)
        compose_row.addWidget(self.send_btn, 0, Qt.AlignVCenter)
        input_layout.addLayout(compose_row)
        bottom_action_row = QHBoxLayout()
        bottom_action_row.setSpacing(8)
        bottom_action_row.addStretch(1)
        self.clear_session_btn = QPushButton("清空当前对话")
        self.clear_session_btn.setObjectName("DangerButton")
        bottom_action_row.addWidget(self.clear_session_btn)
        self.send_last_to_cursor_btn = QPushButton("发送最后给 Cursor")
        self.send_last_to_cursor_btn.setObjectName("send_last_to_cursor_btn")
        self.send_last_to_cursor_btn.setProperty("class", "PrimaryButton")
        bottom_action_row.addWidget(self.send_last_to_cursor_btn)
        self.copy_last_btn = QPushButton("复制最后回复")
        self.copy_last_btn.setObjectName("PrimaryButton")
        bottom_action_row.addWidget(self.copy_last_btn)
        self.upload_current_file_btn = QPushButton("开始上传")
        self.upload_current_file_btn.setObjectName("PrimaryButton")
        bottom_action_row.addWidget(self.upload_current_file_btn)
        input_layout.addLayout(bottom_action_row)
        chat_tab_layout.addWidget(input_block, 0)
        self._bind_chat_panel_signals()

        cursor_flow_layout = QVBoxLayout(self.cursor_flow_tab)
        cursor_flow_layout.setContentsMargins(10, 10, 10, 10)
        cursor_flow_layout.setSpacing(10)
        self._build_cursor_flow_tab(cursor_flow_layout)

        chat_area_layout.addWidget(self.chat_sub_tabs, stretch=1)
        self.chat_splitter.addWidget(self.session_sidebar)
        self.chat_splitter.addWidget(chat_area)
        self.chat_splitter.setStretchFactor(0, 0)
        self.chat_splitter.setStretchFactor(1, 1)
        self.chat_splitter.setSizes(
            [
                self.CHAT_SIDEBAR_DEFAULT_WIDTH,
                self.CHAT_SPLITTER_DEFAULT_RIGHT,
            ]
        )
        if hasattr(self, "_init_splitter_save_timer"):
            self._init_splitter_save_timer()
        self.chat_splitter.splitterMoved.connect(self._schedule_save_chat_splitter_sizes)
        self._restore_chat_splitter_sizes()
        layout.addWidget(self.chat_splitter, 1)
        return panel
