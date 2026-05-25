"""旧版 ChatGPT -> Cursor 自动任务调度（孤儿模块候选）。"""

# @deprecated-candidate
# 当前源码中未发现 app.core.job_scheduler 的真实业务 import。
# 该模块疑似旧版 ChatGPT -> Cursor 自动任务调度残留。
# 暂保留一个版本观察；若确认没有 UI、server route、外部脚本依赖，再整文件删除。

import threading
import time
import traceback
import uuid
from collections import deque

from app.cursor_code.runtime import (
    get_cursor_code_pause_reason,
    is_cursor_code_paused,
)

job_queue = deque()
job_map = {}
job_lock = threading.RLock()
cursor_task_to_job = {}

JOB_STATUSES = frozenset({
    "created",
    "queued_chatgpt",
    "sent_to_chatgpt",
    "waiting_chatgpt_reply",
    "chatgpt_reply_ready",
    "queued_cursor",
    "cursor_claimed",
    "cursor_submitted",
    "cursor_running",
    "cursor_done",
    "cursor_failed",
    "chatgpt_failed",
    "cancelled",
})

JOB_TERMINAL_STATUSES = frozenset({
    "cursor_done",
    "cursor_failed",
    "chatgpt_failed",
    "cancelled",
})

JOB_TRANSITIONS = {
    "created": {"queued_chatgpt", "cancelled"},
    "queued_chatgpt": {"sent_to_chatgpt", "chatgpt_failed", "cancelled"},
    "sent_to_chatgpt": {"waiting_chatgpt_reply", "chatgpt_failed", "cancelled"},
    "waiting_chatgpt_reply": {"chatgpt_reply_ready", "chatgpt_failed", "cancelled"},
    "chatgpt_reply_ready": {"queued_cursor", "cursor_failed", "cancelled"},
    "queued_cursor": {"cursor_claimed", "cursor_failed", "cancelled"},
    "cursor_claimed": {"cursor_submitted", "cursor_failed", "cancelled"},
    "cursor_submitted": {"cursor_running", "cursor_failed", "cancelled"},
    "cursor_running": {"cursor_done", "cursor_failed", "cancelled"},
    "cursor_done": set(),
    "cursor_failed": set(),
    "chatgpt_failed": set(),
    "cancelled": set(),
}


def job_status_from(job):
    if not isinstance(job, dict):
        return ""
    return (job.get("job_status") or "").strip()


def is_job_terminal_status(status: str) -> bool:
    return (status or "").strip() in JOB_TERMINAL_STATUSES


def can_transition_job_status(current_status: str, next_status: str) -> bool:
    current_status = (current_status or "").strip()
    next_status = (next_status or "").strip()
    if not next_status:
        return False
    if current_status == next_status:
        return True
    if is_job_terminal_status(current_status):
        return False
    allowed = JOB_TRANSITIONS.get(current_status)
    if allowed is None:
        return False
    return next_status in allowed


def reject_invalid_job_transition(
    job_id: str,
    current_status: str,
    next_status: str,
    message: str = "",
) -> None:
    _log_line(
        "[JOB][INVALID_TRANSITION] "
        f"job_id={job_id} "
        f"current={current_status or '-'} "
        f"next={next_status or '-'} "
        f"message={message or '-'}"
    )


def reject_terminal_job_update(
    job_id: str,
    current_status: str,
    next_status: str,
    message: str = "",
) -> None:
    _log_line(
        "[JOB][TERMINAL_UPDATE_REJECTED] "
        f"job_id={job_id} "
        f"current={current_status or '-'} "
        f"next={next_status or '-'} "
        f"message={message or '-'}"
    )


def _migrate_job_status_inplace(job):
    if not isinstance(job, dict):
        return job
    status = job_status_from(job)
    if status:
        job["job_status"] = status
    job.pop("status", None)
    return job

CHATGPT_CURSOR_PROMPT_TEMPLATE = """请根据下面需求，整理成适合直接发给 Cursor Agent 的修改指令。

要求：
1. 基于现有代码继续修改。
2. 不要重构无关模块。
3. 不要删除无关功能。
4. 不要使用 try/except pass。
5. 如果必须捕获异常，必须打印或记录具体错误。
6. 输出内容要适合 Cursor 直接执行。
7. 请明确修改目标、涉及文件、关键逻辑、验收标准。

用户需求：
{user_requirement}
"""


def _now_text():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _new_job_id():
    return f"job_{int(time.time())}_{uuid.uuid4().hex[:8]}"


def build_chatgpt_prompt(user_requirement):
    requirement = (user_requirement or "").strip()
    return CHATGPT_CURSOR_PROMPT_TEMPLATE.format(user_requirement=requirement)


def create_job(
    user_requirement,
    title="",
    *,
    auto_send_to_cursor=False,
    project_root="",
):
    requirement = (user_requirement or "").strip()
    if not requirement:
        return None, "user_requirement is empty"

    job_id = _new_job_id()
    now = _now_text()
    job = {
        "job_id": job_id,
        "title": (title or "").strip() or requirement[:40],
        "user_requirement": requirement,
        "chatgpt_prompt": build_chatgpt_prompt(requirement),
        "chatgpt_reply": "",
        "cursor_task_id": "",
        "outbound_message_id": "",
        "job_status": "created",
        "cursor_status": "",
        "error": "",
        "auto_send_to_cursor": bool(auto_send_to_cursor),
        "project_root": (project_root or "").strip(),
        "created_at": now,
        "updated_at": now,
        "logs": [],
    }

    with job_lock:
        job_map[job_id] = job
        job_queue.append(job_id)

    append_job_log(job_id, "CREATE", f"title={job['title']}")
    update_job_status(job_id, "created", "任务已创建")
    cleanup_job_records()
    return job_id, job


def update_job_status(job_id, status, message=""):
    job_id = (job_id or "").strip()
    status = (status or "").strip()
    message = str(message or "").strip()
    if status and status not in JOB_STATUSES:
        _log_line(
            "[JOB][UNKNOWN_STATUS] "
            f"job_id={job_id or '-'} "
            f"status={status} "
            f"message={message or '-'}"
        )
        return False, f"invalid status: {status}"

    with job_lock:
        job = job_map.get(job_id)
        if not job:
            _log_line(
                "[JOB][STATUS_UPDATE_MISSING_JOB] "
                f"job_id={job_id or '-'} "
                f"status={status or '-'} "
                f"message={message or '-'}"
            )
            return False, "job not found"
        _migrate_job_status_inplace(job)
        current_status = job_status_from(job)
        if not status:
            job["updated_at"] = _now_text()
        elif current_status == status:
            job["job_status"] = status
            job.pop("status", None)
            job["updated_at"] = _now_text()
        else:
            if is_job_terminal_status(current_status):
                reject_terminal_job_update(
                    job_id, current_status, status, message
                )
                return False, f"terminal status {current_status} cannot transition to {status}"
            if not can_transition_job_status(current_status, status):
                reject_invalid_job_transition(
                    job_id, current_status, status, message
                )
                return (
                    False,
                    f"{current_status or '-'} -> {status} not allowed",
                )
            job["job_status"] = status
            job.pop("status", None)
            if status == "chatgpt_failed":
                job["failure_stage"] = "chatgpt"
            elif status == "cursor_failed":
                job.setdefault("failure_stage", "cursor")
            job["updated_at"] = _now_text()
            _log_line(
                "[JOB][STATUS] "
                f"job_id={job_id} "
                f"{current_status or '-'} -> {status} "
                f"message={message or '-'}"
            )
        if message:
            if status in ("cursor_failed", "chatgpt_failed", "cancelled"):
                job["error"] = message
                job["status_message"] = message
            elif status and status not in JOB_TERMINAL_STATUSES:
                job["error"] = ""
                job["status_message"] = message

    if message and status:
        append_job_log(job_id, status.upper(), message)
    _notify_job_change()
    cleanup_job_records()
    return True, "ok"


def append_job_log(job_id, tag, message):
    job_id = (job_id or "").strip()
    tag = (tag or "").strip() or "INFO"
    message = str(message or "").strip()
    entry = {
        "time": _now_text(),
        "tag": tag,
        "message": message,
    }
    line = f"[JOB][{tag}] {message}" if message else f"[JOB][{tag}]"

    with job_lock:
        job = job_map.get(job_id)
        if not job:
            return False
        job["logs"].append(entry)
        if len(job["logs"]) > 200:
            job["logs"] = job["logs"][-200:]
        job["updated_at"] = _now_text()

    _log_line(line)
    return True


def get_job(job_id):
    job_id = (job_id or "").strip()
    with job_lock:
        job = job_map.get(job_id)
        if not job:
            return None
        _migrate_job_status_inplace(job)
        return dict(job)


def list_jobs(limit=50):
    limit = max(1, int(limit or 50))
    with job_lock:
        ids = list(job_queue)
        jobs = []
        for job_id in reversed(ids):
            job = job_map.get(job_id)
            if job:
                jobs.append(dict(_migrate_job_status_inplace(job)))
            if len(jobs) >= limit:
                break
        return jobs


def _count_waiting_chatgpt_jobs():
    count = 0
    with job_lock:
        for job_id in job_queue:
            job = job_map.get(job_id)
            if job and job_status_from(job) == "waiting_chatgpt_reply":
                count += 1
    return count


def _find_waiting_chatgpt_job(*, outbound_message_id=""):
    outbound_message_id = (outbound_message_id or "").strip()
    with job_lock:
        if outbound_message_id:
            for job_id in reversed(job_queue):
                job = job_map.get(job_id)
                if not job:
                    continue
                if job.get("outbound_message_id") == outbound_message_id:
                    if job_status_from(job) == "waiting_chatgpt_reply":
                        return job_id, job
            return None, None

        waiting = []
        for job_id in reversed(job_queue):
            job = job_map.get(job_id)
            if not job:
                continue
            if job_status_from(job) == "waiting_chatgpt_reply":
                waiting.append((job_id, job))
        if len(waiting) == 1:
            return waiting[0]
        if len(waiting) > 1:
            waiting_ids = ",".join(jid for jid, _job in waiting)
            _log_line(
                "[JOB][AMBIGUOUS_REPLY] "
                f"outbound_message_id=- "
                f"waiting_job_count={len(waiting)} "
                f"waiting_job_ids={waiting_ids}"
            )
    return None, None


def on_assistant_reply(text, *, outbound_message_id="", auto_send_hook=None):
    """
    油猴回报 assistant 回复时由 server 调用。
    auto_send_hook: callable(job_id) -> (ok, result)，默认 send_job_to_cursor。
    """
    reply_text = (text or "").strip()
    if not reply_text:
        _log_line(
            "[JOB][ASSISTANT_REPLY_ORPHAN] "
            f"outbound_message_id={outbound_message_id or '-'} "
            "reply_len=0"
        )
        return None

    job_id, job = _find_waiting_chatgpt_job(outbound_message_id=outbound_message_id)
    if not job_id:
        _log_line(
            "[JOB][ASSISTANT_REPLY_ORPHAN] "
            f"outbound_message_id={outbound_message_id or '-'} "
            f"reply_len={len(reply_text)}"
        )
        return None

    with job_lock:
        stored = job_map.get(job_id)
        if not stored:
            return None
        current = job_status_from(stored)
        if current in JOB_TERMINAL_STATUSES:
            _log_line(
                "[JOB][STALE_REPLY_IGNORED] "
                f"job_id={job_id} "
                f"status={current} "
                f"outbound_message_id={outbound_message_id or '-'}"
            )
            return None
        if current != "waiting_chatgpt_reply":
            _log_line(
                "[JOB][STALE_REPLY_IGNORED] "
                f"job_id={job_id} "
                f"status={current} "
                "expected=waiting_chatgpt_reply"
            )
            return None
        stored["chatgpt_reply"] = reply_text
        stored["updated_at"] = _now_text()

    append_job_log(
        job_id,
        "CHATGPT_REPLY_READY",
        f"reply_len={len(reply_text)}",
    )
    update_ok, _update_reason = update_job_status(
        job_id,
        "chatgpt_reply_ready",
        "ChatGPT 已返回 Cursor 修改指令",
    )
    if not update_ok:
        _log_line(
            "[JOB][ASSISTANT_REPLY_STATUS_UPDATE_FAILED] "
            f"job_id={job_id} "
            f"outbound_message_id={outbound_message_id or '-'} "
            f"reason={_update_reason}"
        )
        return None

    job_after = get_job(job_id)
    if job_after and job_after.get("auto_send_to_cursor"):
        hook = auto_send_hook
        if not hook:
            append_job_log(
                job_id,
                "CURSOR_FAILED",
                "auto_send_to_cursor 已开启但未提供 enqueue 回调",
            )
            update_job_status(
                job_id,
                "cursor_failed",
                "auto_send_to_cursor 缺少 enqueue_cursor_task 回调",
            )
        else:
            try:
                hook(job_id)
            except Exception as exc:
                detail = f"{exc}\n{traceback.format_exc()}"
                append_job_log(job_id, "CURSOR_FAILED", detail)
                update_job_status(job_id, "cursor_failed", str(exc))
                _log_line(
                    f"[JOB][AUTO_SEND_CURSOR_FAILED] job_id={job_id} error={exc}"
                )

    return job_id


def on_assistant_reply_failed(message, *, outbound_message_id=""):
    job_id, job = _find_waiting_chatgpt_job(outbound_message_id=outbound_message_id)
    if not job_id:
        return None
    detail = (message or "").strip() or "ChatGPT 回复失败"
    append_job_log(job_id, "CHATGPT_FAILED", detail)
    with job_lock:
        stored = job_map.get(job_id)
        if stored is not None:
            stored["failure_stage"] = "chatgpt"
    update_job_status(job_id, "chatgpt_failed", detail)
    return job_id


def send_job_to_cursor(job_id, enqueue_cursor_task_fn):
    job = get_job(job_id)
    if not job:
        return False, "job not found"

    current = job_status_from(job)
    if current == "cancelled":
        _log_line(f"[JOB][CURSOR_DISPATCH_SKIP_CANCELLED] job_id={job_id}")
        return False, "job cancelled"
    if current != "chatgpt_reply_ready":
        _log_line(
            "[JOB][CURSOR_DISPATCH_INVALID_STATUS] "
            f"job_id={job_id} "
            f"status={current or '-'}"
        )
        return False, f"job status must be chatgpt_reply_ready, got {current or '-'}"
    if is_cursor_code_paused():
        reason = get_cursor_code_pause_reason() or "cursor_code_paused"
        append_job_log(job_id, "PAUSED_BY_CURSOR_CODE", reason)
        _log_line(f"[JOB][PAUSED_BY_CURSOR_CODE] job_id={job_id} reason={reason}")
        return False, "paused_by_cursor_code"

    content = job.get("chatgpt_reply") or ""
    if not content.strip():
        with job_lock:
            stored = job_map.get(job_id)
            if stored is not None:
                stored["failure_stage"] = "cursor_dispatch"
                stored["error"] = "chatgpt_reply is empty"
                stored["updated_at"] = _now_text()
        update_ok, _ = update_job_status(
            job_id, "cursor_failed", "chatgpt_reply is empty"
        )
        _log_line(
            "[JOB][CURSOR_DISPATCH_EMPTY_REPLY] "
            f"job_id={job_id} "
            f"update_ok={update_ok}"
        )
        return False, "chatgpt_reply is empty"

    task_id = f"cursor_task_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    task = {
        "task_id": task_id,
        "job_id": job_id,
        "type": "cursor_agent_prompt",
        "command": "send_message",
        "delivery_mode": "auto_send",
        "mode": "auto_send",
        "require_confirm": False,
        "prompt_mode": "raw",
        "submit_mode": "enter",
        "target": "agent",
        "title": job.get("title") or "Cursor 修改任务",
        "project_root": job.get("project_root") or "",
        "content": content,
        "files": [],
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    append_job_log(job_id, "SEND_TO_CURSOR", f"task_id={task_id} content_len={len(content)}")

    try:
        ok, result = enqueue_cursor_task_fn(task)
    except Exception as exc:
        detail = f"{exc}\n{traceback.format_exc()}"
        append_job_log(job_id, "CURSOR_FAILED", detail)
        update_job_status(job_id, "cursor_failed", str(exc))
        return False, str(exc)

    if not ok:
        with job_lock:
            stored = job_map.get(job_id)
            if stored is not None:
                stored["failure_stage"] = "cursor_dispatch"
                stored["error"] = str(result)
                stored["updated_at"] = _now_text()
        update_job_status(job_id, "cursor_failed", str(result))
        return False, result

    with job_lock:
        stored = job_map.get(job_id)
        if stored:
            stored["cursor_task_id"] = task_id
            stored["updated_at"] = _now_text()
        cursor_task_to_job[task_id] = job_id

    update_job_status(job_id, "queued_cursor", f"已发送到 Cursor 队列：{task_id}")
    return True, task_id


def handle_cursor_task_report(report):
    if not isinstance(report, dict):
        return False, "report must be dict"

    task_id = (report.get("task_id") or "").strip()
    status = (report.get("status") or "").strip().lower()
    message = (report.get("message") or "").strip()

    with job_lock:
        job_id = cursor_task_to_job.get(task_id)

    if not job_id:
        _log_line(
            "[JOB][CURSOR_REPORT_ORPHAN] "
            f"task_id={task_id or '-'} "
            f"status={status or '-'}"
        )
        return False, "no job for task_id"

    job = get_job(job_id)
    if not job:
        _log_line(
            "[JOB][CURSOR_REPORT_JOB_MISSING] "
            f"task_id={task_id or '-'} "
            f"job_id={job_id} "
            f"status={status or '-'}"
        )
        return False, "job not found"

    stored_task_id = (job.get("cursor_task_id") or "").strip()
    if stored_task_id != task_id:
        _log_line(
            "[JOB][CURSOR_REPORT_TASK_MISMATCH] "
            f"job_id={job_id} "
            f"report_task_id={task_id or '-'} "
            f"job_task_id={stored_task_id or '-'} "
            f"status={status or '-'}"
        )
        return False, "task_id mismatch"

    current = job_status_from(job)
    if is_job_terminal_status(current):
        _log_line(
            "[JOB][STALE_CURSOR_REPORT_IGNORED] "
            f"job_id={job_id} "
            f"task_id={task_id or '-'} "
            f"current_status={current} "
            f"report_status={status or '-'}"
        )
        return False, f"job in terminal status {current}"

    with job_lock:
        stored = job_map.get(job_id)
        if stored is not None:
            stored["cursor_status"] = status

    if status == "received":
        append_job_log(job_id, "CURSOR_CLAIMED", message or "Cursor 插件已领取任务")
        update_job_status(job_id, "cursor_claimed", "Cursor 插件已领取任务")
        return True, "cursor_claimed"

    if status == "sent":
        append_job_log(
            job_id,
            "CURSOR_SUBMITTED",
            message or "Cursor 插件已提交给 Cursor Agent",
        )
        update_job_status(
            job_id,
            "cursor_submitted",
            "已提交给 Cursor Agent，等待 Cursor 执行完成",
        )
        return True, "cursor_submitted"

    if status == "running":
        append_job_log(job_id, "CURSOR_RUNNING", message or "Cursor 正在执行")
        update_job_status(job_id, "cursor_running", message or "Cursor 正在执行")
        return True, "cursor_running"

    if status == "done":
        append_job_log(job_id, "CURSOR_DONE", message or "Cursor 已完成任务")
        update_job_status(job_id, "cursor_done", message or "Cursor 已完成任务")
        return True, "cursor_done"

    if status == "failed":
        err = message or "Cursor 任务失败"
        with job_lock:
            stored = job_map.get(job_id)
            if stored is not None:
                stored["failure_stage"] = "cursor"
                stored["error"] = err
                stored["updated_at"] = _now_text()
        append_job_log(job_id, "CURSOR_FAILED", err)
        update_job_status(job_id, "cursor_failed", err)
        return True, "cursor_failed"

    _log_line(
        "[JOB][CURSOR_REPORT_UNKNOWN_STATUS] "
        f"job_id={job_id} "
        f"task_id={task_id or '-'} "
        f"status={status or '-'} "
        f"payload={report!r}"
    )
    cleanup_job_records()
    return False, f"unknown report status: {status}"


def cancel_job(job_id, reason=""):
    job_id = (job_id or "").strip()
    with job_lock:
        job = job_map.get(job_id)
        if not job:
            return False, "job not found"
        current_status = job_status_from(job)
        if current_status in JOB_TERMINAL_STATUSES:
            return False, f"cannot cancel status={current_status}"

    detail = (reason or "").strip() or "用户取消"
    with job_lock:
        stored = job_map.get(job_id)
        if stored is not None:
            stored["cancel_reason"] = detail
    append_job_log(job_id, "CANCELLED", detail)
    update_job_status(job_id, "cancelled", detail)
    return True, "ok"

JOB_CLEANUP_MAX = 300
JOB_CLEANUP_TTL_HOURS = 24
JOB_STALE_ACTIVE_TTL_HOURS = 2
JOB_STALE_ACTIVE_STATUSES = frozenset({
    "waiting_chatgpt_reply",
    "queued_cursor",
    "cursor_claimed",
    "cursor_running",
})


def _job_timestamp_seconds(job):
    if not isinstance(job, dict):
        return None
    for field in ("updated_at", "created_at"):
        text = (job.get(field) or "").strip()
        if not text:
            continue
        try:
            return time.mktime(time.strptime(text, "%Y-%m-%d %H:%M:%S"))
        except (ValueError, OSError):
            continue
    return None


def cleanup_job_records():
    """清理终端状态且超过 TTL 的任务记录；job_map 不超过 JOB_CLEANUP_MAX。"""
    now_ts = time.time()
    ttl_sec = JOB_CLEANUP_TTL_HOURS * 3600
    stale_active_ttl_sec = JOB_STALE_ACTIVE_TTL_HOURS * 3600
    max_records = JOB_CLEANUP_MAX
    stale_marked = 0
    stale_to_fail = []
    with job_lock:
        for job_id, job in list(job_map.items()):
            if not isinstance(job, dict):
                continue
            status = job_status_from(job)
            if status not in JOB_STALE_ACTIVE_STATUSES:
                continue
            ts = _job_timestamp_seconds(job)
            if ts is None or (now_ts - ts) <= stale_active_ttl_sec:
                continue
            stale_to_fail.append(
                (
                    job_id,
                    status,
                    (
                        f"stale timeout: status={status} exceeded "
                        f"{JOB_STALE_ACTIVE_TTL_HOURS}h"
                    ),
                )
            )
    for job_id, prev_status, err_text in stale_to_fail:
        fail_status = (
            "chatgpt_failed"
            if prev_status == "waiting_chatgpt_reply"
            else "cursor_failed"
        )
        failure_stage = "chatgpt" if fail_status == "chatgpt_failed" else "cursor"
        with job_lock:
            stored = job_map.get(job_id)
            if stored is not None:
                stored["failure_stage"] = failure_stage
                stored["error"] = err_text
        ok, _ = update_job_status(job_id, fail_status, err_text)
        if ok:
            stale_marked += 1
            _log_line(
                "[JOB][STALE_ACTIVE_TIMEOUT] "
                f"job_id={job_id} "
                f"previous_status={prev_status}"
            )
    with job_lock:
        to_remove = set()
        for job_id, job in list(job_map.items()):
            if not isinstance(job, dict):
                to_remove.add(job_id)
                continue
            status = job_status_from(job)
            if status not in JOB_TERMINAL_STATUSES:
                continue
            ts = _job_timestamp_seconds(job)
            if ts is None:
                continue
            if now_ts - ts > ttl_sec:
                to_remove.add(job_id)
        # remove oldest terminal jobs if over max
        alive = [
            (jid, j)
            for jid, j in job_map.items()
            if jid not in to_remove and isinstance(j, dict)
        ]
        if len(alive) > max_records:
            alive.sort(key=lambda kv: kv[1].get("created_at") or "")
            overflow = len(alive) - max_records
            for jid, _j in alive[:overflow]:
                status = job_status_from(_j)
                if status in JOB_TERMINAL_STATUSES:
                    to_remove.add(jid)
        if not to_remove:
            if stale_marked:
                _log_line(
                    "[JOB][CLEANUP] "
                    f"stale_marked={stale_marked} "
                    f"removed=0 "
                    f"remaining_jobs={len(job_map)} "
                    f"remaining_queue={len(job_queue)} "
                    f"remaining_task_to_job={len(cursor_task_to_job)}"
                )
            return
        for jid in to_remove:
            job_map.pop(jid, None)
            # sync remove from cursor_task_to_job
            task_ids_to_remove = [
                tid for tid, stored_jid in list(cursor_task_to_job.items())
                if stored_jid == jid
            ]
            for tid in task_ids_to_remove:
                cursor_task_to_job.pop(tid, None)
            # remove from queue
            while jid in job_queue:
                try:
                    job_queue.remove(jid)
                except ValueError:
                    break
    _log_line(
        "[JOB][CLEANUP] "
        f"stale_marked={stale_marked} "
        f"removed={len(to_remove)} "
        f"remaining_jobs={len(job_map)} "
        f"remaining_queue={len(job_queue)} "
        f"remaining_task_to_job={len(cursor_task_to_job)}"
    )


def get_job_scheduler_snapshot(limit=20):
    cleanup_job_records()
    jobs = list_jobs(limit=limit)
    active = None
    for job in jobs:
        st = job_status_from(job)
        if st not in JOB_TERMINAL_STATUSES:
            active = job
            break
    if active is None and jobs:
        active = jobs[0]
    return {
        "active_job": active,
        "jobs": jobs,
        "pending_chatgpt": sum(
            1 for j in jobs if job_status_from(j) == "waiting_chatgpt_reply"
        ),
    }


_job_status_callback = None
_job_log_callback = None


def set_job_status_callback(callback):
    global _job_status_callback
    _job_status_callback = callback


def set_job_log_callback(callback):
    global _job_log_callback
    _job_log_callback = callback


def _notify_job_change():
    cb = _job_status_callback
    if cb:
        try:
            cb(get_job_scheduler_snapshot())
        except Exception as exc:
            _log_line(
                "[JOB][STATUS_CALLBACK_FAILED] "
                "function=_notify_job_change "
                f"callback={repr(cb)} "
                f"error_type={type(exc).__name__} "
                f"error={exc}\n{traceback.format_exc()}"
            )


def _log_line(line):
    cb = _job_log_callback
    if cb:
        try:
            cb(line)
        except Exception as exc:
            line_preview = str(line or "")
            if len(line_preview) > 500:
                line_preview = line_preview[:500] + "...<truncated>"
            print(
                "[JOB][LOG_CALLBACK_FAILED] "
                "function=_log_line "
                f"callback={repr(cb)} "
                f"line_preview={line_preview!r} "
                f"error_type={type(exc).__name__} "
                f"error={exc}\n{traceback.format_exc()}"
            )
    else:
        print(line)
