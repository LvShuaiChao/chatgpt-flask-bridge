"""Poll 匹配：缺 page_type 时由 URL/conversation_id 推断为 conversation。"""

import time

import pytest


@pytest.fixture
def server_module():
    import importlib
    import server as srv

    return importlib.reload(srv)


def test_body_identity_infers_conversation_from_url(server_module):
    body = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "url": "https://chatgpt.com/c/conv-abc",
        "conversation_id": "conv-abc",
        "last_seen": time.time(),
    }
    body_id = server_module._body_identity(body)
    assert body_id["page_type"] == "conversation"


def test_message_matches_page_when_page_type_missing_but_url_is_conversation(
    server_module,
):
    msg = {
        "message_id": "m1",
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-abc",
        "url": "https://chatgpt.com/c/conv-abc",
    }
    body = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-abc",
        "url": "https://chatgpt.com/c/conv-abc",
        "page_type": "",
        "last_seen": time.time(),
    }
    assert server_module._message_matches_page(msg, body) is True


def test_message_matches_page_when_page_type_stale_but_conversation_id_matches(
    server_module,
):
    msg = {
        "message_id": "m2",
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-abc",
    }
    body = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-abc",
        "url": "https://chatgpt.com/c/conv-abc",
        "page_type": "home",
        "last_seen": time.time(),
    }
    assert server_module._message_matches_page(msg, body) is True


def test_poll_no_message_reason_allows_stale_page_type_with_conversation_id(
    server_module,
):
    body = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-abc",
        "url": "https://chatgpt.com/c/conv-abc",
        "page_type": "other",
        "last_seen": time.time(),
    }
    reason = server_module._poll_no_message_reason(body, waiting=None)
    assert reason != "not_target_client"
