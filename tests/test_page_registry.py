"""PageRegistry / PageSnapshot 单元测试。"""

import time
import unittest

from app.models import BIND_STATE_BOUND_CONVERSATION
from app.utils.page_snapshot import (
    PageRegistry,
    PageSnapshot,
    binding_from_session,
    pages_from_bridge_status,
)


class _FakeSession:
    def __init__(self, remote):
        self.remote_chatgpt = remote


class PageRegistryTests(unittest.TestCase):
    def test_pages_from_bridge_status_prefers_pages(self):
        status = {
            "pages": [{"client_id": "a", "page_instance_id": "1", "url": "https://chatgpt.com/"}],
            "tampermonkey_clients": [{"client_id": "b", "page_instance_id": "2"}],
        }
        pages = pages_from_bridge_status(status)
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0]["client_id"], "a")

    def test_summary_matches_online_list(self):
        now = time.time()
        status = {
            "pages": [
                {
                    "client_id": "c1",
                    "page_instance_id": "p1",
                    "url": "https://chatgpt.com/c/abc",
                    "conversation_id": "abc",
                    "last_seen": now,
                    "page_display_id": "7",
                },
                {
                    "client_id": "c2",
                    "page_instance_id": "p2",
                    "url": "https://chatgpt.com/",
                    "page_type": "home",
                    "last_seen": now - 9999,
                },
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        summary = reg.summary()
        online = reg.list_online_pages()
        self.assertEqual(summary["online_count"], len(online))
        self.assertEqual(summary["total_count"], len(reg.pages))
        self.assertGreaterEqual(summary["conversation_syncable_count"], 0)

    def test_get_bound_page_by_identity(self):
        now = time.time()
        status = {
            "pages": [
                {
                    "client_id": "tm-abc",
                    "page_instance_id": "inst-1",
                    "url": "https://chatgpt.com/c/conv1",
                    "conversation_id": "conv1",
                    "last_seen": now,
                }
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        binding = {
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
            "client_id": "tm-abc",
            "page_instance_id": "inst-1",
            "conversation_id": "conv1",
            "url": "https://chatgpt.com/c/conv1",
        }
        page = reg.get_bound_page(binding)
        self.assertIsNotNone(page)
        self.assertEqual(page.client_id, "tm-abc")
        self.assertEqual(page.page_instance_id, "inst-1")

    def test_get_bound_page_offline_binding(self):
        reg = PageRegistry.empty()
        binding = {
            "enabled": True,
            "client_id": "missing",
            "page_instance_id": "missing",
            "conversation_id": "",
            "url": "",
        }
        self.assertIsNone(reg.get_bound_page(binding))

    def test_binding_from_session(self):
        session = _FakeSession(
            {
                "enabled": True,
                "client_id": "c1",
                "page_instance_id": "p1",
                "conversation_id": "x",
                "url": "https://chatgpt.com/c/x",
            }
        )
        b = binding_from_session(session)
        self.assertEqual(b["client_id"], "c1")
        self.assertEqual(b["url"], "https://chatgpt.com/c/x")

    def test_snapshot_canonical_url_only(self):
        raw = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/legacy",
            "last_seen": time.time(),
        }
        snap = PageSnapshot.from_raw(raw)
        self.assertIsNotNone(snap)
        self.assertEqual(snap.url, "https://chatgpt.com/c/legacy")


if __name__ == "__main__":
    unittest.main()
