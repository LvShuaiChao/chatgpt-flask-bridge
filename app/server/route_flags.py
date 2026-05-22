"""HTTP 路由特性开关。"""
from __future__ import annotations

import os


def enable_external_api() -> bool:
    """第三方 HTTP / Cursor / Jobs 路由；默认关闭。"""
    flag = os.environ.get("CHATGPT_BRIDGE_ENABLE_EXTERNAL_API", "").strip().lower()
    return flag in ("1", "true", "yes", "on")
