from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_INBOUND_ROUTES = {
    "report_unknown": "report_unknown",
    "report_mismatch": "report_mismatch",
    "ack_mismatch": "ack_mismatch",
    "report_ignored": "report_ignored",
    "open_url_success": "open_url_success",
    "open_url_failed": "open_url_failed",
    "close_page_requested": "close_page_requested",
    "close_page_still_open": "close_page_still_open",
    "control_done": "control_done",
    "close_page_success": "command_result",
    "close_page_failed": "command_result",
    "command_failed": "command_result",
    "conversation_snapshot": "conversation_snapshot",
    "conversation_created": "conversation_created",
}


def resolve_inbound_route(kind: str) -> str:
    """Map inbound kind to handler category (no business logic)."""
    key = str(kind or "").strip()
    route = _INBOUND_ROUTES.get(key)
    if route:
        return route
    if key:
        logger.info("[BRIDGE_ROUTER][UNKNOWN_EVENT] kind=%s", key)
    return "bound_message"
