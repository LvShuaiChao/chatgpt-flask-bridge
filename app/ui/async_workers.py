from __future__ import annotations

import json
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

from PyQt5.QtCore import QThread, pyqtSignal


class SessionSaveWorker(QThread):
    result_ready = pyqtSignal(object)

    def __init__(self, *, request_id: str, data_dir: str, payload: dict, payload_hash: str):
        super().__init__()
        self.request_id = str(request_id or "").strip()
        self.data_dir = str(data_dir or "").strip()
        self.payload = payload if isinstance(payload, dict) else {}
        self.payload_hash = str(payload_hash or "").strip()
        self.result_payload = None
        self.result_consumed = False

    def _emit_result(self, payload: dict):
        self.result_payload = payload
        self.result_ready.emit(payload)

    def run(self):
        started_at = time.perf_counter()
        sessions_file = ""
        tmp_file = ""
        try:
            data_dir = Path(self.data_dir)
            data_dir.mkdir(parents=True, exist_ok=True)
            sessions_file = str(data_dir / "chat_sessions.json")
            tmp_file = str(data_dir / "chat_sessions.json.tmp")
            text = json.dumps(
                self.payload,
                ensure_ascii=False,
                separators=(",", ":"),
            )
            tmp_path = Path(tmp_file)
            tmp_path.write_text(text, encoding="utf-8")
            tmp_path.replace(Path(sessions_file))
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            self._emit_result(
                {
                    "ok": True,
                    "request_id": self.request_id,
                    "payload_hash": self.payload_hash,
                    "path": sessions_file,
                    "tmp_path": tmp_file,
                    "elapsed_ms": elapsed_ms,
                    "bytes": len(text.encode("utf-8")),
                }
            )
        except Exception as error:
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            self._emit_result(
                {
                    "ok": False,
                    "request_id": self.request_id,
                    "payload_hash": self.payload_hash,
                    "path": sessions_file,
                    "tmp_path": tmp_file,
                    "elapsed_ms": elapsed_ms,
                    "error_type": type(error).__name__,
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                }
            )


class CursorTaskCreateWorker(QThread):
    # TODO(dead-code-observe): CursorTaskCreateWorker 当前没有实例化入口。
    # 如果连续两个版本全项目无 CursorTaskCreateWorker(...) 调用，可删除该类。
    result_ready = pyqtSignal(object)

    def __init__(
        self,
        *,
        request_id: str,
        url: str,
        task: dict,
        timeout_sec: float = 15.0,
    ):
        super().__init__()
        self.request_id = str(request_id or "").strip()
        self.url = str(url or "").strip()
        self.task = dict(task or {})
        self.timeout_sec = max(1.0, float(timeout_sec or 15.0))
        self.result_payload = None
        self.result_consumed = False

    def _emit_result(self, payload: dict):
        self.result_payload = payload
        self.result_ready.emit(payload)

    def run(self):
        try:
            body = {"task": dict(self.task or {})}
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            request = urllib.request.Request(
                self.url,
                data=payload,
                headers={"Content-Type": "application/json; charset=utf-8"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            detail_body = ""
            try:
                detail_body = error.read().decode("utf-8", errors="replace")
            except Exception as read_error:
                detail_body = (
                    f"{type(read_error).__name__}: {read_error}\n"
                    f"{traceback.format_exc()}"
                )
            self._emit_result(
                {
                    "ok": False,
                    "request_id": self.request_id,
                    "url": self.url,
                    "error_type": type(error).__name__,
                    "error": f"HTTP {error.code}: {detail_body or error.reason}",
                    "status_code": error.code,
                    "response_text": detail_body,
                    "traceback": traceback.format_exc(),
                }
            )
            return
        except urllib.error.URLError as error:
            self._emit_result(
                {
                    "ok": False,
                    "request_id": self.request_id,
                    "url": self.url,
                    "error_type": type(error).__name__,
                    "error": str(error.reason or error),
                    "traceback": traceback.format_exc(),
                }
            )
            return
        except Exception as error:
            self._emit_result(
                {
                    "ok": False,
                    "request_id": self.request_id,
                    "url": self.url,
                    "error_type": type(error).__name__,
                    "error": str(error),
                    "traceback": traceback.format_exc(),
                }
            )
            return

        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError as error:
            self._emit_result(
                {
                    "ok": False,
                    "request_id": self.request_id,
                    "url": self.url,
                    "error_type": type(error).__name__,
                    "error": f"invalid_json: {error}",
                    "response_text": raw[:1000],
                    "traceback": traceback.format_exc(),
                }
            )
            return

        if not isinstance(data, dict):
            self._emit_result(
                {
                    "ok": False,
                    "request_id": self.request_id,
                    "url": self.url,
                    "error_type": "InvalidResponseType",
                    "error": "response must be object",
                    "response_text": raw[:1000],
                }
            )
            return

        if data.get("ok"):
            self._emit_result(
                {
                    "ok": True,
                    "request_id": self.request_id,
                    "url": self.url,
                    "task_id": (data.get("task_id") or self.task.get("task_id") or "").strip(),
                    "response": data,
                }
            )
            return

        self._emit_result(
            {
                "ok": False,
                "request_id": self.request_id,
                "url": self.url,
                "error_type": "CursorBridgeRejected",
                "error": str(data.get("error") or "task_create_failed"),
                "response": data,
            }
        )
