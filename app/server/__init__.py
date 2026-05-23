"""Flask 桥接服务包（显式导出 + 测试/旧代码用的动态属性回退）。"""
from __future__ import annotations

import importlib

from app.server import state as st
from app.server.runtime_state import (
    complete_gui_dispatch,
    create_app,
    get_server_bind_host,
    get_server_bridge_url,
    get_server_port,
    get_server_public_host,
    get_server_url,
    is_debug_mode,
    is_server_running,
    set_debug_mode,
    set_external_gui_dispatch,
    set_log_callback,
    set_status_callback,
    start_server,
    stop_server,
)
from app.server.message_queue import (
    cancel_message,
    get_bridge_message_id,
    get_bridge_status,
    get_message_state,
    push_message,
)
from app.server.tm_page_registry import get_tm_online_summary
from app.server.control_commands import (
    enqueue_control_command,
    push_close_other_pages,
    push_close_page,
    push_open_url,
)
from app.server.system_hotkey import (
    _parse_hotkey_for_pyautogui,
    execute_system_hotkey as _execute_system_hotkey_impl,
)

ONLINE_TIMEOUT_SEC = st.ONLINE_TIMEOUT_SEC

_LAST_SYSTEM_HOTKEY_AT = 0.0

_FALLBACK_MODULES = (
    "app.server.state",
    "app.server.runtime_state",
    "app.server.bridge_logging",
    "app.server.message_queue",
    "app.server.tm_page_registry",
    "app.server.control_commands",
    "app.server.system_hotkey",
    "app.server.cursor_api",
    "app.server.external_api",
)

__all__ = [
    "st",
    "ONLINE_TIMEOUT_SEC",
    "complete_gui_dispatch",
    "create_app",
    "get_server_bind_host",
    "get_server_bridge_url",
    "get_server_port",
    "get_server_public_host",
    "get_server_url",
    "is_debug_mode",
    "is_server_running",
    "set_debug_mode",
    "set_external_gui_dispatch",
    "set_log_callback",
    "set_status_callback",
    "start_server",
    "stop_server",
    "cancel_message",
    "get_bridge_message_id",
    "get_bridge_status",
    "get_message_state",
    "push_message",
    "get_tm_online_summary",
    "enqueue_control_command",
    "push_close_other_pages",
    "push_close_page",
    "push_open_url",
    "_parse_hotkey_for_pyautogui",
    "execute_system_hotkey",
]


def execute_system_hotkey(hotkey: str, *, source: str = ""):
    """同步模块级 `_LAST_SYSTEM_HOTKEY_AT`（供测试与旧调用方）。"""
    global _LAST_SYSTEM_HOTKEY_AT
    from app.server import system_hotkey as _sh

    _sh._LAST_SYSTEM_HOTKEY_AT = float(_LAST_SYSTEM_HOTKEY_AT or 0.0)
    result = _execute_system_hotkey_impl(hotkey, source=source)
    _LAST_SYSTEM_HOTKEY_AT = float(_sh._LAST_SYSTEM_HOTKEY_AT or 0.0)
    return result


def __getattr__(name: str):
    for module_name in _FALLBACK_MODULES:
        mod = importlib.import_module(module_name)
        if hasattr(mod, name):
            return getattr(mod, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    names = set(globals())
    for module_name in _FALLBACK_MODULES:
        mod = importlib.import_module(module_name)
        names.update(getattr(mod, "__all__", dir(mod)))
    return sorted(names)
