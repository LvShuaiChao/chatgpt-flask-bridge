from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

from .account_resolver import resolve_account_for_page
from .page_matcher import match_page_identity
from .state import PageAutoBindState

logger = logging.getLogger(__name__)


def run_auto_bind(
    state: PageAutoBindState,
    *,
    pages: list,
    page_info: Optional[Dict[str, Any]] = None,
    selected_account_id: str = "",
    notify_ui: Optional[Callable[[PageAutoBindState], None]] = None,
) -> PageAutoBindState:
    """Execute bind steps without UI drawing (optional notify callback)."""
    page_info = page_info if isinstance(page_info, dict) else {}
    matched = match_page_identity(
        pages,
        page_instance_id=str(page_info.get("page_instance_id") or ""),
        page_display_id=str(page_info.get("page_display_id") or page_info.get("page_no") or ""),
        conversation_id=str(page_info.get("conversation_id") or ""),
        url=str(page_info.get("url") or ""),
    )
    if matched is None:
        state.mark_error("no_page")
        logger.warning("[PAGE_AUTO_BIND][RUN] no matching page")
    else:
        account = resolve_account_for_page(matched, selected_account_id=selected_account_id)
        state.mark_bound(
            account_id=account.get("account_id") or "",
            display_name=account.get("display_name") or "",
            page_id=str(
                matched.get("page_display_id")
                or matched.get("page_no")
                or ""
            ),
            conversation_id=str(matched.get("conversation_id") or ""),
        )
        logger.info(
            "[PAGE_AUTO_BIND][BOUND] page_display_id=%s page_instance_id=%s conversation_id=%s account_id=%s",
            matched.get("page_display_id") or matched.get("page_no") or "-",
            matched.get("page_instance_id") or "-",
            matched.get("conversation_id") or "-",
            account.get("account_id") or "-",
        )
    if notify_ui is not None:
        notify_ui(state)
    return state
