from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class PageAutoBindState:
    current_account_id: str = ""
    current_account_display_name: str = ""
    current_page_id: str = ""
    current_conversation_id: str = ""
    bind_status: str = ""
    last_bind_error: str = ""
    updated_at: float = field(default_factory=time.time)

    def mark_bound(
        self,
        *,
        account_id: str = "",
        display_name: str = "",
        page_id: str = "",
        conversation_id: str = "",
        status: str = "bound",
    ) -> None:
        self.current_account_id = str(account_id or "")
        self.current_account_display_name = str(display_name or "")
        self.current_page_id = str(page_id or "")
        self.current_conversation_id = str(conversation_id or "")
        self.bind_status = str(status or "bound")
        self.last_bind_error = ""
        self.updated_at = time.time()

    def mark_error(self, error: str) -> None:
        self.last_bind_error = str(error or "")
        self.bind_status = "error"
        self.updated_at = time.time()
