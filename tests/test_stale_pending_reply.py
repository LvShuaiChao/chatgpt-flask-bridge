"""stale pending_reply：无 bridge_message_id / 超时 / 页面 idle 应清理且不拦截发送。"""
import time
from unittest.mock import MagicMock

import pytest

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    PENDING_REPLY_HARD_TIMEOUT_SECONDS,
)
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    ChatMessage,
    ChatSession,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.ui.mixins.bridge_mixin import BridgeMixin
from app.ui.mixins.send_flow_mixin import SendFlowMixin
from app.ui.mixins.session_mixin import SessionMixin
from app.utils.send_plan import LocalTurn


class _PendingHost(SessionMixin, SendFlowMixin, BridgeMixin):
    def __init__(self):
        self._sessions = {}
        self._bridge_msg = MagicMock()
        self._bridge_msg.finalized_bridge_message_ids = set()
        self._bridge_msg.ack_success_message_ids = set()
        self._bridge_ui = MagicMock(last_bridge_status={})
        self._current_session_id = ""
        self._append_log = MagicMock()
        self._save_sessions_to_disk = MagicMock()
        self._refresh_session_list = MagicMock()
        self._auto_bind = MagicMock(pending_session_id="")
        self._session_send_queues = {}
        self._message_to_session = {}
        self._message_to_turn = {}
        self.resolve_page_action = MagicMock()
        self._check_bound_client_response_ready = MagicMock(return_value=(True, ""))
        self._bind_each_chat_to_page = False
        self._effective_bind_state = MagicMock(return_value="bound_conversation")
        self._session_bound_page_display_id_text = MagicMock(return_value="5")
        self._apply_reopen_checks_to_plan = MagicMock(return_value=None)
        self._save_chat_history = True

    def _is_session_unbound(self, session):
        return False

    def _is_finalized(self, bridge_message_id):
        return bridge_message_id in self._bridge_msg.finalized_bridge_message_ids

    def _finalize_bridge(self, bridge_message_id):
        self._bridge_msg.finalized_bridge_message_ids.add(bridge_message_id)

    def _mark_session_waiting_finished(self, session, reason=""):
        session.reply_waiting_since = 0

    def _mark_session_waiting_started(self, session, reason=""):
        session.reply_waiting_since = time.time()

    def request_sync_conversation(self, session, reason=""):
        return True, "ok"

    def _client_info_by_id(self, client_id, status=None, page_instance_id=""):
        return {
            "can_accept_input": True,
            "is_responding": False,
            "response_state": "idle",
        }

    def _remote_bind_state(self, remote):
        return (remote.get("bind_state") or "").strip()


def _session_with_local_placeholder(
    *, bridge_id="", created_at=None, use_local_parent=True
):
    remote = normalize_remote_chatgpt(default_remote_chatgpt())
    remote.update(
        {
            "client_id": "tm-c1",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
        }
    )
    now = time.time()
    session = ChatSession(
        session_id="s1",
        title="test",
        created_at=now,
        updated_at=now,
        remote_chatgpt=remote,
    )
    session.reply_waiting_since = created_at or time.time()
    user = ChatMessage(
        role="user",
        content="hi",
        message_id="u1",
        turn_id="t1",
        message_source="local_send",
        created_at=time.time(),
    )
    assistant = ChatMessage(
        role="assistant",
        content=ASSISTANT_WAIT_TEXT,
        message_id="a1",
        turn_id="t1",
        ui_status="waiting",
        parent_message_id="u1" if use_local_parent else "",
        message_source="local_placeholder" if use_local_parent else "bridge_send",
        bridge_message_id=bridge_id,
        created_at=created_at or time.time(),
    )
    session.messages = [user, assistant]
    return session


def test_stale_pending_missing_bridge_message_id():
    host = _PendingHost()
    old = time.time() - PENDING_REPLY_HARD_TIMEOUT_SECONDS - 5
    session = _session_with_local_placeholder(
        use_local_parent=False, created_at=old
    )
    session.reply_waiting_since = old
    pending = host._get_pending_reply_state(session)
    assert pending is not None
    assert not host._pending_reply_is_actionable(session, pending)
    assert host._stale_pending_clear_reason(session, pending) == "missing_bridge_message_id"
    assert host._is_stale_pending_reply(session, pending)
    assert host._session_send_busy_reason(session) == ""


def test_stale_pending_not_cleared_before_hard_timeout():
    host = _PendingHost()
    # Under sync-timeout (45s) and hard-timeout (180s) thresholds.
    old = time.time() - 30
    session = _session_with_local_placeholder(
        bridge_id="bridge-1", created_at=old
    )
    session.reply_waiting_since = old
    assert not host._is_stale_pending_reply(session)
    assert not host._clear_stale_pending_reply_before_send(session)


def test_stale_pending_timeout():
    host = _PendingHost()
    old = time.time() - PENDING_REPLY_HARD_TIMEOUT_SECONDS - 5
    session = _session_with_local_placeholder(
        bridge_id="bridge-1", created_at=old
    )
    session.reply_waiting_since = old
    assert host._is_stale_pending_reply(session)
    assert host._clear_stale_pending_reply_before_send(session)
    assert host._get_pending_reply_state(session) is None


def test_stale_pending_page_idle_not_cleared_when_young():
    host = _PendingHost()
    session = _session_with_local_placeholder(bridge_id="bridge-2")
    assert host._bound_page_indicates_idle(session)
    assert not host._is_stale_pending_reply(session)
    assert host._session_send_busy_reason(session) == "pending_reply"


def test_maybe_recover_pending_reply_requests_sync_once():
    host = _PendingHost()
    session = _session_with_local_placeholder(bridge_id="bridge-sync")
    session.reply_waiting_since = time.time() - 50
    for message in session.messages:
        if message.role == "assistant":
            message.created_at = session.reply_waiting_since
    assert host._maybe_recover_pending_reply(session) is True
    assert session.pending_sync_requested is True
    assert host._maybe_recover_pending_reply(session) is False


def test_stale_pending_cleared_after_timeout_even_when_page_idle():
    host = _PendingHost()
    old = time.time() - PENDING_REPLY_HARD_TIMEOUT_SECONDS - 5
    session = _session_with_local_placeholder(bridge_id="bridge-2", created_at=old)
    session.reply_waiting_since = old
    assert host._bound_page_indicates_idle(session)
    assert host._stale_pending_clear_reason(session) == "hard_timeout"
    assert host._is_stale_pending_reply(session)


def test_stale_pending_not_cleared_when_page_generating():
    host = _PendingHost()

    def _generating(*_a, **_k):
        return {
            "can_accept_input": False,
            "is_responding": True,
            "response_state": "generating",
        }

    host._client_info_by_id = _generating
    session = _session_with_local_placeholder(bridge_id="bridge-gen")
    assert host._bound_page_indicates_busy(session)
    assert not host._is_stale_pending_reply(session)


def test_actionable_pending_blocks_send():
    host = _PendingHost()

    def _busy_page(*_a, **_k):
        return {
            "can_accept_input": False,
            "is_responding": True,
            "response_state": "generating",
        }

    host._client_info_by_id = _busy_page
    session = _session_with_local_placeholder(
        bridge_id="bridge-live", use_local_parent=False
    )
    assert host._session_send_busy_reason(session) == "pending_reply"


def test_orphan_reply_waiting_since_cleared_before_send():
    host = _PendingHost()
    session = _session_with_local_placeholder(use_local_parent=True)
    session.messages = []
    session.reply_waiting_since = time.time() - (PENDING_REPLY_HARD_TIMEOUT_SECONDS + 30)
    assert host._clear_stale_pending_reply_before_send(session)
    assert float(session.reply_waiting_since or 0) <= 0
    assert host._session_send_busy_reason(session) == ""


def test_build_send_plan_clears_stale_local_placeholder():
    host = _PendingHost()
    session = _session_with_local_placeholder(use_local_parent=False)
    host._sessions[session.session_id] = session
    turn = LocalTurn(
        session=session,
        content="你好",
        trace_id="tr1",
        turn_id="t2",
        user_message_id="u2",
        assistant_message_id="a2",
    )
    from app.utils.page_status import PageActionPlan, PageCapability

    cap = PageCapability(
        online=True,
        send_decision="allowed",
        client_id="tm-c1",
        page_instance_id="p1",
        conversation_id="conv-1",
        url="https://chatgpt.com/c/conv-1",
    )
    host.resolve_page_action.return_value = PageActionPlan(
        action="send",
        decision="allowed",
        target_source="bound_page",
        reason_code="",
        capability=cap,
    )
    plan = host._build_send_plan(turn, source="gui_click")
    assert plan.decision == "allowed"
    assert plan.reason != "pending_reply"


def test_apply_busy_pending_reply_status_text():
    from app.utils.send_plan import SendPlan

    host = _PendingHost()
    session = _session_with_local_placeholder(bridge_id="b1")
    turn = LocalTurn(
        session=session,
        content="x",
        trace_id="t",
        turn_id="t",
        user_message_id="u",
        assistant_message_id="a",
    )
    plan = SendPlan(turn=turn)
    plan = host._apply_busy_to_plan(plan, "pending_reply")
    assert plan.block_status == "当前仍在等待上一条回复"
    assert plan.render_reason == "send_waiting_prior_reply"
