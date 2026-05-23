"""TEMP_HOME_BOUND 首条发送：不得被 prebound_home_wait_conversation 拦截。"""
from unittest.mock import MagicMock

import pytest

from app.models import BIND_STATE_TEMP_HOME_BOUND, write_session_remote_chatgpt
from app.ui.mixins.send_flow_mixin import SendFlowMixin
from app.utils.send_plan import LocalTurn


class _TempHomeHost(SendFlowMixin):
    def __init__(self, *, busy_reason="", temp_matched=True):
        self._busy = busy_reason
        self._temp_matched = temp_matched
        self._append_log = MagicMock()
        self._bind_each_chat_to_page = False
        self._auto_clear_input_after_send = False

    def _is_session_unbound(self, session):
        return False

    def _session_send_busy_reason(self, session):
        return self._busy

    def _check_bound_client_response_ready(self, session):
        return True, ""

    def _effective_bind_state(self, session):
        return BIND_STATE_TEMP_HOME_BOUND

    def _is_temp_home_bound_state(self, bind_state):
        from app.models import is_temp_home_bound_state

        return is_temp_home_bound_state(bind_state)

    def _resolve_temp_home_send_target(self, session, remote=None):
        if not self._temp_matched:
            return {
                "matched": False,
                "temp_page_id": "8",
                "reason_code": "temp_home_page_not_found",
            }
        return {
            "matched": True,
            "temp_page_id": "8",
            "url": "https://chatgpt.com/",
            "client_id": "client-8",
            "page_instance_id": "inst-8",
            "conversation_id": "",
            "reason_code": "",
            "page_raw": {
                "page_display_id": "8",
                "client_id": "client-8",
                "page_instance_id": "inst-8",
                "page_type": "home",
                "url": "https://chatgpt.com/",
            },
        }

    def _apply_reopen_checks_to_plan(self, plan, content):
        return None

    def _log_send_plan(self, plan):
        pass


def test_build_send_plan_allows_temp_home_before_busy_check():
    host = _TempHomeHost(busy_reason="prebound_home_wait_conversation")
    session = MagicMock(session_id="s1")
    write_session_remote_chatgpt(
        session,
        bind_state=BIND_STATE_TEMP_HOME_BOUND,
        temp_page_id="8",
        page_display_id="8",
        client_id="client-8",
    )
    turn = LocalTurn(
        session=session,
        content="你好",
        trace_id="t1",
        turn_id="turn-1",
        user_message_id="u1",
        assistant_message_id="a1",
    )
    plan = host._build_send_plan(turn, source="gui_click")
    assert plan.decision == "allowed"
    assert plan.reason != "prebound_home_wait_conversation"
    assert plan.is_bootstrap is True
    assert plan.target_page_id == "8"
    assert plan.conversation_id == ""


def test_session_send_busy_reason_empty_when_temp_home_online():
    from app.ui.mixins.bridge_mixin import BridgeMixin

    class _BusyHost(BridgeMixin):
        pass

    host = _BusyHost.__new__(_BusyHost)
    host._auto_bind = MagicMock(pending_session_id="")
    host._is_temp_home_bound_state = lambda bind_state: True  # noqa: E731
    host._resolve_temp_home_send_target = lambda session, remote=None: {  # noqa: E731
        "matched": True,
        "temp_page_id": "8",
    }
    host._get_pending_reply_state = lambda session: None  # noqa: E731
    host._session_has_pending_assistant_reply = lambda session: False  # noqa: E731
    host._session_bound_response_state = lambda session: {}  # noqa: E731
    host._remote_bind_state = staticmethod(  # type: ignore[method-assign]
        lambda remote: BIND_STATE_TEMP_HOME_BOUND
    )

    session = MagicMock(session_id="s1")
    write_session_remote_chatgpt(
        session,
        bind_state=BIND_STATE_TEMP_HOME_BOUND,
        temp_page_id="8",
    )
    assert host._session_send_busy_reason(session) == ""
