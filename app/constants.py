from pathlib import Path

RUNTIME_DIR = Path(__file__).resolve().parent.parent / "runtime"
SESSIONS_FILE = RUNTIME_DIR / "chat_sessions.json"
SESSIONS_JSON_VERSION = 2
ASSISTANT_WAIT_TEXT = "等待回复…"
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
PENDING_ASSISTANT_STATUSES = frozenset(
    {
        "waiting",
        "等待中",
        "已加入队列",
        "等待回复",
        "发送中",
        "读取中",
    }
)
PENDING_REPLY_SYNC_AFTER_SECONDS = 45
PENDING_REPLY_HARD_TIMEOUT_SECONDS = 180
PENDING_REPLY_STALE_TIMEOUT_SEC = PENDING_REPLY_HARD_TIMEOUT_SECONDS

# 桥接完整 JSON 日志（GUI / Flask / 油猴）；稳定后可改为 False
DEBUG_FULL_BRIDGE_JSON = True

PENDING_USER_SEND_STATUSES = frozenset({"sending", "queued", "waiting_send"})

# GUI 重启 / 写盘时不应保留的运行态等待文案
STARTUP_PENDING_RESET_MESSAGE = (
    "错误：上一次回复未完成，已在重新打开 GUI 时重置。"
    "若网页中已有回复，请点击【同步网页对话】刷新完整内容。"
)
PERSIST_PENDING_RESET_MESSAGE = (
    "错误：GUI 已关闭，上一条回复未完成。请重新同步网页对话。"
)
WAITING_PLACEHOLDER_SOURCES = frozenset({"local_placeholder"})
WAITING_PLACEHOLDER_STATUSES = frozenset(
    {
        "waiting",
        "读取中",
        "等待回复",
        "assistant_pending",
    }
) | PENDING_ASSISTANT_STATUSES
UI_STATUS_DISPLAY_TEXT = {
    "sending": "发送中",
    "queued": "已加入队列",
    "waiting": ASSISTANT_WAIT_TEXT,
    "assistant_pending": ASSISTANT_WAIT_TEXT,
}

CHATGPT_HOME_URL = "https://chatgpt.com/"
# 油猴页面在线/活跃度（server.ONLINE_TIMEOUT_SEC 与此同源）
TM_POLL_FRESH_SECONDS = 5.0
TM_HEARTBEAT_ONLINE_SECONDS = 10.0
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

# 顶部状态栏三种页面角色（仅 UI 文案，不改变业务逻辑）
STATUS_CHIP_AUTO_FOCUS_PREFIX = "自动焦点页"
STATUS_CHIP_MANUAL_SELECT_PREFIX = "所选页面"
STATUS_CHIP_SESSION_BIND_PREFIX = "会话绑定页"

STATUS_CHIP_AUTO_FOCUS_TOOLTIP = (
    "表示油猴脚本自动检测到的当前浏览器焦点页面。\n"
    "如果显示“浏览器页面未获得焦点”，不代表页面不存在，"
    "只表示 ChatGPT 网页当前没有获得浏览器焦点。"
)
STATUS_CHIP_MANUAL_SELECT_TOOLTIP = (
    "表示「可用页面列表」中当前选中的页面。\n"
    "点击「绑定所选页面」后才会成为本会话的绑定目标。"
)
STATUS_CHIP_SESSION_BIND_TOOLTIP = (
    "表示当前本地对话真正绑定的远端 ChatGPT 页面。\n"
    "发送消息、同步网页对话、复制最后回复时，应优先使用这个绑定页面。"
)

STATUS_PAGE_ROLES_HINT = (
    "会话绑定页是当前对话实际发送和同步使用的目标页面；"
    "先在可用页面列表选中页面，再点击「绑定所选页面」。"
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
