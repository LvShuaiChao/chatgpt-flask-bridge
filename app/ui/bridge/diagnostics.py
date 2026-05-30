from __future__ import annotations

import logging
import time
from typing import List, Optional

from .state import BridgeState

logger = logging.getLogger(__name__)

_STALE_CLIENT_SEC = 30.0


def diagnose_bridge_state(
    state: BridgeState,
    *,
    expected_client_id: str = "",
    expected_conversation_id: str = "",
    now: Optional[float] = None,
) -> List[str]:
    codes: List[str] = []
    now = time.time() if now is None else float(now)

    if not state.connected:
        codes.append("bridge_disconnected")

    if state.last_seen_at and (now - state.last_seen_at) > _STALE_CLIENT_SEC:
        codes.append("stale_client")

    if not state.last_seen_at and state.connected:
        codes.append("no_heartbeat")

    exp_client = (expected_client_id or "").strip()
    if exp_client and state.client_id and exp_client != state.client_id:
        codes.append("page_id_mismatch")

    if expected_conversation_id and state.page_instance_id:
        pass  # conversation mismatch checked at session layer

    logger.info("[BRIDGE_DIAG][RESULT] codes=%s", ",".join(codes) or "-")
    return codes
