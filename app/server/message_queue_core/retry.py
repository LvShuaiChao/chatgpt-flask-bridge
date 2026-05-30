from __future__ import annotations

import logging
import time

from .models import MessageQueueItem, normalize_status

logger = logging.getLogger(__name__)


def can_retry(item: MessageQueueItem) -> bool:
    status = normalize_status(item.status)
    if status in {"sent", "cancelled", "running"}:
        return False
    return status == "failed" and item.retry_count < item.max_retry


def mark_retry(item: MessageQueueItem, reason: str) -> None:
    item.retry_count += 1
    item.status = "pending"
    item.updated_at = time.time()
    item.last_error = str(reason or "")
    logger.info(
        "[MESSAGE_QUEUE_RETRY][MARK] message_id=%s retry=%s/%s reason=%s",
        item.message_id,
        item.retry_count,
        item.max_retry,
        reason,
    )
