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
SETTINGS_ORG = "TampermonkeyBridge"
SETTINGS_APP = "ChatGUI"
DEFAULT_APP_SETTINGS = {
    "host": "127.0.0.1",
    "port": "5000",
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
}
