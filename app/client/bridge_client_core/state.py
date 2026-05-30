from __future__ import annotations

import time

from .models import BridgeClientState


def merge_client_state(state: BridgeClientState, *, connected: bool, error: str = "") -> BridgeClientState:
    state.connected = bool(connected)
    state.last_error = str(error or "")
    if connected:
        state.last_health_at = time.time()
    return state
