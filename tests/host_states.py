"""测试桩挂载 MainWindow 领域状态（与 MainWindow.__init__ 一致）。"""
from __future__ import annotations

from app.ui.main_window_state import (
    AutoBindState,
    BindDisplayState,
    BridgeMessageState,
    BridgeUiState,
    LogUiState,
    PageCommandUiState,
    PageSelectorState,
    ServerUiState,
    SessionUiState,
    WebSyncState,
)


def attach_main_window_states(host) -> None:
    defaults = (
        ("_bridge_ui", BridgeUiState),
        ("_page_selector", PageSelectorState),
        ("_web_sync", WebSyncState),
        ("_auto_bind", AutoBindState),
        ("_bind_display", BindDisplayState),
        ("_page_cmd", PageCommandUiState),
        ("_bridge_msg", BridgeMessageState),
        ("_log_ui", LogUiState),
        ("_session_ui", SessionUiState),
        ("_server_ui", ServerUiState),
    )
    for attr, cls in defaults:
        if not hasattr(host, attr):
            setattr(host, attr, cls())
