"""Legacy field guards with per-context allowlists."""

from __future__ import annotations

import inspect
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.utils.legacy_fields import (
    LEGACY_ASSERT_FIELD_NAMES,
    LEGACY_CLEANUP_FIELD_NAMES,
)

LEGACY_FIELD_NAMES = LEGACY_CLEANUP_FIELD_NAMES | frozenset({"title"})

SESSION_MESSAGE_ALLOWED_FIELDS = frozenset(
    {
        "message_id",
        "turn_id",
        "role",
        "content",
        "created_at",
        "ui_status",
        "detail",
        "message_source",
        "bridge_message_id",
        "parent_message_id",
        "visible_in_chat",
    }
)

REMOTE_CHATGPT_ALLOWED_FIELDS = frozenset(
    {
        "bind_state",
        "client_id",
        "page_instance_id",
        "page_display_id",
        "conversation_id",
        "url",
    }
)

REMOTE_CHATGPT_LOAD_MIGRATION_FIELDS = frozenset(
    {
        "bind_mode",
        "temp_page_id",
        "page_no",
        "page_type",
        "page_title",
        "last_seen",
        "last_poll_at",
        "bind_request_id",
        "bind_started_at",
        "bootstrap_in_progress",
        "bootstrap_message_id",
        "bootstrap_started_at",
        "pending_bootstrap_content",
        "pending_bootstrap_created_at",
        "opened_home_at",
        "bound_at",
        "pending_send_content",
        "pending_send_message_id",
        "pending_send_created_at",
        "reopen_request_id",
        "reopen_started_at",
        "reopen_target_url",
    }
)

BRIDGE_REQUEST_ALLOWED_FIELDS = frozenset(
    {
        "action",
        "event",
        "source",
        "test_connection",
        "debug_status",
        "message_id",
        "session_id",
        "turn_id",
        "role",
        "content",
        "content_len",
        "success",
        "detail",
        "reason",
        "created_at",
        "payload",
        "client_id",
        "page_instance_id",
        "page_display_id",
        "conversation_id",
        "url",
        "page_type",
        "page_title",
        "bind_request_id",
        "script_version",
        "upload_bridge_supported",
        "upload_bridge_version",
        "is_top_frame",
        "visibility_state",
        "has_focus",
        "heartbeat_alive",
        "pathname",
        "last_seen",
        "last_poll_at",
        "last_heartbeat_at",
        "is_responding",
        "response_state",
        "response_state_reason",
        "response_state_at",
        "can_accept_input",
        "can_send_now",
        "url_syncable",
        "conversation_syncable",
        "combo",
        "event_at",
        "identity_error",
    }
)

PAGE_REGISTRY_ALLOWED_FIELDS = BRIDGE_REQUEST_ALLOWED_FIELDS | frozenset(
    {
        "last_dom_mutation_at",
        "last_reply_watch_at",
        "pending_reply_active",
        "pending_reply_started_at",
        "pending_reply_text_length",
        "browser_hidden",
        "browser_visibility_state",
        "browser_has_focus",
        "browser_timer_drift_ms",
        "browser_probably_throttled",
    }
)

QUEUE_MESSAGE_ALLOWED_FIELDS = frozenset(
    {
        "message_id",
        "type",
        "command",
        "session_id",
        "turn_id",
        "trace_id",
        "content",
        "url",
        "client_id",
        "page_instance_id",
        "conversation_id",
        "bootstrap_conversation",
        "target_page_id",
        "bind_request_id",
        "target_source",
        "message_status",
        "created_at",
        "delivered_to",
        "delivered_at",
        "lease_until",
        "acked_at",
        "finalized_at",
        "error_detail",
        "payload",
        "active",
    }
)

POLL_RESPONSE_ALLOWED_FIELDS = frozenset(
    {
        "ok",
        "has_message",
        "message_id",
        "type",
        "retry",
        "command",
        "active",
        "content",
        "url",
        "client_id",
        "page_instance_id",
        "page_display_id",
        "conversation_id",
        "bind_request_id",
        "bootstrap_conversation",
        "target_page_id",
        "payload",
        "server_time",
        "page_no",
        "page_channel_promotion",
    }
)

GUI_PUSH_ALLOWED_FIELDS = frozenset(
    {
        "content",
        "url",
        "session_id",
        "turn_id",
        "trace_id",
        "client_id",
        "page_instance_id",
        "conversation_id",
        "bootstrap_conversation",
        "bind_request_id",
        "target_page_id",
        "target_source",
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

ALLOWED_TOP_LEVEL_FIELDS = GUI_PUSH_ALLOWED_FIELDS


def _normalize_allowed_fields(
    allowed_fields: Optional[Iterable[str]],
) -> Optional[frozenset[str]]:
    if allowed_fields is None:
        return None
    return frozenset(str(field) for field in allowed_fields if str(field).strip())


def _normalize_banned_fields(
    banned_fields: Optional[Iterable[str]],
    *,
    default_fields: frozenset[str],
) -> frozenset[str]:
    if banned_fields is None:
        return default_fields
    return frozenset(str(field) for field in banned_fields if str(field).strip())


def _is_legacy_target_source(path: str, key: str, value: Any) -> bool:
    if key != "target_source":
        return False
    if path and path != "target_source":
        return False
    return value in _LEGACY_TARGET_SOURCE_VALUES


def _legacy_target_source_text(value: Any) -> str:
    return f"target_source={value}"


def _collect_invalid_fields(
    obj: Any,
    *,
    allowed_fields: Optional[Iterable[str]] = None,
    strict_unknown: bool = False,
    banned_fields: Optional[Iterable[str]] = None,
    path: str = "",
) -> List[str]:
    found: List[str] = []
    allowed = _normalize_allowed_fields(allowed_fields)
    banned = _normalize_banned_fields(
        banned_fields,
        default_fields=LEGACY_ASSERT_FIELD_NAMES,
    )
    if isinstance(obj, dict):
        for key, value in obj.items():
            sub = f"{path}.{key}" if path else key
            if key in banned:
                found.append(sub)
            elif _is_legacy_target_source(path, key, value):
                found.append(_legacy_target_source_text(value))
            elif strict_unknown and allowed is not None and not path and key not in allowed:
                found.append(sub)
            if isinstance(value, (dict, list)):
                found.extend(
                    _collect_invalid_fields(
                        value,
                        allowed_fields=allowed,
                        strict_unknown=strict_unknown,
                        banned_fields=banned,
                        path=sub,
                    )
                )
    elif isinstance(obj, list):
        for index, item in enumerate(obj):
            sub = f"{path}[{index}]" if path else f"[{index}]"
            if isinstance(item, (dict, list)):
                found.extend(
                    _collect_invalid_fields(
                        item,
                        allowed_fields=allowed,
                        strict_unknown=strict_unknown,
                        banned_fields=banned,
                        path=sub,
                    )
                )
    return found


def assert_no_legacy_fields(
    obj: Any,
    *,
    owner: str = "-",
    allowed_fields: Optional[Iterable[str]] = None,
    strict_unknown: bool = False,
    banned_fields: Optional[Iterable[str]] = None,
) -> None:
    found = _collect_invalid_fields(
        obj,
        allowed_fields=allowed_fields,
        strict_unknown=strict_unknown,
        banned_fields=banned_fields,
    )
    if not found:
        return
    caller = inspect.stack()[1]
    print(
        "[FIELD][LEGACY_BLOCKED]\n"
        f"owner={owner}\n"
        f"fields={found}\n"
        f"caller={caller.filename}:{caller.lineno} {caller.function}\n"
        f"replacement={_REPLACEMENT_HINT}"
    )
    raise ValueError(
        f"legacy fields still exist before save: owner={owner}, fields={found}"
    )


def assert_no_remote_chatgpt_invalid_fields(obj: Any, *, owner: str = "-") -> None:
    if not isinstance(obj, dict):
        return
    obj = dict(obj)
    removable_legacy = (
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
    )
    for key in removable_legacy:
        obj.pop(key, None)
    invalid = []
    for key in obj.keys():
        if key not in REMOTE_CHATGPT_ALLOWED_FIELDS:
            invalid.append(key)
    if not invalid:
        return
    caller = inspect.stack()[1]
    print(
        "[REMOTE_FIELD][INVALID_BLOCKED]\n"
        f"owner={owner}\n"
        f"invalid={invalid}\n"
        f"caller={caller.filename}:{caller.lineno} {caller.function}\n"
        "replacement=canonical remote_chatgpt fields / BindSessionRuntime"
    )
    raise ValueError(
        f"invalid remote_chatgpt fields: owner={owner}, invalid={invalid}"
    )


def reject_legacy_fields(
    payload: Any,
    *,
    context: str = "-",
    migrate: bool = False,
    allowed_fields: Optional[Iterable[str]] = None,
    strict_unknown: bool = True,
) -> Optional[Tuple[Dict[str, Any], int]]:
    """Return (error_body, 400) when payload contains rejected fields."""
    if not isinstance(payload, dict):
        return None
    if migrate:
        raise ValueError(
            "legacy field migration is disabled; use canonical fields only"
        )

    legacy_fields = _collect_invalid_fields(
        payload,
        allowed_fields=None,
        strict_unknown=False,
        banned_fields=LEGACY_CLEANUP_FIELD_NAMES,
    )
    if legacy_fields:
        return (
            {
                "ok": False,
                "error": "legacy_fields_not_allowed",
                "context": context,
                "legacy_fields": sorted(legacy_fields),
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
                "legacy_fields": [_legacy_target_source_text(target_source)],
            },
            400,
        )

    allowed = _normalize_allowed_fields(allowed_fields)
    if strict_unknown and allowed:
        unknown_fields = sorted(
            key for key in payload.keys() if key not in allowed
        )
        if unknown_fields:
            return (
                {
                    "ok": False,
                    "error": "unknown_fields_not_allowed",
                    "context": context,
                    "unknown_fields": unknown_fields,
                },
                400,
            )
    return None


__all__ = [
    "LEGACY_FIELD_NAMES",
    "SESSION_MESSAGE_ALLOWED_FIELDS",
    "REMOTE_CHATGPT_ALLOWED_FIELDS",
    "REMOTE_CHATGPT_LOAD_MIGRATION_FIELDS",
    "BRIDGE_REQUEST_ALLOWED_FIELDS",
    "PAGE_REGISTRY_ALLOWED_FIELDS",
    "QUEUE_MESSAGE_ALLOWED_FIELDS",
    "POLL_RESPONSE_ALLOWED_FIELDS",
    "GUI_PUSH_ALLOWED_FIELDS",
    "assert_no_legacy_fields",
    "assert_no_remote_chatgpt_invalid_fields",
    "reject_legacy_fields",
]
