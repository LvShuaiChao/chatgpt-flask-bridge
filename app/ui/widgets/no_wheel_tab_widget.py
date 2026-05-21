from PyQt5.QtCore import QEvent
from PyQt5.QtWidgets import QTabWidget


class NoWheelTabWidget(QTabWidget):
    """禁止鼠标滚轮直接切换标签页（含标签栏区域）。"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.tabBar().installEventFilter(self)

    def eventFilter(self, obj, event):
        if obj is self.tabBar() and event.type() == QEvent.Wheel:
            event.accept()
            return True
        return super().eventFilter(obj, event)

    def wheelEvent(self, event):
        event.accept()
