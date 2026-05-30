from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import List

from .models import MessageQueueItem

logger = logging.getLogger(__name__)


class MessageQueueStorage:
    def __init__(self, queue_path: Path):
        self.queue_path = Path(queue_path)

    def load_items(self) -> List[MessageQueueItem]:
        if not self.queue_path.exists():
            logger.info("[MESSAGE_QUEUE_STORAGE][LOAD_EMPTY] path=%s", self.queue_path)
            return []
        try:
            raw_text = self.queue_path.read_text(encoding="utf-8")
            raw_data = json.loads(raw_text)
        except Exception as exc:
            logger.exception(
                "[MESSAGE_QUEUE_STORAGE][LOAD_FAILED] path=%s error=%s",
                self.queue_path,
                exc,
            )
            raise
        if not isinstance(raw_data, list):
            raise ValueError(
                f"Message queue file must contain list, got {type(raw_data)!r}"
            )
        items = [MessageQueueItem.from_dict(row) for row in raw_data]
        logger.info(
            "[MESSAGE_QUEUE_STORAGE][LOAD_OK] path=%s count=%s",
            self.queue_path,
            len(items),
        )
        return items

    def save_items(self, items: List[MessageQueueItem]) -> None:
        self.queue_path.parent.mkdir(parents=True, exist_ok=True)
        data = [item.to_dict() for item in items]
        tmp_path = self.queue_path.with_suffix(self.queue_path.suffix + ".tmp")
        try:
            tmp_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            tmp_path.replace(self.queue_path)
        except Exception as exc:
            logger.exception(
                "[MESSAGE_QUEUE_STORAGE][SAVE_FAILED] path=%s error=%s",
                self.queue_path,
                exc,
            )
            raise
        logger.info(
            "[MESSAGE_QUEUE_STORAGE][SAVE_OK] path=%s count=%s",
            self.queue_path,
            len(items),
        )
