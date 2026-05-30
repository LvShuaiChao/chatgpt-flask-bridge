from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class BridgeClientState:
    base_url: str = ""
    connected: bool = False
    last_error: str = ""
    last_health_at: float = 0.0


@dataclass
class BridgeClientEvent:
    name: str = ""
    payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BridgeRequestResult:
    ok: bool = False
    status_code: int = 0
    data: Dict[str, Any] = field(default_factory=dict)
    error: str = ""

    @classmethod
    def from_response(cls, *, ok: bool, status_code: int, data: dict, error: str = "") -> "BridgeRequestResult":
        return cls(
            ok=ok,
            status_code=status_code,
            data=dict(data) if isinstance(data, dict) else {},
            error=error,
        )
