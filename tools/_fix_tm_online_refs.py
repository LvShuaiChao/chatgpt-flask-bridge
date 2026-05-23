from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "app" / "ui"

for path in UI.rglob("*.py"):
    text = path.read_text(encoding="utf-8")
    orig = text
    text = text.replace('status.get("tampermonkey_online")', "bridge_status_online(status)")
    text = text.replace('full_status.get("tampermonkey_online")', "bridge_status_online(full_status)")
    if "bridge_status_online(" in text and "from app.utils.page_status import bridge_status_online" not in text:
        lines = text.splitlines()
        insert_at = 0
        for i, line in enumerate(lines):
            if line.startswith(("from app.", "import app.")):
                insert_at = i + 1
        if insert_at:
            lines.insert(insert_at, "from app.utils.page_status import bridge_status_online")
            text = "\n".join(lines) + ("\n" if text.endswith("\n") else "")
    if text != orig:
        path.write_text(text, encoding="utf-8")
        print(path.relative_to(ROOT))
