"""Cursor代码 页面 UI。"""
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QTabWidget,
    QTableWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class UiCursorCodePageMixin:
    def _build_cursor_code_page(self):
        page = QWidget()
        outer = QVBoxLayout(page)
        self.cursor_code_tabs = QTabWidget()
        self.cursor_code_tabs.addTab(self._build_cursor_find_tab(), "找图")
        self.cursor_code_tabs.addTab(self._build_cursor_automation_tab(), "自动化")
        outer.addWidget(self.cursor_code_tabs)
        return page

    def _build_cursor_find_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        scope_group = QGroupBox("截图范围设置")
        scope_form = QFormLayout(scope_group)
        self.cursor_code_use_all_screens = QCheckBox("所有屏幕截图")
        self.cursor_code_use_window_capture = QCheckBox("绑定指定 Cursor 窗口截图")
        self.cursor_code_window_combo = QComboBox()
        self.cursor_code_refresh_windows_btn = QPushButton("刷新窗口列表")
        self.cursor_code_refresh_windows_btn.setObjectName("PrimaryButton")
        row_window = QHBoxLayout()
        row_window.addWidget(self.cursor_code_window_combo, 1)
        row_window.addWidget(self.cursor_code_refresh_windows_btn)
        scope_form.addRow(self.cursor_code_use_all_screens)
        scope_form.addRow(self.cursor_code_use_window_capture)
        scope_form.addRow("Cursor 窗口列表", row_window)
        layout.addWidget(scope_group)

        param_group = QGroupBox("参数")
        param_form = QFormLayout(param_group)
        self.cursor_code_threshold = QDoubleSpinBox()
        self.cursor_code_threshold.setRange(0.3, 0.99)
        self.cursor_code_threshold.setSingleStep(0.01)
        self.cursor_code_threshold.setValue(0.80)
        self.cursor_code_capture_interval = QSpinBox()
        self.cursor_code_capture_interval.setRange(50, 10000)
        self.cursor_code_capture_interval.setValue(300)
        self.cursor_code_watch_interval = QSpinBox()
        self.cursor_code_watch_interval.setRange(200, 30000)
        self.cursor_code_watch_interval.setValue(1000)
        param_form.addRow("相似度阈值", self.cursor_code_threshold)
        param_form.addRow("截图间隔(ms)", self.cursor_code_capture_interval)
        param_form.addRow("监控间隔(ms)", self.cursor_code_watch_interval)
        layout.addWidget(param_group)

        table_group = QGroupBox("模板表")
        table_layout = QVBoxLayout(table_group)
        self.cursor_code_template_table = QTableWidget(0, 4)
        self.cursor_code_template_table.setHorizontalHeaderLabels(
            ["模板名", "状态", "kind", "相似度"]
        )
        table_layout.addWidget(self.cursor_code_template_table)
        layout.addWidget(table_group)

        btn_row = QHBoxLayout()
        self.cursor_code_refresh_templates_btn = QPushButton("刷新模板")
        self.cursor_code_refresh_capture_btn = QPushButton("刷新截图")
        self.cursor_code_find_once_btn = QPushButton("找图")
        for btn in (
            self.cursor_code_refresh_templates_btn,
            self.cursor_code_refresh_capture_btn,
            self.cursor_code_find_once_btn,
        ):
            btn.setObjectName("PrimaryButton")
            btn_row.addWidget(btn)
        btn_row.addStretch(1)
        layout.addLayout(btn_row)

        preview_group = QGroupBox("预览")
        preview_layout = QVBoxLayout(preview_group)
        self.cursor_code_preview_label = QLabel("暂无截图")
        self.cursor_code_preview_label.setMinimumHeight(180)
        self.cursor_code_preview_label.setStyleSheet(
            "QLabel{background:#1a1a2e;color:#aaa;border:1px solid #333;}"
        )
        self.cursor_code_preview_label.setAlignment(Qt.AlignHCenter | Qt.AlignVCenter)
        preview_layout.addWidget(self.cursor_code_preview_label)
        layout.addWidget(preview_group)

        log_group = QGroupBox("Cursor代码日志")
        log_layout = QVBoxLayout(log_group)
        self.cursor_code_log_text = QTextEdit()
        self.cursor_code_log_text.setReadOnly(True)
        log_layout.addWidget(self.cursor_code_log_text)
        layout.addWidget(log_group)
        return tab

    def _build_cursor_automation_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        form_group = QGroupBox("升级自动化")
        form = QFormLayout(form_group)
        self.cursor_code_continue_text = QLineEdit("继续")
        form.addRow("升级时发送文本", self.cursor_code_continue_text)
        layout.addWidget(form_group)

        row = QHBoxLayout()
        self.cursor_code_start_watch_btn = QPushButton("开始升级监控")
        self.cursor_code_start_watch_btn.setObjectName("PrimaryButton")
        self.cursor_code_stop_watch_btn = QPushButton("停止升级监控")
        self.cursor_code_stop_watch_btn.setObjectName("DangerButton")
        self.cursor_code_run_once_btn = QPushButton("单次升级发继续")
        self.cursor_code_run_once_btn.setObjectName("PrimaryButton")
        row.addWidget(self.cursor_code_start_watch_btn)
        row.addWidget(self.cursor_code_stop_watch_btn)
        row.addWidget(self.cursor_code_run_once_btn)
        row.addStretch(1)
        layout.addLayout(row)

        self.cursor_code_pause_state_label = QLabel("当前暂停状态：未暂停")
        self.cursor_code_last_action_label = QLabel("最近一次动作结果：-")
        layout.addWidget(self.cursor_code_pause_state_label)
        layout.addWidget(self.cursor_code_last_action_label)
        layout.addStretch(1)
        return tab

