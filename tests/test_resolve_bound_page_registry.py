"""resolve_bound_page_in_registry 同会话兜底。"""

import time
import unittest

from app.utils.page_command import resolve_bound_page_in_registry
from app.utils.page_snapshot import PageRegistry


class ResolveBoundPageRegistryTests(unittest.TestCase):
    def test_same_conversation_fallback_when_instance_stale(self):
        now = time.time()
        status = {
            "pages": [
                {
                    "client_id": "c1",
                    "page_instance_id": "page-new",
                    "conversation_id": "conv-1",
                    "url": "https://chatgpt.com/c/conv-1",
                    "page_type": "conversation",
                    "last_seen": now,
                    "last_poll_at": now,
                },
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        binding = {
            "bind_state": "BOUND_CONVERSATION",
            "client_id": "c1",
            "page_instance_id": "page-old",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
        }
        resolved = resolve_bound_page_in_registry(reg, binding, now=now)
        self.assertEqual(resolved.get("matched_by"), "same_conversation")
        self.assertTrue(resolved.get("online"))
        page = resolved.get("page")
        self.assertIsNotNone(page)
        self.assertEqual(page.page_instance_id, "page-new")
        self.assertTrue(resolved.get("relink_needed"))

    def test_exact_match_online(self):
        now = time.time()
        status = {
            "pages": [
                {
                    "client_id": "c1",
                    "page_instance_id": "inst-1",
                    "conversation_id": "conv-1",
                    "page_type": "conversation",
                    "last_seen": now,
                    "last_poll_at": now,
                },
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        binding = {
            "bind_state": "BOUND_CONVERSATION",
            "client_id": "c1",
            "page_instance_id": "inst-1",
            "conversation_id": "conv-1",
        }
        resolved = resolve_bound_page_in_registry(reg, binding, now=now)
        self.assertEqual(resolved.get("matched_by"), "exact")
        self.assertTrue(resolved.get("online"))
        self.assertFalse(resolved.get("relink_needed"))

    def test_offline_exact_match_falls_back_to_online_same_conversation(self):
        now = time.time()
        stale_ts = now - 120.0
        status = {
            "pages": [
                {
                    "client_id": "c1",
                    "page_instance_id": "page-old",
                    "conversation_id": "conv-1",
                    "url": "https://chatgpt.com/c/conv-1",
                    "page_type": "conversation",
                    "last_seen": stale_ts,
                    "last_poll_at": stale_ts,
                },
                {
                    "client_id": "c1",
                    "page_instance_id": "page-new",
                    "conversation_id": "conv-1",
                    "url": "https://chatgpt.com/c/conv-1",
                    "page_type": "conversation",
                    "last_seen": now,
                    "last_poll_at": now,
                },
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        binding = {
            "bind_state": "BOUND_CONVERSATION",
            "client_id": "c1",
            "page_instance_id": "page-old",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
        }
        resolved = resolve_bound_page_in_registry(reg, binding, now=now)
        self.assertTrue(resolved.get("offline_fallback"))
        self.assertTrue(resolved.get("online"))
        page = resolved.get("page")
        self.assertIsNotNone(page)
        self.assertEqual(page.page_instance_id, "page-new")

    def test_stale_home_exact_match_falls_back_to_conversation_page(self):
        now = time.time()
        status = {
            "pages": [
                {
                    "client_id": "c1",
                    "page_instance_id": "page-old",
                    "conversation_id": "",
                    "url": "https://chatgpt.com/",
                    "page_type": "home",
                    "last_seen": now,
                    "last_poll_at": now,
                },
                {
                    "client_id": "c2",
                    "page_instance_id": "page-live",
                    "conversation_id": "conv-1",
                    "url": "https://chatgpt.com/c/conv-1",
                    "page_type": "conversation",
                    "last_seen": now,
                    "last_poll_at": now,
                },
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        binding = {
            "bind_state": "BOUND_CONVERSATION",
            "client_id": "c1",
            "page_instance_id": "page-old",
            "conversation_id": "conv-1",
            "url": "https://chatgpt.com/c/conv-1",
        }
        resolved = resolve_bound_page_in_registry(reg, binding, now=now)
        self.assertTrue(resolved.get("offline_fallback"))
        page = resolved.get("page")
        self.assertIsNotNone(page)
        self.assertEqual(page.page_instance_id, "page-live")


if __name__ == "__main__":
    unittest.main()
