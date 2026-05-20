"""油猴页面活跃度与可发送性判断（基于 poll / heartbeat，而非单纯 focus / visibility）。"""

from __future__ import annotations

import time
from typing import Any, Dict, Tuple

from app.constants import (
    TM_HEARTBEAT_ONLINE_SECONDS,
    TM_POLL_FRESH_SECONDS,
)

__all__ = [
    "classify_tm_client_activity",
    "compute_tm_activity_metrics",
    "tm_send_allowed",
]


def _float_ts(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def compute_tm_activity_metrics(
    item: Dict[str, Any], now: float | None = None
) -> Tuple[float, float, float, float]:
    """返回 (now, seen_age, poll_age, last_poll_ts)。"""
    if now is None:
        now = time.time()
    last_seen = _float_ts(item.get("last_seen"))
    last_poll_at = _float_ts(item.get("last_poll_at"))
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

    visible = (item.get("visibility_state") or item.get("visible") or "").strip()
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
    是否允许向该 client 发送桥接消息。
    规则：必须在「在线」时间窗内，且 poll 足够新（与后台 hidden 无关）。
    """
    if not isinstance(item, dict):
        return False, "not_a_dict", {}

    now_v, seen_age, poll_age, _ = compute_tm_activity_metrics(item, now=now)
    state = classify_tm_client_activity(item, now=now_v)

    detail = {
        "activity": state,
        "seen_age": round(seen_age, 3),
        "poll_age": round(poll_age, 3),
    }

    if seen_age > TM_HEARTBEAT_ONLINE_SECONDS:
        return False, "offline", detail

    if poll_age > TM_POLL_FRESH_SECONDS:
        return False, "poll_stale", detail

    if state == "stale_hidden":
        return False, "stale_hidden", detail

    return True, state, detail
