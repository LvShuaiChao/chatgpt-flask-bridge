"""_append_local_send_turn：message id 来自 turn，不裸用未定义变量。"""
from unittest.mock import MagicMock

from app.ui.mixins.send_flow_mixin import SendFlowMixin, _turn_get
from app.utils.send_plan import LocalTurn


class _AppendHost(SendFlowMixin):
    def __init__(self):
        self._show_assistant_placeholder = True
        self._auto_clear_input_after_send = False
        self.message_edit = MagicMock()
        self._append_log = MagicMock()
        self._save_sessions_to_disk = MagicMock()
        self._pending = {}

    def _append_message_to_session(self, session_id, message):
        return True

    def _mark_session_waiting_started(self, session, reason=""):
        pass


def test_turn_get_dict_and_object():
    turn = LocalTurn(
        session=MagicMock(session_id="s1"),
        content="hi",
        trace_id="t1",
        turn_id="turn-1",
        user_message_id="u1",
        assistant_message_id="a1",
    )
    assert _turn_get(turn, "user_message_id") == "u1"
    assert _turn_get({"user_message_id": "u2"}, "user_message_id") == "u2"


def test_append_local_send_turn_uses_turn_ids():
    host = _AppendHost()
    session = MagicMock(session_id="s1", messages=[])
    turn = LocalTurn(
        session=session,
        content="你好",
        trace_id="trace-1",
        turn_id="turn-fixed",
        user_message_id="user-fixed",
        assistant_message_id="asst-fixed",
    )
    appended = []
    original_append = host._append_message_to_session

    def capture_append(session_id, message):
        appended.append(message)
        return original_append(session_id, message)

    host._append_message_to_session = capture_append
    result = host._append_local_send_turn(turn, clear_input=False)

    assert result == {
        "user_message_id": "user-fixed",
        "assistant_message_id": "asst-fixed",
        "turn_id": "turn-fixed",
    }
    assert len(appended) == 2
    assert appended[0]["message_id"] == "user-fixed"
    assert appended[0]["turn_id"] == "turn-fixed"
    assert appended[1]["message_id"] == "asst-fixed"
    assert appended[1]["parent_message_id"] == "user-fixed"


def test_fail_local_send_turn_skips_status_when_not_appended():
    host = _AppendHost()
    host._find_session_message_by_id = MagicMock(return_value=None)
    host._update_local_user_message_status = MagicMock()
    host._add_system_message = MagicMock()
    host._mark_session_waiting_finished = MagicMock()
    host._apply_chat_bind_visual_state = MagicMock()

    session = MagicMock(session_id="s1", messages=[])
    turn = LocalTurn(
        session=session,
        content="hi",
        trace_id="t1",
        turn_id="turn-1",
        user_message_id="u1",
        assistant_message_id="a1",
    )
    from app.utils.send_plan import SendPlan

    plan = SendPlan(turn=turn)
    host._fail_local_send_turn(
        plan,
        error=NameError("user_message_id"),
        stage="push_message_impl",
        local_messages_appended=False,
    )
    host._update_local_user_message_status.assert_not_called()
    host._add_system_message.assert_called_once_with(
        "发送失败：本地消息创建失败，未发送到网页。"
    )
