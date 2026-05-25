"""页面列表 fingerprint 日志聚合与展示规则。"""

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
