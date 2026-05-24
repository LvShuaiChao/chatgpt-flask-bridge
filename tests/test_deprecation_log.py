"""deprecation_log 观察日志单元测试。"""

import logging
import unittest
from unittest.mock import patch

from app.utils.deprecation_log import log_deprecated_hit, log_migration_hit


class DeprecationLogTests(unittest.TestCase):
    def test_log_deprecated_hit_format(self):
        with self.assertLogs("app.utils.deprecation_log", level="WARNING") as captured:
            log_deprecated_hit(
                name="remote_binding_enabled",
                reason="compat_wrapper",
                replacement="remote_binding_active",
            )
        self.assertEqual(len(captured.records), 1)
        message = captured.records[0].getMessage()
        self.assertIn("[DEPRECATED_HIT]", message)
        self.assertIn("name=remote_binding_enabled", message)
        self.assertIn("reason=compat_wrapper", message)
        self.assertIn("replacement=remote_binding_active", message)

    def test_log_migration_hit_format(self):
        with self.assertLogs("app.utils.deprecation_log", level="INFO") as captured:
            log_migration_hit(
                name="persist_qsettings_last_url",
                old="last_page_url",
                new="last_url",
                reason="cleanup_legacy_qsettings_key",
            )
        self.assertEqual(len(captured.records), 1)
        message = captured.records[0].getMessage()
        self.assertIn("[MIGRATION_HIT]", message)
        self.assertIn("old=last_page_url", message)
        self.assertIn("new=last_url", message)


class RemoteBindingDeprecatedTests(unittest.TestCase):
    def test_remote_binding_enabled_logs_once_per_process(self):
        from app.models import BIND_STATE_BOUND_CONVERSATION, remote_binding_enabled

        import app.models as models_module

        models_module._REMOTE_BINDING_DEPRECATED_LOGGED = False
        remote = {"bind_state": BIND_STATE_BOUND_CONVERSATION}

        with self.assertLogs("app.utils.deprecation_log", level="WARNING") as captured:
            self.assertTrue(remote_binding_enabled(remote))
            self.assertTrue(remote_binding_enabled(remote))

        self.assertEqual(len(captured.records), 1)
        models_module._REMOTE_BINDING_DEPRECATED_LOGGED = False


if __name__ == "__main__":
    unittest.main()
