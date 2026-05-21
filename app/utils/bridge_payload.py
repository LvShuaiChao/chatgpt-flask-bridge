"""桥接消息入队字段规范化（GUI / server 共用）。"""

from __future__ import annotations

from typing import Any, Dict, Tuple

from app.utils.page_status import page_url_from

__all__ = [
    "normalize_inbound_push_payload",
    "normalize_outbound_bridge_message",
    "build_gui_push_payload",
]

_DEPRECATED_PUSH_FIELDS_LOGGED: set[str] = set()


def _log_deprecated_field(field: str, replacement: str) -> None:
    if field in _DEPRECATED_PUSH_FIELDS_LOGGED:
        return
    _DEPRECATED_PUSH_FIELDS_LOGGED.add(field)
    print(f"[FIELD][DEPRECATED] field={field} replacement={replacement}")


def normalize_inbound_push_payload(payload: Any) -> Dict[str, Any]:
    """读取兼容旧字段，返回统一字段（content / raw_content / url 等）。"""
    if isinstance(payload, str):
        text = payload.strip()
        return {
            "content": text,
            "raw_content": text,
            "url": "",
            "target_url": "",
            "target_page_url": "",
            "conversation_url": "",
        }
    if not isinstance(payload, dict):
        return {"content": "", "raw_content": "", "url": ""}

    data = dict(payload)
    for old_key, new_key in (
        ("final_prompt", "content"),
        ("text", "content"),
        ("message", "content"),
        ("prompt", "content"),
        ("raw_user_text", "raw_content"),
    ):
        if old_key in data and data.get(old_key) and not data.get(new_key):
            _log_deprecated_field(old_key, new_key)
            data[new_key] = data[old_key]

    content = (
        (data.get("content") or data.get("final_prompt") or data.get("text") or "")
        .strip()
    )
    raw_content = (data.get("raw_content") or data.get("raw_user_text") or "").strip()
    if not raw_content:
        raw_content = content

    url = page_url_from(
        {
            "url": data.get("url"),
            "target_url": data.get("target_url"),
            "target_page_url": data.get("target_page_url"),
            "conversation_url": data.get("conversation_url"),
            "page_url": data.get("page_url"),
        }
    )
    if url:
        data["url"] = url
        data["target_url"] = url
        data["target_page_url"] = url
        if not (data.get("conversation_url") or "").strip():
            data["conversation_url"] = url

    data["content"] = content
    data["raw_content"] = raw_content
    return data


def build_gui_push_payload(
    *,
    session_id: str,
    turn_id: str,
    content: str,
    raw_content: str = "",
    trace_id: str = "",
    target_client_id: str = "",
    url: str = "",
    conversation_id: str = "",
    page_instance_id: str = "",
    bootstrap_conversation: bool = False,
    bind_request_id: str = "",
    launch_token: str = "",
    extra: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """GUI 入队：新字段为主，保留少量兼容字段供旧 userscript 读取。"""
    content = (content or "").strip()
    raw_content = (raw_content or content).strip()
    url = (url or "").strip()
    payload: Dict[str, Any] = {
        "session_id": (session_id or "").strip(),
        "turn_id": (turn_id or "").strip(),
        "trace_id": (trace_id or "").strip(),
        "content": content,
        "raw_content": raw_content,
        "url": url,
        "target_url": url,
        "target_client_id": (target_client_id or "").strip() or None,
        "target_page_url": url or None,
        "conversation_url": url or None,
        "conversation_id": (conversation_id or "").strip() or None,
        "target_page_instance_id": (page_instance_id or "").strip() or None,
        "bootstrap_conversation": bool(bootstrap_conversation),
        "bind_request_id": (bind_request_id or "").strip() or None,
        "launch_token": (launch_token or bind_request_id or "").strip() or None,
    }
    if extra:
        payload.update(extra)
    return payload


def normalize_outbound_bridge_message(msg: Dict[str, Any]) -> Dict[str, Any]:
    """出站消息对外暴露 message_id / message_status，内部仍保留 id / status。"""
    if not isinstance(msg, dict):
        return {}
    out = dict(msg)
    mid = (out.get("message_id") or out.get("id") or "").strip()
    if mid:
        out["message_id"] = mid
        out["id"] = mid
    content = (out.get("content") or out.get("final_prompt") or out.get("raw_user_text") or "").strip()
    if content:
        out["content"] = content
    url = page_url_from(out)
    if url:
        out["url"] = url
        out["target_url"] = url
        if not (out.get("target_page_url") or "").strip():
            out["target_page_url"] = url
    status = (out.get("message_status") or out.get("status") or "").strip()
    if status:
        out["message_status"] = status
        out["status"] = status
    return out
