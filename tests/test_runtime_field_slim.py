"""运行时字段精简：poll 载荷、idle 响应、binding、legacy 拒绝。"""

import pytest

from app.models import ChatSession, normalize_remote_chatgpt, write_session_remote_chatgpt
from app.utils.legacy_cleanup import assert_no_legacy_fields, reject_legacy_fields


@pytest.fixture
def server_module():
    import app.server as srv

    return srv


def test_poll_minimal_idle_has_only_core_keys(server_module):
    resp = server_module._poll_minimal_idle_response()
    assert resp == {"ok": True, "has_message": False}
    assert "pending_total" not in resp
    assert "tampermonkey_online" not in resp


def test_handle_poll_idle_includes_page_display_id(server_module):
    _clear_tm_state(server_module)
    body = {
        "client_id": "tm-poll-id",
        "page_instance_id": "page-poll-id",
        "url": "https://chatgpt.com/c/poll-id",
        "page_type": "conversation",
        "conversation_id": "poll-id",
        "is_responding": False,
        "response_state": "idle",
        "can_accept_input": True,
    }
    result, _notify, _changed = server_module._handle_poll(body)
    assert result.get("has_message") is False
    assert result.get("page_display_id") not in (None, "", 0)


def _clear_tm_state(server_module):
    with server_module._state_lock:
        server_module._tampermonkey_pages.clear()
        server_module._last_poll_identity.clear()


def _page_entry(server_module, client_id, page_instance_id):
    key = server_module.build_page_key(client_id, page_instance_id) or client_id
    with server_module._state_lock:
        entry = server_module._tampermonkey_pages.get(key)
        return dict(entry) if isinstance(entry, dict) else {}


def test_bridge_api_idle_poll_stays_minimal(server_module):
    _clear_tm_state(server_module)
    body = {
        "client_id": "tm-slim",
        "page_instance_id": "page-slim",
        "url": "https://chatgpt.com/c/slim",
        "page_type": "conversation",
        "conversation_id": "slim",
        "is_responding": False,
        "response_state": "idle",
        "can_accept_input": True,
    }
    result, _notify, _changed = server_module._handle_poll(body)
    assert result.get("has_message") is False
    assert result.get("ok") is True
    assert "pending_total" not in result
    assert "raw_clients_count" not in result


def test_handle_hello_caches_script_version(server_module):
    _clear_tm_state(server_module)
    with server_module._state_lock:
        server_module._known_page_instances.clear()
    body = {
        "action": "hello",
        "client_id": "tm-hello",
        "page_instance_id": "page-hello",
        "url": "https://chatgpt.com/",
        "page_type": "home",
        "script_version": "test-9.9.9",
        "upload_bridge_supported": True,
        "upload_bridge_version": 2,
        "is_top_frame": True,
    }
    result, need_notify = server_module._handle_hello(body)
    assert result.get("ok") is True
    assert result.get("page_display_id")
    assert need_notify is True
    entry = _page_entry(server_module, "tm-hello", "page-hello")
    assert entry.get("script_version") == "test-9.9.9"
    assert entry.get("upload_bridge_supported") is True
    assert entry.get("upload_bridge_version") == 2

    poll_body = {
        "client_id": "tm-hello",
        "page_instance_id": "page-hello",
        "url": "https://chatgpt.com/",
        "page_type": "home",
        "conversation_id": "",
        "is_responding": False,
        "response_state": "idle",
        "can_accept_input": True,
    }
    server_module._touch_tampermonkey(poll_body, action="poll")
    entry2 = _page_entry(server_module, "tm-hello", "page-hello")
    assert entry2.get("script_version") == "test-9.9.9"


def test_poll_rejects_legacy_debug_tm_fields():
    payload = {
        "client_id": "x",
        "page_instance_id": "y",
        "url": "https://chatgpt.com/c/a",
        "debug_tm_url_syncable": True,
    }
    rejected = reject_legacy_fields(payload, context="test", migrate=False)
    assert rejected is not None


def test_normalize_remote_chatgpt_rejects_legacy_bound_fields():
    with pytest.raises(ValueError, match="legacy fields"):
        normalize_remote_chatgpt(
            {
                "enabled": True,
                "bound_client_id": "c1",
                "bound_page_instance_id": "p1",
                "bound_conversation_id": "conv1",
                "bound_url": "https://chatgpt.com/c/conv1",
                "bind_state": "BOUND_CONVERSATION",
            }
        )


def test_write_session_remote_chatgpt_keeps_top_level_fields_only():
    session = ChatSession(session_id="s-bind", title="t", created_at=0, updated_at=0)
    write_session_remote_chatgpt(
        session,
        bind_state="BOUND_CONVERSATION",
        client_id="c2",
        page_instance_id="p2",
        conversation_id="conv2",
        url="https://chatgpt.com/c/conv2",
    )
    remote = session.remote_chatgpt
    assert remote.get("client_id") == "c2"
    assert remote.get("page_instance_id") == "p2"
    assert "binding" not in remote
