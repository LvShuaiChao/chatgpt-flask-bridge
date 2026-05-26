# tools/check_dead_code_manifest.py

from __future__ import annotations

import json
from pathlib import Path

from _common import PROJECT_ROOT as ROOT, read_text_safe as read_text

MANIFEST_PATH = ROOT / "docs" / "dead_code_cleanup_manifest.json"

REQUIRED_TOP_KEYS = {
    "version",
    "project",
    "purpose",
    "categories",
}

REQUIRED_CATEGORIES = {
    "replace_then_remove",
    "observe_before_remove",
    "must_keep",
    "exclude_from_source_level_cleanup",
}


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"manifest not found: {MANIFEST_PATH}")

    text = MANIFEST_PATH.read_text(encoding="utf-8")
    data = json.loads(text)

    if not isinstance(data, dict):
        raise ValueError("manifest root must be object")

    return data


def validate_top_level(data: dict, errors: list[str]) -> None:
    for key in sorted(REQUIRED_TOP_KEYS):
        if key not in data:
            errors.append(f"missing top-level key: {key}")

    categories = data.get("categories")
    if not isinstance(categories, dict):
        errors.append("categories must be object")
        return

    for key in sorted(REQUIRED_CATEGORIES):
        if key not in categories:
            errors.append(f"missing category: {key}")


def validate_replace_then_remove(items, errors: list[str]) -> None:
    if not isinstance(items, list):
        errors.append("replace_then_remove must be list")
        return

    required = {"path", "symbol", "replacement", "reason", "risk", "required_tests"}

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"replace_then_remove[{index}] must be object")
            continue

        for key in sorted(required):
            if key not in item:
                errors.append(f"replace_then_remove[{index}] missing {key}")

        if "required_tests" in item and not isinstance(item["required_tests"], list):
            errors.append(f"replace_then_remove[{index}].required_tests must be list")


def validate_observe_before_remove(items, errors: list[str]) -> None:
    if not isinstance(items, list):
        errors.append("observe_before_remove must be list")
        return

    required = {"path", "symbol", "replacement", "reason", "risk", "remove_after"}

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"observe_before_remove[{index}] must be object")
            continue

        for key in sorted(required):
            if key not in item:
                errors.append(f"observe_before_remove[{index}] missing {key}")


def validate_must_keep(items, errors: list[str]) -> None:
    if not isinstance(items, list):
        errors.append("must_keep must be list")
        return

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"must_keep[{index}] must be object")
            continue

        path_text = item.get("path")
        symbols = item.get("symbols")

        if not path_text:
            errors.append(f"must_keep[{index}] missing path")
            continue

        if not isinstance(symbols, list):
            errors.append(f"must_keep[{index}] symbols must be list")
            continue

        reason_text = (item.get("reason") or "").lower()
        allow_empty_symbols = "package marker" in reason_text
        if not symbols and not allow_empty_symbols:
            errors.append(f"must_keep[{index}] symbols must be non-empty list")
            continue
        if not symbols:
            continue

        if "*" in path_text:
            continue

        path = ROOT / path_text
        text = read_text(path)

        if not path.exists():
            errors.append(f"must_keep[{index}] file missing: {path_text}")
            continue

        for symbol in symbols:
            if symbol == "generated userscript artifact":
                continue

            if symbol not in text:
                errors.append(f"must_keep[{index}] missing symbol {symbol} in {path_text}")


def validate_excludes(items, errors: list[str]) -> None:
    if not isinstance(items, list):
        errors.append("exclude_from_source_level_cleanup must be list")
        return

    for index, item in enumerate(items):
        if not isinstance(item, str) or not item.strip():
            errors.append(f"exclude_from_source_level_cleanup[{index}] must be non-empty string")


def main() -> int:
    print("[DEAD_CODE_MANIFEST][START]")

    errors = []

    try:
        data = load_manifest()
    except Exception as exc:
        print(f"[DEAD_CODE_MANIFEST][FAILED] {exc}")
        return 1

    validate_top_level(data, errors)

    categories = data.get("categories") or {}
    validate_replace_then_remove(categories.get("replace_then_remove"), errors)
    validate_observe_before_remove(categories.get("observe_before_remove"), errors)
    validate_must_keep(categories.get("must_keep"), errors)
    validate_excludes(categories.get("exclude_from_source_level_cleanup"), errors)

    if errors:
        print("[DEAD_CODE_MANIFEST][FAILED]")
        for err in errors:
            print(f"- {err}")
        return 1

    print("[DEAD_CODE_MANIFEST][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
