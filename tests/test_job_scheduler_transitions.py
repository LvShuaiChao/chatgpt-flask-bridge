"""Job 状态机 transition guard 回归。"""

from app.core import job_scheduler as js


def reset_scheduler_state():
    with js.job_lock:
        js.job_queue.clear()
        js.job_map.clear()
        js.cursor_task_to_job.clear()


def test_invalid_transition_rejected():
    reset_scheduler_state()
    job_id, _job = js.create_job("需求", auto_send_to_cursor=False)
    assert job_id

    ok, reason = js.update_job_status(job_id, "cursor_done", "illegal jump")
    assert ok is False
    assert "not allowed" in reason
    assert js.job_status_from(js.get_job(job_id)) == "created"


def test_cancelled_terminal_cannot_be_overwritten_by_reply():
    reset_scheduler_state()
    job_id, _job = js.create_job("需求", auto_send_to_cursor=False)
    with js.job_lock:
        stored = js.job_map[job_id]
        stored["job_status"] = "cancelled"
        stored.pop("status", None)

    result = js.on_assistant_reply("reply text", outbound_message_id="")
    assert result is None
    assert js.job_status_from(js.get_job(job_id)) == "cancelled"


def test_ambiguous_reply_without_outbound_message_id():
    reset_scheduler_state()
    for _ in range(2):
        job_id, _job = js.create_job("需求", auto_send_to_cursor=False)
        with js.job_lock:
            js.job_map[job_id]["job_status"] = "waiting_chatgpt_reply"

    result = js.on_assistant_reply("reply", outbound_message_id="")
    assert result is None


def test_chatgpt_failed_not_cursor_failed():
    reset_scheduler_state()
    job_id, _job = js.create_job("需求", auto_send_to_cursor=False)
    with js.job_lock:
        js.job_map[job_id]["job_status"] = "waiting_chatgpt_reply"

    js.on_assistant_reply_failed("timeout")
    job = js.get_job(job_id)
    assert js.job_status_from(job) == "chatgpt_failed"
    assert job.get("failure_stage") == "chatgpt"


def test_empty_chatgpt_reply_marks_cursor_failed():
    reset_scheduler_state()
    job_id, _job = js.create_job("需求", auto_send_to_cursor=False)
    with js.job_lock:
        stored = js.job_map[job_id]
        stored["job_status"] = "chatgpt_reply_ready"
        stored["chatgpt_reply"] = "   "

    called = []

    def fake_enqueue(task):
        called.append(task)
        return True, "ok"

    ok, _msg = js.send_job_to_cursor(job_id, fake_enqueue)
    assert ok is False
    assert called == []
    assert js.job_status_from(js.get_job(job_id)) == "cursor_failed"
