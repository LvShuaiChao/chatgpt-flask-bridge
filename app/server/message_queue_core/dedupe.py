from __future__ import annotations

import logging
from typing import Iterable, List, Set

from .models import MessageQueueItem

logger = logging.getLogger(__name__)


def build_dedupe_key(item: MessageQueueItem) -> str:
    return "|".join(
        [
            str(item.conversation_id or ""),
            str(item.page_id or ""),
            str(item.text or "").strip(),
        ]
    )


def dedupe_items(items: Iterable[MessageQueueItem]) -> List[MessageQueueItem]:
    rows = list(items)
    seen: Set[str] = set()
    result: List[MessageQueueItem] = []
    for item in rows:
        key = build_dedupe_key(item)
        if key in seen:
            logger.info(
                "[MESSAGE_QUEUE_DEDUPE][DROP] key=%s message_id=%s",
                key,
                item.message_id,
            )
            continue
        seen.add(key)
        result.append(item)
    logger.info(
        "[MESSAGE_QUEUE_DEDUPE][RESULT] before=%s after=%s",
        len(rows),
        len(result),
    )
    return result
