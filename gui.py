import sys

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QApplication

from app.ui.main_window import MainWindow
from log_utils import clear_log_file


def main():
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
