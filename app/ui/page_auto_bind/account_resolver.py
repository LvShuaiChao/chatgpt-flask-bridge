from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def resolve_account_for_page(
    page: Optional[Dict[str, Any]],
    *,
    selected_account_id: str = "",
    selected_display_name: str = "",
    config_account_id: str = "",
) -> Dict[str, str]:
    """Resolve account_id (internal) vs display_name (UI) from page / selection / config."""
    page = page if isinstance(page, dict) else {}
    account_id = (
        (selected_account_id or "").strip()
        or (config_account_id or "").strip()
        or str(page.get("account_id") or "").strip()
    )
    display_name = (
        (selected_display_name or "").strip()
        or str(page.get("account_display_name") or page.get("display_name") or "").strip()
    )
    if not account_id:
        logger.info(
            "[PAGE_AUTO_BIND_ACCOUNT][MISSING] page_instance_id=%s",
            page.get("page_instance_id") or "-",
        )
        return {"account_id": "", "display_name": display_name, "username": ""}
    logger.info(
        "[PAGE_AUTO_BIND_ACCOUNT][RESOLVE] account_id=%s display_name=%s",
        account_id,
        display_name or "-",
    )
    username = str(page.get("username") or page.get("login_name") or "").strip()
    logger.info(
        "[PAGE_AUTO_BIND_ACCOUNT][RESULT] account_id=%s display_name=%s",
        account_id,
        display_name or "-",
    )
    return {
        "account_id": account_id,
        "display_name": display_name,
        "username": username,
    }
