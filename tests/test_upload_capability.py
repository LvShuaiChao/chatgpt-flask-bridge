"""上传能力统一判定回归。"""

import time

import pytest

from app.utils.page_status import evaluate_page_capability


@pytest.fixture
def server_module():
    import app.server as srv

    return srv


def test_evaluate_page_capability_upload_requires_bridge_and_online():
    now = time.time()
    page = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-1",
        "url": "https://chatgpt.com/c/conv-1",
        "page_type": "conversation",
        "last_seen": now,
        "upload_bridge_supported": False,
    }
    cap = evaluate_page_capability(page, action="upload", now=now)
    assert cap.allowed is False
    assert cap.reason_code == "upload_bridge_not_supported"

    page["upload_bridge_supported"] = True
    cap_ok = evaluate_page_capability(page, action="upload", now=now)
    assert cap_ok.allowed is True
    assert cap_ok.uploadable is True


def test_evaluate_control_command_target_sync_exact_match(server_module):
    msg = {
        "command": "start_upload",
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "conv-1",
    }
    body = {
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "conv-1",
        "page_type": "conversation",
        "url": "https://chatgpt.com/c/conv-1",
    }
    matched, reason = server_module.evaluate_control_command_target(msg, body)
    assert matched is True
    assert reason == ""


def test_evaluate_control_command_target_blocks_instance_mismatch(server_module):
    msg = {
        "command": "sync_conversation",
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "conv-1",
    }
    body = {
        "client_id": "client-a",
        "page_instance_id": "page-b",
        "conversation_id": "conv-1",
        "page_type": "conversation",
    }
    matched, reason = server_module.evaluate_control_command_target(msg, body)
    assert matched is False
    assert reason == "page_instance_mismatch"
