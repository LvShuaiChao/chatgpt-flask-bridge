import time
import traceback
from pathlib import Path

from log_utils import get_log_file_path, read_last_lines

from PyQt5.QtCore import QThread, QTimer, QUrl, pyqtSignal
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QApplication, QPlainTextEdit


class LogLoadWorker(QThread):
    loaded = pyqtSignal(list)
    failed = pyqtSignal(str)

    def __init__(self, log_path, max_lines=1000, parent=None):
        super().__init__(parent)
        self.log_path = log_path
        self.max_lines = max_lines

    def run(self):
        try:
            lines = read_last_lines(self.log_path, self.max_lines)
            self.loaded.emit(lines)
        except Exception as exc:
            self.failed.emit(str(exc))


class LogTabMixin:
    LOG_TAB_MAX_DISPLAY_LINES = 1000
    LOG_TAB_MAX_BLOCK_COUNT = 3000
    LOG_TAB_REFRESH_INTERVAL_SEC = 2
    LOG_TAB_AUTO_REFRESH_INTERVAL_SEC = 5

    def _init_log_tab_state(self):
        self._log_tab_loaded = False
        self._log_loading = False
        self._last_log_refresh_ts = 0.0
        self._loaded_log_lines = []
        self._log_worker = None
        self._pending_log_subtabs_refresh = False

        self._log_filter_timer = QTimer(self)
        self._log_filter_timer.setSingleShot(True)
        self._log_filter_timer.timeout.connect(self._apply_log_filter)

    def _get_current_log_path(self):
        return get_log_file_path()

    def _is_log_tab_visible(self):
        main_tabs = getattr(self, "main_tabs", None)
        log_page = getattr(self, "log_page", None)
        if main_tabs is None or log_page is None:
            return False
        return main_tabs.currentWidget() is log_page

    def _is_runtime_log_subtab_active(self):
        log_tabs = getattr(self, "log_tabs", None)
        if log_tabs is None:
            return False
        current = log_tabs.currentWidget()
        run_log_page = getattr(self, "run_log_page", None)
        if run_log_page is not None:
            return current is run_log_page
        log_edit = getattr(self, "log_edit", None)
        return current is log_edit

    def _on_main_tab_changed(self, index):
        if index < 0:
            return
        tab_text = self.main_tabs.tabText(index)
        if tab_text == "日志":
            self._ensure_log_tab_loaded()
            if getattr(self, "_pending_log_subtabs_refresh", False):
                self._refresh_log_subtabs_from_cache()

    def _ensure_log_tab_loaded(self):
        if self._log_loading:
            return

        now = time.time()
        if self._log_tab_loaded and (now - self._last_log_refresh_ts) < self.LOG_TAB_REFRESH_INTERVAL_SEC:
            return

        self._last_log_refresh_ts = now
        self._load_log_async()

    def _load_log_async(self):
        log_path = self._get_current_log_path()
        log_edit = getattr(self, "log_edit", None)
        if log_edit is None:
            return

        if not log_path:
            log_edit.setPlainText("未找到日志文件路径。")
            self._append_log("[LOG_TAB][LOAD_FAILED] reason=no_log_path", echo=True)
            return

        self._append_log(
            f"[LOG_TAB][LOAD_START] path={log_path} max_lines={self.LOG_TAB_MAX_DISPLAY_LINES}",
            echo=True,
        )

        self._log_loading = True
        self._log_load_started_at = time.perf_counter()
        log_edit.setPlainText(
            f"正在加载最近 {self.LOG_TAB_MAX_DISPLAY_LINES} 行日志..."
        )

        worker = LogLoadWorker(
            log_path,
            max_lines=self.LOG_TAB_MAX_DISPLAY_LINES,
            parent=self,
        )
        self._log_worker = worker
        worker.loaded.connect(self._on_log_loaded)
        worker.failed.connect(self._on_log_load_failed)
        worker.finished.connect(self._on_log_load_finished)
        worker.start()

    def _on_log_loaded(self, lines):
        start = getattr(self, "_log_load_started_at", None)
        cost_ms = 0
        if start is not None:
            cost_ms = int((time.perf_counter() - start) * 1000)

        self._loaded_log_lines = list(lines or [])
        keyword = ""
        filter_edit = getattr(self, "log_filter_edit", None)
        if filter_edit is not None:
            keyword = (filter_edit.text() or "").strip().lower()

        if keyword:
            show_lines = [
                line for line in self._loaded_log_lines if keyword in line.lower()
            ]
        else:
            show_lines = self._loaded_log_lines

        text = "\n".join(show_lines[-self.LOG_TAB_MAX_DISPLAY_LINES :])
        log_edit = getattr(self, "log_edit", None)
        if log_edit is not None:
            log_edit.setPlainText(text)
            scrollbar = log_edit.verticalScrollBar()
            scrollbar.setValue(scrollbar.maximum())

        self._log_tab_loaded = True

        slow = cost_ms > 1000
        msg = (
            f"[LOG_TAB][LOAD_DONE] lines={len(self._loaded_log_lines)} cost_ms={cost_ms}"
        )
        if slow:
            msg += f" [LOG_TAB][SLOW_LOAD] cost_ms={cost_ms}"
        self._append_log(msg, echo=True)

    def _on_log_load_failed(self, error):
        log_edit = getattr(self, "log_edit", None)
        if log_edit is not None:
            log_edit.setPlainText(f"日志加载失败：{error}")
        self._append_log(f"[LOG_TAB][LOAD_FAILED] error={error}", echo=True)
        print(f"[LOG_TAB][LOAD_FAILED] error={error}")
        print(traceback.format_exc())

    def _on_log_load_finished(self):
        self._log_loading = False
        worker = getattr(self, "_log_worker", None)
        if worker is not None:
            worker.deleteLater()
            self._log_worker = None

    def _on_refresh_log_clicked(self):
        self._log_tab_loaded = False
        self._last_log_refresh_ts = 0.0
        self._load_log_async()

    def _on_open_log_dir_clicked(self):
        log_path = self._get_current_log_path()
        if not log_path:
            msg = "打开日志目录失败：未找到日志文件路径。"
            self._append_log("[LOG_TAB][OPEN_DIR][FAILED] reason=no_log_path", echo=True)
            self._set_tm_action_hint(msg)
            return

        log_dir = str(Path(log_path).resolve().parent)
        url = QUrl.fromLocalFile(log_dir)
        if not url.isValid():
            msg = f"打开日志目录失败：路径无效（{log_dir}）"
            self._append_log(
                f"[LOG_TAB][OPEN_DIR][FAILED] reason=invalid_url path={log_dir}",
                echo=True,
            )
            self._set_tm_action_hint(msg)
            return

        if QDesktopServices.openUrl(url):
            self._set_tm_action_hint(f"已打开日志目录：{log_dir}")
            self._append_log(f"[LOG_TAB][OPEN_DIR] path={log_dir}", echo=True)
            return

        msg = f"打开日志目录失败：无法打开（{log_dir}）"
        self._append_log(
            f"[LOG_TAB][OPEN_DIR][FAILED] reason=openUrl_failed path={log_dir}",
            echo=True,
        )
        self._set_tm_action_hint(msg)

    def _on_copy_log_clicked(self):
        log_edit = getattr(self, "log_edit", None)
        if log_edit is None:
            self._set_tm_action_hint("未找到运行日志控件。")
            self._append_log("[LOG_TAB][COPY][FAILED] reason=no_log_edit", echo=True)
            return

        text = log_edit.toPlainText()
        loading_hint = f"正在加载最近 {self.LOG_TAB_MAX_DISPLAY_LINES} 行日志"
        if not (text or "").strip() or (loading_hint in text):
            self._set_tm_action_hint("当前日志为空。")
            self._append_log("[LOG_TAB][COPY][EMPTY]", echo=True)
            return

        QApplication.clipboard().setText(text)
        self._set_tm_action_hint(f"已复制当前日志，共 {len(text)} 个字符。")
        self._append_log(f"[LOG_TAB][COPY] chars={len(text)}", echo=True)

    def _apply_log_filter(self):
        log_edit = getattr(self, "log_edit", None)
        if log_edit is None:
            return

        keyword = ""
        filter_edit = getattr(self, "log_filter_edit", None)
        if filter_edit is not None:
            keyword = (filter_edit.text() or "").strip().lower()

        lines = getattr(self, "_loaded_log_lines", []) or []
        if not keyword:
            show_lines = lines
        else:
            show_lines = [line for line in lines if keyword in line.lower()]

        log_edit.setPlainText("\n".join(show_lines[-self.LOG_TAB_MAX_DISPLAY_LINES :]))
        scrollbar = log_edit.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def _maybe_auto_refresh_log(self):
        if not self._is_log_tab_visible():
            return
        if not self._is_runtime_log_subtab_active():
            return
        if self._log_loading:
            return

        now = time.time()
        if now - self._last_log_refresh_ts < self.LOG_TAB_AUTO_REFRESH_INTERVAL_SEC:
            return

        self._last_log_refresh_ts = now
        self._load_log_async()

    def _refresh_log_subtabs_from_cache(self):
        status = getattr(self, "_last_bridge_status", None) or {}
        if not status:
            self._pending_log_subtabs_refresh = False
            return
        try:
            inbound_items = status.get("recent_inbound") or []
            outbound_items = status.get("recent_outbound") or []
            if hasattr(self, "_render_inbound_log"):
                self._render_inbound_log(inbound_items)
            if hasattr(self, "_render_outbound"):
                self._render_outbound(outbound_items)
            if hasattr(self, "_render_status_summary"):
                self._render_status_summary(status)
        except Exception as error:
            self._append_log(
                f"[LOG_TAB][SUBTAB_REFRESH_FAILED] error={error}\n{traceback.format_exc()}",
                echo=True,
            )
        finally:
            self._pending_log_subtabs_refresh = False

    def _mark_log_subtabs_pending_refresh(self):
        self._pending_log_subtabs_refresh = True

    @staticmethod
    def _configure_runtime_log_edit(widget):
        widget.setObjectName("RuntimeLogText")
        widget.setReadOnly(True)
        widget.setLineWrapMode(QPlainTextEdit.NoWrap)
        widget.setMaximumBlockCount(LogTabMixin.LOG_TAB_MAX_BLOCK_COUNT)
        widget.setPlaceholderText("日志加载中...")
