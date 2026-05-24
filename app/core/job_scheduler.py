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
    "cancelled",
})


def job_status_from(job):
    if not isinstance(job, dict):
        return ""
    return (job.get("job_status") or "").strip()


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
    if status and status not in JOB_STATUSES:
        return False, f"invalid status: {status}"

    with job_lock:
        job = job_map.get(job_id)
        if not job:
            return False, "job not found"
        if status:
            job["job_status"] = status
            job.pop("status", None)
        if message:
            job["error"] = message if status in ("cursor_failed", "cancelled") else ""
        job["updated_at"] = _now_text()

    if message:
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
        for job_id in reversed(job_queue):
            job = job_map.get(job_id)
            if not job:
                continue
            if job_status_from(job) == "waiting_chatgpt_reply":
                return job_id, job
    return None, None


def on_assistant_reply(text, *, outbound_message_id="", auto_send_hook=None):
    """
    油猴回报 assistant 回复时由 server 调用。
    auto_send_hook: callable(job_id) -> (ok, result)，默认 send_job_to_cursor。
    """
    reply_text = (text or "").strip()
    if not reply_text:
        return None

    job_id, job = _find_waiting_chatgpt_job(outbound_message_id=outbound_message_id)
    if not job_id:
        return None

    with job_lock:
        stored = job_map.get(job_id)
        if not stored or job_status_from(stored) != "waiting_chatgpt_reply":
            return None
        stored["chatgpt_reply"] = reply_text
        stored["updated_at"] = _now_text()

    append_job_log(
        job_id,
        "CHATGPT_REPLY_READY",
        f"reply_len={len(reply_text)}",
    )
    update_job_status(job_id, "chatgpt_reply_ready", "ChatGPT 已返回 Cursor 修改指令")

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
    update_job_status(job_id, "cursor_failed", detail)
    return job_id


def send_job_to_cursor(job_id, enqueue_cursor_task_fn):
    job = get_job(job_id)
    if not job:
        return False, "job not found"

    if job_status_from(job) == "cancelled":
        return False, "job cancelled"
    if is_cursor_code_paused():
        reason = get_cursor_code_pause_reason() or "cursor_code_paused"
        append_job_log(job_id, "PAUSED_BY_CURSOR_CODE", reason)
        _log_line(f"[JOB][PAUSED_BY_CURSOR_CODE] job_id={job_id} reason={reason}")
        return False, "paused_by_cursor_code"

    content = job.get("chatgpt_reply") or ""
    if not content.strip():
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
        return False, "no job for task_id"

    job = get_job(job_id)
    if not job:
        return False, "job not found"

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
        append_job_log(job_id, "CURSOR_FAILED", err)
        update_job_status(job_id, "cursor_failed", err)
        return True, "cursor_failed"

    cleanup_job_records()
    return False, f"unknown report status: {status}"


def cancel_job(job_id, reason=""):
    job_id = (job_id or "").strip()
    with job_lock:
        job = job_map.get(job_id)
        if not job:
            return False, "job not found"
        current_status = job_status_from(job)
        if current_status in ("cursor_done", "cancelled"):
            return False, f"cannot cancel status={current_status}"

    detail = (reason or "").strip() or "用户取消"
    append_job_log(job_id, "CANCELLED", detail)
    update_job_status(job_id, "cancelled", detail)
    return True, "ok"


JOB_TERMINAL_STATUSES = frozenset({"cursor_done", "cancelled", "cursor_failed"})
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
            job["job_status"] = "cursor_failed"
            job.pop("status", None)
            job["error"] = (
                f"stale timeout: status={status} exceeded "
                f"{JOB_STALE_ACTIVE_TTL_HOURS}h"
            )
            job["updated_at"] = _now_text()
            stale_marked += 1
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
        if st not in ("cursor_done", "cancelled", "cursor_failed"):
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
