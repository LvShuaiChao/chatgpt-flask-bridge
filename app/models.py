import time
from dataclasses import dataclass, field


def default_remote_chatgpt():
    return {
        "enabled": False,
        "conversation_id": "",
        "conversation_url": "",
        "client_id": "",
        "page_instance_id": "",
        "page_type": "",
        "page_title": "",
        "last_seen": 0,
    }


def normalize_remote_chatgpt(remote):
    base = default_remote_chatgpt()
    if not remote:
        return base
    for key in base:
        if key in remote:
            base[key] = remote[key]
    base["enabled"] = bool(remote.get("enabled", False))
    base["last_seen"] = float(remote.get("last_seen", 0) or 0)
    return base


@dataclass
class ChatMessage:
    role: str
    content: str
    created_at: float = field(default_factory=time.time)
    message_id: str = ""
    turn_id: str = ""
    status: str = ""
    bridge_message_id: str = ""
    parent_message_id: str = ""
    visible_in_chat: bool = True
    @property
    def text(self):
        return self.content
    @text.setter
    def text(self, value):
        self.content = value

@dataclass
class ChatSession:
    session_id: str
    title: str
    created_at: float
    updated_at: float
    task_type: str = ""
    context_mode: str = ""
    summary: str = ""
    pinned_context: str = ""
    remote_chatgpt: dict = field(default_factory=default_remote_chatgpt)
    messages: list = field(default_factory=list)
    has_pending_reply: bool = False
