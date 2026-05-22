"""迁移 getattr(self, '_old_field', ...) 到 dataclass 状态访问。"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# (old_getattr_expr, replacement) — 按长度降序
REPLACEMENTS = [
    (
        'getattr(self, "_pending_auto_bind_known_page_instances", set())',
        "getattr(self._auto_bind, 'pending_known_page_instances', set())",
    ),
    (
        'getattr(self, "_pending_auto_bind_known_clients", set())',
        "getattr(self._auto_bind, 'pending_known_clients', set())",
    ),
    (
        'getattr(self, "_pending_auto_bind_session_id", "")',
        "getattr(self._auto_bind, 'pending_session_id', '')",
    ),
    (
        'getattr(self, "_auto_bind_wait_until", 0)',
        "getattr(self._auto_bind, 'wait_until', 0)",
    ),
    (
        'getattr(self, "_web_sync_hard_timed_out_request_ids", set())',
        "getattr(self._web_sync, 'hard_timed_out_request_ids', set())",
    ),
    (
        'getattr(self, "_web_sync_hard_timed_out_request_ids", None)',
        "getattr(self._web_sync, 'hard_timed_out_request_ids', None)",
    ),
    (
        'getattr(self, "_web_sync_timeout_retry_done", None)',
        "getattr(self._web_sync, 'timeout_retry_done', None)",
    ),
    (
        'getattr(self, "_web_sync_timeout_timer_request_id", "")',
        "getattr(self._web_sync, 'timeout_timer_request_id', '')",
    ),
    (
        'getattr(self, "_web_sync_request_id", "")',
        "getattr(self._web_sync, 'request_id', '')",
    ),
    (
        'getattr(self, "_web_sync_started_at", 0.0)',
        "getattr(self._web_sync, 'started_at', 0.0)",
    ),
    (
        'getattr(self, "_web_sync_running", False)',
        "getattr(self._web_sync, 'running', False)",
    ),
    (
        'getattr(self, "_pending_web_sync_requests", None)',
        "getattr(self._web_sync, 'pending_requests', None)",
    ),
    (
        'getattr(self, "_pending_web_sync_requests", {}).get',
        "getattr(self._web_sync, 'pending_requests', {}).get",
    ),
    (
        'getattr(self, "_pending_sync_requests", None)',
        "getattr(self._page_cmd, 'pending_sync_requests', None)",
    ),
    (
        'getattr(self, "_pending_sync_requests", {}).pop',
        "getattr(self._page_cmd, 'pending_sync_requests', {}).pop",
    ),
    (
        'getattr(self, "_pending_sync_requests", {}).get',
        "getattr(self._page_cmd, 'pending_sync_requests', {}).get",
    ),
    (
        'getattr(self, "_manual_current_tm_page_instance_id", "")',
        "getattr(self._page_selector, 'manual_page_instance_id', '')",
    ),
    (
        'getattr(self, "_manual_current_tm_conversation_id", "")',
        "getattr(self._page_selector, 'manual_conversation_id', '')",
    ),
    (
        'getattr(self, "_manual_current_tm_client_id", "")',
        "getattr(self._page_selector, 'manual_client_id', '')",
    ),
    (
        'getattr(self, "_manual_current_tm_page", None)',
        "getattr(self._page_selector, 'manual_page', None)",
    ),
    (
        'getattr(self, "_pending_tm_page_list_status", None)',
        "getattr(self._page_selector, 'pending_status', None)",
    ),
    (
        'getattr(self, "_last_tm_page_list_fingerprint", "")',
        "getattr(self._page_selector, 'last_fingerprint', '')",
    ),
    (
        'getattr(self, "_page_list_auto_refresh_failed", False)',
        "getattr(self._page_selector, 'auto_refresh_failed', False)",
    ),
    (
        'getattr(self, "_page_list_rebuild_running", False)',
        "getattr(self._page_selector, 'rebuild_running', False)",
    ),
    (
        'getattr(self, "_pending_bridge_status", None)',
        "getattr(self._bridge_ui, 'pending_bridge_status', None)",
    ),
    (
        'getattr(self, "_last_bridge_status", {}) or {}',
        "(getattr(self._bridge_ui, 'last_bridge_status', None) or {})",
    ),
    (
        'getattr(self, "_last_bridge_status", {})',
        "getattr(self._bridge_ui, 'last_bridge_status', {})",
    ),
    (
        'getattr(self, "_last_bridge_status", None) or {}',
        "(getattr(self._bridge_ui, 'last_bridge_status', None) or {})",
    ),
    (
        'getattr(self, "_last_bridge_status", None)',
        "getattr(self._bridge_ui, 'last_bridge_status', None)",
    ),
    (
        'getattr(self, "_server_start_failed", False)',
        "getattr(self._server_ui, 'start_failed', False)",
    ),
    (
        'getattr(self, "_session_switching", False)',
        "getattr(self._session_ui, 'switching', False)",
    ),
    (
        'getattr(self, "_pending_log_lines", [])',
        "getattr(self._log_ui, 'pending_log_lines', [])",
    ),
    (
        "getattr(self, '_last_bridge_status', None)",
        "getattr(self._bridge_ui, 'last_bridge_status', None)",
    ),
]

SKIP = {"_migrate_main_window_state_getattr.py", "_migrate_main_window_state.py"}


def main():
    changed = []
    for base in [ROOT / "app" / "ui", ROOT / "tests"]:
        for path in base.rglob("*.py"):
            if path.name in SKIP:
                continue
            raw = path.read_text(encoding="utf-8")
            new = raw
            for old, repl in sorted(REPLACEMENTS, key=lambda x: len(x[0]), reverse=True):
                new = new.replace(old, repl)
            if new != raw:
                path.write_text(new, encoding="utf-8")
                changed.append(path)
    print(f"updated {len(changed)} files")


if __name__ == "__main__":
    main()
