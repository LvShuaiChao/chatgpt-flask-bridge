# tools/create_dead_code_cleanup_baseline.py

from __future__ import annotations

import hashlib
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from shutil import which

from _common import PROJECT_ROOT as ROOT, read_text_safe
OUT_FILE = ROOT / "docs" / "dead_code_cleanup_baseline.md"

KEY_FILES = [
    "app/core/job_scheduler.py",
    "app/utils/legacy_cleanup.py",
    "app/utils/bridge_payload.py",
    "app/models.py",
    "app/constants.py",
]

GENERATED_ARTIFACTS = [
    "client.user.js",
    "chatgpt-toolbox/dist/client.user.js",
]

MUST_KEEP_SYMBOLS = [
    ("app/utils/legacy_cleanup.py", "LEGACY_FIELD_NAMES"),
    ("app/utils/legacy_cleanup.py", "assert_no_legacy_fields"),
    ("app/utils/legacy_cleanup.py", "reject_legacy_fields"),
    ("app/utils/bridge_payload.py", "validate_outbound_queue_message"),
    ("app/utils/bridge_payload.py", "assert_no_legacy_fields"),
]

RG_CHECKS = [
    ("job_get_status", r'job.get\("status"\)'),
    ("j_get_status", r'j.get\("status"\)'),
    ("default_auto_config", "DEFAULT_AUTO_CONFIG"),
    ("pending_reply_stale_timeout", "PENDING_REPLY_STALE_TIMEOUT_SEC"),
    ("status_chip_text", "status_chip_text"),
]

SKIP_DIR_NAMES = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "exports",
    "runtime",
}

SKIP_FILE_NAMES = {
    OUT_FILE.name,
    "0_merged_for_chatgpt.txt",
}


def sha256_file(path: Path) -> str:
    if not path.exists() or not path.is_file():
        return "-"

    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def python_rg_fallback(pattern: str) -> str:
    regex = re.compile(pattern)
    hits: list[str] = []

    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.name in SKIP_FILE_NAMES:
            continue
        if path.resolve() == OUT_FILE.resolve():
            continue
        if any(part in SKIP_DIR_NAMES for part in path.parts):
            continue

        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            print(f"[DEAD_CODE_BASELINE][WARN] skip {path}: {exc}", file=sys.stderr)
            continue

        rel = path.relative_to(ROOT).as_posix()
        for line_no, line in enumerate(text.splitlines(), start=1):
            if regex.search(line):
                hits.append(f"{rel}:{line_no}:{line}")

    return "\n".join(hits).strip()


def run_rg(pattern: str) -> str:
    rg_exe = which("rg")
    if not rg_exe:
        return python_rg_fallback(pattern)

    cmd = [
        rg_exe,
        "-n",
        pattern,
        ".",
        "-g",
        f"!{OUT_FILE.relative_to(ROOT).as_posix()}",
        "-g",
        "!0_merged_for_chatgpt.txt",
    ]
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    output = result.stdout or ""
    return output.strip()


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    lines = []
    lines.append("# Dead Code Cleanup Baseline")
    lines.append("")
    lines.append(f"created_at={datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"python={sys.executable}")
    lines.append("")

    lines.append("## 1. Key File Hashes")
    lines.append("")
    lines.append("| path | exists | sha256 |")
    lines.append("|---|---:|---|")

    for rel_path in KEY_FILES:
        path = ROOT / rel_path
        exists = path.exists()
        file_hash = sha256_file(path)
        lines.append(f"| `{rel_path}` | `{exists}` | `{file_hash}` |")

    lines.append("")
    lines.append("## 生成产物说明")
    lines.append("")
    lines.append(
        "以下文件由 `cd chatgpt-toolbox && npm run build` 生成，"
        "**不作为**当前导出源码快照的强制存在项，也**不做** sha256 强校验："
    )
    lines.append("")
    for rel_path in GENERATED_ARTIFACTS:
        lines.append(f"- `{rel_path}`")
    lines.append("")
    lines.append("验证方式：")
    lines.append("")
    lines.append(
        "- 禁止手工编辑上述文件；源码审查对象是 "
        "`chatgpt-toolbox/tampermonkey-userscript-src/`。"
    )
    lines.append("- 需要产物时运行 `npm run build`。")
    lines.append(
        "- 合并导出快照通常不收录上述文件；缺失不代表 dead code。"
    )
    lines.append("")
    lines.append("## 2. Must-Keep Symbols")
    lines.append("")
    lines.append("| path | symbol | exists |")
    lines.append("|---|---|---:|")

    for rel_path, symbol in MUST_KEEP_SYMBOLS:
        path = ROOT / rel_path
        text = read_text_safe(path)
        exists = symbol in text
        lines.append(f"| `{rel_path}` | `{symbol}` | `{exists}` |")

    lines.append("")
    lines.append("## 3. rg Checks")
    lines.append("")
    lines.append("以下结果用于记录清理前状态，不代表全部都要删除。")
    lines.append("")

    for name, pattern in RG_CHECKS:
        lines.append(f"### {name}")
        lines.append("")
        lines.append(f"pattern=`{pattern}`")
        lines.append("")
        output = run_rg(pattern)
        if output:
            lines.append("```text")
            lines.append(output[:12000])
            lines.append("```")
        else:
            lines.append("无匹配。")
        lines.append("")

    OUT_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"[DEAD_CODE_BASELINE][OK] wrote {OUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
