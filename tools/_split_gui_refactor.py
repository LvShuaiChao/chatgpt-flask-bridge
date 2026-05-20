"""One-shot script: split gui.py into app/ package. Run from project root."""
from __future__ import annotations

import ast
import re
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUI_PATH = ROOT / "gui.py"

SETTINGS_METHODS = {
    "_qsettings_bool",
    "_load_ui_and_bind_settings_from_qsettings",
    "_force_ui_settings_to_defaults",
    "_load_app_settings_values",
    "_read_settings_from_widgets",
    "_save_app_settings",
    "_apply_settings",
    "_reset_settings_to_default",
    "_sync_settings_widgets_from_values",
    "_set_settings_hint",
    "_set_tm_action_hint",
    "_on_save_settings_clicked",
    "_show_log_tab",
    "_clear_log_widget",
    "_clear_runtime_log",
    "_update_service_settings_status",
    "_on_check_tampermonkey",
    "_restart_server_with_settings",
}

UI_BUILDER_METHODS = {
    "_build_ui",
    "_apply_app_style",
    "_build_chat_page",
    "_build_log_page",
    "_build_settings_page",
    "_build_chat_status_bar",
    "_build_chat_panel",
    "_create_tm_ghost_button",
    "_ensure_tm_action_buttons",
    "_build_tm_action_buttons",
    "_build_tm_debug_action_buttons",
    "_tm_page_combo_label",
    "_refresh_tm_page_selector",
    "_selected_tm_page_client_id",
    "_selected_tm_client_id_from_table",
    "_update_input_placeholder",
    "_update_input_hint_label",
    "_update_tampermonkey_settings_labels",
    "_on_tm_table_selection_changed",
}

SESSION_METHODS = {
    "_create_session",
    "_current_session",
    "_ensure_current_session",
    "_select_session",
    "_session_display_title",
    "_session_list_subtitle",
    "_session_list_item_text",
    "_update_current_session_title",
    "_list_index_for_session",
    "_sync_session_order_from_list",
    "_ensure_session_order",
    "_apply_session_search_filter",
    "_refresh_session_list",
    "_on_session_search_changed",
    "_on_session_list_changed",
    "_on_session_list_reordered",
    "_on_session_list_double_clicked",
    "_on_session_list_context_menu",
    "_delete_current_session",
    "_delete_session_by_id",
    "_rename_current_session",
    "_clear_current_session",
    "_append_session_message",
    "_find_assistant_by_turn",
    "_resolve_inbound_binding",
    "_has_assistant_for_turn",
    "_migrate_loaded_session_messages",
    "_mark_session_pending",
    "_message_to_dict",
    "_message_from_dict",
    "_session_to_dict",
    "_session_from_dict",
    "_save_sessions_to_disk",
    "_load_sessions_from_disk",
    "_restore_ui_settings",
    "_save_ui_settings",
}

CHAT_RENDER_METHODS = {
    "_format_ts",
    "_format_message_ts",
    "_clear_chat_widgets",
    "_session_has_chat_messages",
    "_update_chat_empty_state",
    "_render_session_chat",
    "_add_bubble_from_message",
    "_add_system_message",
    "_scroll_to_bottom",
    "_do_scroll_to_bottom",
    "_last_assistant_text",
    "_update_session_assistant",
    "_apply_session_change",
    "_set_reply_text",
    "_set_reply_error",
    "_set_reply_waiting",
}

PAGE_BIND_METHODS = {
    "_short_page_display",
    "_make_inbound_key",
    "_is_finalized",
    "_finalize_bridge",
    "_is_persistable_page_url",
    "_load_saved_page_url",
    "_persist_page_url",
    "_set_page_link_label",
    "_update_live_page_display",
    "_is_client_online",
    "_client_conversation_id",
    "_is_sendable_chatgpt_client",
    "_find_online_client_for_remote",
    "_session_has_sendable_bound_page",
    "_current_bind_visual_state",
    "_apply_chat_bind_visual_state",
    "_has_online_bindable_chatgpt_page",
    "_try_auto_bind_online_page",
    "_rebind_current_session_to_online_client_if_needed",
    "_open_or_queue_url",
    "_auto_open_url_once",
    "_open_page_once",
    "_preferred_open_url_for_session",
    "_resolve_target_page_for_session",
    "_best_live_conversation_client",
    "_binding_status_details",
    "_verify_send_target_binding",
    "_update_bound_page_display",
    "_set_chat_open_bound_enabled",
    "_is_bindable_chatgpt_url",
    "_is_client_bound_to_other_session",
    "_candidate_matches_remote",
    "_client_matches_session_rebind",
    "_pick_auto_bind_client",
    "_auto_bind_current_session_if_needed",
    "_mark_auto_bind_waiting",
    "_clear_pending_auto_bind",
    "_start_auto_bind_for_new_session",
    "_try_finish_pending_auto_bind",
    "_sync_bound_session_urls_from_clients",
    "_bind_page_to_session",
    "_client_info_from_status",
    "_on_bind_current_page",
    "_on_bind_selected_tm_page",
    "_on_unbind_current_page",
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
    "_session_bound_client_id",
    "_render_tampermonkey_clients",
    "_on_refresh_tm_pages",
    "_on_reload_bound_tm_page",
    "_enqueue_close_page",
    "_on_close_selected_tm_page",
    "_on_close_other_tm_pages",
    "_on_close_bound_tm_page",
}

BRIDGE_METHODS = {
    "_render_status_summary",
    "_refresh_status_chip",
    "_apply_bridge_status",
    "_handle_inbound_events",
    "_render_inbound_log",
    "_render_outbound",
    "_refresh_status_tick",
    "_append_log",
    "_update_running_ui",
    "_parse_port",
    "_start_server",
    "_stop_server",
    "_push_message",
    "_copy_last_reply",
    "closeEvent",
}

MIXIN_MAP = {
    "settings_mixin": SETTINGS_METHODS,
    "ui_builder_mixin": UI_BUILDER_METHODS,
    "session_mixin": SESSION_METHODS,
    "chat_render_mixin": CHAT_RENDER_METHODS,
    "page_bind_mixin": PAGE_BIND_METHODS,
    "bridge_mixin": BRIDGE_METHODS,
}

RENAME_IN_SOURCE = [
    ("_default_remote_chatgpt", "default_remote_chatgpt"),
    ("_normalize_remote_chatgpt", "normalize_remote_chatgpt"),
    ("_parse_conversation_id", "parse_conversation_id"),
]


def get_mainwindow_methods(source: str) -> list[tuple[str, int, int, str]]:
    lines = source.splitlines(keepends=True)
    tree = ast.parse(source)
    mw = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "MainWindow")
    funcs = [n for n in mw.body if isinstance(n, ast.FunctionDef)]
    result = []
    for fn in funcs:
        start = fn.lineno - 1
        if fn.decorator_list:
            start = min(d.lineno for d in fn.decorator_list) - 1
        end = fn.end_lineno
        body = patch_source("".join(lines[start:end]))
        result.append((fn.name, start, end, body))
    return result


def classify_method(name: str) -> str:
    for mixin, names in MIXIN_MAP.items():
        if name in names:
            return mixin
    raise KeyError(f"Unclassified MainWindow method: {name}")


def patch_source(text: str) -> str:
    for old, new in RENAME_IN_SOURCE:
        text = re.sub(rf"\b{re.escape(old)}\b", new, text)
    return text


def extract_lines(source: str, start: int, end: int) -> str:
    return patch_source("".join(source.splitlines(keepends=True)[start:end]))


def write_constants_models_widgets(source: str) -> None:
    lines = source.splitlines(keepends=True)

    constants = """from pathlib import Path

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
    "auto_open_and_bind_on_new_chat": True,
}
"""
    (ROOT / "app" / "constants.py").write_text(constants, encoding="utf-8")

    url_utils = """import re

_CONVERSATION_ID_RE = re.compile(
    r"/c/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)


def parse_conversation_id(url):
    match = _CONVERSATION_ID_RE.search(url or "")
    return match.group(1) if match else ""
"""
    (ROOT / "app" / "url_utils.py").write_text(url_utils, encoding="utf-8")

    models = extract_lines(source, 97, 121)
    models = models.replace("_default_remote_chatgpt", "default_remote_chatgpt")
    models = models.replace("_normalize_remote_chatgpt", "normalize_remote_chatgpt")
    models += extract_lines(source, 127, 158)
    models_header = "import time\nfrom dataclasses import dataclass, field\n\n\n"
    (ROOT / "app" / "models.py").write_text(models_header + models.strip() + "\n", encoding="utf-8")

    # widgets: lines 160-301 (BridgeNotifier through ChatBubble)
    widget_block = extract_lines(source, 159, 301)
    widget_block = widget_block.replace(
        "class BridgeNotifier",
        "from PyQt5.QtCore import QObject, Qt, pyqtSignal\n"
        "from PyQt5.QtWidgets import QFrame, QLabel, QListWidget, QSizePolicy, QTextEdit, QHBoxLayout, QVBoxLayout\n\n"
        "import html\n\n\n"
        "class BridgeNotifier",
        1,
    )
    # Split widgets into separate files
    parts = {}
    current = None
    buf = []
    for line in widget_block.splitlines(keepends=True):
        if line.startswith("class "):
            if current and buf:
                parts[current] = "".join(buf)
            current = line.split("(")[0].replace("class ", "").strip()
            buf = [line]
        else:
            buf.append(line)
    if current and buf:
        parts[current] = "".join(buf)

    (ROOT / "app" / "ui" / "widgets" / "bridge_notifier.py").write_text(
        "from PyQt5.QtCore import QObject, pyqtSignal\n\n\n" + parts["BridgeNotifier"],
        encoding="utf-8",
    )
    (ROOT / "app" / "ui" / "widgets" / "chat_input.py").write_text(
        "from PyQt5.QtCore import Qt, pyqtSignal\nfrom PyQt5.QtWidgets import QTextEdit\n\n\n"
        + parts["ChatInput"],
        encoding="utf-8",
    )
    (ROOT / "app" / "ui" / "widgets" / "session_list.py").write_text(
        "from PyQt5.QtCore import Qt, pyqtSignal\nfrom PyQt5.QtWidgets import QListWidget\n\n\n"
        + parts["SessionListWidget"],
        encoding="utf-8",
    )
    bubble_src = parts["SystemBubble"] + "\n\n" + parts["ChatBubble"]
    (ROOT / "app" / "ui" / "widgets" / "chat_bubble.py").write_text(
        "import html\n\n"
        "from PyQt5.QtCore import Qt\n"
        "from PyQt5.QtWidgets import QFrame, QHBoxLayout, QLabel, QSizePolicy, QVBoxLayout\n\n\n"
        + bubble_src,
        encoding="utf-8",
    )


GUI_IMPORTS = """import html
import json
import re
import sys
import time
import traceback
import uuid
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

import server
from log_utils import append_log, clear_log_file, get_log_file_path

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
    CHATGPT_HOME_URL,
    DEFAULT_APP_SETTINGS,
    RUNTIME_DIR,
    SESSIONS_FILE,
    SESSIONS_JSON_VERSION,
    SETTINGS_APP,
    SETTINGS_ORG,
)
from app.models import ChatMessage, ChatSession, default_remote_chatgpt, normalize_remote_chatgpt
from app.url_utils import parse_conversation_id
from app.ui.widgets.bridge_notifier import BridgeNotifier
from app.ui.widgets.chat_bubble import ChatBubble, SystemBubble
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.session_list import SessionListWidget
from PyQt5.QtCore import QObject, QSettings, QUrl, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QDesktopServices, QFont
from PyQt5.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)
"""

MIXIN_CLASS_NAMES = {
    "settings_mixin": "SettingsMixin",
    "ui_builder_mixin": "UiBuilderMixin",
    "session_mixin": "SessionMixin",
    "chat_render_mixin": "ChatRenderMixin",
    "page_bind_mixin": "PageBindMixin",
    "bridge_mixin": "BridgeMixin",
}


def build_mixins(source: str, methods: list[tuple[str, int, int, str]]) -> None:
    buckets: dict[str, list[str]] = {k: [] for k in MIXIN_MAP}
    init_body = None
    for name, _s, _e, body in methods:
        if name == "__init__":
            init_body = body
            continue
        mixin = classify_method(name)
        buckets[mixin].append(body)

    for mixin_file, bodies in buckets.items():
        class_name = MIXIN_CLASS_NAMES[mixin_file]
        content = GUI_IMPORTS + f"\n\nclass {class_name}:\n" + "".join(bodies)
        path = ROOT / "app" / "ui" / "mixins" / f"{mixin_file}.py"
        path.write_text(content, encoding="utf-8")
        print(f"Wrote {path} ({len(bodies)} methods)")

    main_window = GUI_IMPORTS + """
from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.mixins.chat_render_mixin import ChatRenderMixin
from app.ui.mixins.page_bind_mixin import PageBindMixin
from app.ui.mixins.session_mixin import SessionMixin
from app.ui.mixins.settings_mixin import SettingsMixin
from app.ui.mixins.ui_builder_mixin import UiBuilderMixin


class MainWindow(
    QMainWindow,
    SettingsMixin,
    UiBuilderMixin,
    SessionMixin,
    ChatRenderMixin,
    PageBindMixin,
    BridgeMixin,
):
"""
    main_window += init_body or ""
    (ROOT / "app" / "ui" / "main_window.py").write_text(main_window, encoding="utf-8")
    print("Wrote app/ui/main_window.py")


def write_entry_gui() -> None:
    entry = '''import sys

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QApplication

from app.ui.main_window import MainWindow
from log_utils import clear_log_file


def main():
    clear_log_file()
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    app = QApplication(sys.argv)
    app.setFont(QFont("Microsoft YaHei UI", 10))
    window = MainWindow()
    window.show()
    if not window._current_session() or not window._current_session().messages:
        window._add_system_message(
            "请先启动服务，然后刷新 ChatGPT 页面并确认油猴脚本在线。"
        )
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
'''
    (ROOT / "gui.py").write_text(entry, encoding="utf-8")
    (ROOT / "GUI.py").write_text(entry, encoding="utf-8")
    print("Wrote gui.py / GUI.py entry")


def create_init_files() -> None:
    for p in [
        "app",
        "app/ui",
        "app/ui/widgets",
        "app/ui/mixins",
        "app/storage",
        "app/bridge",
        "app/utils",
    ]:
        init = ROOT / p / "__init__.py"
        init.parent.mkdir(parents=True, exist_ok=True)
        if not init.exists():
            init.write_text("", encoding="utf-8")


def main() -> None:
    source = GUI_PATH.read_text(encoding="utf-8")
    create_init_files()
    write_constants_models_widgets(source)
    methods = get_mainwindow_methods(source)
    build_mixins(source, methods)
    write_entry_gui()
    print("Done.")


if __name__ == "__main__":
    main()
