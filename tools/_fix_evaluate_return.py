from pathlib import Path

p = Path(__file__).resolve().parents[1] / "app/utils/page_status.py"
t = p.read_text(encoding="utf-8")
replacements = [
    ("conversation_syncable=bool(data.get(\"conversation_syncable\")),\n            ", ""),
    ("reason=reason_val,", "blocked_reason=reason_val,"),
    (
        "        reason=reason,\n        response_state=response_state,",
        "        blocked_reason=reason if send_decision == \"blocked\" else \"\",\n        response_state=response_state,",
    ),
    ("conversation_syncable=conversation_syncable,\n        ", ""),
    ('            "conversation_syncable": self.conversation_syncable,\n            ', ""),
    ("return PageCapability(send_decision=\"blocked\", reason_code=\"no_page\")", "return PageCapability(send_decision=\"blocked\", blocked_reason=\"no_page\")"),
]
for old, new in replacements:
    if old in t:
        t = t.replace(old, new)
    else:
        print("skip:", old[:50])
p.write_text(t, encoding="utf-8")
print("done")
