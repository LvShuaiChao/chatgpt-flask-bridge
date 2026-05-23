"""One-shot: split ui_builder monolith into focused mixins."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "ui" / "mixins"
SRC = OUT / "_ui_builder_mixin_monolith.py.bak"
if not SRC.exists():
    SRC = OUT / "ui_builder_mixin.py"


def read_lines() -> list[str]:
    return SRC.read_text(encoding="utf-8").splitlines(keepends=True)


def slice_lines(lines: list[str], start: int, end: int) -> str:
    return "".join(lines[start - 1 : end])


def build_file(
    *,
    module_doc: str,
    imports: str,
    class_decl: str,
    body_parts: list[str],
    preamble: str = "",
) -> str:
    parts = [
        f'"""{module_doc}"""\n',
        imports.rstrip() + "\n\n\n",
        preamble,
    ]
    if class_decl:
        parts.append(f"{class_decl}:\n")
    elif preamble and "class " in preamble:
        pass
    else:
        raise ValueError("build_file requires class_decl or preamble with class")
    for part in body_parts:
        parts.append(part)
    return "".join(parts)


# Rich-text combo helpers (from newer ui_builder; not in git HEAD monolith).
RICH_TEXT_FORMAT_METHODS = '''
    TM_PAGE_HTML_ROLE = Qt.UserRole + 120
    TM_PAGE_RAW_ROLE = Qt.UserRole + 121

    def _html_escape_text(self, value):
        return html.escape(str(value or ""), quote=True)

    def _tm_page_option_resolve_conversation_id(self, page):
        if not isinstance(page, dict):
            return ""
        conversation_id = (page.get("conversation_id") or "").strip()
        if not conversation_id and hasattr(self, "_client_conversation_id"):
            conversation_id = (self._client_conversation_id(page) or "").strip()
        if not conversation_id and hasattr(self, "_page_chatgpt_conversation_id"):
            conversation_id = (self._page_chatgpt_conversation_id(page) or "").strip()
        return conversation_id

    def _tm_page_option_resolve_url(self, page):
        if not isinstance(page, dict):
            return ""
        url = (page.get("url") or page.get("page_url") or "").strip()
        if not url and hasattr(self, "_page_full_url"):
            url = (self._page_full_url(page) or "").strip()
        if not url:
            conversation_id = self._tm_page_option_resolve_conversation_id(page)
            if conversation_id:
                url = f"https://chatgpt.com/c/{conversation_id}"
        return url

    def _format_tm_page_option_text(self, page):
        if not isinstance(page, dict):
            return "无效页面"
        is_online = self._page_is_online(page)
        status_text = "在线" if is_online else "离线"
        page_display_id = self._tm_page_display_id_text(page)
        url = self._tm_page_option_resolve_url(page) or "无URL"
        return f"[{status_text}] 页面ID:{page_display_id} | {url}"

    def _format_tm_page_option_html(self, page):
        if not isinstance(page, dict):
            return self._html_escape_text("无效页面")

        is_online = self._page_is_online_for_ui(page)
        status_text = "在线" if is_online else "离线"
        online_color = "#16a34a" if is_online else "#64748b"
        page_display_id = self._tm_page_display_id_text(page)
        url = self._tm_page_option_resolve_url(page) or "无URL"
        return (
            f'<span style="color:{online_color};font-weight:700;">'
            f"[{self._html_escape_text(status_text)}]"
            f"</span> "
            f'<span style="color:#7c3aed;font-weight:700;">'
            f"页面ID:{self._html_escape_text(page_display_id)}"
            f"</span> "
            f'<span style="color:#94a3b8;">|</span> '
            f'<span style="color:#2563eb;">'
            f"{self._html_escape_text(url)}"
            f"</span>"
        )

    def _format_tm_page_option_tooltip(self, page):
        if not isinstance(page, dict):
            return "无效页面"
        page_display_id = self._tm_page_display_id_text(page)
        is_online = self._page_is_online(page)
        online_text = "在线" if is_online else "离线"
        page_type = str(page.get("page_type") or "").strip() or "-"
        client_id = str(page.get("client_id") or "").strip() or "-"
        page_instance_id = str(page.get("page_instance_id") or "").strip() or "-"
        conversation_id = self._tm_page_option_resolve_conversation_id(page) or "-"
        url = self._tm_page_option_resolve_url(page) or "-"
        lines = [
            f"页面ID: {page_display_id}",
            f"状态: {online_text}",
            f"页面类型: {page_type}",
            f"client_id: {client_id}",
            f"page_instance_id: {page_instance_id}",
            f"conversation_id: {conversation_id}",
            f"url: {url}",
        ]
        return "\n".join(lines)

    def _tm_page_combo_apply_item_option_data(self, index, page):
        if not hasattr(self, "tm_page_combo") or index < 0:
            return
        if not isinstance(page, dict):
            return

        combo = self.tm_page_combo
        plain_text = self._format_tm_page_option_text(page)
        html_text = self._format_tm_page_option_html(page)
        page_copy = dict(page)

        combo.setItemText(index, plain_text)
        combo.setItemData(index, html_text, self.TM_PAGE_HTML_ROLE)
        combo.setItemData(index, page_copy, self.TM_PAGE_RAW_ROLE)
        combo.setItemData(index, page_copy, self.TM_PAGE_ITEM_DICT_ROLE)
        if hasattr(self, "_format_tm_page_option_tooltip"):
            tooltip = self._format_tm_page_option_tooltip(page)
        elif hasattr(self, "_format_compact_page_combo_tooltip"):
            tooltip = self._format_compact_page_combo_tooltip(page)
        else:
            tooltip = plain_text
        combo.setItemData(index, tooltip, Qt.ToolTipRole)

        client_id = (page.get("client_id") or "").strip()
        combo.setItemData(
            index,
            client_id if client_id else page_copy,
            Qt.UserRole,
        )

    def _format_tm_page_option_label_verbose(self, page):
        client_id = str(page.get("client_id") or "").strip()
        page_type = str(page.get("page_type") or "").strip()
        url = self._page_full_url(page) if hasattr(self, "_page_full_url") else page_url_from(page)
        if not url:
            conversation_id = ""
            if hasattr(self, "_page_chatgpt_conversation_id"):
                conversation_id = self._page_chatgpt_conversation_id(page) or ""
            if conversation_id:
                url = f"https://chatgpt.com/c/{conversation_id}"
            else:
                url = "未知页面 URL"

        is_online = self._page_is_online(page)
        status_text = "在线" if is_online else "离线"
        page_display_id = str(page.get("page_display_id") or "").strip() or "-"
        page_instance_id = str(page.get("page_instance_id") or "").strip() or "-"
        client_id_label = client_id or "-"
        conversation_id = (page.get("conversation_id") or "").strip()
        if not conversation_id and hasattr(self, "_client_conversation_id"):
            conversation_id = (self._client_conversation_id(page) or "").strip()
        conversation_id = conversation_id or "-"
        type_suffix = ""
        if page_type == "home":
            type_suffix = " [首页]"
        elif page_type and page_type != "conversation":
            type_suffix = f" [{page_type}]"
        return (
            f"[{status_text}]{type_suffix} "
            f"页面ID:{page_display_id} | "
            f"实例ID:{page_instance_id} | "
            f"client:{client_id_label} | "
            f"会话:{conversation_id} | "
            f"URL:{url}"
        ).strip()

    def _tm_page_list_fingerprint(self, pages):
        """稳定指纹：列表未变时不重建 QComboBox（兼容旧名）。"""
        return self._tm_page_selector_signature(pages)

'''


IMPORTS_FORMAT = """import html
import time

from app.models import normalize_remote_chatgpt
from app.utils.page_status import get_page_liveness, is_page_online, page_url_from
from PyQt5.QtCore import Qt"""


IMPORTS_PAGE_SELECTOR = """import time
import traceback

import app.server
from app.models import normalize_remote_chatgpt
from app.utils.page_status import get_page_liveness, is_page_online, page_url_from
from app.ui.mixins.tm_page_selector_format_mixin import TmPageSelectorFormatMixin
from app.ui.widgets.no_wheel_combo_box import NoWheelComboBox
from app.ui.widgets.rich_text_combo_delegate import RichTextComboDelegate
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QColor, QBrush
from PyQt5.QtWidgets import (
    QComboBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QWidget,
)"""


IMPORTS_CHAT = """import traceback

from app.constants import STATUS_CHIP_SESSION_BIND_TOOLTIP
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.elided_label import ElidedLabel
from app.ui.widgets.no_wheel_tab_widget import NoWheelTabWidget
from app.ui.widgets.session_list import SessionListWidget
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import (
    QAbstractItemView,
    QFrame,
    QHBoxLayout,
    QLabel,
    QProgressBar,
    QPushButton,
    QSplitter,
    QSizePolicy,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)"""


IMPORTS_LOG = """from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import (
    QApplication,
    QHBoxLayout,
    QPlainTextEdit,
    QPushButton,
    QTableWidget,
    QTextEdit,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)"""


IMPORTS_SETTINGS = """import os

import app.server
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QCheckBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)"""


IMPORTS_CURSOR = """from PyQt5.QtWidgets import (
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
)"""


IMPORTS_CORE = """import traceback

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtWidgets import (
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)"""


CHAT_CLASS_HEADER = """class UiChatPanelMixin:
    CHAT_SUB_TAB_CHAT = 0
    CHAT_SUB_TAB_CURSOR_FLOW = 1
    CURSOR_FLOW_TAB_TITLE_BASE = "Cursor 动作编排"
    CHAT_SIDEBAR_MIN_WIDTH = 260
    CHAT_SIDEBAR_DEFAULT_WIDTH = 320
    CHAT_SIDEBAR_MAX_WIDTH = 460
    CHAT_MAIN_MIN_WIDTH = 700
    CHAT_SPLITTER_INVALID_LEFT = 220
    CHAT_SPLITTER_INVALID_RIGHT = 600
    CHAT_SPLITTER_DEFAULT_RIGHT = 1280

"""


def main() -> None:
    lines = read_lines()

    format_body = (
        RICH_TEXT_FORMAT_METHODS
        + slice_lines(lines, 560, 940)
        + slice_lines(lines, 942, 953)
        + slice_lines(lines, 1073, 1119)
    )
    page_sel_body = (
        slice_lines(lines, 447, 559)
        + slice_lines(lines, 955, 1072)
        + slice_lines(lines, 1121, 1350)
        + slice_lines(lines, 1472, 1478)
    )
    chat_body = (
        slice_lines(lines, 107, 298)
        + slice_lines(lines, 1512, 1649)
        + slice_lines(lines, 2097, 2272)
        + slice_lines(lines, 2402, len(lines))
    )
    log_body = slice_lines(lines, 1650, 1797)
    settings_body = (
        slice_lines(lines, 1372, 1471)
        + slice_lines(lines, 1798, 2096)
    )
    cursor_body = slice_lines(lines, 2274, 2401)
    core_body = slice_lines(lines, 60, 106) + slice_lines(lines, 299, 446) + slice_lines(
        lines, 1479, 1511
    )

    files = {
        "tm_page_selector_format_mixin.py": build_file(
            module_doc="油猴页面下拉框：选项格式化、索引查找与恢复选择。",
            imports=IMPORTS_FORMAT,
            class_decl="class TmPageSelectorFormatMixin",
            body_parts=[format_body],
        ),
        "ui_page_selector_mixin.py": build_file(
            module_doc="油猴页面下拉框 UI 构建、列表刷新与空状态展示。",
            imports=IMPORTS_PAGE_SELECTOR,
            class_decl="class UiPageSelectorMixin(TmPageSelectorFormatMixin)",
            body_parts=[page_sel_body],
        ),
        "ui_chat_panel_mixin.py": build_file(
            module_doc="聊天页：侧栏、会话区、状态条与分割条持久化。",
            imports=IMPORTS_CHAT,
            class_decl="class UiChatPanelMixin",
            body_parts=[chat_body],
            preamble=CHAT_CLASS_HEADER,
        ),
        "ui_log_page_mixin.py": build_file(
            module_doc="日志页与子页复制。",
            imports=IMPORTS_LOG,
            class_decl="class UiLogPageMixin",
            body_parts=[log_body],
        ),
        "ui_settings_page_mixin.py": build_file(
            module_doc="设置页（服务 / 油猴子页）与桥接地址展示文案。",
            imports=IMPORTS_SETTINGS,
            class_decl="class UiSettingsPageMixin",
            body_parts=[settings_body],
        ),
        "ui_cursor_tab_mixin.py": build_file(
            module_doc="聊天子页「Cursor 动作编排」构建。",
            imports=IMPORTS_CURSOR,
            class_decl="class UiCursorTabMixin",
            body_parts=[cursor_body],
        ),
    }

    for name, content in files.items():
        (OUT / name).write_text(content, encoding="utf-8")
        print("wrote", name, len(content.splitlines()), "lines")

    core_file = build_file(
        module_doc="主界面骨架、通用控件工厂与油猴操作按钮。",
        imports=IMPORTS_CORE,
        class_decl="class UiBuilderCoreMixin",
        body_parts=[core_body],
    )
    (OUT / "ui_builder_core_mixin.py").write_text(core_file, encoding="utf-8")
    print("wrote ui_builder_core_mixin.py", len(core_file.splitlines()), "lines")

    aggregator = '''"""主界面构建入口：聚合各 UI 子 mixin。"""

from app.ui.mixins.ui_builder_core_mixin import UiBuilderCoreMixin
from app.ui.mixins.ui_chat_panel_mixin import UiChatPanelMixin
from app.ui.mixins.ui_cursor_tab_mixin import UiCursorTabMixin
from app.ui.mixins.ui_log_page_mixin import UiLogPageMixin
from app.ui.mixins.ui_page_selector_mixin import UiPageSelectorMixin
from app.ui.mixins.ui_settings_page_mixin import UiSettingsPageMixin
from app.ui.mixins.tm_page_selector_format_mixin import TmPageSelectorFormatMixin


class UiBuilderMixin(
    UiChatPanelMixin,
    UiPageSelectorMixin,
    UiSettingsPageMixin,
    UiLogPageMixin,
    UiCursorTabMixin,
    UiBuilderCoreMixin,
):
    """向后兼容：MainWindow 与测试仍从此处导入 UiBuilderMixin。"""

    TM_PAGE_HTML_ROLE = TmPageSelectorFormatMixin.TM_PAGE_HTML_ROLE
    TM_PAGE_RAW_ROLE = TmPageSelectorFormatMixin.TM_PAGE_RAW_ROLE
    TM_PAGE_ITEM_DICT_ROLE = TmPageSelectorFormatMixin.TM_PAGE_ITEM_DICT_ROLE
'''
    (OUT / "ui_builder_mixin.py").write_text(aggregator, encoding="utf-8")
    print("wrote ui_builder_mixin.py aggregator")


if __name__ == "__main__":
    main()
