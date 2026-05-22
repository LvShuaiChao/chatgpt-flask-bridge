"""P2 字段收敛：审查清单 7 项回归（无 legacy 字段迁移）。"""

import pytest

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    PENDING_ASSISTANT_STATUSES,
    PENDING_USER_SEND_STATUSES,
    UI_STATUS_DISPLAY_TEXT,
)
from app.core.job_scheduler import create_job, get_job, job_status_from, update_job_status
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    ChatSession,
    default_remote_chatgpt,
    write_session_remote_chatgpt,
)
from app.utils.bridge_payload import normalize_inbound_push_payload, normalize_outbound_bridge_message
from app.utils.page_status import page_url_from as url_from
from app.utils.legacy_cleanup import assert_no_legacy_fields


def test_remote_chatgpt_setter_migrates_bound_offline():
    session = ChatSession(
        session_id="s1",
        title="t",
        created_at=0,
        updated_at=0,
    )
    session.remote_chatgpt = {
        "bind_state": BIND_STATE_BOUND_OFFLINE,
        "conversation_id": "conv-legacy",
    }
    remote = session.remote_chatgpt
    assert remote["bind_state"] == BIND_STATE_BOUND_CONVERSATION
    assert remote["conversation_id"] == "conv-legacy"


def test_write_session_rejects_bound_offline_write():
    session = ChatSession(
        session_id="s2",
        title="t",
        created_at=0,
        updated_at=0,
    )
    write_session_remote_chatgpt(
        session,
        bind_state=BIND_STATE_BOUND_OFFLINE,
        conversation_id="conv-x",
    )
    assert session.remote_chatgpt["bind_state"] == BIND_STATE_BOUND_CONVERSATION


def test_ui_status_display_maps_sending():
    assert UI_STATUS_DISPLAY_TEXT["sending"] == "发送中"
    assert "sending" in PENDING_USER_SEND_STATUSES
    assert UI_STATUS_DISPLAY_TEXT.get("waiting") == ASSISTANT_WAIT_TEXT
    assert UI_STATUS_DISPLAY_TEXT["assistant_pending"] == ASSISTANT_WAIT_TEXT


def test_url_from_reads_url_only():
    assert url_from({"target_url": "https://chatgpt.com/c/x"}) == ""
    assert url_from({"url": "https://chatgpt.com/c/x"}) == "https://chatgpt.com/c/x"


def test_normalize_inbound_rejects_target_url():
    import pytest

    with pytest.raises(ValueError, match="legacy"):
        normalize_inbound_push_payload(
            {"content": "hi", "target_url": "https://chatgpt.com/c/abc"}
        )


def test_normalize_outbound_rejects_target_url():
    with pytest.raises(ValueError):
        normalize_outbound_bridge_message(
            {
                "message_id": "m1",
                "content": "x",
                "target_url": "https://chatgpt.com/c/legacy",
            }
        )


def test_job_status_migration_on_get_job():
    job_id, _job = create_job("hello requirement")
    with pytest.importorskip("app.core.job_scheduler").job_lock:
        from app.core import job_scheduler

        stored = job_scheduler.job_map[job_id]
        stored["status"] = "waiting_chatgpt_reply"
        stored.pop("job_status", None)
    fetched = get_job(job_id)
    assert fetched is not None
    assert job_status_from(fetched) == "waiting_chatgpt_reply"
    assert "status" not in fetched
    update_job_status(job_id, "cancelled", "done")
    assert "status" not in (get_job(job_id) or {})


@pytest.fixture
def server_module():
    import importlib
    import server as srv

    return importlib.reload(srv)


@pytest.fixture
def server_module():
    import importlib
    import server as srv

    return importlib.reload(srv)


def test_registry_no_clients_fallback_when_pages_exist(server_module):
    srv = server_module
    with srv._state_lock:
        srv._tampermonkey_pages.clear()
        srv._tampermonkey_pages["c-only|p-old"] = {
            "client_id": "c-only",
            "page_instance_id": "p-old",
            "last_seen": srv._now(),
        }
        srv._tampermonkey_pages["c-only|p-new"] = {
            "client_id": "c-only",
            "page_instance_id": "p-new",
            "last_seen": srv._now() + 1,
        }
        entry = srv._registry_entry_for_client("c-only")
    assert (entry.get("page_instance_id") or "") == "p-new"


def test_prepare_pending_strips_stale_target_after_upload():
    from app.ui.mixins.bridge_mixin import BridgeMixin

    class _Host(BridgeMixin):
        def _effective_bind_state(self, session):
            return ""

        def _find_session_message_by_id(self, session, message_id):
            return None

    host = _Host()
    session = ChatSession(
        session_id="s3",
        title="t",
        created_at=0,
        updated_at=0,
        remote_chatgpt=default_remote_chatgpt(),
    )
    ctx = host._prepare_chat_send_from_pending(
        session,
        {
            "refresh_send_target": True,
            "payload": {
                "client_id": "stale-c",
                "page_instance_id": "stale-p",
                "url": "https://chatgpt.com/c/stale",
                "content": "hi",
            },
            "raw_content": "hi",
            "turn_id": "t1",
        },
    )
    payload = ctx["payload"]
    assert "client_id" not in payload
    assert "page_instance_id" not in payload
    assert "url" not in payload
    assert_no_legacy_fields(payload, owner="test_prepare_pending")
