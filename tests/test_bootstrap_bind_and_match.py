"""Bootstrap 绑定推断与 bridge 消息匹配。"""

import time

import pytest

from app.models import (
    BIND_STATE_TEMP_HOME_BOUND,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    normalize_remote_chatgpt,
)
from app.utils.page_snapshot import PageRegistry, binding_from_session


class _SessionStub:
    def __init__(self, remote):
        self.remote_chatgpt = remote


@pytest.fixture
def server_module():
    import importlib
    import app.server as srv

    return importlib.reload(srv)


def test_normalize_remote_preserves_temp_home_during_bootstrap():
    remote = {
        "bind_state": BIND_STATE_WAITING_CONVERSATION_CREATED,
        "bootstrap_in_progress": True,
        "bootstrap_message_id": "msg-bootstrap-1",
        "client_id": "tm-al4xco4l",
        "page_instance_id": "page-1779593669374-08vt",
        "page_no": "1",
        "temp_page_id": "1",
        "page_display_id": "1",
        "url": "https://chatgpt.com/",
        "conversation_id": "",
    }
    normalized = normalize_remote_chatgpt(remote)
    assert normalized["bind_state"] == BIND_STATE_TEMP_HOME_BOUND
    assert normalized["client_id"] == "tm-al4xco4l"
    assert normalized["page_instance_id"] == "page-1779593669374-08vt"


def test_binding_from_session_after_bootstrap_start():
    session = _SessionStub(
        {
            "bind_state": BIND_STATE_WAITING_CONVERSATION_CREATED,
            "bootstrap_in_progress": True,
            "client_id": "tm-al4xco4l",
            "page_instance_id": "page-1779593669374-08vt",
            "page_no": "1",
            "temp_page_id": "1",
            "url": "https://chatgpt.com/",
            "conversation_id": "",
        }
    )
    binding = binding_from_session(session)
    assert binding["bind_state"] == BIND_STATE_TEMP_HOME_BOUND
    assert binding["client_id"] == "tm-al4xco4l"
    assert binding["page_instance_id"] == "page-1779593669374-08vt"


def test_resolve_bound_home_page_by_client_and_page_instance():
    from app.utils.page_command import resolve_bound_page_in_registry

    now = time.time()
    status = {
        "pages": [
            {
                "client_id": "tm-al4xco4l",
                "page_instance_id": "page-1779593669374-08vt",
                "page_no": "1",
                "page_display_id": "1",
                "page_type": "home",
                "conversation_id": "",
                "url": "https://chatgpt.com/",
                "online": True,
                "last_poll_at": now,
                "last_seen": now,
            }
        ]
    }
    reg = PageRegistry.from_bridge_status(status)
    binding = {
        "bind_state": BIND_STATE_TEMP_HOME_BOUND,
        "client_id": "tm-al4xco4l",
        "page_instance_id": "page-1779593669374-08vt",
        "temp_page_id": "1",
        "page_no": "1",
        "conversation_id": "",
    }
    resolved = resolve_bound_page_in_registry(reg, binding, now=now)
    assert resolved["matched_by"] == "client_and_page_instance"
    assert resolved["online"] is True
    assert resolved.get("reason_code") == ""


def test_message_matches_bootstrap_without_body_page_no(server_module):
    msg = {
        "message_id": "m-bootstrap",
        "bootstrap_conversation": True,
        "client_id": "tm-al4xco4l",
        "page_instance_id": "page-1779593669374-08vt",
        "target_page_id": "1",
        "conversation_id": "",
    }
    body = {
        "client_id": "tm-al4xco4l",
        "page_instance_id": "page-1779593669374-08vt",
        "page_type": "home",
        "conversation_id": "",
        "url": "https://chatgpt.com/",
    }
    assert server_module._message_matches_page(msg, body) is True


def test_message_matches_bootstrap_requires_home_page_type(server_module):
    msg = {
        "message_id": "m-bootstrap-home",
        "bootstrap_conversation": True,
        "client_id": "tm-al4xco4l",
        "page_instance_id": "page-1779593669374-08vt",
        "target_page_id": "1",
        "conversation_id": "",
    }
    body = {
        "client_id": "tm-al4xco4l",
        "page_instance_id": "page-1779593669374-08vt",
        "page_type": "conversation",
        "conversation_id": "",
    }
    assert server_module._message_matches_page(msg, body) is False


def test_unbound_without_bootstrap_hints_stays_unbound():
    remote = {
        "bind_state": BIND_STATE_UNBOUND,
        "client_id": "",
        "page_instance_id": "",
        "conversation_id": "",
        "url": "",
    }
    normalized = normalize_remote_chatgpt(remote)
    assert normalized["bind_state"] == BIND_STATE_UNBOUND
