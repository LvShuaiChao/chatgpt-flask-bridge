"""核心桥接路由：/api/bridge、/health（默认始终注册）。"""
from __future__ import annotations

import time
import traceback

from flask import jsonify, request
from werkzeug.exceptions import HTTPException

from app.server import bridge_api
from app.server.runtime_state import _log, is_debug_mode


def health():
    """轻量健康检查（无需鉴权），供 bridge_client 等探测。"""
    return jsonify({"ok": True, "server": "running"})


def before_request():
    request._log_started_at = time.perf_counter()
    if not is_debug_mode():
        return
    json_keys = []
    if request.is_json:
        try:
            body = request.get_json(silent=True) or {}
            if isinstance(body, dict):
                json_keys = sorted(body.keys())
        except Exception as error:
            _log(
                "[HTTP][REQUEST_BODY_PARSE_FAILED] "
                f"path={request.path} error_type={type(error).__name__} error={error}"
            )
    _log(
        "[HTTP][REQUEST] "
        f"method={request.method} path={request.path} "
        f"remote={request.remote_addr or '-'} "
        f"content_length={request.content_length or 0} "
        f"json_keys={json_keys}"
    )


def after_request(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    started_at = getattr(request, "_log_started_at", None)
    cost_ms = 0
    if started_at is not None:
        cost_ms = int((time.perf_counter() - started_at) * 1000)
    status_code = int(response.status_code or 0)
    should_log = is_debug_mode() or status_code >= 400
    if should_log:
        _log(
            "[HTTP][RESPONSE] "
            f"method={request.method} path={request.path} "
            f"status={response.status_code} cost_ms={cost_ms} "
            f"content_length={response.calculate_content_length() or 0}"
        )
    return response


def handle_unexpected_route_error(error):
    if isinstance(error, HTTPException):
        return error
    _log(
        "[HTTP][UNHANDLED_EXCEPTION] "
        f"method={request.method} path={request.path} "
        f"remote={request.remote_addr or '-'} "
        f"error_type={type(error).__name__} error={error}\n{traceback.format_exc()}"
    )
    return jsonify(
        {
            "ok": False,
            "error": str(error),
            "code": "INTERNAL_ERROR",
        }
    ), 500


def register_core_routes(app) -> None:
    from app.server import upload_files as uf
    from app.server import system_hotkey as sh

    app.add_url_rule("/api/bridge", view_func=bridge_api.api_bridge, methods=["POST"])
    app.add_url_rule("/health", view_func=health, methods=["GET"])
    app.add_url_rule(
        "/api/upload_files",
        view_func=uf.api_register_upload_file,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/upload_files/<file_id>/content",
        view_func=uf.api_download_upload_file,
        methods=["GET"],
    )
    sh.register_system_hotkey_routes(app)
    app.before_request(before_request)
    app.after_request(after_request)
    app.errorhandler(Exception)(handle_unexpected_route_error)
