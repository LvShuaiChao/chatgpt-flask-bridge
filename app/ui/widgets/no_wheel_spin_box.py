from PyQt5.QtWidgets import QDoubleSpinBox, QSpinBox


class NoWheelSpinBox(QSpinBox):
    """禁止鼠标滚轮直接改数值，避免在可滚动设置页上误触。"""

    def wheelEvent(self, event):
        event.ignore()


class NoWheelDoubleSpinBox(QDoubleSpinBox):
    """禁止鼠标滚轮直接改数值，避免在可滚动设置页上误触。"""

    def wheelEvent(self, event):
        event.ignore()
