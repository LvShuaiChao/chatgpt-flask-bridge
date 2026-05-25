import re
from pathlib import Path

RUNTIME_DIR = Path(__file__).resolve().parent.parent / "runtime"
SESSIONS_FILE = RUNTIME_DIR / "chat_sessions.json"
SESSIONS_JSON_VERSION = 2
ASSISTANT_WAIT_TEXT = "等待回复…"
INVALID_ASSISTANT_REPLY_TEXTS = frozenset(
    {
        "正在思考",
        "正在生成",
        "思考中",
        "回复完成",
    }
)
# ChatGPT 思考阶段 UI 文案（如「已思考 4m 54s」「已思考 12 秒」），不得当作正式回复
_THINKING_DURATION_PLACEHOLDER_RE = re.compile(
    r"^已思考\s*"
    r"(?:若干秒|"
    r"几\s*秒|"
    r"\d+\s*秒|"
    r"\d+\s*分钟|"
    r"\d+\s*m(?:in)?(?:\s+\d+\s*s)?)"
    r"(?:\s*›)?\s*$",
    re.IGNORECASE,
)
_THOUGHT_FOR_DURATION_PLACEHOLDER_RE = re.compile(
    r"^Thought for\s+"
    r"(?:\d+\s*(?:seconds?|minutes?|m(?:in)?)(?:\s+\d+\s*s)?|.+?)"
    r"(?:\s*›)?\s*$",
    re.IGNORECASE,
)
# ChatGPT 风控/限流页（如 Unusual activity has been detected）
_CHATGPT_PLATFORM_ERROR_RE = re.compile(
    r"(?:unusual\s+activity\s+has\s+been\s+detected|检测到.{0,16}异常.{0,8}活动)",
    re.IGNORECASE,
)


_CHATGPT_PLATFORM_ERROR_DEPRECATED_LOGGED = False


# @deprecated 当前静态扫描无调用；确认无外部脚本引用后可删除。
def is_chatgpt_platform_error_text(text) -> bool:
    global _CHATGPT_PLATFORM_ERROR_DEPRECATED_LOGGED
    if not _CHATGPT_PLATFORM_ERROR_DEPRECATED_LOGGED:
        from app.utils.deprecation_log import log_deprecated_hit

        _CHATGPT_PLATFORM_ERROR_DEPRECATED_LOGGED = True
        log_deprecated_hit(
            name="is_chatgpt_platform_error_text",
            reason="no_internal_call",
            replacement="none",
        )
    value = str(text or "").strip()
    if not value:
        return False
    return bool(_CHATGPT_PLATFORM_ERROR_RE.search(value))


def is_invalid_assistant_reply_text(text) -> bool:
    value = str(text or "").strip()
    if not value:
        return True
    if value in INVALID_ASSISTANT_REPLY_TEXTS:
        return True
    if _THINKING_DURATION_PLACEHOLDER_RE.match(value):
        return True
    if _THOUGHT_FOR_DURATION_PLACEHOLDER_RE.match(value):
        return True
    return False
BOOTSTRAP_CLAIM_WAIT_TEXT = "等待 ChatGPT 首页领取首条消息…"
BOOTSTRAP_CLAIMED_WAIT_TEXT = "ChatGPT 页面已领取，等待回复…"
BOOTSTRAP_CLAIM_UNCLAIMED_WARN_TEXT = (
    "ChatGPT 首页尚未领取消息，请检查页面ID、绑定状态和油猴脚本是否在线。"
)
BOOTSTRAP_STALE_TIMEOUT_TEXT = "发送超时：页面未领取或未回传发送结果。"
BOOTSTRAP_CLAIM_WARN_AFTER_SECONDS = 30
DEFAULT_CHAT_INPUT_TEXT = "你好"
ASSISTANT_WAIT_TEXTS = frozenset(
    {
        ASSISTANT_WAIT_TEXT,
        "等待回复…",
        "等待回复...",
        "等待中…",
        "等待中...",
        "等待 ChatGPT 回复…",
        "等待回复...",
        "等待 ChatGPT 回复...",
        BOOTSTRAP_CLAIM_WAIT_TEXT,
        "等待 ChatGPT 首页领取首条消息...",
        BOOTSTRAP_CLAIMED_WAIT_TEXT,
        "ChatGPT 页面已领取，等待回复...",
        BOOTSTRAP_CLAIM_UNCLAIMED_WARN_TEXT,
        BOOTSTRAP_STALE_TIMEOUT_TEXT,
    }
)
ASSISTANT_REPLY_PENDING_STATUSES = frozenset(
    {
        "waiting",
        "assistant_pending",
        "waiting_reply",
        "等待中",
        "等待回复",
        "等待回复中",
    }
)

USER_SEND_PENDING_STATUSES = frozenset(
    {
        "sending",
        "queued",
        "waiting_send",
        "send_waiting",
        "发送中",
        "已加入队列",
        "等待发送",
    }
)

SYNC_PENDING_STATUSES = frozenset(
    {
        "syncing",
        "reading",
        "读取中",
        "同步中",
    }
)

UI_STATUS_DISPLAY_TEXT = {
    "sending": "发送中",
    "queued": "已加入队列",
    "waiting_send": "等待发送",
    "waiting": "等待回复…",
    "assistant_pending": "等待回复…",
    "waiting_reply": "等待回复…",
    "syncing": "同步中",
    "reading": "读取中",
    "failed": "失败",
    "timeout": "超时",
    "cancelled": "已取消",
    "done": "已完成",
}

PENDING_MISSING_ID_CLEAR_SECONDS = 15

# 仅保留 assistant 回复等待态；发送/同步态见 USER_SEND_PENDING_STATUSES / SYNC_PENDING_STATUSES
PENDING_ASSISTANT_STATUSES = ASSISTANT_REPLY_PENDING_STATUSES


def is_assistant_reply_pending_status(status: str | None) -> bool:
    if not status:
        return False
    return str(status).strip() in ASSISTANT_REPLY_PENDING_STATUSES


def is_user_send_pending_status(status: str | None) -> bool:
    if not status:
        return False
    return str(status).strip() in USER_SEND_PENDING_STATUSES


def is_sync_pending_status(status: str | None) -> bool:
    if not status:
        return False
    return str(status).strip() in SYNC_PENDING_STATUSES
PENDING_REPLY_SYNC_AFTER_SECONDS = 45
PENDING_REPLY_HARD_TIMEOUT_SECONDS = 180

# 桥接完整 JSON 日志（GUI / Flask / 油猴）；仅临时排查时改为 True
DEBUG_FULL_BRIDGE_JSON = False

PENDING_USER_SEND_STATUSES = USER_SEND_PENDING_STATUSES

# GUI 重启 / 写盘时不应保留的运行态等待文案
STARTUP_PENDING_RESET_MESSAGE = (
    "错误：上一次回复未完成，已在重新打开 GUI 时重置。"
    "若网页中已有回复，请点击【同步网页对话】刷新完整内容。"
)
PERSIST_PENDING_RESET_MESSAGE = (
    "错误：GUI 已关闭，上一条回复未完成。请重新同步网页对话。"
)
RESET_PLACEHOLDER_ERROR_TEXTS = frozenset(
    {
        STARTUP_PENDING_RESET_MESSAGE,
        PERSIST_PENDING_RESET_MESSAGE,
        "错误：GUI 已关闭，上一条回复未完成。请重新同步网页对话。",
        "错误：上一次回复未完成，已在重新打开 GUI 时重置。若网页中已有回复，请点击【同步网页对话】刷新完整内容。",
    }
)
WAITING_PLACEHOLDER_SOURCES = frozenset({"local_placeholder"})
WAITING_PLACEHOLDER_STATUSES = (
    ASSISTANT_REPLY_PENDING_STATUSES
    | frozenset({"等待回复"})
)

CHATGPT_HOME_URL = "https://chatgpt.com/"
# 油猴页面在线/活跃度（server.ONLINE_TIMEOUT_SEC 与此同源）
TM_POLL_FRESH_SECONDS = 5.0
TM_HEARTBEAT_ONLINE_SECONDS = 10.0
# 等待回复期间自动唤醒绑定页（后台节流补偿）
REPLY_WAKE_WAIT_SECONDS = 6.0
REPLY_WAKE_MIN_INTERVAL_SECONDS = 10.0
REPLY_WAKE_MAX_COUNT = 3
REPLY_WAKE_STALE_POLL_SECONDS = 5.0
# sync_conversation 入队前要求绑定页 last_poll_at 不超过此秒数
SYNC_COMMAND_POLL_MAX_AGE_SECONDS = 10.0
BOUND_PAGE_ONLINE_SECONDS = 30.0
BOUND_PAGE_STALE_SECONDS = 60.0
BOUND_PAGE_OFFLINE_GRACE_SECONDS = 10.0
SETTINGS_ORG = "TampermonkeyBridge"
SETTINGS_APP = "ChatGUI"
SESSION_BIND_LIST_STYLES = {
    "bound_online": {
        "bg": "#ecfdf5",
        "border": "#86efac",
        "left": "#22c55e",
        "text": "#166534",
        "label": "已绑定在线",
        "selected_border": "#16a34a",
    },
    "bound_offline": {
        "bg": "#fffbeb",
        "border": "#fbbf24",
        "left": "#f59e0b",
        "text": "#92400e",
        "label": "绑定离线",
        "selected_border": "#d97706",
    },
    "prebound_home": {
        "bg": "#eff6ff",
        "border": "#bfdbfe",
        "left": "#3b82f6",
        "text": "#1e3a8a",
        "label": "页面通道",
        "selected_border": "#2563eb",
    },
    "waiting_home": {
        "bg": "#fffbeb",
        "border": "#fde68a",
        "left": "#f59e0b",
        "text": "#78350f",
        "label": "等待首页",
        "selected_border": "#d97706",
    },
    "waiting_conversation_created": {
        "bg": "#fffbeb",
        "border": "#fde68a",
        "left": "#f59e0b",
        "text": "#78350f",
        "label": "创建中",
        "selected_border": "#d97706",
    },
    "waiting_bound_conversation": {
        "bg": "#fffbeb",
        "border": "#fde68a",
        "left": "#f59e0b",
        "text": "#78350f",
        "label": "等待打开绑定页",
        "selected_border": "#d97706",
    },
    "unbound": {
        "bg": "#f9fafb",
        "border": "#d1d5db",
        "left": "#9ca3af",
        "text": "#374151",
        "label": "未绑定",
        "selected_border": "#6b7280",
    },
    "bind_mismatch": {
        "bg": "#fef2f2",
        "border": "#fca5a5",
        "left": "#ef4444",
        "text": "#991b1b",
        "label": "绑定异常",
        "selected_border": "#dc2626",
    },
}

# 顶部状态栏会话绑定页（仅 UI 文案，不改变业务逻辑）
STATUS_CHIP_SESSION_BIND_PREFIX = "会话绑定页"

STATUS_CHIP_SESSION_BIND_TOOLTIP = (
    "表示当前本地对话真正绑定的远端 ChatGPT 页面。\n"
    "发送消息、同步网页对话、复制最后回复时，应优先使用这个绑定页面。"
)

UNBOUND_SESSION_SEND_HINT = (
    "当前会话未绑定 ChatGPT 页面，请先点击【打开 ChatGPT】或在列表选中页面后点击【绑定所选页面】。"
)

STATUS_DETAIL_TECH_HINT = (
    "client_id、page_instance_id、conversation_id、message_id 与原始状态"
    "请点击聊天页顶部「详情」查看。"
)


def status_chip_text(prefix, state):
    """顶部状态芯片：「前缀：状态」。"""
    return f"{prefix}：{state}"


# 油猴「发送快捷键」按钮经 GUI 模拟的系统级组合键（与 bridge 白名单一致）
DEFAULT_SYSTEM_HOTKEY_COMBO = "ctrl+alt+i"

DEFAULT_APP_SETTINGS = {
    "host": "127.0.0.1",
    "port": "5000",
    "enable_lan_access": False,
    "auto_start_server": True,
    "font_size": 14,
    "remember_window_geometry": True,
    "remember_window_position": True,
    "restore_main_tab": True,
    "restore_chat_tab": True,
    "show_top_status_bar": True,
    "enter_send_mode": "enter_send",
    "auto_clear_input_after_send": True,
    "auto_name_new_chat": True,
    "show_timestamp": True,
    "show_assistant_placeholder": True,
    "chat_sessions_path": str(RUNTIME_DIR),
    "save_chat_history": True,
    "debug_mode": False,
    "show_raw_payload": True,
    "mirror_log_to_console": False,
    "include_log_callsite": False,
    "log_ack_events": True,
    "log_assistant_reply_events": True,
    "log_send_failed_events": True,
    # 新建本地对话时是否自动打开/绑定 ChatGPT 首页（默认仅创建本地会话）
    "auto_open_chatgpt_on_new_session": False,
    # 0=不强制；N>0 时同一 GUI 会话连续 N 条用户消息后，外部 API 下一条自动新建会话
    "force_new_session_after_turns": 0,
}
