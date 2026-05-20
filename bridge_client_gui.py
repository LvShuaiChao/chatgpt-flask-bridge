"""
Bridge API 客户端图形界面入口。

用法::

    python bridge_client_gui.py

需先启动主 GUI（gui.py）并开启本地桥接服务；油猴脚本与 ChatGPT 页面需在线。
命令行最小客户端仍使用 bridge_client.py 或 examples/chat_cli.py。
"""

from __future__ import annotations

import faulthandler
import sys
import traceback

from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QApplication

from app.client_ui.main_window import BridgeClientMainWindow


def main() -> int:
    faulthandler.enable()

    def handle_exception(exc_type, exc_value, exc_traceback):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_traceback)
            return
        detail = "".join(
            traceback.format_exception(exc_type, exc_value, exc_traceback)
        )
        print(detail, file=sys.stderr)

    sys.excepthook = handle_exception

    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    app = QApplication(sys.argv)
    app.setApplicationName("BridgeClientGUI")
    app.setFont(QFont("Microsoft YaHei UI", 10))
    window = BridgeClientMainWindow()
    window.show()
    return app.exec_()


if __name__ == "__main__":
    raise SystemExit(main())
