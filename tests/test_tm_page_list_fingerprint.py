"""页面列表 fingerprint 与聊天清空跳过。"""

from app.utils.gui_logging import TmPageListLogAggregator, should_show_gui_log


def test_tm_page_list_log_aggregator_summary():
    agg = TmPageListLogAggregator(interval_sec=0.001)
    agg.record("fetch")
    agg.record("normalize")
    agg.record("dedupe")
    line = agg.flush()
    assert line is not None
    assert "[TM_PAGE_LIST][SUMMARY_THROTTLED]" in line
    assert "fetch_count=1" in line
    assert should_show_gui_log(line, "INFO", debug_mode=False) is False


def test_should_show_gui_log_skip_rebuild_visible():
    line = (
        "[TM_PAGE_LIST][SKIP_REBUILD] reason=fingerprint_unchanged "
        "count=3 fingerprint=()"
    )
    assert should_show_gui_log(line, "INFO", debug_mode=False) is True


def test_should_show_gui_log_fetch_hidden_in_normal_mode():
    assert (
        should_show_gui_log("[TM_PAGE_LIST][FETCH] raw_count=14", "INFO", debug_mode=False)
        is False
    )


class _ClearHost:
    def __init__(self):
        self._current_session_id = "s1"
        self._sessions = {
            "s1": type("S", (), {"session_id": "s1", "messages": [], "updated_at": 0})(),
        }
        self._logs = []

    def _current_session(self):
        return self._sessions.get(self._current_session_id)

    def _append_log(self, text, echo=False):
        self._logs.append(text)


def test_clear_skip_on_auto_bind_reason():
    from app.ui.mixins.session_mixin import SessionMixin

    class Host(SessionMixin, _ClearHost):
        pass

    host = Host()
    host._clear_current_session_messages_before_rebind_or_sync(
        reason="auto_bind_conversation"
    )
    assert any("[CHAT][CLEAR_SKIP]" in line for line in host._logs)
    assert not any("[CHAT][CLEAR_BEFORE_BIND_OR_SYNC]" in line for line in host._logs)
