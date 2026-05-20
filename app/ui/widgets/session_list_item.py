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


def _refresh_widget_style(widget):
    widget.style().unpolish(widget)
    widget.style().polish(widget)
    widget.update()


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

        if selected:
            bg = "#ecfdf5"
            border = "#86efac"
            left = "#22c55e"
            sel_border = "#22c55e"

        r, g, b = _hex_to_rgb_triplet(left)

        self.card.setProperty("currentSession", bool(selected))
        self.card.setProperty("bindState", bind_state)
        _refresh_widget_style(self.card)

        self.left_bar.setProperty("currentSession", bool(selected))
        _refresh_widget_style(self.left_bar)

        bar_width = 5 if selected else 4
        self.left_bar.setFixedWidth(bar_width)
        self.left_bar.setStyleSheet(
            f"""
            QFrame#SessionListLeftBar {{
                background: {left};
                border: none;
                border-top-left-radius: {SESSION_LIST_ITEM_RADIUS}px;
                border-bottom-left-radius: {SESSION_LIST_ITEM_RADIUS}px;
            }}
            """
        )

        if not selected:
            self.card.setStyleSheet(
                f"""
                QFrame#SessionCard {{
                    background: {bg};
                    border: 1px solid {border};
                    border-radius: {SESSION_LIST_ITEM_RADIUS}px;
                }}
                """
            )
        else:
            self.card.setStyleSheet("")

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

        if selected:
            self.current_badge.setStyleSheet(
                f"""
                QLabel#SessionCurrentBadge {{
                    font-size: 10px;
                    font-weight: 600;
                    color: {sel_border};
                    background: rgba({r}, {g}, {b}, 0.18);
                    border: 1px solid {sel_border};
                    border-radius: 4px;
                    padding: 1px 6px;
                }}
                """
            )
            self.title_label.setStyleSheet(
                """
                QLabel#SessionItemTitle {
                    font-weight: 700;
                    color: #111827;
                    font-size: 14px;
                    background: transparent;
                }
                """
            )
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
            self.title_label.setStyleSheet(
                """
                QLabel#SessionItemTitle {
                    font-weight: 600;
                    color: #111827;
                    font-size: 14px;
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
