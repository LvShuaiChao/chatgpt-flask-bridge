"""GUI ↔ 油猴动作编排桥接协议（命令 / 结果字段）。"""
from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

ORCH_COMMAND_NAME = "orch_action"
ORCH_REPORT_STEP_RESULT = "orch_step_result"
ORCH_REPORT_TASK_REQUEST = "orch_task_request"
ORCH_REPORT_TASK_CANCEL = "orch_task_cancel"

ORCH_LOG_TAGS = (
    "[ORCH][TASK_START]",
    "[ORCH][STEP_START]",
    "[ORCH][STEP_RESULT]",
    "[ORCH][TASK_FINISH]",
    "[ORCH][TASK_CANCEL]",
    "[ORCH][TASK_FAIL]",
    "[BRIDGE_CMD][SEND]",
    "[BRIDGE_RESULT][RECV]",
)

TM_ATOMIC_ACTIONS = frozenset(
    {
        "detect_page_state",
        "detect_composer_state",
        "preflight_page",
        "upload_files",
        "upload_if_needed",
        "send_message",
        "wait_reply_state_once",
        "wait_reply_done",
        "copy_last_assistant_message",
        "copy_last_reply",
    }
)

GUI_ONLY_STEPS = frozenset(
    {
        "send_system_hotkey",
        "verify_hotkey_result",
        "finish",
    }
)

STEP_TO_ATOMIC_ACTION: Dict[str, str] = {
    "preflight_page": "preflight_page",
    "upload_if_needed": "upload_files",
    "send_message": "send_message",
    "wait_reply_done": "wait_reply_state_once",
    "copy_last_reply": "copy_last_assistant_message",
}


def new_run_id(prefix: str = "orch") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def new_step_id(run_id: str, step_name: str) -> str:
    return f"{run_id}:{step_name}"


def build_orch_command(
    *,
    run_id: str,
    step_id: str,
    action: str,
    page_instance_id: str = "",
    conversation_id: str = "",
    client_id: str = "",
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    atomic = STEP_TO_ATOMIC_ACTION.get(action, action)
    return {
        "run_id": run_id,
        "step_id": step_id,
        "action": atomic,
        "step": action,
        "page_instance_id": page_instance_id,
        "conversation_id": conversation_id,
        "client_id": client_id,
        "payload": dict(payload or {}),
    }


def parse_step_result_payload(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    return {
        "run_id": str(payload.get("run_id") or "").strip(),
        "step_id": str(payload.get("step_id") or "").strip(),
        "ok": bool(payload.get("ok")),
        "error": str(payload.get("error") or "").strip(),
        "page_snapshot": payload.get("page_snapshot")
        if isinstance(payload.get("page_snapshot"), dict)
        else {},
        "detail": payload.get("detail") if isinstance(payload.get("detail"), dict) else {},
    }
