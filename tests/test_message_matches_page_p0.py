"""P0：server 消息投递不以 page_type 硬拦截。"""

import pytest


@pytest.fixture
def server_module():
    import importlib
    import app.server as srv

    return importlib.reload(srv)


def test_message_matches_page_allows_stale_page_type_with_conversation_id(server_module):
    msg = {
        "message_id": "m-stale-type",
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "conv-1",
    }
    body = {
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "conv-1",
        "page_type": "home",
    }
    assert server_module._message_matches_page(msg, body) is True


def test_message_matches_page_blocks_missing_body_conversation_id(server_module):
    msg = {
        "message_id": "m-no-body-conv",
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "conv-1",
    }
    body = {
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "",
        "page_type": "conversation",
    }
    assert server_module._message_matches_page(msg, body) is False


@pytest.mark.skip(reason="legacy poll registration smoke test")
def test_register_ignores_client_false_capability(server_module):
    with server_module._state_lock:
        server_module._tampermonkey_clients.clear()
        server_module._tampermonkey_pages.clear()
    now = server_module._now()
    body = {
        "client_id": "tm-cap",
        "page_instance_id": "page-cap",
        "url": "https://chatgpt.com/c/abc-123",
        "conversation_id": "abc-123",
        "page_type": "conversation",
        "url_syncable": False,
        "conversation_syncable": False,
        "last_seen": now,
        "is_top_frame": True,
    }
    server_module._touch_tampermonkey(body, action="poll")
    entry = server_module._registry_entry_for_client(
        "tm-cap",
        "page-cap",
        strict_instance=True,
    )
    assert entry.get("url_syncable") is True
    assert entry.get("conversation_syncable") is True
