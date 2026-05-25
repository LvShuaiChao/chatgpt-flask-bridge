# tools/check_dead_code_toolchain.py

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_COMMANDS = [
    {
        "name": "python",
        "cmd": [sys.executable, "--version"],
        "required": True,
    },
    {
        "name": "compileall",
        "cmd": [sys.executable, "-m", "compileall", "-h"],
        "required": True,
    },
    {
        "name": "rg",
        "cmd": ["rg", "--version"],
        "required": False,
    },
    {
        "name": "pytest",
        "cmd": [sys.executable, "-m", "pytest", "--version"],
        "required": False,
    },
    {
        "name": "npm",
        "cmd": ["npm", "--version"],
        "required": False,
    },
]

REQUIRED_PATHS = [
    "app",
    "tools",
]

OPTIONAL_PATHS = [
    "tests",
    "docs",
    "tampermonkey-userscript-src",
    "client.user.js",
    "tools/search_text_fallback.py",
]

SEARCH_TEXT_FALLBACK_REL = "tools/search_text_fallback.py"


def command_exists(cmd: list[str]) -> bool:
    executable = cmd[0]

    if executable == sys.executable:
        return Path(sys.executable).exists()

    return shutil.which(executable) is not None


def run_command(name: str, cmd: list[str], required: bool) -> bool:
    print(f"[TOOLCHAIN][CHECK] name={name} cmd={' '.join(cmd)} required={required}")

    if not command_exists(cmd):
        level = "FAILED" if required else "WARN"
        print(f"[TOOLCHAIN][{level}] name={name} reason=command_not_found")
        return not required

    try:
        result = subprocess.run(
            cmd,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
    except (FileNotFoundError, OSError) as exc:
        level = "FAILED" if required else "WARN"
        print(f"[TOOLCHAIN][{level}] name={name} reason=command_launch_failed error={exc}")
        return not required

    output = (result.stdout or "").strip()
    if output:
        first_line = output.splitlines()[0]
        print(f"[TOOLCHAIN][OUTPUT] name={name} {first_line}")

    if result.returncode != 0:
        level = "FAILED" if required else "WARN"
        print(f"[TOOLCHAIN][{level}] name={name} returncode={result.returncode}")
        return not required

    print(f"[TOOLCHAIN][OK] name={name}")
    return True


def rg_available() -> bool:
    if not command_exists(["rg", "--version"]):
        return False
    try:
        result = subprocess.run(
            ["rg", "--version"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
    except (FileNotFoundError, OSError):
        return False
    return result.returncode == 0


def check_rg_fallback() -> None:
    if rg_available():
        print("[TOOLCHAIN][OK] rg available; prefer rg for search")
        return

    fallback_path = ROOT / SEARCH_TEXT_FALLBACK_REL
    if fallback_path.is_file():
        print(
            "[TOOLCHAIN][WARN] rg missing; fallback available: "
            f"python {SEARCH_TEXT_FALLBACK_REL} <pattern>"
        )
    else:
        print(
            f"[TOOLCHAIN][WARN] rg missing; fallback script not found: "
            f"{SEARCH_TEXT_FALLBACK_REL}"
        )


def check_paths() -> bool:
    ok = True

    for rel_path in REQUIRED_PATHS:
        path = ROOT / rel_path
        if path.exists():
            print(f"[TOOLCHAIN][PATH_OK] required path={rel_path}")
        else:
            print(f"[TOOLCHAIN][PATH_FAILED] required path={rel_path}")
            ok = False

    for rel_path in OPTIONAL_PATHS:
        path = ROOT / rel_path
        if path.exists():
            print(f"[TOOLCHAIN][PATH_OK] optional path={rel_path}")
        else:
            print(f"[TOOLCHAIN][PATH_WARN] optional path={rel_path} missing")

    return ok


def main() -> int:
    print("[DEAD_CODE_TOOLCHAIN][START]")

    ok = True

    if not check_paths():
        ok = False

    for item in REQUIRED_COMMANDS:
        if not run_command(
            name=item["name"],
            cmd=item["cmd"],
            required=item["required"],
        ):
            ok = False

    check_rg_fallback()

    if not ok:
        print("[DEAD_CODE_TOOLCHAIN][FAILED]")
        return 1

    print("[DEAD_CODE_TOOLCHAIN][OK]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
