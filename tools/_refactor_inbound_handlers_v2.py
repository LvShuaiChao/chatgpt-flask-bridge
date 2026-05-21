"""Restore inbound handlers from git original + thin dispatcher."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "app" / "ui" / "mixins" / "bridge_mixin.py"
orig_path = ROOT / "tools" / "_inbound_original_utf8.py"
text = path.read_text(encoding="utf-8")
full_original = orig_path.read_text(encoding="utf-8")
o_start = full_original.index("    def _handle_inbound_events(self, items):")
o_end = full_original.index("    def _render_inbound_log(self, items):")
original = full_original[o_start:o_end]

# Keep extracted small handlers inserted before _handle_inbound_events
marker = "    def _handle_report_unknown_event(self, item, payload):"
handlers_start = text.find(marker)
handlers_end = text.find("    def _handle_inbound_events(self, items):")
extra_handlers = ""
if handlers_start != -1 and handlers_end != -1:
    extra_handlers = text[handlers_start:handlers_end]

inbound_start = text.find("    def _handle_inbound_events(self, items):")
inbound_end = text.find("    def _render_inbound_log(self, items):")
if inbound_start == -1 or inbound_end == -1:
    raise SystemExit("markers not found in bridge_mixin.py")

lines = original.splitlines()
body_start = next(i for i, line in enumerate(lines) if 'kind = item.get("kind"' in line)
dedented = []
for line in lines[body_start:]:
    if line.startswith("            "):
        dedented.append("        " + line[12:])
    elif line.startswith("        "):
        dedented.append("        " + line[8:])
    else:
        dedented.append(line)
body = "\n".join(dedented)
body = body.replace("            continue", "            return")
body = body.replace("                continue", "                return")

# Re-dispatch early kinds to extracted handlers
replacements = [
    (
        '        if kind == "report_unknown":\n'
        "            bridge_id = item.get(\"message_id\") or \"-\"\n"
        "            payload = item.get(\"payload\") or {}\n"
        "            waiting_ids = payload.get(\"waiting_message_ids\") or []\n"
        "            self._append_log(\n"
        "                f\"[回传未知] message_id={bridge_id} event={payload.get('event') or '-'} \"\n"
        "                f\"client_id={item.get('client_id') or '-'} \"\n"
        "                f\"waiting_message_ids={waiting_ids}\"\n"
        "            )\n"
        "            return",
        '        if kind == "report_unknown":\n'
        "            self._handle_report_unknown_event(item, payload)\n"
        "            return",
    ),
    (
        '        if kind == "report_mismatch":\n'
        "            bridge_id = item.get(\"message_id\") or \"-\"\n"
        "            payload = item.get(\"payload\") or {}\n"
        "            self._append_log(\n"
        "                f\"[回传不匹配] message_id={bridge_id} \"\n"
        "                f\"session_id={item.get('session_id') or '-'} \"\n"
        "                f\"turn_id={item.get('turn_id') or '-'} \"\n"
        "                f\"event={payload.get('event') or '-'} \"\n"
        "                f\"owner_client_id={payload.get('owner_client_id') or '-'} \"\n"
        "                f\"report_client_id={payload.get('report_client_id') or item.get('client_id') or '-'}\"\n"
        "            )\n"
        "            return",
        '        if kind == "report_mismatch":\n'
        "            self._handle_report_mismatch_event(item, payload)\n"
        "            return",
    ),
]
for old, new in replacements:
    if old in body:
        body = body.replace(old, new, 1)

ack_old = (
    '        if kind in ("ack_mismatch", "report_ignored"):\n'
    "            if kind == \"ack_mismatch\":\n"
    "                bridge_id = item.get(\"message_id\") or \"-\"\n"
    "                payload = item.get(\"payload\") or {}\n"
    "                self._append_log(\n"
    "                    f\"[ACK不匹配] message_id={bridge_id} \"\n"
    "                    f\"session_id={item.get('session_id') or '-'} \"\n"
    "                    f\"turn_id={item.get('turn_id') or '-'} \"\n"
    "                    f\"detail={payload.get('detail') or '-'} \"\n"
    "                    f\"owner_client_id={payload.get('owner_client_id') or '-'} \"\n"
    "                    f\"report_client_id={payload.get('report_client_id') or item.get('client_id') or '-'}\"\n"
    "                )\n"
    "            return"
)
if ack_old in body:
    body = body.replace(
        ack_old,
        '        if kind in ("ack_mismatch", "report_ignored"):\n'
        "            self._handle_ack_mismatch_or_ignored_event(item, payload, kind)\n"
        "            return",
        1,
    )

open_old = (
    '        if kind in ("open_url_success", "open_url_failed"):\n'
    "            url = payload.get(\"url\") or \"\"\n"
    "            detail = payload.get(\"detail\") or \"\"\n"
    "            if kind == \"open_url_success\":\n"
    "                self._append_log(f\"[打开网页] 成功：{url} {detail}\".strip())\n"
    "            else:\n"
    "                self._append_log(f\"[打开网页] 失败：{url} {detail}\".strip())\n"
    "            return"
)
if open_old in body:
    body = body.replace(
        open_old,
        '        if kind in ("open_url_success", "open_url_failed"):\n'
        "            self._handle_open_url_result_event(item, payload, kind)\n"
        "            return",
        1,
    )

new_header = """    def _handle_inbound_events(self, items):
        for item in items:
            event_key = (
                item.get("event_id") or item.get("id") or self._make_inbound_key(item)
            )
            if event_key in self._processed_inbound_ids:
                continue
            self._processed_inbound_ids.add(event_key)
            self._handle_inbound_event(item)

"""
new_block = (extra_handlers or "") + new_header + "    def _handle_inbound_event(self, item):\n" + body + "\n"
text2 = text[:inbound_start] + new_block + text[inbound_end:]
path.write_text(text2, encoding="utf-8")
print("restored inbound block", len(body.splitlines()), "lines")
