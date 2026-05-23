"""
ChatGPT Page Bridge 外部 API 客户端。

用法::

    from app.client.bridge_client import BridgeClient

    client = BridgeClient()  # 默认 http://127.0.0.1:5000
    reply = client.ask("你好，请介绍一下你自己")
    print(reply)

需先启动 GUI 并开启本地桥接服务；油猴脚本与 ChatGPT 页面需在线。
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin

import requests

DEFAULT_CLIENT_NAME = "bridge_client"
DEFAULT_BASE_URL = "http://127.0.0.1:5000"
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_SERVER_URL_FILE = _PROJECT_ROOT / "runtime" / "server_url.txt"

HEALTH_ENDPOINTS = (
    "/api/v1/status",
    "/health",
)

# 0 = 不强制新建；N > 0 表示连续 N 条用户消息后下一条自动新建 GUI/ChatGPT 会话
FORCE_NEW_SESSION_AFTER_TURNS = 0


def resolve_default_base_url() -> str:
    env_url = (os.environ.get("CHATGPT_PAGE_BRIDGE_URL") or "").strip()
    if env_url:
        return env_url.rstrip("/")
    try:
        if RUNTIME_SERVER_URL_FILE.is_file():
            file_url = RUNTIME_SERVER_URL_FILE.read_text(encoding="utf-8").strip()
            if file_url:
                return file_url.rstrip("/")
    except OSError as error:
        print(
            f"[CLIENT][CONFIG] 读取 {RUNTIME_SERVER_URL_FILE} 失败：{error}",
            file=sys.stderr,
        )
    return DEFAULT_BASE_URL


def format_connection_help(base_url: str) -> str:
    status_url = f"{base_url.rstrip('/')}/api/v1/status"
    runtime_hint = ""
    if RUNTIME_SERVER_URL_FILE.is_file():
        runtime_hint = (
            f"\nGUI 最近一次启动地址见：{RUNTIME_SERVER_URL_FILE}"
        )
    return (
        f"无法访问 {status_url}\n"
        "请确认 GUI 已启动；默认桥接地址为 http://127.0.0.1:5000/api/bridge（可在 GUI「详情」查看）。\n"
        "若 GUI 自动切换到了备用端口（如 8765），请把客户端地址改为该端口，例如：\n"
        "  python -m app.client.bridge_client --url http://127.0.0.1:8765\n"
        "或设置环境变量 CHATGPT_PAGE_BRIDGE_URL。"
        f"{runtime_hint}"
    )


@dataclass
class ConnectionDiagnostics:
    """启动时连接探测结果。"""

    health_ok: bool = False
    health_endpoint: str = ""
    bridge_ok: bool = False
    chat_api_ok: bool = False
    external_v1: bool = False
    tm_online_clients: int = 0
    messages: list[str] = field(default_factory=list)

    def summary_lines(self) -> list[str]:
        health_text = "通过" if self.health_ok else "失败"
        if self.health_ok and self.health_endpoint:
            health_text = f"{health_text} ({self.health_endpoint})"
        bridge_text = "可用" if self.bridge_ok else "不可用"
        chat_text = "可用" if self.chat_api_ok else "未实现/不可用"
        lines = [
            f"健康检查: {health_text}",
            f"油猴桥接 /api/bridge: {bridge_text}",
            f"外部聊天 API /api/v1/chat/ask: {chat_text}",
            f"油猴客户端: 在线 {self.tm_online_clients} 个",
        ]
        lines.extend(self.messages)
        return lines


class BridgeApiError(RuntimeError):
    """外部 API 返回 ok=false 或 HTTP 错误。"""

    def __init__(
        self,
        message: str,
        *,
        code: str = "",
        status_code: int = 0,
        payload: Optional[dict] = None,
    ):
        super().__init__(message)
        self.code = code or ""
        self.status_code = status_code
        self.payload = payload or {}


class BridgeClient:
    """调用 /api/v1/* 的 Python 客户端。"""

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        *,
        default_timeout: float = 120,
        http_timeout: float = 150,
        poll_interval: float = 0.2,
    ):
        self.base_url = (base_url or resolve_default_base_url()).rstrip("/")
        self.token = (token if token is not None else os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")).strip()
        self.default_timeout = float(default_timeout)
        self.http_timeout = float(http_timeout)
        self.poll_interval = float(poll_interval)
        self._session = requests.Session()

    def _headers(self, *, include_json: bool = False) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if include_json:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
            headers["X-API-Key"] = self.token
        return headers

    @staticmethod
    def _health_payload_ok(data: dict[str, Any]) -> bool:
        if data.get("ok") is True:
            return True
        if data.get("server_running") is True:
            return True
        if (data.get("server") or "").strip().lower() == "running":
            return True
        return False

    @staticmethod
    def _tm_online_count(data: dict[str, Any]) -> int:
        tm = data.get("tm") or data.get("tampermonkey") or data.get("tm_online_summary") or {}
        if isinstance(tm, dict):
            return int(tm.get("online_clients") or 0)
        return 0

    def _probe_get_health(self, path: str, timeout: float = 5) -> tuple[bool, dict[str, Any], str]:
        url = self._url(path)
        try:
            response = self._session.get(
                url,
                headers=self._headers(),
                timeout=timeout,
            )
        except requests.RequestException as error:
            print(f"[CLIENT][CHECK][ERROR] {url} -> {error}", file=sys.stderr)
            return False, {}, str(error)

        text_preview = (response.text or "")[:200]
        try:
            data = response.json()
        except ValueError as error:
            print(
                f"[CLIENT][CHECK][ERROR] {url} JSON 解析失败：{error}；"
                f"HTTP {response.status_code} body={text_preview}",
                file=sys.stderr,
            )
            return False, {}, str(error)

        if not isinstance(data, dict):
            print(
                f"[CLIENT][CHECK][WARN] {url} 响应不是对象：HTTP {response.status_code} {text_preview}",
                file=sys.stderr,
            )
            return False, {}, "响应格式异常"

        if response.status_code == 401:
            print(
                f"[CLIENT][CHECK][WARN] {url} HTTP 401 未授权：{text_preview}",
                file=sys.stderr,
            )
            return False, data, "未授权"

        if response.status_code != 200:
            print(
                f"[CLIENT][CHECK][WARN] {url} HTTP {response.status_code}: {text_preview}",
                file=sys.stderr,
            )
            return False, data, f"HTTP {response.status_code}"

        if not self._health_payload_ok(data):
            print(
                f"[CLIENT][CHECK][WARN] {url} 未通过健康判定：{data}",
                file=sys.stderr,
            )
            return False, data, "健康检查未通过"

        print(f"[CLIENT][CHECK] 服务可用：{url}", file=sys.stderr)
        return True, data, ""

    def _probe_bridge(self, timeout: float = 5) -> tuple[bool, dict[str, Any]]:
        url = self._url("/api/bridge")
        payload = {
            "action": "poll",
            "client_id": "bridge-client-probe",
            "test_connection": True,
        }
        headers = self._headers(include_json=True)
        headers["X-Request-Source"] = "tampermonkey"
        try:
            response = self._session.post(
                url,
                json=payload,
                headers=headers,
                timeout=timeout,
            )
        except requests.RequestException as error:
            print(f"[CLIENT][CHECK][ERROR] {url} -> {error}", file=sys.stderr)
            return False, {}

        text_preview = (response.text or "")[:200]
        try:
            data = response.json()
        except ValueError as error:
            print(
                f"[CLIENT][CHECK][ERROR] {url} JSON 解析失败：{error}；"
                f"HTTP {response.status_code} body={text_preview}",
                file=sys.stderr,
            )
            return False, {}

        if response.status_code == 401:
            print(f"[CLIENT][CHECK][WARN] {url} HTTP 401：{text_preview}", file=sys.stderr)
            return False, data if isinstance(data, dict) else {}

        if response.status_code != 200:
            print(
                f"[CLIENT][CHECK][WARN] {url} HTTP {response.status_code}: {text_preview}",
                file=sys.stderr,
            )
            return False, data if isinstance(data, dict) else {}

        if not isinstance(data, dict):
            print(f"[CLIENT][CHECK][WARN] {url} 响应不是对象", file=sys.stderr)
            return False, {}

        print(f"[CLIENT][CHECK] 油猴桥接可用：{url}", file=sys.stderr)
        return True, data

    def check_chat_api(self, timeout: float = 8) -> tuple[bool, str]:
        """探测 POST /api/v1/chat/ask 是否存在（不要求真正发送成功）。"""
        url = self._url("/api/v1/chat/ask")
        payload = {
            "text": "__ping__",
            "auto_create_session": False,
            "auto_open_home": False,
            "timeout": 5,
        }
        try:
            response = self._session.post(
                url,
                json=payload,
                headers=self._headers(include_json=True),
                timeout=timeout,
            )
        except requests.RequestException as error:
            print(f"[CLIENT][CHAT_API][ERROR] {url} -> {error}", file=sys.stderr)
            return False, f"无法访问聊天接口：{error}"

        text_preview = (response.text or "")[:500]
        try:
            body = response.json()
        except ValueError as error:
            body = None
            print(
                "[CLIENT][CHAT_API][JSON_PARSE_FAILED] "
                f"url={url} "
                f"status={response.status_code} "
                f"error_type={type(error).__name__} "
                f"error={error} "
                f"body_preview={text_preview!r}",
                file=sys.stderr,
            )

        if response.status_code == 404:
            if isinstance(body, dict) and (
                "ok" in body or body.get("code") or body.get("error")
            ):
                code = str(body.get("code") or "")
                print(
                    f"[CLIENT][CHAT_API] 接口存在（HTTP 404 业务响应 code={code}）",
                    file=sys.stderr,
                )
                return True, ""

            print(
                "[CLIENT][CHAT_API] /api/v1/chat/ask 路由不存在（HTTP 404 HTML），"
                "请完全退出 GUI 后重新启动以加载最新 server.py",
                file=sys.stderr,
            )
            return False, "外部聊天接口 /api/v1/chat/ask 不存在（路由 404）。"

        if response.status_code == 401:
            print(f"[CLIENT][CHAT_API][WARN] {url} HTTP 401：{text_preview}", file=sys.stderr)
            return False, "聊天接口鉴权失败，请设置 --token 或 CHATGPT_PAGE_BRIDGE_TOKEN。"

        if response.status_code in (200, 400, 409, 503):
            print(f"[CLIENT][CHAT_API] 接口存在：{url} HTTP {response.status_code}", file=sys.stderr)
            return True, ""

        if isinstance(body, dict) and ("ok" in body or body.get("code")):
            print(
                f"[CLIENT][CHAT_API] 接口存在：{url} HTTP {response.status_code} "
                f"code={body.get('code')}",
                file=sys.stderr,
            )
            return True, ""

        print(
            f"[CLIENT][CHAT_API][WARN] {url} HTTP {response.status_code}: {text_preview}",
            file=sys.stderr,
        )
        return False, f"聊天接口异常：HTTP {response.status_code}"

    def diagnose_connection(self) -> ConnectionDiagnostics:
        diag = ConnectionDiagnostics()

        for path in HEALTH_ENDPOINTS:
            ok, data, _reason = self._probe_get_health(path)
            if ok:
                diag.health_ok = True
                diag.health_endpoint = path
                diag.tm_online_clients = max(
                    diag.tm_online_clients,
                    self._tm_online_count(data),
                )
                if path == "/api/v1/status":
                    diag.external_v1 = True
                break

        bridge_ok, bridge_data = self._probe_bridge()
        diag.bridge_ok = bridge_ok
        if bridge_ok and not diag.health_ok:
            diag.health_ok = True
            diag.health_endpoint = "/api/bridge"
            diag.messages.append(
                "已通过 POST /api/bridge 确认服务运行（油猴桥接接口正常）。"
            )
        if bridge_ok and diag.tm_online_clients == 0:
            if bridge_data.get("tampermonkey_online"):
                diag.tm_online_clients = 1

        if diag.health_ok and diag.external_v1:
            chat_ok, chat_reason = self.check_chat_api()
            diag.chat_api_ok = chat_ok
            if not chat_ok and chat_reason:
                diag.messages.append(chat_reason)
        elif diag.health_ok and not diag.external_v1:
            chat_ok, chat_reason = self.check_chat_api()
            if chat_ok:
                diag.chat_api_ok = True
                diag.external_v1 = True
            else:
                diag.chat_api_ok = False
                diag.messages.append(
                    "服务已连接（/health），但外部 API /api/v1 不可用。"
                )
                diag.messages.append(
                    "请完全退出 GUI 后重新运行 python gui.py，以加载含 /api/v1/* 的最新 server.py。"
                )
                if chat_reason:
                    diag.messages.append(chat_reason)
        elif not diag.health_ok:
            diag.messages.append(format_connection_help(self.base_url))

        if diag.health_ok and diag.external_v1 and diag.chat_api_ok:
            if diag.tm_online_clients == 0:
                diag.messages.append(
                    "提示：当前没有在线油猴页面，发送消息前请打开 ChatGPT 并确认脚本已启用。"
                )

        return diag

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return urljoin(self.base_url + "/", path.lstrip("/"))

    def _decode_json_response(
        self,
        response,
        *,
        path: str = "",
        allow_not_ok: bool = False,
    ) -> dict[str, Any]:
        try:
            data = response.json()
        except ValueError as error:
            text = (response.text or "")[:500]
            raise BridgeApiError(
                f"响应不是 JSON（HTTP {response.status_code}）：{text}",
                status_code=response.status_code,
            ) from error

        if not isinstance(data, dict):
            raise BridgeApiError(
                f"响应格式异常（HTTP {response.status_code}）",
                status_code=response.status_code,
            )

        if response.status_code == 404 and path.startswith("/api/v1"):
            raise BridgeApiError(
                "外部 API /api/v1 不存在。请完全退出 GUI 后重新启动，以加载最新 server.py。",
                code="API_V1_NOT_FOUND",
                status_code=404,
                payload=data,
            )

        if response.status_code >= 400 or (
            not allow_not_ok and not data.get("ok")
        ):
            raise BridgeApiError(
                data.get("error") or f"HTTP {response.status_code}",
                code=str(data.get("code") or ""),
                status_code=response.status_code,
                payload=data,
            )
        return data

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[dict] = None,
        timeout: Optional[float] = None,
    ) -> dict[str, Any]:
        timeout = self.http_timeout if timeout is None else timeout
        method_upper = method.upper()
        url = self._url(path)
        try:
            response = self._session.request(
                method_upper,
                url,
                json=json_body,
                headers=self._headers(),
                timeout=timeout,
            )
        except requests.RequestException as error:
            payload_keys = sorted((json_body or {}).keys()) if isinstance(json_body, dict) else []
            raise BridgeApiError(
                "[CLIENT][REQUEST_FAILED] "
                f"method={method_upper} "
                f"url={url} "
                f"path={path} "
                f"timeout={timeout} "
                f"payload_keys={payload_keys} "
                f"error_type={type(error).__name__} "
                f"error={error}"
            ) from error

        return self._decode_json_response(response, path=path)

    def check_connection(self) -> tuple[bool, str]:
        """
        @deprecated 当前 GUI / CLI 内部不再使用。

        保留原因：外部脚本可能直接调用 BridgeClient.check_connection()。
        新代码请优先使用 diagnose_connection()。
        """
        diag = self.diagnose_connection()
        if not diag.health_ok:
            return False, "\n".join(diag.summary_lines())
        if not diag.chat_api_ok:
            return False, "\n".join(diag.summary_lines())
        return True, "\n".join(diag.summary_lines())

    def status(self) -> dict[str, Any]:
        """GET /api/v1/status。"""
        return self._request("GET", "/api/v1/status", timeout=30)

    def _chat_ask_payload(
        self,
        text: str,
        *,
        session_id: str = "",
        auto_create_session: bool = True,
        auto_open_home: bool = True,
        new_session: bool = False,
        reuse_last_session: bool = True,
        force_new_session_after_turns: Optional[int] = None,
        timeout: Optional[float] = None,
        client_name: str = DEFAULT_CLIENT_NAME,
    ) -> dict[str, Any]:
        timeout = self.default_timeout if timeout is None else float(timeout)
        if force_new_session_after_turns is None:
            force_new_session_after_turns = FORCE_NEW_SESSION_AFTER_TURNS
        if new_session:
            print("[CLIENT][NEW_SESSION_REQUEST]", file=sys.stderr)
        elif session_id:
            print(
                f"[CLIENT][REUSE_SESSION] session_id={session_id}",
                file=sys.stderr,
            )
        return {
            "text": text,
            "session_id": session_id or "",
            "auto_create_session": auto_create_session,
            "auto_open_home": auto_open_home,
            "new_session": new_session,
            "reuse_last_session": reuse_last_session,
            "force_new_session_after_turns": int(force_new_session_after_turns or 0),
            "timeout": timeout,
            "client_name": client_name,
        }

    def _request_chat_action(
        self,
        endpoint: str,
        text: str,
        *,
        session_id: str = "",
        auto_create_session: bool = True,
        auto_open_home: bool = True,
        new_session: bool = False,
        reuse_last_session: bool = True,
        force_new_session_after_turns: Optional[int] = None,
        timeout: Optional[float] = None,
        client_name: str = DEFAULT_CLIENT_NAME,
        request_timeout: Optional[float] = None,
    ) -> dict[str, Any]:
        timeout = self.default_timeout if timeout is None else float(timeout)
        if request_timeout is None:
            request_timeout = timeout + 30
        return self._request(
            "POST",
            endpoint,
            json_body=self._chat_ask_payload(
                text,
                session_id=session_id,
                auto_create_session=auto_create_session,
                auto_open_home=auto_open_home,
                new_session=new_session,
                reuse_last_session=reuse_last_session,
                force_new_session_after_turns=force_new_session_after_turns,
                timeout=timeout,
                client_name=client_name,
            ),
            timeout=request_timeout,
        )

    def ask(
        self,
        text: str,
        *,
        session_id: str = "",
        auto_create_session: bool = True,
        auto_open_home: bool = True,
        new_session: bool = False,
        reuse_last_session: bool = True,
        force_new_session_after_turns: Optional[int] = None,
        timeout: Optional[float] = None,
        client_name: str = DEFAULT_CLIENT_NAME,
        return_meta: bool = False,
    ) -> str | dict[str, Any]:
        """
        POST /api/v1/chat/ask — 同步发送并等待回复。

        返回 assistant 回复文本；return_meta=True 时返回完整响应 dict。
        """
        data = self._request_chat_action(
            "/api/v1/chat/ask",
            text,
            session_id=session_id,
            auto_create_session=auto_create_session,
            auto_open_home=auto_open_home,
            new_session=new_session,
            reuse_last_session=reuse_last_session,
            force_new_session_after_turns=force_new_session_after_turns,
            timeout=timeout,
            client_name=client_name,
        )
        if return_meta:
            return data
        return str(data.get("reply") or "")

    def send(
        self,
        text: str,
        *,
        session_id: str = "",
        auto_create_session: bool = True,
        auto_open_home: bool = True,
        new_session: bool = False,
        reuse_last_session: bool = True,
        force_new_session_after_turns: Optional[int] = None,
        timeout: Optional[float] = None,
        client_name: str = DEFAULT_CLIENT_NAME,
    ) -> dict[str, Any]:
        """
        POST /api/v1/chat/send — 异步发送。

        返回含 request_id、session_id、status 的字典。
        """
        return self._request_chat_action(
            "/api/v1/chat/send",
            text,
            session_id=session_id,
            auto_create_session=auto_create_session,
            auto_open_home=auto_open_home,
            new_session=new_session,
            reuse_last_session=reuse_last_session,
            force_new_session_after_turns=force_new_session_after_turns,
            timeout=timeout,
            client_name=client_name,
            request_timeout=60,
        )

    def get_result(self, request_id: str) -> dict[str, Any]:
        """GET /api/v1/chat/result/<request_id>"""
        return self._request(
            "GET",
            f"/api/v1/chat/result/{request_id}",
            timeout=30,
        )

    def wait_result(
        self,
        request_id: str,
        *,
        timeout: Optional[float] = None,
        poll_interval: Optional[float] = None,
    ) -> str:
        """轮询异步请求直到完成或超时，返回回复文本。"""
        timeout = self.default_timeout if timeout is None else float(timeout)
        poll_interval = self.poll_interval if poll_interval is None else float(poll_interval)
        deadline = time.time() + timeout
        last_status = ""

        while time.time() < deadline:
            try:
                data = self.get_result(request_id)
            except BridgeApiError as error:
                if error.code == "SESSION_NOT_FOUND":
                    raise BridgeApiError(
                        f"request_id 不存在：{request_id}",
                        code="SESSION_NOT_FOUND",
                        payload=error.payload,
                    ) from error
                raise

            status = str(data.get("status") or "")
            last_status = status
            if status == "done":
                return str(data.get("reply") or "")
            if status in ("failed", "timeout"):
                raise BridgeApiError(
                    data.get("error") or status,
                    code=str(data.get("code") or status.upper()),
                    payload=data,
                )
            time.sleep(poll_interval)

        raise BridgeApiError(
            f"等待回复超时（{int(timeout)}s），最后状态：{last_status or 'waiting'}",
            code="REPLY_TIMEOUT",
        )

    def send_and_wait(
        self,
        text: str,
        *,
        session_id: str = "",
        auto_create_session: bool = True,
        auto_open_home: bool = True,
        new_session: bool = False,
        reuse_last_session: bool = True,
        force_new_session_after_turns: Optional[int] = None,
        timeout: Optional[float] = None,
        client_name: str = DEFAULT_CLIENT_NAME,
    ) -> str:
        """异步 send + 本地轮询 wait_result。"""
        sent = self.send(
            text,
            session_id=session_id,
            auto_create_session=auto_create_session,
            auto_open_home=auto_open_home,
            new_session=new_session,
            reuse_last_session=reuse_last_session,
            force_new_session_after_turns=force_new_session_after_turns,
            timeout=timeout,
            client_name=client_name,
        )
        request_id = str(sent.get("request_id") or "")
        if not request_id:
            raise BridgeApiError("send 未返回 request_id", payload=sent)
        return self.wait_result(request_id, timeout=timeout)

    def list_sessions(self) -> list[dict[str, Any]]:
        """GET /api/v1/sessions"""
        data = self._request("GET", "/api/v1/sessions", timeout=30)
        sessions = data.get("sessions")
        return list(sessions) if isinstance(sessions, list) else []

    def create_session(self, title: str = "新对话") -> dict[str, Any]:
        """POST /api/v1/sessions"""
        data = self._request(
            "POST",
            "/api/v1/sessions",
            json_body={"title": title},
            timeout=30,
        )
        session = data.get("session")
        return dict(session) if isinstance(session, dict) else {}

    def get_session(self, session_id: str) -> dict[str, Any]:
        """
        @deprecated 当前 GUI / CLI 内部不再使用。

        保留原因：BridgeClient 可能作为外部 SDK 使用。
        新代码如无强需求，优先使用 list_sessions() 或服务端 /api/v1/sessions。
        """
        data = self._request(
            "GET",
            f"/api/v1/sessions/{session_id}",
            timeout=30,
        )
        session = data.get("session")
        return dict(session) if isinstance(session, dict) else {}

    def bind_session(
        self,
        session_id: str,
        client_id: str,
        *,
        url: str = "",
        page_url: str = "",
        conversation_id: str = "",
    ) -> dict[str, Any]:
        """
        @deprecated 当前 GUI / CLI 内部不再使用。

        保留原因：外部脚本可能通过 SDK 绑定 session。
        新代码请优先使用 /api/v1 接口；GUI 内部绑定应以 session.remote_chatgpt 为权威。
        """
        url = (url or page_url or "").strip()
        data = self._request(
            "POST",
            f"/api/v1/sessions/{session_id}/bind",
            json_body={
                "client_id": client_id,
                "url": url,
                "conversation_id": conversation_id,
            },
            timeout=30,
        )
        session = data.get("session")
        return dict(session) if isinstance(session, dict) else {}

    def ping(self) -> bool:
        """
        @deprecated 当前 GUI / CLI 内部不再使用。

        保留原因：外部脚本可能直接调用 BridgeClient.ping()。
        新代码请优先使用 diagnose_connection().health_ok 或 status()。
        """
        return self.diagnose_connection().health_ok


def _build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ChatGPT Page Bridge 命令行客户端",
        prog="bridge_client",
    )
    parser.add_argument(
        "message",
        nargs="?",
        help="要发送的内容；省略则进入交互模式",
    )
    parser.add_argument(
        "--url",
        default=resolve_default_base_url(),
        help="桥接服务地址（默认读 CHATGPT_PAGE_BRIDGE_URL 或 runtime/server_url.txt）",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", ""),
        help="API token（也可设环境变量 CHATGPT_PAGE_BRIDGE_TOKEN）",
    )
    parser.add_argument(
        "--session",
        default="",
        help="指定初始 session_id（交互模式会复用并在首条消息后更新）",
    )
    parser.add_argument(
        "--new-session",
        action="store_true",
        help="本条消息强制新建 GUI 会话与 ChatGPT 对话",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120,
        help="等待回复超时（秒）",
    )
    parser.add_argument(
        "--no-open-home",
        action="store_true",
        help="无可用页面时不自动打开 ChatGPT 首页",
    )
    parser.add_argument(
        "--async",
        dest="use_async",
        action="store_true",
        help="使用 send + 轮询（不用服务端 /chat/ask 长连接）",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="仅打印服务状态后退出",
    )
    parser.add_argument(
        "--list-sessions",
        action="store_true",
        help="列出 GUI 会话后退出",
    )
    parser.add_argument(
        "--no-pause",
        action="store_true",
        help="退出前不等待按键（Windows 双击运行时默认会暂停）",
    )
    return parser


def _print_bridge_status(client: BridgeClient) -> None:
    data = client.status()
    tm = data.get("tm") or {}
    queues = data.get("queues") or {}
    sessions = data.get("sessions") or {}
    print("服务:", data.get("server", "-"))
    if "tampermonkey_online" in data:
        print("油猴在线:", "是" if data.get("tampermonkey_online") else "否")
        print("最近 client_id:", data.get("tampermonkey_client_id") or "-")
    print(
        f"油猴: 在线 {tm.get('online_clients', 0)} | "
        f"首页 {tm.get('online_home_clients', 0)} | "
        f"对话页 {tm.get('online_conversation_clients', 0)}"
    )
    print(
        f"队列: chat={queues.get('chat_queue', 0)} "
        f"control={queues.get('control_queue', 0)} "
        f"waiting={queues.get('waiting', 0)}"
    )
    print(
        f"会话: 共 {sessions.get('total', 0)} | "
        f"绑定在线 {sessions.get('bound_online', 0)} | "
        f"绑定离线 {sessions.get('bound_offline', 0)} | "
        f"未绑定 {sessions.get('unbound', 0)}"
    )


def _print_bridge_sessions(client: BridgeClient) -> None:
    items = client.list_sessions()
    if not items:
        print("（暂无会话）")
        return
    for item in items:
        sid = (item.get("session_id") or "")[:8]
        title = item.get("title") or "新对话"
        bind_state = item.get("bind_state") or "-"
        print(f"{sid}…  {title}  [{bind_state}]")


def _apply_ask_session_meta(
    data: dict[str, Any],
    *,
    current_session_id: Optional[str],
    current_session_turn_count: int,
) -> tuple[Optional[str], int]:
    """根据 ask 响应更新本地 session 与轮数。"""
    new_sid = (data.get("session_id") or "").strip() or None
    if data.get("new_session_created"):
        reason = (data.get("new_session_reason") or "").strip()
        limit = int(data.get("force_new_session_after_turns") or 0)
        if reason == "force_new_session_after_turns" and limit > 0:
            print(
                f"已达到 {limit} 条消息上限，服务端已自动创建新会话：{new_sid or '-'}",
                file=sys.stderr,
            )
        if new_sid and new_sid != (current_session_id or ""):
            return new_sid, 1
    if new_sid and new_sid != (current_session_id or ""):
        return new_sid, 1
    if new_sid:
        return new_sid, current_session_turn_count + 1
    return current_session_id, current_session_turn_count + 1


def _ask_once_cli(
    client: BridgeClient,
    text: str,
    args: argparse.Namespace,
    *,
    session_id: str = "",
    new_session: bool = False,
) -> tuple[str, str]:
    sid = (session_id or args.session or "").strip()
    use_new = new_session or bool(getattr(args, "new_session", False))
    kwargs = {
        "session_id": sid,
        "auto_create_session": True,
        "auto_open_home": not args.no_open_home,
        "new_session": use_new,
        "reuse_last_session": not use_new,
        "timeout": args.timeout,
    }
    print(
        f"[CLIENT][SESSION] current_session_id={sid or '(none)'}",
        file=sys.stderr,
    )
    if args.use_async:
        sent = client.send(text, **kwargs)
        request_id = str(sent.get("request_id") or "")
        if not request_id:
            raise BridgeApiError("send 未返回 request_id", payload=sent)
        reply = client.wait_result(request_id, timeout=args.timeout)
        return reply, str(sent.get("session_id") or sid)
    data = client.ask(text, return_meta=True, **kwargs)
    if not isinstance(data, dict):
        return str(data), sid
    return str(data.get("reply") or ""), str(data.get("session_id") or sid)


def _print_startup_diagnostics(client: BridgeClient) -> ConnectionDiagnostics:
    diag = client.diagnose_connection()
    print(f"服务: {client.base_url}")
    for line in diag.summary_lines():
        print(line)
    return diag


def _interactive_cli(client: BridgeClient, args: argparse.Namespace) -> int:
    print("交互模式：输入内容回车发送，空行或 Ctrl+C 退出。")
    print("命令：/new 下一条新建会话；/session 查看当前 session_id；/limit 查看强制新建阈值")
    diag = _print_startup_diagnostics(client)
    if not diag.health_ok:
        print(
            f"\n无法连接服务：请确认 GUI 已启动，地址为 {client.base_url}。",
            file=sys.stderr,
        )
        return 1
    if not diag.chat_api_ok:
        print(
            "\n服务已连接，但外部聊天接口 /api/v1/chat/ask 不可用。\n"
            "当前仅 /api/bridge 油猴内部接口可用，bridge_client 无法直接发送聊天。\n"
            "请完全退出 GUI 后重新运行 python gui.py 加载最新 server.py。",
            file=sys.stderr,
        )
        return 1
    current_session_id: Optional[str] = (args.session or "").strip() or None
    current_session_turn_count = 0
    manual_new_next = False
    while True:
        try:
            line = input("\n你> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见。")
            return 0
        if not line:
            break
        if line == "/limit":
            limit = FORCE_NEW_SESSION_AFTER_TURNS
            if limit > 0:
                print(f"当前强制新建阈值：{limit} 条用户消息")
            else:
                print("当前强制新建阈值：已关闭（0 = 不强制新建）")
            continue
        if line == "/new":
            current_session_id = None
            current_session_turn_count = 0
            manual_new_next = True
            print("已切换为新会话模式，下一条消息将创建新的 GUI 对话。")
            continue
        if line == "/session":
            if current_session_id:
                print(f"当前 session_id: {current_session_id}")
            else:
                print("当前还没有绑定外部 session，下一条消息将自动创建。")
            continue
        try:
            use_new_session = manual_new_next
            manual_new_next = False
            print(
                f"[CLIENT][SESSION] current_session_id={current_session_id or '(none)'}",
                file=sys.stderr,
            )
            data = client.ask(
                line,
                session_id=current_session_id or "",
                auto_create_session=True,
                auto_open_home=not args.no_open_home,
                new_session=use_new_session,
                reuse_last_session=not use_new_session,
                timeout=args.timeout,
                return_meta=True,
            )
            if not isinstance(data, dict):
                data = {"reply": str(data)}
            current_session_id, current_session_turn_count = _apply_ask_session_meta(
                data,
                current_session_id=current_session_id,
                current_session_turn_count=current_session_turn_count,
            )
            if current_session_id:
                print(
                    f"[CLIENT][SESSION] current_session_id={current_session_id}",
                    file=sys.stderr,
                )
            reply = str(data.get("reply") or "")
            sid_hint = ""
            if current_session_id:
                sid_hint = f" [session {current_session_id[:8]}… 第{current_session_turn_count}轮]"
            print(f"\nChatGPT>{sid_hint} {reply}")
        except BridgeApiError as error:
            print(f"\n[错误 {error.code}] {error}", file=sys.stderr)
    return 0


def _pause_before_exit(enabled: bool) -> None:
    if not enabled:
        return
    if os.environ.get("BRIDGE_CLIENT_NO_PAUSE") == "1":
        return
    try:
        input("\n按 Enter 键退出...")
    except EOFError:
        return


def main(argv: Optional[list[str]] = None) -> int:
    """命令行入口：`python -m app.client.bridge_client`。"""
    parser = _build_cli_parser()
    args = parser.parse_args(argv)
    pause_on_exit = not args.no_pause

    client = BridgeClient(
        base_url=args.url,
        token=args.token or None,
        default_timeout=args.timeout,
        http_timeout=args.timeout + 30,
    )

    try:
        if args.status:
            _print_bridge_status(client)
            return 0

        if args.list_sessions:
            _print_bridge_sessions(client)
            return 0

        if args.message:
            diag = client.diagnose_connection()
            if not diag.health_ok:
                print(
                    f"无法连接服务：请确认 GUI 已启动，地址为 {client.base_url}。",
                    file=sys.stderr,
                )
                for line in diag.summary_lines():
                    print(line, file=sys.stderr)
                return 1
            if not diag.chat_api_ok:
                print(
                    "服务已连接，但外部聊天接口 /api/v1/chat/ask 不可用。",
                    file=sys.stderr,
                )
                for line in diag.summary_lines():
                    print(line, file=sys.stderr)
                return 1
            reply, _sid = _ask_once_cli(client, args.message, args)
            print(reply)
            return 0

        return _interactive_cli(client, args)
    except BridgeApiError as error:
        print(f"失败 [{error.code}]: {error}", file=sys.stderr)
        if error.payload:
            print(error.payload, file=sys.stderr)
        return 1
    finally:
        if pause_on_exit and sys.platform == "win32":
            _pause_before_exit(True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"运行失败: {error}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        if sys.platform == "win32":
            _pause_before_exit(True)
        raise SystemExit(1) from error
