from collections import deque
from pathlib import Path
import threading
import time
import traceback


_LOG_LOCK = threading.RLock()
LOG_FILE = Path(__file__).resolve().parent / "log.txt"


def _now_text():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


def append_log(message, source="", echo=False):
    text = str(message or "").rstrip()
    if not text:
        text = ""

    prefix = f"[{_now_text()}]"
    if source:
        prefix += f"[{source}]"

    line = f"{prefix} {text}"

    try:
        with _LOG_LOCK:
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with LOG_FILE.open("a", encoding="utf-8") as file:
                file.write(line + "\n")
    except Exception as error:
        print(f"[LOG_WRITE_FAILED] {error}")
        print(traceback.format_exc())

    if echo:
        print(line)

    return line


def clear_log_file():
    try:
        with _LOG_LOCK:
            LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            LOG_FILE.write_text("", encoding="utf-8")
    except Exception as error:
        print(f"[LOG_CLEAR_FAILED] {error}")
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
        print(f"[LOG_READ_FAILED] path={log_path} error={error}")
        print(traceback.format_exc())
        raise

    return list(lines)
