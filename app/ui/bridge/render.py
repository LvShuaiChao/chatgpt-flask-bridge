from __future__ import annotations

from .state import BridgeState


def format_bridge_status_text(state: BridgeState, *, online_count: int = 0) -> str:
    """Format bridge status for UI; does not mutate state."""
    if not state.connected:
        err = (state.last_error or "").strip()
        if err:
            return f"桥接未连接：{err}"
        return "桥接未连接"
    page = state.page_display_id or state.page_instance_id or state.client_id or "-"
    return f"桥接已连接｜在线页 {online_count}｜焦点 {page}"
