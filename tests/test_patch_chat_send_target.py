"""_patch_chat_send_target_payload 只校验不重选 target。"""

from app.models import BIND_STATE_TEMP_HOME_BOUND, write_session_remote_chatgpt
from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.main_window_state import init_main_window_states





class _Session:

    session_id = "s1"
    remote_chatgpt = {}





class _PatchHost(BridgeMixin):

    def __init__(self):
        init_main_window_states(self)

    def _append_log(self, text, echo=False):

        self._logs = getattr(self, "_logs", [])

        self._logs.append(text)





def test_patch_passes_when_canonical_target_fields_present():

    host = _PatchHost()

    session = _Session()

    payload = {

        "client_id": "c1",

        "page_instance_id": "p1",

        "conversation_id": "conv1",

        "url": "https://chatgpt.com/c/conv1",

        "content": "hi",

    }

    assert host._patch_chat_send_target_payload(session, payload) is True





def test_patch_fails_when_target_fields_missing():

    host = _PatchHost()

    session = _Session()

    payload = {"content": "hi", "session_id": "s1"}

    assert host._patch_chat_send_target_payload(session, payload) is False

    assert any("[SEND][PATCH_TARGET][FAIL]" in line for line in host._logs)

    assert "missing_fields" in host._logs[-1]





def test_patch_does_not_fill_from_session_when_only_client_id_legacy():

    host = _PatchHost()

    session = _Session()

    payload = {

        "client_id": "c1",

        "content": "hi",

    }

    assert host._patch_chat_send_target_payload(session, payload) is False

    assert "page_instance_id" in host._logs[-1] or "target_page_instance_id" in host._logs[-1]


def test_patch_allows_temp_home_without_conversation_id():
    host = _PatchHost()
    session = _Session()
    write_session_remote_chatgpt(
        session,
        bind_state=BIND_STATE_TEMP_HOME_BOUND,
        temp_page_id="4",
        page_display_id="4",
    )
    payload = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "",
        "url": "https://chatgpt.com/",
        "content": "你好",
    }
    assert host._patch_chat_send_target_payload(session, payload) is True
    assert payload.get("bootstrap_conversation") is True
    assert payload.get("target_page_id") == "4"
    assert payload.get("conversation_id") == ""
    assert any("mode=temp_home" in line for line in host._logs)
    assert any("[SEND][PATCH_TARGET][OK]" in line for line in host._logs)


def test_patch_still_requires_conversation_id_for_bound_conversation():
    host = _PatchHost()
    session = _Session()
    write_session_remote_chatgpt(
        session,
        bind_state="BOUND_CONVERSATION",
        conversation_id="conv-1",
    )
    payload = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "",
        "url": "https://chatgpt.com/c/conv-1",
        "content": "hi",
    }
    assert host._patch_chat_send_target_payload(session, payload) is False
    assert "conversation_id" in host._logs[-1]


def test_patch_allows_temp_home_when_effective_bind_state_is_offline():
    """持久化 TEMP_HOME_BOUND 时，即使 effective 为 BOUND_OFFLINE 也应允许 bootstrap。"""
    host = _PatchHost()
    session = _Session()
    write_session_remote_chatgpt(
        session,
        bind_state=BIND_STATE_TEMP_HOME_BOUND,
        temp_page_id="4",
        page_display_id="4",
        client_id="c1",
        page_instance_id="p1",
        url="https://chatgpt.com/",
    )
    host._effective_bind_state = lambda _session: "BOUND_OFFLINE"
    payload = {
        "client_id": "c1",
        "page_instance_id": "p1",
        "conversation_id": "",
        "url": "https://chatgpt.com/",
        "content": "你好",
    }
    assert host._patch_chat_send_target_payload(session, payload) is True
    assert payload.get("bootstrap_conversation") is True
    assert payload.get("target_page_id") == "4"
    assert payload.get("conversation_id") == ""


