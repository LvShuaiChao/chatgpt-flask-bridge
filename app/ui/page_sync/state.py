from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict

from app.utils.page_identity import PageIdentity


@dataclass
class PageSyncState:
    page_id: str = ""
    conversation_id: str = ""
    bridge_connected: bool = False
    inputable: bool = False
    sendable: bool = False
    response_state: str = ""
    response_state_reason: str = ""
    updated_at: float = field(default_factory=time.time)

    def update_from_payload(self, payload: Dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise TypeError(
                f"PageSyncState.update_from_payload expected dict, got {type(payload)!r}"
            )
        self.page_id = str(
            payload.get("page_id")
            or payload.get("page_display_id")
            or payload.get("page_instance_id")
            or self.page_id
            or ""
        )
        self.conversation_id = str(
            payload.get("conversation_id") or self.conversation_id or ""
        )
        self.bridge_connected = bool(
            payload.get("bridge_connected", self.bridge_connected)
        )
        self.inputable = bool(payload.get("inputable", self.inputable))
        self.sendable = bool(payload.get("sendable", self.sendable))
        self.response_state = str(
            payload.get("response_state") or self.response_state or ""
        )
        self.response_state_reason = str(
            payload.get("response_state_reason") or self.response_state_reason or ""
        )
        self.updated_at = time.time()


@dataclass
class SyncPlan:
    """一次 sync_conversation 的决策与入队上下文。"""

    session: Any
    session_id: str
    request_reason: str = "manual_button"
    delay_ms: int = 0
    allow_open_url: bool = False
    strict_bound_identity: bool = True
    trace_id: str = ""
    request_id: str = ""
    allowed: bool = False
    target: Dict[str, Any] = field(default_factory=dict)
    target_source: str = ""
    block_reason: str = ""
    mode: str = "merge"
    max_messages: int = 10

    @property
    def identity(self) -> PageIdentity:
        return PageIdentity.from_mapping(self.target)

    @property
    def client_id(self) -> str:
        return self.identity.client_id

    @property
    def page_instance_id(self) -> str:
        return self.identity.page_instance_id

    @property
    def conversation_id(self) -> str:
        return self.identity.conversation_id

    @property
    def url(self) -> str:
        return self.identity.url
