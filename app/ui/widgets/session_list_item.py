from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QSizePolicy, QVBoxLayout, QWidget

from app.constants import SESSION_BIND_LIST_STYLES


class SessionListItemWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("SessionListItem")
        self.setProperty("bindState", "unbound")
        self.setProperty("selected", False)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

        root = QHBoxLayout(self)
        root.setContentsMargins(10, 8, 10, 8)
        root.setSpacing(6)

        body = QVBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(3)

        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title_row.setSpacing(6)

        self.title_label = QLabel()
        self.title_label.setObjectName("SessionItemTitle")
        self.title_label.setWordWrap(False)
        title_row.addWidget(self.title_label, stretch=1)

        self.pending_dot = QLabel("●")
        self.pending_dot.setObjectName("SessionPendingDot")
        self.pending_dot.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.pending_dot.setVisible(False)
        title_row.addWidget(self.pending_dot)

        self.subtitle_label = QLabel()
        self.subtitle_label.setObjectName("SessionItemSubtitle")
        self.subtitle_label.setWordWrap(True)

        self.status_label = QLabel()
        self.status_label.setObjectName("SessionBindStatusLabel")
        self.status_label.setWordWrap(False)

        body.addLayout(title_row)
        body.addWidget(self.subtitle_label)
        body.addWidget(self.status_label)
        root.addLayout(body, stretch=1)

        self.current_badge = QLabel("当前")
        self.current_badge.setObjectName("SessionCurrentBadge")
        self.current_badge.setAlignment(Qt.AlignTop | Qt.AlignRight)
        self.current_badge.setVisible(False)
        root.addWidget(self.current_badge)

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

        if self.property("bindState") != bind_state:
            self.setProperty("bindState", bind_state)
        if bool(self.property("selected")) != bool(selected):
            self.setProperty("selected", bool(selected))

        self.title_label.setText(title or "新对话")
        self.subtitle_label.setText(subtitle or "")
        self.status_label.setText(style["label"])
        self.pending_dot.setVisible(bool(pending_reply))
        self.current_badge.setVisible(bool(selected))
        self.setToolTip(tooltip or "")

        widget_style = self.style()
        widget_style.unpolish(self)
        widget_style.polish(self)
        self.update()
