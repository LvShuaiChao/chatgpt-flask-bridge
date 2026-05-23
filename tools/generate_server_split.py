"""Generate app/server/*.py from server.py by AST function extraction."""
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server.py"
PKG = ROOT / "app" / "server"

ASSIGN = {
    "SilentWSGIRequestHandler": "runtime_state",
    "_configure_werkzeug_access_log": "runtime_state",
    "set_debug_mode": "runtime_state",
    "is_debug_mode": "runtime_state",
    "set_log_callback": "runtime_state",
    "set_status_callback": "runtime_state",
    "set_external_gui_dispatch": "runtime_state",
    "complete_gui_dispatch": "runtime_state",
    "_dispatch_to_gui": "runtime_state",
    "_log": "runtime_state",
    "_notify_status": "runtime_state",
    "_now": "runtime_state",
    "_format_time": "runtime_state",
    "_safe_int_field": "runtime_state",
    "_tm_seen_float": "runtime_state",
    "is_tampermonkey_online": "runtime_state",
    "_client_online": "runtime_state",
    "_init_job_scheduler_hooks": "runtime_state",
    "_is_bridge_debug_enabled": "runtime_state",
    "_should_emit_bridge_log": "runtime_state",
    "_normalize_chatgpt_url_for_compare": "runtime_state",
    "is_server_running": "runtime_state",
    "get_server_bind_host": "runtime_state",
    "get_server_port": "runtime_state",
    "get_server_public_host": "runtime_state",
    "get_server_url": "runtime_state",
    "get_server_bridge_url": "runtime_state",
    "_public_host_for_bind": "runtime_state",
    "is_port_available": "runtime_state",
    "_format_bind_error_message": "runtime_state",
    "_log_start_failure": "runtime_state",
    "_write_server_url_file": "runtime_state",
    "_clear_server_url_file": "runtime_state",
    "_parse_server_port": "runtime_state",
    "start_server": "runtime_state",
    "stop_server": "runtime_state",
    "print_registered_routes": "runtime_state",
    "create_app": "runtime_state",
    "_format_log_fields": "bridge_logging",
    "_bridge_clip_text": "bridge_logging",
    "_bridge_json_safe_value": "bridge_logging",
    "_bridge_json_dumps_for_log": "bridge_logging",
    "_bridge_json_should_log": "bridge_logging",
    "_log_bridge_json_line": "bridge_logging",
    "_log_bridge_json_payload": "bridge_logging",
    "_log_bridge_exchange": "bridge_logging",
    "_cursor_now_ts": "cursor_api",
    "_cursor_safe_text": "cursor_api",
    "enqueue_cursor_task": "cursor_api",
    "claim_next_cursor_task": "cursor_api",
    "append_cursor_task_report": "cursor_api",
    "update_cursor_client_heartbeat": "cursor_api",
    "get_cursor_bridge_status": "cursor_api",
    "_is_ignored_page": "page_registry",
    "_page_registry_key": "page_registry",
    "_tm_page_display_key": "page_registry",
    "_allocate_tm_page_display_id": "page_registry",
    "_ensure_tm_page_display_id": "page_registry",
    "_bridge_runtime_patch_for_body": "page_registry",
    "_apply_bridge_runtime_patch": "page_registry",
    "_cleanup_tm_page_display_ids": "page_registry",
    "_register_bridge_client_report": "page_registry",
    "_tm_registry_counts": "page_registry",
    "_iter_page_registry_entries": "page_registry",
    "_registry_entry_for_client": "page_registry",
    "_clear_bound_session_on_registry": "page_registry",
    "_overwrite_page_identity_fields": "page_registry",
    "_sync_tampermonkey_page_registry": "page_registry",
    "get_tm_online_summary": "page_registry",
    "_snapshot_clients": "page_registry",
    "_maybe_log_tm_activity_classify": "page_registry",
    "_meta_has_focus": "page_registry",
    "_normalized_last_focused_page": "page_registry",
    "_update_last_focused_tm_page": "page_registry",
    "_touch_tampermonkey": "page_registry",
    "get_bridge_status": "message_queue",
    "push_message": "message_queue",
    "get_message_state": "message_queue",
    "cancel_message": "message_queue",
    "get_bridge_message_id": "message_queue",
    "_bridge_message_id_matches": "message_queue",
    "_sync_message_status_fields": "message_queue",
    "_set_message_status": "message_queue",
    "_add_inbound": "message_queue",
    "_find_outbound_message": "message_queue",
    "_finalize_control_message": "message_queue",
    "_is_finalized": "message_queue",
    "_finalize_message": "message_queue",
    "_normalize_page_url": "message_queue",
    "_archive_waiting": "message_queue",
    "_waiting_messages_for_client": "message_queue",
    "_get_waiting_message_for_client": "message_queue",
    "_message_target_client_id": "message_queue",
    "_message_matches_client": "message_queue",
    "_targeted_control_matches": "message_queue",
    "_message_matches_page": "message_queue",
    "_pop_message_for_client": "message_queue",
    "_pop_control_command_for_client": "message_queue",
    "_claim_message": "message_queue",
    "_poll_identity_changed": "message_queue",
    "_poll_log_immediate": "message_queue",
    "_poll_log_rate_limited": "message_queue",
    "_record_poll_empty": "message_queue",
    "_record_poll_claimed": "message_queue",
    "_flush_poll_summary": "message_queue",
    "_poll_response": "message_queue",
    "_outbound_queue_stats": "message_queue",
    "_poll_minimal_idle_response": "message_queue",
    "_poll_idle_response": "message_queue",
    "_poll_response_needs_runtime_patch": "message_queue",
    "_poll_no_message_reason": "message_queue",
    "_log_poll_request": "message_queue",
    "_log_poll_no_message": "message_queue",
    "_log_poll_message_found": "message_queue",
    "_handle_poll": "message_queue",
    "_handle_ack": "message_queue",
    "_report_recv_fields": "message_queue",
    "_log_finalized": "message_queue",
    "_handle_report": "message_queue",
    "_copy_existing_fields": "message_queue",
    "_queue_control_message": "control_commands",
    "_append_control_messages": "control_commands",
    "push_open_url": "control_commands",
    "_make_command_message": "control_commands",
    "_push_targeted_page_command": "control_commands",
    "push_close_page": "control_commands",
    "_enqueue_control_command_result": "control_commands",
    "enqueue_control_command": "control_commands",
    "push_close_other_pages": "control_commands",
    "_external_auth_ok": "external_api",
    "_external_json_error": "external_api",
    "_external_json_ok": "external_api",
    "_new_external_request_id": "external_api",
    "_external_request_status": "external_api",
    "_set_external_request_status": "external_api",
    "_message_allow_same_conversation_fallback": "external_api",
    "_register_external_request": "external_api",
    "attach_external_request_bridge": "external_api",
    "_update_external_status_for_bridge": "external_api",
    "_notify_external_request_from_bridge": "external_api",
    "_external_req_float": "external_api",
    "_check_external_request_timeout": "external_api",
    "_get_external_request": "external_api",
    "count_user_turns": "external_api",
    "_parse_external_timeout": "external_api",
    "_parse_force_new_session_after_turns": "external_api",
    "_safe_meta_int": "external_api",
    "_external_session_meta_from_gui": "external_api",
    "_log_force_new_session_if_needed": "external_api",
    "_external_sessions_summary_from_gui": "external_api",
    "_external_client_key": "external_api",
    "_resolve_external_session_for_send": "external_api",
    "_remember_external_client_session": "external_api",
    "_external_create_chat_send": "external_api",
    "_require_external_auth": "external_api",
    "_external_auth_denied": "external_api",
    "_request_body_preview": "external_api",
    "_json_body_or_error": "external_api",
    "api_v1_status": "routes",
    "api_v1_chat_send": "routes",
    "api_v1_chat_result": "routes",
    "api_v1_chat_ask": "routes",
    "api_v1_sessions": "routes",
    "api_v1_session_detail": "routes",
    "api_v1_session_bind": "routes",
    "_is_local_remote_addr": "bridge_api",
    "api_bridge": "bridge_api",
    "api_cursor_tasks_create": "routes",
    "api_cursor_tasks_next": "routes",
    "api_cursor_tasks_report": "routes",
    "api_cursor_tasks_status": "routes",
    "api_cursor_client_heartbeat": "routes",
    "send_job_chatgpt_message": "routes",
    "send_job_to_cursor": "routes",
    "api_jobs_create": "routes",
    "api_jobs_list": "routes",
    "api_jobs_status": "routes",
    "api_jobs_send_to_cursor": "routes",
    "api_jobs_cancel": "routes",
    "health": "routes",
    "before_request": "routes",
    "after_request": "routes",
    "handle_unexpected_route_error": "routes",
}

MODULE_IMPORTS = {
    "runtime_state": '''"""Server lifecycle, logging, callbacks, debug mode."""
from __future__ import annotations

import json
import logging
import socket
import threading
import time
import traceback
import uuid

from flask import Flask, jsonify
from flask_cors import CORS
from app.utils.log_utils import append_log, clear_log_file
from werkzeug.serving import WSGIRequestHandler, make_server

from app.core import job_scheduler as _job_scheduler
from app.server import state as st

''',
    "bridge_logging": '''"""Bridge JSON request/response logging."""
from __future__ import annotations

import json
import time

from app.server import state as st
from app.server.runtime_state import _is_bridge_debug_enabled, _log, _log_callback

''',
    "page_registry": '''"""Tampermonkey client/page registry."""
from __future__ import annotations

import time
import traceback

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
from app.server.runtime_state import (
    _client_online,
    _format_time,
    _log,
    _now,
    _notify_status,
    _safe_int_field,
    _tm_seen_float,
    is_debug_mode,
)
from app.server.session_bindings import clear_session_binding, gc_orphan_session_bindings

''',
    "message_queue": '''"""Outbound/inbound message queues, poll/ack/report handlers."""
from __future__ import annotations

import traceback
import uuid

from app.core import job_scheduler as _job_scheduler
from app.server import state as st
from app.server.state import BridgeQueueFullError
from app.utils.bridge_payload import (
    migrate_outbound_queue_message,
    normalize_inbound_push_payload,
    normalize_outbound_bridge_message,
    read_bridge_client_id,
    read_bridge_page_instance_id,
)
from app.utils.legacy_cleanup import assert_no_legacy_fields
from app.utils.page_status import normalize_page_url_fields, page_url_from
from app.server.runtime_state import (
    _format_time,
    _log,
    _now,
    _notify_status,
    is_debug_mode,
)
from app.server import page_registry as pr
from app.server import control_commands as cc
from app.server import external_api as ext

''',
    "control_commands": '''"""Control command queue (open/close page, sync, etc.)."""
from __future__ import annotations

import uuid

from app.server import state as st
from app.server.state import BridgeQueueFullError
from app.server.runtime_state import _log, _notify_status
from app.server import message_queue as mq

''',
    "cursor_api": '''"""Cursor bridge task queue (non-HTTP)."""
from __future__ import annotations

import time

from app.server import state as st
from app.server.runtime_state import _format_time, _log, _now

''',
    "external_api": '''"""External REST API helpers (/api/v1/*)."""
from __future__ import annotations

import time
import traceback
import uuid

from flask import jsonify, request

from app.server import state as st
from app.server.runtime_state import (
    _dispatch_to_gui,
    _log,
    _notify_status,
    _now,
)
from app.server import message_queue as mq
from app.server import page_registry as pr

''',
    "bridge_api": '''"""Tampermonkey /api/bridge handler."""
from __future__ import annotations

from flask import jsonify, request

from app.server import state as st
from app.server.runtime_state import _log, _now, _notify_status, is_debug_mode
from app.server import bridge_logging as bl
from app.server import message_queue as mq
from app.server import page_registry as pr
from app.server.external_api import _external_auth_denied, _json_body_or_error

''',
    "routes": '''"""Flask route handlers and HTTP middleware."""
from __future__ import annotations

import time
import traceback

from flask import jsonify, request
from werkzeug.exceptions import HTTPException

from app.core import job_scheduler as _job_scheduler
from app.server import state as st
from app.server.runtime_state import _log, is_debug_mode
from app.server import bridge_api
from app.server import cursor_api
from app.server import external_api as ext
from app.server import message_queue as mq
from app.server import page_registry as pr

''',
}

# Map bare names used across modules -> import prefix
CROSS_REFS = {
    "runtime_state": {},
    "bridge_logging": {"_log": "runtime_state", "_log_callback": "state"},
    "page_registry": {
        "_state_lock": "st",
        "_tampermonkey_clients": "st",
        "_tampermonkey_pages": "st",
        "_known_page_instances": "st",
        "_tm_page_display_id_by_key": "st",
        "_tm_page_display_id_updated_at": "st",
        "_last_focused_tm_page": "st",
        "_last_focused_tm_page_at": "st",
        "_last_focused_update_log_key": "st",
        "_last_tm_activity_classify_log": "st",
        "_last_tm_response_state_log": "st",
        "_tm_prev_snapshot": "st",
        "LAST_FOCUSED_TM_PAGE_MAX_AGE_SEC": "st",
        "POLL_SUMMARY_INTERVAL_SEC": "st",
        "ONLINE_TIMEOUT_SEC": "st",
    },
}


def extract_constants(src: str) -> str:
    """Lines 139-165 constants for bridge_logging."""
    lines = src.splitlines(keepends=True)
    return "".join(lines[138:165])


def extract_function_chunks(src: str) -> dict[str, list[str]]:
    lines = src.splitlines(keepends=True)
    tree = ast.parse(src)
    mods: dict[str, list[str]] = {k: [] for k in set(ASSIGN.values())}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            mod = ASSIGN.get(node.name)
            if mod:
                mods[mod].append("".join(lines[node.lineno - 1 : node.end_lineno]))
    return mods


def patch_state_refs(body: str, mod: str) -> str:
    """Replace module-level globals with st.* where appropriate."""
    subs = [
        (r"\b_state_lock\b", "st._state_lock"),
        (r"\b_debug_mode\b", "st._debug_mode"),
        (r"\b_log_callback\b", "st._log_callback"),
        (r"\b_status_callback\b", "st._status_callback"),
        (r"\b_external_gui_dispatch\b", "st._external_gui_dispatch"),
        (r"\b_http_server\b", "st._http_server"),
        (r"\b_server_thread\b", "st._server_thread"),
        (r"\b_server_bind_host\b", "st._server_bind_host"),
        (r"\b_server_port\b", "st._server_port"),
        (r"\b_server_public_host\b", "st._server_public_host"),
        (r"\b_tampermonkey_clients\b", "st._tampermonkey_clients"),
        (r"\b_tampermonkey_pages\b", "st._tampermonkey_pages"),
        (r"\b_outbound_queue\b", "st._outbound_queue"),
        (r"\b_outbound_waiting\b", "st._outbound_waiting"),
        (r"\b_control_queue\b", "st._control_queue"),
        (r"\b_control_waiting\b", "st._control_waiting"),
        (r"\b_inbound_messages\b", "st._inbound_messages"),
        (r"\b_outbound_history\b", "st._outbound_history"),
        (r"\b_external_requests\b", "st._external_requests"),
        (r"\b_bridge_message_to_external\b", "st._bridge_message_to_external"),
        (r"\b_pending_gui_actions\b", "st._pending_gui_actions"),
        (r"\b_external_action_lock\b", "st._external_action_lock"),
        (r"\b_external_client_sessions\b", "st._external_client_sessions"),
        (r"\bcursor_task_queue\b", "st.cursor_task_queue"),
        (r"\bcursor_task_reports\b", "st.cursor_task_reports"),
        (r"\bcursor_task_history\b", "st.cursor_task_history"),
        (r"\bcursor_task_lock\b", "st.cursor_task_lock"),
        (r"\bcursor_client_state\b", "st.cursor_client_state"),
    ]
    if mod == "runtime_state":
        # keep local aliases for http server vars we assign with global
        for pat, repl in subs[:10]:
            body = re.sub(pat, repl, body)
        return body
    for pat, repl in subs:
        body = re.sub(pat, repl, body)
    return body


def write_modules(chunks: dict[str, list[str]], constants: str) -> None:
    PKG.mkdir(parents=True, exist_ok=True)
    for mod, parts in chunks.items():
        body = "\n\n".join(patch_state_refs(p, mod) for p in parts)
        header = MODULE_IMPORTS.get(mod, "")
        if mod == "bridge_logging":
            body = constants + "\n\n" + body
        path = PKG / f"{mod}.py"
        path.write_text(header + body, encoding="utf-8")
        print(f"wrote {path.name} ({len(parts)} defs)")


def extend_state() -> None:
    extra = '''

import uuid
import time
from collections import deque

_server_instance_id = str(uuid.uuid4())
_server_start_time = time.time()
_external_requests = {}
_bridge_message_to_external = {}
_session_external_pending = {}
_pending_gui_actions = {}
_external_action_lock = threading.Lock()
_external_client_sessions = {}
DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS = 0

cursor_task_queue = deque()
cursor_task_reports = deque(maxlen=200)
cursor_task_history = deque(maxlen=200)
cursor_task_lock = threading.RLock()
cursor_client_state = {
    "client_id": "",
    "name": "",
    "version": "",
    "status": "never_seen",
    "last_seen": 0.0,
    "last_seen_text": "",
    "last_task_claim_at": 0.0,
    "last_task_id": "",
    "last_report_at": 0.0,
    "last_report_status": "",
    "last_report_message": "",
}
CURSOR_ONLINE_TIMEOUT_SEC = 15
'''
    p = PKG / "state.py"
    text = p.read_text(encoding="utf-8")
    if "_external_requests" not in text:
        p.write_text(text.rstrip() + extra, encoding="utf-8")


def write_create_app_and_routes_register() -> None:
    runtime = PKG / "runtime_state.py"
    text = runtime.read_text(encoding="utf-8")
    if "def create_app" not in text:
        create_app = '''

def create_app():
    """Build Flask app and register all routes."""
    app = Flask(__name__)
    CORS(app)
    app.logger.setLevel("ERROR")
    app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
    from app.server import routes

    routes.register_routes(app)
    _configure_werkzeug_access_log()
    return app
'''
        text = text.replace(
            "def start_server(host=",
            create_app + "\ndef start_server(host=",
        )
        # start_server uses `app` — bind module-level app
        text = text.replace(
            "def create_app():",
            "app = None  # set by create_app()\n\ndef create_app():",
        )
        runtime.write_text(text, encoding="utf-8")

    routes = PKG / "routes.py"
    rt = routes.read_text(encoding="utf-8")
    if "def register_routes" not in rt:
        # strip @app.route decorators -> register manually
        reg = '''

def register_routes(app):
    """Attach all HTTP routes and middleware to *app*."""
    import app.server.routes as self_mod
    app.add_url_rule("/api/v1/status", view_func=self_mod.api_v1_status, methods=["GET"])
    app.add_url_rule("/api/v1/chat/send", view_func=self_mod.api_v1_chat_send, methods=["POST"])
    app.add_url_rule("/api/v1/chat/result/<request_id>", view_func=self_mod.api_v1_chat_result, methods=["GET"])
    app.add_url_rule("/api/v1/chat/ask", view_func=self_mod.api_v1_chat_ask, methods=["POST"])
    app.add_url_rule("/api/v1/sessions", view_func=self_mod.api_v1_sessions, methods=["GET", "POST"])
    app.add_url_rule("/api/v1/sessions/<session_id>", view_func=self_mod.api_v1_session_detail, methods=["GET"])
    app.add_url_rule("/api/v1/sessions/<session_id>/bind", view_func=self_mod.api_v1_session_bind, methods=["POST", "DELETE"])
    app.add_url_rule("/api/bridge", view_func=bridge_api.api_bridge, methods=["POST"])
    app.add_url_rule("/api/cursor/tasks/create", view_func=self_mod.api_cursor_tasks_create, methods=["POST"])
    app.add_url_rule("/api/cursor/tasks/next", view_func=self_mod.api_cursor_tasks_next, methods=["GET"])
    app.add_url_rule("/api/cursor/tasks/report", view_func=self_mod.api_cursor_tasks_report, methods=["POST"])
    app.add_url_rule("/api/cursor/tasks/status", view_func=self_mod.api_cursor_tasks_status, methods=["GET"])
    app.add_url_rule("/api/cursor/client/heartbeat", view_func=self_mod.api_cursor_client_heartbeat, methods=["POST"])
    app.add_url_rule("/api/jobs/create", view_func=self_mod.api_jobs_create, methods=["POST"])
    app.add_url_rule("/api/jobs/list", view_func=self_mod.api_jobs_list, methods=["GET"])
    app.add_url_rule("/api/jobs/status", view_func=self_mod.api_jobs_status, methods=["GET"])
    app.add_url_rule("/api/jobs/send_to_cursor", view_func=self_mod.api_jobs_send_to_cursor, methods=["POST"])
    app.add_url_rule("/api/jobs/cancel", view_func=self_mod.api_jobs_cancel, methods=["POST"])
    app.add_url_rule("/health", view_func=self_mod.health, methods=["GET"])
    app.before_request(self_mod.before_request)
    app.after_request(self_mod.after_request)
    app.errorhandler(Exception)(self_mod.handle_unexpected_route_error)
'''
        rt = re.sub(r"@app\.route\([^)]+\)\s*\n", "", rt)
        routes.write_text(rt + reg, encoding="utf-8")


def write_server_py() -> None:
    SERVER.write_text(
        '''"""Flask bridge entry — thin facade over app.server."""
from __future__ import annotations

from app.server.message_queue import get_bridge_status, push_message
from app.server.runtime_state import (
    create_app,
    is_server_running,
    start_server,
    stop_server,
)

# Backward compatibility: delegate unknown attributes to app.server
def __getattr__(name: str):
    import app.server as pkg
    return getattr(pkg, name)


def __dir__():
    import app.server as pkg
    return sorted(set(globals()) | set(dir(pkg)))
''',
        encoding="utf-8",
    )


def write_app_server_init() -> None:
    init = PKG / "__init__.py"
    init.write_text(
        '''"""Flask bridge server package."""
from app.server.runtime_state import (
    create_app,
    is_server_running,
    start_server,
    stop_server,
    set_debug_mode,
    is_debug_mode,
    set_log_callback,
    set_status_callback,
    set_external_gui_dispatch,
    complete_gui_dispatch,
    get_server_url,
    get_server_bridge_url,
    get_server_bind_host,
    get_server_port,
    get_server_public_host,
)
from app.server.message_queue import (
    get_bridge_status,
    push_message,
    get_message_state,
    cancel_message,
    get_bridge_message_id,
)
from app.server.page_registry import get_tm_online_summary
from app.server.control_commands import (
    enqueue_control_command,
    push_open_url,
    push_close_page,
    push_close_other_pages,
)
from app.server.cursor_api import (
    enqueue_cursor_task,
    claim_next_cursor_task,
    append_cursor_task_report,
    update_cursor_client_heartbeat,
    get_cursor_bridge_status,
)
from app.server.external_api import attach_external_request_bridge, count_user_turns

''',
        encoding="utf-8",
    )


def main() -> None:
    src = SERVER.read_text(encoding="utf-8")
    constants = extract_constants(src)
    chunks = extract_function_chunks(src)
    extend_state()
    write_modules(chunks, constants)
    write_create_app_and_routes_register()
    write_app_server_init()
    write_server_py()
    print("generation complete — run tests and fix cross-imports")


if __name__ == "__main__":
    main()
