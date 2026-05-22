"""Flask 桥接服务包（显式导出，无动态 __getattr__）。"""
from __future__ import annotations

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
    execute_system_hotkey,
)

ONLINE_TIMEOUT_SEC = st.ONLINE_TIMEOUT_SEC

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
