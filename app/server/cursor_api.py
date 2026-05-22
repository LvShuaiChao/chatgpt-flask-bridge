"""Cursor bridge task queue (non-HTTP)."""
from __future__ import annotations

import time

from app.server import state as st
from app.server.runtime_state import _format_time, _log, _now

def _cursor_now_ts():
    return time.time()


def _cursor_safe_text(value):
    return str(value or "").strip()


def enqueue_cursor_task(task):
    """
    将 Python GUI 创建的 Cursor 任务加入队列。
    Cursor 插件通过 /api/cursor/tasks/next 拉取。
    """
    if not isinstance(task, dict):
        _log("[CURSOR_BRIDGE][TASK_CREATE_FAILED] reason=task_not_dict")
        return False, "task must be dict"

    task_id = _cursor_safe_text(task.get("task_id"))
    command = _cursor_safe_text(task.get("command")) or "send_message"
    if command not in ("send_message", "new_chat", "new_chat_and_send"):
        command = "send_message"
    task["command"] = command

    content_raw = task.get("content")
    if command != "new_chat":
        if content_raw is None or not str(content_raw).strip():
            if not task_id:
                task_id = f"cursor_task_{int(time.time())}_{uuid.uuid4().hex[:8]}"
            _log(
                "[CURSOR_BRIDGE][TASK_CREATE_FAILED] "
                f"task_id={task_id} command={command} reason=empty_content"
            )
            return False, "content is empty"

    if not task_id:
        task_id = f"cursor_task_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        task["task_id"] = task_id

    task.setdefault("type", "cursor_agent_prompt")
    task.setdefault("command", "send_message")
    task.setdefault("delivery_mode", task.get("mode") or "auto_send")
    task.setdefault("mode", task.get("delivery_mode") or "auto_send")
    task.setdefault("prompt_mode", "raw")
    task.setdefault("submit_mode", "enter")
    task.setdefault("title", "Cursor Bridge 任务")
    task.setdefault("files", [])
    task.setdefault("target", "agent")

    delivery_mode = task.get("delivery_mode") or task.get("mode") or "auto_send"
    if delivery_mode == "auto_send":
        task["delivery_mode"] = "auto_send"
        task["mode"] = "auto_send"
        task["require_confirm"] = False
    else:
        task["delivery_mode"] = "manual_confirm"
        task["mode"] = "manual_confirm"
        task.setdefault("require_confirm", True)

    task.setdefault("created_at", time.strftime("%Y-%m-%d %H:%M:%S"))
    task.setdefault("updated_at", _cursor_now_ts())
    task.setdefault("status", "queued")

    with st.cursor_task_lock:
        st.cursor_task_queue.append(task)
        st.cursor_task_history.append({
            "task_id": task_id,
            "title": task.get("title") or "",
            "status": "queued",
            "created_at": task.get("created_at") or "",
            "updated_at": task.get("updated_at") or _cursor_now_ts(),
        })

    _log(
        "[CURSOR_BRIDGE][TASK_CREATE] "
        f"task_id={task_id} "
        f"title={task.get('title') or '-'} "
        f"delivery_mode={task.get('delivery_mode') or '-'} "
        f"prompt_mode={task.get('prompt_mode') or '-'} "
        f"submit_mode={task.get('submit_mode') or '-'} "
        f"mode={task.get('mode') or '-'} "
        f"require_confirm={task.get('require_confirm')}"
    )
    _notify_status()
    return True, task_id


def claim_next_cursor_task(client=""):
    """Cursor 插件领取下一条任务。"""
    with st.cursor_task_lock:
        if not st.cursor_task_queue:
            return None

        task = st.cursor_task_queue.popleft()
        task["status"] = "claimed"
        task["claimed_at"] = _cursor_now_ts()
        task["claimed_by"] = _cursor_safe_text(client) or "cursor-extension"

        st.cursor_client_state["last_task_claim_at"] = _cursor_now_ts()
        st.cursor_client_state["last_task_id"] = task.get("task_id") or ""

    _log(
        "[CURSOR_BRIDGE][TASK_CLAIM] "
        f"task_id={task.get('task_id') or '-'} "
        f"client={client or '-'}"
    )
    _notify_status()
    return task


def append_cursor_task_report(report):
    """保存 Cursor 插件回报。"""
    if not isinstance(report, dict):
        _log("[CURSOR_BRIDGE][REPORT_FAILED] reason=report_not_dict")
        return False, "report must be dict"

    task_id = _cursor_safe_text(report.get("task_id"))
    status = _cursor_safe_text(report.get("status"))
    message = _cursor_safe_text(report.get("message"))

    if not task_id:
        _log("[CURSOR_BRIDGE][REPORT_FAILED] reason=empty_task_id")
        return False, "task_id is empty"

    report.setdefault("updated_at", _cursor_now_ts())

    with st.cursor_task_lock:
        st.cursor_task_reports.append(report)
        st.cursor_client_state["last_report_at"] = _cursor_now_ts()
        st.cursor_client_state["last_report_status"] = status
        st.cursor_client_state["last_report_message"] = message

    _log(
        "[CURSOR_BRIDGE][REPORT] "
        f"task_id={task_id} "
        f"status={status or '-'} "
        f"message={message or '-'}"
    )
    try:
        _job_scheduler.handle_cursor_task_report(report)
    except Exception as exc:
        _log(
            "[JOB][CURSOR_REPORT_SYNC_FAILED] "
            f"task_id={task_id} error={exc}\n{traceback.format_exc()}"
        )
    _notify_status()
    return True, "ok"


def update_cursor_client_heartbeat(payload):
    """
    Cursor 插件心跳。
    插件启动 Python Bridge 后，应每 5 秒调用一次。
    """
    if not isinstance(payload, dict):
        _log("[CURSOR_BRIDGE][HEARTBEAT_FAILED] reason=payload_not_dict")
        return False, "payload must be dict"

    client_id = _cursor_safe_text(payload.get("client_id")) or "cursor-extension"
    name = _cursor_safe_text(payload.get("name")) or "Cursor Extension"
    version = _cursor_safe_text(payload.get("version"))
    now = _cursor_now_ts()

    with st.cursor_task_lock:
        st.cursor_client_state.update({
            "client_id": client_id,
            "name": name,
            "version": version,
            "status": "online",
            "last_seen": now,
            "last_seen_text": time.strftime("%Y-%m-%d %H:%M:%S"),
        })

    _log(
        "[CURSOR_BRIDGE][HEARTBEAT] "
        f"client_id={client_id} "
        f"name={name} "
        f"version={version or '-'}"
    )
    _notify_status()
    return True, "ok"


def get_cursor_bridge_status():
    """
    返回 Cursor Bridge 当前状态。
    Python GUI 顶部状态栏用这个函数刷新 Cursor 在线状态。
    """
    now = _cursor_now_ts()

    with st.cursor_task_lock:
        state = dict(st.cursor_client_state)
        pending_count = len(st.cursor_task_queue)
        reports = list(st.cursor_task_reports)[-20:]
        history = list(st.cursor_task_history)[-20:]

    last_seen = float(state.get("last_seen") or 0.0)
    age = now - last_seen if last_seen > 0 else None

    if last_seen <= 0:
        online = False
        status = "never_seen"
    elif age is not None and age <= CURSOR_ONLINE_TIMEOUT_SEC:
        online = True
        status = "online"
    else:
        online = False
        status = "offline"

    state["online"] = online
    state["status"] = status
    state["age_seconds"] = age
    state["pending_count"] = pending_count
    state["reports"] = reports
    state["history"] = history

    return state
