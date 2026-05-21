import logging
import os
import socket
import threading
import time
import traceback
import uuid
from collections import deque
from pathlib import Path
from flask import Flask, jsonify, request
from log_utils import append_log, clear_log_file
from app.core import job_scheduler as _job_scheduler
from app.constants import TM_HEARTBEAT_ONLINE_SECONDS
from app.url_utils import parse_conversation_id
from app.utils.bridge_payload import (
    normalize_inbound_push_payload,
    normalize_outbound_bridge_message,
)
from app.utils.page_status import explain_page_decision, page_url_from
from app.utils.tm_activity import classify_tm_client_activity, compute_tm_activity_metrics
from flask_cors import CORS
from werkzeug.serving import WSGIRequestHandler, make_server

from app.server import state as st
from app.server.state import (
    LAST_FOCUSED_TM_PAGE_MAX_AGE_SEC,
    LEASE_SEC,
    MAX_CONTROL_QUEUE_SIZE,
    MAX_INBOUND_HISTORY_SIZE,
    MAX_OUTBOUND_HISTORY_SIZE,
    MAX_OUTBOUND_QUEUE_SIZE,
    ONLINE_TIMEOUT_SEC,
    POLL_SUMMARY_INTERVAL_SEC,
    API_TOKEN,
    FALLBACK_PORTS,
    RUNTIME_DIR,
    SERVER_URL_FILE,
    _control_queue,
    _control_waiting,
    _inbound_messages,
    _known_page_instances,
    _last_focused_tm_page,
    _last_focused_tm_page_at,
    _last_focused_update_log_key,
    _last_poll_empty_log_at,
    _last_poll_identity,
    _last_poll_other_reason_log_at,
    _last_tm_activity_classify_log,
    _last_tm_response_state_log,
    _outbound_history,
    _outbound_queue,
    _outbound_waiting,
    _poll_summaries,
    _state_lock,
    _tampermonkey_clients,
    _tampermonkey_pages,
    _tm_prev_snapshot,
    bound_client_id,
    bound_session_id,
    tampermonkey_client_id,
    tampermonkey_last_seen,
    tampermonkey_page_url,
)
from app.server.session_bindings import (
    clear_session_binding,
    gc_orphan_session_bindings,
    set_bound_client_id,
)

logging.getLogger("werkzeug").setLevel(logging.ERROR)


class SilentWSGIRequestHandler(WSGIRequestHandler):
    def log_request(self, code="-", size="-"):
        return

    def log(self, type, message, *args):
        return


def _configure_werkzeug_access_log():
    werkzeug_logger = logging.getLogger("werkzeug")
    werkzeug_logger.setLevel(logging.ERROR)
    if not is_debug_mode():
        werkzeug_logger.disabled = True


app = Flask(__name__)
CORS(app)
app.logger.setLevel("ERROR")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
_log_callback = None
_status_callback = None
_external_gui_dispatch = None
_http_server = None
_server_thread = None
_server_bind_host = None
_server_port = None
_server_public_host = None
_debug_mode = False
ENABLE_LEGACY_PROCESS_ENDPOINT = (
    os.environ.get("CHATGPT_ENABLE_LEGACY_PROCESS", "").strip().lower()
    in ("1", "true", "yes")
)
# 0 = 不强制；N > 0 表示同一 session 已有 N 条用户消息后，下一条自动新建 session
DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS = 0
_external_requests = {}
_bridge_message_to_external = {}
_session_external_pending = {}
_pending_gui_actions = {}
_external_action_lock = threading.Lock()
# external API 客户端最近一次成功使用的 session_id（按 client_name / remote_addr）
_external_client_sessions = {}


def set_debug_mode(enabled):
    global _debug_mode
    _debug_mode = bool(enabled)
    st._debug_mode = bool(enabled)
    _configure_werkzeug_access_log()


def is_debug_mode():
    with _state_lock:
        return bool(st._debug_mode)


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
# Cursor Bridge：GUI / 插件 任务队列与回报
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


def _cursor_now_ts():
    return time.time()


def _cursor_safe_text(value):
    return str(value or "").strip()
def set_log_callback(callback):
    global _log_callback
    _log_callback = callback

def set_status_callback(callback):
    global _status_callback
    _status_callback = callback


def set_external_gui_dispatch(callback):
    """GUI 注册：在主线程执行 external API 动作。callback(action_id, action, payload)。"""
    global _external_gui_dispatch
    _external_gui_dispatch = callback


def complete_gui_dispatch(action_id, result):
    with _external_action_lock:
        pending = _pending_gui_actions.get(action_id)
    if not pending:
        return False
    pending["result"] = dict(result or {})
    pending["event"].set()
    return True


def _dispatch_to_gui(action, payload, timeout_sec=30):
    if not _external_gui_dispatch:
        return {
            "ok": False,
            "error": "GUI 未就绪，请先启动 ChatGPT 联动窗口。",
            "code": "GUI_NOT_AVAILABLE",
        }
    action_id = str(uuid.uuid4())
    event = threading.Event()
    with _external_action_lock:
        _pending_gui_actions[action_id] = {
            "event": event,
            "result": None,
            "action": action,
        }
    try:
        _external_gui_dispatch(action_id, action, payload)
    except Exception as error:
        detail = f"{error}\n{traceback.format_exc()}"
        _log(f"[EXTERNAL_API][ERROR] gui_dispatch_failed action={action} error={detail}")
        with _external_action_lock:
            _pending_gui_actions.pop(action_id, None)
        return {
            "ok": False,
            "error": str(error),
            "code": "INTERNAL_ERROR",
        }
    if not event.wait(timeout=max(1.0, float(timeout_sec))):
        with _external_action_lock:
            _pending_gui_actions.pop(action_id, None)
        _log(
            f"[EXTERNAL_API][TIMEOUT] gui_dispatch action={action} "
            f"action_id={action_id[:8]}… timeout={timeout_sec}"
        )
        return {
            "ok": False,
            "error": f"GUI 处理超时（{timeout_sec}s）",
            "code": "INTERNAL_ERROR",
        }
    with _external_action_lock:
        pending = _pending_gui_actions.pop(action_id, None)
    result = (pending or {}).get("result") or {}
    if not isinstance(result, dict):
        return {
            "ok": False,
            "error": "GUI 返回了无效结果",
            "code": "INTERNAL_ERROR",
        }
    return result


def _is_bridge_debug_enabled():
    return bool(st._debug_mode)


def _should_emit_bridge_log(tag, message):
    if _is_bridge_debug_enabled():
        return True
    text = f"{tag} {message}".strip()
    if "[TM][HEARTBEAT]" in text:
        return False
    if "[TM_ACTIVITY][CLASSIFY]" in text:
        return False
    if "[BRIDGE][POLL][REQUEST]" in text:
        return False
    if "[BRIDGE][POLL][NO_MESSAGE]" in text and "reason=queue_empty" in text:
        return False
    if "[BRIDGE][POLL][NO_MESSAGE]" in text and "reason=home_bootstrap_only" in text:
        return False
    if "[BRIDGE][POLL][NO_MESSAGE]" in text and "reason=client_busy" in text:
        return False
    if "[BRIDGE][POLL][NO_MESSAGE]" in text and "reason=no_message" in text:
        return False
    return True


def _normalize_chatgpt_url_for_compare(url):
    text = str(url or "").strip()
    if not text:
        return ""
    if "#xz_reopen_token=" in text:
        text = text.split("#xz_reopen_token=", 1)[0]
    return text.rstrip("/")


def _log(message, tag=""):
    text = str(message or "")
    if not _should_emit_bridge_log(tag, text):
        return
    if _log_callback:
        _log_callback(f"[SERVER] {text}")
    else:
        append_log(text, source="SERVER", echo=True)


def _init_job_scheduler_hooks():
    _job_scheduler.set_job_log_callback(lambda msg: _log(msg))
    _job_scheduler.set_job_status_callback(lambda _snapshot: _notify_status())


_init_job_scheduler_hooks()


def _notify_status():
    if _status_callback:
        _status_callback(get_bridge_status())

def _now():
    return time.time()

def _format_time(ts):
    from app.utils.text_utils import format_ts

    return format_ts(ts)

def is_tampermonkey_online():
    if tampermonkey_last_seen is None:
        return False
    return (_now() - tampermonkey_last_seen) <= ONLINE_TIMEOUT_SEC

def _client_online(last_seen):
    if last_seen is None:
        return False
    return (_now() - last_seen) <= ONLINE_TIMEOUT_SEC

def _is_ignored_page(meta):
    page_type = (meta.get("page_type") or "").strip()
    page_url = page_url_from(meta) if isinstance(meta, dict) else ""
    if not page_url:
        page_url = (meta.get("page_url") or "").strip()
    if page_type == "ignored":
        return True
    if "/backend-api/" in page_url or "/sentinel/" in page_url or "frame.html" in page_url:
        return True
    if meta.get("is_top_frame") is False:
        return True
    return False


def _page_registry_key(client_id, page_instance_id):
    client_id = (client_id or "").strip()
    page_instance_id = (page_instance_id or "").strip()
    if not client_id:
        return ""
    if page_instance_id:
        return f"{client_id}|{page_instance_id}"
    return client_id


def _iter_page_registry_entries():
    """页面注册表条目（优先 _tampermonkey_pages，回退 _tampermonkey_clients）。"""
    with _state_lock:
        if _tampermonkey_pages:
            return [dict(info) for info in _tampermonkey_pages.values()]
        return [dict(info) for info in _tampermonkey_clients.values()]


def _registry_entry_for_client(client_id, page_instance_id=""):
    """按 client_id / page_instance_id 取最新页面条目（控制命令校验用）。"""
    client_id = (client_id or "").strip()
    page_instance_id = (page_instance_id or "").strip()
    with _state_lock:
        if _tampermonkey_pages:
            if page_instance_id:
                key = _page_registry_key(client_id, page_instance_id)
                entry = _tampermonkey_pages.get(key)
                if entry:
                    return dict(entry)
            best = None
            best_seen = 0.0
            for info in _tampermonkey_pages.values():
                if (info.get("client_id") or "").strip() != client_id:
                    continue
                seen = float(info.get("last_seen") or 0)
                if seen >= best_seen:
                    best_seen = seen
                    best = info
            if best:
                return dict(best)
        entry = _tampermonkey_clients.get(client_id)
        return dict(entry) if entry else {}


def _set_bound_session_on_registry(client_id, page_instance_id, session_id):
    session_id = (session_id or "").strip()
    client_id = (client_id or "").strip()
    page_instance_id = (page_instance_id or "").strip()
    with _state_lock:
        if _tampermonkey_pages:
            if page_instance_id:
                key = _page_registry_key(client_id, page_instance_id)
                page = _tampermonkey_pages.get(key)
                if page is not None:
                    page["bound_session_id"] = session_id
            else:
                for info in _tampermonkey_pages.values():
                    if (info.get("client_id") or "").strip() == client_id:
                        info["bound_session_id"] = session_id
        if client_id in _tampermonkey_clients:
            _tampermonkey_clients[client_id]["bound_session_id"] = session_id


def _clear_bound_session_on_registry(session_id, client_id=""):
    session_id = (session_id or "").strip()
    client_id = (client_id or "").strip()
    with _state_lock:
        for info in _tampermonkey_pages.values():
            if not isinstance(info, dict):
                continue
            entry_session = (info.get("bound_session_id") or "").strip()
            entry_client = (info.get("client_id") or "").strip()
            if session_id and entry_session == session_id:
                info["bound_session_id"] = ""
            elif client_id and entry_client == client_id and entry_session == session_id:
                info["bound_session_id"] = ""
        for info in _tampermonkey_clients.values():
            if not isinstance(info, dict):
                continue
            entry_session = (info.get("bound_session_id") or "").strip()
            entry_client = (info.get("client_id") or "").strip()
            if session_id and entry_session == session_id:
                info["bound_session_id"] = ""
            elif client_id and entry_client == client_id and entry_session == session_id:
                info["bound_session_id"] = ""


def _overwrite_page_identity_fields(entry, meta):
    """同一 page_instance 的 URL/对话字段允许被后续 poll/report 覆盖。"""
    page_url_val = (
        (meta.get("url") or meta.get("page_url") or meta.get("conversation_url") or "")
        .strip()
    )
    if page_url_val:
        entry["page_url"] = page_url_val
        entry["url"] = page_url_val
    elif "page_url" in meta:
        entry["page_url"] = (meta.get("page_url") or "").strip()
        entry["url"] = entry["page_url"]
    if "page_title" in meta:
        entry["page_title"] = (meta.get("page_title") or "").strip()
    if "pathname" in meta:
        entry["pathname"] = (meta.get("pathname") or "").strip()
    if "conversation_id" in meta:
        entry["conversation_id"] = (meta.get("conversation_id") or "").strip()
    if "page_type" in meta:
        entry["page_type"] = (meta.get("page_type") or "").strip()


def _sync_tampermonkey_page_registry(entry):
    client_id = (entry.get("client_id") or "").strip()
    page_instance_id = (entry.get("page_instance_id") or "").strip()
    page_key = _page_registry_key(client_id, page_instance_id)

    if not page_key:
        return

    # 以 client_id|page_instance_id 为唯一键；同一 client_id 下允许多个 page_instance（多标签/多窗口）。
    page_entry = _tampermonkey_pages.setdefault(page_key, {})
    page_entry.update(dict(entry))
    page_entry["client_id"] = client_id
    page_entry["page_instance_id"] = page_instance_id

def get_tm_online_summary(bound_client_id=None, bound_conversation_id=None):
    """统计油猴页面在线数量（以 _tampermonkey_pages 为主，client 表仅兼容）。"""
    bound_client_id = (bound_client_id or "").strip() or None
    bound_conversation_id = (bound_conversation_id or "").strip() or None
    if bound_conversation_id in ("", "-"):
        bound_conversation_id = None

    with _state_lock:
        if _tampermonkey_pages:
            all_entries = [
                ((info.get("client_id") or "").strip(), info)
                for info in _tampermonkey_pages.values()
                if (info.get("client_id") or "").strip()
            ]
        else:
            all_entries = list(_tampermonkey_clients.items())

    total_clients = len(all_entries)
    online_clients = 0
    offline_clients = 0
    online_conversation_clients = 0
    online_home_clients = 0
    active_client_id = None
    active_conversation_id = None
    active_last_seen = 0.0
    active_conv_last_seen = 0.0
    bound_online = False
    bound_page_type = ""
    bound_registry_conv_id = None

    for client_id, info in all_entries:
        last_seen = info.get("last_seen")
        online = _client_online(last_seen)
        if online:
            online_clients += 1
        else:
            offline_clients += 1

        page_type = (info.get("page_type") or "").strip()
        if bound_client_id and client_id == bound_client_id:
            bound_online = online
            bound_page_type = page_type
            registry_conv = (info.get("conversation_id") or "").strip()
            if registry_conv and registry_conv != "-":
                bound_registry_conv_id = registry_conv

        if _is_ignored_page(info):
            continue

        if online:
            if page_type == "conversation":
                online_conversation_clients += 1
            elif page_type == "home":
                online_home_clients += 1
            seen_ts = float(last_seen or 0)
            if seen_ts >= active_last_seen:
                active_last_seen = seen_ts
                active_client_id = client_id
            conversation_id = (info.get("conversation_id") or "").strip()
            if page_type == "conversation" and conversation_id and conversation_id != "-":
                if seen_ts >= active_conv_last_seen:
                    active_conv_last_seen = seen_ts
                    active_conversation_id = conversation_id

    if bound_conversation_id is None and bound_registry_conv_id:
        bound_conversation_id = bound_registry_conv_id

    bound_dialog_ready = bool(
        bound_online
        and bound_page_type == "conversation"
        and bound_conversation_id
    )

    return {
        "total_clients": total_clients,
        "online_clients": online_clients,
        "offline_clients": offline_clients,
        "online_conversation_clients": online_conversation_clients,
        "online_home_clients": online_home_clients,
        "active_client_id": active_client_id,
        "active_conversation_id": active_conversation_id,
        "bound_client_id": bound_client_id,
        "bound_conversation_id": bound_conversation_id,
        "bound_online": bound_online,
        "bound_page_type": bound_page_type,
        "bound_dialog_ready": bound_dialog_ready,
        "online_timeout_sec": ONLINE_TIMEOUT_SEC,
    }

def _snapshot_clients():
    items = []
    now = _now()
    source_entries = []
    if _tampermonkey_pages:
        source_entries = list(_tampermonkey_pages.items())
    else:
        source_entries = list(_tampermonkey_clients.items())
    for _key, info in sorted(source_entries, key=lambda row: row[1].get("client_id") or ""):
        client_id = (info.get("client_id") or "").strip()
        if not client_id:
            continue
        last_seen = info.get("last_seen")
        visibility = (info.get("visibility_state") or "").strip()
        activity_state = classify_tm_client_activity(info, now=now)
        _, seen_age, poll_age, _ = compute_tm_activity_metrics(info, now=now)
        decision = explain_page_decision(info, action="sync")
        items.append(
            {
                "client_id": client_id or (info.get("client_id") or ""),
                "page_instance_id": info.get("page_instance_id") or "",
                "script_version": info.get("script_version") or "",
                "page_url": decision.get("url") or info.get("page_url") or info.get("url") or "",
                "url": decision.get("url") or info.get("url") or info.get("page_url") or "",
                "page_title": info.get("page_title") or "",
                "page_type": info.get("page_type") or "",
                "conversation_id": info.get("conversation_id") or "",
                "is_top_frame": bool(info.get("is_top_frame", True)),
                "visibility_state": info.get("visibility_state") or "",
                "visible": visibility,
                "has_focus": bool(info.get("has_focus")),
                "last_focus_at": info.get("last_focus_at"),
                "pathname": info.get("pathname") or "",
                "last_seen": last_seen,
                "last_heartbeat_at": info.get("last_heartbeat_at"),
                "last_poll_at": info.get("last_poll_at"),
                "last_claim_at": info.get("last_claim_at"),
                "last_report_at": info.get("last_report_at"),
                "activity_state": activity_state,
                "seen_age_seconds": round(seen_age, 3),
                "poll_age_seconds": round(poll_age, 3),
                "online": _client_online(last_seen),
                "bound_session_id": info.get("bound_session_id") or "",
                "is_bound": client_id == bound_client_id,
                "bind_request_id": info.get("bind_request_id") or "",
                "launch_token": info.get("launch_token") or "",
                "is_responding": bool(info.get("is_responding", False)),
                "response_state": info.get("response_state") or "unknown",
                "response_state_reason": info.get("response_state_reason") or "",
                "response_state_at": info.get("response_state_at"),
                "can_accept_input": bool(info.get("can_accept_input", True)),
                "can_send_now": bool(info.get("can_send_now")) if "can_send_now" in info else None,
                "syncable": bool(decision.get("syncable")),
                "conversation_syncable": bool(decision.get("conversation_syncable")),
                "dialog_ready": bool(decision.get("dialog_ready")),
                "sendable": bool(decision.get("sendable")),
                "last_response_state_seen_at": info.get("last_response_state_seen_at"),
                "response_started_at": info.get("response_started_at"),
                "response_last_text_changed_at": info.get("response_last_text_changed_at"),
                "upload_bridge_supported": bool(info.get("upload_bridge_supported")),
                "upload_bridge_version": int(info.get("upload_bridge_version") or 0),
            }
        )
    return items

def get_bridge_status():
    with _state_lock:
        waiting_acks = [dict(msg) for msg in _outbound_waiting.values()]
        waiting = waiting_acks[0] if waiting_acks else None
        server_url = get_server_url() if is_server_running() else ""
        return {
            "server_running": is_server_running(),
            "server_url": server_url,
            "server_host": get_server_public_host() if is_server_running() else "",
            "server_port": get_server_port() if is_server_running() else None,
            "server_bind_host": get_server_bind_host() if is_server_running() else "",
            "tampermonkey_online": is_tampermonkey_online(),
            "tampermonkey_last_seen": tampermonkey_last_seen,
            "tampermonkey_client_id": tampermonkey_client_id,
            "tampermonkey_page_url": tampermonkey_page_url,
            "bound_client_id": bound_client_id,
            "bound_session_id": bound_session_id,
            "tampermonkey_clients": _snapshot_clients(),
            "tm_online_summary": get_tm_online_summary(),
            "queue_length": len(_outbound_queue),
            "control_queue_length": len(_control_queue),
            "control_waiting_count": len(_control_waiting),
            "waiting_ack": waiting,
            "waiting_acks": waiting_acks,
            "inbound_count": len(_inbound_messages),
            "recent_inbound": list(_inbound_messages)[-10:],
            "recent_outbound": list(_outbound_history)[-10:],
            "cursor_bridge": get_cursor_bridge_status(),
            "job_scheduler": _job_scheduler.get_job_scheduler_snapshot(),
            "last_focused_tm_page": (
                dict(_last_focused_tm_page) if isinstance(_last_focused_tm_page, dict) else None
            ),
            "last_focused_tm_page_at": float(_last_focused_tm_page_at or 0.0),
        }

def push_message(data):
    """GUI 或其它本地程序：向油猴下发一条待发送消息。"""
    payload = normalize_inbound_push_payload(data)
    session_id = (payload.get("session_id") or "").strip()
    turn_id = (payload.get("turn_id") or "").strip()
    raw_content = (payload.get("raw_content") or "").strip()
    content = (payload.get("content") or "").strip()
    if not content:
        raise ValueError("content/raw_content 不能为空")
    if not raw_content:
        raw_content = content
    target_client_id = (payload.get("target_client_id") or "").strip() or None
    target_url = page_url_from(payload) or None
    target_page_url = target_url
    target_page_instance_id = (
        (payload.get("target_page_instance_id") or "").strip() or None
    )
    conversation_id = (payload.get("conversation_id") or "").strip() or None
    conversation_url = (payload.get("conversation_url") or target_url or "").strip() or None
    bootstrap_conversation = bool(payload.get("bootstrap_conversation"))
    bind_request_id = (
        (payload.get("bind_request_id") or payload.get("launch_token") or "").strip()
        or None
    )
    launch_token = (payload.get("launch_token") or bind_request_id or "").strip() or None
    trace_id = (payload.get("trace_id") or "").strip() or None
    message_id = str(uuid.uuid4())
    msg = {
        "id": message_id,
        "message_id": message_id,
        "type": "chat",
        "session_id": session_id,
        "turn_id": turn_id,
        "trace_id": trace_id,
        "raw_content": raw_content,
        "content": content,
        "url": target_url or "",
        "target_url": target_url or "",
        "target_client_id": target_client_id,
        "target_page_url": target_page_url,
        "target_page_instance_id": target_page_instance_id,
        "conversation_id": conversation_id,
        "conversation_url": conversation_url,
        "bootstrap_conversation": bootstrap_conversation,
        "bind_request_id": bind_request_id,
        "launch_token": launch_token,
        "message_status": "queued",
        "status": "queued",
        "created_at": _now(),
        "delivered_to": None,
        "delivered_at": None,
        "lease_until": None,
        "acked_at": None,
        "finalized_at": None,
        "error_detail": None,
    }
    with _state_lock:
        queue_before = len(_outbound_queue)
        if queue_before >= MAX_OUTBOUND_QUEUE_SIZE:
            _log(
                f"[CHAT_QUEUE][PUT_FAIL] trace_id={trace_id or '-'} "
                f"reason=queue_full queue_before={queue_before} "
                f"max={MAX_OUTBOUND_QUEUE_SIZE} session_id={session_id or '-'}"
            )
            raise RuntimeError(
                "发送队列已满，请等待油猴页面处理完已有消息后再发送"
            )
        _outbound_queue.append(msg)
        queue_after = len(_outbound_queue)
    preview = content if len(content) <= 80 else content[:80] + "..."
    target_hint = target_client_id or "-"
    page_hint = target_url or "-"
    if len(page_hint) > 60:
        page_hint = page_hint[:60] + "..."
    _log(
        f"[CHAT_QUEUE][PUT_OK] trace_id={trace_id or '-'} "
        f"message_id={message_id} target_client={target_hint} "
        f"target_conv={conversation_id or '-'} url={page_hint} text_len={len(content)} "
        f"queue_before={queue_before} queue_after={queue_after} "
        f"session_id={session_id or '-'} turn_id={turn_id or '-'} "
        f"page={page_hint} preview={preview}"
    )
    _notify_status()
    return msg


def get_message_state(message_id):
    message_id = (message_id or "").strip()
    if not message_id:
        return None
    with _state_lock:
        for msg in _outbound_queue:
            if msg.get("id") == message_id:
                return dict(msg)
        msg = _outbound_waiting.get(message_id)
        if msg:
            return dict(msg)
        msg = _control_waiting.get(message_id)
        if msg:
            return dict(msg)
        for msg in _outbound_history:
            if msg.get("id") == message_id:
                return dict(msg)
    return None


def cancel_message(message_id, reason="cancelled"):
    message_id = (message_id or "").strip()
    if not message_id:
        return False
    cancelled = False
    with _state_lock:
        kept = deque()
        while _outbound_queue:
            msg = _outbound_queue.popleft()
            if msg.get("id") == message_id:
                msg["status"] = "cancelled"
                msg["finalized_at"] = _now()
                msg["error_detail"] = reason
                _outbound_history.append(dict(msg))
                cancelled = True
            else:
                kept.append(msg)
        _outbound_queue.extend(kept)

        msg = _outbound_waiting.pop(message_id, None)
        if msg:
            msg["status"] = "cancelled"
            msg["finalized_at"] = _now()
            msg["error_detail"] = reason
            _outbound_history.append(dict(msg))
            cancelled = True

    if cancelled:
        _log(f"[BRIDGE][CANCEL] message_id={message_id[:8]}… reason={reason}")
        _notify_status()
    return cancelled


def _queue_control_message(command, *, log_label="", **extra):
    msg = _make_command_message(command, **extra)
    with _state_lock:
        if len(_control_queue) >= MAX_CONTROL_QUEUE_SIZE:
            _log(
                f"[BRIDGE][CONTROL][QUEUE_FULL] command={command} "
                f"control_queue_size={len(_control_queue)} "
                f"max={MAX_CONTROL_QUEUE_SIZE}"
            )
            return None
        _control_queue.append(msg)

    label = log_label or command
    target_client_id = msg.get("target_client_id") or "-"
    target_page_url = page_url_from(msg) or msg.get("target_page_url") or "-"
    page_instance = msg.get("target_page_instance_id") or "-"
    conversation = msg.get("target_conversation_id") or "-"
    request_id = ""
    payload = msg.get("payload")
    if isinstance(payload, dict):
        request_id = (payload.get("request_id") or "").strip()
    _log(
        f"[BRIDGE][CONTROL][QUEUE] command={command} "
        f"message_id={msg['id'][:8]}… "
        f"target_client_id={target_client_id} "
        f"target_page_url={target_page_url} "
        f"page_instance={page_instance} "
        f"conversation={conversation} "
        f"label={label}"
    )
    _log(
        f"[TM_CONTROL][ENQUEUE] type={command} request_id={request_id or '-'} "
        f"target_client_id={target_client_id} message_id={msg['id'][:8]}…"
    )
    _notify_status()
    return msg


def _append_control_messages(msgs, *, log_label="batch", log_detail=""):
    if not msgs:
        return []
    with _state_lock:
        if len(_control_queue) + len(msgs) > MAX_CONTROL_QUEUE_SIZE:
            _log(
                f"[BRIDGE][CONTROL][QUEUE_FULL] label={log_label} "
                f"control_queue_size={len(_control_queue)} "
                f"incoming={len(msgs)} max={MAX_CONTROL_QUEUE_SIZE}"
            )
            return []
        _control_queue.extend(msgs)
    count = len(msgs)
    first_id = (msgs[0].get("id") or "")[:8] or "-"
    detail = f" {log_detail}" if log_detail else ""
    _log(
        f"[BRIDGE][CONTROL][QUEUE] label={log_label} count={count} "
        f"first_message_id={first_id}…{detail}"
    )
    _notify_status()
    return msgs


def push_open_url(url, active=True):
    """GUI：通过油猴在新标签页打开 URL。"""
    url = (url or "").strip()
    if not url:
        raise ValueError("url 不能为空")

    return _queue_control_message(
        "open_url",
        log_label="open_url",
        url=url,
        active=bool(active),
    )

def _make_command_message(command, **extra):
    message_id = str(uuid.uuid4())
    target_url = (
        (extra.pop("target_url", None) or extra.pop("url", None) or "")
        or (extra.pop("target_page_url", None) or "")
    )
    target_url = (target_url or "").strip() or None
    msg = {
        "id": message_id,
        "message_id": message_id,
        "type": "command",
        "command": command,
        "message_status": "queued",
        "status": "queued",
        "created_at": _now(),
        "delivered_to": None,
        "delivered_at": None,
        "lease_until": None,
        "acked_at": None,
        "finalized_at": None,
        "error_detail": None,
        "target_client_id": extra.pop("target_client_id", None),
        "url": target_url,
        "target_url": target_url,
        "target_page_url": target_url,
    }
    msg.update(extra)
    if target_url and not (msg.get("url") or "").strip():
        msg["url"] = target_url
        msg["target_url"] = target_url
        msg["target_page_url"] = target_url
    return msg

def _copy_existing_fields(dst, src, fields):
    for field in fields:
        value = src.get(field)
        if value is not None and value != "":
            dst[field] = value
    return dst


def _push_targeted_page_command(command, log_label, client_id, target_page_url=None, url=None):
    client_id = (client_id or "").strip()
    if not client_id:
        raise ValueError("client_id 不能为空")
    page_url = (url or target_page_url or "").strip() or None

    return _queue_control_message(
        command,
        log_label=log_label,
        target_client_id=client_id,
        url=page_url,
        target_url=page_url,
        target_page_url=page_url,
    )


def push_close_page(client_id, target_page_url=None):
    """向指定油猴客户端下发关闭当前页面命令。"""
    return _push_targeted_page_command(
        "close_self",
        "close_page",
        client_id,
        target_page_url,
    )


def enqueue_cursor_task(task):
    """
    将 Python GUI 创建的 Cursor 任务加入队列。
    Cursor 插件通过 /api/cursor/tasks/next 拉取。
    """
    if not isinstance(task, dict):
        _log("[CURSOR_BRIDGE][TASK_CREATE_FAILED] reason=task_not_dict")
        return False, "task must be dict"

    task_id = _cursor_safe_text(task.get("task_id"))
    command = _cursor_safe_text(task.get("command")) or "send_message"
    if command not in ("send_message", "new_chat", "new_chat_and_send"):
        command = "send_message"
    task["command"] = command

    content_raw = task.get("content")
    if command != "new_chat":
        if content_raw is None or not str(content_raw).strip():
            if not task_id:
                task_id = f"cursor_task_{int(time.time())}_{uuid.uuid4().hex[:8]}"
            _log(
                "[CURSOR_BRIDGE][TASK_CREATE_FAILED] "
                f"task_id={task_id} command={command} reason=empty_content"
            )
            return False, "content is empty"

    if not task_id:
        task_id = f"cursor_task_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        task["task_id"] = task_id

    task.setdefault("type", "cursor_agent_prompt")
    task.setdefault("command", "send_message")
    task.setdefault("delivery_mode", task.get("mode") or "auto_send")
    task.setdefault("mode", task.get("delivery_mode") or "auto_send")
    task.setdefault("prompt_mode", "raw")
    task.setdefault("submit_mode", "enter")
    task.setdefault("title", "Cursor Bridge 任务")
    task.setdefault("files", [])
    task.setdefault("target", "agent")

    delivery_mode = task.get("delivery_mode") or task.get("mode") or "auto_send"
    if delivery_mode == "auto_send":
        task["delivery_mode"] = "auto_send"
        task["mode"] = "auto_send"
        task["require_confirm"] = False
    else:
        task["delivery_mode"] = "manual_confirm"
        task["mode"] = "manual_confirm"
        task.setdefault("require_confirm", True)

    task.setdefault("created_at", time.strftime("%Y-%m-%d %H:%M:%S"))
    task.setdefault("updated_at", _cursor_now_ts())
    task.setdefault("status", "queued")

    with cursor_task_lock:
        cursor_task_queue.append(task)
        cursor_task_history.append({
            "task_id": task_id,
            "title": task.get("title") or "",
            "status": "queued",
            "created_at": task.get("created_at") or "",
            "updated_at": task.get("updated_at") or _cursor_now_ts(),
        })

    _log(
        "[CURSOR_BRIDGE][TASK_CREATE] "
        f"task_id={task_id} "
        f"title={task.get('title') or '-'} "
        f"delivery_mode={task.get('delivery_mode') or '-'} "
        f"prompt_mode={task.get('prompt_mode') or '-'} "
        f"submit_mode={task.get('submit_mode') or '-'} "
        f"mode={task.get('mode') or '-'} "
        f"require_confirm={task.get('require_confirm')}"
    )
    _notify_status()
    return True, task_id


def claim_next_cursor_task(client=""):
    """Cursor 插件领取下一条任务。"""
    with cursor_task_lock:
        if not cursor_task_queue:
            return None

        task = cursor_task_queue.popleft()
        task["status"] = "claimed"
        task["claimed_at"] = _cursor_now_ts()
        task["claimed_by"] = _cursor_safe_text(client) or "cursor-extension"

        cursor_client_state["last_task_claim_at"] = _cursor_now_ts()
        cursor_client_state["last_task_id"] = task.get("task_id") or ""

    _log(
        "[CURSOR_BRIDGE][TASK_CLAIM] "
        f"task_id={task.get('task_id') or '-'} "
        f"client={client or '-'}"
    )
    _notify_status()
    return task


def append_cursor_task_report(report):
    """保存 Cursor 插件回报。"""
    if not isinstance(report, dict):
        _log("[CURSOR_BRIDGE][REPORT_FAILED] reason=report_not_dict")
        return False, "report must be dict"

    task_id = _cursor_safe_text(report.get("task_id"))
    status = _cursor_safe_text(report.get("status"))
    message = _cursor_safe_text(report.get("message"))

    if not task_id:
        _log("[CURSOR_BRIDGE][REPORT_FAILED] reason=empty_task_id")
        return False, "task_id is empty"

    report.setdefault("updated_at", _cursor_now_ts())

    with cursor_task_lock:
        cursor_task_reports.append(report)
        cursor_client_state["last_report_at"] = _cursor_now_ts()
        cursor_client_state["last_report_status"] = status
        cursor_client_state["last_report_message"] = message

    _log(
        "[CURSOR_BRIDGE][REPORT] "
        f"task_id={task_id} "
        f"status={status or '-'} "
        f"message={message or '-'}"
    )
    try:
        _job_scheduler.handle_cursor_task_report(report)
    except Exception as exc:
        _log(
            "[JOB][CURSOR_REPORT_SYNC_FAILED] "
            f"task_id={task_id} error={exc}\n{traceback.format_exc()}"
        )
    _notify_status()
    return True, "ok"


def update_cursor_client_heartbeat(payload):
    """
    Cursor 插件心跳。
    插件启动 Python Bridge 后，应每 5 秒调用一次。
    """
    if not isinstance(payload, dict):
        _log("[CURSOR_BRIDGE][HEARTBEAT_FAILED] reason=payload_not_dict")
        return False, "payload must be dict"

    client_id = _cursor_safe_text(payload.get("client_id")) or "cursor-extension"
    name = _cursor_safe_text(payload.get("name")) or "Cursor Extension"
    version = _cursor_safe_text(payload.get("version"))
    now = _cursor_now_ts()

    with cursor_task_lock:
        cursor_client_state.update({
            "client_id": client_id,
            "name": name,
            "version": version,
            "status": "online",
            "last_seen": now,
            "last_seen_text": time.strftime("%Y-%m-%d %H:%M:%S"),
        })

    _log(
        "[CURSOR_BRIDGE][HEARTBEAT] "
        f"client_id={client_id} "
        f"name={name} "
        f"version={version or '-'}"
    )
    _notify_status()
    return True, "ok"


def get_cursor_bridge_status():
    """
    返回 Cursor Bridge 当前状态。
    Python GUI 顶部状态栏用这个函数刷新 Cursor 在线状态。
    """
    now = _cursor_now_ts()

    with cursor_task_lock:
        state = dict(cursor_client_state)
        pending_count = len(cursor_task_queue)
        reports = list(cursor_task_reports)[-20:]
        history = list(cursor_task_history)[-20:]

    last_seen = float(state.get("last_seen") or 0.0)
    age = now - last_seen if last_seen > 0 else None

    if last_seen <= 0:
        online = False
        status = "never_seen"
    elif age is not None and age <= CURSOR_ONLINE_TIMEOUT_SEC:
        online = True
        status = "online"
    else:
        online = False
        status = "offline"

    state["online"] = online
    state["status"] = status
    state["age_seconds"] = age
    state["pending_count"] = pending_count
    state["reports"] = reports
    state["history"] = history

    return state


def print_registered_routes():
    try:
        rules = list(app.url_map.iter_rules())
        if _debug_mode:
            _log("[SERVER][ROUTES]")
            for rule in rules:
                _log(
                    f"  {rule.rule} "
                    f"methods={sorted(rule.methods)} "
                    f"endpoint={rule.endpoint}"
                )
        else:
            _log(f"[SERVER][READY] routes_count={len(rules)}")
    except Exception as exc:
        _log(f"[SERVER][ROUTES][FAILED] error={exc}")


def enqueue_control_command(
    command,
    target_client_id,
    target_page_instance_id="",
    target_conversation_id="",
    payload=None,
):
    """GUI：向指定油猴页面下发控制命令（如 flash_page）。"""
    command = (command or "").strip()
    target_client_id = (target_client_id or "").strip()
    target_page_instance_id = (target_page_instance_id or "").strip()
    target_conversation_id = (target_conversation_id or "").strip()

    if not command or not target_client_id:
        _log(
            f"[BRIDGE][CONTROL][ERROR] invalid command={command!r} "
            f"target_client_id={target_client_id!r}"
        )
        return False

    if command == "sync_conversation":
        if not target_conversation_id or target_conversation_id == "-":
            _log(
                "[BRIDGE][CONTROL][BLOCK] "
                f"command=sync_conversation reason=missing_conversation_id "
                f"target_client_id={target_client_id or '-'}"
            )
            return False
        entry = _registry_entry_for_client(
            target_client_id, target_page_instance_id
        )
        page_type = (entry.get("page_type") or "").strip()
        if page_type == "home":
            _log(
                "[BRIDGE][CONTROL][BLOCK] "
                f"command=sync_conversation reason=home_bootstrap_only "
                f"target_client_id={target_client_id or '-'} "
                f"page_type=home"
            )
            return False

    msg = _queue_control_message(
        command,
        log_label=command,
        target_client_id=target_client_id,
        target_page_instance_id=target_page_instance_id or None,
        target_conversation_id=target_conversation_id or None,
        payload=dict(payload or {}),
    )
    return msg


def push_close_other_pages(except_client_id):
    """关闭除 except_client_id 外所有在线 ChatGPT 页面。"""
    except_client_id = (except_client_id or "").strip()
    if not except_client_id:
        raise ValueError("except_client_id 不能为空")
    online_clients = []
    seen_client_ids = set()
    for info in _iter_page_registry_entries():
        if not _client_online(info.get("last_seen")) or _is_ignored_page(info):
            continue
        client_id = (info.get("client_id") or "").strip()
        if not client_id or client_id in seen_client_ids:
            continue
        seen_client_ids.add(client_id)
        online_clients.append((client_id, info))
    keep_online = any(client_id == except_client_id for client_id, _ in online_clients)
    if not keep_online:
        raise ValueError(
            f"保留页面不在线或不存在，已取消关闭其他页面：client_id={except_client_id}"
        )
    msgs = []
    for client_id, info in online_clients:
        if client_id == except_client_id:
            continue
        page_url = page_url_from(info)
        msgs.append(
            _make_command_message(
                "close_self",
                target_client_id=client_id,
                url=page_url,
                target_url=page_url,
                target_page_url=page_url,
            )
        )
    return _append_control_messages(
        msgs,
        log_label="close_other",
        log_detail=f"command=close_self keep_client_id={except_client_id}",
    )


def _maybe_log_tm_activity_classify(client_id, entry, meta):
    """在活跃度分类变化时写 [TM_ACTIVITY][CLASSIFY]（调试模式下每次 touch 都写）。"""
    now = _now()
    state = classify_tm_client_activity(entry, now=now)
    _, seen_age, poll_age, _ = compute_tm_activity_metrics(entry, now=now)
    visible = (entry.get("visibility_state") or meta.get("visibility_state") or "-").strip()
    focus_b = bool(entry.get("has_focus"))
    token = (
        state,
        int(round(seen_age * 10)) / 10.0,
        int(round(poll_age * 10)) / 10.0,
    )
    prev = _last_tm_activity_classify_log.get(client_id)
    if not _debug_mode:
        return
    if prev == token:
        return
    _last_tm_activity_classify_log[client_id] = token
    page_type = (entry.get("page_type") or meta.get("page_type") or "-").strip()
    conversation_id = (entry.get("conversation_id") or meta.get("conversation_id") or "-").strip()
    _log(
        f"[TM_ACTIVITY][CLASSIFY] client_id={client_id} "
        f"page_type={page_type} conversation_id={conversation_id} "
        f"visible={visible} focus={focus_b} "
        f"seen_age={seen_age:.3f} poll_age={poll_age:.3f} state={state}"
    )


def _meta_has_focus(meta):
    if not isinstance(meta, dict):
        return False
    for key in ("has_focus", "focus", "focused"):
        value = meta.get(key)
        if isinstance(value, bool):
            if value:
                return True
        elif isinstance(value, str):
            if value.strip().lower() in ("yes", "true", "1", "focused", "focus"):
                return True
        elif value:
            return True
    return False


def _normalized_last_focused_page(entry):
    if not isinstance(entry, dict):
        return None
    client_id = (entry.get("client_id") or "").strip()
    if not client_id:
        return None
    page_url = (entry.get("page_url") or "").strip()
    if "chatgpt.com" not in page_url:
        return None
    page_type = (entry.get("page_type") or "").strip()
    if page_type not in ("conversation", "home", ""):
        return None
    return {
        "client_id": client_id,
        "page_instance_id": (entry.get("page_instance_id") or "").strip(),
        "page_url": page_url,
        "page_title": (entry.get("page_title") or "").strip(),
        "page_type": page_type,
        "conversation_id": (entry.get("conversation_id") or "").strip(),
        "visibility_state": (entry.get("visibility_state") or "").strip(),
        "visible": (entry.get("visibility_state") or entry.get("visible") or "").strip(),
        "has_focus": bool(entry.get("has_focus")),
        "last_focus_at": entry.get("last_focus_at"),
        "online": _client_online(entry.get("last_seen")),
        "is_responding": bool(entry.get("is_responding")),
        "response_state": entry.get("response_state") or "unknown",
        "can_accept_input": bool(entry.get("can_accept_input", True)),
    }


def _update_last_focused_tm_page(entry):
    global _last_focused_tm_page, _last_focused_tm_page_at, _last_focused_update_log_key
    page = _normalized_last_focused_page(entry)
    if not page:
        return
    now = _now()
    _last_focused_tm_page = page
    _last_focused_tm_page_at = now
    log_key = "|".join([
        page.get("client_id") or "-",
        page.get("conversation_id") or "-",
        page.get("page_url") or "-",
    ])
    if log_key == _last_focused_update_log_key:
        return
    _last_focused_update_log_key = log_key
    _log(
        "[TM][LAST_FOCUSED_UPDATE] "
        f"client_id={page.get('client_id') or '-'} "
        f"conversation_id={page.get('conversation_id') or '-'} "
        f"url={page.get('page_url') or '-'}"
    )


def _touch_tampermonkey(meta, action="poll"):
    global tampermonkey_last_seen, tampermonkey_client_id, tampermonkey_page_url
    now = _now()
    client_id = (meta.get("client_id") or "").strip()
    if not client_id:
        return
    page_instance_id = (meta.get("page_instance_id") or "").strip()
    page_url = (meta.get("page_url") or "").strip()
    page_type = (meta.get("page_type") or "").strip()
    conversation_id = (meta.get("conversation_id") or "").strip()
    ignored = _is_ignored_page(meta)
    if page_instance_id and page_instance_id not in _known_page_instances:
        _known_page_instances.add(page_instance_id)
        hello_bind = (
            (meta.get("bind_request_id") or meta.get("launch_token") or "").strip()
        )
        _log(
            f"[TM][HELLO] client_id={client_id} page_type={page_type or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"page_instance_id={page_instance_id} url={page_url or '-'}"
        )
        _log(
            f"[TM][IDENTITY] client_id={client_id} "
            f"page_instance_id={page_instance_id} page_type={page_type or '-'} "
            f"bind_request_id={hello_bind or '-'}"
        )
    entry = _tampermonkey_clients.setdefault(
        client_id,
        {
            "client_id": client_id,
            "page_instance_id": "",
            "script_version": "",
            "page_url": "",
            "page_title": "",
            "page_type": "",
            "conversation_id": "",
            "is_top_frame": True,
            "visibility_state": "",
            "has_focus": False,
            "last_focus_at": None,
            "pathname": "",
            "last_seen": None,
            "last_heartbeat_at": None,
            "last_poll_at": None,
            "last_claim_at": None,
            "last_report_at": None,
            "online": False,
            "bound_session_id": "",
            "bind_request_id": "",
            "launch_token": "",
            "is_responding": False,
            "response_state": "unknown",
            "response_state_reason": "",
            "response_state_at": None,
            "can_accept_input": True,
            "last_response_state_seen_at": None,
            "response_started_at": None,
            "response_last_text_changed_at": None,
            "upload_bridge_supported": False,
            "upload_bridge_version": 0,
        },
    )
    entry["client_id"] = client_id
    bind_request_id = (
        (meta.get("bind_request_id") or meta.get("launch_token") or "").strip()
    )
    launch_token = (meta.get("launch_token") or bind_request_id or "").strip()
    if bind_request_id:
        entry["bind_request_id"] = bind_request_id
    if launch_token:
        entry["launch_token"] = launch_token
    if page_instance_id:
        entry["page_instance_id"] = page_instance_id
    entry["script_version"] = (meta.get("script_version") or entry.get("script_version") or "").strip()
    if "upload_bridge_supported" in meta:
        entry["upload_bridge_supported"] = bool(meta.get("upload_bridge_supported"))
    if "upload_bridge_version" in meta:
        try:
            entry["upload_bridge_version"] = int(meta.get("upload_bridge_version") or 0)
        except (TypeError, ValueError):
            entry["upload_bridge_version"] = int(entry.get("upload_bridge_version") or 0)
    entry["page_title"] = (meta.get("page_title") or entry.get("page_title") or "").strip()
    _overwrite_page_identity_fields(entry, meta)
    if "page_type" not in meta:
        entry["page_type"] = page_type or entry.get("page_type") or ""
    entry["is_top_frame"] = bool(meta.get("is_top_frame", entry.get("is_top_frame", True)))
    entry["visibility_state"] = (meta.get("visibility_state") or entry.get("visibility_state") or "").strip()
    has_focus = _meta_has_focus(meta)
    entry["has_focus"] = has_focus
    if has_focus:
        entry["last_focus_at"] = now
        _update_last_focused_tm_page(entry)
    if "pathname" not in meta:
        entry["pathname"] = (entry.get("pathname") or "").strip()
    is_responding = bool(meta.get("is_responding"))
    response_state = (meta.get("response_state") or "").strip() or entry.get("response_state") or "unknown"
    response_state_reason = (meta.get("response_state_reason") or "").strip()
    response_state_at = meta.get("response_state_at") or entry.get("response_state_at")
    can_accept_input = bool(meta.get("can_accept_input", True))
    if "can_send_now" in meta:
        entry["can_send_now"] = bool(meta.get("can_send_now"))
    response_started_at = meta.get("response_started_at") or entry.get("response_started_at")
    response_last_text_changed_at = (
        meta.get("response_last_text_changed_at")
        or entry.get("response_last_text_changed_at")
    )
    prev_response_state = entry.get("response_state") or "unknown"
    prev_response_reason = entry.get("response_state_reason") or ""
    entry["is_responding"] = is_responding
    entry["response_state"] = response_state
    entry["response_state_reason"] = response_state_reason
    entry["response_state_at"] = response_state_at
    entry["can_accept_input"] = can_accept_input
    entry["last_response_state_seen_at"] = now
    entry["response_started_at"] = response_started_at
    entry["response_last_text_changed_at"] = response_last_text_changed_at
    entry["last_seen"] = now
    if action == "poll":
        entry["last_poll_at"] = now
        entry["last_heartbeat_at"] = now
    elif action == "ack":
        entry["last_heartbeat_at"] = now
    elif action == "report":
        entry["last_report_at"] = now
        entry["last_heartbeat_at"] = now
    _sync_tampermonkey_page_registry(entry)
    if not ignored:
        tampermonkey_last_seen = now
        tampermonkey_client_id = client_id
        tampermonkey_page_url = page_url or entry.get("page_url") or tampermonkey_page_url
    if action == "poll":
        visible = entry.get("visibility_state") or "-"
        focus = "yes" if entry.get("has_focus") else "no"
        responding = "yes" if entry.get("is_responding") else "no"
        response_state_txt = entry.get("response_state") or "unknown"
        input_txt = "yes" if entry.get("can_accept_input", True) else "no"
        norm_url = _normalize_chatgpt_url_for_compare(
            page_url or entry.get("page_url") or ""
        )
        if _debug_mode:
            _log(
                f"[TM][HEARTBEAT] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} visible={visible} "
                f"focus={focus} responding={responding} state={response_state_txt} "
                f"input={input_txt} url={page_url or '-'}"
            )
        prev_snap = _tm_prev_snapshot.get(client_id) or {}
        new_snap = {
            "page_type": page_type or "-",
            "conversation_id": conversation_id or "-",
            "normalized_url": norm_url,
            "visible": visible,
            "focus": focus,
            "responding": responding,
            "input": input_txt,
            "state": response_state_txt,
        }
        compare_keys = (
            "page_type",
            "conversation_id",
            "normalized_url",
            "visible",
            "focus",
            "responding",
            "input",
            "state",
        )
        changed_fields = [
            key
            for key in compare_keys
            if (prev_snap.get(key) or "") != (new_snap.get(key) or "")
        ]
        if changed_fields:
            _log(
                f"[TM][STATE_CHANGE] client_id={client_id} "
                f"changed_fields={','.join(changed_fields)} "
                f"old_page_type={prev_snap.get('page_type') or '-'} "
                f"new_page_type={new_snap.get('page_type') or '-'} "
                f"old_conv={prev_snap.get('conversation_id') or '-'} "
                f"new_conv={new_snap.get('conversation_id') or '-'} "
                f"old_url={prev_snap.get('normalized_url') or '-'} "
                f"new_url={new_snap.get('normalized_url') or '-'} "
                f"old_responding={prev_snap.get('responding') or '-'} "
                f"new_responding={new_snap.get('responding') or '-'} "
                f"old_input={prev_snap.get('input') or '-'} "
                f"new_input={new_snap.get('input') or '-'} "
                f"reason=heartbeat_diff"
            )
            old_pt = (prev_snap.get("page_type") or "").strip()
            old_conv = (prev_snap.get("conversation_id") or "").strip()
            new_pt = (new_snap.get("page_type") or "").strip()
            new_conv = (new_snap.get("conversation_id") or "").strip()
            if (
                prev_snap
                and old_pt == "home"
                and (not old_conv or old_conv == "-")
                and new_pt == "conversation"
                and new_conv
                and new_conv != "-"
            ):
                _log(
                    f"[TM][HOME_TO_CONVERSATION] client_id={client_id} "
                    f"old_conv=- new_conv={new_conv} "
                    f"old_url={prev_snap.get('normalized_url') or 'https://chatgpt.com/'} "
                    f"new_url={new_snap.get('normalized_url') or '-'}"
                )
        _tm_prev_snapshot[client_id] = new_snap

    response_key = (
        bool(entry.get("is_responding")),
        entry.get("response_state") or "unknown",
        entry.get("response_state_reason") or "",
        bool(entry.get("can_accept_input", True)),
    )
    prev_response_key = _last_tm_response_state_log.get(client_id)
    if response_key != prev_response_key:
        if prev_response_key is not None:
            _log(
                f"[TM_RESPONSE_STATE][CHANGE] client_id={client_id} "
                f"conversation_id={conversation_id or '-'} "
                f"old={prev_response_state} new={entry.get('response_state') or 'unknown'} "
                f"reason={entry.get('response_state_reason') or prev_response_reason or '-'} "
                f"responding={'yes' if entry.get('is_responding') else 'no'} "
                f"input={'yes' if entry.get('can_accept_input', True) else 'no'}"
            )
        _last_tm_response_state_log[client_id] = response_key

    _maybe_log_tm_activity_classify(client_id, entry, meta)


def _add_inbound(
    kind,
    payload,
    message_id=None,
    session_id=None,
    turn_id=None,
    client_id=None,
):
    outbound = _find_outbound_message(message_id)
    if outbound:
        session_id = session_id or outbound.get("session_id") or ""
        turn_id = turn_id or outbound.get("turn_id") or ""
    entry = {
        "event_id": str(uuid.uuid4()),
        "kind": kind,
        "message_id": message_id,
        "session_id": session_id or "",
        "turn_id": turn_id or "",
        "client_id": client_id or "",
        "time": _now(),
        "payload": payload,
    }
    _inbound_messages.append(entry)
    return entry

def _find_outbound_message(message_id):
    if not message_id:
        return None
    waiting = _outbound_waiting.get(message_id)
    if waiting:
        return waiting
    control = _control_waiting.get(message_id)
    if control:
        return control
    for msg in reversed(_outbound_history):
        if msg.get("id") == message_id:
            return msg
    return None

def _finalize_control_message(message_id, status, error_detail=None):
    msg = _control_waiting.pop(message_id, None)
    if not msg:
        return None
    _finalize_message(msg, status)
    if error_detail:
        msg["error_detail"] = error_detail
    _outbound_history.append(dict(msg))
    return msg

def _is_finalized(msg):
    if not msg:
        return False
    if msg.get("finalized_at"):
        return True
    return msg.get("status") in ("replied", "failed")

def _finalize_message(msg, status):
    msg["status"] = status
    msg["finalized_at"] = _now()

def _normalize_page_url(url):
    return (url or "").strip().split("#")[0]


def _archive_waiting(message_id):
    msg = _outbound_waiting.pop(message_id, None)
    if msg is not None:
        _outbound_history.append(dict(msg))
        _log(
            f"[BRIDGE][WAITING_ARCHIVE] message_id={message_id[:8]}… "
            f"status={msg.get('status') or '-'} "
            f"client_id={msg.get('delivered_to') or '-'}"
        )
    return msg


def _waiting_messages_for_client(client_id):
    return [
        msg
        for msg in _outbound_waiting.values()
        if msg.get("delivered_to") == client_id and not _is_finalized(msg)
    ]


def _get_waiting_message_for_client(client_id):
    msgs = _waiting_messages_for_client(client_id)
    if not msgs:
        return None
    return max(
        msgs,
        key=lambda m: float(m.get("delivered_at") or m.get("created_at") or 0),
    )


def _message_target_client_id(msg):
    return (msg.get("target_client_id") or "").strip()


def _message_matches_client(msg, client_id):
    target = _message_target_client_id(msg)
    if target and target != client_id:
        return False
    return True


STRICT_TARGET_CONTROL_COMMANDS = frozenset({
    "flash_page",
    "sync_conversation",
    "start_upload",
})


def _targeted_control_matches(msg, body):
    """定向控制命令：sync_conversation 按 client_id 或 conversation_id 匹配，忽略 page_instance 过期。"""
    client_id = (body.get("client_id") or "").strip()
    command = (msg.get("command") or "").strip()
    if command not in STRICT_TARGET_CONTROL_COMMANDS:
        return False

    target_client_id = _message_target_client_id(msg)
    target_page_instance_id = (msg.get("target_page_instance_id") or "").strip()
    target_conversation_id = (msg.get("target_conversation_id") or "").strip()
    body_page_instance_id = (body.get("page_instance_id") or "").strip()
    body_conversation_id = (body.get("conversation_id") or "").strip()

    if command == "sync_conversation":
        body_page_type = (body.get("page_type") or "").strip()
        if body_page_type == "home":
            _log(
                "[BRIDGE][CONTROL][SKIP] "
                f"command=sync_conversation reason=home_bootstrap_only "
                f"client_id={client_id or '-'} "
                f"conversation_id={(body.get('conversation_id') or '-')}"
            )
            return False
        if not body_conversation_id or body_conversation_id == "-":
            return False
        if target_client_id and target_client_id == client_id:
            return True

        if target_conversation_id and target_conversation_id == body_conversation_id:
            _log(
                "[BRIDGE][CONTROL][MATCH_BY_CONVERSATION] "
                f"command=sync_conversation "
                f"target_client_id={target_client_id or '-'} "
                f"body_client_id={client_id or '-'} "
                f"conversation_id={body_conversation_id or '-'}"
            )
            return True

        if not target_client_id and not target_conversation_id:
            return True

        return False

    if not _message_matches_client(msg, client_id):
        return False

    if target_page_instance_id and target_page_instance_id != body_page_instance_id:
        return False

    if target_conversation_id and target_conversation_id != body_conversation_id:
        return False

    return True


def _message_matches_page(msg, body):
    client_id = (body.get("client_id") or "").strip()
    if not _message_matches_client(msg, client_id):
        return False

    if msg.get("bootstrap_conversation"):
        page_type = (body.get("page_type") or "").strip()
        if page_type != "home":
            return False
        body_conv = (body.get("conversation_id") or "").strip()
        if body_conv:
            return False
        target_client = (msg.get("target_client_id") or "").strip()
        target_instance = (msg.get("target_page_instance_id") or "").strip()
        body_client = (body.get("client_id") or "").strip()
        body_instance = (body.get("page_instance_id") or "").strip()
        if target_client and target_client != body_client:
            return False
        if target_instance and target_instance != body_instance:
            return False
        target_bind = (
            (msg.get("bind_request_id") or msg.get("launch_token") or "").strip()
        )
        body_bind = (
            (body.get("bind_request_id") or body.get("launch_token") or "").strip()
        )
        if target_bind:
            if not body_bind or body_bind != target_bind:
                return False
        target_conv = (msg.get("conversation_id") or "").strip()
        if target_conv:
            return False
        return True

    page_type = (body.get("page_type") or "").strip()
    if page_type != "conversation":
        return False

    target_conv = (
        (msg.get("conversation_id") or msg.get("target_conversation_id") or "")
        .strip()
    )
    if not target_conv:
        return False
    target_page = _normalize_page_url(
        page_url_from(msg) or msg.get("target_page_url") or ""
    )
    body_conv = (body.get("conversation_id") or "").strip()
    body_page = _normalize_page_url(body.get("page_url") or "")
    if target_conv != body_conv:
        return False
    if target_page and target_page != body_page:
        return False
    if target_conv or target_page:
        conv_ok = bool(target_conv and target_conv == body_conv)
        page_ok = bool(target_page and target_page == body_page)
        if not conv_ok and not page_ok:
            return False
    return True


def _pop_message_for_client(body):
    client_id = (body.get("client_id") or "").strip()
    if not _outbound_queue:
        return None
    attempts = len(_outbound_queue)
    for _ in range(attempts):
        msg = _outbound_queue.popleft()
        if msg.get("type") == "command":
            _control_queue.append(msg)
            _log(
                f"[命令] 已将滞留控制命令迁入控制队列 "
                f"({msg.get('id', '?')[:8]}…) command={msg.get('command')}"
            )
            continue
        if _message_matches_page(msg, body):
            return msg
        _outbound_queue.append(msg)
    return None

def _pop_control_command_for_client(body):
    client_id = (body.get("client_id") or "").strip()
    if not _control_queue:
        return None
    attempts = len(_control_queue)

    def _rotate(predicate):
        for _ in range(attempts):
            msg = _control_queue.popleft()
            if predicate(msg):
                return msg
            _control_queue.append(msg)
        return None

    # 1) 严格定向控制命令（flash_page / sync_conversation / start_upload 等）
    msg = _rotate(lambda m: _targeted_control_matches(m, body))
    if msg:
        _log(
            f"[BRIDGE][CONTROL][CLAIM] command={(msg.get('command') or '-')} "
            f"message_id={msg['id'][:8]}… client_id={client_id} "
            f"page_instance_id={(body.get('page_instance_id') or '-')} "
            f"conversation_id={(body.get('conversation_id') or '-')}"
        )
        _log(
            f"[TM_CONTROL][POLL_RESULT] client_id={client_id} "
            f"command={(msg.get('command') or '-')} message_id={msg['id'][:8]}… "
            f"command_count=1"
        )
        return msg
    # 2) 定向 close_self（匹配 target_client_id）
    msg = _rotate(
        lambda m: m.get("command") == "close_self"
        and _message_target_client_id(m)
        and _message_matches_client(m, client_id)
    )
    if msg:
        return msg
    # 3) open_url（无 target 或匹配当前 client）
    msg = _rotate(
        lambda m: m.get("command") == "open_url"
        and _message_matches_client(m, client_id)
    )
    if msg:
        return msg
    # 4) 其余控制命令（含批量 close_self 等；排除严格定向命令）
    return _rotate(
        lambda m: (m.get("command") or "").strip()
        not in STRICT_TARGET_CONTROL_COMMANDS
        and _message_matches_client(m, client_id)
    )

def _claim_message(msg, client_id):
    now = _now()
    msg["status"] = "delivered"
    msg["delivered_to"] = client_id
    msg["delivered_at"] = now
    msg["lease_until"] = now + LEASE_SEC
    _update_external_status_for_bridge(msg.get("id"), "sent")
    entry = _tampermonkey_clients.get(client_id)
    if entry is not None:
        entry["last_claim_at"] = now
    _log(
        f"[BRIDGE][CLAIM] client_id={client_id} message_id={msg['id'][:8]}… "
        f"lease_until={_format_time(msg['lease_until'])}"
    )

def _poll_identity_changed(client_id, page_type, conversation_id, page_url=""):
    prev = _last_poll_identity.get(client_id)
    norm_url = _normalize_chatgpt_url_for_compare(page_url or "")
    current = (page_type or "", conversation_id or "", norm_url)
    if prev is None:
        _last_poll_identity[client_id] = current
        return True
    if prev != current:
        _last_poll_identity[client_id] = current
        return True
    return False


def _poll_log_immediate(message):
    _log(message)


def _poll_log_rate_limited(message, client_id, reason, *, interval_sec=5.0):
    """非 queue_empty 等原因限频；queue_empty 默认 5 秒/client 最多一条。"""
    client_id = (client_id or "").strip() or "-"
    reason = (reason or "").strip() or "unknown"
    now = _now()
    if reason == "queue_empty":
        key = f"{client_id}:queue_empty"
        interval = interval_sec
    else:
        key = f"{client_id}:{reason}"
        interval = 2.0
    last_at = _last_poll_other_reason_log_at.get(key, 0.0)
    if now - last_at < interval:
        return
    _last_poll_other_reason_log_at[key] = now
    _poll_log_immediate(message)


def _record_poll_empty(client_id, page_type, conversation_id):
    now = _now()
    stats = _poll_summaries.setdefault(
        client_id,
        {
            "window_start": now,
            "polls": 0,
            "claimed": 0,
            "page_type": page_type or "-",
            "conversation_id": conversation_id or "-",
        },
    )
    stats["polls"] += 1
    stats["page_type"] = page_type or stats.get("page_type") or "-"
    stats["conversation_id"] = conversation_id or stats.get("conversation_id") or "-"
    elapsed = now - stats.get("window_start", now)
    if elapsed >= POLL_SUMMARY_INTERVAL_SEC:
        _flush_poll_summary(client_id)


def _record_poll_claimed(client_id, page_type, conversation_id):
    stats = _poll_summaries.setdefault(
        client_id,
        {
            "window_start": _now(),
            "polls": 0,
            "claimed": 0,
            "page_type": page_type or "-",
            "conversation_id": conversation_id or "-",
        },
    )
    stats["claimed"] = int(stats.get("claimed", 0)) + 1
    stats["page_type"] = page_type or stats.get("page_type") or "-"
    stats["conversation_id"] = conversation_id or stats.get("conversation_id") or "-"


def _flush_poll_summary(client_id, force=False):
    stats = _poll_summaries.get(client_id)
    if not stats:
        return
    now = _now()
    elapsed = now - stats.get("window_start", now)
    if not force and elapsed < POLL_SUMMARY_INTERVAL_SEC:
        return
    duration = max(1, int(round(elapsed)))
    polls = int(stats.get("polls", 0))
    claimed = int(stats.get("claimed", 0))
    _log(
        f"[BRIDGE][POLL_SUMMARY] client_id={client_id} "
        f"page_type={stats.get('page_type') or '-'} "
        f"conversation_id={stats.get('conversation_id') or '-'} "
        f"duration={duration}s polls={polls} claimed={claimed}"
    )
    _poll_summaries[client_id] = {
        "window_start": now,
        "polls": 0,
        "claimed": 0,
        "page_type": stats.get("page_type") or "-",
        "conversation_id": stats.get("conversation_id") or "-",
    }


def _poll_response(msg, retry):
    msg = normalize_outbound_bridge_message(msg)
    message_id = (msg.get("message_id") or msg.get("id") or "").strip()
    resp = {
        "ok": True,
        "has_message": True,
        "message_id": message_id,
        "id": message_id,
        "type": msg.get("type", "chat"),
        "retry": retry,
        "trace_id": (msg.get("trace_id") or "").strip() or None,
    }
    common_target_fields = (
        "target_client_id",
        "url",
        "target_url",
        "target_page_url",
        "target_page_instance_id",
        "target_conversation_id",
    )
    if msg.get("type") == "command":
        resp["command"] = msg.get("command")
        resp["url"] = msg.get("url")
        resp["active"] = msg.get("active", True)
        _copy_existing_fields(resp, msg, common_target_fields)
        if msg.get("payload") is not None:
            resp["payload"] = msg.get("payload")
    else:
        resp["content"] = (msg.get("content") or "").strip()
        resp["url"] = page_url_from(msg) or None
        if resp["url"]:
            resp["target_url"] = resp["url"]
        _copy_existing_fields(
            resp,
            msg,
            (
                "session_id",
                "turn_id",
                *common_target_fields,
                "conversation_url",
                "conversation_id",
                "bind_request_id",
                "launch_token",
            ),
        )
        if msg.get("bootstrap_conversation"):
            resp["bootstrap_conversation"] = True
    return resp

def _outbound_queue_stats(client_id="", conversation_id=""):
    client_id = (client_id or "").strip()
    conversation_id = (conversation_id or "").strip()
    pending_total = 0
    pending_for_client = 0
    pending_for_conversation = 0
    with _state_lock:
        for msg in _outbound_queue:
            if msg.get("type") == "command":
                continue
            pending_total += 1
            if client_id and _message_matches_client(msg, client_id):
                pending_for_client += 1
            msg_conv = (msg.get("conversation_id") or msg.get("target_conversation_id") or "").strip()
            if conversation_id and msg_conv == conversation_id:
                pending_for_conversation += 1
    return pending_total, pending_for_client, pending_for_conversation


def _poll_no_message_reason(body, waiting=None):
    client_id = (body.get("client_id") or "").strip()
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    if waiting and not _is_finalized(waiting):
        status = (waiting.get("status") or "").strip()
        owner = (waiting.get("delivered_to") or "").strip()
        if status in ("acked", "delivered") and owner == client_id:
            return "client_busy"
        return "client_busy"
    if page_type == "home":
        has_bootstrap = False
        with _state_lock:
            for msg in _outbound_queue:
                if msg.get("bootstrap_conversation") and _message_matches_client(msg, client_id):
                    has_bootstrap = True
                    break
        if has_bootstrap:
            return "home_bootstrap_only"
        return "home_bootstrap_only"
    if page_type != "conversation":
        return "not_target_client"
    pending_total, pending_for_client, pending_for_conversation = _outbound_queue_stats(
        client_id, conversation_id
    )
    if pending_total <= 0:
        return "queue_empty"
    if pending_for_client <= 0:
        return "not_target_client"
    for msg in list(_outbound_queue):
        if msg.get("type") == "command":
            continue
        if not _message_matches_client(msg, client_id):
            continue
        target_conv = (
            (msg.get("conversation_id") or msg.get("target_conversation_id") or "")
            .strip()
        )
        if target_conv and conversation_id and target_conv != conversation_id:
            return "target_conversation_mismatch"
    entry = _tampermonkey_clients.get(client_id) or {}
    if not entry.get("can_accept_input", True):
        return "input_not_ready"
    if entry.get("is_responding"):
        return "client_busy"
    return "queue_empty"


def _log_poll_request(body):
    client_id = (body.get("client_id") or "").strip()
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    visible = (body.get("visibility_state") or body.get("visible") or "-")
    focus = "yes" if body.get("has_focus") else "no"
    responding = "yes" if body.get("is_responding") else "no"
    input_txt = "yes" if body.get("can_accept_input", True) else "no"
    state = (body.get("response_state") or "-").strip() or "-"
    _poll_log_immediate(
        f"[BRIDGE][POLL][REQUEST] client_id={client_id} "
        f"page_instance_id={(body.get('page_instance_id') or '-')} "
        f"page_type={page_type or '-'} conversation_id={conversation_id or '-'} "
        f"url={(body.get('page_url') or '-')} visible={visible} focus={focus} "
        f"responding={responding} input={input_txt} state={state}"
    )


def _log_poll_no_message(body, waiting=None):
    client_id = (body.get("client_id") or "").strip()
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    reason = _poll_no_message_reason(body, waiting)
    if reason == "queue_empty":
        if not _debug_mode:
            _record_poll_empty(client_id, page_type, conversation_id)
            return
        now = _now()
        key = f"{client_id}:{conversation_id}:queue_empty"
        last_at = _last_poll_empty_log_at.get(key, 0.0)
        if now - last_at < 10.0:
            _record_poll_empty(client_id, page_type, conversation_id)
            return
        _last_poll_empty_log_at[key] = now
    pending_total, pending_for_client, pending_for_conversation = _outbound_queue_stats(
        client_id, conversation_id
    )
    msg = (
        f"[BRIDGE][POLL][NO_MESSAGE] client_id={client_id} "
        f"conversation_id={conversation_id or '-'} page_type={page_type or '-'} "
        f"reason={reason} pending_total={pending_total} "
        f"pending_for_client={pending_for_client} "
        f"pending_for_conversation={pending_for_conversation}"
    )
    if _debug_mode:
        _poll_log_immediate(msg)
    else:
        _poll_log_rate_limited(msg, client_id, reason)


def _log_poll_message_found(body, msg, *, delivered=False):
    client_id = (body.get("client_id") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    text = (msg.get("content") or msg.get("raw_content") or msg.get("raw_user_text") or "")
    _poll_log_immediate(
        f"[BRIDGE][POLL][MESSAGE_FOUND] client_id={client_id} "
        f"conversation_id={conversation_id or '-'} "
        f"message_id={msg.get('id') or '-'} "
        f"trace_id={(msg.get('trace_id') or '-')} text_len={len(text)} "
        f"target_client={(msg.get('target_client_id') or '-')} "
        f"target_conv={(msg.get('conversation_id') or msg.get('target_conversation_id') or '-')}"
    )
    if delivered:
        _poll_log_immediate(
            f"[BRIDGE][POLL][MESSAGE_DELIVERED] client_id={client_id} "
            f"message_id={msg.get('id') or '-'} "
            f"trace_id={(msg.get('trace_id') or '-')}"
        )


def _handle_poll(body):
    client_id = (body.get("client_id") or "").strip()
    if not client_id:
        _poll_log_immediate("[BRIDGE][POLL] 拒绝：缺少 client_id")
        return {"ok": False, "error": "缺少 client_id"}, False
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    page_url = (body.get("page_url") or "").strip()
    identity_changed = _poll_identity_changed(
        client_id, page_type, conversation_id, page_url
    )
    _touch_tampermonkey(body, action="poll")
    if _debug_mode:
        _log_poll_request(body)
    need_notify = False
    now = _now()
    cmd = _pop_control_command_for_client(body)
    if cmd:
        _claim_message(cmd, client_id)
        _control_waiting[cmd["id"]] = cmd
        _record_poll_claimed(client_id, page_type, conversation_id)
        _poll_log_immediate(
            f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
            f"conversation_id={conversation_id or '-'} has_message=True "
            f"message_id={cmd['id'][:8]}… type=command"
        )
        _log(
            f"[命令] 控制命令已下发 ({cmd['id'][:8]}…) "
            f"command={cmd.get('command')} client_id={client_id}"
        )
        need_notify = True
        return _poll_response(cmd, retry=False), need_notify
    waiting = _get_waiting_message_for_client(client_id)
    if waiting and waiting.get("status") == "delivered":
        owner = waiting.get("delivered_to")
        lease_until = waiting.get("lease_until") or 0
        if owner == client_id and now < lease_until:
            _record_poll_claimed(client_id, page_type, conversation_id)
            _poll_log_immediate(
                f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={waiting['id'][:8]}… status=retry_same_owner has_message=True"
            )
            return _poll_response(waiting, retry=True), need_notify
        if _is_finalized(waiting):
            _archive_waiting(waiting["id"])
            waiting = _get_waiting_message_for_client(client_id)
        elif now >= lease_until:
            _claim_message(waiting, client_id)
            _record_poll_claimed(client_id, page_type, conversation_id)
            _poll_log_immediate(
                f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={waiting['id'][:8]}… status=lease_reclaim has_message=True"
            )
            return _poll_response(waiting, retry=True), need_notify
    if waiting and not _is_finalized(waiting):
        if waiting.get("status") in ("acked", "delivered"):
            owner = waiting.get("delivered_to")
            if owner == client_id:
                if _debug_mode:
                    _log_poll_no_message(body, waiting)
                else:
                    _record_poll_empty(client_id, page_type, conversation_id)
                return {"ok": True, "has_message": False}, identity_changed
        _log_poll_no_message(body, waiting)
        return {"ok": True, "has_message": False}, identity_changed
    if page_type == "home":
        msg = _pop_message_for_client(body)
        if msg and msg.get("bootstrap_conversation"):
            _claim_message(msg, client_id)
            _outbound_waiting[msg["id"]] = msg
            _log(
                f"[BRIDGE][WAITING_ADD] message_id={msg['id'][:8]}… "
                f"session_id={(msg.get('session_id') or '-')[:8]} "
                f"turn_id={(msg.get('turn_id') or '-')[:8]} "
                f"client_id={client_id} bootstrap=home"
            )
            _record_poll_claimed(client_id, page_type, conversation_id)
            _log_poll_message_found(body, msg, delivered=True)
            _log(f"[发送] 油猴已取走 bootstrap ({msg['id'][:8]}…) client_id={client_id}")
            need_notify = True
            return _poll_response(msg, retry=False), need_notify
        if _debug_mode:
            _log_poll_no_message(body, waiting)
        else:
            _record_poll_empty(client_id, page_type, conversation_id)
        return {"ok": True, "has_message": False}, identity_changed
    if page_type != "conversation":
        if _debug_mode:
            _log_poll_no_message(body, waiting)
        else:
            _record_poll_empty(client_id, page_type, conversation_id)
        return {"ok": True, "has_message": False}, identity_changed
    msg = _pop_message_for_client(body)
    if msg:
        _claim_message(msg, client_id)
        _outbound_waiting[msg["id"]] = msg
        _log(
            f"[BRIDGE][WAITING_ADD] message_id={msg['id'][:8]}… "
            f"session_id={(msg.get('session_id') or '-')[:8]} "
            f"turn_id={(msg.get('turn_id') or '-')[:8]} "
            f"client_id={client_id} "
            f"conversation_id={msg.get('conversation_id') or conversation_id or '-'}"
        )
        _record_poll_claimed(client_id, page_type, conversation_id)
        _log_poll_message_found(body, msg, delivered=True)
        _log(f"[发送] 油猴已取走 ({msg['id'][:8]}…) client_id={client_id}")
        need_notify = True
        return _poll_response(msg, retry=False), need_notify
    if _debug_mode:
        _log_poll_no_message(body, waiting)
    else:
        _record_poll_empty(client_id, page_type, conversation_id)
    return {"ok": True, "has_message": False}, identity_changed

def _handle_ack(body):
    client_id = (body.get("client_id") or "").strip()
    message_id = body.get("message_id")
    success = bool(body.get("success", False))
    detail = body.get("detail") or ""
    _touch_tampermonkey(body, action="ack")
    if not client_id:
        _log("[BRIDGE][ACK] 拒绝：缺少 client_id")
        return {"ok": False, "error": "缺少 client_id"}
    ack_session_id = None
    ack_turn_id = None
    with _state_lock:
        control = _control_waiting.get(message_id)
        if control:
            owner = control.get("delivered_to")
            if owner != client_id:
                _add_inbound(
                    "ack_mismatch",
                    {
                        "message_id": message_id,
                        "detail": detail or "client_id 与领取者不一致",
                        "owner_client_id": owner,
                        "report_client_id": client_id,
                    },
                    message_id=message_id,
                    client_id=client_id,
                )
                _log(
                    f"[BRIDGE][ACK_MISMATCH] control owner={owner} reporter={client_id} "
                    f"message_id={message_id[:8]}…"
                )
                _notify_status()
                return {"ok": False, "error": "client_id 不匹配"}
            if _is_finalized(control):
                _add_inbound(
                    "ack_mismatch",
                    {
                        "message_id": message_id,
                        "detail": "控制命令已结束，忽略 ack",
                        "owner_client_id": owner,
                        "report_client_id": client_id,
                    },
                    message_id=message_id,
                    client_id=client_id,
                )
                _notify_status()
                return {"ok": False, "error": "消息已结束"}
            control["acked_at"] = _now()
            if success:
                control["status"] = "acked"
            else:
                _finalize_control_message(message_id, "failed", detail)
            control_command = (control.get("command") or "-").strip()
            _log(
                f"[BRIDGE][ACK] command={control_command} client_id={client_id} "
                f"message_id={message_id[:8]}… success={success} detail={detail or '-'}"
            )
            _add_inbound(
                "ack",
                {"success": success, "detail": detail, "control": True},
                message_id=message_id,
                client_id=client_id,
            )
            _notify_status()
            return {"ok": True}
        waiting = _outbound_waiting.get(message_id)
        if not waiting:
            _add_inbound(
                "ack_mismatch",
                {
                    "message_id": message_id,
                    "detail": detail or "message_id 不匹配或已过期",
                    "report_client_id": client_id,
                },
                message_id=message_id,
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][ACK_MISMATCH] reporter={client_id} message_id={message_id} "
                f"reason=not_waiting"
            )
            _notify_status()
            return {"ok": False, "error": "message_id 不匹配或已过期"}
        owner = waiting.get("delivered_to")
        if owner != client_id:
            _add_inbound(
                "ack_mismatch",
                {
                    "message_id": message_id,
                    "detail": detail or "client_id 与领取者不一致",
                    "owner_client_id": owner,
                    "report_client_id": client_id,
                },
                message_id=message_id,
                session_id=waiting.get("session_id"),
                turn_id=waiting.get("turn_id"),
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][ACK_MISMATCH] owner={owner} reporter={client_id} "
                f"message_id={message_id[:8]}…"
            )
            _notify_status()
            return {"ok": False, "error": "client_id 不匹配"}
        if _is_finalized(waiting):
            _add_inbound(
                "ack_mismatch",
                {
                    "message_id": message_id,
                    "detail": "消息已 finalized，忽略 ack",
                    "owner_client_id": owner,
                    "report_client_id": client_id,
                },
                message_id=message_id,
                session_id=waiting.get("session_id"),
                turn_id=waiting.get("turn_id"),
                client_id=client_id,
            )
            _notify_status()
            return {"ok": False, "error": "消息已结束"}
        waiting["acked_at"] = _now()
        if not success:
            waiting["error_detail"] = detail
        ack_session_id = waiting.get("session_id")
        ack_turn_id = waiting.get("turn_id")
        if success:
            waiting["status"] = "acked"
            status_text = "成功"
            _update_external_status_for_bridge(message_id, "waiting")
        else:
            _finalize_message(waiting, "failed")
            status_text = "失败"
            _archive_waiting(message_id)
            _notify_external_request_from_bridge(
                message_id,
                "send_failed",
                {"detail": detail, "reason": detail},
                waiting,
            )
    _log(
        f"[BRIDGE][ACK] client_id={client_id} message_id={message_id[:8]}… "
        f"success={success} detail={detail or '-'}"
    )
    _add_inbound(
        "ack",
        {"success": success, "detail": detail},
        message_id=message_id,
        session_id=ack_session_id,
        turn_id=ack_turn_id,
        client_id=client_id,
    )
    _notify_status()
    return {"ok": True}

def _report_recv_fields(body, event, payload, message_id):
    client_id = (body.get("client_id") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    reply_len = 0
    reason = ""
    if isinstance(payload, dict):
        text = payload.get("text") or payload.get("content") or ""
        reply_len = len(str(text).strip())
        reason = (
            payload.get("reason")
            or payload.get("detail")
            or payload.get("error_message")
            or ""
        )
    mid = message_id or "-"
    if mid != "-" and len(mid) > 8:
        mid = f"{mid[:8]}…"
    _log(
        f"[BRIDGE][REPORT][RECV] client_id={client_id} "
        f"conversation_id={conversation_id or '-'} event={event} "
        f"message_id={mid} reply_len={reply_len} reason={reason or '-'}"
    )


def _log_finalized(msg, message_id, event):
    mid = message_id or ""
    if len(mid) > 8:
        mid = f"{mid[:8]}…"
    session_id = (msg.get("session_id") or "").strip()
    turn_id = (msg.get("turn_id") or "").strip()
    if session_id and len(session_id) > 8:
        session_id = f"{session_id[:8]}…"
    if turn_id and len(turn_id) > 8:
        turn_id = f"{turn_id[:8]}…"
    _log(
        f"[BRIDGE][FINALIZED] message_id={mid or '-'} "
        f"turn_id={turn_id or '-'} session_id={session_id or '-'} "
        f"event={event} status={msg.get('status') or '-'}"
    )


def _handle_report(body):
    client_id = (body.get("client_id") or "").strip()
    event = body.get("event") or "info"
    payload = body.get("payload") or {}
    message_id = body.get("message_id")
    if event == "identity_change":
        page_instance_id = (
            (body.get("page_instance_id") or payload.get("page_instance_id") or "").strip()
        )
        page_key = _page_registry_key(client_id, page_instance_id)
        with _state_lock:
            old_entry = dict(
                _tampermonkey_pages.get(page_key)
                or _tampermonkey_clients.get(client_id)
                or {}
            )
        old_url = (old_entry.get("page_url") or "").strip()
        old_conv = (old_entry.get("conversation_id") or "").strip()
        merge_meta = dict(body)
        if isinstance(payload, dict):
            merge_meta.update(payload)
        _touch_tampermonkey(merge_meta, action="report")
        new_url = (merge_meta.get("page_url") or "").strip()
        new_conv = (merge_meta.get("conversation_id") or "").strip()
        reason = (payload.get("reason") or merge_meta.get("reason") or "-").strip()
        _log(
            "[BRIDGE][IDENTITY_CHANGE] "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"old_url={old_url or '-'} new_url={new_url or '-'} "
            f"old_conv={old_conv or '-'} new_conv={new_conv or '-'} "
            f"reason={reason}"
        )
        if old_url and new_url and old_url != new_url:
            _log(
                "[PAGE_SYNC][STALE_URL] "
                f"old_url={old_url} new_url={new_url} "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'}"
            )
        _notify_status()
        return {"ok": True}
    _touch_tampermonkey(body, action="report")
    if event == "focus_state":
        entry = _tampermonkey_clients.get(client_id) or {}
        reason = (payload.get("reason") or "-").strip()
        has_focus = "yes" if entry.get("has_focus") else "no"
        visible = (entry.get("visibility_state") or "-").strip() or "-"
        conversation_id = (entry.get("conversation_id") or "-").strip() or "-"
        page_url = (entry.get("page_url") or body.get("page_url") or "-").strip() or "-"
        _log(
            "[TM][FOCUS_STATE] "
            f"client_id={client_id or '-'} "
            f"conversation_id={conversation_id} "
            f"has_focus={has_focus} "
            f"visible={visible} "
            f"url={page_url} "
            f"reason={reason}"
        )
        _notify_status()
        return {"ok": True}
    if not client_id:
        _log(f"[BRIDGE][REPORT] 拒绝：缺少 client_id event={event}")
        return {"ok": False, "error": "缺少 client_id"}
    if event == "client_log":
        level = payload.get("level") or "info"
        message = (payload.get("message") or "").strip()
        extra = payload.get("extra") or {}
        page_url = payload.get("page_url") or body.get("page_url") or ""
        log_client_id = body.get("client_id") or payload.get("client_id") or client_id
        if message.startswith("[TM]"):
            extra_text = _format_log_fields(extra)
            if extra_text:
                _log(f"{message} {extra_text} client_id={log_client_id}")
            else:
                _log(f"{message} client_id={log_client_id}")
        else:
            _log(
                f"[TM][CLIENT_LOG][{level}] "
                f"client_id={log_client_id} page={page_url} message={message} "
                f"extra={extra}"
            )
        return {"ok": True}
    _report_recv_fields(body, event, payload, message_id)
    with _state_lock:
        msg = _find_outbound_message(message_id)
        if event == "conversation_created" and not msg:
            conv_report = (payload.get("conversation_id") or "").strip()
            if conv_report:
                orphan_session = (
                    (payload.get("local_session_id") or body.get("session_id") or "")
                ).strip()
                turn_extra = (
                    (payload.get("turn_id") or body.get("turn_id") or "")
                ).strip()
                _add_inbound(
                    event,
                    payload,
                    message_id=message_id or "",
                    session_id=orphan_session,
                    turn_id=turn_extra,
                    client_id=client_id,
                )
                mid_log = message_id or "-"
                if isinstance(mid_log, str) and len(mid_log) > 8:
                    mid_log = f"{mid_log[:8]}…"
                _log(
                    f"[BRIDGE][REPORT] event=conversation_created client_id={client_id} "
                    f"conv={conv_report} message_id={mid_log} inbound=orphan_no_outbound"
                )
                _notify_status()
                return {"ok": True}
        if not msg:
            waiting_ids = sorted(_outbound_waiting.keys())
            _add_inbound(
                "report_unknown",
                {
                    "event": event,
                    "payload": payload,
                    "report_client_id": client_id,
                    "waiting_message_ids": waiting_ids,
                },
                message_id=message_id,
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][REPORT_UNKNOWN] message_id={message_id} "
                f"client_id={client_id} event={event} "
                f"waiting_message_ids={[mid[:8] + '…' for mid in waiting_ids]}"
            )
            _notify_status()
            return {"ok": True}
        owner = msg.get("delivered_to")
        if owner != client_id:
            _add_inbound(
                "report_mismatch",
                {
                    "event": event,
                    "payload": payload,
                    "owner_client_id": owner,
                    "report_client_id": client_id,
                },
                message_id=message_id,
                session_id=msg.get("session_id"),
                turn_id=msg.get("turn_id"),
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][REPORT_MISMATCH] message_id={message_id or '-'} "
                f"session_id={msg.get('session_id') or '-'} "
                f"turn_id={msg.get('turn_id') or '-'} "
                f"client_id={client_id} "
                f"conversation_id={msg.get('conversation_id') or '-'} "
                f"owner={owner} reporter={client_id} event={event}"
            )
            _notify_status()
            return {"ok": True}
        if _is_finalized(msg) and event in (
            "send_failed",
            "assistant_reply",
            "assistant_reply_empty",
            "assistant_reply_failed",
            "ack",
        ):
            _add_inbound(
                "report_ignored",
                {
                    "event": event,
                    "payload": payload,
                    "reason": "消息已 finalized",
                    "finalized_at": msg.get("finalized_at"),
                },
                message_id=message_id,
                session_id=msg.get("session_id"),
                turn_id=msg.get("turn_id"),
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][REPORT_IGNORED] message_id={message_id[:8]}… "
                f"event={event} status={msg.get('status')}"
            )
            _notify_status()
            return {"ok": True}
        inbound_kw = {
            "message_id": message_id,
            "session_id": msg.get("session_id"),
            "turn_id": msg.get("turn_id"),
            "client_id": client_id,
        }
        if message_id in _control_waiting:
            control_events_finalize = (
                "open_url_success",
                "open_url_failed",
                "close_page_success",
                "close_page_failed",
                "close_page_still_open",
                "control_done",
                "command_failed",
            )
            if event == "conversation_snapshot":
                cmd_payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
                page_meta = payload.get("page") if isinstance(payload.get("page"), dict) else {}
                enriched = dict(payload)
                for key, value in cmd_payload.items():
                    if value not in (None, "") and not enriched.get(key):
                        enriched[key] = value
                target_field_map = {
                    "conversation_id": "target_conversation_id",
                    "page_url": "target_page_url",
                    "page_instance_id": "target_page_instance_id",
                    "client_id": "target_client_id",
                }
                for key in (
                    "session_id",
                    "conversation_id",
                    "request_id",
                    "client_id",
                    "page_instance_id",
                    "page_url",
                ):
                    if (enriched.get(key) or "").strip():
                        continue
                    alt = cmd_payload.get(key) or page_meta.get(key)
                    if not alt and key in target_field_map:
                        alt = msg.get(target_field_map[key])
                    if alt not in (None, ""):
                        enriched[key] = alt
                if not (enriched.get("client_id") or "").strip():
                    enriched["client_id"] = client_id
                session_id = (enriched.get("session_id") or msg.get("session_id") or "").strip()
                message_count = len(enriched.get("messages") or [])
                total_text_len = 0
                for web_msg in enriched.get("messages") or []:
                    if isinstance(web_msg, dict):
                        total_text_len += len(
                            str(
                                web_msg.get("text") or web_msg.get("content") or ""
                            ).strip()
                        )
                _log(
                    f"[SYNC_CONVERSATION][RECV] session_id={session_id or '-'} "
                    f"message_id={message_id[:8] if message_id else '?'}… "
                    f"conversation_id={(enriched.get('conversation_id') or '-')} "
                    f"count={message_count} total_text_len={total_text_len}"
                )
                _log(
                    f"[WEB_SYNC][SNAPSHOT_RECEIVED] request_id="
                    f"{(enriched.get('request_id') or '-')} "
                    f"client_id={client_id} "
                    f"conversation_id={(enriched.get('conversation_id') or '-')} "
                    f"message_count={message_count}"
                )
                _add_inbound(
                    event,
                    enriched,
                    message_id=message_id,
                    session_id=session_id,
                    client_id=client_id,
                )
                _finalize_control_message(message_id, "replied", None)
                _notify_status()
                return {"ok": True}
            if event == "close_page_requested":
                msg["status"] = "requested"
                _add_inbound(event, payload, **inbound_kw)
            elif event in control_events_finalize:
                if (
                    event.endswith("_success")
                    or event in ("close_page_still_open", "control_done")
                ):
                    status = "replied"
                    error_detail = None
                else:
                    status = "failed"
                    error_detail = payload.get("detail") or payload.get("reason")
                _add_inbound(event, payload, **inbound_kw)
                _finalize_control_message(message_id, status, error_detail)
            else:
                _add_inbound(event, payload, **inbound_kw)
            control_command = (msg.get("command") or payload.get("command") or "-").strip()
            _log(
                f"[BRIDGE][REPORT] event={event} command={control_command} "
                f"client_id={client_id} "
                f"message_id={message_id[:8] if message_id else '?'}…"
            )
            _notify_status()
            return {"ok": True}
        if event == "assistant_reply":
            text = (payload.get("text") or payload.get("content") or "").strip()
            msg["reply_text"] = text
            try:
                _job_scheduler.on_assistant_reply(
                    text,
                    outbound_message_id=message_id,
                    auto_send_hook=lambda jid: _job_scheduler.send_job_to_cursor(
                        jid, enqueue_cursor_task
                    ),
                )
            except Exception as exc:
                _log(
                    "[JOB][ASSISTANT_REPLY_HOOK_FAILED] "
                    f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"
                )
            _finalize_message(msg, "replied")
            client_entry = _tampermonkey_clients.get(client_id)
            if isinstance(client_entry, dict):
                now = _now()
                client_entry["is_responding"] = False
                client_entry["response_state"] = "idle"
                client_entry["response_state_reason"] = "assistant_reply_received"
                client_entry["response_state_at"] = int(now * 1000)
                client_entry["can_accept_input"] = True
                client_entry["last_response_state_seen_at"] = now
            _log_finalized(msg, message_id, event)
            _add_inbound(event, payload, **inbound_kw)
            _archive_waiting(message_id)
            _notify_external_request_from_bridge(message_id, event, payload, msg)
        elif event == "send_failed":
            if not _is_finalized(msg):
                _finalize_message(msg, "failed")
                msg["error_detail"] = payload.get("detail") or payload.get("reason")
                _log_finalized(msg, message_id, event)
                _add_inbound(event, payload, **inbound_kw)
                if message_id in _outbound_waiting:
                    _archive_waiting(message_id)
                _notify_external_request_from_bridge(message_id, event, payload, msg)
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        elif event in ("assistant_reply_empty", "assistant_reply_failed"):
            if not _is_finalized(msg):
                fail_detail = (
                    payload.get("reason")
                    or payload.get("detail")
                    or payload.get("error_message")
                    or ""
                )
                try:
                    _job_scheduler.on_assistant_reply_failed(
                        fail_detail or event,
                        outbound_message_id=message_id,
                    )
                except Exception as exc:
                    _log(
                        "[JOB][ASSISTANT_REPLY_FAILED_HOOK] "
                        f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"
                    )
                _finalize_message(msg, "failed")
                msg["error_detail"] = fail_detail
                _log_finalized(msg, message_id, event)
                _add_inbound(event, payload, **inbound_kw)
                if message_id in _outbound_waiting:
                    _archive_waiting(message_id)
                _notify_external_request_from_bridge(message_id, event, payload, msg)
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        elif event == "conversation_created":
            conv_id = (payload.get("conversation_id") or body.get("conversation_id") or "").strip()
            page_url = (
                (payload.get("page_url") or payload.get("url") or body.get("page_url") or "")
                .strip()
            )
            report_bind = (
                payload.get("bind_request_id")
                or payload.get("launch_token")
                or body.get("bind_request_id")
                or body.get("launch_token")
                or ""
            ).strip()
            _log(
                f"[BRIDGE][REPORT] event=conversation_created client_id={client_id} "
                f"conv={conv_id or '-'} message_id={message_id[:8] if message_id else '?'}…"
            )
            _log(
                f"[BIND][CONVERSATION_CREATED] message_id={message_id[:8] if message_id else '?'}… "
                f"session_id={(msg.get('session_id') or '-')[:8]} "
                f"bind_request_id={report_bind or '-'} "
                f"client_id={client_id} "
                f"page_instance_id={(body.get('page_instance_id') or '-')[:16]} "
                f"conversation_id={conv_id or '-'} url={page_url or '-'}"
            )
            msg["conversation_id"] = conv_id or msg.get("conversation_id")
            if page_url:
                msg["conversation_url"] = page_url
            _add_inbound(event, payload, **inbound_kw)
        elif event in (
            "open_url_success",
            "open_url_failed",
            "close_page_success",
            "close_page_failed",
            "close_page_requested",
            "close_page_still_open",
            "command_failed",
        ):
            if not _is_finalized(msg):
                if event.endswith("_success"):
                    _finalize_message(msg, "replied")
                else:
                    _finalize_message(msg, "failed")
                    msg["error_detail"] = payload.get("detail") or payload.get("reason")
                _add_inbound(event, payload, **inbound_kw)
                if message_id in _outbound_waiting:
                    _archive_waiting(message_id)
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        else:
            _add_inbound(event, payload, **inbound_kw)
    _notify_status()
    return {"ok": True}


def _external_auth_ok():
    token = (API_TOKEN or "").strip()
    if not token:
        return True
    auth_header = (request.headers.get("Authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        provided = auth_header[7:].strip()
    else:
        provided = (request.headers.get("X-API-Key") or "").strip()
    return provided == token


def _external_json_error(error, code, status=400):
    return jsonify({"ok": False, "error": error, "code": code}), status


def _external_json_ok(**fields):
    payload = {"ok": True}
    payload.update(fields)
    return jsonify(payload)


def _new_external_request_id():
    return f"req_{uuid.uuid4().hex}"


def _register_external_request(
    request_id,
    session_id,
    text,
    timeout,
    turn_id="",
    bridge_message_id="",
    status="queued",
):
    now = _now()
    entry = {
        "request_id": request_id,
        "session_id": session_id or "",
        "turn_id": turn_id or "",
        "bridge_message_id": bridge_message_id or "",
        "text": text or "",
        "status": status,
        "reply": "",
        "error": "",
        "created_at": now,
        "updated_at": now,
        "timeout": float(timeout or 120),
    }
    with _state_lock:
        _external_requests[request_id] = entry
        if bridge_message_id:
            _bridge_message_to_external[bridge_message_id] = request_id
        if session_id and not bridge_message_id:
            _session_external_pending[session_id] = request_id
    return entry


def attach_external_request_bridge(session_id, bridge_message_id, turn_id=""):
    session_id = (session_id or "").strip()
    bridge_message_id = (bridge_message_id or "").strip()
    turn_id = (turn_id or "").strip()
    if not session_id or not bridge_message_id:
        return False
    with _state_lock:
        request_id = _session_external_pending.pop(session_id, None)
        if not request_id:
            for rid, req in _external_requests.items():
                if req.get("session_id") == session_id and not req.get("bridge_message_id"):
                    request_id = rid
                    break
        if not request_id:
            return False
        req = _external_requests.get(request_id)
        if not req:
            return False
        req["bridge_message_id"] = bridge_message_id
        req["turn_id"] = turn_id or req.get("turn_id") or ""
        req["updated_at"] = _now()
        if req.get("status") in ("queued", "waiting"):
            req["status"] = "queued"
        _bridge_message_to_external[bridge_message_id] = request_id
    _log(
        f"[EXTERNAL_API][ATTACH] request_id={request_id} session_id={session_id} "
        f"bridge_message_id={bridge_message_id[:8]}… turn_id={turn_id[:8] + '…' if turn_id else '-'}"
    )
    return True


def _update_external_status_for_bridge(bridge_message_id, status):
    bridge_message_id = (bridge_message_id or "").strip()
    if not bridge_message_id:
        return
    with _state_lock:
        request_id = _bridge_message_to_external.get(bridge_message_id)
        if not request_id:
            return
        req = _external_requests.get(request_id)
        if not req or req.get("status") in ("done", "failed", "timeout"):
            return
        req["status"] = status
        req["updated_at"] = _now()


def _notify_external_request_from_bridge(message_id, event, payload, msg=None):
    message_id = (message_id or "").strip()
    if not message_id:
        return
    payload = payload or {}
    with _state_lock:
        request_id = _bridge_message_to_external.get(message_id)
        if not request_id:
            return
        req = _external_requests.get(request_id)
        if not req:
            return
        if req.get("status") in ("done", "failed", "timeout"):
            return
        session_id = req.get("session_id") or ""
        if event == "assistant_reply":
            text = (payload.get("text") or payload.get("content") or "").strip()
            req["status"] = "done"
            req["reply"] = text
            req["error"] = ""
            req["updated_at"] = _now()
            _log(
                f"[EXTERNAL_API][REQUEST_DONE] request_id={request_id} "
                f"session_id={session_id} bridge_message_id={message_id} "
                f"reply_len={len(text)}"
            )
        elif event in ("assistant_reply_empty", "assistant_reply_failed", "send_failed"):
            reason = (
                payload.get("reason")
                or payload.get("detail")
                or payload.get("error_message")
                or (msg or {}).get("error_detail")
                or event
            )
            req["status"] = "failed"
            req["error"] = str(reason)
            req["updated_at"] = _now()
            _log(
                f"[EXTERNAL_API][REQUEST_FAILED] request_id={request_id} "
                f"reason={reason}"
            )


def _check_external_request_timeout(req):
    timeout = float(req.get("timeout") or 120)
    created = float(req.get("created_at") or 0)
    if created and (_now() - created) > timeout:
        req["status"] = "timeout"
        req["error"] = f"等待回复超时（{int(timeout)}s）"
        req["updated_at"] = _now()
        return True
    return False


def _get_external_request(request_id):
    request_id = (request_id or "").strip()
    if not request_id:
        return None
    with _state_lock:
        req = _external_requests.get(request_id)
        if not req:
            return None
        req = dict(req)
    if req.get("status") not in ("done", "failed", "timeout"):
        if _check_external_request_timeout(req):
            with _state_lock:
                stored = _external_requests.get(request_id)
                if stored:
                    stored["status"] = "timeout"
                    stored["error"] = req["error"]
                    stored["updated_at"] = _now()
            _log(
                f"[EXTERNAL_API][TIMEOUT] request_id={request_id} "
                f"session_id={req.get('session_id') or '-'} "
                f"bridge_message_id={req.get('bridge_message_id') or '-'}"
            )
    return req


def count_user_turns(session):
    """统计 session 中非空用户消息条数（对象或 dict 均兼容）。"""
    if not session:
        return 0
    messages = getattr(session, "messages", None)
    if messages is None and isinstance(session, dict):
        messages = session.get("messages") or []
    messages = messages or []
    count = 0
    for message in messages:
        if isinstance(message, dict):
            role = message.get("role", "")
            text = message.get("text") or message.get("content") or ""
        else:
            role = getattr(message, "role", "")
            text = getattr(message, "text", None)
            if text is None:
                text = getattr(message, "content", "")
        if role == "user" and str(text or "").strip():
            count += 1
    return count


def _parse_force_new_session_after_turns(body):
    if not isinstance(body, dict):
        return DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS
    if "force_new_session_after_turns" in body:
        return int(body.get("force_new_session_after_turns") or 0)
    return DEFAULT_FORCE_NEW_SESSION_AFTER_TURNS


def _external_session_meta_from_gui(gui_result):
    if not isinstance(gui_result, dict):
        gui_result = {}
    return {
        "new_session_created": bool(gui_result.get("new_session_created")),
        "new_session_reason": (gui_result.get("new_session_reason") or "").strip(),
        "previous_session_id": (gui_result.get("previous_session_id") or "").strip(),
        "previous_turn_count": int(gui_result.get("previous_turn_count") or 0),
        "force_new_session_after_turns": int(
            gui_result.get("force_new_session_after_turns") or 0
        ),
    }


def _log_force_new_session_if_needed(body, gui_result):
    meta = _external_session_meta_from_gui(gui_result)
    if meta.get("new_session_reason") != "force_new_session_after_turns":
        return
    client_name = (body.get("client_name") or "default").strip() or "default"
    _log(
        "[EXTERNAL_API][FORCE_NEW_SESSION] "
        f"client_name={client_name} "
        f"previous_session_id={meta.get('previous_session_id') or '-'} "
        f"previous_turn_count={meta.get('previous_turn_count')} "
        f"limit={meta.get('force_new_session_after_turns')} "
        f"new_session_id={(gui_result.get('session_id') or '-')}"
    )


def _external_sessions_summary_from_gui():
    result = _dispatch_to_gui("sessions_summary", {}, timeout_sec=5)
    if result.get("ok") and isinstance(result.get("summary"), dict):
        return result["summary"]
    return {
        "total": 0,
        "bound_online": 0,
        "bound_offline": 0,
        "unbound": 0,
    }


def _external_client_key(body):
    client_name = (body.get("client_name") or body.get("client_id") or "").strip()
    if client_name:
        return client_name
    try:
        addr = (request.remote_addr or "").strip()
    except RuntimeError:
        addr = ""
    return addr or "unknown"


def _resolve_external_session_for_send(body):
    """
    解析外部 API 应使用的 session_id。
    返回 (session_id, new_session_flag, log_reason)。
    """
    new_session = bool(body.get("new_session", False))
    reuse_last_session = body.get("reuse_last_session", True) is not False
    session_id = str(body.get("session_id") or "").strip()
    auto_create_session = bool(body.get("auto_create_session", True))
    client_key = _external_client_key(body)

    if new_session:
        return "", True, "new_session_true"

    if session_id:
        return session_id, False, "client_session_id"

    if reuse_last_session:
        with _state_lock:
            last = (_external_client_sessions.get(client_key) or "").strip()
        if last:
            return last, False, "reuse_last_session"

    if auto_create_session:
        return "", False, "no_session_id"

    return "", False, ""


def _remember_external_client_session(body, session_id):
    session_id = (session_id or "").strip()
    if not session_id:
        return
    client_key = _external_client_key(body)
    with _state_lock:
        _external_client_sessions[client_key] = session_id


def _external_create_chat_send(body):
    text = (body.get("text") or "").strip()
    if not text:
        return None, _external_json_error("text 不能为空", "EMPTY_TEXT", 400)
    client_name = (body.get("client_name") or "").strip() or "default"
    client_key = _external_client_key(body)
    auto_create_session = bool(body.get("auto_create_session", True))
    auto_open_home = bool(body.get("auto_open_home", True))
    new_session = bool(body.get("new_session", False))
    reuse_last_session = body.get("reuse_last_session", True) is not False
    force_new_session_after_turns = _parse_force_new_session_after_turns(body)
    timeout = float(body.get("timeout") or 120)
    if timeout <= 0:
        timeout = 120

    session_id, force_new_session_flag, resolve_reason = _resolve_external_session_for_send(
        body
    )
    if new_session or force_new_session_flag:
        new_session = True
        session_id = ""
        _log(
            f"[EXTERNAL_API][CREATE_SESSION] client_name={client_key} "
            f"reason={resolve_reason or 'new_session_true'}"
        )
    elif session_id and resolve_reason in ("client_session_id", "reuse_last_session"):
        _log(
            f"[EXTERNAL_API][REUSE_SESSION] client_name={client_key} "
            f"session_id={session_id} reason={resolve_reason}"
        )
    elif not session_id and auto_create_session:
        _log(
            f"[EXTERNAL_API][CREATE_SESSION] client_name={client_key} "
            f"reason={resolve_reason or 'no_session_id'}"
        )

    gui_payload = {
        "session_id": session_id,
        "text": text,
        "auto_create_session": auto_create_session,
        "auto_open_home": auto_open_home,
        "new_session": new_session,
        "reuse_last_session": reuse_last_session,
        "client_name": client_name,
        "force_new_session_after_turns": force_new_session_after_turns,
    }
    gui_result = _dispatch_to_gui("chat_send", gui_payload, timeout_sec=min(60, timeout))
    if not gui_result.get("ok"):
        code = gui_result.get("code") or "INTERNAL_ERROR"
        error = gui_result.get("error") or "发送失败"
        _log(
            f"[EXTERNAL_API][ERROR] chat_send code={code} error={error} "
            f"session_id={session_id or '-'} text_len={len(text)}"
        )
        status = 404 if code == "SESSION_NOT_FOUND" else 400
        if code in ("UNAUTHORIZED",):
            status = 401
        return None, _external_json_error(error, code, status)

    session_id = (gui_result.get("session_id") or session_id or "").strip()
    _remember_external_client_session(body, session_id)
    bridge_message_id = (gui_result.get("bridge_message_id") or "").strip()
    turn_id = (gui_result.get("turn_id") or "").strip()
    pending_home = bool(gui_result.get("pending_home"))
    session_meta = _external_session_meta_from_gui(gui_result)
    _log_force_new_session_if_needed(body, gui_result)
    if pending_home and session_id:
        _log(
            f"[EXTERNAL_API][OPEN_HOME] session_id={session_id} "
            f"reason=no_bound_conversation_and_no_idle_home"
        )
    request_id = _new_external_request_id()
    initial_status = "waiting" if pending_home else "queued"
    _register_external_request(
        request_id,
        session_id,
        text,
        timeout,
        turn_id=turn_id,
        bridge_message_id=bridge_message_id,
        status=initial_status,
    )
    _log(
        f"[EXTERNAL_API][SEND] request_id={request_id} session_id={session_id} "
        f"bridge_message_id={bridge_message_id or '-'} text_len={len(text)} "
        f"status={initial_status} pending_home={pending_home}"
    )
    return {
        "request_id": request_id,
        "session_id": session_id,
        "status": initial_status,
        **session_meta,
    }, None


def _require_external_auth():
    if _external_auth_ok():
        return None
    return _external_json_error("未授权", "UNAUTHORIZED", 401)


def _external_auth_denied():
    return _require_external_auth()


def _external_request_body():
    return request.get_json(silent=True) or {}


def _json_body_or_error(log_tag):
    try:
        return request.get_json(silent=True) or {}, None
    except Exception as exc:
        _log(f"{log_tag} reason=json_error error={exc}")
        return None, jsonify({
            "ok": False,
            "error": f"invalid json: {exc}",
        }), 400


@app.route("/api/v1/status", methods=["GET"])
def api_v1_status():
    denied = _external_auth_denied()
    if denied:
        return denied
    tm = get_tm_online_summary()
    with _state_lock:
        waiting_count = len(_outbound_waiting)
        queue_len = len(_outbound_queue)
        control_len = len(_control_queue)
    sessions = _external_sessions_summary_from_gui()
    return _external_json_ok(
        server="running",
        bridge="ready",
        bridge_endpoint="/api/bridge",
        external_api="ready",
        tampermonkey={
            "online_clients": tm.get("online_clients", 0),
            "online_home_clients": tm.get("online_home_clients", 0),
            "online_conversation_clients": tm.get("online_conversation_clients", 0),
        },
        tm={
            "online_clients": tm.get("online_clients", 0),
            "online_home_clients": tm.get("online_home_clients", 0),
            "online_conversation_clients": tm.get("online_conversation_clients", 0),
        },
        queues={
            "chat_queue": queue_len,
            "control_queue": control_len,
            "waiting": waiting_count,
        },
        sessions=sessions,
    )


@app.route("/api/v1/chat/send", methods=["POST"])
def api_v1_chat_send():
    denied = _external_auth_denied()
    if denied:
        return denied
    body = _external_request_body()
    try:
        result, err_resp = _external_create_chat_send(body)
        if err_resp:
            return err_resp
        return _external_json_ok(
            request_id=result["request_id"],
            session_id=result["session_id"],
            status=result["status"],
            new_session_created=bool(result.get("new_session_created")),
            new_session_reason=result.get("new_session_reason") or "",
            previous_session_id=result.get("previous_session_id") or "",
            previous_turn_count=int(result.get("previous_turn_count") or 0),
            force_new_session_after_turns=int(
                result.get("force_new_session_after_turns") or 0
            ),
        )
    except Exception as error:
        detail = f"{error}\n{traceback.format_exc()}"
        _log(f"[EXTERNAL_API][ERROR] send exception={detail}")
        return _external_json_error(str(error), "INTERNAL_ERROR", 500)


@app.route("/api/v1/chat/result/<request_id>", methods=["GET"])
def api_v1_chat_result(request_id):
    denied = _external_auth_denied()
    if denied:
        return denied
    req = _get_external_request(request_id)
    if not req:
        return _external_json_error("request_id 不存在", "SESSION_NOT_FOUND", 404)
    status = req.get("status") or "waiting"
    _log(
        f"[EXTERNAL_API][RESULT] request_id={request_id} session_id={req.get('session_id') or '-'} "
        f"bridge_message_id={req.get('bridge_message_id') or '-'} status={status} "
        f"error={req.get('error') or '-'}"
    )
    if status == "done":
        return _external_json_ok(
            request_id=request_id,
            status="done",
            reply=req.get("reply") or "",
        )
    if status in ("failed", "timeout"):
        return jsonify(
            {
                "ok": False,
                "request_id": request_id,
                "status": status,
                "error": req.get("error") or status,
                "code": "REPLY_TIMEOUT" if status == "timeout" else "INTERNAL_ERROR",
            }
        )
    return _external_json_ok(
        request_id=request_id,
        status="waiting",
        reply="",
    )


@app.route("/api/v1/chat/ask", methods=["POST"])
def api_v1_chat_ask():
    denied = _external_auth_denied()
    if denied:
        return denied
    body = _external_request_body()
    text = (body.get("text") or "").strip()
    text_len = len(text)
    try:
        result, err_resp = _external_create_chat_send(body)
        if err_resp:
            return err_resp
        request_id = result["request_id"]
        session_id = result["session_id"]
        ask_session_meta = {
            "new_session_created": bool(result.get("new_session_created")),
            "new_session_reason": result.get("new_session_reason") or "",
            "previous_session_id": result.get("previous_session_id") or "",
            "previous_turn_count": int(result.get("previous_turn_count") or 0),
            "force_new_session_after_turns": int(
                result.get("force_new_session_after_turns") or 0
            ),
        }
        timeout = float(body.get("timeout") or 30)
        if timeout <= 0:
            timeout = 30
        timeout = max(1, min(timeout, 30))
        _log(
            f"[EXTERNAL_API][ASK] request_id={request_id} session_id={session_id} "
            f"text_len={text_len} timeout={timeout}"
        )
        deadline = _now() + timeout
        while _now() < deadline:
            req = _get_external_request(request_id)
            if not req:
                return _external_json_error("request_id 丢失", "INTERNAL_ERROR", 500)
            status = req.get("status") or "waiting"
            if status == "done":
                return _external_json_ok(
                    request_id=request_id,
                    session_id=req.get("session_id") or session_id,
                    reply=req.get("reply") or "",
                    **ask_session_meta,
                )
            if status in ("failed", "timeout"):
                code = "REPLY_TIMEOUT" if status == "timeout" else "INTERNAL_ERROR"
                return jsonify(
                    {
                        "ok": False,
                        "request_id": request_id,
                        "session_id": req.get("session_id") or session_id,
                        "status": status,
                        "error": req.get("error") or status,
                        "code": code,
                    }
                )
            time.sleep(0.2)
        with _state_lock:
            req = _external_requests.get(request_id)
            if req:
                req["status"] = "timeout"
                req["error"] = f"等待回复超时（{int(timeout)}s）"
                req["updated_at"] = _now()
        _log(
            f"[EXTERNAL_API][TIMEOUT] request_id={request_id} session_id={session_id} "
            f"bridge_message_id={(req or {}).get('bridge_message_id') or '-'} "
            f"text_len={text_len}"
        )
        return jsonify(
            {
                "ok": False,
                "request_id": request_id,
                "session_id": session_id,
                "status": "timeout",
                "error": f"等待回复超时（{int(timeout)}s）",
                "code": "REPLY_TIMEOUT",
            }
        )
    except Exception as error:
        detail = f"{error}\n{traceback.format_exc()}"
        _log(f"[EXTERNAL_API][ERROR] ask exception={detail}")
        return _external_json_error(str(error), "INTERNAL_ERROR", 500)


@app.route("/api/v1/sessions", methods=["GET", "POST"])
def api_v1_sessions():
    denied = _external_auth_denied()
    if denied:
        return denied
    if request.method == "GET":
        gui_result = _dispatch_to_gui("sessions_list", {}, timeout_sec=10)
        if not gui_result.get("ok"):
            return _external_json_error(
                gui_result.get("error") or "获取会话列表失败",
                gui_result.get("code") or "INTERNAL_ERROR",
                500,
            )
        return _external_json_ok(sessions=gui_result.get("sessions") or [])
    gui_result = _dispatch_to_gui(
        "sessions_create",
        {"title": _external_request_body().get("title") or "新对话"},
        timeout_sec=10,
    )
    if not gui_result.get("ok"):
        return _external_json_error(
            gui_result.get("error") or "创建会话失败",
            gui_result.get("code") or "INTERNAL_ERROR",
            500,
        )
    return _external_json_ok(session=gui_result.get("session") or {})


@app.route("/api/v1/sessions/<session_id>", methods=["GET"])
def api_v1_session_detail(session_id):
    denied = _external_auth_denied()
    if denied:
        return denied
    gui_result = _dispatch_to_gui(
        "sessions_get",
        {"session_id": session_id},
        timeout_sec=10,
    )
    if not gui_result.get("ok"):
        code = gui_result.get("code") or "INTERNAL_ERROR"
        status = 404 if code == "SESSION_NOT_FOUND" else 500
        return _external_json_error(
            gui_result.get("error") or "会话不存在",
            code,
            status,
        )
    return _external_json_ok(session=gui_result.get("session") or {})


@app.route("/api/v1/sessions/<session_id>/bind", methods=["POST", "DELETE"])
def api_v1_session_bind(session_id):
    denied = _external_auth_denied()
    if denied:
        return denied
    body = _external_request_body()
    if request.method == "DELETE" or body.get("clear"):
        gui_result = _dispatch_to_gui(
            "sessions_bind_clear",
            {
                "session_id": session_id,
                "reason": (body.get("reason") or "api_delete").strip(),
            },
            timeout_sec=15,
        )
        if not gui_result.get("ok"):
            code = gui_result.get("code") or "INTERNAL_ERROR"
            status = 404 if code == "SESSION_NOT_FOUND" else 400
            return _external_json_error(
                gui_result.get("error") or "清空绑定失败",
                code,
                status,
            )
        return _external_json_ok(
            ok=True,
            session_id=session_id,
            bind_state=gui_result.get("bind_state") or "UNBOUND",
            session=gui_result.get("session") or {},
        )

    client_id = (body.get("client_id") or "").strip()
    page_url = (body.get("page_url") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    page_instance_id = (body.get("page_instance_id") or "").strip()
    if not conversation_id and page_url:
        conversation_id = parse_conversation_id(page_url) or ""
    if not page_url and conversation_id:
        page_url = f"https://chatgpt.com/c/{conversation_id}"
    if not any([client_id, page_url, conversation_id, page_instance_id]):
        return _external_json_error(
            "缺少页面身份信息（client_id / page_url / conversation_id / page_instance_id）",
            "EMPTY_TEXT",
            400,
        )
    gui_result = _dispatch_to_gui(
        "sessions_bind",
        {
            "session_id": session_id,
            "client_id": client_id,
            "page_url": page_url,
            "conversation_id": conversation_id,
            "page_instance_id": page_instance_id,
            "allow_offline": bool(body.get("allow_offline", True)),
            "allow_not_syncable": bool(body.get("allow_not_syncable", True)),
        },
        timeout_sec=15,
    )
    if not gui_result.get("ok"):
        code = gui_result.get("code") or "INTERNAL_ERROR"
        status = 404 if code == "SESSION_NOT_FOUND" else 400
        return _external_json_error(
            gui_result.get("error") or "绑定失败",
            code,
            status,
        )
    return _external_json_ok(
        session=gui_result.get("session") or {},
        session_id=gui_result.get("session_id") or session_id,
        bound_client_id=gui_result.get("bound_client_id") or client_id,
        bound_page_instance_id=gui_result.get("bound_page_instance_id") or page_instance_id,
        bound_conversation_id=gui_result.get("bound_conversation_id") or conversation_id,
        bound_url=gui_result.get("bound_url") or page_url,
        bind_state=gui_result.get("bind_state") or "bound",
    )


def _is_local_remote_addr(remote_addr):
    addr = (remote_addr or "").strip().lower()
    if not addr:
        return True
    if addr in ("127.0.0.1", "localhost", "::1"):
        return True
    if addr.startswith("::ffff:127."):
        return True
    return False


@app.route("/api/bridge", methods=["POST"])

def api_bridge():
    """油猴专用交互接口：poll / ack / report"""
    denied = _external_auth_denied()
    if denied:
        return denied
    source = request.headers.get("X-Request-Source")
    if source != "tampermonkey":
        return jsonify({"ok": False, "error": "需要 X-Request-Source: tampermonkey"}), 403
    body = _external_request_body()
    remote_addr = (request.remote_addr or "").strip() or "-"
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
    with _state_lock:
        if action == "poll":
            result, need_notify = _handle_poll(body)
        elif action == "ack":
            result = _handle_ack(body)
        elif action == "report":
            result = _handle_report(body)
        else:
            return jsonify({"ok": False, "error": f"未知 action: {action}"}), 400
    if need_notify:
        _notify_status()
    result["server_time"] = _now()
    result["tampermonkey_online"] = True
    return jsonify(result)

@app.route("/api/cursor/tasks/create", methods=["POST"])
def api_cursor_tasks_create():
    body, error_response = _json_body_or_error("[CURSOR_BRIDGE][TASK_CREATE_FAILED]")
    if error_response:
        return error_response

    task = body.get("task") if isinstance(body.get("task"), dict) else body

    ok, result = enqueue_cursor_task(task)

    if not ok:
        return jsonify({
            "ok": False,
            "error": result,
        }), 400

    return jsonify({
        "ok": True,
        "task_id": result,
    })


@app.route("/api/cursor/tasks/next", methods=["GET"])
def api_cursor_tasks_next():
    client = (request.args.get("client") or "").strip()
    task = claim_next_cursor_task(client=client)

    return jsonify({
        "ok": True,
        "task": task,
    })


@app.route("/api/cursor/tasks/report", methods=["POST"])
def api_cursor_tasks_report():
    report, error_response = _json_body_or_error("[CURSOR_BRIDGE][REPORT_FAILED]")
    if error_response:
        return error_response

    ok, result = append_cursor_task_report(report)

    if not ok:
        return jsonify({
            "ok": False,
            "error": result,
        }), 400

    return jsonify({
        "ok": True,
    })


@app.route("/api/cursor/tasks/status", methods=["GET"])
def api_cursor_tasks_status():
    """查询 Cursor Bridge 状态与队列摘要。"""
    status = get_cursor_bridge_status()
    return jsonify(
        {
            "ok": True,
            "cursor": status,
            "pending_count": status.get("pending_count", 0),
            "reports": status.get("reports") or [],
            "history": status.get("history") or [],
        }
    )


@app.route("/api/cursor/client/heartbeat", methods=["POST"])
def api_cursor_client_heartbeat():
    payload, error_response = _json_body_or_error("[CURSOR_BRIDGE][HEARTBEAT_FAILED]")
    if error_response:
        return error_response

    ok, result = update_cursor_client_heartbeat(payload)

    if not ok:
        return jsonify({
            "ok": False,
            "error": result,
        }), 400

    return jsonify({
        "ok": True,
        "status": get_cursor_bridge_status(),
    })


def send_job_chatgpt_message(job_id, payload_extra=None):
    """将 Job 的 ChatGPT prompt 加入出站队列。"""
    return _job_scheduler.send_job_to_chatgpt(job_id, push_message, payload_extra)


def send_job_to_cursor(job_id):
    """将 Job 的 ChatGPT 回复原文发送到 Cursor 任务队列。"""
    return _job_scheduler.send_job_to_cursor(job_id, enqueue_cursor_task)


@app.route("/api/jobs/create", methods=["POST"])
def api_jobs_create():
    body, error_response = _json_body_or_error("[JOB][API_CREATE_FAILED]")
    if error_response:
        return error_response

    requirement = (body.get("user_requirement") or body.get("requirement") or "").strip()
    title = (body.get("title") or "").strip()
    auto_send = bool(body.get("auto_send_to_cursor"))
    project_root = (body.get("project_root") or "").strip()

    job_id, result = _job_scheduler.create_job(
        requirement,
        title=title,
        auto_send_to_cursor=auto_send,
        project_root=project_root,
    )
    if not job_id:
        return jsonify({"ok": False, "error": result}), 400

    return jsonify({"ok": True, "job_id": job_id, "job": _job_scheduler.get_job(job_id)})


@app.route("/api/jobs/list", methods=["GET"])
def api_jobs_list():
    limit = request.args.get("limit", 50)
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 50
    return jsonify({
        "ok": True,
        "jobs": _job_scheduler.list_jobs(limit=limit),
        "snapshot": _job_scheduler.get_job_scheduler_snapshot(limit=limit),
    })


@app.route("/api/jobs/status", methods=["GET"])
def api_jobs_status():
    job_id = (request.args.get("job_id") or "").strip()
    if job_id:
        job = _job_scheduler.get_job(job_id)
        if not job:
            return jsonify({"ok": False, "error": "job not found"}), 404
        return jsonify({"ok": True, "job": job})
    return jsonify({
        "ok": True,
        "snapshot": _job_scheduler.get_job_scheduler_snapshot(),
    })


@app.route("/api/jobs/send_to_cursor", methods=["POST"])
def api_jobs_send_to_cursor():
    body, error_response = _json_body_or_error("[JOB][API_SEND_CURSOR_FAILED]")
    if error_response:
        return error_response

    job_id = (body.get("job_id") or "").strip()
    if not job_id:
        return jsonify({"ok": False, "error": "job_id is required"}), 400

    ok, result = send_job_to_cursor(job_id)
    if not ok:
        return jsonify({"ok": False, "error": result}), 400
    return jsonify({"ok": True, "task_id": result, "job": _job_scheduler.get_job(job_id)})


@app.route("/api/jobs/cancel", methods=["POST"])
def api_jobs_cancel():
    body, error_response = _json_body_or_error("[JOB][API_CANCEL_FAILED]")
    if error_response:
        return error_response

    job_id = (body.get("job_id") or "").strip()
    reason = (body.get("reason") or "").strip()
    if not job_id:
        return jsonify({"ok": False, "error": "job_id is required"}), 400

    ok, result = _job_scheduler.cancel_job(job_id, reason=reason)
    if not ok:
        return jsonify({"ok": False, "error": result}), 400
    return jsonify({"ok": True, "job": _job_scheduler.get_job(job_id)})


@app.route("/health", methods=["GET"])
def health():
    """轻量健康检查（无需鉴权），供 bridge_client 等探测。"""
    return jsonify({"ok": True, "server": "running"})


@app.route("/api/status", methods=["GET"])
def api_status():
    _log(
        "[API][DEPRECATED] endpoint=/api/status "
        "replacement=/api/v1/status (GUI 仍可用此接口作兼容探测)"
    )
    return jsonify(get_bridge_status())

@app.route("/process", methods=["POST"])

def process_legacy():
    """@deprecated 旧版接口。当前油猴应使用 /api/bridge。"""
    if not ENABLE_LEGACY_PROCESS_ENDPOINT:
        return jsonify(
            {
                "ok": False,
                "error": "legacy /process endpoint is disabled; use /api/bridge",
                "code": "LEGACY_PROCESS_DISABLED",
            }
        ), 410
    _log(
        "[API][DEPRECATED] endpoint=/process replacement=/api/bridge "
        "(legacy process_legacy; client.user.js 应使用 /api/bridge)"
    )
    source = request.headers.get("X-Request-Source")
    if source == "tampermonkey":
        body = request.get_json(silent=True) or {}
        if not body.get("action"):
            body["action"] = "poll"
        if not body.get("client_id"):
            body["client_id"] = "legacy-client"
        need_notify = False
        with _state_lock:
            result, need_notify = _handle_poll(body)
        if need_notify:
            _notify_status()
        return jsonify(
            {
                "status": "new data" if result.get("has_message") else "no new data",
                "processed_data": result.get("content") or "",
                "message_id": result.get("message_id"),
            }
        )
    if source == "client":
        data_from_client = None
        if request.is_json:
            data_from_client = request.json.get("data")
        else:
            data_from_client = request.data.decode("utf-8")
        try:
            push_message(data_from_client)
        except ValueError as error:
            return jsonify({
                "ok": False,
                "error": str(error),
                "code": "EMPTY_MESSAGE",
            }), 400
        except RuntimeError as error:
            return jsonify({
                "ok": False,
                "error": str(error),
                "code": "QUEUE_FULL",
            }), 503
        return jsonify(
            {
                "status": "new data",
                "processed_data": "我是服务器端，谢谢客户端的来信",
            }
        )
    need_notify = False
    with _state_lock:
        result, need_notify = _handle_poll({"client_id": "anonymous"})
    if need_notify:
        _notify_status()
    return jsonify(
        {
            "status": "new data" if result.get("has_message") else "no new data",
            "processed_data": result.get("content") or "",
            "message_id": result.get("message_id"),
        }
    )

def is_server_running():
    return _http_server is not None


def get_server_bind_host():
    return _server_bind_host or ""


def get_server_port():
    return _server_port


def get_server_public_host():
    if _server_public_host:
        return _server_public_host
    bind_host = get_server_bind_host()
    if bind_host in ("0.0.0.0", "::"):
        return "127.0.0.1"
    return bind_host or "127.0.0.1"


def get_server_url():
    port = get_server_port()
    if not port:
        return ""
    return f"http://{get_server_public_host()}:{port}"


def get_server_bridge_url():
    url = get_server_url()
    if not url:
        return ""
    return f"{url}/api/bridge"


def _public_host_for_bind(bind_host):
    bind_host = (bind_host or "").strip() or "127.0.0.1"
    if bind_host in ("0.0.0.0", "::"):
        return "127.0.0.1"
    return bind_host


def is_port_available(host, port):
    host = (host or "").strip() or "127.0.0.1"
    port = int(port)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((host, port))
        return True, ""
    except OSError as error:
        detail = (
            f"host={host} port={port} "
            f"errno={getattr(error, 'errno', None)} "
            f"winerror={getattr(error, 'winerror', None)} "
            f"error={error}"
        )
        return False, detail
    finally:
        sock.close()


def _format_bind_error_message(error, host, port):
    winerror = getattr(error, "winerror", None)
    url = f"http://{_public_host_for_bind(host)}:{int(port)}"
    if winerror == 10013:
        return (
            "服务启动失败：Windows 拒绝绑定该地址或端口。\n"
            "请检查端口是否被系统保留、防火墙是否拦截、监听地址是否正确。\n"
            f"当前地址：{url}"
        )
    if winerror == 10048:
        return (
            "服务启动失败：端口已被占用。\n"
            "请关闭旧的 GUI.py / python.exe，或更换端口。"
        )
    return (
        f"服务启动失败：{error}\n"
        f"host={host} port={port} "
        f"errno={getattr(error, 'errno', None)} "
        f"winerror={winerror}"
    )


def _log_start_failure(error, host, port):
    detail = (
        f"[SERVER][START_FAILED] "
        f"host={host} port={port} "
        f"errno={getattr(error, 'errno', None)} "
        f"winerror={getattr(error, 'winerror', None)} "
        f"error={error}\n{traceback.format_exc()}"
    )
    _log(detail)


def _write_server_url_file(url):
    if not url:
        return
    try:
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        SERVER_URL_FILE.write_text(url.strip() + "\n", encoding="utf-8")
    except OSError as error:
        _log(
            f"[SERVER][URL_FILE] 写入失败 path={SERVER_URL_FILE} "
            f"errno={getattr(error, 'errno', None)} "
            f"winerror={getattr(error, 'winerror', None)} error={error}"
        )


def _clear_server_url_file():
    try:
        if SERVER_URL_FILE.exists():
            SERVER_URL_FILE.unlink()
    except OSError as error:
        _log(
            f"[SERVER][URL_FILE] 删除失败 path={SERVER_URL_FILE} "
            f"errno={getattr(error, 'errno', None)} "
            f"winerror={getattr(error, 'winerror', None)} error={error}"
        )


def start_server(host="127.0.0.1", port=5000, fallback_ports=None):
    global _http_server, _server_thread
    global _server_bind_host, _server_port, _server_public_host

    bind_host = (host or "").strip() or "127.0.0.1"
    configured_port = int(port)
    if _http_server is not None:
        result = {
            "ok": False,
            "already_running": True,
            "message": "服务已经在运行中。",
            "bind_host": get_server_bind_host(),
            "host": get_server_public_host(),
            "port": get_server_port(),
            "url": get_server_url(),
        }
        return result

    extra_ports = list(fallback_ports if fallback_ports is not None else FALLBACK_PORTS)
    candidates = []
    for candidate in [configured_port, *extra_ports]:
        if candidate not in candidates:
            candidates.append(int(candidate))

    failures = []
    for candidate_port in candidates:
        available, check_detail = is_port_available(bind_host, candidate_port)
        _log(
            f"[SERVER][BIND_CHECK] host={bind_host} port={candidate_port} "
            f"available={available} reason={check_detail or '-'}"
        )
        try:
            request_handler = WSGIRequestHandler
            if not is_debug_mode():
                request_handler = SilentWSGIRequestHandler
            http_server = make_server(
                bind_host,
                candidate_port,
                app,
                threaded=True,
                request_handler=request_handler,
            )
        except OSError as error:
            _log_start_failure(error, bind_host, candidate_port)
            failures.append(
                {
                    "port": candidate_port,
                    "message": _format_bind_error_message(error, bind_host, candidate_port),
                    "errno": getattr(error, "errno", None),
                    "winerror": getattr(error, "winerror", None),
                }
            )
            continue

        _http_server = http_server
        _server_thread = threading.Thread(
            target=_http_server.serve_forever, daemon=True
        )
        _server_thread.start()
        _server_bind_host = bind_host
        _server_port = candidate_port
        _server_public_host = _public_host_for_bind(bind_host)
        server_url = get_server_url()
        bridge_url = get_server_bridge_url()

        if candidate_port != configured_port:
            _log(
                f"[SERVER][FALLBACK_PORT] old_port={configured_port} "
                f"new_port={candidate_port}"
            )
        _log(f"[SERVER][STARTED] url={server_url}")
        _log(f"服务已启动：{server_url}")
        _log(f"  油猴接口 POST {bridge_url}")
        _log(f"  外部 API GET/POST /api/v1/*")
        print_registered_routes()
        if (API_TOKEN or "").strip():
            _log(f"  外部 API 鉴权：已启用（CHATGPT_PAGE_BRIDGE_TOKEN）")
        _write_server_url_file(server_url)

        result = {
            "ok": True,
            "already_running": False,
            "bind_host": bind_host,
            "host": _server_public_host,
            "port": candidate_port,
            "configured_port": configured_port,
            "fallback_used": candidate_port != configured_port,
            "url": server_url,
            "bridge_url": bridge_url,
            "message": f"服务已启动：{server_url}",
        }
        _notify_status()
        return result

    combined_message = "\n\n".join(item["message"] for item in failures if item.get("message"))
    if not combined_message:
        combined_message = (
            f"服务启动失败：无法在 {bind_host} 上绑定端口 "
            f"{', '.join(str(p) for p in candidates)}。"
        )
    else:
        combined_message = (
            "所有候选端口均启动失败。\n" + combined_message
        )

    result = {
        "ok": False,
        "already_running": False,
        "bind_host": bind_host,
        "host": _public_host_for_bind(bind_host),
        "port": None,
        "configured_port": configured_port,
        "fallback_used": False,
        "url": "",
        "bridge_url": "",
        "message": combined_message,
        "failures": failures,
    }
    _log(f"[SERVER][START_FAILED] all_candidates_exhausted bind_host={bind_host} ports={candidates}")
    return result


def stop_server():
    global _http_server, _server_thread
    global _server_bind_host, _server_port, _server_public_host
    if _http_server is None:
        return False
    _http_server.shutdown()
    _http_server = None
    _server_thread = None
    _server_bind_host = None
    _server_port = None
    _server_public_host = None
    _clear_server_url_file()
    _log("服务已停止")
    _notify_status()
    return True

@app.after_request

def after_request(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
_configure_werkzeug_access_log()
if __name__ == "__main__":
    clear_log_file()
    start_server()
    try:
        if _server_thread:
            _server_thread.join()
    except KeyboardInterrupt:
        stop_server()
