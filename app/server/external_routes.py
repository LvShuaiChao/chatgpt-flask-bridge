"""外部 REST API 路由 /api/v1/*（仅 CHATGPT_BRIDGE_ENABLE_EXTERNAL_API=1 时注册）。"""
from __future__ import annotations

import time
import traceback

from flask import jsonify, request

from app.server import state as st
from app.server.runtime_state import _log, _now
from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from


def register_external_routes(app) -> None:
    from app.server import external_api as ext

    app.add_url_rule("/api/v1/status", view_func=_api_v1_status(ext), methods=["GET"])
    app.add_url_rule("/api/v1/chat/send", view_func=_api_v1_chat_send(ext), methods=["POST"])
    app.add_url_rule(
        "/api/v1/chat/result/<request_id>",
        view_func=_api_v1_chat_result(ext),
        methods=["GET"],
    )
    app.add_url_rule("/api/v1/chat/ask", view_func=_api_v1_chat_ask(ext), methods=["POST"])
    app.add_url_rule("/api/v1/sessions", view_func=_api_v1_sessions(ext), methods=["GET", "POST"])
    app.add_url_rule(
        "/api/v1/sessions/<session_id>",
        view_func=_api_v1_session_detail(ext),
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/v1/sessions/<session_id>/bind",
        view_func=_api_v1_session_bind(ext),
        methods=["POST", "DELETE"],
    )


def _api_v1_status(ext):
    def view():
        denied = ext._external_auth_denied()
        if denied:
            return denied
        from app.server.tm_page_registry import get_tm_online_summary

        tm = get_tm_online_summary()
        with st._state_lock:
            waiting_count = len(st._outbound_waiting)
            queue_len = len(st._outbound_queue)
            control_len = len(st._control_queue)
        sessions = ext._external_sessions_summary_from_gui()
        return ext._external_json_ok(
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

    return view


def _api_v1_chat_send(ext):
    def view():
        denied = ext._external_auth_denied()
        if denied:
            return denied
        body, error_response = ext._json_body_or_error("[EXTERNAL_API][SEND_JSON]")
        if error_response:
            return error_response
        try:
            result, err_resp = ext._external_create_chat_send(body)
            if err_resp:
                return err_resp
            return ext._external_json_ok(
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
            return ext._external_json_error(str(error), "INTERNAL_ERROR", 500)

    return view


def _api_v1_chat_result(ext):
    def view(request_id):
        denied = ext._external_auth_denied()
        if denied:
            return denied
        req = ext._get_external_request(request_id)
        if not req:
            return ext._external_json_error("request_id 不存在", "SESSION_NOT_FOUND", 404)
        status = ext._external_request_status(req) or "waiting"
        _log(
            f"[EXTERNAL_API][RESULT] request_id={request_id} session_id={req.get('session_id') or '-'} "
            f"bridge_message_id={req.get('bridge_message_id') or '-'} status={status} "
            f"error={req.get('error') or '-'}"
        )
        if status == "done":
            return ext._external_json_ok(
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
        return ext._external_json_ok(
            request_id=request_id,
            status="waiting",
            reply="",
        )

    return view


def _api_v1_chat_ask(ext):
    def view():
        denied = ext._external_auth_denied()
        if denied:
            return denied
        body, error_response = ext._json_body_or_error("[EXTERNAL_API][ASK_JSON]")
        if error_response:
            return error_response
        text = (body.get("text") or "").strip()
        text_len = len(text)
        try:
            result, err_resp = ext._external_create_chat_send(body)
            if err_resp:
                return err_resp
            request_id = result["request_id"]
            session_id = result["session_id"]
            ask_session_meta = {
                "new_session_created": bool(result.get("new_session_created")),
                "new_session_reason": result.get("new_session_reason") or "",
                "previous_session_id": result.get("previous_session_id") or "",
                "previous_turn_count": ext._safe_meta_int(
                    result.get("previous_turn_count"),
                    0,
                    field="previous_turn_count",
                ),
                "force_new_session_after_turns": ext._safe_meta_int(
                    result.get("force_new_session_after_turns"),
                    0,
                    field="force_new_session_after_turns",
                ),
            }
            timeout, timeout_error = ext._parse_external_timeout(
                body,
                default=30,
                min_value=1,
                max_value=30,
            )
            if timeout_error:
                return timeout_error
            _log(
                f"[EXTERNAL_API][ASK] request_id={request_id} session_id={session_id} "
                f"text_len={text_len} timeout={timeout}"
            )
            deadline = _now() + timeout
            while _now() < deadline:
                req = ext._get_external_request(request_id)
                if not req:
                    return ext._external_json_error("request_id 丢失", "INTERNAL_ERROR", 500)
                status = ext._external_request_status(req) or "waiting"
                if status == "done":
                    return ext._external_json_ok(
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
            with st._state_lock:
                req = st._external_requests.get(request_id)
                if req:
                    ext._set_external_request_status(req, "timeout")
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
            return ext._external_json_error(str(error), "INTERNAL_ERROR", 500)

    return view


def _api_v1_sessions(ext):
    def view():
        from app.server.runtime_state import _dispatch_to_gui

        denied = ext._external_auth_denied()
        if denied:
            return denied
        if request.method == "GET":
            gui_result = _dispatch_to_gui("sessions_list", {}, timeout_sec=10)
            if not gui_result.get("ok"):
                return ext._external_json_error(
                    gui_result.get("error") or "获取会话列表失败",
                    gui_result.get("code") or "INTERNAL_ERROR",
                    500,
                )
            return ext._external_json_ok(sessions=gui_result.get("sessions") or [])
        body, error_response = ext._json_body_or_error("[EXTERNAL_API][SESSIONS_CREATE_JSON]")
        if error_response:
            return error_response
        gui_result = _dispatch_to_gui(
            "sessions_create",
            {"title": body.get("title") or "新对话"},
            timeout_sec=10,
        )
        if not gui_result.get("ok"):
            return ext._external_json_error(
                gui_result.get("error") or "创建会话失败",
                gui_result.get("code") or "INTERNAL_ERROR",
                500,
            )
        return ext._external_json_ok(session=gui_result.get("session") or {})

    return view


def _api_v1_session_detail(ext):
    def view(session_id):
        from app.server.runtime_state import _dispatch_to_gui

        denied = ext._external_auth_denied()
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
            return ext._external_json_error(
                gui_result.get("error") or "会话不存在",
                code,
                status,
            )
        return ext._external_json_ok(session=gui_result.get("session") or {})

    return view


def _api_v1_session_bind(ext):
    def view(session_id):
        from app.server.runtime_state import _dispatch_to_gui

        denied = ext._external_auth_denied()
        if denied:
            return denied
        body, error_response = ext._json_body_or_error("[EXTERNAL_API][SESSION_BIND_JSON]")
        if error_response:
            return error_response
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
                return ext._external_json_error(
                    gui_result.get("error") or "清空绑定失败",
                    code,
                    status,
                )
            return ext._external_json_ok(
                ok=True,
                session_id=session_id,
                bind_state=gui_result.get("bind_state") or "UNBOUND",
                session=gui_result.get("session") or {},
            )

        client_id = (body.get("client_id") or "").strip()
        page_url = page_url_from(body)
        conversation_id = (body.get("conversation_id") or "").strip()
        page_instance_id = (body.get("page_instance_id") or "").strip()
        if not conversation_id and page_url:
            conversation_id = parse_conversation_id(page_url) or ""
        if not page_url and conversation_id:
            page_url = f"https://chatgpt.com/c/{conversation_id}"
        if not any([client_id, page_url, conversation_id, page_instance_id]):
            return ext._external_json_error(
                "缺少页面身份信息（client_id / url / conversation_id / page_instance_id）",
                "EMPTY_TEXT",
                400,
            )
        gui_result = _dispatch_to_gui(
            "sessions_bind",
            {
                "session_id": session_id,
                "client_id": client_id,
                "url": page_url,
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
            return ext._external_json_error(
                gui_result.get("error") or "绑定失败",
                code,
                status,
            )
        bound = gui_result.get("bound") or {}
        return ext._external_json_ok(
            session=gui_result.get("session") or {},
            session_id=gui_result.get("session_id") or session_id,
            bound={
                "client_id": bound.get("client_id") or client_id,
                "page_instance_id": bound.get("page_instance_id") or page_instance_id,
                "conversation_id": bound.get("conversation_id") or conversation_id,
                "url": bound.get("url") or page_url,
            },
        )

    return view
