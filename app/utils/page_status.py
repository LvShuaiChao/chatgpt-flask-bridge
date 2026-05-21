"""统一页面身份、在线/可同步/可发送判定（各层共用，避免多套逻辑打架）。"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional, Tuple
from urllib.parse import urlparse

from app.constants import (
    BOUND_PAGE_ONLINE_SECONDS,
    BOUND_PAGE_STALE_SECONDS,
    TM_HEARTBEAT_ONLINE_SECONDS,
)
from app.url_utils import parse_conversation_id
from app.utils.time_utils import float_ts as _float_ts

PageStateKind = Literal["offline", "online", "dialog_ready", "prebound_home"]
PageLiveness = Literal["online", "recently_seen", "stale", "offline"]

__all__ = [
    "normalize_page",
    "normalize_page_url_fields",
    "page_url_from",
    "page_registry_key",
    "get_page_liveness",
    "is_page_online",
    "can_sync_conversation",
    "is_page_url_syncable",
    "is_conversation_syncable",
    "is_dialog_ready_page",
    "is_prebound_home_page",
    "classify_page_state",
    "is_page_syncable",
    "evaluate_send_page",
    "explain_page_decision",
    "evaluate_page_capability",
    "log_page_decision_fields",
    "PageCapability",
]

_CHATGPT_HOSTS = frozenset(
    {"chatgpt.com", "chat.openai.com", "www.chatgpt.com"}
)

_URL_READ_KEYS = (
    "url",
    "page_url",
    "conversation_url",
    "target_page_url",
    "target_url",
    "normalized_url",
    "bound_url",
    "bound_page_url",
    "chatgpt_url",
    "last_page_url",
    "current_url",
    "reopen_target_url",
)

_DEPRECATED_URL_LOGGED: set[str] = set()


def page_url_from(raw: Any) -> str:
    if not isinstance(raw, dict):
        return ""
    for key in _URL_READ_KEYS:
        val = (raw.get(key) or "").strip()
        if val and val != "-":
            return val
    return ""


def normalize_page_url_fields(raw: Any) -> Dict[str, str]:
    """Migrate legacy URL aliases into the canonical url field without writing aliases."""
    if not isinstance(raw, dict):
        return {"url": "", "url_source": ""}
    for key in _URL_READ_KEYS:
        val = (raw.get(key) or "").strip()
        if val and val != "-":
            if key != "url":
                _maybe_log_deprecated_url_field(raw, key)
            return {"url": val, "url_source": key}
    return {"url": "", "url_source": ""}


def _maybe_log_deprecated_url_field(raw: dict, used_key: str) -> None:
    if used_key == "url" or used_key in _DEPRECATED_URL_LOGGED:
        return
    _DEPRECATED_URL_LOGGED.add(used_key)
    client_id = (raw.get("client_id") or "-").strip()
    page_instance_id = (raw.get("page_instance_id") or "-").strip()
    print(
        f"[FIELD][MIGRATE] field={used_key} replacement=url "
        f"client_id={client_id} page_instance_id={page_instance_id}"
    )


def normalize_page(raw: Any, *, now: float | None = None) -> Dict[str, Any]:
    """规范化页面对象；写入统一 url，读取兼容旧 URL 字段。"""
    if not isinstance(raw, dict):
        return {}
    if now is None:
        now = time.time()

    url_info = normalize_page_url_fields(raw)
    url = url_info["url"]

    conversation_id = (
        (raw.get("conversation_id") or raw.get("chatgpt_conversation_id") or "")
        .strip()
    )
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

    last_seen = _float_ts(
        raw.get("last_seen"),
        context="page_status.normalize_page.last_seen",
        log_on_error=True,
    )
    page_liveness = get_page_liveness(raw, now=now) if last_seen else "offline"
    online = page_liveness == "online"
    legacy_online = bool(raw.get("online")) if not last_seen else None

    out: Dict[str, Any] = dict(raw)
    for legacy_url_key in _URL_READ_KEYS:
        if legacy_url_key != "url":
            out.pop(legacy_url_key, None)
    out.update(
        {
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": url,
            "page_type": page_type,
            "page_title": (raw.get("page_title") or raw.get("title") or "").strip(),
            "last_seen": last_seen,
            "online": online,
            "page_liveness": page_liveness,
            "legacy_online": legacy_online,
            "visibility_state": (
                raw.get("visibility_state")
                or raw.get("visible")
                or ""
            ),
            "has_focus": bool(raw.get("has_focus") or raw.get("is_focused")),
            "can_accept_input": bool(raw.get("can_accept_input", True)),
            "can_send_now": raw.get("can_send_now"),
            "is_responding": bool(raw.get("is_responding")),
            "response_state": (raw.get("response_state") or "unknown").strip()
            or "unknown",
            "activity_state": (raw.get("activity_state") or raw.get("activity") or "").strip(),
        }
    )
    return out


def page_registry_key(raw: Any) -> str:
    page = normalize_page(raw) if isinstance(raw, dict) else {}
    client_id = page.get("client_id") or ""
    page_instance_id = page.get("page_instance_id") or ""
    if not client_id:
        return ""
    if page_instance_id:
        return f"{client_id}|{page_instance_id}"
    return client_id


def get_page_liveness(page: Any, now: float | None = None) -> PageLiveness:
    """统一页面存活分级：online / recently_seen / stale / offline。"""
    if not isinstance(page, dict):
        return "offline"
    if now is None:
        now = time.time()
    last_seen = _float_ts(
        page.get("last_seen")
        or page.get("last_heartbeat_at")
        or page.get("last_poll_at"),
        context="page_status.get_page_liveness.last_seen",
        log_on_error=True,
    )
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


def is_page_online(page: Any, now: float | None = None) -> bool:
    """仅根据最近心跳 last_seen 判断在线，不依赖焦点/可见性/输入框/生成状态。"""
    return get_page_liveness(page, now=now) == "online"


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


def is_conversation_syncable(page: Any, *, now: float | None = None) -> bool:
    """兼容旧名：等同 can_sync_conversation。"""
    return can_sync_conversation(page, now=now)


def is_dialog_ready_page(page: Any, *, now: float | None = None) -> bool:
    """UI 文案兼容：与 can_sync_conversation 一致。"""
    if not isinstance(page, dict):
        return False
    norm = normalize_page(page, now=now)
    page_type = (norm.get("page_type") or "").strip()
    if page_type and page_type not in ("conversation", "-"):
        return False
    return can_sync_conversation(page, now=now)


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
    """返回统一状态字段；state 仅保留为 legacy_state 兼容。"""
    online = is_page_online(page, now=now) if isinstance(page, dict) else False
    dialog_ready = is_dialog_ready_page(page, now=now) if isinstance(page, dict) else False
    prebound_home = is_prebound_home_page(page, now=now) if isinstance(page, dict) else False
    page_liveness = get_page_liveness(page, now=now) if isinstance(page, dict) else "offline"
    if not online:
        state: PageStateKind = "offline"
    elif dialog_ready:
        state = "dialog_ready"
    elif prebound_home:
        state = "prebound_home"
    else:
        state = "online"
    norm = normalize_page(page, now=now) if isinstance(page, dict) else {}
    return {
        "online": online,
        "dialog_ready": dialog_ready,
        "prebound_home": prebound_home,
        "legacy_state": state,
        "state": state,
        "page_liveness": page_liveness,
        "client_id": norm.get("client_id") or "",
        "page_instance_id": norm.get("page_instance_id") or "",
        "conversation_id": norm.get("conversation_id") or "",
        "url": norm.get("url") or "",
        "page_type": norm.get("page_type") or "",
    }


def is_page_syncable(page: Any, *, require_conversation: bool = True) -> bool:
    """兼容旧名：默认等同 is_dialog_ready_page（同步硬拦截）。"""
    if not require_conversation:
        return is_page_online(page)
    return is_dialog_ready_page(page)


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
        return "blocked", "missing_conversation_id"
    expected = (expected_conversation_id or "").strip()
    if expected and conversation_id != expected:
        return "blocked", "conversation_mismatch"
    if norm.get("page_type") in ("-", "home", "ignored"):
        return "blocked", "not_conversation_page"
    if not ("/c/" in url or conversation_id):
        return "blocked", "not_conversation_url"

    if norm.get("can_send_now") is False:
        return "queued", "send_button_unavailable"
    if norm.get("is_responding") or not norm.get("can_accept_input", True):
        return "queued", "waiting_for_input"
    return "allowed", "ready"


@dataclass
class PageCapability:
    """统一页面能力判定结果（UI、server、执行入口共用）。"""

    online: bool = False
    bound: bool = False
    syncable: bool = False
    conversation_syncable: bool = False
    sendable: bool = False
    queueable: bool = False
    reason: str = ""
    block_reason: str = ""
    client_id: str = ""
    page_instance_id: str = ""
    conversation_id: str = ""
    url: str = ""
    page_liveness: str = "offline"
    dialog_ready: bool = False
    prebound_home: bool = False
    send_decision: str = "blocked"
    url_syncable: bool = False
    client_id_mismatch: bool = False
    page_instance_id_mismatch: bool = False
    conversation_mismatch: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "client_id": self.client_id,
            "page_instance_id": self.page_instance_id,
            "conversation_id": self.conversation_id,
            "url": self.url,
            "online": self.online,
            "bound": self.bound,
            "client_id_mismatch": self.client_id_mismatch,
            "page_instance_id_mismatch": self.page_instance_id_mismatch,
            "conversation_mismatch": self.conversation_mismatch,
            "page_liveness": self.page_liveness,
            "dialog_ready": self.dialog_ready,
            "prebound_home": self.prebound_home,
            "page_state": "offline" if not self.online else "online",
            "legacy_state": "",
            "can_sync_conversation": self.conversation_syncable,
            "url_syncable": self.url_syncable,
            "syncable": self.syncable,
            "conversation_syncable": self.conversation_syncable,
            "sendable": self.sendable,
            "queueable": self.queueable,
            "send_queued": self.queueable,
            "send_decision": self.send_decision,
            "blocked_reason": self.block_reason,
            "reason": self.reason,
            "response_state": "unknown",
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
    """统一能力判定：online/url_syncable/conversation_syncable/sendable/queueable。"""
    norm = normalize_page(page, now=now) if isinstance(page, dict) else {}
    if not norm:
        return PageCapability(reason="no_page", block_reason="no_page")
    classified = classify_page_state(norm, now=now)
    online = bool(classified.get("online"))
    url_syncable = is_page_url_syncable(norm, now=now)
    conversation_syncable = can_sync_conversation(norm, now=now)
    dialog_ready = conversation_syncable
    # 保持当前外部行为：syncable 仍按完整对话可同步处理，避免改变按钮/同步流程。
    syncable = conversation_syncable
    send_decision, send_reason = evaluate_send_page(
        norm,
        expected_conversation_id,
    )
    sendable = send_decision == "allowed"
    queueable = send_decision == "queued"
    block_reason = ""
    reason = ""
    if action == "sync" and not conversation_syncable:
        block_reason = _page_block_reason_for_sync(norm, classified, online)
        reason = block_reason
    elif action == "send":
        if send_decision == "blocked":
            block_reason = send_reason
        elif send_decision == "queued":
            reason = send_reason
        else:
            reason = send_reason

    exp_cid = (expected_conversation_id or "").strip()
    exp_client = (expected_client_id or "").strip()
    exp_instance = (expected_page_instance_id or "").strip()
    client_id_mismatch = bool(
        norm and exp_client and (norm.get("client_id") or "").strip() != exp_client
    )
    page_instance_id_mismatch = bool(
        norm
        and exp_instance
        and (norm.get("page_instance_id") or "").strip() != exp_instance
    )
    page_conv = (norm.get("conversation_id") or "").strip() if norm else ""
    conversation_mismatch = bool(
        norm and exp_cid and page_conv and page_conv != exp_cid
    )
    if client_id_mismatch:
        block_reason = block_reason or "client_id_mismatch"
    if page_instance_id_mismatch:
        block_reason = block_reason or "page_instance_id_mismatch"
    if conversation_mismatch:
        block_reason = block_reason or "conversation_mismatch"

    return PageCapability(
        online=online,
        bound=bound,
        syncable=syncable,
        conversation_syncable=conversation_syncable,
        sendable=sendable,
        queueable=queueable,
        reason=reason,
        block_reason=block_reason,
        client_id=norm.get("client_id") or "",
        page_instance_id=norm.get("page_instance_id") or "",
        conversation_id=norm.get("conversation_id") or "",
        url=norm.get("url") or "",
        page_liveness=str(classified.get("page_liveness") or "offline"),
        dialog_ready=dialog_ready,
        prebound_home=bool(classified.get("prebound_home")),
        send_decision=send_decision,
        url_syncable=url_syncable,
        client_id_mismatch=client_id_mismatch,
        page_instance_id_mismatch=page_instance_id_mismatch,
        conversation_mismatch=conversation_mismatch,
    )


def explain_page_decision(page: Any, action: str = "sync") -> Dict[str, Any]:
    cap = evaluate_page_capability(page, action=action)
    out = cap.to_dict()
    if isinstance(page, dict):
        norm = normalize_page(page)
        classified = classify_page_state(norm)
        out["legacy_state"] = classified.get("legacy_state") or ""
        out["page_state"] = out["legacy_state"] or out["page_state"]
        out["response_state"] = norm.get("response_state") or "unknown"
    return out


def log_page_decision_fields(decision: Dict[str, Any]) -> str:
    return (
        f"client_id={decision.get('client_id') or '-'} "
        f"page_instance_id={decision.get('page_instance_id') or '-'} "
        f"conversation_id={decision.get('conversation_id') or '-'} "
        f"url={decision.get('url') or '-'} "
        f"page_liveness={decision.get('page_liveness') or '-'} "
        f"online={'true' if decision.get('online') else 'false'} "
        f"dialog_ready={'true' if decision.get('dialog_ready') else 'false'} "
        f"prebound_home={'true' if decision.get('prebound_home') else 'false'} "
        f"can_sync_conversation={'true' if (decision.get('conversation_syncable') or decision.get('syncable')) else 'false'} "
        f"syncable={'true' if decision.get('syncable') else 'false'} "
        f"conversation_syncable={'true' if decision.get('conversation_syncable') else 'false'} "
        f"sendable={'true' if decision.get('sendable') else 'false'} "
        f"queueable={'true' if decision.get('queueable') else 'false'} "
        f"send_decision={decision.get('send_decision') or '-'} "
        f"response_state={decision.get('response_state') or '-'} "
        f"bound={'true' if decision.get('bound') else 'false'} "
        f"client_id_mismatch={'true' if decision.get('client_id_mismatch') else 'false'} "
        f"page_instance_id_mismatch={'true' if decision.get('page_instance_id_mismatch') else 'false'} "
        f"conversation_mismatch={'true' if decision.get('conversation_mismatch') else 'false'} "
        f"blocked_reason={decision.get('blocked_reason') or '-'} "
        f"reason={decision.get('reason') or '-'}"
    )
