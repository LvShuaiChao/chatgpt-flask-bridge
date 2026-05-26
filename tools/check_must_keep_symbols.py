"""Verify symbols that must not be removed during dead-code cleanup."""
from __future__ import annotations

from pathlib import Path

from _common import PROJECT_ROOT as ROOT, read_text_safe as read_text

MUST_KEEP = [
    {
        "path": "app/utils/legacy_cleanup.py",
        "symbols": [
            "LEGACY_FIELD_NAMES",
            "assert_no_legacy_fields",
            "reject_legacy_fields",
        ],
    },
    {
        "path": "app/utils/bridge_payload.py",
        "symbols": [
            "validate_outbound_queue_message",
            "assert_no_legacy_fields",
        ],
    },
]

# Framework hooks / Qt-Werkzeug callbacks (batch 5 guardrails).
FRAMEWORK_MUST_KEEP = [
    {"path": "app/server/__init__.py", "symbols": ["def __getattr__", "def __dir__"]},
    {"path": "app/server/runtime_state.py", "symbols": ["def log_request"]},
    {"path": "app/ui/main_window.py", "symbols": ["def closeEvent"]},
    {"path": "app/ui/widgets/no_wheel_combo_box.py", "symbols": ["def wheelEvent"]},
    {
        "path": "chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js",
        "symbols": ["tickWaitingReplyOrSendOpportunity"],
    },
]


def check_group(label: str, items: list[dict]) -> list[str]:
    errors: list[str] = []
    for item in items:
        path = ROOT / item["path"]
        text = read_text(path)

        if not text:
            errors.append(f"{item['path']} missing")
            continue

        for symbol in item["symbols"]:
            if symbol not in text:
                errors.append(f"{item['path']} missing symbol {symbol} ({label})")
    return errors


def main() -> int:
    errors: list[str] = []
    errors.extend(check_group("legacy_guard", MUST_KEEP))
    errors.extend(check_group("framework_hook", FRAMEWORK_MUST_KEEP))

    if errors:
        print("[MUST_KEEP_SYMBOLS][FAILED]")
        for err in errors:
            print(f"- {err}")
        return 1

    print("[MUST_KEEP_SYMBOLS][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
