#!/usr/bin/env python3
"""
从 export_for_chatgpt 生成的合并 txt / zip 中解析 FILE 块，还原单文件以便离线核验。

合并块格式（见 export_for_chatgpt.py build_file_block）::

    ====================================================================================================
    FILE: app/core/job_scheduler.py
    TOKENS（cl100k_base）: ...
    ====================================================================================================

    <file body>

用法示例::

    python tools/unbundle_merged_for_chatgpt.py 0_merged_for_chatgpt.zip -o _unbundle_415
    python tools/unbundle_merged_for_chatgpt.py 0_merged_for_chatgpt.txt --only app/core/job_scheduler.py app/models.py
    python tools/unbundle_merged_for_chatgpt.py 0_merged_for_chatgpt.zip --verify-dead-code -o _unbundle_415
"""

from __future__ import annotations

import argparse
import fnmatch
import re
import sys
import zipfile
from pathlib import Path

_FILE_BLOCK_RE = re.compile(
    r"(?:^|\n)={100}\nFILE:\s*(?P<path>[^\n]+)\n(?:TOKENS[^\n]*\n)?={100}\n\n(?P<body>.*?)(?=\n={100}\nFILE:|\Z)",
    re.DOTALL,
)

# docs/dead_code_cleanup_rules.md §22.6 — 已删项应无命中
_SHOULD_BE_GONE = [
    ("BridgeQueueFullError|_server_instance_id|_server_start_time", "app/server/state.py"),
    ("CursorMatchResult", "app/cursor_code/matcher.py"),
    ("should_emit_log", "app/utils/gui_logging.py"),
    ("has_page_channel|\\.display_key\\(", "app/utils/page_identity.py"),
    ('job\\.get\\("status"\\)|j\\.get\\("status"\\)', "app/core/job_scheduler.py"),
    ("DEFAULT_AUTO_CONFIG", "chatgpt-toolbox/tampermonkey-userscript-src"),
    (
        "is_chatgpt_platform_error_text|_CHATGPT_PLATFORM_ERROR_RE|_CHATGPT_PLATFORM_ERROR_DEPRECATED_LOGGED",
        "app/constants.py",
    ),
    ("_on_send_to_cursor_clicked", "app/ui/mixins/cursor_bridge_mixin.py"),
    (
        "clickRealComposerSendButton|copyAndSendHotkeyOnce|isAssistantReallyGeneratingForCopy|"
        "forceChatPageToAbsoluteEnd|getChatScrollContainers|forceScrollContainerToEnd",
        "chatgpt-toolbox/tampermonkey-userscript-src",
    ),
    (
        "_log_send_bind_check|_log_bind_auto_rebind|_sync_target_unavailable_reason_text",
        "app/ui/mixins/page_binding_diagnostics_mixin.py",
    ),
    ("_bool_alias_value|_page_identity_text", "app/ui/mixins/page_binding_display_mixin.py"),
    ("_gc_orphan_bindings|_update_session_binding_from_normalized_page", "app/ui/mixins/page_binding_state_mixin.py"),
    ("_tm_table_signature|_page_list_refresh_metrics", "app/ui/mixins/page_open_close_mixin.py"),
    ("_classify_page_state|_short_page_display|build_monkey_binding_summary_text", "app/ui/mixins/page_tm_client_mixin.py"),
    ("_render_pending_chat_if_needed", "app/ui/mixins/session_mixin.py"),
]

# §22.7 — 必须仍存在
_MUST_KEEP = [
    ("__getattr__|__dir__", "app/server/__init__.py"),
    ("def log_request", "app/server/runtime_state.py"),
    ("def closeEvent", "app/ui/main_window.py"),
    ("def wheelEvent", "app/ui/widgets/no_wheel_combo_box.py"),
    ("tickWaitingReplyOrSendOpportunity", "chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js"),
    ("LEGACY_FIELD_NAMES|assert_no_legacy_fields|reject_legacy_fields", "app/utils/legacy_cleanup.py"),
    ("validate_outbound_queue_message", "app/utils/bridge_payload.py"),
    ("job_status_from", "app/core/job_scheduler.py"),
    ("getDefaultAutoListPromptsText", "chatgpt-toolbox/tampermonkey-userscript-src/core/state.js"),
]


def _read_merged_texts(inputs: list[Path]) -> str:
    parts: list[str] = []
    for p in inputs:
        if p.suffix.lower() == ".zip":
            with zipfile.ZipFile(p, "r") as zf:
                for name in sorted(zf.namelist()):
                    if not name.lower().endswith(".txt"):
                        continue
                    parts.append(zf.read(name).decode("utf-8", errors="replace"))
        else:
            parts.append(p.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(parts)


def _collect_input_paths(paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for raw in paths:
        p = Path(raw).resolve()
        if not p.exists():
            raise FileNotFoundError(raw)
        if p.is_dir():
            for pattern in ("0_merged_for_chatgpt*.txt", "0_merged_for_chatgpt*.zip"):
                out.extend(sorted(p.glob(pattern)))
        else:
            out.append(p)
    if not out:
        raise SystemExit("未找到任何合并 txt/zip 输入")
    return out


def parse_file_blocks(merged_text: str) -> dict[str, str]:
    blocks: dict[str, str] = {}
    for m in _FILE_BLOCK_RE.finditer(merged_text):
        rel = m.group("path").strip().replace("\\", "/")
        body = m.group("body")
        if body.endswith("\n"):
            body = body[:-1]
        blocks[rel] = body
    return blocks


def _path_selected(rel: str, only_patterns: list[str] | None) -> bool:
    if not only_patterns:
        return True
    norm = rel.replace("\\", "/")
    for pat in only_patterns:
        pat = pat.replace("\\", "/")
        if fnmatch.fnmatch(norm, pat) or norm == pat or norm.endswith("/" + pat):
            return True
    return False


def write_blocks(
    blocks: dict[str, str],
    output_dir: Path,
    *,
    only_patterns: list[str] | None,
) -> list[str]:
    written: list[str] = []
    for rel in sorted(blocks):
        if not _path_selected(rel, only_patterns):
            continue
        dest = output_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(blocks[rel] + "\n", encoding="utf-8", newline="\n")
        written.append(rel)
    return written


def _search_in_text(pattern: str, text: str) -> bool:
    return re.search(pattern, text) is not None


def verify_dead_code(blocks: dict[str, str]) -> int:
    """对解析出的块做 §22.6/22.7 静态核对；返回失败数。"""
    failures = 0

    def _get(rel: str) -> str | None:
        key = rel.replace("\\", "/")
        if key in blocks:
            return blocks[key]
        for k, v in blocks.items():
            if k.replace("\\", "/") == key:
                return v
        return None

    print("[verify] 已删项应无命中（§22.6）")
    for pattern, rel in _SHOULD_BE_GONE:
        text = _get(rel)
        if text is None:
            print(f"  [SKIP] 合并包中无 FILE: {rel}")
            continue
        if _search_in_text(pattern, text):
            print(f"  [FAIL] {rel} 仍匹配 /{pattern}/")
            failures += 1
        else:
            print(f"  [OK]   {rel}")

    print("\n[verify] 保留项应仍存在（§22.7）")
    for pattern, rel in _MUST_KEEP:
        text = _get(rel)
        if text is None:
            print(f"  [SKIP] 合并包中无 FILE: {rel}")
            continue
        if not _search_in_text(pattern, text):
            print(f"  [FAIL] {rel} 未找到 /{pattern}/")
            failures += 1
        else:
            print(f"  [OK]   {rel}")

    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="从合并导出中解析 FILE 块并写回单文件")
    parser.add_argument(
        "inputs",
        nargs="+",
        help="0_merged_for_chatgpt.txt / .zip / _partNN 文件，或含这些文件的目录",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("_unbundle_from_merged"),
        help="输出目录（默认 _unbundle_from_merged）",
    )
    parser.add_argument(
        "--only",
        nargs="*",
        metavar="GLOB",
        help="仅提取匹配的路径（fnmatch，如 app/core/*.py）",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="只列出 FILE 块路径，不写盘",
    )
    parser.add_argument(
        "--verify-dead-code",
        action="store_true",
        help="对解析结果运行 dead code §22.6/22.7 核对（可与 --only 联用）",
    )
    args = parser.parse_args(argv)

    inputs = _collect_input_paths(args.inputs)
    merged = _read_merged_texts(inputs)
    blocks = parse_file_blocks(merged)
    if not blocks:
        print("未解析到任何 FILE 块；请确认输入为 export_for_chatgpt 合并包", file=sys.stderr)
        return 1

    print(f"解析到 {len(blocks)} 个 FILE 块（输入: {len(inputs)} 个文件）")

    if args.list:
        for rel in sorted(blocks):
            print(rel)
        if args.verify_dead_code:
            return 1 if verify_dead_code(blocks) else 0
        return 0

    written = write_blocks(blocks, args.output.resolve(), only_patterns=args.only)
    print(f"已写入 {len(written)} 个文件 -> {args.output.resolve()}")

    if args.verify_dead_code:
        subset = blocks if not args.only else {k: blocks[k] for k in written}
        fail = verify_dead_code(subset if args.only else blocks)
        return 1 if fail else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
