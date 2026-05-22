"""write_session_remote_chatgpt 禁止持久化 BOUND_OFFLINE。"""

from dataclasses import dataclass, field
from typing import Any, Dict, List

from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_UNBOUND,
    write_session_remote_chatgpt,
)


@dataclass
class _Session:
    session_id: str = "s1"
    remote_chatgpt: Dict[str, Any] = field(default_factory=dict)
    messages: List[Any] = field(default_factory=list)
    updated_at: float = 0.0


def test_write_bound_offline_with_conversation_becomes_bound_conversation():
    session = _Session(
        remote_chatgpt={
            "enabled": True,
            "conversation_id": "conv-1",
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
        }
    )
    write_session_remote_chatgpt(session, bind_state=BIND_STATE_BOUND_OFFLINE)
    assert session.remote_chatgpt["bind_state"] == BIND_STATE_BOUND_CONVERSATION
    assert session.remote_chatgpt["conversation_id"] == "conv-1"


def test_write_bound_offline_without_conversation_does_not_persist_offline():
    session = _Session(remote_chatgpt={"enabled": False})
    write_session_remote_chatgpt(
        session, bind_state=BIND_STATE_BOUND_OFFLINE, enabled=False
    )
    assert session.remote_chatgpt["bind_state"] != BIND_STATE_BOUND_OFFLINE
    assert session.remote_chatgpt["bind_state"] in (
        BIND_STATE_UNBOUND,
        BIND_STATE_BOUND_CONVERSATION,
    )
