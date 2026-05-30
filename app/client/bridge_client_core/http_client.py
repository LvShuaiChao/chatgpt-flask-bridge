from __future__ import annotations

import sys
from typing import Any, Optional
from urllib.parse import urljoin

import requests


class BridgeHttpClient:
    """Low-level HTTP for bridge API (no UI)."""

    def __init__(
        self,
        base_url: str,
        token: str = "",
        *,
        session: Optional[requests.Session] = None,
        default_http_timeout: float = 150.0,
        api_error_cls: type = RuntimeError,
    ):
        self.base_url = (base_url or "").rstrip("/")
        self.token = (token or "").strip()
        self._session = session or requests.Session()
        self.http_timeout = float(default_http_timeout)
        self._api_error_cls = api_error_cls

    def url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return urljoin(self.base_url + "/", path.lstrip("/"))

    def headers(self, *, include_json: bool = False) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if include_json:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
            headers["X-API-Key"] = self.token
        return headers

    def decode_json_response(
        self,
        response: requests.Response,
        *,
        path: str = "",
        allow_not_ok: bool = False,
    ) -> dict[str, Any]:
        api_error = self._api_error_cls
        try:
            data = response.json()
        except ValueError as error:
            text = (response.text or "")[:500]
            raise api_error(
                f"响应不是 JSON（HTTP {response.status_code}）：{text}",
                status_code=response.status_code,
            ) from error

        if not isinstance(data, dict):
            raise api_error(
                f"响应格式异常（HTTP {response.status_code}）",
                status_code=response.status_code,
            )

        if response.status_code == 404 and path.startswith("/api/v1"):
            raise api_error(
                "外部 API /api/v1 不存在。请完全退出 GUI 后重新启动，以加载最新 server.py。",
                code="API_V1_NOT_FOUND",
                status_code=404,
                payload=data,
            )

        if response.status_code >= 400 or (
            not allow_not_ok and not data.get("ok")
        ):
            raise api_error(
                data.get("error") or f"HTTP {response.status_code}",
                code=str(data.get("code") or ""),
                status_code=response.status_code,
                payload=data,
            )
        return data

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[dict] = None,
        timeout: Optional[float] = None,
        include_json_header: bool = False,
    ) -> dict[str, Any]:
        timeout = self.http_timeout if timeout is None else float(timeout)
        method_upper = method.upper()
        url = self.url(path)
        try:
            response = self._session.request(
                method_upper,
                url,
                json=json_body,
                headers=self.headers(include_json=include_json_header),
                timeout=timeout,
            )
        except requests.RequestException as error:
            payload_keys = sorted((json_body or {}).keys()) if isinstance(json_body, dict) else []
            raise self._api_error_cls(
                "[CLIENT][REQUEST_FAILED] "
                f"method={method_upper} "
                f"url={url} "
                f"path={path} "
                f"timeout={timeout} "
                f"payload_keys={payload_keys} "
                f"error_type={type(error).__name__} "
                f"error={error}"
            ) from error

        return self.decode_json_response(response, path=path)

    def probe_get(
        self, path: str, timeout: float = 5.0
    ) -> tuple[bool, dict[str, Any], str]:
        url = self.url(path)
        try:
            response = self._session.get(
                url, headers=self.headers(), timeout=timeout
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

        if response.status_code != 200:
            print(
                f"[CLIENT][CHECK][WARN] {url} HTTP {response.status_code}: {text_preview}",
                file=sys.stderr,
            )
            return False, data, f"HTTP {response.status_code}"

        return True, data, ""
