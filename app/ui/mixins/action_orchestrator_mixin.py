"""GUI 动作编排 Mixin：连接 ActionOrchestrator 与桥接 inbound。"""
from __future__ import annotations

from app.core.action_models import PageSnapshot, StepResult
from app.core.action_orchestrator import get_action_orchestrator
from app.core.bridge_protocol import (
    ORCH_REPORT_STEP_RESULT,
    ORCH_REPORT_TASK_CANCEL,
    ORCH_REPORT_TASK_REQUEST,
)
from app.server.orch_bridge import configure_orchestrator_enqueue


class ActionOrchestratorMixin:
    def _init_action_orchestrator(self) -> None:
        orch = get_action_orchestrator()
        orch.set_logger(self._append_log)
        orch.set_hotkey_executor(self._orch_execute_hotkey)
        configure_orchestrator_enqueue()
        if not hasattr(self, "_orch_tick_timer"):
            from PyQt5.QtCore import QTimer

            self._orch_tick_timer = QTimer(self)
            self._orch_tick_timer.setInterval(500)
            self._orch_tick_timer.timeout.connect(self._orch_tick)
            self._orch_tick_timer.start()

    def _orch_execute_hotkey(self, combo: str, source: str) -> dict:
        return self._execute_system_hotkey_from_gui_payload(
            {"combo": combo},
            source=source or "orch",
        )

    def _orch_tick(self) -> None:
        get_action_orchestrator().tick()

    def _handle_orch_inbound_event(self, item, payload) -> bool:
        kind = (item.get("kind") or "").strip()
        if kind == ORCH_REPORT_STEP_RESULT:
            result = StepResult.from_dict(payload)
            get_action_orchestrator().on_step_result(result)
            return True
        if kind == ORCH_REPORT_TASK_REQUEST:
            task_type = (payload.get("task_type") or "").strip()
            result = get_action_orchestrator().start_task(task_type, payload)
            if not result.get("ok"):
                self._append_log(
                    f"[ORCH][TASK_START][REJECTED] task_type={task_type} "
                    f"error={result.get('error') or '-'} flow=gui-orch",
                    echo=True,
                )
            return True
        if kind == ORCH_REPORT_TASK_CANCEL:
            get_action_orchestrator().cancel_task(
                run_id=str(payload.get("run_id") or "").strip(),
                owner_button_id=str(payload.get("owner_button_id") or "").strip(),
            )
            return True
        return False

    def _orch_get_button_view(self, button_id: str) -> dict:
        return get_action_orchestrator().get_button_view_state(button_id)

    def _orch_start_send_copy_hotkey(self, payload: dict) -> dict:
        data = dict(payload or {})
        data.setdefault("owner_button_id", "cgpt-send-copy-hotkey-once")
        return get_action_orchestrator().start_task("send_copy_hotkey_once", data)

    def _orch_cancel_send_copy_hotkey(self, *, run_id: str = "", owner_button_id: str = "") -> dict:
        return get_action_orchestrator().cancel_task(
            run_id=run_id,
            owner_button_id=owner_button_id or "cgpt-send-copy-hotkey-once",
        )
