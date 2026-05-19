import threading
import time
import uuid
from collections import deque
from flask import Flask, jsonify, request
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
HEARTBEAT_LOG_INTERVAL_SEC = 5
# 出站：服务端 -> 油猴 -> ChatGPT
_outbound_queue = deque(maxlen=50)
_outbound_waiting_ack = None
# 入站：油猴 -> 服务端（事件、回执、页面信息等）
_inbound_messages = deque(maxlen=100)
# 历史出站（已确认或失败）
_outbound_history = deque(maxlen=50)
ONLINE_TIMEOUT_SEC = 5
LEASE_SEC = 30

def set_log_callback(callback):
    global _log_callback
    _log_callback = callback

def set_status_callback(callback):
    global _status_callback
    _status_callback = callback

def _log(message):
    if _log_callback:
        _log_callback(message)
    else:
        print(message)

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
                "pathname": info.get("pathname") or "",
                "last_seen": last_seen,
                "online": _client_online(last_seen),
                "bound_session_id": info.get("bound_session_id") or "",
                "is_bound": client_id == bound_client_id,
            }
        )
    return items

def get_bridge_status():
    with _state_lock:
        waiting = _outbound_waiting_ack
        if waiting is not None:
            waiting = dict(waiting)
        return {
            "server_running": is_server_running(),
            "tampermonkey_online": is_tampermonkey_online(),
            "tampermonkey_last_seen": tampermonkey_last_seen,
            "tampermonkey_client_id": tampermonkey_client_id,
            "tampermonkey_page_url": tampermonkey_page_url,
            "bound_client_id": bound_client_id,
            "bound_session_id": bound_session_id,
            "tampermonkey_clients": _snapshot_clients(),
            "queue_length": len(_outbound_queue),
            "waiting_ack": waiting,
            "inbound_count": len(_inbound_messages),
            "recent_inbound": list(_inbound_messages)[-10:],
            "recent_outbound": list(_outbound_history)[-10:],
        }

def set_bound_client_id(client_id, session_id=None):
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
    conversation_id = (payload.get("conversation_id") or "").strip() or None
    conversation_url = (
        (payload.get("conversation_url") or target_page_url or "").strip() or None
    )
    msg = {
        "id": str(uuid.uuid4()),
        "type": "chat",
        "session_id": session_id,
        "turn_id": turn_id,
        "raw_user_text": raw_user_text,
        "content": final_prompt,
        "target_client_id": target_client_id,
        "target_page_url": target_page_url,
        "conversation_id": conversation_id,
        "conversation_url": conversation_url,
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

def push_open_url(url, active=True):
    """GUI：通过油猴在新标签页打开 URL。"""
    url = (url or "").strip()
    if not url:
        raise ValueError("url 不能为空")
    msg = _make_command_message("open_url", url=url, active=bool(active))
    with _state_lock:
        _outbound_queue.append(msg)
    _log(f"[命令] open_url 已加入队列 ({msg['id'][:8]}…) url={url}")
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
        _outbound_queue.append(msg)
    _log(
        f"[命令] close_self 已加入队列 ({msg['id'][:8]}…) "
        f"target_client_id={client_id}"
    )
    _notify_status()
    return msg

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
            _outbound_queue.append(msg)
            msgs.append(msg)
    _log(
        f"[命令] close_self 批量入队 {len(msgs)} 条 "
        f"(保留 client_id={except_client_id or '-'})"
    )
    _notify_status()
    return msgs

def push_close_pages_by_url(url):
    """向 page_url 匹配的在线客户端下发关闭命令。"""
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
            _outbound_queue.append(msg)
            msgs.append(msg)
    _log(f"[命令] close_self 按 URL 入队 {len(msgs)} 条 url={url}")
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
        _log(
            f"[TM][HELLO] client_id={client_id} page_type={page_type or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"page_instance_id={page_instance_id} url={page_url or '-'}"
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
            "pathname": "",
            "last_seen": None,
            "online": False,
            "bound_session_id": "",
        },
    )
    entry["client_id"] = client_id
    if page_instance_id:
        entry["page_instance_id"] = page_instance_id
    entry["script_version"] = (meta.get("script_version") or entry.get("script_version") or "").strip()
    entry["page_title"] = (meta.get("page_title") or entry.get("page_title") or "").strip()
    entry["page_type"] = page_type or entry.get("page_type") or ""
    entry["conversation_id"] = conversation_id or entry.get("conversation_id") or ""
    entry["is_top_frame"] = bool(meta.get("is_top_frame", entry.get("is_top_frame", True)))
    entry["visibility_state"] = (meta.get("visibility_state") or entry.get("visibility_state") or "").strip()
    entry["has_focus"] = bool(meta.get("has_focus", entry.get("has_focus")))
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
        last_log = _last_heartbeat_log.get(client_id, 0)
        state_key = (
            f"{page_type}|{entry.get('visibility_state')}|"
            f"{entry.get('has_focus')}|{page_url}"
        )
        prev_key = _last_heartbeat_log.get(f"{client_id}:state")
        if now - last_log >= HEARTBEAT_LOG_INTERVAL_SEC or state_key != prev_key:
            visible = entry.get("visibility_state") or "-"
            focus = "yes" if entry.get("has_focus") else "no"
            _log(
                f"[TM][HEARTBEAT] client_id={client_id} page_type={page_type or '-'} "
                f"visible={visible} focus={focus}"
            )
            _last_heartbeat_log[client_id] = now
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
    if _outbound_waiting_ack and _outbound_waiting_ack.get("id") == message_id:
        return _outbound_waiting_ack
    for msg in reversed(_outbound_history):
        if msg.get("id") == message_id:
            return msg
    return None

def _is_finalized(msg):
    if not msg:
        return False
    if msg.get("finalized_at"):
        return True
    return msg.get("status") in ("replied", "failed")

def _finalize_message(msg, status):
    msg["status"] = status
    msg["finalized_at"] = _now()

def _release_waiting_if_match(message_id):
    global _outbound_waiting_ack
    if _outbound_waiting_ack and _outbound_waiting_ack.get("id") == message_id:
        _outbound_waiting_ack = None

def _archive_waiting():
    global _outbound_waiting_ack
    if _outbound_waiting_ack is not None:
        _outbound_history.append(dict(_outbound_waiting_ack))
        _outbound_waiting_ack = None

def _message_target_client_id(msg):
    return (msg.get("target_client_id") or "").strip()

def _message_matches_client(msg, client_id):
    target = _message_target_client_id(msg)
    if target and target != client_id:
        return False
    return True

def _pop_message_for_client(client_id):
    if not _outbound_queue:
        return None
    attempts = len(_outbound_queue)
    for _ in range(attempts):
        msg = _outbound_queue.popleft()
        if _message_matches_client(msg, client_id):
            return msg
        _outbound_queue.append(msg)
    return None

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
    return resp

def _handle_poll(body):
    global _outbound_waiting_ack
    client_id = (body.get("client_id") or "").strip()
    if not client_id:
        _log("[BRIDGE][POLL] 拒绝：缺少 client_id")
        return {"ok": False, "error": "缺少 client_id"}
    _touch_tampermonkey(body, action="poll")
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    now = _now()
    waiting = _outbound_waiting_ack
    waiting_for_self = waiting and _message_matches_client(waiting, client_id)
    if waiting_for_self and waiting.get("status") == "delivered":
        owner = waiting.get("delivered_to")
        lease_until = waiting.get("lease_until") or 0
        if owner == client_id and now < lease_until:
            _log(
                f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={waiting['id'][:8]}… status=retry_same_owner"
            )
            return _poll_response(waiting, retry=True)
        if _is_finalized(waiting):
            _archive_waiting()
            waiting = _outbound_waiting_ack
            waiting_for_self = waiting and _message_matches_client(waiting, client_id)
        elif now >= lease_until:
            _claim_message(waiting, client_id)
            _log(
                f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={waiting['id'][:8]}… status=lease_reclaim"
            )
            return _poll_response(waiting, retry=True)
        elif owner != client_id:
            _log(
                f"[BRIDGE][POLL] client_id={client_id} blocked: message "
                f"{waiting['id'][:8]}… owned by {owner}"
            )
            return {"ok": True, "has_message": False}
    if waiting_for_self and not _is_finalized(waiting):
        if waiting.get("status") in ("acked", "delivered"):
            owner = waiting.get("delivered_to")
            if owner == client_id:
                _log(
                    f"[BRIDGE][POLL] client_id={client_id} message_id={waiting['id'][:8]}… "
                    f"status=awaiting_report"
                )
                return {"ok": True, "has_message": False}
        _log(
            f"[BRIDGE][POLL] client_id={client_id} queue blocked by "
            f"message_id={waiting.get('id', '?')[:8]}… status={waiting.get('status')}"
        )
        return {"ok": True, "has_message": False}
    msg = _pop_message_for_client(client_id)
    if msg:
        _claim_message(msg, client_id)
        _outbound_waiting_ack = msg
        _log(f"[发送] 油猴已取走 ({msg['id'][:8]}…) client_id={client_id}")
        _notify_status()
        return _poll_response(msg, retry=False)
    _log(
        f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
        f"conversation_id={conversation_id or '-'} has_message=False"
    )
    return {"ok": True, "has_message": False}

def _handle_ack(body):
    global _outbound_waiting_ack
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
        waiting = _outbound_waiting_ack
        if not waiting or waiting.get("id") != message_id:
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
            _outbound_history.append(dict(waiting))
            _outbound_waiting_ack = None
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

def _handle_report(body):
    client_id = (body.get("client_id") or "").strip()
    event = body.get("event") or "info"
    payload = body.get("payload") or {}
    message_id = body.get("message_id")
    _touch_tampermonkey(body, action="report")
    if not client_id:
        _log(f"[BRIDGE][REPORT] 拒绝：缺少 client_id event={event}")
        return {"ok": False, "error": "缺少 client_id"}
    with _state_lock:
        msg = _find_outbound_message(message_id)
        if not msg:
            _add_inbound(
                "report_unknown",
                {"event": event, "payload": payload, "report_client_id": client_id},
                message_id=message_id,
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][REPORT] 未知 message_id={message_id} event={event} "
                f"client_id={client_id}"
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
                f"[BRIDGE][REPORT_MISMATCH] owner={owner} reporter={client_id} "
                f"message_id={message_id[:8] if message_id else '?'}… event={event}"
            )
            _notify_status()
            return {"ok": True}
        if _is_finalized(msg) and event in (
            "send_failed",
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
        if event == "assistant_reply":
            text = (payload.get("text") or payload.get("content") or "").strip()
            msg["reply_text"] = text
            _finalize_message(msg, "replied")
            _log(f"[BRIDGE][FINALIZED] message_id={message_id[:8]}… event=assistant_reply")
            _add_inbound(event, payload, **inbound_kw)
            _archive_waiting()
        elif event == "send_failed":
            if not _is_finalized(msg):
                _finalize_message(msg, "failed")
                msg["error_detail"] = payload.get("detail") or payload.get("reason")
                _add_inbound(event, payload, **inbound_kw)
                if _outbound_waiting_ack and _outbound_waiting_ack.get("id") == message_id:
                    _archive_waiting()
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        elif event in ("assistant_reply_empty", "assistant_reply_failed"):
            if not _is_finalized(msg):
                _finalize_message(msg, "failed")
                msg["error_detail"] = payload.get("detail") or payload.get("reason")
                _add_inbound(event, payload, **inbound_kw)
                if _outbound_waiting_ack and _outbound_waiting_ack.get("id") == message_id:
                    _archive_waiting()
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        elif event in (
            "open_url_success",
            "open_url_failed",
            "close_page_success",
            "close_page_failed",
            "command_failed",
        ):
            if not _is_finalized(msg):
                if event.endswith("_success"):
                    _finalize_message(msg, "replied")
                else:
                    _finalize_message(msg, "failed")
                    msg["error_detail"] = payload.get("detail") or payload.get("reason")
                _add_inbound(event, payload, **inbound_kw)
                if _outbound_waiting_ack and _outbound_waiting_ack.get("id") == message_id:
                    _archive_waiting()
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        else:
            _add_inbound(event, payload, **inbound_kw)
    _log(f"[BRIDGE][REPORT] client_id={client_id} message_id={message_id} event={event}")
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
    """兼容旧版油猴轮询（无 action 时视为 poll）。"""
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
    start_server()
    try:
        if _server_thread:
            _server_thread.join()
    except KeyboardInterrupt:
        stop_server()
