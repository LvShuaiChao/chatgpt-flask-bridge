"""PageActionPlan 统一结构与快照。"""

from app.utils.page_status import PageActionPlan, PageCapability


def test_from_resolve_result_maps_canonical_fields():
    cap = PageCapability(
        online=True,
        conversation_syncable=True,
        page_liveness="online",
        send_decision="allowed",
        client_id="c1",
        page_instance_id="p1",
        conversation_id="conv-1",
        url="https://chatgpt.com/c/conv-1",
    )
    plan = PageActionPlan.from_resolve_result(
        {
            "action": "send",
            "decision": "allowed",
            "target_source": "bound_page",
            "capability_detail": cap.to_dict(),
            "page": {"client_id": "c1"},
        }
    )
    assert plan.decision == "allowed"
    assert plan.client_id == "c1"
    assert plan.conversation_syncable is True
    assert plan.send_decision == "allowed"


def test_page_field_from_resolve_result():
    cap = PageCapability(client_id="c1", conversation_id="conv-1")
    page = {"client_id": "c1", "page_type": "conversation"}
    plan = PageActionPlan(
        action="sync_conversation",
        decision="allowed",
        target_source="bound_page",
        reason_code="",
        capability=cap,
        page=page,
    )
    assert plan.page is page
    assert plan.to_dict()["page"] is page


def test_capability_fallback_when_page_missing():
    cap = PageCapability(
        client_id="c2",
        page_instance_id="p2",
        conversation_id="conv-2",
        url="https://chatgpt.com/c/conv-2",
    )
    plan = PageActionPlan(
        action="send",
        decision="blocked",
        target_source="bound_page",
        reason_code="offline",
        capability=cap,
        page=None,
    )
    assert plan.client_id == "c2"
    assert plan.conversation_id == "conv-2"


def test_from_resolve_result_accepts_legacy_page_aliases():
    plan = PageActionPlan.from_resolve_result(
        {
            "action": "sync_conversation",
            "decision": "allowed",
            "target_source": "bound_page",
            "target": {"client_id": "c9"},
        }
    )
    assert plan.page == {"client_id": "c9"}


def test_to_sync_target_snapshot_uses_plan_not_legacy_aliases():
    cap = PageCapability(
        online=True,
        conversation_syncable=True,
        page_liveness="online",
        send_decision="queued",
    )
    plan = PageActionPlan(
        action="sync_conversation",
        decision="allowed",
        target_source="bound_page",
        reason_code="",
        capability=cap,
        page={"client_id": "c1", "page_type": "conversation"},
    )
    snap = plan.to_sync_target_snapshot(
        remote={"bind_state": "BOUND_CONVERSATION", "client_id": "c1", "conversation_id": "conv-1"},
        status={"active": {"client_id": "c1", "conversation_id": ""}},
        short_label="c1",
    )
    assert snap["conversation_syncable"] is True
    assert snap["send_decision"] == "queued"
    assert "sendable" not in snap


def test_as_send_and_sync_tuples():
    plan = PageActionPlan.from_resolve_result(
        {
            "action": "sync_conversation",
            "decision": "blocked",
            "reason_code": "offline",
            "capability_detail": {"page_liveness": "offline"},
        }
    )
    allowed, item, source, block, detail = plan.as_sync_decision_tuple()
    assert allowed is False
    assert block == "offline"
    assert isinstance(detail, dict)
