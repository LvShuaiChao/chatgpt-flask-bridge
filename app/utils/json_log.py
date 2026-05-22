"""完整 JSON 日志序列化（不截断 content/text/messages）。"""
from __future__ import annotations

import json
import traceback

SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "cookies",
    "api_token",
    "token",
    "access_token",
    "refresh_token",
    "password",
}


def sanitize_for_json_log(obj):
    if isinstance(obj, dict):
        result = {}
        for key, value in obj.items():
            key_text = str(key)
            if key_text.lower() in SENSITIVE_KEYS:
                result[key] = "***REDACTED***"
            else:
                result[key] = sanitize_for_json_log(value)
        return result

    if isinstance(obj, list):
        return [sanitize_for_json_log(item) for item in obj]

    return obj


def dumps_full_json_for_log(obj):
    safe_obj = sanitize_for_json_log(obj)
    try:
        return json.dumps(
            safe_obj,
            ensure_ascii=False,
            sort_keys=True,
            indent=None,
            default=str,
        )
    except Exception as exc:
        return json.dumps(
            {
                "error_type": type(exc).__name__,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            },
            ensure_ascii=False,
            sort_keys=True,
            indent=None,
            default=str,
        )
