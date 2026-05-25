#!/usr/bin/env python3
"""
只出现一次的 Python 定义候选扫描器（只读，不自动删代码）。

用法（仓库根目录）::

    python scripts/find_single_occurrence_defs.py

说明：
- 扫描 app/**/*.py 与 GUI.py 中的 FunctionDef / AsyncFunctionDef / ClassDef；
- 若符号名在合并文本中仅出现 1 次，打印为候选（多为定义处唯一）；
- Qt 槽、Flask/Werkzeug 回调、__getattr__ 等框架入口会产生假阳性，须人工复核；
- 不得据此脚本自动删除代码。
"""

from __future__ import annotations

import ast
import collections
import pathlib
import re
import sys

PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]

IGNORE_NAMES = frozenset(
    {
        "__getattr__",
        "__dir__",
        "showEvent",
        "closeEvent",
        "wheelEvent",
        "log_request",
    }
)


def _collect_py_files() -> list[pathlib.Path]:
    paths: list[pathlib.Path] = sorted(PROJECT_ROOT.glob("app/**/*.py"))
    gui = PROJECT_ROOT / "GUI.py"
    if gui.is_file():
        paths.append(gui)
    return paths


def main() -> int:
    py_files = _collect_py_files()
    if not py_files:
        print("[find_single_occurrence_defs] no Python files found", file=sys.stderr)
        return 1

    texts: list[str] = []
    real_files: list[pathlib.Path] = []

    for path in py_files:
        real_files.append(path)
        texts.append(path.read_text(encoding="utf-8", errors="ignore"))

    all_text = "\n".join(texts)
    words = collections.Counter(re.findall(r"\b[A-Za-z_]\w*\b", all_text))

    exit_code = 0
    for path, text in zip(real_files, texts):
        try:
            tree = ast.parse(text)
        except SyntaxError as error:
            print(f"[SKIP][SYNTAX] {path}: {error}", file=sys.stderr)
            exit_code = 1
            continue

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            name = node.name
            if name in IGNORE_NAMES:
                continue
            count = words[name]
            if count <= 1:
                rel = path.relative_to(PROJECT_ROOT)
                kind = type(node).__name__
                print(f"{rel}:{node.lineno} {kind} {name} count={count}")

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
