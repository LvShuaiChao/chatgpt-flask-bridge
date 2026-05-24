"""油猴页面活跃度与可发送性判断（基于 poll / heartbeat，而非单纯 focus / visibility）。"""

from __future__ import annotations

import time
from typing import Any, Dict, Tuple

from app.constants import (
    REPLY_WAKE_MAX_COUNT,
    REPLY_WAKE_MIN_INTERVAL_SECONDS,
    REPLY_WAKE_STALE_POLL_SECONDS,
    REPLY_WAKE_WAIT_SECONDS,
    TM_HEARTBEAT_ONLINE_SECONDS,
    TM_POLL_FRESH_SECONDS,
)
from app.utils.time_utils import float_ts as _float_ts

__all__ = [
    "classify_tm_client_activity",
    "compute_tm_activity_metrics",
    "describe_reply_wait_page_hint",
    "reply_wait_page_metrics",
    "should_wake_page_for_reply_wait",
    "tm_send_allowed",
]


def compute_tm_activity_metrics(
    item: Dict[str, Any], now: float | None = None
) -> Tuple[float, float, float, float]:
    """返回 (now, seen_age, poll_age, last_poll_ts)。"""
    if now is None:
        now = time.time()
    last_seen = _float_ts(
        item.get("last_seen"),
        context="tm_activity.last_seen",
        log_on_error=True,
    )
    last_poll_at = _float_ts(
        item.get("last_poll_at"),
        context="tm_activity.last_poll_at",
        log_on_error=True,
    )
    if not last_poll_at:
        last_poll_at = last_seen
    seen_age = now - last_seen if last_seen else 999999.0
    poll_age = now - last_poll_at if last_poll_at else 999999.0
    return now, seen_age, poll_age, last_poll_at


def classify_tm_client_activity(
    item: Dict[str, Any], now: float | None = None
) -> str:
    if not isinstance(item, dict):
        return "offline"
    now_v, seen_age, poll_age, _ = compute_tm_activity_metrics(item, now=now)
    _ = now_v

    visible = (item.get("visibility_state") or "").strip()
    has_focus = bool(item.get("has_focus"))

    if seen_age > TM_HEARTBEAT_ONLINE_SECONDS:
        return "offline"

    if has_focus:
        return "active_focused"

    if visible == "visible":
        return "active_visible"

    if visible == "hidden" and poll_age <= TM_POLL_FRESH_SECONDS:
        return "active_hidden"

    if visible == "hidden":
        return "stale_hidden"

    return "online_unknown"


def tm_send_allowed(
    item: Dict[str, Any], now: float | None = None
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    页面活跃度摘要（用于 UI 展示与候选排序）。
    发送/同步硬拦截请使用 app.utils.page_status.evaluate_send_page / is_page_online。
    仅 offline（心跳超时）时返回 allowed=False；poll_stale / stale_hidden 不拦截。
    """
    if not isinstance(item, dict):
        return False, "not_a_dict", {}

    now_v, seen_age, poll_age, _ = compute_tm_activity_metrics(item, now=now)
    state = classify_tm_client_activity(item, now=now_v)

    detail = {
        "activity_state": state,
        "seen_age": round(seen_age, 3),
        "poll_age": round(poll_age, 3),
    }

    if seen_age > TM_HEARTBEAT_ONLINE_SECONDS:
        return False, "offline", detail

    return True, state, detail


def reply_wait_page_metrics(
    item: Dict[str, Any], now: float | None = None
) -> Dict[str, Any]:
    """等待回复 UI / 唤醒判断用的页面指标。"""
    if not isinstance(item, dict):
        return {
            "poll_age": 999999.0,
            "heartbeat_age": 999999.0,
            "visibility_state": "",
            "has_focus": False,
            "activity_state": "offline",
        }
    now_v, seen_age, poll_age, _ = compute_tm_activity_metrics(item, now=now)
    _ = now_v
    heartbeat_ts = _float_ts(
        item.get("last_heartbeat_at"),
        context="reply_wait.last_heartbeat_at",
        log_on_error=False,
    )
    if not heartbeat_ts:
        heartbeat_ts = _float_ts(
            item.get("last_seen"),
            context="reply_wait.last_seen",
            log_on_error=False,
        )
    heartbeat_age = now_v - heartbeat_ts if heartbeat_ts else 999999.0
    return {
        "poll_age": poll_age,
        "heartbeat_age": heartbeat_age,
        "seen_age": seen_age,
        "visibility_state": (item.get("visibility_state") or "").strip(),
        "has_focus": bool(item.get("has_focus")),
        "activity_state": classify_tm_client_activity(item, now=now_v),
    }


def should_wake_page_for_reply_wait(
    item: Dict[str, Any],
    *,
    wait_seconds: float,
    wake_count: int,
    last_wake_at: float,
    now: float | None = None,
) -> tuple[bool, str]:
    """
    是否应在等待回复期间自动唤醒绑定页。
    返回 (should_wake, block_reason)。
    """
    if wake_count >= REPLY_WAKE_MAX_COUNT:
        return False, "max_wake_count"
    if now is None:
        now = time.time()
    if last_wake_at > 0 and (now - last_wake_at) < REPLY_WAKE_MIN_INTERVAL_SECONDS:
        return False, "wake_cooldown"
    if wait_seconds < REPLY_WAKE_WAIT_SECONDS:
        return False, "wait_too_short"

    metrics = reply_wait_page_metrics(item, now=now)
    if metrics["activity_state"] == "offline":
        return False, "page_offline"

    poll_age = float(metrics["poll_age"])
    heartbeat_age = float(metrics["heartbeat_age"])
    visibility = metrics["visibility_state"]
    has_focus = bool(metrics["has_focus"])

    stale_poll = poll_age > REPLY_WAKE_STALE_POLL_SECONDS
    stale_heartbeat = heartbeat_age > REPLY_WAKE_STALE_POLL_SECONDS
    hidden = visibility == "hidden"
    unfocused = not has_focus

    if stale_poll or stale_heartbeat or hidden or unfocused:
        return True, ""
    return False, "page_active"


def describe_reply_wait_page_hint(
    item: Dict[str, Any] | None,
    *,
    wake_count: int = 0,
    max_wake_count: int = REPLY_WAKE_MAX_COUNT,
    waking: bool = False,
    now: float | None = None,
) -> str:
    """等待回复状态栏附带的页面活跃度说明。"""
    if wake_count >= max_wake_count:
        return "页面疑似冻结，请手动激活 ChatGPT 页面"

    if not isinstance(item, dict):
        return "页面未绑定或离线"

    metrics = reply_wait_page_metrics(item, now=now)
    activity = metrics["activity_state"]
    poll_age = float(metrics["poll_age"])
    has_focus = bool(metrics["has_focus"])
    visibility = metrics["visibility_state"]

    if waking:
        return "页面后台节流，正在自动唤醒"

    if has_focus and poll_age <= REPLY_WAKE_STALE_POLL_SECONDS:
        return "页面活跃"

    if activity in ("active_focused", "active_visible"):
        return "页面活跃"

    if activity == "active_hidden" and poll_age <= REPLY_WAKE_STALE_POLL_SECONDS:
        return "页面后台可用"

    if wake_count > 0:
        return f"页面后台，已自动唤醒 {wake_count} 次"

    if visibility == "hidden" or not has_focus or poll_age > REPLY_WAKE_STALE_POLL_SECONDS:
        return "页面后台节流"

    return "页面在线"
