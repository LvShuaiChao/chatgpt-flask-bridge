from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MORE = [
    (
        'status or getattr(self, "_last_bridge_status", None) or {}',
        "status or self._bridge_ui.last_bridge_status or {}",
    ),
    (
        'getattr(self, "_last_bridge_status", None) or {}',
        "self._bridge_ui.last_bridge_status or {}",
    ),
    (
        'getattr(self, "_last_bridge_status", {}) or {}',
        "self._bridge_ui.last_bridge_status or {}",
    ),
    (
        'getattr(self, "_last_bridge_status", None)',
        'getattr(self._bridge_ui, "last_bridge_status", None)',
    ),
    (
        'getattr(self, "_last_bridge_status", {})',
        'getattr(self._bridge_ui, "last_bridge_status", {})',
    ),
    (
        '(getattr(self, "_manual_current_tm_client_id", "") or "").strip()',
        "(self._page_selector.manual_client_id or '').strip()",
    ),
    (
        'getattr(self, "_manual_current_tm_page_instance_id", "") or ""',
        "self._page_selector.manual_page_instance_id or ''",
    ),
    (
        '(getattr(self, "_manual_current_tm_conversation_id", "") or "").strip()',
        "(self._page_selector.manual_conversation_id or '').strip()",
    ),
    (
        'getattr(self, "_pending_web_sync_requests", {}).pop',
        "self._web_sync.pending_requests.pop",
    ),
    (
        'getattr(self, "_session_switching", False)',
        'getattr(self._session_ui, "switching", False)',
    ),
    (
        'getattr(self, "_server_start_failed", False)',
        'getattr(self._server_ui, "start_failed", False)',
    ),
    (
        'getattr(self, "_server_start_error", "")',
        'getattr(self._server_ui, "start_error", "")',
    ),
    (
        'getattr(self, "_pending_bridge_status", None)',
        'getattr(self._bridge_ui, "pending_bridge_status", None)',
    ),
    (
        'if not hasattr(self, "_pending_web_sync_requests"):',
        'if not hasattr(self, "_web_sync"):',
    ),
    (
        'if not hasattr(self, "_pending_sync_requests"):',
        'if not hasattr(self, "_page_cmd"):',
    ),
]

for base in [ROOT / "app" / "ui", ROOT / "tests"]:
    for path in base.rglob("*.py"):
        t = path.read_text(encoding="utf-8")
        n = t
        for a, b in sorted(MORE, key=lambda x: -len(x[0])):
            n = n.replace(a, b)
        if n != t:
            path.write_text(n, encoding="utf-8")
            print(path.relative_to(ROOT))
