"""顶部同步目标状态文案：queued 不应显示为不可发送。"""

import unittest

from app.ui.mixins.page_sync_mixin import PageSyncMixin


class _Host(PageSyncMixin):
    def _current_session_queue_size(self):
        return 0


class TestSyncTargetStatusText(unittest.TestCase):
    def test_send_now_shows_sendable(self):
        host = _Host()
        text = host._format_sync_target_status_text(
            {"online": True, "conversation_syncable": True, "send_now_available": True},
            {"send_requestable": True, "send_decision": "allowed"},
        )
        self.assertEqual(text, "同步：可同步｜发送：可发送")

    def test_queued_shows_queueable_not_blocked(self):
        host = _Host()
        text = host._format_sync_target_status_text(
            {
                "online": True,
                "conversation_syncable": True,
                "send_now_available": False,
                "send_queueable": True,
                "send_decision": "queued",
            },
            {"send_requestable": True},
        )
        self.assertEqual(text, "同步：可同步｜发送：可排队")

    def test_responding_shows_waiting_reply(self):
        host = _Host()
        text = host._format_sync_target_status_text(
            {"online": True, "conversation_syncable": True, "is_responding": True},
            {"send_requestable": False, "send_now_available": False},
        )
        self.assertEqual(text, "同步：可同步｜发送：等待回复")

    def test_truly_blocked_send(self):
        host = _Host()
        text = host._format_sync_target_status_text(
            {"online": True, "conversation_syncable": True},
            {
                "send_requestable": False,
                "send_now_available": False,
                "send_queueable": False,
                "send_decision": "blocked",
            },
        )
        self.assertEqual(text, "同步：可同步｜发送：不可发送")


class TestCapabilityDictCanonicalOnly(unittest.TestCase):
    def test_to_dict_has_no_legacy_aliases(self):
        from app.utils.page_status import evaluate_page_capability

        page = {
            "client_id": "c1",
            "page_instance_id": "p1",
            "url": "https://chatgpt.com/c/abc",
            "conversation_id": "abc",
            "last_seen": __import__("time").time(),
            "can_send_now": False,
            "can_accept_input": True,
            "response_state": "idle",
        }
        cap = evaluate_page_capability(page, action="send")
        d = cap.to_dict()
        self.assertTrue(d["send_now_available"])
        self.assertFalse(d["send_queueable"])
        for legacy in ("sendable", "queueable", "syncable", "dialog_ready", "can_request_send"):
            self.assertNotIn(legacy, d)


if __name__ == "__main__":
    unittest.main()
