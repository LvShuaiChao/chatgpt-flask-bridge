"""bridge_payload 出站字段规范化单元测试。"""

import inspect
import unittest

from app.ui.mixins.page_bind_mixin import PageBindMixin
from app.utils.bridge_payload import (
    build_gui_push_payload,
    get_bridge_message_id,
    load_qsettings_last_url,
    normalize_inbound_push_payload,
    normalize_outbound_bridge_message,
    persist_qsettings_last_url,
    read_bridge_client_id,
    read_bridge_page_instance_id,
)
from app.utils.page_status import page_url_from
from app.utils.legacy_cleanup import assert_no_legacy_fields


class _FakeSettings:
    def __init__(self, values=None):
        self._values = dict(values or {})

    def value(self, key, default=""):
        return self._values.get(key, default)

    def setValue(self, key, value):
        self._values[key] = value

    def remove(self, key):
        self._values.pop(key, None)

    def contains(self, key):
        return key in self._values


class BridgePayloadTests(unittest.TestCase):
    def test_read_helpers_use_canonical_fields_only(self):
        data = {
            "client_id": "c-new",
            "target_client_id": "c-old",
            "page_instance_id": "p-new",
            "target_page_instance_id": "p-old",
            "content": "hello",
            "text": "legacy",
        }
        self.assertEqual(read_bridge_client_id(data), "c-new")
        self.assertEqual(read_bridge_page_instance_id(data), "p-new")
        self.assertEqual((data.get("content") or "").strip(), "hello")

    def test_read_helpers_ignore_legacy_fields(self):
        data = {
            "target_client_id": "c-legacy",
            "target_page_instance_id": "p-legacy",
            "text": "from text",
        }
        self.assertEqual(read_bridge_client_id(data), "")
        self.assertEqual(read_bridge_page_instance_id(data), "")
        self.assertEqual((data.get("content") or "").strip(), "")

    def test_normalize_outbound_keeps_canonical_only(self):
        msg = {
            "message_id": "msg-1",
            "message_status": "pending",
            "content": "hello",
            "url": "https://chatgpt.com/c/abc",
            "client_id": "client-a",
            "page_instance_id": "page-b",
        }
        out = normalize_outbound_bridge_message(msg)
        self.assertEqual(out["message_id"], "msg-1")
        self.assertEqual(out["message_status"], "pending")
        self.assertEqual(out["content"], "hello")
        self.assertEqual(out["url"], "https://chatgpt.com/c/abc")
        self.assertEqual(out["client_id"], "client-a")
        self.assertEqual(out["page_instance_id"], "page-b")

    def test_normalize_outbound_rejects_legacy_id(self):
        with self.assertRaises(ValueError):
            normalize_outbound_bridge_message(
                {
                    "message_id": "msg-1",
                    "id": "legacy-id",
                    "content": "hello",
                }
            )

    def test_normalize_outbound_rejects_legacy_raw_user_text(self):
        with self.assertRaises(ValueError):
            normalize_outbound_bridge_message(
                {
                    "message_id": "msg-2",
                    "content": "final text",
                    "raw_user_text": "user typed",
                }
            )

    def test_normalize_outbound_rejects_legacy_target_url(self):
        with self.assertRaises(ValueError):
            normalize_outbound_bridge_message(
                {
                    "message_id": "msg-legacy",
                    "content": "from legacy",
                    "target_url": "https://chatgpt.com/c/legacy",
                }
            )

    def test_get_bridge_message_id_reads_canonical_only(self):
        self.assertEqual(get_bridge_message_id({"message_id": "mid-1"}), "mid-1")
        self.assertEqual(get_bridge_message_id({"id": "legacy-only"}), "")

    def test_page_url_from_reads_url(self):
        status = {
            "url": "https://chatgpt.com/c/new",
            "tampermonkey_page_url": "https://legacy",
        }
        self.assertEqual(page_url_from(status), "https://chatgpt.com/c/new")

    def test_page_url_from_ignores_tampermonkey_page_url(self):
        status = {"tampermonkey_page_url": "https://chatgpt.com/c/legacy"}
        self.assertEqual(page_url_from(status), "")

    def test_load_qsettings_last_url_no_legacy_migration(self):
        settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/old"})
        self.assertIsNone(load_qsettings_last_url(settings))

    def test_persist_qsettings_last_url_only_writes_new_key(self):
        settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/stale"})
        with self.assertLogs("app.utils.deprecation_log", level="INFO") as captured:
            persist_qsettings_last_url(settings, "https://chatgpt.com/c/fresh")
        self.assertEqual(settings.value("last_url"), "https://chatgpt.com/c/fresh")
        self.assertFalse(settings.contains("last_page_url"))
        messages = [record.getMessage() for record in captured.records]
        self.assertTrue(
            any(
                "[MIGRATION_HIT]" in line and "old=last_page_url" in line
                for line in messages
            ),
            messages,
        )

    def test_normalize_inbound_push_payload_rejects_legacy_target_url(self):
        with self.assertRaises(ValueError):
            normalize_inbound_push_payload(
                {"content": "hi", "target_url": "https://chatgpt.com/c/abc"}
            )

    def test_normalize_inbound_push_payload_rejects_legacy_page_url(self):
        with self.assertRaises(ValueError):
            normalize_inbound_push_payload(
                {"content": "hi", "page_url": "https://chatgpt.com/c/page"}
            )

    def test_build_gui_push_payload_uses_canonical_target_fields(self):
        payload = build_gui_push_payload(
            session_id="s1",
            turn_id="t1",
            content="hello",
            client_id="c1",
            page_instance_id="p1",
            conversation_id="conv1",
            url="https://chatgpt.com/c/conv1",
        )
        normalized = normalize_inbound_push_payload(payload)
        self.assertEqual(normalized["client_id"], "c1")
        self.assertEqual(normalized["page_instance_id"], "p1")
        self.assertNotIn("target_client_id", payload)
        self.assertNotIn("target_page_instance_id", payload)

    def test_normalize_inbound_push_payload_rejects_target_conversation_id(self):
        with self.assertRaises(ValueError):
            normalize_inbound_push_payload(
                {
                    "content": "hi",
                    "target_conversation_id": "conv-abc",
                }
            )

    def test_build_bridge_send_payload_accepts_url_kwarg(self):
        sig = inspect.signature(PageBindMixin._compose_send_payload)
        self.assertIn("url", sig.parameters)
        self.assertIn("raw_content", sig.parameters)
        self.assertIn("content", sig.parameters)
        self.assertNotIn("target_page_url", sig.parameters)
        self.assertNotIn("final_prompt", sig.parameters)
        self.assertNotIn("raw_user_text", sig.parameters)

    def test_assert_no_legacy_fields_lists_all_banned_keys(self):
        from app.utils.legacy_cleanup import LEGACY_FIELD_NAMES

        for key in (
            "target_client_id",
            "target_page_instance_id",
            "target_conversation_id",
            "target_page_url",
            "target_url",
            "raw_user_text",
            "page_id",
            "window_id",
            "current_page_id",
        ):
            self.assertIn(key, LEGACY_FIELD_NAMES)
            with self.assertRaises(ValueError):
                assert_no_legacy_fields({key: "x"}, owner="test")

        with self.assertRaises(ValueError):
            assert_no_legacy_fields({"id": "legacy-id"}, owner="test")


if __name__ == "__main__":
    unittest.main()
