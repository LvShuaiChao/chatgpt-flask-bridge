from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_KNOWN_EVENT_PREFIXES = (
    "BRIDGE POLL",
    "REPORT_FILTER",
    "BUTTON_STATE",
    "UPLOAD_UI_ACTION",
    "CLOSED_LOOP",
)


@dataclass
class BridgeClientEvent:
    action: str = ""
    event: str = ""
    client_id: str = ""
    page_instance_id: str = ""
    payload: Dict[str, Any] = field(default_factory=dict)


def parse_bridge_client_event(body: Optional[dict]) -> BridgeClientEvent:
    """Parse browser bridge POST body; no business handling."""
    body = body if isinstance(body, dict) else {}
    action = str(body.get("action") or "").strip()
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else body
    event = str(payload.get("event") or body.get("event") or "").strip()
    if not event and action.upper().startswith("POLL"):
        event = "BRIDGE POLL"
    for prefix in _KNOWN_EVENT_PREFIXES:
        if event.upper().startswith(prefix) or action.upper().startswith(prefix):
            logger.info(
                "[BRIDGE_CLIENT_EVENT][PARSE] action=%s event=%s",
                action or "-",
                event or prefix,
            )
            break
    return BridgeClientEvent(
        action=action,
        event=event,
        client_id=str(body.get("client_id") or payload.get("client_id") or ""),
        page_instance_id=str(
            body.get("page_instance_id") or payload.get("page_instance_id") or ""
        ),
        payload=dict(payload),
    )
