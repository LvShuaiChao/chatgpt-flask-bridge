"""聊天区当前会话 / 绑定页面行展示 page_display_id。"""

import pytest
from PyQt5.QtWidgets import QApplication

from app.models import normalize_remote_chatgpt, remote_binding_enabled
from app.ui.widgets.segmented_elided_label import SegmentedElidedLabel


@pytest.fixture(scope="session")
def qapp():
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app
from app.ui.mixins.page_binding_display_mixin import PageBindingDisplayMixin
from app.ui.mixins.ui_status_compact_mixin import UiStatusCompactMixin
from tests.host_states import attach_main_window_states as init_main_window_states


class _Session:
    def __init__(self, session_id="s1", title="2121", remote=None):
        self.session_id = session_id
        self.title = title
        self.remote_chatgpt = remote or {}


class _Host(UiStatusCompactMixin, PageBindingDisplayMixin):
    def __init__(self):
        init_main_window_states(self)
        self._logs = []

    def _current_session(self):
        return getattr(self, "_session", None)

    def _append_log(self, text, echo=False):
        self._logs.append(text)

    def _session_display_title(self, session):
        return (session.title or "").strip() or "新对话"

    def _current_bound_tm_page(self, status=None, session=None):
        session = session or self._current_session()
        remote = normalize_remote_chatgpt(getattr(session, "remote_chatgpt", {}) or {})
        if not remote_binding_enabled(remote):
            return None
        client_id = (remote.get("client_id") or "").strip()
        page_instance_id = (remote.get("page_instance_id") or "").strip()
        key = f"{client_id}:{page_instance_id}"
        return self._registry.get(key)

    def _client_info_by_page_identity(self, client_id, page_instance_id, status=None):
        return self._registry.get(f"{client_id}:{page_instance_id}")

    def _client_info_by_id(self, client_id, status=None, page_instance_id=""):
        return self._registry.get(f"{client_id}:{page_instance_id}")

    def _get_selected_tm_page_from_combo(self, status=None):
        return getattr(self, "_combo_page", None)

    def _remote_conversation_id(self, remote):
        return (remote.get("conversation_id") or "").strip()

    def _remote_conversation_url(self, remote):
        return (remote.get("url") or "").strip()

    def _remote_bind_state(self, remote):
        return "bound_conversation" if remote_binding_enabled(remote) else "unbound"

    def _effective_bind_state(self, session):
        return "bound_conversation"

    def _fix_session_remote_url_from_conversation(self, session, echo=False):
        pass


@pytest.fixture
def host(qapp):
    h = _Host()
    h.current_session_url_label = SegmentedElidedLabel("")
    h._registry = {
        "tm-abc:page-inst-1": {
            "client_id": "tm-abc",
            "page_instance_id": "page-inst-1",
            "page_display_id": 2,
            "online": True,
        }
    }
    h._session = _Session(
        remote={
            "enabled": True,
            "client_id": "tm-abc",
            "page_instance_id": "page-inst-1",
            "conversation_id": "6a10768a-de10-83a6-8b4d-629fec09c77a",
            "conversation_url": "https://chatgpt.com/c/6a10768a-de10-83a6-8b4d-629fec09c77a",
        }
    )
    return h


def test_current_bound_page_display_id_from_bound_record(host):
    assert host._current_bound_page_display_id_text() == "2"


def test_format_current_session_header_with_page_id(host):
    text = host._format_current_session_header_with_page_id(host._session)
    assert text == "当前会话：2121 ｜ 页面ID：2"


def test_format_bound_page_line_with_url(host):
    text = host._format_bound_page_line_text(
        2,
        url="https://chatgpt.com/c/6a10768a-de10-83a6-8b4d-629fec09c77a",
    )
    assert text == (
        "绑定页面：页面ID:2 ｜ "
        "https://chatgpt.com/c/6a10768a-de10-83a6-8b4d-629fec09c77a"
    )


def test_format_bound_page_line_unbound(host):
    text = host._format_bound_page_line_text("-", state_text="未绑定 ChatGPT 页面")
    assert text == "绑定页面：页面ID:- ｜ 未绑定 ChatGPT 页面"


def test_update_current_session_url_display(host):
    host._update_current_session_url_display()
    assert host.current_session_url_label._full_text.startswith("绑定页面：页面ID:2")
    assert "chatgpt.com/c/" in host.current_session_url_label._full_text
    assert any("[CHAT_HEADER][BOUND_PAGE_ID]" in line for line in host._logs)


def test_session_list_bind_status_text(host):
    text = host._session_list_bind_status_text(host._session, "bound_online")
    assert text == "页面ID:2 ｜ 已绑定在线"


def test_fallback_to_combo_when_bound_record_missing_page_id(host):
    host._registry = {
        "tm-abc:page-inst-1": {
            "client_id": "tm-abc",
            "page_instance_id": "page-inst-1",
            "online": True,
        }
    }
    host._combo_page = {"page_display_id": 5, "client_id": "tm-other"}
    assert host._current_bound_page_display_id_text() == "5"


def test_missing_page_id_logs(host):
    host._registry = {}
    host._session = _Session(
        remote={
            "enabled": True,
            "client_id": "tm-missing",
            "page_instance_id": "page-x",
            "conversation_url": "https://chatgpt.com/c/abc",
        }
    )
    host._combo_page = None
    host._update_current_session_url_display()
    assert host._current_bound_page_display_id_text() == "-"
    assert any("[CHAT_HEADER][BOUND_PAGE_ID_MISSING]" in line for line in host._logs)
