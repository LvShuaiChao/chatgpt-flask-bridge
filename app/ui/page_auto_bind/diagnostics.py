from __future__ import annotations

import logging
import time
from typing import List

from .state import PageAutoBindState

logger = logging.getLogger(__name__)


def diagnose_auto_bind(
    state: PageAutoBindState,
    *,
    expected_conversation_id: str = "",
    stale_sec: float = 120.0,
    now: float | None = None,
) -> List[str]:
    codes: List[str] = []
    now = time.time() if now is None else float(now)

    if not (state.current_account_id or "").strip():
        codes.append("no_account")
    if not (state.current_page_id or "").strip():
        codes.append("no_page")
    if state.last_bind_error:
        if "mismatch" in state.last_bind_error.lower():
            codes.append("page_mismatch")
        if "conversation" in state.last_bind_error.lower():
            codes.append("conversation_mismatch")
    exp = (expected_conversation_id or "").strip()
    if exp and state.current_conversation_id and exp != state.current_conversation_id:
        codes.append("conversation_mismatch")
    if state.updated_at and (now - state.updated_at) > stale_sec:
        codes.append("stale_bind")

    logger.info("[PAGE_AUTO_BIND_DIAG][RESULT] codes=%s", ",".join(codes) or "-")
    return codes
