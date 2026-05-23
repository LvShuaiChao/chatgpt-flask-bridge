"""支持分段配色的单行省略标签（用于绑定页面行）。"""

from __future__ import annotations

from app.ui.page_display_segments import paint_text_segments
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QPainter
from PyQt5.QtWidgets import QLabel, QSizePolicy


class SegmentedElidedLabel(QLabel):
    """按 segments 列表绘制；_full_text 为拼接纯文本，供 tooltip / 测试使用。"""

    def __init__(self, text="", parent=None):
        super().__init__(parent)
        self._segments = []
        self._full_text = ""
        self.setTextFormat(Qt.PlainText)
        self.setWordWrap(False)
        self.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        if text:
            self.setText(text)

    def set_segments(self, segments, *, tooltip=None):
        self._segments = list(segments) if isinstance(segments, list) else []
        self._full_text = "".join(
            str(seg.get("text") or "")
            for seg in self._segments
            if isinstance(seg, dict)
        )
        if tooltip is None:
            QLabel.setToolTip(self, self._full_text)
        else:
            QLabel.setToolTip(self, str(tooltip))
        self.update()

    def setText(self, text, tooltip=None):
        plain = str(text or "")
        self._segments = [{"text": plain, "role": "plain"}] if plain else []
        self._full_text = plain
        if tooltip is None:
            QLabel.setToolTip(self, self._full_text)
        else:
            QLabel.setToolTip(self, str(tooltip))
        self.update()

    def paintEvent(self, event):
        if not self._segments:
            super().paintEvent(event)
            return
        painter = QPainter(self)
        paint_text_segments(
            painter,
            self.rect(),
            self.font(),
            self._segments,
            selected=False,
            content_margin=4,
        )
        painter.end()

    def minimumSizeHint(self):
        hint = super().minimumSizeHint()
        return hint

    def sizeHint(self):
        hint = super().sizeHint()
        return hint
