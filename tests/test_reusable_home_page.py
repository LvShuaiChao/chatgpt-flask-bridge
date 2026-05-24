"""可复用 ChatGPT 首页判定与查找。"""

import time

from app.utils.page_status import (
    find_reusable_chatgpt_home_page,
    has_stable_conversation_id,
    is_chatgpt_home_location,
    is_reusable_chatgpt_home_page,
    page_list_display_id,
)


def _home_page(**overrides):
    now = time.time()
    base = {
        "client_id": "tm-test",
        "page_instance_id": "page-inst-1",
        "page_display_id": "4",
        "page_no": "4",
        "page_type": "home",
        "conversation_id": "",
        "url": "https://chatgpt.com/",
        "online": True,
        "last_poll_at": now,
        "last_seen": now,
    }
    base.update(overrides)
    return base


def test_has_stable_conversation_id_treats_dash_as_empty():
    assert not has_stable_conversation_id({"conversation_id": "-"})
    assert not has_stable_conversation_id({"conversation_id": ""})
    assert has_stable_conversation_id({"conversation_id": "abc-123"})


def test_is_chatgpt_home_location_by_url_or_pathname():
    assert is_chatgpt_home_location({"url": "https://chatgpt.com/"})
    assert is_chatgpt_home_location({"pathname": "/", "page_type": "home"})
    assert not is_chatgpt_home_location(
        {"url": "https://chatgpt.com/c/abc", "conversation_id": "abc"}
    )


def test_is_reusable_chatgpt_home_page_online_home_without_conv():
    assert is_reusable_chatgpt_home_page(_home_page())
    assert is_reusable_chatgpt_home_page(
        _home_page(conversation_id="-", url="https://chatgpt.com/")
    )
    assert not is_reusable_chatgpt_home_page(
        _home_page(url="https://chatgpt.com/c/xyz", conversation_id="xyz")
    )
    assert not is_reusable_chatgpt_home_page(
        _home_page(online=False, last_poll_at=0, last_seen=0)
    )


def test_find_reusable_prefers_selected_page_id():
    pages = [
        _home_page(page_display_id="3", client_id="tm-3"),
        _home_page(page_display_id="4", client_id="tm-4"),
    ]
    found = find_reusable_chatgpt_home_page(pages, "4")
    assert page_list_display_id(found) == "4"


def test_find_reusable_picks_most_recent_when_no_preference():
    older = time.time() - 60
    newer = time.time()
    pages = [
        _home_page(page_display_id="1", last_poll_at=older, last_seen=older),
        _home_page(page_display_id="2", last_poll_at=newer, last_seen=newer),
    ]
    found = find_reusable_chatgpt_home_page(pages, "")
    assert page_list_display_id(found) == "2"


def test_find_reusable_respects_eligible_filter():
    pages = [_home_page(page_display_id="4")]
    found = find_reusable_chatgpt_home_page(
        pages,
        "",
        is_eligible=lambda _page: False,
    )
    assert found is None
