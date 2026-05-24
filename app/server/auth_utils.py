"""Shared external API authentication helpers."""
from __future__ import annotations

from flask import request

from app.server import state as st


def external_auth_ok() -> bool:
    token = (st.API_TOKEN or "").strip()
    if not token:
        return True

    auth_header = (request.headers.get("Authorization") or "").strip()
    if auth_header.lower().startswith("bearer "):
        provided = auth_header[7:].strip()
    else:
        provided = (request.headers.get("X-API-Key") or "").strip()

    return provided == token
