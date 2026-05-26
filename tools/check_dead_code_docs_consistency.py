# tools/check_dead_code_docs_consistency.py

from __future__ import annotations

import json
from pathlib import Path

from _common import PROJECT_ROOT as ROOT, read_text_safe as read_text

RULES_PATH = ROOT / "docs" / "dead_code_cleanup_rules.md"
REPORT_PATH = ROOT / "docs" / "dead_code_cleanup_report.md"
MANIFEST_PATH = ROOT / "docs" / "dead_code_cleanup_manifest.json"

REQUIRED_TEXT_IN_RULES = [
    "Qt 信号槽",
    "Flask route",
    "fetch",
    "getattr",
    "setattr",
    "validate",
    "assert",
    "reject",
    "sanitize",
    "normalize",
    "migrate",
    "from __future__ import annotations",
    "client.user.js",
    "dist/**",
    "build/**",
    "runtime/**",
    "logs/**",
]

REQUIRED_TEXT_IN_REPORT = [
    'job.get("status") == "cancelled"',
    'j.get("status") == "waiting_chatgpt_reply"',
    "DEFAULT_AUTO_CONFIG",
    "remote_binding_enabled(remote)",
    "persist_qsettings_last_url()",
    "legacy_cleanup.py",
    "assert_no_legacy_fields",
    "reject_legacy_fields",
    "validate_outbound_queue_message",
    "from __future__ import annotations",
    "client.user.js",
]

REQUIRED_MANIFEST_SYMBOLS = [
    'job.get("status") == "cancelled"',
    'j.get("status") == "waiting_chatgpt_reply"',
    "DEFAULT_AUTO_CONFIG",
    "remote_binding_enabled(remote)",
    "status_chip_text(prefix, state)",
    "LEGACY_FIELD_NAMES",
    "assert_no_legacy_fields",
    "reject_legacy_fields",
    "validate_outbound_queue_message",
    "generated userscript artifact",
]

REQUIRED_MANIFEST_EXCLUDES = [
    "client.user.js",
    "dist/client.user.js",
    "dist/**",
    "build/**",
    "runtime/**",
    "logs/**",
    "__pycache__/**",
    ".venv/**",
    "venv/**",
]


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"missing manifest: {MANIFEST_PATH}")

    text = MANIFEST_PATH.read_text(encoding="utf-8")
    data = json.loads(text)

    if not isinstance(data, dict):
        raise ValueError("manifest root must be object")

    return data


def collect_strings(data: object) -> list[str]:
    out: list[str] = []
    if isinstance(data, dict):
        for value in data.values():
            out.extend(collect_strings(value))
    elif isinstance(data, list):
        for item in data:
            out.extend(collect_strings(item))
    elif isinstance(data, str):
        out.append(data)
    return out


def manifest_search_text(data: dict) -> str:
    """Join manifest string values so symbol checks match parsed JSON, not dumps escaping."""
    return "\n".join(collect_strings(data))


def main() -> int:
    print("[DEAD_CODE_DOCS_CONSISTENCY][START]")

    errors: list[str] = []

    rules_text = read_text(RULES_PATH)
    report_text = read_text(REPORT_PATH)

    if not rules_text:
        errors.append(f"missing or empty: {RULES_PATH.relative_to(ROOT)}")

    if not report_text:
        errors.append(f"missing or empty: {REPORT_PATH.relative_to(ROOT)}")

    try:
        manifest = load_manifest()
        manifest_text = manifest_search_text(manifest)
    except Exception as exc:
        errors.append(f"manifest load failed: {exc}")
        manifest = {}
        manifest_text = ""

    for item in REQUIRED_TEXT_IN_RULES:
        if item not in rules_text:
            errors.append(f"rules missing required text: {item}")

    for item in REQUIRED_TEXT_IN_REPORT:
        if item not in report_text:
            errors.append(f"report missing required text: {item}")

    for item in REQUIRED_MANIFEST_SYMBOLS:
        if item not in manifest_text:
            errors.append(f"manifest missing required symbol/text: {item}")

    for item in REQUIRED_MANIFEST_EXCLUDES:
        if item not in manifest_text:
            errors.append(f"manifest missing exclude path: {item}")

    if errors:
        print("[DEAD_CODE_DOCS_CONSISTENCY][FAILED]")
        for err in errors:
            print(f"- {err}")
        return 1

    print("[DEAD_CODE_DOCS_CONSISTENCY][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
