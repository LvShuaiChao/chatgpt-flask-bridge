"""External REST API helpers (/api/v1/*)."""
from __future__ import annotations

import time
import traceback
import uuid

from flask import jsonify, request

from app.server import state as st
from app.server.auth_utils import external_auth_ok
from app.server.runtime_state import (
    _dispatch_to_gui,
    _log,
    _notify_status,
    _now,
)


def _external_auth_ok():
    return external_auth_ok()


def _external_json_error(error, code, status=400):
    return jsonify({"ok": False, "error": error, "code": code}), status


def _external_json_ok(**fields):
    payload = {"ok": True}
    payload.update(fields)
    return jsonify(payload)


def _new_external_request_id():
    return f"req_{uuid.uuid4().hex}"


def _external_request_status(req):
    if not isinstance(req, dict):
        return ""
    return (req.get("request_status") or "").strip()


def _set_external_request_status(req, status):
    if isinstance(req, dict):
        req["request_status"] = (status or "").strip()
        req.pop("status", None)


_EXTERNAL_TERMINAL_STATUSES = frozenset({"done", "failed", "timeout"})


def cleanup_external_requests_locked():
    """清理终态且超过 TTL 的外部 API 请求；总数超过上限时优先删最旧终态记录。"""
    now = _now()
    ttl_sec = float(st.EXTERNAL_REQUEST_TTL_SEC)
    max_records = int(st.EXTERNAL_REQUEST_MAX_RECORDS)
    to_remove = set()
    with st._state_lock:
        for request_id, req in list(st._external_requests.items()):
            if not isinstance(req, dict):
                to_remove.add(request_id)
                continue
            status = _external_request_status(req)
            if status not in _EXTERNAL_TERMINAL_STATUSES:
                continue
            updated_at = _external_req_float(req, "updated_at", req.get("created_at", 0))
            if updated_at and (now - updated_at) > ttl_sec:
                to_remove.add(request_id)
        alive_count = len(st._external_requests) - len(to_remove)
        if alive_count > max_records:
            terminal = []
            for request_id, req in st._external_requests.items():
                if request_id in to_remove or not isinstance(req, dict):
                    continue
                if _external_request_status(req) in _EXTERNAL_TERMINAL_STATUSES:
                    terminal.append(
                        (
                            _external_req_float(
                                req, "updated_at", req.get("created_at", 0)
                            ),
                            request_id,
                        )
                    )
            terminal.sort(key=lambda item: item[0])
            overflow = alive_count - max_records
            for _ts, request_id in terminal[:overflow]:
                to_remove.add(request_id)
        if not to_remove:
            return 0
        for request_id in to_remove:
            st._external_requests.pop(request_id, None)
        for bridge_id, request_id in list(st._bridge_message_to_external.items()):
            if request_id in to_remove or request_id not in st._external_requests:
                st._bridge_message_to_external.pop(bridge_id, None)
        for session_id, request_id in list(st._session_external_pending.items()):
            if request_id in to_remove or request_id not in st._external_requests:
                st._session_external_pending.pop(session_id, None)
    _log(
        "[EXTERNAL_API][CLEANUP] "
        f"removed={len(to_remove)} "
        f"remaining={len(st._external_requests)} "
        f"bridge_map={len(st._bridge_message_to_external)} "
        f"session_pending={len(st._session_external_pending)}"
    )
    return len(to_remove)


def _register_external_request(
    request_id,
    session_id,
    text,
    timeout,
    turn_id="",
    bridge_message_id="",
    status="queued",
):
    now = _now()
    entry = {
        "request_id": request_id,
        "session_id": session_id or "",
        "turn_id": turn_id or "",
        "bridge_message_id": bridge_message_id or "",
        "text": text or "",
        "request_status": status,
        "reply": "",
        "error": "",
        "created_at": now,
        "updated_at": now,
        "timeout": float(timeout or 120),
    }
    with st._state_lock:
        st._external_requests[request_id] = entry
        if bridge_message_id:
            st._bridge_message_to_external[bridge_message_id] = request_id
        if session_id and not bridge_message_id:
            st._session_external_pending[session_id] = request_id
        cleanup_external_requests_locked()
    return entry


def attach_external_request_bridge(session_id, bridge_message_id, turn_id=""):
    session_id = (session_id or "").strip()
    bridge_message_id = (bridge_message_id or "").strip()
    turn_id = (turn_id or "").strip()
    if not session_id or not bridge_message_id:
        return False
    with st._state_lock:
        request_id = st._session_external_pending.pop(session_id, None)
        if not request_id:
            for rid, req in st._external_requests.items():
                if req.get("session_id") == session_id and not req.get("bridge_message_id"):
                    request_id = rid
                    break
        if not request_id:
            return False
        req = st._external_requests.get(request_id)
        if not req:
            return False
        req["bridge_message_id"] = bridge_message_id
        req["turn_id"] = turn_id or req.get("turn_id") or ""
        req["updated_at"] = _now()
        if _external_request_status(req) in ("queued", "waiting"):
            _set_external_request_status(req, "queued")
        st._bridge_message_to_external[bridge_message_id] = request_id
    _log(
        f"[EXTERNAL_API][ATTACH] request_id={request_id} session_id={session_id} "
        f"bridge_message_id={bridge_message_id[:8]}… turn_id={turn_id[:8] + '…' if turn_id else '-'}"
    )
    return True


def _update_external_status_for_bridge(bridge_message_id, status):
    bridge_message_id = (bridge_message_id or "").strip()
    if not bridge_message_id:
        return
    with st._state_lock:
        request_id = st._bridge_message_to_external.get(bridge_message_id)
        if not request_id:
            return
        req = st._external_requests.get(request_id)
        if not req or _external_request_status(req) in ("done", "failed", "timeout"):
            return
        _set_external_request_status(req, status)
        req["updated_at"] = _now()


def _notify_external_request_from_bridge(message_id, event, payload, msg=None):
    message_id = (message_id or "").strip()
    if not message_id:
        return False
    payload = payload if isinstance(payload, dict) else {}
    try:
        return _notify_external_request_from_bridge_locked(
            message_id, event, payload, msg
        )
    except Exception as exc:
        _log(
            "[BRIDGE][EXTERNAL_NOTIFY][FAILED] "
            f"message_id={message_id[:8]}… "
            f"event={event or '-'} "
            f"error_type={type(exc).__name__} "
            f"error={exc}\n{traceback.format_exc()}"
        )
        return False


def _notify_external_request_from_bridge_locked(message_id, event, payload, msg=None):
    with st._state_lock:
        request_id = st._bridge_message_to_external.get(message_id)
        if not request_id:
            return False
        req = st._external_requests.get(request_id)
        if not req:
            return False
        if _external_request_status(req) in ("done", "failed", "timeout"):
            return False
        session_id = req.get("session_id") or ""
        terminal_after = False
        if event == "assistant_reply":
            text = (
                payload.get("content") or ""
            ).strip()
            if not text:
                _log(
                    f"[FIELD][MISSING_CONTENT] request_id={request_id} "
                    f"bridge_message_id={message_id}"
                )
            _set_external_request_status(req, "done")
            req["reply"] = text
            req["error"] = ""
            req["updated_at"] = _now()
            terminal_after = True
            _log(
                f"[EXTERNAL_API][REQUEST_DONE] request_id={request_id} "
                f"session_id={session_id} bridge_message_id={message_id} "
                f"reply_len={len(text)}"
            )
        elif event in ("assistant_reply_empty", "assistant_reply_failed", "send_failed"):
            reason = (
                payload.get("reason")
                or payload.get("detail")
                or payload.get("error_message")
                or (msg or {}).get("error_detail")
                or event
            )
            _set_external_request_status(req, "failed")
            req["error"] = str(reason)
            req["updated_at"] = _now()
            terminal_after = True
            _log(
                f"[EXTERNAL_API][REQUEST_FAILED] request_id={request_id} "
                f"reason={reason}"
            )
    if terminal_after:
        cleanup_external_requests_locked()
    return True


def _external_req_float(req, field, default):
    raw = req.get(field) if isinstance(req, dict) else None
    try:
        return float(raw if raw not in (None, "") else default)
    except (TypeError, ValueError) as error:
        _log(
            "[EXTERNAL_API][REQUEST_FLOAT_FALLBACK] "
            f"field={field} "
            f"value={raw!r} "
            f"default={default!r} "
            f"request_id={(req or {}).get('request_id') or '-'} "
            f"error_type={type(error).__name__} "
            f"error={error}"
        )
        return float(default)


def _check_external_request_timeout(req):
    timeout = _external_req_float(req, "timeout", 120)
    created = _external_req_float(req, "created_at", 0)
    if created and (_now() - created) > timeout:
        _set_external_request_status(req, "timeout")
        req["error"] = f"等待回复超时（{int(timeout)}s）"
        req["updated_at"] = _now()
        return True
    return False


def _get_external_request(request_id):
    request_id = (request_id or "").strip()
    if not request_id:
        return None
    with st._state_lock:
        req = st._external_requests.get(request_id)
        if not req:
            return None
        req = dict(req)
    if _external_request_status(req) not in ("done", "failed", "timeout"):
        if _check_external_request_timeout(req):
            with st._state_lock:
                stored = st._external_requests.get(request_id)
                if stored:
                    _set_external_request_status(stored, "timeout")
                    stored["error"] = req["error"]
                    stored["updated_at"] = _now()
            _log(
                f"[EXTERNAL_API][TIMEOUT] request_id={request_id} "
                f"session_id={req.get('session_id') or '-'} "
                f"bridge_message_id={req.get('bridge_message_id') or '-'}"
            )
            cleanup_external_requests_locked()
    else:
        cleanup_external_requests_locked()
    return req


def count_user_turns(session):
    """统计 session 中非空用户消息条数（对象或 dict 均兼容）。"""
    if not session:
        return 0
    messages = getattr(session, "messages", None)
    if messages is None and isinstance(session, dict):
        messages = session.get("messages") or []
    messages = messages or []
    count = 0
    for message in messages:
        if isinstance(message, dict):
            role = message.get("role", "")
            text = message.get("content") or ""
        else:
            role = getattr(message, "role", "")
            text = getattr(message, "text", None)
            if text is None:
                text = getattr(message, "content", "")
        if role == "user" and str(text or "").strip():
            count += 1
    return count


def _parse_external_timeout(body, *, default=120, min_value=1, max_value=120):
    raw_timeout = body.get("timeout", default) if isinstance(body, dict) else default
    try:
        timeout = float(raw_timeout or default)
    except (TypeError, ValueError) as error:
        _log(
            "[EXTERNAL_API][INVALID_TIMEOUT] "
            f"raw_timeout={raw_timeout!r} "
            f"default={default} "
            f"error_type={type(error).__name__} "
            f"error={error}"
        )
        return None, _external_json_error(
            f"invalid timeout: {raw_timeout}",
            "INVALID_TIMEOUT",
            400,
        )

    if timeout <= 0:
        timeout = default

    timeout = max(float(min_value), min(float(timeout), float(max_value)))
    return timeout, None


def _parse_force_new_session_after_turns(body):
    if not isinstance(body, dict):
        return DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS, None
    if "force_new_session_after_turns" not in body:
        return DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS, None

    raw_value = body.get("force_new_session_after_turns")
    try:
        value = int(raw_value or 0)
    except (TypeError, ValueError) as error:
        _log(
            "[EXTERNAL_API][INVALID_FORCE_NEW_SESSION_AFTER_TURNS] "
            f"raw_value={raw_value!r} "
            f"error_type={type(error).__name__} "
            f"error={error}"
        )
        return None, _external_json_error(
            f"invalid force_new_session_after_turns: {raw_value}",
            "INVALID_FORCE_NEW_SESSION_AFTER_TURNS",
            400,
        )

    return max(0, value), None


def _safe_meta_int(value, default=0, *, field=""):
    try:
        return int(value or default)
    except (TypeError, ValueError) as error:
        _log(
            "[EXTERNAL_API][SESSION_META_INT_FALLBACK] "
            f"field={field or '-'} "
            f"value={value!r} "
            f"default={default!r} "
            f"error_type={type(error).__name__} "
            f"error={error}"
        )
        return int(default)


def _external_session_meta_from_gui(gui_result):
    if not isinstance(gui_result, dict):
        _log(
            "[EXTERNAL_API][SESSION_META_INVALID] "
            f"type={type(gui_result).__name__} fallback=empty"
        )
        gui_result = {}
    return {
        "new_session_created": bool(gui_result.get("new_session_created")),
        "new_session_reason": (gui_result.get("new_session_reason") or "").strip(),
        "previous_session_id": (gui_result.get("previous_session_id") or "").strip(),
        "previous_turn_count": _safe_meta_int(
            gui_result.get("previous_turn_count"),
            0,
            field="previous_turn_count",
        ),
        "force_new_session_after_turns": _safe_meta_int(
            gui_result.get("force_new_session_after_turns"),
            0,
            field="force_new_session_after_turns",
        ),
    }


def _log_force_new_session_if_needed(body, gui_result):
    meta = _external_session_meta_from_gui(gui_result)
    if meta.get("new_session_reason") != "force_new_session_after_turns":
        return
    client_name = (body.get("client_name") or "default").strip() or "default"
    _log(
        "[EXTERNAL_API][FORCE_NEW_SESSION] "
        f"client_name={client_name} "
        f"previous_session_id={meta.get('previous_session_id') or '-'} "
        f"previous_turn_count={meta.get('previous_turn_count')} "
        f"limit={meta.get('force_new_session_after_turns')} "
        f"new_session_id={(gui_result.get('session_id') or '-')}"
    )


def _external_sessions_summary_from_gui():
    result = _dispatch_to_gui("sessions_summary", {}, timeout_sec=5)
    if not isinstance(result, dict):
        result = {"ok": False, "error": f"invalid gui result: {type(result).__name__}"}
    if result.get("ok") and isinstance(result.get("summary"), dict):
        return result["summary"]
    _log(
        "[EXTERNAL_API][SESSIONS_SUMMARY_FAILED] "
        "function=_external_sessions_summary_from_gui "
        f"code={result.get('code') or '-'} "
        f"error={result.get('error') or '-'} "
        f"result_keys={sorted(result.keys()) if isinstance(result, dict) else '-'}"
    )
    return {
        "total": 0,
        "bound_online": 0,
        "bound_offline": 0,
        "unbound": 0,
        "summary_error": result.get("error") or "sessions_summary failed",
        "summary_error_code": result.get("code") or "INTERNAL_ERROR",
    }


def _external_client_key(body):
    client_name = (body.get("client_name") or body.get("client_id") or "").strip()
    if client_name:
        return client_name
    try:
        addr = (request.remote_addr or "").strip()
    except RuntimeError as error:
        _log(
            "[EXTERNAL_API][CLIENT_KEY_FAILED] "
            "reason=no_request_context "
            f"error_type={type(error).__name__} "
            f"error={error}\n{traceback.format_exc()}"
        )
        addr = ""
    return addr or "unknown"


def _resolve_external_session_for_send(body):
    """
    解析外部 API 应使用的 session_id。
    返回 (session_id, new_session_flag, log_reason)。
    """
    new_session = bool(body.get("new_session", False))
    reuse_last_session = body.get("reuse_last_session", True) is not False
    session_id = str(body.get("session_id") or "").strip()
    auto_create_session = bool(body.get("auto_create_session", True))
    client_key = _external_client_key(body)

    if new_session:
        return "", True, "new_session_true"

    if session_id:
        return session_id, False, "client_session_id"

    if reuse_last_session:
        with st._state_lock:
            stored = st._external_client_sessions.get(client_key)
            if isinstance(stored, dict):
                last = (stored.get("session_id") or "").strip()
            else:
                last = str(stored or "").strip()
        if last:
            return last, False, "reuse_last_session"

    if auto_create_session:
        return "", False, "no_session_id"

    return "", False, ""


def cleanup_external_client_sessions_locked(now=None):
    now = _now() if now is None else float(now)
    rows = st._external_client_sessions
    remove_keys = []
    for key, value in list(rows.items()):
        if isinstance(value, dict):
            updated_at = float(value.get("updated_at") or 0)
        else:
            updated_at = 0
        if not isinstance(value, dict) or not updated_at:
            remove_keys.append(key)
            continue
        if now - updated_at > st.EXTERNAL_CLIENT_SESSION_TTL_SEC:
            remove_keys.append(key)
    for key in remove_keys:
        rows.pop(key, None)
    if len(rows) > st.EXTERNAL_CLIENT_SESSION_MAX_RECORDS:
        sorted_items = sorted(
            rows.items(),
            key=lambda kv: float(kv[1].get("updated_at") or 0)
            if isinstance(kv[1], dict)
            else 0,
        )
        overflow = len(rows) - st.EXTERNAL_CLIENT_SESSION_MAX_RECORDS
        for key, _value in sorted_items[:overflow]:
            rows.pop(key, None)


def _remember_external_client_session(body, session_id):
    session_id = (session_id or "").strip()
    client_key = _external_client_key(body)
    if not client_key or not session_id:
        return
    with st._state_lock:
        st._external_client_sessions[client_key] = {
            "session_id": session_id,
            "updated_at": _now(),
        }
        cleanup_external_client_sessions_locked()


def _external_create_chat_send(body):
    text = (body.get("text") or "").strip()
    if not text:
        return None, _external_json_error("text 不能为空", "EMPTY_TEXT", 400)
    client_name = (body.get("client_name") or "").strip() or "default"
    client_key = _external_client_key(body)
    auto_create_session = bool(body.get("auto_create_session", True))
    auto_open_home = bool(body.get("auto_open_home", True))
    new_session = bool(body.get("new_session", False))
    reuse_last_session = body.get("reuse_last_session", True) is not False
    force_new_session_after_turns, force_error = _parse_force_new_session_after_turns(body)
    if force_error:
        return None, force_error
    timeout, timeout_error = _parse_external_timeout(
        body,
        default=120,
        min_value=1,
        max_value=120,
    )
    if timeout_error:
        return None, timeout_error

    session_id, force_new_session_flag, resolve_reason = _resolve_external_session_for_send(
        body
    )
    if new_session or force_new_session_flag:
        new_session = True
        session_id = ""
        _log(
            f"[EXTERNAL_API][CREATE_SESSION] client_name={client_key} "
            f"reason={resolve_reason or 'new_session_true'}"
        )
    elif session_id and resolve_reason in ("client_session_id", "reuse_last_session"):
        _log(
            f"[EXTERNAL_API][REUSE_SESSION] client_name={client_key} "
            f"session_id={session_id} reason={resolve_reason}"
        )
    elif not session_id and auto_create_session:
        _log(
            f"[EXTERNAL_API][CREATE_SESSION] client_name={client_key} "
            f"reason={resolve_reason or 'no_session_id'}"
        )

    gui_payload = {
        "session_id": session_id,
        "content": text,
        "auto_create_session": auto_create_session,
        "auto_open_home": auto_open_home,
        "new_session": new_session,
        "reuse_last_session": reuse_last_session,
        "client_name": client_name,
        "force_new_session_after_turns": force_new_session_after_turns,
    }
    gui_result = _dispatch_to_gui("chat_send", gui_payload, timeout_sec=min(60, timeout))
    if not gui_result.get("ok"):
        code = gui_result.get("code") or "INTERNAL_ERROR"
        error = gui_result.get("error") or "发送失败"
        _log(
            f"[EXTERNAL_API][ERROR] chat_send code={code} error={error} "
            f"session_id={session_id or '-'} text_len={len(text)}"
        )
        status = 404 if code == "SESSION_NOT_FOUND" else 400
        if code in ("UNAUTHORIZED",):
            status = 401
        return None, _external_json_error(error, code, status)

    session_id = (gui_result.get("session_id") or session_id or "").strip()
    _remember_external_client_session(body, session_id)
    bridge_message_id = (gui_result.get("bridge_message_id") or "").strip()
    turn_id = (gui_result.get("turn_id") or "").strip()
    pending_home = bool(gui_result.get("pending_home"))
    session_meta = _external_session_meta_from_gui(gui_result)
    _log_force_new_session_if_needed(body, gui_result)
    if pending_home and session_id:
        _log(
            f"[EXTERNAL_API][OPEN_HOME] session_id={session_id} "
            f"reason=no_bound_conversation_and_no_idle_home"
        )
    request_id = _new_external_request_id()
    initial_status = "waiting" if pending_home else "queued"
    _register_external_request(
        request_id,
        session_id,
        text,
        timeout,
        turn_id=turn_id,
        bridge_message_id=bridge_message_id,
        status=initial_status,
    )
    _log(
        f"[EXTERNAL_API][SEND] request_id={request_id} session_id={session_id} "
        f"bridge_message_id={bridge_message_id or '-'} text_len={len(text)} "
        f"status={initial_status} pending_home={pending_home}"
    )
    return {
        "request_id": request_id,
        "session_id": session_id,
        "status": initial_status,
        **session_meta,
    }, None


def _require_external_auth():
    if _external_auth_ok():
        return None
    return _external_json_error("未授权", "UNAUTHORIZED", 401)


def _external_auth_denied():
    return _require_external_auth()
