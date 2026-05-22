from pathlib import Path

path = Path(__file__).resolve().parents[1] / "app/utils/page_status.py"
text = path.read_text(encoding="utf-8")
start = text.index("@dataclass\nclass PageCapability:")
end = text.index("\n\n@dataclass\nclass PageActionPlan:")
new = '''@dataclass
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
            or data.get("reason")
            or data.get("reason_code")
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
text = text[:start] + new + text[end:]
text = text.replace(
    "return PageCapability(send_decision=\"blocked\", blocked_reason=\"no_page\")",
    "return PageCapability(send_decision=\"blocked\", blocked_reason=\"no_page\")",
)
text = text.replace(
    """    return PageCapability(
        online=online,
        page_liveness=str(classified.get("page_liveness") or get_page_liveness(norm, now=now)),
        send_decision=send_decision,
        reason=reason,
        bind_state=(page.get("bind_state") or "").strip() if isinstance(page, dict) else "",
        response_state=response_state,
        client_id=norm.get("client_id") or "",
        page_instance_id=norm.get("page_instance_id") or "",
        conversation_id=norm.get("conversation_id") or "",
        url=norm.get("url") or "",
        page_type=(norm.get("page_type") or "").strip(),
        prebound_home=prebound_home,
        can_accept_input=can_accept_input_val,
    )""",
    """    blocked_reason = reason if send_decision == "blocked" else ""
    if act == "send":
        blocked_reason = send_reason if send_decision == "blocked" else ""
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
    )""",
)
# Remove PageActionPlan.conversation_syncable property if present
text = text.replace(
    """    @property
    def conversation_syncable(self) -> bool:
        return bool(self.capability.conversation_syncable)

""",
    "",
)
path.write_text(text, encoding="utf-8")
print("fixed PageCapability")
