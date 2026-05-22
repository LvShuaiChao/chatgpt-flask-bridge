"""Split server.py into app/server/*.py modules."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server.py"
PKG = ROOT / "app" / "server"

# (filename, start_line, end_line) — 1-based inclusive
SECTIONS: list[tuple[str, int, int]] = [
    ("bridge_logging.py", 139, 293),
    ("page_registry.py", 524, 1082),
    ("message_queue.py", 538, 565),
    ("message_queue.py", 1083, 1259),
    ("message_queue.py", 2164, 3590),
    ("control_commands.py", 1260, 1411),
    ("control_commands.py", 1654, 1798),
    ("cursor_api.py", 295, 314),
    ("cursor_api.py", 1422, 1631),
    ("external_api.py", 3593, 4217),
    ("routes.py", 4220, 4814),
    ("routes.py", 5147, 5207),
    ("runtime_state.py", 74, 86),
    ("runtime_state.py", 115, 125),
    ("runtime_state.py", 322, 480),
    ("runtime_state.py", 4816, 5145),
]

COMMON_HEADER = '''"""Auto-extracted from server.py — see split_server_refactor.py."""
from __future__ import annotations

import json
import logging
import socket
import threading
import time
import traceback
import uuid
from collections import deque

from flask import Flask, jsonify, request
from flask_cors import CORS
from log_utils import append_log, clear_log_file
from werkzeug.exceptions import BadRequest, HTTPException
from werkzeug.serving import WSGIRequestHandler, make_server

from app.core import job_scheduler as _job_scheduler
from app.server import state as st
from app.server.session_bindings import (
    clear_session_binding,
    gc_orphan_session_bindings,
)
from app.url_utils import parse_conversation_id
from app.utils.bridge_payload import (
    migrate_outbound_queue_message,
    normalize_inbound_push_payload,
    normalize_outbound_bridge_message,
    read_bridge_client_id,
    read_bridge_page_instance_id,
)
from app.utils.legacy_cleanup import assert_no_legacy_fields
from app.utils.page_status import (
    build_page_key,
    explain_page_decision,
    get_page_liveness,
    is_page_online,
    normalize_page_url_fields,
    page_url_from,
)
from app.utils.tm_activity import classify_tm_client_activity, compute_tm_activity_metrics

_state_lock = st._state_lock
_log_callback = st._log_callback
_status_callback = st._status_callback
_external_gui_dispatch = st._external_gui_dispatch
_http_server = st._http_server
_server_thread = st._server_thread
_server_bind_host = st._server_bind_host
_server_port = st._server_port
_server_public_host = st._server_public_host
_debug_mode = st._debug_mode
_tampermonkey_clients = st._tampermonkey_clients
_tampermonkey_pages = st._tampermonkey_pages
_known_page_instances = st._known_page_instances
_tm_prev_snapshot = st._tm_prev_snapshot
_last_tm_activity_classify_log = st._last_tm_activity_classify_log
_last_tm_response_state_log = st._last_tm_response_state_log
_poll_summaries = st._poll_summaries
_last_poll_identity = st._last_poll_identity
_last_poll_empty_log_at = st._last_poll_empty_log_at
_last_poll_other_reason_log_at = st._last_poll_other_reason_log_at
_last_focused_tm_page = st._last_focused_tm_page
_last_focused_tm_page_at = st._last_focused_tm_page_at
_last_focused_update_log_key = st._last_focused_update_log_key
_outbound_queue = st._outbound_queue
_outbound_waiting = st._outbound_waiting
_control_queue = st._control_queue
_control_waiting = st._control_waiting
_inbound_messages = st._inbound_messages
_outbound_history = st._outbound_history
LEASE_SEC = st.LEASE_SEC
ONLINE_TIMEOUT_SEC = st.ONLINE_TIMEOUT_SEC
MAX_OUTBOUND_QUEUE_SIZE = st.MAX_OUTBOUND_QUEUE_SIZE
MAX_CONTROL_QUEUE_SIZE = st.MAX_CONTROL_QUEUE_SIZE
POLL_SUMMARY_INTERVAL_SEC = st.POLL_SUMMARY_INTERVAL_SEC
API_TOKEN = st.API_TOKEN
FALLBACK_PORTS = st.FALLBACK_PORTS
RUNTIME_DIR = st.RUNTIME_DIR
SERVER_URL_FILE = st.SERVER_URL_FILE
_tm_page_display_id_by_key = st._tm_page_display_id_by_key
_tm_page_display_id_updated_at = st._tm_page_display_id_updated_at
cursor_task_queue = st.cursor_task_queue
cursor_task_reports = st.cursor_task_reports
cursor_task_history = st.cursor_task_history
cursor_task_lock = st.cursor_task_lock
cursor_client_state = st.cursor_client_state
CURSOR_ONLINE_TIMEOUT_SEC = st.CURSOR_ONLINE_TIMEOUT_SEC
_external_requests = st._external_requests
_bridge_message_to_external = st._bridge_message_to_external
_session_external_pending = st._session_external_pending
_pending_gui_actions = st._pending_gui_actions
_external_action_lock = st._external_action_lock
_external_client_sessions = st._external_client_sessions
_server_instance_id = st._server_instance_id
_server_start_time = st._server_start_time
DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS = st.DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS

'''


def slice_lines(path: Path, start: int, end: int) -> str:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    return "".join(lines[start - 1 : end])


def merge_sections(sections: list[tuple[str, int, int]], src: Path) -> dict[str, str]:
    merged: dict[str, list[str]] = {}
    for name, start, end in sections:
        merged.setdefault(name, []).append(slice_lines(src, start, end))
    return {k: "\n".join(v) for k, v in merged.items()}


def main() -> None:
    src_text = SERVER.read_text(encoding="utf-8")
    bodies = merge_sections(SECTIONS, SERVER)

    PKG.mkdir(parents=True, exist_ok=True)

    for fname, body in bodies.items():
        out = PKG / fname
        if out.exists() and fname not in ("bridge_logging.py",):
            existing = out.read_text(encoding="utf-8")
            if "Auto-extracted" not in existing:
                body = existing + "\n\n" + body
        content = COMMON_HEADER + "\n" + body
        out.write_text(content, encoding="utf-8")
        print(f"wrote {out} ({len(body)} chars)")

    # Extend state.py with globals from server.py top
    state_extra = """
# --- moved from server.py module globals ---
_external_requests = {}
_bridge_message_to_external = {}
_session_external_pending = {}
_pending_gui_actions = {}
_external_action_lock = threading.Lock()
_external_client_sessions = {}
_server_instance_id = None  # set on server start
_server_start_time = 0.0
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
"""
    state_path = PKG / "state.py"
    st_text = state_path.read_text(encoding="utf-8")
    if "_external_requests" not in st_text:
        state_path.write_text(st_text.rstrip() + state_extra, encoding="utf-8")
        print("extended state.py")

    print("done — manual wiring of imports and server.py still required")


if __name__ == "__main__":
    main()
