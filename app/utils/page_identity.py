"""统一页面身份（client / instance / conversation / url）。"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from app.url_utils import parse_conversation_id


@dataclass(frozen=True)
class PageIdentity:
    client_id: str = ""
    page_instance_id: str = ""
    conversation_id: str = ""
    url: str = ""

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any] | None) -> "PageIdentity":
        if not isinstance(data, Mapping):
            return cls()
        from app.utils.page_status import page_url_from

        url = page_url_from(dict(data)) or str(data.get("url") or "").strip()
        conversation_id = str(data.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(url) or ""
        return cls(
            client_id=str(data.get("client_id") or "").strip(),
            page_instance_id=str(data.get("page_instance_id") or "").strip(),
            conversation_id=conversation_id,
            url=url,
        )

    def to_dict(self) -> dict:
        return {
            "client_id": self.client_id,
            "page_instance_id": self.page_instance_id,
            "conversation_id": self.conversation_id,
            "url": self.url,
        }

    def has_page_channel(self) -> bool:
        return bool(self.client_id or self.page_instance_id)

    def has_conversation(self) -> bool:
        return bool(self.conversation_id)

    def display_key(self) -> str:
        return (
            self.page_instance_id
            or self.client_id
            or self.conversation_id
            or self.url
        )
