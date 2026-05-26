"""target_source 仅接受强绑定模式枚举。"""

from app.utils.target_sources import (
    TARGET_SOURCE_BOUND_PAGE,
    TARGET_SOURCE_NO_SESSION,
    TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID,
    canonical_target_source,
    target_source_from,
)


def test_canonical_target_source_rejects_legacy_bound():
    assert canonical_target_source("bound") == ""


def test_canonical_target_source_rejects_legacy_auto_rebind():
    assert canonical_target_source("auto_rebind_by_conv") == ""


def test_canonical_target_source_rejects_legacy_conversation_fallbacks():
    assert canonical_target_source("conversation_id_fallback") == ""
    assert canonical_target_source("conversation_only_fallback") == ""
    assert canonical_target_source("same_conversation_latest_fallback") == ""
    assert canonical_target_source("selected_gui_page") == ""
    assert canonical_target_source("bound_page_offline") == ""


def test_canonical_target_source_canonical_passthrough():
    assert canonical_target_source(TARGET_SOURCE_BOUND_PAGE) == TARGET_SOURCE_BOUND_PAGE
    assert canonical_target_source(TARGET_SOURCE_NO_SESSION) == TARGET_SOURCE_NO_SESSION
    assert (
        canonical_target_source(TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID)
        == TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID
    )


def test_target_source_from_temp_home_page_display_id():
    assert target_source_from(
        {"target_source": TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID}
    ) == TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID
    assert canonical_target_source(TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID) == (
        TARGET_SOURCE_TEMP_HOME_PAGE_DISPLAY_ID
    )


def test_target_source_from_rejects_legacy_bound_client():
    assert target_source_from({"target_source": TARGET_SOURCE_BOUND_PAGE}) == (
        TARGET_SOURCE_BOUND_PAGE
    )
    assert target_source_from({"target_source": "bound_client"}) == ""
    assert target_source_from({"target_source": "bound"}) == ""
