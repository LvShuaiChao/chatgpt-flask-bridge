from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtWidgets import QListWidget


class SessionListWidget(QListWidget):
    delete_requested = pyqtSignal()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Delete and self.currentItem() is not None:
            self.delete_requested.emit()
            event.accept()
            return
        super().keyPressEvent(event)


