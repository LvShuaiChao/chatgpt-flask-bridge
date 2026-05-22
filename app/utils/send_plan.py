"""发送主线：本地轮次 + 单次 resolve 后的 SendPlan。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from app.utils.page_status import PageActionPlan


@dataclass
class LocalTurn:
    session: Any
    content: str
    trace_id: str
    turn_id: str
    user_message_id: str
    assistant_message_id: str
    button: str = "send"


@dataclass
class SendPlan:
    """一次发送决策快照；resolve_page_action 只在此构建一次。"""

    turn: LocalTurn
    page_action: PageActionPlan | None = None
    decision: str = "blocked"  # allowed | queued | blocked
    reason: str = ""
    is_bootstrap: bool = False
    block_status: str = ""
    enqueue: bool = False
    system_msg: str = ""
    hint: str = ""
    render_reason: str = "send_blocked"
    retryable: bool = True
    suppress_system_message: bool = False
    from_pending_bootstrap: bool = False
    message_source: str = "direct"
    stop_after_handle: bool = False

    @property
    def session(self):
        return self.turn.session

    @property
    def content(self) -> str:
        return self.turn.content

    @property
    def trace_id(self) -> str:
        return self.turn.trace_id

    @property
    def turn_id(self) -> str:
        return self.turn.turn_id

    @property
    def user_message_id(self) -> str:
        return self.turn.user_message_id

    @property
    def assistant_message_id(self) -> str:
        return self.turn.assistant_message_id

    @property
    def client_id(self) -> str:
        if self.page_action is None:
            return ""
        return self.page_action.client_id

    @property
    def page_instance_id(self) -> str:
        if self.page_action is None:
            return ""
        return self.page_action.page_instance_id

    @property
    def conversation_id(self) -> str:
        if self.page_action is None:
            return ""
        return self.page_action.conversation_id

    @property
    def url(self) -> str:
        if self.page_action is None:
            return ""
        return self.page_action.url

    @property
    def target_source(self) -> str:
        if self.page_action is None:
            return ""
        return self.page_action.target_source

    @property
    def page(self) -> PageActionPlan | None:
        """发送目标解析结果；与历史 plan.page.client_id 访问兼容。"""
        return self.page_action

    @property
    def send_detail(self) -> Dict[str, Any]:
        if self.page_action is None:
            return {}
        return self.page_action.to_dict()

    def apply_page_action(self, page_action: PageActionPlan | None) -> None:
        self.page_action = page_action
        if page_action is None:
            return
        self.decision = (page_action.decision or "blocked").strip()
        self.reason = (page_action.reason_code or "").strip()

    def allows_dispatch(self) -> bool:
        return self.decision in ("allowed", "queued") and bool(self.client_id)
