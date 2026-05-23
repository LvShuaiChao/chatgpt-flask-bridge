"""从 page_bind_mixin.py 提取子 mixin 到独立文件。在项目根目录运行。"""
from __future__ import annotations

import ast
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "app" / "ui" / "mixins" / "page_bind_mixin.py"

AUTO_BIND_METHODS = frozenset({
    "_session_has_prebound_home_online",
    "_find_prebound_home_client",
    "_session_user_message_count",
    "_is_new_local_session_without_remote_conversation",
    "_session_has_real_assistant_reply",
    "_session_is_local_new_chat_flow",
    "_session_has_wrong_existing_conversation_bind",
    "_reject_bind_existing_conversation_for_new_session",
    "_idle_home_sort_key",
    "_idle_home_selection_reason",
    "_session_bind_request_id",
    "_resolve_session_for_conversation_created",
    "_idle_home_skip_reason",
    "_recent_focus_home_client_id",
    "_is_fresh_idle_home_client",
    "_is_ignored_or_unusable_home_client",
    "_home_client_has_pending_bridge_work",
    "_is_home_client_used_by_any_session",
    "_find_idle_chatgpt_home_client",
    "_session_has_claimed_or_acked_bootstrap",
    "_prebound_home_is_retryable",
    "_session_needs_first_message_bind",
    "_start_waiting_home_on_send",
    "_prepare_first_message_binding",
    "_bound_conversation_target_url",
    "_open_bound_conversation_url",
    "_prepare_bound_conversation_reopen_if_needed",
    "_flush_pending_bound_send_message",
    "_try_finish_waiting_bound_conversations",
    "_prebound_home_bind_to_session",
    "_bind_conversation_to_session",
    "_apply_conversation_created_binding",
    "_is_client_bound_to_other_session",
    "_candidate_matches_remote",
    "_pick_auto_bind_client",
    "_auto_bind_current_session_if_needed",
    "_mark_auto_bind_waiting",
    "_clear_pending_auto_bind",
    "_try_finish_pending_auto_bind",
    "_sync_bound_session_urls_from_clients",
})

OPEN_CLOSE_METHODS = frozenset({
    "_open_or_queue_url",
    "_auto_open_url_once",
    "_open_page_once",
    "_open_url_in_browser",
    "_open_tampermonkey_page",
    "_chatgpt_url_from_remote",
    "_session_openable_chatgpt_url",
    "_live_openable_chatgpt_url",
    "_session_bound_conversation_url",
    "_bound_conversation_url",
    "_remember_session_page_from_client",
    "_open_bound_page_for_session",
    "_push_open_url",
    "_on_open_chatgpt_home",
    "_on_open_new_chatgpt_tab",
    "_on_open_bound_chatgpt_page",
    "_render_tampermonkey_clients",
    "_on_refresh_tm_pages",
    "_on_reload_bound_tm_page",
    "_enqueue_close_page",
    "_on_close_selected_tm_page",
    "_on_close_other_tm_pages",
    "_on_close_bound_tm_page",
})

SEND_TARGET_METHODS = frozenset({
    "_preferred_open_url_for_session",
    "_resolve_target_page_for_session",
    "_best_live_conversation_client",
    "_binding_status_details",
    "_verify_send_target_binding",
    "_is_sendable_chatgpt_client",
    "_find_online_client_for_remote",
    "_session_has_sendable_bound_page",
    "_session_bound_page_online",
    "_session_bound_page_has_mismatch",
    "_try_auto_bind_online_page",
    "_rebind_current_session_to_online_client_if_needed",
})

HEADERS = {
    "page_auto_bind_mixin.py": textwrap.dedent('''
        """自动绑定、首页预绑定、bootstrap 与对话创建绑定。"""

        import time
        import traceback
        import uuid

        import app.server
        from app.utils.log_utils import append_log

        from app.constants import (
            ASSISTANT_WAIT_TEXTS,
            CHATGPT_HOME_URL,
            PENDING_ASSISTANT_STATUSES,
        )
        from app.models import (
            BIND_STATE_BOUND_CONVERSATION,
            BIND_STATE_BOUND_OFFLINE,
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_UNBOUND,
            BIND_STATE_WAITING_BOUND_CONVERSATION,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
            BIND_STATE_WAITING_HOME,
            default_remote_chatgpt,
            normalize_remote_chatgpt,
        )
        from app.url_utils import parse_conversation_id
        from PyQt5.QtCore import QTimer


        class PageAutoBindMixin:
            IDLE_HOME_FRESH_SECONDS = 3.0
            BOOTSTRAP_CLAIM_TIMEOUT_SECONDS = 5.0
            REOPEN_BOUND_CONVERSATION_TIMEOUT_SECONDS = 30

    ''').strip() + "\n\n",
    "page_open_close_mixin.py": textwrap.dedent('''
        """打开 / 关闭 / 刷新 ChatGPT 页面与油猴页面表格。"""

        import traceback
        import uuid
        import webbrowser
        from urllib.parse import urlparse

        import app.server

        from app.constants import CHATGPT_HOME_URL
        from app.models import (
            BIND_STATE_BOUND_CONVERSATION,
            default_remote_chatgpt,
            normalize_remote_chatgpt,
        )
        from app.url_utils import parse_conversation_id
        from PyQt5.QtCore import QUrl, Qt
        from PyQt5.QtGui import QDesktopServices
        from PyQt5.QtWidgets import QTableWidgetItem


        class PageOpenCloseMixin:

    ''').strip() + "\n\n",
    "page_send_target_mixin.py": textwrap.dedent('''
        """发送目标解析、绑定校验与在线页面选择。"""

        import time

        from app.models import (
            BIND_STATE_BOUND_CONVERSATION,
            BIND_STATE_BOUND_OFFLINE,
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_UNBOUND,
            BIND_STATE_WAITING_HOME,
            default_remote_chatgpt,
            normalize_remote_chatgpt,
        )
        from app.url_utils import parse_conversation_id


        class PageSendTargetMixin:

    ''').strip() + "\n\n",
}

REMAINING_HEADER = textwrap.dedent('''
    """页面绑定主 mixin：UI 事件、同步、显示与入站桥接状态。"""

    import hashlib
    import html
    import time
    import traceback
    import uuid
    import webbrowser
    from urllib.parse import urlparse

    import app.server
    from app.utils.log_utils import append_log

    from app.constants import (
        ASSISTANT_WAIT_TEXTS,
        CHATGPT_HOME_URL,
        PENDING_ASSISTANT_STATUSES,
    )
    from app.models import (
        BIND_STATE_BOUND_CONVERSATION,
        BIND_STATE_BOUND_OFFLINE,
        BIND_STATE_PREBOUND_HOME,
        BIND_STATE_UNBOUND,
        BIND_STATE_WAITING_BOUND_CONVERSATION,
        BIND_STATE_WAITING_CONVERSATION_CREATED,
        BIND_STATE_WAITING_HOME,
        default_remote_chatgpt,
        normalize_remote_chatgpt,
    )
    from app.url_utils import parse_conversation_id
    from app.ui.mixins.page_auto_bind_mixin import PageAutoBindMixin
    from app.ui.mixins.page_open_close_mixin import PageOpenCloseMixin
    from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin
    from app.ui.mixins.page_tm_client_mixin import PageTmClientMixin
    from PyQt5.QtCore import QUrl, Qt, QTimer
    from PyQt5.QtGui import QDesktopServices
    from PyQt5.QtWidgets import QTableWidgetItem


    class PageBindMixin(
        PageOpenCloseMixin,
        PageAutoBindMixin,
        PageSendTargetMixin,
        PageTmClientMixin,
    ):

''').strip() + "\n"


def classify(name: str) -> str:
    if name in AUTO_BIND_METHODS:
        return "auto"
    if name in OPEN_CLOSE_METHODS:
        return "open"
    if name in SEND_TARGET_METHODS:
        return "send"
    return "remain"


def extract_methods(source: str) -> dict[str, list[tuple[str, str]]]:
    lines = source.splitlines(keepends=True)
    tree = ast.parse(source)
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "PageBindMixin")

    buckets: dict[str, list[tuple[str, str]]] = {
        "auto": [],
        "open": [],
        "send": [],
        "remain": [],
    }
    class_attrs: list[str] = []

    for node in cls.body:
        if isinstance(node, ast.FunctionDef):
            start = node.lineno - 1
            if node.decorator_list:
                start = min(d.lineno for d in node.decorator_list) - 1
            end = node.end_lineno
            body = "".join(lines[start:end])
            buckets[classify(node.name)].append((node.name, body))
        elif isinstance(node, ast.Assign):
            start = node.lineno - 1
            end = node.end_lineno
            # class-level constants only at top
            text = "".join(lines[start:end])
            if any(
                target.id in (
                    "IDLE_HOME_FRESH_SECONDS",
                    "BOOTSTRAP_CLAIM_TIMEOUT_SECONDS",
                    "REOPEN_BOUND_CONVERSATION_TIMEOUT_SECONDS",
                )
                for target in node.targets
                if isinstance(target, ast.Name)
            ):
                pass  # moved to PageAutoBindMixin header
            else:
                class_attrs.append(text)

    return buckets


def write_mixin(filename: str, methods: list[tuple[str, str]]) -> None:
    path = ROOT / "app" / "ui" / "mixins" / filename
    parts = [HEADERS[filename]]
    for _name, body in methods:
        parts.append(body)
        if not body.endswith("\n"):
            parts.append("\n")
    parts.append("\n")
    path.write_text("".join(parts), encoding="utf-8")
    print(f"Wrote {path} ({len(methods)} methods)")


def main() -> None:
    source = SOURCE.read_text(encoding="utf-8")
    buckets = extract_methods(source)

    all_assigned = AUTO_BIND_METHODS | OPEN_CLOSE_METHODS | SEND_TARGET_METHODS
    extracted_names = {
        name for group in ("auto", "open", "send") for name, _ in buckets[group]
    }
    remain_names = {name for name, _ in buckets["remain"]}

    missing = all_assigned - extracted_names
    if missing:
        raise SystemExit(f"Methods not found in source: {sorted(missing)}")

    overlap = extracted_names & remain_names
    if overlap:
        raise SystemExit(f"Methods in multiple buckets: {sorted(overlap)}")

    unknown_in_sets = extracted_names - all_assigned - remain_names
    # methods in auto/open/send not in frozensets
    for name, _ in buckets["auto"]:
        if name not in AUTO_BIND_METHODS:
            raise SystemExit(f"auto bucket has unexpected: {name}")
    for name, _ in buckets["open"]:
        if name not in OPEN_CLOSE_METHODS:
            raise SystemExit(f"open bucket has unexpected: {name}")
    for name, _ in buckets["send"]:
        if name not in SEND_TARGET_METHODS:
            raise SystemExit(f"send bucket has unexpected: {name}")

    write_mixin("page_auto_bind_mixin.py", buckets["auto"])
    write_mixin("page_open_close_mixin.py", buckets["open"])
    write_mixin("page_send_target_mixin.py", buckets["send"])

    remain_body = "".join(body for _name, body in buckets["remain"])
    new_source = REMAINING_HEADER + remain_body + "\n"
    SOURCE.write_text(new_source, encoding="utf-8")
    print(f"Rewrote {SOURCE} ({len(buckets['remain'])} remaining methods)")


if __name__ == "__main__":
    main()
