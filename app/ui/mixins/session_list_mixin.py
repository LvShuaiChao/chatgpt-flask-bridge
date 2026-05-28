import logging
import time

logger = logging.getLogger(__name__)

from app.constants import (
    ASSISTANT_WAIT_TEXTS,
    ASSISTANT_REPLY_PENDING_STATUSES,
    USER_SEND_PENDING_STATUSES,
    SESSION_BIND_LIST_STYLES,
    UNBOUND_SESSION_SEND_HINT,
)
from app.models import (
    remote_binding_enabled,
    BIND_STATE_WAITING_HOME,
    ChatSession,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.ui.widgets.session_list_item import (
    SESSION_LIST_ITEM_HEIGHT,
    SessionListItemWidget,
)
from PyQt5.QtCore import QSize, Qt
from PyQt5.QtWidgets import (
    QInputDialog,
    QListWidgetItem,
    QMenu,
)


class SessionListMixin:
    def _build_session_preview_text(self, session):
        ts = time.strftime("%H:%M", time.localtime(session.updated_at or time.time()))
        response_state = self._session_bound_response_state(session)
        runtime = self._session_runtime_entry(session)
        pending_cache = runtime.get("pending_cache") or self._compute_session_pending_state(session)
        has_pending = bool(pending_cache.get("has_pending"))
        remote = normalize_remote_chatgpt(session.remote_chatgpt)

        bind_list_state = self._session_bind_list_state(
            session,
            getattr(self._bridge_ui, "last_bridge_status", None),
        )

        if self._remote_bind_state(remote) == BIND_STATE_WAITING_HOME:
            return f"{ts} 路 等待首页上线..."

        if self._auto_bind.pending_session_id == session.session_id:
            return f"{ts} 路 等待绑定..."

        if has_pending:
            if hasattr(self, "_session_bootstrap_claim_pending") and self._session_bootstrap_claim_pending(session):
                elapsed = ""
                if hasattr(self, "_session_waiting_preview_suffix"):
                    elapsed = self._session_waiting_preview_suffix(session)
                from app.constants import BOOTSTRAP_CLAIM_WARN_AFTER_SECONDS

                pending_elapsed = 0.0
                if hasattr(self, "_session_pending_elapsed_sec"):
                    pending_elapsed = float(self._session_pending_elapsed_sec(session) or 0)
                if pending_elapsed >= float(BOOTSTRAP_CLAIM_WARN_AFTER_SECONDS):
                    if elapsed:
                        return f"{ts} 路 首页未领取 {elapsed}"
                    return f"{ts} 路 首页未领取..."
                if elapsed:
                    return f"{ts} 路 等待首页领取 {elapsed}"
                return f"{ts} 路 等待首页领取..."
            if hasattr(self, "_session_bootstrap_message_id"):
                bridge_id = self._session_bootstrap_message_id(session)
                if bridge_id and hasattr(self, "_bootstrap_message_delivery_phase"):
                    if self._bootstrap_message_delivery_phase(bridge_id) == "delivered":
                        elapsed = ""
                        if hasattr(self, "_session_waiting_preview_suffix"):
                            elapsed = self._session_waiting_preview_suffix(session)
                        if elapsed:
                            return f"{ts} 路 页面已领取 {elapsed}"
                        return f"{ts} 路 页面已领取..."
            elapsed = ""
            if hasattr(self, "_session_waiting_preview_suffix"):
                elapsed = self._session_waiting_preview_suffix(session)
            if elapsed:
                return f"{ts} 路 等待回复 {elapsed}"
            return f"{ts} 路 等待回复..."

        if response_state["is_responding"]:
            return f"{ts} 路 正在回答..."

        if bind_list_state == "bound_offline":
            return f"{ts} 路 已绑定离线"

        if bind_list_state == "bind_mismatch":
            return f"{ts} 路 绑定异常"

        if bind_list_state == "prebound_home":
            return f"{ts} 路 等待进入对话"

        if bind_list_state == "waiting_bound_conversation":
            return f"{ts} 路 等待打开绑定页"

        if bind_list_state == "waiting_conversation_created":
            return f"{ts} 路 创建中..."

        text = self._latest_visible_chat_message_text(session)
        if text:
            text = text.replace("\n", " ")
            if len(text) > 36:
                text = text[:36] + "..."
            return f"{ts} 路 {text}"

        if bind_list_state == "bound_online":
            return f"{ts} 路 已绑定在线"

        if remote_binding_enabled(remote) and (remote.get("client_id") or "").strip():
            return f"{ts} 路 已绑定离线"

        return ts

    def _session_visual_row_signature(self, session):
        runtime = self._session_runtime_entry(session)
        cached = runtime.get("visual_row_signature")
        if cached:
            return cached
        pending_cache = runtime.get("pending_cache") or self._compute_session_pending_state(session)
        preview = self._session_preview_text(session)
        bind_state = self._session_bind_list_state(
            session,
            self._bridge_ui.last_bridge_status,
        )
        value = (
            session.session_id,
            self._session_list_title_text(session),
            preview,
            bind_state,
            bool(pending_cache.get("has_pending")),
            self._session_reply_done_flash_phase(session),
        )
        runtime["visual_row_signature"] = value
        return value

    def _session_display_title(self, session):
        title = session.title or "新对话"
        if session.has_pending_reply:
            return f"{title} *"
        return title

    @staticmethod
    def _is_default_session_title(title):
        value = str(title or "").strip()
        return value in ("", "新对话", "新的对话", "New chat")

    @staticmethod
    def _compact_session_title_from_text(text, max_len=24):
        value = str(text or "")
        value = value.replace("\r\n", "\n").replace("\r", "\n")
        value = " ".join(value.split())
        value = value.strip()
        if not value:
            return ""
        if len(value) > max_len:
            return value[:max_len] + "…"
        return value

    def _first_visible_chat_message_text(self, session, *, prefer_user=True):
        if session is None:
            return ""
        roles = ("user", "assistant") if prefer_user else ("assistant", "user")
        for role in roles:
            for message in session.messages:
                if not getattr(message, "visible_in_chat", True):
                    continue
                if message.role != role:
                    continue
                text = str(message.content or "").strip()
                if not text:
                    continue
                if text in ASSISTANT_WAIT_TEXTS:
                    continue
                return text
        return ""

    def _latest_visible_chat_message_text(self, session):
        if session is None:
            return ""
        for message in reversed(session.messages):
            if not getattr(message, "visible_in_chat", True):
                continue
            if message.role not in ("user", "assistant"):
                continue
            text = str(message.content or "").strip()
            if not text:
                continue
            if text in ASSISTANT_WAIT_TEXTS:
                return ""
            return text
        return ""

    def _last_assistant_text(self, session):
        if session is None:
            return ""
        for message in reversed(session.messages):
            if not getattr(message, "visible_in_chat", True):
                continue
            if message.role != "assistant":
                continue
            status = (message.ui_status or "").strip()
            if status in ASSISTANT_REPLY_PENDING_STATUSES:
                continue
            text = str(message.content or "")
            if not text.strip():
                continue
            if text.strip() in ASSISTANT_WAIT_TEXTS:
                continue
            return text
        return ""

    def _auto_rename_session_from_messages(self, session, *, force=False):
        if session is None:
            return False
        if not force and not self._is_default_session_title(session.title):
            return False
        text = self._first_visible_chat_message_text(session, prefer_user=True)
        title = self._compact_session_title_from_text(text, max_len=24)
        if not title:
            return False
        old_title = session.title
        session.title = title
        session.updated_at = time.time()
        self._append_log(
            "[SESSION_TITLE][AUTO_FROM_MESSAGES] "
            f"session_id={session.session_id} "
            f"old={old_title or '-'} "
            f"new={title}"
        )
        return True

    def _session_list_title_text(self, session):
        if session is None:
            return "新对话"
        if self._is_default_session_title(session.title):
            text = self._first_visible_chat_message_text(session, prefer_user=True)
            title = self._compact_session_title_from_text(text, max_len=24)
            if title:
                return title
        return session.title or "新对话"

    def _session_item_is_current(self, session_id):
        current_id = getattr(self, "_current_session_id", "") or ""
        return bool(session_id) and session_id == current_id

    def _format_current_session_header_text(self, session=None):
        if hasattr(self, "_format_current_session_header_with_page_id"):
            return self._format_current_session_header_with_page_id(session)
        if session is None:
            return "当前会话：新对话"
        title = self._session_display_title(session) if hasattr(self, "_session_display_title") else ""
        if not title or title == "新对话":
            return "当前会话：新对话"
        return f"当前会话：{title}"

    def _log_session_current_badge_refresh(self, session_id, is_current, title=""):
        if not hasattr(self, "_append_log"):
            return
        self._append_log(
            "[SESSION][CURRENT_BADGE_REFRESH] "
            f"session_id={session_id or '-'} "
            f"title={title or '-'} "
            f"is_current={'true' if is_current else 'false'}",
            echo=False,
        )

    def _refresh_session_list_current_badges(self, session_ids=None):
        if not hasattr(self, "session_list"):
            return
        current_id = getattr(self, "_current_session_id", "") or ""
        if session_ids is None:
            session_ids = []
            for index in range(self.session_list.count()):
                item = self.session_list.item(index)
                if item is None:
                    continue
                sid = item.data(Qt.UserRole) or ""
                if sid:
                    session_ids.append(sid)
        seen = set()
        for session_id in session_ids:
            if session_id in seen:
                continue
            seen.add(session_id)
            is_current = session_id == current_id
            index = self._list_index_for_session(session_id)
            if index < 0:
                continue
            item = self.session_list.item(index)
            if item is None:
                continue
            widget = self.session_list.itemWidget(item)
            prev_current = None
            if widget is not None:
                state = getattr(widget, "_last_apply_state", None)
                if isinstance(state, dict):
                    prev_current = bool(state.get("is_current"))
            badge_updated = False
            if widget is not None and hasattr(widget, "set_is_current_fast"):
                badge_updated = bool(widget.set_is_current_fast(is_current))
            if not badge_updated:
                session = self._sessions.get(session_id)
                if session is not None:
                    self._apply_session_list_item_widget(
                        item,
                        session,
                        selected=is_current,
                    )
            if prev_current is not None and prev_current == is_current:
                continue
            session = self._sessions.get(session_id)
            badge_title = "-"
            if session is not None and hasattr(self, "_session_list_title_text"):
                badge_title = self._session_list_title_text(session)
            self._log_session_current_badge_refresh(
                session_id, is_current, badge_title
            )

    def _update_session_list_item_runtime(self, session, *, selected=None):
        if session is None or not hasattr(self, "session_list"):
            return False
        session_id = (session.session_id or "").strip()
        if not session_id:
            return False
        index = self._list_index_for_session(session_id)
        if index < 0:
            return False
        item = self.session_list.item(index)
        if item is None:
            return False
        if selected is None:
            selected = self._session_item_is_current(session_id)
        started_at = time.perf_counter()
        self._apply_session_list_item_widget(
            item,
            session,
            selected=selected,
        )
        cost_ms = int((time.perf_counter() - started_at) * 1000)
        if cost_ms > 80 and hasattr(self, "_append_log"):
            self._append_log(
                "[PERF][SESSION_LIST] "
                f"session_id={session_id} "
                f"mode=item_update "
                f"cost={cost_ms}ms",
                echo=False,
            )
        return True

    def _set_session_item_selected_fast(self, session_id, selected):
        is_current = self._session_item_is_current(session_id)
        index = self._list_index_for_session(session_id)
        if index < 0:
            return
        item = self.session_list.item(index)
        if item is None:
            return
        widget = self.session_list.itemWidget(item)
        if widget is not None and hasattr(widget, "set_selected_fast"):
            if widget.set_selected_fast(selected, is_current=is_current):
                return
        session = self._sessions.get(session_id)
        if session is None:
            return
        self._apply_session_list_item_widget(
            item,
            session,
            selected=selected,
        )

    def _refresh_session_list_selection_only(
        self, current_session_id, previous_session_id=None
    ):
        if not hasattr(self, "session_list"):
            return
        self._page_cmd.list_refreshing = True
        self.session_list.blockSignals(True)
        try:
            current_index = self._list_index_for_session(current_session_id)
            if current_index >= 0 and self.session_list.currentRow() != current_index:
                self.session_list.setCurrentRow(current_index)
            changed_ids = []
            if previous_session_id:
                changed_ids.append(previous_session_id)
            if current_session_id:
                changed_ids.append(current_session_id)
            seen = set()
            for sid in changed_ids:
                if sid in seen:
                    continue
                seen.add(sid)
                self._set_session_item_selected_fast(
                    sid,
                    selected=(sid == current_session_id),
                )
        finally:
            self.session_list.blockSignals(False)
            self._page_cmd.list_refreshing = False

    def _force_session_list_repaint_now(self):
        session_list = getattr(self, "session_list", None)
        if session_list is None:
            return
        viewport = session_list.viewport()
        if viewport is not None:
            viewport.update()

    def _update_current_session_title_fast(self, session):
        label = getattr(self, "current_session_title", None)
        if label is None:
            return
        if hasattr(self, "_format_current_session_header_segments") and hasattr(
            label, "set_segments"
        ):
            label.set_segments(self._format_current_session_header_segments(session))
        else:
            label.setText(self._format_current_session_header_text(session))
        if hasattr(self, "_refresh_current_conversation_stats"):
            self._refresh_current_conversation_stats(session)

    def _session_list_item_tooltip(self, session, bind_state):
        style = SESSION_BIND_LIST_STYLES.get(
            bind_state, SESSION_BIND_LIST_STYLES["unbound"]
        )
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        title = self._session_list_title_text(session)
        lines = [
            f"标题：{title}",
            f"绑定状态：{style['label']}",
        ]
        bridge_status = getattr(self._bridge_ui, 'last_bridge_status', None)
        client_id = (
            remote.get("client_id")
            or remote.get("prebound_home_client_id")
            or ""
        ).strip()
        page_instance_id = (
            remote.get("page_instance_id")
            or remote.get("prebound_home_page_instance_id")
            or ""
        ).strip()
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                (remote.get("url") or "").strip()
            )
        page_url = (remote.get("url") or "").strip()
        if bind_state == "bind_mismatch":
            reason = self._session_bind_mismatch_tooltip_reason(session, bridge_status)
            if reason:
                lines.append(reason)
        if bind_state == "unbound" and not remote_binding_enabled(remote):
            lines.append(UNBOUND_SESSION_SEND_HINT)
        elif remote_binding_enabled(remote):
            from app.constants import STATUS_DETAIL_TECH_HINT

            page_no = "-"
            if hasattr(self, "_session_bound_page_no_text"):
                page_no = self._session_bound_page_no_text(
                    session, status=bridge_status
                )
            if page_url:
                lines.append(f"绑定页 URL：{page_url}")
            if page_no and page_no != "-":
                lines.append(f"页面 ID：{page_no}")
            lines.append(STATUS_DETAIL_TECH_HINT)
        verbose = (
            hasattr(self, "_is_ui_verbose_status_enabled")
            and self._is_ui_verbose_status_enabled()
        )
        if verbose and remote_binding_enabled(remote):
            lines.extend([
                f"client_id：{client_id or '-'}",
                f"page_instance_id：{page_instance_id or '-'}",
                f"conversation_id：{conversation_id or '-'}",
            ])
            client_info = (
                self._client_info_by_id(client_id, bridge_status)
                if client_id
                else None
            )
            if client_info:
                focus_txt = "是" if client_info.get("has_focus") else "否"
                lines.append(f"focus：{focus_txt}")
                lines.append(
                    f"last_seen：{self._format_last_seen_ago(client_info.get('last_seen'))}"
                )
        if self._session_has_pending_assistant_reply(session):
            if hasattr(self, "_session_bootstrap_claim_pending") and self._session_bootstrap_claim_pending(session):
                lines.append("消息状态：等待 ChatGPT 首页领取首条消息")
            else:
                elapsed = ""
                if hasattr(self, "_session_waiting_preview_suffix"):
                    elapsed = self._session_waiting_preview_suffix(session)
                if elapsed:
                    lines.append(f"消息状态：等待回复 {elapsed}")
                else:
                    lines.append("消息状态：等待回复")
        else:
            response_state = self._session_bound_response_state(session)
            if response_state["is_responding"]:
                lines.append("消息状态：正在回答")
            elif response_state["response_state"] == "idle":
                lines.append("消息状态：空闲可发送")
        return "\n".join(lines)

    def _apply_session_list_item_widget(self, item, session, *, selected=False):
        bind_state = self._session_bind_list_state(session, self._bridge_ui.last_bridge_status)
        is_current = self._session_item_is_current(session.session_id)
        widget = self.session_list.itemWidget(item)
        if widget is None:
            widget = SessionListItemWidget()
            self.session_list.setItemWidget(item, widget)
        status_text = None
        status_segments = None
        if hasattr(self, "_session_list_bind_status_segments"):
            status_segments = self._session_list_bind_status_segments(
                session, bind_state
            )
        elif hasattr(self, "_session_list_bind_status_text"):
            status_text = self._session_list_bind_status_text(session, bind_state)
        widget.apply_state(
            title=self._session_list_title_text(session),
            subtitle=self._session_preview_text(session),
            bind_state=bind_state,
            pending_reply=self._session_has_pending_assistant_reply(session),
            reply_flash=self._session_reply_done_flash_active(session),
            reply_flash_phase=self._session_reply_done_flash_phase(session),
            selected=selected,
            is_current=is_current,
            tooltip=self._session_list_item_tooltip(session, bind_state),
            status_text=status_text,
            status_segments=status_segments,
        )
        viewport_w = max(0, self.session_list.viewport().width())
        item_w = viewport_w if viewport_w > 0 else 220
        item.setSizeHint(QSize(item_w, SESSION_LIST_ITEM_HEIGHT))
        widget.setMaximumWidth(16777215)

    def _update_current_session_title(self, session=None):
        if not hasattr(self, "current_session_title"):
            return
        session = session or self._current_session()
        if not session:
            if hasattr(self.current_session_title, "set_segments") and hasattr(
                self, "_format_current_session_header_segments"
            ):
                self.current_session_title.set_segments(
                    self._format_current_session_header_segments(None)
                )
            else:
                self.current_session_title.setText("当前会话：新对话")
            if hasattr(self, "_update_current_session_url_display"):
                self._update_current_session_url_display()
            if hasattr(self, "_refresh_current_conversation_stats"):
                self._refresh_current_conversation_stats(None)
            return
        if self._is_default_session_title(session.title):
            self._auto_rename_session_from_messages(session)
        if hasattr(self.current_session_title, "set_segments") and hasattr(
            self, "_format_current_session_header_segments"
        ):
            self.current_session_title.set_segments(
                self._format_current_session_header_segments(session)
            )
        else:
            self.current_session_title.setText(
                self._format_current_session_header_text(session)
            )
        if hasattr(self, "_update_current_session_url_display"):
            self._update_current_session_url_display()
        if hasattr(self, "_refresh_current_conversation_stats"):
            self._refresh_current_conversation_stats(session)

    def _list_index_for_session(self, session_id):
        for index in range(self.session_list.count()):
            item = self.session_list.item(index)
            if item and item.data(Qt.UserRole) == session_id:
                return index
        return -1

    def _sync_session_order_from_list(self):
        ordered = []
        for index in range(self.session_list.count()):
            item = self.session_list.item(index)
            if not item:
                continue
            session_id = item.data(Qt.UserRole)
            if session_id and session_id in self._sessions:
                ordered.append(session_id)
        if ordered:
            self._tab_session_ids = ordered

    def _ensure_session_order(self):
        valid = [sid for sid in self._tab_session_ids if sid in self._sessions]
        for session_id in self._sessions:
            if session_id not in valid:
                valid.append(session_id)
        self._tab_session_ids = valid

    def _refresh_session_list(self, select_session_id=None):
        if not hasattr(self, "session_list"):
            return
        started_at = time.perf_counter()
        self._ensure_session_order()
        new_sig = self._session_list_visual_signature()
        old_sig = getattr(self, "_last_session_list_visual_signature", None)
        target_id = select_session_id or self._current_session_id

        if old_sig == new_sig:
            if target_id:
                list_index = self._list_index_for_session(target_id)
                if list_index >= 0 and self.session_list.currentRow() != list_index:
                    self._page_cmd.list_refreshing = True
                    self.session_list.blockSignals(True)
                    self.session_list.setCurrentRow(list_index)
                    self.session_list.blockSignals(False)
                    self._page_cmd.list_refreshing = False
            self._refresh_session_list_current_badges(
                [target_id] if target_id else None
            )
            cost_ms = int((time.perf_counter() - started_at) * 1000)
            if cost_ms > 80 and hasattr(self, "_append_log"):
                self._append_log(
                    "[PERF][SESSION_LIST] "
                    f"mode=skip "
                    f"cost={cost_ms}ms "
                    f"target_id={target_id or '-'}",
                    echo=False,
                )
            return

        structure_same = (
            old_sig
            and len(old_sig) == len(new_sig)
            and all(old_row[0] == new_row[0] for old_row, new_row in zip(old_sig, new_sig))
        )

        self._page_cmd.list_refreshing = True
        self.session_list.blockSignals(True)

        if structure_same:
            old_by_id = {}
            if old_sig:
                old_by_id = {row[0]: row for row in old_sig}

            for index, row in enumerate(new_sig):
                session_id = row[0]
                old_row = old_by_id.get(session_id)

                if old_row == row:
                    continue

                session = self._sessions.get(session_id)
                item = self.session_list.item(index)
                if not item or not session:
                    continue

                self._apply_session_list_item_widget(
                    item,
                    session,
                    selected=self._session_item_is_current(session_id),
                )
        else:
            self.session_list.clear()
            for row in new_sig:
                session_id = row[0]
                session = self._sessions.get(session_id)
                if not session:
                    continue
                item = QListWidgetItem()
                item.setData(Qt.UserRole, session_id)
                self.session_list.addItem(item)
                self._apply_session_list_item_widget(
                    item,
                    session,
                    selected=self._session_item_is_current(session_id),
                )

        if target_id:
            list_index = self._list_index_for_session(target_id)
            if list_index >= 0:
                self.session_list.setCurrentRow(list_index)
        self.session_list.blockSignals(False)
        self._page_cmd.list_refreshing = False
        self._last_session_list_visual_signature = new_sig
        self._refresh_session_list_current_badges()
        cost_ms = int((time.perf_counter() - started_at) * 1000)
        if cost_ms > 80 and hasattr(self, "_append_log"):
            self._append_log(
                "[PERF][SESSION_LIST] "
                f"mode={'structure_same' if structure_same else 'rebuild'} "
                f"cost={cost_ms}ms "
                f"count={len(new_sig)}",
                echo=False,
            )

    def _on_session_list_pressed_fast(self, item):
        if self._page_cmd.list_refreshing or item is None:
            return
        session_id = item.data(Qt.UserRole)
        if not session_id:
            return
        if session_id == getattr(self, "_current_session_id", ""):
            self._focus_message_input_later()
            if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):
                self._append_log(
                    f"[SESSION_LIST][CURRENT_CLICK_FOCUS_INPUT] session_id={session_id}",
                    echo=False,
                )
            return
        self._select_session(session_id)

    def _on_session_list_changed(self, current, previous):
        if self._page_cmd.list_refreshing or current is None:
            return
        session_id = current.data(Qt.UserRole)
        if not session_id:
            return
        if session_id == getattr(self, "_current_session_id", ""):
            return
        self._select_session(session_id)

    def _on_session_list_reordered(self, parent, start, end, destination, row):
        self._sync_session_order_from_list()
        self._schedule_save_sessions_to_disk()

    def _on_session_list_double_clicked(self, item):
        if not item:
            return
        session_id = item.data(Qt.UserRole)
        if not session_id:
            return
        if session_id != self._current_session_id:
            self._select_session(session_id)
        session = self._sessions.get(session_id)
        if not session:
            return
        self._open_bound_page_for_session(
            session,
            label=f"对话「{session.title}」ChatGPT 页面",
            fallback_live=(session_id == self._current_session_id),
        )

    def _on_session_list_context_menu(self, pos):
        item = self.session_list.itemAt(pos)
        if not item:
            return
        session_id = item.data(Qt.UserRole)
        if not session_id:
            return
        if session_id != self._current_session_id:
            self._select_session(session_id)
        session = self._sessions.get(session_id)
        open_url = self._session_openable_chatgpt_url(session)
        if not open_url and session_id == self._current_session_id:
            open_url = self._live_openable_chatgpt_url()
        menu = QMenu(self)
        open_page_action = menu.addAction("打开 ChatGPT 页面")
        open_page_action.setEnabled(bool(open_url))
        if open_url:
            open_page_action.setToolTip(open_url)
        else:
            open_page_action.setToolTip(
                "发送消息后会自动记录页面；也可先在列表选中页面后点击「绑定所选页面」"
            )
        menu.addSeparator()
        rename_action = menu.addAction("重命名")
        clear_action = menu.addAction("清空对话")
        delete_action = menu.addAction("删除对话")
        action = menu.exec_(self.session_list.mapToGlobal(pos))
        if action == open_page_action:
            if session:
                self._open_bound_page_for_session(
                    session,
                    label=f"对话「{session.title}」ChatGPT 页面",
                    fallback_live=(session_id == self._current_session_id),
                )
        elif action == rename_action:
            self._rename_current_session()
        elif action == clear_action:
            self._clear_current_session()
        elif action == delete_action:
            self._delete_session_by_id(session_id)

    def _delete_current_session(self):
        session = self._current_session()
        if not session:
            return
        self._delete_session_by_id(session.session_id)

    def _select_next_session_after_delete(self, *, deleted_session_id, list_index=-1):
        if not self._tab_session_ids:
            self._current_session_id = None
            if hasattr(self, "_refresh_current_chat_panel"):
                self._refresh_current_chat_panel()
            return ""
        if list_index < 0:
            list_index = self._list_index_for_session(deleted_session_id)
        if list_index < 0:
            list_index = 0
        next_index = min(max(list_index, 0), len(self._tab_session_ids) - 1)
        next_id = self._tab_session_ids[next_index]
        self._select_session(next_id)
        return next_id

    def _delete_session_by_id(self, session_id):
        if session_id not in self._sessions:
            return

        self._append_log(
            f"[SESSION][DELETE][START] session_id={session_id}",
            echo=True,
        )

        was_current = session_id == getattr(self, "_current_session_id", "")
        is_last_session = len(self._tab_session_ids) <= 1

        if hasattr(self, "_clear_session_binding"):
            self._clear_session_binding(session_id, reason="session_deleted")
        if hasattr(self, "_clear_pending_web_sync_for_session"):
            self._clear_pending_web_sync_for_session(session_id)

        list_index = self._list_index_for_session(session_id)
        if is_last_session:
            self._clear_current_session()
            next_session_id = getattr(self, "_current_session_id", "") or ""
            self._refresh_session_list(select_session_id=next_session_id or None)
        else:
            for message_id, sid in list(self._message_to_session.items()):
                if sid == session_id:
                    del self._message_to_session[message_id]
                    self._message_to_turn.pop(message_id, None)
            if session_id in self._tab_session_ids:
                self._tab_session_ids.remove(session_id)
            if isinstance(getattr(self, "_session_send_queues", None), dict):
                self._session_send_queues.pop(session_id, None)
            if hasattr(self, "_purge_session_binding_caches"):
                self._purge_session_binding_caches(session_id)
            del self._sessions[session_id]
            if was_current:
                next_session_id = self._select_next_session_after_delete(
                    deleted_session_id=session_id,
                    list_index=list_index,
                )
            else:
                next_session_id = getattr(self, "_current_session_id", "") or ""
            self._refresh_session_list(
                select_session_id=next_session_id or None
            )

        self._append_log(
            f"[SESSION][DELETE][DONE] session_id={session_id}",
            echo=True,
        )

        current_bound_url = ""
        current_session = self._current_session()
        if current_session and hasattr(self, "_current_session_bound_url"):
            current_bound_url, _state = self._current_session_bound_url()
        if hasattr(self, "_refresh_current_session_binding_display"):
            self._refresh_current_session_binding_display()
        if was_current and hasattr(self, "_refresh_current_chat_panel"):
            self._refresh_current_chat_panel()
        self._append_log(
            "[SESSION][DELETE][UI_REFRESH] "
            f"deleted_session_id={session_id} "
            f"next_session_id={next_session_id or '-'} "
            f"current_bound_url={current_bound_url or '-'}",
            echo=True,
        )
        self._save_sessions_to_disk()
        if hasattr(self, "_cleanup_bridge_runtime_maps"):
            self._cleanup_bridge_runtime_maps("session_changed")

    def _rename_current_session(self):
        session = self._current_session()
        if not session:
            return
        title, ok = QInputDialog.getText(
            self, "重命名对话", "对话标题：", text=session.title
        )
        if not ok:
            return
        new_title = title.strip()
        if not new_title:
            self._add_system_message("对话标题不能为空。")
            return
        session.title = new_title
        session.updated_at = time.time()
        self._refresh_session_list(select_session_id=session.session_id)
        self._update_current_session_title(session)
        self._schedule_save_sessions_to_disk()

    def _session_was_cleared_for_rebind_or_sync(self, session_id):
        cleared_map = getattr(self, "_session_cleared_for_rebind_sync", None)
        if not isinstance(cleared_map, dict):
            return False
        return (session_id or "").strip() in cleared_map

    def _sync_failure_text_after_pre_clear(self, session_id, detail=""):
        session = self._sessions.get((session_id or "").strip())
        if session is None:
            return detail or "同步失败"
        if not self._session_was_cleared_for_rebind_or_sync(session.session_id):
            return detail or "同步失败"
        if len(session.messages or []) > 0:
            return detail or "同步失败"
        base = "同步失败，当前会话已清空，请重新点击同步网页对话。"
        if detail:
            return f"{base}（{detail}）"
        return base

    def _log_sync_failed_after_clear(self, session_id, reason="", error=""):
        if not self._session_was_cleared_for_rebind_or_sync(session_id):
            return
        self._append_log(
            "[SYNC][FAILED_AFTER_CLEAR] "
            f"session_id={session_id or '-'} "
            f"reason={reason or '-'} "
            f"error={error or '-'}",
            echo=True,
        )

    def _clear_current_session(self):
        session = self._current_session()
        if not session:
            return
        if isinstance(getattr(self, "_session_send_queues", None), dict):
            self._session_send_queues.pop(session.session_id, None)
        for bridge_id, sid in list(self._message_to_session.items()):
            if sid == session.session_id:
                del self._message_to_session[bridge_id]
                self._message_to_turn.pop(bridge_id, None)
                self._bridge_msg.finalized_bridge_message_ids.discard(bridge_id)
                self._bridge_msg.ack_success_message_ids.discard(bridge_id)
        session.messages.clear()
        session.updated_at = time.time()
        session.has_pending_reply = False
        session.reply_waiting_since = 0
        if hasattr(self, "_mark_session_waiting_finished"):
            self._mark_session_waiting_finished(session, reason="clear_session")
        if hasattr(self, "_set_tm_action_hint"):
            self._set_tm_action_hint("当前对话已清空")
        if hasattr(self, "_append_log"):
            self._append_log(
                f"[SESSION][CLEAR] session_id={session.session_id} title={session.title}",
                echo=True,
            )
        self._render_session_chat(session, force_bottom=True)
        self._refresh_session_list(select_session_id=session.session_id)
        self._update_current_session_title(session)
        self._schedule_save_sessions_to_disk()
        if hasattr(self, "_cleanup_bridge_runtime_maps"):
            self._cleanup_bridge_runtime_maps("session_changed")

    def _session_preview_text(self, session):
        if session is None:
            return ""
        runtime = self._session_runtime_entry(session)
        cached = runtime.get("preview_cache")
        if isinstance(cached, str) and cached:
            return cached
        text = self._build_session_preview_text(session)
        runtime["preview_cache"] = text
        return text

    def _session_list_visual_signature(self):
        self._ensure_session_order()
        rows = []
        for sid in self._tab_session_ids:
            session = self._sessions.get(sid)
            if not session:
                continue
            rows.append(self._session_visual_row_signature(session))
        return tuple(rows)

