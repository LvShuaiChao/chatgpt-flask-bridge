# scripts/install_git_hooks.py

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from _common import PROJECT_ROOT as ROOT

HOOKS_DIR = ROOT / ".git" / "hooks"
PRE_COMMIT = HOOKS_DIR / "pre-commit"

HOOK_CONTENT = """#!/bin/sh
python scripts/pre_commit_dead_code_check.py
status=$?
if [ $status -ne 0 ]; then
  echo "[GIT_HOOK][FAILED] dead code cleanup checks failed"
  exit $status
fi
exit 0
"""


def main() -> int:
    if not HOOKS_DIR.exists():
        print(f"[INSTALL_GIT_HOOKS][FAILED] hooks dir not found: {HOOKS_DIR}")
        return 1

    PRE_COMMIT.write_text(HOOK_CONTENT, encoding="utf-8")
    print(f"[INSTALL_GIT_HOOKS][OK] wrote {PRE_COMMIT}")
    print("[INSTALL_GIT_HOOKS][NOTE] On Windows Git Bash can run this hook directly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
