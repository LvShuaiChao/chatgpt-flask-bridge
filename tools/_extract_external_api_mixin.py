#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
bridge_path = ROOT / "app" / "ui" / "mixins" / "bridge_mixin.py"
lines = bridge_path.read_text(encoding="utf-8").splitlines(True)
start = next(i for i, line in enumerate(lines) if "def _handle_external_gui_dispatch" in line)
end = next(i for i, line in enumerate(lines) if line.startswith("    def closeEvent"))

header = (
    '"""External HTTP API GUI adapter (mount only when external API enabled)."""\n'
    "from __future__ import annotations\n\n"
    "import time\n"
    "import traceback\n"
    "import uuid\n\n"
    "from app.server.external_api import attach_external_request_bridge, count_user_turns\n"
    "from app.server import complete_gui_dispatch, is_server_running, push_message\n"
    "from app.constants import ASSISTANT_WAIT_TEXT\n"
    "from app.models import (\n"
    "    BIND_STATE_BOUND_CONVERSATION,\n"
    "    BIND_STATE_BOUND_OFFLINE,\n"
    "    BIND_STATE_PREBOUND_HOME,\n"
    "    BIND_STATE_UNBOUND,\n"
    "    BIND_STATE_WAITING_CONVERSATION_CREATED,\n"
    "    default_remote_chatgpt,\n"
    "    normalize_remote_chatgpt,\n"
    ")\n"
    "from app.url_utils import parse_conversation_id\n"
    "from app.utils.page_status import page_url_from\n\n\n"
    "class ExternalApiGuiMixin:\n"
)

out_path = ROOT / "app" / "ui" / "mixins" / "external_api_gui_mixin.py"
out_path.write_text(header + "".join(lines[start:end]), encoding="utf-8")

stub = (
    "    def _handle_external_gui_dispatch(self, action_id, action, payload):\n"
    "        from app.server.runtime_state import complete_gui_dispatch\n"
    "        complete_gui_dispatch(\n"
    "            action_id,\n"
    "            {\n"
    '                "ok": False,\n'
    '                "error": "外部 API 未启用",\n'
    '                "code": "DISABLED",\n'
    "            },\n"
    "        )\n\n"
)

bridge_path.write_text("".join(lines[:start] + [stub] + lines[end:]), encoding="utf-8")
print("wrote", out_path, "stubbed bridge", start, end)
