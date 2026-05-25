import time

from app.utils.log_utils import append_log


def short_id(value, length=8):
    text = (value or "").strip()
    if not text:
        return "-"
    if len(text) <= length:
        return text
    return f"{text[:length]}…"


def format_ts(ts=None):
    if not ts:
        return "-"
    try:
        return time.strftime("%H:%M:%S", time.localtime(float(ts)))
    except (TypeError, ValueError, OSError) as error:
        append_log(f"[TIME][WARN] 时间格式化失败：ts={ts!r} error={error}")
        return "-"
