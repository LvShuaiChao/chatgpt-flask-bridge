"""桥接状态 UI 刷新调度：合并 signal / timer / throttle 为单层 debounce。"""

from __future__ import annotations

from typing import Any, Callable

from PyQt5.QtCore import QTimer

StatusFlushCallback = Callable[[Any], None]


class StatusScheduler:
    """缓存最新 status，interval_ms 后统一 flush 一次。"""

    def __init__(
        self,
        parent,
        flush_callback: StatusFlushCallback,
        *,
        interval_ms: int = 150,
    ):
        self._latest_status: Any = None
        self._interval_ms = max(50, int(interval_ms))
        self._flush_callback = flush_callback
        self._timer = QTimer(parent)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._on_timeout)

    def submit(self, status) -> None:
        if status is not None:
            self._latest_status = status
        if self._latest_status is None:
            return
        if not self._timer.isActive():
            self._timer.start(self._interval_ms)

    def flush_now(self, status=None) -> None:
        if status is not None:
            self._latest_status = status
        self._timer.stop()
        self._on_timeout()

    def _on_timeout(self) -> None:
        status = self._latest_status
        if status is None:
            return
        self._flush_callback(status)
