"""等待回复自动唤醒与页面活跃度判断。"""
import time

from app.constants import REPLY_WAKE_MAX_COUNT, REPLY_WAKE_WAIT_SECONDS
from app.utils.tm_activity import (
    describe_reply_wait_page_hint,
    should_wake_page_for_reply_wait,
)


def _page(**overrides):
    now = time.time()
    base = {
        "client_id": "tm-abc",
        "last_seen": now,
        "last_poll_at": now,
        "last_heartbeat_at": now,
        "visibility_state": "visible",
        "has_focus": True,
    }
    base.update(overrides)
    return base


def test_should_wake_when_hidden_and_wait_long_enough():
    page = _page(
        visibility_state="hidden",
        has_focus=False,
        last_poll_at=time.time() - 20,
        last_heartbeat_at=time.time() - 20,
    )
    ok, reason = should_wake_page_for_reply_wait(
        page,
        wait_seconds=REPLY_WAKE_WAIT_SECONDS + 1,
        wake_count=0,
        last_wake_at=0,
    )
    assert ok is True
    assert reason == ""


def test_should_not_wake_when_page_active():
    page = _page()
    ok, reason = should_wake_page_for_reply_wait(
        page,
        wait_seconds=REPLY_WAKE_WAIT_SECONDS + 2,
        wake_count=0,
        last_wake_at=0,
    )
    assert ok is False
    assert reason == "page_active"


def test_should_not_wake_after_max_count():
    page = _page(visibility_state="hidden", has_focus=False)
    ok, reason = should_wake_page_for_reply_wait(
        page,
        wait_seconds=REPLY_WAKE_WAIT_SECONDS + 2,
        wake_count=REPLY_WAKE_MAX_COUNT,
        last_wake_at=0,
    )
    assert ok is False
    assert reason == "max_wake_count"


def test_describe_hint_frozen_after_max_wake():
    hint = describe_reply_wait_page_hint(
        _page(),
        wake_count=REPLY_WAKE_MAX_COUNT,
    )
    assert "冻结" in hint


def test_describe_hint_throttled_when_hidden():
    hint = describe_reply_wait_page_hint(
        _page(visibility_state="hidden", has_focus=False),
        wake_count=0,
    )
    assert "节流" in hint or "后台" in hint
