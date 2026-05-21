import time
import traceback

from log_utils import get_log_file_path, read_last_lines

from PyQt5.QtCore import QThread, QTimer, pyqtSignal
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
            detail = (
                "[LOG_TAB][WORKER_FAILED] "
                "function=LogLoadWorker.run "
                f"path={self.log_path} "
                f"max_lines={self.max_lines} "
                f"error_type={type(exc).__name__} "
                f"error={exc}\n{traceback.format_exc()}"
            )
            print(detail)
            self.failed.emit(detail)


class LogTabMixin:
    LOG_TAB_MAX_DISPLAY_LINES = 3000
    LOG_TAB_MAX_BLOCK_COUNT = 8000

    def _init_log_tab_state(self):
        self._log_tab_loaded = False
        self._runtime_log_loaded_once = False
        self._log_loading = False
        self._loaded_log_lines = []
        self._log_worker = None
        self._pending_log_subtabs_refresh = False
        self._log_tab_load_pending = False
        self._pending_log_lines = []
        self._log_flush_scheduled = False

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
        if hasattr(self, "_flush_pending_chat_render") and (
            "聊天" in tab_text or "鑱婂ぉ" in tab_text
        ):
            QTimer.singleShot(30, self._flush_pending_chat_render)
        if tab_text != "日志":
            return
        if getattr(self, "_pending_log_subtabs_refresh", False):
            self._refresh_log_subtabs_from_cache()
        if not getattr(self, "_log_tab_loaded", False):
            self._load_runtime_log_once()

    def _load_runtime_log_once(self):
        if getattr(self, "_runtime_log_loaded_once", False):
            return
        self._runtime_log_loaded_once = True
        self._reload_runtime_log_view()

    def _load_runtime_log_if_visible(self):
        if not self._is_log_tab_visible():
            return
        self._load_runtime_log_once()

    def _reload_runtime_log_view(self, max_lines=None):
        if max_lines is None:
            max_lines = self.LOG_TAB_MAX_DISPLAY_LINES
        try:
            self._load_log_async(force_full=True, max_lines=max_lines)
        except Exception as exc:
            if hasattr(self, "_append_log"):
                self._append_log(
                    f"[LOG_TAB][LOAD_ERROR] {type(exc).__name__}: {exc}",
                    echo=True,
                )

    def _append_runtime_log_line_to_ui(self, line):
        if hasattr(self, "_should_show_gui_log_line") and not self._should_show_gui_log_line(line):
            return
        log_edit = getattr(self, "log_edit", None)
        if log_edit is None:
            return
        self._pending_log_lines.append(line)
        if getattr(self, "_log_flush_scheduled", False):
            return
        self._log_flush_scheduled = True
        QTimer.singleShot(120, self._flush_log_lines_to_ui)

    def _flush_log_lines_to_ui(self):
        self._log_flush_scheduled = False
        log_edit = getattr(self, "log_edit", None)
        if log_edit is None or not self._pending_log_lines:
            self._pending_log_lines = []
            return
        lines = self._pending_log_lines
        self._pending_log_lines = []
        for line in lines:
            log_edit.appendPlainText(line)
        scrollbar = log_edit.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def _load_log_async(self, force_full=False, max_lines=None):
        if getattr(self, "_session_switching", False):
            return
        if not force_full and not self._is_log_tab_visible():
            return
        if getattr(self, "_log_tab_load_pending", False) or self._log_loading:
            return
        if max_lines is None:
            max_lines = self.LOG_TAB_MAX_DISPLAY_LINES

        log_path = self._get_current_log_path()
        log_edit = getattr(self, "log_edit", None)
        if log_edit is None:
            return

        if not log_path:
            log_edit.setPlainText("未找到日志文件路径。")
            if hasattr(self, "_append_log"):
                self._append_log("[LOG_TAB][LOAD_FAILED] reason=no_log_path", echo=True)
            return

        if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():
            self._append_log(
                f"[LOG_TAB][LOAD_START] path={log_path} "
                f"max_lines={self.LOG_TAB_MAX_DISPLAY_LINES}",
                echo=False,
            )

        self._log_tab_load_pending = True
        self._log_loading = True
        self._log_load_started_at = time.perf_counter()
        if not self._log_tab_loaded:
            log_edit.setPlainText(
                f"正在加载最近 {self.LOG_TAB_MAX_DISPLAY_LINES} 行日志..."
            )

        worker = LogLoadWorker(
            log_path,
            max_lines=max_lines,
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
        text = "\n".join(
            self._loaded_log_lines[-self.LOG_TAB_MAX_DISPLAY_LINES :]
        )
        log_edit = getattr(self, "log_edit", None)
        if log_edit is not None:
            log_edit.setPlainText(text)
            pending = list(getattr(self, "_pending_log_lines", []) or [])
            self._pending_log_lines = []
            for line in pending:
                log_edit.appendPlainText(line)
            scrollbar = log_edit.verticalScrollBar()
            scrollbar.setValue(scrollbar.maximum())

        self._log_tab_loaded = True

        debug_enabled = (
            hasattr(self, "_is_debug_mode_enabled")
            and self._is_debug_mode_enabled()
        )

        if debug_enabled:
            self._append_log(
                f"[LOG_TAB][LOAD_DONE] lines={len(self._loaded_log_lines)} "
                f"cost_ms={cost_ms}",
                echo=False,
            )

        if cost_ms >= 1000:
            self._append_log(
                f"[LOG_TAB][SLOW_LOAD] cost_ms={cost_ms}",
                echo=False,
            )
        self._log_tab_load_pending = False

    def _on_log_load_failed(self, error):
        log_edit = getattr(self, "log_edit", None)
        if log_edit is not None:
            log_edit.setPlainText(f"日志加载失败：{error}")
        if hasattr(self, "_append_log"):
            self._append_log(f"[LOG_TAB][LOAD_FAILED] error={error}", echo=True)
        print(f"[LOG_TAB][LOAD_FAILED] error={error}")
        print(traceback.format_exc())
        self._log_tab_load_pending = False

    def _on_log_load_finished(self):
        self._log_loading = False
        self._log_tab_load_pending = False
        worker = getattr(self, "_log_worker", None)
        if worker is not None:
            worker.deleteLater()
            self._log_worker = None

    def _on_copy_log_clicked(self):
        log_edit = getattr(self, "log_edit", None)
        if log_edit is None:
            self._set_tm_action_hint("未找到运行日志控件。")
            self._append_log("[LOG_TAB][COPY][FAILED] reason=no_log_edit", echo=True)
            return

        text = log_edit.toPlainText()
        if not (text or "").strip():
            self._set_tm_action_hint("当前日志为空。")
            if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():
                self._append_log("[LOG_TAB][COPY][EMPTY]", echo=True)
            return

        QApplication.clipboard().setText(text)
        self._set_tm_action_hint(f"已复制当前日志，共 {len(text)} 个字符。")
        if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():
            self._append_log(f"[LOG_TAB][COPY] chars={len(text)}", echo=True)

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
        widget.setPlaceholderText("运行日志将随应用活动追加显示…")
