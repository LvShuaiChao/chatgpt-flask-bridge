"""Aggregate dead-code scanner output into a risk-tiered review report."""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_FILE = ROOT / "docs" / "dead_code_review_summary.md"

SCAN_COMMANDS = [
    {
        "name": "dead_code_candidates",
        "cmd": [sys.executable, "tools/find_dead_code_candidates.py"],
    },
    {
        "name": "python_dead_statements",
        "cmd": [sys.executable, "tools/find_python_dead_statements.py"],
    },
    {
        "name": "orphan_python_modules",
        "cmd": [sys.executable, "tools/find_orphan_python_modules.py"],
    },
    {
        "name": "js_dead_code_candidates",
        "cmd": [sys.executable, "tools/find_js_dead_code_candidates.py"],
    },
    {
        "name": "commented_dead_code_candidates",
        "cmd": [sys.executable, "tools/find_commented_dead_code_candidates.py"],
    },
    {
        "name": "dead_config_keys",
        "cmd": [sys.executable, "tools/find_dead_config_keys.py"],
    },
    {
        "name": "stale_tests_candidates",
        "cmd": [sys.executable, "tools/find_stale_tests_candidates.py"],
    },
    {
        "name": "feature_flag_dead_code_candidates",
        "cmd": [sys.executable, "tools/find_feature_flag_dead_code_candidates.py"],
    },
    {
        "name": "api_route_usage_candidates",
        "cmd": [sys.executable, "tools/find_api_route_usage_candidates.py"],
    },
    {
        "name": "dead_artifact_files",
        "cmd": [sys.executable, "tools/find_dead_artifact_files.py"],
    },
]

HIGH_RISK_MARKERS = [
    "[MUST_KEEP_SYMBOLS][FAILED]",
    "[DEAD_CODE_REGRESSION][FAILED]",
    "[MISSING_ROUTE_CANDIDATE]",
    "[STALE_TEST_CANDIDATE]",
    "possible_stale_behavior_test",
    "possible_live_legacy_usage",
]

MEDIUM_RISK_MARKERS = [
    "[UNUSED_ROUTE_CANDIDATE]",
    "[ORPHAN_PY_MODULE_CANDIDATE]",
    "[JS_UNUSED_DECL_CANDIDATE]",
    "[UNREACHABLE_STATEMENT_CANDIDATE]",
    "[JS_UNREACHABLE_STATEMENT_CANDIDATE]",
    "[COMMENTED_DEAD_CODE_CANDIDATE]",
    "[FEATURE_FLAG_CANDIDATE]",
]

LOW_RISK_MARKERS = [
    "[UNUSED_IMPORT_CANDIDATE]",
    "[DEAD_ARTIFACT_FILE_CANDIDATE]",
    "generated_runtime_artifact_keep",
    "safe_guard_or_migration_context",
    "safe_guard_or_migration_test",
]


def run_command(name: str, cmd: list[str]) -> tuple[int, str]:
    print(f"[DEAD_CODE_SUMMARY][RUN] name={name} cmd={' '.join(cmd)}")

    result = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    output = result.stdout or ""
    return result.returncode, output


def classify_line(line: str) -> str:
    for marker in HIGH_RISK_MARKERS:
        if marker in line:
            return "high"

    for marker in MEDIUM_RISK_MARKERS:
        if marker in line:
            return "medium"

    for marker in LOW_RISK_MARKERS:
        if marker in line:
            return "low"

    return ""


def main() -> int:
    print("[DEAD_CODE_SUMMARY][START]")

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    grouped: dict[str, list[tuple[str, str] | tuple[str, int]]] = {
        "high": [],
        "medium": [],
        "low": [],
        "raw": [],
        "failed_commands": [],
    }

    for item in SCAN_COMMANDS:
        name = item["name"]
        returncode, output = run_command(name, item["cmd"])

        if returncode != 0:
            grouped["failed_commands"].append((name, returncode))

        grouped["raw"].append((name, output))

        for line in output.splitlines():
            level = classify_line(line)
            if level:
                grouped[level].append((name, line))

    lines: list[str] = []
    lines.append("# Dead Code Review Summary")
    lines.append("")
    lines.append(f"created_at={datetime.now().isoformat(timespec='seconds')}")
    lines.append("")
    lines.append("本报告由候选扫描脚本生成，只用于人工审查，不允许自动删除代码。")
    lines.append("")

    lines.append("## Failed Commands")
    lines.append("")
    if grouped["failed_commands"]:
        for name, returncode in grouped["failed_commands"]:
            lines.append(f"- `{name}` returncode=`{returncode}`")
    else:
        lines.append("无。")
    lines.append("")

    for level, title in (
        ("high", "High Priority / High Risk Candidates"),
        ("medium", "Medium Priority Candidates"),
        ("low", "Low Priority / Informational Candidates"),
    ):
        lines.append(f"## {title}")
        lines.append("")

        items = grouped[level]
        if not items:
            lines.append("无。")
            lines.append("")
            continue

        for name, line in items:
            lines.append(f"- `{name}`: `{line[:500]}`")
        lines.append("")

    lines.append("## Raw Scanner Output")
    lines.append("")
    for name, output in grouped["raw"]:
        lines.append(f"### {name}")
        lines.append("")
        lines.append("```text")
        lines.append(output[:20000])
        lines.append("```")
        lines.append("")

    lines.append("## Review Rule")
    lines.append("")
    lines.append("- high：优先人工确认，通常代表旧字段真实残留、接口断链、过期测试或强校验失败。")
    lines.append("- medium：进入候选清单，但必须结合动态引用、GUI 冒烟和测试确认。")
    lines.append("- low：多为信息项或低风险清理项，不应影响主流程。")
    lines.append("- 所有等级都不允许脚本自动删除。")

    OUT_FILE.write_text("\n".join(lines), encoding="utf-8")

    print(f"[DEAD_CODE_SUMMARY][OK] wrote {OUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
