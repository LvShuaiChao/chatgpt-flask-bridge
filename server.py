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
    text = (data or "").strip()
    if not text:
        text = "Hello World"

    msg = {
        "id": str(uuid.uuid4()),
        "content": text,
        "status": "queued",
        "created_at": _now(),
        "delivered_at": None,
        "acked_at": None,
    }

    with _state_lock:
        _outbound_queue.append(msg)

    preview = text if len(text) <= 80 else text[:80] + "..."
    _log(f"[发送] 已加入队列 ({msg['id'][:8]}…)：{preview}")
    _notify_status()
    return msg


def _touch_tampermonkey(meta):
    global tampermonkey_last_seen, tampermonkey_client_id, tampermonkey_page_url

    tampermonkey_last_seen = _now()
    if meta.get("client_id"):
        tampermonkey_client_id = meta["client_id"]
    if meta.get("page_url"):
        tampermonkey_page_url = meta["page_url"]


def _add_inbound(kind, payload, message_id=None):
    entry = {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "payload": payload,
        "message_id": message_id,
        "time": _now(),
    }
    _inbound_messages.append(entry)
    return entry


def _handle_poll(body):
    global _outbound_waiting_ack

    _touch_tampermonkey(body)

    # 仍有未确认消息时，继续下发同一条（防止油猴漏 ack）
    if _outbound_waiting_ack and _outbound_waiting_ack["status"] == "delivered":
        msg = _outbound_waiting_ack
        return {
            "ok": True,
            "has_message": True,
            "message_id": msg["id"],
            "content": msg["content"],
            "retry": True,
        }

    if _outbound_queue:
        msg = _outbound_queue.popleft()
        msg["status"] = "delivered"
        msg["delivered_at"] = _now()
        _outbound_waiting_ack = msg
        _log(f"[发送] 油猴已取走 ({msg['id'][:8]}…)")
        _notify_status()
        return {
            "ok": True,
            "has_message": True,
            "message_id": msg["id"],
            "content": msg["content"],
            "retry": False,
        }

    return {"ok": True, "has_message": False}


def _handle_ack(body):
    global _outbound_waiting_ack

    _touch_tampermonkey(body)

    message_id = body.get("message_id")
    success = bool(body.get("success", False))
    detail = body.get("detail") or ""

    with _state_lock:
        waiting = _outbound_waiting_ack
        if not waiting or waiting["id"] != message_id:
            _add_inbound("ack_mismatch", {"message_id": message_id, "detail": detail}, message_id)
            _notify_status()
            return {"ok": False, "error": "message_id 不匹配或已过期"}

        waiting["status"] = "acked" if success else "failed"
        waiting["acked_at"] = _now()
        waiting["ack_detail"] = detail
        _outbound_history.append(dict(waiting))
        _outbound_waiting_ack = None

    status_text = "成功" if success else "失败"
    _log(f"[回执] 消息 {message_id[:8]}… {status_text}：{detail or '-'}")
    _add_inbound("ack", {"success": success, "detail": detail}, message_id)
    _notify_status()
    return {"ok": True}


def _handle_report(body):
    _touch_tampermonkey(body)

    event = body.get("event") or "info"
    payload = body.get("payload") or {}
    message_id = body.get("message_id")

    _add_inbound(event, payload, message_id)
    _log(f"[油猴] {event}：{payload}")
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
        result = _handle_poll({})
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
