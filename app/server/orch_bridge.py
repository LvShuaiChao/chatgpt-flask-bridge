"""动作编排桥接：控制命令入队与 report 事件处理。"""
from __future__ import annotations

import traceback
from typing import Any, Dict

from app.core.action_models import StepResult
from app.core.action_orchestrator import get_action_orchestrator
from app.core.bridge_protocol import (
    ORCH_COMMAND_NAME,
    ORCH_REPORT_STEP_RESULT,
    ORCH_REPORT_TASK_CANCEL,
    ORCH_REPORT_TASK_REQUEST,
    parse_step_result_payload,
)
from app.server.control_commands import _queue_control_message
from app.server.runtime_state import _log, _notify_status
from app.server.message_queue import _add_inbound
from app.utils.bridge_payload import read_bridge_client_id, read_bridge_page_instance_id


def push_orch_action_command(cmd: Dict[str, Any]) -> bool:
    """向油猴 poll 队列投递单步原子动作命令。"""
    if not isinstance(cmd, dict):
        return False
    client_id = str(cmd.get("client_id") or "").strip()
    if not client_id:
        _log("[ORCH][BRIDGE_CMD][SKIP] missing client_id")
        return False
    page_instance_id = str(cmd.get("page_instance_id") or "").strip()
    conversation_id = str(cmd.get("conversation_id") or "").strip()
    extra: Dict[str, Any] = {
        "client_id": client_id,
        "payload": {"orch": cmd},
    }
    if page_instance_id:
        extra["page_instance_id"] = page_instance_id
    if conversation_id:
        extra["conversation_id"] = conversation_id
    msg = _queue_control_message(
        ORCH_COMMAND_NAME,
        log_label="orch_action",
        **extra,
    )
    return bool(msg)


def handle_orch_bridge_report(event: str, body: Dict[str, Any], payload: Any) -> bool:
    """处理油猴 report 编排事件；返回 True 表示已消费。"""
    event = (event or "").strip()
    if event not in (
        ORCH_REPORT_STEP_RESULT,
        ORCH_REPORT_TASK_REQUEST,
        ORCH_REPORT_TASK_CANCEL,
    ):
        return False

    client_id = read_bridge_client_id(body)
    page_instance_id = read_bridge_page_instance_id(body)
    if not isinstance(payload, dict):
        payload = {}

    if event == ORCH_REPORT_STEP_RESULT:
        parsed = parse_step_result_payload(payload)
        result = StepResult.from_dict(parsed)
        if not result.run_id:
            result.run_id = str(payload.get("run_id") or "").strip()
        _log(
            f"[BRIDGE_RESULT][RECV] run_id={result.run_id or '-'} "
            f"step_id={result.step_id or '-'} ok={int(result.ok)} "
            f"error={result.error or '-'}"
        )
        _add_inbound(
            ORCH_REPORT_STEP_RESULT,
            parsed,
            client_id=client_id,
        )
        _notify_status()
        return True

    if event == ORCH_REPORT_TASK_REQUEST:
        task_payload = dict(payload)
        task_payload.setdefault("client_id", client_id)
        task_payload.setdefault("page_instance_id", page_instance_id)
        _add_inbound(ORCH_REPORT_TASK_REQUEST, task_payload, client_id=client_id)
        _notify_status()
        return True

    if event == ORCH_REPORT_TASK_CANCEL:
        cancel_payload = dict(payload)
        cancel_payload.setdefault("client_id", client_id)
        _add_inbound(ORCH_REPORT_TASK_CANCEL, cancel_payload, client_id=client_id)
        _notify_status()
        return True

    return False


def configure_orchestrator_enqueue() -> None:
    orch = get_action_orchestrator()
    orch.set_enqueue_command(push_orch_action_command)
