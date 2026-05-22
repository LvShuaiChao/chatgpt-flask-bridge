"""Control command queue (open/close page, sync, etc.)."""
from __future__ import annotations

import uuid

from app.server import state as st
from app.server.bridge_logging import _log_bridge_json_payload
from app.utils.bridge_payload import get_bridge_message_id
from app.server.tm_page_registry import (
    _is_ignored_page,
    _iter_page_registry_entries,
    _registry_entry_for_client,
)
from app.server.runtime_state import _client_online, _log, _notify_status, _now
from app.server.state import MAX_CONTROL_QUEUE_SIZE
from app.utils.bridge_payload import (
    read_bridge_client_id,
    read_bridge_page_instance_id,
    validate_outbound_queue_message,
)
from app.utils.legacy_cleanup import assert_no_legacy_fields
from app.utils.page_status import page_url_from

def _queue_control_message(command, *, log_label="", **extra):
    msg = _make_command_message(command, **extra)
    assert_no_legacy_fields(msg, owner="server._queue_control_message")
    with st._state_lock:
        if len(st._control_queue) >= MAX_CONTROL_QUEUE_SIZE:
            _log(
                f"[BRIDGE][CONTROL][QUEUE_FULL] command={command} "
                f"control_queue_size={len(st._control_queue)} "
                f"max={MAX_CONTROL_QUEUE_SIZE}"
            )
            return None
        st._control_queue.append(msg)

    label = log_label or command
    client_id = read_bridge_client_id(msg) or "-"
    page_url = page_url_from(msg) or "-"
    page_instance = read_bridge_page_instance_id(msg) or "-"
    conversation = (msg.get("conversation_id") or "").strip() or "-"
    message_id = get_bridge_message_id(msg)[:8]
    request_id = ""
    payload = msg.get("payload")
    if isinstance(payload, dict):
        request_id = (payload.get("request_id") or "").strip()
    _log(
        f"[BRIDGE][CONTROL][QUEUE] command={command} "
        f"message_id={message_id}… "
        f"client_id={client_id} "
        f"url={page_url} "
        f"page_instance_id={page_instance} "
        f"conversation_id={conversation} "
        f"label={label}"
    )
    _log(
        f"[TM_CONTROL][ENQUEUE] type={command} request_id={request_id or '-'} "
        f"client_id={client_id} message_id={message_id}…"
    )
    if command == "start_upload":
        _log(
            f"[TM_CONTROL][START_UPLOAD][QUEUE] "
            f"client_id={client_id} command=start_upload"
        )
    _log_bridge_json_payload(
        "SERVER_TO_TM_QUEUE",
        msg,
        action="queue_command",
        event=command,
        message_id=get_bridge_message_id(msg),
        client_id=client_id if client_id != "-" else "",
    )
    _notify_status()
    return msg


def _append_control_messages(msgs, *, log_label="batch", log_detail=""):
    if not msgs:
        return []
    with st._state_lock:
        if len(st._control_queue) + len(msgs) > MAX_CONTROL_QUEUE_SIZE:
            _log(
                f"[BRIDGE][CONTROL][QUEUE_FULL] label={log_label} "
                f"control_queue_size={len(st._control_queue)} "
                f"incoming={len(msgs)} max={MAX_CONTROL_QUEUE_SIZE}"
            )
            return []
        st._control_queue.extend(msgs)
    count = len(msgs)
    first_id = get_bridge_message_id(msgs[0])[:8] or "-"
    detail = f" {log_detail}" if log_detail else ""
    _log(
        f"[BRIDGE][CONTROL][QUEUE] label={log_label} count={count} "
        f"first_message_id={first_id}…{detail}"
    )
    _notify_status()
    return msgs


def push_open_url(url, active=True):
    """GUI：通过油猴在新标签页打开 URL。"""
    url = (url or "").strip()
    if not url:
        raise ValueError("url 不能为空")

    return _queue_control_message(
        "open_url",
        log_label="open_url",
        url=url,
        active=bool(active),
    )


def _make_command_message(command, **extra):
    msg = {
        "message_id": str(uuid.uuid4()),
        "type": "command",
        "command": command,
        "message_status": "queued",
        "created_at": _now(),
        "delivered_to": None,
        "delivered_at": None,
        "lease_until": None,
        "acked_at": None,
        "finalized_at": None,
        "error_detail": None,
    }
    msg.update(extra)
    url = page_url_from(msg)
    if url:
        msg["url"] = url
    msg = validate_outbound_queue_message(msg)
    assert_no_legacy_fields(msg, owner="server._make_command_message")
    return msg


def _push_targeted_page_command(command, log_label, client_id, url=None):
    client_id = (client_id or "").strip()
    if not client_id:
        raise ValueError("client_id 不能为空")
    page_url = (url or "").strip() or None

    return _queue_control_message(
        command,
        log_label=log_label,
        client_id=client_id,
        url=page_url,
    )


def push_close_page(client_id, url=None):
    """向指定油猴客户端下发关闭当前页面命令。"""
    return _push_targeted_page_command(
        "close_self",
        "close_page",
        client_id,
        url=url,
    )


def _enqueue_control_command_result(
    ok,
    *,
    reason="",
    message=None,
    command="",
    client_id="",
    page_instance_id="",
    conversation_id="",
):
    message_id = ""
    if ok and isinstance(message, dict):
        message_id = get_bridge_message_id(message)
    return {
        "ok": bool(ok),
        "reason": (reason or "").strip() if not ok else "",
        "message": message if ok else None,
        "message_id": message_id,
        "command": (command or "").strip(),
        "client_id": (client_id or "").strip(),
        "page_instance_id": (page_instance_id or "").strip(),
        "conversation_id": (conversation_id or "").strip(),
    }


def enqueue_control_command(
    command,
    *,
    client_id="",
    page_instance_id="",
    conversation_id="",
    payload=None,
):
    """GUI：向指定油猴页面下发控制命令（只写 canonical 字段）。"""
    command = (command or "").strip()
    client_id = (client_id or "").strip()
    page_instance_id = (page_instance_id or "").strip()
    conversation_id = (conversation_id or "").strip()
    fail = lambda reason: _enqueue_control_command_result(
        False,
        reason=reason,
        command=command,
        client_id=client_id,
        page_instance_id=page_instance_id,
        conversation_id=conversation_id,
    )

    if not command:
        _log("[BRIDGE][CONTROL][ERROR] reason=missing_command")
        return fail("missing_command")
    if not client_id:
        _log(
            f"[BRIDGE][CONTROL][ERROR] invalid command={command!r} "
            f"client_id={client_id!r}"
        )
        return fail("missing_client_id")

    if command == "sync_conversation":
        if not page_instance_id:
            _log(
                "[BRIDGE][CONTROL][BLOCK] "
                "command=sync_conversation reason=missing_page_instance_id "
                f"client_id={client_id or '-'}"
            )
            return fail("missing_page_instance_id")
        if not conversation_id or conversation_id == "-":
            _log(
                "[BRIDGE][CONTROL][BLOCK] "
                f"command=sync_conversation reason=missing_conversation_id "
                f"client_id={client_id or '-'}"
            )
            return fail("missing_conversation_id")
        entry = _registry_entry_for_client(client_id, page_instance_id)
        page_type = (entry.get("page_type") or "").strip()
        if page_type == "home":
            _log(
                "[BRIDGE][CONTROL][BLOCK] "
                f"command=sync_conversation reason=home_bootstrap_only "
                f"client_id={client_id or '-'} "
                f"page_type=home"
            )
            return fail("home_bootstrap_only")

    msg = _queue_control_message(
        command,
        log_label=command,
        client_id=client_id,
        page_instance_id=page_instance_id or None,
        conversation_id=conversation_id or None,
        payload=dict(payload or {}),
    )
    if not isinstance(msg, dict):
        return fail("queue_control_message_failed")
    return _enqueue_control_command_result(
        True,
        message=msg,
        command=command,
        client_id=client_id,
        page_instance_id=page_instance_id,
        conversation_id=conversation_id,
    )


def push_close_other_pages(except_client_id):
    """关闭除 except_client_id 外所有在线 ChatGPT 页面。"""
    except_client_id = (except_client_id or "").strip()
    if not except_client_id:
        raise ValueError("except_client_id 不能为空")
    online_clients = []
    seen_client_ids = set()
    for info in _iter_page_registry_entries():
        if not _client_online(info.get("last_seen")) or _is_ignored_page(info):
            continue
        client_id = (info.get("client_id") or "").strip()
        if not client_id or client_id in seen_client_ids:
            continue
        seen_client_ids.add(client_id)
        online_clients.append((client_id, info))
    keep_online = any(client_id == except_client_id for client_id, _ in online_clients)
    if not keep_online:
        raise ValueError(
            f"保留页面不在线或不存在，已取消关闭其他页面：client_id={except_client_id}"
        )
    msgs = []
    for client_id, info in online_clients:
        if client_id == except_client_id:
            continue
        page_url = page_url_from(info)
        msgs.append(
            _make_command_message(
                "close_self",
                client_id=client_id,
                url=page_url,
            )
        )
    return _append_control_messages(
        msgs,
        log_label="close_other",
        log_detail=f"command=close_self keep_client_id={except_client_id}",
    )
