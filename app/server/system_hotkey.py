"""Local system hotkey API.

The HTTP route receives a hotkey request from a local browser script, then
dispatches it to the GUI process when possible. The GUI executes the hotkey
with pyautogui so browser security rules do not block the key chord.
"""
from __future__ import annotations

import time
import traceback

from flask import jsonify, request
from werkzeug.exceptions import BadRequest

from app.server import state as st
from app.server.runtime_state import _dispatch_to_gui, _log

SYSTEM_HOTKEY_MIN_INTERVAL_SEC = 0.8
_LAST_SYSTEM_HOTKEY_AT = 0.0

_MODIFIER_ALIASES = {
    "ctrl": "ctrl",
    "control": "ctrl",
    "ctl": "ctrl",
    "alt": "alt",
    "option": "alt",
    "shift": "shift",
    "meta": "win",
    "cmd": "win",
    "command": "win",
    "win": "win",
    "windows": "win",
}

_NAMED_KEY_ALIASES = {
    "enter": "enter",
    "return": "enter",
    "esc": "esc",
    "escape": "esc",
    "tab": "tab",
    "space": "space",
    "backspace": "backspace",
    "delete": "delete",
    "del": "delete",
    "insert": "insert",
    "ins": "insert",
    "home": "home",
    "end": "end",
    "pageup": "pageup",
    "pagedown": "pagedown",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
}

_ALLOWED_NON_MODIFIER_KEYS = {
    *[chr(code) for code in range(ord("a"), ord("z") + 1)],
    *[str(num) for num in range(10)],
    *[f"f{num}" for num in range(1, 13)],
    *_NAMED_KEY_ALIASES.values(),
}


def _external_auth_ok() -> bool:
    from app.server.auth_utils import external_auth_ok

    return external_auth_ok()


def _is_local_request() -> bool:
    remote = (request.remote_addr or "").strip().lower()
    return remote in {"127.0.0.1", "::1", "localhost"}


def _hotkey_error(error: str, code: str, status: int = 400):
    return jsonify({"ok": False, "error": error, "code": code}), status


def _normalize_hotkey_part(part: str) -> str:
    text = str(part or "").strip().lower()
    if not text:
        return ""
    if text in _MODIFIER_ALIASES:
        return _MODIFIER_ALIASES[text]
    if text in _NAMED_KEY_ALIASES:
        return _NAMED_KEY_ALIASES[text]
    if len(text) == 1 and text.isalnum():
        return text
    if text.startswith("key") and len(text) == 4 and text[-1].isalpha():
        return text[-1].lower()
    if text.startswith("digit") and len(text) == 6 and text[-1].isdigit():
        return text[-1]
    if text.startswith("f") and text[1:].isdigit() and 1 <= int(text[1:]) <= 12:
        return text
    return ""


def _parse_hotkey_for_pyautogui(hotkey: str) -> list[str]:
    raw_parts = str(hotkey or "").replace("-", "+").split("+")
    keys: list[str] = []
    main_keys = 0
    for raw_part in raw_parts:
        key = _normalize_hotkey_part(raw_part)
        if not key:
            raise ValueError(f"不支持的快捷键按键: {raw_part}")
        if key not in _MODIFIER_ALIASES.values():
            if key not in _ALLOWED_NON_MODIFIER_KEYS:
                raise ValueError(f"不支持的快捷键按键: {raw_part}")
            main_keys += 1
        if key not in keys:
            keys.append(key)
    if not keys:
        raise ValueError("快捷键不能为空")
    if main_keys != 1:
        raise ValueError("快捷键必须包含且只包含一个主按键")
    return keys


def execute_system_hotkey(hotkey: str, *, source: str = "") -> dict:
    global _LAST_SYSTEM_HOTKEY_AT

    now = time.time()
    if now - float(_LAST_SYSTEM_HOTKEY_AT or 0.0) < SYSTEM_HOTKEY_MIN_INTERVAL_SEC:
        return {
            "ok": False,
            "error": "快捷键请求过于频繁",
            "code": "HOTKEY_RATE_LIMITED",
        }

    try:
        keys = _parse_hotkey_for_pyautogui(hotkey)
    except ValueError as error:
        _log(
            "[SYSTEM_HOTKEY][INVALID_HOTKEY] "
            f"hotkey={hotkey!r} source={source or '-'} "
            f"error_type={type(error).__name__} error={error}"
        )
        return {"ok": False, "error": str(error), "code": "INVALID_HOTKEY"}

    try:
        import pyautogui

        pyautogui.hotkey(*keys)
    except Exception as error:
        detail = f"{error}\n{traceback.format_exc()}"
        _log(f"[SYSTEM_HOTKEY][FAILED] hotkey={hotkey!r} source={source or '-'} error={detail}")
        return {"ok": False, "error": str(error), "code": "HOTKEY_EXEC_FAILED"}

    _LAST_SYSTEM_HOTKEY_AT = now
    _log(
        f"[SYSTEM_HOTKEY][OK] hotkey={hotkey!r} keys={'+'.join(keys)} "
        f"source={source or '-'}"
    )
    return {"ok": True, "hotkey": str(hotkey or ""), "keys": keys, "source": source or ""}


def api_v1_system_hotkey():
    if not _is_local_request():
        return _hotkey_error("仅允许本机请求执行快捷键", "LOCAL_ONLY", 403)
    if not _external_auth_ok():
        return _hotkey_error("认证失败", "UNAUTHORIZED", 401)

    try:
        body = request.get_json(silent=False)
    except BadRequest as error:
        _log(
            "[SYSTEM_HOTKEY][INVALID_JSON] "
            f"method={request.method} path={request.path} "
            f"remote={request.remote_addr or '-'} "
            f"content_type={request.content_type!r} "
            f"error_type={type(error).__name__} error={error}\n"
            f"{traceback.format_exc()}"
        )
        return _hotkey_error(f"JSON 解析失败：{error}", "INVALID_JSON", 400)
    if not isinstance(body, dict):
        _log(
            "[SYSTEM_HOTKEY][INVALID_JSON_OBJECT] "
            f"method={request.method} path={request.path} "
            f"body_type={type(body).__name__}"
        )
        return _hotkey_error("JSON body 必须是对象", "INVALID_JSON", 400)
    hotkey = (body.get("hotkey") or body.get("shortcut") or "").strip()
    source = (body.get("source") or request.headers.get("X-Request-Source") or "").strip()
    if not hotkey:
        return _hotkey_error("hotkey 不能为空", "EMPTY_HOTKEY", 400)

    gui_result = _dispatch_to_gui(
        "system_hotkey",
        {"hotkey": hotkey, "source": source or "api"},
        timeout_sec=5,
    )
    if not gui_result.get("ok") and gui_result.get("code") == "GUI_NOT_AVAILABLE":
        gui_result = execute_system_hotkey(hotkey, source=source or "api_fallback")

    status = 200 if gui_result.get("ok") else 400
    code = gui_result.get("code")
    if code == "HOTKEY_RATE_LIMITED":
        status = 429
    elif code == "GUI_NOT_AVAILABLE":
        status = 503
    return jsonify(gui_result), status


def register_system_hotkey_routes(app) -> None:
    app.add_url_rule(
        "/api/v1/system/hotkey",
        view_func=api_v1_system_hotkey,
        methods=["POST"],
    )


__all__ = [
    "_LAST_SYSTEM_HOTKEY_AT",
    "_parse_hotkey_for_pyautogui",
    "execute_system_hotkey",
    "register_system_hotkey_routes",
]
