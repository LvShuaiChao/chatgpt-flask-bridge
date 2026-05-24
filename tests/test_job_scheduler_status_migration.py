from app.core import job_scheduler as js


def reset_scheduler_state():
    with js.job_lock:
        js.job_queue.clear()
        js.job_map.clear()
        js.cursor_task_to_job.clear()


def test_send_job_to_cursor_rejects_cancelled_job_after_status_migration():
    reset_scheduler_state()

    job_id, job = js.create_job(
        "测试需求",
        title="测试任务",
        auto_send_to_cursor=False,
        project_root="",
    )
    assert job_id

    with js.job_lock:
        stored = js.job_map[job_id]
        stored["chatgpt_reply"] = "Cursor 修改指令内容"
        stored["job_status"] = "cancelled"
        stored.pop("status", None)

    called = []

    def fake_enqueue_cursor_task(task):
        called.append(task)
        return True, "task_ok"

    ok, message = js.send_job_to_cursor(job_id, fake_enqueue_cursor_task)

    assert ok is False
    assert message == "job cancelled"
    assert called == []


def test_get_job_scheduler_snapshot_counts_waiting_chatgpt_reply_after_status_migration():
    reset_scheduler_state()

    job_id, job = js.create_job(
        "测试需求",
        title="等待回复任务",
        auto_send_to_cursor=False,
        project_root="",
    )
    assert job_id

    with js.job_lock:
        stored = js.job_map[job_id]
        stored["job_status"] = "waiting_chatgpt_reply"
        stored.pop("status", None)

    snapshot = js.get_job_scheduler_snapshot(limit=20)

    assert snapshot["pending_chatgpt"] == 1
    assert snapshot["active_job"]["job_id"] == job_id
