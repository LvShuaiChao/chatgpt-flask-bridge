from PyQt5.QtCore import QObject, pyqtSignal


class BridgeNotifier(QObject):
    log_signal = pyqtSignal(str)
    status_signal = pyqtSignal(dict)
    external_dispatch_signal = pyqtSignal(str, str, dict)


