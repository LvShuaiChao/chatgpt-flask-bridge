from __future__ import annotations

import logging
from typing import Any, Dict

from .models import BridgeClientEvent

logger = logging.getLogger(__name__)


def parse_bridge_response_event(data: Dict[str, Any]) -> BridgeClientEvent:
    if not isinstance(data, dict):
        raise TypeError(f"parse_bridge_response_event expected dict, got {type(data)!r}")
    event = str(data.get("event") or data.get("kind") or "").strip()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else data
    logger.info("[BRIDGE_CLIENT_EVENT_PARSER] event=%s", event or "-")
    return BridgeClientEvent(name=event, payload=dict(payload))
