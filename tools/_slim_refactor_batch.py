#!/usr/bin/env python3
"""One-shot batch refactor for slim-down pass."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# --- tm_page_registry.py ---
TM = ROOT / "app" / "server" / "tm_page_registry.py"
text = TM.read_text(encoding="utf-8")
text = text.replace(
    'from app.server.session_bindings import clear_session_binding, gc_orphan_session_bindings\n',
    "",
)
text = text.replace("st._tampermonkey_clients", "st._tampermonkey_pages")
text = text.replace("tampermonkey_last_seen", "_removed_tampermonkey_last_seen")
text = text.replace("tampermonkey_client_id", "_removed_tampermonkey_client_id")
text = text.replace("tampermonkey_page_url", "_removed_tampermonkey_page_url")
# Fix mistaken replacements in comments - revert _removed if any
for old in ("_removed_tampermonkey_last_seen", "_removed_tampermonkey_client_id", "_removed_tampermonkey_page_url"):
    text = text.replace(old, "")

# Remove bound_session_id blocks
text = re.sub(
    r"\n\ndef _clear_bound_session_on_registry[\s\S]*?(?=\n\ndef _pathname_from_url)",
    "\n",
    text,
    count=1,
)
text = text.replace('"bound_session_id": info.get("bound_session_id") or "",\n                ', "")
text = text.replace('"bound_session_id": "",\n            ', "")
text = text.replace('"bind_state_source": "session.remote_chatgpt",\n                ', "")

# _touch: use pages only
old_touch_start = "    entry = st._tampermonkey_pages.setdefault("
if "entry = st._tampermonkey_pages.setdefault(" not in text:
    text = text.replace(
        "    entry = st._tampermonkey_pages.setdefault(\n        client_id,",
        "    page_key = _page_registry_key(client_id, page_instance_id)\n    entry = st._tampermonkey_pages.setdefault(\n        page_key,",
        1,
    )
# Remove global client id updates at end of _touch
text = re.sub(
    r"\n    if not ignored:\n        st\.tampermonkey_last_seen = now\n        st\.tampermonkey_client_id = client_id\n        st\.tampermonkey_page_url = \(\n            page_url or entry\.get\(\"url\"\) or st\.tampermonkey_page_url\n        \)",
    "",
    text,
    count=1,
)
text = text.replace("    _sync_tampermonkey_page_registry(entry)\n", "")

# _snapshot: pages only
text = text.replace(
    """    source_entries = []
    if st._tampermonkey_pages:
        source_entries = list(st._tampermonkey_pages.items())
    else:
        source_entries = list(st._tampermonkey_pages.items())""",
    "    source_entries = list(st._tampermonkey_pages.items())",
)

# _iter_page_registry_entries
text = text.replace(
    """def _iter_page_registry_entries():
    \"\"\"页面注册表条目（优先 st._tampermonkey_pages，回退 st._tampermonkey_pages）。\"\"\"
    with st._state_lock:
        if st._tampermonkey_pages:
            return [dict(info) for info in st._tampermonkey_pages.values()]
        return [dict(info) for info in st._tampermonkey_pages.values()]""",
    """def _iter_page_registry_entries():
    \"\"\"页面注册表条目（st._tampermonkey_pages）。\"\"\"
    with st._state_lock:
        return [dict(info) for info in st._tampermonkey_pages.values()]""",
)

# get_tm_online_summary fallback branch
text = text.replace(
    """            if st._tampermonkey_pages:
                all_entries = [
                    ((info.get("client_id") or "").strip(), info)
                    for info in st._tampermonkey_pages.values()
                    if (info.get("client_id") or "").strip()
                ]
            else:
                all_entries = list(st._tampermonkey_pages.items())""",
    """            all_entries = [
                ((info.get("client_id") or "").strip(), info)
                for info in st._tampermonkey_pages.values()
                if (info.get("client_id") or "").strip()
            ]""",
)

# _tm_registry_counts
text = text.replace(
    """    with st._state_lock:
        if st._tampermonkey_pages:
            entries = [dict(info) for info in st._tampermonkey_pages.values()]
        else:
            entries = [dict(info) for info in st._tampermonkey_pages.values()]""",
    """    with st._state_lock:
        entries = [dict(info) for info in st._tampermonkey_pages.values()]""",
)

# poll known check
text = text.replace(
    "known = key in st._tampermonkey_pages or client_id in st._tampermonkey_pages",
    "known = key in st._tampermonkey_pages",
)

# _register_bridge_client_report entry lookup
text = text.replace(
    "entry = st._tampermonkey_pages.get(page_key) or st._tampermonkey_pages.get(client_id)",
    "entry = st._tampermonkey_pages.get(page_key)",
)

# _registry_entry_for_client - remove clients.get fallback at end
text = re.sub(
    r"\n        entry = st\._tampermonkey_pages\.get\(client_id\)\n        return dict\(entry\) if entry else \{\}",
    "\n        return {}",
    text,
)

TM.write_text(text, encoding="utf-8")

# --- page_snapshot.py ---
PS = ROOT / "app" / "utils" / "page_snapshot.py"
pt = PS.read_text(encoding="utf-8")
pt = pt.replace("tampermonkey_client_id", "")
pt = pt.replace('f"tm_id={status.get("") or ""}",\n        ', "")
pt = re.sub(r'\s*f"tm_id=\{[^}]+\}",\n', "\n", pt)
pt = pt.replace('"tampermonkey_online": bool(status.get("tampermonkey_online")),\n            ', "")
pt = pt.replace('"tampermonkey_online": bool(status.get("tampermonkey_online")),\n                ', "")
PS.write_text(pt, encoding="utf-8")

# Fix page_snapshot status_pages_token - read file and fix properly
pt = PS.read_text(encoding="utf-8")
pt = re.sub(
    r'parts\.extend\(\[\s*f"running=\{int\(bool\(status\.get\(\'server_running\'\)\)\)\}",\s*f"tm_id=[^"]*",\s*f"bound=\{[^}]+\}",\s*f"q=\{[^}]+\}",\s*f"cq=\{[^}]+\}",\s*\]\)',
    """parts.extend([
        f"running={int(bool(status.get('server_running')))}",
        f"q={status.get('queue_length', 0)}",
        f"cq={status.get('control_queue_length', 0)}",
    ])""",
    pt,
    count=1,
)
PS.write_text(pt, encoding="utf-8")

# --- bulk import renames in .py files ---
REPLACEMENTS = [
    ("from app.server.page_registry import", "from app.server.tm_page_registry import"),
    ("from app.server import page_registry", "from app.server import tm_page_registry"),
    ("app.server.page_registry", "app.server.tm_page_registry"),
    ("from app.utils.page_registry import", "from app.utils.page_status import"),
    ("app.utils.page_registry", "app.utils.page_snapshot"),
]

SKIP = {"tools/_slim_refactor_batch.py", "app/server/page_registry.py", "app/utils/page_registry.py"}

for path in ROOT.rglob("*.py"):
    rel = str(path.relative_to(ROOT)).replace("\\", "/")
    if rel in SKIP or "tools/_split" in rel or "tools/generate" in rel:
        continue
    content = path.read_text(encoding="utf-8")
    orig = content
    for a, b in REPLACEMENTS:
        content = content.replace(a, b)
    if content != orig:
        path.write_text(content, encoding="utf-8")
        print("updated", rel)

print("done batch")
