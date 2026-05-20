import faulthandler
import sys
import traceback

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QApplication

from app.ui.main_window import MainWindow
from log_utils import append_log, clear_log_file


def main():
    faulthandler.enable()

    def handle_exception(exc_type, exc_value, exc_traceback):
        detail = "".join(
            traceback.format_exception(exc_type, exc_value, exc_traceback)
        )
        append_log(
            "[PYTHON_UNCAUGHT_EXCEPTION]\n" + detail, source="GUI", echo=True
        )

    sys.excepthook = handle_exception

    clear_log_file()
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    app = QApplication(sys.argv)
    app.setFont(QFont("Microsoft YaHei UI", 10))
    window = MainWindow()
    window.show()
    if not window._current_session() or not window._current_session().messages:
        window._add_system_message(
            "请先启动服务，然后刷新 ChatGPT 页面并确认油猴脚本在线。"
        )
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
