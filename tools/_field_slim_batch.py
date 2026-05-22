"""一次性批量替换 enabled/binding 等旧字段（勿重复运行）。"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"

IMPORT_LINE = "from app.models import remote_binding_active\n"

REPLACEMENTS = [
    (r"remote\.get\(\"enabled\"\)", "remote_binding_active(remote)"),
    (r"remote_norm\.get\(\"enabled\"\)", "remote_binding_active(remote_norm)"),
    (r"remote_after\.get\(\"enabled\"\)", "remote_binding_active(remote_after)"),
    (r"remote_bind\.get\(\"enabled\"\)", "remote_binding_active(remote_bind)"),
    (r"remote_early\.get\(\"enabled\"\)", "remote_binding_active(remote_early)"),
    (r"binding\.get\(\"enabled\"\)", "remote_binding_active(binding)"),
    (r"bool\(remote\.get\(\"enabled\"\)\)", "remote_binding_active(remote)"),
    (r"not remote\.get\(\"enabled\"\)", "not remote_binding_active(remote)"),
]

SKIP = {"models.py", "bind_runtime.py", "_field_slim_batch.py"}


def ensure_import(text: str, filepath: Path) -> str:
    if "remote_binding_active" not in text:
        return text
    if "from app.models import remote_binding_active" in text:
        return text
    if "from app.models import" in text:
        return re.sub(
            r"(from app\.models import[^\n]+\n)",
            lambda m: m.group(1)
            + ("    remote_binding_active,\n" if "remote_binding_active" not in m.group(1) else "")
            if "remote_binding_active" not in text
            else m.group(1),
            text,
            count=1,
        )
    lines = text.splitlines()
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("from app.") or line.startswith("import "):
            insert_at = i + 1
    lines.insert(insert_at, "from app.models import remote_binding_active")
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def patch_file(path: Path) -> bool:
    if path.name in SKIP:
        return False
    text = path.read_text(encoding="utf-8")
    orig = text
    for pattern, repl in REPLACEMENTS:
        text = re.sub(pattern, repl, text)
    text = re.sub(r'\s*"enabled"\s*:\s*True,?\n', "\n", text)
    text = re.sub(r'\s*"enabled"\s*:\s*False,?\n', "\n", text)
    text = re.sub(r'\s*enabled=False,?\n', "\n", text)
    if text != orig:
        text = ensure_import(text, path)
        path.write_text(text, encoding="utf-8")
        print(f"patched {path.relative_to(ROOT)}")
        return True
    return False


def main():
    changed = 0
    for path in sorted(APP.rglob("*.py")):
        if patch_file(path):
            changed += 1
    print(f"done, {changed} files")


if __name__ == "__main__":
    main()
