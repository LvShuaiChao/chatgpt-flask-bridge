"""页面列表按 page_display_id 数字升序排序。"""

from app.utils.page_status import (
    page_display_id_sort_key,
    page_display_ids_for_log,
    sort_pages_by_display_id,
)


def _page(page_display_id, client_id):
    return {
        "client_id": client_id,
        "page_instance_id": f"inst-{client_id}",
        "page_display_id": page_display_id,
        "page_no": page_display_id,
    }


def test_sort_pages_by_display_id_numeric_ascending():
    pages = [
        _page(10, "c10"),
        _page(2, "c2"),
        _page(1, "c1"),
        _page(3, "c3"),
    ]
    sorted_pages = sort_pages_by_display_id(pages)
    assert page_display_ids_for_log(sorted_pages) == ["1", "2", "3", "10"]


def test_sort_pages_puts_missing_id_last():
    pages = [
        _page(2, "c2"),
        {"client_id": "c-none", "page_instance_id": "inst-none"},
        _page(1, "c1"),
    ]
    sorted_pages = sort_pages_by_display_id(pages)
    assert page_display_ids_for_log(sorted_pages) == ["1", "2", "-"]


def test_page_display_id_sort_key_uses_page_no_fallback():
    page = {"page_no": "7"}
    assert page_display_id_sort_key(page) == (0, 7)


def test_sort_does_not_mutate_page_id_values():
    pages = [_page(10, "c10"), _page(2, "c2")]
    before = [p["page_display_id"] for p in pages]
    sort_pages_by_display_id(pages)
    after = [p["page_display_id"] for p in pages]
    assert before == after
