"""Tampermonkey client/page registry."""
from __future__ import annotations

import traceback
from urllib.parse import urlparse

from app.utils.page_status import (
    page_registry_key as _psk,
    evaluate_page_capability,
    explain_page_decision,
    is_page_online,
    is_page_url_syncable,
    page_url_from,
)
from app.utils.tm_activity import classify_tm_client_activity, compute_tm_activity_metrics
from app.server import state as st
from app.server.runtime_state import (
    _client_online,
    _is_bridge_debug_enabled,
    _log,
    _normalize_chatgpt_url_for_compare,
    _now,
    _safe_int_field,
    _tm_seen_float,
    is_debug_mode,
)

def _is_ignored_page(meta):
    page_type = (meta.get("page_type") or "").strip()
    page_url = page_url_from(meta) if isinstance(meta, dict) else ""
    if page_type == "ignored":
        return True
    if "/backend-api/" in page_url or "/sentinel/" in page_url or "frame.html" in page_url:
        return True
    if meta.get("is_top_frame") is False:
        return True
    return False


def _page_registry_key(client_id, page_instance_id):
    client_id = (client_id or "").strip()
    page_instance_id = (page_instance_id or "").strip()
    if not client_id:
        return ""
    if not page_instance_id:
        return ""
    return f"{client_id}|{page_instance_id}"


def _tm_page_display_key(client_id, page_instance_id):
    key = _psk({'client_id': client_id, 'page_instance_id': page_instance_id})
    if key:
        return key
    return _page_registry_key(client_id, page_instance_id)


def _allocate_tm_page_no(client_id, page_instance_id):
    key = _tm_page_display_key(client_id, page_instance_id)
    if not key:
        return 0
    now = _now()
    with st._state_lock:
        display_ids = st._tm_page_no_by_key
        if key in display_ids:
            display_ids[key] = int(display_ids[key])
            st._tm_page_no_updated_at[key] = now
            return display_ids[key]
        next_id = 1
        if display_ids:
            next_id = max(int(v) for v in display_ids.values()) + 1
        display_ids[key] = next_id
        st._tm_page_no_updated_at[key] = now
    _log(
        "[TM_PAGE_DISPLAY_ID][ASSIGN] "
        f"page_no={next_id} "
        f"client_id={client_id or '-'} "
        f"page_instance_id={page_instance_id or '-'} "
        f"key={key}"
    )
    return next_id


def _ensure_tm_page_no(client_id, page_instance_id):
    return _allocate_tm_page_no(client_id, page_instance_id)


def _bridge_runtime_patch_for_body(body):
    if not isinstance(body, dict):
        return {}
    client_id = (body.get("client_id") or "").strip()
    page_instance_id = (body.get("page_instance_id") or "").strip()
    page_no = _ensure_tm_page_no(client_id, page_instance_id)
    patch = {
        "page_registered": bool(client_id),
        "client_id": client_id,
        "page_instance_id": page_instance_id,
    }
    if page_no:
        patch["page_no"] = page_no
    try:
        from app.server import upload_files as uf

        patch.update(uf.upload_files_patch_for_poll(body))
    except Exception as error:
        _log(
            "[UPLOAD_FILES][POLL_PATCH][FAILED] "
            f"client_id={client_id or '-'} "
            f"error_type={type(error).__name__} error={error}\n"
            f"{traceback.format_exc()}"
        )
    return patch


def _poll_response_needs_runtime_patch(result, body, *, identity_changed=False):
    if not isinstance(result, dict):
        return False
    if result.get("has_message"):
        return True
    if st._debug_mode or bool(body.get("debug_status")):
        return True
    if identity_changed:
        return True
    client_id = (body.get("client_id") or "").strip()
    page_instance_id = (body.get("page_instance_id") or "").strip()
    if client_id and page_instance_id:
        key = _page_registry_key(client_id, page_instance_id)
        with st._state_lock:
            known = key in st._tampermonkey_pages
        if not known:
            return True
    return False


def _extract_page_no_for_poll(result, body):
    """从 poll 结果体或页面注册状态解析 page_no。"""
    if isinstance(result, dict):
        raw = result.get("page_no")
        if raw not in (None, "", 0):
            try:
                return int(raw)
            except (TypeError, ValueError) as error:
                text = str(raw).strip()
                if text and text != "-":
                    _log(
                        "[TM_PAGE][PAGE_NO_NON_NUMERIC] "
                        f"source=result raw={raw!r} "
                        f"error_type={type(error).__name__} error={error}"
                    )
                    return text
    if not isinstance(body, dict):
        return None
    client_id = (body.get("client_id") or "").strip()
    page_instance_id = (body.get("page_instance_id") or "").strip()
    page_key = _page_registry_key(client_id, page_instance_id)
    if page_key:
        with st._state_lock:
            entry = st._tampermonkey_pages.get(page_key) or {}
        raw = entry.get("page_no")
        if raw not in (None, "", 0):
            try:
                return int(raw)
            except (TypeError, ValueError) as error:
                text = str(raw).strip()
                if text and text != "-":
                    _log(
                        "[TM_PAGE][PAGE_NO_NON_NUMERIC] "
                        f"source=body_registry raw={raw!r} "
                        f"error_type={type(error).__name__} error={error}"
                    )
                    return text
    patch = _bridge_runtime_patch_for_body(body)
    return patch.get("page_no") or None


def _ensure_poll_top_level_page_no(result, body):
    """保证油猴 poll 响应 JSON 顶层含有 page_no / page_display_id。"""
    if not isinstance(result, dict):
        return result

    page_no = _extract_page_no_for_poll(result, body)
    if page_no:
        result["page_no"] = page_no
        result["page_display_id"] = str(page_no)

    if isinstance(body, dict):
        client_id = (body.get("client_id") or "").strip()
        page_instance_id = (body.get("page_instance_id") or "").strip()
        if client_id and page_instance_id:
            page_key = _page_registry_key(client_id, page_instance_id)
            with st._state_lock:
                entry = st._tampermonkey_pages.get(page_key) or {}
            promotion = entry.get("page_channel_promotion")
            if isinstance(promotion, dict) and promotion.get("conversation_id"):
                result["page_channel_promotion"] = dict(promotion)

    client_id = (body.get("client_id") or "").strip() if isinstance(body, dict) else "-"
    page_instance_id = (
        (body.get("page_instance_id") or "").strip() if isinstance(body, dict) else "-"
    )

    _log(
        "[TM_PAGE_DISPLAY_ID][POLL_RESPONSE] "
        f"client_id={client_id or '-'} "
        f"page_instance_id={page_instance_id or '-'} "
        f"page_no={result.get('page_no') or '-'} "
        f"page_display_id={result.get('page_display_id') or '-'}"
    )

    return result


def _apply_bridge_runtime_patch(result, body, *, action="poll", identity_changed=False):
    if not isinstance(result, dict):
        return result
    if action in ("poll", "poll_idle", "hello", "register"):
        page_no = _extract_page_no_for_poll(result, body)
        if page_no:
            result["page_no"] = page_no
            result["page_display_id"] = str(page_no)
    if action in ("poll", "poll_idle") and not result.get("has_message"):
        if not _poll_response_needs_runtime_patch(
            result, body, identity_changed=identity_changed
        ):
            return result
    runtime_patch = _bridge_runtime_patch_for_body(body)
    for key, value in runtime_patch.items():
        if value is not None and value != "":
            result[key] = value
    if st._debug_mode or _is_bridge_debug_enabled():
        _log(
            "[BRIDGE_RUNTIME_PATCH] "
            f"action={action} "
            f"client_id={runtime_patch.get('client_id') or '-'} "
            f"page_instance_id={runtime_patch.get('page_instance_id') or '-'} "
            f"page_no={runtime_patch.get('page_no') or '-'} "
            f"page_registered={runtime_patch.get('page_registered')}"
        )
    return result


def _tm_registry_counts():
    now = _now()
    with st._state_lock:
        entries = [dict(info) for info in st._tampermonkey_pages.values()]
    raw_clients_count = len(entries)
    online_clients_count = 0
    syncable_count = 0
    conversation_syncable_count = 0
    for entry in entries:
        if is_page_online(entry, now=now):
            online_clients_count += 1
        if is_page_url_syncable(entry, now=now):
            syncable_count += 1
        decision = explain_page_decision(entry, action="sync")
        if decision.get("conversation_syncable"):
            conversation_syncable_count += 1
    return {
        "raw_clients_count": raw_clients_count,
        "online_clients_count": online_clients_count,
        "syncable_count": syncable_count,
        "conversation_syncable_count": conversation_syncable_count,
    }


def _iter_page_registry_entries():
    """页面注册表条目（st._tampermonkey_pages）。"""
    with st._state_lock:
        return [dict(info) for info in st._tampermonkey_pages.values()]


def _registry_entry_for_client(client_id, page_instance_id="", *, strict_instance=False):
    """按 client_id / page_instance_id 取最新页面条目（控制命令校验用）。"""
    client_id = (client_id or "").strip()
    page_instance_id = (page_instance_id or "").strip()
    if strict_instance and not page_instance_id:
        return {}
    with st._state_lock:
        if st._tampermonkey_pages:
            if page_instance_id:
                key = _page_registry_key(client_id, page_instance_id)
                entry = st._tampermonkey_pages.get(key)
                if entry:
                    return dict(entry)
            best = None
            best_seen = 0.0
            for info in st._tampermonkey_pages.values():
                if (info.get("client_id") or "").strip() != client_id:
                    continue
                seen = _tm_seen_float(
                    info,
                    field="last_seen",
                    context="_registry_entry_for_client",
                )
                if seen >= best_seen:
                    best_seen = seen
                    best = info
            if best:
                return dict(best)
        return {}



def _pathname_from_url(url: str) -> str:
    text = (url or "").strip()
    if not text:
        return ""
    try:
        return (urlparse(text).path or "").strip()
    except ValueError as error:
        _log(
            f"[TM][URL_PATHNAME_PARSE_FAILED] url={text!r} "
            f"error_type={type(error).__name__} error={error}"
        )
        return ""


def _overwrite_page_identity_fields(entry, meta):
    """同一 page_instance 的 URL/对话字段允许被后续 poll/report 覆盖。"""
    page_url_val = page_url_from(meta) if isinstance(meta, dict) else ""
    if page_url_val:
        entry["url"] = page_url_val
        entry["pathname"] = _pathname_from_url(page_url_val)
    if "page_title" in meta:
        entry["page_title"] = (meta.get("page_title") or "").strip()
    if "conversation_id" in meta:
        incoming_conv = (meta.get("conversation_id") or "").strip()
        prev_conv = (entry.get("conversation_id") or "").strip()
        incoming_type = (meta.get("page_type") or entry.get("page_type") or "").strip()
        if (
            prev_conv
            and not incoming_conv
            and incoming_type == "home"
        ):
            _log(
                "[TM][STALE_HOME_REGISTRY_UPDATE] "
                f"client_id={(entry.get('client_id') or '-')} "
                f"page_instance_id={(entry.get('page_instance_id') or '-')} "
                f"prev_conversation_id={prev_conv} "
                f"incoming_page_type={incoming_type or '-'} "
                f"reason=home_report_empty_conversation_id"
            )
        entry["conversation_id"] = incoming_conv
    if "page_type" in meta:
        entry["page_type"] = (meta.get("page_type") or "").strip()


def get_tm_online_summary(
    bound_client_id=None,
    bound_conversation_id=None,
    *,
    bound_page_instance_id=None,
    snapshot_clients=None,
):
    """统计油猴页面在线数量（以 st._tampermonkey_pages 为主，client 表仅兼容）。"""
    bound_client_id = (bound_client_id or "").strip() or None
    bound_page_instance_id = (bound_page_instance_id or "").strip() or None
    bound_conversation_id = (bound_conversation_id or "").strip() or None
    if bound_conversation_id in ("", "-"):
        bound_conversation_id = None

    if snapshot_clients is not None:
        all_entries = [
            ((item.get("client_id") or "").strip(), item)
            for item in snapshot_clients
            if (item.get("client_id") or "").strip()
        ]
    else:
        with st._state_lock:
            all_entries = [
                ((info.get("client_id") or "").strip(), info)
                for info in st._tampermonkey_pages.values()
                if (info.get("client_id") or "").strip()
            ]

    total_clients = len(all_entries)
    online_clients = 0
    offline_clients = 0
    online_conversation_clients = 0
    online_home_clients = 0
    active_client_id = None
    active_conversation_id = None
    active_last_seen = 0.0
    active_conv_last_seen = 0.0
    exact_bound_info = None
    conversation_fallback_info = None
    bound_registry_conv_id = None

    for client_id, info in all_entries:
        online = is_page_online(info)
        if online:
            online_clients += 1
        else:
            offline_clients += 1

        page_type = (info.get("page_type") or "").strip()
        conversation_id = (info.get("conversation_id") or "").strip()
        if conversation_id == "-":
            conversation_id = ""

        if bound_client_id and client_id == bound_client_id:
            page_instance_id = (info.get("page_instance_id") or "").strip()
            if bound_page_instance_id:
                if page_instance_id == bound_page_instance_id:
                    exact_bound_info = info
            else:
                exact_bound_info = info
            if conversation_id:
                bound_registry_conv_id = conversation_id

        if (
            bound_conversation_id
            and conversation_id == bound_conversation_id
            and page_type == "conversation"
            and online
        ):
            current_seen = _tm_seen_float(
                info,
                field="last_seen",
                context="get_tm_online_summary.conversation_fallback",
            )
            old_seen = (
                _tm_seen_float(
                    conversation_fallback_info,
                    field="last_seen",
                    context="get_tm_online_summary.conversation_fallback_old",
                )
                if conversation_fallback_info
                else 0.0
            )
            if conversation_fallback_info is None or current_seen >= old_seen:
                conversation_fallback_info = info

        if _is_ignored_page(info):
            continue

        if online:
            if page_type == "conversation":
                online_conversation_clients += 1
            elif page_type == "home":
                online_home_clients += 1
            seen_ts = _tm_seen_float(
                info,
                field="last_seen",
                context="get_tm_online_summary",
            )
            if seen_ts >= active_last_seen:
                active_last_seen = seen_ts
                active_client_id = client_id
            if page_type == "conversation" and conversation_id:
                if seen_ts >= active_conv_last_seen:
                    active_conv_last_seen = seen_ts
                    active_conversation_id = conversation_id

    if bound_conversation_id is None and bound_registry_conv_id:
        bound_conversation_id = bound_registry_conv_id

    exact_bound_online = bool(
        isinstance(exact_bound_info, dict) and is_page_online(exact_bound_info)
    )
    fallback_online = bool(
        isinstance(conversation_fallback_info, dict)
        and is_page_online(conversation_fallback_info)
    )
    bound_online = exact_bound_online
    bound_effective_online = exact_bound_online or fallback_online
    bound_actionable = bound_effective_online
    bound_page_type = ""
    bound_match_mode = "offline"
    binding_match_mode = "offline"
    resolved_bound_client_id = bound_client_id
    same_conversation_online = fallback_online
    same_conversation_client_id = None
    same_conversation_page_instance_id = None

    if exact_bound_online:
        bound_page_type = (exact_bound_info.get("page_type") or "").strip()
        resolved_bound_client_id = (
            (exact_bound_info.get("client_id") or bound_client_id or "").strip()
            or bound_client_id
        )
        bound_match_mode = "exact_instance"
        binding_match_mode = "exact_instance"
    elif fallback_online:
        bound_page_type = (conversation_fallback_info.get("page_type") or "").strip()
        resolved_bound_client_id = (
            (conversation_fallback_info.get("client_id") or "").strip()
            or bound_client_id
        )
        bound_match_mode = "conversation_fallback"
        binding_match_mode = "conversation_fallback"
        same_conversation_client_id = resolved_bound_client_id
        same_conversation_page_instance_id = (
            conversation_fallback_info.get("page_instance_id") or ""
        ).strip() or None

    bound_conversation_syncable = bool(
        bound_effective_online
        and bound_page_type == "conversation"
        and bound_conversation_id
    )

    return {
        "total_clients": total_clients,
        "online_clients": online_clients,
        "offline_clients": offline_clients,
        "online_conversation_clients": online_conversation_clients,
        "online_home_clients": online_home_clients,
        "active": {
            "client_id": (active_client_id or "").strip(),
            "conversation_id": (active_conversation_id or "").strip(),
        },
        "exact_bound_online": exact_bound_online,
        "bound_online": bound_online,
        "bound_effective_online": bound_effective_online,
        "bound_actionable": bound_actionable,
        "bound_page_type": bound_page_type,
        "bound_conversation_syncable": bound_conversation_syncable,
        "bound_dialog_ready": bound_conversation_syncable,
        "bound_match_mode": bound_match_mode,
        "binding_match_mode": binding_match_mode,
        "same_conversation_online": same_conversation_online,
        "same_conversation_client_id": same_conversation_client_id,
        "same_conversation_page_instance_id": same_conversation_page_instance_id,
        "online_timeout_sec": st.ONLINE_TIMEOUT_SEC,
    }


def _snapshot_clients():
    items = []
    now = _now()
    cleanup_tampermonkey_pages_locked()
    source_entries = list(st._tampermonkey_pages.items())
    for _key, info in sorted(source_entries, key=lambda row: row[1].get("client_id") or ""):
        client_id = (info.get("client_id") or "").strip()
        if not client_id:
            continue
        last_seen = info.get("last_seen")
        activity_state = classify_tm_client_activity(info, now=now)
        _, seen_age, poll_age, _ = compute_tm_activity_metrics(info, now=now)
        cap_send = evaluate_page_capability(info, action="send", now=now)
        page_no = info.get("page_no") or _ensure_tm_page_no(
            info.get("client_id") or "",
            info.get("page_instance_id") or "",
        )
        page_no = str(page_no or "").strip()
        row = {
            "client_id": client_id or (info.get("client_id") or ""),
            "page_instance_id": info.get("page_instance_id") or "",
            "page_no": page_no,
            "conversation_id": info.get("conversation_id") or "",
            "url": cap_send.url or page_url_from(info) or "",
            "page_type": info.get("page_type") or "",
            "last_seen": info.get("last_seen"),
            "last_heartbeat_at": info.get("last_heartbeat_at"),
            "last_poll_at": info.get("last_poll_at"),
            "last_report_at": info.get("last_report_at"),
            "online": cap_send.online,
            "page_liveness": cap_send.page_liveness or "offline",
            "response_state": cap_send.response_state or "unknown",
            "can_accept_input": bool(cap_send.can_accept_input),
            "visibility_state": info.get("visibility_state") or "",
            "has_focus": bool(info.get("has_focus")),
            "last_focus_at": info.get("last_focus_at"),
            "browser_hidden": info.get("browser_hidden"),
            "browser_visibility_state": info.get("browser_visibility_state") or "",
            "browser_has_focus": info.get("browser_has_focus"),
            "browser_timer_drift_ms": info.get("browser_timer_drift_ms"),
            "browser_probably_throttled": bool(info.get("browser_probably_throttled")),
        }
        if is_debug_mode():
            row["debug_detail"] = {
                "capability": evaluate_page_capability(info, action="send", now=now).to_dict(),
            }
            row["debug_detail"].update({
                "script_version": info.get("script_version") or "",
                "is_top_frame": bool(info.get("is_top_frame", True)),
                "visibility_state": info.get("visibility_state") or "",
                "has_focus": bool(info.get("has_focus")),
                "last_focus_at": info.get("last_focus_at"),
                "pathname": info.get("pathname") or "",
                "last_heartbeat_at": info.get("last_heartbeat_at"),
                "last_poll_at": info.get("last_poll_at"),
                "last_claim_at": info.get("last_claim_at"),
                "last_report_at": info.get("last_report_at"),
                "activity_state": activity_state,
                "seen_age_seconds": round(seen_age, 3),
                "poll_age_seconds": round(poll_age, 3),
                "bind_request_id": info.get("bind_request_id") or "",
                "response_state_reason": info.get("response_state_reason") or "",
                "response_state_at": info.get("response_state_at"),
                "last_response_state_seen_at": info.get("last_response_state_seen_at"),
                "response_started_at": info.get("response_started_at"),
                "response_last_text_changed_at": info.get(
                    "response_last_text_changed_at"
                ),
                "upload_bridge_supported": bool(info.get("upload_bridge_supported")),
                "upload_bridge_version": _safe_int_field(
                    info.get("upload_bridge_version"),
                    0,
                    context="_snapshot_clients",
                    field="upload_bridge_version",
                ),
            })
        items.append(row)
    return items


def _maybe_log_tm_activity_classify(client_id, entry, meta):
    """在活跃度分类变化时写 [TM_ACTIVITY][CLASSIFY]（调试模式下每次 touch 都写）。"""
    now = _now()
    state = classify_tm_client_activity(entry, now=now)
    _, seen_age, poll_age, _ = compute_tm_activity_metrics(entry, now=now)
    visible = (entry.get("visibility_state") or meta.get("visibility_state") or "-").strip()
    focus_b = bool(entry.get("has_focus"))
    token = (
        state,
        int(round(seen_age * 10)) / 10.0,
        int(round(poll_age * 10)) / 10.0,
    )
    prev = st._last_tm_activity_classify_log.get(client_id)
    if not st._debug_mode:
        return
    if prev == token:
        return
    st._last_tm_activity_classify_log[client_id] = token
    page_type = (entry.get("page_type") or meta.get("page_type") or "-").strip()
    conversation_id = (entry.get("conversation_id") or meta.get("conversation_id") or "-").strip()
    _log(
        f"[TM_ACTIVITY][CLASSIFY] client_id={client_id} "
        f"page_type={page_type} conversation_id={conversation_id} "
        f"visible={visible} focus={focus_b} "
        f"seen_age={seen_age:.3f} poll_age={poll_age:.3f} state={state}"
    )


def _meta_has_focus(meta):
    if not isinstance(meta, dict):
        return False
    for key in ("has_focus",):
        value = meta.get(key)
        if isinstance(value, bool):
            if value:
                return True
        elif isinstance(value, str):
            if value.strip().lower() in ("yes", "true", "1", "focused", "focus"):
                return True
        elif value:
            return True
    return False


def _normalized_last_focused_page(entry):
    if not isinstance(entry, dict):
        return None
    client_id = (entry.get("client_id") or "").strip()
    if not client_id:
        return None
    page_url = page_url_from(entry)
    if "chatgpt.com" not in page_url:
        return None
    page_type = (entry.get("page_type") or "").strip()
    if page_type not in ("conversation", "home", ""):
        return None
    return {
        "client_id": client_id,
        "page_instance_id": (entry.get("page_instance_id") or "").strip(),
        "url": page_url,
        "page_title": (entry.get("page_title") or "").strip(),
        "page_type": page_type,
        "conversation_id": (entry.get("conversation_id") or "").strip(),
        "visibility_state": (entry.get("visibility_state") or "").strip(),
        "has_focus": bool(entry.get("has_focus")),
        "last_focus_at": entry.get("last_focus_at"),
        "online": _client_online(entry.get("last_seen")),
        "is_responding": bool(entry.get("is_responding")),
        "response_state": entry.get("response_state") or "unknown",
        "can_accept_input": bool(entry.get("can_accept_input", True)),
    }


def _update_last_focused_tm_page(entry):
    page = _normalized_last_focused_page(entry)
    if not page:
        return
    now = _now()
    st._last_focused_tm_page = page
    st._last_focused_tm_page_at = now
    log_key = "|".join([
        page.get("client_id") or "-",
        page.get("conversation_id") or "-",
        page.get("url") or "-",
    ])
    if log_key == st._last_focused_update_log_key:
        return
    st._last_focused_update_log_key = log_key
    _log(
        "[TM][LAST_FOCUSED_UPDATE] "
        f"client_id={page.get('client_id') or '-'} "
        f"conversation_id={page.get('conversation_id') or '-'} "
        f"url={page.get('url') or '-'}"
    )


def _touch_tampermonkey(meta, action="poll"):
    from app.utils.legacy_cleanup import reject_legacy_fields

    if isinstance(meta, dict):
        legacy_reject = reject_legacy_fields(
            meta, context=f"_touch_tampermonkey:{action}"
        )
        if legacy_reject:
            body, _status = legacy_reject
            raise ValueError(body.get("error") or "legacy_fields_not_allowed")
    now = _now()
    client_id = (meta.get("client_id") or "").strip()
    if not client_id:
        return
    page_instance_id = (meta.get("page_instance_id") or "").strip()
    page_url = page_url_from(meta)
    page_type = (meta.get("page_type") or "").strip()
    conversation_id = (meta.get("conversation_id") or "").strip()
    ignored = _is_ignored_page(meta)
    if page_instance_id and page_instance_id not in st._known_page_instances:
        st._known_page_instances.add(page_instance_id)
        hello_bind = (meta.get("bind_request_id") or "").strip()
        _log(
            f"[TM][HELLO] client_id={client_id} page_type={page_type or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"page_instance_id={page_instance_id} url={page_url or '-'}"
        )
        _log(
            f"[TM][IDENTITY] client_id={client_id} "
            f"page_instance_id={page_instance_id} page_type={page_type or '-'} "
            f"bind_request_id={hello_bind or '-'}"
        )
    page_key = _page_registry_key(client_id, page_instance_id)
    entry = st._tampermonkey_pages.setdefault(
        page_key,
        {
            "client_id": client_id,
            "page_instance_id": "",
            "script_version": "",
            "url": "",
            "page_title": "",
            "page_type": "",
            "conversation_id": "",
            "is_top_frame": True,
            "visibility_state": "",
            "has_focus": False,
            "last_focus_at": None,
            "pathname": "",
            "last_seen": None,
            "last_heartbeat_at": None,
            "last_poll_at": None,
            "last_claim_at": None,
            "last_report_at": None,
            "online": False,
            "bind_request_id": "",
            "is_responding": False,
            "response_state": "unknown",
            "response_state_reason": "",
            "response_state_at": None,
            "can_accept_input": True,
            "last_response_state_seen_at": None,
            "response_started_at": None,
            "response_last_text_changed_at": None,
            "upload_bridge_supported": False,
            "upload_bridge_version": 0,
            "last_dom_mutation_at": 0,
            "last_reply_watch_at": 0,
            "pending_reply_active": False,
            "pending_reply_started_at": 0,
            "pending_reply_text_length": 0,
        },
    )
    entry["client_id"] = client_id
    bind_request_id = (meta.get("bind_request_id") or "").strip()
    if bind_request_id:
        entry["bind_request_id"] = bind_request_id
    if page_instance_id:
        entry["page_instance_id"] = page_instance_id
    if action in ("hello", "register"):
        entry["script_version"] = (
            meta.get("script_version") or entry.get("script_version") or ""
        ).strip()
        if "upload_bridge_supported" in meta:
            entry["upload_bridge_supported"] = bool(meta.get("upload_bridge_supported"))
    if action in ("hello", "register") and "upload_bridge_version" in meta:
        raw_upload_bridge_version = meta.get("upload_bridge_version")
        try:
            entry["upload_bridge_version"] = int(raw_upload_bridge_version or 0)
        except (TypeError, ValueError) as error:
            old_value = entry.get("upload_bridge_version")
            _log(
                "[TM][UPLOAD_BRIDGE_VERSION_INVALID] "
                f"client_id={client_id or '-'} "
                f"page_instance_id={page_instance_id or '-'} "
                f"raw={raw_upload_bridge_version!r} "
                f"old={old_value!r} "
                f"error_type={type(error).__name__} "
                f"error={error}"
            )
            try:
                entry["upload_bridge_version"] = int(old_value or 0)
            except (TypeError, ValueError) as old_error:
                _log(
                    "[TM][UPLOAD_BRIDGE_VERSION_OLD_INVALID] "
                    f"client_id={client_id or '-'} "
                    f"page_instance_id={page_instance_id or '-'} "
                    f"old={old_value!r} "
                    f"error_type={type(old_error).__name__} "
                    f"error={old_error}"
                )
                entry["upload_bridge_version"] = 0
    entry["page_title"] = (meta.get("page_title") or entry.get("page_title") or "").strip()
    _overwrite_page_identity_fields(entry, meta)
    if "page_type" not in meta:
        entry["page_type"] = page_type or entry.get("page_type") or ""
    if "is_top_frame" in meta:
        entry["is_top_frame"] = bool(meta.get("is_top_frame"))
    if "visibility_state" in meta:
        entry["visibility_state"] = (meta.get("visibility_state") or "").strip()
    if "has_focus" in meta:
        has_focus = _meta_has_focus(meta)
        entry["has_focus"] = has_focus
        if has_focus:
            entry["last_focus_at"] = now
            _update_last_focused_tm_page(entry)
    for telemetry_key in (
        "last_dom_mutation_at",
        "last_reply_watch_at",
        "pending_reply_active",
        "pending_reply_started_at",
        "pending_reply_text_length",
        "browser_hidden",
        "browser_visibility_state",
        "browser_has_focus",
        "browser_timer_drift_ms",
        "browser_probably_throttled",
    ):
        if telemetry_key in meta:
            entry[telemetry_key] = meta.get(telemetry_key)
    response_state = (meta.get("response_state") or "").strip() or entry.get("response_state") or "unknown"
    can_accept_input = bool(meta.get("can_accept_input", True))
    response_started_at = meta.get("response_started_at") or entry.get("response_started_at")
    response_last_text_changed_at = (
        meta.get("response_last_text_changed_at")
        or entry.get("response_last_text_changed_at")
    )
    prev_response_state = entry.get("response_state") or "unknown"
    prev_response_reason = entry.get("response_state_reason") or ""
    entry["response_state"] = response_state
    if "response_state_reason" in meta:
        entry["response_state_reason"] = (meta.get("response_state_reason") or "").strip()
    if "response_state_at" in meta:
        entry["response_state_at"] = meta.get("response_state_at")
    entry["can_accept_input"] = can_accept_input
    entry["last_response_state_seen_at"] = now
    entry["response_started_at"] = response_started_at
    entry["response_last_text_changed_at"] = response_last_text_changed_at
    entry["last_seen"] = now
    if action == "poll":
        entry["last_poll_at"] = now
        entry["last_heartbeat_at"] = now
    elif action == "ack":
        entry["last_heartbeat_at"] = now
    elif action == "report":
        entry["last_report_at"] = now
        entry["last_heartbeat_at"] = now
    page_no = _ensure_tm_page_no(client_id, page_instance_id)
    if page_no:
        entry["page_no"] = page_no
    if action == "poll":
        visible = entry.get("visibility_state") or "-"
        focus = "yes" if entry.get("has_focus") else "no"
        from app.utils.page_status import BUSY_RESPONSE_STATES

        busy = (entry.get("response_state") or "unknown") in BUSY_RESPONSE_STATES
        responding = "yes" if busy else "no"
        response_state_txt = entry.get("response_state") or "unknown"
        input_txt = "yes" if entry.get("can_accept_input", True) else "no"
        norm_url = _normalize_chatgpt_url_for_compare(
            page_url or entry.get("url") or ""
        )
        if st._debug_mode:
            _log(
                f"[TM][HEARTBEAT] client_id={client_id} page_type={page_type or '-'} "
                f"conversation_id={conversation_id or '-'} visible={visible} "
                f"focus={focus} responding={responding} state={response_state_txt} "
                f"input={input_txt} url={page_url or '-'}"
            )
        snap_key = _page_registry_key(client_id, page_instance_id)
        prev_snap = st._tm_prev_snapshot.get(snap_key) or {}
        new_snap = {
            "client_id": client_id,
            "page_instance_id": page_instance_id or "-",
            "page_type": page_type or "-",
            "conversation_id": conversation_id or "-",
            "url": norm_url,
            "visibility_state": visible,
            "has_focus": focus,
            "is_responding": responding,
            "can_accept_input": input_txt,
            "response_state": response_state_txt,
        }
        compare_keys = (
            "page_type",
            "conversation_id",
            "url",
            "visibility_state",
            "has_focus",
            "is_responding",
            "can_accept_input",
            "response_state",
        )
        changed_fields = [
            key
            for key in compare_keys
            if (prev_snap.get(key) or "") != (new_snap.get(key) or "")
        ]
        if changed_fields:
            _log(
                f"[TM][STATE_CHANGE] registry_key={snap_key} client_id={client_id} "
                f"page_instance_id={page_instance_id or '-'} "
                f"changed_fields={','.join(changed_fields)} "
                f"old_page_type={prev_snap.get('page_type') or '-'} "
                f"new_page_type={new_snap.get('page_type') or '-'} "
                f"old_conv={prev_snap.get('conversation_id') or '-'} "
                f"new_conv={new_snap.get('conversation_id') or '-'} "
                f"old_url={prev_snap.get('url') or '-'} "
                f"new_url={new_snap.get('url') or '-'} "
                f"old_is_responding={prev_snap.get('is_responding') or '-'} "
                f"new_is_responding={new_snap.get('is_responding') or '-'} "
                f"old_can_accept_input={prev_snap.get('can_accept_input') or '-'} "
                f"new_can_accept_input={new_snap.get('can_accept_input') or '-'} "
                f"reason=heartbeat_diff"
            )
            old_pt = (prev_snap.get("page_type") or "").strip()
            old_conv = (prev_snap.get("conversation_id") or "").strip()
            new_pt = (new_snap.get("page_type") or "").strip()
            new_conv = (new_snap.get("conversation_id") or "").strip()
            if (
                prev_snap
                and old_pt == "home"
                and (not old_conv or old_conv == "-")
                and new_pt == "conversation"
                and new_conv
                and new_conv != "-"
            ):
                old_url = prev_snap.get("url") or "https://chatgpt.com/"
                new_url = new_snap.get("url") or "-"
                _log(
                    f"[TM][HOME_TO_CONVERSATION] registry_key={snap_key} client_id={client_id} "
                    f"page_instance_id={page_instance_id or '-'} "
                    f"old_conv=- new_conv={new_conv} "
                    f"old_url={old_url} "
                    f"new_url={new_url}"
                )
                entry["page_channel_promotion"] = {
                    "client_id": client_id,
                    "page_instance_id": page_instance_id or "",
                    "conversation_id": new_conv,
                    "old_url": old_url,
                    "new_url": new_url,
                }
        st._tm_prev_snapshot[snap_key] = new_snap

    response_key = (
        bool(entry.get("is_responding")),
        entry.get("response_state") or "unknown",
        entry.get("response_state_reason") or "",
        bool(entry.get("can_accept_input", True)),
    )
    response_log_key = _page_registry_key(client_id, page_instance_id)
    prev_response_key = st._last_tm_response_state_log.get(response_log_key)
    if response_key != prev_response_key:
        if prev_response_key is not None:
            _log(
                f"[TM_RESPONSE_STATE][CHANGE] client_id={client_id} "
                f"conversation_id={conversation_id or '-'} "
                f"old={prev_response_state} new={entry.get('response_state') or 'unknown'} "
                f"reason={entry.get('response_state_reason') or prev_response_reason or '-'} "
                f"responding={'yes' if entry.get('is_responding') else 'no'} "
                f"input={'yes' if entry.get('can_accept_input', True) else 'no'}"
            )
        st._last_tm_response_state_log[response_log_key] = response_key

    _maybe_log_tm_activity_classify(client_id, entry, meta)
    cleanup_tampermonkey_pages_locked()


TM_PAGE_MAX_AGE_SEC = 1800  # 30 分钟
TM_PAGE_MAX_RECORDS = 200


def cleanup_tampermonkey_pages_locked():
    """清理超过 1800 秒未心跳的页面记录，超过 200 条时按 last_seen 最旧删除。"""
    now = _now()
    max_age = TM_PAGE_MAX_AGE_SEC
    max_records = TM_PAGE_MAX_RECORDS
    with st._state_lock:
        expired_keys = []
        for page_key, entry in list(st._tampermonkey_pages.items()):
            if not isinstance(entry, dict):
                expired_keys.append(page_key)
                continue
            last_seen = entry.get("last_seen")
            try:
                age = now - float(last_seen)
            except (TypeError, ValueError):
                age = 999999.0
            if age > max_age:
                expired_keys.append(page_key)
        # max records: sort by last_seen, remove oldest
        if len(st._tampermonkey_pages) - len(expired_keys) > max_records:
            alive = [
                (k, v)
                for k, v in st._tampermonkey_pages.items()
                if k not in expired_keys and isinstance(v, dict)
            ]
            alive.sort(key=lambda kv: float(kv[1].get("last_seen") or 0))
            overflow = len(alive) - max_records
            for k, _v in alive[:overflow]:
                expired_keys.append(k)
        if not expired_keys:
            return
        expired_set = set(expired_keys)
        for key in expired_keys:
            entry = st._tampermonkey_pages.pop(key, None)
            if isinstance(entry, dict):
                pi = (entry.get("page_instance_id") or "").strip()
                if pi and pi in st._known_page_instances:
                    st._known_page_instances.discard(pi)
        # sync cleanup: _tm_prev_snapshot
        for key in list(st._tm_prev_snapshot.keys()):
            if key in expired_set:
                st._tm_prev_snapshot.pop(key, None)
        # sync cleanup: _last_tm_activity_classify_log
        expired_client_ids = set()
        for key in expired_keys:
            parts = key.split("|", 1)
            if parts:
                expired_client_ids.add(parts[0])
        for cid in expired_client_ids:
            st._last_tm_activity_classify_log.pop(cid, None)
        # sync cleanup: _last_tm_response_state_log (keys are page_key format)
        for key in list(st._last_tm_response_state_log.keys()):
            if key in expired_set:
                st._last_tm_response_state_log.pop(key, None)
        # sync cleanup: _poll_summaries
        for cid in expired_client_ids:
            st._poll_summaries.pop(cid, None)
        # sync cleanup: _last_poll_identity
        for cid in expired_client_ids:
            st._last_poll_identity.pop(cid, None)
        expired_client_prefixes = tuple(
            f"{cid}|" for cid in expired_client_ids if cid
        )
        # sync cleanup: _last_poll_empty_log_at
        for key in list(st._last_poll_empty_log_at.keys()):
            if expired_client_prefixes and key.startswith(expired_client_prefixes):
                st._last_poll_empty_log_at.pop(key, None)
        # sync cleanup: _last_poll_other_reason_log_at
        for key in list(st._last_poll_other_reason_log_at.keys()):
            if expired_client_prefixes and key.startswith(expired_client_prefixes):
                st._last_poll_other_reason_log_at.pop(key, None)
        # sync cleanup: _tm_page_no_by_key / _tm_page_no_updated_at
        for key in list(st._tm_page_no_by_key.keys()):
            if key in expired_set:
                st._tm_page_no_by_key.pop(key, None)
                st._tm_page_no_updated_at.pop(key, None)
    _log(
        "[TM_PAGE][CLEANUP] "
        f"removed={len(expired_keys)} "
        f"remaining_pages={len(st._tampermonkey_pages)} "
        f"remaining_instances={len(st._known_page_instances)}"
    )
