from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

from .diagnostics import diagnose_sync_target
from .page_snapshot import parse_page_snapshot
from .state import PageSyncState

logger = logging.getLogger(__name__)


def run_page_sync_update(
    payload: Dict[str, Any],
    *,
    render_fn: Optional[Callable[[PageSyncState, Dict[str, Any]], None]] = None,
    bridge_connected: bool = True,
) -> PageSyncState:
    """Apply bridge payload to PageSyncState; optional render callback (no send/enqueue)."""
    logger.info("[PAGE_SYNC_RUNNER][START] page_id=%s", payload.get("page_id") or "-")
    try:
        state = parse_page_snapshot(payload)
        logger.info(
            "[PAGE_SYNC_RUNNER][UPDATE] page_id=%s conversation_id=%s",
            state.page_id,
            state.conversation_id,
        )
        diagnose_sync_target(payload, bridge_connected=bridge_connected)
        if render_fn is not None:
            render_fn(state, payload)
        logger.info("[PAGE_SYNC_RUNNER][FINISH] page_id=%s", state.page_id)
        return state
    except Exception as exc:
        logger.exception("[PAGE_SYNC_RUNNER][FAILED] error=%s", exc)
        raise
