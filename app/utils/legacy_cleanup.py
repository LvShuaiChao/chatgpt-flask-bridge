"""入站/保存边界：禁止携带旧字段（不再做 id/status 等入口迁移）。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.utils.legacy_fields import LEGACY_URL_FIELD_NAMES

# 清理边界：URL 旧字段 + 绑定/页面别名 + 少量消息旧字段（不含 LEGACY_MESSAGE 全表，避免误拦 turn_id 等）。
EXTRA_LEGACY_FIELD_NAMES = frozenset(
    {
        "debug_tm_url_syncable",
        "debug_tm_conversation_syncable",
        "target_client_id",
        "target_page_instance_id",
        "target_conversation_id",
        "target_page_key",
        "page_key",
        "pageKey",
        "toolbox_page_key",
        "page_id",
        "window_id",
        "current_page_id",
        "bound_conversation_id",
        "bound_client_id",
        "bound_page_instance_id",
        "chatgpt_conversation_id",
        "pending_send_text",
        "pending_bootstrap_text",
        "raw_user_text",
        "final_prompt",
        "visible",
        "responding",
        "activity",
        "active_tab",
        "selectedQuickCategory",
        "toolbox_state_key",
        "launch_token",
    }
)

LEGACY_FIELD_NAMES = LEGACY_URL_FIELD_NAMES | EXTRA_LEGACY_FIELD_NAMES

_LEGACY_TARGET_SOURCE_VALUES = frozenset(
    {
        "bound",
        "auto_rebind_by_conv",
        "conversation_id_fallback",
        "conversation_only_fallback",
        "bootstrap_resolve",
    }
)

_REPLACEMENT_HINT = (
    "message_id/message_status/client_id/page_instance_id/"
    "conversation_id/url/bind_state"
)


def _collect_legacy_fields(obj: Any, *, path: str = "") -> List[str]:
    found: List[str] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            sub = f"{path}.{key}" if path else key
            if key in LEGACY_FIELD_NAMES:
                found.append(sub)
            elif key == "target_source" and value in _LEGACY_TARGET_SOURCE_VALUES:
                found.append(f"{sub}={value!r}")
            elif isinstance(value, (dict, list)):
                found.extend(_collect_legacy_fields(value, path=sub))
    elif isinstance(obj, list):
        for index, item in enumerate(obj):
            sub = f"{path}[{index}]" if path else f"[{index}]"
            if isinstance(item, (dict, list)):
                found.extend(_collect_legacy_fields(item, path=sub))
    return found


def assert_no_legacy_fields(obj: Any, *, owner: str = "-") -> None:
    found = _collect_legacy_fields(obj)
    if not found:
        return
    print(
        "[FIELD][LEGACY_BLOCKED]\n"
        f"owner={owner}\n"
        f"fields={found}\n"
        f"replacement={_REPLACEMENT_HINT}"
    )
    raise ValueError(
        f"legacy fields still exist before save: owner={owner}, fields={found}"
    )


def reject_legacy_fields(
    payload: Any,
    *,
    context: str = "-",
    migrate: bool = False,
) -> Optional[Tuple[Dict[str, Any], int]]:
    """若 payload 含旧字段，返回 (error_body, 400)；否则 None。"""
    if not isinstance(payload, dict):
        return None
    if migrate:
        raise ValueError(
            "legacy field migration is disabled; use canonical fields only"
        )
    legacy = sorted(set(payload.keys()) & LEGACY_FIELD_NAMES)
    if legacy:
        return (
            {
                "ok": False,
                "error": "legacy_fields_not_allowed",
                "context": context,
                "legacy_fields": legacy,
            },
            400,
        )
    target_source = payload.get("target_source")
    if target_source in _LEGACY_TARGET_SOURCE_VALUES:
        return (
            {
                "ok": False,
                "error": "legacy_fields_not_allowed",
                "context": context,
                "legacy_fields": [f"target_source={target_source}"],
            },
            400,
        )
    return None


__all__ = [
    "LEGACY_FIELD_NAMES",
    "assert_no_legacy_fields",
    "reject_legacy_fields",
]
