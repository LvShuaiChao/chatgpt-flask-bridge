"""Print minimal imports hint per mixin file (manual apply)."""
import ast
from pathlib import Path

FILES = [
    "app/ui/mixins/page_sync_mixin.py",
    "app/ui/mixins/page_binding_state_mixin.py",
    "app/ui/mixins/page_binding_display_mixin.py",
    "app/ui/mixins/page_bind_mixin.py",
    "app/ui/mixins/page_selector_mixin.py",
    "app/ui/mixins/page_binding_diagnostics_mixin.py",
]

for rel in FILES:
    src = Path(rel).read_text(encoding="utf-8")
    tree = ast.parse(src)
    imports = {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for a in node.names:
                imports[a.asname or a.name.split(".")[0]] = f"import {a.name}"
        elif isinstance(node, ast.ImportFrom):
            mod = node.module
            for a in node.names:
                if a.name == "*":
                    continue
                key = a.asname or a.name
                imports[key] = f"from {mod} import {a.name}" + (
                    f" as {a.asname}" if a.asname else ""
                )
    used = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    print(f"\n=== {rel} ({Path(rel).stat().st_size}) ===")
    for k in sorted(imports):
        if k in used:
            print("  KEEP", imports[k])
