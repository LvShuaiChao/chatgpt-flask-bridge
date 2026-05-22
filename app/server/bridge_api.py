"""油猴 /api/bridge：poll / ack / report。"""
from __future__ import annotations

from flask import jsonify, request

from app.server import state as st
from app.server.bridge_logging import log_server_to_tm_full, log_tm_to_server_full
from app.server.external_api import _json_body_or_error
from app.utils.legacy_cleanup import reject_legacy_fields

from app.server.message_queue import (
    _handle_ack,
    _handle_assistant_reply,
    _handle_hello,
    _handle_poll,
    _handle_report,
)
from app.server.tm_page_registry import (
    _apply_bridge_runtime_patch,
    _bridge_runtime_patch_for_body,
    _ensure_poll_top_level_page_display_id,
    _poll_response_needs_runtime_patch,
    _tm_registry_counts,
)
from app.server.runtime_state import _dispatch_to_gui, _log, _now, _notify_status, is_debug_mode


def _is_local_remote_addr(remote_addr):
    addr = (remote_addr or "").strip().lower()
    if not addr:
        return True
    if addr in ("127.0.0.1", "localhost", "::1"):
        return True
    if addr.startswith("::ffff:127."):
        return True
    return False


def _json_response_with_log(result, body, status_code=200):
    body = body if isinstance(body, dict) else {}
    log_server_to_tm_full(result, body, status_code=status_code)
    return jsonify(result), status_code



def _handle_system_hotkey_action(body):
    combo = str((body or {}).get("combo") or "").strip().lower()
    client_id = str((body or {}).get("client_id") or "-")
    _log(f"[SYSTEM_HOTKEY][REQUEST] combo={combo} client_id={client_id}")

    payload = {"combo": combo, "source": "bridge_api"}
    result = _dispatch_to_gui("system_hotkey", payload, timeout_sec=5)

    ok = bool(result.get("ok"))
    _log(f"[SYSTEM_HOTKEY][RESULT] ok={ok} combo={combo}")
    result["server_time"] = _now()
    return jsonify(result), 200 if ok else 400

def api_bridge():
    """油猴专用交互接口：poll / ack / report"""
    remote_addr = (request.remote_addr or "").strip() or "-"
    if not _is_local_remote_addr(remote_addr):
        error_result = {"ok": False, "error": "仅允许本机油猴访问 /api/bridge"}
        return jsonify(error_result), 403
    source = request.headers.get("X-Request-Source")
    if source != "tampermonkey":
        error_result = {"ok": False, "error": "需要 X-Request-Source: tampermonkey"}
        return jsonify(error_result), 403
    body, error_response = _json_body_or_error("[BRIDGE][JSON_BODY]")
    if error_response:
        return error_response
    legacy_err = reject_legacy_fields(body, context="api_bridge")
    if legacy_err:
        return jsonify(legacy_err[0]), legacy_err[1]
    log_tm_to_server_full(body)
    if body.get("test_connection"):
        _log(
            f"[BRIDGE][TEST] remote={remote_addr} "
            f"client_id={body.get('client_id') or '-'}"
        )
    elif not _is_local_remote_addr(remote_addr) and is_debug_mode():
        _log(
            f"[BRIDGE] remote={remote_addr} action={body.get('action', 'poll')} "
            f"client_id={body.get('client_id') or '-'}"
        )
    action = body.get("action", "poll")
    need_notify = False
    identity_changed = False
    if action == "system_hotkey":
        return _handle_system_hotkey_action(body)

    with st._state_lock:
        if action == "poll":
            result, need_notify, identity_changed = _handle_poll(body)
        elif action in ("hello", "register"):
            result, need_notify = _handle_hello(body)
            identity_changed = False
        elif action == "ack":
            result = _handle_ack(body)
        elif action == "report":
            result = _handle_report(body)
        elif action == "assistant_reply":
            result = _handle_assistant_reply(body)
            need_notify = bool(result.get("ok"))
        else:
            error_result = {"ok": False, "error": f"未知 action: {action}"}
            return _json_response_with_log(error_result, body, 400)
    if need_notify:
        _notify_status()
    result["server_time"] = _now()
    debug_status = bool(body.get("debug_status")) or is_debug_mode()
    if action == "poll" and not result.get("has_message"):
        if _poll_response_needs_runtime_patch(
            result, body, identity_changed=identity_changed
        ):
            result.update(_bridge_runtime_patch_for_body(body))
            if debug_status:
                result.update(_tm_registry_counts())
    elif action == "poll" and result.get("has_message"):
        if debug_status:
            result.update(_tm_registry_counts())
    result = _apply_bridge_runtime_patch(
        result, body, action=action, identity_changed=identity_changed
    )
    if action == "poll":
        result = _ensure_poll_top_level_page_display_id(result, body)
    return _json_response_with_log(result, body)
