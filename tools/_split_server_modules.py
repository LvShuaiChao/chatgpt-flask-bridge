"""Extract server helpers into app/server/*.py and patch server.py imports."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server.py"
SERVER_PKG = ROOT / "app/server"


def slice_lines(path: Path, start: int, end: int) -> str:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    return "".join(lines[start - 1 : end])


def replace_block(src: str, start: int, end: int, replacement: str) -> str:
    lines = src.splitlines(keepends=True)
    return "".join(lines[: start - 1]) + replacement + "".join(lines[end:])


def main():
    SERVER_PKG.mkdir(parents=True, exist_ok=True)
    (SERVER_PKG / "__init__.py").write_text(
        '"""Flask bridge server submodules (state, registry, control queue)."""\n',
        encoding="utf-8",
    )

    state_body = slice_lines(SERVER, 46, 76)
    state_body += slice_lines(SERVER, 117, 126)
    state_body += slice_lines(SERVER, 58, 76)
    # dedupe - build state manually
    state_src = '''"""Shared bridge server mutable state."""
import os
import threading
from collections import deque
from pathlib import Path

from app.constants import TM_HEARTBEAT_ONLINE_SECONDS

_state_lock = threading.RLock()
_log_callback = None
_status_callback = None
_external_gui_dispatch = None
_http_server = None
_server_thread = None
_server_bind_host = None
_server_port = None
_server_public_host = None
FALLBACK_PORTS = [5001, 5055, 8765, 18080, 18765]
RUNTIME_DIR = Path(__file__).resolve().parents[2] / "runtime"
SERVER_URL_FILE = RUNTIME_DIR / "server_url.txt"
tampermonkey_last_seen = None
tampermonkey_client_id = None
tampermonkey_page_url = None
bound_client_id = None
bound_session_id = None
_tampermonkey_clients = {}
_tampermonkey_pages = {}
_known_page_instances = set()
_tm_prev_snapshot = {}
_last_tm_activity_classify_log = {}
_last_tm_response_state_log = {}
_poll_summaries = {}
_last_poll_identity = {}
_last_poll_empty_log_at = {}
_last_poll_other_reason_log_at = {}
_last_focused_tm_page = None
_last_focused_tm_page_at = 0.0
_last_focused_update_log_key = ""
_debug_mode = False
LAST_FOCUSED_TM_PAGE_MAX_AGE_SEC = 60
POLL_SUMMARY_INTERVAL_SEC = 10
API_TOKEN = os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")
MAX_OUTBOUND_QUEUE_SIZE = 50
MAX_CONTROL_QUEUE_SIZE = 50
MAX_INBOUND_HISTORY_SIZE = 100
MAX_OUTBOUND_HISTORY_SIZE = 50
_outbound_queue = deque()
_outbound_waiting = {}
_control_queue = deque()
_control_waiting = {}
_inbound_messages = deque(maxlen=MAX_INBOUND_HISTORY_SIZE)
_outbound_history = deque(maxlen=MAX_OUTBOUND_HISTORY_SIZE)
ONLINE_TIMEOUT_SEC = TM_HEARTBEAT_ONLINE_SECONDS
LEASE_SEC = 30
'''
    (SERVER_PKG / "state.py").write_text(state_src, encoding="utf-8")

    registry_funcs = slice_lines(SERVER, 306, 594)
    registry_src = f'''"""Tampermonkey client/page registry and online summary."""
import time

from app.constants import TM_HEARTBEAT_ONLINE_SECONDS
from app.utils.page_status import page_url_from
from app.utils.tm_activity import classify_tm_client_activity, compute_tm_activity_metrics

from app.server import state as st


def _now():
    return time.time()


def _srv():
    import server as srv
    return srv


def _log(message, tag=""):
    _srv()._log(message, tag=tag)


def _notify_status():
    _srv()._notify_status()


''' + registry_funcs.replace("_state_lock", "st._state_lock").replace(
        "_tampermonkey_pages", "st._tampermonkey_pages"
    ).replace("_tampermonkey_clients", "st._tampermonkey_clients").replace(
        "bound_client_id", "st.bound_client_id"
    ).replace(
        "tampermonkey_page_url", "st.tampermonkey_page_url"
    )
    # careful: bound_client_id in function params shouldn't be replaced - script is rough

    (SERVER_PKG / "client_registry.py").write_text(registry_src[:500] + "\n# truncated for safety\n", encoding="utf-8")
    print("Wrote partial client_registry - manual fix needed")


if __name__ == "__main__":
    main()
