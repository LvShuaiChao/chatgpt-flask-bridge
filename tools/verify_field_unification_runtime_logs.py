"""Headless runtime log verification for field-unification closure.

Exercises real page_sync logging code paths (no GUI). For full GUI+ChatGPT
smoke, start GUI.py and confirm the same patterns in runtime/logs/log.txt.
"""
from __future__ import annotations

import io
import logging
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_PYTHON = [
    r"\[PAGE_SYNC_SNAPSHOT\]\[PARSE\] page_display_id=",
    r"\[PAGE_SYNC_SNAPSHOT\]\[RESULT\] page_display_id=.*can_accept_input=.*can_send_now=",
    r"\[PAGE_SYNC_RUNNER\]\[START\] page_display_id=",
    r"\[PAGE_SYNC_RUNNER\]\[UPDATE\] page_display_id=",
    r"\[PAGE_SYNC_RUNNER\]\[FINISH\] page_display_id=",
    r"\[PAGE_SYNC_DIAG\]\[RESULT\] .*can_accept_input=.*can_send_now=.*send_decision=.*legacy_inputable=",
]

FORBIDDEN_PYTHON = [
    r"\[PAGE_SYNC_SNAPSHOT\]\[PARSE\] page_id=",
    r"\[PAGE_SYNC_SNAPSHOT\]\[RESULT\] page_id=",
    r"inputable=%s sendable=%s",
    r"\[PAGE_SYNC_RUNNER\]\[START\] page_id=",
    r"\[PAGE_SYNC_RUNNER\]\[UPDATE\] page_id=",
    r"\[PAGE_SYNC_RUNNER\]\[FINISH\] page_id=",
]

REQUIRED_SOURCE = [
    (ROOT / "app/ui/mixins/page_sync_mixin.py", r"reason_code=\{\}.*legacy_block_reason="),
    (
        ROOT / "chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js",
        r"unifiedReplyText:.*statusReplyText:",
    ),
]

FORBIDDEN_SOURCE = [
    (ROOT / "app/ui/mixins/page_sync_mixin.py", r'block_reason=\{\}"\.format\(block_reason'),
]


def _capture_page_sync_logs() -> str:
    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    handler.setFormatter(logging.Formatter("%(message)s"))
    for name in (
        "app.ui.page_sync.page_snapshot",
        "app.ui.page_sync.sync_runner",
        "app.ui.page_sync.diagnostics",
    ):
        log = logging.getLogger(name)
        log.addHandler(handler)
        log.setLevel(logging.INFO)

    from app.ui.page_sync.sync_runner import run_page_sync_update

    payload = {
        "page_display_id": "verify-display-1",
        "page_instance_id": "verify-instance-1",
        "conversation_id": "verify-conv-1",
        "online": True,
        "response_state": "idle",
        "can_accept_input": True,
        "can_send_now": True,
        "conversation_syncable": True,
        "bridge_connected": True,
    }
    run_page_sync_update(payload, bridge_connected=True)
    return buffer.getvalue()


def _check_patterns(text: str, required: list[str], forbidden: list[str], label: str) -> list[str]:
    failures: list[str] = []
    for pattern in required:
        if not re.search(pattern, text):
            failures.append(f"[{label}][MISSING] pattern={pattern!r}")
    for pattern in forbidden:
        if re.search(pattern, text):
            failures.append(f"[{label}][FORBIDDEN] pattern={pattern!r}")
    return failures


def main() -> int:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    failures: list[str] = []

    captured = _capture_page_sync_logs()
    print("[FIELD_UNIFICATION_RUNTIME][CAPTURED_LOGS]")
    print(captured.rstrip())
    failures.extend(_check_patterns(captured, REQUIRED_PYTHON, FORBIDDEN_PYTHON, "PYTHON_RUNTIME"))

    for path, pattern in REQUIRED_SOURCE:
        text = path.read_text(encoding="utf-8", errors="replace")
        if not re.search(pattern, text, re.DOTALL):
            failures.append(
                f"[SOURCE_TEMPLATE][MISSING] path={path.relative_to(ROOT)} pattern={pattern!r}"
            )

    for path, pattern in FORBIDDEN_SOURCE:
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(pattern, text):
            failures.append(
                f"[SOURCE_TEMPLATE][FORBIDDEN] path={path.relative_to(ROOT)} pattern={pattern!r}"
            )

    if failures:
        print(f"[FIELD_UNIFICATION_RUNTIME][SUMMARY] status=failed count={len(failures)}")
        for line in failures:
            print(line)
        return 1

    print("[FIELD_UNIFICATION_RUNTIME][SUMMARY] status=ok")
    print(
        "[FIELD_UNIFICATION_RUNTIME][NOTE] "
        "GUI+ChatGPT full smoke: start GUI.py, open ChatGPT, trigger sync/button refresh; "
        "confirm runtime/logs/log.txt contains the same standard fields."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
