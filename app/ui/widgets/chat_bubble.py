import html

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QFrame, QHBoxLayout, QLabel, QSizePolicy, QVBoxLayout


class SystemBubble(QFrame):
    def __init__(self, text, ts_text=""):
        super().__init__()
        self.ts_text = ts_text
        self.setObjectName("SystemBubble")
        self.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Minimum)
        self.setMaximumWidth(520)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 7, 14, 7)
        self.body_label = QLabel()
        self.body_label.setObjectName("SystemBubbleBody")
        self.body_label.setWordWrap(True)
        self.body_label.setAlignment(Qt.AlignCenter)
        self.body_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        layout.addWidget(self.body_label)
        self.set_text(text)

    def set_text(self, text):
        self.body_label.setText(text or "")




class ChatBubble(QFrame):
    def __init__(self, role, text, ts_text, status_text="", body_pt=14):
        super().__init__()
        self.role = role
        self.ts_text = ts_text
        self.status_text = status_text
        self._body_pt = body_pt
        self.setObjectName("ChatBubble")
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Minimum)
        self.setMinimumWidth(140)
        if role == "error":
            self.setMaximumWidth(520)
        else:
            self.setMaximumWidth(720)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(4)
        self.header_label = QLabel()
        self.header_label.setObjectName("BubbleHeader")
        layout.addWidget(self.header_label)
        self.body_label = QLabel()
        self.body_label.setWordWrap(True)
        self.body_label.setTextFormat(Qt.PlainText)
        self.body_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.body_label.setObjectName("BubbleBody")
        layout.addWidget(self.body_label)
        self.set_text(text, status_text)
        self._apply_style()

    def _role_name(self):
        if self.role == "user":
            return "你"
        if self.role == "assistant":
            return "ChatGPT"
        if self.role == "error":
            return "错误"
        return "系统"

    def _apply_style(self):
        header_pt = max(11, self._body_pt - 2)
        if self.role == "user":
            self.setProperty("bubbleRole", "user")
        elif self.role == "assistant":
            self.setProperty("bubbleRole", "assistant")
        elif self.role == "error":
            self.setProperty("bubbleRole", "error")
        else:
            self.setProperty("bubbleRole", "other")
        self.style().unpolish(self)
        self.style().polish(self)
        self.header_label.setStyleSheet(
            f"font-size: {header_pt}px; background: transparent;"
        )
        self.body_label.setStyleSheet(
            f"font-size: {self._body_pt}px; background: transparent;"
        )

    def set_status(self, status_text):
        self.set_text(self.body_label.text() or "", status_text)

    def set_text(self, text, status_text=None):
        if status_text is not None:
            self.status_text = status_text
        name = html.escape(self._role_name())
        ts = html.escape(self.ts_text or "")
        header_pt = max(11, self._body_pt - 2)
        if self.status_text:
            status = html.escape(self.status_text)
            self.header_label.setTextFormat(Qt.RichText)
            self.header_label.setText(
                f'<span style="font-size:{header_pt}px;font-weight:600;">'
                f"{name} · {ts}</span> "
                f'<span style="color:#9aa0a6;font-weight:normal;">{status}</span>'
            )
        else:
            self.header_label.setTextFormat(Qt.PlainText)
            self.header_label.setText(f"{self._role_name()} · {self.ts_text}")
        self.body_label.setText(text or "")

    def set_error(self, text, status_text="失败"):
        self.role = "error"
        self.setMaximumWidth(520)
        self._apply_style()
        self.set_text(text, status_text)

