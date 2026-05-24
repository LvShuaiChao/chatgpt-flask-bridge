"""升级发继续等桌面自动化。"""
import subprocess
import time
import traceback
from typing import Callable, Optional, Tuple

import pyautogui

from app.cursor_code.capture import capture_mode_label, screenshot_capture
from app.cursor_code.config import CursorCodeConfig
from app.cursor_code.matcher import find_template_on_screen
from app.cursor_code.templates import INPUT_BOX_FILENAME, UPGRADE_PRO_FILENAME


def set_clipboard(text: str) -> None:
    try:
        import pyperclip

        pyperclip.copy(text)
    except ImportError:
        escaped = text.replace("'", "''")
        subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"Set-Clipboard -Value '{escaped}'",
            ],
            check=True,
        )


def send_text_to_inputbox(
    text: str,
    x: int,
    y: int,
    cfg: CursorCodeConfig,
    log: Callable[[str], None] = print,
) -> None:
    t0 = time.perf_counter()
    pyautogui.click(x, y)
    time.sleep(cfg.delay_before_type)
    set_clipboard(text)
    pyautogui.hotkey("ctrl", "v")
    time.sleep(0.1)
    pyautogui.press("enter")
    log(
        f"[CURSOR_CODE] 已在输入框 ({x}, {y}) 发送: {text}，"
        f"耗时 {(time.perf_counter() - t0) * 1000:.1f} ms"
    )


def run_upgrade_continue_flow(
    cfg: CursorCodeConfig,
    log: Callable[[str], None] = print,
    *,
    captured: Optional[tuple] = None,
) -> Tuple[Optional[dict], Optional[dict]]:
    """
    检测 upgrade → 找输入框 → 点击并发送继续。
    返回 (upgrade_match, input_match)。
    """
    try:
        if captured is None:
            screen, origin_x, origin_y, cap_w, cap_h, screenshot_ms = (
                screenshot_capture(cfg)
            )
            log(
                f"[CURSOR_CODE] 截图 {screenshot_ms:.1f} ms | "
                f"{capture_mode_label(cfg)}"
            )
        else:
            screen, origin_x, origin_y, cap_w, cap_h, screenshot_ms = captured

        upgrade_match = find_template_on_screen(
            cfg,
            UPGRADE_PRO_FILENAME,
            screen,
            origin_x,
            origin_y,
            cap_w,
            cap_h,
            log,
            tag="升级",
        )
        if upgrade_match is None:
            log("[CURSOR_CODE][CONTINUE_SEND_FAILED] 未检测到 Upgrade to Pro")
            return None, None

        log("[CURSOR_CODE][UPGRADE_DETECTED] 已检测到 Upgrade to Pro")

        input_match = find_template_on_screen(
            cfg,
            INPUT_BOX_FILENAME,
            screen,
            origin_x,
            origin_y,
            cap_w,
            cap_h,
            log,
            tag="输入框",
        )
        if input_match is None:
            log(
                "[CURSOR_CODE][CONTINUE_SEND_FAILED] "
                "未找到编辑框输入位置，不执行点击"
            )
            return upgrade_match, None

        log("[CURSOR_CODE][INPUT_FOUND] 已找到输入框模板")
        cx, cy = input_match["center"]
        text = cfg.upgrade_continue_text
        log(f"[CURSOR_CODE][CONTINUE_SEND_START] 发送「{text}」@ ({cx}, {cy})")
        send_text_to_inputbox(text, cx, cy, cfg, log)
        log("[CURSOR_CODE][CONTINUE_SEND_DONE]")
        return upgrade_match, input_match
    except Exception as e:
        log(
            f"[CURSOR_CODE][CONTINUE_SEND_FAILED] "
            f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        )
        return None, None
