"""_patch_chat_send_target_payload 只校验不重选 target。"""



from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.main_window_state import init_main_window_states





class _Session:

    session_id = "s1"





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


