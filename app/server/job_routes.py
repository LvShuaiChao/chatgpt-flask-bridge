"""Job 调度路由 /api/jobs/*（仅启用外部 API 时注册）。"""
from __future__ import annotations

from flask import jsonify, request

from app.server.runtime_state import _log


def register_job_routes(app) -> None:
    from app.core import job_scheduler as job_scheduler
    from app.server.message_queue import push_message

    app.add_url_rule(
        "/api/jobs/create",
        view_func=api_jobs_create(job_scheduler),
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/jobs/list",
        view_func=api_jobs_list(job_scheduler),
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/jobs/status",
        view_func=api_jobs_status(job_scheduler),
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/jobs/send_to_cursor",
        view_func=api_jobs_send_to_cursor(job_scheduler),
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/jobs/cancel",
        view_func=api_jobs_cancel(job_scheduler),
        methods=["POST"],
    )

    # 供 job_scheduler 内部回调引用
    app.config["_job_push_message"] = push_message


def _json_body_or_error(tag):
    from app.server import external_api as ext

    return ext._json_body_or_error(tag)


def api_jobs_create(job_scheduler):
    def view():
        body, error_response = _json_body_or_error("[JOB][API_CREATE_FAILED]")
        if error_response:
            return error_response
        requirement = (body.get("user_requirement") or body.get("requirement") or "").strip()
        title = (body.get("title") or "").strip()
        auto_send = bool(body.get("auto_send_to_cursor"))
        project_root = (body.get("project_root") or "").strip()
        job_id, result = job_scheduler.create_job(
            requirement,
            title=title,
            auto_send_to_cursor=auto_send,
            project_root=project_root,
        )
        if not job_id:
            return jsonify({"ok": False, "error": result}), 400
        return jsonify({"ok": True, "job_id": job_id, "job": job_scheduler.get_job(job_id)})

    return view


def api_jobs_list(job_scheduler):
    def view():
        raw_limit = request.args.get("limit", 50)
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError) as error:
            _log(
                "[API][JOBS_LIST][INVALID_LIMIT_FALLBACK] "
                f"limit={raw_limit!r} fallback=50 "
                f"error_type={type(error).__name__} "
                f"error={error}"
            )
            limit = 50
        limit = max(1, min(limit, 500))
        return jsonify(
            {
                "ok": True,
                "jobs": job_scheduler.list_jobs(limit=limit),
                "snapshot": job_scheduler.get_job_scheduler_snapshot(limit=limit),
            }
        )

    return view


def api_jobs_status(job_scheduler):
    def view():
        job_id = (request.args.get("job_id") or "").strip()
        if job_id:
            job = job_scheduler.get_job(job_id)
            if not job:
                return jsonify({"ok": False, "error": "job not found"}), 404
            return jsonify({"ok": True, "job": job})
        return jsonify(
            {
                "ok": True,
                "snapshot": job_scheduler.get_job_scheduler_snapshot(),
            }
        )

    return view


def api_jobs_send_to_cursor(job_scheduler):
    def view():
        from app.server import cursor_api

        body, error_response = _json_body_or_error("[JOB][API_SEND_CURSOR_FAILED]")
        if error_response:
            return error_response
        job_id = (body.get("job_id") or "").strip()
        if not job_id:
            return jsonify({"ok": False, "error": "job_id is required"}), 400
        ok, result = job_scheduler.send_job_to_cursor(job_id, cursor_api.enqueue_cursor_task)
        if not ok:
            return jsonify({"ok": False, "error": result}), 400
        return jsonify({"ok": True, "task_id": result, "job": job_scheduler.get_job(job_id)})

    return view


def api_jobs_cancel(job_scheduler):
    def view():
        body, error_response = _json_body_or_error("[JOB][API_CANCEL_FAILED]")
        if error_response:
            return error_response
        job_id = (body.get("job_id") or "").strip()
        reason = (body.get("reason") or "").strip()
        if not job_id:
            return jsonify({"ok": False, "error": "job_id is required"}), 400
        ok, result = job_scheduler.cancel_job(job_id, reason=reason)
        if not ok:
            return jsonify({"ok": False, "error": result}), 400
        return jsonify({"ok": True, "job": job_scheduler.get_job(job_id)})

    return view
