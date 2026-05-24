"""桥接消息入队字段规范化（GUI / server 共用）。"""



from __future__ import annotations



from typing import Any, Dict, List, Optional, Tuple



from app.utils.legacy_cleanup import (
    LEGACY_FIELD_NAMES,
    assert_no_legacy_fields,
    reject_legacy_fields,
)

from app.utils.page_status import page_url_from



__all__ = [

    "normalize_inbound_push_payload",

    "normalize_outbound_bridge_message",

    "build_gui_push_payload",

    "read_bridge_client_id",

    "read_bridge_page_instance_id",

    "validate_outbound_queue_message",

    "get_bridge_message_id",

    "load_qsettings_last_url",

    "persist_qsettings_last_url",

]







def read_bridge_client_id(data: Any) -> str:

    if not isinstance(data, dict):

        return ""

    return (data.get("client_id") or "").strip()





def read_bridge_page_instance_id(data: Any) -> str:

    if not isinstance(data, dict):

        return ""

    return (data.get("page_instance_id") or "").strip()





def get_bridge_message_id(msg: Any) -> str:
    if not isinstance(msg, dict):
        return ""
    return (msg.get("message_id") or "").strip()


def load_qsettings_last_url(settings) -> Optional[str]:

    if settings is None:

        return None

    val = (settings.value("last_url") or "").strip()

    return val or None





def persist_qsettings_last_url(settings, url: str) -> None:

    if settings is None:

        return

    url = (url or "").strip()

    if not url:

        return

    settings.setValue("last_url", url)

    # @deprecated-migration:
    # 旧版本曾使用 last_page_url / page_url / conversation_url 保存页面地址。
    # 当前统一使用 last_url。连续 2 个版本确认无旧配置恢复需求后，可删除本循环。
    from app.utils.deprecation_log import log_migration_hit

    for legacy_key in ("last_page_url", "page_url", "conversation_url"):
        if settings.contains(legacy_key):
            log_migration_hit(
                name="persist_qsettings_last_url",
                old=legacy_key,
                new="last_url",
                reason="cleanup_legacy_qsettings_key",
            )
            settings.remove(legacy_key)





def normalize_inbound_push_payload(payload: Any) -> Dict[str, Any]:

    """只读 payload['url']；旧 URL 字段由 reject_legacy_fields 拒绝。"""

    if isinstance(payload, str):

        text = payload.strip()

        if not text:

            raise ValueError("content is empty")

        return {

            "content": text,

            "url": "",

        }

    if not isinstance(payload, dict):

        return {"content": "", "url": ""}



    data = dict(payload)

    legacy_reject = reject_legacy_fields(data, context="normalize_inbound_push_payload")
    if legacy_reject:
        body, _status = legacy_reject
        raise ValueError(body.get("error") or "legacy_fields_not_allowed")

    content = str(data.get("content") or "").strip()

    if not content:

        raise ValueError("content is empty")



    url = page_url_from(data)

    out: Dict[str, Any] = {

        "content": content,

        "url": url,

    }

    for key in (

        "session_id",

        "turn_id",

        "trace_id",

        "client_id",

        "page_instance_id",

        "conversation_id",

        "bootstrap_conversation",

        "bind_request_id",

        "target_page_id",

    ):

        if key in data and data.get(key) not in (None, ""):

            out[key] = data[key]

    return out





def build_gui_push_payload(

    *,

    session_id: str,

    turn_id: str,

    content: str,

    trace_id: str = "",

    client_id: str = "",

    url: str = "",

    conversation_id: str = "",

    page_instance_id: str = "",

    bootstrap_conversation: bool = False,

    bind_request_id: str = "",

    target_page_id: str = "",

) -> Dict[str, Any]:

    """GUI 入队：只写 canonical 字段（client_id / page_instance_id / conversation_id / url）。"""

    client_id = (client_id or "").strip()

    page_instance_id = (page_instance_id or "").strip()

    content = (content or "").strip()

    url = (url or "").strip()

    payload: Dict[str, Any] = {

        "session_id": (session_id or "").strip(),

        "turn_id": (turn_id or "").strip(),

        "trace_id": (trace_id or "").strip(),

        "content": content,

        "url": url,

        "client_id": (client_id or "").strip() or None,

        "page_instance_id": (page_instance_id or "").strip() or None,

        "conversation_id": (conversation_id or "").strip() or None,

        "bootstrap_conversation": bool(bootstrap_conversation),

        "bind_request_id": (bind_request_id or "").strip() or None,

        "target_page_id": (target_page_id or "").strip() or None,

    }

    return payload





def validate_outbound_queue_message(msg: Dict[str, Any]) -> Dict[str, Any]:
    """内存队列边界：入口迁移一次后要求 canonical 字段。"""
    if not isinstance(msg, dict):
        return {}
    out = dict(msg)
    legacy_err = reject_legacy_fields(
        out, context="validate_outbound_queue_message", migrate=False
    )
    if legacy_err:
        body, _status = legacy_err
        raise ValueError(body.get("error") or "legacy_fields_not_allowed")
    assert_no_legacy_fields(out, owner="validate_outbound_queue_message")
    mid = (out.get("message_id") or "").strip()
    if not mid:
        raise ValueError("message_id is required")
    url = page_url_from(out)
    if url:
        out["url"] = url
    return out


def normalize_outbound_bridge_message(msg: Dict[str, Any]) -> Dict[str, Any]:

    """出站消息：只暴露 canonical 字段。"""

    if not isinstance(msg, dict):

        return {}

    out = validate_outbound_queue_message(msg)

    out["message_id"] = (out.get("message_id") or "").strip()

    content = (out.get("content") or "").strip()

    if content:

        out["content"] = content

    url = page_url_from(out)

    if url:

        out["url"] = url

    status = (out.get("message_status") or "").strip()

    if status:

        out["message_status"] = status

    assert_no_legacy_fields(out, owner="normalize_outbound_bridge_message")

    return out


