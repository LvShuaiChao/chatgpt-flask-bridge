# tools/check_dead_code_ignore_manifest.py

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IGNORE_MANIFEST = ROOT / "docs" / "dead_code_ignore_manifest.json"

REQUIRED_TOP_KEYS = {
    "version",
    "purpose",
    "rules",
}

REQUIRED_RULE_KEYS = {
    "id",
    "path",
    "symbol",
    "scanner",
    "reason",
    "expires_after",
    "owner",
}


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def main() -> int:
    print("[DEAD_CODE_IGNORE_MANIFEST][START]")

    if not IGNORE_MANIFEST.exists():
        print(f"[DEAD_CODE_IGNORE_MANIFEST][FAILED] missing {IGNORE_MANIFEST}")
        return 1

    try:
        data = json.loads(IGNORE_MANIFEST.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[DEAD_CODE_IGNORE_MANIFEST][FAILED] invalid json: {exc}")
        return 1

    errors: list[str] = []

    if not isinstance(data, dict):
        errors.append("manifest root must be object")
    else:
        for key in sorted(REQUIRED_TOP_KEYS):
            if key not in data:
                errors.append(f"missing top-level key: {key}")

    rules = data.get("rules") if isinstance(data, dict) else None
    if not isinstance(rules, list):
        errors.append("rules must be list")
        rules = []

    seen_ids: set[str] = set()

    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            errors.append(f"rules[{index}] must be object")
            continue

        for key in sorted(REQUIRED_RULE_KEYS):
            if key not in rule:
                errors.append(f"rules[{index}] missing {key}")

        rule_id = str(rule.get("id", "")).strip()
        if not rule_id:
            errors.append(f"rules[{index}] id is empty")
        elif rule_id in seen_ids:
            errors.append(f"duplicate rule id: {rule_id}")
        else:
            seen_ids.add(rule_id)

        path_text = str(rule.get("path", "")).strip()
        symbol = str(rule.get("symbol", "")).strip()
        reason = str(rule.get("reason", "")).strip()
        owner = str(rule.get("owner", "")).strip()
        expires_after = str(rule.get("expires_after", "")).strip()

        if not reason:
            errors.append(f"rules[{index}] reason is empty")

        if not owner:
            errors.append(f"rules[{index}] owner is empty")

        if not expires_after:
            errors.append(f"rules[{index}] expires_after is empty")

        if path_text and "*" not in path_text:
            path = ROOT / path_text
            if not path.exists():
                errors.append(f"rules[{index}] path missing: {path_text}")
            else:
                text = read_text(path)
                if (
                    symbol
                    and symbol != "generated userscript artifact"
                    and symbol not in text
                ):
                    errors.append(
                        f"rules[{index}] symbol not found in path: "
                        f"symbol={symbol} path={path_text}"
                    )

    if errors:
        print("[DEAD_CODE_IGNORE_MANIFEST][FAILED]")
        for err in errors:
            print(f"- {err}")
        return 1

    print("[DEAD_CODE_IGNORE_MANIFEST][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
