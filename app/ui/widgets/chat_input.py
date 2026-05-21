from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtGui import QTextCursor
from PyQt5.QtWidgets import QTextEdit


class ChatInput(QTextEdit):
    send_requested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._main_window = parent
        self._ime_preedit_text = ""
        self.setAcceptRichText(False)
        self.setFocusPolicy(Qt.StrongFocus)

    def _append_input_debug_log(self, message):
        main_window = self._main_window
        if main_window is None:
            return
        if not getattr(main_window, "_debug_mode", False):
            return
        if hasattr(main_window, "_append_log"):
            main_window._append_log(message, echo=False)

    def _is_ime_composing(self):
        return bool((self._ime_preedit_text or "").strip())

    def inputMethodEvent(self, event):
        self._ime_preedit_text = event.preeditString() or ""
        self._append_input_debug_log(
            "[CHAT_INPUT][IME] "
            f"preedit_len={len(self._ime_preedit_text)} "
            f"commit_len={len(event.commitString() or '')}"
        )
        super().inputMethodEvent(event)
        if not self._ime_preedit_text:
            self._ime_preedit_text = ""

    def focusInEvent(self, event):
        self._append_input_debug_log(
            "[CHAT_INPUT][FOCUS_IN] "
            f"readonly={self.isReadOnly()} enabled={self.isEnabled()} "
            f"text_len={len(self.toPlainText() or '')}"
        )
        super().focusInEvent(event)

    def focusOutEvent(self, event):
        self._append_input_debug_log(
            "[CHAT_INPUT][FOCUS_OUT] "
            f"readonly={self.isReadOnly()} enabled={self.isEnabled()} "
            f"text_len={len(self.toPlainText() or '')}"
        )
        super().focusOutEvent(event)

    def mousePressEvent(self, event):
        self._append_input_debug_log(
            "[CHAT_INPUT][MOUSE_PRESS] "
            f"button={int(event.button())} "
            f"readonly={self.isReadOnly()} enabled={self.isEnabled()}"
        )
        super().mousePressEvent(event)
        self.setFocus(Qt.MouseFocusReason)

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            if self._is_ime_composing():
                self._append_input_debug_log(
                    "[CHAT_INPUT][ENTER_PASS_TO_IME] reason=ime_composing"
                )
                super().keyPressEvent(event)
                return

            mods = event.modifiers()
            mode = "enter_send"
            if self._main_window is not None:
                mode = getattr(self._main_window, "_enter_send_mode", "enter_send")

            if mode == "ctrl_enter_send":
                if (mods & Qt.ControlModifier) and not (mods & Qt.ShiftModifier):
                    self._append_input_debug_log(
                        "[CHAT_INPUT][SEND_REQUEST] mode=ctrl_enter_send"
                    )
                    self.send_requested.emit()
                    event.accept()
                    return
            elif not (mods & Qt.ShiftModifier):
                self._append_input_debug_log(
                    "[CHAT_INPUT][SEND_REQUEST] mode=enter_send"
                )
                self.send_requested.emit()
                event.accept()
                return

        super().keyPressEvent(event)

    def focus_to_end(self):
        self.setFocus(Qt.OtherFocusReason)
        cursor = self.textCursor()
        cursor.movePosition(QTextCursor.End)
        self.setTextCursor(cursor)
