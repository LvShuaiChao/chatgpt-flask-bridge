"""GUI 动作编排数据模型（TaskRun / Step / 页面快照）。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


class TaskPhase:
    IDLE = "idle"
    PREFLIGHT = "preflight"
    UPLOADING = "uploading"
    SENDING = "sending"
    WAITING_REPLY = "waiting_reply"
    COPYING = "copying"
    HOTKEY_SENDING = "hotkey_sending"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"


SEND_COPY_HOTKEY_ONCE_STEPS: List[str] = [
    "preflight_page",
    "upload_if_needed",
    "send_message",
    "wait_reply_done",
    "copy_last_reply",
    "send_system_hotkey",
    "verify_hotkey_result",
    "finish",
]

STEP_TO_TASK_PHASE: Dict[str, str] = {
    "preflight_page": TaskPhase.PREFLIGHT,
    "upload_if_needed": TaskPhase.UPLOADING,
    "send_message": TaskPhase.SENDING,
    "wait_reply_done": TaskPhase.WAITING_REPLY,
    "copy_last_reply": TaskPhase.COPYING,
    "send_system_hotkey": TaskPhase.HOTKEY_SENDING,
    "verify_hotkey_result": TaskPhase.HOTKEY_SENDING,
    "finish": TaskPhase.SUCCESS,
}


@dataclass
class TaskStep:
    step_id: str
    action: str
    index: int = 0


BUSY_RESPONSE_STATES_FOR_ACTION_MODEL = {
    "responding",
    "generating",
    "streaming",
    "assistant_busy",
    "busy",
}


@dataclass
class PageSnapshot:
    client_id: str = ""
    page_instance_id: str = ""
    conversation_id: str = ""
    url: str = ""
    response_state: str = ""
    is_responding: bool = False
    can_send_now: bool = False
    can_accept_input: bool = False
    visibility_state: str = ""
    has_focus: bool = False
    extra: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Any) -> "PageSnapshot":
        if not isinstance(data, dict):
            return cls()
        response_state = str(data.get("response_state") or "").strip().lower()
        if not response_state:
            response_state = "unknown"
        legacy_is_responding = bool(data.get("is_responding"))
        derived_is_responding = (
            response_state in BUSY_RESPONSE_STATES_FOR_ACTION_MODEL
            or (
                response_state == "unknown"
                and legacy_is_responding
            )
        )
        return cls(
            client_id=str(data.get("client_id") or "").strip(),
            page_instance_id=str(data.get("page_instance_id") or "").strip(),
            conversation_id=str(data.get("conversation_id") or "").strip(),
            url=str(data.get("url") or "").strip(),
            response_state=response_state,
            is_responding=derived_is_responding,
            can_send_now=bool(
                data.get(
                    "can_send_now",
                    data.get("send_now_available", False),
                )
            ),
            can_accept_input=bool(
                data.get(
                    "can_accept_input",
                    data.get("inputable", False),
                )
            ),
            visibility_state=str(data.get("visibility_state") or "").strip(),
            has_focus=bool(data.get("has_focus")),
            extra={
                k: v
                for k, v in data.items()
                if k
                not in {
                    "client_id",
                    "page_instance_id",
                    "conversation_id",
                    "url",
                    "response_state",
                    "is_responding",
                    "can_send_now",
                    "send_now_available",
                    "can_accept_input",
                    "inputable",
                    "visibility_state",
                    "has_focus",
                }
            },
        )


@dataclass
class StepResult:
    run_id: str
    step_id: str
    ok: bool
    error: str = ""
    page_snapshot: Optional[PageSnapshot] = None
    detail: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Any) -> "StepResult":
        if not isinstance(data, dict):
            return cls(run_id="", step_id="", ok=False, error="invalid_payload")
        snap_raw = data.get("page_snapshot")
        return cls(
            run_id=str(data.get("run_id") or "").strip(),
            step_id=str(data.get("step_id") or "").strip(),
            ok=bool(data.get("ok")),
            error=str(data.get("error") or "").strip(),
            page_snapshot=PageSnapshot.from_dict(snap_raw)
            if isinstance(snap_raw, dict)
            else None,
            detail=dict(data.get("detail") or {}) if isinstance(data.get("detail"), dict) else {},
        )


@dataclass
class TaskRun:
    run_id: str
    task_type: str
    phase: str = TaskPhase.IDLE
    owner_button_id: str = ""
    page_instance_id: str = ""
    conversation_id: str = ""
    client_id: str = ""
    steps: List[str] = field(default_factory=list)
    current_step_index: int = -1
    started_at: float = 0.0
    updated_at: float = 0.0
    cancel_requested: bool = False
    error: str = ""
    payload: Dict[str, Any] = field(default_factory=dict)
    last_page_snapshot: Optional[PageSnapshot] = None
    pending_step_id: str = ""
    pending_message_id: str = ""
    hotkey_result: Optional[Dict[str, Any]] = None
    copied_text_len: int = 0

    def current_step_name(self) -> str:
        if self.current_step_index < 0 or self.current_step_index >= len(self.steps):
            return ""
        return self.steps[self.current_step_index]
