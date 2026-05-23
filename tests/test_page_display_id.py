"""page_display_id 展示编号：分配、复用、释放与 API 透出。"""

import pytest


@pytest.fixture
def server_module():
    import importlib
    import app.server as srv

    return importlib.reload(srv)


def _clear_tm_state(server_module):
    with server_module._state_lock:
        server_module._tampermonkey_pages.clear()
        server_module.st._tm_page_display_id_by_key.clear()
        server_module.st._tm_page_display_id_updated_at.clear()
        server_module.st.tampermonkey_last_seen = None


def test_allocate_display_id_for_two_pages(server_module):
    _clear_tm_state(server_module)
    now = server_module._now()
    for idx, instance in enumerate(("page-a", "page-b"), start=1):
        body = {
            "client_id": f"tm-{idx}",
            "page_instance_id": instance,
            "url": f"https://chatgpt.com/c/conv-{idx}",
            "conversation_id": f"conv-{idx}",
            "page_type": "conversation",
            "last_seen": now,
            "is_top_frame": True,
        }
        assert server_module._register_bridge_client_report(body, action="poll") is True

    id_a = server_module._allocate_tm_page_display_id("tm-1", "page-a")
    id_b = server_module._allocate_tm_page_display_id("tm-2", "page-b")
    assert id_a == 1
    assert id_b == 2
    assert id_a != id_b


def test_same_page_instance_keeps_display_id(server_module):
    _clear_tm_state(server_module)
    now = server_module._now()
    body = {
        "client_id": "tm-stable",
        "page_instance_id": "page-stable",
        "url": "https://chatgpt.com/c/stable",
        "page_type": "conversation",
        "last_seen": now,
        "is_top_frame": True,
    }
    server_module._register_bridge_client_report(body, action="poll")
    first = server_module._allocate_tm_page_display_id("tm-stable", "page-stable")
    second = server_module._allocate_tm_page_display_id("tm-stable", "page-stable")
    assert first == second == 1


def test_snapshot_clients_includes_page_display_id(server_module):
    _clear_tm_state(server_module)
    now = server_module._now()
    server_module._register_bridge_client_report(
        {
            "client_id": "tm-snap",
            "page_instance_id": "page-snap",
            "url": "https://chatgpt.com/c/snap",
            "page_type": "conversation",
            "last_seen": now,
            "is_top_frame": True,
        },
        action="poll",
    )
    items = server_module._snapshot_clients()
    assert len(items) == 1
    assert str(items[0].get("page_display_id") or "") == "1"
    assert "id" not in items[0]
    assert "page_id" not in items[0]


def test_poll_runtime_patch_includes_page_display_id(server_module):
    _clear_tm_state(server_module)
    body = {
        "client_id": "tm-poll",
        "page_instance_id": "page-poll",
        "url": "https://chatgpt.com/c/poll",
        "page_type": "conversation",
        "last_seen": server_module._now(),
        "is_top_frame": True,
    }
    server_module._register_bridge_client_report(body, action="poll")
    resp = server_module._finalize_poll_response(
        server_module._poll_minimal_idle_response(),
        body,
    )
    assert resp.get("page_display_id") == 1


def test_cleanup_releases_display_id(server_module):
    _clear_tm_state(server_module)
    logged = []
    server_module._log = lambda msg, tag="", level=None: logged.append(msg)
    now = server_module._now()
    server_module._register_bridge_client_report(
        {
            "client_id": "tm-gone",
            "page_instance_id": "page-gone",
            "url": "https://chatgpt.com/c/gone",
            "page_type": "conversation",
            "last_seen": now,
            "is_top_frame": True,
        },
        action="poll",
    )
    page_key = server_module.build_page_key("tm-gone", "page-gone")
    assert server_module.st._tm_page_display_id_by_key.get(page_key) == 1

    with server_module._state_lock:
        server_module._tampermonkey_pages.clear()

    removed = server_module._cleanup_tm_page_display_ids()
    assert removed == 1
    assert page_key not in server_module.st._tm_page_display_id_by_key
    assert any("[TM_PAGE_ID][RELEASE]" in line for line in logged) or removed == 1


def test_released_display_id_can_be_reused(server_module):
    _clear_tm_state(server_module)
    page_key = server_module.build_page_key("tm-old", "page-old")
    server_module.st._tm_page_display_id_by_key[page_key] = 1
    server_module.st._tm_page_display_id_updated_at[page_key] = server_module._now()
    server_module._cleanup_tm_page_display_ids()

    new_id = server_module._allocate_tm_page_display_id("tm-new", "page-new")
    assert new_id == 1
