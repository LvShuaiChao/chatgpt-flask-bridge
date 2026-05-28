"""发送目标来源枚举（强绑定：仅绑定页 / 无会话）。"""

from __future__ import annotations

from typing import Any, Tuple

TARGET_SOURCE_BOUND_PAGE = "bound_page"
TARGET_SOURCE_NO_SESSION = "no_session"
TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID = "temp_home_page_display_id"
TARGET_SOURCE_SAME_CONVERSATION_REBOUND_AFTER_LOST = "same_conversation_rebound_after_lost"

TARGET_SOURCES: Tuple[str, ...] = (
    TARGET_SOURCE_BOUND_PAGE,
    TARGET_SOURCE_NO_SESSION,
    TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID,
  TARGET_SOURCE_SAME_CONVERSATION_REBOUND_AFTER_LOST,
)


def target_source_from(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    val = (data.get("target_source") or "").strip()
    return val if val in TARGET_SOURCES else ""


def canonical_target_source(value: Any) -> str:
    raw = str(value or "").strip()
    return raw if raw in TARGET_SOURCES else ""


def target_source_label(value: Any) -> str:
    resolved = canonical_target_source(value) or str(value or "").strip()
    if resolved == TARGET_SOURCE_BOUND_PAGE:
        return "已绑定页"
    if resolved == TARGET_SOURCE_NO_SESSION:
        return "无会话目标"
    if resolved == TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID:
        return "临时首页"
    if resolved:
        return resolved
    return "未知来源"


__all__ = [
    "TARGET_SOURCES",
    "TARGET_SOURCE_BOUND_PAGE",
    "TARGET_SOURCE_NO_SESSION",
    "TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID",
  "TARGET_SOURCE_SAME_CONVERSATION_REBOUND_AFTER_LOST",
    "target_source_from",
    "canonical_target_source",
    "target_source_label",
]
