from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtWidgets import QListWidget


class SessionListWidget(QListWidget):
    delete_requested = pyqtSignal()
    fast_select_requested = pyqtSignal(object)

    def mousePressEvent(self, event):
        item = self.itemAt(event.pos())
        if item is not None and event.button() == Qt.LeftButton:
            self.fast_select_requested.emit(item)
        super().mousePressEvent(event)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Delete and self.currentItem() is not None:
            self.delete_requested.emit()
            event.accept()
            return
        super().keyPressEvent(event)

