"""Bulk UI field slim replacements."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "app" / "ui" / "mixins"


def patch_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    orig = text

    # send_requestable -> send_decision check patterns
    text = re.sub(
        r"bool\(\s*profile\.get\(\"send_requestable\"\)\s*\)",
        '(profile.get("send_decision") in ("allowed", "queued"))',
        text,
    )
    text = re.sub(
        r"bool\(\s*_field\(\"send_requestable\",\s*False\)\s*\)",
        '(_field("send_decision", "blocked") in ("allowed", "queued"))',
        text,
    )
    text = re.sub(
        r"snap\.get\(\"send_requestable\"\)",
        '(snap.get("send_decision") in ("allowed", "queued"))',
        text,
    )
    text = re.sub(
        r"\"send_requestable\":\s*False",
        '"send_decision": "blocked"',
        text,
    )
    text = re.sub(
        r"\"send_requestable\":\s*bool\(send_target\.get\(\"ok\"\)\)",
        '"send_decision": "allowed" if send_target.get("ok") else "blocked"',
        text,
    )
    text = re.sub(
        r"\"conversation_syncable\":\s*bool\(sync_target\.get\(\"ok\"\)\)",
        '"sync_ok": bool(sync_target.get("ok"))',
        text,
    )
    text = re.sub(
        r"if snap\.get\(\"conversation_syncable\"\):",
        'if snap.get("sync_ok"):',
        text,
    )
    text = re.sub(
        r"\"send_now_available\":\s*snap\.get\(\"send_requestable\"\)",
        '"send_decision": snap.get("send_decision") or ("allowed" if snap.get("sync_ok") else "blocked")',
        text,
    )
    text = re.sub(
        r"profile\.get\(\"conversation_syncable\"\)",
        'profile.get("sync_ok")',
        text,
    )
    text = re.sub(
        r"page\.get\(\"conversation_syncable\"\)\s*is\s*True",
        '(page.get("send_decision") == "allowed" or can_sync_conversation(page))',
        text,
    )

    if text != orig:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main() -> None:
    changed = []
    for path in UI.glob("*.py"):
        if patch_file(path):
            changed.append(path.name)
    print("patched:", ", ".join(changed) or "(none)")


if __name__ == "__main__":
    main()
