"""会话绑定临时运行态（不写入 session.remote_chatgpt 持久化）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


TRANSIENT_REMOTE_CHATGPT_KEYS = frozenset(
    {
        "bootstrap_in_progress",
        "bootstrap_message_id",
        "bootstrap_started_at",
        "pending_bootstrap_created_at",
        "opened_home_at",
        "bound_at",
        "pending_send_created_at",
        "reopen_request_id",
    }
)


@dataclass
class BindSessionRuntime:
    bootstrap_in_progress: bool = False
    bootstrap_message_id: str = ""
    bootstrap_started_at: float = 0.0
    pending_bootstrap_created_at: float = 0.0
    opened_home_at: float = 0.0
    bound_at: float = 0.0
    pending_send_created_at: float = 0.0
    reopen_request_id: str = ""


def _session_key(session: Any) -> str:
    if session is None:
        return ""
    return (getattr(session, "session_id", None) or "").strip()


def get_bind_runtime_store(host: Any) -> Dict[str, BindSessionRuntime]:
    auto_bind = getattr(host, "_auto_bind", None)
    if auto_bind is None:
        store: Dict[str, BindSessionRuntime] = {}
        host._bind_runtime_by_session = store
        return store
    store = getattr(auto_bind, "runtime_by_session", None)
    if store is None:
        store = {}
        auto_bind.runtime_by_session = store
    return store


def get_bind_runtime(host: Any, session: Any) -> BindSessionRuntime:
    key = _session_key(session)
    store = get_bind_runtime_store(host)
    if key not in store:
        store[key] = BindSessionRuntime()
    return store[key]


def update_bind_runtime(host: Any, session: Any, **fields: Any) -> BindSessionRuntime:
    runtime = get_bind_runtime(host, session)
    for name, value in fields.items():
        if hasattr(runtime, name):
            setattr(runtime, name, value)
    return runtime


def migrate_transient_from_remote(host: Any, session: Any, remote: Dict[str, Any]) -> Dict[str, Any]:
    """从旧版 remote_chatgpt 读出临时字段到 BindSessionRuntime，并从 dict 中剔除。"""
    if not isinstance(remote, dict) or session is None:
        return remote if isinstance(remote, dict) else {}
    migrated = {}
    for key in TRANSIENT_REMOTE_CHATGPT_KEYS:
        if key not in remote:
            continue
        val = remote.get(key)
        if val in (None, "", 0, 0.0, False):
            continue
        migrated[key] = val
    if migrated:
        update_bind_runtime(host, session, **migrated)
    cleaned = dict(remote)
    for key in TRANSIENT_REMOTE_CHATGPT_KEYS:
        cleaned.pop(key, None)
    return cleaned


__all__ = [
    "TRANSIENT_REMOTE_CHATGPT_KEYS",
    "BindSessionRuntime",
    "get_bind_runtime",
    "update_bind_runtime",
    "migrate_transient_from_remote",
]
