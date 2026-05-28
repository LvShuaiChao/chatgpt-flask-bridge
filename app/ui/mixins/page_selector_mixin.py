"""可用页面列表与所选页面状态。"""

import time

from app.models import derive_remote_page_type, normalize_remote_chatgpt, remote_binding_enabled
from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from
from PyQt5.QtCore import Qt


class PageSelectorMixin:
    def _page_full_url(self, page):
        if not isinstance(page, dict):
            return ""
        return page_url_from(page)

    def _page_chatgpt_conversation_id(self, page):
        if not isinstance(page, dict):
            return ""

        url = (page.get("url") or "").strip()

        url_conversation_id = parse_conversation_id(url) or ''
        field_conversation_id = str(page.get("conversation_id") or "").strip()

        if url_conversation_id:
            return url_conversation_id

        return field_conversation_id

    def _page_has_focus(self, page):
        if not isinstance(page, dict):
            return False
        for key in ("has_focus", "focus", "focused"):
            value = page.get(key)
            if isinstance(value, bool):
                if value:
                    return True
            elif isinstance(value, str):
                if value.strip().lower() in ("yes", "true", "1", "focused", "focus"):
                    return True
            elif value:
                return True
        return False

    def _find_focused_tm_page(self, status=None, snapshot=None):
        status = status or (getattr(self._bridge_ui, "last_bridge_status", None) or {})
        if snapshot is None and hasattr(self, "_get_tm_page_snapshot"):
            snapshot = self._get_tm_page_snapshot(status, log_stages=False)
        pages = (
            list(snapshot.page_dicts)
            if snapshot is not None
            else self._extract_tm_pages_from_status(status, log_stages=False)
        )
        focused_pages = []
        for page in pages:
            page_type = str(page.get("page_type") or "").lower()
            url = (page.get("url") or "").strip()
            if "chatgpt.com" not in str(url):
                continue
            if page_type not in ("conversation", "home", ""):
                continue
            if self._page_has_focus(page):
                focused_pages.append(page)
        if not focused_pages:
            return None

        def sort_key(page):
            for field in ("last_focus_at", "last_seen", "last_seen_at", "updated_at"):
                value = page.get(field)
                if value is None or value == "":
                    continue
                try:
                    return float(value)
                except (TypeError, ValueError) as error:
                    if (
                        hasattr(self, "_is_debug_mode_enabled")
                        and self._is_debug_mode_enabled()
                        and hasattr(self, "_append_log")
                    ):
                        self._append_log(
                            "[TM_PAGE][FOCUS_SORT_FIELD_INVALID] "
                            "function=_find_focused_tm_page.sort_key "
                            f"field={field} "
                            f"value={value!r} "
                            f"client_id={page.get('client_id') or '-'} "
                            f"page_instance_id={page.get('page_instance_id') or '-'} "
                            f"error_type={type(error).__name__} "
                            f"error={error}",
                            echo=False,
                        )
                    continue
            return 0.0

        focused_pages.sort(key=sort_key, reverse=True)
        return focused_pages[0]

    def _find_tm_page_by_selector_data(self, data):
        client_id = str(data or "").strip()
        if not client_id:
            return None
        status = self._bridge_ui.last_bridge_status or {}
        info = self._client_info_by_id(client_id, status=status)
        if isinstance(info, dict):
            return info
        for item in self._iter_tm_clients(status, online_only=False):
            if (item.get("client_id") or "").strip() == client_id:
                return item
        return None

    def _page_combo_refreshing(self):
        return bool(getattr(self, "_tm_page_selector_refreshing", False))

    def _on_tm_page_selector_changed(self, index):
        if self._page_combo_refreshing():
            return

        combo = getattr(self, "tm_page_combo", None) or getattr(
            self, "tm_page_selector", None
        )
        if combo is None or index < 0:
            return

        item = None
        if hasattr(self, "_get_selected_tm_page_from_combo"):
            item = self._get_selected_tm_page_from_combo()
        if not isinstance(item, dict) and hasattr(self, "_tm_page_combo_page_from_index"):
            item = self._tm_page_combo_page_from_index(index)
        if not isinstance(item, dict):
            data = combo.itemData(index, Qt.UserRole)
            if isinstance(data, dict):
                item = data
            else:
                client_id = str(data or "").strip()
                item = self._find_tm_client_by_client_id(client_id)
        client_id = (item.get("client_id") or "").strip() if isinstance(item, dict) else ""
        label = combo.itemText(index) if index < combo.count() else ""

        if not isinstance(item, dict):
            self._append_log(
                "[TM_SELECTOR][CHANGE_SKIP] "
                f"index={index} "
                f"client_id={client_id or '-'} "
                f"reason=item_not_found",
                echo=True,
            )
            self._clear_page_combo_selection(source="page_combo_change_missing")
            return

        self._set_page_combo_selection(item, source="page_combo_change")
        self._append_log(
            "[PAGE_SELECTOR][USER_SELECT] "
            f"index={index} "
            f"client_id={(item.get('client_id') or '-').strip() or '-'} "
            f"page_instance_id={(item.get('page_instance_id') or '-').strip() or '-'} "
            f"label={label or '-'}",
            echo=True,
        )

    def _tm_selector_action_hint_for_page(self, page):
        if not isinstance(page, dict):
            return "请先在可用页面列表中选择一个页面。"
        if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():
            if hasattr(self, "_format_compact_send_target_action_hint"):
                hint, _tip = self._format_compact_send_target_action_hint()
                return hint
        normalized = self._normalize_tm_page_for_binding(page)
        page_type = (normalized.get("page_type") or "").strip()
        online = self._tm_page_is_online_simple(page)
        if page_type == "conversation" or normalized.get("conversation_id"):
            if online:
                return (
                    "已选中对话页；同步/发送仍发往本会话已绑定窗口。"
                    "若要改用此页，请点击「绑定所选页面」。"
                )
            return "已选中离线对话页；绑定、同步和发送都需要页面在线。"
        if page_type == "home" or self._is_prebound_home_page(page):
            return (
                "已选中首页页，可预绑定；进入具体对话页后才可同步对话内容。"
            )
        if online:
            return "已选中页面，可点击「绑定所选页面」建立绑定。"
        return "已选中离线页；绑定、同步和发送都需要页面在线。"

    def _get_tm_page_combo_selection(self, status=None):
        """读取可用页面列表当前选中项（未选中时返回 None）。"""
        if hasattr(self, "_get_selected_tm_page_from_combo"):
            page = self._get_selected_tm_page_from_combo(status=status)
            if isinstance(page, dict):
                return page
        combo = getattr(self, "tm_page_combo", None) or getattr(
            self, "tm_page_selector", None
        )
        if combo is None or combo.count() <= 0:
            return None
        index = combo.currentIndex()
        if index < 0:
            return None
        if hasattr(self, "_tm_page_combo_page_from_index"):
            item = self._tm_page_combo_page_from_index(index)
            if isinstance(item, dict):
                return item
        client_id = combo.itemData(index, Qt.UserRole)
        if isinstance(client_id, dict):
            return dict(client_id)
        return self._find_tm_client_by_client_id(client_id, status=status)

    def _set_page_combo_selection(self, item, *, source=""):
        """同步下拉框选中项，并记录用户最后手动选择的页面身份。"""
        if not isinstance(item, dict):
            return self._clear_page_combo_selection(source=source or "invalid_item")
        normalized = self._normalize_tm_page_for_binding(item)
        client_id = (normalized.get("client_id") or item.get("client_id") or "").strip()
        page_instance_id = (
            normalized.get("page_instance_id")
            or item.get("page_instance_id")
            or ""
        ).strip()
        conversation_id = (
            normalized.get("conversation_id")
            or item.get("conversation_id")
            or ""
        ).strip()
        if not conversation_id and hasattr(self, "_client_conversation_id"):
            conversation_id = (self._client_conversation_id(item) or "").strip()
        self._manual_current_tm_client_id = client_id
        self._manual_current_tm_page_instance_id = page_instance_id
        self._manual_current_tm_conversation_id = conversation_id
        self._manual_current_tm_page = dict(item)
        if hasattr(self, "_append_log"):
            self._append_log(
                "[PAGE_SELECTOR][SELECTION_SET] "
                f"source={source or '-'} "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'} "
                f"conversation_id={conversation_id or '-'}",
                echo=False,
            )
        return bool(client_id or page_instance_id or conversation_id)

    def _clear_page_combo_selection(self, *, source=""):
        combo = getattr(self, "tm_page_combo", None) or getattr(
            self, "tm_page_selector", None
        )
        if combo is not None and combo.count() > 0:
            combo.blockSignals(True)
            combo.setCurrentIndex(-1)
            combo.blockSignals(False)
        self._manual_current_tm_client_id = ""
        self._manual_current_tm_page_instance_id = ""
        self._manual_current_tm_conversation_id = ""
        self._manual_current_tm_page = None
        if source and hasattr(self, "_append_log"):
            self._append_log(
                f"[PAGE_SELECTOR][SELECTION_CLEAR] source={source}",
                echo=False,
            )
        return False

    def _refresh_manual_current_page_display(self):
        self._update_manual_current_page_display()

    def _get_manual_current_tm_page(self, status=None):
        """当前手动选择页面 = 可用页面列表 combo 当前项。"""
        del status
        return self._get_tm_page_combo_selection()

    def _find_tm_client_by_client_id(self, client_id, status=None):
        if isinstance(client_id, dict):
            return dict(client_id)
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        status = status or self._bridge_ui.last_bridge_status or {}
        info = self._client_info_by_id(client_id, status=status)
        if isinstance(info, dict):
            return info
        return self._find_tm_page_by_selector_data(client_id)

    def _current_bound_tm_page(self, status=None, session=None):
        session = session or self._current_session()
        if session is None:
            return None
        status = status or self._bridge_ui.last_bridge_status or {}
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return None
        client_id = (remote.get("client_id") or "").strip()
        page_instance_id = (remote.get("page_instance_id") or "").strip()
        if client_id:
            live = self._client_info_by_id(
                client_id,
                status=status,
                page_instance_id=page_instance_id,
            )
            if isinstance(live, dict):
                return live
        conversation_id = self._remote_conversation_id(remote)
        page_url = (remote.get("url") or "").strip()
        if not page_url and conversation_id:
            page_url = f"https://chatgpt.com/c/{conversation_id}"
        if not any([client_id, conversation_id, page_url, remote.get("page_instance_id")]):
            return None
        return {
            "client_id": client_id,
            "page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "conversation_id": conversation_id,
            "url": page_url,
            "page_type": derive_remote_page_type(page_url, conversation_id) or "conversation",
        }

    def _safe_status_float(self, status, field, default=0.0):
        raw = status.get(field) if isinstance(status, dict) else None
        try:
            return float(raw if raw not in (None, "") else default)
        except (TypeError, ValueError) as error:
            if hasattr(self, "_append_log"):
                self._append_log(
                    "[TM_PAGE][STATUS_FLOAT_FALLBACK] "
                    f"field={field} value={raw!r} default={default!r} "
                    f"error_type={type(error).__name__} error={error}",
                    echo=False,
                )
            return float(default)

    def _find_last_focused_tm_page(self, max_age_sec=None, status=None):
        max_age_sec = (
            self.LAST_FOCUSED_TM_PAGE_MAX_AGE_SEC
            if max_age_sec is None
            else max_age_sec
        )
        status = status or (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        page = status.get("last_focused_tm_page")
        at = self._safe_status_float(status, "last_focused_tm_page_at", 0.0)
        if not isinstance(page, dict) or at <= 0:
            return None, 0.0
        age = time.time() - at
        if age > max_age_sec:
            return None, age
        client_id = (page.get("client_id") or "").strip()
        if client_id:
            live = self._client_info_by_id(client_id, status=status)
            if isinstance(live, dict):
                live = dict(live)
                live["realtime"] = True
                return live, age
        cached = dict(page)
        cached["source"] = cached.get("source") or "cache"
        cached["realtime"] = False
        return cached, age










    def _pages_same_identity(self, page_a, page_b):
        if not isinstance(page_a, dict) or not isinstance(page_b, dict):
            return False, "missing", "页面信息不完整"

        a_client = (page_a.get("client_id") or "").strip()
        b_client = (page_b.get("client_id") or "").strip()
        a_inst = (page_a.get("page_instance_id") or "").strip()
        b_inst = (page_b.get("page_instance_id") or "").strip()
        a_conv = (
            (page_a.get("conversation_id") or "").strip()
            or self._client_conversation_id(page_a)
            or ""
        )
        b_conv = (
            (page_b.get("conversation_id") or "").strip()
            or self._client_conversation_id(page_b)
            or ""
        )

        if a_client and b_client and a_client == b_client:
            if a_inst and b_inst:
                if a_inst == b_inst:
                    return True, "client_instance", ""
                return (
                    False,
                    "client_instance",
                    "手动页与绑定页不一致（client_id 相同但 page_instance_id 不同）",
                )
            if a_conv and b_conv and a_conv == b_conv:
                return True, "client_conversation", "仅按会话ID弱匹配"
            return False, "client_conversation", "手动页与绑定页不一致"

        if a_conv and b_conv and a_conv == b_conv:
            if not a_client and not b_client:
                return True, "conversation_only", "仅按会话ID弱匹配"
            return False, "conversation_only", "手动页与绑定页不一致（仅会话ID相同）"

        return False, "none", "手动页与绑定页不一致"

