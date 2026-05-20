"""发送 / 绑定 / 同步链路的 trace_id 与 key=value 日志辅助。"""

import time

from app.utils.text_utils import short_id


def make_send_trace_id(session_id=""):
    sid = short_id(session_id, length=8)
    return f"send-{int(time.time() * 1000)}-{sid}"


def make_sync_trace_id(session_id=""):
    sid = short_id(session_id, length=8)
    return f"sync-{int(time.time() * 1000)}-{sid}"


def kv_line(**fields):
    parts = []
    for key, value in fields.items():
        if value is None:
            continue
        text = str(value)
        if text == "":
            continue
        parts.append(f"{key}={text}")
    return " ".join(parts)


def page_type_label(page_type="", conversation_id="", url=""):
    pt = (page_type or "").strip()
    if pt:
        return pt
    conv = (conversation_id or "").strip()
    if conv and conv != "-":
        return "conversation"
    raw = (url or "").strip().rstrip("/")
    if raw.endswith("chatgpt.com") or raw == "https://chatgpt.com":
        return "home"
    if "/c/" in raw:
        return "conversation"
    return "unknown"
