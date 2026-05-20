from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtWidgets import QTextEdit


class ChatInput(QTextEdit):
    send_requested = pyqtSignal()
    def __init__(self, main_window=None):
        super().__init__()
        self._main_window = main_window
    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            mods = event.modifiers()
            mode = "enter_send"
            if self._main_window is not None:
                mode = getattr(self._main_window, "_enter_send_mode", "enter_send")
            if mode == "ctrl_enter_send":
                if (mods & Qt.ControlModifier) and not (mods & Qt.ShiftModifier):
                    self.send_requested.emit()
                    event.accept()
                    return
            elif not (mods & Qt.ShiftModifier):
                self.send_requested.emit()
                event.accept()
                return
        super().keyPressEvent(event)


