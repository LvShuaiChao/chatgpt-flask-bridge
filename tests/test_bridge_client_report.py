"""油猴在线注册表与 GUI 油猴在线判定。"""

import time

import pytest


@pytest.fixture
def server_module():
    import importlib
    import server as srv

    return importlib.reload(srv)


def test_register_bridge_client_report_requires_identity(server_module):
    logged = []
    server_module._log = lambda msg, tag="", level=None: logged.append(msg)
    ok = server_module._register_bridge_client_report(
        {"client_id": "c-only"},
        action="poll",
    )
    assert ok is False
    assert any("[BRIDGE_CLIENT_REPORT][DROP] reason=missing_client_identity" in line for line in logged)


def test_register_bridge_client_report_updates_online_table(server_module):
    with server_module._state_lock:
        server_module._tampermonkey_pages.clear()
    now = server_module._now()
    body = {
        "client_id": "tm-test",
        "page_instance_id": "page-test",
        "url": "https://chatgpt.com/c/abc-123",
        "page_title": "Test",
        "conversation_id": "abc-123",
        "page_type": "conversation",
        "is_responding": False,
        "response_state": "idle",
        "can_accept_input": True,
        "is_top_frame": True,
        "last_seen": now,
        "last_poll_at": now,
        "last_heartbeat_at": now,
        "url_syncable": True,
        "conversation_syncable": True,
    }
    assert server_module._register_bridge_client_report(body, action="poll") is True
    counts = server_module._tm_registry_counts()
    assert counts["raw_clients_count"] == 1
    assert counts["online_clients_count"] == 1
    assert counts["conversation_syncable_count"] == 1
    assert server_module.is_tampermonkey_online() is True
    snap = server_module._snapshot_clients()[0]
    assert snap.get("send_decision")
    assert snap.get("page_display_id")
    assert snap.get("url") == "https://chatgpt.com/c/abc-123"


def test_is_tampermonkey_online_false_when_stale(server_module):
    with server_module._state_lock:
        server_module._tampermonkey_pages.clear()
    stale = server_module._now() - server_module.ONLINE_TIMEOUT_SEC - 5
    body = {
        "client_id": "tm-stale",
        "page_instance_id": "page-stale",
        "url": "https://chatgpt.com/",
        "page_type": "home",
        "last_seen": stale,
        "is_top_frame": True,
    }
    server_module._register_bridge_client_report(body, action="poll")
    page_key = server_module.build_page_key("tm-stale", "page-stale")
    with server_module._state_lock:
        store = server_module._tampermonkey_pages.get(page_key)
        if isinstance(store, dict):
            store["last_seen"] = stale
            store["last_heartbeat_at"] = stale
            store["last_poll_at"] = stale
            store["last_report_at"] = stale
    counts = server_module._tm_registry_counts()
    assert counts["raw_clients_count"] == 1
    assert counts["online_clients_count"] == 0
    assert server_module.is_tampermonkey_online() is False


def test_get_bridge_status_slim_pages_and_summary(server_module):
    status = server_module.get_bridge_status()
    assert "pages" in status
    assert "summary" in status
    assert "online_count" in status["summary"]
    assert "tampermonkey_online" not in status
    assert "tampermonkey_client_id" not in status


def test_chatgpt_home_and_conversation_url_capabilities():
    from app.utils.page_status import evaluate_page_capability, explain_page_decision

    now = time.time()
    home = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "url": "https://chatgpt.com/",
        "page_type": "home",
        "last_seen": now - 1,
    }
    conv = {
        "client_id": "c1",
        "page_instance_id": "p2",
        "url": "https://chatgpt.com/c/uuid-here",
        "conversation_id": "uuid-here",
        "page_type": "conversation",
        "last_seen": now - 1,
    }
    gpage = {
        "client_id": "c1",
        "page_instance_id": "p3",
        "url": "https://chatgpt.com/g/gpt-4",
        "page_type": "other",
        "last_seen": now - 1,
    }
    cap_home = evaluate_page_capability(home, action="sync_url", now=now)
    cap_conv = evaluate_page_capability(conv, action="sync_url", now=now)
    cap_g = evaluate_page_capability(gpage, action="sync_url", now=now)
    assert cap_home.url_syncable is True
    assert cap_home.conversation_syncable is False
    assert cap_conv.url_syncable is True
    assert cap_conv.conversation_syncable is True
    assert cap_g.url_syncable is True
    assert cap_g.conversation_syncable is False
    assert evaluate_page_capability(gpage, now=now).url_syncable is True
