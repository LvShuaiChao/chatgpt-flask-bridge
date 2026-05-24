"""出站队列旧字段拦截：防误删回归测试。

本模块保护 ``legacy_cleanup`` / ``bridge_payload`` 中的 fail-fast 边界，避免在
「僵尸代码清理」任务中被误判为 dead code 而删除。

不能删除（须保留 fail-fast，不得弱化为 warning）：

- ``app/utils/legacy_cleanup.py``
- ``app/utils/bridge_payload.py`` 中对 ``legacy_cleanup`` 的导入与调用
- ``app/server/control_commands.py`` 中的 ``assert_no_legacy_fields`` 调用
- ``LEGACY_FIELD_NAMES``、``assert_no_legacy_fields``、``reject_legacy_fields``
- ``validate_outbound_queue_message()`` 内的旧字段拒绝逻辑

可执行判断标准：

1. ``bridge_payload.validate_outbound_queue_message`` 在嵌套 ``payload.request_id``
   时必须抛出 ``ValueError``，且错误信息含 ``legacy fields still exist before save``
   与 ``payload.request_id``（由 ``assert_no_legacy_fields`` 深检触发）。
2. 不含 ``request_id`` 的 canonical 出站消息必须通过校验并返回规范化结果。
3. 不得将 ``payload.request_id`` 加回白名单；上游漏字段应修同步流程，而非删除拦截。

运行::

    pytest -q tests/test_bridge_payload_legacy_guard.py
"""

import pytest

from app.utils.bridge_payload import validate_outbound_queue_message


def _canonical_outbound_msg(**payload_extra):
    return {
        "message_id": "msg_test_001",
        "message_status": "queued",
        "client_id": "tm-test",
        "page_instance_id": "page-test",
        "conversation_id": "conv-test",
        "url": "https://chatgpt.com/c/conv-test",
        "bind_state": "BOUND_CONVERSATION",
        "payload": {
            "content": "测试内容",
            **payload_extra,
        },
    }


def test_validate_outbound_queue_message_rejects_payload_request_id():
    msg = _canonical_outbound_msg(request_id="legacy-request-id")

    with pytest.raises(ValueError) as exc:
        validate_outbound_queue_message(msg)

    err = str(exc.value)
    assert "legacy fields still exist before save" in err
    assert "payload.request_id" in err


def test_validate_outbound_queue_message_accepts_current_fields_without_request_id():
    msg = {
        "message_id": "msg_test_002",
        "message_status": "queued",
        "client_id": "tm-test",
        "page_instance_id": "page-test",
        "conversation_id": "conv-test",
        "url": "https://chatgpt.com/c/conv-test",
        "bind_state": "BOUND_CONVERSATION",
        "payload": {
            "content": "测试内容",
            "trace_id": "trace-test",
        },
    }

    out = validate_outbound_queue_message(msg)

    assert out["message_id"] == "msg_test_002"
    assert out["payload"]["content"] == "测试内容"
    assert "request_id" not in out["payload"]
