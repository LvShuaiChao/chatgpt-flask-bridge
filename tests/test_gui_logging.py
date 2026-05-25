from app.utils.gui_logging import (
    adjust_level_for_message,
    infer_level_from_message,
    level_for_decision_message,
    should_show_gui_log,
)


def test_infer_level_from_message():
    assert infer_level_from_message("[BRIDGE][POLL][NO_MESSAGE] reason=queue_empty") == "DEBUG"
    assert infer_level_from_message("[SEND][FAILED] timeout") == "ERROR"
    assert (
        infer_level_from_message(
            '[BRIDGE][JSON][TM_TO_SERVER] action=poll json={"action":"poll"}'
        )
        == "DEBUG"
    )


def test_should_show_gui_log_blocks_noisy_in_normal_mode():
    assert should_show_gui_log("[TM][HEARTBEAT] client_id=x", "DEBUG", debug_mode=False) is False
    assert should_show_gui_log("[BRIDGE_CLIENT_REPORT][RECV] client_id=x", "INFO", debug_mode=False) is False
    assert should_show_gui_log("[TM_PAGE_LIST][REFRESH] client_id=x", "INFO", debug_mode=False) is False
    assert should_show_gui_log("[SEND][DECISION] client_id=x", "INFO", debug_mode=False) is False
    assert should_show_gui_log("[BRIDGE][POLL][REQUEST] client_id=x", "INFO", debug_mode=False) is False
    assert should_show_gui_log(
        '[BRIDGE][JSON][TM_TO_SERVER] action=poll json={"action":"poll"}',
        "INFO",
        debug_mode=False,
    ) is False
    assert should_show_gui_log("油猴页面已连接", "INFO", debug_mode=False) is True
    assert should_show_gui_log("[SEND][FAILED] timeout", "ERROR", debug_mode=False) is True


def test_should_show_gui_log_debug_mode_still_hides_noisy():
    assert should_show_gui_log("[TM][HEARTBEAT] client_id=x", "DEBUG", debug_mode=True) is False
    assert should_show_gui_log("[ACTION_DECISION] allowed=true", "DEBUG", debug_mode=True) is True


def test_should_show_gui_log_bind_identity_missing_visible():
    line = "[BIND][IDENTITY_MISSING] client_id=c1 page_instance_id=p1 conversation_id=conv1"
    assert should_show_gui_log(line, "INFO", debug_mode=False) is True


def test_should_show_gui_log_target_mismatch_warning_visible():
    line = (
        "[SYNC][TARGET_MISMATCH] session_id=s1 mismatch_type=client_id "
        "bound_client_id=c1 target_client_id=c2"
    )
    assert should_show_gui_log(line, "WARNING", debug_mode=False) is True


def test_level_for_decision_message():
    assert level_for_decision_message("[ACTION_DECISION] allowed=true reason_code=-") == "DEBUG"
    assert level_for_decision_message("[SYNC][DECISION] allowed=false reason_code=offline") == "WARNING"
    assert level_for_decision_message("[ACTION_DECISION] allowed=true reason=no_online_page") == "WARNING"


def test_adjust_level_for_message():
    assert adjust_level_for_message("[ACTION_CAPABILITY] allowed=false", "INFO") == "WARNING"
    assert adjust_level_for_message("[TM][HEARTBEAT] x", "INFO") == "DEBUG"
    assert adjust_level_for_message("[SEND][DECISION] x", "INFO") == "DEBUG"
    assert adjust_level_for_message("[BRIDGE_CLIENT_REPORT][OK] x", "INFO") == "DEBUG"


def test_compact_page_decision_fields():
    from app.utils.page_status import compact_page_decision_fields, log_page_decision_fields

    detail = {
        "page_display_id": 3,
        "conversation_id": "conv-1",
        "client_id": "tm-1",
        "page_instance_id": "page-1",
        "url": "https://chatgpt.com/c/conv-1",
        "send_requestable": True,
    }
    compact = compact_page_decision_fields(detail)
    assert "page_display_id=3" in compact
    assert "send_requestable=" not in compact
    full = log_page_decision_fields(detail, compact=False)
    assert "send_requestable=true" in full
    assert log_page_decision_fields(detail, compact=True) == compact
    assert (
        adjust_level_for_message(
            "[HTTP][REQUEST] method=POST path=/api/bridge remote=127.0.0.1",
            "INFO",
        )
        == "DEBUG"
    )
    assert (
        adjust_level_for_message(
            "[HTTP][RESPONSE] method=POST path=/api/bridge status=200 cost_ms=12",
            "INFO",
        )
        == "DEBUG"
    )
    assert (
        adjust_level_for_message(
            "[BRIDGE][JSON][TM_TO_SERVER] action=report event=focus_state client_id=x",
            "INFO",
        )
        == "DEBUG"
    )
    assert adjust_level_for_message("[TM][FOCUS_STATE] client_id=x", "INFO") == "DEBUG"


def test_should_show_gui_log_blocks_sync_target_resolve_in_normal_mode():
    line = "[SYNC][TARGET_RESOLVE] trace_id=t1 client_id=c1 conversation_id=conv1"
    assert should_show_gui_log(line, "INFO", debug_mode=False) is False


def test_should_show_gui_log_keeps_send_block_in_normal_mode():
    line = (
        "[SEND][BLOCK] session_id=s1 reason=bound_page_offline "
        "page_display_id=1 conversation_id=conv1 target_source=bound_page"
    )
    assert should_show_gui_log(line, "WARNING", debug_mode=False) is True


def test_should_show_gui_log_hides_tm_page_list_summary_in_normal_mode():
    line = "[TM_PAGE_LIST][SUMMARY] total=3 online=2 bound=1 available=1"
    assert should_show_gui_log(line, "INFO", debug_mode=False) is False


def test_should_show_gui_log_hides_summary_throttled_in_normal_mode():
    line = (
        "[TM_PAGE_LIST][SUMMARY_THROTTLED] fetch_count=5 normalize_count=5 "
        "dedupe_count=5 duration_ms=1000"
    )
    assert should_show_gui_log(line, "INFO", debug_mode=False) is False


def test_should_show_gui_log_result_allowlist_in_normal_mode():
    assert should_show_gui_log(
        "[SYNC][TARGET_SELECTED] session_id=s1 target_client_id=c1",
        "INFO",
        debug_mode=False,
    ) is True
    assert should_show_gui_log(
        "[PAGE_LIST][REFRESH][DONE] reason=after_heavy_skip",
        "INFO",
        debug_mode=False,
    ) is True
    assert should_show_gui_log(
        "[CHAT_SEND][ENQUEUED] session_id=s1",
        "INFO",
        debug_mode=False,
    ) is True
    assert should_show_gui_log(
        "[PAGE_ACTION][DECIDE] action=send allowed=yes",
        "INFO",
        debug_mode=False,
    ) is False
    assert should_show_gui_log(
        "[BIND_STATE][MISMATCH] session_id=s1",
        "INFO",
        debug_mode=False,
    ) is False
