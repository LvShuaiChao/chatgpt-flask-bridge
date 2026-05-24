"""Bridge JSON request/response logging (full payload, no truncation)."""
from __future__ import annotations

from app.constants import DEBUG_FULL_BRIDGE_JSON
from app.server.runtime_state import _is_bridge_debug_enabled, _log
from app.utils.bridge_json_file_log import append_bridge_json_log
from app.utils.json_log import dumps_full_json_for_log

_QUIET_REPORT_EVENTS = frozenset({
    "focus_state",
    "page_heartbeat",
    "heartbeat",
    "heartbeat_busy",
    "status_timer",
})


def _bridge_json_should_log(action, request_payload=None, response_payload=None):
    if response_payload is None and isinstance(request_payload, dict):
        if "has_message" in request_payload or request_payload.get("ok") is not None:
            response_payload = request_payload
            request_payload = None
    action = (action or "").strip().lower()
    if not DEBUG_FULL_BRIDGE_JSON:
        if action == "poll":
            return bool(response_payload and response_payload.get("has_message"))
        if action == "report":
            event = ""
            if isinstance(request_payload, dict):
                event = str(request_payload.get("event") or "").strip()
            if event in _QUIET_REPORT_EVENTS:
                return False
            if event == "assistant_reply":
                return True
            return _is_bridge_debug_enabled()
        if action == "ack":
            return True
        return _is_bridge_debug_enabled()
    if action in ("poll", "ack", "hello", "register"):
        return True
    if action == "report":
        event = ""
        if isinstance(request_payload, dict):
            event = str(request_payload.get("event") or "").strip()
        if event in _QUIET_REPORT_EVENTS:
            return _is_bridge_debug_enabled()
        return True
    if action == "heartbeat":
        return _is_bridge_debug_enabled()
    return _is_bridge_debug_enabled()


def _log_bridge_json_line(line):
    """Write full bridge JSON through normal logging and the dedicated file."""
    _log(line, tag="bridge_json")
    append_bridge_json_log(line)


def _log_bridge_json_block(tag, fields, payload):
    parts = [tag]
    for key in sorted(fields.keys()):
        value = fields[key]
        if value is None or value == "":
            value = "-"
        parts.append(f"{key}={value}")
    parts.append(f"json={dumps_full_json_for_log(payload)}")
    _log_bridge_json_line("\n".join(parts))


def log_tm_to_server_full(body):
    if not isinstance(body, dict):
        return
    if not _bridge_json_should_log(str(body.get("action") or ""), body):
        return
    _log_bridge_json_block(
        "[BRIDGE][JSON][TM_TO_SERVER_FULL]",
        {
            "action": body.get("action") or "-",
            "event": body.get("event") or "-",
            "client_id": body.get("client_id") or "-",
            "page_instance_id": body.get("page_instance_id") or "-",
            "conversation_id": body.get("conversation_id") or "-",
            "message_id": body.get("message_id") or "-",
        },
        body,
    )


def log_server_to_tm_full(result, body, *, status_code=200):
    if not isinstance(result, dict):
        result = {"result": result}
    body = body if isinstance(body, dict) else {}
    action = str(body.get("action") or "-")
    if not _bridge_json_should_log(action, body, result):
        return
    message_id = (
        str(result.get("message_id") or body.get("message_id") or "-").strip() or "-"
    )
    _log_bridge_json_block(
        "[BRIDGE][JSON][SERVER_TO_TM_FULL]",
        {
            "action": action,
            "event": body.get("event") or "-",
            "client_id": body.get("client_id") or "-",
            "page_instance_id": body.get("page_instance_id") or "-",
            "message_id": message_id,
            "status_code": status_code,
            "has_message": result.get("has_message"),
            "type": result.get("type") or "-",
        },
        result,
    )


def log_server_to_tm_queue_full(msg, *, action="queue_chat", event=""):
    if not isinstance(msg, dict):
        return
    _log_bridge_json_block(
        "[BRIDGE][JSON][SERVER_TO_TM_QUEUE_FULL]",
        {
            "action": action or "queue_chat",
            "client_id": msg.get("client_id") or "-",
            "page_instance_id": msg.get("page_instance_id") or "-",
            "conversation_id": msg.get("conversation_id") or "-",
            "message_id": msg.get("message_id") or "-",
            "turn_id": msg.get("turn_id") or "-",
            "session_id": msg.get("session_id") or "-",
            "event": event or msg.get("type") or "-",
        },
        msg,
    )


def log_assistant_reply_recv_full(body, msg):
    payload = body.get("payload") if isinstance(body, dict) else {}
    if not isinstance(payload, dict):
        payload = {}
    merged = dict(body) if isinstance(body, dict) else {"body": body}
    if isinstance(msg, dict):
        merged["_matched_outbound"] = {
            "message_id": msg.get("message_id"),
            "session_id": msg.get("session_id"),
            "turn_id": msg.get("turn_id"),
            "message_status": msg.get("message_status"),
        }
    _log_bridge_json_block(
        "[BRIDGE][JSON][ASSISTANT_REPLY_RECV_FULL]",
        {
            "message_id": body.get("message_id") if isinstance(body, dict) else "-",
            "session_id": (msg or {}).get("session_id") if isinstance(msg, dict) else body.get("session_id"),
            "turn_id": (msg or {}).get("turn_id") if isinstance(msg, dict) else body.get("turn_id"),
            "client_id": body.get("client_id") if isinstance(body, dict) else "-",
            "page_instance_id": body.get("page_instance_id") if isinstance(body, dict) else "-",
            "conversation_id": body.get("conversation_id") if isinstance(body, dict) else "-",
            "response_state": payload.get("response_state") or "-",
        },
        merged,
    )


def log_assistant_reply_unknown_full(body, *, known_outbound_ids, known_leased_ids, known_control_ids, recent_finalized_ids):
    if not isinstance(body, dict):
        body = {"body": body}
    _log_bridge_json_block(
        "[BRIDGE][JSON][ASSISTANT_REPLY_UNKNOWN_FULL]",
        {
            "message_id": body.get("message_id") or "-",
            "known_outbound_ids": ",".join(known_outbound_ids or []) or "-",
            "known_leased_ids": ",".join(known_leased_ids or []) or "-",
            "known_control_ids": ",".join(known_control_ids or []) or "-",
            "recent_finalized_ids": ",".join(recent_finalized_ids or []) or "-",
        },
        body,
    )

