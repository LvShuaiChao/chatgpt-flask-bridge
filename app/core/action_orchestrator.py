"""GUI 侧统一动作编排器（第一阶段：send_copy_hotkey_once）。"""
from __future__ import annotations

import time
import traceback
import uuid
from typing import Any, Callable, Dict, List, Optional

from app.core.action_models import (
    SEND_COPY_HOTKEY_ONCE_STEPS,
    STEP_TO_TASK_PHASE,
    PageSnapshot,
    StepResult,
    TaskPhase,
    TaskRun,
)
from app.core.bridge_protocol import (
    GUI_ONLY_STEPS,
    STEP_TO_ATOMIC_ACTION,
    build_orch_command,
    new_run_id,
    new_step_id,
)

LogFn = Callable[[str, bool], None]
HotkeyFn = Callable[[str, str], Dict[str, Any]]
EnqueueCmdFn = Callable[[Dict[str, Any]], bool]


class ActionOrchestrator:
  """唯一权威任务状态源；油猴仅执行原子步骤。"""

  TASK_SEND_COPY_HOTKEY = "send_copy_hotkey_once"
  OWNER_SEND_COPY_HOTKEY = "cgpt-send-copy-hotkey-once"

  def __init__(self) -> None:
    self._runs: Dict[str, TaskRun] = {}
    self._runs_by_button: Dict[str, str] = {}
    self._log: LogFn = lambda line, echo=False: None
    self._enqueue_command: Optional[EnqueueCmdFn] = None
    self._hotkey_executor: Optional[HotkeyFn] = None
    self._enabled = True

  def set_logger(self, log_fn: LogFn) -> None:
    self._log = log_fn

  def set_enqueue_command(self, fn: EnqueueCmdFn) -> None:
    self._enqueue_command = fn

  def set_hotkey_executor(self, fn: HotkeyFn) -> None:
    self._hotkey_executor = fn

  def set_enabled(self, enabled: bool) -> None:
    self._enabled = bool(enabled)

  def is_enabled(self) -> bool:
    return self._enabled

  def _orch_log(self, tag: str, line: str, *, echo: bool = False) -> None:
    text = f"{tag} {line}".strip()
    self._log(text, echo)

  def start_task(self, task_type: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = dict(payload or {})
    if not self._enabled:
      return {"ok": False, "error": "orchestrator_disabled", "legacy": True}

    task_type = (task_type or "").strip()
    if task_type != self.TASK_SEND_COPY_HOTKEY:
      return {"ok": False, "error": f"unsupported_task_type:{task_type}"}

    owner_button_id = (
      payload.get("owner_button_id") or self.OWNER_SEND_COPY_HOTKEY
    ).strip()
    client_id = (payload.get("client_id") or "").strip()
    page_instance_id = (payload.get("page_instance_id") or "").strip()
    conversation_id = (payload.get("conversation_id") or "").strip()

    existing_run_id = self._runs_by_button.get(owner_button_id)
    if existing_run_id:
      existing = self._runs.get(existing_run_id)
      if existing and existing.phase not in (
        TaskPhase.IDLE,
        TaskPhase.SUCCESS,
        TaskPhase.FAILED,
        TaskPhase.CANCELLED,
      ):
        return {
          "ok": False,
          "error": "task_already_running",
          "run_id": existing_run_id,
        }

    run_id = (payload.get("run_id") or "").strip() or new_run_id("sch")
    now = time.time()
    run = TaskRun(
      run_id=run_id,
      task_type=task_type,
      phase=TaskPhase.PREFLIGHT,
      owner_button_id=owner_button_id,
      page_instance_id=page_instance_id,
      conversation_id=conversation_id,
      client_id=client_id,
      steps=list(SEND_COPY_HOTKEY_ONCE_STEPS),
      current_step_index=0,
      started_at=now,
      updated_at=now,
      payload=payload,
    )
    self._runs[run_id] = run
    self._runs_by_button[owner_button_id] = run_id
    self._orch_log(
      "[ORCH][TASK_START]",
      f"run_id={run_id} task_type={task_type} owner={owner_button_id} "
      f"client_id={client_id or '-'} page_instance_id={page_instance_id or '-'} "
      f"source={payload.get('source') or '-'} flow=gui-orch",
      echo=True,
    )
    self._advance_run(run)
    return {"ok": True, "run_id": run_id, "flow": "gui-orch"}

  def cancel_task(self, run_id: str = "", *, owner_button_id: str = "") -> Dict[str, Any]:
    run = self._resolve_run(run_id=run_id, owner_button_id=owner_button_id)
    if not run:
      return {"ok": False, "error": "run_not_found"}
    run.cancel_requested = True
    run.phase = TaskPhase.CANCELLED
    run.updated_at = time.time()
    run.error = "cancelled"
    self._orch_log(
      "[ORCH][TASK_CANCEL]",
      f"run_id={run.run_id} owner={run.owner_button_id} flow=gui-orch",
      echo=True,
    )
    self._finish_run(run, ok=False, reason="cancelled")
    return {"ok": True, "run_id": run.run_id}

  def on_step_result(self, result: StepResult) -> None:
    run = self._runs.get(result.run_id)
    if not run:
      self._orch_log(
        "[ORCH][STEP_RESULT]",
        f"run_id={result.run_id} step_id={result.step_id} ignored=unknown_run",
      )
      return
    run.pending_step_id = ""
    run.pending_message_id = ""
    run.updated_at = time.time()
    if result.page_snapshot:
      run.last_page_snapshot = result.page_snapshot
      if result.page_snapshot.client_id:
        run.client_id = result.page_snapshot.client_id
      if result.page_snapshot.page_instance_id:
        run.page_instance_id = result.page_snapshot.page_instance_id
      if result.page_snapshot.conversation_id:
        run.conversation_id = result.page_snapshot.conversation_id

    self._orch_log(
      "[ORCH][STEP_RESULT]",
      f"run_id={run.run_id} step_id={result.step_id} ok={int(result.ok)} "
      f"error={result.error or '-'} flow=gui-orch",
      echo=not result.ok,
    )
    self._orch_log("[BRIDGE_RESULT][RECV]", f"run_id={run.run_id} step_id={result.step_id}")

    if run.cancel_requested:
      self._finish_run(run, ok=False, reason="cancelled")
      return

    if not result.ok:
      run.phase = TaskPhase.FAILED
      run.error = result.error or "step_failed"
      self._orch_log(
        "[ORCH][TASK_FAIL]",
        f"run_id={run.run_id} step_id={result.step_id} error={run.error}",
        echo=True,
      )
      self._finish_run(run, ok=False, reason=run.error)
      return

    detail = result.detail or {}
    if run.current_step_name() == "copy_last_reply":
      run.copied_text_len = int(detail.get("text_len") or detail.get("copied_len") or 0)

    run.current_step_index += 1
    self._advance_run(run)

  def on_page_snapshot(self, snapshot: PageSnapshot) -> None:
    for run in list(self._runs.values()):
      if run.phase in (TaskPhase.SUCCESS, TaskPhase.FAILED, TaskPhase.CANCELLED):
        continue
      if snapshot.client_id and run.client_id and snapshot.client_id != run.client_id:
        continue
      if (
        snapshot.page_instance_id
        and run.page_instance_id
        and snapshot.page_instance_id != run.page_instance_id
      ):
        continue
      run.last_page_snapshot = snapshot
      run.updated_at = time.time()

  def tick(self) -> None:
    now = time.time()
    for run in list(self._runs.values()):
      if run.phase in (TaskPhase.SUCCESS, TaskPhase.FAILED, TaskPhase.CANCELLED):
        continue
      if run.cancel_requested:
        continue
      if now - run.started_at > 600:
        run.phase = TaskPhase.FAILED
        run.error = "task_timeout"
        self._orch_log(
          "[ORCH][TASK_FAIL]",
          f"run_id={run.run_id} error=task_timeout",
          echo=True,
        )
        self._finish_run(run, ok=False, reason="task_timeout")

  def get_button_view_state(self, button_id: str) -> Dict[str, Any]:
    button_id = (button_id or "").strip()
    run_id = self._runs_by_button.get(button_id)
    if not run_id:
      return {"source": "gui-orch", "active": False}
    run = self._runs.get(run_id)
    if not run:
      return {"source": "gui-orch", "active": False}

    phase = run.phase
    step = run.current_step_name()
    text = self._phase_button_text(phase, step)
    allow_cancel = phase not in (
      TaskPhase.IDLE,
      TaskPhase.SUCCESS,
      TaskPhase.FAILED,
      TaskPhase.CANCELLED,
    )
    active = allow_cancel
    return {
      "source": "gui-orch",
      "active": active,
      "phase": phase,
      "text": text,
      "title": "点击停止（GUI 编排）" if allow_cancel else text,
      "disabled": False,
      "allowCancel": allow_cancel,
      "action": "cancel-send-copy-hotkey" if allow_cancel else "send-copy-hotkey",
      "runtimeAction": "cancel-send-copy-hotkey" if allow_cancel else "",
      "buttonPhase": "running" if active else "idle",
      "taskKey": "send-copy-hotkey",
      "ownerButtonId": button_id,
      "runId": run.run_id,
    }

  def orch_runtime_patch(self, client_id: str = "", page_instance_id: str = "") -> Dict[str, Any]:
    button_views: Dict[str, Any] = {}
    active_runs: List[Dict[str, Any]] = []
    client_id = (client_id or "").strip()
    page_instance_id = (page_instance_id or "").strip()
    for run in self._runs.values():
      if client_id and run.client_id and run.client_id != client_id:
        continue
      if page_instance_id and run.page_instance_id and run.page_instance_id != page_instance_id:
        continue
      if run.phase in (TaskPhase.SUCCESS, TaskPhase.FAILED, TaskPhase.CANCELLED):
        continue
      active_runs.append(
        {
          "run_id": run.run_id,
          "task_type": run.task_type,
          "phase": run.phase,
          "owner_button_id": run.owner_button_id,
          "current_step": run.current_step_name(),
        }
      )
      if run.owner_button_id:
        button_views[run.owner_button_id] = self.get_button_view_state(run.owner_button_id)
    return {
      "orch_enabled": self._enabled,
      "orch_button_views": button_views,
      "orch_active_runs": active_runs,
    }

  def _resolve_run(
    self, *, run_id: str = "", owner_button_id: str = ""
  ) -> Optional[TaskRun]:
    run_id = (run_id or "").strip()
    owner_button_id = (owner_button_id or "").strip()
    if run_id:
      return self._runs.get(run_id)
    if owner_button_id:
      rid = self._runs_by_button.get(owner_button_id)
      return self._runs.get(rid) if rid else None
    return None

  def _phase_button_text(self, phase: str, step: str) -> str:
    mapping = {
      TaskPhase.PREFLIGHT: "准备页面…",
      TaskPhase.UPLOADING: "上传附件…",
      TaskPhase.SENDING: "发送中…",
      TaskPhase.WAITING_REPLY: "等待回复…",
      TaskPhase.COPYING: "复制回复…",
      TaskPhase.HOTKEY_SENDING: "发送快捷键…",
      TaskPhase.SUCCESS: "发送+复制+快捷键",
      TaskPhase.FAILED: "失败（编排）",
      TaskPhase.CANCELLED: "已取消",
    }
    if phase in mapping:
      return mapping[phase]
    if step == "wait_reply_done":
      return "等待回复…"
    return "发送+复制+快捷键…"

  def _advance_run(self, run: TaskRun) -> None:
    if run.cancel_requested:
      self._finish_run(run, ok=False, reason="cancelled")
      return
    while run.current_step_index < len(run.steps):
      step_name = run.steps[run.current_step_index]
      run.phase = STEP_TO_TASK_PHASE.get(step_name, run.phase)
      run.updated_at = time.time()
      if step_name in GUI_ONLY_STEPS:
        handled = self._execute_gui_step(run, step_name)
        if not handled:
          return
        run.current_step_index += 1
        continue
      self._dispatch_tm_step(run, step_name)
      return
    self._finish_run(run, ok=True, reason="done")

  def _dispatch_tm_step(self, run: TaskRun, step_name: str) -> None:
    if not self._enqueue_command:
      run.phase = TaskPhase.FAILED
      run.error = "enqueue_not_configured"
      self._finish_run(run, ok=False, reason=run.error)
      return
    step_id = new_step_id(run.run_id, step_name)
    run.pending_step_id = step_id
    cmd = build_orch_command(
      run_id=run.run_id,
      step_id=step_id,
      action=step_name,
      page_instance_id=run.page_instance_id,
      conversation_id=run.conversation_id,
      client_id=run.client_id,
      payload={
        "owner_button_id": run.owner_button_id,
        "task_type": run.task_type,
        "hotkey_combo": (run.payload or {}).get("hotkey_combo") or "",
        "source": (run.payload or {}).get("source") or "",
      },
    )
    self._orch_log(
      "[ORCH][STEP_START]",
      f"run_id={run.run_id} step_id={step_id} action={cmd.get('action')} "
      f"step={step_name} flow=gui-orch",
    )
    self._orch_log(
      "[BRIDGE_CMD][SEND]",
      f"run_id={run.run_id} step_id={step_id} action={cmd.get('action')}",
    )
    ok = bool(self._enqueue_command(cmd))
    if not ok:
      run.phase = TaskPhase.FAILED
      run.error = "bridge_enqueue_failed"
      self._finish_run(run, ok=False, reason=run.error)

  def _execute_gui_step(self, run: TaskRun, step_name: str) -> bool:
    try:
      if step_name == "send_system_hotkey":
        combo = str((run.payload or {}).get("hotkey_combo") or "").strip()
        if not combo:
          run.phase = TaskPhase.FAILED
          run.error = "hotkey_combo_empty"
          self._finish_run(run, ok=False, reason=run.error)
          return False
        if not self._hotkey_executor:
          run.phase = TaskPhase.FAILED
          run.error = "hotkey_executor_missing"
          self._finish_run(run, ok=False, reason=run.error)
          return False
        result = self._hotkey_executor(combo, f"orch:{run.run_id}")
        run.hotkey_result = dict(result or {})
        if not result or not result.get("ok"):
          run.phase = TaskPhase.FAILED
          run.error = str((result or {}).get("error") or "hotkey_failed")
          self._finish_run(run, ok=False, reason=run.error)
          return False
        return True

      if step_name == "verify_hotkey_result":
        result = run.hotkey_result or {}
        if not result.get("ok"):
          run.phase = TaskPhase.FAILED
          run.error = "hotkey_verify_failed"
          self._finish_run(run, ok=False, reason=run.error)
          return False
        return True

      if step_name == "finish":
        return True
    except Exception as exc:
      detail = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
      self._orch_log(
        "[ORCH][TASK_FAIL]",
        f"run_id={run.run_id} step={step_name} error={detail}",
        echo=True,
      )
      run.phase = TaskPhase.FAILED
      run.error = str(exc)
      self._finish_run(run, ok=False, reason=run.error)
      return False
    return True

  def _finish_run(self, run: TaskRun, *, ok: bool, reason: str) -> None:
    run.updated_at = time.time()
    if ok:
      run.phase = TaskPhase.SUCCESS
      self._orch_log(
        "[ORCH][TASK_FINISH]",
        f"run_id={run.run_id} owner={run.owner_button_id} reason={reason} flow=gui-orch",
        echo=True,
      )
    else:
      if run.phase != TaskPhase.CANCELLED:
        run.phase = TaskPhase.FAILED
      if not run.error:
        run.error = reason
    run.pending_step_id = ""
    run.pending_message_id = ""
    run.current_step_index = len(run.steps)


_orchestrator_singleton: Optional[ActionOrchestrator] = None


def get_action_orchestrator() -> ActionOrchestrator:
  global _orchestrator_singleton
  if _orchestrator_singleton is None:
    _orchestrator_singleton = ActionOrchestrator()
  return _orchestrator_singleton


def orch_runtime_patch_for_poll(body: Any) -> Dict[str, Any]:
  if not isinstance(body, dict):
    return {}
  client_id = str(body.get("client_id") or "").strip()
  page_instance_id = str(body.get("page_instance_id") or "").strip()
  orch = get_action_orchestrator()
  if not orch.is_enabled():
    return {"orch_enabled": False}
  return orch.orch_runtime_patch(client_id, page_instance_id)
