from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QFrame, QHBoxLayout, QLabel, QSizePolicy, QVBoxLayout, QWidget

from app.constants import SESSION_BIND_LIST_STYLES
from app.ui.widgets.elided_label import ElidedLabel

SESSION_LIST_ITEM_HEIGHT = 94
SESSION_LIST_ITEM_MIN_HEIGHT = 88
SESSION_LIST_ITEM_MAX_HEIGHT = 110
SESSION_LIST_ITEM_RADIUS = 8

_CURRENT_BADGE_STYLE = """
QLabel#CurrentSessionBadge {
    color: #ffffff;
    background: #2563eb;
    border-radius: 6px;
    padding: 1px 6px;
    font-size: 11px;
    font-weight: 600;
    min-width: 30px;
    max-width: 42px;
}
"""

_CURRENT_BORDER = "#2563eb"


class SessionListItemWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("SessionListItem")
        self.setMinimumWidth(0)
        self.setMaximumWidth(16777215)
        self.setMinimumHeight(SESSION_LIST_ITEM_MIN_HEIGHT)
        self.setMaximumHeight(SESSION_LIST_ITEM_MAX_HEIGHT)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)

        root = QHBoxLayout(self)
        root.setContentsMargins(2, 3, 6, 3)
        root.setSpacing(0)

        self.left_bar = QFrame()
        self.left_bar.setObjectName("SessionListLeftBar")
        self.left_bar.setFixedWidth(4)
        self.left_bar.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Expanding)

        self.card = QFrame()
        self.card.setObjectName("SessionCard")
        self.card.setMinimumWidth(0)
        self.card.setMaximumWidth(16777215)
        self.card.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

        root.addWidget(self.left_bar)
        root.addWidget(self.card, stretch=1)

        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(10, 8, 14, 8)
        card_layout.setSpacing(3)

        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title_row.setSpacing(6)

        self.title_label = ElidedLabel()
        self.title_label.setObjectName("SessionItemTitle")
        self.title_label.setMinimumHeight(22)
        title_row.addWidget(self.title_label, stretch=1)

        self.pending_dot = QLabel()
        self.pending_dot.setObjectName("SessionPendingDot")
        self.pending_dot.setAlignment(Qt.AlignCenter)
        self.pending_dot.setFixedSize(14, 20)
        title_row.addWidget(self.pending_dot, alignment=Qt.AlignVCenter)

        self.current_badge = QLabel("当前")
        self.current_badge.setObjectName("CurrentSessionBadge")
        self.current_badge.setAlignment(Qt.AlignCenter)
        self.current_badge.setMinimumHeight(20)
        self.current_badge.setMinimumWidth(30)
        self.current_badge.setMaximumWidth(42)
        self.current_badge.setVisible(False)
        title_row.addWidget(self.current_badge, 0, Qt.AlignRight | Qt.AlignTop)

        self.subtitle_label = ElidedLabel()
        self.subtitle_label.setObjectName("SessionItemSubtitle")
        self.subtitle_label.setMinimumHeight(18)

        self.status_label = ElidedLabel()
        self.status_label.setObjectName("SessionBindStatusLabel")
        self.status_label.setMinimumHeight(18)

        card_layout.addLayout(title_row)
        card_layout.addWidget(self.subtitle_label)
        card_layout.addWidget(self.status_label)

        self._last_style_key = None
        self._last_apply_state = None
        self._make_children_mouse_transparent()

    def _make_children_mouse_transparent(self):
        for child in self.findChildren(QWidget):
            child.setAttribute(Qt.WA_TransparentForMouseEvents, True)

    def _sync_current_badge(self, is_current):
        self.current_badge.setVisible(bool(is_current))
        if is_current:
            self.current_badge.setStyleSheet(_CURRENT_BADGE_STYLE)

    def _sync_current_card_property(self, is_current):
        self.card.setProperty("isCurrentSession", "true" if is_current else "false")
        style = self.card.style()
        if style is not None:
            style.unpolish(self.card)
            style.polish(self.card)

    def _sync_session_state_property(self, bind_state):
        bind_state = bind_state if bind_state in SESSION_BIND_LIST_STYLES else "unbound"
        self.card.setProperty("sessionState", bind_state)
        style = self.card.style()
        if style is not None:
            style.unpolish(self.card)
            style.polish(self.card)

    def _reapply_visual_from_state(self):
        state = getattr(self, "_last_apply_state", None)
        if not isinstance(state, dict):
            return False
        bind_state = state.get("bind_state", "unbound")
        style = SESSION_BIND_LIST_STYLES.get(
            bind_state, SESSION_BIND_LIST_STYLES["unbound"]
        )
        self._apply_selection_visual_style(
            selected=bool(state.get("selected")),
            is_current=bool(state.get("is_current")),
            bind_state=bind_state,
            left_color=style.get("left") or "#9ca3af",
            border_color=style.get("border") or "#d1d5db",
            background_color=style.get("bg") or "#f9fafb",
            selected_border=style.get("selected_border") or style.get("border") or "#d1d5db",
        )
        return True

    def _apply_selection_visual_style(
        self,
        *,
        selected,
        is_current,
        bind_state="unbound",
        left_color,
        border_color,
        background_color,
        selected_border,
    ):
        is_current = bool(is_current)
        selected = bool(selected)
        bind_state = bind_state if bind_state in SESSION_BIND_LIST_STYLES else "unbound"

        self._sync_current_badge(is_current)
        self._sync_current_card_property(is_current)
        self._sync_session_state_property(bind_state)

        bar_color = left_color
        card_bg = background_color
        card_border = selected_border if selected else border_color
        border_width = 1
        bar_width = 5 if selected else 4

        self.left_bar.show()
        self.left_bar.setFixedWidth(bar_width)
        self.left_bar.setStyleSheet(
            f"""
            QFrame#SessionListLeftBar {{
                background: {bar_color};
                border: none;
                border-top-left-radius: {SESSION_LIST_ITEM_RADIUS}px;
                border-bottom-left-radius: {SESSION_LIST_ITEM_RADIUS}px;
            }}
            """
        )

        if is_current:
            self.card.setStyleSheet(
                f"""
                QFrame#SessionCard {{
                    background: {card_bg};
                    border-top: 2px solid {_CURRENT_BORDER};
                    border-right: 2px solid {_CURRENT_BORDER};
                    border-bottom: 2px solid {_CURRENT_BORDER};
                    border-left: none;
                    border-radius: {SESSION_LIST_ITEM_RADIUS}px;
                }}
                """
            )
            title_weight = 700
        else:
            self.card.setStyleSheet(
                f"""
                QFrame#SessionCard {{
                    background: {card_bg};
                    border: {border_width}px solid {card_border};
                    border-radius: {SESSION_LIST_ITEM_RADIUS}px;
                }}
                """
            )
            title_weight = 700 if selected else 600

        self.title_label.setStyleSheet(
            f"""
            QLabel#SessionItemTitle {{
                font-weight: {title_weight};
                color: #111827;
                font-size: 14px;
                background: transparent;
            }}
            """
        )

    def set_is_current_fast(self, is_current):
        """仅刷新「当前」角标与卡片高亮，与绑定/在线/等待状态无关。"""
        is_current = bool(is_current)
        state = getattr(self, "_last_apply_state", None)
        if not isinstance(state, dict):
            return False
        old_current = bool(state.get("is_current"))
        state["is_current"] = is_current
        if old_current == is_current:
            self._sync_current_badge(is_current)
            return True

        self._last_apply_state_key = None
        self._reapply_visual_from_state()
        self.card.update()
        self.left_bar.update()
        self.current_badge.update()
        self.update()
        return True

    def set_selected_fast(self, selected, *, is_current=None):
        state = getattr(self, "_last_apply_state", None)
        if not isinstance(state, dict):
            return False

        selected = bool(selected)
        if is_current is None:
            is_current = bool(state.get("is_current"))
        else:
            is_current = bool(is_current)

        old_selected = bool(state.get("selected"))
        old_current = bool(state.get("is_current"))
        if old_selected == selected and old_current == is_current:
            self._sync_current_badge(is_current)
            return True

        state["selected"] = selected
        state["is_current"] = is_current
        self._last_apply_state_key = None
        self._reapply_visual_from_state()
        self.card.update()
        self.left_bar.update()
        self.current_badge.update()
        self.update()
        return True

    def apply_state(
        self,
        *,
        title,
        subtitle,
        bind_state,
        pending_reply=False,
        selected=False,
        is_current=None,
        tooltip="",
        status_text=None,
    ):
        style = SESSION_BIND_LIST_STYLES.get(
            bind_state, SESSION_BIND_LIST_STYLES["unbound"]
        )
        bind_state = bind_state if bind_state in SESSION_BIND_LIST_STYLES else "unbound"
        if is_current is None:
            is_current = False

        self._last_apply_state = {
            "title": title,
            "subtitle": subtitle,
            "bind_state": bind_state,
            "pending_reply": pending_reply,
            "selected": selected,
            "is_current": is_current,
            "tooltip": tooltip,
        }

        subtitle = (subtitle or "").replace("\n", " ")
        title_text = title or "新对话"
        display_status_text = (
            status_text if status_text is not None else style["label"]
        )
        tooltip_text = tooltip or ""

        self._sync_current_badge(is_current)

        state_key = (
            title_text,
            subtitle,
            bind_state,
            bool(pending_reply),
            bool(is_current),
            bool(selected),
            tooltip_text,
            display_status_text,
        )
        if getattr(self, "_last_apply_state_key", None) == state_key:
            return
        self._last_apply_state_key = state_key

        self.title_label.setText(title_text)
        self.subtitle_label.setText(subtitle)
        self.status_label.setText(display_status_text)

        self.pending_dot.setText("●" if pending_reply else "")
        self.pending_dot.setVisible(bool(pending_reply))

        self.setToolTip(tooltip_text)

        style_key = (bind_state, bool(selected), bool(pending_reply), bool(is_current))
        if style_key == getattr(self, "_last_style_key", None):
            self.update()
            return

        self._last_style_key = style_key

        self._apply_selection_visual_style(
            selected=selected,
            is_current=is_current,
            bind_state=bind_state,
            left_color=style["left"],
            border_color=style["border"],
            background_color=style["bg"],
            selected_border=style["selected_border"],
        )

        self.status_label.setStyleSheet(
            f"""
            QLabel#SessionBindStatusLabel {{
                color: {style["text"]};
                font-size: 11px;
                background: rgba(255, 255, 255, 0.45);
                border-radius: 6px;
                padding: 2px 6px;
                border: none;
            }}
            """
        )

        self.subtitle_label.setStyleSheet(
            """
            QLabel#SessionItemSubtitle {
                color: #6b7280;
                font-size: 12px;
                background: transparent;
            }
            """
        )

        if pending_reply:
            self.pending_dot.setStyleSheet(
                """
                QLabel#SessionPendingDot {
                    color: #2563eb;
                    font-size: 14px;
                    background: transparent;
                }
                """
            )
        else:
            self.pending_dot.setStyleSheet(
                """
                QLabel#SessionPendingDot {
                    color: transparent;
                    font-size: 14px;
                    background: transparent;
                }
                """
            )

        self.update()
