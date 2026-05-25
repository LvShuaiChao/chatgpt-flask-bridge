from __future__ import annotations

import ast
from collections import defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ENTRY_FILES = [
    ROOT / "GUI.py",
]

SCAN_ROOTS = [
    ROOT / "app",
    ROOT / "GUI.py",
]

OUT_FILE = ROOT / "docs" / "dead_code_reachability_snapshot.md"

IGNORE_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "runtime",
    "logs",
    "dist",
    "build",
    "node_modules",
}

DYNAMIC_KEEP_MARKERS = [
    "@app.route",
    ".route(",
    "Blueprint(",
    "register_blueprint",
    "QWidget",
    "QDialog",
    "QObject",
    "pyqtSignal",
    "pyqtSlot",
    "importlib",
    "__import__",
    "getattr(",
]


def iter_python_files():
    for target in SCAN_ROOTS:
        if target.is_file() and target.suffix == ".py":
            yield target
            continue

        if not target.exists():
            continue

        for path in target.rglob("*.py"):
            if any(part in IGNORE_DIRS for part in path.parts):
                continue
            yield path


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def module_name_from_path(path: Path) -> str:
    return ".".join(path.relative_to(ROOT).with_suffix("").parts)


def path_from_module(module_name: str, module_to_path: dict[str, Path]) -> Path | None:
    if module_name in module_to_path:
        return module_to_path[module_name]

    parts = module_name.split(".")
    while parts:
        candidate = ".".join(parts)
        if candidate in module_to_path:
            return module_to_path[candidate]
        parts.pop()

    return None


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def parse_imports(path: Path) -> set[str]:
    text = read_text(path)
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        print(f"[REACHABILITY][PARSE_FAILED] {rel(path)} error={exc}")
        return set()

    imports = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.add(alias.name)

        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.add(node.module)

                for alias in node.names:
                    if alias.name == "*":
                        continue
                    imports.add(f"{node.module}.{alias.name}")

    return imports


def has_dynamic_keep_marker(path: Path) -> bool:
    text = read_text(path)
    return any(marker in text for marker in DYNAMIC_KEEP_MARKERS)


def main() -> int:
    print("[REACHABILITY][START]")

    files = sorted(set(iter_python_files()))
    module_to_path = {
        module_name_from_path(path): path
        for path in files
    }
    path_to_module = {
        path: module
        for module, path in module_to_path.items()
    }

    graph = defaultdict(set)

    for path in files:
        module = path_to_module[path]
        for imported in parse_imports(path):
            target_path = path_from_module(imported, module_to_path)
            if target_path:
                graph[module].add(path_to_module[target_path])

    entry_modules = []
    for entry in ENTRY_FILES:
        if entry.exists():
            entry_modules.append(module_name_from_path(entry))

    reachable = set()
    queue = deque(entry_modules)

    while queue:
        module = queue.popleft()
        if module in reachable:
            continue

        reachable.add(module)

        for child in graph.get(module, set()):
            if child not in reachable:
                queue.append(child)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    lines = []
    lines.append("# Dead Code Reachability Snapshot")
    lines.append("")
    lines.append("本报告从入口文件出发，记录 Python import 可达性。")
    lines.append("它只能作为候选分析依据，不能作为自动删除依据。")
    lines.append("")
    lines.append("## Entry Modules")
    lines.append("")
    for module in entry_modules:
        lines.append(f"- `{module}`")
    lines.append("")

    lines.append("## Reachable Modules")
    lines.append("")
    for module in sorted(reachable):
        path = module_to_path.get(module)
        if path:
            lines.append(f"- `{module}` -> `{rel(path)}`")
    lines.append("")

    lines.append("## Unreachable Candidate Modules")
    lines.append("")
    for module, path in sorted(module_to_path.items()):
        if module in reachable:
            continue

        if path.name == "__init__.py":
            continue

        dynamic_keep = has_dynamic_keep_marker(path)
        marker = "dynamic-keep-marker" if dynamic_keep else "plain-unreachable-candidate"
        lines.append(f"- `{rel(path)}` module=`{module}` reason=`{marker}`")
    lines.append("")

    lines.append("## Notes")
    lines.append("")
    lines.append("- Flask route、Qt UI、插件、importlib、getattr 等都可能导致静态 import 图误判。")
    lines.append("- `dynamic-keep-marker` 文件不能直接删除。")
    lines.append("- 删除任何候选前必须运行完整 dead code 检查和 GUI 冒烟测试。")

    OUT_FILE.write_text("\n".join(lines), encoding="utf-8")

    print(f"[REACHABILITY][OK] wrote {rel(OUT_FILE)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
