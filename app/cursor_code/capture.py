"""屏幕 / 窗口截图。"""
import ctypes
import ctypes.wintypes
import sys
import time
from typing import List, Optional, Tuple

import cv2
import mss
import numpy as np

from app.cursor_code.config import CursorCodeConfig


def enable_dpi_awareness() -> None:
    if sys.platform != "win32":
        return
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        print("[DPI] SetProcessDpiAwareness(2) ok")
    except Exception as e1:
        print(f"[DPI] SetProcessDpiAwareness failed: {type(e1).__name__}: {e1}")
        try:
            ctypes.windll.user32.SetProcessDPIAware()
            print("[DPI] SetProcessDPIAware ok")
        except Exception as e2:
            print(f"[DPI] SetProcessDPIAware failed: {type(e2).__name__}: {e2}")


def get_virtual_screen():
    with mss.mss() as sct:
        return sct.monitors[0]


def get_all_screens_rect() -> dict:
    mon = get_virtual_screen()
    return {
        "left": int(mon["left"]),
        "top": int(mon["top"]),
        "width": int(mon["width"]),
        "height": int(mon["height"]),
    }


def list_monitors():
    with mss.mss() as sct:
        items = []
        for i in range(1, len(sct.monitors)):
            mon = sct.monitors[i]
            tag = "主屏" if i == 1 else "扩展屏"
            label = (
                f"显示器 {i}（{tag}） "
                f"{mon['width']}×{mon['height']} "
                f"@ ({mon['left']}, {mon['top']})"
            )
            items.append(
                {
                    "index": i,
                    "left": mon["left"],
                    "top": mon["top"],
                    "width": mon["width"],
                    "height": mon["height"],
                    "label": label,
                    "is_primary": i == 1,
                }
            )
        return items


def get_monitor(index: int):
    monitors = list_monitors()
    by_index = {m["index"]: m for m in monitors}
    if index in by_index:
        return by_index[index]
    if monitors:
        return monitors[0]
    with mss.mss() as sct:
        mon = sct.monitors[1]
    return {
        "index": 1,
        "left": mon["left"],
        "top": mon["top"],
        "width": mon["width"],
        "height": mon["height"],
        "label": "显示器 1（主屏）",
        "is_primary": True,
    }


def _win32_user32():
    if sys.platform != "win32":
        return None
    return ctypes.windll.user32


def list_visible_windows() -> List[Tuple[int, str]]:
    user32 = _win32_user32()
    if user32 is None:
        return []
    results: List[Tuple[int, str]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def _enum_cb(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd) + 1
        buf = ctypes.create_unicode_buffer(length)
        user32.GetWindowTextW(hwnd, buf, length)
        title = buf.value.strip()
        if not title:
            return True
        if user32.IsIconic(hwnd):
            return True
        rect = ctypes.wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return True
        w = rect.right - rect.left
        h = rect.bottom - rect.top
        if w < 8 or h < 8:
            return True
        results.append((int(hwnd), title))
        return True

    user32.EnumWindows(_enum_cb, 0)
    results.sort(key=lambda x: x[1].lower())
    return results


def resolve_target_window_hwnd(cfg: CursorCodeConfig) -> int:
    user32 = _win32_user32()
    if user32 is None:
        return 0
    hwnd = int(getattr(cfg, "target_window_hwnd", 0) or 0)
    if hwnd and user32.IsWindow(hwnd):
        return hwnd
    title = (getattr(cfg, "target_window_title", "") or "").strip()
    if not title:
        return 0
    for h, t in list_visible_windows():
        if t == title:
            return h
    return 0


def get_window_client_rect_screen(hwnd: int):
    user32 = _win32_user32()
    if user32 is None or not hwnd or not user32.IsWindow(hwnd):
        return None
    if user32.IsIconic(hwnd):
        return None
    client = ctypes.wintypes.RECT()
    if not user32.GetClientRect(hwnd, ctypes.byref(client)):
        return None
    w = client.right - client.left
    h = client.bottom - client.top
    if w < 1 or h < 1:
        return None
    origin = ctypes.wintypes.POINT(0, 0)
    if not user32.ClientToScreen(hwnd, ctypes.byref(origin)):
        return None
    return origin.x, origin.y, w, h


class MssWindowCapture:
    """按窗口客户区屏幕坐标用 mss 截图（BGR）。"""

    def __init__(self):
        self.hwnd = 0
        self._sct: Optional[mss.mss] = None

    def init(self, hwnd: int) -> None:
        if sys.platform != "win32":
            raise RuntimeError("窗口截图仅支持 Windows")
        import win32gui

        self.release()
        self.hwnd = int(hwnd)
        if not self.hwnd or not win32gui.IsWindow(self.hwnd):
            raise RuntimeError("无效窗口句柄")
        if win32gui.IsIconic(self.hwnd):
            raise RuntimeError("目标窗口已最小化")
        if get_window_client_rect_screen(self.hwnd) is None:
            raise RuntimeError("无法获取窗口客户区屏幕坐标")
        self._sct = mss.mss()

    def capture(self) -> np.ndarray:
        if not self._sct:
            raise RuntimeError("MssWindowCapture 未初始化")
        rect = get_window_client_rect_screen(self.hwnd)
        if rect is None:
            raise RuntimeError("目标窗口不可用")
        left, top, w, h = rect
        monitor = {"left": left, "top": top, "width": w, "height": h}
        shot = self._sct.grab(monitor)
        img = np.array(shot, dtype=np.uint8)
        img = img[:, :, :3]
        return np.ascontiguousarray(img)

    def release(self) -> None:
        if self._sct is not None:
            try:
                self._sct.close()
            except Exception as e:
                print(
                    f"[MssWindowCapture] release failed "
                    f"{type(e).__name__}: {e}"
                )
        self._sct = None
        self.hwnd = 0


def _ensure_mss_window_capture(
    hwnd: int, cap: Optional[MssWindowCapture]
) -> MssWindowCapture:
    if cap is None:
        cap = MssWindowCapture()
        cap.init(hwnd)
        return cap
    if cap.hwnd != hwnd:
        cap.release()
        cap.init(hwnd)
    return cap


def _capture_window_client_mss(hwnd: int) -> np.ndarray:
    rect = get_window_client_rect_screen(hwnd)
    if rect is None:
        raise RuntimeError("目标窗口不可用")
    left, top, w, h = rect
    monitor = {"left": left, "top": top, "width": w, "height": h}
    with mss.mss() as sct:
        shot = sct.grab(monitor)
        img = np.array(shot, dtype=np.uint8)
        img = img[:, :, :3]
        return np.ascontiguousarray(img)


def screenshot_capture(
    cfg: CursorCodeConfig,
    win32_cap: Optional[MssWindowCapture] = None,
):
    """返回 (bgr_image, origin_x, origin_y, width, height, screenshot_ms)。"""
    t0 = time.perf_counter()
    if getattr(cfg, "use_all_screens", False):
        monitor = get_all_screens_rect()
        origin_x, origin_y = monitor["left"], monitor["top"]
        with mss.mss() as sct:
            img = np.array(sct.grab(monitor))
            img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
        screenshot_ms = (time.perf_counter() - t0) * 1000
        h, w = img.shape[:2]
        return img, origin_x, origin_y, w, h, screenshot_ms

    if getattr(cfg, "use_window_capture", False):
        if sys.platform != "win32":
            raise RuntimeError("绑定窗口截图需要 Windows 与 pywin32")
        hwnd = resolve_target_window_hwnd(cfg)
        if not hwnd:
            raise RuntimeError("未选择有效目标窗口")
        rect = get_window_client_rect_screen(hwnd)
        if rect is None:
            raise RuntimeError("目标窗口不可用")
        origin_x, origin_y, w, h = rect
        if win32_cap is None:
            img = _capture_window_client_mss(hwnd)
        else:
            cap = _ensure_mss_window_capture(hwnd, win32_cap)
            img = cap.capture()
        screenshot_ms = (time.perf_counter() - t0) * 1000
        return img, origin_x, origin_y, w, h, screenshot_ms

    mon = get_monitor(cfg.monitor_index)
    monitor = {
        "left": mon["left"],
        "top": mon["top"],
        "width": mon["width"],
        "height": mon["height"],
    }
    origin_x, origin_y = mon["left"], mon["top"]
    with mss.mss() as sct:
        img = np.array(sct.grab(monitor))
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    screenshot_ms = (time.perf_counter() - t0) * 1000
    h, w = img.shape[:2]
    return img, origin_x, origin_y, w, h, screenshot_ms


def capture_mode_label(cfg: CursorCodeConfig) -> str:
    if getattr(cfg, "use_all_screens", False):
        rect = get_all_screens_rect()
        n = len(list_monitors())
        return (
            f"全桌面·{n}屏 "
            f"{rect['width']}×{rect['height']} @ ({rect['left']},{rect['top']})"
        )
    if getattr(cfg, "use_window_capture", False):
        title = (getattr(cfg, "target_window_title", "") or "").strip()
        if len(title) > 36:
            title = title[:33] + "..."
        return f"窗口·mss「{title or '?'}」"
    mon = get_monitor(cfg.monitor_index)
    return f"全图·显示器 {mon['index']}"
