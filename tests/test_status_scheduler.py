"""StatusScheduler debounce 与 fingerprint 门控刷新。"""

from unittest.mock import MagicMock

import pytest

from app.ui.status_scheduler import StatusScheduler


class _FakeTimeout:
    def __init__(self):
        self._callbacks = []

    def connect(self, callback):
        self._callbacks.append(callback)

    def emit(self):
        for callback in list(self._callbacks):
            callback()


class _FakeTimer:
    def __init__(self, parent):
        del parent
        self._active = False
        self._interval = 0
        self.timeout = _FakeTimeout()

    def setSingleShot(self, value):
        assert value is True

    def isActive(self):
        return self._active

    def start(self, interval_ms):
        self._active = True
        self._interval = interval_ms

    def stop(self):
        self._active = False


@pytest.fixture(autouse=True)
def patch_qtimer(monkeypatch):
    monkeypatch.setattr("app.ui.status_scheduler.QTimer", _FakeTimer)


def test_submit_debounces_flush():
    flushed = []

    scheduler = StatusScheduler(None, flushed.append, interval_ms=150)
    scheduler.submit({"a": 1})
    scheduler.submit({"a": 2})
    assert flushed == []
    assert scheduler._latest_status == {"a": 2}
    scheduler._timer.timeout.emit()
    assert flushed == [{"a": 2}]


def test_flush_now_immediate():
    flushed = []
    scheduler = StatusScheduler(None, flushed.append, interval_ms=150)
    scheduler.submit({"x": 1})
    scheduler.flush_now({"y": 2})
    assert flushed == [{"y": 2}]
    assert scheduler._timer.isActive() is False
