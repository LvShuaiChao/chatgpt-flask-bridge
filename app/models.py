import time
from dataclasses import dataclass, field

BIND_STATE_UNBOUND = "UNBOUND"
BIND_STATE_WAITING_HOME = "WAITING_HOME"
BIND_STATE_PREBOUND_HOME = "PREBOUND_HOME"
BIND_STATE_WAITING_CONVERSATION_CREATED = "WAITING_CONVERSATION_CREATED"
BIND_STATE_BOUND_CONVERSATION = "BOUND_CONVERSATION"
BIND_STATE_BOUND_OFFLINE = "BOUND_OFFLINE"

VALID_BIND_STATES = frozenset(
    {
        BIND_STATE_UNBOUND,
        BIND_STATE_WAITING_HOME,
        BIND_STATE_PREBOUND_HOME,
        BIND_STATE_WAITING_CONVERSATION_CREATED,
        BIND_STATE_BOUND_CONVERSATION,
        BIND_STATE_BOUND_OFFLINE,
    }
)


def default_remote_chatgpt():
    return {
        "enabled": False,
        "bind_state": BIND_STATE_UNBOUND,
        "conversation_id": "",
        "conversation_url": "",
        "url": "",
        "client_id": "",
        "page_instance_id": "",
        "page_type": "",
        "page_title": "",
        "last_seen": 0,
        "prebound_home_client_id": "",
        "prebound_home_page_instance_id": "",
        "created_from_home": False,
        "bootstrap_in_progress": False,
        "pending_bootstrap_text": "",
        "pending_bootstrap_created_at": 0,
        "opened_home_at": 0,
    }


def _infer_bind_state(remote, base):
    explicit = (remote.get("bind_state") or "").strip()
    if explicit in VALID_BIND_STATES:
        return explicit
    if not remote.get("enabled", base.get("enabled")):
        return BIND_STATE_UNBOUND
    page_type = (remote.get("page_type") or base.get("page_type") or "").strip()
    conversation_id = (remote.get("conversation_id") or base.get("conversation_id") or "").strip()
    if conversation_id:
        return BIND_STATE_BOUND_CONVERSATION
    if page_type == "home":
        return BIND_STATE_PREBOUND_HOME
    if page_type == "conversation":
        return BIND_STATE_BOUND_CONVERSATION
    return BIND_STATE_UNBOUND


def normalize_remote_chatgpt(remote):
    base = default_remote_chatgpt()
    if not remote:
        return base
    for key in base:
        if key in remote:
            base[key] = remote[key]
    base["enabled"] = bool(remote.get("enabled", False))
    base["last_seen"] = float(remote.get("last_seen", 0) or 0)
    base["created_from_home"] = bool(remote.get("created_from_home", False))
    base["bootstrap_in_progress"] = bool(remote.get("bootstrap_in_progress", False))
    if not (base.get("conversation_url") or "").strip():
        legacy_url = (remote.get("url") or "").strip()
        if legacy_url:
            base["conversation_url"] = legacy_url
    if not (base.get("url") or "").strip():
        base["url"] = (base.get("conversation_url") or "").strip()
    base["bind_state"] = _infer_bind_state(remote, base)
    if base["bind_state"] == BIND_STATE_PREBOUND_HOME:
        if not (base.get("prebound_home_client_id") or "").strip():
            base["prebound_home_client_id"] = (base.get("client_id") or "").strip()
        if not (base.get("prebound_home_page_instance_id") or "").strip():
            base["prebound_home_page_instance_id"] = (
                base.get("page_instance_id") or ""
            ).strip()
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
