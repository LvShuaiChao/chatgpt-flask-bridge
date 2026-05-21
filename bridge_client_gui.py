"""
已迁移至 examples/bridge_client_gui.py（独立 Bridge API 调试客户端，不参与主 GUI）。

请运行: python examples/bridge_client_gui.py
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
