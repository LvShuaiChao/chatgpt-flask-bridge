from collections import deque
from pathlib import Path
import inspect
import os
import platform
import sys
import threading
import time
import traceback


_LOG_LOCK = threading.RLock()
LOG_FILE = Path(__file__).resolve().parent / "log.txt"
_LOG_VERBOSE = os.environ.get("CHATGPT_BRIDGE_VERBOSE_LOG", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
_LOG_MIRROR_TO_CONSOLE = os.environ.get("CHATGPT_BRIDGE_LOG_TO_CONSOLE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
_LOG_INCLUDE_CALLSITE = os.environ.get("CHATGPT_BRIDGE_LOG_CALLSITE", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)
_SENSITIVE_KEYS = {
    "token",
    "authorization",
    "cookie",
    "password",
    "secret",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
}
_MAX_FIELD_TEXT_LEN = 500


def set_log_runtime_options(verbose=None, mirror_to_console=None, include_callsite=None):
    global _LOG_VERBOSE, _LOG_MIRROR_TO_CONSOLE, _LOG_INCLUDE_CALLSITE
    if verbose is not None:
        _LOG_VERBOSE = bool(verbose)
    if mirror_to_console is not None:
        _LOG_MIRROR_TO_CONSOLE = bool(mirror_to_console)
    if include_callsite is not None:
        _LOG_INCLUDE_CALLSITE = bool(include_callsite)


def _now_text():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


def _safe_text(value, max_len=_MAX_FIELD_TEXT_LEN):
    text = str(value)
    text = text.replace("\r", "\\r").replace("\n", "\\n")
    if len(text) > max_len:
        return text[:max_len] + f"...<truncated:{len(text)}>"
    return text


def _safe_field_value(key, value):
    key_text = str(key or "").strip().lower()
    if key_text in _SENSITIVE_KEYS or any(part in key_text for part in _SENSITIVE_KEYS):
        return "***"
    return _safe_text(value)


def _format_fields(fields):
    if not fields:
        return ""
    if not isinstance(fields, dict):
        fields = {"fields": fields}
    parts = []
    for key in sorted(fields.keys()):
        value = fields[key]
        if value is None or value == "":
            continue
        parts.append(f"{key}={_safe_field_value(key, value)}")
    return " ".join(parts)


def _find_caller():
    stack = inspect.stack(context=0)
    for frame in stack[2:]:
        filename = Path(frame.filename).name
        if filename == Path(__file__).name:
            continue
        return f"{filename}:{frame.lineno} {frame.function}"
    return "-"


def append_log(
    message,
    source="",
    echo=False,
    level="INFO",
    event="",
    fields=None,
    include_callsite=None,
):
    text = str(message or "").rstrip()
    source_text = str(source or "APP").strip() or "APP"
    level_text = str(level or "INFO").strip().upper()
    event_text = str(event or "").strip()
    prefix = f"[{_now_text()}][{level_text}][{source_text}]"
    if _LOG_VERBOSE:
        prefix += f"[pid={os.getpid()}][thread={threading.current_thread().name}]"
    should_include_callsite = (
        _LOG_INCLUDE_CALLSITE if include_callsite is None else bool(include_callsite)
    )
    if should_include_callsite:
        prefix += f"[caller={_find_caller()}]"
    if event_text:
        prefix += f"[{event_text}]"

    field_text = _format_fields(fields)
    if field_text:
        line = f"{prefix} {text} {field_text}".rstrip()
    else:
        line = f"{prefix} {text}".rstrip()

    try:
        with _LOG_LOCK:
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with LOG_FILE.open("a", encoding="utf-8") as file:
                file.write(line + "\n")
    except Exception as error:
        print(f"[LOG_WRITE_FAILED] {type(error).__name__}: {error}")
        print(traceback.format_exc())

    if echo or _LOG_MIRROR_TO_CONSOLE:
        print(line)

    return line


def append_startup_environment(source="GUI"):
    append_log(
        "[APP][ENV]",
        source=source,
        fields={
            "python": sys.version.replace("\n", " "),
            "executable": sys.executable,
            "cwd": os.getcwd(),
            "platform": platform.platform(),
            "pid": os.getpid(),
            "log_file": str(LOG_FILE.resolve()),
        },
    )


def clear_log_file():
    try:
        with _LOG_LOCK:
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            LOG_FILE.write_text("", encoding="utf-8")
    except Exception as error:
        print(f"[LOG_CLEAR_FAILED] {type(error).__name__}: {error}")
        print(traceback.format_exc())


def get_log_file_path():
    return str(LOG_FILE.resolve())


def read_last_lines(path, max_lines=1000, encoding="utf-8", max_read_bytes=2 * 1024 * 1024):
    """Read at most the last ``max_lines`` from a log file without loading the whole file."""
    log_path = Path(path)
    if not log_path.exists():
        return []

    lines = deque(maxlen=max_lines)
    try:
        file_size = log_path.stat().st_size
        if file_size > max_read_bytes:
            with log_path.open("rb") as raw:
                raw.seek(max(0, file_size - max_read_bytes))
                chunk = raw.read().decode(encoding, errors="replace")
            for line in chunk.splitlines():
                lines.append(line.rstrip("\n"))
        else:
            with log_path.open("r", encoding=encoding, errors="replace") as file:
                for line in file:
                    lines.append(line.rstrip("\n"))
    except Exception as error:
        print(
            f"[LOG_READ_FAILED] path={log_path} "
            f"error_type={type(error).__name__} error={error}"
        )
        print(traceback.format_exc())
        raise

    return list(lines)
