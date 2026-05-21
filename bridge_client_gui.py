"""
@deprecated — 根目录兼容壳入口，真实逻辑已迁移至 examples/bridge_client_gui.py。

独立 Bridge API 调试客户端，不参与主 GUI（主入口为 GUI.py / app/ui/main_window.py），
主程序禁止导入本 legacy wrapper。
源码仓库保留本文件以便旧命令 ``python bridge_client_gui.py`` 仍可运行；
不参与正式打包；制作精简发布包时可排除本文件，请改用::

    python examples/bridge_client_gui.py
"""

import sys

from examples.bridge_client_gui import main


def _run_deprecated_wrapper():
    print(
        "[DEPRECATED] bridge_client_gui.py 已迁移到 examples/bridge_client_gui.py",
        file=sys.stderr,
    )
    return main()


if __name__ == "__main__":
    raise SystemExit(_run_deprecated_wrapper())
