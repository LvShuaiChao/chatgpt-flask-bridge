from PyQt5.QtWidgets import QComboBox


class NoWheelComboBox(QComboBox):
    """
    禁止鼠标滚轮直接切换当前选项。
    用于页面 URL 列表、手动选中页列表等容易误触发的下拉框。
    """

    def wheelEvent(self, event):
        event.accept()
