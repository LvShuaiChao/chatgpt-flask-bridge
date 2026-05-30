from __future__ import annotations

from typing import Any, Callable, Dict, Iterable, List, Tuple

from .models import MessageQueueItem, normalize_status


def summarize_queue(items: Iterable[MessageQueueItem]) -> Dict[str, int]:
    summary = {
        "total": 0,
        "pending": 0,
        "running": 0,
        "sent": 0,
        "failed": 0,
        "cancelled": 0,
    }
    for item in items:
        summary["total"] += 1
        status = normalize_status(item.status)
        if status not in summary:
            status = "pending"
        summary[status] += 1
    return summary


def build_bridge_status_summary(pages: List[dict], *, last_focused_tm_page: dict | None) -> dict:
    """Derive online stats and focused page from a pages snapshot."""
    online_pages = [
        p for p in (pages or []) if isinstance(p, dict) and p.get("online")
    ]
    focused = None
    if isinstance(last_focused_tm_page, dict) and last_focused_tm_page:
        focused = dict(last_focused_tm_page)
    else:
        focus_candidates = [p for p in online_pages if p.get("has_focus")]
        if focus_candidates:
            focus_candidates.sort(
                key=lambda p: float(p.get("last_focus_at") or p.get("last_seen") or 0),
                reverse=True,
            )
            focused = {
                k: focus_candidates[0].get(k)
                for k in (
                    "client_id",
                    "page_instance_id",
                    "url",
                    "conversation_id",
                    "page_type",
                    "page_no",
                )
            }
    return {
        "online_count": len(online_pages),
        "focused_page": focused,
        "bound_page": None,
    }


def outbound_queue_stats(
    outbound_queue: Iterable[dict],
    *,
    client_id: str = "",
    conversation_id: str = "",
    message_matches_client: Callable[[dict, str], bool],
) -> Tuple[int, int, int]:
    client_id = (client_id or "").strip()
    conversation_id = (conversation_id or "").strip()
    pending_total = 0
    pending_for_page = 0
    pending_for_conversation = 0
    for msg in outbound_queue:
        if not isinstance(msg, dict):
            continue
        if msg.get("type") == "command":
            continue
        pending_total += 1
        if client_id and message_matches_client(msg, client_id):
            pending_for_page += 1
        msg_conv = (msg.get("conversation_id") or "").strip()
        if conversation_id and msg_conv == conversation_id:
            pending_for_conversation += 1
    return pending_total, pending_for_page, pending_for_conversation
