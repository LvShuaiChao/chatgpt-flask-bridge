"""Cursor 升级监控线程。"""
import time
import traceback
from typing import Callable, Optional

from PyQt5.QtCore import QThread, pyqtSignal

from app.cursor_code.automation import run_upgrade_continue_flow
from app.cursor_code.capture import MssWindowCapture, screenshot_capture
from app.cursor_code.config import CursorCodeConfig
from app.cursor_code.matcher import find_icon_position, find_template_on_screen
from app.cursor_code.runtime import (
    get_cursor_code_pause_reason,
    pause_all_for_cursor_upgrade,
    resume_after_cursor_upgrade,
)
from app.cursor_code.templates import UPGRADE_PRO_FILENAME


class CursorFindOnceWorker(QThread):
    find_result = pyqtSignal(object, str)

    def __init__(self, cfg: CursorCodeConfig):
        super().__init__()
        self.cfg = cfg
        self._lines = []

    def _log(self, msg: str):
        self._lines.append(msg)

    def run(self):
        try:
            match = find_icon_position(self.cfg, log=self._log)
            self.find_result.emit(match, "\n".join(self._lines))
        except Exception as error:
            self.find_result.emit(
                None,
                "\n".join(self._lines)
                + f"\n[CURSOR_CODE][ERROR] error_type={type(error).__name__} "
                f"error={error}\n{traceback.format_exc()}",
            )


class CursorUpgradeMonitorWorker(QThread):
    log_message = pyqtSignal(str)
    upgrade_detected = pyqtSignal(object)
    continue_sent = pyqtSignal(object, object)
    continue_failed = pyqtSignal(str)
    paused_changed = pyqtSignal(bool, str)
    finished_watch = pyqtSignal()

    def __init__(self, cfg: CursorCodeConfig):
        super().__init__()
        self.cfg = cfg
        self._stop_requested = False
        self._last_sent_at = 0.0

    def request_stop(self):
        self._stop_requested = True

    def _log(self, msg: str):
        self.log_message.emit(msg)

    def run(self):
        self._stop_requested = False
        self._last_sent_at = 0.0
        win32_cap: Optional[MssWindowCapture] = None
        self._log("[CURSOR_CODE][UPGRADE_WATCH_START]")
        try:
            if self.cfg.use_window_capture:
                win32_cap = MssWindowCapture()
            while not self._stop_requested:
                token = ""
                try:
                    screen, ox, oy, cw, ch, ms = screenshot_capture(
                        self.cfg, win32_cap=win32_cap
                    )
                    upgrade_probe = find_template_on_screen(
                        self.cfg,
                        UPGRADE_PRO_FILENAME,
                        screen,
                        ox,
                        oy,
                        cw,
                        ch,
                        self._log,
                        tag="监控",
                        log_on_miss=False,
                    )
                    if upgrade_probe is None:
                        self.msleep(max(200, int(self.cfg.upgrade_watch_interval_ms)))
                        continue

                    now = time.time()
                    if (
                        self._last_sent_at
                        and now - self._last_sent_at
                        < float(self.cfg.upgrade_watch_cooldown_sec)
                    ):
                        self.msleep(max(200, int(self.cfg.upgrade_watch_interval_ms)))
                        continue

                    self.upgrade_detected.emit(upgrade_probe)
                    self._log("[CURSOR_CODE][UPGRADE_DETECTED]")
                    token = pause_all_for_cursor_upgrade("cursor_upgrade_required")
                    reason = get_cursor_code_pause_reason()
                    self.paused_changed.emit(True, reason)
                    upgrade_match, input_match = run_upgrade_continue_flow(
                        self.cfg,
                        self._log,
                        captured=(screen, ox, oy, cw, ch, ms),
                    )
                    if input_match is not None:
                        self._last_sent_at = time.time()
                        self.continue_sent.emit(upgrade_match, input_match)
                    else:
                        self.continue_failed.emit("input_not_found_or_send_failed")
                except Exception as error:
                    self._log(
                        "[CURSOR_CODE][ERROR] "
                        f"error_type={type(error).__name__} error={error}\n"
                        f"{traceback.format_exc()}"
                    )
                finally:
                    if token:
                        resume_after_cursor_upgrade(token)
                        self.paused_changed.emit(False, get_cursor_code_pause_reason())
                if self._stop_requested:
                    break
                self.msleep(max(200, int(self.cfg.upgrade_watch_interval_ms)))
        finally:
            if win32_cap is not None:
                win32_cap.release()
            self._log("[CURSOR_CODE][UPGRADE_WATCH_STOP]")
            self.finished_watch.emit()
