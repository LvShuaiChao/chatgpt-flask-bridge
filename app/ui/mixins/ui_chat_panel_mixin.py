"""聊天页：侧栏、会话区、状态条与分割条持久化。"""
import traceback

from app.constants import DEFAULT_CHAT_INPUT_TEXT, STATUS_CHIP_SESSION_BIND_TOOLTIP
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.elided_label import ElidedLabel
from app.ui.widgets.segmented_elided_label import SegmentedElidedLabel
from app.ui.widgets.session_list import SessionListWidget
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QFont, QTextCursor
from PyQt5.QtWidgets import (
    QAbstractItemView,
    QFrame,
    QHBoxLayout,
    QLabel,
    QProgressBar,
    QPushButton,
    QSplitter,
    QSizePolicy,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)


class UiChatPanelMixin:
    def _message_input_widget(self):
        widget = getattr(self, "message_input", None)
        if widget is not None:
            return widget
        return getattr(self, "message_edit", None)

    def _move_message_input_cursor_to_end(self, input_widget=None):
        widget = input_widget or self._message_input_widget()
        if widget is None:
            return
        if hasattr(widget, "focus_to_end"):
            widget.focus_to_end()
            return
        if hasattr(widget, "textCursor"):
            cursor = widget.textCursor()
            cursor.movePosition(QTextCursor.End)
            widget.setTextCursor(cursor)
        elif hasattr(widget, "moveCursor"):
            widget.moveCursor(QTextCursor.End)

    def _ensure_default_chat_input_text(self):
        input_widget = self._message_input_widget()
        if input_widget is None:
            return
        if input_widget.toPlainText().strip():
            return
        input_widget.setPlainText(DEFAULT_CHAT_INPUT_TEXT)
        self._move_message_input_cursor_to_end(input_widget)

    def _session_compose_drafts_map(self):
        drafts = getattr(self, "_session_compose_drafts", None)
        if drafts is None:
            drafts = {}
            self._session_compose_drafts = drafts
        return drafts

    def _stash_session_compose_draft(self, session_id):
        session_id = (session_id or "").strip()
        if not session_id:
            return
        input_widget = self._message_input_widget()
        if input_widget is None:
            return
        drafts = self._session_compose_drafts_map()
        text = input_widget.toPlainText()
        if text.strip():
            drafts[session_id] = text
        else:
            drafts.pop(session_id, None)

    def _restore_session_compose_input(self, session_id):
        session_id = (session_id or "").strip()
        input_widget = self._message_input_widget()
        if input_widget is None:
            return
        if not session_id:
            self._ensure_default_chat_input_text()
            return
        draft = self._session_compose_drafts_map().get(session_id, "")
        if str(draft).strip():
            input_widget.setPlainText(draft)
            self._move_message_input_cursor_to_end(input_widget)
            return
        self._ensure_default_chat_input_text()

    CHAT_SUB_TAB_CHAT = 0
    CHAT_SUB_TAB_CURSOR_FLOW = 1
    CURSOR_FLOW_TAB_TITLE_BASE = "Cursor 流程"
    CHAT_SIDEBAR_MIN_WIDTH = 260
    CHAT_SIDEBAR_DEFAULT_WIDTH = 320
    CHAT_SIDEBAR_MAX_WIDTH = 460
    CHAT_MAIN_MIN_WIDTH = 700
    CHAT_SPLITTER_INVALID_LEFT = 220
    CHAT_SPLITTER_INVALID_RIGHT = 600
    CHAT_SPLITTER_DEFAULT_RIGHT = 1280

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
            self.copy_last_btn,
            self._copy_last_reply,
            tag="copy_last_btn",
        )
        self._reconnect_button(
            self.clear_current_session_btn,
            self._clear_current_session,
            tag="clear_current_session_btn",
        )
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

        self._chat_panel = self._build_chat_panel()
        page_layout.addWidget(self._chat_panel, 1)
        return page

    def _sync_bridge_status_panel_height(self):
        panel = getattr(self, "bridge_status_panel", None)
        status_group = getattr(self, "_chat_status_group", None)
        if panel is None or status_group is None:
            return
        panel_layout = panel.layout()
        if panel_layout is not None:
            panel_layout.invalidate()
            panel_layout.activate()
        status_group.updateGeometry()
        margins = panel_layout.contentsMargins() if panel_layout is not None else None
        extra = 0
        if margins is not None:
            extra = margins.top() + margins.bottom()
        panel.setMinimumHeight(max(0, status_group.sizeHint().height() + extra))
        panel.updateGeometry()

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
        self.tm_online_label = QLabel("页面：在线 0")
        self.tm_online_label.setObjectName("StatusChip")
        self.tm_bound_page_label = QLabel("绑定：未绑定")
        self.tm_bound_page_label.setObjectName("StatusChip")
        self.tm_bound_page_label.setToolTip(STATUS_CHIP_SESSION_BIND_TOOLTIP)
        self.tm_sync_target_label = QLabel("同步：不可用")
        self.tm_sync_target_label.setObjectName("StatusChip")
        for chip in (
            self.status_label,
            self.tm_online_label,
            self.tm_bound_page_label,
            self.tm_sync_target_label,
        ):
            chip.setWordWrap(False)
            chip.setFixedHeight(30)
            chip.setMinimumHeight(30)
            chip.setMaximumHeight(30)
            chip.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        top_row.addWidget(self.status_label)
        top_row.addWidget(self.tm_online_label)
        top_row.addWidget(self.tm_bound_page_label)
        top_row.addWidget(self.tm_sync_target_label)
        top_row.addStretch(1)
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

        page_row_host = QWidget()
        page_row_host.setObjectName("StatusPageRow")
        page_row_layout = QVBoxLayout(page_row_host)
        page_row_layout.setContentsMargins(0, 0, 0, 0)
        page_row_layout.setSpacing(6)
        self._build_tm_page_selector_row(page_row_layout)
        page_row_layout.addLayout(self._build_page_action_row())
        outer.addWidget(page_row_host)

        self.open_live_page_btn = QPushButton("打开")
        self.open_live_page_btn.setObjectName("PrimaryButton")
        self.open_live_page_btn.setVisible(False)

        return bar

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
        chat_area_layout.setSpacing(6)

        header_block = QWidget()
        header_block.setObjectName("ChatHeaderBlock")
        header_block.setMinimumHeight(56)
        header_block.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        header_layout = QVBoxLayout(header_block)
        header_layout.setContentsMargins(0, 0, 0, 0)
        header_layout.setSpacing(6)

        session_title_row = QWidget()
        session_title_row.setObjectName("CurrentSessionHeader")
        session_title_row.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        session_title_row_layout = QHBoxLayout(session_title_row)
        session_title_row_layout.setContentsMargins(0, 0, 0, 0)
        session_title_row_layout.setSpacing(12)

        self.current_session_title = SegmentedElidedLabel("当前会话：新对话")
        self.current_session_title.setObjectName("CurrentSessionTitle")
        self.current_session_title.setMinimumHeight(28)
        self.current_session_title.setMinimumWidth(0)
        self.current_session_title.setSizePolicy(
            QSizePolicy.Ignored, QSizePolicy.Preferred
        )
        session_title_row_layout.addWidget(self.current_session_title, 1)

        self.chat_stats_label = QLabel(
            "统计：共 0 条｜我 0 条 0 字｜AI 0 条 0 字｜总 0 字"
        )
        self.chat_stats_label.setObjectName("CurrentSessionStatsLabel")
        self.chat_stats_label.setMinimumHeight(28)
        self.chat_stats_label.setMinimumWidth(520)
        self.chat_stats_label.setWordWrap(False)
        self.chat_stats_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.chat_stats_label.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Preferred)
        self.chat_stats_label.setVisible(True)
        session_title_row_layout.addWidget(
            self.chat_stats_label, 0, Qt.AlignRight | Qt.AlignVCenter
        )
        header_layout.addWidget(session_title_row)

        url_row_widget = QWidget()
        url_row_widget.setMinimumHeight(36)
        url_row_widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        url_row = QHBoxLayout(url_row_widget)
        url_row.setContentsMargins(8, 6, 8, 6)
        url_row.setSpacing(8)
        self.current_session_url_label = SegmentedElidedLabel(
            "绑定网址：未绑定 ChatGPT 页面"
        )
        self.current_session_url_label.setObjectName("CurrentSessionUrlLabel")
        self.current_session_url_label.setWordWrap(False)
        self.current_session_url_label.setMinimumHeight(28)
        self.current_session_url_label.setSizePolicy(
            QSizePolicy.Expanding, QSizePolicy.Preferred
        )
        url_row.addWidget(self.current_session_url_label, 1, Qt.AlignVCenter)
        header_layout.addWidget(url_row_widget)
        chat_area_layout.addWidget(header_block, 0)

        self.chat_transcript = QTextBrowser()
        self.chat_transcript.setObjectName("ChatTranscript")
        self.chat_transcript.setProperty("replyFlash", "false")
        self.chat_transcript.setProperty("replyFlashPhase", "0")
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
        chat_area_layout.addWidget(self.chat_transcript, 1)

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
        self._ensure_default_chat_input_text()
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
        self.clear_current_session_btn = QPushButton("清空当前对话")
        self.clear_current_session_btn.setObjectName("DangerButton")
        self.clear_current_session_btn.setToolTip(
            "清空当前会话中的本地聊天记录，不删除会话，不解绑页面"
        )
        bottom_action_row.addWidget(self.clear_current_session_btn)
        self.copy_last_btn = QPushButton("复制最后回复")
        self.copy_last_btn.setObjectName("PrimaryButton")
        bottom_action_row.addWidget(self.copy_last_btn)
        input_layout.addLayout(bottom_action_row)
        chat_area_layout.addWidget(input_block, 0)
        self._bind_chat_panel_signals()

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
