import faulthandler
import sys
import traceback

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QApplication

from app.ui.main_window import MainWindow
from log_utils import (
    append_log,
    append_startup_environment,
    clear_log_file,
    get_log_file_path,
    set_log_runtime_options,
)


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
    set_log_runtime_options(verbose=True, mirror_to_console=True, include_callsite=True)
    append_startup_environment(source="GUI")
    append_log(
        "[APP][BOOT] GUI main started",
        source="GUI",
        fields={"log_file": get_log_file_path()},
    )
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    app = QApplication(sys.argv)
    append_log("[APP][QT] QApplication created", source="GUI", fields={"argv": sys.argv})
    app.setFont(QFont("Microsoft YaHei UI", 10))
    append_log("[APP][WINDOW_CREATE_START]", source="GUI")
    window = MainWindow()
    append_log("[APP][WINDOW_CREATE_DONE]", source="GUI")
    window.show()
    append_log(
        "[APP][WINDOW_SHOW]",
        source="GUI",
        fields={
            "title": window.windowTitle(),
            "size": f"{window.width()}x{window.height()}",
        },
    )
    if not window._current_session() or not window._current_session().messages:
        window._add_system_message(
            "请先启动服务，然后刷新 ChatGPT 页面并确认油猴脚本在线。"
        )
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
