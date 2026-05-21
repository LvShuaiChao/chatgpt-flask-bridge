"""page_status 统一判定单元测试。"""

import time
import unittest

from app.utils.page_status import (
    evaluate_page_capability,
    explain_page_decision,
    is_page_online,
    is_page_url_syncable,
    normalize_page,
    page_url_from,
)


class PageStatusTests(unittest.TestCase):
    def test_page_url_from_legacy_alias(self):
        raw = {"page_url": "https://chatgpt.com/c/abc123"}
        self.assertEqual(page_url_from(raw), "https://chatgpt.com/c/abc123")

    def test_page_url_from_canonical_url(self):
        raw = {"url": "https://chatgpt.com/c/tampermonkey"}
        self.assertEqual(page_url_from(raw), "https://chatgpt.com/c/tampermonkey")

    def test_normalize_page_does_not_trust_cached_online(self):
        now = time.time()
        raw = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/abc",
            "online": True,
        }
        norm = normalize_page(raw, now=now)
        self.assertFalse(norm["online"])
        self.assertEqual(norm["page_liveness"], "offline")

    def test_online_from_recent_heartbeat(self):
        now = time.time()
        raw = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/abc",
            "last_seen": now - 2,
            "page_type": "conversation",
            "conversation_id": "abc",
        }
        norm = normalize_page(raw, now=now)
        self.assertTrue(is_page_online(norm, now=now))

    def test_can_sync_conversation_unified(self):
        now = time.time()
        base = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "last_seen": now - 2,
            "page_type": "home",
        }
        home = {**base, "url": "https://chatgpt.com/"}
        cap_home = evaluate_page_capability(home, action="sync", now=now)
        self.assertFalse(cap_home.syncable)
        self.assertFalse(cap_home.conversation_syncable)

        conv = {
            **base,
            "url": "https://chatgpt.com/c/xyz",
            "conversation_id": "xyz",
            "page_type": "conversation",
        }
        cap_conv = evaluate_page_capability(conv, action="sync", now=now)
        self.assertTrue(cap_conv.syncable)
        self.assertTrue(cap_conv.conversation_syncable)

    def test_sendable_vs_queueable(self):
        now = time.time()
        page = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/xyz",
            "conversation_id": "xyz",
            "page_type": "conversation",
            "last_seen": now - 2,
            "is_responding": True,
            "can_accept_input": False,
        }
        cap = evaluate_page_capability(page, action="send", now=now)
        self.assertFalse(cap.sendable)
        self.assertTrue(cap.queueable)

    def test_evaluate_page_capability_mismatch_flags(self):
        now = time.time()
        page = {
            "client_id": "c-other",
            "page_instance_id": "p-other",
            "url": "https://chatgpt.com/c/xyz",
            "conversation_id": "xyz",
            "page_type": "conversation",
            "last_seen": now - 2,
        }
        cap = evaluate_page_capability(
            page,
            action="sync",
            bound=False,
            expected_client_id="c-bound",
            expected_page_instance_id="p-bound",
            expected_conversation_id="xyz",
            now=now,
        )
        self.assertTrue(cap.client_id_mismatch)
        self.assertTrue(cap.page_instance_id_mismatch)
        self.assertFalse(cap.conversation_mismatch)
        self.assertFalse(cap.bound)

    def test_url_syncable_without_conversation_id(self):
        now = time.time()
        page = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/",
            "page_type": "home",
            "last_seen": now - 2,
        }
        cap = evaluate_page_capability(page, now=now)
        self.assertTrue(cap.url_syncable)
        self.assertFalse(cap.conversation_syncable)
        self.assertEqual(cap.to_dict()["url_syncable"], cap.url_syncable)

    def test_explain_page_decision_home_not_syncable(self):
        now = time.time()
        page = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/",
            "page_type": "home",
            "last_seen": now - 2,
        }
        d = explain_page_decision(page, action="sync")
        self.assertFalse(d["syncable"])
        self.assertFalse(d["conversation_syncable"])
        self.assertFalse(d["can_sync_conversation"])


if __name__ == "__main__":
    unittest.main()
