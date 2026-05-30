from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def match_page_identity(
    pages: List[Dict[str, Any]],
    *,
    page_instance_id: str = "",
    page_display_id: str = "",
    conversation_id: str = "",
    url: str = "",
) -> Optional[Dict[str, Any]]:
    """Match a registry page by instance id, display id, conversation, or url."""
    page_instance_id = (page_instance_id or "").strip()
    page_display_id = (page_display_id or "").strip()
    conversation_id = (conversation_id or "").strip()
    url = (url or "").strip()

    for page in pages or []:
        if not isinstance(page, dict):
            continue
        if page_instance_id and str(page.get("page_instance_id") or "").strip() == page_instance_id:
            return page
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        disp = str(page.get("page_display_id") or page.get("page_no") or "").strip()
        if page_display_id and disp == page_display_id:
            return page
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        if conversation_id and str(page.get("conversation_id") or "").strip() == conversation_id:
            return page
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        if url and str(page.get("url") or "").strip() == url:
            return page
    return None
