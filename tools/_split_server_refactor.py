"""One-shot: split server.py into app/server/*.py. Run from project root."""
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "server.py"
OUT_DIR = ROOT / "app" / "server"

# (module_name, function_names) — names must match server.py defs exactly
MODULE_FUNCS: dict[str, list[str]] = {
    "runtime_state": [
        "SilentWSGIRequestHandler",
        "_configure_werkzeug_access_log",
        "set_debug_mode",
        "is_debug_mode",
        "_format_log_fields",
        "_bridge_clip_text",
        "_bridge_json_safe_value",
        "_bridge_json_dumps_for_log",
        "_bridge_json_should_log",
        "_log_bridge_json_line",
        "_log_bridge_json_payload",
        "_log_bridge_exchange",
        "set_log_callback",
        "set_status_callback",
        "set_external_gui_dispatch",
        "complete_gui_dispatch",
        "_dispatch_to_gui",
        "_is_bridge_debug_enabled",
        "_should_emit_bridge_log",
        "_normalize_chatgpt_url_for_compare",
        "_log",
        "_init_job_scheduler_hooks",
        "_notify_status",
        "_now",
        "_format_time",
        "_safe_int_field",
        "_tm_seen_float",
        "is_server_running",
        "get_server_bind_host",
        "get_server_port",
        "get_server_public_host",
        "get_server_url",
        "get_server_bridge_url",
        "_public_host_for_bind",
        "is_port_available",
        "_format_bind_error_message",
        "_log_start_failure",
        "_write_server_url_file",
        "_clear_server_url_file",
        "_parse_server_port",
        "start_server",
        "stop_server",
    ],
    "page_registry": [
        "is_tampermonkey_online",
        "_client_online",
        "_is_ignored_page",
        "_page_registry_key",
        "_tm_page_display_key",
        "_allocate_tm_page_display_id",
        "_ensure_tm_page_display_id",
        "_bridge_runtime_patch_for_body",
        "_apply_bridge_runtime_patch",
        "_cleanup_tm_page_display_ids",
        "_register_bridge_client_report",
        "_tm_registry_counts",
        "_iter_page_registry_entries",
        "_registry_entry_for_client",
        "_clear_bound_session_on_registry",
        "_overwrite_page_identity_fields",
        "_sync_tampermonkey_page_registry",
        "get_tm_online_summary",
        "_snapshot_clients",
        "_maybe_log_tm_activity_classify",
        "_meta_has_focus",
        "_normalized_last_focused_page",
        "_update_last_focused_tm_page",
        "_touch_tampermonkey",
    ],
    "message_queue": [
        "get_bridge_message_id",
        "_bridge_message_id_matches",
        "_sync_message_status_fields",
        "_set_message_status",
        "get_bridge_status",
        "push_message",
        "get_message_state",
        "cancel_message",
        "_add_inbound",
        "_find_outbound_message",
        "_finalize_control_message",
        "_is_finalized",
        "_finalize_message",
        "_normalize_page_url",
        "_archive_waiting",
        "_waiting_messages_for_client",
        "_get_waiting_message_for_client",
        "_message_target_client_id",
        "_message_matches_client",
        "_targeted_control_matches",
        "_message_matches_page",
        "_pop_message_for_client",
        "_pop_control_command_for_client",
        "_claim_message",
        "_outbound_queue_stats",
        "_copy_existing_fields",
    ],
    "control_commands": [
        "_queue_control_message",
        "_append_control_messages",
        "push_open_url",
        "_make_command_message",
        "_push_targeted_page_command",
        "push_close_page",
        "_enqueue_control_command_result",
        "enqueue_control_command",
        "push_close_other_pages",
    ],
    "cursor_api": [
        "_cursor_now_ts",
        "_cursor_safe_text",
        "enqueue_cursor_task",
        "claim_next_cursor_task",
        "append_cursor_task_report",
        "update_cursor_client_heartbeat",
        "get_cursor_bridge_status",
        "send_job_chatgpt_message",
        "send_job_to_cursor",
    ],
    "bridge_api": [
        "_poll_identity_changed",
        "_poll_log_immediate",
        "_poll_log_rate_limited",
        "_record_poll_empty",
        "_record_poll_claimed",
        "_flush_poll_summary",
        "_poll_response",
        "_poll_minimal_idle_response",
        "_poll_idle_response",
        "_poll_response_needs_runtime_patch",
        "_poll_no_message_reason",
        "_log_poll_request",
        "_log_poll_no_message",
        "_log_poll_message_found",
        "_handle_poll",
        "_handle_ack",
        "_report_recv_fields",
        "_log_finalized",
        "_handle_report",
        "_is_local_remote_addr",
    ],
    "external_api": [
        "_external_auth_ok",
        "_external_json_error",
        "_external_json_ok",
        "_new_external_request_id",
        "_external_request_status",
        "_set_external_request_status",
        "_message_allow_same_conversation_fallback",
        "_register_external_request",
        "attach_external_request_bridge",
        "_update_external_status_for_bridge",
        "_notify_external_request_from_bridge",
        "_external_req_float",
        "_check_external_request_timeout",
        "_get_external_request",
        "count_user_turns",
        "_parse_external_timeout",
        "_parse_force_new_session_after_turns",
        "_safe_meta_int",
        "_external_session_meta_from_gui",
        "_log_force_new_session_if_needed",
        "_external_sessions_summary_from_gui",
        "_external_client_key",
        "_resolve_external_session_for_send",
        "_remember_external_client_session",
        "_external_create_chat_send",
        "_require_external_auth",
        "_external_auth_denied",
        "_request_body_preview",
        "_json_body_or_error",
    ],
    "routes": [
        "print_registered_routes",
        "api_v1_status",
        "api_v1_chat_send",
        "api_v1_chat_result",
        "api_v1_chat_ask",
        "api_v1_sessions",
        "api_v1_session_detail",
        "api_v1_session_bind",
        "api_bridge",
        "api_cursor_tasks_create",
        "api_cursor_tasks_next",
        "api_cursor_tasks_report",
        "api_cursor_tasks_status",
        "api_cursor_client_heartbeat",
        "api_jobs_create",
        "api_jobs_list",
        "api_jobs_status",
        "api_jobs_send_to_cursor",
        "api_jobs_cancel",
        "health",
        "before_request",
        "after_request",
        "handle_unexpected_route_error",
    ],
}

# Module-level code blocks (line ranges 1-based inclusive) appended after functions
MODULE_EXTRA: dict[str, list[tuple[int, int]]] = {
    "runtime_state": [
        (139, 165),  # BRIDGE_JSON_* constants
    ],
    "cursor_api": [
        (295, 314),  # cursor globals
    ],
}

MODULE_HEADERS: dict[str, str] = {
    "runtime_state": '''"""Flask 应用工厂、日志、回调与 HTTP 服务生命周期。"""
from __future__ import annotations

import json
import logging
import socket
import threading
import time
import traceback
import uuid
from flask import Flask, jsonify, request
from flask_cors import CORS
from app.utils.log_utils import append_log
from werkzeug.exceptions import HTTPException
from werkzeug.serving import WSGIRequestHandler, make_server

from app.core import job_scheduler as _job_scheduler
from app.server import state as st
from app.server.state import (
    API_TOKEN,
    FALLBACK_PORTS,
    RUNTIME_DIR,
    SERVER_URL_FILE,
    _state_lock,
)

''',
    "page_registry": '''"""油猴客户端与页面 registry。"""
from __future__ import annotations

import time

from app.url_utils import parse_conversation_id
from app.utils.page_status import (
    build_page_key,
    explain_page_decision,
    get_page_liveness,
    is_page_online,
    normalize_page_url_fields,
    page_url_from,
)
from app.utils.tm_activity import classify_tm_client_activity, compute_tm_activity_metrics

from app.server import state as st
from app.server.state import (
    LAST_FOCUSED_TM_PAGE_MAX_AGE_SEC,
    ONLINE_TIMEOUT_SEC,
    POLL_SUMMARY_INTERVAL_SEC,
    _known_page_instances,
    _last_focused_tm_page,
    _last_focused_tm_page_at,
    _last_focused_update_log_key,
    _last_poll_empty_log_at,
    _last_poll_identity,
    _last_poll_other_reason_log_at,
    _last_tm_activity_classify_log,
    _last_tm_response_state_log,
    _poll_summaries,
    _state_lock,
    _tampermonkey_clients,
    _tampermonkey_pages,
    _tm_page_display_id_by_key,
    _tm_page_display_id_updated_at,
    _tm_prev_snapshot,
    tampermonkey_client_id,
    tampermonkey_last_seen,
    tampermonkey_page_url,
)
from app.server.runtime_state import (
    _format_time,
    _log,
    _notify_status,
    _now,
    _safe_int_field,
    _tm_seen_float,
    is_debug_mode,
)

''',
    "message_queue": '''"""出站/入站消息队列与桥接状态快照。"""
from __future__ import annotations

import time
import uuid

from app.utils.bridge_payload import (
    migrate_outbound_queue_message,
    normalize_inbound_push_payload,
    normalize_outbound_bridge_message,
    read_bridge_client_id,
    read_bridge_page_instance_id,
)
from app.utils.legacy_cleanup import assert_no_legacy_fields
from app.utils.page_status import page_url_from

from app.server import state as st
from app.server.state import (
    BridgeQueueFullError,
    LEASE_SEC,
    MAX_CONTROL_QUEUE_SIZE,
    MAX_OUTBOUND_QUEUE_SIZE,
    _control_queue,
    _control_waiting,
    _inbound_messages,
    _outbound_history,
    _outbound_queue,
    _outbound_waiting,
    _state_lock,
)
from app.server.runtime_state import _log, _notify_status, _now
from app.server.page_registry import _snapshot_clients, _touch_tampermonkey

''',
    "control_commands": '''"""控制命令队列（打开/关闭页面、同步等）。"""
from __future__ import annotations

import uuid

from app.utils.bridge_payload import normalize_outbound_bridge_message
from app.utils.legacy_cleanup import assert_no_legacy_fields

from app.server.state import (
    MAX_CONTROL_QUEUE_SIZE,
    _control_queue,
    _control_waiting,
    _state_lock,
)
from app.server.message_queue import get_bridge_message_id
from app.server.runtime_state import _log, _notify_status, _now

''',
    "cursor_api": '''"""Cursor Bridge 任务队列与心跳。"""
from __future__ import annotations

import threading
import time
import traceback
import uuid
from collections import deque

from app.core import job_scheduler as _job_scheduler

from app.server.runtime_state import _log, _notify_status

''',
    "bridge_api": '''"""油猴 poll / ack / report 处理。"""
from __future__ import annotations

import traceback

from app.core import job_scheduler as _job_scheduler
from app.utils.legacy_cleanup import assert_no_legacy_fields
from app.utils.page_status import normalize_page_url_fields, page_url_from

from app.server import state as st
from app.server.state import (
    _control_waiting,
    _outbound_queue,
    _outbound_waiting,
    _state_lock,
    _tampermonkey_clients,
    _tampermonkey_pages,
)
from app.server.control_commands import _pop_control_command_for_client
from app.server.message_queue import (
    _add_inbound,
    _archive_waiting,
    _claim_message,
    _copy_existing_fields,
    _finalize_control_message,
    _finalize_message,
    _get_waiting_message_for_client,
    _is_finalized,
    _message_matches_client,
    _outbound_queue_stats,
    _pop_message_for_client,
    get_bridge_message_id,
)
from app.server.page_registry import (
    _apply_bridge_runtime_patch,
    _bridge_runtime_patch_for_body,
    _page_registry_key,
    _register_bridge_client_report,
    _tm_registry_counts,
    _touch_tampermonkey,
)
from app.server.runtime_state import (
    _log,
    _log_bridge_exchange,
    _notify_status,
    _now,
    is_debug_mode,
)

''',
    "external_api": '''"""外部 REST API（/api/v1/*）逻辑。"""
from __future__ import annotations

import traceback
import uuid

from flask import jsonify, request
from werkzeug.exceptions import BadRequest

from app.server import state as st
from app.server.state import API_TOKEN, _state_lock
from app.server.message_queue import _message_allow_same_conversation_fallback
from app.server.runtime_state import (
    DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS,
    _dispatch_to_gui,
    _log,
    _now,
)

''',
    "routes": '''"""Flask 路由注册与 HTTP 中间件。"""
from __future__ import annotations

import time
import traceback

from flask import jsonify, request
from werkzeug.exceptions import HTTPException

from app.core import job_scheduler as _job_scheduler
from app.server.bridge_api import handle_bridge_request
from app.server.cursor_api import (
    append_cursor_task_report,
    claim_next_cursor_task,
    enqueue_cursor_task,
    get_cursor_bridge_status,
    update_cursor_client_heartbeat,
)
from app.server.external_api import (
    _external_auth_denied,
    _external_create_chat_send,
    _external_json_error,
    _external_json_ok,
    _external_sessions_summary_from_gui,
    _get_external_request,
    _json_body_or_error,
    _require_external_auth,
)
from app.server.message_queue import get_bridge_status
from app.server.page_registry import get_tm_online_summary
from app.server.runtime_state import (
    _log,
    is_debug_mode,
)
from app.server.state import (
    _control_queue,
    _outbound_queue,
    _outbound_waiting,
    _state_lock,
)

''',
}


def extract_functions(source: str) -> dict[str, tuple[int, int, str]]:
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    out: dict[str, tuple[int, int, str]] = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            start = node.lineno - 1
            end = node.end_lineno
            out[node.name] = (start, end, "".join(lines[start:end]))
    return out


def extract_line_range(source: str, start: int, end: int) -> str:
    lines = source.splitlines(keepends=True)
    return "".join(lines[start - 1 : end])


def main() -> None:
    source = SERVER_PATH.read_text(encoding="utf-8")
    funcs = extract_functions(source)

    for mod, names in MODULE_FUNCS.items():
        parts: list[str] = [MODULE_HEADERS[mod]]
        for name in names:
            if name not in funcs:
                raise SystemExit(f"{mod}: missing function {name!r}")
            parts.append(funcs[name][2])
            if not parts[-1].endswith("\n"):
                parts.append("\n")
        for start, end in MODULE_EXTRA.get(mod, []):
            block = extract_line_range(source, start, end)
            parts.append(block)
            if not block.endswith("\n"):
                parts.append("\n")
        path = OUT_DIR / f"{mod}.py"
        path.write_text("".join(parts), encoding="utf-8")
        print(f"wrote {path} ({len(names)} defs)")

    print("done — manual fixes: create_app, handle_bridge_request, register_routes, server.py, state.py, __init__.py")


if __name__ == "__main__":
    main()
