"""
将项目源码与配置打成文本文件，便于整段粘贴到 ChatGPT。

- **全量扫描**（唯一模式）：遍历项目根下允许的扩展名，跳过无关目录；统一调用 ``export_should_skip_relative_path``。
- **输出路径**：固定为仓库根目录 ``0_merged_for_chatgpt.txt``（超出 ``MAX_TOKENS_PER_OUTPUT_FILE`` 则按 token 拆分为 ``*_partNN.txt``）；默认同轮次为**每个**写出的 txt 各打一个同名 ``.zip``（单文件则仅 ``0_merged_for_chatgpt.zip``，多分片则 ``*_partNN.zip`` 各一个，DEFLATE）；``--no-export-zip`` 可关闭。
- **循环**：默认每隔 ``LOOP_EXPORT_INTERVAL_SEC`` 秒检查一次；进程启动后**会先做一次全量合并写盘**，之后**仅当**候选文件相对上次导出的 mtime 清单有变化时才再次合并（Ctrl+C 结束）。``--loop-always-export`` 恢复「每轮必导出」。``--once`` 只跑一轮。
- 常用开关：``--incremental``（本会话**首轮仍全量合并**，之后才按 mtime 仅合并变更文件）、``--include-runtime-state``、``--include-logs``、``--include-claude``。
- 日志（``logs/*.log`` 等）默认**不**混入源码合并包，单独写入 ``0_export_logs_for_chatgpt.txt``（过大时仅导出末尾一段）。
- 默认缩小合并包（省略 ``runtime/`` 会话状态、``.claude/``、本脚本等）：``--include-runtime-state``、``--include-claude``、``--include-export-script`` 可逐项恢复。
- **统计两类维度**：（1）**行数**——仅收录源码文件行数之和；（2）**Token**——源码合计与合并全文 ``cl100k_base`` 计数，并对照 ``CHATGPT_DOCUMENT_TOKEN_LIMIT``（默认 200 万）。需 ``pip install tiktoken`` 才有 Token 与上限余量。
- **性能**：默认多线程读取/合并各 FILE 块（``--workers``，0=自动）；分片 zip 并行；合并阶段缓存读盘结果避免重复 IO；zip 使用较快 DEFLATE 压缩级别。
"""

from __future__ import annotations

import argparse
import ast
import concurrent.futures
import json
import logging
import os
import re
import sys
import threading
import time
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_GARBLED_TOKEN_CHARS = ("鍟", "銆", "鏍", "鏂", "Ã", "Â", "ç", "è", "ä")

_RUN_STATS: dict = {}


def _rel_posix_and_basename(path: Path, project_root: Path) -> tuple[str, str]:
    try:
        rel = path.resolve().relative_to(project_root.resolve()).as_posix().lower()
    except (OSError, ValueError):
        return "", str(path.name or "").strip().lower()
    return rel, str(path.name or "").strip().lower()


def should_exclude_path(path: Path, project_root: Path) -> bool:
    rel, bn = _rel_posix_and_basename(path, project_root)
    if not rel:
        return True
    return export_should_skip_relative_path(rel, basename=bn)


def _record_excluded_example(run_stats: dict, rel_posix: str) -> None:
    examples: list[str] = run_stats.setdefault("excluded_examples", [])
    if len(examples) >= 50:
        return
    if rel_posix not in examples:
        examples.append(rel_posix)


def _scan_suspicious_encoding(
    *,
    text: str,
    rel_posix: str,
    run_stats: dict,
) -> None:
    """
    Lightweight detection for suspicious encoding / garbled text.
    - record up to 100 entries
    - do NOT auto-fix, only report risk
    """
    if not text:
        return
    out: list[dict] = run_stats.setdefault("suspicious_encoding_files", [])
    if len(out) >= 100:
        return

    # 1) 3+ consecutive question marks
    # 2) typical mojibake token characters
    for idx, line in enumerate(text.splitlines(), 1):
        if len(out) >= 100:
            break
        if "???" in line:
            out.append({"path": rel_posix, "line": idx, "sample": line[:240]})
            continue
        if any(tok in line for tok in _GARBLED_TOKEN_CHARS):
            out.append({"path": rel_posix, "line": idx, "sample": line[:240]})

# =========================
# 项目根：本仓库为油猴脚本 + Python 联动（server.py / GUI.py 与脚本同目录）
# =========================
_SCRIPT_HOME = Path(__file__).resolve().parent


def _detect_project_root(script_home: Path) -> Path:
    markers = ("server.py", "gui.py", "GUI.py", "client.user.js")
    if any((script_home / name).is_file() for name in markers):
        return script_home
    return script_home.parent


PROJECT_ROOT = _detect_project_root(_SCRIPT_HOME)

# =========================
# 默认输出：固定在项目根目录
# 重要约束：未经用户明确确认，不允许修改导出路径相关逻辑（DEFAULT_OUTPUT / run_export 输出位置）。
# =========================
DEFAULT_OUTPUT = PROJECT_ROOT / "0_merged_for_chatgpt.txt"
# 与 DEFAULT_OUTPUT 同 stem：单文件导出时对应 ``0_merged_for_chatgpt.zip``；分片时每个 part 另有同名 zip。
DEFAULT_ZIP_OUTPUT = DEFAULT_OUTPUT.with_suffix(".zip")
# 日志单独导出，不混入源码合并包
DEFAULT_LOG_OUTPUT = PROJECT_ROOT / "0_export_logs_for_chatgpt.txt"

# 循环导出：间隔秒数（写死，便于双击运行无需参数）
LOOP_EXPORT_INTERVAL_SEC = 10.0
# 循环模式下，每轮导出开始/结束的分隔线宽度（与合并文件头 "=" * 100 一致）
LOOP_EXPORT_CYCLE_SEPARATOR_WIDTH = 100

# 默认严格排除本地状态/日志/第三方工具目录；需显式开关才包含。
INCLUDE_RUNTIME_STATE = False
INCLUDE_LOGS = False
INCLUDE_CLAUDE = False
# 缩小合并包：默认排除仓库根 export_for_chatgpt.py（其余 tests/tools 等目录本仓库通常不存在）。
SLIM_SKIP_TESTS = True
SLIM_SKIP_TOOLS = True
SLIM_SKIP_SCRIPTS = True
SLIM_SKIP_DATA_ACCOUNTS = True
SLIM_SKIP_EXPORT_SCRIPT = True

_ALWAYS_SKIP_DIR_SEGMENTS = frozenset(
    {
        ".git",
        ".idea",
        "__pycache__",
        ".pytest_cache",
        "node_modules",
        ".venv",
        "venv",
        "runtime",
    }
)


def export_should_skip_relative_path(rel_posix: str, *, basename: str = "") -> bool:
    """按相对路径（posix、小写）判断是否跳过扫描/合并。

    默认排除（非源码）：log.txt、*.log、runtime/、__pycache__/、.git/、.venv/、venv/ 等。
    """
    rel = str(rel_posix or "").strip().lower().replace("\\", "/")
    if not rel:
        return True
    bn = (basename or rel.rsplit("/", 1)[-1]).strip().lower()
    parts = [p for p in rel.split("/") if p]

    if any(p in _ALWAYS_SKIP_DIR_SEGMENTS for p in parts):
        return True
    if bn == ".export_for_chatgpt_mtimes.json":
        return True
    if bn.startswith("0_merged_for_chatgpt") or bn.startswith("0_export_logs_for_chatgpt"):
        return True
    if bn.endswith(".pyc"):
        return True
    if bn == "log.txt" or bn.endswith(".log"):
        return True

    if not INCLUDE_CLAUDE and any(p == ".claude" for p in parts):
        return True
    if not INCLUDE_RUNTIME_STATE and parts and parts[0] == "runtime":
        return True
    if not INCLUDE_LOGS:
        if bn.endswith(".log") or bn.endswith(".jsonl") or "snapshot" in bn:
            return True

    if SLIM_SKIP_TESTS and parts and parts[0] == "tests":
        return True
    if SLIM_SKIP_TOOLS and parts and parts[0] == "tools":
        return True
    if SLIM_SKIP_SCRIPTS and parts and parts[0] == "scripts":
        return True
    if SLIM_SKIP_DATA_ACCOUNTS and rel.startswith("data/accounts/"):
        return True
    if SLIM_SKIP_EXPORT_SCRIPT and rel == "export_for_chatgpt.py":
        return True

    return False


def export_log_basename_should_skip_in_source_scan(basename: str) -> bool:
    """logs/ 下日志文件名：默认不进源码合并包（单独 log 导出）。"""
    return str(basename or "").strip().lower().endswith(".log")
# 导出时是否替换“明显占位符式”的连续问号（例如 ???????? / ？？？？？？？？）。
# 仅影响导出文本，不改动源文件内容。
SANITIZE_PLACEHOLDER_QUESTION_RUNS = True
PLACEHOLDER_QUESTION_RUN_RE = re.compile(r"[?？]{8,}")
FORBIDDEN_EXPORT_TEXT_LITERALS: tuple[str, ...] = (
    "_archive/",
    "run_logs/",
    "logs/",
    "0_merged_for_chatgpt.manifest.json",
    ".tmp_old_main_window_impl.py",
    ".tmp_main_window_remote.py",
)

# 与 GPT-4 / ChatGPT 文本 tokenizer 常用的 cl100k 一致，便于对照上传文档 token 上限。
TIKTOKEN_ENCODING_NAME = "cl100k_base"
# ChatGPT 文本/PDF/Word 等「单文档」常见上限参考（约 200 万 tokens）；用于余量与超限提示。
CHATGPT_DOCUMENT_TOKEN_LIMIT = 2_000_000
# 单个输出文件最大 tokens（cl100k_base）；超出则拆分为 *_partNN.txt（默认 150 万；与上方 ChatGPT 参考上限独立）。
MAX_TOKENS_PER_OUTPUT_FILE = 1_700_000
_TIKTOKEN_ENCODER: object | None = None
_TIKTOKEN_IMPORT_FAILED = False
_WARNED_TOKEN_SPLIT_UNAVAILABLE = False
# zip DEFLATE 压缩级别 1–9；1 明显快于默认 6，体积略大。
EXPORT_ZIP_COMPRESSLEVEL = 1
# --workers 0：min(32, cpu_count)；1：强制单线程（便于排查）；>1：指定线程数。
EXPORT_WORKERS_AUTO_CAP = 32


def _get_tiktoken_encoder():
    global _TIKTOKEN_ENCODER, _TIKTOKEN_IMPORT_FAILED
    if _TIKTOKEN_IMPORT_FAILED:
        return None
    if _TIKTOKEN_ENCODER is not None:
        return _TIKTOKEN_ENCODER
    try:
        import tiktoken

        _TIKTOKEN_ENCODER = tiktoken.get_encoding(TIKTOKEN_ENCODING_NAME)
        return _TIKTOKEN_ENCODER
    except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
        logger.warning("[export] tiktoken import or get_encoding failed", exc_info=True)
        _TIKTOKEN_IMPORT_FAILED = True
        return None


def count_text_tokens(text: str) -> int | None:
    """使用 tiktoken 统计 tokens；不可用时返回 None。"""
    enc = _get_tiktoken_encoder()
    if enc is None:
        return None
    if not text:
        return 0
    return len(enc.encode(text))


def _default_export_workers() -> int:
    n = os.cpu_count() or 4
    return max(1, min(EXPORT_WORKERS_AUTO_CAP, n))


def resolve_export_workers(workers: int) -> int:
    """解析 ``--workers``：0 为自动，1 为单线程，其余为显式线程数。"""
    if workers <= 0:
        return _default_export_workers()
    return workers


def sum_paths_tokens(
    paths: list[Path],
    *,
    project_root: Path | None = None,
    file_cache: dict[Path, "_FileExportCacheEntry"] | None = None,
) -> int | None:
    """对多个文件原文累计 token（各文件分别编码后相加）。"""
    enc = _get_tiktoken_encoder()
    if enc is None:
        return None
    total = 0
    for p in paths:
        if file_cache is not None:
            try:
                rp = p.resolve()
            except OSError:
                rp = None
            if rp is not None:
                entry = file_cache.get(rp)
                if entry is not None and entry.source_tokens is not None:
                    total += entry.source_tokens
                    continue
        try:
            text = (
                read_export_text(p, project_root)
                if project_root is not None
                else read_text_auto(p)
            )
            total += len(enc.encode(text))
        except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
            logger.warning("[export] sum_paths_tokens encode failed path=%s", p, exc_info=True)
            continue
    return total


def format_tokens_wan(n: int) -> str:
    """将 token 数写成「万」为单位（1 万 tokens → 1万；非整万保留两位小数）。"""
    if n % 10000 == 0:
        return f"{n // 10000}万"
    return f"{n / 10000.0:.2f}万"


def _tokens_header_line_for_exported_body(
    content: str,
    *,
    token_count: int | None = None,
) -> str:
    """对「将写入合并文件的正文」统计 tokens，供 FILE 块内单独一行展示。"""
    enc = _get_tiktoken_encoder()
    if enc is None:
        return f"TOKENS（{TIKTOKEN_ENCODING_NAME}）: （需 pip install tiktoken）"
    n = token_count if token_count is not None else len(enc.encode(content))
    return f"TOKENS（{TIKTOKEN_ENCODING_NAME}）: {format_tokens_wan(n)}（{n:,}）"


def _chatgpt_token_limit_lines(
    merged_export_tokens: int | None,
    *,
    limit: int = CHATGPT_DOCUMENT_TOKEN_LIMIT,
) -> list[str]:
    """相对 ChatGPT 单文档 token 参考上限的余量或超限说明（合并全文为准）。"""
    if merged_export_tokens is None:
        return []
    out: list[str] = [
        f"ChatGPT 文档 token 参考上限（文本类）: {format_tokens_wan(limit)}",
    ]
    if merged_export_tokens > limit:
        over = merged_export_tokens - limit
        out.append(f"警告：合并导出全文已超过上述参考上限（超出约 {format_tokens_wan(over)}）。")
    else:
        remaining = limit - merged_export_tokens
        out.append(f"合并导出全文相对上述上限尚余约 {format_tokens_wan(remaining)}。")
    return out


def _is_windows_reserved_output_basename(path: Path) -> bool:
    """Windows 将 NUL/CON/PRN 等当作设备；误用 ``-o NUL`` 会在当前目录生成 ``NUL_part01`` 等普通文件。"""
    if os.name != "nt":
        return False
    stem = path.stem.upper()
    if stem in {"NUL", "CON", "PRN", "AUX"}:
        return True
    if len(stem) == 4 and stem[:3] in {"COM", "LPT"} and stem[3].isdigit():
        return True
    return False


# =========================
# 始终附加在末尾的额外路径（相对项目根）；可为空；缺文件时仅在合并文内写「未找到」提示
# 例：["README.md", "workflows/example_navigate.py"]
# =========================
ADDITIONAL_INCLUDES: list[str] = []
# 单独导出日志时，对下列相对路径的大文件仅导出末尾字节。
EXPORT_LOG_RELATIVE_CANDIDATES: tuple[str, ...] = ()
EXPORT_LOG_GLOB_UNDER_LOGS: tuple[str, ...] = ("*.log",)
EXPORT_LOG_TAIL_MAX_BYTES = 800_000

# =========================
# 递归搜索：仅当 resolve 失败且给定的是「纯文件名」时，在项目内按名找第一个匹配
# =========================
ALLOW_RECURSIVE_SEARCH_BY_NAME = True

# 按文件名排除：密钥与 IDE 配置等不打进合并包。
IGNORE_FILE_BASENAMES = frozenset(
    {
        ".env",
        ".env.local",
        ".env.credentials",
        "workspace.xml",
        "log.txt",
    }
)

ALLOWED_SUFFIXES = {
    ".py",
    ".txt",
    ".log",
    ".md",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".bat",
    ".ps1",
    ".sh",
    ".css",
    ".html",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
}

_STDLIB_TOP: frozenset[str] | None = None

# 本仓库主要源码（用于文档/说明；实际收录以排除规则 + 后缀为准）
CORE_EXPORT_ROOT_FILES: frozenset[str] = frozenset(
    {
        "server.py",
        "gui.py",
        "client.user.js",
        "requirements.txt",
        "export_for_chatgpt.py",
    }
)


def _is_core_export_path(rel_posix: str) -> bool:
    """油猴+Python 联动：通过后缀与排除规则的文件均纳入（仅再挡 export 脚本 slim）。"""
    rel = str(rel_posix or "").strip().lower().replace("\\", "/")
    if not rel:
        return False
    if SLIM_SKIP_EXPORT_SCRIPT and rel == "export_for_chatgpt.py":
        return False
    return True


def _stdlib_top_level() -> frozenset[str]:
    global _STDLIB_TOP
    if _STDLIB_TOP is not None:
        return _STDLIB_TOP
    names: set[str] = set()
    if hasattr(sys, "stdlib_module_names"):
        names |= set(sys.stdlib_module_names)
    # 常见非 stdlib 但无项目文件时也不应误解析
    names |= {
        "browser_use",
        "playwright",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "openai",
        "pydantic",
        "dotenv",
        "numpy",
        "pandas",
        "cv2",
        "PIL",
        "requests",
        "httpx",
        "yaml",
    }
    _STDLIB_TOP = frozenset(names)
    return _STDLIB_TOP


def read_text_auto(file_path: Path) -> str:
    """
    Read text strictly as UTF-8.
    - do NOT use errors="replace"
    - caller should handle UnicodeDecodeError and decide to skip
    """
    return file_path.read_text(encoding="utf-8")


def _read_log_tail_utf8(file_path: Path, max_bytes: int) -> str:
    """读取日志末尾（自最近完整行起）；文件不超过 max_bytes 时读全文。"""
    size = file_path.stat().st_size
    if size <= max_bytes:
        return read_text_auto(file_path)
    read_size = min(size, max_bytes + 8192)
    with file_path.open("rb") as f:
        f.seek(size - read_size)
        raw = f.read()
    nl = raw.find(b"\n")
    if nl != -1:
        raw = raw[nl + 1 :]
    try:
        body = raw.decode("utf-8")
    except UnicodeDecodeError:
        body = raw.decode("utf-8", errors="replace")
    return (
        f"[导出说明] {file_path.name} 体积过大（共 {size:,} 字节），"
        f"以下仅包含文件末尾约 {len(raw):,} 字节（自最近完整行起）。\n\n"
        + body
    )


def _is_separate_log_export_path(rel_posix: str) -> bool:
    rel = str(rel_posix or "").strip().replace("\\", "/")
    if not rel:
        return False
    if rel in EXPORT_LOG_RELATIVE_CANDIDATES:
        return True
    bn = rel.rsplit("/", 1)[-1]
    return rel.startswith("logs/") and export_log_basename_should_skip_in_source_scan(bn)


def read_export_text(file_path: Path, project_root: Path) -> str:
    """导出用读文：单独导出的日志过大时仅读尾部。"""
    try:
        rel = file_path.resolve().relative_to(project_root.resolve()).as_posix()
    except (OSError, ValueError):
        rel = file_path.name
    rel_norm = rel.replace("\\", "/")
    if _is_separate_log_export_path(rel_norm) and file_path.suffix.lower() == ".log":
        return _read_log_tail_utf8(file_path, EXPORT_LOG_TAIL_MAX_BYTES)
    return read_text_auto(file_path)


def collect_export_log_paths(project_root: Path) -> list[Path]:
    """收集需单独导出的日志路径（不参与源码合并包扫描）。"""
    root = project_root.resolve()
    out: list[Path] = []
    seen: set[Path] = set()
    for rel in EXPORT_LOG_RELATIVE_CANDIDATES:
        candidate = root / rel
        if candidate.is_file():
            resolved = candidate.resolve()
            if resolved not in seen:
                seen.add(resolved)
                out.append(candidate)
    logs_dir = root / "logs"
    if logs_dir.is_dir():
        for pattern in EXPORT_LOG_GLOB_UNDER_LOGS:
            for candidate in sorted(logs_dir.glob(pattern)):
                if candidate.is_file():
                    resolved = candidate.resolve()
                    if resolved not in seen:
                        seen.add(resolved)
                        out.append(candidate)
    return out


def write_log_export_bundle(
    project_root: Path,
    output_path: Path | None = None,
    *,
    run_stats: dict | None = None,
) -> list[Path]:
    """将日志写入独立文件，不混入 ``0_merged_for_chatgpt.txt``。"""
    log_paths = collect_export_log_paths(project_root)
    out_path = (output_path or DEFAULT_LOG_OUTPUT).resolve()
    if not log_paths:
        if out_path.is_file():
            try:
                out_path.unlink()
            except OSError:
                logger.warning("[export] remove stale log bundle failed path=%s", out_path, exc_info=True)
        return []
    stats = run_stats if run_stats is not None else _RUN_STATS
    header_lines = [
        "=" * 100,
        "LOG EXPORT FOR CHATGPT / CURSOR (separate from source merge bundle)",
        f"Export time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Project: {project_root.resolve().name}",
        f"Log files: {len(log_paths)}",
        "=" * 100,
        "",
    ]
    body_parts: list[str] = []
    for fp in log_paths:
        try:
            body_parts.append(build_file_block(fp, project_root, run_stats=stats))
        except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError) as e:
            err_body = f"[读取失败] {type(e).__name__}: {e}"
            body_parts.append(
                "\n".join(
                    [
                        "\n" + "=" * 100,
                        f"FILE: {fp}",
                        "=" * 100,
                        "",
                        err_body,
                        "",
                    ]
                )
            )
    final_text = "\n".join([*header_lines, *body_parts]).rstrip() + "\n"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(final_text, encoding="utf-8")
    return [out_path.resolve()]


def _sanitize_export_text(content: str) -> str:
    """清洗导出正文中的占位符问号与强制屏蔽路径字面量。"""
    if not SANITIZE_PLACEHOLDER_QUESTION_RUNS or not content:
        sanitized = content
    else:
        sanitized = PLACEHOLDER_QUESTION_RUN_RE.sub("[QUESTION_PLACEHOLDER]", content)
    for literal in FORBIDDEN_EXPORT_TEXT_LITERALS:
        if literal in sanitized:
            sanitized = sanitized.replace(literal, "[EXCLUDED_PATH]")
    return sanitized


def is_ignored_path(path: Path) -> bool:
    rel, bn = _rel_posix_and_basename(path, PROJECT_ROOT)
    if not rel:
        return True
    return export_should_skip_relative_path(rel, basename=bn)


def _is_env_dotfile(name: str) -> bool:
    n = str(name or "").strip()
    if not n:
        return False
    # .env 与 .env.* 全部默认排除
    return n == ".env" or n.startswith(".env.")


def _is_export_output_artifact(name: str) -> bool:
    n = str(name or "").strip().lower()
    if not n:
        return False
    if n.startswith("0_merged_for_chatgpt"):
        return True
    return False


def _is_chrome_crx_cache_metadata(rel_posix_lower: str, low_name: str) -> bool:
    """Chrome profile 下 CRX 缓存目录里的 metadata.json 等为运行时自动生成，非源码。"""
    if low_name != "metadata.json":
        return False
    r = f"/{rel_posix_lower.strip().lower().replace(chr(92), '/')}/"
    return "/component_crx_cache/" in r or "/extensions_crx_cache/" in r


def _should_ignore_file(*, file_path: Path, project_root: Path, name: str) -> bool:
    rel, bn = _rel_posix_and_basename(file_path, project_root)
    if not rel:
        return True
    if export_should_skip_relative_path(rel, basename=bn or str(name or "").strip().lower()):
        return True
    if _is_env_dotfile(name):
        return True
    if bn in IGNORE_FILE_BASENAMES:
        return True
    return False


def _is_under_skills(path: Path, project_root: Path) -> bool:
    """相对项目根的路径中任一段为 skills 则排除（与 is_ignored_path 语义一致）。"""
    try:
        rel = path.resolve().relative_to(project_root.resolve())
    except ValueError:
        return False
    return any(p.lower() == "skills" for p in rel.parts)


def _filter_export_candidate_paths(paths: list[Path], project_root: Path) -> list[Path]:
    root = project_root.resolve()
    out: list[Path] = []
    for p in paths:
        try:
            rel = p.resolve().relative_to(root).as_posix()
        except ValueError:
            continue
        rel_low = rel.lower().replace("\\", "/")
        if _is_ignored_relative_path(rel_low):
            continue
        out.append(p)
    return out


def _is_ignored_relative_path(rel_posix: str) -> bool:
    rel_low = str(rel_posix or "").strip().lower().replace("\\", "/")
    if not rel_low:
        return False
    bn = rel_low.rsplit("/", 1)[-1]
    return export_should_skip_relative_path(rel_low, basename=bn)


def collect_all_project_files(
    project_root: Path,
    *,
    exclude_resolved: set[Path] | None = None,
    run_stats: dict | None = None,
) -> list[Path]:
    """遍历项目根，收集所有允许后缀的文件（去重、排序），用于「全量导出」。"""
    project_root = project_root.resolve()
    skip = exclude_resolved or set()
    found: set[Path] = set()
    for root, dirs, files in os.walk(project_root):
        root_path = Path(root)
        kept_dirs: list[str] = []
        for d in list(dirs):
            dp = root_path / d
            if should_exclude_path(dp, project_root):
                if run_stats is not None:
                    run_stats["excluded_dirs_count"] = int(run_stats.get("excluded_dirs_count", 0)) + 1
                    try:
                        _record_excluded_example(
                            run_stats, dp.resolve().relative_to(project_root).as_posix()
                        )
                    except (OSError, ValueError):
                        _record_excluded_example(run_stats, str(dp))
                continue
            kept_dirs.append(d)
        dirs[:] = kept_dirs
        for name in files:
            fp0 = root_path / name
            if should_exclude_path(fp0, project_root):
                if run_stats is not None:
                    run_stats["excluded_files_count"] = int(run_stats.get("excluded_files_count", 0)) + 1
                    try:
                        _record_excluded_example(
                            run_stats, fp0.resolve().relative_to(project_root).as_posix()
                        )
                    except (OSError, ValueError):
                        _record_excluded_example(run_stats, str(fp0))
                continue
            if _should_ignore_file(file_path=fp0, project_root=project_root, name=name):
                continue
            fp = fp0
            if not fp.is_file():
                continue
            if fp.suffix.lower() not in ALLOWED_SUFFIXES:
                continue
            if _should_ignore_file(file_path=fp, project_root=project_root, name=name):
                continue
            try:
                resolved = fp.resolve()
            except OSError:
                logger.warning("[export] collect_all_export_paths resolve failed path=%s", fp, exc_info=True)
                continue
            try:
                rel_posix = resolved.relative_to(project_root).as_posix().lower()
            except ValueError:
                logger.warning("[export] collect_all_export_paths relative_to failed resolved=%s", resolved, exc_info=True)
                continue
            if _is_ignored_relative_path(rel_posix):
                continue
            if not _is_core_export_path(rel_posix):
                if run_stats is not None:
                    run_stats["excluded_files_count"] = int(run_stats.get("excluded_files_count", 0)) + 1
                    _record_excluded_example(run_stats, rel_posix)
                continue
            if resolved in skip:
                continue
            if _is_under_skills(resolved, project_root):
                continue
            found.add(resolved)
    return sorted(found, key=lambda p: str(p).lower())


def find_file_by_name(project_root: Path, relative_or_name: str) -> Path | None:
    p = project_root / relative_or_name
    if p.is_file():
        if should_exclude_path(p, project_root):
            return None
        return p
    if not ALLOW_RECURSIVE_SEARCH_BY_NAME:
        return None
    target_name = Path(relative_or_name).name
    for root, dirs, files in os.walk(project_root):
        root_path = Path(root)
        kept_dirs: list[str] = []
        for d in list(dirs):
            dp = root_path / d
            if should_exclude_path(dp, project_root):
                continue
            kept_dirs.append(d)
        dirs[:] = kept_dirs
        if target_name in files:
            if _should_ignore_file(file_path=(root_path / target_name), project_root=project_root, name=target_name):
                continue
            candidate = root_path / target_name
            if candidate.is_file():
                if should_exclude_path(candidate, project_root):
                    continue
                return candidate
    return None


def build_header(
    *,
    project_root: Path,
    discovered: list[Path],
    extras: list[Path],
    loop_iteration: int | None = None,
    export_merge_sec: float | None = None,
    total_code_lines: int | None = None,
    source_code_tokens: int | None = None,
    merged_export_tokens: int | None = None,
) -> str:
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    project_name = project_root.resolve().name
    lines = [
        "=" * 100,
        "PROJECT EXPORT FOR CHATGPT / CURSOR",
        f"Export time: {now_str}",
        f"Project name: {project_name}",
        f"Project root: {project_root}",
        "Export mode: full project scan",
    ]
    if loop_iteration is not None:
        lines.append(f"循环次数: 第 {loop_iteration} 次")
    if export_merge_sec is not None:
        lines.append(f"本次合并耗时: {export_merge_sec:.2f}s（读取各文件并组装正文）")
    if total_code_lines is not None:
        lines.append(f"当前代码总行数: {total_code_lines}")
    if source_code_tokens is not None:
        lines.append(
            f"当前收录源码文件合计 tokens（{TIKTOKEN_ENCODING_NAME}）: {format_tokens_wan(source_code_tokens)}"
        )
    if merged_export_tokens is not None:
        lines.append(
            f"当前合并导出全文 tokens（{TIKTOKEN_ENCODING_NAME}）: {format_tokens_wan(merged_export_tokens)}"
        )
        lines.extend(_chatgpt_token_limit_lines(merged_export_tokens))
    lines.extend(
        [
            "=" * 100,
            "",
            "说明：",
        ]
    )
    lines.append("1. 本文件由 export_for_chatgpt.py 自动生成。")
    lines.extend(
        [
            "2. 全量模式：遍历项目内允许的扩展名，将匹配文件全部写入（见下方列表）。",
            "3. 每个文件前有分隔符、路径与「TOKENS」行（对应该块内正文，含占位符清洗后的内容）。",
            f"4. Token 计数使用 tiktoken（{TIKTOKEN_ENCODING_NAME}）；头部中的「参考上限」为 "
            f"{format_tokens_wan(CHATGPT_DOCUMENT_TOKEN_LIMIT)} tokens，与 ChatGPT 文本类文档常见上限对齐（非各产品官方保证）。",
            "",
        ]
    )
    lines.append("包含的文件（按路径排序）：")
    for i, p in enumerate(discovered, 1):
        try:
            rel = p.relative_to(project_root).as_posix()
        except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
            logger.warning("[export] header list relative_to failed path=%s", p, exc_info=True)
            rel = str(p)
        lines.append(f"  {i}. {rel}")
    if extras:
        lines.append("")
        lines.append("附加包含的文件：")
        for i, p in enumerate(extras, 1):
            try:
                rel = p.relative_to(project_root).as_posix()
            except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
                logger.warning("[export] header extras relative_to failed path=%s", p, exc_info=True)
                rel = str(p)
            lines.append(f"  {i}. {rel}")
    lines.extend(["", "-" * 100, ""])
    return "\n".join(lines)


@dataclass(frozen=True)
class _FileExportCacheEntry:
    """单文件合并阶段缓存，避免统计行数/tokens 时重复读盘。"""

    text: str
    lines: int
    source_tokens: int | None


def _prepare_export_file(
    file_path: Path,
    project_root: Path,
    *,
    run_stats: dict,
    stats_lock: threading.Lock | None = None,
) -> tuple[str, _FileExportCacheEntry | None, int | None]:
    """读取并组装单个 FILE 块；返回 (块正文, 缓存项, 整块 token 数)。"""
    try:
        rel_path = file_path.relative_to(project_root)
    except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
        logger.warning("[export] build_file_block relative_to failed file=%s", file_path, exc_info=True)
        rel_path = Path(file_path.name)
    suffix = file_path.suffix.lower()
    cache_entry: _FileExportCacheEntry | None = None
    source_tokens: int | None = None

    if suffix not in ALLOWED_SUFFIXES:
        content = f"[已跳过：不在允许导出后缀列表中] {file_path}"
    else:
        try:
            content_raw = read_export_text(file_path, project_root)
        except UnicodeDecodeError as exc:
            rel_err = None
            try:
                rel_err = file_path.resolve().relative_to(project_root.resolve()).as_posix()
            except (OSError, ValueError):
                rel_err = str(file_path)
            logger.error(
                "[export] read_text failed stage=utf8_decode file_path=%s reason=%s",
                rel_err,
                exc,
                exc_info=True,
            )
            content = f"[已跳过：UnicodeDecodeError] {rel_err} | {exc}"
        else:
            try:
                rel_posix = file_path.resolve().relative_to(project_root.resolve()).as_posix()
            except (OSError, ValueError):
                rel_posix = str(file_path)
            if suffix in {".py", ".json", ".qss", ".ui"}:
                if stats_lock is not None:
                    with stats_lock:
                        _scan_suspicious_encoding(
                            text=content_raw, rel_posix=rel_posix, run_stats=run_stats
                        )
                else:
                    _scan_suspicious_encoding(
                        text=content_raw, rel_posix=rel_posix, run_stats=run_stats
                    )
            content = _sanitize_export_text(content_raw)
            enc = _get_tiktoken_encoder()
            if enc is not None:
                source_tokens = len(enc.encode(content))
            cache_entry = _FileExportCacheEntry(
                text=content,
                lines=len(content.splitlines()),
                source_tokens=source_tokens,
            )

    tok_line = _tokens_header_line_for_exported_body(content, token_count=source_tokens)

    block = "\n".join(
        [
            "\n" + "=" * 100,
            f"FILE: {rel_path.as_posix()}",
            tok_line,
            "=" * 100,
            "",
            content.rstrip(),
            "\n",
        ]
    )
    enc = _get_tiktoken_encoder()
    block_tokens = len(enc.encode(block)) if enc is not None else None
    return block, cache_entry, block_tokens


def build_file_block(file_path: Path, project_root: Path, *, run_stats: dict) -> str:
    block, _, _ = _prepare_export_file(file_path, project_root, run_stats=run_stats)
    return block


def _error_file_block(file_path: Path, err: BaseException) -> str:
    err_body = f"[读取失败] {type(err).__name__}: {err}"
    return "\n".join(
        [
            "\n" + "=" * 100,
            f"FILE: {file_path}",
            _tokens_header_line_for_exported_body(err_body),
            "=" * 100,
            "",
            err_body,
            "",
        ]
    )


def _build_blocks_for_paths(
    paths: list[Path],
    project_root: Path,
    *,
    run_stats: dict,
    workers: int,
) -> tuple[list[str], dict[Path, _FileExportCacheEntry], list[int | None]]:
    """按 paths 顺序生成 FILE 块；workers>1 时用线程池并行读盘与编码。"""
    if not paths:
        return [], {}, []

    stats_lock = threading.Lock() if workers > 1 else None

    def _one(fp: Path) -> tuple[str, _FileExportCacheEntry | None, int | None]:
        try:
            return _prepare_export_file(
                fp, project_root, run_stats=run_stats, stats_lock=stats_lock
            )
        except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError) as e:
            block = _error_file_block(fp, e)
            enc = _get_tiktoken_encoder()
            block_tokens = len(enc.encode(block)) if enc is not None else None
            return block, None, block_tokens

    blocks: list[str] = []
    cache: dict[Path, _FileExportCacheEntry] = {}
    block_tokens: list[int | None] = []

    if workers <= 1:
        for fp in paths:
            block, entry, btok = _one(fp)
            blocks.append(block)
            block_tokens.append(btok)
            if entry is not None:
                try:
                    cache[fp.resolve()] = entry
                except OSError:
                    logger.warning("[export] cache key resolve failed path=%s", fp, exc_info=True)
        return blocks, cache, block_tokens

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        prepared = list(pool.map(_one, paths))
    for fp, (block, entry, btok) in zip(paths, prepared, strict=True):
        blocks.append(block)
        block_tokens.append(btok)
        if entry is not None:
            try:
                cache[fp.resolve()] = entry
            except OSError:
                logger.warning("[export] cache key resolve failed path=%s", fp, exc_info=True)
    return blocks, cache, block_tokens


def resolve_existing(project_root: Path, rel: str) -> Path | None:
    p = project_root / rel
    if p.is_file():
        return p
    return find_file_by_name(project_root, rel)


def _split_export_part_paths(output_path: Path) -> list[Path]:
    """与 ``write_merged_text_with_token_limit`` 一致的分片命名：``{stem}_partNN{suffix}``。"""
    parent = output_path.parent
    stem = output_path.stem
    suffix = output_path.suffix
    return sorted(parent.glob(f"{stem}_part*{suffix}"))


def _unlink_export_artifact(path: Path) -> bool:
    try:
        if path.is_file():
            path.unlink()
            return True
    except OSError:
        logger.warning("[export] unlink export artifact failed path=%s", path, exc_info=True)
    return False


def _iter_export_artifact_paths(project_root: Path, output_path: Path) -> list[Path]:
    """枚举可能存在的合并导出 txt / zip（主文件、分片及历史目录）。"""
    project_root = project_root.resolve()
    output_path = output_path.resolve()
    stem = output_path.stem
    suffix = output_path.suffix
    patterns = (
        f"{stem}{suffix}",
        f"{stem}_part*{suffix}",
        f"{stem}_export_metadata.txt",
        f"{stem}.zip",
        f"{stem}_part*.zip",
        "0_merged_for_chatgpt.txt",
        "0_merged_for_chatgpt_part*.txt",
        "0_merged_for_chatgpt.zip",
        "0_merged_for_chatgpt_part*.zip",
    )
    dirs: list[Path] = []
    for d in (output_path.parent, project_root, project_root / "project_config" / "exports"):
        try:
            dr = d.resolve()
        except OSError:
            continue
        if dr not in dirs and dr.is_dir():
            dirs.append(dr)

    found: list[Path] = []
    seen: set[Path] = set()
    for directory in dirs:
        for pattern in patterns:
            for p in directory.glob(pattern):
                try:
                    key = p.resolve()
                except OSError:
                    continue
                if key in seen:
                    continue
                seen.add(key)
                found.append(p)
    return found


def _cleanup_stale_export_artifacts(
    project_root: Path,
    output_path: Path,
    *,
    keep: set[Path],
) -> int:
    """
    本轮 txt / zip 全部写完后，删除不在 keep 集合中的旧导出文件。
    生成过程中保留上一轮文件，缩短「无可用导出包」的空窗期。
    """
    keep_resolved: set[Path] = set()
    for p in keep:
        try:
            keep_resolved.add(p.resolve())
        except OSError:
            logger.warning("[export] resolve keep path failed path=%s", p, exc_info=True)

    removed = 0
    seen_removed: set[Path] = set()
    for p in _iter_export_artifact_paths(project_root, output_path):
        try:
            rp = p.resolve()
        except OSError:
            continue
        if rp in keep_resolved or rp in seen_removed:
            continue
        if _unlink_export_artifact(p):
            removed += 1
            seen_removed.add(rp)
    return removed


def export_paths_to_exclude_from_scan(
    project_root: Path, output_path: Path
) -> set[Path]:
    """全量扫描时排除主输出路径及历史分片，避免把导出结果再次合并进去。"""
    project_root = project_root.resolve()
    out: set[Path] = {output_path.resolve()}
    try:
        out.add(
            output_path.with_name(f"{output_path.stem}_export_metadata.txt").resolve()
        )
    except OSError:
        logger.warning(
            "[export] resolve export metadata sibling failed output_path=%s",
            output_path,
            exc_info=True,
        )
    for p in _split_export_part_paths(output_path):
        if p.is_file():
            out.add(p.resolve())
    # 旧版写在仓库根目录的导出 / 分片，避免全量扫描再次打进去
    for legacy in (
        project_root / "0_merged_for_chatgpt.txt",
        project_root / "project_config" / "exports" / "0_merged_for_chatgpt.txt",
    ):
        try:
            if legacy.is_file():
                out.add(legacy.resolve())
        except OSError:
            logger.warning("[export] resolve legacy export path failed path=%s", legacy, exc_info=True)
    try:
        for p in project_root.glob("0_merged_for_chatgpt_part*.txt"):
            if p.is_file():
                out.add(p.resolve())
    except OSError:
        logger.warning("[export] glob root export parts failed root=%s", project_root, exc_info=True)
    try:
        exdir = project_root / "project_config" / "exports"
        if exdir.is_dir():
            for p in exdir.glob("0_merged_for_chatgpt_part*.txt"):
                if p.is_file():
                    out.add(p.resolve())
    except OSError:
        logger.warning("[export] glob exports dir parts failed exdir=%s", exdir, exc_info=True)
    # 若默认输出曾落在 docs/_exports/ 且与本次 output_path 不同，也排除另一套主文件+分片
    alt_base = project_root / "docs" / "_exports" / "0_merged_for_chatgpt.txt"
    if alt_base.resolve() != output_path.resolve():
        try:
            if alt_base.is_file():
                out.add(alt_base.resolve())
        except OSError:
            logger.warning("[export] resolve alt export base failed path=%s", alt_base, exc_info=True)
        try:
            for p in _split_export_part_paths(alt_base):
                if p.is_file():
                    out.add(p.resolve())
        except OSError:
            logger.warning("[export] collect alt export parts failed base=%s", alt_base, exc_info=True)
    return out


def _export_manifest_path(project_root: Path) -> Path:
    return project_root / ".export_for_chatgpt_mtimes.json"


def _load_export_manifest(project_root: Path) -> dict[str, float]:
    p = _export_manifest_path(project_root)
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {str(k): float(v) for k, v in data.items() if v is not None}
    except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
        logger.warning("[export] load manifest failed path=%s", p, exc_info=True)
    return {}


def _save_export_manifest(project_root: Path, mtime_by_rel: dict[str, float]) -> None:
    p = _export_manifest_path(project_root)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(mtime_by_rel, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        print(f"[警告] 无法写入增量清单 {p}: {e}", file=sys.stderr)


def _collect_full_scanned_candidates(
    project_root: Path, output_path: Path, *, run_stats: dict | None = None
) -> list[Path]:
    """全量扫描候选路径（与 export_bundle 中 incremental 之前的列表一致）。"""
    exclude_out = export_paths_to_exclude_from_scan(project_root, output_path)
    ordered_py = collect_all_project_files(
        project_root, exclude_resolved=exclude_out, run_stats=run_stats
    )
    ordered_py = [p for p in ordered_py if not _is_under_skills(p, project_root)]
    return _filter_export_candidate_paths(ordered_py, project_root)


def _filter_incremental_changed(
    project_root: Path,
    ordered_full: list[Path],
    manifest_prev: dict[str, float],
) -> list[Path]:
    """相对清单仅保留新增或 mtime 更新的路径（与 export_bundle 增量语义一致）。"""
    root = project_root.resolve()
    changed: list[Path] = []
    for p in ordered_full:
        try:
            rel = p.relative_to(root).as_posix()
            mtime = p.stat().st_mtime
        except (OSError, ValueError):
            continue
        old = manifest_prev.get(rel)
        if old is None or mtime > old + 1e-6:
            changed.append(p)
    return changed


def _resolve_export_extras(
    project_root: Path,
    ordered_py_for_dedup: list[Path],
    extra_names: Iterable[str],
) -> tuple[list[Path], list[str]]:
    """解析附加包含路径；``ordered_py_for_dedup`` 用于去重（与 export_bundle 一致，可为 incremental 过滤后的列表）。"""
    ordered_set = {p.resolve() for p in ordered_py_for_dedup}
    extras: list[Path] = []
    missing: list[str] = []
    for name in extra_names:
        p = resolve_existing(project_root, name)
        if p is None:
            missing.append(name)
            continue
        pr = p.resolve()
        if pr not in ordered_set and not _is_under_skills(p, project_root):
            extras.append(p)
    extras = _filter_export_candidate_paths(extras, project_root)
    return extras, missing


def _export_manifest_mtime_map(
    project_root: Path,
    ordered_full: list[Path],
    extras: list[Path],
) -> dict[str, float]:
    """写入清单用的相对路径 → mtime（全量扫描列表 + 本轮 extras）。"""
    root = project_root.resolve()
    mt: dict[str, float] = {}
    for p in ordered_full:
        try:
            rel = p.relative_to(root).as_posix()
            mt[rel] = p.stat().st_mtime
        except (OSError, ValueError):
            logger.warning("[export] manifest entry skip path=%s", p, exc_info=True)
    for p in extras:
        try:
            rel = p.relative_to(root).as_posix()
            mt[rel] = p.stat().st_mtime
        except (OSError, ValueError):
            logger.warning("[export] manifest extra entry skip path=%s", p, exc_info=True)
    return mt


def _mtime_maps_equal(a: dict[str, float], b: dict[str, float]) -> bool:
    if set(a.keys()) != set(b.keys()):
        return False
    for k in a:
        if abs(a[k] - b[k]) > 1e-6:
            return False
    return True


def _build_export_mtime_snapshot(
    project_root: Path,
    output_path: Path,
    extra_names: Iterable[str],
    *,
    incremental: bool,
) -> dict[str, float]:
    """与本轮 export_bundle 写盘后的清单语义一致的当前快照（用于循环模式下判断是否跳过导出）。"""
    root = project_root.resolve()
    ordered_full = _collect_full_scanned_candidates(root, output_path, run_stats=None)
    manifest_prev = _load_export_manifest(root) if incremental else {}
    ordered_merge = (
        _filter_incremental_changed(root, ordered_full, manifest_prev)
        if incremental and manifest_prev
        else list(ordered_full)
    )
    extras, _missing = _resolve_export_extras(root, ordered_merge, extra_names)
    return _export_manifest_mtime_map(root, ordered_full, extras)


def write_merged_text_with_token_limit(text: str, output_path: Path) -> list[Path]:
    """兼容旧调用：无 FILE 块信息时按 token 硬切（日志导出等）。"""
    global _WARNED_TOKEN_SPLIT_UNAVAILABLE  # noqa: PLW0603
    output_path.parent.mkdir(parents=True, exist_ok=True)
    enc = _get_tiktoken_encoder()

    def _write_single_file() -> list[Path]:
        output_path.write_text(text, encoding="utf-8")
        return [output_path.resolve()]

    if enc is None:
        if not _WARNED_TOKEN_SPLIT_UNAVAILABLE:
            print(
                "[提示] 未安装 tiktoken 或加载失败：无法按 token 拆片，始终写入单个文件。",
                file=sys.stderr,
            )
            _WARNED_TOKEN_SPLIT_UNAVAILABLE = True
        return _write_single_file()

    ids = enc.encode(text)
    ntok = len(ids)
    max_tok = MAX_TOKENS_PER_OUTPUT_FILE

    if ntok <= max_tok:
        return _write_single_file()

    written_paths: list[Path] = []
    start = 0
    part_idx = 0
    while start < ntok:
        end = min(start + max_tok, ntok)
        chunk_text = enc.decode(ids[start:end])
        part_idx += 1
        part_path = output_path.parent / (
            f"{output_path.stem}_part{part_idx:02d}{output_path.suffix}"
        )
        part_path.write_text(chunk_text, encoding="utf-8")
        written_paths.append(part_path.resolve())
        start = end

    return written_paths


def verify_export_zip(zip_path: Path) -> str | None:
    """``ZipFile.testzip()``；返回损坏条目名，无损坏则 None。"""
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            return zf.testzip()
    except (OSError, zipfile.BadZipFile, RuntimeError, ValueError) as exc:
        return f"<zip open failed: {exc}>"


def write_export_zip_archive(source_paths: list[Path], zip_path: Path) -> None:
    """将给定文件打入 zip（DEFLATE，覆盖同名 zip）；通常 ``source_paths`` 仅含一个 txt。"""
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        zip_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=EXPORT_ZIP_COMPRESSLEVEL,
    ) as zf:
        for p in source_paths:
            try:
                rp = p.resolve()
            except OSError:
                logger.warning("[export] zip resolve failed path=%s", p, exc_info=True)
                continue
            if not rp.is_file():
                logger.warning("[export] zip skip missing file path=%s", rp)
                continue
            zf.write(rp, arcname=rp.name)


def write_and_verify_export_zip(txt_path: Path, zip_path: Path) -> ExportPartMeta | None:
    """写入 zip 并立即 ``testzip``；失败返回带 ``zip_ok=False`` 的 meta，成功则 ``zip_ok=True``。"""
    label = txt_path.name
    try:
        write_export_zip_archive([txt_path], zip_path)
    except OSError as exc:
        print(f"[错误] ZIP 写入失败: {zip_path} | {exc}", file=sys.stderr)
        return ExportPartMeta(
            part_path=txt_path.resolve(),
            file_count=0,
            start_file=label,
            end_file=label,
            zip_path=zip_path,
            zip_ok=False,
            zip_error=str(exc),
        )
    bad = verify_export_zip(zip_path)
    zip_bytes: int | None = None
    try:
        zip_bytes = zip_path.stat().st_size
    except OSError:
        zip_bytes = None
    if bad is not None:
        print(
            f"[错误] ZIP 校验失败 testzip: part={zip_path.name} bad_entry={bad}",
            file=sys.stderr,
        )
        return ExportPartMeta(
            part_path=txt_path.resolve(),
            file_count=0,
            start_file=label,
            end_file=label,
            zip_path=zip_path,
            zip_bytes=zip_bytes,
            zip_ok=False,
            zip_error=str(bad),
        )
    return ExportPartMeta(
        part_path=txt_path.resolve(),
        file_count=0,
        start_file=label,
        end_file=label,
        zip_path=zip_path.resolve(),
        zip_bytes=zip_bytes,
        zip_ok=True,
    )


def test_all_export_zips(zip_paths: list[Path]) -> bool:
    """导出结束后对所有 zip 执行 testzip；有损坏则打印 part 与条目名。"""
    all_ok = True
    for zp in zip_paths:
        if not zp.is_file():
            print(f"[错误] ZIP 不存在: {zp}", file=sys.stderr)
            all_ok = False
            continue
        bad = verify_export_zip(zp)
        if bad is not None:
            print(
                f"[错误] 导出 ZIP 损坏: part={zp.name} bad_entry={bad}",
                file=sys.stderr,
            )
            all_ok = False
    return all_ok


def count_file_lines(path: Path) -> int:
    """统计文本文件行数（按换行符计；末行无换行符时仍计为一行）。"""
    line_count = 0
    last_byte = b""
    with path.open("rb") as f:
        while True:
            chunk = f.read(8 * 1024 * 1024)
            if not chunk:
                break
            line_count += chunk.count(b"\n")
            last_byte = chunk[-1:]
    if path.stat().st_size > 0 and last_byte != b"\n":
        line_count += 1
    return line_count


def format_byte_size(num_bytes: int) -> str:
    """人类可读的文件大小（B / KB / MB / GB）。"""
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024**2:
        return f"{num_bytes / 1024:.2f} KB"
    if num_bytes < 1024**3:
        return f"{num_bytes / 1024**2:.2f} MB"
    return f"{num_bytes / 1024**3:.2f} GB"


@dataclass(frozen=True)
class ExportPartMeta:
    """单个导出分片的 FILE 块统计（用于写盘日志与 zip 校验）。"""

    part_path: Path
    file_count: int
    start_file: str
    end_file: str
    zip_path: Path | None = None
    zip_bytes: int | None = None
    zip_ok: bool = True
    zip_error: str | None = None


def _file_label_from_export_block(block: str) -> str | None:
    for line in block.splitlines():
        if line.startswith("FILE: "):
            return line[6:].strip()
    return None


def _file_block_span(blocks: list[str]) -> tuple[int, str, str]:
    labels = [_file_label_from_export_block(b) for b in blocks]
    file_labels = [x for x in labels if x]
    if not file_labels:
        return 0, "（无）", "（无）"
    return len(file_labels), file_labels[0], file_labels[-1]


def _assemble_merged_export_text(prefix: str, blocks: list[str], *, tail: str = "") -> str:
    parts: list[str] = []
    if prefix:
        parts.append(prefix)
    parts.extend(blocks)
    if tail:
        parts.append(tail)
    return "\n".join(parts).rstrip() + "\n"


def write_merged_parts_from_file_blocks(
    header: str,
    body_parts: list[str],
    output_path: Path,
    *,
    block_token_counts: list[int | None] | None = None,
) -> tuple[list[Path], list[ExportPartMeta]]:
    """按完整 FILE 块边界拆分合并导出；首片含 header。统计类元数据请另写 *_export_metadata.txt。"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    enc = _get_tiktoken_encoder()
    max_tok = MAX_TOKENS_PER_OUTPUT_FILE

    def _token_len(text: str) -> int | None:
        if enc is None:
            return None
        return len(enc.encode(text)) if text else 0

    grouped: list[tuple[str, list[str]]] = []
    current_prefix = header
    current_blocks: list[str] = []

    if enc is None:
        grouped.append((header, list(body_parts)))
    else:
        block_toks: list[int] = []
        precomputed = (
            block_token_counts
            if block_token_counts is not None and len(block_token_counts) == len(body_parts)
            else None
        )
        for i, block in enumerate(body_parts):
            if precomputed is not None and precomputed[i] is not None:
                block_toks.append(precomputed[i])
                continue
            n = _token_len(block)
            block_toks.append(n if n is not None else max(1, len(block) // 3))

        join_tok = _token_len("\n") or 1
        current_tok = _token_len(header) or 0
        # 接近上限时再精确编码，避免对每个块都 encode 整段正文（O(n²) 极慢）。
        resync_threshold = int(max_tok * 0.92)

        def _exact_group_tok(prefix: str, blocks: list[str]) -> int:
            return _token_len(_assemble_merged_export_text(prefix, blocks)) or 0

        for block, block_tok in zip(body_parts, block_toks, strict=True):
            sep = join_tok if (current_prefix or current_blocks) else 0
            est_with = current_tok + sep + block_tok

            if current_blocks and est_with > resync_threshold:
                exact_with = _exact_group_tok(current_prefix, [*current_blocks, block])
                if exact_with > max_tok:
                    grouped.append((current_prefix, current_blocks))
                    current_prefix = ""
                    current_blocks = [block]
                    current_tok = block_tok
                    continue
                current_blocks.append(block)
                current_tok = exact_with
            else:
                current_blocks.append(block)
                current_tok = est_with

        if current_blocks:
            grouped.append((current_prefix, current_blocks))

    single_part = len(grouped) == 1
    written: list[Path] = []
    part_metas: list[ExportPartMeta] = []

    for idx, (prefix, blocks) in enumerate(grouped, 1):
        text = _assemble_merged_export_text(prefix, blocks)
        if single_part:
            part_path = output_path
        else:
            part_path = output_path.parent / (
                f"{output_path.stem}_part{idx:02d}{output_path.suffix}"
            )
        part_path.write_text(text, encoding="utf-8")
        resolved = part_path.resolve()
        written.append(resolved)
        file_count, start_file, end_file = _file_block_span(blocks)
        part_metas.append(
            ExportPartMeta(
                part_path=resolved,
                file_count=file_count,
                start_file=start_file,
                end_file=end_file,
            )
        )

    return written, part_metas


@dataclass(frozen=True)
class _SourceFileLineStat:
    rel_path: str
    lines: int
    functions: tuple[str, ...]


def extract_python_function_names(source: str) -> tuple[str, ...]:
    """提取 .py 顶层函数/类及类内方法名（供行数排行展示）。"""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return ()
    names: list[str] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.append(node.name)
        elif isinstance(node, ast.ClassDef):
            methods = [
                n.name
                for n in node.body
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            ]
            if methods:
                preview = ", ".join(methods[:6])
                if len(methods) > 6:
                    preview += f", …+{len(methods) - 6}"
                names.append(f"{node.name}({preview})")
            else:
                names.append(node.name)
    return tuple(names)


def _collect_source_file_line_stats(
    paths: list[Path],
    project_root: Path,
    *,
    file_cache: dict[Path, _FileExportCacheEntry] | None = None,
) -> tuple[int, list[_SourceFileLineStat]]:
    """统计各收录文件行数；.py 附带顶层函数/类名列表。"""
    root = project_root.resolve()
    stats: list[_SourceFileLineStat] = []
    total = 0
    seen: set[Path] = set()
    for p in paths:
        try:
            resolved = p.resolve()
        except OSError:
            logger.warning("[export] line stats resolve failed path=%s", p, exc_info=True)
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        text: str | None = None
        lines: int | None = None
        if file_cache is not None:
            entry = file_cache.get(resolved)
            if entry is not None:
                text = entry.text
                lines = entry.lines
        if text is None:
            try:
                text = read_export_text(p, project_root)
                lines = len(text.splitlines())
            except (OSError, UnicodeDecodeError, ValueError):
                logger.warning("[export] line stats read failed path=%s", p, exc_info=True)
                continue
        try:
            rel = resolved.relative_to(root).as_posix()
        except ValueError:
            logger.warning("[export] line stats relative_to failed path=%s", p, exc_info=True)
            continue
        funcs: tuple[str, ...] = ()
        if p.suffix.lower() == ".py":
            funcs = extract_python_function_names(text)
        stats.append(_SourceFileLineStat(rel_path=rel, lines=int(lines), functions=funcs))
        total += int(lines)
    return total, stats


def _ascii_table_lines(
    headers: tuple[str, ...],
    rows: list[tuple[str, ...]],
    *,
    aligns: tuple[str, ...] | None = None,
) -> list[str]:
    """生成带边框的 ASCII 表格行（列对齐：aligns 为每列 'l' 或 'r'）。"""
    if not headers:
        return []
    ncol = len(headers)
    widths = [len(h) for h in headers]
    for row in rows:
        for i in range(min(ncol, len(row))):
            widths[i] = max(widths[i], len(row[i]))

    def _pad(cell: str, col: int) -> str:
        w = widths[col]
        align = aligns[col] if aligns and col < len(aligns) else "l"
        return cell.rjust(w) if align == "r" else cell.ljust(w)

    def _row(cells: tuple[str, ...]) -> str:
        padded = [_pad(cells[i] if i < len(cells) else "", i) for i in range(ncol)]
        return "| " + " | ".join(padded) + " |"

    border = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    out = [border, _row(headers), border]
    for row in rows:
        out.append(_row(row))
    out.append(border)
    return out


def _print_ascii_table(
    headers: tuple[str, ...],
    rows: list[tuple[str, ...]],
    *,
    aligns: tuple[str, ...] | None = None,
) -> None:
    for line in _ascii_table_lines(headers, rows, aligns=aligns):
        print(line)


def _print_top_source_files_by_lines(
    stats: list[_SourceFileLineStat],
    total_lines: int,
    *,
    top_n: int = 10,
) -> None:
    """打印收录源码中行数前十名及占全库行数百分比（表格）。"""
    if not stats or total_lines <= 0:
        return
    ranked = sorted(stats, key=lambda s: s.lines, reverse=True)[:top_n]
    rows: list[tuple[str, ...]] = []
    for i, item in enumerate(ranked, 1):
        pct = 100.0 * item.lines / total_lines
        rows.append((str(i), f"{item.lines:,}", f"{pct:.2f}%", item.rel_path))
    print()
    print(f"[统计] 源码行数前十名（占收录源码合计 {total_lines:,} 行）：")
    _print_ascii_table(
        ("#", "行数", "占比", "文件路径"),
        rows,
        aligns=("r", "r", "r", "l"),
    )
    print()


def _print_written_artifacts_summary(
    written_txt_paths: list[Path],
    *,
    export_zip: bool,
    zip_by_txt: dict[Path, Path | None],
    part_metas: list[ExportPartMeta] | None = None,
    export_ok: bool = True,
) -> None:
    """打印本轮写出的每个 txt 行数及对应 zip 大小（表格）。"""
    if not export_ok:
        print("[错误] 导出未完全成功：存在 ZIP 校验失败或写入失败，请勿将损坏 zip 当作正常结果。", file=sys.stderr)
    if len(written_txt_paths) == 1:
        print("[完成] 导出文件：" if export_ok else "[部分失败] 导出文件：")
    else:
        print(
            f"[{'完成' if export_ok else '部分失败'}] 合并正文超过 {format_tokens_wan(MAX_TOKENS_PER_OUTPUT_FILE)} tokens"
            f"（{MAX_TOKENS_PER_OUTPUT_FILE:,}），已按完整 FILE 块拆成 {len(written_txt_paths)} 个文件："
        )
    meta_by_txt: dict[Path, ExportPartMeta] = {}
    if part_metas:
        for m in part_metas:
            meta_by_txt[m.part_path.resolve()] = m
    headers: tuple[str, ...]
    if export_zip:
        headers = ("#", "文件名", "FILE数", "起止文件", "TXT行数", "ZIP大小", "ZIP", "完整路径")
    else:
        headers = ("#", "文件名", "FILE数", "起止文件", "TXT行数", "完整路径")
    rows: list[tuple[str, ...]] = []
    for i, txt_path in enumerate(written_txt_paths, 1):
        try:
            txt_resolved = txt_path.resolve()
            lines = count_file_lines(txt_path)
            line_bit = f"{lines:,}"
        except OSError:
            txt_resolved = txt_path
            line_bit = "（无法统计）"
        path_bit = str(txt_resolved)
        pm = meta_by_txt.get(txt_resolved)
        file_n = str(pm.file_count) if pm else "-"
        span = (
            f"{pm.start_file} … {pm.end_file}"
            if pm and pm.start_file != pm.end_file
            else (pm.start_file if pm else "-")
        )
        if export_zip:
            zip_path = zip_by_txt.get(txt_resolved)
            zip_ok_bit = "OK"
            if pm is not None and not pm.zip_ok:
                zip_ok_bit = "FAIL"
            elif zip_path is None or not zip_path.is_file():
                zip_ok_bit = "缺失"
            if zip_path is not None and zip_path.is_file():
                try:
                    zip_bit = format_byte_size(zip_path.stat().st_size)
                except OSError:
                    zip_bit = "（无法读取）"
            else:
                zip_bit = "（未生成或失败）"
            rows.append((str(i), txt_path.name, file_n, span, line_bit, zip_bit, zip_ok_bit, path_bit))
        else:
            rows.append((str(i), txt_path.name, file_n, span, line_bit, path_bit))
    aligns: tuple[str, ...]
    if export_zip:
        aligns = ("r", "l", "r", "l", "r", "r", "c", "l")
    else:
        aligns = ("r", "l", "r", "l", "r", "l")
    print()
    _print_ascii_table(headers, rows, aligns=aligns)
    print()


def _print_export_timing_summary(
    *,
    project_name: str,
    loop_iteration: int | None,
    scan_sec: float,
    merge_sec: float,
    prepare_sec: float,
    write_sec: float,
    zip_sec: float,
    total_sec: float,
) -> None:
    """打印本轮导出分阶段耗时（在 zip / 日志等全部完成后输出）。"""
    parts = [
        f"扫描 {scan_sec:.2f}s",
        f"合并 {merge_sec:.2f}s",
        f"统计 {prepare_sec:.2f}s",
        f"写盘 {write_sec:.2f}s",
    ]
    if zip_sec >= 0.005:
        parts.append(f"压缩 {zip_sec:.2f}s")
    parts.append(f"合计 {total_sec:.2f}s")
    head = f"[项目] {project_name}"
    if loop_iteration is not None:
        head += f" | [统计] 第 {loop_iteration} 次"
    print(f"{head} | {' | '.join(parts)}")


def _zip_export_txt_part(txt_path: Path) -> tuple[Path, ExportPartMeta | None]:
    """压缩单个分片 txt 为同名 zip 并校验。"""
    zip_out = txt_path.with_suffix(".zip")
    try:
        txt_resolved = txt_path.resolve()
    except OSError:
        txt_resolved = txt_path
    return txt_resolved, write_and_verify_export_zip(txt_path, zip_out)


def export_bundle(
    *,
    project_root: Path,
    output_path: Path,
    extra_names: Iterable[str],
    loop_iteration: int | None = None,
    incremental: bool = False,
    export_zip: bool = True,
    workers: int = 0,
) -> float:
    """执行一轮导出；返回本轮总耗时（秒，含扫描/合并/写盘/压缩/日志等）。"""
    project_root = project_root.resolve()
    t_export0 = time.perf_counter()
    global _RUN_STATS  # noqa: PLW0603
    _RUN_STATS = {
        "excluded_files_count": 0,
        "excluded_dirs_count": 0,
        "excluded_examples": [],
        "suspicious_encoding_files": [],
    }
    ordered_py = _collect_full_scanned_candidates(project_root, output_path, run_stats=_RUN_STATS)
    full_project_files_for_manifest = list(ordered_py)

    manifest_prev = _load_export_manifest(project_root) if incremental else {}
    if incremental and manifest_prev:
        before_n = len(ordered_py)
        ordered_py = _filter_incremental_changed(project_root, ordered_py, manifest_prev)
        print(
            f"[增量] 仅包含相对上次 mtime 变更的文件：{len(ordered_py)}/{before_n} 个"
        )
    if incremental and not manifest_prev:
        print("[增量] 无历史 mtime 清单，本轮导出全部文件并写入清单。")
    extras, missing_extras = _resolve_export_extras(project_root, ordered_py, extra_names)

    worker_count = resolve_export_workers(workers)
    if worker_count > 1:
        print(f"[导出] 并行合并 FILE 块（workers={worker_count}）", flush=True)

    body_parts: list[str] = []
    block_token_counts: list[int | None] = []
    file_cache: dict[Path, _FileExportCacheEntry] = {}
    if missing_extras:
        body_parts.append(
            "\n".join(
                [
                    "以下「附加包含」路径未找到（已跳过）：",
                    *[f"  - {x}" for x in missing_extras],
                    "",
                    "-" * 100,
                    "",
                ]
            )
        )

    t_merge0 = time.perf_counter()
    scan_sec = t_merge0 - t_export0

    main_blocks, main_cache, main_block_tokens = _build_blocks_for_paths(
        ordered_py,
        project_root,
        run_stats=_RUN_STATS,
        workers=worker_count,
    )
    body_parts.extend(main_blocks)
    block_token_counts.extend(main_block_tokens)
    file_cache.update(main_cache)

    extra_blocks, extra_cache, extra_block_tokens = _build_blocks_for_paths(
        extras,
        project_root,
        run_stats=_RUN_STATS,
        workers=worker_count,
    )
    body_parts.extend(extra_blocks)
    block_token_counts.extend(extra_block_tokens)
    file_cache.update(extra_cache)

    merge_sec = time.perf_counter() - t_merge0
    t_after_merge = time.perf_counter()

    total_code_lines = 0
    for p in [*ordered_py, *extras]:
        try:
            rp = p.resolve()
        except OSError:
            logger.warning("[export] total_code_lines resolve failed path=%s", p, exc_info=True)
            continue
        entry = file_cache.get(rp)
        if entry is not None:
            total_code_lines += entry.lines
            continue
        try:
            total_code_lines += len(read_export_text(p, project_root).splitlines())
        except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
            logger.warning("[export] total_code_lines read failed path=%s", p, exc_info=True)
            continue

    def _header(
        merge: float | None,
        *,
        total_lines: int | None = None,
        merged_tokens: int | None = None,
        src_tokens: int | None = None,
    ) -> str:
        return build_header(
            project_root=project_root,
            discovered=ordered_py,
            extras=extras,
            loop_iteration=loop_iteration,
            export_merge_sec=merge,
            total_code_lines=total_lines,
            source_code_tokens=src_tokens,
            merged_export_tokens=merged_tokens,
        )

    header = _header(
        merge_sec if loop_iteration is not None else None,
        total_lines=total_code_lines,
    )
    final_text = "\n".join([header, *body_parts]).rstrip() + "\n"

    source_code_tokens = sum_paths_tokens(
        [*ordered_py, *extras],
        project_root=project_root,
        file_cache=file_cache,
    )
    merged_export_tokens: int | None = None
    header = _header(
        merge_sec if loop_iteration is not None else None,
        total_lines=total_code_lines,
        merged_tokens=None,
        src_tokens=source_code_tokens,
    )
    final_text = "\n".join([header, *body_parts]).rstrip() + "\n"
    merged_export_tokens = count_text_tokens(final_text)
    if merged_export_tokens is not None:
        for _ in range(4):
            header = _header(
                merge_sec if loop_iteration is not None else None,
                total_lines=total_code_lines,
                merged_tokens=merged_export_tokens,
                src_tokens=source_code_tokens,
            )
            final_text = "\n".join([header, *body_parts]).rstrip() + "\n"
            nt = count_text_tokens(final_text)
            if nt is None:
                merged_export_tokens = None
                break
            if nt == merged_export_tokens:
                break
            merged_export_tokens = nt

    rel_export_list: list[str] = []
    for p in [*ordered_py, *extras]:
        try:
            rel_export_list.append(p.relative_to(project_root).as_posix().lower())
        except ValueError:
            logger.exception("[export] relative path conversion failed before preflight check: %s", p)
            raise

    forbidden_hits = [
        rel
        for rel in rel_export_list
        if rel.startswith("_archive/")
        or rel.startswith("run_logs/")
        or rel.rsplit("/", 1)[-1].startswith("0_merged_for_chatgpt")
    ]
    if forbidden_hits:
        raise RuntimeError(
            "导出列表命中强制排除项（_archive/run_logs/0_merged_for_chatgpt*）: "
            + ", ".join(forbidden_hits[:10])
        )

    print(f"[导出前检查] 最终导出文件数量: {len(rel_export_list)}")
    if merged_export_tokens is not None:
        print(f"[导出前检查] 最终 token 总量: {merged_export_tokens:,}")
    else:
        print("[导出前检查] 最终 token 总量: （未安装 tiktoken，无法统计）")
    print(f"[导出前检查] 被排除目录数量: {int(_RUN_STATS.get('excluded_dirs_count', 0))}")
    excluded_examples = list(_RUN_STATS.get("excluded_examples", []))
    if excluded_examples:
        print("[导出前检查] 被排除典型样例:")
        for item in excluded_examples[:10]:
            print(f"  - {item}")

    if _TIKTOKEN_IMPORT_FAILED:
        print(
            "[提示] Token 统计需要 tiktoken，请执行: pip install tiktoken",
            file=sys.stderr,
        )

    stats_tail = ""
    if loop_iteration is not None:
        stats_lines = f"收录源码合计行数: {total_code_lines}\n"
        if source_code_tokens is not None:
            stats_lines += (
                f"收录源码合计 tokens（{TIKTOKEN_ENCODING_NAME}）: {format_tokens_wan(source_code_tokens)}\n"
            )
        if merged_export_tokens is not None:
            stats_lines += (
                f"合并导出全文 tokens（{TIKTOKEN_ENCODING_NAME}）: {format_tokens_wan(merged_export_tokens)}\n"
            )
            stats_lines += "\n".join(_chatgpt_token_limit_lines(merged_export_tokens)) + "\n"
        stats_tail = (
            f"\n\n{'=' * 100}\n"
            f"【以下为导出元数据，不属于上方任一 FILE 源码块】\n"
            f"导出附加统计（源码行数 + tokens，与上方「循环次数」为同一轮）\n"
            f"{stats_lines}"
            f"{'=' * 100}\n"
        )

    t_write0 = time.perf_counter()
    prepare_sec = t_write0 - t_after_merge
    tok_hint = f"，约 {merged_export_tokens:,} tokens" if merged_export_tokens is not None else ""
    print(
        f"[导出] 正在拆分写盘（{len(body_parts)} 个 FILE 块{tok_hint}），请稍候…",
        flush=True,
    )
    written, part_metas = write_merged_parts_from_file_blocks(
        header,
        body_parts,
        output_path,
        block_token_counts=block_token_counts if block_token_counts else None,
    )
    export_metadata_path: Path | None = None
    if stats_tail.strip():
        export_metadata_path = output_path.with_name(f"{output_path.stem}_export_metadata.txt")
        export_metadata_path.write_text(stats_tail.strip() + "\n", encoding="utf-8")
        print(
            f"[导出] 统计与说明已单独写入: {export_metadata_path.name}（未并入 FILE 源码块）",
            flush=True,
        )
    write_sec = time.perf_counter() - t_write0
    if loop_iteration is not None:
        project_name = project_root.resolve().name
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        tok_bits = ""
        if source_code_tokens is not None:
            tok_bits += f" | 源码合计 tokens（{TIKTOKEN_ENCODING_NAME}） {format_tokens_wan(source_code_tokens)}"
        if merged_export_tokens is not None:
            tok_bits += f" | 合并全文 tokens {format_tokens_wan(merged_export_tokens)}"
            over = merged_export_tokens - CHATGPT_DOCUMENT_TOKEN_LIMIT
            if over > 0:
                tok_bits += (
                    f" | 超过 ChatGPT 参考上限 {format_tokens_wan(CHATGPT_DOCUMENT_TOKEN_LIMIT)}"
                    f"（多 {format_tokens_wan(over)}）"
                )
            else:
                tok_bits += f" | 距上限余约 {format_tokens_wan(-over)}"
        print(
            f"[项目] {project_name} | [时间] {now_str} | 当前代码总行数 {total_code_lines}{tok_bits}"
        )
        if merged_export_tokens is not None and merged_export_tokens > CHATGPT_DOCUMENT_TOKEN_LIMIT:
            print(
                "[警告] 合并导出全文已超过 ChatGPT 单文档 token 参考上限 "
                f"（{format_tokens_wan(CHATGPT_DOCUMENT_TOKEN_LIMIT)}）。建议缩减导出范围或拆成多个文件上传。",
                file=sys.stderr,
            )

    stats_paths: list[Path] = []
    seen_stats: set[Path] = set()
    for p in [*full_project_files_for_manifest, *extras]:
        try:
            rp = p.resolve()
        except OSError:
            continue
        if rp in seen_stats:
            continue
        seen_stats.add(rp)
        stats_paths.append(p)
    _total_project_lines, project_line_stats = _collect_source_file_line_stats(
        stats_paths,
        project_root,
        file_cache=file_cache,
    )
    _print_top_source_files_by_lines(project_line_stats, _total_project_lines)

    zip_by_txt: dict[Path, Path | None] = {}
    keep_artifacts: set[Path] = set()
    export_zip_ok = True
    zip_paths_written: list[Path] = []
    zip_sec = 0.0
    if export_zip:
        t_zip0 = time.perf_counter()
        if len(written) > 1:
            zip_workers = min(worker_count, len(written)) if worker_count > 1 else 1
            print(
                f"[导出] 正在压缩 {len(written)} 个分片为 zip"
                f"{f'（workers={zip_workers}）' if zip_workers > 1 else ''}…",
                flush=True,
            )
        meta_by_part: dict[Path, ExportPartMeta] = {m.part_path.resolve(): m for m in part_metas}
        if worker_count > 1 and len(written) > 1:
            zip_workers = min(worker_count, len(written))
            with concurrent.futures.ThreadPoolExecutor(max_workers=zip_workers) as pool:
                zip_pairs = list(pool.map(_zip_export_txt_part, written))
        else:
            zip_pairs = [_zip_export_txt_part(txt_path) for txt_path in written]
        for txt_resolved, zip_meta in zip_pairs:
            keep_artifacts.add(txt_resolved)
            pm = meta_by_part.get(txt_resolved)
            if zip_meta is not None and zip_meta.zip_ok and zip_meta.zip_path is not None:
                zip_resolved = zip_meta.zip_path.resolve()
                zip_by_txt[txt_resolved] = zip_resolved
                keep_artifacts.add(zip_resolved)
                zip_paths_written.append(zip_resolved)
                if pm is not None:
                    idx = part_metas.index(pm)
                    part_metas = list(part_metas)
                    part_metas[idx] = ExportPartMeta(
                        part_path=pm.part_path,
                        file_count=pm.file_count,
                        start_file=pm.start_file,
                        end_file=pm.end_file,
                        zip_path=zip_resolved,
                        zip_bytes=zip_meta.zip_bytes,
                        zip_ok=True,
                    )
            else:
                zip_by_txt[txt_resolved] = None
                export_zip_ok = False
                if pm is not None:
                    print(
                        f"[错误] part={txt_resolved.name} FILE数={pm.file_count} "
                        f"起={pm.start_file} 止={pm.end_file} ZIP 未通过校验",
                        file=sys.stderr,
                    )
        zip_sec = time.perf_counter() - t_zip0
    else:
        for txt_path in written:
            try:
                keep_artifacts.add(txt_path.resolve())
            except OSError:
                keep_artifacts.add(txt_path)

    if export_metadata_path is not None:
        try:
            keep_artifacts.add(export_metadata_path.resolve())
        except OSError:
            keep_artifacts.add(export_metadata_path)

    if export_zip and zip_paths_written:
        if not test_all_export_zips(zip_paths_written):
            export_zip_ok = False

    removed_stale = _cleanup_stale_export_artifacts(
        project_root, output_path, keep=keep_artifacts
    )
    if removed_stale:
        print(f"[导出] 新文件已就绪，已清理旧导出文件 {removed_stale} 个（txt / zip）")

    if export_zip_ok and export_zip:
        for pm in part_metas:
            zb = pm.zip_bytes
            zsize = format_byte_size(zb) if zb is not None else "（未知）"
            print(
                f"[完成] {pm.part_path.name}: FILE块={pm.file_count} "
                f"起={pm.start_file} 止={pm.end_file} zip={zsize}"
            )

    _print_written_artifacts_summary(
        written,
        export_zip=export_zip,
        zip_by_txt=zip_by_txt,
        part_metas=part_metas,
        export_ok=export_zip_ok if export_zip else True,
    )

    log_written = write_log_export_bundle(project_root, run_stats=_RUN_STATS)
    if log_written:
        print(
            f"[完成] 日志已单独导出: {log_written[0]} "
            f"（{len(collect_export_log_paths(project_root))} 个日志文件，未混入源码合并包）"
        )

    if full_project_files_for_manifest:
        mt = _export_manifest_mtime_map(project_root, full_project_files_for_manifest, extras)
        _save_export_manifest(project_root, mt)

    # 行数 / tokens 已在上方「[项目] | [时间]」一行输出；此处不再重复（除非未打印该块的调用方）。
    done_suffix = ""
    if loop_iteration is None:
        done_suffix += f" | 代码总行数 {total_code_lines}"
        if source_code_tokens is not None:
            done_suffix += f" | 源码合计 tokens {format_tokens_wan(source_code_tokens)}"
        if merged_export_tokens is not None:
            done_suffix += f" | 合并全文 tokens {format_tokens_wan(merged_export_tokens)}"
            if merged_export_tokens > CHATGPT_DOCUMENT_TOKEN_LIMIT:
                done_suffix += (
                    f" | 超过 ChatGPT 参考上限 {format_tokens_wan(CHATGPT_DOCUMENT_TOKEN_LIMIT)} "
                    f"（多 {format_tokens_wan(merged_export_tokens - CHATGPT_DOCUMENT_TOKEN_LIMIT)}）"
                )
    export_total_sec = time.perf_counter() - t_export0
    project_name = project_root.resolve().name
    _print_export_timing_summary(
        project_name=project_name,
        loop_iteration=loop_iteration,
        scan_sec=scan_sec,
        merge_sec=merge_sec,
        prepare_sec=prepare_sec,
        write_sec=write_sec,
        zip_sec=zip_sec,
        total_sec=export_total_sec,
    )
    print(
        f"[完成] 合并文件数: {len(ordered_py) + len(extras)}"
        f"（全量扫描 {len(ordered_py)} + 附加 {len(extras)}）"
        f" | 本轮耗时 {export_total_sec:.2f}s{done_suffix}"
    )
    return export_total_sec


def _format_launch_command() -> str:
    """还原本次启动命令行（python 可执行文件 + 脚本路径 + 参数）。"""
    parts: list[str] = [str(Path(sys.executable).resolve())]
    script = Path(sys.argv[0]).resolve() if sys.argv else Path(__file__).resolve()
    if script.suffix.lower() in {".py", ".pyw"}:
        parts.append(str(script))
    elif sys.argv:
        parts.append(sys.argv[0])
    if len(sys.argv) > 1:
        parts.extend(sys.argv[1:])
    return " ".join(parts)


def _print_export_cycle_separator(
    cycle: int,
    *,
    ended: bool = False,
    elapsed_sec: float | None = None,
) -> None:
    """循环导出时，在每轮开始或结束处打印醒目分隔线（次数编号置于分隔线中央）。"""
    line = "=" * LOOP_EXPORT_CYCLE_SEPARATOR_WIDTH
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    phase = "结束" if ended else "开始"
    print()
    print(line)
    print(f"第 {cycle} 次导出")
    if ended and elapsed_sec is not None:
        print(f"  {phase} | {now_str} | 本轮耗时 {elapsed_sec:.2f}s")
    else:
        print(f"  {phase} | {now_str}")
    print(line)
    print()


def _print_session_startup_banner(
    *,
    project_name: str,
    loop_mode: bool,
    loop_always: bool,
    cycle: int = 1,
) -> None:
    """进程启动时打印一次：导出次数、启动命令、循环说明（若有）、项目名。"""
    print(f"第 {cycle} 次导出：{_format_launch_command()}")
    if loop_mode:
        if loop_always:
            print(
                f"[循环] 每 {LOOP_EXPORT_INTERVAL_SEC:g} 秒导出一次，覆盖写入输出路径（Ctrl+C 结束）"
            )
        else:
            print(
                f"[循环] 每 {LOOP_EXPORT_INTERVAL_SEC:g} 秒检查变更，有变更时才导出并覆盖写入输出路径（Ctrl+C 结束）"
            )
    print(f"[项目] {project_name}")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
            logger.warning("[export] stdout.reconfigure(utf-8) failed", exc_info=True)
    if hasattr(sys.stderr, "reconfigure"):
        try:
            sys.stderr.reconfigure(encoding="utf-8")
        except (AttributeError, ImportError, KeyError, OSError, RuntimeError, TypeError, ValueError):
            logger.warning("[export] stderr.reconfigure(utf-8) failed", exc_info=True)
    _stdlib_top_level()
    parser = argparse.ArgumentParser(
        description=(
            "将项目源码与配置合并为文本：默认按固定间隔循环检查文件变更，"
            "有变更时才覆盖导出；"
            f"输出固定为 {DEFAULT_OUTPUT.name}；"
            f"超过 {MAX_TOKENS_PER_OUTPUT_FILE:,} tokens（{format_tokens_wan(MAX_TOKENS_PER_OUTPUT_FILE)}）自动按 token 拆片。"
        )
    )
    parser.add_argument(
        "--extra",
        action="append",
        dest="extras",
        metavar="PATH",
        help="额外包含的相对路径（可多次指定；仅当文件未被全量扫描收录时加入）",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="只执行一轮导出后退出（默认循环导出）",
    )
    parser.add_argument(
        "--loop-always-export",
        action="store_true",
        help=(
            "循环模式下每轮都执行导出（忽略 mtime 清单跳过逻辑）；"
            "默认仅在候选文件相对上次导出有变化时才写盘。"
        ),
    )
    parser.add_argument(
        "--include-runtime-state",
        action="store_true",
        help=(
            "显式包含本地运行状态（例如 config/local、runs、outputs、state、runtime_profile.json）。"
            "默认关闭以避免导出污染与潜在敏感信息。"
        ),
    )
    parser.add_argument(
        "--include-logs",
        action="store_true",
        help="显式包含日志与快照文件（如 *.log、*.jsonl、*snapshot*.txt）。默认关闭。",
    )
    parser.add_argument(
        "--include-claude",
        action="store_true",
        help="显式包含 .claude/** 本地工具目录。默认关闭。",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help=(
            "本会话首轮导出仍为全量合并；从第二轮起仅合并相对上次 mtime 有变化的文件 "
            "（清单：.export_for_chatgpt_mtimes.json）"
        ),
    )
    parser.add_argument(
        "--include-tests",
        action="store_true",
        help="包含 tests/（默认排除以缩小合并包）",
    )
    parser.add_argument(
        "--include-tools",
        action="store_true",
        help="包含 tools/（默认排除）",
    )
    parser.add_argument(
        "--include-scripts",
        action="store_true",
        help="包含 scripts/（默认排除）",
    )
    parser.add_argument(
        "--include-data-accounts",
        action="store_true",
        help="包含 data/accounts/（默认排除本地账号数据）",
    )
    parser.add_argument(
        "--include-export-script",
        action="store_true",
        help="包含仓库根 export_for_chatgpt.py（默认排除）",
    )
    parser.add_argument(
        "--no-export-zip",
        action="store_true",
        help=(
            "不为本轮写出的每个 txt 生成同名 .zip（默认单文件为 "
            f"{DEFAULT_ZIP_OUTPUT.name}，多分片则为各 *_partNN.zip）"
        ),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=0,
        metavar="N",
        help=(
            "并行读取/合并 FILE 块与多分片 zip 的线程数；"
            f"0=自动（min({EXPORT_WORKERS_AUTO_CAP}, CPU 核数)），1=单线程"
        ),
    )
    args = parser.parse_args()
    global INCLUDE_RUNTIME_STATE, INCLUDE_LOGS, INCLUDE_CLAUDE  # noqa: PLW0603
    global SLIM_SKIP_TESTS, SLIM_SKIP_TOOLS, SLIM_SKIP_SCRIPTS  # noqa: PLW0603
    global SLIM_SKIP_DATA_ACCOUNTS, SLIM_SKIP_EXPORT_SCRIPT  # noqa: PLW0603
    INCLUDE_RUNTIME_STATE = bool(args.include_runtime_state)
    INCLUDE_LOGS = bool(args.include_logs)
    INCLUDE_CLAUDE = bool(args.include_claude)
    SLIM_SKIP_TESTS = not bool(args.include_tests)
    SLIM_SKIP_TOOLS = not bool(args.include_tools)
    SLIM_SKIP_SCRIPTS = not bool(args.include_scripts)
    SLIM_SKIP_DATA_ACCOUNTS = not bool(args.include_data_accounts)
    SLIM_SKIP_EXPORT_SCRIPT = not bool(args.include_export_script)

    output_path = DEFAULT_OUTPUT.resolve()
    if _is_windows_reserved_output_basename(output_path):
        print(
            "[错误] 默认输出文件名不能为 Windows 保留设备名（NUL、CON 等）。请重命名 DEFAULT_OUTPUT。",
            file=sys.stderr,
        )
        raise SystemExit(2)

    extras = list(ADDITIONAL_INCLUDES)
    if args.extras:
        extras.extend(args.extras)

    # --incremental：本会话第一次导出必须全量「组合」，避免「相对清单无变更 → 合并 0 个文件」。
    incremental_active = False

    loop_mode = not bool(args.once)

    def run_export(cycle: int) -> None:
        nonlocal incremental_active
        if loop_mode:
            _print_export_cycle_separator(cycle, ended=False)
            if cycle > 1:
                print(f"[项目] {PROJECT_ROOT.resolve().name}")
        use_incremental = bool(args.incremental) and incremental_active
        elapsed_sec = export_bundle(
            project_root=PROJECT_ROOT,
            output_path=output_path,
            extra_names=extras,
            loop_iteration=cycle,
            incremental=use_incremental,
            export_zip=not bool(args.no_export_zip),
            workers=int(args.workers),
        )
        incremental_active = True
        if loop_mode:
            _print_export_cycle_separator(cycle, ended=True, elapsed_sec=elapsed_sec)

    project_name = PROJECT_ROOT.resolve().name
    cycle = 0
    if args.once:
        _print_session_startup_banner(project_name=project_name, loop_mode=False, loop_always=False)
        run_export(1)
        return
    loop_always = bool(getattr(args, "loop_always_export", False))
    _print_session_startup_banner(
        project_name=project_name,
        loop_mode=True,
        loop_always=loop_always,
    )
    try:
        while True:
            # 首轮循环强制导出一次；从第二轮开始才依据清单判断是否跳过。
            if not loop_always and cycle > 0:
                manifest_disk = _load_export_manifest(PROJECT_ROOT)
                snap = _build_export_mtime_snapshot(
                    PROJECT_ROOT,
                    output_path,
                    extras,
                    incremental=bool(args.incremental),
                )
                if manifest_disk and _mtime_maps_equal(snap, manifest_disk):
                    print(
                        f"[循环] 无文件变更，跳过导出（距上次清单一致） | {PROJECT_ROOT.resolve().name}"
                    )
                    time.sleep(LOOP_EXPORT_INTERVAL_SEC)
                    continue
            cycle += 1
            run_export(cycle)
            time.sleep(LOOP_EXPORT_INTERVAL_SEC)
    except KeyboardInterrupt:
        print("\n[循环] 已停止。")


if __name__ == "__main__":
    main()
