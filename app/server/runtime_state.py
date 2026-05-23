"""Server lifecycle, logging, callbacks, debug mode."""
from __future__ import annotations

import json
import logging
import socket
import threading
import time
import traceback
import uuid

from flask import Flask, jsonify
from flask_cors import CORS
from app.utils.log_utils import append_log, clear_log_file
from werkzeug.serving import WSGIRequestHandler, make_server

from app.server import state as st

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


def set_debug_mode(enabled):
    st._debug_mode = bool(enabled)
    _configure_werkzeug_access_log()


def is_debug_mode():
    with st._state_lock:
        return bool(st._debug_mode)


def set_log_callback(callback):
    st._log_callback = callback


def set_status_callback(callback):
    st._status_callback = callback


def set_external_gui_dispatch(callback):
    """GUI 注册：在主线程执行 external API 动作。callback(action_id, action, payload)。"""
    st._external_gui_dispatch = callback


def complete_gui_dispatch(action_id, result):
    with st._external_action_lock:
        pending = st._pending_gui_actions.get(action_id)
    if not pending:
        return False
    pending["result"] = dict(result or {})
    pending["event"].set()
    return True


def _dispatch_to_gui(action, payload, timeout_sec=30):
    if not st._external_gui_dispatch:
        return {
            "ok": False,
            "error": "GUI 未就绪，请先启动 ChatGPT 联动窗口。",
            "code": "GUI_NOT_AVAILABLE",
        }
    action_id = str(uuid.uuid4())
    event = threading.Event()
    with st._external_action_lock:
        st._pending_gui_actions[action_id] = {
            "event": event,
            "result": None,
            "action": action,
        }
    try:
        st._external_gui_dispatch(action_id, action, payload)
    except Exception as error:
        detail = f"{error}\n{traceback.format_exc()}"
        _log(f"[EXTERNAL_API][ERROR] gui_dispatch_failed action={action} error={detail}")
        with st._external_action_lock:
            st._pending_gui_actions.pop(action_id, None)
        return {
            "ok": False,
            "error": str(error),
            "code": "INTERNAL_ERROR",
        }
    if not event.wait(timeout=max(1.0, float(timeout_sec))):
        with st._external_action_lock:
            st._pending_gui_actions.pop(action_id, None)
        _log(
            f"[EXTERNAL_API][TIMEOUT] gui_dispatch action={action} "
            f"action_id={action_id[:8]}… timeout={timeout_sec}"
        )
        return {
            "ok": False,
            "error": f"GUI 处理超时（{timeout_sec}s）",
            "code": "INTERNAL_ERROR",
        }
    with st._external_action_lock:
        pending = st._pending_gui_actions.pop(action_id, None)
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


def _log(message, tag="", level=None):
    text = str(message or "")
    if not _should_emit_bridge_log(tag, text):
        return
    if st._log_callback:
        try:
            st._log_callback(f"[SERVER] {text}")
        except Exception as error:
            append_log(
                "[SERVER][LOG_CALLBACK_FAILED] "
                f"error_type={type(error).__name__} "
                f"error={error}\n{traceback.format_exc()}",
                source="SERVER",
                echo=True,
            )
        return
    append_log(text, source="SERVER", echo=True)


def _init_job_scheduler_hooks():
    from app.core import job_scheduler as job_scheduler

    job_scheduler.set_job_log_callback(lambda msg: _log(msg))
    job_scheduler.set_job_status_callback(lambda _snapshot: _notify_status())


def _notify_status():
    if not st._status_callback:
        return
    try:
        from app.server.message_queue import get_bridge_status

        status = get_bridge_status()
    except Exception as error:
        _log(
            "[SERVER][STATUS_BUILD_FAILED] "
            f"error_type={type(error).__name__} "
            f"error={error}\n{traceback.format_exc()}"
        )
        return
    try:
        st._status_callback(status)
    except Exception as error:
        _log(
            "[SERVER][STATUS_CALLBACK_FAILED] "
            f"error_type={type(error).__name__} "
            f"error={error}\n{traceback.format_exc()}"
        )


def _now():
    return time.time()


def _format_time(ts):
    from app.utils.text_utils import format_ts

    return format_ts(ts)


def _safe_int_field(value, default=0, *, context="", field=""):
    try:
        return int(value or default)
    except (TypeError, ValueError) as error:
        _log(
            "[SERVER][INT_FIELD_FALLBACK] "
            f"context={context or '-'} "
            f"field={field or '-'} "
            f"value={value!r} "
            f"default={default!r} "
            f"error_type={type(error).__name__} "
            f"error={error}"
        )
        return int(default)


def _tm_seen_float(info, *, field="last_seen", default=0.0, context=""):
    info_dict = info if isinstance(info, dict) else {}
    raw = info_dict.get(field) if info_dict else None
    try:
        return float(raw if raw not in (None, "") else default)
    except (TypeError, ValueError) as error:
        _log(
            "[TM][TIME_FIELD_FALLBACK] "
            f"context={context or '-'} "
            f"field={field} "
            f"value={raw!r} "
            f"client_id={info_dict.get('client_id') or '-'} "
            f"page_instance_id={info_dict.get('page_instance_id') or '-'} "
            f"error_type={type(error).__name__} "
            f"error={error}"
        )
        return float(default)


def _client_online(last_seen):
    """@deprecated 仅兼容旧调用；业务判断请用 is_page_online(page)。"""
    from app.utils.page_status import is_page_online

    if last_seen is None or last_seen == "":
        return False
    return is_page_online({"last_seen": last_seen})


def print_registered_routes():
    try:
        rules = list(app.url_map.iter_rules())
        if st._debug_mode:
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
        _log(
            "[SERVER][ROUTES][FAILED] "
            "function=print_registered_routes "
            f"error_type={type(exc).__name__} "
            f"error={exc}\n{traceback.format_exc()}"
        )


def is_server_running():
    return st._http_server is not None


def get_server_bind_host():
    return st._server_bind_host or ""


def get_server_port():
    return st._server_port


def get_server_public_host():
    if st._server_public_host:
        return st._server_public_host
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
        st.RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        st.SERVER_URL_FILE.write_text(url.strip() + "\n", encoding="utf-8")
    except OSError as error:
        _log(
            f"[SERVER][URL_FILE] 写入失败 path={SERVER_URL_FILE} "
            f"errno={getattr(error, 'errno', None)} "
            f"winerror={getattr(error, 'winerror', None)} error={error}"
        )


def _clear_server_url_file():
    try:
        if st.SERVER_URL_FILE.exists():
            st.SERVER_URL_FILE.unlink()
    except OSError as error:
        _log(
            f"[SERVER][URL_FILE] 删除失败 path={SERVER_URL_FILE} "
            f"errno={getattr(error, 'errno', None)} "
            f"winerror={getattr(error, 'winerror', None)} error={error}"
        )


def _parse_server_port(value, default=5000, *, field="port"):
    try:
        parsed_port = int(value)
    except (TypeError, ValueError) as error:
        detail = (
            "[SERVER][INVALID_PORT] "
            f"field={field} value={value!r} default={default!r} "
            f"error_type={type(error).__name__} error={error}"
        )
        _log(detail)
        return None, detail
    if parsed_port <= 0 or parsed_port > 65535:
        detail = (
            "[SERVER][INVALID_PORT_RANGE] "
            f"field={field} value={value!r} parsed={parsed_port}"
        )
        _log(detail)
        return None, detail
    return parsed_port, ""




app = None  # set by create_app()

def create_app():
    """Build Flask app and register all routes."""
    global app
    if app is not None:
        return app
    flask_app = Flask(__name__)
    CORS(flask_app)
    flask_app.logger.setLevel("ERROR")
    flask_app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
    from app.server import routes

    routes.register_routes(flask_app)
    _configure_werkzeug_access_log()
    from app.server.route_flags import enable_external_api

    if enable_external_api():
        _init_job_scheduler_hooks()
    app = flask_app
    return app

def start_server(host="127.0.0.1", port=5000, fallback_ports=None):
    global app
    if app is None:
        app = create_app()
    bind_host = (host or "").strip() or "127.0.0.1"
    configured_port, port_error = _parse_server_port(port, 5000, field="port")
    extra_ports = list(fallback_ports if fallback_ports is not None else st.FALLBACK_PORTS)
    _log(
        "[SERVER][START_REQUEST] "
        f"host={bind_host} port={port} fallback_ports={extra_ports} "
        f"debug={is_debug_mode()}"
    )
    if port_error:
        return {
            "ok": False,
            "message": f"服务端口无效：{port}",
            "detail": port_error,
            "host": bind_host,
            "bind_host": bind_host,
            "port": port,
            "url": "",
        }
    if st._http_server is not None:
        _log(
            "[SERVER][START_SKIPPED] "
            "reason=already_running "
            f"bind_host={get_server_bind_host()} "
            f"public_host={get_server_public_host()} "
            f"port={get_server_port()} url={get_server_url()}"
        )
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

    candidates = []
    for raw_candidate in [configured_port, *extra_ports]:
        candidate_port, candidate_error = _parse_server_port(
            raw_candidate,
            configured_port,
            field="fallback_port",
        )
        if candidate_error:
            continue
        if candidate_port not in candidates:
            candidates.append(candidate_port)

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

        st._http_server = http_server
        st._server_thread = threading.Thread(
            target=st._http_server.serve_forever, daemon=True
        )
        st._server_thread.start()
        st._server_bind_host = bind_host
        st._server_port = candidate_port
        st._server_public_host = _public_host_for_bind(bind_host)
        server_url = get_server_url()
        bridge_url = get_server_bridge_url()

        if candidate_port != configured_port:
            _log(
                f"[SERVER][FALLBACK_PORT] old_port={configured_port} "
                f"new_port={candidate_port}"
            )
        _write_server_url_file(server_url)
        _log(
            "[SERVER][STARTED] "
            f"bind_host={bind_host} public_host={st._server_public_host} "
            f"configured_port={configured_port} actual_port={candidate_port} "
            f"fallback_used={candidate_port != configured_port} "
            f"server_url={server_url} bridge_url={bridge_url} "
            f"url_file={st.SERVER_URL_FILE}"
        )
        _log(f"服务已启动：{server_url}")
        _log(f"  油猴接口 POST {bridge_url}")
        print_registered_routes()

        result = {
            "ok": True,
            "already_running": False,
            "bind_host": bind_host,
            "host": st._server_public_host,
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
    _log(
        "[SERVER][STOP_REQUEST] "
        f"running={st._http_server is not None} bind_host={st._server_bind_host or '-'} "
        f"port={st._server_port or '-'}"
    )
    if st._http_server is None:
        _log("[SERVER][STOP_SKIPPED] reason=not_running")
        return False
    try:
        st._http_server.shutdown()
    except Exception as error:
        _log(
            "[SERVER][STOP_FAILED] "
            f"error_type={type(error).__name__} error={error}\n{traceback.format_exc()}"
        )
        return False
    st._http_server = None
    st._server_thread = None
    st._server_bind_host = None
    st._server_port = None
    st._server_public_host = None
    _clear_server_url_file()
    _log("[SERVER][STOPPED] success=True")
    _log("服务已停止")
    _notify_status()
    return True
