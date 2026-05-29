from __future__ import annotations

import json
import time
import traceback
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
