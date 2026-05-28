"""统一页面快照与注册表（bridge status 唯一解析入口）。"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from app.models import BIND_STATE_TEMP_HOME_BOUND, BIND_STATE_UNBOUND, normalize_remote_chatgpt


def _ps():
    from app.utils import page_status

    return page_status

__all__ = [
    "PageSnapshot",
    "PageRegistry",
    "binding_from_session",
    "pages_from_bridge_status",
    "status_pages_token",
    "compute_list_fingerprint",
    "build_page_indexes",
    "compute_page_counts",
    "bridge_status_online",
    "bridge_status_online_count",
    "page_display_id_sort_key",
    "page_display_ids_for_log",
    "sort_pages_by_display_id",
]

_PAGE_SOURCE_KEYS = ("pages",)


def bridge_status_online_count(status: Any) -> int:
    if not isinstance(status, dict):
        return 0
    summary = status.get("summary")
    if isinstance(summary, dict) and "online_count" in summary:
        return int(summary.get("online_count") or 0)
    pages = status.get("pages") or []
    return sum(1 for p in pages if isinstance(p, dict) and p.get("online"))


def bridge_status_online(status: Any) -> bool:
    return bridge_status_online_count(status) > 0


def _page_source_len(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        return len(value)
    return 0


def status_pages_token(status: Any) -> str:
    """用于判断 bridge status 的页面源是否变化（避免重复 build）。"""
    if not isinstance(status, dict):
        return ""
    parts: List[str] = []
    for key in _PAGE_SOURCE_KEYS:
        value = status.get(key)
        if value is not None:
            parts.append(f"{key}:{_page_source_len(value)}")
    if not parts:
        nested = status.get("summary")
        if isinstance(nested, dict):
            for key in _PAGE_SOURCE_KEYS:
                value = nested.get(key)
                if value is not None:
                    parts.append(f"summary.{key}:{_page_source_len(value)}")
    parts.extend([
        f"running={int(bool(status.get('server_running')))}",
        f"bound={_ps().read_snapshot_identity(status, 'bound')['client_id']}",
        f"q={status.get('queue_length', 0)}",
        f"cq={status.get('control_queue_length', 0)}",
    ])
    return "|".join(parts)


def compute_list_fingerprint(pages: List[dict]) -> str:
    rows = []
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        rows.append(
            "|".join(
                [
                    _ps().page_registry_key(page),
                    "1" if _ps().is_page_online(page) else "0",
                    (page.get("page_type") or "").strip(),
                    (page.get("conversation_id") or "").strip(),
                    _ps().page_url_from(page),
                    str(page.get("page_display_id") or "").strip(),
                ]
            )
        )
    return f"{len(rows)}#{'/'.join(sorted(rows))}"


def page_display_id_sort_key(page: Any) -> Tuple[int, int]:
    """页面展示编号排序键：(0, 数字) 升序在前；(1, …) 无有效 ID 排在最后。"""
    if not isinstance(page, dict):
        return (1, 999999999)
    page_id = page.get("page_display_id")
    if page_id in (None, ""):
        page_id = page.get("page_no")
    if page_id is None:
        return (1, 999999999)
    page_id_text = str(page_id).strip()
    if not page_id_text or page_id_text == "-":
        return (1, 999999999)
    if page_id_text.isdigit():
        return (0, int(page_id_text))
    return (1, 999999999)


def page_display_ids_for_log(pages: List[Any]) -> List[str]:
    ids: List[str] = []
    for page in pages or []:
        if not isinstance(page, dict):
            ids.append("-")
            continue
        rank, value = page_display_id_sort_key(page)
        if rank == 0:
            ids.append(str(value))
        else:
            ids.append("-")
    return ids


def sort_pages_by_display_id(pages: List[dict]) -> List[dict]:
    """按 page_display_id / page_no 数字升序排列；无 ID 的页面排在最后。"""
    if not pages:
        return []
    return sorted(pages, key=page_display_id_sort_key)


def build_page_indexes(
    pages: List[dict],
    *,
    conversation_id_of: Optional[Callable[[dict], str]] = None,
) -> Tuple[Dict[str, dict], Dict[str, dict], Dict[str, List[dict]]]:
    by_client_id: Dict[str, dict] = {}
    by_page_instance_id: Dict[str, dict] = {}
    by_conversation_id: Dict[str, List[dict]] = {}
    conv_fn = conversation_id_of or (lambda _page: "")
    for page in pages or []:
        if not isinstance(page, dict):
            continue
        client_id = (page.get("client_id") or "").strip()
        page_instance_id = (page.get("page_instance_id") or "").strip()
        conversation_id = (conv_fn(page) or page.get("conversation_id") or "").strip()
        if client_id:
            by_client_id[client_id] = page
        if page_instance_id:
            by_page_instance_id[page_instance_id] = page
        if conversation_id:
            by_conversation_id.setdefault(conversation_id, []).append(page)
    return by_client_id, by_page_instance_id, by_conversation_id


def compute_page_counts(
    pages: List[dict],
    *,
    is_online: Callable[[dict], bool],
) -> Tuple[int, int, int, int]:
    total = len(pages or [])
    online = sum(1 for page in pages if is_online(page))
    conversation_count = sum(
        1
        for page in pages
        if (page.get("page_type") or "").strip().lower() == "conversation"
    )
    home_count = sum(
        1
        for page in pages
        if (page.get("page_type") or "").strip().lower() == "home"
    )
    return online, total, conversation_count, home_count


def pages_from_bridge_status(status: Any) -> List[Dict[str, Any]]:
    """从 bridge status 提取页面列表（canonical 字段 pages）。"""
    if not isinstance(status, dict):
        return []
    pages = status.get("pages")
    if isinstance(pages, list) and pages:
        return [p for p in pages if isinstance(p, dict)]
    nested = status.get("summary")
    if isinstance(nested, dict):
        nested_pages = nested.get("pages")
        if isinstance(nested_pages, list) and nested_pages:
            return [p for p in nested_pages if isinstance(p, dict)]
    return []


def binding_from_session(session: Any) -> Dict[str, Any]:
    """从 session 得到绑定查询用的规范 binding 字典。"""
    if session is None:
        return {
            "bind_state": BIND_STATE_UNBOUND,
            "client_id": "",
            "page_instance_id": "",
            "conversation_id": "",
            "url": "",
        }
    remote = normalize_remote_chatgpt(getattr(session, "remote_chatgpt", None))
    return {
        "bind_state": (remote.get("bind_state") or "").strip(),
        "client_id": (remote.get("client_id") or "").strip(),
        "page_instance_id": (remote.get("page_instance_id") or "").strip(),
        "conversation_id": (remote.get("conversation_id") or "").strip(),
        "url": (remote.get("url") or "").strip(),
        "page_display_id": (remote.get("page_display_id") or "").strip(),
    }


@dataclass(frozen=True)
class PageSnapshot:
    """规范页面状态快照（UI / 命令决策共用）。"""

    client_id: str = ""
    page_instance_id: str = ""
    conversation_id: str = ""
    url: str = ""
    page_display_id: str = ""
    page_type: str = ""
    online: bool = False
    can_accept_input: bool = True
    send_decision: str = "blocked"
    reason_code: str = ""
    response_state: str = "unknown"
    page_liveness: str = "offline"
    activity_state: str = ""
    last_seen: float = 0.0
    _raw: Dict[str, Any] = field(default_factory=dict, repr=False, compare=False)

    @property
    def page_key(self) -> str:
        return _ps().build_page_key(self._raw or self.to_dict())

    @property
    def url_syncable(self) -> bool:
        raw = self._raw or self.to_dict()
        return _ps().is_page_url_syncable(raw) if raw else False

    @property
    def conversation_syncable(self) -> bool:
        raw = self._raw or self.to_dict()
        return _ps().can_sync_conversation(raw) if raw else False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "client_id": self.client_id,
            "page_instance_id": self.page_instance_id,
            "conversation_id": self.conversation_id,
            "url": self.url,
            "page_display_id": self.page_display_id,
            "page_type": self.page_type,
            "online": self.online,
            "can_accept_input": self.can_accept_input,
            "send_decision": self.send_decision,
            "reason_code": self.reason_code,
            "response_state": self.response_state,
            "page_liveness": self.page_liveness,
            "activity_state": self.activity_state,
            "last_seen": self.last_seen,
        }

    @classmethod
    def from_dict(cls, data: Any, *, now: float | None = None) -> Optional[PageSnapshot]:
        return cls.from_raw(data, now=now)

    @classmethod
    def from_raw(cls, raw: Any, *, now: float | None = None) -> Optional[PageSnapshot]:
        if not isinstance(raw, dict):
            return None
        if now is None:
            now = time.time()
        ps = _ps()
        norm = ps.normalize_page(raw, now=now)
        client_id = (norm.get("client_id") or "").strip()
        page_instance_id = (norm.get("page_instance_id") or "").strip()
        if not client_id or not page_instance_id:
            return None
        liveness = ps.get_page_liveness(norm, now=now)
        online = ps.is_strict_page_online(norm, now=now)
        send_cap = ps.evaluate_page_capability(norm, action="send", now=now)
        display_id = str(
            raw.get("page_display_id")
            or norm.get("page_display_id")
            or raw.get("page_no")
            or norm.get("page_no")
            or ""
        ).strip()
        last_seen = float(norm.get("last_seen") or 0.0)
        return cls(
            client_id=client_id,
            page_instance_id=page_instance_id,
            conversation_id=(norm.get("conversation_id") or "").strip(),
            url=(norm.get("url") or "").strip(),
            page_display_id=display_id,
            page_type=(norm.get("page_type") or "").strip(),
            online=online,
            can_accept_input=bool(norm.get("can_accept_input", True)),
            send_decision=send_cap.send_decision,
            reason_code=send_cap.reason_code,
            response_state=(norm.get("response_state") or "unknown").strip() or "unknown",
            page_liveness=liveness,
            activity_state=(norm.get("activity_state") or "").strip(),
            last_seen=last_seen,
            _raw=norm,
        )


@dataclass
class PageRegistry:
    """bridge status 解析后的页面索引。"""

    pages: List[PageSnapshot] = field(default_factory=list)
    by_key: Dict[str, PageSnapshot] = field(default_factory=dict)
    by_conversation_id: Dict[str, List[PageSnapshot]] = field(default_factory=dict)
    _status_meta: Dict[str, Any] = field(default_factory=dict)
    page_dicts: List[Dict[str, Any]] = field(default_factory=list)
    by_client_id: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    by_page_instance_id: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    by_conversation_id_dict: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    fingerprint: str = ""
    status_token: str = ""
    online_count: int = 0
    total_count: int = 0
    conversation_count: int = 0
    home_count: int = 0

    @classmethod
    def empty(cls) -> PageRegistry:
        return cls()

    @classmethod
    def from_bridge_status(cls, status: Any, *, now: float | None = None) -> PageRegistry:
        if now is None:
            now = time.time()
        registry = cls()
        if not isinstance(status, dict):
            return registry
        registry._status_meta = {
            "tm_online_summary": status.get("tm_online_summary") if isinstance(status.get("tm_online_summary"), dict) else {},
        }
        seen_keys: set[str] = set()
        for raw in pages_from_bridge_status(status):
            snap = PageSnapshot.from_raw(raw, now=now)
            if snap is None:
                continue
            key = snap.page_key
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            registry.pages.append(snap)
            registry.by_key[key] = snap
            conv = snap.conversation_id
            if conv:
                registry.by_conversation_id.setdefault(conv, []).append(snap)
        registry.status_token = status_pages_token(status)
        registry.page_dicts = sort_pages_by_display_id(
            [
                dict(snap._raw) if snap._raw else snap.to_dict()
                for snap in registry.pages
            ]
        )
        registry._rebuild_dict_indexes()
        return registry

    @classmethod
    def from_normalized_dicts(
        cls,
        page_dicts: List[Dict[str, Any]],
        status: Any,
        *,
        conversation_id_of: Optional[Callable[[dict], str]] = None,
        is_online: Optional[Callable[[dict], bool]] = None,
        now: float | None = None,
    ) -> PageRegistry:
        """从已 normalize/dedupe 的页面 dict 列表构建注册表（含 dict 索引）。"""
        if now is None:
            now = time.time()
        registry = cls()
        registry.status_token = status_pages_token(status)
        registry.page_dicts = sort_pages_by_display_id(list(page_dicts or []))
        online_fn = is_online or _ps().is_page_online
        (
            registry.online_count,
            registry.total_count,
            registry.conversation_count,
            registry.home_count,
        ) = compute_page_counts(registry.page_dicts, is_online=online_fn)
        registry.fingerprint = compute_list_fingerprint(registry.page_dicts)
        registry._rebuild_dict_indexes(conversation_id_of=conversation_id_of)
        seen_keys: set[str] = set()
        for raw in registry.page_dicts:
            snap = PageSnapshot.from_raw(raw, now=now)
            if snap is None:
                continue
            key = snap.page_key
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            registry.pages.append(snap)
            registry.by_key[key] = snap
            conv = snap.conversation_id
            if conv:
                registry.by_conversation_id.setdefault(conv, []).append(snap)
        if isinstance(status, dict):
            registry._status_meta = {
                    "tm_online_summary": status.get("tm_online_summary")
                if isinstance(status.get("tm_online_summary"), dict)
                else {},
            }
        return registry

    def matches_status(self, status: Any) -> bool:
        return self.status_token == status_pages_token(status)

    def _rebuild_dict_indexes(
        self, *, conversation_id_of: Optional[Callable[[dict], str]] = None
    ) -> None:
        by_client, by_instance, by_conv = build_page_indexes(
            self.page_dicts, conversation_id_of=conversation_id_of
        )
        self.by_client_id = by_client
        self.by_page_instance_id = by_instance
        self.by_conversation_id_dict = by_conv
        if not self.fingerprint:
            self.fingerprint = compute_list_fingerprint(self.page_dicts)
        if not self.total_count:
            online, total, conv_count, home_count = compute_page_counts(
                self.page_dicts, is_online=_ps().is_page_online
            )
            self.online_count = online
            self.total_count = total
            self.conversation_count = conv_count
            self.home_count = home_count

    def get_by_identity(
        self, client_id: str, page_instance_id: str
    ) -> Optional[PageSnapshot]:
        key = _ps().build_page_key(client_id, page_instance_id)
        if not key:
            return None
        return self.by_key.get(key)

    def get_by_conversation_id(self, conversation_id: str) -> List[PageSnapshot]:
        cid = (conversation_id or "").strip()
        if not cid:
            return []
        return list(self.by_conversation_id.get(cid) or [])

    def get_by_page_display_id(self, page_display_id: str) -> Optional[PageSnapshot]:
        target_id = str(page_display_id or "").strip()
        if not target_id:
            return None
        for page in self.pages:
            raw = page._raw if isinstance(page._raw, dict) else {}
            candidates = (
                str(raw.get("page_display_id") or "").strip(),
                str(raw.get("page_no") or "").strip(),
                str(page.page_display_id or "").strip(),
            )
            if target_id in candidates:
                return page
        return None

    def get_bound_page(
        self, binding: Mapping[str, Any] | None, *, strict_identity: bool = True
    ) -> Optional[PageSnapshot]:
        if not binding or (binding.get("bind_state") or BIND_STATE_UNBOUND) == BIND_STATE_UNBOUND:
            return None
        bind_state = (binding.get("bind_state") or "").strip()
        if bind_state == BIND_STATE_TEMP_HOME_BOUND:
            temp_page_id = (
                (binding.get("temp_page_id") or binding.get("page_display_id") or "")
                .strip()
            )
            if temp_page_id:
                page = self.get_by_page_display_id(temp_page_id)
                if page is not None:
                    return page
        client_id = (binding.get("client_id") or "").strip()
        page_instance_id = (binding.get("page_instance_id") or "").strip()
        if client_id and page_instance_id:
            return self.get_by_identity(client_id, page_instance_id)
        if strict_identity and (client_id or page_instance_id):
            return None
        conversation_id = (binding.get("conversation_id") or "").strip()
        if conversation_id:
            matches = self.get_by_conversation_id(conversation_id)
            if len(matches) == 1:
                return matches[0]
            for snap in matches:
                if client_id and snap.client_id != client_id:
                    continue
                if page_instance_id and snap.page_instance_id != page_instance_id:
                    continue
                return snap
        return None

    def list_online_pages(self) -> List[PageSnapshot]:
        return [p for p in self.pages if p.online]

    def list_conversation_pages(self) -> List[PageSnapshot]:
        return [p for p in self.pages if p.conversation_syncable]

    def list_blank_pages(self) -> List[PageSnapshot]:
        return [p for p in self.pages if _ps().is_prebound_home_page(p._raw)]

    def summary(self) -> Dict[str, int]:
        online = self.list_online_pages()
        return {
            "total_count": len(self.pages),
            "online_count": len(online),
            "url_syncable_count": sum(1 for p in self.pages if p.url_syncable),
            "conversation_syncable_count": len(self.list_conversation_pages()),
            "blank_count": len(self.list_blank_pages()),
        }
