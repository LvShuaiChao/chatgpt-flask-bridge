from __future__ import annotations

from typing import Any, Callable, Dict, Optional, Tuple


def format_sync_target_status_text(
    target: Dict[str, Any],
    profile: Optional[Dict[str, Any]] = None,
    *,
    verbose: bool = True,
    compact_sync_chip: Optional[
        Callable[[Dict[str, Any], Optional[Dict[str, Any]]], Tuple[str, str]]
    ] = None,
    compact_send_chip: Optional[
        Callable[[Dict[str, Any], Optional[Dict[str, Any]]], Tuple[str, str]]
    ] = None,
    queue_size: int = 0,
) -> str:
    """Format sync/send status line for UI labels (does not touch widgets)."""
    profile = profile or {}
    if not verbose and compact_sync_chip is not None and compact_send_chip is not None:
        sync_text, _chip = compact_sync_chip(target, profile)
        send_text, _send_chip = compact_send_chip(target, profile)
        return f"{sync_text}｜{send_text}"

    online = bool(
        target.get("online")
        if target.get("online") is not None
        else profile.get("online")
    )
    prebound_home = bool(
        target.get("prebound_home")
        if target.get("prebound_home") is not None
        else profile.get("prebound_home")
    )
    conversation_syncable = bool(
        target.get("conversation_syncable")
        if target.get("conversation_syncable") is not None
        else profile.get("conversation_syncable")
    )
    if prebound_home and online:
        return "已绑定首页｜等待进入对话｜不可同步对话"
    if not online:
        reason = (
            target.get("reason_code")
            or target.get("reason")
            or profile.get("reason_code")
            or profile.get("reason")
            or ""
        ).strip()
        if reason in ("bound_page_offline", "offline", "no_online_page"):
            return "同步：不可同步（离线）"
        return "同步：不可同步"
    if online and not conversation_syncable:
        return "已绑定在线｜等待进入对话页｜不可同步对话"

    def _field(key: str, default=None):
        if target.get(key) is not None:
            return target.get(key)
        if profile.get(key) is not None:
            return profile.get(key)
        return default

    send_now = bool(_field("send_now_available", False))
    send_queueable = bool(_field("send_queueable", False))
    send_decision = (_field("send_decision") or "").strip()
    send_requestable = _field("send_decision", "blocked") in ("allowed", "queued")
    is_responding = bool(_field("is_responding", False))
    sync_line = "同步：可同步"
    if send_now:
        return f"{sync_line}｜发送：可发送"
    if send_queueable or send_decision == "queued":
        return f"{sync_line}｜发送：可排队"
    if is_responding:
        return f"{sync_line}｜发送：等待回复"
    if queue_size > 0:
        return f"{sync_line}｜发送：等待队列"
    if not send_requestable and not send_now and not send_queueable:
        return f"{sync_line}｜发送：不可发送"
    if send_requestable:
        return f"{sync_line}｜发送：等待注入后发送"
    return f"{sync_line}｜发送：不可发送"
