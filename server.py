"""Flask bridge CLI 入口（兼容旧 `import server`；业务代码优先 `from app.server import ...`）。"""
from __future__ import annotations

from app.server.runtime_state import (
    create_app,
    is_debug_mode,
    is_server_running,
    set_debug_mode,
    set_external_gui_dispatch,
    set_log_callback,
    set_status_callback,
    start_server,
    stop_server,
)
from app.server.system_hotkey import (
    _parse_hotkey_for_pyautogui,
    execute_system_hotkey as _execute_system_hotkey_impl,
)

__all__ = [
    "create_app",
    "is_debug_mode",
    "is_server_running",
    "set_debug_mode",
    "set_external_gui_dispatch",
    "set_log_callback",
    "set_status_callback",
    "start_server",
    "stop_server",
    "_parse_hotkey_for_pyautogui",
    "execute_system_hotkey",
]

_LAST_SYSTEM_HOTKEY_AT = 0.0


def execute_system_hotkey(hotkey: str, *, source: str = ""):
    """Compatibility wrapper for old `import server` callers/tests."""
    global _LAST_SYSTEM_HOTKEY_AT
    from app.server import system_hotkey as _sh

    _sh._LAST_SYSTEM_HOTKEY_AT = float(_LAST_SYSTEM_HOTKEY_AT or 0.0)
    result = _execute_system_hotkey_impl(hotkey, source=source)
    _LAST_SYSTEM_HOTKEY_AT = float(_sh._LAST_SYSTEM_HOTKEY_AT or 0.0)
    return result

_FALLBACK_MODULES = (
    "app.server",
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


def __getattr__(name: str):
    import importlib

    for module_name in _FALLBACK_MODULES:
        mod = importlib.import_module(module_name)
        if hasattr(mod, name):
            return getattr(mod, name)
    raise AttributeError(f"module 'server' has no attribute {name!r}")


def __dir__():
    import importlib

    names = set(globals())
    for module_name in _FALLBACK_MODULES:
        mod = importlib.import_module(module_name)
        names.update(getattr(mod, "__all__", dir(mod)))
    return sorted(names)
