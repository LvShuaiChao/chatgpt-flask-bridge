import logging
import time
from dataclasses import dataclass, field

from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from

logger = logging.getLogger(__name__)

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

REMOTE_CHATGPT_PERSISTENT_KEYS = (
    "bind_state",
    "conversation_id",
    "url",
    "client_id",
    "page_instance_id",
    "page_display_id",
    "page_type",
    "page_title",
    "last_seen",
    "bind_request_id",
    "bind_started_at",
    "pending_bootstrap_content",
    "pending_send_content",
    "pending_send_message_id",
    "reopen_started_at",
)

_REMOTE_NORMALIZE_KEYS = (
    "bind_state",
    "url",
    "conversation_id",
    "client_id",
    "page_instance_id",
    "page_display_id",
    "page_type",
    "page_title",
    "last_seen",
    "last_poll_at",
)


def default_remote_chatgpt():
    """长期绑定字段；临时运行态见 app.utils.bind_runtime.BindSessionRuntime。"""
    return {
        "bind_state": BIND_STATE_UNBOUND,
        "url": "",
        "conversation_id": "",
        "client_id": "",
        "page_instance_id": "",
        "page_display_id": "",
        "page_type": "",
        "page_title": "",
        "last_seen": 0,
        "last_poll_at": "",
    }


def remote_binding_active(remote) -> bool:
    """bind_state != UNBOUND 即视为已启用绑定（不再持久化 enabled）。"""
    remote = normalize_remote_chatgpt(remote)
    return (remote.get("bind_state") or "").strip() != BIND_STATE_UNBOUND


def remote_binding_enabled(remote) -> bool:
    """由 bind_state 推导是否已绑定/预绑定（替代 remote.get('enabled')）。"""
    return remote_binding_active(remote)


def derive_remote_page_type(url: str = "", conversation_id: str = "") -> str:
    """由 url / conversation_id 派生 page_type（不写入 session.remote_chatgpt）。"""
    conversation_id = (conversation_id or "").strip()
    if conversation_id:
        return "conversation"
    url = (url or "").strip()
    if not url:
        return ""
    low = url.lower()
    if "xz_bind_token" in low:
        return "home"
    try:
        from urllib.parse import urlparse

        parsed = urlparse(low)
        host = (parsed.netloc or "").lower()
        path = (parsed.path or "/").rstrip("/") or "/"
        if host in ("chatgpt.com", "www.chatgpt.com") and path == "/":
            return "home"
    except Exception as error:
        logger.warning(
            "[REMOTE][DERIVE_PAGE_TYPE] url=%r error=%s",
            url,
            error,
        )
    return ""


def _infer_bind_state(remote, base):
    explicit = (remote.get("bind_state") or "").strip()
    if explicit in VALID_BIND_STATES:
        return explicit
    conversation_id = (remote.get("conversation_id") or base.get("conversation_id") or "").strip()
    if conversation_id:
        return BIND_STATE_BOUND_CONVERSATION
    page_type = derive_remote_page_type(
        remote.get("url") or base.get("url") or "",
        conversation_id,
    )
    if page_type == "home":
        return BIND_STATE_PREBOUND_HOME
    return BIND_STATE_UNBOUND


def _core_remote_dict(remote: dict) -> dict:
    last_seen = remote.get("last_seen")
    try:
        last_seen_val = float(last_seen if last_seen not in (None, "") else 0)
    except (TypeError, ValueError):
        last_seen_val = 0.0
    return {
        "bind_state": (remote.get("bind_state") or BIND_STATE_UNBOUND),
        "url": (remote.get("url") or "").strip(),
        "conversation_id": (remote.get("conversation_id") or "").strip(),
        "client_id": (remote.get("client_id") or "").strip(),
        "page_instance_id": (remote.get("page_instance_id") or "").strip(),
        "page_display_id": str(remote.get("page_display_id") or "").strip(),
        "page_type": (remote.get("page_type") or "").strip(),
        "page_title": (remote.get("page_title") or "").strip(),
        "last_seen": last_seen_val,
        "last_poll_at": str(remote.get("last_poll_at") or "").strip(),
    }


def normalize_remote_chatgpt(remote):
    base = default_remote_chatgpt()
    if not remote:
        return base
    if not isinstance(remote, dict):
        logger.warning(
            "[REMOTE][INVALID_REMOTE_TYPE] type=%s fallback=default",
            type(remote).__name__,
        )
        return base
    from app.utils.legacy_cleanup import assert_no_legacy_fields

    remote_work = dict(remote)
    remote_work.pop("binding", None)
    for drop_key in (
        "enabled",
        "canonical_url",
        "last_reported_url",
        "prebound_home_client_id",
        "prebound_home_page_instance_id",
        "reserved_client_id",
        "reserved_page_instance_id",
        "reserved_at",
        "created_from_home",
        "opened_home_at",
        "bound_at",
        "reopen_request_id",
        "reopen_target_url",
        "pending_bootstrap_created_at",
        "pending_send_created_at",
        "bootstrap_message_id",
        "bootstrap_started_at",
        "bootstrap_in_progress",
    ):
        remote_work.pop(drop_key, None)
    assert_no_legacy_fields(remote_work, owner="normalize_remote_chatgpt")
    for key in _REMOTE_NORMALIZE_KEYS:
        if key in remote_work:
            base[key] = remote_work[key]
    for extra_key in ("page_display_id", "page_type", "page_title", "last_seen", "last_poll_at"):
        if extra_key in remote_work and extra_key not in base:
            base[extra_key] = remote_work[extra_key]

    url = (base.get("url") or "").strip() or (remote_work.get("url") or "").strip()
    if url and not (base.get("url") or "").strip():
        base["url"] = url

    legacy_conversation_id = (base.get("conversation_id") or "").strip() or (
        remote_work.get("conversation_id") or ""
    ).strip()
    if not legacy_conversation_id:
        legacy_conversation_id = parse_conversation_id(url)
    if legacy_conversation_id:
        base["conversation_id"] = legacy_conversation_id
        if not (base.get("url") or "").strip():
            base["url"] = f"https://chatgpt.com/c/{legacy_conversation_id}"

    base["bind_state"] = _infer_bind_state(remote_work, base)
    conversation_id = (base.get("conversation_id") or "").strip()
    if conversation_id and base["bind_state"] in (
        BIND_STATE_UNBOUND,
        BIND_STATE_PREBOUND_HOME,
        BIND_STATE_WAITING_HOME,
        BIND_STATE_WAITING_CONVERSATION_CREATED,
    ):
        base["bind_state"] = BIND_STATE_BOUND_CONVERSATION
    if base["bind_state"] == BIND_STATE_BOUND_OFFLINE:
        if conversation_id:
            base["bind_state"] = BIND_STATE_BOUND_CONVERSATION
        else:
            base["bind_state"] = BIND_STATE_UNBOUND
    return _core_remote_dict(base)


def write_session_remote_chatgpt(session, **fields):
    """
    唯一推荐写入入口：更新 session.remote_chatgpt 并规范化 url / bind_state。
    仅接受 REMOTE_CHATGPT_PERSISTENT_KEYS 与核心绑定字段；其余写入 bind_runtime。
    """
    if session is None:
        return default_remote_chatgpt()
    remote = normalize_remote_chatgpt(session.remote_chatgpt)
    from app.utils.bind_runtime import TRANSIENT_REMOTE_CHATGPT_KEYS

    for key in _REMOTE_NORMALIZE_KEYS:
        if key in fields and fields[key] is not None:
            remote[key] = fields[key]
    for key, value in fields.items():
        if key in TRANSIENT_REMOTE_CHATGPT_KEYS:
            logger.debug(
                "[SESSION_REMOTE][SKIP_TRANSIENT] session_id=%s field=%s",
                getattr(session, "session_id", "-"),
                key,
            )
            continue
        if key not in _REMOTE_NORMALIZE_KEYS:
            logger.debug(
                "[SESSION_REMOTE][SKIP_UNKNOWN] session_id=%s field=%s",
                getattr(session, "session_id", "-"),
                key,
            )
    url = page_url_from(remote)
    conversation_id = (remote.get("conversation_id") or "").strip()
    if not conversation_id and url:
        parsed_conversation_id = parse_conversation_id(url)
        if parsed_conversation_id:
            conversation_id = parsed_conversation_id
            remote["conversation_id"] = conversation_id
    if conversation_id:
        canonical = f"https://chatgpt.com/c/{conversation_id}"
        remote["url"] = canonical
        if (remote.get("bind_state") or "").strip() in (
            BIND_STATE_UNBOUND,
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
            "",
        ):
            remote["bind_state"] = BIND_STATE_BOUND_CONVERSATION
    elif (remote.get("bind_state") or "").strip() == BIND_STATE_PREBOUND_HOME:
        pass
    logger.info(
        "[SESSION_REMOTE][NORMALIZE] session_id=%s bind_state=%s conversation_id=%s url=%s",
        getattr(session, "session_id", "-"),
        remote.get("bind_state"),
        remote.get("conversation_id"),
        remote.get("url"),
    )
    remote = normalize_remote_chatgpt(remote)
    from app.utils.legacy_cleanup import assert_no_legacy_fields

    assert_no_legacy_fields(remote, owner="GUI session.remote_chatgpt")
    session.remote_chatgpt = remote
    return remote


@dataclass
class ChatMessage:
    role: str
    content: str
    created_at: float = field(default_factory=time.time)
    message_id: str = ""
    turn_id: str = ""
    ui_status: str = ""
    detail: str = ""
    message_source: str = ""
    bridge_message_id: str = ""
    parent_message_id: str = ""
    visible_in_chat: bool = True


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
    pending_reply_since: float = 0

    @property
    def has_pending_reply(self) -> bool:
        return float(self.pending_reply_since or 0) > 0

    @property
    def waiting_for_reply(self) -> bool:
        return self.has_pending_reply

    @property
    def waiting_since_ts(self) -> float:
        return float(self.pending_reply_since or 0)

    @property
    def waiting_elapsed_sec(self) -> int:
        since = float(self.pending_reply_since or 0)
        if since <= 0:
            return 0
        return max(0, int(time.time() - since))

    @property
    def conversation_id(self):
        remote = normalize_remote_chatgpt(self.remote_chatgpt)
        return (remote.get("conversation_id") or "").strip()

    @conversation_id.setter
    def conversation_id(self, value):
        remote = normalize_remote_chatgpt(self.remote_chatgpt)
        remote["conversation_id"] = (value or "").strip()
        self.remote_chatgpt = remote

    def __setattr__(self, name, value):
        if name == "remote_chatgpt":
            value = normalize_remote_chatgpt(value)
        elif name == "has_pending_reply":
            if value:
                if float(getattr(self, "pending_reply_since", 0) or 0) <= 0:
                    object.__setattr__(self, "pending_reply_since", time.time())
            else:
                object.__setattr__(self, "pending_reply_since", 0)
            return
        elif name in ("waiting_for_reply", "waiting_since_ts", "waiting_elapsed_sec"):
            if name == "waiting_for_reply":
                if value and float(getattr(self, "pending_reply_since", 0) or 0) <= 0:
                    object.__setattr__(self, "pending_reply_since", time.time())
                elif not value:
                    object.__setattr__(self, "pending_reply_since", 0)
            elif name == "waiting_since_ts" and value:
                object.__setattr__(self, "pending_reply_since", float(value or 0))
            return
        super().__setattr__(name, value)


def _message_field(message, key, default=""):
    if isinstance(message, dict):
        value = message.get(key)
    else:
        value = getattr(message, key, default)
    if value is None:
        return default
    return value


def is_waiting_placeholder_message(message) -> bool:
    """assistant 本地占位 / 等待回复类消息（运行态，不应跨 GUI 重启保留）。"""
    role = (_message_field(message, "role") or "").strip()
    if role != "assistant":
        return False
    source = (
        _message_field(message, "message_source")
        or _message_field(message, "source")
    ).strip()
    status = (
        _message_field(message, "ui_status")
        or _message_field(message, "status")
    ).strip()
    content = (_message_field(message, "content") or "").strip()
    from app.constants import (
        ASSISTANT_WAIT_TEXTS,
        WAITING_PLACEHOLDER_SOURCES,
        WAITING_PLACEHOLDER_STATUSES,
    )

    if source in WAITING_PLACEHOLDER_SOURCES:
        return True
    if status in WAITING_PLACEHOLDER_STATUSES:
        return True
    if content in ASSISTANT_WAIT_TEXTS:
        return True
    return content.startswith("等待回复")


def mark_waiting_placeholder_failed(message, *, content: str) -> bool:
    if not is_waiting_placeholder_message(message):
        return False
    if isinstance(message, dict):
        message["ui_status"] = "failed"
        message["status"] = "failed"
        message["content"] = content
    else:
        message.ui_status = "failed"
        message.content = content
    return True
