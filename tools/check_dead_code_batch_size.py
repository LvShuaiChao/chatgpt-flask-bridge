# tools/check_dead_code_batch_size.py

from __future__ import annotations

import subprocess
from pathlib import Path

from _common import PROJECT_ROOT as ROOT

MAX_DELETED_LINES_SOFT = 400
MAX_FILES_CHANGED_SOFT = 20

HIGH_RISK_PATH_MARKERS = [
    "app/utils/legacy_cleanup.py",
    "app/utils/bridge_payload.py",
    "app/server/",
    "app/ui/",
    "app/widgets/",
    "app/mixins/",
    "client.user.js",
]

HIGH_RISK_TEXT_MARKERS = [
    "assert_no_legacy_fields",
    "reject_legacy_fields",
    "validate_outbound_queue_message",
    "@app.route",
    ".route(",
    "Blueprint(",
    ".connect(",
    "clicked.connect",
    "pyqtSignal",
    "pyqtSlot",
]


def run_git_diff(args: list[str]) -> str:
    cmd = ["git", *args]
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return result.stdout or ""


def parse_changed_files(name_only_output: str) -> list[str]:
    paths: list[str] = []
    for line in name_only_output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("warning:"):
            continue
        paths.append(stripped)
    return paths


def main() -> int:
    print("[DEAD_CODE_BATCH_SIZE][START]")

    stat = run_git_diff(["diff", "--numstat"])
    name_only = run_git_diff(["diff", "--name-only"])
    patch = run_git_diff(["diff", "--"])

    changed_files = parse_changed_files(name_only)

    deleted_lines = 0
    for line in stat.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue

        deleted = parts[1]
        if deleted.isdigit():
            deleted_lines += int(deleted)

    warnings: list[str] = []

    if len(changed_files) > MAX_FILES_CHANGED_SOFT:
        warnings.append(
            f"changed_files={len(changed_files)} exceeds soft limit {MAX_FILES_CHANGED_SOFT}"
        )

    if deleted_lines > MAX_DELETED_LINES_SOFT:
        warnings.append(
            f"deleted_lines={deleted_lines} exceeds soft limit {MAX_DELETED_LINES_SOFT}"
        )

    for path in changed_files:
        normalized = path.replace("\\", "/")
        for marker in HIGH_RISK_PATH_MARKERS:
            if marker in normalized:
                warnings.append(f"high_risk_path_changed={normalized}")
                break

    for marker in HIGH_RISK_TEXT_MARKERS:
        if marker in patch:
            warnings.append(f"high_risk_text_marker_in_diff={marker}")

    print(f"[DEAD_CODE_BATCH_SIZE][FILES] count={len(changed_files)}")
    for path in changed_files:
        print(f"- {path}")

    print(f"[DEAD_CODE_BATCH_SIZE][DELETED_LINES] count={deleted_lines}")

    if warnings:
        print("[DEAD_CODE_BATCH_SIZE][WARN]")
        for warning in warnings:
            print(f"- {warning}")
        print("这些是风险提醒，不代表必须失败；请确认本批次是否过大或涉及高风险入口。")
        return 0

    print("[DEAD_CODE_BATCH_SIZE][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
