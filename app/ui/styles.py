"""主窗口 QSS 样式（从 ui_builder_mixin 抽出，避免业务逻辑文件过长）。"""

APP_STYLESHEET = """
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
            QTabWidget#ChatInnerTabs::pane {
                border: 1px solid #d0d7de;
                border-radius: 6px;
                background: #ffffff;
                top: -1px;
            }
            QTabWidget#ChatInnerTabs QTabBar::tab {
                min-width: 120px;
                min-height: 30px;
                padding: 6px 16px;
                margin-right: 2px;
                border: 1px solid #d0d7de;
                border-bottom: none;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                background: #f3f4f6;
                color: #4b5563;
                font-weight: 500;
            }
            QTabWidget#ChatInnerTabs QTabBar::tab:selected {
                background: #f5f3ff;
                color: #4c1d95;
                border-top: 3px solid #8b5cf6;
                border-left: 1px solid #c4b5fd;
                border-right: 1px solid #c4b5fd;
                border-bottom: 1px solid #f5f3ff;
                padding-top: 4px;
                font-weight: 700;
            }
            QTabWidget#ChatInnerTabs QTabBar::tab:hover:!selected {
                background: #ede9fe;
                color: #5b21b6;
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
            QPushButton#PrimaryButton,
            QPushButton[class="PrimaryButton"],
            QPushButton#NewSessionButton,
            QPushButton#CopyCurrentLogButton {
                background: #2563eb;
                color: #ffffff;
                border: 1px solid #1d4ed8;
                border-radius: 6px;
                padding: 5px 12px;
                font-weight: 600;
            }
            QPushButton#PrimaryButton:hover,
            QPushButton[class="PrimaryButton"]:hover,
            QPushButton#NewSessionButton:hover,
            QPushButton#CopyCurrentLogButton:hover {
                background: #1d4ed8;
                color: #ffffff;
            }
            QPushButton#PrimaryButton:pressed,
            QPushButton[class="PrimaryButton"]:pressed,
            QPushButton#NewSessionButton:pressed,
            QPushButton#CopyCurrentLogButton:pressed {
                background: #1e40af;
                color: #ffffff;
            }
            QPushButton#PrimaryButton:disabled,
            QPushButton[class="PrimaryButton"]:disabled,
            QPushButton#NewSessionButton:disabled,
            QPushButton#CopyCurrentLogButton:disabled {
                background: #3b82f6;
                color: #ffffff;
                border: 1px solid #2563eb;
            }
            QPushButton#NewSessionButton {
                padding: 8px 12px;
                border-radius: 8px;
            }
            QPushButton#CopyCurrentLogButton {
                min-height: 28px;
                padding: 4px 12px;
            }
            QPushButton#DangerButton {
                background: #dc2626;
                color: #ffffff;
                border: 1px solid #b91c1c;
                border-radius: 6px;
                padding: 5px 12px;
                font-weight: 600;
            }
            QPushButton#DangerButton:hover {
                background: #b91c1c;
                color: #ffffff;
            }
            QPushButton#DangerButton:pressed {
                background: #991b1b;
                color: #ffffff;
            }
            QPushButton#DangerButton:disabled {
                background: #ef4444;
                color: #ffffff;
                border: 1px solid #dc2626;
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
            /* 页面行：刷新列表（查询/刷新，蓝色） */
            QPushButton#refreshPageListButton {
                background: #2563eb;
                color: #ffffff;
                border: 1px solid #1d4ed8;
                border-radius: 6px;
                padding: 5px 12px;
                font-weight: 600;
            }
            QPushButton#refreshPageListButton:hover {
                background: #1d4ed8;
                color: #ffffff;
            }
            QPushButton#refreshPageListButton:pressed {
                background: #1e40af;
                color: #ffffff;
            }
            QPushButton#refreshPageListButton:disabled {
                background: #3b82f6;
                color: #ffffff;
                border: 1px solid #2563eb;
            }
            /* 页面行：绑定所选页面（确认关联，绿色） */
            QPushButton#bindSelectedPageButton {
                background: #16a34a;
                color: #ffffff;
                border: 1px solid #15803d;
                border-radius: 6px;
                padding: 5px 12px;
                font-weight: 600;
            }
            QPushButton#bindSelectedPageButton:hover {
                background: #15803d;
                color: #ffffff;
            }
            QPushButton#bindSelectedPageButton:pressed {
                background: #166534;
                color: #ffffff;
            }
            QPushButton#bindSelectedPageButton:disabled {
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
            QLabel#StatusRelationLine {
                color: #5b6472;
                font-size: 12px;
                padding: 0px 4px;
            }
            QLabel#StatusRelationLine[state="warn"] {
                color: #92400e;
            }
            QWidget#ChatStatusBar {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
            }
            QFrame#SyncProgressPanel {
                background: #eff6ff;
                border: 1px solid #bfdbfe;
                border-radius: 6px;
            }
            QLabel#SyncProgressLabel {
                color: #1d4ed8;
                font-size: 12px;
                font-weight: 600;
            }
            QProgressBar#SyncProgressBar {
                border: 1px solid #bfdbfe;
                border-radius: 5px;
                background: #ffffff;
            }
            QProgressBar#SyncProgressBar::chunk {
                border-radius: 5px;
                background: #2563eb;
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
                border: 1px solid #fbbf24;
            }
            QWidget#ChatPanel[bindState="bind_mismatch"] {
                background: #fef2f2;
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
            QFrame#StatusInfoCard {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
            }
            QFrame#StatusPageCard {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
            }
            QLabel#StatusSectionTitle {
                color: #111827;
                font-size: 12px;
                font-weight: 700;
                padding: 0px 2px;
            }
            QLineEdit#StatusUrlEdit {
                background: #f9fafb;
                border: 1px solid #d1d5db;
                border-radius: 5px;
                padding: 3px 6px;
                color: #111827;
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
            QSplitter#ChatMainSplitter::handle {
                background: #d1d5db;
            }
            QSplitter#ChatMainSplitter::handle:horizontal {
                width: 4px;
            }
            QSplitter#ChatMainSplitter::handle:hover {
                background: #60a5fa;
            }
            QFrame#SessionCard[sessionState="bound_online"] {
                background: #ecfdf5;
                border: 1px solid #86efac;
            }
            QFrame#SessionCard[sessionState="bound_offline"] {
                background: #fffbeb;
                border: 1px solid #fbbf24;
            }
            QFrame#SessionCard[sessionState="unbound"] {
                background: #f9fafb;
                border: 1px solid #d1d5db;
            }
            QFrame#SessionCard[sessionState="bound_online"][isCurrentSession="true"] {
                background: #ecfdf5;
                border-top: 2px solid #2563eb;
                border-right: 2px solid #2563eb;
                border-bottom: 2px solid #2563eb;
                border-left: none;
            }
            QFrame#SessionCard[sessionState="bound_offline"][isCurrentSession="true"] {
                background: #fffbeb;
                border-top: 2px solid #2563eb;
                border-right: 2px solid #2563eb;
                border-bottom: 2px solid #2563eb;
                border-left: none;
            }
            QFrame#SessionCard[sessionState="unbound"][isCurrentSession="true"] {
                background: #f8fafc;
                border-top: 2px solid #2563eb;
                border-right: 2px solid #2563eb;
                border-bottom: 2px solid #2563eb;
                border-left: none;
            }
            QLabel#CurrentSessionBadge {
                color: #ffffff;
                background: #2563eb;
                border-radius: 6px;
                padding: 1px 6px;
                font-size: 11px;
                font-weight: 600;
                min-width: 30px;
                max-width: 42px;
            }
            QWidget#CurrentSessionHeader {
                background: transparent;
            }
            QLabel#CurrentSessionTitle {
                color: #111827;
                font-size: 15px;
                font-weight: 600;
                padding: 0px 4px;
                min-height: 28px;
            }
            QLabel#CurrentSessionUrlLabel {
                font-size: 12px;
                color: #475569;
                background: transparent;
                border: none;
                padding: 4px 8px;
                min-height: 28px;
            }
            QListWidget#SessionList {
                background: #f3f4f6;
                border: none;
                outline: none;
                padding-right: 6px;
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
                background: #f9fafb;
                border: 1px solid #d1d5db;
                border-radius: 8px;
            }
            QFrame#SessionCard:hover {
                border-color: #9ca3af;
            }
            QLabel#SessionItemTitle {
                color: #111827;
                font-size: 14px;
                font-weight: 600;
                background: transparent;
                min-height: 22px;
            }
            QLabel#SessionItemSubtitle {
                color: #6b7280;
                font-size: 12px;
                background: transparent;
                min-height: 18px;
            }
            QLabel#SessionBindStatusLabel {
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 6px;
                min-height: 18px;
            }
            QLabel#SessionPendingDot {
                color: #2563eb;
                font-size: 14px;
                background: transparent;
            }
            QWidget#ChatPage {
                background: #f8fafc;
            }
            QWidget#ChatHeaderBlock {
                background: #ffffff;
                border: none;
            }
            QTextBrowser#ChatTranscript {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
                border-radius: 10px;
                padding: 10px 12px;
                color: #111827;
                font-size: 13px;
            }
            QTextBrowser#ChatTranscript[replyFlash="false"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QTextBrowser#ChatTranscript[bindState="bound_online"],
            QTextBrowser#ChatTranscript[bindState="bound_offline"],
            QTextBrowser#ChatTranscript[bindState="unbound_optional"],
            QTextBrowser#ChatTranscript[bindState="unbound_required"],
            QTextBrowser#ChatTranscript[bindState="pending_bind"],
            QTextBrowser#ChatTranscript[bindState="waiting_bound_reopen"],
            QTextBrowser#ChatTranscript[bindState="prebound_home"] {
                background: #f7f8fa;
                border: 1px solid #e5e7eb;
            }
            QTextBrowser#ChatTranscript[bindState="bind_mismatch"] {
                background: #fef2f2;
                border: 1px solid #fca5a5;
            }
            QTextBrowser#ChatTranscript[replyFlash="true"][replyFlashPhase="1"] {
                background: #fff7ed;
                border: 2px solid #fb923c;
            }
            QTextBrowser#ChatTranscript[replyFlash="true"][replyFlashPhase="2"] {
                background: #ecfdf5;
                border: 2px solid #22c55e;
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
            QComboBox QAbstractItemView {
                background: #ffffff;
                color: #111827;
                selection-background-color: #2563eb;
                selection-color: #ffffff;
                outline: none;
            }
            """

REFRESH_PAGE_LIST_BUTTON_OBJECT_NAME = "refreshPageListButton"
BIND_SELECTED_PAGE_BUTTON_OBJECT_NAME = "bindSelectedPageButton"


def apply_refresh_button_style(button) -> None:
    """页面行「刷新页面列表」：蓝色刷新/查询按钮（依赖全局 APP_STYLESHEET）。"""
    if button is None:
        return
    button.setObjectName(REFRESH_PAGE_LIST_BUTTON_OBJECT_NAME)


def apply_bind_button_style(button) -> None:
    """页面行「绑定所选页面」：绿色确认绑定按钮（依赖全局 APP_STYLESHEET）。"""
    if button is None:
        return
    button.setObjectName(BIND_SELECTED_PAGE_BUTTON_OBJECT_NAME)
