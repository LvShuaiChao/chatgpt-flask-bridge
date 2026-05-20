from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QLabel, QSizePolicy


class ElidedLabel(QLabel):
    """单行 QLabel：宽度不足时用省略号裁剪；默认 tooltip 为完整正文，可被 setToolTip 覆盖。"""

    def __init__(self, text="", parent=None):
        super().__init__(parent)
        self._full_text = ""
        self.setTextFormat(Qt.PlainText)
        self.setWordWrap(False)
        self.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.setText(text)

    def setText(self, text, tooltip=None):
        self._full_text = str(text or "")
        if tooltip is None:
            QLabel.setToolTip(self, self._full_text)
        else:
            QLabel.setToolTip(self, str(tooltip))
        self._update_elided_text()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._update_elided_text()

    def _update_elided_text(self):
        metrics = self.fontMetrics()
        width = max(20, self.width() - 8)
        elided = metrics.elidedText(self._full_text, Qt.ElideRight, width)
        QLabel.setText(self, elided)
