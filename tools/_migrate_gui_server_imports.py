#!/usr/bin/env python3
"""一次性：将 app/ui 内 import server 改为 from app.server import ..."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "app" / "ui"

COMMON = """
from app.server import (
    cancel_message,
    complete_gui_dispatch,
    enqueue_control_command,
    get_bridge_status,
    get_message_state,
    get_server_port,
    get_server_public_host,
    get_server_url,
    get_tm_online_summary,
    is_server_running,
    push_close_other_pages,
    push_close_page,
    push_message,
    push_open_url,
    set_debug_mode,
    set_external_gui_dispatch,
    set_log_callback,
    set_status_callback,
    start_server,
    stop_server,
)
""".strip()

EXTRA_ATTACH = "from app.server.external_api import attach_external_request_bridge\n"
EXTRA_COUNT = "from app.server.external_api import count_user_turns\n"
EXTRA_CURSOR = "from app.server.cursor_api import get_cursor_bridge_status\n"
EXTRA_IGNORED = "from app.server.tm_page_registry import _is_ignored_page\n"


def migrate_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "import server" not in text and "import server as" not in text:
        return False
    uses_attach = "attach_external_request_bridge" in text
    uses_count = "count_user_turns" in text
    uses_cursor = "get_cursor_bridge_status" in text
    uses_ignored = "_is_ignored_page" in text or "bridge_server._is_ignored_page" in text

    text = re.sub(r"^import server\s*\n", "", text, flags=re.M)
    text = re.sub(r"^import server as bridge_server\s*\n", "", text, flags=re.M)
    text = text.replace("bridge_server._is_ignored_page", "_is_ignored_page")

    imports = COMMON
    if uses_attach:
        imports = EXTRA_ATTACH + imports
    if uses_count:
        imports = EXTRA_COUNT + imports
    if uses_cursor:
        imports = EXTRA_CURSOR + imports
    if uses_ignored:
        imports = EXTRA_IGNORED + imports

    text = re.sub(r"server\.(\w+)", r"\1", text)

    if imports not in text:
        # 插在首个 from app. 之前，或文件头 docstring 之后
        m = re.search(r"^(from |import )", text, re.M)
        if m:
            text = text[: m.start()] + imports + "\n\n" + text[m.start() :]
        else:
            text = imports + "\n\n" + text

    path.write_text(text, encoding="utf-8")
    return True


def main():
    changed = []
    for path in sorted(UI.rglob("*.py")):
        if migrate_file(path):
            changed.append(path.relative_to(ROOT))
    print("migrated:", len(changed))
    for p in changed:
        print(" ", p)


if __name__ == "__main__":
    main()
