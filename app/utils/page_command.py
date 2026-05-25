"""页面命令目标解析（无 Qt 依赖）。"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Mapping, Optional, Tuple

from app.constants import SYNC_COMMAND_POLL_MAX_AGE_SECONDS
from app.utils.page_status import PageRegistry, PageSnapshot, binding_from_session
from app.utils.page_status import (
    can_sync_conversation,
    evaluate_page_capability,
    find_online_fallback_page_for_binding,
    is_page_online,
    is_prebound_home_page,
    page_effective_conversation_id,
    page_url_from,
)
from app.utils.time_utils import float_ts

__all__ = [
    "resolve_page_command_target",
    "resolve_bound_page_in_registry",
    "resolve_bound_page_for_action",
    "build_action_target_payload",
    "registry_resolve_to_gui_bound_result",
    "command_target_result",
    "evaluate_sync_poll_freshness",
    "is_page_polling_active",
    "normalize_page_action",
]

logger = logging.getLogger(__name__)

_COMMAND_ALIASES = {
    "sync": "sync_conversation",
    "send": "send_message",
    "upload": "start_upload",
    "copy_last": "copy_last_message",
}


def normalize_page_action(action: str) -> str:
    """统一 send / sync / upload / copy_last 动作名。"""
    act = (action or "").strip() or "send"
    if act == "sync":
        return "sync_conversation"
    return _COMMAND_ALIASES.get(act, act)


def build_action_target_payload(
    item: Mapping[str, Any],
    *,
    source: str = "bound_page",
    matched_by: str = "",
) -> Dict[str, Any]:
    """构造页面动作目标 payload，供 send/sync/open 等页面命令共用。"""
    from app.utils.page_status import (
        can_sync_conversation,
        conversation_syncable_from,
        get_page_liveness,
        is_page_online,
    )

    raw = dict(item) if isinstance(item, Mapping) else {}
    client_id = (raw.get("client_id") or "").strip()
    page_instance_id = (raw.get("page_instance_id") or "").strip()
    conversation_id = page_effective_conversation_id(raw)
    url = page_url_from(raw) or (raw.get("url") or "").strip()
    online = is_page_online(raw)
    return {
        "client_id": client_id,
        "page_instance_id": page_instance_id,
        "conversation_id": conversation_id,
        "url": url,
        "source": (source or "").strip(),
        "matched_by": (matched_by or "").strip(),
        "online": online,
        "page_liveness": get_page_liveness(raw),
        "conversation_syncable": conversation_syncable_from(raw)
        or can_sync_conversation(raw),
        "item": raw,
    }


def registry_resolve_to_gui_bound_result(
    resolved: Mapping[str, Any],
    *,
    default_reason_code: str = "bound_page_offline",
) -> Dict[str, Any]:
    """将 `resolve_bound_page_in_registry` 结果转为 GUI `resolve_bound_page_target` 形。"""
    page = resolved.get("page")
    matched_by = (resolved.get("matched_by") or "none").strip()
    online = bool(resolved.get("online"))
    reason_code = (resolved.get("reason_code") or "").strip()

    if page is None or not online:
        return {
            "ok": False,
            "page": page,
            "item": None,
            "target": None,
            "matched_by": matched_by,
            "online": online,
            "reason_code": reason_code or default_reason_code,
        }

    item = page._raw if isinstance(getattr(page, "_raw", None), dict) else {}
    if not isinstance(item, dict):
        return {
            "ok": False,
            "page": page,
            "item": None,
            "target": None,
            "matched_by": matched_by,
            "online": False,
            "reason_code": "bound_page_offline",
        }

    source = "bound_page" if matched_by == "exact" else "same_conversation"
    target = build_action_target_payload(item, source=source, matched_by=matched_by)
    return {
        "ok": True,
        "page": page,
        "item": item,
        "target": target,
        "matched_by": matched_by,
        "online": online,
        "reason_code": reason_code,
    }


def resolve_bound_page_for_action(
    registry: PageRegistry,
    binding: Mapping[str, Any] | None,
    action: str,
    *,
    now: float | None = None,
    allow_same_conversation: bool | None = None,
) -> Dict[str, Any]:
    """注册表解析 + GUI 绑定目标结构（send/sync 共用入口）。"""
    act = normalize_page_action(action)
    if allow_same_conversation is None:
        allow_same_conversation = bool(
            ((binding or {}).get("conversation_id") or "").strip()
        )
    if act == "sync_conversation":
        allow_same_conversation = bool(allow_same_conversation)
    resolved = resolve_bound_page_in_registry(
        registry,
        binding,
        now=now,
        allow_same_conversation=allow_same_conversation,
    )
    return registry_resolve_to_gui_bound_result(resolved)


def command_target_result(
    *,
    ok: bool,
    reason: str = "",
    reason_code: str = "",
    page: Optional[PageSnapshot] = None,
    matched_by: str = "",
) -> Dict[str, Any]:
    page_obj = page
    return {
        "ok": bool(ok),
        "reason": (reason or "").strip(),
        "reason_code": (reason_code or "").strip(),
        "page": page_obj,
        "client_id": (page_obj.client_id if page_obj else "") or "",
        "page_instance_id": (page_obj.page_instance_id if page_obj else "") or "",
        "conversation_id": (page_obj.conversation_id if page_obj else "") or "",
        "url": (page_obj.url if page_obj else "") or "",
        "matched_by": (matched_by or "").strip(),
    }


def _resolve_page_raw(page):
    """? PageSnapshot ? raw dict ???????"""
    if isinstance(page, dict):
        return page
    if hasattr(page, '_raw') and isinstance(page._raw, dict):
        return page._raw
    return {}


def is_page_polling_active(
    page,
    *,
    now_ts=None,
    max_age_sec=15.0,
):
    """???????????????
    
    ?? online=true ? last_poll_at ?????????????????????
    ?????? polling / is_polling / poll_state ???
    
    ???? raw dict ? PageSnapshot ???
    """
    raw = _resolve_page_raw(page)
    if not isinstance(raw, dict) or not raw.get("online"):
        return False
    
    last_poll_at = raw.get("last_poll_at")
    if last_poll_at is None:
        return False
    
    try:
        last_poll_at_value = float(last_poll_at)
    except (TypeError, ValueError) as exc:
        print(
            "[PAGE_POLLING][INVALID_LAST_POLL_AT] "
            f"value={last_poll_at!r} error_type={type(exc).__name__} error={exc}"
        )
        return False
    
    if now_ts is None:
        now_ts = __import__('time').time()
    
    return (now_ts - last_poll_at_value) <= max_age_sec


def evaluate_sync_poll_freshness(
    page,
    *,
    now: float | None = None,
    max_age_seconds: float = SYNC_COMMAND_POLL_MAX_AGE_SECONDS,
) -> Tuple[bool, str, str]:
    """检查绑定页 poll 是否足够新鲜以领取 sync_conversation。"""
    if now is None:
        now = time.time()
    raw = _resolve_page_raw(page)
    last_poll_at = float_ts(
        raw.get("last_poll_at"),
        default=0.0,
        context="page_command.sync.last_poll_at",
        log_on_error=True,
    )
    if last_poll_at <= 0:
        return (
            False,
            "bound_page_not_polling",
            "绑定页面没有 poll 记录，无法领取同步命令",
        )
    poll_age = now - last_poll_at
    if poll_age > float(max_age_seconds):
        return (
            False,
            "bound_page_poll_stale",
            f"绑定页面轮询已过期（{poll_age:.1f}s），无法领取同步命令",
        )
    return True, "", ""


def _pick_fresh_conversation_page(
    registry: PageRegistry,
    conversation_id: str,
    *,
    now: float | None = None,
    for_sync: bool = False,
    binding: Mapping[str, Any] | None = None,
) -> Optional[PageSnapshot]:
    """同 conversation 选最新在线页；sync 要求 poll 新鲜且可同步。"""
    conversation_id = (conversation_id or "").strip()
    if not conversation_id or not isinstance(registry, PageRegistry):
        return None
    if now is None:
        now = time.time()
    bind = dict(binding or {})
    if not bind.get("conversation_id"):
        bind["conversation_id"] = conversation_id
    fallback, _matched_by = find_online_fallback_page_for_binding(
        registry,
        bind,
        now=now,
        require_conversation_syncable=True,
    )
    if fallback is None:
        return None
    if for_sync:
        poll_ok, _, _ = evaluate_sync_poll_freshness(fallback, now=now)
        if not poll_ok:
            return None
    return fallback


def _resolve_page_channel_page(
    registry: PageRegistry,
    binding: Mapping[str, Any],
    *,
    now: float | None = None,
) -> tuple[Optional[PageSnapshot], str, str]:
    """
    页面通道绑定解析优先级：
    1. page_instance_id 精确匹配
    2. client_id + page_no
    3. 仅 page_no（在线且唯一）
    """
    if now is None:
        now = time.time()
    bound_instance = (binding.get("page_instance_id") or "").strip()
    bound_client = (binding.get("client_id") or "").strip()
    page_no = (
        (binding.get("page_no") or binding.get("temp_page_id") or binding.get("page_display_id") or "")
        .strip()
    )

    if bound_client and bound_instance:
        page = registry.get_by_identity(bound_client, bound_instance)
        if page is not None:
            raw = page._raw if isinstance(page._raw, dict) else {}
            if is_page_online(raw, now=now):
                return page, "client_and_page_instance", ""
            return page, "client_and_page_instance", "bound_page_offline"

    if bound_client and page_no:
        matches = []
        for page in registry.pages:
            raw = page._raw if isinstance(page._raw, dict) else {}
            raw_no = str(raw.get("page_no") or page.page_display_id or "").strip()
            if raw_no == page_no and (page.client_id or "").strip() == bound_client:
                matches.append(page)
        if len(matches) == 1:
            raw = matches[0]._raw if isinstance(matches[0]._raw, dict) else {}
            if is_page_online(raw, now=now):
                return matches[0], "client_id_page_no", ""
            return matches[0], "client_id_page_no", "bound_page_offline"
        if len(matches) > 1:
            return None, "page_no_ambiguous", "ambiguous_page_no"

    if page_no:
        matches = []
        for page in registry.pages:
            raw = page._raw if isinstance(page._raw, dict) else {}
            raw_no = str(raw.get("page_no") or page.page_display_id or "").strip()
            if raw_no == page_no:
                matches.append(page)
        online_matches = [
            p
            for p in matches
            if is_page_online(p._raw if isinstance(p._raw, dict) else {}, now=now)
        ]
        if len(online_matches) == 1:
            logger.warning(
                "[SEND][RESOLVE][PAGE_NO_FALLBACK] page_no=%s reason=page_no_unique_online",
                page_no,
            )
            return online_matches[0], "page_no_unique", ""
        if len(matches) > 1:
            return None, "page_no_ambiguous", "ambiguous_page_no"

    temp_page_id = (
        (binding.get("temp_page_id") or binding.get("page_display_id") or "")
        .strip()
    )
    if temp_page_id:
        page = registry.get_by_page_display_id(temp_page_id)
        if page is not None:
            raw = page._raw if isinstance(page._raw, dict) else {}
            if is_page_online(raw, now=now):
                return page, "page_display_id", ""
            return page, "page_display_id", "bound_page_offline"

    return None, "none", "temp_home_page_not_found"


def resolve_bound_page_in_registry(
    registry: PageRegistry,
    binding: Mapping[str, Any] | None,
    *,
    now: float | None = None,
    allow_same_conversation: bool = False,
) -> Dict[str, Any]:
    """
    在 PageRegistry 中解析会话绑定页：仅精确匹配，不允许同 conversation 兜底。
    返回 page / matched_by / online / last_poll_at / reason_code。
    """
    from app.models import BIND_STATE_UNBOUND, is_temp_home_bound_state

    if now is None:
        now = time.time()
    empty = {
        "page": None,
        "matched_by": "none",
        "online": False,
        "last_poll_at": 0.0,
        "reason_code": "not_bound",
        "relink_needed": False,
    }
    if not binding or (binding.get("bind_state") or BIND_STATE_UNBOUND) == BIND_STATE_UNBOUND:
        empty["reason_code"] = "not_bound"
        return empty

    reg = registry if isinstance(registry, PageRegistry) else PageRegistry.empty()
    bind_state = (binding.get("bind_state") or "").strip()
    if is_temp_home_bound_state(bind_state):
        page, matched_by, reason_code = _resolve_page_channel_page(reg, binding, now=now)
        if page is None:
            return {
                **empty,
                "matched_by": matched_by or "none",
                "reason_code": reason_code or "temp_home_page_not_found",
            }
        raw = page._raw if isinstance(page._raw, dict) else {}
        page_url = page_url_from(raw) or (page.url or "")
        page_conv = (raw.get("conversation_id") or page.conversation_id or "").strip()
        if page_conv:
            online = is_page_online(raw, now=now)
            last_poll_at = float_ts(
                raw.get("last_poll_at"),
                default=0.0,
                context="page_command.page_channel.promoted_poll",
            )
            return {
                "page": page,
                "matched_by": matched_by,
                "online": online,
                "last_poll_at": last_poll_at,
                "reason_code": "" if online else "bound_page_offline",
                "relink_needed": False,
                "bootstrap_conversation": False,
                "target_page_id": (
                    (binding.get("temp_page_id") or binding.get("page_no") or binding.get("page_display_id") or "")
                    .strip()
                ),
            }
        page_type = (raw.get("page_type") or page.page_type or "").strip()
        is_home = is_prebound_home_page(raw, now=now) or page_type == "home" or not page_conv
        if not is_home and not page_conv:
            return {
                "page": page,
                "matched_by": matched_by,
                "online": False,
                "last_poll_at": float_ts(
                    raw.get("last_poll_at"),
                    default=0.0,
                    context="page_command.page_channel.not_home_poll",
                ),
                "reason_code": "temp_home_page_not_home",
                "relink_needed": False,
            }
        online = is_page_online(raw, now=now)
        last_poll_at = float_ts(
            raw.get("last_poll_at"),
            default=0.0,
            context="page_command.page_channel.last_poll_at",
        )
        if not online:
            return {
                "page": page,
                "matched_by": matched_by,
                "online": False,
                "last_poll_at": last_poll_at,
                "reason_code": "bound_page_offline",
                "relink_needed": False,
            }
        target_page_id = (
            (binding.get("temp_page_id") or binding.get("page_no") or binding.get("page_display_id") or "")
            .strip()
        )
        return {
            "page": page,
            "matched_by": matched_by,
            "online": True,
            "last_poll_at": last_poll_at,
            "reason_code": "",
            "relink_needed": False,
            "bootstrap_conversation": True,
            "target_page_id": target_page_id,
        }
    bound_client = (binding.get("client_id") or "").strip()
    bound_instance = (binding.get("page_instance_id") or "").strip()
    bound_conv = (binding.get("conversation_id") or "").strip()
    if not bound_conv:
        bound_conv = page_effective_conversation_id({"url": binding.get("url") or ""})

    page = reg.get_bound_page(binding, strict_identity=True)
    matched_by = "exact" if page is not None else "none"
    reason_code = ""
    last_poll_at = 0.0
    exact_online = False

    if page is not None:
        raw = page._raw if isinstance(page._raw, dict) else {}
        page_conv = page_effective_conversation_id(raw)
        last_poll_at = float_ts(
            raw.get("last_poll_at"),
            default=0.0,
            context="page_command.resolve.last_poll_at",
        )
        if bound_conv and page_conv and page_conv != bound_conv:
            return {
                "page": page,
                "matched_by": "identity_conversation_mismatch",
                "online": False,
                "last_poll_at": last_poll_at,
                "reason_code": "conversation_id_mismatch",
                "relink_needed": False,
                "offline_fallback": False,
            }
        exact_online = is_page_online(raw, now=now)
        exact_usable = exact_online and (
            not bound_conv or bool(page_conv)
        )
        if exact_usable:
            return {
                "page": page,
                "matched_by": "exact",
                "online": True,
                "last_poll_at": last_poll_at,
                "reason_code": "",
                "relink_needed": False,
                "offline_fallback": False,
            }
        reason_code = "bound_page_offline"
    else:
        reason_code = "bound_page_offline"

    offline_fallback_attempted = bool(bound_conv)
    if offline_fallback_attempted:
        logger.info(
            "[BOUND_PAGE][OFFLINE_FALLBACK_START] "
            "session_binding client_id=%s page_instance_id=%s conversation_id=%s "
            "exact_matched=%s exact_online=%s reason=%s",
            bound_client or "-",
            bound_instance or "-",
            bound_conv or "-",
            matched_by == "exact",
            exact_online,
            reason_code or "-",
        )
        fallback, fb_matched_by = find_online_fallback_page_for_binding(
            reg,
            binding,
            now=now,
            require_conversation_syncable=False,
        )
        if fallback is not None:
            fb_raw = fallback._raw if isinstance(fallback._raw, dict) else {}
            fb_last_poll_at = float_ts(
                fb_raw.get("last_poll_at"),
                default=0.0,
                context="page_command.resolve.offline_fallback_poll",
            )
            relink_needed = (
                (fallback.client_id or "").strip() != bound_client
                or (fallback.page_instance_id or "").strip() != bound_instance
            )
            logger.info(
                "[BOUND_PAGE][OFFLINE_FALLBACK_FOUND] "
                "old_client_id=%s old_page_instance_id=%s old_conversation_id=%s "
                "new_client_id=%s new_page_instance_id=%s new_page_no=%s "
                "matched_by=%s reason=%s",
                bound_client or "-",
                bound_instance or "-",
                bound_conv or "-",
                (fallback.client_id or "-"),
                (fallback.page_instance_id or "-"),
                str(fb_raw.get("page_no") or fallback.page_display_id or "-"),
                fb_matched_by or "same_conversation",
                reason_code or "bound_page_offline",
            )
            return {
                "page": fallback,
                "matched_by": fb_matched_by or "same_conversation",
                "online": True,
                "last_poll_at": fb_last_poll_at,
                "reason_code": "",
                "relink_needed": relink_needed,
                "offline_fallback": True,
            }
        logger.info(
            "[BOUND_PAGE][OFFLINE_FALLBACK_MISS] "
            "old_client_id=%s old_page_instance_id=%s old_conversation_id=%s reason=%s",
            bound_client or "-",
            bound_instance or "-",
            bound_conv or "-",
            reason_code or "bound_page_offline",
        )

    if not allow_same_conversation or not bound_conv:
        return {
            "page": page,
            "matched_by": matched_by,
            "online": False,
            "last_poll_at": last_poll_at,
            "reason_code": reason_code,
            "relink_needed": False,
            "offline_fallback": False,
        }

    fallback = _pick_fresh_conversation_page(
        reg, bound_conv, now=now, for_sync=False, binding=binding
    )
    if fallback is None:
        return {
            "page": None,
            "matched_by": "none",
            "online": False,
            "last_poll_at": 0.0,
            "reason_code": reason_code,
            "relink_needed": False,
            "offline_fallback": False,
        }

    raw = fallback._raw if isinstance(fallback._raw, dict) else {}
    last_poll_at = float_ts(
        raw.get("last_poll_at"),
        default=0.0,
        context="page_command.resolve.fallback_poll",
    )
    relink_needed = (
        fallback.client_id != bound_client
        or fallback.page_instance_id != bound_instance
    )
    return {
        "page": fallback,
        "matched_by": "same_conversation",
        "online": True,
        "last_poll_at": last_poll_at,
        "reason_code": "",
        "relink_needed": relink_needed,
        "offline_fallback": True,
    }


# Log labels: [SYNC][RESOLVE] / [SEND][RESOLVE] / [COMMAND][CLAIM]
def resolve_page_command_target(
    session: Any,
    command: str,
    registry: Optional[PageRegistry] = None,
    *,
    now: float | None = None,
    allow_same_conversation: bool = False,
) -> Dict[str, Any]:
    """
    统一解析 sync/send/upload/copy 目标页。
    使用 resolve_bound_page_in_registry；同会话新鲜在线页可作为绑定目标。
    """
    if now is None:
        now = time.time()
    cmd = _COMMAND_ALIASES.get((command or "").strip(), (command or "").strip())
    if not cmd:
        return command_target_result(ok=False, reason="未知命令", reason_code="invalid_command")

    if session is None:
        return command_target_result(
            ok=False, reason="当前没有选中的对话", reason_code="no_session"
        )

    binding = binding_from_session(session)
    from app.models import BIND_STATE_UNBOUND

    if (binding.get("bind_state") or BIND_STATE_UNBOUND) == BIND_STATE_UNBOUND:
        return command_target_result(
            ok=False,
            reason="当前对话未绑定页面",
            reason_code="not_bound",
        )

    reg = registry if isinstance(registry, PageRegistry) else PageRegistry.empty()
    resolved = resolve_bound_page_in_registry(
        reg,
        binding,
        now=now,
        allow_same_conversation=allow_same_conversation,
    )
    page = resolved.get("page")
    matched_by = (resolved.get("matched_by") or "none").strip()

    if page is None:
        code = (resolved.get("reason_code") or "bound_page_offline").strip()
        return command_target_result(
            ok=False,
            reason="绑定页面不在线或未上报",
            reason_code=code,
            matched_by=matched_by,
        )

    if cmd == "sync_conversation":
        if not page.online:
            return command_target_result(
                ok=False,
                reason="绑定页面离线",
                reason_code="bound_page_offline",
                page=page,
                matched_by=matched_by,
            )
        raw = page._raw if isinstance(page._raw, dict) else {}
        need_fallback = False
        if not can_sync_conversation(raw, now=now):
            need_fallback = True
        else:
            poll_ok, poll_code, poll_reason = evaluate_sync_poll_freshness(page, now=now)
            if not poll_ok:
                need_fallback = True
        if need_fallback and allow_same_conversation:
            fresh = _pick_fresh_conversation_page(
                reg,
                binding.get("conversation_id") or "",
                now=now,
                for_sync=True,
            )
            if fresh is not None:
                page = fresh
                matched_by = "same_conversation"
                raw = page._raw if isinstance(page._raw, dict) else {}
        if not can_sync_conversation(raw, now=now):
            return command_target_result(
                ok=False,
                reason="绑定页面暂不可同步对话",
                reason_code="not_conversation_syncable",
                page=page,
                matched_by=matched_by,
            )
        poll_ok, poll_code, poll_reason = evaluate_sync_poll_freshness(page, now=now)
        if not poll_ok:
            return command_target_result(
                ok=False,
                reason=poll_reason,
                reason_code=poll_code,
                page=page,
                matched_by=matched_by,
            )
        return command_target_result(
            ok=True, reason="", reason_code="", page=page, matched_by=matched_by
        )

    action = cmd
    if cmd == "send_message":
        action = "send"
    elif cmd == "start_upload":
        action = "upload"
    elif cmd == "copy_last_message":
        action = "copy_last"

    bind_state = (binding.get("bind_state") or "").strip()
    from app.models import is_temp_home_bound_state

    expected_conversation_id = binding.get("conversation_id") or ""
    if is_temp_home_bound_state(bind_state):
        expected_conversation_id = ""
    cap = evaluate_page_capability(
        page._raw,
        action=action,
        bound=True,
        expected_conversation_id=expected_conversation_id,
        expected_client_id=binding.get("client_id") or "",
        expected_page_instance_id=binding.get("page_instance_id") or "",
        now=now,
    )
    raw = page._raw if isinstance(page._raw, dict) else {}
    online = is_page_online(raw, now=now)
    if not online:
        return command_target_result(
            ok=False,
            reason="绑定页面离线",
            reason_code="bound_page_offline",
            page=page,
            matched_by=matched_by,
        )
    if cmd in ("send_message", "start_upload") and cap.send_decision == "blocked":
        blocked = cap.reason_code or "blocked"
        return command_target_result(
            ok=False,
            reason=f"绑定页面暂不可{cmd}: {blocked}",
            reason_code=blocked,
            page=page,
            matched_by=matched_by,
        )
    if cmd == "copy_last_message" and not can_sync_conversation(page._raw, now=now):
        return command_target_result(
            ok=False,
            reason="绑定页面暂不可复制",
            reason_code="not_conversation_syncable",
            page=page,
            matched_by=matched_by,
        )
    return command_target_result(
        ok=True, reason="", reason_code="", page=page, matched_by=matched_by
    )
