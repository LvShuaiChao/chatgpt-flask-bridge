"""桥接服务共享可变状态（由 server.py 与各子模块共同读写）。"""
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
