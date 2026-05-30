from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

_VALID_STATUSES = frozenset({"pending", "running", "sent", "failed", "cancelled"})


@dataclass
class MessageQueueItem:
    message_id: str
    text: str
    page_id: str = ""
    conversation_id: str = ""
    status: str = "pending"
    retry_count: int = 0
    max_retry: int = 3
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    last_error: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "message_id": self.message_id,
            "text": self.text,
            "page_id": self.page_id,
            "conversation_id": self.conversation_id,
            "status": self.status,
            "retry_count": self.retry_count,
            "max_retry": self.max_retry,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_error": self.last_error,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MessageQueueItem":
        if not isinstance(data, dict):
            raise TypeError(f"MessageQueueItem.from_dict expected dict, got {type(data)!r}")
        return cls(
            message_id=str(data.get("message_id") or ""),
            text=str(data.get("text") or data.get("content") or ""),
            page_id=str(data.get("page_id") or data.get("page_instance_id") or ""),
            conversation_id=str(data.get("conversation_id") or ""),
            status=str(data.get("status") or data.get("message_status") or "pending"),
            retry_count=int(data.get("retry_count") or 0),
            max_retry=int(data.get("max_retry") or 3),
            created_at=float(data.get("created_at") or time.time()),
            updated_at=float(data.get("updated_at") or time.time()),
            last_error=str(data.get("last_error") or data.get("error_detail") or ""),
        )


def normalize_status(status: str) -> str:
    value = str(status or "").strip().lower()
    if value in _VALID_STATUSES:
        return value
    return "pending"


def sync_message_status_fields(msg: dict, status: str) -> None:
    if not isinstance(msg, dict):
        return
    msg["message_status"] = status


def set_message_status(
    msg: dict,
    status: str,
    *,
    error_detail: Optional[str] = None,
    now_fn: Optional[Callable[[], float]] = None,
) -> None:
    """Update server outbound dict message status (compatible with legacy fields)."""
    if not isinstance(msg, dict):
        return
    sync_message_status_fields(msg, status)
    ts = float(now_fn()) if now_fn is not None else time.time()
    msg["finalized_at"] = ts
    if error_detail is not None:
        msg["error_detail"] = error_detail
