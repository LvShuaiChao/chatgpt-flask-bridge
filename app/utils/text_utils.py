import time
from urllib.parse import urlparse

from log_utils import append_log


def short_id(value, length=8):
    text = (value or "").strip()
    if not text:
        return "-"
    if len(text) <= length:
        return text
    return f"{text[:length]}…"


def short_text(value, max_len=80, suffix="..."):
    text = (value or "").strip()
    if len(text) <= max_len:
        return text
    return text[:max_len] + suffix


def format_ts(ts=None):
    if not ts:
        return "-"
    try:
        return time.strftime("%H:%M:%S", time.localtime(float(ts)))
    except (TypeError, ValueError, OSError) as error:
        append_log(f"[TIME][WARN] 时间格式化失败：ts={ts!r} error={error}")
        return "-"


def short_page_display(url, max_path_len=36, max_raw_len=80):
    raw = (url or "").strip()
    if not raw or raw == "-":
        return ""

    try:
        parsed = urlparse(raw)
        if parsed.netloc:
            path = parsed.path or ""
            if len(path) > max_path_len:
                path = path[:max_path_len] + "..."
            return f"{parsed.netloc}{path}"
    except ValueError as error:
        append_log(f"[URL][WARN] URL 解析失败：url={raw} error={error}")

    return short_text(raw, max_raw_len)
