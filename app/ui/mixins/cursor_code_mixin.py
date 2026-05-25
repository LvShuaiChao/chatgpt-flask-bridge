"""Cursor代码 业务逻辑 mixin。"""
import traceback

from app.cursor_code.automation import run_upgrade_continue_flow
from app.cursor_code.capture import list_visible_windows, screenshot_capture
from app.cursor_code.config import CursorCodeConfig, resolve_template_root
from app.cursor_code.preview_utils import cv2_to_qpixmap, match_preview_image
from app.cursor_code.runtime import (
    get_cursor_code_pause_reason,
    is_cursor_code_paused,
)
from app.cursor_code.templates import discover_templates
from app.cursor_code.upgrade_monitor import CursorFindOnceWorker, CursorUpgradeMonitorWorker
from app.utils.qt_table_items import set_table_item


class CursorCodeMixin:
    def _init_cursor_code_state(self):
        self._cursor_upgrade_monitor_worker = None
        self._cursor_find_worker = None
        self._append_cursor_code_log("[CURSOR_CODE][INIT]")
        self._refresh_cursor_template_list()
        self._refresh_cursor_window_list()
        self._update_cursor_code_buttons()

        self.cursor_code_refresh_templates_btn.clicked.connect(
            self._refresh_cursor_template_list
        )
        self.cursor_code_refresh_windows_btn.clicked.connect(
            self._refresh_cursor_window_list
        )
        self.cursor_code_refresh_capture_btn.clicked.connect(self._run_cursor_refresh_capture)
        self.cursor_code_find_once_btn.clicked.connect(self._run_cursor_find_once)
        self.cursor_code_start_watch_btn.clicked.connect(self._start_cursor_upgrade_monitor)
        self.cursor_code_stop_watch_btn.clicked.connect(self._stop_cursor_upgrade_monitor)
        self.cursor_code_run_once_btn.clicked.connect(self._run_cursor_upgrade_continue_once)

    def _read_cursor_code_config_from_ui(self):
        hwnd = int(self.cursor_code_window_combo.currentData() or 0)
        return CursorCodeConfig(
            match_threshold=float(self.cursor_code_threshold.value()),
            use_all_screens=bool(self.cursor_code_use_all_screens.isChecked()),
            use_window_capture=bool(self.cursor_code_use_window_capture.isChecked()),
            target_window_hwnd=hwnd,
            target_window_title=self.cursor_code_window_combo.currentText() if hwnd else "",
            continuous_capture_interval_ms=int(self.cursor_code_capture_interval.value()),
            upgrade_watch_interval_ms=int(self.cursor_code_watch_interval.value()),
            upgrade_continue_text=(self.cursor_code_continue_text.text() or "继续").strip()
            or "继续",
        )

    def _append_cursor_code_log(self, text):
        if hasattr(self, "cursor_code_log_text"):
            self.cursor_code_log_text.append(text)
        if hasattr(self, "_append_log"):
            self._append_log(text, echo=True)

    def _refresh_cursor_template_list(self):
        cfg = self._read_cursor_code_config_from_ui()
        rows = discover_templates(resolve_template_root(cfg))
        self.cursor_code_template_table.setRowCount(len(rows))
        for i, item in enumerate(rows):
            set_table_item(self.cursor_code_template_table, i, 0, item["path"], tooltip=item["path"])
            set_table_item(self.cursor_code_template_table, i, 1, item["state"], tooltip=item["state"])
            set_table_item(self.cursor_code_template_table, i, 2, item["kind"], tooltip=item["kind"])
            set_table_item(self.cursor_code_template_table, i, 3, "-")
        self._append_cursor_code_log(
            f"[CURSOR_CODE][TEMPLATE_LOAD] count={len(rows)}"
        )

    def _refresh_cursor_window_list(self):
        rows = list_visible_windows()
        self.cursor_code_window_combo.clear()
        if not rows:
            self.cursor_code_window_combo.addItem("（无可用窗口）", 0)
            return
        for hwnd, title in rows:
            self.cursor_code_window_combo.addItem(title, int(hwnd))

    def _run_cursor_refresh_capture(self):
        cfg = self._read_cursor_code_config_from_ui()
        try:
            screen, *_ = screenshot_capture(cfg)
            self.cursor_code_preview_label.setPixmap(cv2_to_qpixmap(screen))
        except Exception as error:
            self._append_cursor_code_log(
                "[CURSOR_CODE][ERROR] "
                f"error_type={type(error).__name__} error={error}\n"
                f"{traceback.format_exc()}"
            )

    def _run_cursor_find_once(self):
        if self._cursor_find_worker is not None and self._cursor_find_worker.isRunning():
            return
        self._append_cursor_code_log("[CURSOR_CODE][FIND_START]")
        worker = CursorFindOnceWorker(self._read_cursor_code_config_from_ui())
        worker.find_result.connect(self._on_cursor_find_once_result)
        self._cursor_find_worker = worker
        worker.start()

    def _on_cursor_find_once_result(self, match, log_text):
        if log_text:
            self._append_cursor_code_log(log_text)
        if match is None:
            self._append_cursor_code_log("[CURSOR_CODE][FIND_MISS]")
            return
        self._append_cursor_code_log("[CURSOR_CODE][FIND_OK]")
        view = match_preview_image(match, found=True)
        if view is not None:
            self.cursor_code_preview_label.setPixmap(cv2_to_qpixmap(view))

    def _run_cursor_upgrade_continue_once(self):
        cfg = self._read_cursor_code_config_from_ui()
        upgrade_match, input_match = run_upgrade_continue_flow(cfg, self._append_cursor_code_log)
        if input_match is not None:
            self._on_cursor_continue_sent(upgrade_match, input_match)
        elif upgrade_match is not None:
            self._on_cursor_continue_failed("未找到输入框")
        else:
            self._on_cursor_continue_failed("未检测到 Upgrade")

    def _start_cursor_upgrade_monitor(self):
        if (
            self._cursor_upgrade_monitor_worker is not None
            and self._cursor_upgrade_monitor_worker.isRunning()
        ):
            return
        worker = CursorUpgradeMonitorWorker(self._read_cursor_code_config_from_ui())
        worker.log_message.connect(self._append_cursor_code_log)
        worker.upgrade_detected.connect(self._on_cursor_upgrade_detected)
        worker.continue_sent.connect(self._on_cursor_continue_sent)
        worker.continue_failed.connect(self._on_cursor_continue_failed)
        worker.paused_changed.connect(self._on_cursor_pause_changed)
        worker.finished_watch.connect(self._on_cursor_watch_finished)
        self._cursor_upgrade_monitor_worker = worker
        worker.start()
        self._update_cursor_code_buttons()

    def _stop_cursor_upgrade_monitor(self, wait_ms=3000):
        worker = self._cursor_upgrade_monitor_worker
        if worker is None:
            return
        if worker.isRunning():
            worker.request_stop()
            if not worker.wait(wait_ms):
                self._append_cursor_code_log(
                    f"[CURSOR_CODE][ERROR] monitor stop timeout {wait_ms}ms"
                )
        self._on_cursor_watch_finished()

    def _on_cursor_upgrade_detected(self, match):
        self.cursor_code_last_action_label.setText("最近一次动作结果：检测到 Upgrade")
        view = match_preview_image(match, found=True)
        if view is not None:
            self.cursor_code_preview_label.setPixmap(cv2_to_qpixmap(view))

    def _on_cursor_continue_sent(self, upgrade_match, input_match):
        self.cursor_code_last_action_label.setText("最近一次动作结果：已发送继续")
        view = match_preview_image(input_match or upgrade_match, found=True)
        if view is not None:
            self.cursor_code_preview_label.setPixmap(cv2_to_qpixmap(view))

    def _on_cursor_continue_failed(self, reason):
        self.cursor_code_last_action_label.setText(f"最近一次动作结果：发送失败（{reason}）")

    def _on_cursor_pause_changed(self, paused, reason):
        if paused:
            self.cursor_code_pause_state_label.setText(f"当前暂停状态：已暂停：{reason}")
        else:
            self.cursor_code_pause_state_label.setText("当前暂停状态：未暂停")

    def _on_cursor_watch_finished(self):
        self._cursor_upgrade_monitor_worker = None
        self._on_cursor_pause_changed(
            is_cursor_code_paused(), get_cursor_code_pause_reason()
        )
        self._update_cursor_code_buttons()

    def _update_cursor_code_buttons(self):
        running = (
            self._cursor_upgrade_monitor_worker is not None
            and self._cursor_upgrade_monitor_worker.isRunning()
        )
        self.cursor_code_start_watch_btn.setEnabled(not running)
        self.cursor_code_stop_watch_btn.setEnabled(running)

