"""Outbound/inbound message queues, poll/ack/report handlers."""
from __future__ import annotations

import traceback
import uuid

from app.core import job_scheduler as _job_scheduler
from app.server import state as st
from app.server.bridge_logging import (
    log_assistant_reply_recv_full,
    log_assistant_reply_unknown_full,
    log_server_to_tm_queue_full,
)
from app.server.state import BridgeQueueFullError, LEASE_SEC, MAX_OUTBOUND_QUEUE_SIZE
from app.utils.bridge_payload import (
    get_bridge_message_id,
    normalize_inbound_push_payload,
    normalize_outbound_bridge_message,
    read_bridge_client_id,
    read_bridge_page_instance_id,
    validate_outbound_queue_message,
)
from app.utils.legacy_cleanup import assert_no_legacy_fields
from app.utils.page_status import page_url_from
from app.server.runtime_state import (
    _format_time,
    _log,
    _normalize_chatgpt_url_for_compare,
    _now,
    _notify_status,
    get_server_bind_host,
    get_server_port,
    get_server_public_host,
    get_server_bridge_url,
    get_server_url,
    is_debug_mode,
    is_server_running,
)
from app.server.tm_page_registry import (
    _bridge_runtime_patch_for_body,
    _ensure_poll_top_level_page_no,
    _registry_entry_for_client,
    _snapshot_clients,
    _touch_tampermonkey,
)
from app.server import external_api as ext
from app.server.external_api import (
    _notify_external_request_from_bridge as _notify_external_request_impl,
)
from app.server.state import (
    POLL_SUMMARY_INTERVAL_SEC,
    _last_focused_tm_page,
    _last_focused_tm_page_at,
    _last_poll_empty_log_at,
    _last_poll_identity,
    _last_poll_other_reason_log_at,
    _poll_summaries,
    _server_instance_id,
    _server_start_time,
)

STRICT_TARGET_CONTROL_COMMANDS = frozenset({
    "sync_conversation",
    "start_upload",
})

_INVALID_ASSISTANT_REPLY_TEXTS = frozenset({
    "正在思考",
    "正在生成",
    "思考中",
    "回复完成",
})


def _is_invalid_assistant_reply_text(text):
    value = str(text or "").strip()
    if not value:
        return True
    if value in _INVALID_ASSISTANT_REPLY_TEXTS:
        return True
    return False


def _bridge_message_id_matches(msg, message_id):
    message_id = (message_id or "").strip()
    if not message_id:
        return False
    return get_bridge_message_id(msg) == message_id


def _sync_message_status_fields(msg, status):
    if not isinstance(msg, dict):
        return
    msg["message_status"] = status


def _set_message_status(msg, status, *, error_detail=None):
    if not isinstance(msg, dict):
        return
    _sync_message_status_fields(msg, status)
    msg["finalized_at"] = _now()
    if error_detail is not None:
        msg["error_detail"] = error_detail


def _build_bridge_status_summary(pages):
    """从 pages 快照推导在线统计与焦点页（无单客户端全局字段）。"""
    online_pages = [p for p in (pages or []) if isinstance(p, dict) and p.get("online")]
    focused = None
    with st._state_lock:
        last_focused = (
            dict(st._last_focused_tm_page)
            if isinstance(st._last_focused_tm_page, dict)
            else None
        )
    if last_focused:
        focused = last_focused
    else:
        focus_candidates = [
            p for p in online_pages if p.get("has_focus")
        ]
        if focus_candidates:
            focus_candidates.sort(
                key=lambda p: float(p.get("last_focus_at") or p.get("last_seen") or 0),
                reverse=True,
            )
            focused = {
                k: focus_candidates[0].get(k)
                for k in (
                    "client_id",
                    "page_instance_id",
                    "url",
                    "conversation_id",
                    "page_type",
                    "page_no",
                )
            }
    return {
        "online_count": len(online_pages),
        "focused_page": focused,
        "bound_page": None,
    }


def get_bridge_status():
    with st._state_lock:
        pages = _snapshot_clients()
        server_url = get_server_url() if is_server_running() else ""
        bridge_url = get_server_bridge_url() if is_server_running() else ""
        summary = _build_bridge_status_summary(pages)
        recent_inbound = [dict(item) for item in st._inbound_messages]
        return {
            "server_running": is_server_running(),
            "server_url": server_url,
            "bridge_url": bridge_url,
            "pages": pages,
            "summary": summary,
            "queue_length": len(st._outbound_queue),
            "control_queue_length": len(st._control_queue),
            "inbound_count": len(st._inbound_messages),
            "recent_inbound": recent_inbound,
        }


def push_message(data):
    """GUI 或其它本地程序：向油猴下发一条待发送消息。"""
    payload = normalize_inbound_push_payload(data)
    session_id = (payload.get("session_id") or "").strip()
    turn_id = (payload.get("turn_id") or "").strip()
    content = str(payload.get("content") or "").strip()
    if not content:
        raise ValueError("content 不能为空")
    client_id = read_bridge_client_id(payload) or None
    url = page_url_from(payload) or None
    page_instance_id = read_bridge_page_instance_id(payload) or None
    conversation_id = (payload.get("conversation_id") or "").strip() or None
    bootstrap_conversation = bool(payload.get("bootstrap_conversation"))
    target_page_id = (payload.get("target_page_id") or "").strip() or None
    bind_request_id = (payload.get("bind_request_id") or "").strip() or None
    target_source = (payload.get("target_source") or "").strip() or None
    trace_id = (payload.get("trace_id") or "").strip() or None
    message_id = str(uuid.uuid4())
    msg = {
        "message_id": message_id,
        "type": "chat",
        "session_id": session_id,
        "turn_id": turn_id,
        "trace_id": trace_id,
        "content": content,
        "url": url or "",
        "client_id": client_id,
        "page_instance_id": page_instance_id,
        "conversation_id": conversation_id,
        "bootstrap_conversation": bootstrap_conversation,
        "target_page_id": target_page_id,
        "bind_request_id": bind_request_id,
        "target_source": target_source,
        "message_status": "queued",
        "created_at": _now(),
        "delivered_to": None,
        "delivered_at": None,
        "lease_until": None,
        "acked_at": None,
        "finalized_at": None,
        "error_detail": None,
    }
    assert_no_legacy_fields(msg, owner="server.push_message")
    with st._state_lock:
        queue_before = len(st._outbound_queue)
        if queue_before >= MAX_OUTBOUND_QUEUE_SIZE:
            _log(
                f"[CHAT_QUEUE][PUT_FAIL] trace_id={trace_id or '-'} "
                f"reason=queue_full queue_before={queue_before} "
                f"max={MAX_OUTBOUND_QUEUE_SIZE} session_id={session_id or '-'}"
            )
            raise RuntimeError(
                "发送队列已满，请等待油猴页面处理完已有消息后再发送"
            )
        st._outbound_queue.append(msg)
        queue_after = len(st._outbound_queue)
    preview = content if len(content) <= 80 else content[:80] + "..."
    client_hint = client_id or "-"
    page_hint = url or "-"
    if len(page_hint) > 60:
        page_hint = page_hint[:60] + "..."
    _log(
        f"[CHAT_QUEUE][PUT_OK] trace_id={trace_id or '-'} "
        f"message_id={message_id} client_id={client_hint} "
        f"conversation_id={conversation_id or '-'} url={page_hint} content_len={len(content)} "
        f"queue_before={queue_before} queue_after={queue_after} "
        f"session_id={session_id or '-'} turn_id={turn_id or '-'} "
        f"url={page_hint} preview={preview}"
    )
    log_server_to_tm_queue_full(msg, action="queue_chat", event="chat")
    _notify_status()
    return msg


def get_message_state(message_id):
    message_id = (message_id or "").strip()
    if not message_id:
        return None
    with st._state_lock:
        for msg in st._outbound_queue:
            if _bridge_message_id_matches(msg, message_id):
                return dict(msg)
        msg = st._outbound_waiting.get(message_id)
        if msg:
            return dict(msg)
        msg = st._control_waiting.get(message_id)
        if msg:
            return dict(msg)
        for msg in st._outbound_history:
            if _bridge_message_id_matches(msg, message_id):
                return dict(msg)
    return None


def cancel_message(message_id, reason="cancelled"):
    message_id = (message_id or "").strip()
    if not message_id:
        return False
    cancelled = False
    with st._state_lock:
        kept = deque()
        while st._outbound_queue:
            msg = st._outbound_queue.popleft()
            if _bridge_message_id_matches(msg, message_id):
                _set_message_status(msg, "cancelled", error_detail=reason)
                st._outbound_history.append(dict(msg))
                cancelled = True
            else:
                kept.append(msg)
        st._outbound_queue.extend(kept)

        msg = st._outbound_waiting.pop(message_id, None)
        if msg:
            _set_message_status(msg, "cancelled", error_detail=reason)
            st._outbound_history.append(dict(msg))
            cancelled = True

    if cancelled:
        _log(f"[BRIDGE][CANCEL] message_id={message_id[:8]}… reason={reason}")
        _notify_status()
    return cancelled


def _copy_existing_fields(dst, src, fields):
    for field in fields:
        value = src.get(field)
        if value is not None and value != "":
            dst[field] = value
    return dst


def _add_inbound(
    kind,
    payload,
    message_id=None,
    session_id=None,
    turn_id=None,
    client_id=None,
):
    outbound = _find_outbound_message(message_id)
    if outbound:
        session_id = session_id or outbound.get("session_id") or ""
        turn_id = turn_id or outbound.get("turn_id") or ""
    entry = {
        "event_id": str(uuid.uuid4()),
        "kind": kind,
        "message_id": message_id,
        "session_id": session_id or "",
        "turn_id": turn_id or "",
        "client_id": client_id or "",
        "time": _now(),
        "payload": payload,
    }
    st._inbound_messages.append(entry)
    return entry


def _find_outbound_message(message_id):
    if not message_id:
        return None
    waiting = st._outbound_waiting.get(message_id)
    if waiting:
        return waiting
    control = st._control_waiting.get(message_id)
    if control:
        return control
    for msg in reversed(st._outbound_history):
        if _bridge_message_id_matches(msg, message_id):
            return msg
    return None


def _lookup_outbound_for_ack(message_id):
    """ack 查找：waiting -> outbound_queue -> history（未 finalize 的 chat）。"""
    message_id = (message_id or "").strip()
    if not message_id:
        return None, None
    waiting = st._outbound_waiting.get(message_id)
    if waiting:
        return waiting, "waiting"
    for pending in st._outbound_queue:
        if _bridge_message_id_matches(pending, message_id):
            return pending, "queue"
    for hist in reversed(st._outbound_history):
        if _bridge_message_id_matches(hist, message_id) and hist.get("type") != "command":
            return hist, "history"
    return None, None


def _short_id_list(ids, limit=8):
    rows = []
    for mid in list(ids or [])[:limit]:
        mid = (mid or "").strip()
        if not mid:
            continue
        rows.append(f"{mid[:8]}…" if len(mid) > 8 else mid)
    return rows


def _log_ack_unknown(
    message_id,
    client_id,
    body,
    *,
    reason,
):
    page_instance_id = (body.get("page_instance_id") or "").strip()
    with st._state_lock:
        known_outbound_ids = sorted(st._outbound_waiting.keys())
        known_leased_ids = [
            get_bridge_message_id(msg)
            for msg in st._outbound_waiting.values()
            if msg.get("delivered_at") and not msg.get("acked_at")
        ]
        known_control_ids = sorted(st._control_waiting.keys())
        recent_finalized = [
            get_bridge_message_id(item)
            for item in reversed(st._outbound_history)
            if item.get("finalized_at") or (item.get("message_status") or "") in (
                "replied",
                "failed",
                "cancelled",
            )
        ][:8]
    _log(
        "[BRIDGE][ACK_UNKNOWN] "
        f"message_id={message_id or '-'} "
        f"client_id={client_id or '-'} "
        f"page_instance_id={page_instance_id or '-'} "
        f"reason={reason or '-'} "
        f"known_outbound_ids={_short_id_list(known_outbound_ids)} "
        f"known_leased_ids={_short_id_list(known_leased_ids)} "
        f"known_control_ids={_short_id_list(known_control_ids)} "
        f"recent_finalized_ids={_short_id_list(recent_finalized)}"
    )


def _safe_notify_external_request_from_bridge(
    message_id,
    event,
    payload=None,
    msg=None,
):
    """通知 external API；失败不得影响 ack/report 主流程。"""
    try:
        _notify_external_request_impl(
            message_id,
            event,
            payload if isinstance(payload, dict) else {},
            msg,
        )
        return True
    except Exception as exc:
        _log(
            "[BRIDGE][EXTERNAL_NOTIFY][FAILED] "
            f"message_id={(message_id or '-')[:8]}… "
            f"event={event or '-'} "
            f"error_type={type(exc).__name__} "
            f"error={exc}\n{traceback.format_exc()}"
        )
        return False


def _finalize_control_message(message_id, status, error_detail=None):
    msg = st._control_waiting.pop(message_id, None)
    if not msg:
        return None
    _finalize_message(msg, status)
    if error_detail:
        msg["error_detail"] = error_detail
    st._outbound_history.append(dict(msg))
    return msg


def _is_finalized(msg):
    if not msg:
        return False
    if msg.get("finalized_at"):
        return True
    message_status = (msg.get("message_status") or "").strip()
    return message_status in ("replied", "failed", "cancelled")


def _finalize_message(msg, status, *, error_detail=None):
    _set_message_status(msg, status, error_detail=error_detail)


def _normalize_page_url(url):
    return (url or "").strip().split("#")[0]


def _archive_waiting(message_id):
    msg = st._outbound_waiting.pop(message_id, None)
    if msg is not None:
        st._outbound_history.append(dict(msg))
        _log(
            f"[BRIDGE][WAITING_ARCHIVE] message_id={message_id[:8]}… "
            f"message_status={msg.get('message_status') or '-'} "
            f"client_id={msg.get('delivered_to') or '-'}"
        )
    return msg


WAITING_TIMEOUT_SEC = 1800  # 30 分钟


def cleanup_stale_waiting_messages():
    """清理 _outbound_waiting 和 _control_waiting 中超时未收到最终回复的消息。

    对状态为 acked / delivered / waiting_reply 且超过 30 分钟无最终 report 的消息，
    标记为 stale/failed，移入 history，然后从 waiting 字典中删除。
    """
    now = _now()
    timeout = WAITING_TIMEOUT_SEC
    stale_outbound_ids = []
    with st._state_lock:
        for message_id, msg in list(st._outbound_waiting.items()):
            if not isinstance(msg, dict):
                stale_outbound_ids.append(message_id)
                continue
            status = (msg.get("message_status") or "").strip()
            if status not in ("acked", "delivered", "waiting_reply"):
                continue
            if _is_finalized(msg):
                stale_outbound_ids.append(message_id)
                continue
            # determine waiting start time
            ts = msg.get("acked_at") or msg.get("delivered_at") or msg.get("created_at") or 0
            try:
                elapsed = now - float(ts)
            except (TypeError, ValueError):
                elapsed = 0.0
            if elapsed < timeout:
                continue
            stale_outbound_ids.append(message_id)
        stale_control_ids = []
        for message_id, msg in list(st._control_waiting.items()):
            if not isinstance(msg, dict):
                stale_control_ids.append(message_id)
                continue
            status = (msg.get("message_status") or "").strip()
            if status not in ("acked", "delivered", "waiting_reply"):
                continue
            if _is_finalized(msg):
                stale_control_ids.append(message_id)
                continue
            ts = msg.get("acked_at") or msg.get("delivered_at") or msg.get("created_at") or 0
            try:
                elapsed = now - float(ts)
            except (TypeError, ValueError):
                elapsed = 0.0
            if elapsed < timeout:
                continue
            stale_control_ids.append(message_id)
        # move stale outbound to history
        for message_id in stale_outbound_ids:
            msg = st._outbound_waiting.pop(message_id, None)
            if msg is None:
                continue
            client_id = (msg.get("delivered_to") or msg.get("client_id") or "-").strip()
            page_key = (msg.get("delivered_page_instance_id") or "").strip()
            ts = msg.get("acked_at") or msg.get("delivered_at") or msg.get("created_at") or 0
            try:
                wait_duration = now - float(ts)
            except (TypeError, ValueError):
                wait_duration = 0.0
            old_status = (msg.get("message_status") or "-").strip()
            msg["message_status"] = "failed"
            msg["error_detail"] = "timeout_no_final_report"
            msg["finalized_at"] = now
            st._outbound_history.append(dict(msg))
            _log(
                "[WAITING][TIMEOUT_RELEASE] "
                f"message_id={message_id or '-'} "
                f"client_id={client_id} "
                f"page_key={page_key or '-'} "
                f"wait_duration_sec={int(wait_duration)} "
                f"old_status={old_status}"
            )
        # move stale control to history
        for message_id in stale_control_ids:
            msg = st._control_waiting.pop(message_id, None)
            if msg is None:
                continue
            client_id = (msg.get("delivered_to") or msg.get("client_id") or "-").strip()
            ts = msg.get("acked_at") or msg.get("delivered_at") or msg.get("created_at") or 0
            try:
                wait_duration = now - float(ts)
            except (TypeError, ValueError):
                wait_duration = 0.0
            old_status = (msg.get("message_status") or "-").strip()
            msg["message_status"] = "failed"
            msg["error_detail"] = "timeout_no_final_report"
            msg["finalized_at"] = now
            st._outbound_history.append(dict(msg))
            _log(
                "[WAITING][TIMEOUT_RELEASE] "
                f"message_id={message_id or '-'} "
                f"client_id={client_id} "
                f"page_key=- "
                f"wait_duration_sec={int(wait_duration)} "
                f"old_status={old_status}"
            )
        if stale_outbound_ids or stale_control_ids:
            _log(
                "[WAITING][TIMEOUT_CLEANUP] "
                f"outbound_released={len(stale_outbound_ids)} "
                f"control_released={len(stale_control_ids)} "
                f"remaining_outbound={len(st._outbound_waiting)} "
                f"remaining_control={len(st._control_waiting)}"
            )


def _waiting_messages_for_client(client_id):
    return [
        msg
        for msg in st._outbound_waiting.values()
        if msg.get("delivered_to") == client_id and not _is_finalized(msg)
    ]


def _get_waiting_message_for_client(client_id):
    msgs = _waiting_messages_for_client(client_id)
    if not msgs:
        return None
    return max(
        msgs,
        key=lambda m: float(m.get("delivered_at") or m.get("created_at") or 0),
    )


def _message_message_client_id(msg):
    return read_bridge_client_id(msg)


def _message_matches_client(msg, client_id):
    target = _message_message_client_id(msg)
    if target and target != client_id:
        return False
    return True


def _sync_conversation_strict_match(msg, body):
    """sync_conversation 严格匹配；返回 (matched, mismatch_reason)。"""
    client_id = (body.get("client_id") or "").strip()
    message_client_id = _message_message_client_id(msg)
    message_page_instance_id = read_bridge_page_instance_id(msg)
    message_conversation_id = (msg.get("conversation_id") or "").strip()
    body_page_instance_id = (body.get("page_instance_id") or "").strip()
    body_conversation_id = (body.get("conversation_id") or "").strip()
    body_page_type = (body.get("page_type") or "").strip()

    if body_page_type == "home":
        return False, "home_bootstrap_only"
    if not body_conversation_id or body_conversation_id == "-":
        return False, "missing_body_conversation_id"
    if body_page_type and body_page_type != "conversation":
        return False, "page_type_not_conversation"
    if not message_client_id or not message_page_instance_id or not message_conversation_id:
        return False, "missing_target_identity"
    if message_client_id != client_id:
        return False, "client_id_mismatch"
    if message_page_instance_id != body_page_instance_id:
        return False, "page_instance_id_mismatch"
    if message_conversation_id != body_conversation_id:
        return False, "conversation_id_mismatch"
    return True, ""


def _sync_conversation_fallback_match(msg, body):
    """同 conversation_id 兜底领取 sync（需 payload.simple_online_policy）。"""
    command = (msg.get("command") or "").strip()
    if command != "sync_conversation":
        return False
    payload = msg.get("payload")
    if not isinstance(payload, dict) or not payload.get("simple_online_policy"):
        return False
    body_page_type = (body.get("page_type") or "").strip()
    if body_page_type == "home":
        return False
    if body_page_type and body_page_type != "conversation":
        return False
    body_conversation_id = (body.get("conversation_id") or "").strip()
    if not body_conversation_id or body_conversation_id == "-":
        return False
    message_conversation_id = (msg.get("conversation_id") or "").strip()
    if not message_conversation_id:
        return False
    return message_conversation_id == body_conversation_id


def _log_sync_conversation_no_match(pending, body, *, mismatch_reason=""):
    client_id = (body.get("client_id") or "").strip()
    message_client_id = _message_message_client_id(pending)
    message_page_instance_id = read_bridge_page_instance_id(pending)
    message_conversation_id = (pending.get("conversation_id") or "").strip()
    body_page_instance_id = (body.get("page_instance_id") or "").strip()
    body_conversation_id = (body.get("conversation_id") or "").strip()
    body_page_type = (body.get("page_type") or "").strip()
    if not mismatch_reason:
        _, mismatch_reason = _sync_conversation_strict_match(pending, body)
    _poll_log_rate_limited(
        "[BRIDGE][CONTROL][NO_MATCH] command=sync_conversation "
        f"message_client_id={message_client_id or '-'} "
        f"message_page_instance_id={message_page_instance_id or '-'} "
        f"message_conversation_id={message_conversation_id or '-'} "
        f"body_client_id={client_id or '-'} "
        f"body_page_instance_id={body_page_instance_id or '-'} "
        f"body_conversation_id={body_conversation_id or '-'} "
        f"body_page_type={body_page_type or '-'} "
        f"mismatch_reason={mismatch_reason or '-'}",
        client_id,
        f"sync_conversation_no_match:{mismatch_reason or 'unknown'}",
        interval_sec=10.0,
    )


def _targeted_control_matches(msg, body):
    """定向控制命令：优先 client_id+page_instance_id，再 client_id+conversation_id，再 conversation_id。"""
    client_id = (body.get("client_id") or "").strip()
    command = (msg.get("command") or "").strip()
    if command not in STRICT_TARGET_CONTROL_COMMANDS:
        return False

    message_client_id = _message_message_client_id(msg)
    message_page_instance_id = read_bridge_page_instance_id(msg)
    message_conversation_id = (msg.get("conversation_id") or "").strip()
    body_page_instance_id = (body.get("page_instance_id") or "").strip()
    body_conversation_id = (body.get("conversation_id") or "").strip()

    if command == "sync_conversation":
        matched, mismatch_reason = _sync_conversation_strict_match(msg, body)
        if matched:
            return True
        if mismatch_reason == "home_bootstrap_only":
            _log(
                "[BRIDGE][CONTROL][SKIP] "
                f"command=sync_conversation reason=home_bootstrap_only "
                f"client_id={client_id or '-'} "
                f"conversation_id={body_conversation_id or '-'}"
            )
        return False

    if not _message_matches_client(msg, client_id):
        return False

    if message_page_instance_id and message_page_instance_id != body_page_instance_id:
        return False

    if message_conversation_id and message_conversation_id != body_conversation_id:
        return False

    return True


def _message_matches_page(msg, body):
    client_id = (body.get("client_id") or "").strip()
    if not _message_matches_client(msg, client_id):
        return False

    is_bootstrap = bool(msg.get("bootstrap_conversation"))

    if not is_bootstrap:
        target_page_id = (msg.get("target_page_id") or "").strip()
        if target_page_id:
            body_page_id = (
                str(body.get("page_display_id") or body.get("page_no") or "").strip()
            )
            if not body_page_id or body_page_id != target_page_id:
                return False

    if is_bootstrap:
        page_type = (body.get("page_type") or "").strip()
        if page_type != "home":
            _log(
                "[BRIDGE][MATCH_SKIP] reason=bootstrap_not_home "
                f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                f"page_type={page_type or '-'} "
                f"client_id={(body.get('client_id') or '-')}"
            )
            return False

        body_conv = (body.get("conversation_id") or "").strip()
        if body_conv:
            _log(
                "[BRIDGE][MATCH_SKIP] reason=bootstrap_has_conversation "
                f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                f"body_conv={body_conv or '-'} "
                f"client_id={(body.get('client_id') or '-')}"
            )
            return False

        target_client = read_bridge_client_id(msg)
        target_instance = read_bridge_page_instance_id(msg)
        body_client = (body.get("client_id") or "").strip()
        body_instance = (body.get("page_instance_id") or "").strip()

        if target_client and target_client != body_client:
            _log(
                "[BRIDGE][MATCH_SKIP] reason=bootstrap_client_mismatch "
                f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                f"target_client={target_client or '-'} "
                f"body_client={body_client or '-'}"
            )
            return False

        if target_instance and target_instance != body_instance:
            _log(
                "[BRIDGE][MATCH_SKIP] reason=bootstrap_page_instance_mismatch "
                f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                f"target_instance={target_instance or '-'} "
                f"body_instance={body_instance or '-'}"
            )
            return False

        target_page_id = (msg.get("target_page_id") or "").strip()
        body_page_id = (
            str(body.get("page_display_id") or body.get("page_no") or "").strip()
        )

        if target_page_id and body_page_id and body_page_id != target_page_id:
            _log(
                "[BRIDGE][MATCH_SKIP] reason=bootstrap_page_id_mismatch "
                f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                f"target_page_id={target_page_id or '-'} "
                f"body_page_id={body_page_id or '-'} "
                f"target_client={target_client or '-'} "
                f"body_client={body_client or '-'} "
                f"target_instance={target_instance or '-'} "
                f"body_instance={body_instance or '-'}"
            )
            return False

        target_bind = (msg.get("bind_request_id") or "").strip()
        body_bind = (body.get("bind_request_id") or "").strip()
        if target_bind:
            if not body_bind or body_bind != target_bind:
                _log(
                    "[BRIDGE][MATCH_SKIP] reason=bootstrap_bind_request_mismatch "
                    f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                    f"target_bind={target_bind or '-'} "
                    f"body_bind={body_bind or '-'} "
                    f"client_id={body_client or '-'}"
                )
                return False

        target_conv = (msg.get("conversation_id") or "").strip()
        if target_conv:
            return False

        _log(
            "[BRIDGE][MATCH_OK] type=bootstrap "
            f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
            f"target_page_id={target_page_id or '-'} "
            f"body_page_id={body_page_id or '-'} "
            f"client_id={body_client or '-'} "
            f"page_instance_id={body_instance or '-'}"
        )
        return True

    body_conv_early = (body.get("conversation_id") or "").strip()
    page_type = (body.get("page_type") or "").strip()
    if not body_conv_early and page_type != "conversation":
        return False

    target_client = read_bridge_client_id(msg)
    target_instance = read_bridge_page_instance_id(msg)
    body_client = (body.get("client_id") or "").strip()
    body_instance = (body.get("page_instance_id") or "").strip()
    if target_client and target_instance:
        if target_client != body_client or target_instance != body_instance:
            _log(
                "[BRIDGE][MATCH_SKIP] reason=page_instance_mismatch "
                f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                f"target_client={target_client or '-'} "
                f"body_client={body_client or '-'} "
                f"target_instance={target_instance or '-'} "
                f"body_instance={body_instance or '-'}"
            )
            return False
        target_conv = (msg.get("conversation_id") or "").strip()
        body_conv = (body.get("conversation_id") or "").strip()
        if target_conv:
            if not body_conv:
                return False
            if target_conv != body_conv:
                _log(
                    "[BRIDGE][MATCH_SKIP] reason=conversation_mismatch "
                    f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                    f"target_conv={target_conv or '-'} "
                    f"body_conv={body_conv or '-'}"
                )
                return False
        return True

    target_conv = (msg.get("conversation_id") or "").strip()
    if not target_conv:
        return False
    body_conv = (body.get("conversation_id") or "").strip()
    if target_conv != body_conv:
        _log(
            "[BRIDGE][MATCH_SKIP] reason=conversation_mismatch "
            f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
            f"client_id={client_id or '-'} "
            f"target_conv={target_conv or '-'} "
            f"body_conv={body_conv or '-'} "
            f"target_url={_normalize_page_url(page_url_from(msg)) or '-'} "
            f"body_url={_normalize_page_url(page_url_from(body)) or '-'}"
        )
        return False

    target_page = _normalize_page_url(page_url_from(msg))
    body_page = _normalize_page_url(page_url_from(body))
    if target_page and body_page and target_page != body_page:
        if not msg.get("strict_url_match"):
            _log(
                "[BRIDGE][MATCH_URL_DIFF] "
                f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                f"client_id={client_id or '-'} "
                f"target_conv={target_conv or '-'} "
                f"body_conv={body_conv or '-'} "
                f"target_url={target_page or '-'} "
                f"body_url={body_page or '-'} "
                f"strict_url_match=false"
            )
        else:
            _log(
                "[BRIDGE][MATCH_SKIP] reason=page_url_mismatch "
                f"message_id={get_bridge_message_id(msg)[:8] or '-'} "
                f"client_id={client_id or '-'} "
                f"target_conv={target_conv or '-'} "
                f"body_conv={body_conv or '-'} "
                f"target_url={target_page or '-'} "
                f"body_url={body_page or '-'}"
            )
            return False
    return True


def _pop_message_for_client(body):
    if not st._outbound_queue:
        return None
    attempts = len(st._outbound_queue)
    for _ in range(attempts):
        msg = st._outbound_queue.popleft()
        if msg.get("type") == "command":
            st._control_queue.append(msg)
            _log(
                f"[命令] 已将滞留控制命令迁入控制队列 "
                f"({get_bridge_message_id(msg)[:8] or '?'}…) command={msg.get('command')}"
            )
            continue
        if _message_matches_page(msg, body):
            return msg
        st._outbound_queue.append(msg)
    return None


def _pop_control_command_for_client(body):
    client_id = (body.get("client_id") or "").strip()
    if not st._control_queue:
        return None
    attempts = len(st._control_queue)

    def _rotate(predicate):
        for _ in range(attempts):
            msg = st._control_queue.popleft()
            if predicate(msg):
                return msg
            st._control_queue.append(msg)
        return None

    # 1) 严格定向控制命令（sync_conversation / start_upload 等）
    msg = _rotate(lambda m: _targeted_control_matches(m, body))
    if msg:
        _log(
            f"[BRIDGE][CONTROL][CLAIM] command={(msg.get('command') or '-')} "
            f"message_id={get_bridge_message_id(msg)[:8]}… client_id={client_id} "
            f"page_instance_id={(body.get('page_instance_id') or '-')} "
            f"conversation_id={(body.get('conversation_id') or '-')}"
        )
        _log(
            f"[TM_CONTROL][POLL_RESULT] client_id={client_id} "
            f"command={(msg.get('command') or '-')} message_id={get_bridge_message_id(msg)[:8]}… "
            f"command_count=1"
        )
        return msg

    # 1b) sync_conversation：同 conversation_id 兜底（仅 simple_online_policy）
    msg = _rotate(lambda m: _sync_conversation_fallback_match(m, body))
    if msg:
        message_client_id = _message_message_client_id(msg)
        message_page_instance_id = read_bridge_page_instance_id(msg)
        _log(
            "[BRIDGE][CONTROL][CLAIM_FALLBACK_SAME_CONVERSATION] "
            f"command=sync_conversation "
            f"message_id={get_bridge_message_id(msg)[:8]}… "
            f"old_message_client_id={message_client_id or '-'} "
            f"old_message_page_instance_id={message_page_instance_id or '-'} "
            f"body_client_id={client_id or '-'} "
            f"body_page_instance_id={(body.get('page_instance_id') or '-')} "
            f"conversation_id={(body.get('conversation_id') or '-')}"
        )
        _log(
            f"[TM_CONTROL][POLL_RESULT] client_id={client_id} "
            f"command=sync_conversation message_id={get_bridge_message_id(msg)[:8]}… "
            f"command_count=1 fallback=same_conversation"
        )
        return msg

    for pending in st._control_queue:
        if (pending.get("command") or "").strip() != "sync_conversation":
            continue
        _log_sync_conversation_no_match(pending, body)
        break
    # 2) 定向 close_self（匹配 message_client_id）
    msg = _rotate(
        lambda m: m.get("command") == "close_self"
        and _message_message_client_id(m)
        and _message_matches_client(m, client_id)
    )
    if msg:
        return msg
    # 3) open_url（无 target 或匹配当前 client）
    msg = _rotate(
        lambda m: m.get("command") == "open_url"
        and _message_matches_client(m, client_id)
    )
    if msg:
        return msg
    # 4) 其余控制命令（含批量 close_self 等；排除严格定向命令）
    return _rotate(
        lambda m: (m.get("command") or "").strip()
        not in STRICT_TARGET_CONTROL_COMMANDS
        and _message_matches_client(m, client_id)
    )


def _claim_message(msg, client_id_or_body):
    now = _now()
    if isinstance(client_id_or_body, dict):
        body = client_id_or_body
        client_id = (body.get("client_id") or "").strip()
        page_instance_id = (body.get("page_instance_id") or "").strip()
        conversation_id = (body.get("conversation_id") or "").strip()
    else:
        client_id = (client_id_or_body or "").strip()
        page_instance_id = ""
        conversation_id = ""
    _sync_message_status_fields(msg, "delivered")
    msg["delivered_to"] = client_id
    msg["delivered_at"] = now
    msg["lease_until"] = now + LEASE_SEC
    if page_instance_id:
        msg["delivered_client_id"] = client_id
        msg["delivered_page_instance_id"] = page_instance_id
        msg["delivered_conversation_id"] = (body.get("conversation_id") or "").strip()
    if conversation_id:
        msg["delivered_conversation_id"] = conversation_id
    ext._update_external_status_for_bridge(get_bridge_message_id(msg), "sent")
    entry = _registry_entry_for_client(client_id, page_instance_id)
    if entry:
        registry_key = f"{client_id}|{page_instance_id}" if client_id and page_instance_id else (client_id or '')
        with st._state_lock:
            live = st._tampermonkey_pages.get(registry_key)
            if isinstance(live, dict):
                live["last_claim_at"] = now
    _log(
        f"[BRIDGE][CLAIM] client_id={client_id} message_id={get_bridge_message_id(msg)[:8]}… "
        f"lease_until={_format_time(msg['lease_until'])}"
    )


def _poll_identity_changed(client_id, page_type, conversation_id, url=""):
    prev = st._last_poll_identity.get(client_id)
    norm_url = _normalize_chatgpt_url_for_compare(url or "")
    current = (page_type or "", conversation_id or "", norm_url)
    if prev is None:
        st._last_poll_identity[client_id] = current
        return True
    if prev != current:
        st._last_poll_identity[client_id] = current
        return True
    return False


def _poll_log_immediate(message):
    _log(message)


def _poll_log_rate_limited(message, client_id, reason, *, interval_sec=5.0):
    """非 queue_empty 等原因限频；queue_empty 默认 5 秒/client 最多一条。"""
    client_id = (client_id or "").strip() or "-"
    reason = (reason or "").strip() or "unknown"
    now = _now()
    if reason == "queue_empty":
        key = f"{client_id}:queue_empty"
        interval = interval_sec
    else:
        key = f"{client_id}:{reason}"
        interval = 2.0
    last_at = st._last_poll_other_reason_log_at.get(key, 0.0)
    if now - last_at < interval:
        return
    st._last_poll_other_reason_log_at[key] = now
    _poll_log_immediate(message)


def _record_poll_empty(client_id, page_type, conversation_id):
    now = _now()
    stats = st._poll_summaries.setdefault(
        client_id,
        {
            "window_start": now,
            "polls": 0,
            "claimed": 0,
            "page_type": page_type or "-",
            "conversation_id": conversation_id or "-",
        },
    )
    stats["polls"] += 1
    stats["page_type"] = page_type or stats.get("page_type") or "-"
    stats["conversation_id"] = conversation_id or stats.get("conversation_id") or "-"
    elapsed = now - stats.get("window_start", now)
    if elapsed >= POLL_SUMMARY_INTERVAL_SEC:
        _flush_poll_summary(client_id)


def _record_poll_claimed(client_id, page_type, conversation_id):
    stats = st._poll_summaries.setdefault(
        client_id,
        {
            "window_start": _now(),
            "polls": 0,
            "claimed": 0,
            "page_type": page_type or "-",
            "conversation_id": conversation_id or "-",
        },
    )
    stats["claimed"] = int(stats.get("claimed", 0)) + 1
    stats["page_type"] = page_type or stats.get("page_type") or "-"
    stats["conversation_id"] = conversation_id or stats.get("conversation_id") or "-"


def _flush_poll_summary(client_id, force=False):
    stats = st._poll_summaries.get(client_id)
    if not stats:
        return
    now = _now()
    elapsed = now - stats.get("window_start", now)
    if not force and elapsed < POLL_SUMMARY_INTERVAL_SEC:
        return
    duration = max(1, int(round(elapsed)))
    polls = int(stats.get("polls", 0))
    claimed = int(stats.get("claimed", 0))
    _log(
        f"[BRIDGE][POLL_SUMMARY] client_id={client_id} "
        f"page_type={stats.get('page_type') or '-'} "
        f"conversation_id={stats.get('conversation_id') or '-'} "
        f"duration={duration}s polls={polls} claimed={claimed}"
    )
    st._poll_summaries[client_id] = {
        "window_start": now,
        "polls": 0,
        "claimed": 0,
        "page_type": stats.get("page_type") or "-",
        "conversation_id": stats.get("conversation_id") or "-",
    }


def _poll_response(msg, retry):
    if isinstance(msg, dict):
        assert_no_legacy_fields(dict(msg), owner="server._poll_response")
    msg = normalize_outbound_bridge_message(msg)
    message_id = (msg.get("message_id") or "").strip()
    message_status = (msg.get("message_status") or "").strip()
    resp = {
        "ok": True,
        "has_message": True,
        "message_id": message_id,
        "type": msg.get("type", "chat"),
        "retry": retry,
    }
    common_target_fields = (
        "client_id",
        "page_instance_id",
        "url",
        "conversation_id",
    )
    if msg.get("type") == "command":
        resp["command"] = msg.get("command")
        resp["url"] = msg.get("url")
        resp["active"] = msg.get("active", True)
        _copy_existing_fields(resp, msg, common_target_fields)
        if msg.get("payload") is not None:
            resp["payload"] = msg.get("payload")
    else:
        resp["content"] = (msg.get("content") or "").strip()
        resp["url"] = page_url_from(msg) or None
        _copy_existing_fields(
            resp,
            msg,
            (
                *common_target_fields,
                "bind_request_id",
            ),
        )
        if msg.get("bootstrap_conversation"):
            resp["bootstrap_conversation"] = True
        if msg.get("target_page_id"):
            resp["target_page_id"] = msg.get("target_page_id")
    assert_no_legacy_fields(resp, owner="server._poll_response")
    return resp


def _outbound_queue_stats(client_id="", conversation_id=""):
    client_id = (client_id or "").strip()
    conversation_id = (conversation_id or "").strip()
    pending_total = 0
    pending_for_page = 0
    pending_for_conversation = 0
    with st._state_lock:
        for msg in st._outbound_queue:
            if msg.get("type") == "command":
                continue
            pending_total += 1
            if client_id and _message_matches_client(msg, client_id):
                pending_for_page += 1
            msg_conv = (msg.get("conversation_id") or "").strip()
            if conversation_id and msg_conv == conversation_id:
                pending_for_conversation += 1
    return pending_total, pending_for_page, pending_for_conversation


def _poll_minimal_idle_response(body=None):
    """无消息时的最小 poll 响应。"""
    return {"ok": True, "has_message": False}


def _finalize_poll_response(result, body):
    """保证 poll 响应顶层含 page_no 并写 [TM_PAGE_DISPLAY_ID][POLL_RESPONSE] 日志。"""
    return _ensure_poll_top_level_page_no(result, body)


def _poll_no_message_reason(body, waiting=None):
    client_id = (body.get("client_id") or "").strip()
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    if waiting and not _is_finalized(waiting):
        message_status = (waiting.get("message_status") or "").strip()
        owner = (waiting.get("delivered_to") or "").strip()
        if message_status in ("acked", "delivered") and owner == client_id:
            return "client_busy"
        return "client_busy"
    if page_type == "home":
        has_bootstrap = False
        with st._state_lock:
            for msg in st._outbound_queue:
                if msg.get("bootstrap_conversation") and _message_matches_client(msg, client_id):
                    has_bootstrap = True
                    break
        if has_bootstrap:
            return "home_bootstrap_only"
        return "home_bootstrap_only"
    if page_type != "conversation":
        return "not_target_client"
    pending_total, pending_for_page, _ = _outbound_queue_stats(
        client_id, conversation_id
    )
    if pending_total <= 0:
        return "queue_empty"
    if pending_for_page <= 0:
        return "not_target_client"
    for msg in list(st._outbound_queue):
        if msg.get("type") == "command":
            continue
        if not _message_matches_client(msg, client_id):
            continue
        target_conv = (msg.get("conversation_id") or "").strip()
        if target_conv and conversation_id and target_conv != conversation_id:
            return "target_conversation_mismatch"
    entry = _registry_entry_for_client(client_id, (body.get("page_instance_id") or "").strip())
    if not entry.get("can_accept_input", True):
        return "input_not_ready"
    from app.utils.page_status import BUSY_RESPONSE_STATES

    response_state = (entry.get("response_state") or "unknown").strip()
    if response_state in BUSY_RESPONSE_STATES:
        return "client_busy"
    return "queue_empty"


def _log_poll_request(body):
    client_id = (body.get("client_id") or "").strip()
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    page_instance_id = (body.get("page_instance_id") or "-")
    page_no = str(body.get("page_display_id") or body.get("page_no") or "-").strip() or "-"
    _poll_log_immediate(
        f"[BRIDGE][POLL] client_id={client_id} "
        f"page_instance_id={page_instance_id} "
        f"page_no={page_no} "
        f"page_type={page_type or '-'} "
        f"conversation_id={conversation_id or '-'}"
    )


def _log_poll_no_message(body, waiting=None):
    client_id = (body.get("client_id") or "").strip()
    page_type = (body.get("page_type") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    reason = _poll_no_message_reason(body, waiting)
    if reason == "queue_empty":
        if not st._debug_mode:
            _record_poll_empty(client_id, page_type, conversation_id)
            return
        now = _now()
        key = f"{client_id}:{conversation_id}:queue_empty"
        last_at = st._last_poll_empty_log_at.get(key, 0.0)
        if now - last_at < 10.0:
            _record_poll_empty(client_id, page_type, conversation_id)
            return
        st._last_poll_empty_log_at[key] = now
    pending_total, pending_for_page, pending_for_conversation = _outbound_queue_stats(
        client_id, conversation_id
    )
    msg = (
        f"[BRIDGE][POLL][NO_MESSAGE] client_id={client_id} "
        f"conversation_id={conversation_id or '-'} page_type={page_type or '-'} "
        f"reason={reason} pending_total={pending_total} "
        f"pending_for_url={pending_for_page} "
        f"pending_for_conversation={pending_for_conversation}"
    )
    if st._debug_mode:
        _poll_log_immediate(msg)
    else:
        _poll_log_rate_limited(msg, client_id, reason)


def _log_poll_message_found(body, msg, *, delivered=False):
    client_id = (body.get("client_id") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    text = (msg.get("content") or "")
    _poll_log_immediate(
        f"[BRIDGE][POLL][MESSAGE_FOUND] client_id={client_id} "
        f"conversation_id={conversation_id or '-'} "
        f"message_id={get_bridge_message_id(msg) or '-'} "
        f"trace_id={(msg.get('trace_id') or '-')} text_len={len(text)} "
        f"client_id={(read_bridge_client_id(msg) or '-')} "
        f"conversation_id={(msg.get('conversation_id') or '-')}"
    )
    if delivered:
        _poll_log_immediate(
            f"[BRIDGE][POLL][MESSAGE_DELIVERED] client_id={client_id} "
            f"message_id={get_bridge_message_id(msg) or '-'} "
            f"trace_id={(msg.get('trace_id') or '-')}"
        )


def _handle_hello(body):
    """页面 hello/register：缓存版本能力字段，返回注册 patch。"""
    client_id = (body.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "缺少 client_id"}, False
    page_instance_id = (body.get("page_instance_id") or "").strip()
    _touch_tampermonkey(body, action="hello")
    result = {"ok": True}
    result.update(_bridge_runtime_patch_for_body(body))
    if st._debug_mode or bool(body.get("debug_status")):
        result.update(_tm_registry_counts())
    _log(
        f"[TM][HELLO][REGISTER] client_id={client_id} "
        f"page_instance_id={page_instance_id or '-'} "
        f"page_no={result.get('page_no') or '-'}"
    )
    return result, True


def _handle_poll(body):
    import traceback

    body = body if isinstance(body, dict) else {}
    client_id = str(body.get("client_id") or "").strip()
    page_instance_id = str(body.get("page_instance_id") or "").strip()
    page_type = str(body.get("page_type") or "").strip()
    conversation_id = str(body.get("conversation_id") or "").strip()
    url = str(body.get("url") or "").strip()
    _log(
        "[BRIDGE][POLL][ENTER] "
        f"client_id={client_id or '-'} "
        f"page_instance_id={page_instance_id or '-'} "
        f"conversation_id={conversation_id or '-'} "
        f"url={url or '-'}"
    )
    try:
        return _handle_poll_impl(
            body,
            client_id=client_id,
            page_instance_id=page_instance_id,
            page_type=page_type,
            conversation_id=conversation_id,
            url=url,
        )
    except Exception as exc:
        _log(
            "[BRIDGE][POLL][ERROR] "
            f"error_type={type(exc).__name__} "
            f"error={exc} "
            f"traceback={traceback.format_exc()}"
        )
        return {"ok": False, "error": str(exc)}, False, False


def _handle_poll_impl(
    body,
    *,
    client_id,
    page_instance_id,
    page_type,
    conversation_id,
    url,
):
    if not client_id:
        _poll_log_immediate("[BRIDGE][POLL] 拒绝：缺少 client_id")
        return {"ok": False, "error": "缺少 client_id"}, False, False
    identity_changed = _poll_identity_changed(
        client_id, page_type, conversation_id, url
    )
    _touch_tampermonkey(body, action="poll")
    cleanup_stale_waiting_messages()
    _log_poll_request(body)
    need_notify = False
    now = _now()
    cmd = _pop_control_command_for_client(body)
    if cmd:
        _claim_message(cmd, client_id)
        message_id = get_bridge_message_id(cmd)
        st._control_waiting[message_id] = cmd
        _record_poll_claimed(client_id, page_type, conversation_id)
        _poll_log_immediate(
            f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
            f"conversation_id={conversation_id or '-'} has_message=True "
            f"message_id={message_id[:8]}… type=command"
        )
        _log(
            f"[命令] 控制命令已下发 ({message_id[:8]}…) "
            f"command={cmd.get('command')} client_id={client_id}"
        )
        need_notify = True
        return (
            _finalize_poll_response(_poll_response(cmd, retry=False), body),
            need_notify,
            identity_changed,
        )
    waiting = _get_waiting_message_for_client(client_id)
    if waiting and waiting.get("message_status") == "delivered":
        message_id = get_bridge_message_id(waiting)
        owner = waiting.get("delivered_to")
        lease_until = waiting.get("lease_until") or 0
        if owner == client_id and now < lease_until:
            _record_poll_claimed(client_id, page_type, conversation_id)
            _poll_log_immediate(
                f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={message_id[:8]}… message_status=retry_same_owner has_message=True"
            )
            return (
                _finalize_poll_response(_poll_response(waiting, retry=True), body),
                need_notify,
                identity_changed,
            )
        if _is_finalized(waiting):
            _archive_waiting(message_id)
            waiting = _get_waiting_message_for_client(client_id)
        elif now >= lease_until:
            _claim_message(waiting, client_id)
            _record_poll_claimed(client_id, page_type, conversation_id)
            _poll_log_immediate(
                f"[BRIDGE][POLL] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"message_id={message_id[:8]}… message_status=lease_reclaim has_message=True"
            )
            return (
                _finalize_poll_response(_poll_response(waiting, retry=True), body),
                need_notify,
                identity_changed,
            )
    if waiting and not _is_finalized(waiting):
        if waiting.get("message_status") in ("acked", "delivered"):
            owner = waiting.get("delivered_to")
            if owner == client_id:
                if st._debug_mode:
                    _log_poll_no_message(body, waiting)
                else:
                    _record_poll_empty(client_id, page_type, conversation_id)
                return (
                    _finalize_poll_response(_poll_minimal_idle_response(body), body),
                    False,
                    identity_changed,
                )
        _log_poll_no_message(body, waiting)
        return (
            _finalize_poll_response(_poll_minimal_idle_response(body), body),
            False,
            identity_changed,
        )
    if page_type == "home":
        msg = _pop_message_for_client(body)
        if msg and msg.get("bootstrap_conversation"):
            _claim_message(msg, client_id)
            message_id = get_bridge_message_id(msg)
            st._outbound_waiting[message_id] = msg
            page_instance_id = (body.get("page_instance_id") or "-").strip() or "-"
            _log(
                f"[BRIDGE][QUEUE_TAKE] message_id={message_id[:8] or '-'} "
                f"client_id={client_id} "
                f"page_instance_id={page_instance_id} "
                f"bootstrap=true"
            )
            _log(
                f"[BRIDGE][WAITING_ADD] message_id={message_id[:8]}… "
                f"session_id={(msg.get('session_id') or '-')[:8]} "
                f"turn_id={(msg.get('turn_id') or '-')[:8]} "
                f"client_id={client_id} bootstrap=home"
            )
            _record_poll_claimed(client_id, page_type, conversation_id)
            _log_poll_message_found(body, msg, delivered=True)
            _log(f"[发送] 油猴已取走 bootstrap ({message_id[:8]}…) client_id={client_id}")
            need_notify = True
            return (
                _finalize_poll_response(_poll_response(msg, retry=False), body),
                need_notify,
                identity_changed,
            )
        if st._debug_mode:
            _log_poll_no_message(body, waiting)
        else:
            _record_poll_empty(client_id, page_type, conversation_id)
        return (
            _finalize_poll_response(_poll_minimal_idle_response(body), body),
            False,
            identity_changed,
        )
    if page_type != "conversation":
        if st._debug_mode:
            _log_poll_no_message(body, waiting)
        else:
            _record_poll_empty(client_id, page_type, conversation_id)
        return (
            _finalize_poll_response(_poll_minimal_idle_response(body), body),
            False,
            identity_changed,
        )
    msg = _pop_message_for_client(body)
    if msg:
        _claim_message(msg, client_id)
        message_id = get_bridge_message_id(msg)
        st._outbound_waiting[message_id] = msg
        page_instance_id = (body.get("page_instance_id") or "-").strip() or "-"
        is_bootstrap = bool(msg.get("bootstrap_conversation"))
        _log(
            f"[BRIDGE][QUEUE_TAKE] message_id={message_id[:8] or '-'} "
            f"client_id={client_id} "
            f"page_instance_id={page_instance_id} "
            f"bootstrap={'true' if is_bootstrap else 'false'}"
        )
        _log(
            f"[BRIDGE][WAITING_ADD] message_id={message_id[:8]}… "
            f"session_id={(msg.get('session_id') or '-')[:8]} "
            f"turn_id={(msg.get('turn_id') or '-')[:8]} "
            f"client_id={client_id} "
            f"conversation_id={msg.get('conversation_id') or conversation_id or '-'}"
        )
        _record_poll_claimed(client_id, page_type, conversation_id)
        _log_poll_message_found(body, msg, delivered=True)
        _log(f"[发送] 油猴已取走 ({message_id[:8]}…) client_id={client_id}")
        need_notify = True
        return (
            _finalize_poll_response(_poll_response(msg, retry=False), body),
            need_notify,
            identity_changed,
        )
    if st._debug_mode:
        _log_poll_no_message(body, waiting)
    else:
        _record_poll_empty(client_id, page_type, conversation_id)
    return (
        _finalize_poll_response(_poll_minimal_idle_response(body), body),
        False,
        identity_changed,
    )


def _lookup_control_command(message_id):
    """查找 sync/控制命令：waiting -> control_queue -> history。"""
    message_id = (message_id or "").strip()
    if not message_id:
        return None, None
    with st._state_lock:
        msg = st._control_waiting.get(message_id)
        if msg:
            return msg, "waiting"
        for pending in st._control_queue:
            if get_bridge_message_id(pending) == message_id:
                return pending, "queue"
        for hist in reversed(st._outbound_history):
            if get_bridge_message_id(hist) == message_id and hist.get("type") == "command":
                return hist, "history"
    return None, None


def _handle_conversation_snapshot_report(body, client_id, message_id, payload):
    message_id = (message_id or "").strip()
    client_id = (client_id or "").strip()
    msg, location = _lookup_control_command(message_id)
    if not msg:
        with st._state_lock:
            waiting_ids = sorted(st._control_waiting.keys())
            queue_ids = [
                get_bridge_message_id(item)
                for item in st._control_queue
                if get_bridge_message_id(item)
            ]
            recent_finalized = [
                get_bridge_message_id(item)
                for item in reversed(st._outbound_history)
                if item.get("type") == "command"
            ][:8]
        waiting_short = [
            (mid[:8] + "…") if mid and len(mid) > 8 else (mid or "-")
            for mid in waiting_ids
        ]
        queue_short = [
            (mid[:8] + "…") if mid and len(mid) > 8 else (mid or "-")
            for mid in queue_ids
        ]
        finalized_short = [
            (mid[:8] + "…") if mid and len(mid) > 8 else (mid or "-")
            for mid in recent_finalized
        ]
        _log(
            "[BRIDGE][CONVERSATION_SNAPSHOT][UNKNOWN] "
            f"message_id={message_id or '-'} "
            f"waiting_message_ids={waiting_short} "
            f"control_queue_ids={queue_short} "
            f"recent_finalized_ids={finalized_short}"
        )
        _add_inbound(
            "report_unknown",
            {
                "event": "conversation_snapshot",
                "payload": payload,
                "report_client_id": client_id,
                "waiting_message_ids": waiting_ids,
                "control_queue_ids": queue_ids,
            },
            message_id=message_id,
            client_id=client_id,
        )
        _notify_status()
        return {"ok": True}

    command = (msg.get("command") or "").strip()
    if command != "sync_conversation":
        _log(
            "[BRIDGE][CONVERSATION_SNAPSHOT][IGNORED] "
            f"message_id={message_id[:8]}… command={command or '-'}"
        )
        return {"ok": True}

    owner = (msg.get("delivered_to") or "").strip()
    if owner and owner != client_id:
        _add_inbound(
            "report_mismatch",
            {
                "event": "conversation_snapshot",
                "payload": payload,
                "owner_client_id": owner,
                "report_client_id": client_id,
            },
            message_id=message_id,
            session_id=msg.get("session_id"),
            client_id=client_id,
        )
        _log(
            "[BRIDGE][CONVERSATION_SNAPSHOT][MISMATCH] "
            f"message_id={message_id[:8]}… owner={owner} reporter={client_id}"
        )
        _notify_status()
        return {"ok": True}

    if _is_finalized(msg):
        session_id = (payload.get("session_id") or msg.get("session_id") or "").strip()
        _add_inbound(
            "conversation_snapshot",
            dict(payload) if isinstance(payload, dict) else {},
            message_id=message_id,
            session_id=session_id,
            client_id=client_id,
        )
        _log(
            "[BRIDGE][CONVERSATION_SNAPSHOT][LATE] "
            f"message_id={message_id[:8]}… location={location or '-'}"
        )
        _notify_status()
        return {"ok": True}

    cmd_payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
    page_meta = payload.get("page") if isinstance(payload.get("page"), dict) else {}
    enriched = dict(payload) if isinstance(payload, dict) else {}
    for key, value in cmd_payload.items():
        if value not in (None, "") and not enriched.get(key):
            enriched[key] = value
    for key in (
        "session_id",
        "conversation_id",
        "request_id",
        "client_id",
        "page_instance_id",
        "url",
    ):
        if (enriched.get(key) or "").strip():
            continue
        alt = cmd_payload.get(key) or page_meta.get(key) or body.get(key)
        if alt not in (None, ""):
            enriched[key] = alt
    if not (enriched.get("client_id") or "").strip():
        enriched["client_id"] = client_id
    session_id = (enriched.get("session_id") or msg.get("session_id") or "").strip()
    request_id = (enriched.get("request_id") or "-").strip() or "-"
    conversation_id = (enriched.get("conversation_id") or "-").strip() or "-"
    message_count = len(enriched.get("messages") or [])
    _log(
        "[BRIDGE][CONVERSATION_SNAPSHOT][RECV] "
        f"message_id={message_id} "
        f"session_id={session_id or '-'} "
        f"request_id={request_id} "
        f"client_id={client_id or '-'} "
        f"conversation_id={conversation_id} "
        f"message_count={message_count}"
    )
    _log(
        f"[SYNC_CONVERSATION][RECV] session_id={session_id or '-'} "
        f"message_id={message_id[:8]}… "
        f"conversation_id={conversation_id} "
        f"count={message_count}"
    )
    _log(
        f"[WEB_SYNC][SNAPSHOT_RECEIVED] request_id={request_id} "
        f"client_id={client_id} conversation_id={conversation_id} "
        f"message_count={message_count}"
    )
    _add_inbound(
        "conversation_snapshot",
        enriched,
        message_id=message_id,
        session_id=session_id,
        client_id=client_id,
    )
    with st._state_lock:
        if message_id in st._control_waiting:
            _finalize_control_message(message_id, "replied", None)
    _log(
        "[BRIDGE][CONVERSATION_SNAPSHOT][FINALIZED] "
        f"message_id={message_id} status=snapshot_received"
    )
    _notify_status()
    return {"ok": True}


def _ack_detail_indicates_busy_wait(detail):
    detail_text = str(detail or "").lower()
    return (
        "assistant_busy" in detail_text
        or "generating" in detail_text
        or (
            "send_not_confirmed" in detail_text
            and "assistant_busy" in detail_text
        )
    )


def _handle_ack(body):
    client_id = (body.get("client_id") or "").strip()
    message_id = (body.get("message_id") or "").strip()
    success = bool(body.get("success", False))
    detail = body.get("detail") or ""
    detail_text = str(detail or "").lower()
    busy_wait = _ack_detail_indicates_busy_wait(detail)
    if busy_wait and "assistant_busy" in detail_text:
        detail = detail if str(detail).strip() else "assistant_busy"
    _touch_tampermonkey(body, action="ack")
    if not client_id:
        _log("[BRIDGE][ACK] 拒绝：缺少 client_id")
        return {"ok": False, "error": "缺少 client_id"}
    ack_session_id = None
    ack_turn_id = None
    with st._state_lock:
        control = st._control_waiting.get(message_id)
        if control:
            owner = control.get("delivered_to")
            if owner != client_id:
                _add_inbound(
                    "ack_mismatch",
                    {
                        "message_id": message_id,
                        "detail": detail or "client_id 与领取者不一致",
                        "owner_client_id": owner,
                        "report_client_id": client_id,
                    },
                    message_id=message_id,
                    client_id=client_id,
                )
                _log(
                    f"[BRIDGE][ACK_MISMATCH] control owner={owner} reporter={client_id} "
                    f"message_id={message_id[:8]}…"
                )
                _notify_status()
                return {"ok": False, "error": "client_id 不匹配"}
            if _is_finalized(control):
                _add_inbound(
                    "ack_mismatch",
                    {
                        "message_id": message_id,
                        "detail": "控制命令已结束，忽略 ack",
                        "owner_client_id": owner,
                        "report_client_id": client_id,
                    },
                    message_id=message_id,
                    client_id=client_id,
                )
                _notify_status()
                return {"ok": False, "error": "消息已结束"}
            control["acked_at"] = _now()
            if success:
                _sync_message_status_fields(control, "acked")
            else:
                _finalize_control_message(message_id, "failed", detail)
            control_command = (control.get("command") or "-").strip()
            _log(
                f"[BRIDGE][ACK] command={control_command} client_id={client_id} "
                f"message_id={message_id[:8]}… success={success} detail={detail or '-'}"
            )
            _add_inbound(
                "ack",
                {"success": success, "detail": detail, "control": True},
                message_id=message_id,
                client_id=client_id,
            )
            _notify_status()
            return {"ok": True}
        waiting, ack_location = _lookup_outbound_for_ack(message_id)
        if not waiting:
            hist_control, hist_loc = _lookup_control_command(message_id)
            if hist_control and hist_control.get("type") == "command":
                hist_owner = (hist_control.get("delivered_to") or "").strip()
                hist_cmd = (hist_control.get("command") or "").strip()
                if hist_owner and hist_owner != client_id:
                    _log(
                        "[BRIDGE][ACK][CONTROL_MISMATCH] "
                        f"message_id={message_id[:8]}… command={hist_cmd} "
                        f"owner={hist_owner} reporter={client_id}"
                    )
                    _notify_status()
                    return {"ok": False, "error": "client_id 不匹配"}
                _log(
                    "[BRIDGE][ACK][CONTROL_LATE] "
                    f"message_id={message_id} command={hist_cmd} "
                    f"location={hist_loc or '-'} finalized="
                    f"{'yes' if _is_finalized(hist_control) else 'no'} "
                    f"detail={detail or '-'}"
                )
                _add_inbound(
                    "ack",
                    {
                        "success": success,
                        "detail": detail,
                        "control": True,
                        "late": True,
                    },
                    message_id=message_id,
                    client_id=client_id,
                )
                _notify_status()
                return {"ok": True}
            _log_ack_unknown(
                message_id,
                client_id,
                body,
                reason="not_in_outbound_waiting_queue_or_history",
            )
            _add_inbound(
                "ack_mismatch",
                {
                    "message_id": message_id,
                    "detail": detail or "message_id 不匹配或已过期",
                    "report_client_id": client_id,
                },
                message_id=message_id,
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][ACK_MISMATCH] reporter={client_id} message_id={message_id} "
                f"reason=not_waiting"
            )
            _notify_status()
            return {"ok": False, "error": "message_id 不匹配或已过期"}
        if ack_location == "queue":
            _log(
                "[BRIDGE][ACK][QUEUE_LATE] "
                f"message_id={message_id} client_id={client_id} "
                f"success={success} detail={detail or '-'}"
            )
            _add_inbound(
                "ack",
                {"success": success, "detail": detail, "late": True, "location": "queue"},
                message_id=message_id,
                session_id=waiting.get("session_id"),
                turn_id=waiting.get("turn_id"),
                client_id=client_id,
            )
            _notify_status()
            return {"ok": True}
        if ack_location == "history" and _is_finalized(waiting):
            _log(
                "[BRIDGE][ACK][HISTORY_FINALIZED] "
                f"message_id={message_id} client_id={client_id} "
                f"message_status={waiting.get('message_status') or '-'}"
            )
            _add_inbound(
                "ack",
                {
                    "success": success,
                    "detail": detail,
                    "late": True,
                    "location": "history",
                    "ignored": True,
                },
                message_id=message_id,
                session_id=waiting.get("session_id"),
                turn_id=waiting.get("turn_id"),
                client_id=client_id,
            )
            _notify_status()
            return {"ok": True}
        if ack_location == "history":
            _log(
                "[BRIDGE][ACK][HISTORY_LATE] "
                f"message_id={message_id} client_id={client_id} "
                f"success={success} detail={detail or '-'}"
            )
        owner = (waiting.get("delivered_to") or "").strip()
        if owner and owner != client_id:
            _add_inbound(
                "ack_mismatch",
                {
                    "message_id": message_id,
                    "detail": detail or "client_id 与领取者不一致",
                    "owner_client_id": owner,
                    "report_client_id": client_id,
                },
                message_id=message_id,
                session_id=waiting.get("session_id"),
                turn_id=waiting.get("turn_id"),
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][ACK_MISMATCH] owner={owner} reporter={client_id} "
                f"message_id={message_id[:8]}…"
            )
            _notify_status()
            return {"ok": False, "error": "client_id 不匹配"}
        if _is_finalized(waiting):
            _add_inbound(
                "ack_mismatch",
                {
                    "message_id": message_id,
                    "detail": "消息已 finalized，忽略 ack",
                    "owner_client_id": owner,
                    "report_client_id": client_id,
                },
                message_id=message_id,
                session_id=waiting.get("session_id"),
                turn_id=waiting.get("turn_id"),
                client_id=client_id,
            )
            _notify_status()
            return {"ok": False, "error": "消息已结束"}
        now = _now()
        if not waiting.get("delivered_at"):
            waiting["delivered_at"] = now
        waiting["acked_at"] = now
        if not success:
            waiting["error_detail"] = detail
        ack_session_id = waiting.get("session_id")
        ack_turn_id = waiting.get("turn_id")
        if success:
            waiting.pop("finalized_at", None)
            _sync_message_status_fields(waiting, "acked")
            ext._update_external_status_for_bridge(message_id, "waiting")
        elif busy_wait:
            waiting.pop("finalized_at", None)
            _sync_message_status_fields(waiting, "waiting_reply")
            ext._update_external_status_for_bridge(message_id, "waiting")
            _log(
                "[BRIDGE][ACK][BUSY_WAIT] "
                f"client_id={client_id} message_id={message_id} "
                f"detail={detail or '-'}"
            )
        else:
            _finalize_message(waiting, "failed")
            if ack_location == "waiting":
                _archive_waiting(message_id)
            _safe_notify_external_request_from_bridge(
                message_id,
                "send_failed",
                {"detail": detail, "reason": detail},
                waiting,
            )
    if success:
        ack_conv = (body.get("conversation_id") or "").strip()
        if not ack_conv and waiting:
            ack_conv = (waiting.get("conversation_id") or "").strip()
        _log(
            "[BRIDGE][ACK][SEND_SUCCESS] "
            f"message_id={message_id} "
            f"conversation_id={ack_conv or '-'}"
        )
        _log(
            "[BRIDGE][ACK][OK] "
            f"client_id={client_id} message_id={message_id} "
            f"session_id={(ack_session_id or '-')[:8] if ack_session_id else '-'} "
            f"turn_id={(ack_turn_id or '-')[:8] if ack_turn_id else '-'} "
            f"detail={detail or '-'}"
        )
    _log(
        f"[BRIDGE][ACK] client_id={client_id} message_id={message_id[:8]}… "
        f"success={success} detail={detail or '-'}"
    )
    _add_inbound(
        "ack",
        {"success": success, "detail": detail},
        message_id=message_id,
        session_id=ack_session_id,
        turn_id=ack_turn_id,
        client_id=client_id,
    )
    _notify_status()
    return {"ok": True}


def _report_recv_fields(body, event, payload, message_id):
    client_id = (body.get("client_id") or "").strip()
    conversation_id = (body.get("conversation_id") or "").strip()
    reply_len = 0
    reason = ""
    if isinstance(payload, dict):
        text = payload.get("text") or payload.get("content") or ""
        reply_len = len(str(text).strip())
        reason = (
            payload.get("reason")
            or payload.get("detail")
            or payload.get("error_message")
            or ""
        )
    mid = message_id or "-"
    if mid != "-" and len(mid) > 8:
        mid = f"{mid[:8]}…"
    _log(
        f"[BRIDGE][REPORT][RECV] client_id={client_id} "
        f"conversation_id={conversation_id or '-'} event={event} "
        f"message_id={mid} reply_len={reply_len} reason={reason or '-'}"
    )


def _log_finalized(msg, message_id, event):
    mid = message_id or ""
    if len(mid) > 8:
        mid = f"{mid[:8]}…"
    session_id = (msg.get("session_id") or "").strip()
    turn_id = (msg.get("turn_id") or "").strip()
    if session_id and len(session_id) > 8:
        session_id = f"{session_id[:8]}…"
    if turn_id and len(turn_id) > 8:
        turn_id = f"{turn_id[:8]}…"
    _log(
        f"[BRIDGE][FINALIZED] message_id={mid or '-'} "
        f"turn_id={turn_id or '-'} session_id={session_id or '-'} "
        f"event={event} message_status={msg.get('message_status') or '-'}"
    )


def _handle_report(body):
    client_id = (body.get("client_id") or "").strip()
    event = body.get("event") or "info"
    payload = body.get("payload") or {}
    message_id = (body.get("message_id") or "").strip()
    if event == "identity_change":
        page_instance_id = (
            (body.get("page_instance_id") or payload.get("page_instance_id") or "").strip()
        )
        registry_key = f"{client_id}|{page_instance_id}" if client_id and page_instance_id else (client_id or '')
        with st._state_lock:
            old_entry = dict(st._tampermonkey_pages.get(registry_key) or {})
        old_url = page_url_from(old_entry)
        old_conv = (old_entry.get("conversation_id") or "").strip()
        merge_meta = dict(body)
        if isinstance(payload, dict):
            merge_meta.update(payload)
        _touch_tampermonkey(merge_meta, action="report")
        new_url = page_url_from(merge_meta)
        new_conv = (merge_meta.get("conversation_id") or "").strip()
        reason = (payload.get("reason") or merge_meta.get("reason") or "-").strip()
        _log(
            "[BRIDGE][IDENTITY_CHANGE] "
            f"client_id={client_id or '-'} "
            f"page_instance_id={page_instance_id or '-'} "
            f"old_url={old_url or '-'} new_url={new_url or '-'} "
            f"old_conv={old_conv or '-'} new_conv={new_conv or '-'} "
            f"reason={reason}"
        )
        if old_url and new_url and old_url != new_url:
            _log(
                "[PAGE_SYNC][STALE_URL] "
                f"old_url={old_url} new_url={new_url} "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'}"
            )
        _notify_status()
        return {"ok": True}
    if event == "focus_state":
        merge_meta = dict(body)
        if isinstance(payload, dict):
            merge_meta.update(payload)
        _touch_tampermonkey(merge_meta, action="report")
        entry = _registry_entry_for_client(
            client_id,
            (body.get("page_instance_id") or payload.get("page_instance_id") or "").strip(),
        )
        reason = (payload.get("reason") or "-").strip()
        has_focus = "yes" if entry.get("has_focus") else "no"
        visible = (entry.get("visibility_state") or "-").strip() or "-"
        conversation_id = (entry.get("conversation_id") or "-").strip() or "-"
        url = page_url_from(entry) or page_url_from(body) or "-"
        _log(
            "[TM][FOCUS_STATE] "
            f"client_id={client_id or '-'} "
            f"conversation_id={conversation_id} "
            f"has_focus={has_focus} "
            f"visible={visible} "
            f"url={url} "
            f"reason={reason}"
        )
        _notify_status()
        return {"ok": True}
    _touch_tampermonkey(body, action="report")
    if not client_id:
        _log(f"[BRIDGE][REPORT] 拒绝：缺少 client_id event={event}")
        return {"ok": False, "error": "缺少 client_id"}
    if event == "conversation_snapshot":
        return _handle_conversation_snapshot_report(
            body, client_id, message_id, payload
        )
    if event == "client_log":
        level = payload.get("level") or "info"
        message = (payload.get("message") or "").strip()
        extra = payload.get("extra") or {}
        url = page_url_from(payload) or page_url_from(body) or ""
        log_client_id = body.get("client_id") or payload.get("client_id") or client_id
        if message.startswith("[TM]"):
            extra_text = _format_log_fields(extra)
            if extra_text:
                _log(f"{message} {extra_text} client_id={log_client_id}")
            else:
                _log(f"{message} client_id={log_client_id}")
        else:
            _log(
                f"[TM][CLIENT_LOG][{level}] "
                f"client_id={log_client_id} url={url} message={message} "
                f"extra={extra}"
            )
        return {"ok": True}
    _report_recv_fields(body, event, payload, message_id)
    with st._state_lock:
        msg = _find_outbound_message(message_id)
        if event == "conversation_created" and not msg:
            conv_report = (payload.get("conversation_id") or "").strip()
            if conv_report:
                orphan_session = (
                    (payload.get("local_session_id") or body.get("session_id") or "")
                ).strip()
                turn_extra = (
                    (payload.get("turn_id") or body.get("turn_id") or "")
                ).strip()
                _add_inbound(
                    event,
                    payload,
                    message_id=message_id or "",
                    session_id=orphan_session,
                    turn_id=turn_extra,
                    client_id=client_id,
                )
                mid_log = message_id or "-"
                if isinstance(mid_log, str) and len(mid_log) > 8:
                    mid_log = f"{mid_log[:8]}…"
                _log(
                    f"[BRIDGE][REPORT] event=conversation_created client_id={client_id} "
                    f"conv={conv_report} message_id={mid_log} inbound=orphan_no_outbound"
                )
                _notify_status()
                return {"ok": True}
        if not msg:
            waiting_ids = sorted(st._outbound_waiting.keys())
            control_ids = sorted(st._control_waiting.keys())
            outbound_ids = [
                str(m.get("message_id") or "")
                for m in st._outbound_queue
                if isinstance(m, dict) and m.get("message_id")
            ]
            leased_ids = list(waiting_ids)
            recent_finalized = [
                str(m.get("message_id") or "")
                for m in list(st._outbound_history)[-20:]
                if isinstance(m, dict) and m.get("message_id")
            ]
            _add_inbound(
                "report_unknown",
                {
                    "event": event,
                    "payload": payload,
                    "report_client_id": client_id,
                    "waiting_message_ids": waiting_ids,
                },
                message_id=message_id,
                client_id=client_id,
            )
            waiting_short = [
                (mid[:8] + "…") if mid and len(mid) > 8 else (mid or "-")
                for mid in waiting_ids
            ]
            _log(
                f"[BRIDGE][REPORT_UNKNOWN] event={event} "
                f"message_id={message_id or '-'} "
                f"client_id={client_id or '-'} "
                f"waiting_message_ids={waiting_short}"
            )
            if event == "assistant_reply":
                log_assistant_reply_unknown_full(
                    body,
                    known_outbound_ids=outbound_ids,
                    known_leased_ids=leased_ids,
                    known_control_ids=control_ids,
                    recent_finalized_ids=recent_finalized,
                )
            _notify_status()
            return {"ok": True}
        owner = msg.get("delivered_to")
        if owner != client_id:
            _add_inbound(
                "report_mismatch",
                {
                    "event": event,
                    "payload": payload,
                    "owner_client_id": owner,
                    "report_client_id": client_id,
                },
                message_id=message_id,
                session_id=msg.get("session_id"),
                turn_id=msg.get("turn_id"),
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][REPORT_MISMATCH] message_id={message_id or '-'} "
                f"session_id={msg.get('session_id') or '-'} "
                f"turn_id={msg.get('turn_id') or '-'} "
                f"client_id={client_id} "
                f"conversation_id={msg.get('conversation_id') or '-'} "
                f"owner={owner} reporter={client_id} event={event}"
            )
            _notify_status()
            return {"ok": True}
        if _is_finalized(msg) and event in (
            "send_failed",
            "assistant_reply",
            "assistant_reply_empty",
            "assistant_reply_failed",
            "ack",
        ):
            _add_inbound(
                "report_ignored",
                {
                    "event": event,
                    "payload": payload,
                    "reason": "消息已 finalized",
                    "finalized_at": msg.get("finalized_at"),
                },
                message_id=message_id,
                session_id=msg.get("session_id"),
                turn_id=msg.get("turn_id"),
                client_id=client_id,
            )
            _log(
                f"[BRIDGE][REPORT_IGNORED] message_id={message_id[:8]}… "
                f"event={event} message_status={msg.get('message_status')}"
            )
            _notify_status()
            return {"ok": True}
        inbound_kw = {
            "message_id": message_id,
            "session_id": msg.get("session_id"),
            "turn_id": msg.get("turn_id"),
            "client_id": client_id,
        }
        if message_id in st._control_waiting:
            control_events_finalize = (
                "open_url_success",
                "open_url_failed",
                "close_page_success",
                "close_page_failed",
                "close_page_still_open",
                "control_done",
                "command_failed",
            )
            if event == "conversation_snapshot":
                return _handle_conversation_snapshot_report(
                    body, client_id, message_id, payload
                )
            if event == "close_page_requested":
                _sync_message_status_fields(msg, "requested")
                _add_inbound(event, payload, **inbound_kw)
            elif event in control_events_finalize:
                if (
                    event.endswith("_success")
                    or event in ("close_page_still_open", "control_done")
                ):
                    status = "replied"
                    error_detail = None
                else:
                    status = "failed"
                    error_detail = payload.get("detail") or payload.get("reason")
                _add_inbound(event, payload, **inbound_kw)
                _finalize_control_message(message_id, status, error_detail)
            else:
                _add_inbound(event, payload, **inbound_kw)
            control_command = (msg.get("command") or payload.get("command") or "-").strip()
            _log(
                f"[BRIDGE][REPORT] event={event} command={control_command} "
                f"client_id={client_id} "
                f"message_id={message_id[:8] if message_id else '?'}…"
            )
            _notify_status()
            return {"ok": True}
        if event == "assistant_reply":
            text = (payload.get("text") or payload.get("content") or "").strip()
            if _is_invalid_assistant_reply_text(text):
                _log(
                    "[BRIDGE][ASSISTANT_REPLY][SKIP_INVALID_TEXT] "
                    f"message_id={message_id or '-'} "
                    f"content={text!r}"
                )
                _notify_status()
                return {"ok": False, "error": "invalid_assistant_reply_text"}
            msg["reply_text"] = text
            session_id_log = (msg.get("session_id") or "").strip()
            turn_id_log = (msg.get("turn_id") or "").strip()
            mid_log = message_id or "-"
            if isinstance(mid_log, str) and len(mid_log) > 8:
                mid_log = f"{mid_log[:8]}…"
            _log(
                "[BRIDGE][ASSISTANT_REPLY][RECV] "
                f"message_id={mid_log} "
                f"session_id={session_id_log or '-'} "
                f"turn_id={turn_id_log or '-'} "
                f"client_id={client_id or '-'} "
                f"text_len={len(text)}"
            )
            log_assistant_reply_recv_full(body, msg)
            try:
                _job_scheduler.on_assistant_reply(
                    text,
                    outbound_message_id=message_id,
                    auto_send_hook=lambda jid: _job_scheduler.send_job_to_cursor(
                        jid, enqueue_cursor_task
                    ),
                )
            except Exception as exc:
                _log(
                    "[JOB][ASSISTANT_REPLY_HOOK_FAILED] "
                    f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"
                )
            _finalize_message(msg, "replied")
            page_inst = (body.get("page_instance_id") or "").strip()
            page_key = _page_registry_key(client_id, page_inst) or client_id
            with st._state_lock:
                client_entry = st._tampermonkey_pages.get(registry_key)
            if isinstance(client_entry, dict):
                now = _now()
                client_entry["is_responding"] = False
                client_entry["response_state"] = "idle"
                client_entry["response_state_reason"] = "assistant_reply_received"
                client_entry["response_state_at"] = int(now * 1000)
                client_entry["can_accept_input"] = True
                client_entry["last_response_state_seen_at"] = now
            _log(
                "[BRIDGE][ASSISTANT_REPLY][FINALIZED] "
                f"message_id={mid_log} status=replied reply_len={len(text)}"
            )
            _log_finalized(msg, message_id, event)
            _add_inbound(event, payload, **inbound_kw)
            _archive_waiting(message_id)
            _safe_notify_external_request_from_bridge(message_id, event, payload, msg)
        elif event == "send_failed":
            if not _is_finalized(msg):
                _finalize_message(msg, "failed")
                msg["error_detail"] = payload.get("detail") or payload.get("reason")
                _log_finalized(msg, message_id, event)
                _add_inbound(event, payload, **inbound_kw)
                if message_id in st._outbound_waiting:
                    _archive_waiting(message_id)
                _safe_notify_external_request_from_bridge(message_id, event, payload, msg)
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        elif event in ("assistant_reply_empty", "assistant_reply_failed"):
            if not _is_finalized(msg):
                fail_detail = (
                    payload.get("reason")
                    or payload.get("detail")
                    or payload.get("error_message")
                    or ""
                )
                try:
                    _job_scheduler.on_assistant_reply_failed(
                        fail_detail or event,
                        outbound_message_id=message_id,
                    )
                except Exception as exc:
                    _log(
                        "[JOB][ASSISTANT_REPLY_FAILED_HOOK] "
                        f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"
                    )
                _finalize_message(msg, "failed")
                msg["error_detail"] = fail_detail
                _log_finalized(msg, message_id, event)
                _add_inbound(event, payload, **inbound_kw)
                if message_id in st._outbound_waiting:
                    _archive_waiting(message_id)
                _safe_notify_external_request_from_bridge(message_id, event, payload, msg)
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        elif event == "conversation_created":
            conv_id = (payload.get("conversation_id") or body.get("conversation_id") or "").strip()
            url = page_url_from(payload) or page_url_from(body)
            report_bind = (
                payload.get("bind_request_id") or body.get("bind_request_id") or ""
            ).strip()
            _log(
                f"[BRIDGE][REPORT] event=conversation_created client_id={client_id} "
                f"conv={conv_id or '-'} message_id={message_id[:8] if message_id else '?'}…"
            )
            _log(
                f"[BIND][CONVERSATION_CREATED] message_id={message_id[:8] if message_id else '?'}… "
                f"session_id={(msg.get('session_id') or '-')[:8]} "
                f"bind_request_id={report_bind or '-'} "
                f"client_id={client_id} "
                f"page_instance_id={(body.get('page_instance_id') or '-')[:16]} "
                f"conversation_id={conv_id or '-'} url={url or '-'}"
            )
            msg["conversation_id"] = conv_id or msg.get("conversation_id")
            if url:
                msg["url"] = url
            _add_inbound(event, payload, **inbound_kw)
        elif event in (
            "open_url_success",
            "open_url_failed",
            "close_page_success",
            "close_page_failed",
            "close_page_requested",
            "close_page_still_open",
            "command_failed",
        ):
            if not _is_finalized(msg):
                if event.endswith("_success"):
                    _finalize_message(msg, "replied")
                else:
                    _finalize_message(msg, "failed")
                    msg["error_detail"] = payload.get("detail") or payload.get("reason")
                _add_inbound(event, payload, **inbound_kw)
                if message_id in st._outbound_waiting:
                    _archive_waiting(message_id)
            else:
                _add_inbound(
                    "report_ignored",
                    {"event": event, "payload": payload},
                    **inbound_kw,
                )
        else:
            _add_inbound(event, payload, **inbound_kw)
    _notify_status()
    return {"ok": True}


def _handle_assistant_reply(body):
    """油猴 action=assistant_reply：直接上报 assistant 正文到 GUI。"""
    client_id = read_bridge_client_id(body)
    page_instance_id = read_bridge_page_instance_id(body)
    message_id = str(body.get("message_id") or "").strip()
    content = str(
        body.get("content")
        or body.get("text")
        or body.get("assistant_text")
        or ""
    ).strip()
    if not content:
        return {"ok": False, "error": "empty_assistant_reply"}
    if _is_invalid_assistant_reply_text(content):
        _log(
            "[BRIDGE][ASSISTANT_REPLY][SKIP_INVALID_TEXT] "
            f"message_id={message_id or '-'} "
            f"content={content!r}"
        )
        return {"ok": False, "error": "invalid_assistant_reply_text"}
    if not client_id:
        _log("[BRIDGE][ASSISTANT_REPLY] 拒绝：缺少 client_id")
        return {"ok": False, "error": "缺少 client_id"}

    _touch_tampermonkey(body, action="assistant_reply")

    session_id = str(body.get("session_id") or "").strip()
    turn_id = str(body.get("turn_id") or "").strip()
    payload = {
        "text": content,
        "content": content,
        "assistant_text": content,
        "session_id": session_id,
        "turn_id": turn_id,
        "client_id": client_id,
        "page_instance_id": page_instance_id,
        "conversation_id": str(body.get("conversation_id") or "").strip(),
        "url": page_url_from(body),
        "reason": str(body.get("reason") or "").strip(),
        "response_state": str(body.get("response_state") or "").strip(),
        "ok": True,
    }
    inbound_kw = {
        "message_id": message_id,
        "session_id": session_id,
        "turn_id": turn_id,
        "client_id": client_id,
    }

    with st._state_lock:
        msg = _find_outbound_message(message_id) if message_id else None

    mid_log = message_id or "-"
    if isinstance(mid_log, str) and len(mid_log) > 8:
        mid_log = f"{mid_log[:8]}…"
    session_id_log = session_id or (msg.get("session_id") if msg else "") or ""
    turn_id_log = turn_id or (msg.get("turn_id") if msg else "") or ""
    _log(
        "[BRIDGE][ASSISTANT_REPLY][RECV] "
        f"message_id={mid_log} "
        f"session_id={session_id_log or '-'} "
        f"turn_id={turn_id_log or '-'} "
        f"client_id={client_id or '-'} "
        f"content_len={len(content)}"
    )

    if msg:
        msg["reply_text"] = content
        if not session_id:
            session_id = str(msg.get("session_id") or "").strip()
            inbound_kw["session_id"] = session_id
            payload["session_id"] = session_id
        if not turn_id:
            turn_id = str(msg.get("turn_id") or "").strip()
            inbound_kw["turn_id"] = turn_id
            payload["turn_id"] = turn_id
        log_assistant_reply_recv_full(body, msg)
        try:
            _job_scheduler.on_assistant_reply(
                content,
                outbound_message_id=message_id,
                auto_send_hook=lambda jid: _job_scheduler.send_job_to_cursor(
                    jid, enqueue_cursor_task
                ),
            )
        except Exception as exc:
            _log(
                "[JOB][ASSISTANT_REPLY_HOOK_FAILED] "
                f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"
            )
        _finalize_message(msg, "replied")
        registry_key = f"{client_id}|{page_instance_id}" if client_id and page_instance_id else (client_id or '')
        with st._state_lock:
            client_entry = st._tampermonkey_pages.get(registry_key)
        if isinstance(client_entry, dict):
            now = _now()
            client_entry["is_responding"] = False
            client_entry["response_state"] = "idle"
            client_entry["response_state_reason"] = "assistant_reply_received"
            client_entry["response_state_at"] = int(now * 1000)
            client_entry["can_accept_input"] = True
            client_entry["last_response_state_seen_at"] = now
        _log(
            "[BRIDGE][ASSISTANT_REPLY][FINALIZED] "
            f"message_id={mid_log} status=replied reply_len={len(content)}"
        )
        _log_finalized(msg, message_id, "assistant_reply")
        _add_inbound("assistant_reply", payload, **inbound_kw)
        _archive_waiting(message_id)
        _safe_notify_external_request_from_bridge(
            message_id, "assistant_reply", payload, msg
        )
    else:
        if message_id:
            waiting_ids = sorted(st._outbound_waiting.keys())
            control_ids = sorted(st._control_waiting.keys())
            outbound_ids = [
                str(m.get("message_id") or "")
                for m in st._outbound_queue
                if isinstance(m, dict) and m.get("message_id")
            ]
            leased_ids = list(waiting_ids)
            recent_finalized = [
                str(m.get("message_id") or "")
                for m in list(st._outbound_history)[-20:]
                if isinstance(m, dict) and m.get("message_id")
            ]
            log_assistant_reply_unknown_full(
                body,
                known_outbound_ids=outbound_ids,
                known_leased_ids=leased_ids,
                known_control_ids=control_ids,
                recent_finalized_ids=recent_finalized,
            )
        _add_inbound("assistant_reply", payload, **inbound_kw)

    _notify_status()
    return {"ok": True, "handled": True}
