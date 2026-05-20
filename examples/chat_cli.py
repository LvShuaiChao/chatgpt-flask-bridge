"""
命令行客户端：与本地 ChatGPT Page Bridge 对话。

用法::

    # 单次提问
    python examples/chat_cli.py "你好"

    # 交互模式
    python examples/chat_cli.py

    # 指定服务地址与 token
    python examples/chat_cli.py --url http://127.0.0.1:5000 --token YOUR_TOKEN

环境变量:
    CHATGPT_PAGE_BRIDGE_URL   服务地址（默认 http://127.0.0.1:5000）
    CHATGPT_PAGE_BRIDGE_TOKEN 鉴权 token（若服务端已配置）
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from bridge_client import main

if __name__ == "__main__":
    raise SystemExit(main())
