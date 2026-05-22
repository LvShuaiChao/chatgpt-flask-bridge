"""GUI 侧桥接完整 JSON 日志。"""
from __future__ import annotations

import traceback

from app.utils.bridge_json_file_log import append_bridge_json_log
from app.utils.json_log import dumps_full_json_for_log
from log_utils import append_log


def format_gui_send_payload_full_log(
    *,
    trace_id="-",
    session_id="-",
    turn_id="-",
    user_message_id="-",
    assistant_message_id="-",
    bridge_message_id="-",
    payload,
):
    payload = payload if isinstance(payload, dict) else {}
    lines = [
        "[GUI][JSON][SEND_PAYLOAD_FULL]",
        f"trace_id={trace_id or '-'}",
        f"session_id={session_id or '-'}",
        f"turn_id={turn_id or '-'}",
        f"user_message_id={user_message_id or '-'}",
        f"assistant_message_id={assistant_message_id or '-'}",
        f"bridge_message_id={bridge_message_id or '-'}",
        f"client_id={payload.get('client_id') or '-'}",
        f"page_instance_id={payload.get('page_instance_id') or '-'}",
        f"conversation_id={payload.get('conversation_id') or '-'}",
        f"url={payload.get('url') or '-'}",
        f"json={dumps_full_json_for_log(payload)}",
    ]
    return "\n".join(lines)


def log_gui_send_payload_full(**kwargs):
    try:
        line = format_gui_send_payload_full_log(**kwargs)
        append_bridge_json_log(line)
        append_log(line, source="GUI", echo=True, force=True)
        return line
    except Exception as exc:
        detail = (
            "[GUI][JSON][SEND_PAYLOAD_FULL][LOG_FAILED] "
            f"error_type={type(exc).__name__} "
            f"error={exc}\n{traceback.format_exc()}"
        )
        append_log(detail, source="GUI", echo=True, level="ERROR", force=True)
        return detail
