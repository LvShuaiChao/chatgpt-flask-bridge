from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


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
        target.get("response_state") or profile.get("response_state") or ""
    ).strip().lower()
    if response_state in ("responding", "busy", "generating"):
        codes.append("assistant_busy")

    inputable = bool(
        target.get("can_accept_input")
        if target.get("can_accept_input") is not None
        else target.get("inputable", profile.get("inputable"))
    )
    if not inputable:
        codes.append("composer_not_inputable")

    sendable = bool(
        target.get("send_now_available")
        if target.get("send_now_available") is not None
        else target.get("sendable", profile.get("sendable"))
    )
    send_queueable = bool(target.get("send_queueable") or profile.get("send_queueable"))
    if not sendable and not send_queueable:
        codes.append("send_button_disabled")

    conversation_syncable = bool(
        target.get("conversation_syncable")
        if target.get("conversation_syncable") is not None
        else profile.get("conversation_syncable")
    )
    if online and not conversation_syncable and not target.get("prebound_home"):
        codes.append("conversation_not_syncable")

    logger.info("[PAGE_SYNC_DIAG][RESULT] codes=%s", ",".join(codes) or "-")
    return codes
