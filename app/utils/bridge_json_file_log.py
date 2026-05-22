"""桥接完整 JSON 独立落盘：logs/bridge_json.log"""
from __future__ import annotations

import threading
import time
import traceback
from pathlib import Path

BRIDGE_JSON_LOG_TAGS = (
    "[GUI][JSON][SEND_PAYLOAD_FULL]",
    "[BRIDGE][JSON][SERVER_TO_TM_QUEUE_FULL]",
    "[BRIDGE][JSON][TM_TO_SERVER_FULL]",
    "[BRIDGE][JSON][SERVER_TO_TM_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_REPORT_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_RECV_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_UNKNOWN_FULL]",
)

_BRIDGE_JSON_LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
BRIDGE_JSON_LOG_FILE = _BRIDGE_JSON_LOG_DIR / "bridge_json.log"
_BRIDGE_JSON_LOG_LOCK = threading.RLock()


def _now_text():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


def should_write_bridge_json_file(message: str) -> bool:
    text = str(message or "")
    return any(tag in text for tag in BRIDGE_JSON_LOG_TAGS)


def append_bridge_json_log(message: str) -> None:
    text = str(message or "").rstrip()
    if not text:
        return
    line = f"[{_now_text()}] {text}\n"
    with _BRIDGE_JSON_LOG_LOCK:
        try:
            _BRIDGE_JSON_LOG_DIR.mkdir(parents=True, exist_ok=True)
            with BRIDGE_JSON_LOG_FILE.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(line)
        except Exception as exc:
            err_line = (
                "[BRIDGE_JSON_LOG][WRITE_FAILED] "
                f"error_type={type(exc).__name__} "
                f"error={exc}\n{traceback.format_exc()}"
            )
            print(err_line, flush=True)
