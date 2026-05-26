# tools/find_feature_flag_dead_code_candidates.py

from __future__ import annotations

from pathlib import Path

from _common import DEFAULT_IGNORE_DIRS, PROJECT_ROOT as ROOT

TARGET_SUFFIXES = {
    ".py",
    ".js",
    ".ts",
    ".json",
    ".md",
    ".txt",
}

FEATURE_FLAG_PATTERNS = [
    "DEBUG_",
    "debug",
    "verbose",
    "trace",
    "feature",
    "Feature",
    "experimental",
    "legacy",
    "deprecated",
    "compat",
    "fallback",
    "migration",
    "migrate",
    "use_legacy",
    "enable_",
    "disable_",
    "AUTO_",
    "ENV",
    "os.environ",
    "process.env",
    "GM_getValue",
    "GM_setValue",
    "localStorage",
    "settings.value",
    "QSettings",
]

SAFE_KEEP_HINTS = [
    "guard",
    "migration",
    "fallback",
    "debug",
    "trace",
    "diagnostic",
    "compat",
    "legacy",
    "deprecated",
    "旧配置",
    "迁移",
    "兜底",
    "调试",
]


def iter_files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue

        if path.suffix.lower() not in TARGET_SUFFIXES:
            continue

        if any(part in DEFAULT_IGNORE_DIRS for part in path.parts):
            continue

        yield path


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def classify_line(line: str) -> str:
    lowered = line.lower()

    for hint in SAFE_KEEP_HINTS:
        if hint.lower() in lowered:
            return "likely_guard_or_diagnostic"

    return "needs_manual_review"


def main() -> int:
    print("[FEATURE_FLAG_DEAD_CODE_SCAN][START]")

    hit_count = 0

    for path in iter_files():
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

        for line_no, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped:
                continue

            for pattern in FEATURE_FLAG_PATTERNS:
                if pattern not in line:
                    continue

                hit_count += 1
                context = classify_line(line)

                print(
                    f"[FEATURE_FLAG_CANDIDATE] {rel(path)}:{line_no} "
                    f"pattern={pattern} context={context} line={stripped[:220]}"
                )
                break

    print(f"[FEATURE_FLAG_DEAD_CODE_SCAN][DONE] hits={hit_count}")
    print(
        "以上只是候选清单。功能开关、调试开关、fallback、migration、legacy guard "
        "都可能是低频但必要逻辑，不能自动删除。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
