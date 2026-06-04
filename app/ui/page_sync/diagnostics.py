from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

BUSY_RESPONSE_STATES_FOR_SYNC_DIAG = {
    "responding",
    "busy",
    "generating",
    "streaming",
    "assistant_busy",
}


def _bool_from_mapping(
    primary: Dict[str, Any],
    secondary: Dict[str, Any],
    standard_key: str,
    *legacy_keys: str,
    default: bool = False,
) -> bool:
    if standard_key in primary and primary.get(standard_key) is not None:
        return bool(primary.get(standard_key))
    if standard_key in secondary and secondary.get(standard_key) is not None:
        return bool(secondary.get(standard_key))
    for key in legacy_keys:
        if key in primary and primary.get(key) is not None:
            return bool(primary.get(key))
        if key in secondary and secondary.get(key) is not None:
            return bool(secondary.get(key))
    return bool(default)


def diagnose_sync_target(
    target: Optional[Dict[str, Any]],
    *,
    profile: Optional[Dict[str, Any]] = None,
    bridge_connected: bool = True,
) -> List[str]:
    """Return diagnostic codes for page sync readiness (no UI)."""
    target = target if isinstance(target, dict) else {}
    profile = profile if isinstance(profile, dict) else {}
    codes: List[str] = []

    if not bridge_connected:
        codes.append("bridge_disconnected")

    online = bool(
        target.get("online")
        if target.get("online") is not None
        else profile.get("online")
    )
    if not online:
        codes.append("page_offline")

    response_state = str(
        target.get("response_state")
        or profile.get("response_state")
        or "unknown"
    ).strip().lower()
    if response_state in BUSY_RESPONSE_STATES_FOR_SYNC_DIAG:
        codes.append("assistant_busy")

    can_accept_input = _bool_from_mapping(
        target,
        profile,
        "can_accept_input",
        "inputable",
        default=False,
    )
    if not can_accept_input:
        codes.append("composer_not_inputable")

    send_decision = str(
        target.get("send_decision")
        or profile.get("send_decision")
        or ""
    ).strip().lower()
    can_send_now = _bool_from_mapping(
        target,
        profile,
        "can_send_now",
        "send_now_available",
        "sendable",
        default=False,
    )
    send_queueable = bool(
        target.get("send_queueable")
        or profile.get("send_queueable")
        or send_decision == "queued"
    )
    send_allowed_by_decision = send_decision in {"allowed", "queued"}
    if not can_send_now and not send_queueable and not send_allowed_by_decision:
        codes.append("send_button_disabled")

    conversation_syncable = bool(
        target.get("conversation_syncable")
        if target.get("conversation_syncable") is not None
        else profile.get("conversation_syncable")
    )
    if online and not conversation_syncable and not target.get("prebound_home"):
        codes.append("conversation_not_syncable")

    logger.info(
        "[PAGE_SYNC_DIAG][RESULT] "
        "codes=%s online=%s response_state=%s can_accept_input=%s "
        "can_send_now=%s send_decision=%s send_queueable=%s "
        "legacy_inputable=%s legacy_send_now_available=%s legacy_sendable=%s",
        ",".join(codes) or "-",
        int(online),
        response_state or "-",
        int(can_accept_input),
        int(can_send_now),
        send_decision or "-",
        int(send_queueable),
        int(bool(target.get("inputable") or profile.get("inputable"))),
        int(bool(target.get("send_now_available") or profile.get("send_now_available"))),
        int(bool(target.get("sendable") or profile.get("sendable"))),
    )
    return codes
