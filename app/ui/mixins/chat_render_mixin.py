import time
import traceback

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtWidgets import QLabel, QSizePolicy, QWidget

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
)
from app.ui.chat_view_helpers import (
    capture_scroll_state,
    clear_layout,
    create_bubble_row_widget,
    schedule_scroll_to_bottom,
    schedule_scroll_to_bottom_if_needed,
    schedule_scroll_to_last_row,
)
from app.ui.widgets.chat_bubble import ChatBubble, SystemBubble
from app.utils.text_utils import format_ts


MAX_RENDER_MESSAGES_ON_SWITCH = 120


class ChatRenderMixin:
    def _chat_primary_scroll_area(self):
        scroll = getattr(self, "chat_messages_scroll", None)
        if scroll is not None:
            return scroll
        return getattr(self, "chat_scroll", None)

    def _chat_messages_container(self):
        container = getattr(self, "chat_messages_container", None)
        if container is not None:
            return container
        return getattr(self, "chat_container", None)

    def _chat_messages_layout(self):
        layout = getattr(self, "chat_messages_layout", None)
        if layout is not None:
            return layout
        return getattr(self, "chat_list_layout", None)

    def _ensure_chat_scroll_widget_attached(self):
        scroll = self._chat_primary_scroll_area()
        container = self._chat_messages_container()
        if scroll is None or container is None:
            return False
        if scroll.widget() is container:
            return True
        scroll.setWidget(container)
        scroll.setWidgetResizable(True)
        self._append_log(
            "[CHAT_RENDER][FIX] reason=reattach_container_to_scroll "
            f"container={container.objectName() or type(container).__name__}",
            echo=True,
        )
        return True

    @staticmethod
    def _format_ts(ts):
        return format_ts(ts)
    def _format_message_ts(self, created_at):
        if not self._show_timestamp:
            return ""
        return time.strftime("%H:%M:%S", time.localtime(created_at))
    def _clear_chat_widgets(self):
        layout = self._chat_messages_layout()
        if layout is None:
            self._append_log(
                "[CHAT_RENDER][CLEAR_SKIP] reason=missing_layout",
                echo=True,
            )
            return

        count_before = layout.count()
        empty_widget = getattr(self, "empty_state_widget", None)
        skip = (empty_widget,) if empty_widget is not None else ()
        clear_layout(layout, skip_widgets=skip)

        self._reply_bubbles_by_message_id.clear()
        self._user_bubbles_by_message_id.clear()
        self._last_rendered_chat_signature = None
        self._last_rendered_session_id = ""
        self._last_chat_bubble_row = None
        self.chat_bottom_spacer_widget = None
        self.chat_bottom_spacer = None

        self._append_log(
            "[CHAT_RENDER][CLEAR] "
            f"layout_count_before={count_before} "
            f"layout_count_after={layout.count()}",
            echo=False,
        )

    def _hide_empty_chat_state(self):
        widget = getattr(self, "empty_state_widget", None)
        if widget is None:
            return
        layout = self._chat_messages_layout()
        if layout is not None and layout.indexOf(widget) >= 0:
            layout.removeWidget(widget)
        widget.hide()
        widget.setVisible(False)

    def _show_empty_chat_state(self):
        layout = self._chat_messages_layout()
        if layout is None:
            return

        self._hide_empty_chat_state()
        self._clear_chat_widgets()

        widget = getattr(self, "empty_state_widget", None)
        if widget is None:
            widget = QLabel("暂无消息")
            widget.setObjectName("ChatEmptyState")
            widget.setAlignment(Qt.AlignCenter)
            self.empty_state_widget = widget

        widget.setMinimumHeight(80)
        widget.setMaximumHeight(120)
        widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

        container = self._chat_messages_container()
        if container is not None and widget.parent() is not container:
            widget.setParent(container)

        layout.setAlignment(Qt.AlignTop)
        layout.addWidget(widget)
        widget.show()
        widget.setVisible(True)

    def _update_chat_empty_state(self, session=None):
        if session is not None:
            visible, _skipped = self._visible_messages_for_render(session)
            self._update_chat_empty_placeholder(len(visible))
            return
        self._hide_empty_chat_state()

    def _update_chat_empty_placeholder(self, message_count: int):
        placeholder = getattr(self, "empty_state_widget", None)
        if placeholder is None:
            return

        visible = message_count <= 0
        placeholder.setVisible(visible)
        if visible:
            placeholder.raise_()
        else:
            placeholder.lower()
            placeholder.hide()

        if message_count > 0 and placeholder.isVisible():
            self._append_log(
                "[CHAT_OVERLAY][BUG_VISIBLE_WITH_MESSAGES] "
                f"message_count={message_count} "
                f"placeholder_visible={placeholder.isVisible()}",
                echo=True,
            )
    def _visible_messages_for_render(self, session):
        visible = [
            message
            for message in session.messages
            if getattr(message, "visible_in_chat", True)
        ]
        if len(visible) <= MAX_RENDER_MESSAGES_ON_SWITCH:
            return visible, 0
        skipped = len(visible) - MAX_RENDER_MESSAGES_ON_SWITCH
        return visible[-MAX_RENDER_MESSAGES_ON_SWITCH:], skipped

    def _session_chat_render_signature(self, session):
        rows = []
        for message in session.messages:
            if not message.visible_in_chat:
                continue
            rows.append((
                message.message_id,
                message.role,
                message.content,
                message.status,
                getattr(message, "detail", "") or "",
            ))
        return tuple(rows)

    def _log_chat_render_session_check(self, session):
        current_id = (getattr(self, "_current_session_id", "") or "").strip()
        render_id = (session.session_id if session else "") or ""
        selected_id = current_id
        session_list = getattr(self, "session_list", None)
        if session_list is not None:
            item = session_list.currentItem()
            if item is not None and hasattr(item, "session_id"):
                selected_id = (item.session_id or "").strip() or selected_id
        self._append_log(
            "[CHAT_RENDER][SESSION_CHECK] "
            f"current_session_id={current_id or '-'} "
            f"render_session_id={render_id or '-'} "
            f"selected_session_id={selected_id or '-'} "
            f"same_current={'true' if render_id == current_id else 'false'}",
            echo=True,
        )

    def _log_chat_render_tab_check(self):
        tab_index = -1
        tab_text = "-"
        chat_tab_index = getattr(self, "CHAT_SUB_TAB_CHAT", 0)
        tabs = getattr(self, "chat_sub_tabs", None)
        if tabs is not None:
            tab_index = int(tabs.currentIndex())
            tab_text = tabs.tabText(tab_index).strip() or "-"
        chat_tab_visible = getattr(self, "chat_tab", None)
        self._append_log(
            "[CHAT_RENDER][TAB_CHECK] "
            f"current_tab_index={tab_index} "
            f"current_tab_text={tab_text} "
            f"chat_tab_index={chat_tab_index} "
            f"chat_tab_widget_visible="
            f"{chat_tab_visible.isVisible() if chat_tab_visible is not None else '-'}",
            echo=True,
        )

    def _log_chat_render_ui_state(self, session, messages, bubble_count):
        layout = self._chat_messages_layout()
        container = self._chat_messages_container()
        scroll = self._chat_primary_scroll_area()
        session_id = session.session_id if session else "-"
        message_count = len(messages or [])
        layout_count = layout.count() if layout is not None else -1
        container_name = container.objectName() if container is not None else "-"
        container_visible = container.isVisible() if container is not None else "-"
        container_parent = (
            type(container.parent()).__name__
            if container is not None and container.parent() is not None
            else "-"
        )
        container_size = "-"
        container_hint = "-"
        if container is not None:
            size = container.size()
            hint = container.sizeHint()
            container_size = f"{size.width()}x{size.height()}"
            container_hint = f"{hint.width()}x{hint.height()}"
        scroll_visible = scroll.isVisible() if scroll is not None else "-"
        scroll_widget = (
            type(scroll.widget()).__name__
            if scroll is not None and scroll.widget() is not None
            else "-"
        )
        scroll_resizable = (
            scroll.widgetResizable() if scroll is not None else "-"
        )
        viewport_size = "-"
        if scroll is not None and scroll.viewport() is not None:
            vp = scroll.viewport().size()
            viewport_size = f"{vp.width()}x{vp.height()}"
        scroll_size = "-"
        if scroll is not None:
            ss = scroll.size()
            scroll_size = f"{ss.width()}x{ss.height()}"
        chat_page_visible = "-"
        chat_tab = getattr(self, "chat_tab", None)
        if chat_tab is not None:
            chat_page_visible = chat_tab.isVisible()
        scroll_widget_is_container = "-"
        if scroll is not None and container is not None:
            scroll_widget_is_container = scroll.widget() is container
        self._append_log(
            "[CHAT_RENDER][UI_STATE] "
            f"session_id={session_id} "
            f"message_count={message_count} "
            f"bubble_count={bubble_count} "
            f"layout_count={layout_count} "
            f"container={container_name} "
            f"container_visible={container_visible} "
            f"container_parent={container_parent} "
            f"container_size={container_size} "
            f"container_hint={container_hint} "
            f"scroll_visible={scroll_visible} "
            f"scroll_size={scroll_size} "
            f"scroll_widget={scroll_widget} "
            f"scroll_widget_is_container={scroll_widget_is_container} "
            f"scroll_resizable={scroll_resizable} "
            f"viewport_size={viewport_size} "
            f"chat_page_visible={chat_page_visible}",
            echo=True,
        )

    def _log_chat_bubble_parent(self, message, row, bubble):
        container = self._chat_messages_container()
        layout = self._chat_messages_layout()
        row_parent = "-"
        bubble_parent = "-"
        if row is not None and row.parent() is not None:
            row_parent = row.parent().objectName() or type(row.parent()).__name__
        if bubble is not None and bubble.parent() is not None:
            bubble_parent = (
                bubble.parent().objectName() or type(bubble.parent()).__name__
            )
        layout_count = layout.count() if layout is not None else -1
        role = getattr(message, "role", None) or "-"
        self._append_log(
            "[CHAT_RENDER][BUBBLE_PARENT] "
            f"role={role} "
            f"row_parent={row_parent} "
            f"bubble_parent={bubble_parent} "
            f"layout_count={layout_count}",
            echo=False,
        )
        expected_name = (
            container.objectName()
            if container is not None
            else "ChatMessagesContainer"
        )
        if container is not None and row is not None and row.parent() is not container:
            self._append_log(
                "[CHAT_RENDER][BUBBLE_PARENT_ERROR] "
                "reason=row_not_attached_to_chat_container "
                f"expected={expected_name or 'ChatMessagesContainer'} "
                f"row_parent={row_parent}",
                echo=True,
            )

    def _log_chat_render_bubble_geometry(self, bubble_count):
        layout = self._chat_messages_layout()
        if layout is None or bubble_count <= 0:
            return
        samples = []
        for index in range(layout.count()):
            item = layout.itemAt(index)
            if item is None:
                continue
            row = item.widget()
            if row is None:
                continue
            if row.objectName() != "ChatBubbleRow":
                continue
            bubble = row.findChild(ChatBubble) or row.findChild(SystemBubble)
            row_size = row.size()
            row_visible = row.isVisible()
            bubble_size = "-"
            bubble_visible = "-"
            if bubble is not None:
                bs = bubble.size()
                bubble_size = f"{bs.width()}x{bs.height()}"
                bubble_visible = bubble.isVisible()
            samples.append(
                f"idx={index} row={row_size.width()}x{row_size.height()} "
                f"row_vis={row_visible} bubble={bubble_size} bubble_vis={bubble_visible}"
            )
            if len(samples) >= 3:
                break
        if samples:
            self._append_log(
                "[CHAT_RENDER][BUBBLE_GEOMETRY] " + " | ".join(samples),
                echo=True,
            )

    def _refresh_chat_messages_layout_geometry(self, *, force_bottom=False):
        container = self._chat_messages_container()
        scroll = self._chat_primary_scroll_area()
        if container is not None:
            container.adjustSize()
            container.updateGeometry()
        if scroll is not None:
            viewport = scroll.viewport()
            if viewport is not None:
                viewport.update()
            scroll.updateGeometry()
        if force_bottom and scroll is not None:
            last_row = getattr(self, "_last_chat_bubble_row", None)
            if last_row is not None:
                schedule_scroll_to_last_row(scroll, last_row, enabled=True)
            else:
                schedule_scroll_to_bottom(scroll, enabled=True)

    def _ensure_chat_bottom_spacer(self):
        layout = self._chat_messages_layout()
        container = self._chat_messages_container()
        if layout is None or container is None:
            return

        widget = getattr(self, "chat_bottom_spacer_widget", None)
        if widget is None:
            widget = QWidget(container)
            widget.setObjectName("ChatBottomSpacer")
            widget.setFixedHeight(8)
            widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
            self.chat_bottom_spacer_widget = widget
            self.chat_bottom_spacer = widget
        elif layout.indexOf(widget) >= 0:
            return

        layout.addWidget(widget)

    def _adjust_chat_history_height_to_content(self):
        scroll = self._chat_primary_scroll_area()
        container = self._chat_messages_container()
        if scroll is None or container is None:
            self._append_log(
                "[CHAT_HEIGHT][SKIP] reason=missing_scroll_or_container",
                echo=True,
            )
            return

        message_count = 0
        session = self._current_session()
        if session is not None:
            messages = getattr(session, "messages", None)
            if isinstance(messages, list):
                message_count = len(messages)

        layout = self._chat_messages_layout()
        content_hint = 0
        if layout is not None:
            margins = layout.contentsMargins()
            content_hint = (
                layout.sizeHint().height()
                + margins.top()
                + margins.bottom()
            )
        container.adjustSize()
        if content_hint <= 0:
            content_hint = container.sizeHint().height()

        min_height = 90
        empty_height = 120
        max_height = 360

        if message_count <= 0:
            target_height = empty_height
        else:
            target_height = content_hint + 16
            if target_height < min_height:
                target_height = min_height
            if target_height > max_height:
                target_height = max_height

        scroll.setMinimumHeight(target_height)
        scroll.setMaximumHeight(target_height)
        scroll.updateGeometry()

        self._append_log(
            "[CHAT_HEIGHT][ADJUST] "
            f"message_count={message_count} "
            f"content_hint={content_hint} "
            f"target_height={target_height}",
            echo=False,
        )

    def _finish_chat_render_layout(self, *, force_bottom=False):
        self._ensure_chat_bottom_spacer()
        self._refresh_chat_messages_layout_geometry(force_bottom=False)
        self._adjust_chat_history_height_to_content()
        if force_bottom:
            self._refresh_chat_messages_layout_geometry(force_bottom=True)
        QTimer.singleShot(0, self._scroll_to_last_chat_message)
        if force_bottom:
            QTimer.singleShot(
                50,
                self._scroll_to_last_chat_message,
            )

    def _render_session_chat(self, session, *, force_bottom=False):
        if session is None:
            self._append_log(
                "[CHAT_RENDER][SKIP] reason=session_is_none",
                echo=True,
            )
            return

        current_id = (getattr(self, "_current_session_id", "") or "").strip()
        if session.session_id != current_id:
            self._append_log(
                "[CHAT_RENDER][SKIP] "
                f"reason=not_current_session "
                f"render_session_id={session.session_id} "
                f"current_session_id={current_id or '-'}",
                echo=True,
            )
            return

        if hasattr(self, "_is_chat_view_visible") and not self._is_chat_view_visible():
            self._pending_chat_render_session_id = session.session_id
            self._append_log(
                "[CHAT_RENDER][DEFER] "
                f"session_id={session.session_id} reason=chat_view_not_visible",
                echo=True,
            )
            return

        self._log_chat_render_session_check(session)
        self._log_chat_render_tab_check()
        self._ensure_chat_scroll_widget_attached()

        t0 = time.perf_counter()
        visible_messages, _skipped = self._visible_messages_for_render(session)
        if not visible_messages:
            self._show_empty_chat_state()
            self._update_chat_empty_placeholder(0)
            self._finish_chat_render_layout(force_bottom=force_bottom)
            self._append_log(
                f"[CHAT_RENDER][EMPTY] session_id={session.session_id}",
                echo=True,
            )
            return

        new_signature = self._session_chat_render_signature(session)
        old_signature = getattr(self, "_last_rendered_chat_signature", None)
        old_session_id = getattr(self, "_last_rendered_session_id", "")
        bubble_count = 0
        if hasattr(self, "_count_visible_chat_bubble_widgets"):
            bubble_count = self._count_visible_chat_bubble_widgets()

        if (
            old_session_id == session.session_id
            and old_signature == new_signature
            and not force_bottom
            and bubble_count >= len(visible_messages)
        ):
            self._hide_empty_chat_state()
            self._adjust_chat_history_height_to_content()
            self._append_log(
                "[CHAT_RENDER][SKIP] "
                f"session_id={session.session_id} "
                f"reason=signature_unchanged count={len(visible_messages)}",
                echo=False,
            )
            return
        if bubble_count <= 0 and len(visible_messages) > 0:
            self._append_log(
                "[CHAT_RENDER][FORCE] "
                f"session_id={session.session_id} "
                f"reason=messages_exist_but_no_bubbles count={len(visible_messages)}",
                echo=True,
            )

        scroll_state = capture_scroll_state(self._chat_primary_scroll_area())

        layout = self._chat_messages_layout()
        widgets = [
            self._chat_primary_scroll_area(),
            self._chat_messages_container(),
        ]

        old_states = []
        for widget in widgets:
            if widget is None:
                continue
            old_states.append((widget, widget.updatesEnabled()))
            widget.setUpdatesEnabled(False)

        bubble_count = 0
        try:
            self._hide_empty_chat_state()
            self._clear_chat_widgets()
            if layout is not None:
                layout.setAlignment(Qt.AlignTop)

            messages = visible_messages
            skipped = _skipped
            if skipped > 0:
                fold_text = f"已折叠较早的 {skipped} 条消息，避免切换卡顿。"
                fold_container = self._chat_messages_container()
                fold_bubble = SystemBubble(fold_text, "", parent=fold_container)
                fold_bubble.setSizePolicy(
                    QSizePolicy.Expanding, QSizePolicy.Minimum
                )
                fold_bubble.setMinimumHeight(32)
                fold_row = create_bubble_row_widget(
                    fold_bubble,
                    "system",
                    spacing=8,
                    parent=fold_container,
                )
                fold_row.setSizePolicy(
                    QSizePolicy.Expanding, QSizePolicy.Minimum
                )
                fold_row.setMinimumHeight(32)
                if self._insert_chat_bubble_row(fold_row):
                    fold_row.show()
                    fold_row.setVisible(True)
                    fold_bubble.show()
                    fold_bubble.setVisible(True)
            for message in messages:
                self._add_bubble_from_message(message, register_only=False)

            if hasattr(self, "_count_visible_chat_bubble_widgets"):
                bubble_count = self._count_visible_chat_bubble_widgets()

            self._last_rendered_chat_signature = new_signature
            self._last_rendered_session_id = session.session_id
        except Exception as error:
            self._append_log(
                "[CHAT_RENDER][ERROR] "
                f"session_id={session.session_id} "
                f"error={error}\n{traceback.format_exc()}",
                echo=True,
            )
            raise
        finally:
            for widget, old_enabled in old_states:
                widget.setUpdatesEnabled(old_enabled)
                widget.update()

        self._update_chat_empty_placeholder(len(visible_messages))
        self._scroll_to_bottom_if_user_was_near_bottom(
            scroll_state,
            force_bottom=force_bottom,
        )
        self._finish_chat_render_layout(force_bottom=force_bottom)

        cost_ms = int((time.perf_counter() - t0) * 1000)
        self._append_log(
            "[CHAT_RENDER][DONE] "
            f"session_id={session.session_id} "
            f"count={len(visible_messages)} "
            f"bubbles={bubble_count} "
            f"cost_ms={cost_ms}",
            echo=True,
        )
        self._log_chat_render_ui_state(session, visible_messages, bubble_count)
        self._log_chat_render_visible_rows(session, visible_messages)
        self._log_chat_render_layout_items()
        self._log_chat_render_row_geometry_detailed(visible_messages)
        self._log_chat_scroll_state()
        self._log_chat_overlay_state(len(visible_messages))
        if bubble_count > 0:
            container = self._chat_messages_container()
            scroll = self._chat_primary_scroll_area()
            suspicious = False
            if container is not None and container.size().height() <= 0:
                suspicious = True
            if scroll is not None and scroll.viewport() is not None:
                if scroll.viewport().size().height() <= 0:
                    suspicious = True
            if scroll is not None and not scroll.isVisible():
                suspicious = True
            if suspicious:
                self._log_chat_render_bubble_geometry(bubble_count)
        if cost_ms >= 30:
            self._append_log(
                f"[CHAT_RENDER][SLOW] session_id={session.session_id} "
                f"messages={len(session.messages)} cost_ms={cost_ms}",
                echo=False,
            )

    def _update_existing_reply_bubble(self, message):
        if not message or not message.message_id:
            return False
        bubble = self._reply_bubbles_by_message_id.get(message.message_id)
        if bubble is None:
            return False
        if message.role == "error":
            bubble.set_error(message.text, message.status)
        else:
            bubble.set_text(message.text, message.status)
        return True
    def _scroll_to_last_chat_message(self):
        scroll = self._chat_primary_scroll_area()
        row = getattr(self, "_last_chat_bubble_row", None)
        if scroll is None:
            self._append_log(
                "[CHAT_SCROLL][SKIP] reason=missing_scroll_area",
                echo=False,
            )
            return
        if row is None:
            self._append_log(
                "[CHAT_SCROLL][SKIP] reason=no_last_bubble_row",
                echo=False,
            )
            return
        if not row.isVisible():
            self._append_log(
                "[CHAT_SCROLL][WARN] reason=last_row_not_visible",
                echo=True,
            )
            return

        scroll.ensureWidgetVisible(row, 0, 8)
        bar = scroll.verticalScrollBar()
        bar_info = "-"
        if bar is not None:
            bar_info = f"value={bar.value()} max={bar.maximum()} page={bar.pageStep()}"
        geo = row.geometry()
        vp = scroll.viewport()
        vp_size = (
            f"{vp.width()}x{vp.height()}" if vp is not None else "-"
        )
        self._append_log(
            "[CHAT_SCROLL][LAST_ROW] "
            f"{bar_info} "
            f"row_geo={geo.x()},{geo.y()},{geo.width()}x{geo.height()} "
            f"viewport={vp_size}",
            echo=True,
        )

    def _log_chat_scroll_state(self):
        scroll = self._chat_primary_scroll_area()
        container = self._chat_messages_container()
        if scroll is None:
            return
        bar = scroll.verticalScrollBar()
        vp = scroll.viewport()
        bar_value = bar.value() if bar is not None else -1
        bar_max = bar.maximum() if bar is not None else -1
        bar_page = bar.pageStep() if bar is not None else -1
        vp_size = f"{vp.width()}x{vp.height()}" if vp is not None else "-"
        container_size = "-"
        if container is not None:
            cs = container.size()
            container_size = f"{cs.width()}x{cs.height()}"
        self._append_log(
            "[CHAT_SCROLL][STATE] "
            f"value={bar_value} max={bar_max} pageStep={bar_page} "
            f"viewport={vp_size} container={container_size}",
            echo=True,
        )

    def _log_chat_overlay_state(self, message_count: int):
        placeholder = getattr(self, "empty_state_widget", None)
        scroll = self._chat_primary_scroll_area()
        if placeholder is None:
            return
        geo = placeholder.geometry()
        parent_name = "-"
        if placeholder.parent() is not None:
            parent_name = (
                placeholder.parent().objectName()
                or type(placeholder.parent()).__name__
            )
        covers_messages = False
        if scroll is not None and placeholder.isVisible() and message_count > 0:
            covers_messages = True
        ancestor = False
        container = self._chat_messages_container()
        if container is not None and scroll is not None:
            ancestor = placeholder.isAncestorOf(container)
        self._append_log(
            "[CHAT_OVERLAY][STATE] "
            f"placeholder_visible={placeholder.isVisible()} "
            f"message_count={message_count} "
            f"geometry={geo.x()},{geo.y()},{geo.width()}x{geo.height()} "
            f"parent={parent_name} "
            f"is_ancestor_of_container={ancestor} "
            f"covers_messages={covers_messages}",
            echo=True,
        )

    def _log_chat_render_visible_rows(self, session, messages):
        layout = self._chat_messages_layout()
        if layout is None:
            return
        session_id = session.session_id if session else "-"
        visible_rows = 0
        hidden_rows = 0
        for index in range(layout.count()):
            item = layout.itemAt(index)
            widget = item.widget() if item else None
            if widget is None:
                continue
            if widget.isVisible():
                visible_rows += 1
            else:
                hidden_rows += 1
        self._append_log(
            "[CHAT_RENDER][VISIBLE_ROWS] "
            f"session_id={session_id} "
            f"message_count={len(messages or [])} "
            f"layout_count={layout.count()} "
            f"visible_rows={visible_rows} "
            f"hidden_rows={hidden_rows}",
            echo=True,
        )

    def _log_chat_render_layout_items(self):
        layout = self._chat_messages_layout()
        if layout is None:
            return

        items = []
        for index in range(layout.count()):
            item = layout.itemAt(index)
            if item is None:
                continue

            widget = item.widget()
            if widget is not None:
                items.append(
                    f"{index}:{type(widget).__name__}:{widget.objectName() or '-'}:"
                    f"visible={widget.isVisible()}:"
                    f"h={widget.height()}:"
                    f"hint={widget.sizeHint().height()}"
                )
            elif item.spacerItem() is not None:
                items.append(f"{index}:SPACER")

        self._append_log(
            "[CHAT_RENDER][LAYOUT_ITEMS] " + " | ".join(items[:40]),
            echo=True,
        )

    def _log_chat_render_row_geometry(self):
        layout = self._chat_messages_layout()
        if layout is None:
            return
        for index in range(min(3, layout.count())):
            item = layout.itemAt(index)
            widget = item.widget() if item else None
            if widget is None:
                continue
            hint = widget.sizeHint()
            self._append_log(
                "[CHAT_RENDER][ROW_GEOMETRY] "
                f"index={index} "
                f"class={type(widget).__name__} "
                f"object={widget.objectName() or '-'} "
                f"visible={widget.isVisible()} "
                f"size={widget.size().width()}x{widget.size().height()} "
                f"hint={hint.width()}x{hint.height()} "
                f"parent={type(widget.parent()).__name__ if widget.parent() else '-'}",
                echo=False,
            )

    def _log_chat_render_row_geometry_detailed(self, messages):
        layout = self._chat_messages_layout()
        scroll = self._chat_primary_scroll_area()
        if layout is None:
            return

        vp = scroll.viewport() if scroll is not None else None
        bar = scroll.verticalScrollBar() if scroll is not None else None
        scroll_value = int(bar.value()) if bar is not None else 0
        vp_height = int(vp.height()) if vp is not None else 0
        visible_top = scroll_value
        visible_bottom = scroll_value + vp_height

        bubble_indices = []
        for index in range(layout.count()):
            item = layout.itemAt(index)
            if item is None:
                continue
            row = item.widget()
            if row is None or row.objectName() != "ChatBubbleRow":
                continue
            bubble_indices.append((index, row))

        if not bubble_indices:
            return

        sample_indices = {0, len(bubble_indices) - 1}
        if len(bubble_indices) > 2:
            sample_indices.add(len(bubble_indices) // 2)

        msg_by_index = list(messages or [])
        for sample_pos in sorted(sample_indices):
            if sample_pos < 0 or sample_pos >= len(bubble_indices):
                continue
            layout_index, row = bubble_indices[sample_pos]
            bubble = row.findChild(ChatBubble) or row.findChild(SystemBubble)
            role = "-"
            if sample_pos < len(msg_by_index):
                role = getattr(msg_by_index[sample_pos], "role", None) or "-"
            row_geo = row.geometry()
            bubble_geo = "-"
            if bubble is not None:
                bg = bubble.geometry()
                bubble_geo = f"{bg.x()},{bg.y()},{bg.width()}x{bg.height()}"
            self._append_log(
                "[CHAT_RENDER][ROW_GEOMETRY] "
                f"index={layout_index} role={role} "
                f"row_visible={row.isVisible()} "
                f"row_geo={row_geo.x()},{row_geo.y()},"
                f"{row_geo.width()}x{row_geo.height()} "
                f"bubble_geo={bubble_geo}",
                echo=True,
            )
            row_top = row_geo.y()
            row_bottom = row_top + row_geo.height()
            if (
                vp is not None
                and row.isVisible()
                and row_geo.height() > 0
                and (row_bottom < visible_top or row_top > visible_bottom)
            ):
                self._append_log(
                    "[CHAT_RENDER][SUSPECT_OFFSCREEN] "
                    f"index={layout_index} role={role} "
                    f"row_top={row_top} row_bottom={row_bottom} "
                    f"visible_top={visible_top} visible_bottom={visible_bottom}",
                    echo=True,
                )

    def _insert_chat_bubble_row(self, row):
        layout = self._chat_messages_layout()
        container = self._chat_messages_container()

        if layout is None:
            self._append_log(
                "[CHAT_RENDER][INSERT_SKIP] reason=missing_layout",
                echo=True,
            )
            return False

        if container is None:
            self._append_log(
                "[CHAT_RENDER][INSERT_SKIP] reason=missing_container",
                echo=True,
            )
            return False

        if row is None:
            self._append_log(
                "[CHAT_RENDER][INSERT_SKIP] reason=row_none",
                echo=True,
            )
            return False

        if row.parent() is not container:
            row.setParent(container)

        layout.addWidget(row)
        self._last_chat_bubble_row = row

        self._append_log(
            "[CHAT_RENDER][INSERT_ROW] "
            f"row_parent={type(row.parent()).__name__ if row.parent() else '-'} "
            f"row_visible={row.isVisible()} "
            f"layout_count={layout.count()}",
            echo=False,
        )

        return True

    def _add_bubble_from_message(self, message, register_only=False):
        container = self._chat_messages_container()
        ts_text = self._format_message_ts(message.created_at)
        if container is None:
            self._append_log(
                "[CHAT_RENDER][SKIP] reason=missing_chat_container "
                f"message_id={message.message_id or '-'}",
                echo=True,
            )
            return None

        if message.role == "system":
            bubble = SystemBubble(message.text, ts_text, parent=container)
        else:
            display_status = message.status or ""
            msg_detail = (getattr(message, "detail", "") or "").strip()
            if msg_detail:
                display_status = (
                    f"{display_status} ({msg_detail})"
                    if display_status
                    else msg_detail
                )
            bubble = ChatBubble(
                message.role,
                message.text,
                ts_text,
                display_status,
                body_pt=self._chat_font_pt,
                parent=container,
            )

        bubble.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        bubble.setMinimumHeight(32)
        if hasattr(bubble, "body_label") and bubble.body_label is not None:
            bubble.body_label.setWordWrap(True)
            bubble.body_label.setTextInteractionFlags(
                Qt.TextSelectableByMouse
            )
            bubble.body_label.setSizePolicy(
                QSizePolicy.Expanding, QSizePolicy.Minimum
            )
            bubble.body_label.setMinimumHeight(20)

        bubble.setVisible(False)

        row = create_bubble_row_widget(
            bubble,
            message.role,
            spacing=8,
            parent=container,
        )
        row.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        row.setMinimumHeight(32)

        inserted = self._insert_chat_bubble_row(row)
        if inserted:
            row.show()
            row.setVisible(True)
            bubble.show()
            bubble.setVisible(True)
            self._log_chat_bubble_parent(message, row, bubble)
        else:
            row.hide()
            row.setVisible(False)
            bubble.hide()
            bubble.setVisible(False)
            row.deleteLater()
            self._append_log(
                "[CHAT_RENDER][INSERT_FAILED] "
                f"role={message.role or '-'} "
                f"message_id={message.message_id or '-'}",
                echo=True,
            )
            return None

        if message.message_id:
            if message.role == "user":
                self._user_bubbles_by_message_id[message.message_id] = bubble
            elif message.role in ("assistant", "error"):
                self._reply_bubbles_by_message_id[message.message_id] = bubble
        if not register_only:
            self._hide_empty_chat_state()
            session = self._current_session()
            msg_count = len(session.messages) if session is not None else 1
            self._update_chat_empty_placeholder(msg_count)
            QTimer.singleShot(0, self._scroll_to_last_chat_message)
        return bubble
    def _add_system_message(self, text):
        text = (text or "").strip()
        if not text:
            return
        now = time.time()
        last_text = (getattr(self, "_last_system_message_text", "") or "").strip()
        last_at = float(getattr(self, "_last_system_message_at", 0) or 0)
        if last_text == text and (now - last_at) < 5.0:
            return
        self._last_system_message_text = text
        self._last_system_message_at = now
        session = self._ensure_current_session()
        self._append_session_message(session, "system", text)
        if session.session_id == self._current_session_id:
            scroll_state = capture_scroll_state(self._chat_primary_scroll_area())
            self._add_bubble_from_message(session.messages[-1])
            self._scroll_to_bottom_if_user_was_near_bottom(scroll_state)
        self._refresh_session_list(select_session_id=session.session_id)
        self._save_sessions_to_disk()
    def _add_system_message_once(self, text, dedupe_seconds=10):
        text = (text or "").strip()
        if not text:
            return
        now = time.time()
        key = (getattr(self, "_current_session_id", "") or "", text)
        cache = getattr(self, "_system_message_once_cache", None)
        if not isinstance(cache, dict):
            cache = {}
            self._system_message_once_cache = cache
        last_at = float(cache.get(key) or 0)
        if (now - last_at) < max(0.0, float(dedupe_seconds or 0)):
            return
        cache[key] = now
        self._add_system_message(text)
    def _scroll_to_bottom(self):
        scroll = self._chat_primary_scroll_area()
        last_row = getattr(self, "_last_chat_bubble_row", None)
        if last_row is not None:
            schedule_scroll_to_last_row(
                scroll,
                last_row,
                enabled=self._auto_scroll_to_bottom,
            )
            return
        schedule_scroll_to_bottom(
            scroll,
            enabled=self._auto_scroll_to_bottom,
        )

    def _scroll_to_bottom_if_user_was_near_bottom(self, scroll_state, *, force_bottom=False):
        schedule_scroll_to_bottom_if_needed(
            self._chat_primary_scroll_area(),
            scroll_state,
            enabled=self._auto_scroll_to_bottom,
            force_bottom=force_bottom,
            last_row=getattr(self, "_last_chat_bubble_row", None),
        )
    def _last_assistant_text(self, session=None):
        session = session or self._current_session()
        if not session:
            return ""
        for message in reversed(session.messages):
            if message.role == "assistant" and message.text.strip():
                if message.content.strip() not in ASSISTANT_WAIT_TEXTS:
                    return message.content.strip()
        return ""
    def _log_chat_update_assistant(
        self, session, turn_id, status, text_len, message_id=""
    ):
        self._append_log(
            "[GUI][CHAT][UPDATE_ASSISTANT] "
            f"session_id={session.session_id} turn_id={turn_id} "
            f"message_id={message_id or '-'} status={status} text_len={text_len}"
        )

    def _update_session_assistant(
        self, session, turn_id, text=None, status=None, role=None, error=False
    ):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        if text is not None:
            target.content = text
        if status is not None:
            target.status = status
        if role is not None:
            target.role = role
        if error:
            target.role = "error"
        session.updated_at = time.time()
        return True

    def _apply_reply_ui_change(self, session, target):
        scroll_state = capture_scroll_state(self._chat_primary_scroll_area())

        if session.session_id == self._current_session_id:
            updated = self._update_existing_reply_bubble(target)
            if not updated:
                if hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="reply_bubble_missing_full_render",
                    )
                else:
                    self._render_session_chat(session, force_bottom=True)
            else:
                sig = self._session_chat_render_signature(session)
                self._last_rendered_chat_signature = sig
                self._last_rendered_session_id = session.session_id
                self._scroll_to_bottom_if_user_was_near_bottom(scroll_state)
                if hasattr(self, "_render_current_chat_messages"):
                    self._render_current_chat_messages(
                        force_bottom=True,
                        reason="reply_bubble_updated_refresh",
                    )
        else:
            self._mark_session_pending(session.session_id)

        self._refresh_session_list(select_session_id=self._current_session_id)
        self._save_sessions_to_disk()
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()

    def _set_reply_text(self, session, turn_id, text, status_text="已回复"):
        target = self._find_assistant_by_turn(session, turn_id)
        if not self._update_session_assistant(
            session, turn_id, text=text, status=status_text, role="assistant"
        ):
            return
        msg_id = target.message_id if target else ""
        self._log_chat_update_assistant(
            session, turn_id, status_text, len(text or ""), msg_id
        )
        self._apply_reply_ui_change(session, target)

    def _set_reply_error(self, session, turn_id, text, status_text="失败"):
        target = self._find_assistant_by_turn(session, turn_id)
        if not self._update_session_assistant(
            session,
            turn_id,
            text=text,
            status=status_text,
            role="error",
            error=True,
        ):
            return
        msg_id = target.message_id if target else ""
        self._log_chat_update_assistant(
            session, turn_id, status_text, len(text or ""), msg_id
        )
        self._apply_reply_ui_change(session, target)
    def _set_reply_waiting(self, session, turn_id):
        target = self._find_assistant_by_turn(session, turn_id)
        if target is None:
            return False
        target.role = "assistant"
        target.content = ASSISTANT_WAIT_TEXT
        target.status = "等待中"
        session.updated_at = time.time()
        if session.session_id == self._current_session_id:
            bubble = self._reply_bubbles_by_message_id.get(target.message_id)
            if bubble is not None:
                if bubble.role == "error":
                    bubble.role = "assistant"
                    bubble._apply_style()
                bubble.set_text(ASSISTANT_WAIT_TEXT, "等待中")
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._save_sessions_to_disk()
        return True
