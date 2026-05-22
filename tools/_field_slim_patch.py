"""One-shot patch for field slimming round 2."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_page_status() -> None:
    path = ROOT / "app/utils/page_status.py"
    text = path.read_text(encoding="utf-8")

    start = text.index("@dataclass\nclass PageCapability:")
    end = text.index("\n\n@dataclass\nclass PageActionPlan:")
    new_cap = '''@dataclass
class PageCapability:
    """统一页面能力判定结果（UI、server、执行入口共用）。"""

    online: bool = False
    page_liveness: str = "offline"
    client_id: str = ""
    page_instance_id: str = ""
    conversation_id: str = ""
    url: str = ""
    page_type: str = ""
    response_state: str = "unknown"
    can_accept_input: bool = True
    send_decision: str = "blocked"
    blocked_reason: str = ""
    prebound_home: bool = False

    @property
    def allowed(self) -> bool:
        return self.send_decision in ("allowed", "queued")

    @property
    def reason(self) -> str:
        return self.blocked_reason

    @property
    def reason_code(self) -> str:
        return self.blocked_reason

    @property
    def block_reason(self) -> str:
        return self.blocked_reason

    def to_dict(self) -> Dict[str, Any]:
        return {
            "client_id": self.client_id,
            "page_instance_id": self.page_instance_id,
            "conversation_id": self.conversation_id,
            "url": self.url,
            "page_type": self.page_type,
            "online": self.online,
            "page_liveness": self.page_liveness,
            "prebound_home": self.prebound_home,
            "response_state": self.response_state or "unknown",
            "can_accept_input": self.can_accept_input,
            "send_decision": self.send_decision,
            "blocked_reason": self.blocked_reason,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> PageCapability:
        if not isinstance(data, dict):
            return PageCapability()
        send_decision = (
            data.get("send_decision") or data.get("decision") or "blocked"
        )
        blocked_reason = (
            data.get("blocked_reason")
            or data.get("reason_code")
            or data.get("reason")
            or data.get("block_reason")
            or ""
        ).strip()
        page_liveness = (data.get("page_liveness") or "offline").strip()
        online = bool(data.get("online"))
        if not online and page_liveness == "online":
            online = True
        if online and page_liveness == "offline":
            page_liveness = "online"
        return cls(
            online=online,
            page_liveness=page_liveness,
            send_decision=str(send_decision).strip() or "blocked",
            blocked_reason=blocked_reason,
            response_state=(data.get("response_state") or "unknown").strip(),
            client_id=(data.get("client_id") or "").strip(),
            page_instance_id=(data.get("page_instance_id") or "").strip(),
            conversation_id=(data.get("conversation_id") or "").strip(),
            url=(data.get("url") or "").strip(),
            page_type=(data.get("page_type") or "").strip(),
            prebound_home=bool(data.get("prebound_home")),
            can_accept_input=bool(data.get("can_accept_input", True)),
        )
'''
    text = text[:start] + new_cap + text[end:]

    for old_props in (
        '''    @property
    def conversation_syncable(self) -> bool:
        return bool(self.capability.conversation_syncable)

    @property
    def send_decision(self) -> str:
        return (self.capability.send_decision or "blocked").strip()

    @property
    def send_requestable(self) -> bool:
        return bool(self.capability.send_requestable)

    @property
    def send_now_available(self) -> bool:
        return bool(self.capability.send_now_available)

    @property
    def send_queueable(self) -> bool:
        return bool(self.capability.send_queueable)

    @property
    def online(self) -> bool:
        return bool(self.capability.online)

''',
    ):
        if old_props in text:
            text = text.replace(
                old_props,
                '''    @property
    def send_decision(self) -> str:
        return (self.capability.send_decision or "blocked").strip()

    @property
    def online(self) -> bool:
        return bool(self.capability.online)

''',
            )

    text = text.replace(
        'cap = PageCapability(reason_code="invalid_page_action_result")',
        'cap = PageCapability(blocked_reason="invalid_page_action_result")',
    )

    old_eval = '''    """统一能力判定：online / conversation_syncable / send_decision / reason。"""
    del bound  # 保留参数以兼容旧调用方
    norm = normalize_page(page, now=now) if isinstance(page, dict) else {}
    if not norm:
        return PageCapability(send_decision="blocked", reason_code="no_page")
    classified = classify_page_state(norm, now=now)
    online = bool(classified.get("online"))
    conversation_syncable = can_sync_conversation(norm, now=now)
    send_decision, send_reason = evaluate_send_page(
        norm,
        expected_conversation_id,
    )
    prebound_home = bool(classified.get("prebound_home"))
    reason = ""
    act = (action or "").strip()
    if act in ("sync", "sync_conversation"):
        if conversation_syncable:
            reason = "ready"
        else:
            reason = _page_block_reason_for_sync(norm, classified, online)
    elif act == "send":
        reason = send_reason
    elif act == "sync_url":
        if not is_page_url_syncable(norm, now=now):
            reason = _page_block_reason_for_sync(norm, classified, online)
            send_decision = "blocked"
        else:
            reason = "ready"
    elif act == "upload":
        if not online:
            reason = "offline"
            send_decision = "blocked"
        elif not bool(norm.get("upload_bridge_supported")):
            reason = "upload_bridge_not_supported"
            send_decision = "blocked"
        else:
            reason = "ready"
            send_decision = "allowed"

    exp_cid = (expected_conversation_id or "").strip()
    exp_client = (expected_client_id or "").strip()
    exp_instance = (expected_page_instance_id or "").strip()
    page_conv = (norm.get("conversation_id") or "").strip()
    if norm and exp_client and (norm.get("client_id") or "").strip() != exp_client:
        reason = "client_id_mismatch"
        send_decision = "blocked"
    elif (
        norm
        and exp_instance
        and (norm.get("page_instance_id") or "").strip() != exp_instance
    ):
        reason = "page_instance_id_mismatch"
        send_decision = "blocked"
    elif norm and exp_cid and page_conv and page_conv != exp_cid:
        reason = "conversation_mismatch"
        send_decision = "blocked"

    response_state = read_response_state(norm)
    can_accept_input_val = can_accept_input(norm)

    return PageCapability(
        online=online,
        conversation_syncable=conversation_syncable,
        send_decision=send_decision,
        reason_code=reason or send_reason,
        response_state=response_state,
        client_id=norm.get("client_id") or "",
        page_instance_id=norm.get("page_instance_id") or "",
        conversation_id=norm.get("conversation_id") or "",
        url=norm.get("url") or "",
        page_liveness=str(classified.get("page_liveness") or "offline"),
        prebound_home=prebound_home,
        can_accept_input=can_accept_input_val,
    )'''

    new_eval = '''    """统一能力判定：online / send_decision / blocked_reason（细分能力仅内部计算）。"""
    del bound  # 保留参数以兼容旧调用方
    norm = normalize_page(page, now=now) if isinstance(page, dict) else {}
    if not norm:
        return PageCapability(send_decision="blocked", blocked_reason="no_page")
    classified = classify_page_state(norm, now=now)
    online = bool(classified.get("online"))
    send_decision, send_reason = evaluate_send_page(
        norm,
        expected_conversation_id,
    )
    prebound_home = bool(classified.get("prebound_home"))
    blocked_reason = ""
    act = (action or "").strip()
    if act in ("sync", "sync_conversation"):
        if not can_sync_conversation(norm, now=now):
            blocked_reason = _page_block_reason_for_sync(norm, classified, online)
    elif act == "send":
        blocked_reason = send_reason if send_decision == "blocked" else ""
    elif act == "sync_url":
        if not is_page_url_syncable(norm, now=now):
            blocked_reason = _page_block_reason_for_sync(norm, classified, online)
            send_decision = "blocked"
    elif act == "upload":
        if not online:
            blocked_reason = "offline"
            send_decision = "blocked"
        elif not bool(norm.get("upload_bridge_supported")):
            blocked_reason = "upload_bridge_not_supported"
            send_decision = "blocked"
        else:
            send_decision = "allowed"

    exp_cid = (expected_conversation_id or "").strip()
    exp_client = (expected_client_id or "").strip()
    exp_instance = (expected_page_instance_id or "").strip()
    page_conv = (norm.get("conversation_id") or "").strip()
    if norm and exp_client and (norm.get("client_id") or "").strip() != exp_client:
        blocked_reason = "client_id_mismatch"
        send_decision = "blocked"
    elif (
        norm
        and exp_instance
        and (norm.get("page_instance_id") or "").strip() != exp_instance
    ):
        blocked_reason = "page_instance_id_mismatch"
        send_decision = "blocked"
    elif norm and exp_cid and page_conv and page_conv != exp_cid:
        blocked_reason = "conversation_mismatch"
        send_decision = "blocked"

    response_state = read_response_state(norm)
    can_accept_input_val = can_accept_input(norm)

    return PageCapability(
        online=online,
        page_liveness=str(classified.get("page_liveness") or get_page_liveness(norm, now=now)),
        send_decision=send_decision,
        blocked_reason=blocked_reason,
        response_state=response_state,
        client_id=norm.get("client_id") or "",
        page_instance_id=norm.get("page_instance_id") or "",
        conversation_id=norm.get("conversation_id") or "",
        url=norm.get("url") or "",
        page_type=(norm.get("page_type") or "").strip(),
        prebound_home=prebound_home,
        can_accept_input=can_accept_input_val,
    )'''

    if old_eval not in text:
        raise RuntimeError("evaluate_page_capability block not found")
    text = text.replace(old_eval, new_eval, 1)

    text = text.replace(
        '''        return {
            "conversation_syncable": conv_sync,
            "sync_readable": sync_readable,
            "decision": self.send_decision,
            "reason": self.blocked_reason or self.reason,
''',
        '''        return {
            "sync_readable": sync_readable,
            "send_decision": self.send_decision,
            "blocked_reason": self.blocked_reason or self.reason,
''',
    )

    old_compact = '''    cap = evaluate_page_capability(page, action="send")
    return {
        "page_display_id": str(page.get("page_display_id") or "").strip(),
        "client_id": (page.get("client_id") or "").strip(),
        "page_instance_id": (page.get("page_instance_id") or "").strip(),
        "url": cap.url or page_url_from(page) or "",
        "online": cap.online,
        "page_type": (page.get("page_type") or "").strip(),
        "conversation_id": (page.get("conversation_id") or "").strip(),
        "decision": cap.decision,
        "reason": cap.reason,
        "response_state": cap.response_state or "unknown",
    }'''

    new_compact = '''    cap = evaluate_page_capability(page, action="send")
    return {
        "page_display_id": str(page.get("page_display_id") or "").strip(),
        "client_id": (page.get("client_id") or "").strip(),
        "page_instance_id": (page.get("page_instance_id") or "").strip(),
        "url": cap.url or page_url_from(page) or "",
        "page_title": (page.get("page_title") or "").strip(),
        "page_type": cap.page_type or (page.get("page_type") or "").strip(),
        "conversation_id": (page.get("conversation_id") or "").strip(),
        "online": cap.online,
        "page_liveness": cap.page_liveness,
        "last_seen": page.get("last_seen"),
        "response_state": cap.response_state or "unknown",
        "can_accept_input": cap.can_accept_input,
        "send_decision": cap.send_decision,
        "blocked_reason": cap.blocked_reason,
    }'''

    if old_compact in text:
        text = text.replace(old_compact, new_compact, 1)

    path.write_text(text, encoding="utf-8")
    print("patched", path)


if __name__ == "__main__":
    patch_page_status()
