from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict

from app.utils.page_identity import PageIdentity
from app.utils.page_identity_proxy import PageIdentityProxyMixin


@dataclass
class PageSyncState:
    page_display_id: str = ""
    page_instance_id: str = ""
    conversation_id: str = ""
    bridge_connected: bool = False
    can_accept_input: bool = False
    can_send_now: bool = False
    response_state: str = ""
    response_state_reason: str = ""
    updated_at: float = field(default_factory=time.time)

    @property
    def page_id(self) -> str:
        """旧字段兼容：UI 展示 ID 等同 page_display_id，不能返回 page_instance_id。"""
        return self.page_display_id

    @property
    def inputable(self) -> bool:
        """旧字段兼容：inputable 等同 can_accept_input。"""
        return self.can_accept_input

    @property
    def sendable(self) -> bool:
        """旧字段兼容：sendable 等同 can_send_now。"""
        return self.can_send_now

    def update_from_payload(self, payload: Dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise TypeError(
                f"PageSyncState.update_from_payload expected dict, got {type(payload)!r}"
            )
        self.page_display_id = str(
            payload.get("page_display_id")
            or payload.get("page_no")
            or payload.get("page_id")
            or self.page_display_id
            or ""
        ).strip()
        self.page_instance_id = str(
            payload.get("page_instance_id")
            or self.page_instance_id
            or ""
        ).strip()
        self.conversation_id = str(
            payload.get("conversation_id") or self.conversation_id or ""
        ).strip()
        self.bridge_connected = bool(
            payload.get("bridge_connected", self.bridge_connected)
        )
        self.can_accept_input = bool(
            payload.get(
                "can_accept_input",
                payload.get("inputable", self.can_accept_input),
            )
        )
        self.can_send_now = bool(
            payload.get(
                "can_send_now",
                payload.get(
                    "send_now_available",
                    payload.get("sendable", self.can_send_now),
                ),
            )
        )
        self.response_state = str(
            payload.get("response_state") or self.response_state or ""
        ).strip().lower()
        self.response_state_reason = str(
            payload.get("response_state_reason") or self.response_state_reason or ""
        ).strip()
        self.updated_at = time.time()


@dataclass
class SyncPlan(PageIdentityProxyMixin):
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
    def reason_code(self) -> str:
        """标准字段兼容层：旧 block_reason 等同 reason_code。"""
        return self.block_reason

    @reason_code.setter
    def reason_code(self, value: str) -> None:
        self.block_reason = str(value or "").strip()

    @property
    def identity(self) -> PageIdentity:
        return PageIdentity.from_mapping(self.target)
