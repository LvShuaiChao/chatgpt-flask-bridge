from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QFrame, QHBoxLayout, QLabel, QSizePolicy, QVBoxLayout, QWidget

from app.constants import SESSION_BIND_LIST_STYLES
from app.ui.widgets.elided_label import ElidedLabel

SESSION_LIST_ITEM_HEIGHT = 80
SESSION_LIST_ITEM_MIN_HEIGHT = 74
SESSION_LIST_ITEM_MAX_HEIGHT = 92
SESSION_LIST_ITEM_RADIUS = 8
SESSION_CARD_MAX_WIDTH = 240


def _hex_to_rgb_triplet(hex_color: str) -> tuple[int, int, int]:
    h = (hex_color or "").strip().lstrip("#")
    if len(h) != 6:
        return 156, 163, 175
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


class SessionListItemWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("SessionListItem")
        self.setMinimumWidth(0)
        self.setMaximumWidth(SESSION_CARD_MAX_WIDTH + 12)
        self.setMinimumHeight(SESSION_LIST_ITEM_MIN_HEIGHT)
        self.setMaximumHeight(SESSION_LIST_ITEM_MAX_HEIGHT)
        self.setFixedHeight(SESSION_LIST_ITEM_HEIGHT)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

        root = QHBoxLayout(self)
        root.setContentsMargins(2, 2, 2, 2)
        root.setSpacing(0)

        self.left_bar = QFrame()
        self.left_bar.setObjectName("SessionListLeftBar")
        self.left_bar.setFixedWidth(4)
        self.left_bar.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Expanding)

        self.card = QFrame()
        self.card.setObjectName("SessionCard")
        self.card.setMinimumWidth(0)
        self.card.setMaximumWidth(SESSION_CARD_MAX_WIDTH)
        self.card.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

        root.addWidget(self.left_bar)
        root.addWidget(self.card, stretch=1)

        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(8, 6, 8, 6)
        card_layout.setSpacing(2)

        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title_row.setSpacing(4)

        self.title_label = ElidedLabel()
        self.title_label.setObjectName("SessionItemTitle")
        self.title_label.setFixedHeight(20)
        title_row.addWidget(self.title_label, stretch=1)

        self.pending_dot = QLabel()
        self.pending_dot.setObjectName("SessionPendingDot")
        self.pending_dot.setAlignment(Qt.AlignCenter)
        self.pending_dot.setFixedSize(14, 20)
        title_row.addWidget(self.pending_dot, alignment=Qt.AlignVCenter)

        self.current_badge = QLabel("当前")
        self.current_badge.setObjectName("SessionCurrentBadge")
        self.current_badge.setAlignment(Qt.AlignCenter)
        self.current_badge.setFixedHeight(20)
        self.current_badge.setMinimumWidth(34)
        self.current_badge.setVisible(False)
        title_row.addWidget(self.current_badge, 0, Qt.AlignVCenter)

        self.subtitle_label = ElidedLabel()
        self.subtitle_label.setObjectName("SessionItemSubtitle")
        self.subtitle_label.setFixedHeight(18)

        self.status_label = ElidedLabel()
        self.status_label.setObjectName("SessionBindStatusLabel")
        self.status_label.setFixedHeight(18)

        card_layout.addLayout(title_row)
        card_layout.addWidget(self.subtitle_label)
        card_layout.addWidget(self.status_label)

        self._last_style_key = None
        self._last_apply_state = None
        self._make_children_mouse_transparent()

    def _make_children_mouse_transparent(self):
        for child in self.findChildren(QWidget):
            child.setAttribute(Qt.WA_TransparentForMouseEvents, True)

    def _apply_selection_visual_style(
        self,
        *,
        selected,
        left_color,
        border_color,
        background_color,
        selected_border,
    ):
        self.current_badge.setVisible(bool(selected))
        self.left_bar.setFixedWidth(5 if selected else 4)

        self.left_bar.setStyleSheet(
            f"""
            QFrame#SessionListLeftBar {{
                background: {left_color};
                border: none;
                border-top-left-radius: {SESSION_LIST_ITEM_RADIUS}px;
                border-bottom-left-radius: {SESSION_LIST_ITEM_RADIUS}px;
            }}
            """
        )

        border_width = 2 if selected else 1
        self.card.setStyleSheet(
            f"""
            QFrame#SessionCard {{
                background: {background_color};
                border: {border_width}px solid {border_color};
                border-radius: {SESSION_LIST_ITEM_RADIUS}px;
            }}
            """
        )

        if selected:
            r, g, b = _hex_to_rgb_triplet(left_color)
            self.current_badge.setStyleSheet(
                f"""
                QLabel#SessionCurrentBadge {{
                    font-size: 10px;
                    font-weight: 600;
                    color: {selected_border};
                    background: rgba({r}, {g}, {b}, 0.18);
                    border: 1px solid {selected_border};
                    border-radius: 4px;
                    padding: 1px 6px;
                }}
                """
            )
            title_weight = 700
        else:
            self.current_badge.setStyleSheet(
                """
                QLabel#SessionCurrentBadge {
                    font-size: 10px;
                    font-weight: 600;
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 4px;
                    padding: 1px 6px;
                }
                """
            )
            title_weight = 600

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

    def set_selected_fast(self, selected):
        state = getattr(self, "_last_apply_state", None)
        if not isinstance(state, dict):
            return False

        selected = bool(selected)
        old_selected = bool(state.get("selected"))
        if old_selected == selected:
            return True

        state["selected"] = selected

        bind_state = state.get("bind_state", "unbound")
        style = SESSION_BIND_LIST_STYLES.get(
            bind_state, SESSION_BIND_LIST_STYLES["unbound"]
        )

        left_color = style.get("left") or "#9ca3af"
        border_color = style.get("border") or "#d1d5db"
        background_color = style.get("bg") or "#f9fafb"
        sel_border = style.get("selected_border") or border_color

        self._apply_selection_visual_style(
            selected=selected,
            left_color=left_color,
            border_color=border_color,
            background_color=background_color,
            selected_border=sel_border,
        )

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
        tooltip="",
    ):
        style = SESSION_BIND_LIST_STYLES.get(
            bind_state, SESSION_BIND_LIST_STYLES["unbound"]
        )
        bind_state = bind_state if bind_state in SESSION_BIND_LIST_STYLES else "unbound"

        self._last_apply_state = {
            "title": title,
            "subtitle": subtitle,
            "bind_state": bind_state,
            "pending_reply": pending_reply,
            "selected": selected,
            "tooltip": tooltip,
        }

        subtitle = (subtitle or "").replace("\n", " ")
        title_text = title or "新对话"
        status_text = style["label"]
        tooltip_text = tooltip or ""

        state_key = (
            title_text,
            subtitle,
            bind_state,
            bool(pending_reply),
            bool(selected),
            tooltip_text,
            status_text,
        )
        if getattr(self, "_last_apply_state_key", None) == state_key:
            return
        self._last_apply_state_key = state_key

        self.title_label.setText(title_text)
        self.subtitle_label.setText(subtitle)
        self.status_label.setText(status_text)

        self.pending_dot.setText("●" if pending_reply else "")
        self.pending_dot.setVisible(bool(pending_reply))
        self.current_badge.setVisible(bool(selected))

        self.setToolTip(tooltip_text)

        style_key = (bind_state, bool(selected), bool(pending_reply))
        if style_key == getattr(self, "_last_style_key", None):
            self.update()
            return

        self._last_style_key = style_key

        bg = style["bg"]
        border = style["border"]
        left = style["left"]
        sel_border = style["selected_border"]
        text_color = style["text"]

        self._apply_selection_visual_style(
            selected=selected,
            left_color=left,
            border_color=border,
            background_color=bg,
            selected_border=sel_border,
        )

        self.status_label.setStyleSheet(
            f"""
            QLabel#SessionBindStatusLabel {{
                color: {text_color};
                font-size: 11px;
                background: rgba(255, 255, 255, 0.45);
                border-radius: 6px;
                padding: 1px 6px;
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
