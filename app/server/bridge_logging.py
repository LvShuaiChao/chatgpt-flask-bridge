"""Bridge JSON request/response logging."""
from __future__ import annotations

import json
import time

from app.server import state as st
from app.server.runtime_state import _is_bridge_debug_enabled, _log

BRIDGE_JSON_LOG_TEXT_LIMIT = 1200
BRIDGE_JSON_LOG_MAX_CHARS = 9000
BRIDGE_JSON_LOG_LIST_LIMIT = 5
BRIDGE_JSON_SECRET_KEYS = {
    "authorization",
    "x-api-key",
    "api_key",
    "api_token",
    "token",
    "bridgeapitoken",
    "bridge_api_token",
    "password",
    "cookie",
    "set-cookie",
}
BRIDGE_JSON_LONG_TEXT_KEYS = {
    "content",
    "raw_content",
    "text",
    "assistant_text",
    "processed_data",
    "prompt",
    "message",
    "final_prompt",
    "reply",
}



def _format_log_fields(fields):
    if not fields:
        return ""
    parts = []
    for key in sorted(fields.keys()):
        value = fields[key]
        if value is None or value == "":
            continue
        parts.append(f"{key}={value}")
    return " ".join(parts)


def _bridge_clip_text(value, limit=BRIDGE_JSON_LOG_TEXT_LIMIT):
    text = str(value or "")
    if len(text) <= limit:
        return text
    return text[:limit] + f"...<truncated len={len(text)}>"


def _bridge_json_safe_value(value, depth=0):
    if depth >= 6:
        return f"<max_depth type={type(value).__name__}>"
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            key_text = str(key)
            key_lower = key_text.lower()
            if key_lower in BRIDGE_JSON_SECRET_KEYS:
                out[key_text] = "***"
                continue
            if key_lower in BRIDGE_JSON_LONG_TEXT_KEYS:
                raw_text = str(item or "")
                out[key_text] = _bridge_clip_text(raw_text)
                out[f"{key_text}_len"] = len(raw_text)
                out[f"{key_text}_truncated"] = len(raw_text) > BRIDGE_JSON_LOG_TEXT_LIMIT
                continue
            if key_lower == "messages" and isinstance(item, list):
                out["messages_count"] = len(item)
                out["messages"] = [
                    _bridge_json_safe_value(row, depth + 1)
                    for row in item[:BRIDGE_JSON_LOG_LIST_LIMIT]
                ]
                if len(item) > BRIDGE_JSON_LOG_LIST_LIMIT:
                    out["messages_truncated_count"] = len(item) - BRIDGE_JSON_LOG_LIST_LIMIT
                continue
            out[key_text] = _bridge_json_safe_value(item, depth + 1)
        return out
    if isinstance(value, list):
        rows = [
            _bridge_json_safe_value(item, depth + 1)
            for item in value[:BRIDGE_JSON_LOG_LIST_LIMIT]
        ]
        if len(value) > BRIDGE_JSON_LOG_LIST_LIMIT:
            rows.append(f"<list_truncated count={len(value) - BRIDGE_JSON_LOG_LIST_LIMIT}>")
        return rows
    if isinstance(value, tuple):
        return _bridge_json_safe_value(list(value), depth + 1)
    if isinstance(value, (str, int, float, bool)) or value is None:
        if isinstance(value, str):
            return _bridge_clip_text(value)
        return value
    return str(value)


def _bridge_json_dumps_for_log(payload):
    safe_payload = _bridge_json_safe_value(payload)
    text = json.dumps(
        safe_payload,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    if len(text) > BRIDGE_JSON_LOG_MAX_CHARS:
        return text[:BRIDGE_JSON_LOG_MAX_CHARS] + f"...<json_truncated len={len(text)}>"
    return text


_QUIET_REPORT_EVENTS = frozenset({"focus_state", "page_heartbeat"})


def _bridge_json_should_log(action, request_payload=None, response_payload=None):
    if response_payload is None and isinstance(request_payload, dict):
        if "has_message" in request_payload or request_payload.get("ok") is not None:
            response_payload = request_payload
            request_payload = None
    action = (action or "").strip()
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


def _log_bridge_json_line(line):
    """油猴桥接 JSON 日志；GUI 模式下额外 print 到命令行。"""
    _log(line, tag="bridge_json")
    if st._log_callback:
        now_text = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        print(f"[{now_text}][SERVER] {line}")


def _log_bridge_json_payload(direction, payload, *, action="", event="", message_id="", client_id=""):
    action = (action or "").strip() or "-"
    event = (event or "").strip() or "-"
    message_id = (message_id or "").strip() or "-"
    client_id = (client_id or "").strip() or "-"
    json_text = _bridge_json_dumps_for_log(payload)
    _log_bridge_json_line(
        f"[BRIDGE][JSON][{direction}] "
        f"action={action} event={event} "
        f"client_id={client_id} message_id={message_id} "
        f"json={json_text}"
    )


def _log_bridge_exchange(action, request_payload, response_payload):
    if not _bridge_json_should_log(action, request_payload, response_payload):
        return
    event = ""
    message_id = ""
    client_id = ""
    if isinstance(request_payload, dict):
        event = str(request_payload.get("event") or "")
        message_id = str(request_payload.get("message_id") or "")
        client_id = str(request_payload.get("client_id") or "")
    if not message_id and isinstance(response_payload, dict):
        message_id = str(response_payload.get("message_id") or "")
    _log_bridge_json_payload(
        "TM_TO_SERVER",
        request_payload,
        action=action,
        event=event,
        message_id=message_id,
        client_id=client_id,
    )
    _log_bridge_json_payload(
        "SERVER_TO_TM",
        response_payload,
        action=action,
        event=event,
        message_id=message_id,
        client_id=client_id,
    )


