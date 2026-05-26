"""Scan Flask routes vs frontend fetch / Python requests API paths (read-only).

Outputs candidate unused routes and candidate missing backend routes for manual review.
Does not modify any files or auto-delete anything.
"""
from __future__ import annotations

import re
from pathlib import Path

from _common import (
    DEFAULT_IGNORE_DIRS,
    PROJECT_ROOT as ROOT,
    read_text,
    rel,
)

PY_TARGETS = [
    ROOT / "app",
    ROOT / "server.py",
    ROOT / "gui.py",
]

JS_TARGETS = [
    ROOT / "chatgpt-toolbox" / "tampermonkey-userscript-src",
    ROOT / "client.user.js",
]

ROUTE_RE = re.compile(
    r"@\s*(?:app|bp|blueprint|api|routes|[\w_]+)\.route\s*\(\s*['\"]([^'\"]+)['\"]"
)

ADD_URL_RULE_RE = re.compile(
    r"\badd_url_rule\s*\(\s*['\"]([^'\"]+)['\"]"
)

FETCH_PATH_RE = re.compile(
    r"\bfetch\s*\(\s*['\"]([^'\"]+)['\"]"
)

REQUESTS_PATH_RE = re.compile(
    r"\brequests\.(?:get|post|put|delete|patch)\s*\(\s*['\"]([^'\"]+)['\"]"
)

URL_LITERAL_RE = re.compile(
    r"['\"](/(?:api|bridge|cursor|job|control|external|core)[^'\"]*)['\"]"
)


def iter_files(targets, suffixes):
    for target in targets:
        if target.is_file() and target.suffix.lower() in suffixes:
            yield target
            continue

        if not target.exists():
            continue

        for path in target.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in suffixes:
                continue
            if any(part in DEFAULT_IGNORE_DIRS for part in path.parts):
                continue
            yield path


def normalize_path(path: str) -> str:
    path = path.strip()

    if path.startswith("http://") or path.startswith("https://"):
        for marker in [
            "/api/",
            "/bridge/",
            "/cursor/",
            "/job/",
            "/control/",
            "/external/",
            "/core/",
        ]:
            index = path.find(marker)
            if index >= 0:
                path = path[index:]
                break

    if "?" in path:
        path = path.split("?", 1)[0]

    path = path.rstrip("/")

    if not path:
        return "/"

    return path


def path_matches(route_path: str, call_path: str) -> bool:
    route_path = normalize_path(route_path)
    call_path = normalize_path(call_path)

    if route_path == call_path:
        return True

    route_parts = route_path.strip("/").split("/")
    call_parts = call_path.strip("/").split("/")

    if len(route_parts) != len(call_parts):
        return False

    for route_part, call_part in zip(route_parts, call_parts):
        if route_part.startswith("<") and route_part.endswith(">"):
            continue
        if route_part != call_part:
            return False

    return True


def collect_routes():
    routes = []

    for path in iter_files(PY_TARGETS, {".py"}):
        text = read_text(path)
        for regex in (ROUTE_RE, ADD_URL_RULE_RE):
            for match in regex.finditer(text):
                route_path = normalize_path(match.group(1))
                line_no = text[: match.start()].count("\n") + 1
                routes.append(
                    {
                        "path": route_path,
                        "file": path,
                        "line": line_no,
                    }
                )

    return routes


def collect_api_calls():
    calls = []

    for path in iter_files(JS_TARGETS, {".js", ".ts"}):
        text = read_text(path)

        for regex, kind in (
            (FETCH_PATH_RE, "fetch"),
            (URL_LITERAL_RE, "url_literal"),
        ):
            for match in regex.finditer(text):
                call_path = normalize_path(match.group(1))
                line_no = text[: match.start()].count("\n") + 1
                calls.append(
                    {
                        "path": call_path,
                        "file": path,
                        "line": line_no,
                        "kind": kind,
                    }
                )

    for path in iter_files(PY_TARGETS, {".py"}):
        text = read_text(path)

        for regex, kind in (
            (REQUESTS_PATH_RE, "requests"),
            (URL_LITERAL_RE, "url_literal"),
        ):
            for match in regex.finditer(text):
                call_path = normalize_path(match.group(1))
                line_no = text[: match.start()].count("\n") + 1
                calls.append(
                    {
                        "path": call_path,
                        "file": path,
                        "line": line_no,
                        "kind": kind,
                    }
                )

    return calls


def main() -> int:
    print("[API_ROUTE_USAGE_SCAN][START]")

    routes = collect_routes()
    calls = collect_api_calls()

    print(f"[API_ROUTE_USAGE_SCAN][ROUTES] count={len(routes)}")
    for item in routes:
        print(f"[API_ROUTE] {rel(item['file'])}:{item['line']} path={item['path']}")

    print(f"[API_ROUTE_USAGE_SCAN][CALLS] count={len(calls)}")
    for item in calls:
        print(
            f"[API_CALL] {rel(item['file'])}:{item['line']} "
            f"kind={item['kind']} path={item['path']}"
        )

    print("[API_ROUTE_USAGE_SCAN][UNUSED_ROUTE_CANDIDATES]")
    for route in routes:
        matched = any(path_matches(route["path"], call["path"]) for call in calls)
        if not matched:
            print(
                f"[UNUSED_ROUTE_CANDIDATE] {rel(route['file'])}:{route['line']} "
                f"path={route['path']}"
            )

    print("[API_ROUTE_USAGE_SCAN][MISSING_ROUTE_CANDIDATES]")
    api_prefixes = (
        "/api",
        "/bridge",
        "/cursor",
        "/job",
        "/control",
        "/external",
        "/core",
    )
    for call in calls:
        if not call["path"].startswith(api_prefixes):
            continue

        matched = any(path_matches(route["path"], call["path"]) for route in routes)
        if not matched:
            print(
                f"[MISSING_ROUTE_CANDIDATE] {rel(call['file'])}:{call['line']} "
                f"kind={call['kind']} path={call['path']}"
            )

    print("[API_ROUTE_USAGE_SCAN][DONE]")
    print(
        "以上只是候选清单。动态拼接 URL、Blueprint 前缀、反向代理前缀、"
        "外部接口都可能导致误判，不能自动删除 route 或调用。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
