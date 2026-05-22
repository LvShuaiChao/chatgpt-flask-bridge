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
_LOG_VERBOSE = os.environ.get("CHATGPT_BRIDGE_VERBOSE_LOG", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
_LOG_MIRROR_TO_CONSOLE = os.environ.get("CHATGPT_BRIDGE_LOG_TO_CONSOLE", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
_LOG_INCLUDE_CALLSITE = os.environ.get("CHATGPT_BRIDGE_LOG_CALLSITE", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
_LOG_MIN_LEVEL = os.environ.get("CHATGPT_BRIDGE_LOG_MIN_LEVEL", "INFO").strip().upper() or "INFO"
_LOG_MAX_BYTES = 5 * 1024 * 1024
_LOG_MAX_BACKUPS = 3
_LOG_LEVEL_RANK = {"TRACE": 0, "DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
_BRIDGE_JSON_FULL_TAGS = (
    "[GUI][JSON][SEND_PAYLOAD_FULL]",
    "[BRIDGE][JSON][SERVER_TO_TM_QUEUE_FULL]",
    "[BRIDGE][JSON][TM_TO_SERVER_FULL]",
    "[BRIDGE][JSON][SERVER_TO_TM_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_REPORT_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_RECV_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_UNKNOWN_FULL]",
)

_NOISY_FILE_TAGS = (
    "[ACTION_CAPABILITY]",
    "[ACTION_DECISION]",
    "[BRIDGE][JSON][SERVER_TO_TM]",
    "[BRIDGE][JSON][TM_TO_SERVER]",
    "[BRIDGE][JSON][SERVER_TO_TM_FULL]",
    "[BRIDGE][JSON][TM_TO_SERVER_FULL]",
    "[BRIDGE][JSON][SERVER_TO_TM_QUEUE_FULL]",
    "[GUI][JSON][SEND_PAYLOAD_FULL]",
    "[BRIDGE][POLL_SUMMARY]",
    "[TM][HEARTBEAT]",
    "[TM][POLL]",
    "[TM][FOCUS_STATE]",
    "[TM_ACTIVITY][CLASSIFY]",
    "[TM_PAGE_LIST][FETCH]",
    "[TM_PAGE_LIST][NORMALIZE]",
    "[TM_PAGE_LIST][DEDUPE]",
    "[TM_PAGE_LIST][SUMMARY]",
    "[TM_PAGE_LIST][SUMMARY_THROTTLED]",
    "[STATUS_APPLY]",
    "[BIND_STATE]",
    "[UPLOAD_CAPABILITY]",
    "[BRIDGE][POLL]",
    "[HTTP][REQUEST]",
    "[HTTP][RESPONSE]",
    "[PAGE_ACTION][DECIDE]",
    "[PAGE_ACTION][DECISION]",
    "[PAGE_LIVENESS][STATE]",
    "[PAGE_RELATION_DISPLAY]",
    "[PERF][STATUS_APPLY]",
    "[STATUS_APPLY][STEP]",
    "[STATUS_APPLY][SKIP]",
    "[SYNC][BOUND_TARGET_CHECK]",
    "[SYNC][TARGET_RESOLVE]",
    "[SYNC][TARGET_SELECTED]",
    "[TM_SELECTOR]",
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


def get_log_runtime_options():
    return {
        "verbose": _LOG_VERBOSE,
        "mirror_to_console": _LOG_MIRROR_TO_CONSOLE,
        "include_callsite": _LOG_INCLUDE_CALLSITE,
        "min_level": _LOG_MIN_LEVEL,
    }


def set_log_min_level(level):
    global _LOG_MIN_LEVEL
    text = str(level or "INFO").strip().upper()
    _LOG_MIN_LEVEL = text if text in _LOG_LEVEL_RANK else "INFO"


def _normalize_log_level(level):
    text = str(level or "INFO").strip().upper()
    if text == "WARN":
        return "WARNING"
    if text == "CRITICAL":
        return "ERROR"
    return text if text in _LOG_LEVEL_RANK else "INFO"


def _effective_log_level(text, level):
    level_text = _normalize_log_level(level)
    if _LOG_LEVEL_RANK.get(level_text, 20) >= _LOG_LEVEL_RANK["WARNING"]:
        return level_text
    try:
        from app.utils.gui_logging import adjust_level_for_message, infer_level_from_message

        inferred = _normalize_log_level(infer_level_from_message(text))
        if _LOG_LEVEL_RANK.get(inferred, 20) >= _LOG_LEVEL_RANK["WARNING"]:
            return inferred
        if level_text in ("TRACE", "DEBUG"):
            return level_text
        return _normalize_log_level(adjust_level_for_message(text, inferred or level_text))
    except Exception:
        return level_text


def _should_write_file(text, level, *, force=False):
    if force:
        return True
    if any(tag in text for tag in _BRIDGE_JSON_FULL_TAGS):
        return True
    level_text = _normalize_log_level(level)
    if _LOG_LEVEL_RANK.get(level_text, 20) < _LOG_LEVEL_RANK.get(_LOG_MIN_LEVEL, 20):
        return False
    if level_text in ("TRACE", "DEBUG") and any(tag in text for tag in _NOISY_FILE_TAGS):
        return False
    return True


def _rotate_log_if_needed(next_line_bytes):
    try:
        if _LOG_MAX_BYTES <= 0 or not LOG_FILE.exists():
            return
        if LOG_FILE.stat().st_size + int(next_line_bytes or 0) <= _LOG_MAX_BYTES:
            return
        for idx in range(int(_LOG_MAX_BACKUPS or 0), 0, -1):
            src = LOG_FILE.with_name(f"{LOG_FILE.name}.{idx}")
            dst = LOG_FILE.with_name(f"{LOG_FILE.name}.{idx + 1}")
            if idx >= int(_LOG_MAX_BACKUPS or 0) and src.exists():
                src.unlink()
            elif src.exists():
                src.replace(dst)
        LOG_FILE.replace(LOG_FILE.with_name(f"{LOG_FILE.name}.1"))
    except Exception as error:
        print(f"[LOG_ROTATE_FAILED] {type(error).__name__}: {error}")


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
    force=False,
):
    text = str(message or "").rstrip()
    level_text = _effective_log_level(text, level)
    if not _should_write_file(text, level_text, force=force):
        return ""
    source_text = str(source or "APP").strip() or "APP"
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
            _rotate_log_if_needed(len((line + "\n").encode("utf-8")))
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
