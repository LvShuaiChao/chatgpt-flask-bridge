"""sync_conversation 控制命令严格/兜底匹配。"""

import unittest

from app.server.message_queue import (
    _sync_conversation_fallback_match,
    _sync_conversation_strict_match,
)


class SyncControlMatchTests(unittest.TestCase):
    def _sync_msg(self, **extra):
        base = {
            "command": "sync_conversation",
            "client_id": "tm-1",
            "page_instance_id": "inst-old",
            "conversation_id": "conv-1",
            "payload": {"simple_online_policy": True},
        }
        base.update(extra)
        return base

    def _body(self, **extra):
        base = {
            "client_id": "tm-1",
            "page_instance_id": "inst-new",
            "conversation_id": "conv-1",
            "page_type": "conversation",
        }
        base.update(extra)
        return base

    def test_strict_match_requires_instance(self):
        matched, reason = _sync_conversation_strict_match(
            self._sync_msg(), self._body()
        )
        self.assertFalse(matched)
        self.assertEqual(reason, "page_instance_id_mismatch")

    def test_strict_match_ok(self):
        matched, reason = _sync_conversation_strict_match(
            self._sync_msg(page_instance_id="inst-new"),
            self._body(),
        )
        self.assertTrue(matched)
        self.assertEqual(reason, "")

    def test_fallback_same_conversation(self):
        self.assertTrue(
            _sync_conversation_fallback_match(self._sync_msg(), self._body())
        )

    def test_fallback_disabled_without_policy(self):
        msg = self._sync_msg()
        msg["payload"] = {}
        self.assertFalse(_sync_conversation_fallback_match(msg, self._body()))

    def test_fallback_rejects_home_body(self):
        self.assertFalse(
            _sync_conversation_fallback_match(
                self._sync_msg(), self._body(page_type="home")
            )
        )


if __name__ == "__main__":
    unittest.main()
