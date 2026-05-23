#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
built = (REPO / "chatgpt-toolbox" / "dist" / "client.user.js").read_text(encoding="utf-8")
orig = subprocess.check_output(
    ["git", "show", "HEAD:client.user.js"],
    cwd=REPO,
    text=True,
    encoding="utf-8",
)


def body(s: str) -> str:
    m = re.search(r"\(function \(\) \{\s*'use strict';\s*([\s\S]*)\}\)\(\);", s)
    if not m:
        raise SystemExit("IIFE body not found")
    return m.group(1)


ob = body(orig)
bb = body(built)
print("orig body chars", len(ob), "built", len(bb), "delta", len(bb) - len(ob))
if ob == bb:
    print("body equal True")
    sys.exit(0)
for i, (a, b) in enumerate(zip(ob, bb)):
    if a != b:
        print("first char diff at", i, "orig ctx", repr(ob[max(0, i - 40) : i + 40]))
        print("built ctx", repr(bb[max(0, i - 40) : i + 40]))
        break
else:
    print("prefix equal, length tail diff")
    print("orig tail", repr(ob[len(bb) : len(bb) + 80]))
    print("built tail", repr(bb[len(ob) : len(ob) + 80]))
sys.exit(1)
