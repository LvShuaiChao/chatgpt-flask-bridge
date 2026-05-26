"""严格控制命令 canonical 字段匹配单元测试。"""

import unittest

from app.server.message_queue import _targeted_control_matches


class StrictControlMatchTests(unittest.TestCase):
    def _msg(self, command, **extra):
        base = {
            "command": command,
            "client_id": "tm-1",
            "page_instance_id": "inst-1",
            "conversation_id": "conv-1",
        }
        base.update(extra)
        return base

    def _body(self, **extra):
        base = {
            "client_id": "tm-1",
            "page_instance_id": "inst-1",
            "conversation_id": "conv-1",
        }
        base.update(extra)
        return base

    def test_start_upload_matches_canonical_fields(self):
        self.assertTrue(
            _targeted_control_matches(
                self._msg("start_upload"),
                self._body(),
            )
        )

    def test_start_upload_rejects_client_id_mismatch(self):
        self.assertFalse(
            _targeted_control_matches(
                self._msg("start_upload"),
                self._body(client_id="tm-other"),
            )
        )

    def test_start_upload_rejects_page_instance_mismatch(self):
        self.assertFalse(
            _targeted_control_matches(
                self._msg("start_upload"),
                self._body(page_instance_id="inst-other"),
            )
        )

    def test_start_upload_rejects_conversation_mismatch(self):
        self.assertFalse(
            _targeted_control_matches(
                self._msg("start_upload"),
                self._body(conversation_id="conv-other"),
            )
        )

    def test_cancel_run_requires_msg_client_id(self):
        self.assertFalse(
            _targeted_control_matches(
                self._msg("cancel_run", client_id=""),
                self._body(),
            )
        )

    def test_non_strict_command_not_matched(self):
        self.assertFalse(
            _targeted_control_matches(
                self._msg("open_url"),
                self._body(),
            )
        )


if __name__ == "__main__":
    unittest.main()
