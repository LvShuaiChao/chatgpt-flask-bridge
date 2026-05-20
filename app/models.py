import time
from dataclasses import dataclass, field

from app.url_utils import parse_conversation_id

BIND_STATE_UNBOUND = "UNBOUND"
BIND_STATE_WAITING_HOME = "WAITING_HOME"
BIND_STATE_PREBOUND_HOME = "PREBOUND_HOME"
BIND_STATE_WAITING_CONVERSATION_CREATED = "WAITING_CONVERSATION_CREATED"
BIND_STATE_BOUND_CONVERSATION = "BOUND_CONVERSATION"
BIND_STATE_BOUND_OFFLINE = "BOUND_OFFLINE"
BIND_STATE_WAITING_BOUND_CONVERSATION = "WAITING_BOUND_CONVERSATION"

VALID_BIND_STATES = frozenset(
    {
        BIND_STATE_UNBOUND,
        BIND_STATE_WAITING_HOME,
        BIND_STATE_PREBOUND_HOME,
        BIND_STATE_WAITING_CONVERSATION_CREATED,
        BIND_STATE_BOUND_CONVERSATION,
        BIND_STATE_BOUND_OFFLINE,
        BIND_STATE_WAITING_BOUND_CONVERSATION,
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
        "bind_request_id": "",
        "launch_token": "",
        "bind_started_at": 0,
        "reserved_client_id": "",
        "reserved_page_instance_id": "",
        "reserved_at": 0,
        "pending_send_text": "",
        "pending_send_created_at": 0,
        "reopen_request_id": "",
        "reopen_started_at": 0,
        "reopen_target_url": "",
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
    base["bind_started_at"] = float(remote.get("bind_started_at", 0) or 0)
    base["reserved_at"] = float(remote.get("reserved_at", 0) or 0)
    legacy_url = (
        (base.get("conversation_url") or "").strip()
        or (remote.get("conversation_url") or "").strip()
        or (remote.get("url") or "").strip()
        or (remote.get("page_url") or "").strip()
        or (remote.get("bound_url") or "").strip()
        or (remote.get("bound_page_url") or "").strip()
        or (remote.get("chatgpt_url") or "").strip()
        or (remote.get("last_page_url") or "").strip()
    )
    if legacy_url:
        if not (base.get("conversation_url") or "").strip():
            base["conversation_url"] = legacy_url
        if not (base.get("url") or "").strip():
            base["url"] = legacy_url

    legacy_conversation_id = (
        (base.get("conversation_id") or "").strip()
        or (remote.get("conversation_id") or "").strip()
        or (remote.get("bound_conversation_id") or "").strip()
        or (remote.get("target_conversation_id") or "").strip()
    )
    if not legacy_conversation_id:
        legacy_conversation_id = parse_conversation_id(legacy_url)
    if legacy_conversation_id:
        base["enabled"] = True
        base["conversation_id"] = legacy_conversation_id
        base["page_type"] = "conversation"
        if not (base.get("conversation_url") or "").strip():
            base["conversation_url"] = f"https://chatgpt.com/c/{legacy_conversation_id}"
        if not (base.get("url") or "").strip():
            base["url"] = base["conversation_url"]

    if not (base.get("url") or "").strip():
        base["url"] = (base.get("conversation_url") or "").strip()

    base["bind_state"] = _infer_bind_state(remote, base)
    conversation_id = (base.get("conversation_id") or "").strip()
    if conversation_id and base["bind_state"] in (
        BIND_STATE_UNBOUND,
        BIND_STATE_PREBOUND_HOME,
        BIND_STATE_WAITING_HOME,
        BIND_STATE_WAITING_CONVERSATION_CREATED,
    ):
        base["bind_state"] = BIND_STATE_BOUND_CONVERSATION
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

    @property
    def conversation_id(self):
        remote = normalize_remote_chatgpt(self.remote_chatgpt)
        return (remote.get("conversation_id") or "").strip()

    @conversation_id.setter
    def conversation_id(self, value):
        remote = normalize_remote_chatgpt(self.remote_chatgpt)
        remote["conversation_id"] = (value or "").strip()
        self.remote_chatgpt = remote
