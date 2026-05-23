#!/usr/bin/env python3
"""Slice repo-root client.user.js into chatgpt-toolbox/tampermonkey-userscript-src/ organized by feature."""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPO_ROOT / "client.user.js"
OUT_DIR = REPO_ROOT / "chatgpt-toolbox" / "tampermonkey-userscript-src"
UPLOAD_INSERT_MARKER = "/*__UPLOAD_MODULES__*/"
HEADER_SLICE = (1, 24)


def read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines(keepends=True)


def slice_lines(lines: list[str], start: int, end: int) -> str:
    if start < 1 or end < start:
        raise ValueError(f"invalid slice {start}-{end}")
    return "".join(lines[start - 1 : end])


def find_line(lines: list[str], pattern: str, *, start: int = 1) -> int:
    rx = re.compile(pattern)
    for i in range(start - 1, len(lines)):
        if rx.search(lines[i]):
            return i + 1
    raise SystemExit(f"Anchor not found: {pattern}")


def find_slices(lines: list[str]) -> dict[str, tuple[int, int]]:
    iife = find_line(lines, r"^\(function \(\) \{\s*$")
    strict_end = find_line(lines, r"^\s*'use strict';\s*$", start=iife) + 1
    while strict_end <= len(lines) and not lines[strict_end - 1].strip():
        strict_end += 1

    dom_util = find_line(lines, r"^  const DomUtil = \(\(\) => \{")
    toolbox = find_line(lines, r"^  const ToolboxShell = \(\(\) => \{")
    chat_extractor = find_line(lines, r"^  const ChatMessageExtractor = \(\(\) => \{")
    upload = find_line(lines, r"^  const UploadModule = \(\(\) => \{")
    upload_banner = find_line(
        lines,
        r"^\s*/\*{5,}\s*$",
        start=max(1, upload - 8),
    )
    copy_once = find_line(lines, r"^    async function copyHotkeyAndContinueOnce\(")
    toggle_loop = find_line(lines, r"^    async function toggleCopyHotkeyContinueLoop\(")
    build_flask = find_line(lines, r"^    function buildFlaskUploadListHtml\(")
    bind_send_shortcut = find_line(lines, r"^    function bindUploadSendShortcut\(")
    bind_delegated = find_line(lines, r"^    function bindUploadDelegatedClick\(")
    upload_close = find_line(lines, r"^  \}\)\(\);\s*$", start=bind_delegated)
    auto_queue = find_line(lines, r"^  const AutoQueueModule = \(\(\) => \{", start=upload)
    auto_queue_banner = find_line(
        lines,
        r"^\s*/\*{5,}\s*$",
        start=max(1, auto_queue - 8),
    )
    outer_close = find_line(lines, r"^\}\)\(\);\s*$", start=auto_queue)

    return {
        "core/state.js": (strict_end, dom_util - 1),
        "core/logger.js": (dom_util, toolbox - 1),
        "ui/toolbox-shell.js": (toolbox, chat_extractor - 1),
        "main-middle.js": (chat_extractor, upload_banner - 1),
        "upload-head.js": (upload_banner, copy_once - 1),
        "continue.js": (copy_once, toggle_loop - 1),
        "loop.js": (toggle_loop, build_flask - 1),
        "upload-mid.js": (build_flask, bind_send_shortcut - 1),
        "shortcut.js": (bind_send_shortcut, bind_delegated - 1),
        "upload-tail.js": (bind_delegated, upload_close),
        "main-boot.js": (auto_queue_banner, outer_close - 1),
    }


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing source: {SOURCE}")

    lines = read_lines(SOURCE)
    slices = find_slices(lines)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    header = slice_lines(lines, *HEADER_SLICE)
    middle = slice_lines(lines, *slices["main-middle.js"])
    boot = slice_lines(lines, *slices["main-boot.js"])

    # core/main.js = header + ChatMessageExtractor + upload marker (ends with marker)
    core_main = (OUT_DIR / "core" / "main.js")
    core_main.parent.mkdir(parents=True, exist_ok=True)
    core_main.write_text(
        header
        + middle.rstrip("\n")
        + f"\n{UPLOAD_INSERT_MARKER}\n",
        encoding="utf-8",
    )

    # autoqueue/auto-queue.js = AutoQueueModule (starts after the marker)
    autoqueue_file = (OUT_DIR / "autoqueue" / "auto-queue.js")
    autoqueue_file.parent.mkdir(parents=True, exist_ok=True)
    autoqueue_file.write_text(boot.lstrip("\n"), encoding="utf-8")

    # Move simple files to new subdirectories
    path_map = {
        "core/state.js": "core/state.js",
        "core/logger.js": "core/logger.js",
        "ui/toolbox-shell.js": "ui/toolbox-shell.js",
    }
    for src_key, dst_rel in path_map.items():
        dst = OUT_DIR / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(slice_lines(lines, *slices[src_key]), encoding="utf-8")

    # upload/upload-module.js = upload-head + continue + loop + upload-mid + shortcut + upload-tail
    upload_module = (OUT_DIR / "upload" / "upload-module.js")
    upload_module.parent.mkdir(parents=True, exist_ok=True)
    upload_module.write_text(
        slice_lines(lines, *slices["upload-head.js"])
        + slice_lines(lines, *slices["continue.js"])
        + slice_lines(lines, *slices["loop.js"])
        + slice_lines(lines, *slices["upload-mid.js"])
        + slice_lines(lines, *slices["shortcut.js"])
        + slice_lines(lines, *slices["upload-tail.js"]),
        encoding="utf-8",
    )

    # .build-order.json metadata
    (OUT_DIR / ".build-order.json").write_text(
        json.dumps(
            {
                "parts": [
                    "core/state.js",
                    "core/logger.js",
                    "ui/toolbox-shell.js",
                    "core/main.js",
                    "upload/upload-module.js",
                    "autoqueue/auto-queue.js",
                ],
                "uploadInsertMarker": UPLOAD_INSERT_MARKER,
                "slices": {k: list(v) for k, v in slices.items()},
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Wrote modules under {OUT_DIR}")
    for name, bounds in sorted(slices.items()):
        print(f"  {name}: {bounds[0]}-{bounds[1]}")
    print(f"  upload/upload-module.js: merged from upload-head + continue + loop + upload-mid + shortcut + upload-tail")
    print(f"  core/main.js: header + main-middle + marker")
    print(f"  autoqueue/auto-queue.js: main-boot (AutoQueueModule)")


if __name__ == "__main__":
    main()
