"""Scan dynamic reference entry points (Qt/Flask/fetch/getattr/etc.).

Output is for manual review before dead-code deletion — not a zombie-code list.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

TARGET_SUFFIXES = {".py", ".js", ".md"}

IGNORE_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "runtime",
    "logs",
    "dist",
    "build",
}

# 构建产物：不作为源码级动态入口扫描输入（改 tampermonkey-userscript-src/ 后 npm run build）
GENERATED_SKIP_REL = frozenset(
    {
        "client.user.js",
        "chatgpt-toolbox/dist/client.user.js",
    }
)

PATTERNS = [
    ("QT_CONNECT", re.compile(r"\.connect\s*\(")),
    ("QT_CLICKED_CONNECT", re.compile(r"clicked\s*\.\s*connect\s*\(")),
    ("QT_TIMEOUT_CONNECT", re.compile(r"timeout\s*\.\s*connect\s*\(")),
    ("PY_GETATTR", re.compile(r"getattr\s*\(")),
    ("PY_SETATTR", re.compile(r"setattr\s*\(")),
    ("FLASK_ROUTE", re.compile(r"@\w+\.route\s*\(")),
    ("FLASK_BLUEPRINT", re.compile(r"\bBlueprint\s*\(")),
    ("FLASK_ADD_URL_RULE", re.compile(r"\badd_url_rule\s*\(")),
    ("FETCH_API", re.compile(r"\bfetch\s*\(")),
    (
        "REQUESTS_API",
        re.compile(r"\brequests\.(get|post|put|delete|patch)\s*\("),
    ),
    ("PARTIAL_CALLBACK", re.compile(r"\bpartial\s*\(")),
    ("THREAD_TARGET", re.compile(r"\btarget\s*=")),
]


def iter_files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in TARGET_SUFFIXES:
            continue
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        try:
            rel_posix = str(path.relative_to(ROOT)).replace("\\", "/")
        except ValueError:
            continue
        if rel_posix in GENERATED_SKIP_REL:
            continue
        yield path


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def main():
    print("[DYNAMIC_REFERENCE_ENTRIES][START]")

    for path in iter_files():
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            print(f"[READ_FAILED] {rel(path)} error={exc}")
            continue

        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue

            for tag, pattern in PATTERNS:
                if pattern.search(stripped):
                    print(f"{tag} {rel(path)}:{idx}: {stripped[:180]}")

    print("[DYNAMIC_REFERENCE_ENTRIES][DONE]")
    print("以上结果不是僵尸代码清单，而是删除前必须人工确认的动态入口清单。")


if __name__ == "__main__":
    main()
