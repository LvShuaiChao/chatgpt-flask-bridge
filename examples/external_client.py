"""最小示例：同步提问并打印回复。"""

from bridge_client import BridgeClient, BridgeApiError

client = BridgeClient(base_url="http://127.0.0.1:5000")

try:
    reply = client.ask(
        "你好，请介绍一下你自己",
        auto_create_session=True,
        auto_open_home=True,
        timeout=120,
    )
    print(reply)
except BridgeApiError as error:
    print(f"调用失败 [{error.code}]: {error}")
    if error.payload:
        print("详情:", error.payload)
