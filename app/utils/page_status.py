"""统一页面身份、在线/可同步/可发送判定（各层共用，避免多套逻辑打架）。"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Literal, Mapping, Optional, Tuple
from urllib.parse import urlparse

from app.constants import (
    BOUND_PAGE_ONLINE_SECONDS,
    BOUND_PAGE_STALE_SECONDS,
    TM_HEARTBEAT_ONLINE_SECONDS,
)
from app.url_utils import parse_conversation_id
from app.utils.page_identity import PageIdentity
from app.utils.page_identity_proxy import PageIdentityProxyMixin
from app.utils.time_utils import float_ts as _float_ts


def _canonical_url_from(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    return (data.get("url") or "").strip()

PageStateKind = Literal["offline", "online", "conversation_ready", "prebound_home"]
PageLiveness = Literal["online", "recently_seen", "stale", "offline"]

__all__ = [
    "BUSY_RESPONSE_STATES",
    "normalize_page",
    "page_url_from",
    "conversation_syncable_from",
    "build_page_key",
    "page_registry_key",
    "latest_page_seen_ts",
    "get_page_liveness",
    "is_strict_page_online",
    "is_display_page_online",
    "is_page_online",
    "read_response_state",
    "is_page_busy",
    "can_accept_input",
    "can_sync_conversation",
    "is_page_url_syncable",
    "is_prebound_home_page",
    "classify_page_state",
    "evaluate_send_page",
    "explain_page_decision",
    "evaluate_page_capability",
    "compact_page_decision_fields",
    "compact_page_public_fields",
    "log_page_decision_fields",
    "PageCapability",
    "PageActionPlan",
    "read_snapshot_identity",
    "PageRegistry",
    "PageSnapshot",
    "binding_from_session",
    "bridge_status_online",
    "page_display_id_sort_key",
    "page_display_ids_for_log",
    "pages_from_bridge_status",
    "sort_pages_by_display_id",
    "status_pages_token",
    "page_effective_conversation_id",
    "page_poll_recency_ts",
    "find_online_fallback_page_for_binding",
    "has_stable_conversation_id",
    "is_chatgpt_home_location",
    "is_reusable_chatgpt_home_page",
    "page_list_display_id",
    "find_reusable_chatgpt_home_page",
]


def read_snapshot_identity(snapshot: Any, role: str) -> Dict[str, str]:
    """从快照/摘要读取 bound 或 active 身份（仅嵌套 snapshot[role]）。"""
    empty = {
        "client_id": "",
        "page_instance_id": "",
        "conversation_id": "",
        "url": "",
    }
    if not isinstance(snapshot, dict):
        return dict(empty)
    role_key = (role or "").strip().lower()
    nested = snapshot.get(role_key)
    if isinstance(nested, dict):
        return {
            "client_id": (nested.get("client_id") or "").strip(),
            "page_instance_id": (nested.get("page_instance_id") or "").strip(),
            "conversation_id": (nested.get("conversation_id") or "").strip(),
            "url": (nested.get("url") or "").strip(),
        }
    return dict(empty)

BUSY_RESPONSE_STATES = frozenset(
    {
        "responding",
        "generating",
        "streaming",
        "waiting",
        "pending",
        "queued",
    }
)

_CHATGPT_HOSTS = frozenset(
    {"chatgpt.com", "chat.openai.com", "www.chatgpt.com"}
)


# normalize_page 出站清理：仅删除非 canonical 的 URL 别名（不读取）
_PAGE_URL_STRIP_KEYS = (
    "page_url",
    "target_url",
    "target_page_url",
    "conversation_url",
    "tampermonkey_page_url",
    "bound_url",
    "bound_page_url",
    "normalized_url",
    "chatgpt_url",
    "last_page_url",
    "current_url",
    "reopen_target_url",
)



def conversation_syncable_from(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    val = data.get("conversation_syncable")
    if val is True:
        return True
    if val is False:
        return False
    if isinstance(val, str) and val.strip().lower() in ("true", "yes", "1"):
        return True
    return False


def page_url_from(raw: Any) -> str:
    """运行时只读 canonical url；入站迁移请用 normalize_page。"""
    return _canonical_url_from(raw)


def normalize_page(raw: Any, *, now: float | None = None) -> Dict[str, Any]:
    """规范化页面对象；只读规范字段（旧字段须在入站/加载边界先 migrate）。"""
    if not isinstance(raw, dict):
        return {}
    if now is None:
        now = time.time()

    url = (raw.get("url") or "").strip()

    conversation_id = (raw.get("conversation_id") or "").strip()
    if conversation_id in ("", "-"):
        conversation_id = ""
    if not conversation_id and url:
        conversation_id = parse_conversation_id(url) or ""

    client_id = (raw.get("client_id") or "").strip()
    page_instance_id = (raw.get("page_instance_id") or "").strip()
    page_type = (raw.get("page_type") or "").strip()
    if not page_type and url:
        if conversation_id or "/c/" in url:
            page_type = "conversation"
        elif "xz_bind_token=" in url:
            page_type = "home"
        else:
            try:
                parsed = urlparse(url)
                path = (parsed.path or "/").rstrip("/") or "/"
                host = (parsed.netloc or "").lower()
                if host in _CHATGPT_HOSTS and path == "/":
                    page_type = "home"
            except ValueError as exc:
                print(
                    f"[PAGE_STATUS][URL_PARSE_FAILED] url={url!r} error={exc!r}"
                )

    seen_values = []
    for seen_key in (
        "last_seen",
        "last_seen_at",
        "last_heartbeat_at",
        "last_poll_at",
        "last_report_at",
    ):
        seen_ts = _float_ts(
            raw.get(seen_key),
            context=f"page_status.normalize_page.{seen_key}",
            log_on_error=True,
        )
        if seen_ts:
            seen_values.append(seen_ts)

    last_seen = max(seen_values) if seen_values else 0.0

    if last_seen:
        page_liveness = get_page_liveness(raw, now=now)
    else:
        incoming_liveness = str(raw.get("page_liveness") or "").strip().lower()
        if incoming_liveness in ("online", "recently_seen", "stale", "offline"):
            page_liveness = incoming_liveness
        elif raw.get("online") is True:
            page_liveness = "online"
        else:
            page_liveness = "offline"

    online = page_liveness == "online"

    out: Dict[str, Any] = dict(raw)
    out.update(
        {
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": url,
            "page_type": page_type,
            "page_title": (raw.get("page_title") or "").strip(),
            "last_seen": last_seen,
            "online": online,
            "page_liveness": page_liveness,
            "visibility_state": (raw.get("visibility_state") or "").strip(),
            "has_focus": bool(raw.get("has_focus")),
            "can_accept_input": bool(raw.get("can_accept_input", True)),
            "response_state": (raw.get("response_state") or "unknown").strip()
            or "unknown",
            "activity_state": (raw.get("activity_state") or "").strip(),
        }
    )
    for key in _PAGE_URL_STRIP_KEYS:
        out.pop(key, None)
    return out


def build_page_key(page: Any = None, page_instance_id: str | None = None) -> str:
    """组合页面键：client_id|page_instance_id；缺任一则为无效。"""
    if page_instance_id is not None:
        client_id = str(page or "").strip()
        instance_id = str(page_instance_id).strip()
    elif isinstance(page, dict):
        client_id = str(page.get("client_id") or "").strip()
        instance_id = str(page.get("page_instance_id") or "").strip()
    else:
        return ""
    if not client_id or not instance_id:
        return ""
    return f"{client_id}|{instance_id}"


def page_registry_key(raw: Any) -> str:
    return build_page_key(raw)


def latest_page_seen_ts(page: dict) -> float:
    """最近活跃时间（心跳/轮询/上报，不含 focus）。"""
    if not isinstance(page, dict):
        return 0.0
    values = []
    for key in ("last_seen", "last_seen_at", "last_heartbeat_at", "last_poll_at", "last_report_at"):
        ts = _float_ts(page.get(key), context=f"page_status.latest_page_seen_ts.{key}")
        if ts:
            values.append(ts)
    return max(values) if values else 0.0


def get_page_liveness(page: Any, now: float | None = None) -> PageLiveness:
    """统一页面存活分级：online / recently_seen / stale / offline。"""
    if not isinstance(page, dict):
        return "offline"
    if now is None:
        now = time.time()
    last_seen = latest_page_seen_ts(page)
    if not last_seen:
        return "offline"
    try:
        age = now - float(last_seen)
    except (TypeError, ValueError) as exc:
        print(
            f"[PAGE_LIVENESS][ERROR] invalid last_seen={last_seen!r}: {exc}"
        )
        return "offline"
    if age <= TM_HEARTBEAT_ONLINE_SECONDS:
        state: PageLiveness = "online"
    elif age <= BOUND_PAGE_ONLINE_SECONDS:
        state = "recently_seen"
    elif age <= BOUND_PAGE_STALE_SECONDS:
        state = "stale"
    else:
        state = "offline"
    return state


def is_strict_page_online(page: Any, now: float | None = None) -> bool:
    """严格在线：仅 liveness == online（发送/同步/命令判定用）。"""
    return get_page_liveness(page, now=now) == "online"


def is_display_page_online(page: Any, now: float | None = None) -> bool:
    """UI 展示：online 或 recently_seen；不得用于动作强拦截。"""
    return get_page_liveness(page, now=now) in ("online", "recently_seen")


def is_page_online(page: Any, now: float | None = None) -> bool:
    """严格在线（等同 is_strict_page_online）。"""
    return is_strict_page_online(page, now=now)


def read_response_state(page: Any) -> str:
    if not isinstance(page, dict):
        return "unknown"
    norm = normalize_page(page)
    state = str(norm.get("response_state") or "").strip().lower()
    return state or "unknown"


def is_page_busy(page: Any) -> bool:
    if not isinstance(page, dict):
        return False
    norm = normalize_page(page)
    if bool(norm.get("is_responding")):
        return True
    return read_response_state(norm) in BUSY_RESPONSE_STATES


def can_accept_input(page: Any) -> bool:
    if not isinstance(page, dict):
        return True
    norm = normalize_page(page)
    return bool(norm.get("can_accept_input", True))


def is_page_url_syncable(page: Any, *, now: float | None = None) -> bool:
    """页面可同步（宽松）：在线且 url 非空；不依赖焦点/可见性/发送按钮。"""
    if not isinstance(page, dict):
        return False
    norm = normalize_page(page, now=now)
    return is_page_online(norm, now=now) and bool((norm.get("url") or "").strip())


def can_sync_conversation(page: Any, *, now: float | None = None) -> bool:
    """可同步完整对话：在线 + conversation_id + url 含 /c/。"""
    if not isinstance(page, dict):
        return False
    norm = normalize_page(page, now=now)
    if not is_page_online(norm, now=now):
        return False
    conversation_id = (norm.get("conversation_id") or "").strip()
    url = (norm.get("url") or "").strip()
    return bool(conversation_id and "/c/" in url)


def _page_dialog_ready(page: Any, *, now: float | None = None) -> bool:
    if not isinstance(page, dict):
        return False
    norm = normalize_page(page, now=now)
    page_type = (norm.get("page_type") or "").strip()
    if page_type and page_type not in ("conversation", "-"):
        return False
    return can_sync_conversation(page, now=now)


def page_effective_conversation_id(page: Any, *, now: float | None = None) -> str:
    """页面有效 conversation_id：字段优先，其次 URL /c/<id>。"""
    if not isinstance(page, dict):
        return ""
    norm = normalize_page(page, now=now)
    conversation_id = (norm.get("conversation_id") or "").strip()
    if conversation_id and conversation_id != "-":
        return conversation_id
    url = (norm.get("url") or "").strip()
    if url:
        return parse_conversation_id(url) or ""
    return ""


def page_poll_recency_ts(page: Any) -> float:
    """页面 poll/seen 新鲜度键（越大越新）。"""
    if not isinstance(page, dict):
        raw = getattr(page, "_raw", None)
        page = raw if isinstance(raw, dict) else {}
    if not isinstance(page, dict):
        return 0.0
    for key in ("last_poll_at", "last_seen", "last_heartbeat_at", "last_report_at"):
        ts = _float_ts(page.get(key), context=f"page_status.page_poll_recency_ts.{key}")
        if ts:
            return ts
    return 0.0


_FALLBACK_STRATEGY_RANK = {
    "same_conversation": 3,
    "url_conversation": 2,
    "client_id_conversation": 1,
}


def find_online_fallback_page_for_binding(
    registry: "PageRegistry",
    binding: Mapping[str, Any] | None,
    *,
    now: float | None = None,
    require_conversation_syncable: bool = False,
    exclude_client_id: str = "",
    exclude_page_instance_id: str = "",
) -> Tuple[Optional["PageSnapshot"], str]:
    """
    绑定页离线/失效时，在在线页面中按 conversation 兜底：
    1. conversation_id 字段
    2. URL /c/<conversation_id>
    3. 同 client_id 且 conversation 一致
    多个候选时取 last_poll_at 最新；策略优先级高于 poll 时间。
    """
    if now is None:
        now = time.time()
    if not binding or not isinstance(registry, PageRegistry):
        return None, ""
    bound_conv = (binding.get("conversation_id") or "").strip()
    if not bound_conv:
        url = (binding.get("url") or "").strip()
        bound_conv = parse_conversation_id(url) or ""
    if not bound_conv:
        return None, ""
    bound_client = (binding.get("client_id") or "").strip()
    exclude_client = (exclude_client_id or bound_client or "").strip()
    exclude_instance = (exclude_page_instance_id or "").strip()
    if not exclude_instance:
        exclude_instance = (binding.get("page_instance_id") or "").strip()

    candidates: list[tuple[int, float, str, PageSnapshot]] = []
    seen_keys: set[str] = set()

    def _consider(page: PageSnapshot, matched_by: str) -> None:
        if page is None:
            return
        key = page.page_key
        if not key or key in seen_keys:
            return
        raw = page._raw if isinstance(page._raw, dict) else {}
        if not is_page_online(raw, now=now):
            return
        if is_prebound_home_page(raw, now=now):
            return
        page_type = (raw.get("page_type") or page.page_type or "").strip()
        if page_type == "home":
            return
        page_conv = page_effective_conversation_id(raw, now=now)
        if page_conv != bound_conv:
            return
        if require_conversation_syncable and not can_sync_conversation(raw, now=now):
            return
        if (
            exclude_client
            and exclude_instance
            and page.client_id == exclude_client
            and page.page_instance_id == exclude_instance
        ):
            return
        strategy_rank = _FALLBACK_STRATEGY_RANK.get(matched_by, 0)
        if strategy_rank <= 0:
            return
        seen_keys.add(key)
        candidates.append(
            (strategy_rank, page_poll_recency_ts(raw), matched_by, page)
        )

    for snap in registry.get_by_conversation_id(bound_conv):
        _consider(snap, "same_conversation")

    for snap in registry.list_online_pages():
        raw = snap._raw if isinstance(snap._raw, dict) else {}
        url_conv = parse_conversation_id((raw.get("url") or snap.url or "").strip())
        if url_conv == bound_conv:
            _consider(snap, "url_conversation")

    if bound_client:
        for snap in registry.pages:
            if (snap.client_id or "").strip() != bound_client:
                continue
            _consider(snap, "client_id_conversation")

    if not candidates:
        return None, ""
    candidates.sort(key=lambda row: (row[0], row[1]), reverse=True)
    _, _, matched_by, best = candidates[0]
    return best, matched_by


def has_stable_conversation_id(page: Any, *, now: float | None = None) -> bool:
    """conversation_id 为有效稳定值（非空、非 -、非 null 占位）。"""
    if not isinstance(page, dict):
        return False
    norm = normalize_page(page, now=now)
    conversation_id = (norm.get("conversation_id") or "").strip()
    if conversation_id in ("", "-", "null", "undefined"):
        return False
    if conversation_id:
        return True
    url = (norm.get("url") or "").strip()
    return bool(parse_conversation_id(url))


def is_chatgpt_home_location(page: Any) -> bool:
    """是否为 ChatGPT 根路径首页（url 与 pathname 任一满足即可）。"""
    if not isinstance(page, dict):
        return False
    url = (page.get("url") or page_url_from(page) or "").strip()
    pathname = (page.get("pathname") or "").strip()
    if url in ("https://chatgpt.com/", "https://chatgpt.com"):
        return True
    if pathname in ("/", ""):
        if not url:
            page_type = (page.get("page_type") or "").strip()
            return page_type == "home"
        try:
            parsed = urlparse(url)
            host = (parsed.netloc or "").lower()
            if host in _CHATGPT_HOSTS:
                path = (parsed.path or "/").rstrip("/") or "/"
                return path == "/"
        except ValueError as exc:
            print(f"[PAGE_STATUS][URL_PARSE_FAILED] url={url!r} error={exc!r}")
    if not url:
        return False
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        print(f"[PAGE_STATUS][URL_PARSE_FAILED] url={url!r} error={exc!r}")
        return False
    path = (parsed.path or "/").rstrip("/") or "/"
    host = (parsed.netloc or "").lower()
    return host in _CHATGPT_HOSTS and path == "/"


def is_reusable_chatgpt_home_page(page: Any, *, now: float | None = None) -> bool:
    """
    是否可作为「新建本地对话首条发送」的复用首页。
    仅做页面形态判定，不执行绑定或打开页面。
    """
    if not isinstance(page, dict):
        return False
    if not is_page_online(page, now=now):
        return False
    if has_stable_conversation_id(page, now=now):
        return False
    if is_chatgpt_home_location(page):
        return True
    norm = normalize_page(page, now=now)
    page_type = (norm.get("page_type") or "").strip()
    return page_type == "home" and not has_stable_conversation_id(page, now=now)


def page_list_display_id(page: Any) -> str:
    """bridge 页面列表中的展示 ID（page_display_id / page_no / page_id）。"""
    if not isinstance(page, dict):
        return ""
    for key in ("page_display_id", "page_no", "page_id", "id"):
        value = str(page.get(key) or "").strip()
        if value and value != "-":
            return value
    return ""


def find_reusable_chatgpt_home_page(
    pages: List[Dict[str, Any]],
    preferred_page_id: str = "",
    *,
    now: float | None = None,
    is_eligible: Optional[Callable[[Dict[str, Any]], bool]] = None,
) -> Optional[Dict[str, Any]]:
    """
    在 bridge 页面列表中查找可复用的 ChatGPT 首页。
    优先 preferred_page_id（下拉框当前选中），否则取最近活跃在线首页。
    """
    if not isinstance(pages, list) or not pages:
        return None
    preferred_page_id = str(preferred_page_id or "").strip()

    if preferred_page_id:
        for page in pages:
            if not isinstance(page, dict):
                continue
            if page_list_display_id(page) != preferred_page_id:
                continue
            if not is_reusable_chatgpt_home_page(page, now=now):
                continue
            if is_eligible is not None and not is_eligible(page):
                continue
            return page

    reusable_pages: List[Dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        if not is_reusable_chatgpt_home_page(page, now=now):
            continue
        if is_eligible is not None and not is_eligible(page):
            continue
        reusable_pages.append(page)

    if not reusable_pages:
        return None

    reusable_pages.sort(
        key=lambda row: page_poll_recency_ts(row),
        reverse=True,
    )
    return reusable_pages[0]


def is_prebound_home_page(page: Any, *, now: float | None = None) -> bool:
    """首页预绑定：在线 + home + 无 conversation_id + 根路径或 xz_bind_token。"""
    if not isinstance(page, dict):
        return False
    if not is_page_online(page, now=now):
        return False
    norm = normalize_page(page, now=now)
    page_type = (norm.get("page_type") or "").strip()
    conversation_id = (norm.get("conversation_id") or "").strip()
    if conversation_id:
        return False
    if page_type != "home":
        return False
    url = (norm.get("url") or "").strip()
    if "xz_bind_token=" in url:
        return True
    if not url:
        return False
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        print(f"[PAGE_STATUS][URL_PARSE_FAILED] url={url!r} error={exc!r}")
        return False
    path = (parsed.path or "/").rstrip("/") or "/"
    host = (parsed.netloc or "").lower()
    return host in _CHATGPT_HOSTS and path == "/"


def classify_page_state(page: Any, *, now: float | None = None) -> Dict[str, Any]:
    """返回统一状态字段。"""
    online = is_page_online(page, now=now) if isinstance(page, dict) else False
    dialog_ready = _page_dialog_ready(page, now=now) if isinstance(page, dict) else False
    prebound_home = is_prebound_home_page(page, now=now) if isinstance(page, dict) else False
    page_liveness = get_page_liveness(page, now=now) if isinstance(page, dict) else "offline"
    if not online:
        state: PageStateKind = "offline"
    elif dialog_ready:
        state = "conversation_ready"
    elif prebound_home:
        state = "prebound_home"
    else:
        state = "online"
    norm = normalize_page(page, now=now) if isinstance(page, dict) else {}
    return {
        "online": online,
        "dialog_ready": dialog_ready,
        "prebound_home": prebound_home,
        "page_state": state,
        "page_liveness": page_liveness,
        "page_type": norm.get("page_type") or "",
        "client_id": norm.get("client_id") or "",
        "page_instance_id": norm.get("page_instance_id") or "",
        "conversation_id": norm.get("conversation_id") or "",
        "url": norm.get("url") or "",
    }


def evaluate_send_page(
    page: Any,
    expected_conversation_id: str = "",
) -> Tuple[str, str]:
    """
    返回 (decision, reason)。
    decision: allowed | queued | blocked
    """
    if not isinstance(page, dict):
        return "blocked", "invalid_page"
    norm = normalize_page(page)
    client_id = norm.get("client_id") or ""
    page_instance_id = norm.get("page_instance_id") or ""
    if not client_id:
        return "blocked", "missing_client_id"
    if not page_instance_id:
        return "blocked", "missing_page_instance_id"
    if not is_page_online(norm):
        return "blocked", "offline"
    url = norm.get("url") or ""
    if not url:
        return "blocked", "missing_url"
    conversation_id = (norm.get("conversation_id") or "").strip()
    if not conversation_id:
        conversation_id = parse_conversation_id(url) or ""
    if not conversation_id:
        if is_prebound_home_page(norm) or (norm.get("page_type") or "").strip() == "home":
            if is_page_busy(norm):
                return "queued", "waiting_for_response"
            response_state = read_response_state(norm)
            if response_state in BUSY_RESPONSE_STATES:
                return "queued", "waiting_for_response"
            if not can_accept_input(norm):
                return "queued", "waiting_for_input"
            return "allowed", "home_bootstrap"
        return "blocked", "missing_conversation_id"
    expected = (expected_conversation_id or "").strip()
    if expected and conversation_id != expected:
        return "blocked", "conversation_mismatch"
    if norm.get("page_type") in ("-", "home", "ignored"):
        return "blocked", "not_conversation_page"
    if not ("/c/" in url or conversation_id):
        return "blocked", "not_conversation_url"

    response_state = read_response_state(norm)
    if is_page_busy(norm):
        return "queued", "waiting_for_response"
    if response_state in BUSY_RESPONSE_STATES:
        return "queued", "waiting_for_response"
    if not can_accept_input(norm):
        return "queued", "waiting_for_input"
    # can_send_now reflects the current ChatGPT composer before we inject text.
    # An empty composer reports a disabled send button, but it is still ready for
    # bridge-driven sends because the client fills the composer first.
    if response_state == "unknown":
        return "allowed", "unknown_state_defer_to_tm"
    return "allowed", "ready"


@dataclass
class PageCapability:
    """统一页面能力判定结果（UI、server、执行入口共用）。"""

    online: bool = False
    conversation_syncable: bool = False
    page_liveness: str = "offline"
    client_id: str = ""
    page_instance_id: str = ""
    conversation_id: str = ""
    url: str = ""
    page_type: str = ""
    response_state: str = "unknown"
    can_accept_input: bool = True
    send_decision: str = "blocked"
    reason_code: str = ""
    prebound_home: bool = False

    @property
    def allowed(self) -> bool:
        return self.send_decision in ("allowed", "queued")

    @property
    def send_requestable(self) -> bool:
        return self.send_decision in ("allowed", "queued") or (
            self.prebound_home and self.online
        )

    @property
    def send_now_available(self) -> bool:
        return self.send_decision == "allowed"

    @property
    def send_queueable(self) -> bool:
        return self.send_decision == "queued"

    @property
    def bootstrap_sendable(self) -> bool:
        return self.prebound_home and self.online

    @property
    def url_syncable(self) -> bool:
        return self.online and bool(self.url)

    @property
    def identity(self) -> PageIdentity:
        return PageIdentity(
            client_id=self.client_id,
            page_instance_id=self.page_instance_id,
            conversation_id=self.conversation_id,
            url=self.url,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "client_id": self.client_id,
            "page_instance_id": self.page_instance_id,
            "conversation_id": self.conversation_id,
            "url": self.url,
            "page_type": self.page_type,
            "online": self.online,
            "conversation_syncable": self.conversation_syncable,
            "page_liveness": self.page_liveness,
            "prebound_home": self.prebound_home,
            "response_state": self.response_state or "unknown",
            "can_accept_input": self.can_accept_input,
            "send_decision": self.send_decision,
            "reason_code": self.reason_code,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> PageCapability:
        if not isinstance(data, dict):
            return PageCapability()
        send_decision = (
            data.get("send_decision") or data.get("decision") or "blocked"
        )
        reason_code = (data.get("reason_code") or "").strip()
        page_liveness = (data.get("page_liveness") or "offline").strip()
        online = bool(data.get("online"))
        if not online and page_liveness == "online":
            online = True
        if online and page_liveness == "offline":
            page_liveness = "online"
        return cls(
            online=online,
            conversation_syncable=bool(data.get("conversation_syncable")),
            page_liveness=page_liveness,
            send_decision=str(send_decision).strip() or "blocked",
            reason_code=reason_code,
            response_state=(data.get("response_state") or "unknown").strip(),
            client_id=(data.get("client_id") or "").strip(),
            page_instance_id=(data.get("page_instance_id") or "").strip(),
            conversation_id=(data.get("conversation_id") or "").strip(),
            url=(data.get("url") or "").strip(),
            page_type=(data.get("page_type") or "").strip(),
            prebound_home=bool(data.get("prebound_home")),
            can_accept_input=bool(data.get("can_accept_input", True)),
        )


@dataclass
class PageActionPlan(PageIdentityProxyMixin):
    """统一页面动作判定（send / sync_conversation / copy_last / upload）。"""

    action: str
    decision: str
    target_source: str
    reason_code: str
    capability: PageCapability
    page: Any = None

    @property
    def allowed(self) -> bool:
        return self.decision in ("allowed", "queued")

    @property
    def conversation_syncable(self) -> bool:
        return bool(self.capability.conversation_syncable)

    @property
    def send_decision(self) -> str:
        return (self.capability.send_decision or "blocked").strip()

    @property
    def identity(self) -> PageIdentity:
        return PageIdentity.from_mapping(self.capability.to_dict())

    @property
    def online(self) -> bool:
        return bool(self.capability.online)

    @classmethod
    def from_resolve_result(cls, data: Dict[str, Any]) -> PageActionPlan:
        if not isinstance(data, dict):
            cap = PageCapability(reason_code="invalid_page_action_result")
            return cls(
                action="",
                decision="blocked",
                target_source="",
                reason_code="invalid_page_action_result",
                capability=cap,
            )
        cap_raw = data.get("capability_detail")
        if isinstance(cap_raw, PageCapability):
            cap = cap_raw
        elif isinstance(cap_raw, dict):
            cap = PageCapability.from_dict(cap_raw)
        else:
            cap = PageCapability.from_dict(data)
        if not cap.client_id:
            cap = PageCapability.from_dict(
                {
                    **cap.to_dict(),
                    "client_id": (data.get("client_id") or "").strip(),
                    "page_instance_id": (data.get("page_instance_id") or "").strip(),
                    "conversation_id": (data.get("conversation_id") or "").strip(),
                    "url": (data.get("url") or "").strip(),
                }
            )
        reason_code = (
            data.get("reason_code")
            or data.get("reason")
            or data.get("reason_code")
            or ""
        ).strip()
        page = data.get("page")
        if page is None:
            page = data.get("target_item")
        if page is None:
            page = data.get("target")
        return cls(
            action=(data.get("action") or "").strip(),
            decision=(data.get("decision") or "blocked").strip(),
            target_source=(data.get("target_source") or "").strip(),
            reason_code=reason_code,
            capability=cap,
            page=page,
        )

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "action": self.action,
            "decision": self.decision,
            "reason_code": self.reason_code,
            "target_source": self.target_source,
            "capability": self.capability.to_dict(),
        }
        if isinstance(self.page, dict):
            out["page"] = self.page
        return out

    def as_send_decision_tuple(self) -> Tuple[str, str, Any, Dict[str, Any]]:
        return (
            self.decision,
            self.reason_code,
            self.page,
            self.capability.to_dict(),
        )

    def as_sync_decision_tuple(self) -> Tuple[bool, Any, str, str, Dict[str, Any]]:
        allowed = self.decision == "allowed"
        block = "" if allowed else (self.reason_code or "blocked")
        return (
            allowed,
            self.page,
            self.target_source,
            block,
            self.capability.to_dict(),
        )

    def to_sync_target_snapshot(
        self,
        *,
        remote: Optional[Dict[str, Any]] = None,
        status: Optional[Dict[str, Any]] = None,
        short_label: str = "",
    ) -> Dict[str, Any]:
        remote = remote if isinstance(remote, dict) else {}
        status = status if isinstance(status, dict) else {}
        remote_client_id = (remote.get("client_id") or "").strip()
        remote_page_instance_id = (remote.get("page_instance_id") or "").strip()
        remote_conversation_id = (remote.get("conversation_id") or "").strip()
        remote_url = (remote.get("url") or "").strip()
        active = read_snapshot_identity(status, "active")
        active_client_id = active["client_id"]
        active_conversation_id = active["conversation_id"]
        active_matches_bound = bool(
            active_client_id and remote_client_id and active_client_id == remote_client_id
        )
        cap = self.capability
        conv_sync = bool(cap.conversation_syncable) or self.decision == "allowed"
        sync_readable = conv_sync
        from app.models import remote_binding_enabled

        from app.utils.target_sources import (
            TARGET_SOURCE_BOUND_PAGE,
            TARGET_SOURCE_NO_SESSION,
            canonical_target_source,
            target_source_label,
        )

        resolved_source = canonical_target_source(self.target_source) or (
            TARGET_SOURCE_BOUND_PAGE
            if remote_binding_enabled(remote)
            else TARGET_SOURCE_NO_SESSION
        )
        source_label = target_source_label(resolved_source)
        return {
            "conversation_syncable": conv_sync,
            "sync_readable": sync_readable,
            "send_decision": self.send_decision,
            "reason_code": self.reason_code or "",
            "response_state": cap.response_state or "unknown",
            "online": cap.online,
            "source": resolved_source,
            "source_label": source_label,
            "target_matches_bound": bool(self.client_id),
            "short_label": short_label or (self.client_id or "不可用"),
            "client_id": self.client_id,
            "page_instance_id": self.page_instance_id,
            "conversation_id": self.conversation_id,
            "url": self.url,
            "page_type": (
                (self.page.get("page_type") or "").strip()
                if isinstance(self.page, dict)
                else ""
            ),
            "bound": {
                "client_id": remote_client_id,
                "page_instance_id": remote_page_instance_id,
                "conversation_id": remote_conversation_id,
                "url": remote_url,
            },
            "active": {
                "client_id": active_client_id,
                "conversation_id": active_conversation_id,
            },
            "active_matches_bound": active_matches_bound,
        }


def _page_block_reason_for_sync(
    norm: Dict[str, Any],
    classified: Dict[str, Any],
    online: bool,
) -> str:
    if not online:
        return "offline"
    if classified.get("prebound_home"):
        return "prebound_home_wait_conversation"
    if not (norm.get("url") or ""):
        return "missing_url"
    if not (norm.get("conversation_id") or ""):
        return "missing_conversation_id"
    return "not_conversation_page"


def evaluate_page_capability(
    page: Any,
    *,
    action: Optional[str] = None,
    bound: bool = False,
    expected_conversation_id: str = "",
    expected_client_id: str = "",
    expected_page_instance_id: str = "",
    now: float | None = None,
) -> PageCapability:
    """统一能力判定：online / send_decision / reason_code（细分能力仅内部计算）。"""
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
        if not can_sync_conversation(norm, now=now):
            reason = _page_block_reason_for_sync(norm, classified, online)
    elif act == "send":
        reason = send_reason
    elif act == "sync_url":
        if not is_page_url_syncable(norm, now=now):
            reason = _page_block_reason_for_sync(norm, classified, online)
            send_decision = "blocked"
        else:
            send_decision = "allowed"
            reason = "ready"
    elif act == "upload":
        if not online:
            reason = "offline"
            send_decision = "blocked"
        elif not bool(norm.get("upload_bridge_supported")):
            reason = "upload_bridge_not_supported"
            send_decision = "blocked"
        else:
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
        page_liveness=str(classified.get("page_liveness") or get_page_liveness(norm, now=now)),
        send_decision=send_decision,
        reason_code=reason,
        response_state=response_state,
        client_id=norm.get("client_id") or "",
        page_instance_id=norm.get("page_instance_id") or "",
        conversation_id=norm.get("conversation_id") or "",
        url=norm.get("url") or "",
        page_type=(norm.get("page_type") or "").strip(),
        prebound_home=prebound_home,
        can_accept_input=can_accept_input_val,
    )


def explain_page_decision(page: Any, action: str = "sync") -> Dict[str, Any]:
    cap = evaluate_page_capability(page, action=action)
    out = cap.to_dict()
    if isinstance(page, dict):
        norm = normalize_page(page)
        out["response_state"] = norm.get("response_state") or "unknown"
    return out


def compact_page_public_fields(page: dict) -> dict:
    """UI 页面列表对外字段（不含重复能力/发送细分）。"""
    if not isinstance(page, dict):
        return {}
    cap = evaluate_page_capability(page, action="send")
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
        "reason_code": cap.reason_code,
    }


def compact_page_decision_fields(decision: dict) -> str:
    """Compact log line for page decision."""
    return (
        "[PAGE_CAPABILITY][EVAL] "
        + "client_id=" + str(decision.get("client_id") or "-") + " "
        + "page_instance_id=" + str(decision.get("page_instance_id") or "-") + " "
        + "conversation_id=" + str(decision.get("conversation_id") or "-") + " "
        + "url=" + str(decision.get("url") or "-") + " "
        + "liveness=" + str(decision.get("liveness") or decision.get("page_liveness") or "-") + " "
        + "can_sync=" + str(decision.get("can_sync") or "-") + " "
        + "can_send=" + str(decision.get("can_send") or "-") + " "
        + "busy=" + str(decision.get("busy") or "-") + " "
        + "reason_code=" + str(decision.get("reason_code") or decision.get("block_reason") or decision.get("reason") or "-")
        + " legacy_block_reason=" + str(decision.get("block_reason") or "-")
    )


def log_page_decision_fields(decision: Dict[str, Any], *, compact: bool = True) -> str:
    return compact_page_decision_fields(decision)


# Re-export snapshot/registry helpers (canonical implementation in page_snapshot.py).
from app.utils.page_snapshot import (  # noqa: E402
    PageRegistry,
    PageSnapshot,
    binding_from_session,
    bridge_status_online,
    page_display_id_sort_key,
    page_display_ids_for_log,
    pages_from_bridge_status,
    sort_pages_by_display_id,
    status_pages_token,
)
