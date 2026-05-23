"""外部桥接 HTTP 客户端（库 + CLI）。"""
from __future__ import annotations

from app.client.bridge_client import BridgeApiError, BridgeClient

__all__ = ["BridgeApiError", "BridgeClient"]
