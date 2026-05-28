import importlib

import pytest

from app.utils.legacy_cleanup import BRIDGE_REQUEST_ALLOWED_FIELDS, reject_legacy_fields


@pytest.fixture
def server_module():
    import app.server as srv

    return importlib.reload(srv)


def test_reject_bridge_request_fields_allows_runtime_telemetry():
    err = reject_legacy_fields(
        {
            "action": "poll",
            "client_id": "tm-1",
            "page_instance_id": "page-1",
            "page_display_id": "1",
            "page_title": "ChatGPT",
            "page_type": "conversation",
            "pathname": "/c/test",
            "bind_request_id": "bind-1",
            "is_top_frame": True,
            "has_focus": True,
            "response_state": "idle",
            "can_accept_input": True,
            "can_send_now": True,
            "heartbeat_alive": True,
            "last_seen": 3,
            "response_state_reason": "idle",
            "response_state_at": 4,
            "is_responding": False,
            "event": "focus_state",
        },
        context="test",
        allowed_fields=BRIDGE_REQUEST_ALLOWED_FIELDS,
        strict_unknown=True,
    )
    assert err is None


@pytest.mark.parametrize(
    "field_name",
    [
        "bridge_message_id",
        "parent_message_id",
        "visible_in_chat",
    ],
)
def test_reject_bridge_request_fields_blocks_forbidden_legacy_fields(field_name):
    err = reject_legacy_fields(
        {
            "action": "poll",
            "client_id": "tm-1",
            field_name: "legacy",
        },
        context="test",
        allowed_fields=BRIDGE_REQUEST_ALLOWED_FIELDS,
        strict_unknown=True,
    )
    assert err is not None
    body, status = err
    assert status == 400
    assert body["error"] == "unknown_fields_not_allowed"
    assert body["unknown_fields"] == [field_name]


def test_api_bridge_allows_runtime_telemetry_poll_payload(server_module):
    server_module.create_app()
    client = server_module.app.test_client()
    response = client.post(
        "/api/bridge",
        json={
            "action": "poll",
            "client_id": "tm-api",
            "page_instance_id": "page-api",
            "url": "https://chatgpt.com/c/runtime-test",
            "conversation_id": "runtime-test",
            "page_display_id": "1",
            "page_title": "Runtime Test",
            "page_type": "conversation",
            "pathname": "/c/runtime-test",
            "bind_request_id": "bind-runtime",
            "is_top_frame": True,
            "has_focus": True,
            "heartbeat_alive": True,
            "is_responding": False,
            "response_state": "idle",
            "response_state_reason": "idle",
            "response_state_at": 123,
            "can_accept_input": True,
            "can_send_now": True,
            "last_seen": 123,
        },
        headers={"X-Request-Source": "tampermonkey"},
    )

    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert "unknown_fields" not in data


def test_api_bridge_allows_page_registry_runtime_fields(server_module):
    server_module.create_app()
    client = server_module.app.test_client()
    response = client.post(
        "/api/bridge",
        json={
            "action": "report",
            "client_id": "tm-api",
            "page_instance_id": "page-api",
            "url": "https://chatgpt.com/c/runtime-test",
            "conversation_id": "runtime-test",
            "page_display_id": "1",
            "page_title": "Runtime Test",
            "page_type": "conversation",
            "pathname": "/c/runtime-test",
            "bind_request_id": "bind-runtime",
            "is_top_frame": True,
            "has_focus": True,
            "heartbeat_alive": True,
            "is_responding": False,
            "response_state": "idle",
            "response_state_reason": "idle",
            "response_state_at": 123,
            "can_accept_input": True,
            "can_send_now": True,
            "last_seen": 123,
            "last_dom_mutation_at": 100,
            "last_reply_watch_at": 101,
            "pending_reply_active": True,
            "pending_reply_started_at": 102,
            "pending_reply_text_length": 88,
            "browser_hidden": False,
            "browser_visibility_state": "visible",
            "browser_has_focus": True,
            "browser_timer_drift_ms": 0,
            "browser_probably_throttled": False,
        },
        headers={"X-Request-Source": "tampermonkey"},
    )

    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert "unknown_fields" not in data


@pytest.mark.parametrize(
    "field_name",
    [
        "bridge_message_id",
        "parent_message_id",
        "visible_in_chat",
    ],
)
def test_api_bridge_rejects_forbidden_legacy_fields(server_module, field_name):
    server_module.create_app()
    client = server_module.app.test_client()
    response = client.post(
        "/api/bridge",
        json={
            "action": "poll",
            "client_id": "tm-api",
            "page_instance_id": "page-api",
            field_name: "legacy",
        },
        headers={"X-Request-Source": "tampermonkey"},
    )

    assert response.status_code == 400
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "unknown_fields_not_allowed"
    assert data["unknown_fields"] == [field_name]
