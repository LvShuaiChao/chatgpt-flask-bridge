from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class BridgeState:
    connected: bool = False
    client_id: str = ""
    page_instance_id: str = ""
    page_display_id: str = ""
    last_seen_at: float = 0.0
    last_error: str = ""

    def touch(self) -> None:
        self.last_seen_at = time.time()

    def update_from_status(self, status: dict) -> None:
        if not isinstance(status, dict):
            raise TypeError(f"BridgeState.update_from_status expected dict, got {type(status)!r}")
        pages = status.get("pages") if isinstance(status.get("pages"), list) else []
        self.connected = bool(status.get("server_running")) and bool(pages)
        summary = status.get("summary") if isinstance(status.get("summary"), dict) else {}
        focused = summary.get("focused_page") if isinstance(summary.get("focused_page"), dict) else {}
        self.client_id = str(focused.get("client_id") or self.client_id or "")
        self.page_instance_id = str(
            focused.get("page_instance_id") or self.page_instance_id or ""
        )
        self.page_display_id = str(
            focused.get("page_no") or focused.get("page_display_id") or self.page_display_id or ""
        )
        if self.connected:
            self.touch()
