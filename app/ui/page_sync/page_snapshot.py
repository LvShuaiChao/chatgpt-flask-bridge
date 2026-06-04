from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from

from .state import PageSyncState

logger = logging.getLogger(__name__)


def parse_page_snapshot(payload: Dict[str, Any]) -> PageSyncState:
    """Parse bridge-reported page snapshot into PageSyncState."""
    if not isinstance(payload, dict):
        logger.warning(
            "[PAGE_SYNC_SNAPSHOT][INVALID] type=%s",
            type(payload).__name__,
        )
        raise TypeError(f"parse_page_snapshot expected dict, got {type(payload)!r}")
    logger.info(
        "[PAGE_SYNC_SNAPSHOT][PARSE] page_display_id=%s page_instance_id=%s conversation_id=%s",
        payload.get("page_display_id") or payload.get("page_no") or payload.get("page_id") or "-",
        payload.get("page_instance_id") or "-",
        payload.get("conversation_id") or "-",
    )
    state = PageSyncState()
    state.update_from_payload(payload)
    logger.info(
        "[PAGE_SYNC_SNAPSHOT][RESULT] page_display_id=%s page_instance_id=%s bridge_connected=%s can_accept_input=%s can_send_now=%s",
        state.page_display_id,
        state.page_instance_id,
        int(state.bridge_connected),
        int(state.can_accept_input),
        int(state.can_send_now),
    )
    return state


def normalize_conversation_snapshot_payload(
    payload: Optional[dict],
    *,
    item: Optional[dict] = None,
    pending_sync: Optional[dict] = None,
) -> dict:
    """Normalize conversation snapshot from bridge report (no UI)."""
    payload = dict(payload or {})
    item = item or {}
    pending_sync = pending_sync or {}
    page_meta = payload.get("page") if isinstance(payload.get("page"), dict) else {}
    for key in (
        "session_id",
        "conversation_id",
        "request_id",
        "client_id",
        "page_instance_id",
        "url",
        "page_no",
        "page_display_id",
    ):
        if not str(payload.get(key) or "").strip():
            alt = (
                item.get(key)
                or pending_sync.get(key)
                or page_meta.get(key)
                or ""
            )
            if alt:
                payload[key] = alt
    if not (payload.get("client_id") or "").strip():
        payload["client_id"] = (item.get("client_id") or "").strip()
    if not (payload.get("conversation_id") or "").strip():
        conv = parse_conversation_id(
            page_url_from(payload) or (payload.get("url") or "")
        )
        if conv:
            payload["conversation_id"] = conv
    snapshot_url = (payload.get("url") or "").strip()
    if snapshot_url:
        payload["url"] = snapshot_url

    stats = payload.get("stats")
    if not isinstance(stats, dict):
        stats = {}

    messages = payload.get("messages")
    if not isinstance(messages, list):
        messages = []

    if not stats:
        user_count = 0
        assistant_count = 0
        total_chars = 0

        for msg in messages:
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role") or "").strip().lower()
            text = str(msg.get("text") or msg.get("content") or "").strip()
            char_count = len("".join(text.split()))
            total_chars += char_count

            if role == "user":
                user_count += 1
            elif role == "assistant":
                assistant_count += 1

        stats = {
            "total_count": len(messages),
            "user_count": user_count,
            "assistant_count": assistant_count,
            "round_count": (
                min(user_count, assistant_count)
                if user_count and assistant_count
                else (len(messages) + 1) // 2
            ),
            "total_chars": total_chars,
            "dom_estimated_round_count": int(
                payload.get("dom_estimated_round_count") or 0
            ),
        }

    payload["stats"] = stats
    payload["message_count"] = int(stats.get("total_count") or len(messages))
    payload["user_count"] = int(stats.get("user_count") or 0)
    payload["assistant_count"] = int(stats.get("assistant_count") or 0)
    payload["round_count"] = int(stats.get("round_count") or 0)
    payload["dom_estimated_round_count"] = int(
        stats.get("dom_estimated_round_count")
        or payload.get("dom_estimated_round_count")
        or 0
    )
    return payload
