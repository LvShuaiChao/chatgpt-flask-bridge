# tools/find_dead_artifact_files.py

from __future__ import annotations

from pathlib import Path

from _common import PROJECT_ROOT as ROOT, rel

IGNORE_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
}

GENERATED_OR_CACHE_DIR_NAMES = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
    "runtime",
    "logs",
    "tmp",
    "temp",
    "cache",
    "caches",
}

SUSPICIOUS_SUFFIXES = {
    ".pyc",
    ".pyo",
    ".log",
    ".tmp",
    ".bak",
    ".backup",
    ".old",
    ".orig",
    ".swp",
    ".swo",
}

SUSPICIOUS_NAME_PARTS = [
    "backup",
    "bak",
    "old",
    "copy",
    "副本",
    "备份",
    "临时",
    "temp",
    "tmp",
    "merged_for_chatgpt",
    "粘贴的文本",
]

GENERATED_KEEP_FILES = {
    "client.user.js",
}


def classify(path: Path) -> str:
    parts = set(path.parts)
    name_lower = path.name.lower()
    rel_path = rel(path)

    if path.name in GENERATED_KEEP_FILES:
        return "generated_runtime_artifact_keep"

    if parts.intersection(GENERATED_OR_CACHE_DIR_NAMES):
        return "generated_or_cache_dir_candidate"

    if path.suffix.lower() in SUSPICIOUS_SUFFIXES:
        return "temporary_or_backup_file_candidate"

    for marker in SUSPICIOUS_NAME_PARTS:
        if marker.lower() in name_lower.lower() or marker.lower() in rel_path.lower():
            return "historical_export_or_backup_candidate"

    return ""


def iter_files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue

        if any(part in IGNORE_DIRS for part in path.parts):
            continue

        yield path


def main() -> int:
    print("[DEAD_ARTIFACT_FILES][START]")

    count = 0

    for path in iter_files():
        category = classify(path)
        if not category:
            continue

        count += 1
        size = path.stat().st_size
        print(
            f"[DEAD_ARTIFACT_FILE_CANDIDATE] {rel(path)} "
            f"category={category} size={size}"
        )

    print(f"[DEAD_ARTIFACT_FILES][DONE] hits={count}")
    print(
        "以上只是候选清单。client.user.js 这类运行产物不能直接删除；"
        "logs/runtime/build/dist 是否清理取决于项目发布和调试策略。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
