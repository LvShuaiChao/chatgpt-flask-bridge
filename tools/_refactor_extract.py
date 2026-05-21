"""一次性提取：styles.py、page_bind 子 mixin。运行: python tools/_refactor_extract.py"""
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI_MIXINS = ROOT / "app" / "ui" / "mixins"
UI_BUILDER = UI_MIXINS / "ui_builder_mixin.py"
PAGE_BIND = UI_MIXINS / "page_bind_mixin.py"

STATE_METHODS = {
    "_clear_session_binding",
    "_purge_session_binding_caches",
    "_clear_pending_web_sync_for_session",
    "_gc_orphan_bindings",
    "_fix_session_remote_url_from_conversation",
    "_refresh_current_session_binding_display",
    "_update_session_binding_from_normalized_page",
    "set_bound_page",
    "_bind_page_to_session",
}

SYNC_METHODS = {
    "_normalize_conversation_snapshot_payload",
    "_handle_conversation_snapshot_inbound",
    "_validate_sync_conversation_binding",
    "_enqueue_sync_conversation_command",
    "_sync_bound_web_conversation",
    "_make_web_snapshot_signature",
    "resolve_sync_decision",
    "_resolve_sync_target_simple",
    "_begin_wait_conversation_page_for_sync",
    "_poll_wait_conversation_sync_requests",
    "_build_bound_sync_target_payload",
    "_clear_session_sync_running",
    "_is_session_sync_running",
    "_sync_target_snapshot",
    "_format_sync_target_status_text",
    "_update_sync_target_display",
    "_relink_session_binding_from_tm_page",
}

DISPLAY_METHODS = {
    "_update_manual_current_page_display",
    "_format_manual_current_page_detail_status",
    "_format_no_manual_current_page_detail_status",
    "_page_plugin_status_text",
    "_page_type_text",
    "_page_focus_text",
    "_page_visible_text",
    "_page_input_text",
    "_page_responding_text",
    "_page_syncable_text",
    "_page_identity_text",
    "_page_ids_for_log",
    "_format_page_detail_status",
    "_format_page_status_line",
    "_format_page_status_with_source",
    "_format_focused_page_detail_status",
    "_format_no_focus_page_detail_status",
    "_set_page_url_edit",
    "_refresh_status_relation_label",
    "_set_page_status_label",
    "_short_page_label",
    "_format_tm_online_chip_text",
    "_update_live_page_display",
    "_session_bind_list_state",
    "_raw_bound_state_from_match",
    "_stable_session_bind_list_state",
    "_bound_cache_seen_age",
    "_log_session_bind_state_change",
    "_session_bind_mismatch_tooltip_reason",
    "_current_bind_visual_state",
    "_log_chat_area_style",
    "_apply_chat_bind_visual_state",
    "_current_session_bound_url",
    "_update_current_session_url_display",
    "_copy_current_session_url",
    "_open_current_session_url",
    "_update_bound_page_display",
    "_set_chat_open_bound_enabled",
    "_set_chat_flash_bound_enabled",
}


def extract_stylesheet():
    text = UI_BUILDER.read_text(encoding="utf-8")
    m = re.search(
        r"def _apply_app_style\(self\):\s*\n\s*self\.setStyleSheet\(\s*\n\s*\"\"\"\s*\n(.*?)\"\"\"\s*\n\s*\)",
        text,
        re.DOTALL,
    )
    if not m:
        raise RuntimeError("_apply_app_style stylesheet not found")
    css = m.group(1)
    styles_path = ROOT / "app" / "ui" / "styles.py"
    styles_path.write_text(
        '"""主窗口 QSS 样式（从 ui_builder_mixin 抽出，避免业务逻辑文件过长）。"""\n\n'
        "APP_STYLESHEET = \"\"\"\n"
        + css
        + "\"\"\"\n",
        encoding="utf-8",
    )
    new_apply = (
        "    def _apply_app_style(self):\n"
        "        from app.ui.styles import APP_STYLESHEET\n\n"
        "        self.setStyleSheet(APP_STYLESHEET)\n"
    )
    text = re.sub(
        r"    def _apply_app_style\(self\):.*?(?=\n    def _build_chat_page)",
        new_apply,
        text,
        count=1,
        flags=re.DOTALL,
    )
    UI_BUILDER.write_text(text, encoding="utf-8")
    print(f"wrote {styles_path} ({len(css)} chars css)")


def parse_methods(path: Path) -> dict[str, tuple[int, int]]:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    lines = source.splitlines()
    methods: dict[str, tuple[int, int]] = {}

    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        for item in node.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                start = item.lineno - 1
                end = item.end_lineno
                methods[item.name] = (start, end)
    return methods


def build_mixin_file(
    class_name: str,
    method_names: set[str],
    methods: dict[str, tuple[int, int]],
    source_lines: list[str],
    doc: str,
    extra_imports: str,
) -> str:
    chunks = []
    for name in sorted(method_names, key=lambda n: methods[n][0]):
        if name not in methods:
            print(f"WARN missing method {name}")
            continue
        start, end = methods[name]
        chunks.append("\n".join(source_lines[start:end]))
    body = "\n\n".join(chunks)
    return (
        f'"""{doc}"""\n\n'
        f"{extra_imports}\n\n\n"
        f"class {class_name}:\n"
        f"{body}\n"
    )


def split_page_bind():
    methods = parse_methods(PAGE_BIND)
    source_lines = PAGE_BIND.read_text(encoding="utf-8").splitlines()

    bind_imports = PAGE_BIND.read_text(encoding="utf-8").split('class PageBindMixin')[0]
    # trim to only needed top-level imports from original header (lines 1-48)
    header_end = source_lines.index("class PageBindMixin(")
    header = "\n".join(source_lines[:header_end])

    state_extra = ""
    sync_extra = ""
    display_extra = ""

    state_path = UI_MIXINS / "page_binding_state_mixin.py"
    sync_path = UI_MIXINS / "page_sync_mixin.py"
    display_path = UI_MIXINS / "page_binding_display_mixin.py"

    state_path.write_text(
        build_mixin_file(
            "PageBindingStateMixin",
            STATE_METHODS,
            methods,
            source_lines,
            "绑定字段清理、归一化与统一写入入口。",
            header.replace('"""页面绑定主 mixin', '"""绑定状态'),
        ),
        encoding="utf-8",
    )
    sync_path.write_text(
        build_mixin_file(
            "PageSyncMixin",
            SYNC_METHODS,
            methods,
            source_lines,
            "同步网页对话、快照回收与 sync 决策。",
            header.replace('"""页面绑定主 mixin', '"""页面同步'),
        ),
        encoding="utf-8",
    )
    display_path.write_text(
        build_mixin_file(
            "PageBindingDisplayMixin",
            DISPLAY_METHODS,
            methods,
            source_lines,
            "绑定/页面关系 UI 显示。",
            header.replace('"""页面绑定主 mixin', '"""绑定显示'),
        ),
        encoding="utf-8",
    )

    # Remove extracted methods from page_bind (keep class shell + remaining methods)
    remove_names = STATE_METHODS | SYNC_METHODS | DISPLAY_METHODS
    new_lines = []
    skip_until = -1
    for idx, line in enumerate(source_lines):
        if skip_until > idx:
            continue
        if line.strip().startswith("def ") and "(" in line:
            m = re.match(r"\s+def (\w+)\(", line)
            if m and m.group(1) in remove_names:
                start, end = methods[m.group(1)]
                skip_until = end
                continue
        new_lines.append(line)

    # Update class inheritance
    new_header = "\n".join(new_lines[:header_end])
    new_header += (
        "\nfrom app.ui.mixins.page_binding_display_mixin import PageBindingDisplayMixin\n"
        "from app.ui.mixins.page_binding_state_mixin import PageBindingStateMixin\n"
        "from app.ui.mixins.page_sync_mixin import PageSyncMixin\n"
    )
    rest = "\n".join(new_lines[header_end:])
    rest = rest.replace(
        "class PageBindMixin(\n    PageOpenCloseMixin,",
        "class PageBindMixin(\n    PageBindingDisplayMixin,\n    PageSyncMixin,\n    PageBindingStateMixin,\n    PageOpenCloseMixin,",
        1,
    )
    PAGE_BIND.write_text(new_header + rest, encoding="utf-8")
    print(
        f"split page_bind: removed {len(remove_names)} methods, "
        f"remaining lines ~{len(new_lines)}"
    )


if __name__ == "__main__":
    import sys

    if "--styles-only" in sys.argv:
        extract_stylesheet()
    elif "--split-only" in sys.argv:
        split_page_bind()
    else:
        try:
            extract_stylesheet()
        except RuntimeError as exc:
            print(f"skip styles: {exc}")
        split_page_bind()
    print("done")
