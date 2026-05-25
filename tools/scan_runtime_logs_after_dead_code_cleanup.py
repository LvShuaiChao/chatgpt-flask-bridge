"""Read-only scan of runtime logs for dead-code cleanup regression signals."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LOG_DIRS = [
    ROOT / "logs",
    ROOT / "runtime" / "logs",
]

# Exception class names: only on non-bridge-json lines (poll JSON may embed them in page_title).
EXCEPTION_CLASS_PATTERNS = [
    "ImportError",
    "AttributeError",
    "NameError",
    "KeyError",
]

ERROR_PATTERNS = [
    "[PYTHON_UNCAUGHT_EXCEPTION]",
    "[UI_BIND][ERROR]",
    "[ROUTE][ERROR]",
    "[BRIDGE][ERROR]",
    "[SYNC][ERROR]",
    "[CONTROL_COMMAND][ERROR]",
    "[DEAD_CODE_REGRESSION][FAILED]",
    "[MUST_KEEP_SYMBOLS][FAILED]",
]

WARNING_PATTERNS = [
    "legacy fields still exist before save",
    "[DEPRECATED_HIT]",
    "[MIGRATION_HIT]",
    "[COMPAT_HIT]",
]


def iter_log_files():
    for log_dir in LOG_DIRS:
        if not log_dir.exists():
            continue

        for path in log_dir.rglob("*"):
            if path.is_file() and path.suffix.lower() in {".log", ".txt"}:
                yield path


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def main() -> int:
    print("[DEAD_CODE_LOG_SCAN][START]")

    log_files = list(iter_log_files())
    if not log_files:
        print("[DEAD_CODE_LOG_SCAN][NO_LOG_FILES]")
        return 0

    error_hits = []
    warning_hits = []

    for path in log_files:
        text = path.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            is_bridge_json_line = stripped.startswith("json=")

            for pattern in ERROR_PATTERNS:
                if pattern in line:
                    error_hits.append((path, idx, pattern, stripped))

            if not is_bridge_json_line:
                for pattern in EXCEPTION_CLASS_PATTERNS:
                    if pattern in line:
                        error_hits.append((path, idx, pattern, stripped))

            for pattern in WARNING_PATTERNS:
                if pattern in line:
                    warning_hits.append((path, idx, pattern, line.strip()))

    if warning_hits:
        print("[DEAD_CODE_LOG_SCAN][WARNINGS]")
        for path, idx, pattern, line in warning_hits:
            print(f"- {rel(path)}:{idx} pattern={pattern} line={line[:240]}")

    if error_hits:
        print("[DEAD_CODE_LOG_SCAN][FAILED]")
        for path, idx, pattern, line in error_hits:
            print(f"- {rel(path)}:{idx} pattern={pattern} line={line[:240]}")
        return 1

    print("[DEAD_CODE_LOG_SCAN][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
