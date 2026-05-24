"""Cursor Bridge 路由 /api/cursor/*（仅启用外部 API 时注册）。"""
from __future__ import annotations

from flask import jsonify, request


def register_cursor_routes(app) -> None:
    from app.server import cursor_api

    app.add_url_rule(
        "/api/cursor/tasks/create",
        view_func=_api_cursor_tasks_create(cursor_api),
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/cursor/tasks/next",
        view_func=_api_cursor_tasks_next(cursor_api),
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/cursor/tasks/report",
        view_func=_api_cursor_tasks_report(cursor_api),
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/cursor/tasks/status",
        view_func=_api_cursor_tasks_status(cursor_api),
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/cursor/client/heartbeat",
        view_func=_api_cursor_client_heartbeat(cursor_api),
        methods=["POST"],
    )


def _json_body_or_error(tag):
    from app.server.request_utils import json_body_or_error

    return json_body_or_error(tag)


def _api_cursor_tasks_create(cursor_api):
    def view():
        body, error_response = _json_body_or_error(
            "[CURSOR_BRIDGE][TASK_CREATE_FAILED]"
        )
        if error_response:
            return error_response
        task = body.get("task") if isinstance(body.get("task"), dict) else body
        ok, result = cursor_api.enqueue_cursor_task(task)
        if not ok:
            return jsonify({"ok": False, "error": result}), 400
        return jsonify({"ok": True, "task_id": result})

    return view


def _api_cursor_tasks_next(cursor_api):
    def view():
        client = (request.args.get("client") or "").strip()
        task = cursor_api.claim_next_cursor_task(client=client)
        return jsonify({"ok": True, "task": task})

    return view


def _api_cursor_tasks_report(cursor_api):
    def view():
        report, error_response = _json_body_or_error(
            "[CURSOR_BRIDGE][REPORT_FAILED]"
        )
        if error_response:
            return error_response
        ok, result = cursor_api.append_cursor_task_report(report)
        if not ok:
            return jsonify({"ok": False, "error": result}), 400
        return jsonify({"ok": True})

    return view


def _api_cursor_tasks_status(cursor_api):
    def view():
        status = cursor_api.get_cursor_bridge_status()
        return jsonify(
            {
                "ok": True,
                "cursor": status,
                "pending_count": status.get("pending_count", 0),
                "reports": status.get("reports") or [],
                "history": status.get("history") or [],
            }
        )

    return view


def _api_cursor_client_heartbeat(cursor_api):
    def view():
        payload, error_response = _json_body_or_error(
            "[CURSOR_BRIDGE][HEARTBEAT_FAILED]"
        )
        if error_response:
            return error_response
        ok, result = cursor_api.update_cursor_client_heartbeat(payload)
        if not ok:
            return jsonify({"ok": False, "error": result}), 400
        return jsonify({"ok": True, "status": cursor_api.get_cursor_bridge_status()})

    return view
