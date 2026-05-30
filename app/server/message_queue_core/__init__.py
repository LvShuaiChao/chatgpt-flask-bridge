"""Outbound/inbound message queue primitives (models, storage, dispatch)."""
from __future__ import annotations

from .models import MessageQueueItem, normalize_status
from .storage import MessageQueueStorage
from .dedupe import build_dedupe_key, dedupe_items
from .dispatcher import MessageQueueDispatcher
from .retry import can_retry, mark_retry
from .status import (
    build_bridge_status_summary,
    outbound_queue_stats,
    summarize_queue,
)

__all__ = [
    "MessageQueueItem",
    "normalize_status",
    "MessageQueueStorage",
    "build_dedupe_key",
    "dedupe_items",
    "MessageQueueDispatcher",
    "can_retry",
    "mark_retry",
    "summarize_queue",
    "build_bridge_status_summary",
    "outbound_queue_stats",
]
