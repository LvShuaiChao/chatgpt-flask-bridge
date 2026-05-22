"""ChatMessage ui_status 字段与 session 序列化测试。"""

import unittest

import pytest

from app.models import ChatMessage
from app.ui.mixins.session_mixin import SessionMixin


class _SessionHost(SessionMixin):
    pass


class ChatMessageUiStatusTests(unittest.TestCase):
    def test_message_from_dict_reads_ui_status(self):
        host = _SessionHost()
        message = host._message_from_dict(
            {"role": "user", "content": "x", "ui_status": "已发送"}
        )
        self.assertEqual(message.ui_status, "已发送")

    def test_message_to_dict_writes_ui_status_only(self):
        host = _SessionHost()
        message = ChatMessage(role="user", content="x", ui_status="sending")
        data = host._message_to_dict(message)
        self.assertEqual(data["ui_status"], "sending")
        self.assertNotIn("status", data)

    def test_message_from_dict_reads_message_source(self):
        host = _SessionHost()
        message = host._message_from_dict(
            {
                "role": "user",
                "content": "hi",
                "ui_status": "发送中",
                "message_source": "local_send",
            }
        )
        self.assertEqual(message.ui_status, "发送中")
        self.assertEqual(message.message_source, "local_send")

    def test_message_from_dict_rejects_legacy_status(self):
        host = _SessionHost()
        with pytest.raises(ValueError, match="legacy fields"):
            host._message_from_dict(
                {
                    "role": "user",
                    "content": "y",
                    "status": "发送中",
                }
            )


if __name__ == "__main__":
    unittest.main()
