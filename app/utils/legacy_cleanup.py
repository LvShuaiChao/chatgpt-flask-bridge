"""入站/保存边界：仅允许标准字段（白名单硬切）。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

ALLOWED_TOP_LEVEL_FIELDS = frozenset(
    {
        "message_id",
        "turn_id",
        "role",
        "content",
        "ui_status",
        "message_source",
        "client_id",
        "page_instance_id",
        "page_display_id",
        "conversation_id",
        "url",
        "bind_state",
        "target_source",
        "payload",
        "action",
        "created_at",
        "updated_at",
        "source",
        "status",
        "request_id",
        "session_id",
        "tool",
        "data",
    }
)

_LEGACY_TARGET_SOURCE_VALUES = frozenset(
    {
        "bound",
        "auto_rebind_by_conv",
        "conversation_id_fallback",
        "conversation_only_fallback",
        "bootstrap_resolve",
    }
)

_REPLACEMENT_HINT = "canonical schema fields only"

REMOTE_CHATGPT_COMPAT_FIELDS = frozenset(
    {
        "bind_state",
        "client_id",
        "page_instance_id",
        "conversation_id",
        "url",
        "page_display_id",
        # 当前仍有运行路径依赖，暂时不能 hard-block
        "page_no",
        "temp_page_id",
        "page_type",
        "page_title",
        "last_seen",
        "last_poll_at",
        "bind_mode",
        "bind_request_id",
        "bind_started_at",
        "pending_bootstrap_content",
        "pending_send_content",
        "pending_send_message_id",
        "reopen_started_at",
    }
)

REMOTE_CHATGPT_REMOVED_FIELDS = frozenset(
    {
        "binding",
        "enabled",
        "canonical_url",
        "last_reported_url",
        "prebound_home_client_id",
        "prebound_home_page_instance_id",
        "reserved_client_id",
        "reserved_page_instance_id",
        "reserved_at",
        "created_from_home",
        "opened_home_at",
        "bound_at",
        "reopen_request_id",
        "reopen_target_url",
        "pending_bootstrap_created_at",
        "pending_send_created_at",
        "bootstrap_message_id",
        "bootstrap_started_at",
        "bootstrap_in_progress",
    }
)


def _collect_invalid_fields(obj: Any, *, path: str = "") -> List[str]:
    found: List[str] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            sub = f"{path}.{key}" if path else key
            if not path and key not in ALLOWED_TOP_LEVEL_FIELDS:
                found.append(sub)
            elif key == "target_source" and value in _LEGACY_TARGET_SOURCE_VALUES:
                found.append(f"{sub}={value!r}")
            elif isinstance(value, (dict, list)):
                found.extend(_collect_invalid_fields(value, path=sub))
    elif isinstance(obj, list):
        for index, item in enumerate(obj):
            sub = f"{path}[{index}]" if path else f"[{index}]"
            if isinstance(item, (dict, list)):
                found.extend(_collect_invalid_fields(item, path=sub))
    return found


def assert_no_legacy_fields(obj: Any, *, owner: str = "-") -> None:
    found = _collect_invalid_fields(obj)
    if not found:
        return
    print(
        "[FIELD][LEGACY_BLOCKED]\n"
        f"owner={owner}\n"
        f"fields={found}\n"
        f"replacement={_REPLACEMENT_HINT}"
    )
    raise ValueError(
        f"invalid fields still exist before save: owner={owner}, fields={found}"
    )


def assert_no_remote_chatgpt_invalid_fields(obj: Any, *, owner: str = "-") -> None:
    if not isinstance(obj, dict):
        return

    invalid = []
    removed = []

    for key in obj.keys():
        if key in REMOTE_CHATGPT_REMOVED_FIELDS:
            removed.append(key)
        elif key not in REMOTE_CHATGPT_COMPAT_FIELDS:
            invalid.append(key)

    if not invalid and not removed:
        return

    print(
        "[REMOTE_FIELD][INVALID_BLOCKED]\n"
        f"owner={owner}\n"
        f"invalid={invalid}\n"
        f"removed={removed}\n"
        "replacement=canonical remote_chatgpt fields / BindSessionRuntime"
    )

    raise ValueError(
        f"invalid remote_chatgpt fields: owner={owner}, invalid={invalid}, removed={removed}"
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
    invalid = sorted(set(payload.keys()) - ALLOWED_TOP_LEVEL_FIELDS)
    if invalid:
        return (
            {
                "ok": False,
                "error": "unknown_fields_not_allowed",
                "context": context,
                "unknown_fields": invalid,
            },
            400,
        )
    target_source = payload.get("target_source")
    if target_source in _LEGACY_TARGET_SOURCE_VALUES:
        return (
            {
                "ok": False,
                "error": "unknown_fields_not_allowed",
                "context": context,
                "unknown_fields": [f"target_source={target_source}"],
            },
            400,
        )
    return None


__all__ = [
    "ALLOWED_TOP_LEVEL_FIELDS",
    "assert_no_legacy_fields",
    "assert_no_remote_chatgpt_invalid_fields",
    "reject_legacy_fields",
]
