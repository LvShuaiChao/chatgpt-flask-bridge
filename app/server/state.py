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


class BridgeQueueFullError(RuntimeError):
    def __init__(self, current_size, max_size):
        self.current_size = int(current_size or 0)
        self.max_size = int(max_size or 0)
        super().__init__(f"outbound queue full: {self.current_size}/{self.max_size}")

    def to_dict(self):
        return {
            "ok": False,
            "code": "queue_full",
            "queue_full": True,
            "current_size": self.current_size,
            "max_size": self.max_size,
            "suggestion": "队列已满，请稍后再试或等待油猴窗口处理完已有消息。",
        }


_outbound_queue = deque()
_outbound_waiting = {}
_control_queue = deque()
_control_waiting = {}
_inbound_messages = deque(maxlen=MAX_INBOUND_HISTORY_SIZE)
_outbound_history = deque(maxlen=MAX_OUTBOUND_HISTORY_SIZE)
ONLINE_TIMEOUT_SEC = TM_HEARTBEAT_ONLINE_SECONDS
LEASE_SEC = 30
# 油猴页面展示编号：key=client_id|page_instance_id，value=递增短编号
_tm_page_display_id_by_key = {}
_tm_page_display_id_updated_at = {}

import uuid
import time

_server_instance_id = str(uuid.uuid4())
_server_start_time = time.time()
_external_requests = {}
_bridge_message_to_external = {}
_session_external_pending = {}
_pending_gui_actions = {}
_external_action_lock = threading.Lock()
_external_client_sessions = {}
# GUI 本地直读上传：file_id -> 登记记录；session / client 索引待上传列表
_upload_files_by_id = {}
_session_upload_file_ids = {}
_client_upload_file_ids = {}
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
