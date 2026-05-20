from pathlib import Path

RUNTIME_DIR = Path(__file__).resolve().parent.parent / "runtime"
SESSIONS_FILE = RUNTIME_DIR / "chat_sessions.json"
SESSIONS_JSON_VERSION = 2
ASSISTANT_WAIT_TEXT = "等待回复…"
ASSISTANT_WAIT_TEXTS = frozenset(
    {
        ASSISTANT_WAIT_TEXT,
        "等待 ChatGPT 回复…",
        "等待回复...",
        "等待 ChatGPT 回复...",
    }
)
PENDING_ASSISTANT_STATUSES = frozenset(
    {
        "等待中",
        "已加入队列",
        "等待回复",
        "发送中",
        "读取中",
    }
)
CHATGPT_HOME_URL = "https://chatgpt.com/"
# 油猴页面活跃度（与 server.ONLINE_TIMEOUT_SEC / GUI 判断一致）
TM_POLL_FRESH_SECONDS = 5.0
TM_HEARTBEAT_ONLINE_SECONDS = 15.0
BOUND_PAGE_ONLINE_SECONDS = 30.0
BOUND_PAGE_STALE_SECONDS = 60.0
BOUND_PAGE_OFFLINE_GRACE_SECONDS = 45.0
ACTIVE_POLL_SECONDS = 10.0
SETTINGS_ORG = "TampermonkeyBridge"
SETTINGS_APP = "ChatGUI"
SESSION_BIND_LIST_STYLES = {
    "bound_online": {
        "bg": "#eefaf1",
        "border": "#b7e4c7",
        "left": "#22c55e",
        "text": "#14532d",
        "label": "已绑定在线",
        "selected_border": "#16a34a",
    },
    "bound_offline": {
        "bg": "#fff7ed",
        "border": "#fed7aa",
        "left": "#f97316",
        "text": "#9a3412",
        "label": "绑定离线",
        "selected_border": "#ea580c",
    },
    "prebound_home": {
        "bg": "#eff6ff",
        "border": "#bfdbfe",
        "left": "#3b82f6",
        "text": "#1e3a8a",
        "label": "预绑定首页",
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
        "bg": "#ffffff",
        "border": "#e5e7eb",
        "left": "#9ca3af",
        "text": "#374151",
        "label": "未绑定",
        "selected_border": "#6b7280",
    },
    "bind_mismatch": {
        "bg": "#fef2f2",
        "border": "#ef4444",
        "left": "#dc2626",
        "text": "#7f1d1d",
        "label": "绑定异常",
        "selected_border": "#dc2626",
    },
}

DEFAULT_APP_SETTINGS = {
    "host": "127.0.0.1",
    "port": "5000",
    "enable_lan_access": False,
    "auto_start_server": False,
    "font_size": 14,
    "remember_window_geometry": True,
    "remember_window_position": True,
    "restore_main_tab": True,
    "restore_chat_tab": True,
    "show_page_url": True,
    "show_top_status_bar": True,
    "enter_send_mode": "enter_send",
    "auto_clear_input_after_send": True,
    "auto_scroll_to_bottom": True,
    "auto_name_new_chat": True,
    "show_timestamp": True,
    "show_assistant_placeholder": True,
    "chat_sessions_path": str(RUNTIME_DIR),
    "save_chat_history": True,
    "debug_mode": False,
    "show_raw_payload": True,
    "log_ack_events": True,
    "log_assistant_reply_events": True,
    "log_send_failed_events": True,
    "bind_each_chat_to_page": True,
    "auto_open_bound_page_when_missing": True,
    "allow_fallback_to_any_page": False,
    "auto_bind_unbound_page": True,
    "auto_open_and_bind_on_new_chat": False,
    "sync_full_conversation_enabled": True,
    "auto_sync_conversation_on_bind": False,
    "auto_sync_conversation_after_reply": False,
    "sync_conversation_max_messages": 200,
    "sync_conversation_mode": "merge",
    # 0=不强制；N>0 时同一 GUI 会话连续 N 条用户消息后，外部 API 下一条自动新建会话
    "force_new_session_after_turns": 0,
}
