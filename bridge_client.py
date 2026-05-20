"""
ChatGPT Page Bridge 外部 API 客户端。

用法::

    from bridge_client import BridgeClient

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
from typing import Any, Optional
from urllib.parse import urljoin

import requests


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
        base_url: str = "http://127.0.0.1:5000",
        token: Optional[str] = None,
        *,
        default_timeout: float = 120,
        http_timeout: float = 150,
        poll_interval: float = 0.2,
    ):
        self.base_url = (base_url or "http://127.0.0.1:5000").rstrip("/")
        self.token = (token if token is not None else os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")).strip()
        self.default_timeout = float(default_timeout)
        self.http_timeout = float(http_timeout)
        self.poll_interval = float(poll_interval)
        self._session = requests.Session()

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return urljoin(self.base_url + "/", path.lstrip("/"))

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[dict] = None,
        timeout: Optional[float] = None,
    ) -> dict[str, Any]:
        timeout = self.http_timeout if timeout is None else timeout
        try:
            response = self._session.request(
                method.upper(),
                self._url(path),
                json=json_body,
                headers=self._headers(),
                timeout=timeout,
            )
        except requests.RequestException as error:
            raise BridgeApiError(f"网络请求失败：{error}") from error

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

        if response.status_code >= 400 or not data.get("ok"):
            raise BridgeApiError(
                data.get("error") or f"HTTP {response.status_code}",
                code=str(data.get("code") or ""),
                status_code=response.status_code,
                payload=data,
            )
        return data

    def _get_legacy_health(self) -> dict[str, Any]:
        """GET /api/status — GUI 内置状态接口（无 /api/v1 的旧服务也可用）。"""
        try:
            response = self._session.get(
                self._url("/api/status"),
                headers=self._headers(),
                timeout=30,
            )
        except requests.RequestException as error:
            raise BridgeApiError(f"网络请求失败：{error}") from error

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
        if response.status_code >= 400:
            raise BridgeApiError(
                data.get("error") or f"HTTP {response.status_code}",
                status_code=response.status_code,
                payload=data,
            )
        return data

    @staticmethod
    def _normalize_legacy_status(data: dict[str, Any]) -> dict[str, Any]:
        tm_summary = data.get("tm_online_summary") or {}
        waiting_acks = data.get("waiting_acks") or []
        return {
            "ok": True,
            "server": "running" if data.get("server_running") else "stopped",
            "tm": {
                "online_clients": tm_summary.get("online_clients", 0),
                "online_home_clients": tm_summary.get("online_home_clients", 0),
                "online_conversation_clients": tm_summary.get(
                    "online_conversation_clients", 0
                ),
            },
            "queues": {
                "chat_queue": data.get("queue_length", 0),
                "control_queue": data.get("control_queue_length", 0),
                "waiting": len(waiting_acks),
            },
            "sessions": {},
            "tampermonkey_online": data.get("tampermonkey_online"),
            "tampermonkey_client_id": data.get("tampermonkey_client_id"),
            "_legacy_status": True,
        }

    def check_connection(self) -> tuple[bool, str]:
        """
        检查桥接服务是否可达。

        返回 (是否可用, 说明)。旧版仅含 /api/status 时也算“可达”，但会提示需重启 GUI。
        """
        try:
            self._request("GET", "/api/v1/status", timeout=10)
            return True, "已连接，外部 API /api/v1 可用。"
        except BridgeApiError as error:
            if error.status_code == 401:
                return (
                    False,
                    f"鉴权失败：{error}\n"
                    "请在客户端设置 --token 或环境变量 CHATGPT_PAGE_BRIDGE_TOKEN。",
                )
            if error.status_code not in (404,):
                return False, f"无法连接服务：{error}"

        try:
            legacy = self._get_legacy_health()
        except BridgeApiError as error:
            return (
                False,
                f"无法连接 {self.base_url}：{error}\n"
                "请确认 GUI 已启动，并在「设置 → 服务设置」中点击「启动服务」。",
            )

        if not legacy.get("server_running"):
            return (
                False,
                f"已访问 {self.base_url}，但桥接服务未运行（server_running=false）。\n"
                "请在 GUI「设置 → 服务设置」中点击「启动服务」。",
            )

        tm_online = legacy.get("tampermonkey_online")
        lines = [
            f"已连接基础服务（{self.base_url}/api/status）。",
            "当前运行的 GUI 服务较旧，缺少外部 API /api/v1/*。",
            "请完全退出 GUI 后重新运行 python gui.py，再使用本客户端发送消息。",
        ]
        if tm_online is False:
            lines.append("提示：油猴当前显示为离线，请打开 ChatGPT 页面并确认脚本已启用。")
        return True, "\n".join(lines)

    def status(self) -> dict[str, Any]:
        """GET /api/v1/status；旧服务自动回退到 /api/status。"""
        try:
            return self._request("GET", "/api/v1/status", timeout=30)
        except BridgeApiError as error:
            if error.code != "API_V1_NOT_FOUND" and error.status_code != 404:
                raise
            legacy = self._get_legacy_health()
            return self._normalize_legacy_status(legacy)

    def ask(
        self,
        text: str,
        *,
        session_id: str = "",
        auto_create_session: bool = True,
        auto_open_home: bool = True,
        timeout: Optional[float] = None,
    ) -> str:
        """
        POST /api/v1/chat/ask — 同步发送并等待回复。

        返回 assistant 回复文本。
        """
        timeout = self.default_timeout if timeout is None else float(timeout)
        data = self._request(
            "POST",
            "/api/v1/chat/ask",
            json_body={
                "text": text,
                "session_id": session_id,
                "auto_create_session": auto_create_session,
                "auto_open_home": auto_open_home,
                "timeout": timeout,
            },
            timeout=timeout + 30,
        )
        return str(data.get("reply") or "")

    def send(
        self,
        text: str,
        *,
        session_id: str = "",
        auto_create_session: bool = True,
        auto_open_home: bool = True,
        timeout: Optional[float] = None,
    ) -> dict[str, Any]:
        """
        POST /api/v1/chat/send — 异步发送。

        返回含 request_id、session_id、status 的字典。
        """
        timeout = self.default_timeout if timeout is None else float(timeout)
        return self._request(
            "POST",
            "/api/v1/chat/send",
            json_body={
                "text": text,
                "session_id": session_id,
                "auto_create_session": auto_create_session,
                "auto_open_home": auto_open_home,
                "timeout": timeout,
            },
            timeout=60,
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
        timeout: Optional[float] = None,
    ) -> str:
        """异步 send + 本地轮询 wait_result。"""
        sent = self.send(
            text,
            session_id=session_id,
            auto_create_session=auto_create_session,
            auto_open_home=auto_open_home,
            timeout=timeout,
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
        """GET /api/v1/sessions/<session_id>"""
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
        page_url: str = "",
        conversation_id: str = "",
    ) -> dict[str, Any]:
        """POST /api/v1/sessions/<session_id>/bind"""
        data = self._request(
            "POST",
            f"/api/v1/sessions/{session_id}/bind",
            json_body={
                "client_id": client_id,
                "page_url": page_url,
                "conversation_id": conversation_id,
            },
            timeout=30,
        )
        session = data.get("session")
        return dict(session) if isinstance(session, dict) else {}

    def ping(self) -> bool:
        """检查服务是否可达（含旧版仅 /api/status 的服务）。"""
        ok, _message = self.check_connection()
        return ok


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
        default=os.environ.get("CHATGPT_PAGE_BRIDGE_URL", "http://127.0.0.1:5000"),
        help="桥接服务地址",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", ""),
        help="API token（也可设环境变量 CHATGPT_PAGE_BRIDGE_TOKEN）",
    )
    parser.add_argument(
        "--session",
        default="",
        help="指定 session_id；默认自动创建新会话",
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
    if data.get("_legacy_status"):
        print("（通过旧版 /api/status 读取，会话统计不可用）")
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


def _ask_once_cli(client: BridgeClient, text: str, args: argparse.Namespace) -> str:
    kwargs = {
        "session_id": args.session,
        "auto_create_session": not args.session,
        "auto_open_home": not args.no_open_home,
        "timeout": args.timeout,
    }
    if args.use_async:
        return client.send_and_wait(text, **kwargs)
    return client.ask(text, **kwargs)


def _interactive_cli(client: BridgeClient, args: argparse.Namespace) -> int:
    print("交互模式：输入内容回车发送，空行或 Ctrl+C 退出。")
    print(f"服务: {client.base_url}")
    connected, connection_message = client.check_connection()
    if connected:
        print(connection_message)
    else:
        print(f"警告: {connection_message}", file=sys.stderr)
    session_id = args.session
    while True:
        try:
            line = input("\n你> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见。")
            return 0
        if not line:
            break
        try:
            reply = client.ask(
                line,
                session_id=session_id,
                auto_create_session=not session_id,
                auto_open_home=not args.no_open_home,
                timeout=args.timeout,
            )
            print(f"\nChatGPT> {reply}")
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
        pass


def main(argv: Optional[list[str]] = None) -> int:
    """命令行入口。也可直接运行本文件或 `python bridge_client.py`。"""
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
            reply = _ask_once_cli(client, args.message, args)
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
        if sys.platform == "win32" and os.environ.get("BRIDGE_CLIENT_NO_PAUSE") != "1":
            try:
                input("\n按 Enter 键退出...")
            except EOFError:
                pass
        raise SystemExit(1) from error
