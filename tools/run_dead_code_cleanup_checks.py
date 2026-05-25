"""Unified acceptance entry for dead-code cleanup verification."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

COMMANDS = [
    {
        "name": "dead_code_toolchain",
        "cmd": [sys.executable, "tools/check_dead_code_toolchain.py"],
        "required": True,
    },
    {
        "name": "compile_python",
        "cmd": [sys.executable, "-m", "compileall", "-q", "app", "GUI.py"],
        "required": True,
    },
    {
        "name": "dead_code_candidates",
        "cmd": [sys.executable, "tools/find_dead_code_candidates.py"],
        "required": True,
    },
    {
        "name": "python_dead_statements",
        "cmd": [sys.executable, "tools/find_python_dead_statements.py"],
        "required": True,
    },
    {
        "name": "orphan_python_modules",
        "cmd": [sys.executable, "tools/find_orphan_python_modules.py"],
        "required": True,
    },
    {
        "name": "stale_tests_candidates",
        "cmd": [sys.executable, "tools/find_stale_tests_candidates.py"],
        "required": True,
    },
    {
        "name": "feature_flag_dead_code_candidates",
        "cmd": [sys.executable, "tools/find_feature_flag_dead_code_candidates.py"],
        "required": True,
    },
    {
        "name": "api_route_usage_candidates",
        "cmd": [sys.executable, "tools/find_api_route_usage_candidates.py"],
        "required": True,
    },
    {
        "name": "dynamic_reference_entries",
        "cmd": [sys.executable, "tools/find_dynamic_reference_entries.py"],
        "required": True,
    },
    {
        "name": "dead_code_regression",
        "cmd": [sys.executable, "tools/check_dead_code_regression.py"],
        "required": True,
    },
    {
        "name": "must_keep_symbols",
        "cmd": [sys.executable, "tools/check_must_keep_symbols.py"],
        "required": True,
    },
    {
        "name": "dead_code_manifest",
        "cmd": [sys.executable, "tools/check_dead_code_manifest.py"],
        "required": True,
    },
    {
        "name": "dead_code_ignore_manifest",
        "cmd": [sys.executable, "tools/check_dead_code_ignore_manifest.py"],
        "required": True,
    },
    {
        "name": "dead_code_docs_consistency",
        "cmd": [sys.executable, "tools/check_dead_code_docs_consistency.py"],
        "required": True,
    },
    {
        "name": "runtime_log_scan",
        "cmd": [sys.executable, "tools/scan_runtime_logs_after_dead_code_cleanup.py"],
        "required": False,
    },
    {
        "name": "dead_artifact_files",
        "cmd": [sys.executable, "tools/find_dead_artifact_files.py"],
        "required": False,
    },
    {
        "name": "dead_code_batch_size",
        "cmd": [sys.executable, "tools/check_dead_code_batch_size.py"],
        "required": False,
    },
]

OPTIONAL_PYTEST_COMMANDS = [
    {
        "name": "job_scheduler_status_migration_tests",
        "cmd": [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "tests/test_job_scheduler_status_migration.py",
        ],
    },
    {
        "name": "bridge_payload_legacy_guard_tests",
        "cmd": [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "tests/test_bridge_payload_legacy_guard.py",
        ],
    },
    {
        "name": "stale_pending_reply_tests",
        "cmd": [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "tests/test_stale_pending_reply.py",
        ],
    },
]


def run_command(name: str, cmd: list[str], required: bool = True) -> bool:
    print(f"\n[CHECK][START] name={name}")
    print(f"[CHECK][CMD] {' '.join(cmd)}")

    result = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    output = result.stdout or ""
    if output.strip():
        print(output.rstrip())

    if result.returncode == 0:
        print(f"[CHECK][OK] name={name}")
        return True

    level = "FAILED" if required else "SKIPPED_OR_FAILED"
    print(f"[CHECK][{level}] name={name} returncode={result.returncode}")

    if required:
        return False

    return True


def path_exists_for_command(cmd: list[str]) -> bool:
    for part in cmd:
        if part.startswith("tests/") or part.startswith("tools/"):
            if not (ROOT / part).exists():
                return False
    return True


def main() -> int:
    print("[DEAD_CODE_CLEANUP_CHECKS][START]")

    failed: list[str] = []

    for item in COMMANDS:
        ok = run_command(
            name=item["name"],
            cmd=item["cmd"],
            required=item["required"],
        )
        if not ok:
            failed.append(item["name"])

    for item in OPTIONAL_PYTEST_COMMANDS:
        if not path_exists_for_command(item["cmd"]):
            print(f"\n[CHECK][SKIP] name={item['name']} reason=test_file_not_found")
            continue

        ok = run_command(
            name=item["name"],
            cmd=item["cmd"],
            required=True,
        )
        if not ok:
            failed.append(item["name"])

    if failed:
        print("\n[DEAD_CODE_CLEANUP_CHECKS][FAILED]")
        for name in failed:
            print(f"- {name}")
        return 1

    print("\n[DEAD_CODE_CLEANUP_CHECKS][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
