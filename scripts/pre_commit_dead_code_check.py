# scripts/pre_commit_dead_code_check.py

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from _common import PROJECT_ROOT as ROOT


def run_check() -> int:
    cmd = [sys.executable, "tools/run_dead_code_cleanup_checks.py"]

    print("[PRE_COMMIT_DEAD_CODE_CHECK][START]")
    print("[PRE_COMMIT_DEAD_CODE_CHECK][CMD]", " ".join(cmd))

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

    if result.returncode != 0:
        print(f"[PRE_COMMIT_DEAD_CODE_CHECK][FAILED] returncode={result.returncode}")
        return result.returncode

    print("[PRE_COMMIT_DEAD_CODE_CHECK][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_check())
