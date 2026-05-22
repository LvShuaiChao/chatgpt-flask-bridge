"""一次性迁移 MainWindow 散落状态字段到 dataclass 引用（勿重复运行）。"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REPLACEMENTS = [
    ("self._last_bridge_status", "self._bridge_ui.last_bridge_status"),
    ("self._applying_bridge_status", "self._bridge_ui.applying_bridge_status"),
    ("self._pending_bridge_status", "self._bridge_ui.pending_bridge_status"),
    ("self._status_apply_pending", "self._bridge_ui.status_apply_pending"),
    ("self._pending_status_payload", "self._bridge_ui.pending_status_payload"),
    ("self._pending_status_apply_reason", "self._bridge_ui.pending_status_apply_reason"),
    ("self._last_status_apply_at", "self._bridge_ui.last_status_apply_at"),
    ("self._last_status_snapshot_key", "self._bridge_ui.last_status_snapshot_key"),
    ("self._last_light_status_signature", "self._bridge_ui.last_light_status_signature"),
    ("self._last_status_apply_schedule_at", "self._bridge_ui.last_status_apply_schedule_at"),
    ("self._pending_after_switch_status_apply", "self._bridge_ui.pending_after_switch_status_apply"),
    ("self._last_session_switch_status_apply_at", "self._bridge_ui.last_session_switch_status_apply_at"),
    ("self._current_status_apply_reason", "self._bridge_ui.current_status_apply_reason"),
    ("self._last_tm_page_list_fingerprint", "self._page_selector.last_fingerprint"),
    ("self._tm_page_list_dirty", "self._page_selector.dirty"),
    ("self._page_list_refresh_in_progress", "self._page_selector.refresh_in_progress"),
    ("self._page_list_rebuild_running", "self._page_selector.rebuild_running"),
    ("self._page_list_auto_refresh_failed", "self._page_selector.auto_refresh_failed"),
    ("self._page_list_refresh_last_ms", "self._page_selector.refresh_last_ms"),
    ("self._tm_page_selector_refreshing", "self._page_selector.selector_refreshing"),
    ("self._last_page_selector_key", "self._page_selector.last_page_selector_key"),
    ("self._last_tm_clients_signature", "self._page_selector.last_tm_clients_signature"),
    ("self._pending_tm_page_list_status", "self._page_selector.pending_status"),
    ("self._manual_current_tm_page", "self._page_selector.manual_page"),
    ("self._manual_current_tm_client_id", "self._page_selector.manual_client_id"),
    ("self._manual_current_tm_page_instance_id", "self._page_selector.manual_page_instance_id"),
    ("self._manual_current_tm_conversation_id", "self._page_selector.manual_conversation_id"),
    ("self._manual_current_tm_url", "self._page_selector.manual_url"),
    ("self._web_sync_running", "self._web_sync.running"),
    ("self._web_sync_request_id", "self._web_sync.request_id"),
    ("self._web_sync_started_at", "self._web_sync.started_at"),
    ("self._web_sync_timeout_timer_request_id", "self._web_sync.timeout_timer_request_id"),
    ("self._web_sync_hard_timed_out_request_ids", "self._web_sync.hard_timed_out_request_ids"),
    ("self._web_sync_timeout_retry_done", "self._web_sync.timeout_retry_done"),
    ("self._pending_web_sync_requests", "self._web_sync.pending_requests"),
    ("self._auto_bind_known_clients", "self._auto_bind.known_clients"),
    ("self._auto_bind_wait_until", "self._auto_bind.wait_until"),
    ("self._pending_auto_bind_session_id", "self._auto_bind.pending_session_id"),
    ("self._pending_auto_bind_until", "self._auto_bind.pending_until"),
    ("self._pending_auto_bind_known_clients", "self._auto_bind.pending_known_clients"),
    ("self._pending_auto_bind_known_page_instances", "self._auto_bind.pending_known_page_instances"),
    ("self._last_bound_page_seen_by_session", "self._bind_display.last_bound_page_seen_by_session"),
    ("self._last_session_bind_display_state", "self._bind_display.last_session_bind_display_state"),
    ("self._last_session_bind_logged_pair", "self._bind_display.last_session_bind_logged_pair"),
    ("self._last_session_bind_state_log_at", "self._bind_display.last_session_bind_state_log_at"),
    ("self._last_auto_open_url_at", "self._bind_display.last_auto_open_url_at"),
    ("self._last_chat_area_style_key", "self._bind_display.last_chat_area_style_key"),
    ("self._last_page_relation_key", "self._bind_display.last_page_relation_key"),
    ("self._last_bind_mismatch_key", "self._bind_display.last_bind_mismatch_key"),
    ("self._last_bind_mismatch_at", "self._bind_display.last_bind_mismatch_at"),
    ("self._last_bind_mismatch_ui_key", "self._bind_display.last_bind_mismatch_ui_key"),
    ("self._pending_sync_requests", "self._page_cmd.pending_sync_requests"),
    ("self._sync_conversation_running", "self._page_cmd.sync_conversation_running"),
    ("self._set_bound_page_running", "self._page_cmd.set_bound_page_running"),
    ("self._list_refreshing", "self._page_cmd.list_refreshing"),
    ("self._pending_upload_sends", "self._bridge_msg.pending_upload_sends"),
    ("self._pending_send_requests", "self._bridge_msg.pending_send_requests"),
    ("self._pending_chat_render", "self._bridge_msg.pending_chat_render"),
    ("self._finalized_bridge_message_ids", "self._bridge_msg.finalized_bridge_message_ids"),
    ("self._ack_success_message_ids", "self._bridge_msg.ack_success_message_ids"),
    ("self._pending_log_lines", "self._log_ui.pending_log_lines"),
    ("self._log_flush_scheduled", "self._log_ui.flush_scheduled"),
    ("self._log_tab_load_pending", "self._log_ui.tab_load_pending"),
    ("self._session_switching", "self._session_ui.switching"),
    ("self._server_start_failed", "self._server_ui.start_failed"),
    ("self._server_start_error", "self._server_ui.start_error"),
    ("self._tampermonkey_page_url", "self._server_ui.tampermonkey_page_url"),
]

# 测试里常见 win._xxx 形式
WIN_REPLACEMENTS = [
    (old.replace("self.", "win."), new.replace("self.", "win."))
    for old, new in REPLACEMENTS
    if old.startswith("self.")
]

GLOB_DIRS = [
    ROOT / "app" / "ui",
    ROOT / "tests",
]

SKIP = {"main_window_state.py", "_migrate_main_window_state.py"}


def migrate_text(text: str) -> str:
    all_repls = sorted(REPLACEMENTS + WIN_REPLACEMENTS, key=lambda x: len(x[0]), reverse=True)
    for old, new in all_repls:
        text = text.replace(old, new)
    return text


def main():
    changed = []
    for base in GLOB_DIRS:
        for path in base.rglob("*.py"):
            if path.name in SKIP:
                continue
            raw = path.read_text(encoding="utf-8")
            new = migrate_text(raw)
            if new != raw:
                path.write_text(new, encoding="utf-8")
                changed.append(path)
    print(f"updated {len(changed)} files")
    for p in changed:
        print(" ", p.relative_to(ROOT))


if __name__ == "__main__":
    main()
