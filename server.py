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
from app.utils.tm_activity import classify_tm_client_activity, compute_tm_activity_metrics
from flask_cors import CORS
from werkzeug.serving import make_server

app = Flask(__name__)
CORS(app)
app.logger.setLevel("ERROR")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
_state_lock = threading.RLock()
_log_callback = None
_status_callback = None
_external_gui_dispatch = None
_http_server = None
_server_thread = None
_server_bind_host = None
_server_port = None
_server_public_host = None
_last_start_result = {}
FALLBACK_PORTS = [5001, 5055, 8765, 18080, 18765]
RUNTIME_DIR = Path(__file__).resolve().parent / "runtime"
SERVER_URL_FILE = RUNTIME_DIR / "server_url.txt"
# 油猴连接状态
tampermonkey_last_seen = None
tampermonkey_client_id = None
tampermonkey_page_url = None
bound_client_id = None
bound_session_id = None
_tampermonkey_clients = {}
_known_page_instances = set()
_last_heartbeat_log = {}
_last_tm_activity_classify_log = {}
_last_tm_response_state_log = {}
_poll_summaries = {}
_last_poll_identity = {}
_debug_mode = False
POLL_SUMMARY_INTERVAL_SEC = 10
API_TOKEN = os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")
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


def is_debug_mode():
    with _state_lock:
        return _debug_mode


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
# 出站：服务端 -> 油猴 -> ChatGPT
_outbound_queue = deque(maxlen=50)
_outbound_waiting = {}
# 控制命令（close_self 等）：独立于聊天队列，避免被 waiting 阻塞
_control_queue = deque(maxlen=50)
_control_waiting = {}
# 入站：油猴 -> 服务端（事件、回执、页面信息等）
_inbound_messages = deque(maxlen=100)
# 历史出站（已确认或失败）
_outbound_history = deque(maxlen=50)
ONLINE_TIMEOUT_SEC = 15
LEASE_SEC = 30

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


def _log(message):
    text = str(message or "")
    if _log_callback:
        _log_callback(f"[SERVER] {text}")
    else:
        append_log(text, source="SERVER", echo=True)

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
    page_url = (meta.get("page_url") or "").strip()
    if page_type == "ignored":
        return True
    if "/backend-api/" in page_url or "/sentinel/" in page_url or "frame.html" in page_url:
        return True
    if meta.get("is_top_frame") is False:
        return True
    return False

def get_tm_online_summary(bound_client_id=None, bound_conversation_id=None):
    """统计油猴 client 在线数量与活跃/绑定状态（绑定信息由 GUI 会话传入）。"""
    bound_client_id = (bound_client_id or "").strip() or None
    bound_conversation_id = (bound_conversation_id or "").strip() or None
    if bound_conversation_id in ("", "-"):
        bound_conversation_id = None

    with _state_lock:
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
        "online_timeout_sec": ONLINE_TIMEOUT_SEC,
    }

def _snapshot_clients():
    items = []
    now = _now()
    for client_id, info in sorted(_tampermonkey_clients.items()):
        last_seen = info.get("last_seen")
        visibility = (info.get("visibility_state") or "").strip()
        activity_state = classify_tm_client_activity(info, now=now)
        _, seen_age, poll_age, _ = compute_tm_activity_metrics(info, now=now)
        items.append(
            {
                "client_id": client_id,
                "page_instance_id": info.get("page_instance_id") or "",
                "script_version": info.get("script_version") or "",
                "page_url": info.get("page_url") or "",
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
                "last_response_state_seen_at": info.get("last_response_state_seen_at"),
                "response_started_at": info.get("response_started_at"),
                "response_last_text_changed_at": info.get("response_last_text_changed_at"),
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
        }

def set_bound_client_id(client_id, session_id=None):
    """@deprecated 当前推荐使用 GUI 的 session.remote_chatgpt 保存每个对话绑定。"""
    _log("[DEPRECATED] set_bound_client_id called; prefer session.remote_chatgpt binding")
    global bound_client_id, bound_session_id
    client_id = (client_id or "").strip()
    session_id = (session_id or "").strip() if session_id is not None else None
    with _state_lock:
        bound_client_id = client_id or None
        if session_id is not None:
            bound_session_id = session_id or None
        if client_id and client_id in _tampermonkey_clients:
            if session_id:
                _tampermonkey_clients[client_id]["bound_session_id"] = session_id
    _notify_status()

def get_bound_client_id():
    """@deprecated 当前推荐使用 GUI 的 session.remote_chatgpt 读取每个对话绑定。"""
    _log("[DEPRECATED][GET_BOUND_CLIENT] get_bound_client_id called")
    with _state_lock:
        return bound_client_id

def push_message(data):
    """GUI 或其它本地程序：向油猴下发一条待发送消息。"""
    if isinstance(data, str):
        payload = {"final_prompt": data, "raw_user_text": data}
    elif isinstance(data, dict):
        payload = dict(data)
    else:
        payload = {}
    session_id = (payload.get("session_id") or "").strip()
    turn_id = (payload.get("turn_id") or "").strip()
    raw_user_text = (payload.get("raw_user_text") or "").strip()
    final_prompt = (
        payload.get("final_prompt") or payload.get("content") or raw_user_text or ""
    ).strip()
    if not final_prompt:
        final_prompt = "Hello World"
    if not raw_user_text:
        raw_user_text = final_prompt
    target_client_id = (payload.get("target_client_id") or "").strip() or None
    target_page_url = (payload.get("target_page_url") or "").strip() or None
    target_page_instance_id = (
        (payload.get("target_page_instance_id") or "").strip() or None
    )
    conversation_id = (payload.get("conversation_id") or "").strip() or None
    conversation_url = (
        (payload.get("conversation_url") or target_page_url or "").strip() or None
    )
    bootstrap_conversation = bool(payload.get("bootstrap_conversation"))
    bind_request_id = (
        (payload.get("bind_request_id") or payload.get("launch_token") or "").strip()
        or None
    )
    launch_token = (payload.get("launch_token") or bind_request_id or "").strip() or None
    msg = {
        "id": str(uuid.uuid4()),
        "type": "chat",
        "session_id": session_id,
        "turn_id": turn_id,
        "raw_user_text": raw_user_text,
        "content": final_prompt,
        "target_client_id": target_client_id,
        "target_page_url": target_page_url,
        "target_page_instance_id": target_page_instance_id,
        "conversation_id": conversation_id,
        "conversation_url": conversation_url,
        "bootstrap_conversation": bootstrap_conversation,
        "bind_request_id": bind_request_id,
        "launch_token": launch_token,
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
        _outbound_queue.append(msg)
    preview = final_prompt if len(final_prompt) <= 80 else final_prompt[:80] + "..."
    target_hint = target_client_id or "-"
    page_hint = target_page_url or "-"
    if len(page_hint) > 60:
        page_hint = page_hint[:60] + "..."
    _log(
        f"[发送] 已加入队列 ({msg['id'][:8]}…) "
        f"session={session_id[:8] + '…' if session_id else '-'} "
        f"turn={turn_id[:8] + '…' if turn_id else '-'} "
        f"target_client={target_hint} page={page_hint}：{preview}"
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
        kept = deque(maxlen=_outbound_queue.maxlen)
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
        _control_queue.append(msg)

    label = log_label or command
    target_client_id = msg.get("target_client_id") or "-"
    target_page_url = msg.get("target_page_url") or "-"
    page_instance = msg.get("target_page_instance_id") or "-"
    conversation = msg.get("target_conversation_id") or "-"
    _log(
        f"[BRIDGE][CONTROL][QUEUE] command={command} "
        f"message_id={msg['id'][:8]}… "
        f"target_client_id={target_client_id} "
        f"target_page_url={target_page_url} "
        f"page_instance={page_instance} "
        f"conversation={conversation} "
        f"label={label}"
    )
    _notify_status()
    return msg


def _append_control_messages(msgs, *, log_label="batch", log_detail=""):
    if not msgs:
        return []
    with _state_lock:
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
    msg = {
        "id": str(uuid.uuid4()),
        "type": "command",
        "command": command,
        "status": "queued",
        "created_at": _now(),
        "delivered_to": None,
        "delivered_at": None,
        "lease_until": None,
        "acked_at": None,
        "finalized_at": None,
        "error_detail": None,
        "target_client_id": extra.pop("target_client_id", None),
        "target_page_url": extra.pop("target_page_url", None),
    }
    msg.update(extra)
    return msg

def push_close_page(client_id, target_page_url=None):
    """向指定油猴客户端下发关闭当前页面命令。"""
    client_id = (client_id or "").strip()
    if not client_id:
        raise ValueError("client_id 不能为空")

    return _queue_control_message(
        "close_self",
        log_label="close_page",
        target_client_id=client_id,
        target_page_url=(target_page_url or "").strip() or None,
    )


def push_reload_page(client_id, target_page_url=None):
    """向指定油猴客户端下发刷新当前页面命令。"""
    client_id = (client_id or "").strip()
    if not client_id:
        raise ValueError("client_id 不能为空")

    return _queue_control_message(
        "reload_self",
        log_label="reload_page",
        target_client_id=client_id,
        target_page_url=(target_page_url or "").strip() or None,
    )


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

    _queue_control_message(
        command,
        log_label=command,
        target_client_id=target_client_id,
        target_page_instance_id=target_page_instance_id or None,
        target_conversation_id=target_conversation_id or None,
        payload=dict(payload or {}),
    )
    return True


def push_close_other_pages(except_client_id):
    """关闭除 except_client_id 外所有在线 ChatGPT 页面。"""
    except_client_id = (except_client_id or "").strip()
    msgs = []
    with _state_lock:
        clients_snapshot = list(_tampermonkey_clients.items())
    for client_id, info in clients_snapshot:
        if client_id == except_client_id:
            continue
        if not _client_online(info.get("last_seen")):
            continue
        msgs.append(
            _make_command_message(
                "close_self",
                target_client_id=client_id,
                target_page_url=info.get("page_url"),
            )
        )
    return _append_control_messages(
        msgs,
        log_label="close_other",
        log_detail=f"command=close_self (保留 client_id={except_client_id or '-'})",
    )


def push_close_pages_by_url(url):
    """@deprecated 当前 GUI 优先按 client_id 关闭页面，建议使用 push_close_page(client_id)。"""
    _log(
        "[DEPRECATED][CLOSE_BY_URL] push_close_pages_by_url called; "
        "use push_close_page(client_id)"
    )
    url = (url or "").strip()
    if not url:
        raise ValueError("url 不能为空")
    msgs = []
    with _state_lock:
        clients_snapshot = list(_tampermonkey_clients.items())
    for client_id, info in clients_snapshot:
        page_url = (info.get("page_url") or "").strip()
        if page_url != url:
            continue
        if not _client_online(info.get("last_seen")):
            continue
        msgs.append(
            _make_command_message(
                "close_self",
                target_client_id=client_id,
                target_page_url=page_url,
            )
        )
    return _append_control_messages(
        msgs,
        log_label="close_by_url",
        log_detail=f"command=close_self url={url}",
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
    if prev == token and not _debug_mode:
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
    entry["page_title"] = (meta.get("page_title") or entry.get("page_title") or "").strip()
    entry["page_type"] = page_type or entry.get("page_type") or ""
    entry["conversation_id"] = conversation_id or entry.get("conversation_id") or ""
    entry["is_top_frame"] = bool(meta.get("is_top_frame", entry.get("is_top_frame", True)))
    entry["visibility_state"] = (meta.get("visibility_state") or entry.get("visibility_state") or "").strip()
    has_focus = bool(meta.get("has_focus", entry.get("has_focus")))
    entry["has_focus"] = has_focus
    if has_focus:
        entry["last_focus_at"] = now
    entry["pathname"] = (meta.get("pathname") or entry.get("pathname") or "").strip()
    is_responding = bool(meta.get("is_responding"))
    response_state = (meta.get("response_state") or "").strip() or entry.get("response_state") or "unknown"
    response_state_reason = (meta.get("response_state_reason") or "").strip()
    response_state_at = meta.get("response_state_at") or entry.get("response_state_at")
    can_accept_input = bool(meta.get("can_accept_input", True))
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
    entry["online"] = True
    if action == "poll":
        entry["last_poll_at"] = now
        entry["last_heartbeat_at"] = now
    elif action == "ack":
        entry["last_heartbeat_at"] = now
    elif action == "report":
        entry["last_report_at"] = now
        entry["last_heartbeat_at"] = now
    if page_url:
        entry["page_url"] = page_url
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
        state_key = (
            f"{page_type}|{conversation_id}|{visible}|{focus}|{responding}|{response_state_txt}|{input_txt}|{page_url}"
        )
        prev_key = _last_heartbeat_log.get(f"{client_id}:state")
        if _debug_mode:
            _log(
                f"[TM][HEARTBEAT] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} visible={visible} "
                f"focus={focus} responding={responding} state={response_state_txt} "
                f"input={input_txt} url={page_url or '-'}"
            )
        elif state_key != prev_key:
            _log(
                f"[TM][HEARTBEAT] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} visible={visible} "
                f"focus={focus} responding={responding} state={response_state_txt} "
                f"input={input_txt} url={page_url or '-'}"
            )
            _last_heartbeat_log[f"{client_id}:state"] = state_key

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


def _targeted_control_matches(msg, body):
    """flash_page / sync_conversation：严格匹配 client、page_instance、conversation。"""
    client_id = (body.get("client_id") or "").strip()
    if not _message_matches_client(msg, client_id):
        return False
    command = (msg.get("command") or "").strip()
    if command not in ("flash_page", "sync_conversation"):
        return False

    target_page_instance_id = (msg.get("target_page_instance_id") or "").strip()
    target_conversation_id = (msg.get("target_conversation_id") or "").strip()
    body_page_instance_id = (body.get("page_instance_id") or "").strip()
    body_conversation_id = (body.get("conversation_id") or "").strip()

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
    target_page = _normalize_page_url(msg.get("target_page_url") or "")
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

    # 1) 定向控制命令（flash_page / sync_conversation，严格匹配）
    msg = _rotate(lambda m: _targeted_control_matches(m, body))
    if msg:
        _log(
            f"[BRIDGE][CONTROL][CLAIM] command={(msg.get('command') or '-')} "
            f"message_id={msg['id'][:8]}… client_id={client_id} "
            f"page_instance_id={(body.get('page_instance_id') or '-')} "
            f"conversation_id={(body.get('conversation_id') or '-')}"
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
    # 4) 其余控制命令（含 reload_self、批量 close_self 等，不匹配定向命令）
    return _rotate(
        lambda m: (m.get("command") or "").strip()
        not in ("flash_page", "sync_conversation")
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

def _poll_identity_changed(client_id, page_type, conversation_id):
    prev = _last_poll_identity.get(client_id)
    current = (page_type or "", conversation_id or "")
    if prev is None:
        _last_poll_identity[client_id] = current
        return True
    if prev != current:
        _last_poll_identity[client_id] = current
        return True
    return False


def _poll_log_immediate(message):
    _log(message)


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
    resp = {
        "ok": True,
        "has_message": True,
        "message_id": msg["id"],
        "type": msg.get("type", "chat"),
        "retry": retry,
    }
    if msg.get("type") == "command":
        resp["command"] = msg.get("command")
        resp["url"] = msg.get("url")
        resp["active"] = msg.get("active", True)
        if msg.get("target_client_id"):
            resp["target_client_id"] = msg.get("target_client_id")
        if msg.get("target_page_url"):
            resp["target_page_url"] = msg.get("target_page_url")
        if msg.get("target_page_instance_id"):
            resp["target_page_instance_id"] = msg.get("target_page_instance_id")
        if msg.get("target_conversation_id"):
            resp["target_conversation_id"] = msg.get("target_conversation_id")
        if msg.get("payload") is not None:
            resp["payload"] = msg.get("payload")
    else:
        resp["content"] = msg.get("content") or ""
        if msg.get("session_id"):
            resp["session_id"] = msg.get("session_id")
        if msg.get("turn_id"):
            resp["turn_id"] = msg.get("turn_id")
        if msg.get("target_client_id"):
            resp["target_client_id"] = msg.get("target_client_id")
        if msg.get("target_page_url"):
            resp["target_page_url"] = msg.get("target_page_url")
        if msg.get("conversation_url"):
            resp["conversation_url"] = msg.get("conversation_url")
        if msg.get("conversation_id"):
            resp["conversation_id"] = msg.get("conversation_id")
        if msg.get("bootstrap_conversation"):
            resp["bootstrap_conversation"] = True
        if msg.get("target_page_instance_id"):
            resp["target_page_instance_id"] = msg.get("target_page_instance_id")
        if msg.get("bind_request_id"):
            resp["bind_request_id"] = msg.get("bind_request_id")
        if msg.get("launch_token"):
            resp["launch_token"] = msg.get("launch_token")
    return resp

def _handle_poll(body):
    client_id = (body.get("client_id") or "").strip()
    if not client_id:
        _poll_log_immediate("[BRIDGE][POLL] 拒绝：缺少 client_id")
        return {"ok": False, "error": "缺少 client_id"}
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    identity_changed = _poll_identity_changed(client_id, page_type, conversation_id)
    _touch_tampermonkey(body, action="poll")
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
        _notify_status()
        return _poll_response(cmd, retry=False)
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
            return _poll_response(waiting, retry=True)
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
            return _poll_response(waiting, retry=True)
    if waiting and not _is_finalized(waiting):
        if waiting.get("status") in ("acked", "delivered"):
            owner = waiting.get("delivered_to")
            if owner == client_id:
                if _debug_mode or identity_changed:
                    _poll_log_immediate(
                        f"[BRIDGE][POLL] client_id={client_id} message_id={waiting['id'][:8]}… "
                        f"status=awaiting_report has_message=False"
                    )
                else:
                    _record_poll_empty(client_id, page_type, conversation_id)
                return {"ok": True, "has_message": False}
        _poll_log_immediate(
            f"[BRIDGE][POLL] client_id={client_id} queue blocked by "
            f"message_id={waiting.get('id', '?')[:8]}… status={waiting.get('status')}"
        )
        return {"ok": True, "has_message": False}
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
            _poll_log_immediate(
                f"[BRIDGE][POLL] client_id={client_id} page_type=home "
                f"conversation_id=- has_message=True "
                f"message_id={msg['id'][:8]}… type=chat bootstrap"
            )
            _log(f"[发送] 油猴已取走 bootstrap ({msg['id'][:8]}…) client_id={client_id}")
            _notify_status()
            return _poll_response(msg, retry=False)
        if _debug_mode or identity_changed:
            _poll_log_immediate(
                f"[BRIDGE][POLL] client_id={client_id} page_type=home "
                f"conversation_id=- has_message=False "
                f"(首页仅领取 bootstrap 消息)"
            )
        else:
            _record_poll_empty(client_id, page_type, conversation_id)
        return {"ok": True, "has_message": False}
    if page_type != "conversation":
        if _debug_mode or identity_changed:
            _poll_log_immediate(
                f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} has_message=False "
                f"(非对话页不领取聊天消息)"
            )
        else:
            _record_poll_empty(client_id, page_type, conversation_id)
        return {"ok": True, "has_message": False}
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
        _poll_log_immediate(
            f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
            f"conversation_id={conversation_id or '-'} has_message=True "
            f"message_id={msg['id'][:8]}… type=chat"
        )
        _log(f"[发送] 油猴已取走 ({msg['id'][:8]}…) client_id={client_id}")
        _notify_status()
        return _poll_response(msg, retry=False)
    if _debug_mode or identity_changed:
        _poll_log_immediate(
            f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
            f"conversation_id={conversation_id or '-'} has_message=False"
        )
    else:
        _record_poll_empty(client_id, page_type, conversation_id)
    return {"ok": True, "has_message": False}

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
    _touch_tampermonkey(body, action="report")
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
                session_id = (payload.get("session_id") or "").strip()
                message_count = len(payload.get("messages") or [])
                total_text_len = 0
                for web_msg in payload.get("messages") or []:
                    if isinstance(web_msg, dict):
                        total_text_len += len(
                            str(
                                web_msg.get("text") or web_msg.get("content") or ""
                            ).strip()
                        )
                _log(
                    f"[SYNC_CONVERSATION][RECV] session_id={session_id or '-'} "
                    f"message_id={message_id[:8] if message_id else '?'}… "
                    f"conversation_id={(payload.get('conversation_id') or '-')} "
                    f"count={message_count} total_text_len={total_text_len}"
                )
                _add_inbound(
                    event,
                    payload,
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
                _finalize_message(msg, "failed")
                msg["error_detail"] = (
                    payload.get("reason")
                    or payload.get("detail")
                    or payload.get("error_message")
                    or ""
                )
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
            page_url = (payload.get("url") or body.get("page_url") or "").strip()
            report_bind = (
                payload.get("bind_request_id")
                or payload.get("launch_token")
                or body.get("bind_request_id")
                or body.get("launch_token")
                or ""
            ).strip()
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
        timeout = float(body.get("timeout") or 120)
        if timeout <= 0:
            timeout = 120
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


@app.route("/api/v1/sessions/<session_id>/bind", methods=["POST"])
def api_v1_session_bind(session_id):
    denied = _external_auth_denied()
    if denied:
        return denied
    body = _external_request_body()
    client_id = (body.get("client_id") or "").strip()
    if not client_id:
        return _external_json_error("client_id 不能为空", "EMPTY_TEXT", 400)
    gui_result = _dispatch_to_gui(
        "sessions_bind",
        {
            "session_id": session_id,
            "client_id": client_id,
            "page_url": (body.get("page_url") or "").strip(),
            "conversation_id": (body.get("conversation_id") or "").strip(),
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
    return _external_json_ok(session=gui_result.get("session") or {})


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
    with _state_lock:
        if action == "poll":
            result = _handle_poll(body)
        elif action == "ack":
            result = _handle_ack(body)
        elif action == "report":
            result = _handle_report(body)
        else:
            return jsonify({"ok": False, "error": f"未知 action: {action}"}), 400
    result["server_time"] = _now()
    result["tampermonkey_online"] = True
    return jsonify(result)

@app.route("/health", methods=["GET"])
def health():
    """轻量健康检查（无需鉴权），供 bridge_client 等探测。"""
    return jsonify({"ok": True, "server": "running"})


@app.route("/api/status", methods=["GET"])

def api_status():
    return jsonify(get_bridge_status())

@app.route("/process", methods=["POST"])

def process_legacy():
    """@deprecated 旧版接口。当前油猴应使用 /api/bridge。"""
    _log(
        "[DEPRECATED][PROCESS_LEGACY] /process was called; "
        "current client.user.js should use /api/bridge"
    )
    source = request.headers.get("X-Request-Source")
    if source == "tampermonkey":
        body = request.get_json(silent=True) or {}
        if not body.get("action"):
            body["action"] = "poll"
        if not body.get("client_id"):
            body["client_id"] = "legacy-client"
        with _state_lock:
            result = _handle_poll(body)
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
        push_message(data_from_client)
        return jsonify(
            {
                "status": "new data",
                "processed_data": "我是服务器端，谢谢客户端的来信",
            }
        )
    with _state_lock:
        result = _handle_poll({"client_id": "anonymous"})
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


def get_last_start_result():
    """@deprecated 启动结果请直接使用 start_server() 返回值。"""
    _log("[DEPRECATED][LAST_START_RESULT] get_last_start_result called")
    return dict(_last_start_result)


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
    global _server_bind_host, _server_port, _server_public_host, _last_start_result

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
        _last_start_result = result
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
            http_server = make_server(bind_host, candidate_port, app, threaded=True)
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
        _last_start_result = result
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
    _last_start_result = result
    _log(f"[SERVER][START_FAILED] all_candidates_exhausted bind_host={bind_host} ports={candidates}")
    return result


def stop_server():
    global _http_server, _server_thread
    global _server_bind_host, _server_port, _server_public_host, _last_start_result
    if _http_server is None:
        return False
    _http_server.shutdown()
    _http_server = None
    _server_thread = None
    _server_bind_host = None
    _server_port = None
    _server_public_host = None
    _clear_server_url_file()
    _last_start_result = {}
    _log("服务已停止")
    _notify_status()
    return True

@app.after_request

def after_request(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
if __name__ == "__main__":
    clear_log_file()
    start_server()
    try:
        if _server_thread:
            _server_thread.join()
    except KeyboardInterrupt:
        stop_server()
