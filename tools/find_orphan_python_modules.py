# tools/find_orphan_python_modules.py

from __future__ import annotations

import ast
from pathlib import Path

from _common import (
    DEFAULT_IGNORE_DIRS,
    PROJECT_ROOT as ROOT,
    read_text,
    rel,
)

SCAN_ROOTS = [
    ROOT / "app",
]

ENTRY_FILES = {
    "gui.py",
    "server.py",
}

ALWAYS_KEEP_BASENAMES = {
    "__init__.py",
    "constants.py",
    "models.py",
}

ALWAYS_KEEP_PATH_PARTS = {
    "server",
    "routes",
    "ui",
    "widgets",
    "mixins",
}


def iter_python_files():
    for root in SCAN_ROOTS:
        if not root.exists():
            continue

        for path in root.rglob("*.py"):
            if any(part in DEFAULT_IGNORE_DIRS for part in path.parts):
                continue
            yield path

    for name in ENTRY_FILES:
        path = ROOT / name
        if path.exists():
            yield path


def module_name_from_path(path: Path) -> str:
    rel_path = path.relative_to(ROOT).with_suffix("")
    return ".".join(rel_path.parts)


def parse_ast(path: Path):
    text = read_text(path)
    try:
        return ast.parse(text)
    except SyntaxError as exc:
        print(f"[ORPHAN_MODULES][PARSE_FAILED] {rel(path)} error={exc}")
        return None


def collect_imported_modules(path: Path) -> set[str]:
    tree = parse_ast(path)
    if tree is None:
        return set()

    imported = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported.add(alias.name)

        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported.add(node.module)

    return imported


def should_skip_candidate(path: Path) -> bool:
    if path.name in ALWAYS_KEEP_BASENAMES:
        return True

    if path.name in ENTRY_FILES:
        return True

    parts = set(path.relative_to(ROOT).parts)
    if parts.intersection(ALWAYS_KEEP_PATH_PARTS):
        return True

    text = read_text(path)

    keep_markers = [
        "@app.route",
        ".route(",
        "Blueprint(",
        "QWidget",
        "QDialog",
        "QObject",
        "pyqtSignal",
        "pyqtSlot",
        "register_blueprint",
    ]

    for marker in keep_markers:
        if marker in text:
            return True

    return False


def main() -> int:
    print("[ORPHAN_MODULES][START]")

    files = list(iter_python_files())
    modules_by_name = {
        module_name_from_path(path): path
        for path in files
    }

    imported_modules = set()

    for path in files:
        imported_modules.update(collect_imported_modules(path))

    for module_name, path in sorted(modules_by_name.items()):
        if should_skip_candidate(path):
            continue

        exact_hit = module_name in imported_modules

        prefix_hit = False
        for imported in imported_modules:
            if imported.startswith(module_name + "."):
                prefix_hit = True
                break

        short_name = module_name.split(".")[-1]
        short_hit = short_name in imported_modules

        if not exact_hit and not prefix_hit and not short_hit:
            print(
                f"[ORPHAN_PY_MODULE_CANDIDATE] {rel(path)} "
                f"module={module_name}"
            )

    print("[ORPHAN_MODULES][DONE]")
    print("以上只是候选清单。动态 import、Flask 自动注册、Qt 动态加载、插件机制、字符串导入都可能导致误判，不能自动删除。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
