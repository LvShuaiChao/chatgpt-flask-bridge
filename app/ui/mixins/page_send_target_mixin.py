"""发送目标解析、绑定校验与在线页面选择。"""

import time
from urllib.parse import urlparse

from app.constants import BOUND_PAGE_ONLINE_SECONDS, BOUND_PAGE_STALE_SECONDS
from app.utils.tm_activity import classify_tm_client_activity, tm_send_allowed
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_HOME,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id


class PageSendTargetMixin:

    def _is_sendable_chatgpt_client(self, client_info, expected_conversation_id=""):
        if not isinstance(client_info, dict):
            return False

        client_id = (client_info.get("client_id") or "").strip()
        if not client_id:
            return False

        if not client_info.get("online"):
            return False

        page_url = (client_info.get("page_url") or "").strip()
        if not page_url or page_url == "-":
            return False
        if not self._is_bindable_chatgpt_url(page_url):
            return False

        try:
            parsed = urlparse(page_url)
            path = parsed.path or "/"
            if not path.startswith("/c/"):
                return False
        except ValueError:
            return False

        page_type = (client_info.get("page_type") or "").strip()
        if page_type in ("-", "home", "ignored"):
            return False

        raw_conversation_id = (client_info.get("conversation_id") or "").strip()
        if raw_conversation_id == "-":
            return False

        conversation_id = self._client_conversation_id(client_info)
        if not conversation_id:
            return False

        expected_conversation_id = (expected_conversation_id or "").strip()
        if expected_conversation_id and conversation_id != expected_conversation_id:
            return False

        ok_send, _, _ = tm_send_allowed(client_info)
        return bool(ok_send)

    def _client_sendable_for_bridge(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return False, None
        info = self._client_info_from_status(client_id)
        if not info or not info.get("online"):
            return False, None
        ok_send, _reason, detail = tm_send_allowed(info)
        return ok_send, detail
    def _find_online_client_for_remote(self, remote, bridge_status=None):
        remote = normalize_remote_chatgpt(remote)
        status = bridge_status if bridge_status is not None else self._last_bridge_status

        bound_client_id = (remote.get("client_id") or "").strip()
        bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
        bound_url = (remote.get("conversation_url") or "").strip()
        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(bound_url)

        if not bound_conversation_id:
            return None

        now = time.time()
        candidates = []
        for item in self._iter_tm_clients(status, online_only=False):
            if not isinstance(item, dict):
                continue

            item_client_id = (item.get("client_id") or "").strip()
            item_page_instance_id = (item.get("page_instance_id") or "").strip()
            item_url = (item.get("page_url") or "").strip()
            item_conversation_id = self._client_conversation_id(item)
            if not item_conversation_id or item_conversation_id != bound_conversation_id:
                continue

            last_seen = float(item.get("last_seen") or 0)
            if last_seen <= 0:
                continue
            seen_age = max(0.0, now - last_seen)
            if seen_age > BOUND_PAGE_STALE_SECONDS:
                continue

            score = 0
            score += 500
            if bound_client_id and item_client_id == bound_client_id:
                score += 100
            if bound_page_instance_id and item_page_instance_id == bound_page_instance_id:
                score += 80
            bound_url_base = bound_url.split("#")[0] if bound_url else ""
            item_url_base = item_url.split("#")[0] if item_url else ""
            if bound_url_base and item_url_base and bound_url_base == item_url_base:
                score += 60

            activity = classify_tm_client_activity(item)
            tier = {
                "active_focused": 4,
                "active_visible": 3,
                "active_hidden": 2,
                "online_unknown": 1,
                "stale_hidden": 0,
                "offline": 0,
            }.get(activity, 0)
            poll_ts = float(item.get("last_poll_at") or item.get("last_seen") or 0)
            is_sendable = self._is_sendable_chatgpt_client(
                item, expected_conversation_id=bound_conversation_id
            )
            freshness = 2 if seen_age <= BOUND_PAGE_ONLINE_SECONDS else 1

            candidates.append(
                (
                    1 if is_sendable else 0,
                    freshness,
                    score,
                    tier,
                    last_seen,
                    poll_ts,
                    item,
                )
            )

        if not candidates:
            return None

        candidates.sort(
            key=lambda row: (row[0], row[1], row[2], row[3], row[4], row[5]),
            reverse=True,
        )
        return dict(candidates[0][6])
    def _session_has_sendable_bound_page(self, remote):
        remote = normalize_remote_chatgpt(remote)
        candidate = self._find_online_client_for_remote(remote)
        if not candidate:
            return False
        expected = (remote.get("conversation_id") or "").strip()
        if not expected:
            expected = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
        return self._is_sendable_chatgpt_client(candidate, expected)
    def _session_bound_page_online(self, session, bridge_status=None):
        if session is None:
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return False
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
        if not conversation_id:
            return False
        candidate = self._find_online_client_for_remote(remote, bridge_status=bridge_status)
        if not candidate:
            return False
        last_seen = float(candidate.get("last_seen") or 0)
        if last_seen <= 0:
            return False
        return (time.time() - last_seen) <= BOUND_PAGE_ONLINE_SECONDS
    def _session_bound_page_has_mismatch(self, session, bridge_status=None):
        if session is None:
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return False
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
        if not conversation_id:
            return False
        status = bridge_status if bridge_status is not None else self._last_bridge_status
        bound_client_id = (remote.get("client_id") or "").strip()
        bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
        for item in self._iter_tm_clients(status, online_only=True):
            item_client_id = (item.get("client_id") or "").strip()
            item_page_instance_id = (item.get("page_instance_id") or "").strip()
            same_client = bool(bound_client_id and item_client_id == bound_client_id)
            same_page_instance = bool(
                bound_page_instance_id and item_page_instance_id == bound_page_instance_id
            )
            if not (same_client or same_page_instance):
                continue
            item_conv = self._client_conversation_id(item) or ""
            if item_conv and item_conv != conversation_id:
                return True
        return False
    def _try_auto_bind_online_page(self, session):
        if self._session_is_local_new_chat_flow(session):
            idle_home = self._find_idle_chatgpt_home_client(
                session_id=(session.session_id if session else "") or ""
            )
            if idle_home:
                client_id = (idle_home.get("client_id") or "").strip()
                page_instance_id = (idle_home.get("page_instance_id") or "").strip()
                self._append_log(
                    f"[AUTO_BIND][USE_IDLE_HOME] session_id={session.session_id} "
                    f"client_id={client_id} page_instance_id={page_instance_id or '-'}"
                )
                return self._prebound_home_bind_to_session(
                    session, idle_home, silent=True
                )
            return False

        status = self._last_bridge_status or {}
        client_info = self._pick_auto_bind_client(
            status, (session.session_id if session else "") or ""
        )
        if not client_info and status.get("tampermonkey_online"):
            client_id = (status.get("tampermonkey_client_id") or "").strip()
            client_info = self._client_info_from_status(client_id)
            if client_info:
                client_info = dict(client_info)
                client_info["page_url"] = (
                    client_info.get("page_url")
                    or (status.get("tampermonkey_page_url") or "").strip()
                )
        if not client_info:
            return False
        return self._bind_page_to_session(session, client_info, silent=True)
    def _rebind_current_session_to_online_client_if_needed(self):
        if not self._bind_each_chat_to_page:
            return False

        session = self._current_session()
        if session is None:
            return False

        if self._session_is_local_new_chat_flow(session):
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        bound_client_id = (remote.get("client_id") or "").strip()

        if bind_state == BIND_STATE_PREBOUND_HOME:
            if self._session_has_prebound_home_online(remote):
                return False
            self._append_log(
                "[自动换绑] 预绑定首页离线，不会换绑到其他 conversation 页面。"
            )
            return False

        if bound_client_id and self._is_client_online(bound_client_id):
            if remote.get("enabled") and self._session_has_sendable_bound_page(remote):
                return False

        status = self._last_bridge_status or {}
        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        bound_conversation_url = (remote.get("conversation_url") or "").strip()
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(bound_conversation_url)
        bound_url_base = bound_conversation_url.split("#")[0] if bound_conversation_url else ""
        lock_conversation = bool(
            remote.get("enabled")
            and bind_state == BIND_STATE_BOUND_CONVERSATION
            and bound_conversation_id
        )

        candidates = []
        for item in status.get("tampermonkey_clients") or []:
            if not isinstance(item, dict):
                continue

            client_id = (item.get("client_id") or "").strip()
            page_url = (item.get("page_url") or "").strip()

            if not client_id:
                continue

            if not item.get("online"):
                continue

            if not self._is_bindable_chatgpt_url(page_url):
                continue

            if self._is_client_bound_to_other_session(item, session.session_id):
                continue

            page_type = (item.get("page_type") or "").strip()
            conversation_id = self._client_conversation_id(item)

            if lock_conversation:
                if conversation_id != bound_conversation_id:
                    continue

            score = 0
            if client_id == live_client_id:
                score += 100
            if (
                bound_conversation_id
                and conversation_id
                and conversation_id == bound_conversation_id
            ):
                score += 500
                if lock_conversation and bound_url_base:
                    page_base = page_url.split("#")[0]
                    if page_base == bound_url_base:
                        score += 20
            if conversation_id:
                score += 50
            if page_type == "conversation":
                score += 30
            if item.get("has_focus"):
                score += 20

            last_seen = float(item.get("last_seen") or 0)
            candidates.append((score, last_seen, item))

        if not candidates:
            if lock_conversation:
                self._append_log(
                    "[自动换绑] 绑定页面离线，未找到同会话在线页面，请打开绑定页面。"
                )
            else:
                self._append_log("[自动换绑] 没有找到可用的在线 ChatGPT 页面。")
            return False

        candidates.sort(key=lambda row: (row[0], row[1]), reverse=True)
        client_info = dict(candidates[0][2])

        page_type = (client_info.get("page_type") or "").strip()
        if lock_conversation or page_type == "conversation":
            ok = self._bind_conversation_to_session(session, client_info, silent=True)
        else:
            ok = False
        if ok:
            self._append_log(
                "[REOPEN][MATCH_BY_CONVERSATION] "
                f"session_id={session.session_id} "
                f"conversation_id={bound_conversation_id or '-'} "
                f"client_id={client_info.get('client_id') or '-'}"
            )
            self._append_log(
                "[自动换绑] "
                f"old_client_id={bound_client_id or '-'} "
                f"new_client_id={client_info.get('client_id') or '-'} "
                f"url={client_info.get('page_url') or '-'}"
            )
            self._update_bound_page_display()
            self._save_sessions_to_disk()

        return ok
    def _preferred_open_url_for_session(self, session):
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )

        history_url = self._chatgpt_url_from_remote(remote)
        if self._is_bindable_chatgpt_url(history_url):
            return history_url

        saved = (self._saved_page_url or "").strip()
        if self._is_bindable_chatgpt_url(saved):
            return saved

        live = self._live_openable_chatgpt_url()
        if self._is_bindable_chatgpt_url(live):
            return live

        return CHATGPT_HOME_URL
    def _resolve_target_page_for_session(self, session):
        session_id = (session.session_id if session else "") or ""
        remote_early = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if self._remote_bind_state(remote_early) == BIND_STATE_WAITING_HOME:
            return (
                "",
                "",
                False,
                "正在等待 ChatGPT 首页上线，首条消息将在页面上线后自动发送。",
            )
        if self._remote_bind_state(remote_early) == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return (
                "",
                "",
                False,
                "绑定的 ChatGPT 对话页未打开，正在自动打开原对话页面...",
            )
        if self._pending_auto_bind_session_id == session_id:
            return (
                "",
                "",
                False,
                "当前对话正在等待新打开的 ChatGPT 页面上线并自动绑定，请稍后再发送。",
            )

        if not self._bind_each_chat_to_page:
            return (
                "",
                "",
                True,
                "未启用页面绑定，使用任意在线页面。",
            )

        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        enabled = bool(remote.get("enabled"))
        bind_state = self._remote_bind_state(remote)
        client_id = (remote.get("client_id") or "").strip()
        page_url = (remote.get("conversation_url") or remote.get("url") or "").strip()

        if bind_state == BIND_STATE_PREBOUND_HOME:
            home_client = self._find_prebound_home_client(remote)
            if home_client:
                home_url = (home_client.get("page_url") or page_url or CHATGPT_HOME_URL).strip()
                home_id = (home_client.get("client_id") or client_id).strip()
                return (
                    home_id,
                    home_url,
                    True,
                    "预绑定首页在线，首条消息将通过首页创建对话。",
                )
            return (
                "",
                "",
                False,
                "预绑定首页已离线，正在重新选择空闲首页或打开新的 ChatGPT 首页。",
            )

        if not enabled or not page_url:
            if bind_state == BIND_STATE_UNBOUND:
                return (
                    "",
                    "",
                    False,
                    "当前对话尚未绑定 ChatGPT 页面，请先发送首条消息。",
                )

            if self._session_has_wrong_existing_conversation_bind(session):
                return (
                    "",
                    "",
                    False,
                    "当前对话错误绑定到已有 ChatGPT 对话页。请点击“绑定当前页面”覆盖后重新发送。",
                )

            if (
                self._is_new_local_session_without_remote_conversation(session)
                and self._auto_bind_unbound_page
            ):
                return (
                    "",
                    "",
                    False,
                    "当前对话尚未绑定 ChatGPT 首页，请先发送首条消息。",
                )

            if self._auto_bind_unbound_page and self._try_auto_bind_online_page(
                session
            ):
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                client_id = (remote.get("client_id") or "").strip()
                page_url = (remote.get("conversation_url") or "").strip()
                if client_id:
                    ok_send, _ = self._client_sendable_for_bridge(client_id)
                    if ok_send:
                        return client_id, page_url, True, "已自动绑定在线 ChatGPT 页面。"

            return "", "", False, "当前对话未绑定 ChatGPT 页面。"

        matched_client = self._find_online_client_for_remote(remote)
        if matched_client:
            matched_client_id = (matched_client.get("client_id") or "").strip()
            matched_page_url = (matched_client.get("page_url") or "").strip()
            if not matched_page_url:
                matched_page_url = page_url
            if matched_client_id and matched_client_id != client_id:
                self._bind_page_to_session(session, matched_client, silent=True)
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                client_id = (remote.get("client_id") or "").strip()
                page_url = (
                    (remote.get("conversation_url") or "").strip()
                    or matched_page_url
                )
            return (
                matched_client_id or client_id,
                page_url or matched_page_url,
                True,
                "绑定页面在线。",
            )

        ok_send, stale_detail = self._client_sendable_for_bridge(client_id)
        if ok_send:
            return client_id, page_url, True, "绑定页面在线。"
        if client_id and self._is_client_online(client_id) and stale_detail:
            self._append_log(
                f"[SEND][PAGE_ACTIVITY_REJECT] session_id={session_id} "
                f"client_id={client_id or '-'} reason=bound_client_poll_not_fresh "
                f"poll_age={stale_detail.get('poll_age')} "
                f"seen_age={stale_detail.get('seen_age')} "
                f"activity={stale_detail.get('activity')}"
            )

        bound_conversation_id = (remote.get("conversation_id") or "").strip()
        if not bound_conversation_id:
            bound_conversation_id = parse_conversation_id(page_url)
        if bound_conversation_id:
            details = self._binding_status_details(session)
            active_conv = (details.get("online_conversation_id") or "").strip()
            if active_conv and active_conv != "-" and active_conv != bound_conversation_id:
                self._append_log(
                    f"[SEND][BLOCK_WRONG_ACTIVE_PAGE] session_id={session_id} "
                    f"bound_conversation_id={bound_conversation_id} "
                    f"active_conversation_id={active_conv} "
                    f"reason=bound_page_offline_reopen_required"
                )
            return (
                "",
                "",
                False,
                "绑定的 ChatGPT 对话页离线，正在自动打开原对话页面...",
            )

        rebind_attempted = self._rebind_current_session_to_online_client_if_needed()
        if rebind_attempted:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            client_id = (remote.get("client_id") or "").strip()
            page_url = (remote.get("conversation_url") or "").strip()
            matched_client = self._find_online_client_for_remote(remote)
            if matched_client:
                matched_client_id = (matched_client.get("client_id") or "").strip()
                matched_page_url = (matched_client.get("page_url") or "").strip()
                if not matched_page_url:
                    matched_page_url = page_url
                return (
                    matched_client_id or client_id,
                    page_url or matched_page_url,
                    True,
                    "绑定页面已自动换绑并在线。",
                )
            ok_send, _ = self._client_sendable_for_bridge(client_id)
            if ok_send:
                return (
                    client_id,
                    page_url,
                    True,
                    "绑定页面已自动换绑并在线。",
                )

        if (
            self._auto_open_bound_page_when_missing
            and not self._pending_auto_bind_session_id
        ):
            open_url = page_url or self._preferred_open_url_for_session(session)
            if self._auto_open_url_once(
                session,
                open_url,
                "自动打开当前对话绑定页面",
            ):
                if rebind_attempted:
                    hint = (
                        "当前绑定页面离线，已尝试自动换绑到在线页面；"
                        "仍未找到可用在线页面，已打开绑定页面，"
                        "请等待油猴上线后重新发送。"
                    )
                else:
                    hint = (
                        "未找到在线 ChatGPT 页面，已打开绑定页面，"
                        "请等待油猴上线后重新发送。"
                    )
                return "", "", False, hint
            if rebind_attempted:
                hint = (
                    "当前绑定页面离线，已尝试自动换绑；"
                    "仍未找到在线页面。绑定页面已在近期打开，"
                    "请等待油猴上线后重新发送。"
                )
            else:
                hint = (
                    "未找到在线 ChatGPT 页面。绑定页面已在近期打开，"
                    "请等待油猴上线后重新发送。"
                )
            return "", "", False, hint

        if self._allow_fallback_to_any_page:
            return (
                "",
                "",
                True,
                "绑定页面未在线，按设置退回任意在线页面发送。",
            )

        return "", "", False, "绑定页面未打开，请先打开当前对话绑定页面。"
    def _best_live_conversation_client(self, status=None):
        status = status or self._last_bridge_status or {}
        live_client_id = (status.get("tampermonkey_client_id") or "").strip()
        candidates = []
        for item in self._iter_tm_clients(status, online_only=True):
            if not self._is_sendable_chatgpt_client(item):
                continue
            client_id = self._tm_client_id(item)
            score = 0
            if client_id == live_client_id:
                score += 100
            activity = classify_tm_client_activity(item)
            tier = {
                "active_focused": 40,
                "active_visible": 30,
                "active_hidden": 25,
                "online_unknown": 15,
                "stale_hidden": 0,
                "offline": 0,
            }.get(activity, 0)
            score += tier
            if item.get("has_focus"):
                score += 5
            vis = (item.get("visibility_state") or item.get("visible") or "").strip()
            if vis == "visible":
                score += 3
            last_seen = float(item.get("last_seen") or 0)
            poll_ts = float(item.get("last_poll_at") or item.get("last_seen") or 0)
            candidates.append((score, last_seen, poll_ts, item))
        if not candidates:
            return None
        candidates.sort(key=lambda row: (row[0], row[1], row[2]), reverse=True)
        return dict(candidates[0][3])
    def _binding_status_details(self, session=None):
        session = session or self._current_session()
        status = self._last_bridge_status or {}
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        bound_client_id = (remote.get("client_id") or "").strip() or "-"
        bound_conv_id = (remote.get("conversation_id") or "").strip()
        if not bound_conv_id:
            bound_conv_id = parse_conversation_id(
                remote.get("conversation_url") or ""
            )
        bound_conv_id = bound_conv_id or "-"

        live_client = self._best_live_conversation_client(status)
        online_client_id = "-"
        online_conv_id = "-"
        if live_client:
            online_client_id = (live_client.get("client_id") or "").strip() or "-"
            online_conv_id = self._client_conversation_id(live_client) or "-"

        if not remote.get("enabled"):
            match = "未绑定"
        elif bound_client_id == "-" or online_client_id == "-":
            match = "无法比对"
        elif (
            bound_client_id == online_client_id
            and bound_conv_id == online_conv_id
        ):
            match = "一致"
        else:
            match = "不一致"

        return {
            "online_client_id": online_client_id,
            "online_conversation_id": online_conv_id,
            "bound_client_id": bound_client_id,
            "bound_conversation_id": bound_conv_id,
            "match": match,
            "live_client": live_client,
        }
    def _verify_send_target_binding(self, session, target_client_id, target_page_url):
        if not self._bind_each_chat_to_page:
            return target_client_id, target_page_url, True, ""

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return target_client_id, target_page_url, True, ""

        if self._session_has_wrong_existing_conversation_bind(session):
            return (
                "",
                "",
                False,
                "当前对话错误绑定到已有 ChatGPT 对话页。请点击“绑定当前页面”覆盖后重新发送。",
            )

        bind_state = self._effective_bind_state(session)
        if bind_state == BIND_STATE_PREBOUND_HOME:
            prebound_client = (
                remote.get("prebound_home_client_id") or remote.get("client_id") or ""
            ).strip()
            prebound_instance = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            target_client_id = (target_client_id or prebound_client).strip()
            if target_client_id != prebound_client:
                return (
                    "",
                    "",
                    False,
                    "目标页面不是当前对话预绑定的 ChatGPT 首页。",
                )
            home_client = self._find_prebound_home_client(remote)
            if not home_client:
                return (
                    "",
                    "",
                    False,
                    "预绑定的 ChatGPT 首页离线，请重新打开首页。",
                )
            home_url = (home_client.get("page_url") or target_page_url or CHATGPT_HOME_URL).strip()
            if prebound_instance and (
                home_client.get("page_instance_id") or ""
            ).strip() != prebound_instance:
                return (
                    "",
                    "",
                    False,
                    "预绑定首页的 page_instance_id 不一致，请重新绑定首页。",
                )
            home_page_type = (home_client.get("page_type") or "").strip()
            home_conv = (home_client.get("conversation_id") or "").strip()
            if home_page_type != "home" or home_conv:
                session_id = (session.session_id if session else "") or ""
                self._append_log(
                    f"[SEND][REJECT_BOOTSTRAP_TARGET] session_id={session_id} "
                    f"target_client_id={target_client_id or prebound_client} "
                    f"page_type={home_page_type or '-'} "
                    f"conversation_id={home_conv or '-'}"
                )
                return (
                    "",
                    "",
                    False,
                    "首条消息只能发送到空白 ChatGPT 首页，不能发送到已有对话页。",
                )
            ok_home, rej_code, det_home = tm_send_allowed(home_client)
            session_sid = (session.session_id if session else "") or ""
            if ok_home:
                act = (det_home or {}).get("activity", "")
                self._append_log(
                    f"[SEND][PAGE_ACTIVITY_CHECK] session_id={session_sid} "
                    f"client_id={target_client_id or prebound_client} "
                    f"conversation_id=- activity={act} allow=True"
                )
                return target_client_id, home_url, True, ""
            self._append_log(
                f"[SEND][PAGE_ACTIVITY_REJECT] session_id={session_sid} "
                f"reason=stale_hidden_or_offline code={rej_code} "
                f"poll_age={(det_home or {}).get('poll_age')} "
                f"seen_age={(det_home or {}).get('seen_age')}"
            )
            opener = getattr(self, "_open_page_once", None)
            if callable(opener):
                opener(home_url, "预绑定首页无活跃轮询，正在重新打开")
            return (
                "",
                "",
                False,
                "预绑定 ChatGPT 首页已无活跃轮询，已尝试重新打开页面，请待恢复后重试。",
            )

        if self._is_new_local_session_without_remote_conversation(session):
            target_client_id = (target_client_id or "").strip()
            client_info = (
                self._client_info_from_status(target_client_id)
                if target_client_id
                else None
            )
            if client_info:
                page_type = (client_info.get("page_type") or "").strip()
                conversation_id = self._client_conversation_id(client_info) or ""
                if page_type == "conversation" or conversation_id:
                    session_id = (session.session_id if session else "") or ""
                    self._append_log(
                        f"[SEND][REJECT_BOOTSTRAP_TARGET] session_id={session_id} "
                        f"target_client_id={target_client_id} "
                        f"page_type={page_type or 'conversation'} "
                        f"conversation_id={conversation_id or '-'}"
                    )
                    return (
                        "",
                        "",
                        False,
                        "新建对话的首条消息只能发送到空白 ChatGPT 首页。",
                    )
            return (
                "",
                "",
                False,
                "当前对话尚未绑定空白 ChatGPT 首页，请先发送首条消息。",
            )

        bound_client_id = (remote.get("client_id") or "").strip()
        bound_conv_id = (remote.get("conversation_id") or "").strip()
        if not bound_conv_id:
            bound_conv_id = parse_conversation_id(
                remote.get("conversation_url") or ""
            )
        bound_url = (remote.get("conversation_url") or "").strip()

        target_client_id = (target_client_id or "").strip()
        target_page_url = (target_page_url or "").strip()

        client_info = None
        if target_client_id:
            client_info = self._client_info_from_status(target_client_id)

        if client_info and client_info.get("online"):
            online_conv = self._client_conversation_id(client_info)
            online_url = (client_info.get("page_url") or "").strip()
            if bound_conv_id and online_conv and bound_conv_id != online_conv:
                session_id = (session.session_id if session else "") or ""
                self._append_log(
                    f"[SEND][BLOCK_WRONG_ACTIVE_PAGE] session_id={session_id} "
                    f"bound_conversation_id={bound_conv_id} "
                    f"active_conversation_id={online_conv} "
                    f"reason=target_client_conversation_mismatch"
                )
                return (
                    "",
                    "",
                    False,
                    "当前在线页面的 conversation_id 与绑定不一致，"
                    "请打开绑定的 ChatGPT 对话页后重试。",
                )
            if bound_url and online_url:
                same_url = bound_url.split("#")[0] == online_url.split("#")[0]
                same_conversation = bool(
                    bound_conv_id and online_conv and bound_conv_id == online_conv
                )
                if not same_url and not same_conversation:
                    return (
                        "",
                        "",
                        False,
                        "当前在线页面 URL 与绑定页面不一致，请先绑定当前页面。",
                    )
            ok_send, reject_code, det = tm_send_allowed(client_info)
            session_sid = (session.session_id if session else "") or ""
            if ok_send:
                act = (det or {}).get("activity", "")
                self._append_log(
                    f"[SEND][PAGE_ACTIVITY_CHECK] session_id={session_sid} "
                    f"client_id={target_client_id} "
                    f"conversation_id={online_conv or '-'} "
                    f"activity={act} allow=True"
                )
                return target_client_id, target_page_url, True, ""
            self._append_log(
                f"[SEND][PAGE_ACTIVITY_REJECT] session_id={session_sid} "
                f"reason=stale_hidden_or_offline code={reject_code} "
                f"poll_age={(det or {}).get('poll_age')} "
                f"seen_age={(det or {}).get('seen_age')} "
                f"activity={(det or {}).get('activity')}"
            )
            target_conv_url = self._bound_conversation_target_url(remote)
            opener = getattr(self, "_open_bound_conversation_url", None)
            if callable(opener) and target_conv_url:
                opener(target_conv_url, "")
            return (
                "",
                "",
                False,
                "绑定页面长时间无活跃轮询，已尝试重新打开对话页，请待页面恢复后重试。",
            )

        if bound_client_id and not self._is_client_online(bound_client_id):
            live = self._find_online_client_for_remote(remote)
            if live:
                live_id = (live.get("client_id") or "").strip()
                live_url = (live.get("page_url") or "").strip()
                self._log_bind_auto_rebind(session, live, reason="bound_offline")
                self._bind_page_to_session(session, live, silent=True)
                self._update_bound_page_display()
                return (
                    live_id,
                    live_url or bound_url,
                    True,
                    "绑定页面离线，发送前已自动换绑到同会话在线页面。",
                )
            if bound_conv_id:
                details = self._binding_status_details(session)
                live = details.get("live_client")
                live_conv = "-"
                if live:
                    live_conv = self._client_conversation_id(live) or "-"
                if live_conv != "-" and live_conv != bound_conv_id:
                    session_id = (session.session_id if session else "") or ""
                    self._append_log(
                        f"[SEND][BLOCK_WRONG_ACTIVE_PAGE] session_id={session_id} "
                        f"bound_conversation_id={bound_conv_id} "
                        f"active_conversation_id={live_conv} "
                        f"reason=bound_page_offline_reopen_required"
                    )
                return (
                    "",
                    "",
                    False,
                    "绑定的 ChatGPT 对话页离线，正在自动打开原对话页面...",
                )
            return (
                "",
                "",
                False,
                "绑定的 client_id 不在线，且未找到可用的同会话在线页面。",
            )

        return target_client_id, target_page_url, True, ""

