from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REPLACEMENTS = [
    ("host._last_bridge_status", "host._bridge_ui.last_bridge_status"),
    ("assert host._last_bridge_status is", "assert host._bridge_ui.last_bridge_status is"),
    ("_last_bridge_status = {}", "_bridge_ui = None  # set in __init__"),
]

IMPORT_LINE = "from app.ui.main_window_state import attach_main_window_states\n"

INIT_SNIPPET = "        attach_main_window_states(self)\n"


def ensure_import(text: str) -> str:
    if "attach_main_window_states" in text:
        return text
    if "from app.ui.main_window_state import" in text:
        if "attach_main_window_states" not in text:
            text = text.replace(
                "from app.ui.main_window_state import",
                "from app.ui.main_window_state import attach_main_window_states,",
                1,
            )
        return text
    # insert after first block of imports
    lines = text.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("import ") or line.startswith("from "):
            insert_at = i + 1
        elif insert_at and line.strip() and not line.startswith("#"):
            break
    lines.insert(insert_at, IMPORT_LINE)
    return "".join(lines)


def ensure_init_attach(text: str, class_name: str) -> str:
    marker = f"class {class_name}"
    if marker not in text or "attach_main_window_states(self)" in text:
        return text
    idx = text.find(marker)
    init_idx = text.find("def __init__", idx)
    if init_idx < 0:
        return text
    body_start = text.find("\n", init_idx) + 1
    # find first line of body
    line_end = text.find("\n", body_start) + 1
    first_body = text[body_start:line_end]
    indent = first_body[: len(first_body) - len(first_body.lstrip())]
    snippet = f"{indent}attach_main_window_states(self)\n"
    if snippet.strip() in text:
        return text
    return text[:body_start] + snippet + text[body_start:]


def main():
    tests = ROOT / "tests"
    for path in tests.rglob("*.py"):
        raw = path.read_text(encoding="utf-8")
        if "_bridge_ui" not in raw and "_last_bridge_status" not in raw:
            continue
        new = raw
        for old, repl in REPLACEMENTS:
            new = new.replace(old, repl)
        if "_bridge_ui.last_bridge_status" in new and "attach_main_window_states" not in new:
            new = ensure_import(new)
            for line in new.splitlines():
                if line.startswith("class "):
                    cname = line.split("(")[0].split(":")[0].replace("class ", "").strip()
                    if "def __init__" in new[new.find(line) : new.find(line) + 800]:
                        new = ensure_init_attach(new, cname)
        if new != raw:
            path.write_text(new, encoding="utf-8")
            print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
