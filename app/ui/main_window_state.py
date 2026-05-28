"""MainWindow 按领域拆分的状态对象，集中默认值避免 __init__ 漏初始化。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BridgeUiState:
    last_bridge_status: dict = field(default_factory=dict)
    pending_status_apply_reason: str = ""
    pending_after_switch_status_apply: bool = False
    last_session_switch_status_apply_at: float = 0.0
    current_status_apply_reason: str = ""


@dataclass
class PageSelectorState:
    last_fingerprint: str = ""
    last_page_selector_key: str = ""


@dataclass
class WebSyncState:
    running: bool = False
    request_id: str = ""
    started_at: float = 0.0
    timeout_timer_request_id: str = ""
    hard_timed_out_request_ids: set = field(default_factory=set)
    pending_requests: dict = field(default_factory=dict)


@dataclass
class AutoBindState:
    pending_session_id: str = ""
    pending_until: float = 0.0
    pending_known_clients: set = field(default_factory=set)
    pending_known_page_instances: set = field(default_factory=set)
    runtime_by_session: dict = field(default_factory=dict)


@dataclass
class BindDisplayState:
    last_bound_page_seen_by_session: dict = field(default_factory=dict)
    last_session_bind_display_state: dict = field(default_factory=dict)
    last_session_bind_logged_pair: dict = field(default_factory=dict)
    last_session_bind_state_log_at: dict = field(default_factory=dict)
    auto_open_home_in_progress: bool = False
    auto_open_home_session_id: str = ""
    last_chat_area_style_key: str = ""
    last_page_relation_key: str = ""
    last_bind_mismatch_key: str = ""
    last_bind_mismatch_at: float = 0.0
    last_bind_mismatch_ui_key: str = ""


@dataclass
class PageCommandUiState:
    pending_sync_requests: dict = field(default_factory=dict)
    sync_conversation_running: bool = False
    set_bound_page_running: bool = False
    list_refreshing: bool = False


@dataclass
class BridgeMessageState:
    pending_upload_sends: dict = field(default_factory=dict)
    pending_send_requests: dict = field(default_factory=dict)
    pending_chat_render: object | None = None
    finalized_bridge_message_ids: set = field(default_factory=set)
    ack_success_message_ids: set = field(default_factory=set)


@dataclass
class SessionUiState:
    switching: bool = False


@dataclass
class ServerUiState:
    start_failed: bool = False
    start_error: str = ""


@dataclass
class LogUiState:
    """UI 日志领域状态（测试桩与 MainWindow 初始化共享）。"""

    last_log_at: float = 0.0
    last_log_level: str = ""
    last_log_text: str = ""

