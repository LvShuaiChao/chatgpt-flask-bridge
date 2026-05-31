"""ActionOrchestrator 第一阶段单元测试。"""
from __future__ import annotations

from app.core.action_models import StepResult, TaskPhase
from app.core.action_orchestrator import ActionOrchestrator


def test_start_send_copy_hotkey_task():
    orch = ActionOrchestrator()
    logs = []
    orch.set_logger(lambda line, echo=False: logs.append(line))
    orch.set_enqueue_command(lambda cmd: True)

    result = orch.start_task(
        "send_copy_hotkey_once",
        {
            "client_id": "tm-test",
            "page_instance_id": "page-1",
            "owner_button_id": "cgpt-send-copy-hotkey-once",
            "hotkey_combo": "ctrl+enter",
        },
    )
    assert result["ok"] is True
    assert any("[ORCH][TASK_START]" in line for line in logs)
    view = orch.get_button_view_state("cgpt-send-copy-hotkey-once")
    assert view.get("active") is True
    assert view.get("source") == "gui-orch"


def test_on_step_result_advances():
    orch = ActionOrchestrator()
    orch.set_enqueue_command(lambda cmd: True)
    started = orch.start_task(
        "send_copy_hotkey_once",
        {"client_id": "tm-test", "page_instance_id": "page-1"},
    )
    run_id = started["run_id"]
    run = orch._runs[run_id]
    first_step = run.steps[0]
    orch.on_step_result(
        StepResult(
            run_id=run_id,
            step_id=f"{run_id}:{first_step}",
            ok=True,
        )
    )
    assert run.current_step_index == 1


def test_cancel_task():
    orch = ActionOrchestrator()
    orch.set_enqueue_command(lambda cmd: True)
    started = orch.start_task(
        "send_copy_hotkey_once",
        {"client_id": "tm-test"},
    )
    run_id = started["run_id"]
    cancel = orch.cancel_task(run_id=run_id)
    assert cancel["ok"] is True
    assert orch._runs[run_id].phase == TaskPhase.CANCELLED
