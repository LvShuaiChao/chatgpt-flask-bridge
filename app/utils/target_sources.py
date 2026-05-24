"""发送目标来源枚举（强绑定：仅绑定页 / 无会话）。"""

from __future__ import annotations

from typing import Any, Tuple

TARGET_SOURCE_BOUND_PAGE = "bound_page"
TARGET_SOURCE_NO_SESSION = "no_session"

TARGET_SOURCES: Tuple[str, ...] = (
    TARGET_SOURCE_BOUND_PAGE,
    TARGET_SOURCE_NO_SESSION,
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
    if resolved:
        return resolved
    return "未知来源"


__all__ = [
    "TARGET_SOURCES",
    "TARGET_SOURCE_BOUND_PAGE",
    "TARGET_SOURCE_NO_SESSION",
    "target_source_from",
    "canonical_target_source",
    "target_source_label",
]
