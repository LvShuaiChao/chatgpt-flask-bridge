import traceback

import server
from app.core import job_scheduler
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import (
    QApplication,
    QCheckBox,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPlainTextEdit,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)


JOB_STATUS_LABELS = {
    "created": "已创建",
    "queued_chatgpt": "ChatGPT 排队中",
    "sent_to_chatgpt": "已发往 ChatGPT",
    "waiting_chatgpt_reply": "等待 ChatGPT 回复",
    "chatgpt_reply_ready": "ChatGPT 已返回指令",
    "queued_cursor": "Cursor 任务排队中",
    "cursor_claimed": "Cursor 插件已领取",
    "cursor_submitted": "已提交给 Cursor Agent，等待执行完成",
    "cursor_running": "Cursor 执行中",
    "cursor_done": "Cursor 已完成",
    "cursor_failed": "任务失败",
    "cancelled": "已取消",
}

TASK_LOG_PANEL_MIN_HEIGHT = 120
TASK_DETAIL_PANEL_MAX_HEIGHT = 180
TASK_STATUS_BAR_MAX_HEIGHT = 36


class JobSchedulerMixin:
    """任务调度 UI 位于「Cursor 动作编排」二级页签内。"""

    def _build_job_task_ui(self, parent_layout):
        self._build_task_queue_card(parent_layout)
        self._build_task_status_bar()
        self._build_task_detail_panel()
        parent_layout.addWidget(self.task_status_bar, 0)
        parent_layout.addWidget(self.task_detail_panel, 0)
        self._build_cursor_flow_task_log_section(parent_layout)

    def _build_task_queue_card(self, parent_layout):
        self.task_queue_card = QFrame()
        self.task_queue_card.setObjectName("TaskCard")
        card_layout = QVBoxLayout(self.task_queue_card)
        card_layout.setContentsMargins(10, 10, 10, 10)
        card_layout.setSpacing(6)
        card_layout.addWidget(self._build_task_card_title("任务队列"))

        grid = QGridLayout()
        grid.setHorizontalSpacing(12)
        grid.setVerticalSpacing(6)
        grid.setColumnStretch(1, 1)
        self.task_queue_session_value = self._add_task_grid_field(
            grid, 0, "当前对话队列"
        )
        self.task_queue_bridge_value = self._add_task_grid_field(
            grid, 1, "桥接待发队列"
        )
        self.task_queue_cursor_value = self._add_task_grid_field(
            grid, 2, "Cursor 待处理"
        )
        card_layout.addLayout(grid)
        parent_layout.addWidget(self.task_queue_card, 0)

    def _update_task_queue_card(self, bridge_status=None):
        if not hasattr(self, "task_queue_session_value"):
            return
        current_q = 0
        total_q = 0
        if hasattr(self, "_current_session_queue_size"):
            current_q = self._current_session_queue_size()
        if hasattr(self, "_total_session_queue_size"):
            total_q = self._total_session_queue_size()
        self._set_task_value(
            self.task_queue_session_value, f"当前 {current_q} / 总 {total_q}"
        )
        status = bridge_status if bridge_status is not None else (
            getattr(self, "_last_bridge_status", {}) or {}
        )
        pending = int(status.get("queue_length") or 0)
        ctrl = int(status.get("control_queue_length") or 0)
        self._set_task_value(
            self.task_queue_bridge_value, f"消息 {pending} / 控制 {ctrl}"
        )
        cursor_pending = 0
        if hasattr(self, "_last_cursor_bridge_status"):
            cursor_pending = int(
                (self._last_cursor_bridge_status or {}).get("pending_count") or 0
            )
        self._set_task_value(self.task_queue_cursor_value, str(cursor_pending))

    def _build_task_status_bar(self):
        self.task_status_bar = QWidget()
        self.task_status_bar.setObjectName("TaskStatusBar")
        self.task_status_bar.setVisible(False)
        self.task_status_bar.setMaximumHeight(TASK_STATUS_BAR_MAX_HEIGHT)
        self.task_status_bar.setSizePolicy(
            QSizePolicy.Expanding,
            QSizePolicy.Fixed,
        )

        bar_layout = QHBoxLayout(self.task_status_bar)
        bar_layout.setContentsMargins(8, 4, 8, 4)
        bar_layout.setSpacing(8)

        self.task_status_summary_label = QLabel("任务：—")
        self.task_status_summary_label.setObjectName("TaskStatusSummary")
        self.task_status_summary_label.setWordWrap(False)
        self.task_status_summary_label.setSizePolicy(
            QSizePolicy.Expanding,
            QSizePolicy.Preferred,
        )
        bar_layout.addWidget(self.task_status_summary_label, 1)

        self.task_detail_toggle_btn = QPushButton("详情")
        self.task_detail_toggle_btn.setObjectName("PrimaryButton")
        self.task_detail_toggle_btn.setFixedHeight(28)
        self.task_detail_toggle_btn.clicked.connect(self._toggle_task_detail_panel)
        bar_layout.addWidget(self.task_detail_toggle_btn)

        self.task_status_cancel_btn = QPushButton("取消")
        self.task_status_cancel_btn.setObjectName("DangerButton")
        self.task_status_cancel_btn.setFixedHeight(28)
        self.task_status_cancel_btn.clicked.connect(self._on_job_cancel)
        bar_layout.addWidget(self.task_status_cancel_btn)

    def _build_task_detail_panel(self):
        self.task_detail_panel = QWidget()
        self.task_detail_panel.setObjectName("TaskDetailPanel")
        self.task_detail_panel.setVisible(False)
        self.task_detail_panel.setSizePolicy(
            QSizePolicy.Expanding,
            QSizePolicy.Fixed,
        )
        self.task_detail_panel.setMaximumHeight(TASK_DETAIL_PANEL_MAX_HEIGHT)

        outer = QVBoxLayout(self.task_detail_panel)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        self.task_detail_scroll = QScrollArea()
        self.task_detail_scroll.setObjectName("TaskDetailScroll")
        self.task_detail_scroll.setWidgetResizable(True)
        self.task_detail_scroll.setFrameShape(QFrame.NoFrame)
        self.task_detail_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.task_detail_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)

        self.task_detail_content = QWidget()
        self.task_detail_content.setObjectName("TaskDetailContent")
        self.task_scheduler_layout = QVBoxLayout(self.task_detail_content)
        self.task_scheduler_layout.setContentsMargins(0, 0, 0, 0)
        self.task_scheduler_layout.setSpacing(8)

        self._build_task_current_card()
        self._build_task_flow_card()
        self._build_task_action_card()

        self.task_detail_scroll.setWidget(self.task_detail_content)
        outer.addWidget(self.task_detail_scroll)

        self._active_job_id = ""

    def _build_cursor_flow_task_log_section(self, parent_layout):
        log_card = QFrame()
        log_card.setObjectName("TaskCard")
        log_layout = QVBoxLayout(log_card)
        log_layout.setContentsMargins(10, 10, 10, 10)
        log_layout.setSpacing(6)
        log_layout.addWidget(self._build_task_card_title("最近任务日志"))

        log_toolbar = QHBoxLayout()
        log_toolbar.setSpacing(6)
        self.copy_job_log_btn = QPushButton("复制任务日志")
        self.copy_job_log_btn.setObjectName("PrimaryButton")
        self.copy_job_log_btn.setFixedHeight(32)
        self.copy_job_log_btn.clicked.connect(self._on_copy_job_log_clicked)
        self.refresh_job_btn = QPushButton("刷新状态")
        self.refresh_job_btn.setObjectName("PrimaryButton")
        self.refresh_job_btn.setFixedHeight(32)
        self.refresh_job_btn.clicked.connect(self._on_job_refresh)
        self.cancel_job_btn = QPushButton("取消任务")
        self.cancel_job_btn.setObjectName("DangerButton")
        self.cancel_job_btn.setFixedHeight(32)
        self.cancel_job_btn.clicked.connect(self._on_job_cancel)
        log_toolbar.addWidget(self.copy_job_log_btn)
        log_toolbar.addWidget(self.refresh_job_btn)
        log_toolbar.addWidget(self.cancel_job_btn)
        log_toolbar.addStretch()
        log_layout.addLayout(log_toolbar)

        self.cursor_task_log_edit = QPlainTextEdit()
        self.cursor_task_log_edit.setObjectName("CursorTaskLogText")
        self.cursor_task_log_edit.setReadOnly(True)
        self.cursor_task_log_edit.setLineWrapMode(QPlainTextEdit.WidgetWidth)
        self.cursor_task_log_edit.setMaximumBlockCount(2000)
        self.cursor_task_log_edit.setFont(QFont("Consolas", 9))
        self.cursor_task_log_edit.setMinimumHeight(TASK_LOG_PANEL_MIN_HEIGHT)
        log_layout.addWidget(self.cursor_task_log_edit, stretch=1)
        parent_layout.addWidget(log_card, 0)

    def _toggle_task_detail_panel(self):
        if hasattr(self, "_focus_cursor_flow_tab"):
            self._focus_cursor_flow_tab()

    def _build_task_card_title(self, text):
        label = QLabel(text)
        label.setObjectName("TaskCardTitle")
        return label

    def _add_task_grid_field(self, grid, row, name):
        name_label = QLabel(name)
        name_label.setObjectName("TaskFieldName")
        value_label = QLabel("—")
        value_label.setObjectName("TaskFieldValue")
        value_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        value_label.setWordWrap(True)
        grid.addWidget(name_label, row, 0, Qt.AlignTop)
        grid.addWidget(value_label, row, 1)
        return value_label

    def _build_task_current_card(self):
        self.task_current_card = QFrame()
        self.task_current_card.setObjectName("TaskCard")
        card_layout = QVBoxLayout(self.task_current_card)
        card_layout.setContentsMargins(10, 10, 10, 10)
        card_layout.setSpacing(8)
        card_layout.addWidget(self._build_task_card_title("当前任务"))

        grid = QGridLayout()
        grid.setHorizontalSpacing(12)
        grid.setVerticalSpacing(6)
        grid.setColumnStretch(1, 1)
        self.task_job_id_value = self._add_task_grid_field(grid, 0, "任务 ID")
        self.task_title_value = self._add_task_grid_field(grid, 1, "标题")
        self.task_status_value = self._add_task_grid_field(grid, 2, "状态")
        self.task_chatgpt_status_value = self._add_task_grid_field(
            grid, 3, "ChatGPT 状态"
        )
        self.task_cursor_status_value = self._add_task_grid_field(
            grid, 4, "Cursor 状态"
        )
        self.task_cursor_task_id_value = self._add_task_grid_field(
            grid, 5, "Cursor task_id"
        )
        self.task_error_value = self._add_task_grid_field(grid, 6, "最后错误")
        self.task_updated_at_value = self._add_task_grid_field(grid, 7, "更新时间")
        card_layout.addLayout(grid)
        self.task_scheduler_layout.addWidget(self.task_current_card)

    def _build_task_flow_card(self):
        self.task_flow_card = QFrame()
        self.task_flow_card.setObjectName("TaskCard")
        card_layout = QVBoxLayout(self.task_flow_card)
        card_layout.setContentsMargins(10, 10, 10, 10)
        card_layout.setSpacing(6)
        card_layout.addWidget(self._build_task_card_title("流程进度"))
        self.task_flow_label = QLabel("当前没有任务")
        self.task_flow_label.setObjectName("TaskFlowLabel")
        self.task_flow_label.setWordWrap(True)
        card_layout.addWidget(self.task_flow_label)
        self.task_scheduler_layout.addWidget(self.task_flow_card)

    def _build_task_action_card(self):
        self.task_action_card = QFrame()
        self.task_action_card.setObjectName("TaskCard")
        card_layout = QVBoxLayout(self.task_action_card)
        card_layout.setContentsMargins(10, 10, 10, 10)
        card_layout.setSpacing(8)
        card_layout.addWidget(self._build_task_card_title("ChatGPT -> Cursor 自动流程"))

        self.job_auto_send_cb = QCheckBox("收到 ChatGPT 回复后自动发送到 Cursor")
        card_layout.addWidget(self.job_auto_send_cb)

        btn_height = 32
        self.generate_cursor_instruction_btn = QPushButton("生成 Cursor 修改指令")
        self.send_chatgpt_reply_to_cursor_btn = QPushButton(
            "发送 ChatGPT 回复到 Cursor"
        )
        self.auto_chatgpt_to_cursor_btn = QPushButton(
            "自动流程：ChatGPT -> Cursor"
        )

        for btn in (
            self.generate_cursor_instruction_btn,
            self.send_chatgpt_reply_to_cursor_btn,
            self.auto_chatgpt_to_cursor_btn,
        ):
            btn.setFixedHeight(btn_height)
            btn.setMinimumHeight(btn_height)

        for btn in (
            self.generate_cursor_instruction_btn,
            self.send_chatgpt_reply_to_cursor_btn,
            self.auto_chatgpt_to_cursor_btn,
        ):
            btn.setObjectName("PrimaryButton")
            btn.setEnabled(True)

        btn_row1 = QHBoxLayout()
        btn_row1.setSpacing(6)
        btn_row1.addWidget(self.generate_cursor_instruction_btn)
        btn_row1.addWidget(self.send_chatgpt_reply_to_cursor_btn)
        btn_row1.addWidget(self.auto_chatgpt_to_cursor_btn)
        btn_row1.addStretch()
        card_layout.addLayout(btn_row1)

        self.task_hint_label = QLabel("")
        self.task_hint_label.setObjectName("TaskHintLabel")
        self.task_hint_label.setWordWrap(True)
        card_layout.addWidget(self.task_hint_label)

        self.generate_cursor_instruction_btn.clicked.connect(
            self._on_job_generate_cursor_instruction
        )
        self.send_chatgpt_reply_to_cursor_btn.clicked.connect(
            self._on_job_send_reply_to_cursor
        )
        self.auto_chatgpt_to_cursor_btn.clicked.connect(self._on_job_auto_flow)

        self.task_scheduler_layout.addWidget(self.task_action_card)

    def _set_task_value(self, label, value):
        if label is None:
            return
        text = str(value).strip() if value is not None else ""
        label.setText(text or "—")

    def _format_job_log_line(self, entry):
        if isinstance(entry, dict):
            tag = entry.get("tag") or ""
            msg = entry.get("message") or ""
            ts = entry.get("time") or ""
            return f"[{ts}] [{tag}] {msg}".strip()
        return str(entry)

    def _set_task_log_lines(self, lines):
        formatted = [self._format_job_log_line(x) for x in (lines or [])]
        safe_lines = formatted[-50:]
        text = "\n".join(safe_lines)
        for widget_name in ("cursor_task_log_edit", "job_log_edit"):
            edit = getattr(self, widget_name, None)
            if edit is not None:
                edit.setPlainText(text)

    def _job_is_running(self, job):
        if not job:
            return False
        status = (job.get("status") or "").strip()
        return status not in ("cursor_done", "cursor_failed", "cancelled")

    def _update_job_status_chip(self, job=None):
        chip = getattr(self, "job_status_chip", None)
        if chip is None:
            return
        if not job:
            chip.setText("任务：空闲")
            chip.setStyleSheet("")
            if hasattr(self, "_update_cursor_flow_tab_title_indicator"):
                self._update_cursor_flow_tab_title_indicator(None)
            return
        title = (job.get("title") or job.get("job_id") or "活动任务").strip()
        status = self._job_status_label(job.get("status") or "")
        if self._job_is_running(job):
            chip.setText(f"任务：运行中 | {status}")
        else:
            chip.setText(f"任务：{title[:24]} | {status}")
        err = (job.get("error") or "").strip()
        if err:
            chip.setStyleSheet("color: #b91c1c; font-weight: 600;")
        else:
            chip.setStyleSheet("")
        if hasattr(self, "_update_cursor_flow_tab_title_indicator"):
            self._update_cursor_flow_tab_title_indicator(job)

    def _update_task_status_bar_summary(self, job):
        label = getattr(self, "task_status_summary_label", None)
        if label is None:
            return
        if not job:
            label.setText("任务：—")
            return
        title = (job.get("title") or job.get("job_id") or "活动任务").strip()
        status = self._job_status_label(job.get("status") or "")
        err = (job.get("error") or "").strip()
        summary = f"任务：{title[:48]} | 状态：{status}"
        if err:
            err_short = err if len(err) <= 60 else err[:57] + "…"
            summary += f" | 错误：{err_short}"
        label.setText(summary)
        if err:
            label.setStyleSheet("color: #b91c1c;")
        else:
            label.setStyleSheet("")

    def _hide_job_task_ui(self):
        if hasattr(self, "task_status_bar"):
            self.task_status_bar.setVisible(False)
        self._update_job_status_chip(None)
        if hasattr(self, "_update_task_queue_card"):
            self._update_task_queue_card()

    def _show_job_task_status_bar(self, job):
        if hasattr(self, "task_status_bar"):
            self.task_status_bar.setVisible(True)
        self._update_task_status_bar_summary(job)
        self._update_job_status_chip(job)

    def _get_current_job_snapshot(self):
        if self._active_job_id:
            job = job_scheduler.get_job(self._active_job_id)
            if job:
                return job
        try:
            snapshot = job_scheduler.get_job_scheduler_snapshot()
        except Exception as exc:
            self._append_log(
                "[JOB][SNAPSHOT_FAILED] "
                f"error={exc}\n{traceback.format_exc()}",
                echo=True,
            )
            return None
        if isinstance(snapshot, dict):
            active = snapshot.get("active_job")
            if active:
                return active
        return None

    def _build_task_flow_text(self, job):
        status = (job.get("status") or "").strip() if job else ""
        if status == "created":
            return (
                "● 创建任务  →  ○ 发送给 ChatGPT  →  ○ 等待回复  →  "
                "○ 发送给 Cursor  →  ○ 完成"
            )
        if status in ("queued_chatgpt", "sent_to_chatgpt", "waiting_chatgpt_reply"):
            return (
                "✓ 创建任务  →  ✓ 已发送给 ChatGPT  →  ● 等待 ChatGPT 回复  →  "
                "○ 发送给 Cursor  →  ○ 完成"
            )
        if status == "chatgpt_reply_ready":
            return (
                "✓ ChatGPT 已回复  →  ● 等待发送到 Cursor  →  ○ Cursor 已提交  →  "
                "○ 完成"
            )
        if status in ("queued_cursor", "cursor_claimed"):
            return (
                "✓ ChatGPT 已回复  →  ✓ 已发送到 Cursor 队列  →  "
                "● Cursor 插件处理中  →  ○ 完成"
            )
        if status in ("cursor_submitted", "cursor_running"):
            return "✓ 已提交给 Cursor Agent  →  ● 等待 Cursor 执行完成"
        if status == "cursor_done":
            return "✓ ChatGPT 已回复  →  ✓ Cursor 已提交  →  ✓ 任务完成"
        if status == "cursor_failed":
            return "✕ Cursor 任务失败，请查看错误日志"
        if status == "cancelled":
            return "任务已取消"
        return "当前没有任务"

    def _job_user_requirement_text(self):
        if hasattr(self, "message_edit") and self.message_edit is not None:
            return self.message_edit.toPlainText().strip()
        return ""

    def _job_project_root(self):
        if hasattr(self, "_get_current_project_root"):
            return self._get_current_project_root()
        import os

        return os.path.abspath(os.getcwd())

    def _job_chatgpt_payload_extra(self, session):
        if session is None:
            return None, "当前无对话会话"
        if not hasattr(self, "_resolve_target_page_for_session"):
            return {"session_id": session.session_id}, None

        target_client_id, target_page_url, allowed, reason = (
            self._resolve_target_page_for_session(session)
        )
        if not allowed:
            return None, reason or "无法解析发送目标页面"

        payload = {"session_id": session.session_id}
        if target_client_id:
            payload["target_client_id"] = target_client_id
        if target_page_url:
            payload["target_page_url"] = target_page_url
        return payload, None

    def _job_status_label(self, status):
        return JOB_STATUS_LABELS.get(status or "", status or "—")

    def _job_chatgpt_phase_text(self, job):
        if not job:
            return "—"
        status = job.get("status") or ""
        if status in ("waiting_chatgpt_reply", "sent_to_chatgpt", "queued_chatgpt"):
            return "等待回复中"
        if job.get("chatgpt_reply"):
            return "已回复"
        if status == "chatgpt_reply_ready":
            return "已返回 Cursor 修改指令"
        if status in ("cursor_failed", "cancelled") and not job.get("chatgpt_reply"):
            return "未收到有效回复"
        return "未开始"

    def _job_cursor_phase_text(self, job):
        if not job:
            return "—"
        status = job.get("status") or ""
        cursor_st = (job.get("cursor_status") or "").strip()
        if status == "cursor_submitted":
            return "已提交给 Cursor Agent，等待执行完成"
        if status == "cursor_claimed":
            return "插件已领取，准备提交"
        if status == "queued_cursor":
            return "任务已入队，等待插件领取"
        if status == "cursor_done":
            return "已完成（插件上报 done）"
        if status == "cursor_failed":
            return f"失败：{job.get('error') or cursor_st or '—'}"
        if cursor_st:
            return cursor_st
        if job.get("cursor_task_id"):
            return "已创建 Cursor 任务，等待状态回报"
        return "尚未发送到 Cursor"

    def _set_job_hint(self, text):
        if hasattr(self, "task_hint_label"):
            self.task_hint_label.setText((text or "").strip())

    def _refresh_job_scheduler_panel(self, snapshot=None):
        if not hasattr(self, "task_job_id_value"):
            return

        if hasattr(self, "_update_task_queue_card"):
            self._update_task_queue_card()

        job = None
        try:
            if snapshot is None:
                snapshot = job_scheduler.get_job_scheduler_snapshot()
            if self._active_job_id:
                fetched = job_scheduler.get_job(self._active_job_id)
                if fetched:
                    job = fetched
            if not job and isinstance(snapshot, dict):
                job = snapshot.get("active_job")
        except Exception as exc:
            self._append_log(
                "[JOB][REFRESH_FAILED] "
                f"error={exc}\n{traceback.format_exc()}",
                echo=True,
            )
            self._set_job_hint(f"读取任务状态失败：{exc}")
            return

        if not job:
            self._active_job_id = ""
            self._hide_job_task_ui()
            self._set_task_log_lines([])
            if hasattr(self, "send_chatgpt_reply_to_cursor_btn"):
                self.send_chatgpt_reply_to_cursor_btn.setEnabled(True)
            self._set_job_hint("")
            return

        job_id = job.get("job_id") or ""
        self._active_job_id = job_id
        status = job.get("status") or ""

        self._show_job_task_status_bar(job)

        self._set_task_value(self.task_job_id_value, job_id)
        self._set_task_value(self.task_title_value, job.get("title"))
        self._set_task_value(self.task_status_value, self._job_status_label(status))
        self._set_task_value(
            self.task_chatgpt_status_value, self._job_chatgpt_phase_text(job)
        )
        self._set_task_value(
            self.task_cursor_status_value, self._job_cursor_phase_text(job)
        )
        self._set_task_value(self.task_cursor_task_id_value, job.get("cursor_task_id"))
        self._set_task_value(self.task_error_value, job.get("error"))
        self._set_task_value(self.task_updated_at_value, job.get("updated_at"))

        self.task_flow_label.setText(self._build_task_flow_text(job))
        self._set_task_log_lines(job.get("logs") or [])

        self.send_chatgpt_reply_to_cursor_btn.setEnabled(True)

        if status == "chatgpt_reply_ready":
            self._set_job_hint(
                "ChatGPT 已返回 Cursor 修改指令。可点击「发送 ChatGPT 回复到 Cursor」。"
            )
        elif status == "cursor_submitted":
            self._set_job_hint(
                "已提交给 Cursor Agent，等待 Cursor 执行完成。"
                "（此状态不代表代码已改完，请勿与「已完成」混淆。）"
            )
        elif status == "cursor_done":
            self._set_job_hint("Cursor 插件已上报任务完成。")
        elif status == "waiting_chatgpt_reply":
            self._set_job_hint("已发往 ChatGPT，等待油猴同步 assistant 回复…")
        else:
            self._set_job_hint("")

    def _on_job_refresh(self):
        self._refresh_job_scheduler_panel()

    def _on_copy_job_log_clicked(self):
        job = self._get_current_job_snapshot()
        logs = []
        if job:
            logs = job.get("logs") or []

        if not logs:
            QApplication.clipboard().setText("")
            if hasattr(self, "_add_system_message"):
                self._add_system_message("暂无任务日志可复制。")
            else:
                self._set_job_hint("暂无任务日志可复制。")
            return

        lines = [self._format_job_log_line(entry) for entry in logs]
        text = "\n".join(lines)
        QApplication.clipboard().setText(text)
        if hasattr(self, "_add_system_message"):
            self._add_system_message("已复制任务日志。")
        else:
            self._set_job_hint(f"已复制任务日志，共 {len(text)} 字符。")

    def _on_job_cancel(self):
        job_id = self._active_job_id
        if not job_id:
            self._set_job_hint("无活动任务可取消。")
            return
        ok, result = job_scheduler.cancel_job(job_id, reason="GUI 取消")
        if ok:
            self._set_job_hint("任务已取消。")
            self._append_log(f"[JOB][CANCEL] job_id={job_id}", echo=True)
        else:
            self._set_job_hint(f"取消失败：{result}")
        self._refresh_job_scheduler_panel()

    def _job_create_and_prepare(self, *, auto_send_to_cursor=False):
        if not server.is_server_running():
            self._set_job_hint("请先启动服务。")
            if hasattr(self, "_add_system_message"):
                self._add_system_message("请先启动服务。")
            return None, "server_not_running"

        requirement = self._job_user_requirement_text()
        if not requirement:
            self._set_job_hint("请在输入框填写用户需求。")
            return None, "empty_requirement"

        session = (
            self._ensure_current_session()
            if hasattr(self, "_ensure_current_session")
            else None
        )
        title = requirement[:40]
        job_id, result = job_scheduler.create_job(
            requirement,
            title=title,
            auto_send_to_cursor=auto_send_to_cursor,
            project_root=self._job_project_root(),
        )
        if not job_id:
            self._set_job_hint(f"创建任务失败：{result}")
            return None, result

        self._active_job_id = job_id
        self._append_log(f"[JOB][CREATE] job_id={job_id} title={title}", echo=True)
        self._refresh_job_scheduler_panel()
        return job_id, session

    def _job_send_chatgpt(self, job_id, session):
        extra, err = self._job_chatgpt_payload_extra(session)
        if err:
            self._set_job_hint(err)
            if hasattr(self, "_add_system_message"):
                self._add_system_message(err)
            job_scheduler.update_job_status(job_id, "cursor_failed", err)
            return False, err

        ok, result = server.send_job_chatgpt_message(job_id, payload_extra=extra)
        if not ok:
            self._set_job_hint(f"发往 ChatGPT 失败：{result}")
            self._append_log(
                f"[JOB][SEND_TO_CHATGPT_FAILED] job_id={job_id} error={result}",
                echo=True,
            )
            return False, result

        self._set_job_hint("已发往 ChatGPT，等待回复…")
        self._append_log(
            f"[JOB][SEND_TO_CHATGPT] job_id={job_id} message_id={result}",
            echo=True,
        )
        self._refresh_job_scheduler_panel()
        return True, result

    def _on_job_generate_cursor_instruction(self):
        auto = (
            self.job_auto_send_cb.isChecked()
            if hasattr(self, "job_auto_send_cb")
            else False
        )
        job_id, session = self._job_create_and_prepare(auto_send_to_cursor=auto)
        if not job_id:
            return
        self._job_send_chatgpt(job_id, session)

    def _on_job_send_reply_to_cursor(self):
        job_id = self._active_job_id
        if not job_id:
            self._set_job_hint("请先创建任务并等待 ChatGPT 回复。")
            return
        job = None
        try:
            job = job_scheduler.get_job(job_id)
        except Exception:
            job = None
        reply = ((job or {}).get("chatgpt_reply") or "").strip()
        if not reply:
            self._set_job_hint("当前还没有可发送到 Cursor 的 ChatGPT 回复。")
            if hasattr(self, "_add_system_message"):
                self._add_system_message("当前还没有可发送到 Cursor 的 ChatGPT 回复。")
            return
        ok, result = server.send_job_to_cursor(job_id)
        if ok:
            self._set_job_hint(f"已发送到 Cursor 队列：{result}")
            self._append_log(
                f"[JOB][SEND_TO_CURSOR] job_id={job_id} task_id={result}",
                echo=True,
            )
        else:
            self._set_job_hint(f"发送 Cursor 失败：{result}")
            self._append_log(
                f"[JOB][SEND_TO_CURSOR_FAILED] job_id={job_id} error={result}",
                echo=True,
            )
        self._refresh_job_scheduler_panel()

    def _on_job_auto_flow(self):
        job_id, session = self._job_create_and_prepare(auto_send_to_cursor=True)
        if not job_id:
            return
        self._job_send_chatgpt(job_id, session)
        self._set_job_hint(
            "自动流程已启动：ChatGPT 回复后将自动发送到 Cursor，"
            "状态将显示到「已提交给 Cursor Agent」为止。"
        )
