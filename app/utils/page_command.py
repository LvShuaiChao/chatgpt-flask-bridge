"""页面命令目标解析（无 Qt 依赖）。"""



from __future__ import annotations



import time

from typing import Any, Dict, Optional, Tuple



from app.constants import SYNC_COMMAND_POLL_MAX_AGE_SECONDS

from app.utils.page_snapshot import PageRegistry, PageSnapshot, binding_from_session

from app.utils.page_status import can_sync_conversation, evaluate_page_capability

from app.utils.time_utils import float_ts



__all__ = [

    "resolve_page_command_target",

    "command_target_result",

    "evaluate_sync_poll_freshness",

]



_COMMAND_ALIASES = {

    "sync": "sync_conversation",

    "send": "send_message",

    "upload": "start_upload",

    "copy_last": "copy_last_message",

}





def command_target_result(

    *,

    ok: bool,

    reason: str = "",

    reason_code: str = "",

    page: Optional[PageSnapshot] = None,

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

    }





def evaluate_sync_poll_freshness(

    page: PageSnapshot,

    *,

    now: float | None = None,

    max_age_seconds: float = SYNC_COMMAND_POLL_MAX_AGE_SECONDS,

) -> Tuple[bool, str, str]:

    """检查绑定页 poll 是否足够新鲜以领取 sync_conversation。"""

    if now is None:

        now = time.time()

    raw = page._raw if isinstance(getattr(page, "_raw", None), dict) else {}

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





def resolve_page_command_target(

    session: Any,

    command: str,

    registry: Optional[PageRegistry] = None,

    *,

    now: float | None = None,

) -> Dict[str, Any]:

    """

    统一解析 sync/send/upload/copy 目标页。

    sync_conversation 仅使用 session 绑定页；不因 GUI 选中页或 active_matches_bound 覆盖。

    """

    if now is None:

        now = time.time()

    cmd = _COMMAND_ALIASES.get((command or "").strip(), (command or "").strip())

    if not cmd:

        return command_target_result(ok=False, reason="未知命令", reason_code="invalid_command")



    if session is None:

        return command_target_result(ok=False, reason="当前没有选中的对话", reason_code="no_session")



    binding = binding_from_session(session)

    from app.models import BIND_STATE_UNBOUND

    if (binding.get("bind_state") or BIND_STATE_UNBOUND) == BIND_STATE_UNBOUND:

        return command_target_result(

            ok=False,

            reason="当前对话未绑定页面",

            reason_code="not_bound",

        )



    reg = registry if isinstance(registry, PageRegistry) else PageRegistry.empty()

    page = reg.get_bound_page(binding)

    if page is None:

        return command_target_result(

            ok=False,

            reason="绑定页面不在线或未上报",

            reason_code="bound_page_offline",

        )



    if cmd == "sync_conversation":

        if not page.online:

            return command_target_result(

                ok=False,

                reason="绑定页面离线",

                reason_code="bound_page_offline",

                page=page,

            )

        if not can_sync_conversation(page._raw, now=now):

            return command_target_result(

                ok=False,

                reason="绑定页面暂不可同步对话",

                reason_code="not_conversation_syncable",

                page=page,

            )

        poll_ok, poll_code, poll_reason = evaluate_sync_poll_freshness(page, now=now)

        if not poll_ok:

            return command_target_result(

                ok=False,

                reason=poll_reason,

                reason_code=poll_code,

                page=page,

            )

        return command_target_result(ok=True, reason="", reason_code="", page=page)



    action = cmd

    if cmd == "send_message":

        action = "send"

    elif cmd == "start_upload":

        action = "upload"

    elif cmd == "copy_last_message":

        action = "copy_last"



    cap = evaluate_page_capability(

        page._raw,

        action=action,

        bound=True,

        expected_conversation_id=binding.get("conversation_id") or "",

        expected_client_id=binding.get("client_id") or "",

        now=now,

    )

    if not page.online:

        return command_target_result(

            ok=False,

            reason="绑定页面离线",

            reason_code="bound_page_offline",

            page=page,

        )

    if cmd in ("send_message", "start_upload") and cap.send_decision == "blocked":

        blocked = cap.reason or "blocked"

        return command_target_result(

            ok=False,

            reason=f"绑定页面暂不可{cmd}: {blocked}",

            reason_code=blocked,

            page=page,

        )

    if cmd == "copy_last_message" and not can_sync_conversation(page._raw, now=now):

        return command_target_result(

            ok=False,

            reason="绑定页面暂不可复制",

            reason_code="not_conversation_syncable",

            page=page,

        )

    return command_target_result(ok=True, reason="", reason_code="", page=page)


