from pathlib import Path
import json

PROJECT_ROOT = Path.cwd()
REPORT_PATH = PROJECT_ROOT / "reports" / "non_runtime_cleanup_report.md"
BUILD_ORDER_PATH = PROJECT_ROOT / "chatgpt-toolbox" / "tampermonkey-userscript-src" / ".build-order.json"
TM_SRC_DIR = PROJECT_ROOT / "chatgpt-toolbox" / "tampermonkey-userscript-src"

NON_RUNTIME_PATTERNS = [
    "button_state_audit_report.md",
    "docs/dead_code_review_summary.md",
    "docs/dead_code_cleanup_rules.md",
    "docs/cursor_dead_code_cleanup_master_task.md",
    "docs/dead_code_cleanup_report.md",
    "docs/dead_code_cleanup_baseline.md",
    "docs/dead_code_cleanup_manifest.json",
    "docs/dead_code_ignore_manifest.json",
    "docs/dead_code_manual_smoke_test.md",
    ".github/pull_request_template_dead_code.md",
    ".github/workflows/dead-code-cleanup-checks.yml",
    "cursor_templates",
    "Prompt备份",
]


def count_lines(path: Path) -> int:
    if path.is_dir():
        total = 0
        for child in path.rglob("*"):
            if child.is_file():
                total += count_lines(child)
        return total
    text = path.read_text(encoding="utf-8", errors="replace")
    return text.count("\n") + 1


def load_build_order() -> set[str]:
    data = json.loads(BUILD_ORDER_PATH.read_text(encoding="utf-8"))
    parts = data.get("parts", [])
    return {str(item).replace("\\", "/") for item in parts}


def collect_not_in_build_order() -> list[Path]:
    build_parts = load_build_order()
    result = []
    for js_file in TM_SRC_DIR.rglob("*.js"):
        rel = js_file.relative_to(TM_SRC_DIR).as_posix()
        if rel not in build_parts:
            result.append(js_file)
    return sorted(result)


def collect_non_runtime_files() -> list[Path]:
    result = []
    for pattern in NON_RUNTIME_PATTERNS:
        path = PROJECT_ROOT / pattern
        if path.exists():
            result.append(path)
    return result


def format_path(path: Path) -> str:
    return path.relative_to(PROJECT_ROOT).as_posix()


def main():
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)

    not_in_build = collect_not_in_build_order()
    non_runtime_files = collect_non_runtime_files()

    lines = []
    lines.append("# Non-runtime cleanup report")
    lines.append("")
    lines.append("## 1. JS files not included by .build-order.json")
    lines.append("")
    lines.append("| lines | path |")
    lines.append("|---:|---|")
    total_not_in_build = 0
    for path in not_in_build:
        line_count = count_lines(path)
        total_not_in_build += line_count
        lines.append(f"| {line_count} | `{format_path(path)}` |")
    lines.append("")
    lines.append(f"Total not-in-build JS lines: **{total_not_in_build}**")
    lines.append("")
    lines.append("## 2. Non-runtime docs / reports / templates")
    lines.append("")
    lines.append("| lines | path |")
    lines.append("|---:|---|")
    total_non_runtime = 0
    for path in non_runtime_files:
        line_count = count_lines(path)
        total_non_runtime += line_count
        lines.append(f"| {line_count} | `{format_path(path)}` |")
    lines.append("")
    lines.append(f"Total non-runtime lines: **{total_non_runtime}**")
    lines.append("")
    lines.append("## 3. Suggested action")
    lines.append("")
    lines.append(
        "Move these files to `_archive/non_runtime_20260602/` first. "
        "Do not permanently delete before build and smoke tests pass."
    )

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report written to: {REPORT_PATH}")


if __name__ == "__main__":
    main()
