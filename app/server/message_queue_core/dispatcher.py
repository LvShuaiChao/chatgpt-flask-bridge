from __future__ import annotations

import logging
import time
from typing import Callable

from .models import MessageQueueItem

logger = logging.getLogger(__name__)


class MessageQueueDispatcher:
    def __init__(self, send_func: Callable[[MessageQueueItem], bool]):
        self.send_func = send_func

    def dispatch_one(self, item: MessageQueueItem) -> bool:
        if not item.text.strip():
            item.status = "failed"
            item.last_error = "empty_text"
            item.updated_at = time.time()
            logger.warning(
                "[MESSAGE_QUEUE_DISPATCH][EMPTY_TEXT] message_id=%s",
                item.message_id,
            )
            return False
        item.status = "running"
        item.updated_at = time.time()
        logger.info(
            "[MESSAGE_QUEUE_DISPATCH][START] message_id=%s page_id=%s",
            item.message_id,
            item.page_id,
        )
        try:
            ok = bool(self.send_func(item))
        except Exception as exc:
            item.status = "failed"
            item.last_error = repr(exc)
            item.updated_at = time.time()
            logger.exception(
                "[MESSAGE_QUEUE_DISPATCH][FAILED] message_id=%s error=%s",
                item.message_id,
                exc,
            )
            return False
        item.status = "sent" if ok else "failed"
        item.updated_at = time.time()
        logger.info(
            "[MESSAGE_QUEUE_DISPATCH][FINISH] message_id=%s ok=%s",
            item.message_id,
            int(ok),
        )
        return ok
