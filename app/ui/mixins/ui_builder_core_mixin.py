"""主界面骨架、通用控件工厂与油猴操作按钮。"""

from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import (
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from app.ui.styles import (
    BIND_SELECTED_PAGE_BUTTON_OBJECT_NAME,
    apply_bind_button_style,
)


class UiBuilderCoreMixin:
    def _make_hint_label(self, text):
        label = QLabel(text)
        label.setWordWrap(True)
        label.setStyleSheet("color: #666;")
        return label

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
                "text": "绑定所选页面",
                "handler": self._on_bind_current_page,
                "danger": False,
                "tooltip": (
                    "把「可用页面列表」当前选中页绑定到左侧当前本地对话；"
                    "若无选中页，则使用 document.hasFocus()=true 的焦点页。"
                ),
            },
            "sync_web": {
                "text": "同步网页对话",
                "handler": self._sync_bound_web_conversation,
                "danger": False,
                "tooltip": "从绑定的 ChatGPT 网页读取完整对话并同步到当前 GUI 聊天窗口",
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
            "close_bound": {
                "text": "关闭当前绑定 ChatGPT 页面",
                "handler": self._on_close_bound_tm_page,
                "danger": True,
                "tooltip": (
                    "只关闭当前本地会话绑定的 ChatGPT 页面，不关闭其他 ChatGPT 页面。"
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
        specs = self._tm_action_button_specs()
        if not getattr(self, "_tm_action_buttons_ready", False):
            self._tm_action_buttons_ready = True
            self.open_chatgpt_btn = self._create_tm_action_button_from_spec(
                "open_chatgpt", specs
            )
            self.bind_current_page_btn = self._create_tm_action_button_from_spec(
                "bind_current",
                specs,
                object_name=BIND_SELECTED_PAGE_BUTTON_OBJECT_NAME,
            )
            self.sync_web_conversation_btn = self._create_tm_action_button_from_spec(
                "sync_web", specs, object_name="sync_web_conversation_btn"
            )
            self.close_other_pages_btn = self._create_tm_action_button_from_spec(
                "close_other", specs
            )
        if getattr(self, "close_bound_page_btn", None) is None:
            self.close_bound_page_btn = self._create_tm_action_button_from_spec(
                "close_bound", specs
            )
        if getattr(self, "sync_web_conversation_btn", None) is not None:
            self._reconnect_button(
                self.sync_web_conversation_btn,
                self._sync_bound_web_conversation,
                tag="sync_web_conversation_btn",
            )
        self._apply_tm_action_button_roles()

    def _apply_tm_action_button_roles(self):
        if self.open_chatgpt_btn is not None:
            self.open_chatgpt_btn.setObjectName("PrimaryButton")
            self.open_chatgpt_btn.setEnabled(True)
        if self.sync_web_conversation_btn is not None:
            self.sync_web_conversation_btn.setObjectName("SuccessButton")
            self.sync_web_conversation_btn.setEnabled(True)
        apply_bind_button_style(self.bind_current_page_btn)
        if self.bind_current_page_btn is not None:
            self.bind_current_page_btn.setEnabled(True)
        for btn in (
            self.close_other_pages_btn,
            getattr(self, "close_bound_page_btn", None),
        ):
            if btn is None:
                continue
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
        ):
            btn.setFixedHeight(30)
            btn.setMinimumHeight(30)
            btn.setMaximumHeight(30)
            row.addWidget(btn)
        row.addStretch()
        return row

    def _on_main_tab_changed(self, index):
        if index < 0:
            return
        tab_text = self.main_tabs.tabText(index)
        if hasattr(self, "_flush_pending_chat_render") and (
            "聊天" in tab_text or "鑱婂ぉ" in tab_text
        ):
            QTimer.singleShot(30, self._flush_pending_chat_render)
            if hasattr(self, "schedule_page_registry_refresh"):
                QTimer.singleShot(
                    0,
                    lambda: self.schedule_page_registry_refresh(
                        reason="chat_tab_focus"
                    ),
                )

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(8)

        self.main_tabs = QTabWidget()
        self.main_tabs.setObjectName("MainTabs")

        self.chat_page = self._build_chat_page()
        self.cursor_code_page = self._build_cursor_code_page()
        self.settings_page = self._build_settings_page()

        self.main_tabs.addTab(self.chat_page, "聊天")
        self.main_tabs.addTab(self.cursor_code_page, "Cursor代码")
        self.main_tabs.addTab(self.settings_page, "设置")

        root.addWidget(self.main_tabs, stretch=1)

        self.main_tabs.currentChanged.connect(self._on_main_tab_changed)

        self.statusBar().showMessage("未启动服务")
        self._apply_app_style()
        self._sync_page_url_detail_widgets()
    def _apply_app_style(self):
        from app.ui.styles import APP_STYLESHEET

        self.setStyleSheet(APP_STYLESHEET)

