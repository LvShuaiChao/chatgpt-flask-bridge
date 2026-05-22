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
]

_FALLBACK_MODULES = (
    "app.server",
    "app.server.state",
    "app.server.runtime_state",
    "app.server.bridge_logging",
    "app.server.message_queue",
    "app.server.tm_page_registry",
    "app.server.control_commands",
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
