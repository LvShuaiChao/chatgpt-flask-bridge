from __future__ import annotations

from typing import Any, Dict

from app.models import normalize_remote_chatgpt, remote_binding_enabled
from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from


def remote_conversation_id(remote: Any) -> str:
    remote = normalize_remote_chatgpt(remote)
    conversation_id = (remote.get("conversation_id") or "").strip()
    if conversation_id:
        return conversation_id
    return parse_conversation_id((remote.get("url") or "").strip()) or ""


def remote_binding_identity(remote: Any) -> Dict[str, str]:
    remote = normalize_remote_chatgpt(remote)
    if not remote_binding_enabled(remote):
        return {
            "client_id": "",
            "page_instance_id": "",
            "conversation_id": "",
            "url": "",
        }
    return {
        "client_id": (remote.get("client_id") or "").strip(),
        "page_instance_id": (remote.get("page_instance_id") or "").strip(),
        "conversation_id": remote_conversation_id(remote),
        "url": page_url_from(remote),
    }


def session_binding_identity(session: Any) -> Dict[str, str]:
    if session is None:
        return {
            "client_id": "",
            "page_instance_id": "",
            "conversation_id": "",
            "url": "",
        }
    return remote_binding_identity(getattr(session, "remote_chatgpt", None))


def session_bound_client_id(session: Any) -> str:
    return session_binding_identity(session)["client_id"]
