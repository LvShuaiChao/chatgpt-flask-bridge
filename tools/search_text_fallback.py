# tools/search_text_fallback.py

from __future__ import annotations

import sys
from pathlib import Path

from _common import (
    DEFAULT_IGNORE_DIRS,
    PROJECT_ROOT as ROOT,
    rel,
)

DEFAULT_INCLUDE_SUFFIXES = {
    ".py",
    ".js",
    ".ts",
    ".json",
    ".md",
    ".txt",
    ".yaml",
    ".yml",
}

IGNORE_DIRS = DEFAULT_IGNORE_DIRS


def iter_files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue

        if any(part in IGNORE_DIRS for part in path.parts):
            continue

        if path.suffix.lower() not in DEFAULT_INCLUDE_SUFFIXES:
            continue

        yield path


def search_text(pattern: str) -> int:
    hit_count = 0

    for path in iter_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        for line_no, line in enumerate(text.splitlines(), start=1):
            if pattern in line:
                hit_count += 1
                print(f"{rel(path)}:{line_no}:{line.rstrip()}")

    return hit_count


def main() -> int:
    if len(sys.argv) < 2:
        print("[SEARCH_TEXT_FALLBACK][FAILED] missing pattern")
        print("usage: python tools/search_text_fallback.py <plain_text_pattern>")
        return 2

    pattern = sys.argv[1]
    if not pattern:
        print("[SEARCH_TEXT_FALLBACK][FAILED] empty pattern")
        return 2

    hit_count = search_text(pattern)
    print(f"[SEARCH_TEXT_FALLBACK][DONE] pattern={pattern!r} hits={hit_count}")

    return 0 if hit_count >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
