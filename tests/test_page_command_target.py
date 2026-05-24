"""resolve_page_command_target 单元测试。"""

import time
import unittest

from app.constants import SYNC_COMMAND_POLL_MAX_AGE_SECONDS
from app.utils.page_command import (
    build_action_target_payload,
    evaluate_sync_poll_freshness,
    registry_resolve_to_gui_bound_result,
    resolve_bound_page_for_action,
    resolve_bound_page_in_registry,
    resolve_page_command_target,
)
from app.models import BIND_STATE_BOUND_CONVERSATION
from app.utils.page_status import PageRegistry


class _FakeSession:
    def __init__(self, remote):
        self.remote_chatgpt = remote


class PageCommandTargetTests(unittest.TestCase):
    def _registry_with_bound(self):
        now = time.time()
        status = {
            "pages": [
                {
                    "client_id": "tm-bind",
                    "page_instance_id": "inst-bind",
                    "url": "https://chatgpt.com/c/conv99",
                    "conversation_id": "conv99",
                    "page_type": "conversation",
                    "last_seen": now,
                    "last_poll_at": now,
                    "page_display_id": "3",
                },
                {
                    "client_id": "tm-other",
                    "page_instance_id": "inst-other",
                    "url": "https://chatgpt.com/c/other",
                    "conversation_id": "other",
                    "page_type": "conversation",
                    "last_seen": now,
                    "last_poll_at": now,
                },
            ]
        }
        return PageRegistry.from_bridge_status(status, now=now)

    def test_sync_uses_bound_page_only(self):
        reg = self._registry_with_bound()
        session = _FakeSession(
            {
                "enabled": True,
                "bind_state": "BOUND_CONVERSATION",
                "client_id": "tm-bind",
                "page_instance_id": "inst-bind",
                "conversation_id": "conv99",
                "url": "https://chatgpt.com/c/conv99",
            }
        )
        result = resolve_page_command_target(session, "sync_conversation", reg)
        self.assertTrue(result["ok"])
        self.assertEqual(result["client_id"], "tm-bind")
        self.assertEqual(result["page_instance_id"], "inst-bind")

    def test_sync_not_blocked_by_other_online_page(self):
        reg = self._registry_with_bound()
        session = _FakeSession(
            {
                "enabled": True,
                "bind_state": "BOUND_CONVERSATION",
                "client_id": "tm-bind",
                "page_instance_id": "inst-bind",
                "conversation_id": "conv99",
                "url": "https://chatgpt.com/c/conv99",
            }
        )
        result = resolve_page_command_target(session, "sync_conversation", reg)
        self.assertTrue(result["ok"])
        self.assertNotEqual(result["client_id"], "tm-other")

    def test_sync_bound_offline(self):
        session = _FakeSession(
            {
                "enabled": True,
                "bind_state": "BOUND_CONVERSATION",
                "client_id": "gone",
                "page_instance_id": "gone",
                "conversation_id": "conv-missing",
                "url": "https://chatgpt.com/c/conv-missing",
            }
        )
        reg = self._registry_with_bound()
        result = resolve_page_command_target(session, "sync_conversation", reg)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason_code"], "bound_page_offline")

    def test_sync_not_bound(self):
        session = _FakeSession({"enabled": False})
        result = resolve_page_command_target(session, "sync_conversation", PageRegistry.empty())
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason_code"], "not_bound")

    def test_sync_bound_page_not_polling(self):
        now = time.time()
        status = {
            "pages": [
                {
                    "client_id": "tm-bind",
                    "page_instance_id": "inst-bind",
                    "url": "https://chatgpt.com/c/conv99",
                    "conversation_id": "conv99",
                    "page_type": "conversation",
                    "last_seen": now,
                    "page_display_id": "3",
                },
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        session = _FakeSession(
            {
                "enabled": True,
                "bind_state": "BOUND_CONVERSATION",
                "client_id": "tm-bind",
                "page_instance_id": "inst-bind",
                "conversation_id": "conv99",
                "url": "https://chatgpt.com/c/conv99",
            }
        )
        page = reg.get_bound_page(
            {
                "bind_state": "BOUND_CONVERSATION",
                "client_id": "tm-bind",
                "page_instance_id": "inst-bind",
                "conversation_id": "conv99",
            }
        )
        self.assertIsNotNone(page)
        result = resolve_page_command_target(session, "sync_conversation", reg, now=now)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason_code"], "bound_page_not_polling")

    def test_sync_bound_page_poll_stale(self):
        now = time.time()
        stale_poll = now - SYNC_COMMAND_POLL_MAX_AGE_SECONDS - 5
        status = {
            "pages": [
                {
                    "client_id": "tm-bind",
                    "page_instance_id": "inst-bind",
                    "url": "https://chatgpt.com/c/conv99",
                    "conversation_id": "conv99",
                    "page_type": "conversation",
                    "last_seen": now,
                    "last_poll_at": stale_poll,
                    "page_display_id": "3",
                },
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        session = _FakeSession(
            {
                "enabled": True,
                "bind_state": "BOUND_CONVERSATION",
                "client_id": "tm-bind",
                "page_instance_id": "inst-bind",
                "conversation_id": "conv99",
                "url": "https://chatgpt.com/c/conv99",
            }
        )
        result = resolve_page_command_target(session, "sync_conversation", reg, now=now)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason_code"], "bound_page_poll_stale")

    def test_sync_bound_page_poll_fresh(self):
        now = time.time()
        status = {
            "pages": [
                {
                    "client_id": "tm-bind",
                    "page_instance_id": "inst-bind",
                    "url": "https://chatgpt.com/c/conv99",
                    "conversation_id": "conv99",
                    "page_type": "conversation",
                    "last_seen": now,
                    "last_poll_at": now,
                    "page_display_id": "3",
                },
            ]
        }
        reg = PageRegistry.from_bridge_status(status, now=now)
        session = _FakeSession(
            {
                "enabled": True,
                "bind_state": "BOUND_CONVERSATION",
                "client_id": "tm-bind",
                "page_instance_id": "inst-bind",
                "conversation_id": "conv99",
                "url": "https://chatgpt.com/c/conv99",
            }
        )
        page = reg.get_bound_page(
            {
                "bind_state": "BOUND_CONVERSATION",
                "client_id": "tm-bind",
                "page_instance_id": "inst-bind",
                "conversation_id": "conv99",
            }
        )
        poll_ok, code, _reason = evaluate_sync_poll_freshness(page, now=now)
        self.assertTrue(poll_ok)
        self.assertEqual(code, "")
        result = resolve_page_command_target(session, "sync_conversation", reg, now=now)
        self.assertTrue(result["ok"])

    def test_registry_resolve_to_gui_bound_result_ok(self):
        reg = self._registry_with_bound()
        binding = {
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
            "client_id": "tm-bind",
            "page_instance_id": "inst-bind",
            "conversation_id": "conv99",
        }
        resolved = resolve_bound_page_in_registry(reg, binding)
        gui = registry_resolve_to_gui_bound_result(resolved)
        self.assertTrue(gui["ok"])
        self.assertEqual(gui["item"]["client_id"], "tm-bind")
        self.assertIsInstance(gui.get("target"), dict)
        self.assertEqual(gui["target"]["client_id"], "tm-bind")

    def test_resolve_bound_page_for_action_send(self):
        reg = self._registry_with_bound()
        binding = {
            "bind_state": BIND_STATE_BOUND_CONVERSATION,
            "client_id": "tm-bind",
            "page_instance_id": "inst-bind",
            "conversation_id": "conv99",
        }
        gui = resolve_bound_page_for_action(reg, binding, "send")
        self.assertTrue(gui["ok"])
        payload = build_action_target_payload(gui["item"], source="bound_page")
        self.assertEqual(payload["conversation_id"], "conv99")


if __name__ == "__main__":
    unittest.main()
