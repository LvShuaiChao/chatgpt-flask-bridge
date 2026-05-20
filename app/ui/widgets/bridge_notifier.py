from PyQt5.QtCore import QObject, pyqtSignal


class BridgeNotifier(QObject):
    log_signal = pyqtSignal(str)
    status_signal = pyqtSignal(dict)


