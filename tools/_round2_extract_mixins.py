"""One-shot extractor for round-2 mixin split. Run from repo root."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIND = ROOT / "app/ui/mixins/page_bind_mixin.py"
SYNC = ROOT / "app/ui/mixins/page_sync_mixin.py"


def extract_methods(source: str, method_names: list[str]) -> tuple[str, str]:
    """Return (extracted_block, remaining_source)."""
    lines = source.splitlines(keepends=True)
    extracted_parts: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^    def (\w+)\(", line)
        if m and m.group(1) in method_names:
            start = i
            # class-level constant before method
            if i > 0 and re.match(r"^    [A-Z_]+ = ", lines[i - 1]):
                start = i - 1
            i += 1
            while i < len(lines):
                if re.match(r"^    def \w+\(", lines[i]) or re.match(
                    r"^class \w+", lines[i]
                ):
                    break
                i += 1
            extracted_parts.append("".join(lines[start:i]))
            del lines[start:i]
            i = start
            continue
        i += 1
    return "".join(extracted_parts), "".join(lines)


SELECTOR_METHODS = [
    "_page_full_url",
    "_extract_chatgpt_conversation_id_from_url",
    "_page_chatgpt_conversation_id",
    "_page_has_focus",
    "_find_focused_tm_page",
    "_find_tm_page_by_selector_data",
    "_selected_tm_page_from_selector",
    "_on_tm_page_selector_changed",
    "_tm_selector_action_hint_for_page",
    "_on_set_manual_current_page_clicked",
    "_set_manual_current_tm_page",
    "_refresh_manual_current_page_display",
    "_get_manual_current_tm_page",
    "_find_tm_client_by_client_id",
    "_current_focused_tm_page",
    "_current_bound_tm_page",
    "_find_last_focused_tm_page",
    "_pages_same_identity",
]

DIAG_METHODS = [
    "_log_send_bind_check",
    "_log_bind_auto_rebind",
    "_detect_bind_mismatch",
    "_log_tm_status_summary",
    "_log_bind_mismatch_if_needed",
    "_set_close_other_pages_enabled",
    "_sync_log_context_fields",
    "_maybe_log_conversation_id_mismatch",
    "_manual_bound_identity_mismatch_text",
    "_sync_target_unavailable_reason_text",
]

SYNC_METHODS = [
    "_message_fingerprint",
    "_normalize_synced_message_text",
    "_is_protected_local_message",
    "_existing_message_fingerprints",
    "_dedupe_synced_messages_in_session",
    "_refresh_local_conversation_after_sync",
    "_clear_pending_wait_messages_after_web_sync",
    "_sync_session_messages_from_web_snapshot",
    "_check_web_sync_timeout",
    "_schedule_auto_sync_conversation",
    "_get_session_sync_key",
    "_mark_session_sync_running",
    "_session_bound_client_id",
]

SELECTOR_HEADER = '''"""手动当前页与页面选择器。"""

import re
import time

from app.models import normalize_remote_chatgpt
from PyQt5.QtCore import Qt


class PageSelectorMixin:
'''

DIAG_HEADER = '''"""绑定冲突检测与诊断日志。"""

import time
import traceback

from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    normalize_remote_chatgpt,
)
from app.utils.trace_log import kv_line, page_type_label


class PageBindingDiagnosticsMixin:
'''

SYNC_APPEND_HEADER = '''

# --- round-2: snapshot merge helpers (moved from page_bind_mixin) ---
'''


def main():
    bind_src = BIND.read_text(encoding="utf-8")

    selector_block, bind_src = extract_methods(bind_src, SELECTOR_METHODS)
    diag_block, bind_src = extract_methods(bind_src, DIAG_METHODS)
    sync_block, bind_src = extract_methods(bind_src, SYNC_METHODS)

    selector_path = ROOT / "app/ui/mixins/page_selector_mixin.py"
    selector_path.write_text(
        SELECTOR_HEADER + selector_block.replace("    def ", "\n    def ", 1).lstrip("\n"),
        encoding="utf-8",
    )
    # fix: selector block should keep indentation
    selector_path.write_text(SELECTOR_HEADER + selector_block, encoding="utf-8")

    diag_path = ROOT / "app/ui/mixins/page_binding_diagnostics_mixin.py"
    diag_path.write_text(DIAG_HEADER + diag_block, encoding="utf-8")

    sync_src = SYNC.read_text(encoding="utf-8")
    if "# --- round-2:" in sync_src:
        sync_src = sync_src.split("# --- round-2:")[0].rstrip() + "\n"
    SYNC.write_text(sync_src + SYNC_APPEND_HEADER + sync_block, encoding="utf-8")

    # Update PageBindMixin imports and bases
    bind_src = bind_src.replace(
        "from app.ui.mixins.page_binding_display_mixin import PageBindingDisplayMixin\n"
        "from app.ui.mixins.page_binding_state_mixin import PageBindingStateMixin\n"
        "from app.ui.mixins.page_sync_mixin import PageSyncMixin\n",
        "from app.ui.mixins.page_binding_diagnostics_mixin import PageBindingDiagnosticsMixin\n"
        "from app.ui.mixins.page_binding_display_mixin import PageBindingDisplayMixin\n"
        "from app.ui.mixins.page_binding_state_mixin import PageBindingStateMixin\n"
        "from app.ui.mixins.page_selector_mixin import PageSelectorMixin\n"
        "from app.ui.mixins.page_sync_mixin import PageSyncMixin\n",
    )
    bind_src = bind_src.replace(
        "class PageBindMixin(\n"
        "    PageBindingDisplayMixin,\n"
        "    PageSyncMixin,\n"
        "    PageBindingStateMixin,\n",
        "class PageBindMixin(\n"
        "    PageBindingDiagnosticsMixin,\n"
        "    PageBindingDisplayMixin,\n"
        "    PageSyncMixin,\n"
        "    PageBindingStateMixin,\n"
        "    PageSelectorMixin,\n",
    )

    BIND.write_text(bind_src, encoding="utf-8")
    print("selector lines:", len(selector_block.splitlines()))
    print("diag lines:", len(diag_block.splitlines()))
    print("sync lines:", len(sync_block.splitlines()))
    print("bind remaining lines:", len(bind_src.splitlines()))


if __name__ == "__main__":
    main()
