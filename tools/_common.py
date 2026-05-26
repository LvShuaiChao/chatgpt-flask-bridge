"""Shared file/path utilities for project tools and scripts."""
from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_IGNORE_DIRS: set[str] = {
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


def read_text(path: Path) -> str:
    """Read file as UTF-8 text with error replacement."""
    return path.read_text(encoding="utf-8", errors="replace")


def read_text_safe(path: Path) -> str:
    """Read file as UTF-8 text, returning '' if the file doesn't exist."""
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def rel(path: Path, root: Path | None = None) -> str:
    """Return path relative to project root with forward slashes."""
    base = root or PROJECT_ROOT
    return str(path.relative_to(base)).replace("\\", "/")


def iter_py_files(
    roots: list[Path],
    ignore_dirs: set[str] | None = None,
) -> list[Path]:
    """Collect Python files under root directories, skipping ignored dirs."""
    if ignore_dirs is None:
        ignore_dirs = DEFAULT_IGNORE_DIRS

    files: list[Path] = []
    for target in roots:
        if not target.exists():
            continue
        if target.is_file() and target.suffix == ".py":
            files.append(target)
            continue
        for path in target.rglob("*.py"):
            if any(part in ignore_dirs for part in path.parts):
                continue
            files.append(path)
    return sorted(set(files))
