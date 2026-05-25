# tools/find_python_dead_statements.py

from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TARGETS = [
    ROOT / "app",
    ROOT / "gui.py",
    ROOT / "server.py",
]

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

# from __future__ import annotations is not a normal unused import (PEP 563).
# Simple scanners false-positive on local name "annotations"; never emit candidates.
IGNORE_IMPORT_NAMES = {
    "__future__",
}


def iter_python_files():
    for target in TARGETS:
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


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def parse_file(path: Path):
    text = read_text(path)
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        print(f"[PY_DEAD_STATEMENTS][PARSE_FAILED] {rel(path)} error={exc}")
        return None, text
    return tree, text


def collect_imports(tree: ast.AST):
    imports = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                local_name = alias.asname or alias.name.split(".")[0]
                root_name = alias.name.split(".")[0]
                imports.append(
                    {
                        "line": node.lineno,
                        "name": alias.name,
                        "local": local_name,
                        "root": root_name,
                        "kind": "import",
                    }
                )

        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module in IGNORE_IMPORT_NAMES:
                continue

            for alias in node.names:
                if alias.name == "*":
                    continue

                local_name = alias.asname or alias.name
                imports.append(
                    {
                        "line": node.lineno,
                        "name": f"{module}.{alias.name}" if module else alias.name,
                        "local": local_name,
                        "root": module.split(".")[0] if module else alias.name,
                        "kind": "from",
                    }
                )

    return imports


class NameUsageVisitor(ast.NodeVisitor):
    def __init__(self):
        self.used_names = set()

    def visit_Name(self, node: ast.Name):
        self.used_names.add(node.id)
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute):
        self.generic_visit(node)


def find_unused_import_candidates(path: Path, tree: ast.AST):
    imports = collect_imports(tree)

    visitor = NameUsageVisitor()
    visitor.visit(tree)

    for item in imports:
        local = item["local"]
        if local not in visitor.used_names:
            print(
                f"[UNUSED_IMPORT_CANDIDATE] {rel(path)}:{item['line']} "
                f"local={local} source={item['name']} kind={item['kind']}"
            )


TERMINAL_NODES = (
    ast.Return,
    ast.Raise,
    ast.Break,
    ast.Continue,
)


def scan_body_for_unreachable(path: Path, body, scope_name: str):
    unreachable = False

    for node in body:
        if unreachable:
            print(
                f"[UNREACHABLE_STATEMENT_CANDIDATE] {rel(path)}:{getattr(node, 'lineno', '?')} "
                f"scope={scope_name} node={type(node).__name__}"
            )

        if isinstance(node, TERMINAL_NODES):
            unreachable = True

        nested_body = getattr(node, "body", None)
        if isinstance(nested_body, list):
            nested_name = f"{scope_name}.{type(node).__name__}@{getattr(node, 'lineno', '?')}"
            scan_body_for_unreachable(path, nested_body, nested_name)

        nested_orelse = getattr(node, "orelse", None)
        if isinstance(nested_orelse, list):
            nested_name = f"{scope_name}.{type(node).__name__}.else@{getattr(node, 'lineno', '?')}"
            scan_body_for_unreachable(path, nested_orelse, nested_name)

        nested_finalbody = getattr(node, "finalbody", None)
        if isinstance(nested_finalbody, list):
            nested_name = f"{scope_name}.{type(node).__name__}.finally@{getattr(node, 'lineno', '?')}"
            scan_body_for_unreachable(path, nested_finalbody, nested_name)


def find_unreachable_statement_candidates(path: Path, tree: ast.AST):
    for node in ast.walk(tree):
        if isinstance(node, ast.Module):
            scan_body_for_unreachable(path, node.body, "module")
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            scan_body_for_unreachable(path, node.body, node.name)


def main() -> int:
    print("[PY_DEAD_STATEMENTS][START]")

    for path in iter_python_files():
        tree, _text = parse_file(path)
        if tree is None:
            continue

        find_unused_import_candidates(path, tree)
        find_unreachable_statement_candidates(path, tree)

    print("[PY_DEAD_STATEMENTS][DONE]")
    print(
        "以上结果只是候选清单。动态导入、类型注解、插件注册、副作用 import 都可能导致误判，不能自动删除。"
    )
    print(
        "已忽略 from __future__ import annotations（非普通 unused import，见 docs/dead_code_cleanup_rules.md §3.3）。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
