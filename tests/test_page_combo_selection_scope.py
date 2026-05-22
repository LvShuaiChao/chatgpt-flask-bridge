"""页面下拉框仅记录选中项，刷新时不按绑定页恢复选中。"""

import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.ui.main_window_state import PageSelectorState
from app.ui.mixins.tm_page_selector_format_mixin import TmPageSelectorFormatMixin


class _ComboHost(TmPageSelectorFormatMixin):
    def __init__(self, pages):
        self._page_selector = PageSelectorState(
            selected_client_id="sel-c",
            selected_page_instance_id="sel-p",
        )
        self.tm_page_combo = _FakeCombo(pages)

    def _page_is_online(self, page):
        return bool(page.get("last_seen"))


class _FakeCombo:
    TM_PAGE_ITEM_DICT_ROLE = TmPageSelectorFormatMixin.TM_PAGE_ITEM_DICT_ROLE

    def __init__(self, pages):
        self._pages = [dict(p) for p in pages]

    def count(self):
        return len(self._pages)

    def itemData(self, index, role):
        if index < 0 or index >= len(self._pages):
            return None
        p = self._pages[index]
        if role == self.TM_PAGE_ITEM_DICT_ROLE:
            return dict(p)
        return (p.get("client_id") or "").strip() or dict(p)


def _page(*, client_id, page_instance_id):
    now = time.time()
    return {
        "client_id": client_id,
        "page_instance_id": page_instance_id,
        "conversation_id": "conv-1",
        "url": "https://chatgpt.com/c/conv-1",
        "page_type": "conversation",
        "last_seen": now,
    }


def test_restore_index_uses_selected_ids_not_bound_page():
    bound = _page(client_id="bound-c", page_instance_id="bound-p")
    selected = _page(client_id="sel-c", page_instance_id="sel-p")
    host = _ComboHost([bound, selected])
    session = SimpleNamespace(
        remote_chatgpt={
            "enabled": True,
            "client_id": "bound-c",
            "page_instance_id": "bound-p",
        }
    )
    idx = host._pick_tm_page_selector_restore_index(
        [bound, selected], session=session
    )
    assert idx == 1


def test_set_page_combo_selection_does_not_touch_manual_page():
    from app.ui.mixins.page_selector_mixin import PageSelectorMixin

    class _Host(PageSelectorMixin):
        def __init__(self):
            self._page_selector = PageSelectorState()
            self._bridge_ui = SimpleNamespace(last_bridge_status={})
            self._logs = []

        def _normalize_tm_page_for_binding(self, item):
            return dict(item)

        def _append_log(self, text, echo=False):
            self._logs.append(text)

        def _refresh_manual_current_page_display(self):
            raise AssertionError("must not refresh manual display")

        def _refresh_current_session_binding_display(self):
            raise AssertionError("must not refresh binding display")

        def _update_sync_target_display(self):
            raise AssertionError("must not update sync target")

        def _apply_chat_bind_visual_state(self):
            raise AssertionError("must not apply bind visual")

    host = _Host()
    page = _page(client_id="c1", page_instance_id="p1")
    host._set_page_combo_selection(page, source="test")
    assert host._page_selector.selected_client_id == "c1"
    assert host._page_selector.selected_page_instance_id == "p1"
    assert host._page_selector.manual_page is None
