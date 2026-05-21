"""统一页面身份、在线/可同步/可发送判定（各层共用，避免多套逻辑打架）。"""

from __future__ import annotations

import time
from typing import Any, Dict, Literal, Tuple
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
    "page_url_from",
    "page_registry_key",
    "get_page_liveness",
    "is_page_online",
    "is_dialog_ready_page",
    "is_prebound_home_page",
    "classify_page_state",
    "is_page_syncable",
    "evaluate_send_page",
    "explain_page_decision",
    "log_page_decision_fields",
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


def _maybe_log_deprecated_url_field(raw: dict, used_key: str) -> None:
    if used_key == "url" or used_key in _DEPRECATED_URL_LOGGED:
        return
    _DEPRECATED_URL_LOGGED.add(used_key)
    client_id = (raw.get("client_id") or "-").strip()
    page_instance_id = (raw.get("page_instance_id") or "-").strip()
    print(
        f"[FIELD][DEPRECATED] field={used_key} replacement=url "
        f"client_id={client_id} page_instance_id={page_instance_id}"
    )


def normalize_page(raw: Any, *, now: float | None = None) -> Dict[str, Any]:
    """规范化页面对象；写入统一 url，读取兼容旧 URL 字段。"""
    if not isinstance(raw, dict):
        return {}
    if now is None:
        now = time.time()

    url = ""
    url_source = ""
    for key in _URL_READ_KEYS:
        val = (raw.get(key) or "").strip()
        if val and val != "-":
            url = val
            url_source = key
            break
    if url_source and url_source != "url":
        _maybe_log_deprecated_url_field(raw, url_source)

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

    last_seen = _float_ts(raw.get("last_seen"))
    online = is_page_online(raw, now=now) if last_seen else bool(raw.get("online"))

    out: Dict[str, Any] = dict(raw)
    out.update(
        {
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": url,
            "page_url": url,
            "page_type": page_type,
            "page_title": (raw.get("page_title") or raw.get("title") or "").strip(),
            "last_seen": last_seen,
            "online": online,
            "visibility_state": (
                raw.get("visibility_state")
                or raw.get("visible")
                or ""
            ),
            "has_focus": bool(raw.get("has_focus") or raw.get("is_focused")),
            "can_accept_input": bool(raw.get("can_accept_input", True)),
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
        or page.get("last_poll_at")
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


def is_dialog_ready_page(page: Any, *, now: float | None = None) -> bool:
    """可同步/可对话页：在线 + conversation 类型 + conversation_id + url 含 /c/。"""
    if not isinstance(page, dict):
        return False
    norm = normalize_page(page, now=now)
    if not is_page_online(norm, now=now):
        return False
    page_type = (norm.get("page_type") or "").strip()
    if page_type and page_type not in ("conversation", "-"):
        return False
    conversation_id = (norm.get("conversation_id") or "").strip()
    if not conversation_id:
        return False
    url = (norm.get("url") or "").strip()
    if not url or "/c/" not in url:
        return False
    return True


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
    """返回 online/dialog_ready/prebound_home 与单一 state（offline|online|dialog_ready|prebound_home）。"""
    online = is_page_online(page, now=now) if isinstance(page, dict) else False
    dialog_ready = is_dialog_ready_page(page, now=now) if isinstance(page, dict) else False
    prebound_home = is_prebound_home_page(page, now=now) if isinstance(page, dict) else False
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
        "state": state,
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

    if norm.get("is_responding") or not norm.get("can_accept_input", True):
        return "queued", "waiting_for_input"
    return "allowed", "ready"


def explain_page_decision(page: Any, action: str = "sync") -> Dict[str, Any]:
    norm = normalize_page(page) if isinstance(page, dict) else {}
    classified = classify_page_state(norm) if norm else {}
    online = bool(classified.get("online"))
    syncable = bool(classified.get("dialog_ready"))
    send_decision, send_reason = (
        evaluate_send_page(norm) if norm else ("blocked", "no_page")
    )
    sendable = send_decision == "allowed"
    send_queued = send_decision == "queued"
    blocked_reason = ""
    if action == "sync" and not syncable:
        if not online:
            blocked_reason = "offline"
        elif classified.get("prebound_home"):
            blocked_reason = "prebound_home_wait_conversation"
        elif not (norm.get("url") or ""):
            blocked_reason = "missing_url"
        else:
            blocked_reason = "missing_conversation_id"
    elif action == "send" and send_decision == "blocked":
        blocked_reason = send_reason

    return {
        "client_id": norm.get("client_id") or "",
        "page_instance_id": norm.get("page_instance_id") or "",
        "conversation_id": norm.get("conversation_id") or "",
        "url": norm.get("url") or "",
        "online": online,
        "dialog_ready": bool(classified.get("dialog_ready")),
        "prebound_home": bool(classified.get("prebound_home")),
        "page_state": classified.get("state") or ("offline" if not online else "online"),
        "syncable": syncable,
        "sendable": sendable,
        "send_queued": send_queued,
        "send_decision": send_decision,
        "blocked_reason": blocked_reason or send_reason,
    }


def log_page_decision_fields(decision: Dict[str, Any]) -> str:
    return (
        f"client_id={decision.get('client_id') or '-'} "
        f"page_instance_id={decision.get('page_instance_id') or '-'} "
        f"conversation_id={decision.get('conversation_id') or '-'} "
        f"url={decision.get('url') or '-'} "
        f"online={'true' if decision.get('online') else 'false'} "
        f"dialog_ready={'true' if decision.get('dialog_ready') else 'false'} "
        f"prebound_home={'true' if decision.get('prebound_home') else 'false'} "
        f"syncable={'true' if decision.get('syncable') else 'false'} "
        f"sendable={'true' if decision.get('sendable') else 'false'} "
        f"blocked_reason={decision.get('blocked_reason') or '-'}"
    )
