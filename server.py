import threading
import time
import uuid
from collections import deque
from flask import Flask, jsonify, request
from log_utils import append_log, clear_log_file
from flask_cors import CORS
from werkzeug.serving import make_server

app = Flask(__name__)
CORS(app)
app.logger.setLevel("ERROR")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
_state_lock = threading.RLock()
_log_callback = None
_status_callback = None
_http_server = None
_server_thread = None
# 油猴连接状态
tampermonkey_last_seen = None
tampermonkey_client_id = None
tampermonkey_page_url = None
bound_client_id = None
bound_session_id = None
_tampermonkey_clients = {}
_known_page_instances = set()
_last_heartbeat_log = {}
_poll_summaries = {}
_last_poll_identity = {}
_debug_mode = False
POLL_SUMMARY_INTERVAL_SEC = 10


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
    if not ts:
        return "-"
    return time.strftime("%H:%M:%S", time.localtime(ts))

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
    for client_id, info in sorted(_tampermonkey_clients.items()):
        last_seen = info.get("last_seen")
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
                "has_focus": bool(info.get("has_focus")),
                "last_focus_at": info.get("last_focus_at"),
                "pathname": info.get("pathname") or "",
                "last_seen": last_seen,
                "online": _client_online(last_seen),
                "bound_session_id": info.get("bound_session_id") or "",
                "is_bound": client_id == bound_client_id,
                "bind_request_id": info.get("bind_request_id") or "",
                "launch_token": info.get("launch_token") or "",
            }
        )
    return items

def get_bridge_status():
    with _state_lock:
        waiting_acks = [dict(msg) for msg in _outbound_waiting.values()]
        waiting = waiting_acks[0] if waiting_acks else None
        return {
            "server_running": is_server_running(),
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


def push_open_url(url, active=True):
    """GUI：通过油猴在新标签页打开 URL。"""
    url = (url or "").strip()
    if not url:
        raise ValueError("url 不能为空")
    msg = _make_command_message("open_url", url=url, active=bool(active))
    with _state_lock:
        _control_queue.append(msg)
    _log(f"[命令] open_url 已加入控制队列 ({msg['id'][:8]}…) url={url}")
    _notify_status()
    return msg

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
    msg = _make_command_message(
        "close_self",
        target_client_id=client_id,
        target_page_url=(target_page_url or "").strip() or None,
    )
    with _state_lock:
        _control_queue.append(msg)
    _log(
        f"[命令] close_self 已加入控制队列 ({msg['id'][:8]}…) "
        f"target_client_id={client_id}"
    )
    _notify_status()
    return msg

def push_reload_page(client_id, target_page_url=None):
    """向指定油猴客户端下发刷新当前页面命令。"""
    client_id = (client_id or "").strip()
    if not client_id:
        raise ValueError("client_id 不能为空")
    msg = _make_command_message(
        "reload_self",
        target_client_id=client_id,
        target_page_url=(target_page_url or "").strip() or None,
    )
    with _state_lock:
        _control_queue.append(msg)
    _log(
        f"[命令] reload_self 已加入控制队列 ({msg['id'][:8]}…) "
        f"target_client_id={client_id}"
    )
    _notify_status()
    return msg


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

    msg = _make_command_message(
        command,
        target_client_id=target_client_id,
        target_page_instance_id=target_page_instance_id or None,
        target_conversation_id=target_conversation_id or None,
        payload=dict(payload or {}),
    )

    with _state_lock:
        _control_queue.append(msg)

    message_id = msg["id"]
    _log(
        f"[BRIDGE][CONTROL][QUEUE] command={command} "
        f"message_id={message_id[:8]}… target_client={target_client_id} "
        f"page_instance={target_page_instance_id or '-'} "
        f"conversation={target_conversation_id or '-'}"
    )
    _notify_status()
    return True

def push_close_other_pages(except_client_id):
    """关闭除 except_client_id 外所有在线 ChatGPT 页面。"""
    except_client_id = (except_client_id or "").strip()
    msgs = []
    with _state_lock:
        for client_id, info in _tampermonkey_clients.items():
            if client_id == except_client_id:
                continue
            if not _client_online(info.get("last_seen")):
                continue
            msg = _make_command_message(
                "close_self",
                target_client_id=client_id,
                target_page_url=info.get("page_url"),
            )
            _control_queue.append(msg)
            msgs.append(msg)
    _log(
        f"[命令] close_self 批量入队控制队列 {len(msgs)} 条 "
        f"(保留 client_id={except_client_id or '-'})"
    )
    _notify_status()
    return msgs

def push_close_pages_by_url(url):
    """@deprecated 当前 GUI 优先按 client_id 关闭页面，建议使用 push_close_page(client_id)。"""
    _log("[DEPRECATED] push_close_pages_by_url called; prefer push_close_page(client_id)")
    url = (url or "").strip()
    if not url:
        raise ValueError("url 不能为空")
    msgs = []
    with _state_lock:
        for client_id, info in _tampermonkey_clients.items():
            page_url = (info.get("page_url") or "").strip()
            if page_url != url:
                continue
            if not _client_online(info.get("last_seen")):
                continue
            msg = _make_command_message(
                "close_self",
                target_client_id=client_id,
                target_page_url=page_url,
            )
            _control_queue.append(msg)
            msgs.append(msg)
    _log(f"[命令] close_self 按 URL 入队控制队列 {len(msgs)} 条 url={url}")
    _notify_status()
    return msgs

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
            "online": False,
            "bound_session_id": "",
            "bind_request_id": "",
            "launch_token": "",
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
    entry["last_seen"] = now
    entry["online"] = True
    if page_url:
        entry["page_url"] = page_url
    if not ignored:
        tampermonkey_last_seen = now
        tampermonkey_client_id = client_id
        tampermonkey_page_url = page_url or entry.get("page_url") or tampermonkey_page_url
    if action == "poll":
        visible = entry.get("visibility_state") or "-"
        focus = "yes" if entry.get("has_focus") else "no"
        state_key = (
            f"{page_type}|{conversation_id}|{visible}|{focus}|{page_url}"
        )
        prev_key = _last_heartbeat_log.get(f"{client_id}:state")
        if _debug_mode:
            _log(
                f"[TM][HEARTBEAT] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} visible={visible} "
                f"focus={focus} url={page_url or '-'}"
            )
        elif state_key != prev_key:
            _log(
                f"[TM][HEARTBEAT] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} visible={visible} "
                f"focus={focus} url={page_url or '-'}"
            )
            _last_heartbeat_log[f"{client_id}:state"] = state_key

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


def _flash_page_matches(msg, body):
    client_id = (body.get("client_id") or "").strip()
    if not _message_matches_client(msg, client_id):
        return False
    if (msg.get("command") or "").strip() != "flash_page":
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

    # 1) flash_page（严格匹配 client / page_instance / conversation）
    msg = _rotate(lambda m: _flash_page_matches(m, body))
    if msg:
        _log(
            f"[BRIDGE][CONTROL][CLAIM] command=flash_page "
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
    # 4) 其余控制命令（含 reload_self、批量 close_self 等，不匹配 flash_page）
    return _rotate(
        lambda m: (m.get("command") or "").strip() != "flash_page"
        and _message_matches_client(m, client_id)
    )

def _claim_message(msg, client_id):
    now = _now()
    msg["status"] = "delivered"
    msg["delivered_to"] = client_id
    msg["delivered_at"] = now
    msg["lease_until"] = now + LEASE_SEC
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
        else:
            _finalize_message(waiting, "failed")
            status_text = "失败"
            _archive_waiting(message_id)
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
            _log_finalized(msg, message_id, event)
            _add_inbound(event, payload, **inbound_kw)
            _archive_waiting(message_id)
        elif event == "send_failed":
            if not _is_finalized(msg):
                _finalize_message(msg, "failed")
                msg["error_detail"] = payload.get("detail") or payload.get("reason")
                _log_finalized(msg, message_id, event)
                _add_inbound(event, payload, **inbound_kw)
                if message_id in _outbound_waiting:
                    _archive_waiting(message_id)
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

@app.route("/api/bridge", methods=["POST"])

def api_bridge():
    """油猴专用交互接口：poll / ack / report"""
    source = request.headers.get("X-Request-Source")
    if source != "tampermonkey":
        return jsonify({"ok": False, "error": "需要 X-Request-Source: tampermonkey"}), 403
    body = request.get_json(silent=True) or {}
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

@app.route("/api/status", methods=["GET"])

def api_status():
    return jsonify(get_bridge_status())

@app.route("/process", methods=["POST"])

def process_legacy():
    """@deprecated 旧版接口。当前油猴应使用 /api/bridge。"""
    _log("[DEPRECATED] /process legacy endpoint was called")
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

def start_server(host="127.0.0.1", port=5000):
    global _http_server, _server_thread
    if _http_server is not None:
        return False
    _http_server = make_server(host, int(port), app, threaded=True)
    _server_thread = threading.Thread(target=_http_server.serve_forever, daemon=True)
    _server_thread.start()
    _log(f"服务已启动：http://{host}:{port}")
    _log(f"  油猴接口 POST /api/bridge")
    _notify_status()
    return True

def stop_server():
    global _http_server, _server_thread
    if _http_server is None:
        return False
    _http_server.shutdown()
    _http_server = None
    _server_thread = None
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
