import logging
import time
from dataclasses import dataclass, field

from app.url_utils import parse_conversation_id

logger = logging.getLogger(__name__)

# Session message retention limit: prevent unbounded JSON growth without
# clipping long-running GUI history too aggressively.
MAX_SESSION_MESSAGES = 5000

BIND_STATE_UNBOUND = "UNBOUND"
BIND_STATE_TEMP_HOME_BOUND = "TEMP_HOME_BOUND"
BIND_STATE_BOUND_CONVERSATION = "BOUND_CONVERSATION"

BIND_STATE_PREBOUND_HOME = BIND_STATE_TEMP_HOME_BOUND
BIND_STATE_WAITING_HOME = "WAITING_HOME"
BIND_STATE_WAITING_CONVERSATION_CREATED = "WAITING_CONVERSATION_CREATED"
BIND_STATE_BOUND_OFFLINE = "BOUND_OFFLINE"
BIND_STATE_WAITING_BOUND_CONVERSATION = "WAITING_BOUND_CONVERSATION"

BIND_MODE_PAGE_CHANNEL = "page_channel"
BIND_MODE_HOME_PENDING = "home_pending"
BIND_MODE_CONVERSATION = "conversation"
VALID_BIND_MODES = frozenset(
    {BIND_MODE_PAGE_CHANNEL, BIND_MODE_HOME_PENDING, BIND_MODE_CONVERSATION}
)

VALID_BIND_STATES = frozenset(
    {
        BIND_STATE_UNBOUND,
        BIND_STATE_TEMP_HOME_BOUND,
        BIND_STATE_BOUND_CONVERSATION,
        BIND_STATE_BOUND_OFFLINE,
        BIND_STATE_WAITING_HOME,
        BIND_STATE_WAITING_CONVERSATION_CREATED,
        BIND_STATE_WAITING_BOUND_CONVERSATION,
    }
)

_LEGACY_BIND_STATE_ALIASES = {
    "BOUND": BIND_STATE_BOUND_CONVERSATION,
    "PREBOUND_HOME": BIND_STATE_TEMP_HOME_BOUND,
}

REMOTE_CHATGPT_PERSISTENT_KEYS = (
    "bind_state",
    "client_id",
    "page_instance_id",
    "page_display_id",
    "conversation_id",
    "url",
)

_REMOTE_NORMALIZE_KEYS = (
    "bind_state",
    "client_id",
    "page_instance_id",
    "page_display_id",
    "conversation_id",
    "url",
)


def default_remote_chatgpt():
    """长期绑定字段；临时运行态见 app.utils.bind_runtime.BindSessionRuntime。"""
    return {
        "bind_state": BIND_STATE_UNBOUND,
        "client_id": "",
        "page_instance_id": "",
        "page_display_id": "",
        "conversation_id": "",
        "url": "",
    }


def derive_bind_mode(remote) -> str:
    """由 bind_mode / bind_state / conversation_id 推导绑定模式。"""
    if not isinstance(remote, dict):
        return ""
    conversation_id = (remote.get("conversation_id") or "").strip()
    bind_state = _canonical_bind_state(remote.get("bind_state") or "")
    if conversation_id or bind_state == BIND_STATE_BOUND_CONVERSATION:
        return BIND_MODE_CONVERSATION
    if is_temp_home_bound_state(bind_state):
        return BIND_MODE_HOME_PENDING
    return ""


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
    """bind_state != UNBOUND 即视为已启用绑定。这里不做 normalize，避免 UI 初始化阶段二次 normalize。"""
    if not isinstance(remote, dict):
        return False
    bind_state = _canonical_bind_state(remote.get("bind_state") or BIND_STATE_UNBOUND)
    return bind_state != BIND_STATE_UNBOUND


_REMOTE_BINDING_DEPRECATED_LOGGED = False


def remote_binding_enabled(remote) -> bool:
    """
    @deprecated
    兼容旧调用名。新代码使用 remote_binding_active(remote)。
    确认全项目无引用后删除。
    """
    global _REMOTE_BINDING_DEPRECATED_LOGGED
    if not _REMOTE_BINDING_DEPRECATED_LOGGED:
        from app.utils.deprecation_log import log_deprecated_hit

        _REMOTE_BINDING_DEPRECATED_LOGGED = True
        log_deprecated_hit(
            name="remote_binding_enabled",
            reason="compat_wrapper",
            replacement="remote_binding_active",
        )
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


def _infer_bind_state(
    remote,
    base,
    *,
    bootstrap_in_progress=False,
    bootstrap_message_id="",
    raw_bind_state="",
):
    raw_bind_state = (
        raw_bind_state
        or (remote.get("bind_state") or base.get("bind_state") or "")
    ).strip()
    explicit = _canonical_bind_state(raw_bind_state)
    conversation_id = (remote.get("conversation_id") or base.get("conversation_id") or "").strip()
    client_id = (remote.get("client_id") or base.get("client_id") or "").strip()
    page_instance_id = (
        remote.get("page_instance_id") or base.get("page_instance_id") or ""
    ).strip()
    page_display_id = (
        (remote.get("page_display_id") or base.get("page_display_id") or "").strip()
    )
    page_channel_waiting = raw_bind_state in (
        "WAITING_CONVERSATION_CREATED",
        "PREBOUND_HOME",
    ) or bootstrap_in_progress or bool(bootstrap_message_id)
    if page_channel_waiting and client_id and page_instance_id and not conversation_id:
        return BIND_STATE_TEMP_HOME_BOUND
    if explicit == BIND_STATE_UNBOUND and client_id and page_instance_id and not conversation_id:
        page_type = derive_remote_page_type(
            remote.get("url") or base.get("url") or "",
            conversation_id,
        )
        if page_type == "home" or page_display_id:
            return BIND_STATE_TEMP_HOME_BOUND
    if explicit in VALID_BIND_STATES and explicit != BIND_STATE_BOUND_OFFLINE:
        return explicit
    if conversation_id:
        return BIND_STATE_BOUND_CONVERSATION
    page_type = derive_remote_page_type(
        remote.get("url") or base.get("url") or "",
        conversation_id,
    )
    if page_type == "home" or page_display_id:
        return BIND_STATE_TEMP_HOME_BOUND
    return BIND_STATE_UNBOUND


def _migrate_remote_legacy_fields(remote: dict) -> dict:
    migrated = dict(remote)
    page_display_id = (
        str(
            migrated.get("page_display_id")
            or migrated.get("temp_page_id")
            or migrated.get("page_no")
            or ""
        ).strip()
    )
    if page_display_id:
        migrated["page_display_id"] = page_display_id
    for key in (
        "temp_page_id",
        "page_no",
        "page_type",
        "page_title",
        "last_seen",
        "last_poll_at",
        "bind_mode",
        "bind_request_id",
        "bind_started_at",
        "pending_bootstrap_content",
        "pending_send_content",
        "pending_send_message_id",
        "reopen_started_at",
        "bootstrap_in_progress",
        "bootstrap_message_id",
        "bootstrap_started_at",
        "pending_bootstrap_created_at",
        "opened_home_at",
        "bound_at",
        "pending_send_created_at",
        "reopen_request_id",
        "reopen_target_url",
    ):
        migrated.pop(key, None)
    return migrated


def _core_remote_dict(remote: dict) -> dict:
    out = {
        "bind_state": _canonical_bind_state(remote.get("bind_state") or BIND_STATE_UNBOUND),
        "client_id": (remote.get("client_id") or "").strip(),
        "page_instance_id": (remote.get("page_instance_id") or "").strip(),
        "page_display_id": (remote.get("page_display_id") or "").strip(),
        "conversation_id": (remote.get("conversation_id") or "").strip(),
        "url": (remote.get("url") or "").strip(),
    }
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
    remote_work = dict(remote)
    from app.utils.legacy_cleanup import assert_no_remote_chatgpt_invalid_fields
    from app.utils.legacy_fields import LEGACY_CLEANUP_FIELD_NAMES

    invalid_legacy_fields = sorted(
        key
        for key in remote_work.keys()
        if key in LEGACY_CLEANUP_FIELD_NAMES
    )
    if invalid_legacy_fields:
        raise ValueError(
            f"legacy fields not allowed in remote_chatgpt: {invalid_legacy_fields}"
        )
    raw_bind_state_before = (remote_work.get("bind_state") or "").strip()
    bootstrap_in_progress = bool(remote_work.get("bootstrap_in_progress"))
    bootstrap_message_id = (remote_work.get("bootstrap_message_id") or "").strip()
    migrated = _migrate_remote_legacy_fields(remote_work)
    for key in _REMOTE_NORMALIZE_KEYS:
        if key in migrated:
            base[key] = migrated[key]

    url = (base.get("url") or "").strip() or (migrated.get("url") or "").strip()
    if url and not (base.get("url") or "").strip():
        base["url"] = url

    bind_state_before_conv = _canonical_bind_state(
        migrated.get("bind_state") or base.get("bind_state") or ""
    )
    legacy_conversation_id = (base.get("conversation_id") or "").strip() or (
        migrated.get("conversation_id") or ""
    ).strip()
    if bind_state_before_conv != BIND_STATE_TEMP_HOME_BOUND:
        if not legacy_conversation_id:
            legacy_conversation_id = parse_conversation_id(url)
        if legacy_conversation_id:
            base["conversation_id"] = legacy_conversation_id
            if not (base.get("url") or "").strip():
                base["url"] = f"https://chatgpt.com/c/{legacy_conversation_id}"

    base["bind_state"] = _infer_bind_state(
        remote_work,
        base,
        bootstrap_in_progress=bootstrap_in_progress,
        bootstrap_message_id=bootstrap_message_id,
        raw_bind_state=raw_bind_state_before,
    )
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

    remote_clean = _core_remote_dict(base)
    assert_no_remote_chatgpt_invalid_fields(
        remote_clean,
        owner="normalize_remote_chatgpt",
    )
    return remote_clean


def write_session_remote_chatgpt(session, **fields):
    """
    唯一推荐写入入口：更新 session.remote_chatgpt 并规范化 url / bind_state。
    仅接受 REMOTE_CHATGPT_PERSISTENT_KEYS 与核心绑定字段；其余写入 bind_runtime。
    """
    if session is None:
        return default_remote_chatgpt()
    remote = normalize_remote_chatgpt(session.remote_chatgpt)
    from app.utils.bind_runtime import TRANSIENT_REMOTE_CHATGPT_KEYS

    if "page_display_id" not in fields:
        migrated_page_display_id = (
            str(
                fields.get("temp_page_id")
                or fields.get("page_no")
                or remote.get("page_display_id")
                or ""
            ).strip()
        )
        if migrated_page_display_id:
            fields["page_display_id"] = migrated_page_display_id

    for key in REMOTE_CHATGPT_PERSISTENT_KEYS:
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
        if key not in REMOTE_CHATGPT_PERSISTENT_KEYS:
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
    from app.utils.legacy_cleanup import assert_no_remote_chatgpt_invalid_fields

    assert_no_remote_chatgpt_invalid_fields(remote, owner="GUI session.remote_chatgpt")
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
    reply_wake_count: int = 0
    last_reply_wake_at: float = 0

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

    def trim_messages(self, max_count=None):
        """裁剪消息列表，只保留最近 max_count 条消息。"""
        max_count = max_count or MAX_SESSION_MESSAGES
        if max_count <= 0:
            return 0
        if len(self.messages) <= max_count:
            return 0
        removed = len(self.messages) - max_count
        self.messages = self.messages[-max_count:]
        logger.info(
            "[SESSION][TRIM_MESSAGES] session_id=%s removed=%d remaining=%d",
            self.session_id,
            removed,
            len(self.messages),
        )
        return removed


def _message_field(message, key, default=""):
    if isinstance(message, dict):
        value = message.get(key)
    else:
        value = getattr(message, key, default)
    if value is None:
        return default
    return value


def is_waiting_placeholder_message(message) -> bool:
    """判断 assistant 本地等待占位消息。

    关键原则：
    只要 assistant 消息已经有真实正文，就不能再因为 source/status 残留旧值而判定为等待占位。
    否则 GUI 启动或保存时会把真实回复覆盖成“上一次回复未完成”。
    """
    role = str(_message_field(message, "role") or "").strip()
    if role != "assistant":
        return False

    source = str(
        _message_field(message, "message_source")
        or _message_field(message, "source")
        or ""
    ).strip()

    status = str(
        _message_field(message, "ui_status")
        or _message_field(message, "status")
        or ""
    ).strip()

    content = str(_message_field(message, "content") or "").strip()

    from app.constants import (
        ASSISTANT_WAIT_TEXTS,
        WAITING_PLACEHOLDER_SOURCES,
        is_assistant_reply_pending_status,
        is_sync_pending_status,
        is_user_send_pending_status,
    )

    if is_user_send_pending_status(status) or is_sync_pending_status(status):
        return False

    content_is_waiting = (
        not content
        or content in ASSISTANT_WAIT_TEXTS
        or content.startswith("等待回复")
        or content.startswith("等待 ChatGPT")
        or content.startswith("ChatGPT 页面已领取，等待回复")
        or content.startswith("发送超时：页面未领取")
    )

    # 关键保护：有真实正文时，绝对不能再按 source/status 当成占位消息。
    if content and not content_is_waiting:
        return False

    if source in WAITING_PLACEHOLDER_SOURCES:
        return True

    if is_assistant_reply_pending_status(status):
        return True

    return content_is_waiting


def is_reset_placeholder_error_message(message) -> bool:
    """判断是否为 GUI 自己生成的等待占位错误消息。"""
    content = str(_message_field(message, "content") or "").strip()
    if not content:
        return False

    from app.constants import RESET_PLACEHOLDER_ERROR_TEXTS

    if content in RESET_PLACEHOLDER_ERROR_TEXTS:
        return True

    if content.startswith("错误：GUI 已关闭，上一条回复未完成"):
        return True

    if content.startswith("错误：上一次回复未完成，已在重新打开 GUI 时重置"):
        return True

    return False
