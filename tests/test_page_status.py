"""page_status 统一判定单元测试。"""

import time
import unittest

from app.utils.page_status import (
    can_sync_conversation,
    evaluate_page_capability,
    explain_page_decision,
    is_page_online,
    is_page_url_syncable,
    normalize_page,
    page_url_from,
)


class PageStatusTests(unittest.TestCase):
    def test_page_url_from_reads_canonical_only(self):
        raw = {"page_url": "https://chatgpt.com/c/abc123"}
        self.assertEqual(page_url_from(raw), "")
        migrated = {
            **raw,
            "url": "https://chatgpt.com/c/abc123",
            "client_id": "c1",
            "page_instance_id": "p1",
        }
        migrated.pop("page_url", None)
        norm = normalize_page(migrated)
        self.assertEqual(norm.get("url"), "https://chatgpt.com/c/abc123")

    def test_page_url_from_canonical_url(self):
        raw = {"url": "https://chatgpt.com/c/tampermonkey"}
        self.assertEqual(page_url_from(raw), "https://chatgpt.com/c/tampermonkey")

    def test_normalize_page_strips_legacy_url_after_boundary_migrate(self):
        raw = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/from-normalized",
            "normalized_url": "https://chatgpt.com/c/from-normalized",
            "current_url": "https://chatgpt.com/c/from-current",
        }
        norm = normalize_page(raw)
        self.assertEqual(norm["url"], "https://chatgpt.com/c/from-normalized")
        self.assertNotIn("normalized_url", norm)
        self.assertNotIn("current_url", norm)

    def test_normalize_page_does_not_read_legacy_url_without_migrate(self):
        raw = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "page_url": "https://chatgpt.com/c/legacy-only",
        }
        norm = normalize_page(raw)
        self.assertEqual(norm.get("url"), "")
        self.assertNotIn("page_url", norm)

    def test_normalize_page_does_not_trust_cached_online(self):
        now = time.time()
        raw = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/abc",
            "online": True,
            "page_liveness": "offline",
        }
        norm = normalize_page(raw, now=now)
        self.assertFalse(norm["online"])
        self.assertEqual(norm["page_liveness"], "offline")

    def test_normalize_page_preserves_server_page_liveness_without_timestamps(self):
        now = time.time()
        raw = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/abc",
            "page_liveness": "online",
            "online": True,
        }
        norm = normalize_page(raw, now=now)
        self.assertTrue(norm["online"])
        self.assertEqual(norm["page_liveness"], "online")

    def test_normalize_page_uses_heartbeat_at_for_liveness(self):
        now = time.time()
        raw = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/abc",
            "last_heartbeat_at": now - 2,
            "page_type": "conversation",
            "conversation_id": "abc",
        }
        norm = normalize_page(raw, now=now)
        self.assertTrue(is_page_online(norm, now=now))

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
        self.assertTrue(can_sync_conversation(home, now=now) is False)

        conv = {
            **base,
            "url": "https://chatgpt.com/c/xyz",
            "conversation_id": "xyz",
            "page_type": "conversation",
        }
        cap_conv = evaluate_page_capability(conv, action="sync", now=now)
        self.assertTrue(can_sync_conversation(conv, now=now))
        self.assertEqual(cap_conv.blocked_reason, "")

    def test_send_now_vs_send_queueable(self):
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
        self.assertEqual(cap.send_decision, "queued")
        d = cap.to_dict()
        self.assertNotIn("send_requestable", d)
        self.assertNotIn("send_now_available", d)
        self.assertNotIn("send_queueable", d)

    def test_empty_idle_composer_is_sendable_after_injection(self):
        now = time.time()
        page = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/xyz",
            "conversation_id": "xyz",
            "page_type": "conversation",
            "last_seen": now - 2,
            "response_state": "idle",
            "can_accept_input": True,
            "can_send_now": False,
        }
        cap = evaluate_page_capability(page, action="send", now=now)
        self.assertEqual(cap.send_decision, "allowed")

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
        self.assertEqual(cap.reason, "client_id_mismatch")
        self.assertEqual(cap.send_decision, "blocked")

    def test_url_syncable_without_conversation_id(self):
        now = time.time()
        page = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/",
            "page_type": "home",
            "last_seen": now - 2,
        }
        cap = evaluate_page_capability(page, action="sync_url", now=now)
        self.assertNotIn("url_syncable", cap.to_dict())
        self.assertEqual(cap.send_decision, "allowed")

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
        self.assertFalse(d.get("conversation_syncable"))
        self.assertNotIn("syncable", d)
        self.assertNotIn("can_sync_conversation", d)


if __name__ == "__main__":
    unittest.main()
