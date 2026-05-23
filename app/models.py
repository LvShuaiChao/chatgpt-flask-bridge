import logging
import time
from dataclasses import dataclass, field

from app.url_utils import parse_conversation_id

logger = logging.getLogger(__name__)

BIND_STATE_UNBOUND = "UNBOUND"
BIND_STATE_TEMP_HOME_BOUND = "TEMP_HOME_BOUND"
BIND_STATE_BOUND_CONVERSATION = "BOUND_CONVERSATION"

# legacy 别名；TODO(cleanup-observe): 全局无引用，观察一个版本后可删。
BIND_STATE_BOUND = BIND_STATE_BOUND_CONVERSATION
BIND_STATE_PREBOUND_HOME = BIND_STATE_TEMP_HOME_BOUND
BIND_STATE_WAITING_HOME = BIND_STATE_UNBOUND
BIND_STATE_WAITING_CONVERSATION_CREATED = BIND_STATE_UNBOUND
BIND_STATE_BOUND_OFFLINE = "BOUND_OFFLINE"
BIND_STATE_WAITING_BOUND_CONVERSATION = BIND_STATE_UNBOUND

VALID_BIND_STATES = frozenset(
    {
        BIND_STATE_UNBOUND,
        BIND_STATE_TEMP_HOME_BOUND,
        BIND_STATE_BOUND_CONVERSATION,
        BIND_STATE_BOUND_OFFLINE,
    }
)

_LEGACY_BIND_STATE_ALIASES = {
    "BOUND": BIND_STATE_BOUND_CONVERSATION,
    "PREBOUND_HOME": BIND_STATE_TEMP_HOME_BOUND,
    "WAITING_HOME": BIND_STATE_UNBOUND,
    "WAITING_CONVERSATION_CREATED": BIND_STATE_UNBOUND,
    "WAITING_BOUND_CONVERSATION": BIND_STATE_UNBOUND,
}

REMOTE_CHATGPT_PERSISTENT_KEYS = (
    "bind_state",
    "conversation_id",
    "url",
    "client_id",
    "page_instance_id",
    "page_no",
    "page_display_id",
    "temp_page_id",
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
    "page_no",
    "page_display_id",
    "temp_page_id",
    "page_type",
    "page_title",
    "last_seen",
    "last_poll_at",
)


def default_remote_chatgpt():
    """长期绑定字段；临时运行态见 app.utils.bind_runtime.BindSessionRuntime。"""
    return {
        "bind_state": BIND_STATE_UNBOUND,
        "client_id": "",
        "page_instance_id": "",
        "conversation_id": "",
        "url": "",
        "page_display_id": "",
        "temp_page_id": "",
        "page_no": "",
        "page_type": "",
        "page_title": "",
        "last_seen": 0,
    }


def _canonical_bind_state(raw_state: str) -> str:
    state = (raw_state or "").strip()
    if state in VALID_BIND_STATES:
        return state
    return _LEGACY_BIND_STATE_ALIASES.get(state, state)


def is_temp_home_bound_state(bind_state: str) -> bool:
    """TEMP_HOME_BOUND / PREBOUND_HOME 视为同一种首页临时绑定。"""
    state = (bind_state or "").strip().upper()
    if state in ("TEMP_HOME_BOUND", "PREBOUND_HOME"):
        return True
    return _canonical_bind_state(bind_state) == BIND_STATE_TEMP_HOME_BOUND


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
    explicit = _canonical_bind_state(remote.get("bind_state") or base.get("bind_state") or "")
    if explicit in VALID_BIND_STATES and explicit != BIND_STATE_BOUND_OFFLINE:
        return explicit
    conversation_id = (remote.get("conversation_id") or base.get("conversation_id") or "").strip()
    if conversation_id:
        return BIND_STATE_BOUND_CONVERSATION
    temp_page_id = (
        (remote.get("temp_page_id") or remote.get("page_display_id") or remote.get("page_no") or "")
        .strip()
    )
    page_type = derive_remote_page_type(
        remote.get("url") or base.get("url") or "",
        conversation_id,
    )
    if page_type == "home" or temp_page_id:
        return BIND_STATE_TEMP_HOME_BOUND
    return BIND_STATE_UNBOUND


def _core_remote_dict(remote: dict) -> dict:
    out = {
        "bind_state": _canonical_bind_state(remote.get("bind_state") or BIND_STATE_UNBOUND),
        "client_id": (remote.get("client_id") or "").strip(),
        "page_instance_id": (remote.get("page_instance_id") or "").strip(),
        "conversation_id": (remote.get("conversation_id") or "").strip(),
        "url": (remote.get("url") or "").strip(),
    }
    for key in _REMOTE_NORMALIZE_KEYS:
        if key in remote and key not in out:
            out[key] = remote[key]
    for key in ("page_no", "page_type", "page_title", "last_seen", "last_poll_at"):
        if key in remote and key not in out:
            out[key] = remote[key]
    temp_page_id = (out.get("temp_page_id") or out.get("page_display_id") or out.get("page_no") or "").strip()
    if temp_page_id:
        out["temp_page_id"] = temp_page_id
        if not (out.get("page_display_id") or "").strip():
            out["page_display_id"] = temp_page_id
        if not (out.get("page_no") or "").strip():
            out["page_no"] = temp_page_id
    return out


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

    url = (base.get("url") or "").strip() or (remote_work.get("url") or "").strip()
    if url and not (base.get("url") or "").strip():
        base["url"] = url

    bind_state_before_conv = _canonical_bind_state(
        remote_work.get("bind_state") or base.get("bind_state") or ""
    )
    legacy_conversation_id = (base.get("conversation_id") or "").strip() or (
        remote_work.get("conversation_id") or ""
    ).strip()
    if bind_state_before_conv != BIND_STATE_TEMP_HOME_BOUND:
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
        BIND_STATE_TEMP_HOME_BOUND,
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
    bind_state = _canonical_bind_state(remote.get("bind_state") or "")
    url = (remote.get("url") or "").strip() if isinstance(remote, dict) else ""
    conversation_id = (remote.get("conversation_id") or "").strip()
    if bind_state != BIND_STATE_TEMP_HOME_BOUND:
        if not conversation_id and url:
            parsed_conversation_id = parse_conversation_id(url)
            if parsed_conversation_id:
                conversation_id = parsed_conversation_id
                remote["conversation_id"] = conversation_id
        if conversation_id:
            canonical = f"https://chatgpt.com/c/{conversation_id}"
            remote["url"] = canonical
            if bind_state in (
                BIND_STATE_UNBOUND,
                BIND_STATE_TEMP_HOME_BOUND,
                BIND_STATE_WAITING_HOME,
                BIND_STATE_WAITING_CONVERSATION_CREATED,
                "",
            ):
                remote["bind_state"] = BIND_STATE_BOUND_CONVERSATION
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
    reply_waiting_since: float = 0

    @property
    def has_pending_reply(self) -> bool:
        return float(self.reply_waiting_since or 0) > 0

    @property
    def waiting_for_reply(self) -> bool:
        return self.has_pending_reply

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
                if float(getattr(self, "reply_waiting_since", 0) or 0) <= 0:
                    object.__setattr__(self, "reply_waiting_since", time.time())
            else:
                object.__setattr__(self, "reply_waiting_since", 0)
            return
        elif name == "waiting_for_reply":
            if value and float(getattr(self, "reply_waiting_since", 0) or 0) <= 0:
                object.__setattr__(self, "reply_waiting_since", time.time())
            elif not value:
                object.__setattr__(self, "reply_waiting_since", 0)
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
