"""油猴页面下拉框 UI 构建、列表刷新与空状态展示。"""
from app.server import (
    cancel_message,
    complete_gui_dispatch,
    enqueue_control_command,
    get_bridge_status,
    get_message_state,
    get_server_port,
    get_server_public_host,
    get_server_url,
    get_tm_online_summary,
    is_server_running,
    push_close_other_pages,
    push_close_page,
    push_message,
    push_open_url,
    set_debug_mode,
    set_external_gui_dispatch,
    set_log_callback,
    set_status_callback,
    start_server,
    stop_server,
)

import time
import traceback

from app.models import normalize_remote_chatgpt
from app.utils.page_status import get_page_liveness, is_page_online, page_url_from
from app.ui.mixins.tm_page_selector_format_mixin import TmPageSelectorFormatMixin
from app.ui.widgets.no_wheel_combo_box import NoWheelComboBox
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QColor, QBrush
from PyQt5.QtWidgets import (
    QComboBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QWidget,
)


class UiPageSelectorMixin(TmPageSelectorFormatMixin):
    def _bridge_status_has_page_sources(self, status):
        if not isinstance(status, dict):
            return False
        if "pages" in status:
            return True
        nested = status.get("summary")
        return isinstance(nested, dict) and "pages" in nested

    def _full_bridge_status_for_page_selector(self, status=None):
        status = status if isinstance(status, dict) else {}
        if self._bridge_status_has_page_sources(status):
            return status
        if is_server_running():
            live = get_bridge_status()
            if isinstance(live, dict):
                self._bridge_ui.last_bridge_status = live
                return live
        return getattr(self._bridge_ui, "last_bridge_status", None) or status

    def _ensure_tm_page_combo(self):
        if hasattr(self, "tm_page_combo"):
            return
        self.tm_page_combo = NoWheelComboBox()
        self.tm_page_combo.setObjectName("TmPageCombo")
        self.tm_page_combo.setMinimumWidth(0)
        self.tm_page_combo.setSizeAdjustPolicy(QComboBox.AdjustToContentsOnFirstShow)
        self.tm_page_combo.setMinimumContentsLength(40)
        self.tm_page_combo.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.tm_page_combo.setToolTip(
            "可用页面列表：选择 ChatGPT 页面作为手动选中页（用于绑定等操作）"
        )
        self.tm_page_selector = self.tm_page_combo
        if not getattr(self, "_tm_page_selector_connected", False):
            self.tm_page_combo.currentIndexChanged.connect(
                self._on_tm_page_selector_changed
            )
            self._tm_page_selector_connected = True

    def _ensure_refresh_page_list_button(self):
        if getattr(self, "_refresh_page_list_btn_ready", False):
            return
        self._refresh_page_list_btn_ready = True
        self.refresh_page_list_btn = QPushButton("刷新页面列表")
        self.refresh_page_list_btn.setObjectName("PrimaryButton")
        self.refresh_page_list_btn.setToolTip("重新扫描当前在线的 ChatGPT 页面")
        self.refresh_page_list_btn.setEnabled(True)

    def _bind_tm_page_selector_row_signals(self):
        if getattr(self, "_tm_page_selector_row_signals_bound", False):
            return
        self._ensure_refresh_page_list_button()
        self._ensure_tm_action_buttons()
        reconnect = getattr(self, "_reconnect_button", None)
        if callable(reconnect):
            reconnect(
                self.refresh_page_list_btn,
                lambda: self.refresh_page_registry(reason="manual_button", force=True),
                tag="refresh_page_list_btn",
            )
        else:
            self.refresh_page_list_btn.clicked.connect(
                lambda: self.refresh_page_registry(reason="manual_button", force=True)
            )
        self._tm_page_selector_row_signals_bound = True

    def _style_tm_page_selector_row_buttons(self):
        self._ensure_tm_action_buttons()
        self._ensure_refresh_page_list_button()
        for page_row_btn in (
            self.refresh_page_list_btn,
            self.bind_current_page_btn,
        ):
            page_row_btn.setObjectName("PrimaryButton")
            page_row_btn.setFixedHeight(28)
            page_row_btn.setMinimumWidth(88)
            page_row_btn.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)

    def _build_tm_page_selector_row(self, parent_layout):
        """页面 [下拉/空态] stretch [刷新页面列表] [绑定所选页面]"""
        self._ensure_tm_action_buttons()
        self._ensure_refresh_page_list_button()
        self._ensure_tm_page_combo()
        self.tm_page_combo.setFixedHeight(28)
        self._style_tm_page_selector_row_buttons()
        self._bind_tm_page_selector_row_signals()

        if not hasattr(self, "tm_page_empty_label"):
            self.tm_page_empty_label = QLabel("暂无可用页面")
            self.tm_page_empty_label.setObjectName("StatusRelationLine")
            self.tm_page_empty_label.setFixedHeight(20)
            self.tm_page_empty_label.setSizePolicy(
                QSizePolicy.Expanding, QSizePolicy.Fixed
            )
            self.tm_page_empty_label.setVisible(False)

        page_label = QLabel("页面")
        page_label.setObjectName("StatusChip")

        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(8)
        row.addWidget(page_label)
        self.tm_page_combo.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        row.addWidget(self.tm_page_empty_label, 1)
        row.addWidget(self.tm_page_combo, 1)
        row.addStretch(1)
        row.addWidget(self.refresh_page_list_btn, 0, Qt.AlignVCenter)
        row.addWidget(self.bind_current_page_btn, 0, Qt.AlignVCenter)
        parent_layout.addLayout(row)
        self._sync_tm_page_list_empty_ui()

    def _build_tm_action_buttons(
        self, layout, *, include_page_selector=False, include_view_logs=False
    ):
        self._ensure_tm_action_buttons()
        layout.setSpacing(6)
        for btn in (
            self.open_chatgpt_btn,
            self.sync_web_conversation_btn,
        ):
            layout.addWidget(btn)
        if include_page_selector:
            self._build_tm_page_selector_row(layout)
        layout.addWidget(self.close_other_pages_btn)
        if include_view_logs:
            layout.addStretch()
            if not hasattr(self, "view_logs_btn"):
                self.view_logs_btn = QPushButton("日志")
                self.view_logs_btn.setObjectName("GhostButton")
                self.view_logs_btn.setToolTip("切换到日志页")
                self.view_logs_btn.clicked.connect(self._show_log_tab)
            layout.addWidget(self.view_logs_btn)

    TM_PAGE_COMBO_ONLINE_COLOR = "#16a34a"
    TM_PAGE_COMBO_OFFLINE_COLOR = "#6b7280"

    def _tm_combo_page_item_dict(self, page):
        """下拉项 UserRole 载荷：完整页面 dict，供绑定/选中读取。"""
        if not isinstance(page, dict):
            return None
        payload = dict(page)
        url = page_url_from(page) or (page.get("url") or "").strip()
        if url:
            payload["url"] = url
        for key in (
            "client_id",
            "page_instance_id",
            "conversation_id",
            "page_display_id",
            "page_type",
            "last_seen",
            "last_poll_at",
        ):
            if key in page and page.get(key) not in (None, ""):
                payload[key] = page.get(key)
        if not (payload.get("page_type") or "").strip():
            conversation_id = (payload.get("conversation_id") or "").strip()
            if conversation_id or "/c/" in url:
                payload["page_type"] = "conversation"
        return payload

    def _tm_page_combo_apply_item_colors(self, index, page):
        if not hasattr(self, "tm_page_combo") or index < 0:
            return
        if not isinstance(page, dict):
            return

        combo = self.tm_page_combo
        is_online = self._page_is_online_for_ui(page)
        color = (
            self.TM_PAGE_COMBO_ONLINE_COLOR
            if is_online
            else self.TM_PAGE_COMBO_OFFLINE_COLOR
        )
        combo.setItemData(
            index,
            QBrush(QColor(color)),
            Qt.ForegroundRole,
        )
        if hasattr(self, "_append_log") and (
            getattr(self, "_debug_mode", False)
            or (
                hasattr(self, "_is_debug_mode_enabled")
                and self._is_debug_mode_enabled()
            )
        ):
            liveness = get_page_liveness(page)
            page_url = (page.get("url") or "-").strip() or "-"
            self._append_log(
                "[PAGE_SELECTOR][ITEM_STYLE] "
                f"index={index} "
                f"client_id={(page.get('client_id') or '-').strip() or '-'} "
                f"url={page_url} "
                f"liveness={liveness} "
                f"online_for_ui={str(is_online).lower()} "
                f"color={color}",
                echo=False,
            )

    def _refresh_page_combo_current_style(self):
        combo = getattr(self, "tm_page_combo", None)
        if combo is None:
            return
        page = None
        if hasattr(self, "_get_selected_tm_page_from_combo"):
            page = self._get_selected_tm_page_from_combo()
        is_online = (
            self._page_is_online_for_ui(page) if isinstance(page, dict) else False
        )
        color = (
            self.TM_PAGE_COMBO_ONLINE_COLOR
            if is_online
            else self.TM_PAGE_COMBO_OFFLINE_COLOR
        )
        combo.setStyleSheet(
            f"""
            QComboBox#TmPageCombo {{
                color: {color};
            }}
            QComboBox#TmPageCombo QAbstractItemView {{
                background: #ffffff;
                selection-background-color: #2563eb;
                selection-color: #ffffff;
                outline: none;
            }}
            """
        )

    def _tm_page_combo_tooltip(self, item):
        self._maybe_log_conversation_id_mismatch(item)

        full_url = self._page_full_url(item) or "-"
        chatgpt_id = self._page_chatgpt_conversation_id(item) or "-"
        client_id = (item.get("client_id") or "-").strip() or "-"
        page_instance_id = (item.get("page_instance_id") or "-").strip() or "-"
        type_text = self._page_type_text(item)
        visible_text = self._page_visible_text(item)
        focus_text = "有焦点" if self._page_has_focus(item) else "无焦点"
        input_text = self._page_input_text(item)
        responding_text = self._page_responding_text(item)
        syncable_text = self._page_syncable_text(item)
        sendable_text = self._page_sendable_text(item)
        profile = self._tm_client_sync_profile(item)
        blocked = (profile.get("reason_code") or "").strip()

        last_seen_text = self._format_last_seen_ago(item.get("last_seen"))

        return (
            f"完整URL：{full_url}\n"
            f"conversation_id：{chatgpt_id}\n"
            f"client_id：{client_id}\n"
            f"page_instance_id：{page_instance_id}\n"
            f"last_seen：{last_seen_text}\n"
            f"页面类型：{type_text}\n"
            f"对话可同步：{syncable_text}\n"
            f"可发送：{sendable_text}\n"
            f"可输入：{input_text}\n"
            f"正在生成：{responding_text}\n"
            f"窗口：{visible_text}（仅展示，不拦截同步）\n"
            f"焦点：{focus_text}（仅展示，不拦截同步）\n"
            f"reason_code：{blocked or '-'}"
        )

    def _tm_page_combo_sort_rank(self, profile):
        if not isinstance(profile, dict):
            return 0
        if profile.get("send_now_available") and profile.get("conversation_syncable"):
            return 4
        if profile.get("conversation_syncable"):
            return 3
        if profile.get("online"):
            return 2
        if profile.get("stale"):
            return 1
        return 0

    def _tm_page_combo_sort_key(self, item):
        profile = self._tm_client_sync_profile(item)
        state_rank = self._tm_page_combo_sort_rank(profile)
        page_type = (item.get("page_type") or "").strip()
        conv_rank = 1 if page_type == "conversation" else 0
        last_seen = float(item.get("last_seen") or 0)
        return (state_rank, conv_rank, last_seen)

    def _tm_page_list_empty_hint_text(self):
        status = getattr(self._bridge_ui, "last_bridge_status", None) or {}
        bridge_url = (status.get("bridge_url") or "").strip()
        if bridge_url:
            return (
                f"暂无可用页面。请确认 ChatGPT 页面已打开，"
                f"油猴脚本接口为：{bridge_url}"
            )
        return (
            "暂无可用页面。请确认已打开 ChatGPT 页面，"
            "并且油猴脚本正在连接本地服务。"
        )

    def _sync_tm_page_list_empty_ui(self):
        """无可用页面时用短文案占位，隐藏空白下拉框；右侧按钮始终可见。"""
        combo = getattr(self, "tm_page_combo", None)
        if combo is None:
            return
        has_pages = combo.count() > 0
        empty_label = getattr(self, "tm_page_empty_label", None)
        if empty_label is not None:
            empty_label.setVisible(not has_pages)
            if not has_pages:
                empty_label.setText(self._tm_page_list_empty_hint_text())
        combo.setVisible(has_pages)
        refresh_btn = getattr(self, "refresh_page_list_btn", None)
        if refresh_btn is not None:
            refresh_btn.setEnabled(True)
            refresh_btn.setVisible(True)
        bind_btn = getattr(self, "bind_current_page_btn", None)
        if bind_btn is not None:
            selected_page = None
            if hasattr(self, "_get_selected_tm_page_from_combo"):
                selected_page = self._get_selected_tm_page_from_combo()
            can_bind = bool(selected_page) and self._page_is_online_for_ui(
                selected_page
            )
            if combo.count() > 0 and selected_page is None:
                self._append_log(
                    "[BIND][BUTTON_STATE_INVALID] "
                    "reason=combo_has_text_but_no_user_data "
                    f"combo_index={combo.currentIndex()} "
                    f"combo_text={combo.currentText()!r} "
                    f"combo_count={combo.count()}",
                    echo=True,
                )
            bind_btn.setEnabled(can_bind)
            bind_btn.setVisible(True)

    def _update_tm_page_selector_display_state(self, index=-1):
        """自动刷新后仅更新展示/提示，不写入 manual_current_tm_client_id。"""
        combo = getattr(self, "tm_page_combo", None)
        if combo is None:
            return
        self._sync_tm_page_list_empty_ui()
        if combo.count() <= 0:
            return
        if index < 0:
            index = combo.currentIndex()
        if index < 0:
            return
        page = None
        if hasattr(self, "_tm_page_combo_page_from_index"):
            page = self._tm_page_combo_page_from_index(index)
        if isinstance(page, dict) and hasattr(self, "_tm_selector_action_hint_for_page"):
            self._set_tm_action_hint(self._tm_selector_action_hint_for_page(page))
        if hasattr(self, "_refresh_manual_current_page_display"):
            self._refresh_manual_current_page_display()
        if hasattr(self, "_refresh_page_combo_current_style"):
            self._refresh_page_combo_current_style()

    def _refresh_tm_page_selector(
        self, status=None, *, force_rebuild=False, snapshot=None
    ):
        del snapshot
        if not hasattr(self, "tm_page_combo"):
            return
        full_status = status if isinstance(status, dict) else None
        client_keys = ("pages",)
        if not full_status or not any(key in full_status for key in client_keys):
            full_status = getattr(self, "_last_bridge_status", None) or {}
        pages = self._extract_tm_pages_from_status(full_status)
        reg = getattr(self, "page_registry", None)
        if reg is not None and hasattr(reg, "pages"):
            unique_pages = [
                snap._raw for snap in reg.pages if getattr(snap, "_raw", None)
            ] or list(pages)
        else:
            unique_pages = list(pages)
        all_pages = [page for page in unique_pages if isinstance(page, dict)]
        online_pages = [
            page for page in all_pages if self._page_is_online_for_ui(page)
        ]
        if online_pages:
            pages = online_pages
        else:
            pages = all_pages
        has_page_source_keys = any(key in full_status for key in client_keys)

        if not pages and self.tm_page_combo.count() > 0 and not has_page_source_keys:
            self._append_log(
                "[TM_SELECTOR][KEEP_LAST] "
                "reason=empty_status_without_page_source "
                f"combo_count={self.tm_page_combo.count()} "
                f"status_keys={list(full_status.keys())}",
                echo=False,
            )
            self._sync_tm_page_list_empty_ui()
            return
        self._append_log(
            "[TM_SELECTOR][SOURCE] "
            f"unique_pages={len(unique_pages)} "
            f"all_pages={len(all_pages)} "
            f"online_pages={len(online_pages)} "
            f"display_pages={len(pages)} "
            f"clients={[p.get('client_id') for p in pages]}",
            echo=False,
        )
        if not pages:
            self._append_log(
                "[TM_SELECTOR][EMPTY] "
                "reason=no_pages_extracted_from_status "
                f"status_keys={list(full_status.keys())}",
                echo=False,
            )
        stored_bound_client_id = self._session_bound_client_id()
        bound_client_id = stored_bound_client_id
        bound_page_instance_id = ""
        bound_conversation_id = ""
        resolved_bound_client_id = ""
        bound_state = ""
        bound_reason = ""
        if hasattr(self, "_resolve_bound_page_info"):
            bound_info, bound_state, bound_reason = self._resolve_bound_page_info(
                status=full_status
            )
            if isinstance(bound_info, dict):
                resolved_bound_client_id = (bound_info.get("client_id") or "").strip()
                bound_page_instance_id = (bound_info.get("page_instance_id") or "").strip()
            session = self._current_session() if hasattr(self, "_current_session") else None
            if session is not None:
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                if hasattr(self, "_remote_conversation_id"):
                    bound_conversation_id = self._remote_conversation_id(remote) or ""
                else:
                    bound_conversation_id = (remote.get("conversation_id") or "").strip()
            self._append_log(
                "[TM_SELECTOR][BOUND_RESOLVE] "
                f"stored_client_id={stored_bound_client_id or '-'} "
                f"resolved_client_id={resolved_bound_client_id or '-'} "
                f"resolved_page_instance_id={bound_page_instance_id or '-'} "
                f"bound_conversation_id={bound_conversation_id or '-'} "
                f"bound_state={bound_state or '-'} "
                f"bound_reason={bound_reason or '-'}",
                echo=False,
            )
        current_client_id = str(
            full_status.get("tampermonkey_client_id") or ""
        ).strip()

        pages.sort(key=self._tm_page_combo_sort_key, reverse=True)
        if hasattr(self, "tm_page_combo") and self.tm_page_combo.count() > 0:
            for item in pages:
                client_id = (item.get("client_id") or "").strip()
                if not client_id:
                    continue
                idx = self._tm_page_combo_find_index_by_client_id(client_id)
                if idx < 0:
                    continue
                old_label = self.tm_page_combo.itemText(idx)
                new_label = self._tm_page_combo_label(
                    item,
                    bound_client_id=bound_client_id,
                    current_client_id=current_client_id,
                    bound_page_instance_id=bound_page_instance_id,
                    bound_conversation_id=bound_conversation_id,
                    resolved_bound_client_id=resolved_bound_client_id,
                )
                if old_label and new_label and old_label != new_label:
                    self._append_log(
                        "[PAGE_SYNC][STALE_URL] "
                        f"old_url={old_label} new_url={new_label} "
                        f"client_id={client_id} "
                        f"page_instance_id={(item.get('page_instance_id') or '-').strip() or '-'}",
                        echo=False,
                    )
        page_selector_key = self._tm_page_selector_signature(pages)
        if (
            not force_rebuild
            and page_selector_key == getattr(self, "_last_page_selector_key", "")
        ):
            self._sync_tm_page_list_empty_ui()
            return
        self._last_page_selector_key = page_selector_key
        manual_client_id = (
            getattr(self, "_manual_current_tm_client_id", "") or ""
        ).strip()
        session_bound = stored_bound_client_id
        self._tm_page_selector_refreshing = True
        self.tm_page_combo.setUpdatesEnabled(False)
        self.tm_page_combo.blockSignals(True)

        self.tm_page_combo.clear()

        for item in pages:
            label = self._tm_page_combo_label(
                item,
                bound_client_id=bound_client_id,
                current_client_id=current_client_id,
                bound_page_instance_id=bound_page_instance_id,
                bound_conversation_id=bound_conversation_id,
                resolved_bound_client_id=resolved_bound_client_id,
            )
            page_payload = self._tm_combo_page_item_dict(item)
            if not isinstance(page_payload, dict):
                continue
            idx = self.tm_page_combo.count()
            self.tm_page_combo.addItem(label, page_payload)
            self.tm_page_combo.setItemData(
                idx, page_payload, self.TM_PAGE_ITEM_DICT_ROLE
            )
            tooltip = (
                self._format_tm_page_option_tooltip(item)
                if hasattr(self, "_format_tm_page_option_tooltip")
                else self._tm_page_combo_tooltip(item)
            )
            self.tm_page_combo.setItemData(idx, tooltip, Qt.ToolTipRole)
            self._tm_page_combo_apply_item_colors(idx, item)
            if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():
                self._append_log(
                    "[TM_SELECTOR][ITEM] "
                    f"index={idx} "
                    f"label={label} "
                    f"client_id={(item.get('client_id') or '-').strip() or '-'} "
                    f"page_type={(item.get('page_type') or '-').strip() or '-'} "
                    f"conversation_id={(item.get('conversation_id') or '-').strip() or '-'} "
                    f"visibility_state={(item.get('visibility_state') or '-').strip() or '-'} "
                    f"focus={(item.get('focus') or '-').strip() or '-'} "
                    f"response_state={(item.get('response_state') or '-').strip() or '-'} "
                    f"activity_state={(item.get('activity_state') or '-').strip() or '-'} "
                    f"input={(item.get('input') or '-').strip() or '-'} "
                    f"url={(page_url_from(item) or '-').strip() or '-'}",
                    echo=False,
                )

        session = self._current_session() if hasattr(self, "_current_session") else None
        restore_index = self._pick_tm_page_selector_restore_index(pages, session=session)
        try:
            if restore_index >= 0:
                self.tm_page_combo.setCurrentIndex(restore_index)
            elif self.tm_page_combo.count() > 0:
                self.tm_page_combo.setCurrentIndex(0)
            else:
                self.tm_page_combo.setCurrentIndex(-1)
        finally:
            self._tm_page_selector_refreshing = False
            self.tm_page_combo.blockSignals(False)
            self.tm_page_combo.setUpdatesEnabled(True)

        self._append_log(
            "[PAGE_SELECTOR][AUTO_REFRESH] "
            f"restore_index={restore_index} "
            f"manual_client_id={manual_client_id or '-'} "
            f"session_bound={session_bound or '-'} "
            f"resolved_bound_client_id={resolved_bound_client_id or '-'} "
            f"bound_conversation_id={bound_conversation_id or '-'} "
            f"page_count={self.tm_page_combo.count()} "
            f"reason={'matched' if restore_index >= 0 else 'no_matching_current_page'}",
            echo=False,
        )
        self._update_tm_page_selector_display_state(restore_index)
        if hasattr(self, "_update_current_session_url_display"):
            self._update_current_session_url_display()
        if hasattr(self, "_update_bound_page_display_light"):
            self._update_bound_page_display_light()
        if hasattr(self, "_update_current_session_title"):
            current_session = (
                self._current_session() if hasattr(self, "_current_session") else None
            )
            if current_session is not None:
                self._update_current_session_title(current_session)

    def _selected_tm_page_client_id(self):
        item = self._get_tm_page_combo_selection() if hasattr(
            self, "_get_tm_page_combo_selection"
        ) else None
        if isinstance(item, dict):
            return (item.get("client_id") or "").strip()
        combo = getattr(self, "tm_page_combo", None)
        if combo is not None and combo.count() > 0 and combo.currentIndex() >= 0:
            return self._tm_page_combo_client_id_from_data(
                combo.currentData(Qt.UserRole)
            )
        return ""
