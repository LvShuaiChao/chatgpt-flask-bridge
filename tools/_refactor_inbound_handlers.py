"""One-off: split _handle_inbound_events loop body into _handle_inbound_event."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "app" / "ui" / "mixins" / "bridge_mixin.py"
text = path.read_text(encoding="utf-8")
start = text.index("    def _handle_inbound_events(self, items):")
end = text.index("    def _render_inbound_log(self, items):")
block = text[start:end]
lines = block.splitlines()
body_start = next(
    i for i, line in enumerate(lines) if 'kind = item.get("kind"' in line
)
dedented = []
for line in lines[body_start:]:
    if line.startswith("            "):
        dedented.append("        " + line[12:])
    else:
        dedented.append(line)
body = "\n".join(dedented).replace("                continue", "            return")

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
new_block = new_header + "    def _handle_inbound_event(self, item):\n" + body + "\n"
path.write_text(text[:start] + new_block + text[end:], encoding="utf-8")
print(f"refactored {len(dedented)} body lines")
