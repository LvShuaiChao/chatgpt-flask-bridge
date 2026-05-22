"""One-shot repair: rebuild page selector mixins from monolith backup."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BAK = ROOT / "app" / "ui" / "mixins" / "_ui_builder_mixin_monolith.py.bak"


def extract_method(source: str, name: str) -> str:
    pat = rf"^    def {re.escape(name)}\("
    m = re.search(pat, source, re.M)
    if not m:
        raise RuntimeError(f"missing method {name}")
    rest = source[m.end() :]
    m2 = re.search(r"^    def ", rest, re.M)
    end = m.end() + (m2.start() if m2 else len(rest))
    return source[m.start() : end]


def build_format_mixin(bak: str) -> str:
    methods = [
        "_tm_page_combo_client_id_from_data",
        "_tm_page_combo_page_from_index",
        "_tm_page_combo_find_index_by_client_id",
        "_tm_page_combo_find_index_by_normalized_url",
        "_tm_page_combo_find_index_for_page",
    ]
    body = "\n".join(extract_method(bak, n) for n in methods)
    return '''"""油猴页面下拉框：选项格式化、索引查找与恢复选择。"""
from app.utils.page_status import page_url_from
from PyQt5.QtCore import Qt


class TmPageSelectorFormatMixin:
    TM_PAGE_ITEM_DICT_ROLE = Qt.UserRole + 1

    def _format_tm_page_option_label(self, page, **_ignored):
        """下拉项展示文案：仅页面在线态与 URL，不含绑定/同步判定。"""
        if not isinstance(page, dict):
            return "无效页面"
        is_online = self._page_is_online(page) if hasattr(self, "_page_is_online") else False
        status_text = "在线" if is_online else "离线"
        page_display_id = "-"
        if hasattr(self, "_tm_page_display_id_text"):
            page_display_id = self._tm_page_display_id_text(page)
        url = page_url_from(page) if page else ""
        if not url and hasattr(self, "_page_full_url"):
            url = self._page_full_url(page) or ""
        if not url:
            conv = (page.get("conversation_id") or "").strip()
            if conv:
                url = f"https://chatgpt.com/c/{conv}"
        url = url or "无URL"
        return f"[{status_text}] 页面ID:{page_display_id} | {url}"

    def _tm_page_combo_label(self, item, **_ignored):
        return self._format_tm_page_option_label(item)

''' + body + '''
    def _pick_tm_page_selector_restore_index(self, pages, session=None):
        """仅按用户已选 client_id/page_instance_id 恢复下拉框，不推断绑定页。"""
        del session
        if not pages or not hasattr(self, "tm_page_combo"):
            return -1
        ps = getattr(self, "_page_selector", None)
        if ps is not None:
            client_id = (getattr(ps, "selected_client_id", "") or "").strip()
            page_instance_id = (getattr(ps, "selected_page_instance_id", "") or "").strip()
        else:
            client_id = (getattr(self, "_selected_client_id", "") or "").strip()
            page_instance_id = (getattr(self, "_selected_page_instance_id", "") or "").strip()
        if client_id and page_instance_id:
            for item in pages:
                if not isinstance(item, dict):
                    continue
                if (item.get("client_id") or "").strip() != client_id:
                    continue
                if (item.get("page_instance_id") or "").strip() != page_instance_id:
                    continue
                return self._tm_page_combo_find_index_for_page(item)
        if client_id:
            return self._tm_page_combo_find_index_by_client_id(client_id)
        return -1
'''


def build_ui_page_selector_refresh() -> str:
    return '''
    def _pages_for_page_combo(self, status=None):
        """优先使用 PageRegistry.snapshot.pages，否则从 bridge status 提取。"""
        from app.utils.page_snapshot import PageRegistry

        reg = getattr(self, "page_registry", None)
        if isinstance(reg, PageRegistry) and reg.pages:
            pages = []
            for snap in reg.pages:
                raw = getattr(snap, "_raw", None)
                if isinstance(raw, dict) and raw:
                    pages.append(dict(raw))
                else:
                    pages.append(dict(snap.to_dict()))
            return pages
        full_status = status if isinstance(status, dict) else {}
        if hasattr(self, "_extract_tm_pages_from_status"):
            return list(self._extract_tm_pages_from_status(full_status, log_stages=False) or [])
        return []

    def _tm_page_combo_sort_key(self, item):
        page_type = (item.get("page_type") or "").strip()
        conv_rank = 1 if page_type == "conversation" else 0
        last_seen = float(item.get("last_seen") or 0)
        return (conv_rank, last_seen)

    def _tm_page_selector_signature(self, pages):
        rows = []
        for page in pages or []:
            if not isinstance(page, dict):
                continue
            rows.append(
                (
                    (page.get("client_id") or "").strip(),
                    (page.get("page_instance_id") or "").strip(),
                    (page.get("conversation_id") or "").strip(),
                    str(page.get("last_seen") or ""),
                    (page.get("page_type") or "").strip(),
                )
            )
        rows.sort()
        return tuple(rows)

    def _sync_tm_page_list_empty_ui(self):
        combo = getattr(self, "tm_page_combo", None)
        if combo is None:
            return
        has_pages = combo.count() > 0
        empty_label = getattr(self, "tm_page_empty_label", None)
        if empty_label is not None:
            empty_label.setVisible(not has_pages)
            if not has_pages:
                empty_label.setText("暂无可用页面")
        combo.setVisible(has_pages)
        bind_selected_btn = getattr(
            self,
            "bind_selected_page_btn",
            getattr(self, "set_manual_current_page_btn", None),
        )
        if bind_selected_btn is not None:
            bind_selected_btn.setVisible(has_pages)

    def _update_tm_page_selector_display_state(self, index=-1):
        """列表刷新后仅同步空态，不写入手动页/绑定展示。"""
        del index
        self._sync_tm_page_list_empty_ui()

    def _refresh_tm_page_selector(self, status=None, *, force_rebuild=False):
        if not hasattr(self, "tm_page_combo"):
            return
        full_status = status if isinstance(status, dict) else {}
        client_keys = (
            "clients",
            "tm_clients",
            "tampermonkey_clients",
            "pages",
            "tm_pages",
        )
        if not full_status or not any(key in full_status for key in client_keys):
            full_status = getattr(self, "_bridge_ui", None)
            full_status = (
                getattr(full_status, "last_bridge_status", None)
                if full_status is not None
                else getattr(self, "_last_bridge_status", None)
            ) or {}
        pages = self._pages_for_page_combo(full_status)
        has_page_source_keys = any(key in full_status for key in client_keys)
        if not pages and self.tm_page_combo.count() > 0 and not has_page_source_keys:
            self._sync_tm_page_list_empty_ui()
            return
        pages.sort(key=self._tm_page_combo_sort_key, reverse=True)
        page_selector_key = self._tm_page_selector_signature(pages)
        ps = getattr(self, "_page_selector", None)
        last_key = (
            getattr(ps, "last_page_selector_key", "")
            if ps is not None
            else getattr(self, "_last_page_selector_key", "")
        )
        if not force_rebuild and page_selector_key == last_key:
            self._sync_tm_page_list_empty_ui()
            return
        if ps is not None:
            ps.last_page_selector_key = page_selector_key
            ps.selector_refreshing = True
        else:
            self._last_page_selector_key = page_selector_key
            self._tm_page_selector_refreshing = True
        self.tm_page_combo.setUpdatesEnabled(False)
        self.tm_page_combo.blockSignals(True)
        self.tm_page_combo.clear()
        for item in pages:
            label = self._tm_page_combo_label(item)
            idx = self.tm_page_combo.count()
            client_id = (item.get("client_id") or "").strip()
            self.tm_page_combo.addItem(label)
            self.tm_page_combo.setItemData(
                idx,
                client_id if client_id else dict(item),
                Qt.UserRole,
            )
            self.tm_page_combo.setItemData(idx, dict(item), self.TM_PAGE_ITEM_DICT_ROLE)
            if hasattr(self, "_tm_page_combo_tooltip"):
                self.tm_page_combo.setItemData(
                    idx, self._tm_page_combo_tooltip(item), Qt.ToolTipRole
                )
        restore_index = self._pick_tm_page_selector_restore_index(pages)
        if restore_index >= 0:
            self.tm_page_combo.setCurrentIndex(restore_index)
        else:
            self.tm_page_combo.setCurrentIndex(-1)
        if ps is not None:
            ps.selector_refreshing = False
        else:
            self._tm_page_selector_refreshing = False
        self.tm_page_combo.blockSignals(False)
        self.tm_page_combo.setUpdatesEnabled(True)
        sel_client = ""
        sel_inst = ""
        if ps is not None:
            sel_client = (ps.selected_client_id or "").strip()
            sel_inst = (ps.selected_page_instance_id or "").strip()
        if hasattr(self, "_append_log"):
            self._append_log(
                "[PAGE_SELECTOR][AUTO_REFRESH] "
                f"restore_index={restore_index} "
                f"selected_client_id={sel_client or '-'} "
                f"selected_page_instance_id={sel_inst or '-'} "
                f"page_count={self.tm_page_combo.count()}",
                echo=False,
            )
        self._update_tm_page_selector_display_state(restore_index)

    def _selected_tm_page_client_id(self):
        ps = getattr(self, "_page_selector", None)
        if ps is not None and (ps.selected_client_id or "").strip():
            return (ps.selected_client_id or "").strip()
        if hasattr(self, "tm_page_combo") and self.tm_page_combo.count() > 0:
            return self._tm_page_combo_client_id_from_data(
                self.tm_page_combo.currentData(Qt.UserRole)
            )
        return self._selected_tm_client_id_from_table() if hasattr(
            self, "_selected_tm_client_id_from_table"
        ) else ""

    def _selected_tm_page_key(self):
        ps = getattr(self, "_page_selector", None)
        if ps is not None:
            cid = (ps.selected_client_id or "").strip()
            inst = (ps.selected_page_instance_id or "").strip()
        else:
            cid = (getattr(self, "_selected_client_id", "") or "").strip()
            inst = (getattr(self, "_selected_page_instance_id", "") or "").strip()
        return f"{cid}|{inst}" if cid and inst else ""
'''


def main():
    bak = BAK.read_text(encoding="utf-8")
    fmt_path = ROOT / "app" / "ui" / "mixins" / "tm_page_selector_format_mixin.py"
    fmt_path.write_text(build_format_mixin(bak), encoding="utf-8")
    print("wrote", fmt_path)

    ui_path = ROOT / "app" / "ui" / "mixins" / "ui_page_selector_mixin.py"
    ui_src = ui_path.read_text(encoding="utf-8", errors="replace")
    # Keep everything before corrupted _format_tm_page_option_label if class header exists
    marker = "class UiPageSelectorMixin"
    if marker not in ui_src:
        raise RuntimeError("UiPageSelectorMixin class missing")
    # Use backup for UI-only methods before refresh
    ui_prefix_methods = [
        "_build_tm_page_selector_row",
        "_style_tm_page_selector_row_buttons",
        "_ensure_bind_selected_page_button",
    ]
    # Extract from backup between _ensure_tm_page_combo and _format_tm_page_option_label
    start = bak.find("    def _ensure_tm_page_combo")
    end = bak.find("    def _format_tm_page_option_label")
    mid = bak[start:end] if start >= 0 and end > start else ""
    # Also get _tm_page_combo_tooltip and _tm_page_combo_apply_item_colors if in backup
    extra = ""
    for name in ("_tm_page_combo_tooltip", "_tm_page_combo_apply_item_colors"):
        try:
            extra += "\n" + extract_method(bak, name)
        except RuntimeError as error:
            print(f"[repair_page_selector] skip optional method {name}: {error}")
    header = '''"""油猴页面下拉框 UI 构建、列表刷新与空状态展示。"""
import traceback

import server
from app.ui.mixins.tm_page_selector_format_mixin import TmPageSelectorFormatMixin
from app.ui.widgets.no_wheel_combo_box import NoWheelComboBox
from app.ui.widgets.rich_text_combo_delegate import RichTextComboDelegate
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtWidgets import QComboBox, QHBoxLayout, QLabel, QPushButton, QSizePolicy


class UiPageSelectorMixin(TmPageSelectorFormatMixin):

'''
    # extract _ensure_tm_page_combo from ui_builder_core if broken - use backup
    ensure_combo = extract_method(bak, "_ensure_tm_page_combo")
    build_row = extract_method(bak, "_build_tm_page_selector_row")
    out = header + ensure_combo + "\n" + build_row + extra + build_ui_page_selector_refresh()
    ui_path.write_text(out, encoding="utf-8")
    print("wrote", ui_path, len(out.splitlines()), "lines")


if __name__ == "__main__":
    main()
