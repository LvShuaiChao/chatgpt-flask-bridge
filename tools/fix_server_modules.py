"""Post-process generated app/server modules."""
from __future__ import annotations

import re
from pathlib import Path

PKG = Path(__file__).resolve().parents[1] / "app" / "server"

STATE_NAMES = [
    "_external_action_lock",
    "_pending_gui_actions",
    "_external_requests",
    "_bridge_message_to_external",
    "_session_external_pending",
    "_external_client_sessions",
    "_poll_summaries",
    "_last_poll_identity",
    "_last_poll_empty_log_at",
    "_last_poll_other_reason_log_at",
    "_known_page_instances",
    "_tm_prev_snapshot",
    "_last_tm_activity_classify_log",
    "_last_tm_response_state_log",
    "_last_focused_tm_page",
    "_last_focused_tm_page_at",
    "_last_focused_update_log_key",
    "_tm_page_display_id_by_key",
    "_tm_page_display_id_updated_at",
]


def fix_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    orig = text
    text = text.replace("st.st.", "st.")
    for name in STATE_NAMES:
        text = re.sub(rf"(?<!st\.){re.escape(name)}\b", f"st.{name}", text)
    text = re.sub(
        r"def set_log_callback\(callback\):\n        st\.",
        "def set_log_callback(callback):\n    st.",
        text,
    )
    text = re.sub(
        r"def set_status_callback\(callback\):\n        st\.",
        "def set_status_callback(callback):\n    st.",
        text,
    )
    text = re.sub(
        r'(def set_external_gui_dispatch\(callback\):[^\n]*\n(?:    [^\n]*\n)?)        st\.',
        r"\1    st.",
        text,
    )
    if text != orig:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main() -> None:
    for path in sorted(PKG.glob("*.py")):
        if fix_file(path):
            print("fixed", path.name)


if __name__ == "__main__":
    main()
