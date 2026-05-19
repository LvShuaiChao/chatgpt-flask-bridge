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
            "queue_length": len(_outbound_queue),
            "waiting_ack": waiting,
            "inbound_count": len(_inbound_messages),
            "recent_inbound": list(_inbound_messages)[-10:],
            "recent_outbound": list(_outbound_history)[-10:],
        }

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
    msg = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "turn_id": turn_id,
        "raw_user_text": raw_user_text,
        "content": final_prompt,
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
    _log(
        f"[发送] 已加入队列 ({msg['id'][:8]}…) "
        f"session={session_id[:8] + '…' if session_id else '-'} "
        f"turn={turn_id[:8] + '…' if turn_id else '-'}：{preview}"
    )
    _notify_status()
    return msg

def _touch_tampermonkey(meta):
    global tampermonkey_last_seen, tampermonkey_client_id, tampermonkey_page_url
    tampermonkey_last_seen = _now()
    if meta.get("client_id"):
        tampermonkey_client_id = meta["client_id"]
    if meta.get("page_url"):
        tampermonkey_page_url = meta["page_url"]

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
    return {
        "ok": True,
        "has_message": True,
        "message_id": msg["id"],
        "content": msg["content"],
        "retry": retry,
    }

def _handle_poll(body):
    global _outbound_waiting_ack
    client_id = (body.get("client_id") or "").strip()
    if not client_id:
        _log("[BRIDGE][POLL] 拒绝：缺少 client_id")
        return {"ok": False, "error": "缺少 client_id"}
    _touch_tampermonkey(body)
    now = _now()
    waiting = _outbound_waiting_ack
    if waiting and waiting.get("status") == "delivered":
        owner = waiting.get("delivered_to")
        lease_until = waiting.get("lease_until") or 0
        if owner == client_id and now < lease_until:
            _log(
                f"[BRIDGE][POLL] client_id={client_id} message_id={waiting['id'][:8]}… "
                f"status=retry_same_owner"
            )
            return _poll_response(waiting, retry=True)
        if _is_finalized(waiting):
            _archive_waiting()
            waiting = _outbound_waiting_ack
        elif now >= lease_until:
            _claim_message(waiting, client_id)
            _log(
                f"[BRIDGE][POLL] client_id={client_id} message_id={waiting['id'][:8]}… "
                f"status=lease_reclaim"
            )
            return _poll_response(waiting, retry=True)
        elif owner != client_id:
            _log(
                f"[BRIDGE][POLL] client_id={client_id} blocked: message "
                f"{waiting['id'][:8]}… owned by {owner}"
            )
            return {"ok": True, "has_message": False}
    if waiting and not _is_finalized(waiting):
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
    if _outbound_queue:
        msg = _outbound_queue.popleft()
        _claim_message(msg, client_id)
        _outbound_waiting_ack = msg
        _log(f"[发送] 油猴已取走 ({msg['id'][:8]}…) client_id={client_id}")
        _notify_status()
        return _poll_response(msg, retry=False)
    _log(f"[BRIDGE][POLL] client_id={client_id} has_message=False")
    return {"ok": True, "has_message": False}

def _handle_ack(body):
    global _outbound_waiting_ack
    client_id = (body.get("client_id") or "").strip()
    message_id = body.get("message_id")
    success = bool(body.get("success", False))
    detail = body.get("detail") or ""
    _touch_tampermonkey(body)
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
    _touch_tampermonkey(body)
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
