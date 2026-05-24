from __future__ import annotations

import traceback

from flask import jsonify, request
from werkzeug.exceptions import BadRequest

from app.server.runtime_state import _log


def request_body_preview(max_len=500) -> str:
    try:
        raw = request.get_data(cache=True, as_text=True) or ""
    except Exception as error:
        _log(
            "[REQUEST][BODY_PREVIEW_FAILED] "
            f"error_type={type(error).__name__} error={error}\n"
            f"{traceback.format_exc()}"
        )
        return f"<read_body_failed {type(error).__name__}: {error}>"
    raw = raw.replace("\r", "\\r").replace("\n", "\\n")
    if len(raw) > max_len:
        return raw[:max_len] + "...<truncated>"
    return raw


def json_body_or_error(log_tag, *, allow_empty=True):
    preview = request_body_preview()
    if not preview.strip() and allow_empty:
        return {}, None
    try:
        body = request.get_json(silent=False)
    except BadRequest as exc:
        _log(
            f"{log_tag} reason=json_decode_failed "
            f"method={request.method} path={request.path} "
            f"remote={request.remote_addr or '-'} "
            f"content_type={request.content_type!r} "
            f"error_type={type(exc).__name__} error={exc} "
            f"body_preview={preview!r}\n{traceback.format_exc()}"
        )
        return None, (
            jsonify(
                {
                    "ok": False,
                    "error": f"invalid json: {exc}",
                    "code": "INVALID_JSON",
                }
            ),
            400,
        )
    except Exception as exc:
        _log(
            f"{log_tag} reason=json_parse_exception "
            f"method={request.method} path={request.path} "
            f"remote={request.remote_addr or '-'} "
            f"content_type={request.content_type!r} "
            f"error_type={type(exc).__name__} error={exc} "
            f"body_preview={preview!r}\n{traceback.format_exc()}"
        )
        return None, (
            jsonify(
                {
                    "ok": False,
                    "error": f"invalid json: {exc}",
                    "code": "INVALID_JSON",
                }
            ),
            400,
        )
    if body is None:
        if allow_empty:
            return {}, None
        _log(
            f"{log_tag} reason=json_body_empty "
            f"method={request.method} path={request.path} "
            f"remote={request.remote_addr or '-'} "
            f"content_type={request.content_type!r}"
        )
        return None, (
            jsonify(
                {
                    "ok": False,
                    "error": "request body must be JSON",
                    "code": "EMPTY_JSON_BODY",
                }
            ),
            400,
        )
    if not isinstance(body, dict):
        _log(
            f"{log_tag} reason=json_body_not_object "
            f"method={request.method} path={request.path} "
            f"remote={request.remote_addr or '-'} "
            f"content_type={request.content_type!r} "
            f"body_type={type(body).__name__} body_preview={preview!r}"
        )
        return None, (
            jsonify(
                {
                    "ok": False,
                    "error": "json body must be an object",
                    "code": "INVALID_JSON",
                }
            ),
            400,
        )
    return body, None
