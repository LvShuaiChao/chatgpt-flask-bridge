"""手动当前页与页面选择器。"""

import re
import time

from app.models import normalize_remote_chatgpt
from app.utils.page_status import page_url_from
from PyQt5.QtCore import Qt


class PageSelectorMixin:
    def _page_full_url(self, page):
        if not isinstance(page, dict):
            return ""
        return page_url_from(page)

    def _extract_chatgpt_conversation_id_from_url(self, url):
        text = str(url or "").strip()
        if not text:
            return ""

        match = re.search(r"/c/([a-zA-Z0-9-]+)", text)
        if match:
            return match.group(1)

        return ""

    def _page_chatgpt_conversation_id(self, page):
        if not isinstance(page, dict):
            return ""

        url = (
            page.get("url")
            or page.get("page_url")
            or page.get("normalized_url")
            or page.get("conversation_url")
            or ""
        )

        url_conversation_id = self._extract_chatgpt_conversation_id_from_url(url)
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

    def _find_focused_tm_page(self, status=None):
        status = status or getattr(self, "_last_bridge_status", None) or {}
        focused_pages = []
        for page in self._extract_tm_pages_from_status(status):
            page_type = str(page.get("page_type") or "").lower()
            url = (
                page.get("url")
                or page.get("page_url")
                or page.get("normalized_url")
                or ""
            )
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
        status = self._last_bridge_status or {}
        info = self._client_info_by_id(client_id, status=status)
        if isinstance(info, dict):
            return info
        for item in self._iter_tm_clients(status, online_only=False):
            if (item.get("client_id") or "").strip() == client_id:
                return item
        return None

    def _on_tm_page_selector_changed(self, index):
        if getattr(self, "_tm_page_selector_refreshing", False):
            return

        combo = getattr(self, "tm_page_combo", None) or getattr(
            self, "tm_page_selector", None
        )
        if combo is None or index < 0:
            return

        client_id = combo.itemData(index, Qt.UserRole)
        if isinstance(client_id, dict):
            client_id = (client_id.get("client_id") or "").strip()
        else:
            client_id = str(client_id or "").strip()

        label = combo.itemText(index) if index < combo.count() else ""
        self._append_log(
            "[PAGE_SELECTOR][USER_SELECT] "
            f"index={index} "
            f"client_id={client_id or '-'} "
            f"label={label or '-'}",
            echo=True,
        )

        item = self._find_tm_client_by_client_id(client_id)
        if not isinstance(item, dict) and hasattr(self, "_tm_page_combo_page_from_index"):
            item = self._tm_page_combo_page_from_index(index)

        if not isinstance(item, dict):
            self._append_log(
                "[TM_SELECTOR][CHANGE_SKIP] "
                f"index={index} "
                f"client_id={client_id or '-'} "
                f"reason=item_not_found",
                echo=True,
            )
            return

        self._set_manual_current_tm_page(
            item,
            source="page_combo_change",
            auto=True,
        )
        self._set_tm_action_hint(self._tm_selector_action_hint_for_page(item))

    def _tm_selector_action_hint_for_page(self, page):
        if not isinstance(page, dict):
            return "请先在可用页面列表中选择一个页面。"
        normalized = self._normalize_tm_page_for_binding(page)
        page_type = (normalized.get("page_type") or "").strip()
        online = self._tm_page_is_online_simple(page)
        if page_type == "conversation" or normalized.get("conversation_id"):
            if online:
                return (
                    "已选中对话页；同步/发送仍发往本会话已绑定窗口。"
                    "若要改用此页，请点击「绑定当前页面」。"
                )
            return "已选中离线对话页；绑定、同步和发送都需要页面在线。"
        if page_type == "home" or self._is_prebound_home_page(page):
            return (
                "已选中首页页，可预绑定；进入具体对话页后才可同步对话内容。"
            )
        if online:
            return "已选中页面，可点击「绑定当前页面」建立绑定。"
        return "已选中离线页；绑定、同步和发送都需要页面在线。"

    def _on_set_manual_current_page_clicked(self):
        self._append_log("[TM_CURRENT_PAGE][BUTTON_CLICK]", echo=True)
        combo = getattr(self, "tm_page_combo", None) or getattr(
            self, "tm_page_selector", None
        )
        if combo is None:
            return

        index = combo.currentIndex()
        if index < 0:
            self._set_tm_action_hint("请先在可用页面列表中选择一个页面。")
            return

        client_id = combo.itemData(index, Qt.UserRole)
        if isinstance(client_id, dict):
            client_id = (client_id.get("client_id") or "").strip()
        else:
            client_id = str(client_id or "").strip()

        item = self._find_tm_client_by_client_id(client_id)
        if not isinstance(item, dict) and hasattr(self, "_tm_page_combo_page_from_index"):
            item = self._tm_page_combo_page_from_index(index)

        if not isinstance(item, dict):
            self._append_log(
                "[TM_CURRENT_PAGE][BUTTON_FAILED] "
                f"index={index} "
                f"client_id={client_id or '-'} "
                f"reason=item_not_found",
                echo=True,
            )
            self._set_tm_action_hint("未找到所选页面，请刷新页面列表后重试。")
            return

        self._set_manual_current_tm_page(
            item,
            source="set_current_button",
            auto=False,
        )
        self._set_tm_action_hint(self._tm_selector_action_hint_for_page(item))

    def _set_manual_current_tm_page(self, item, *, source="", auto=False):
        if not isinstance(item, dict):
            self._append_log(
                f"[TM_CURRENT_PAGE][SET_SKIP] source={source or '-'} reason=invalid_item",
                echo=True,
            )
            self._manual_current_tm_page = None
            self._manual_current_tm_client_id = ""
            self._manual_current_tm_page_instance_id = ""
            self._manual_current_tm_conversation_id = ""
            self._manual_current_tm_url = ""
            self._refresh_manual_current_page_display()
            self._refresh_current_session_binding_display()
            self._update_sync_target_display()
            self._apply_chat_bind_visual_state()
            return False

        normalized = self._normalize_tm_page_for_binding(item)
        client_id = (normalized.get("client_id") or "").strip()
        page_instance_id = (normalized.get("page_instance_id") or "").strip()
        conversation_id = (normalized.get("conversation_id") or "").strip()
        page_url = (normalized.get("url") or "").strip()
        page_type = (normalized.get("page_type") or "").strip()

        if not client_id and not page_url:
            self._append_log(
                f"[TM_CURRENT_PAGE][SET_SKIP] source={source or '-'} reason=missing_identity",
                echo=True,
            )
            return False

        merged = dict(item)
        merged.update(normalized)
        self._manual_current_tm_page = merged
        self._manual_current_tm_client_id = client_id
        self._manual_current_tm_page_instance_id = page_instance_id
        self._manual_current_tm_conversation_id = conversation_id
        self._manual_current_tm_url = page_url

        self._append_log(
            "[TM_CURRENT_PAGE][SET] "
            f"source={source or '-'} "
            f"auto={bool(auto)} "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"page_type={page_type or '-'} "
            f"url={page_url or '-'}",
            echo=True,
        )

        self._refresh_manual_current_page_display()
        self._refresh_current_session_binding_display()
        self._update_sync_target_display()
        self._apply_chat_bind_visual_state()
        return True

    def _refresh_manual_current_page_display(self):
        self._update_manual_current_page_display()

    def _get_manual_current_tm_page(self, status=None):
        stored = getattr(self, "_manual_current_tm_page", None)
        status = status or self._last_bridge_status or {}
        if isinstance(stored, dict) and stored:
            client_id = (stored.get("client_id") or "").strip()
            merged = dict(stored)
            if client_id:
                live = self._client_info_by_id(client_id, status=status)
                if isinstance(live, dict):
                    merged.update(live)
                    merged["realtime"] = True
                else:
                    merged["realtime"] = False
                    merged["source"] = merged.get("source") or "cache"
            else:
                merged["realtime"] = False
                merged["source"] = merged.get("source") or "cache"
            normalized = self._normalize_tm_page_for_binding(merged)
            merged.update(normalized)
            if normalized.get("url"):
                merged["url"] = normalized["url"]
            return merged

        client_id = (self._manual_current_tm_client_id or "").strip()
        if not client_id:
            if not self._manual_current_tm_url and not self._manual_current_tm_conversation_id:
                return None
        else:
            live = self._client_info_by_id(client_id, status=status)
            if isinstance(live, dict):
                merged = dict(live)
                merged["realtime"] = True
                normalized = self._normalize_tm_page_for_binding(merged)
                merged.update(normalized)
                if normalized.get("url"):
                    merged["url"] = normalized["url"]
                return merged
        if not self._manual_current_tm_url and not self._manual_current_tm_conversation_id:
            return None
        fallback = {
            "client_id": client_id,
            "page_instance_id": self._manual_current_tm_page_instance_id,
            "conversation_id": self._manual_current_tm_conversation_id,
            "page_url": self._manual_current_tm_url,
            "url": self._manual_current_tm_url,
            "source": "cache",
            "realtime": False,
        }
        normalized = self._normalize_tm_page_for_binding(fallback)
        fallback.update(normalized)
        if normalized.get("url"):
            fallback["url"] = normalized["url"]
        return fallback

    def _find_tm_client_by_client_id(self, client_id, status=None):
        if isinstance(client_id, dict):
            return dict(client_id)
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        status = status or self._last_bridge_status or {}
        info = self._client_info_by_id(client_id, status=status)
        if isinstance(info, dict):
            return info
        return self._find_tm_page_by_selector_data(client_id)

    def _current_focused_tm_page(self, status=None):
        return self._find_focused_tm_page(status)

    def _current_bound_tm_page(self, status=None):
        session = self._current_session()
        if session is None:
            return None
        status = status or self._last_bridge_status or {}
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
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
        page_url = (
            remote.get("conversation_url")
            or remote.get("url")
            or remote.get("page_url")
            or ""
        ).strip()
        if not page_url and conversation_id:
            page_url = f"https://chatgpt.com/c/{conversation_id}"
        if not any([client_id, conversation_id, page_url, remote.get("page_instance_id")]):
            return None
        return {
            "client_id": client_id,
            "page_instance_id": (remote.get("page_instance_id") or "").strip(),
            "conversation_id": conversation_id,
            "page_url": page_url,
            "url": page_url,
            "page_type": (remote.get("page_type") or "conversation").strip(),
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
        status = status or getattr(self, "_last_bridge_status", None) or {}
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

