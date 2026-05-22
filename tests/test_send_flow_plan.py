"""发送主线：单次 resolve，plan 复用。"""
from unittest.mock import MagicMock

import pytest

from app.ui.mixins.send_flow_mixin import SendFlowMixin
from app.utils.page_status import PageActionPlan, PageCapability
from app.utils.send_plan import LocalTurn, SendPlan


class _PlanHost(SendFlowMixin):
    def __init__(self):
        self.resolve_page_action = MagicMock()
        self.resolve_send_decision = MagicMock()
        self._session_send_busy_reason = MagicMock(return_value="")
        self._check_bound_client_response_ready = MagicMock(return_value=(True, ""))
        self._bind_each_chat_to_page = False
        self._effective_bind_state = MagicMock(return_value="")
        self._append_log = MagicMock()

    def _apply_reopen_checks_to_plan(self, plan, content):
        return None


def test_build_send_plan_reuses_page_action_plan_without_second_resolve():
    host = _PlanHost()
    session = MagicMock(session_id="s1")
    turn = LocalTurn(
        session=session,
        content="hi",
        trace_id="t1",
        turn_id="turn-1",
        user_message_id="u1",
        assistant_message_id="a1",
    )
    cap = PageCapability(
        online=True,
        send_decision="allowed",
        client_id="c1",
        page_instance_id="p1",
        conversation_id="conv-1",
        url="https://chatgpt.com/c/conv-1",
    )
    existing = PageActionPlan(
        action="send",
        decision="allowed",
        target_source="bound_page",
        reason_code="",
        capability=cap,
    )
    plan = host._build_send_plan(
        turn, skip_prebind_checks=True, page_action_plan=existing
    )
    host.resolve_page_action.assert_not_called()
    host.resolve_send_decision.assert_not_called()
    assert plan.decision == "allowed"
    assert plan.client_id == "c1"
    assert plan.url == "https://chatgpt.com/c/conv-1"


def test_send_plan_accepts_message_source_kwarg():
    session = MagicMock(session_id="s1")
    turn = LocalTurn(
        session=session,
        content="hi",
        trace_id="t1",
        turn_id="turn-1",
        user_message_id="u1",
        assistant_message_id="a1",
    )
    plan = SendPlan(turn=turn, message_source="gui_click")
    assert plan.message_source == "gui_click"


def test_send_plan_page_property_uses_page_action():
    from app.utils.page_status import PageCapability

    cap = PageCapability(
        online=True,
        send_decision="allowed",
        client_id="c1",
        page_instance_id="p1",
        conversation_id="conv-1",
        url="https://chatgpt.com/c/conv-1",
    )
    page_action = PageActionPlan(
        action="send",
        decision="allowed",
        target_source="bound_page",
        reason_code="",
        capability=cap,
        page={"client_id": "legacy-dict"},
    )
    session = MagicMock(session_id="s1")
    turn = LocalTurn(
        session=session,
        content="hi",
        trace_id="t1",
        turn_id="turn-1",
        user_message_id="u1",
        assistant_message_id="a1",
    )
    plan = SendPlan(turn=turn)
    plan.apply_page_action(page_action)
    assert plan.page is page_action
    assert plan.page.client_id == "c1"
    assert plan.page.target_source == "bound_page"


def test_should_show_gui_log_keeps_send_plan_in_normal_mode():
    from app.utils.gui_logging import should_show_gui_log

    line = "[SEND][PLAN] trace_id=t1 decision=allowed client_id=c1"
    assert should_show_gui_log(line, "INFO", debug_mode=False) is True
