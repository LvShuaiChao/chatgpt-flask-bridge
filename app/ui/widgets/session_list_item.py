from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QFrame, QHBoxLayout, QLabel, QSizePolicy, QVBoxLayout, QWidget

from app.constants import SESSION_BIND_LIST_STYLES

SESSION_LIST_ITEM_HEIGHT = 86
SESSION_LIST_ITEM_RADIUS = 8


def _hex_to_rgb_triplet(hex_color: str) -> tuple[int, int, int]:
    h = (hex_color or "").strip().lstrip("#")
    if len(h) != 6:
        return 156, 163, 175
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


class SessionListItemWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("SessionListItem")
        self.setFixedHeight(SESSION_LIST_ITEM_HEIGHT)
        self.setMinimumHeight(SESSION_LIST_ITEM_HEIGHT)
        self.setMaximumHeight(SESSION_LIST_ITEM_HEIGHT)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

        root = QHBoxLayout(self)
        root.setContentsMargins(4, 2, 4, 2)
        root.setSpacing(0)

        self.left_bar = QFrame()
        self.left_bar.setObjectName("SessionListLeftBar")
        self.left_bar.setFixedWidth(5)
        self.left_bar.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Expanding)

        self.card = QFrame()
        self.card.setObjectName("SessionListCard")
        self.card.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

        root.addWidget(self.left_bar)
        root.addWidget(self.card, stretch=1)

        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(6, 3, 6, 3)
        card_layout.setSpacing(0)

        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title_row.setSpacing(4)

        self.title_label = QLabel()
        self.title_label.setObjectName("SessionItemTitle")
        self.title_label.setWordWrap(False)
        self.title_label.setFixedHeight(20)
        title_row.addWidget(self.title_label, stretch=1)

        self.pending_dot = QLabel()
        self.pending_dot.setObjectName("SessionPendingDot")
        self.pending_dot.setAlignment(Qt.AlignCenter)
        self.pending_dot.setFixedSize(14, 18)
        self.pending_dot.setVisible(True)
        title_row.addWidget(self.pending_dot, alignment=Qt.AlignVCenter)

        self.current_badge = QLabel()
        self.current_badge.setObjectName("SessionCurrentBadge")
        self.current_badge.setAlignment(Qt.AlignCenter)
        self.current_badge.setFixedSize(34, 18)
        self.current_badge.setVisible(True)
        title_row.addWidget(self.current_badge, alignment=Qt.AlignVCenter)

        self.subtitle_label = QLabel()
        self.subtitle_label.setObjectName("SessionItemSubtitle")
        self.subtitle_label.setWordWrap(False)
        self.subtitle_label.setFixedHeight(32)
        self.subtitle_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

        self.status_label = QLabel()
        self.status_label.setObjectName("SessionBindStatusLabel")
        self.status_label.setWordWrap(False)
        self.status_label.setFixedHeight(18)

        card_layout.addLayout(title_row)
        card_layout.addWidget(self.subtitle_label)
        card_layout.addWidget(self.status_label)

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

        subtitle = subtitle or ""
        subtitle = subtitle.replace("\n", " ")
        if len(subtitle) > 42:
            subtitle = subtitle[:42] + "…"

        bg = style["bg"]
        border = style["selected_border"] if selected else style["border"]
        left = style["left"]
        sel_border = style["selected_border"]
        text_color = style["text"]

        r, g, b = _hex_to_rgb_triplet(left)

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

        self.card.setStyleSheet(
            f"""
            QFrame#SessionListCard {{
                background: {bg};
                border: 1px solid {border};
                border-left: 0px;
                border-top-right-radius: {SESSION_LIST_ITEM_RADIUS}px;
                border-bottom-right-radius: {SESSION_LIST_ITEM_RADIUS}px;
            }}
            """
        )

        self.title_label.setText(title or "新对话")
        self.subtitle_label.setText(subtitle)
        status_text = style["label"]
        self.status_label.setText(status_text)

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

        self.pending_dot.setText("●" if pending_reply else "")
        self.pending_dot.setVisible(True)

        if selected:
            self.current_badge.setText("当前")
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
                    background-clip: border-box;
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
            self.current_badge.setText("")
            self.current_badge.setStyleSheet(
                """
                QLabel#SessionCurrentBadge {
                    font-size: 10px;
                    font-weight: 600;
                    background: transparent;
                    border: 1px solid transparent;
                    border-radius: 4px;
                    padding: 1px 6px;
                    background-clip: border-box;
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
                    padding: 0px;
                    margin: 0px;
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
                    padding: 0px;
                    margin: 0px;
                }
                """
            )

        self.setToolTip(tooltip or "")
        self.update()
