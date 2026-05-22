"""P0 收敛：同会话 fallback 策略、严格控制命令匹配、当前页身份。"""

import pytest

from app.ui.mixins.page_send_target_mixin import PageSendTargetMixin


class _FallbackHost(PageSendTargetMixin):
    def __init__(self):
        self._logs = []

    def _append_log(self, text, echo=False):
        self._logs.append(text)

    def _remote_conversation_id(self, remote):
        return (remote or {}).get("conversation_id") or ""


class _Session:
    def __init__(self, session_id="s1", remote=None):
        self.session_id = session_id
        self.remote_chatgpt = remote or {}


def test_same_conversation_fallback_send_default_off():
    host = _FallbackHost()
    assert host.is_same_conversation_fallback_enabled("send") is False


def test_same_conversation_fallback_sync_default_off():
    host = _FallbackHost()
    assert host.is_same_conversation_fallback_enabled("sync") is False
    assert host.is_same_conversation_fallback_enabled("sync_conversation") is False


def test_same_conversation_fallback_always_off():
    host = _FallbackHost()
    assert host.is_same_conversation_fallback_enabled("send") is False
    assert host.is_same_conversation_fallback_enabled("sync") is False


def test_targeted_control_strict_instance_requires_page_instance(server_module):
    """严格命令不允许仅 conversation_id 匹配（client 不一致）。"""
    msg = {
        "command": "sync_conversation",
        "client_id": "client-a",
        "conversation_id": "conv-1",
    }
    body = {
        "client_id": "client-b",
        "page_instance_id": "page-b",
        "conversation_id": "conv-1",
    }
    assert server_module._targeted_control_matches(msg, body) is False


def test_targeted_control_sync_fallback_without_page_instance(server_module):
    """poll 阶段不得仅靠 conversation 模糊匹配到其它 page_instance。"""
    msg = {
        "command": "sync_conversation",
        "client_id": "client-a",
        "conversation_id": "conv-1",
        "allow_same_conversation_fallback": True,
    }
    body = {
        "client_id": "client-a",
        "page_instance_id": "page-b",
        "conversation_id": "conv-1",
        "page_type": "conversation",
    }
    assert server_module._targeted_control_matches(msg, body) is False


def test_targeted_control_strict_instance_exact_match(server_module):
    msg = {
        "command": "start_upload",
        "client_id": "client-a",
        "page_instance_id": "page-a",
    }
    body = {
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "conv-1",
    }
    assert server_module._targeted_control_matches(msg, body) is True


def test_targeted_control_sync_no_fallback_on_instance_mismatch(server_module):
    """存在 target_page_instance_id 时，不得仅靠 conversation_id 匹配到其它实例。"""
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
    assert server_module._targeted_control_matches(msg, body) is False


def test_enqueue_control_command_writes_conversation_id_not_legacy(server_module):
    """enqueue 入队控制消息应写 conversation_id，不再写 target_conversation_id。"""
    with server_module._state_lock:
        server_module._control_queue.clear()
    from app.utils.page_status import build_page_key

    server_module._tampermonkey_pages[build_page_key("c1", "p1")] = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-1",
        "page_type": "conversation",
        "last_seen": server_module._now(),
    }
    result = server_module.enqueue_control_command(
        "sync_conversation",
        client_id="c1",
        page_instance_id="p1",
        conversation_id="conv-1",
        payload={"request_id": "req-1"},
    )
    assert result.get("ok") is True
    msg = result.get("message") or {}
    assert msg.get("conversation_id") == "conv-1"
    assert "target_conversation_id" not in msg
    with server_module._state_lock:
        queued = list(server_module._control_queue)
        server_module._control_queue.clear()
    assert len(queued) == 1
    assert queued[0].get("conversation_id") == "conv-1"
    assert "target_conversation_id" not in queued[0]


def test_enqueue_control_command_sync_blocks_home_via_capability(server_module):
    """sync_conversation 须通过 evaluate_page_capability，首页不得入队。"""
    from app.utils.page_status import build_page_key

    with server_module._state_lock:
        server_module._control_queue.clear()
    server_module._tampermonkey_pages[build_page_key("c1", "p1")] = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "",
        "page_type": "home",
        "url": "https://chatgpt.com/",
        "last_seen": server_module._now(),
    }
    result = server_module.enqueue_control_command(
        "sync_conversation",
        client_id="c1",
        page_instance_id="p1",
        conversation_id="conv-1",
    )
    assert result.get("ok") is False
    assert result.get("reason")


def test_registry_strict_instance_missing_page_instance(server_module):
    assert server_module._registry_entry_for_client("c1", "", strict_instance=True) == {}


def test_waiting_messages_match_page_instance(server_module):
    body = {
        "client_id": "client-a",
        "page_instance_id": "page-a",
        "conversation_id": "conv-1",
        "page_type": "conversation",
    }
    msg_exact = {
        "message_id": "m1",
        "delivered_to": "client-a",
        "delivered_page_instance_id": "page-a",
        "message_status": "delivered",
    }
    msg_other = {
        "message_id": "m2",
        "delivered_to": "client-a",
        "delivered_page_instance_id": "page-b",
        "message_status": "delivered",
    }
    with server_module._state_lock:
        server_module._outbound_waiting.clear()
        server_module._outbound_waiting["m1"] = msg_exact
        server_module._outbound_waiting["m2"] = msg_other
    waiting = server_module._waiting_messages_for_page(body)
    assert len(waiting) == 1
    assert waiting[0]["message_id"] == "m1"


def test_claim_message_records_page_delivery_fields(server_module):
    msg = {"message_id": "m-claim", "conversation_id": "conv-1"}
    body = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "conv-1",
    }
    server_module._claim_message(msg, body)
    assert msg["delivered_to"] == "c1"
    assert msg["delivered_page_instance_id"] == "p1"
    assert msg["delivered_page_key"] == "c1|p1"
    assert msg["delivered_conversation_id"] == "conv-1"


def test_build_page_key_requires_both_ids():
    from app.utils.page_status import build_page_key

    assert build_page_key("c1", "p1") == "c1|p1"
    assert build_page_key("c1", "") == ""
    assert build_page_key("", "p1") == ""


def test_bound_online_only_exact_instance(server_module):
    """conversation fallback 不得把 bound_online 置为 True。"""
    now = server_module._now()
    exact = {
        "client_id": "bound-c",
        "page_instance_id": "bound-p",
        "conversation_id": "conv-1",
        "last_seen": now - 9999,
        "page_type": "conversation",
    }
    fallback = {
        "client_id": "other-c",
        "page_instance_id": "other-p",
        "conversation_id": "conv-1",
        "last_seen": now,
        "page_type": "conversation",
    }
    summary = server_module.get_tm_online_summary(
        bound_client_id="bound-c",
        bound_page_instance_id="bound-p",
        bound_conversation_id="conv-1",
        snapshot_clients=[exact, fallback],
    )
    assert summary["exact_bound_online"] is False
    assert summary["bound_online"] is False
    assert summary["bound_effective_online"] is True
    assert summary["bound_actionable"] is True
    assert summary["same_conversation_online"] is True
    assert summary["binding_match_mode"] == "conversation_fallback"
    assert summary["same_conversation_client_id"] == "other-c"
    assert summary["same_conversation_page_instance_id"] == "other-p"


def test_bound_online_exact_when_instance_online(server_module):
    now = server_module._now()
    exact = {
        "client_id": "bound-c",
        "page_instance_id": "bound-p",
        "conversation_id": "conv-1",
        "last_seen": now,
        "page_type": "conversation",
    }
    summary = server_module.get_tm_online_summary(
        bound_client_id="bound-c",
        bound_page_instance_id="bound-p",
        bound_conversation_id="conv-1",
        snapshot_clients=[exact],
    )
    assert summary["exact_bound_online"] is True
    assert summary["bound_online"] is True
    assert summary["bound_match_mode"] == "exact_instance"
    assert summary["bound_actionable"] is True
    assert summary["binding_match_mode"] == "exact_instance"


@pytest.fixture
def server_module():
    import importlib
    import server as srv

    return importlib.reload(srv)
