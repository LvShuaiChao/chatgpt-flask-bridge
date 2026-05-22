"""Poll 响应只输出规范 bridge 字段，不含 legacy 别名。"""

import pytest

LEGACY_POLL_KEYS = frozenset(
    {
        "id",
        "status",
        "target_url",
        "target_page_url",
        "target_client_id",
        "target_page_instance_id",
        "text",
        "message",
        "prompt",
        "final_prompt",
        "raw_user_text",
    }
)


@pytest.fixture
def server_module():
    import server as srv

    return srv


def test_poll_response_chat_uses_canonical_fields_only(server_module):
    msg = {
        "message_id": "msg-1",
        "type": "chat",
        "message_status": "queued",
        "content": "hello",
        "client_id": "client-1",
        "page_instance_id": "page-1",
        "url": "https://chatgpt.com/c/abc",
        "session_id": "sess-1",
        "turn_id": "turn-1",
    }
    resp = server_module._poll_response(msg, retry=False)
    assert resp.get("has_message") is True
    assert resp.get("message_id") == "msg-1"
    assert "message_status" not in resp
    assert "session_id" not in resp
    assert "turn_id" not in resp
    assert "trace_id" not in resp
    assert resp.get("content") == "hello"
    assert resp.get("client_id") == "client-1"
    assert resp.get("page_instance_id") == "page-1"
    assert resp.get("url") == "https://chatgpt.com/c/abc"
    assert LEGACY_POLL_KEYS.isdisjoint(resp.keys())


def test_poll_response_command_uses_canonical_fields_only(server_module):
    msg = {
        "message_id": "cmd-1",
        "type": "command",
        "message_status": "queued",
        "command": "sync_conversation",
        "client_id": "client-2",
        "url": "https://chatgpt.com/",
    }
    resp = server_module._poll_response(msg, retry=False)
    assert resp.get("type") == "command"
    assert resp.get("command") == "sync_conversation"
    assert resp.get("client_id") == "client-2"
    assert LEGACY_POLL_KEYS.isdisjoint(resp.keys())


def test_poll_response_rejects_legacy_id_in_queue_message(server_module):
    msg = {
        "id": "legacy-id",
        "type": "chat",
        "content": "hello",
        "client_id": "client-1",
        "page_instance_id": "page-1",
        "message_status": "queued",
    }
    with pytest.raises(ValueError):
        server_module._poll_response(msg, retry=False)
