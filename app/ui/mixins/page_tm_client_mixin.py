"""油猴客户端遍历、URL 摘要与绑定状态基础判断。"""

import time
from urllib.parse import urlparse

from app.constants import TM_HEARTBEAT_ONLINE_SECONDS
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.text_utils import short_id, short_page_display
from app.utils.tm_activity import classify_tm_client_activity, compute_tm_activity_metrics


class PageTmClientMixin:
    @staticmethod
    def _normalize_visibility_state(item):
        raw = (item.get("visibility_state") or item.get("visible") or "").strip().lower()
        if raw in ("true", "1"):
            return "visible"
        if raw in ("false", "0"):
            return "hidden"
        return raw

    @staticmethod
    def _age_from_ts(ts):
        try:
            value = float(ts or 0)
        except (TypeError, ValueError):
            return -1.0
        if value <= 0:
            return -1.0
        return max(0.0, time.time() - value)

    def _tm_client_sync_profile(
        self,
        item,
        *,
        expected_client_id="",
        expected_conversation_id="",
    ):
        expected_client_id = (expected_client_id or "").strip()
        expected_conversation_id = (expected_conversation_id or "").strip()
        if not isinstance(item, dict):
            return {
                "online": False,
                "syncable": False,
                "stale": False,
                "state": "offline",
                "reason": "invalid_client",
            }
        client_id = (item.get("client_id") or "").strip()
        conversation_id = self._client_conversation_id(item)
        visibility = self._normalize_visibility_state(item)
        activity = classify_tm_client_activity(item)
        _, seen_age, _, _ = compute_tm_activity_metrics(item)
        heartbeat_age = self._age_from_ts(item.get("last_heartbeat_at"))
        if heartbeat_age < 0:
            heartbeat_age = self._age_from_ts(item.get("last_seen"))
        last_seen_age = self._age_from_ts(item.get("last_seen"))
        online = bool(seen_age <= TM_HEARTBEAT_ONLINE_SECONDS)
        client_match = not expected_client_id or client_id == expected_client_id
        conv_match = not expected_conversation_id or conversation_id == expected_conversation_id
        input_ok = bool(item.get("can_accept_input", True))
        active_visible = visibility == "visible" and activity in (
            "active_visible",
            "active_focused",
        )
        stale = bool(
            online and (
                visibility == "hidden"
                or activity in ("active_hidden", "stale_hidden")
            )
        )
        syncable = bool(online and client_match and conv_match and active_visible and input_ok)
        reason = ""
        if not online:
            reason = "offline"
        elif not client_match:
            reason = "client_mismatch"
        elif not conv_match:
            reason = "conversation_mismatch"
        elif stale:
            reason = "stale_hidden"
        elif not input_ok:
            reason = "input_unavailable"
        state = "offline"
        if online:
            state = "online"
        if stale:
            state = "stale"
        if syncable:
            state = "syncable"
        return {
            "client_id": client_id,
            "conversation_id": conversation_id,
            "visibility": visibility or "-",
            "activity": activity or "-",
            "online": online,
            "syncable": syncable,
            "stale": stale,
            "state": state,
            "reason": reason,
            "client_match": client_match,
            "conversation_match": conv_match,
            "input_ok": input_ok,
            "heartbeat_age": round(heartbeat_age, 3) if heartbeat_age >= 0 else -1.0,
            "last_seen_age": round(last_seen_age, 3) if last_seen_age >= 0 else -1.0,
        }

    def _pick_best_client_for_conversation(self, conversation_id, status=None):
        conversation_id = (conversation_id or "").strip()
        if not conversation_id:
            return None
        status = status or self._last_bridge_status or {}
        candidates = []
        for item in self._iter_tm_clients(status, online_only=False):
            if self._client_conversation_id(item) != conversation_id:
                continue
            profile = self._tm_client_sync_profile(item)
            visibility_rank = 1 if profile.get("visibility") == "visible" else 0
            focus_rank = 1 if item.get("has_focus") else 0
            hb_age = profile.get("heartbeat_age")
            seen_age = profile.get("last_seen_age")
            hb_rank = -hb_age if isinstance(hb_age, (int, float)) and hb_age >= 0 else -999999.0
            seen_rank = -seen_age if isinstance(seen_age, (int, float)) and seen_age >= 0 else -999999.0
            candidates.append((visibility_rank, focus_rank, hb_rank, seen_rank, item))
        if not candidates:
            return None
        candidates.sort(key=lambda row: (row[0], row[1], row[2], row[3]), reverse=True)
        return dict(candidates[0][4])

    def _iter_tm_clients(self, status=None, *, online_only=False, bindable_only=False, page_type=""):
        status = status or self._last_bridge_status or {}
        clients = status.get("tampermonkey_clients") or []

        for item in clients:
            if not isinstance(item, dict):
                continue

            client_id = (item.get("client_id") or "").strip()
            if not client_id:
                continue

            if online_only and not item.get("online"):
                continue

            if page_type:
                current_page_type = (item.get("page_type") or "").strip()
                if current_page_type != page_type:
                    continue

            if bindable_only:
                page_url = (item.get("page_url") or "").strip()
                if not self._is_bindable_chatgpt_url(page_url):
                    continue

            yield item

    def _tm_client_conversation_id(self, item):
        if not isinstance(item, dict):
            return ""
        conversation_id = (item.get("conversation_id") or "").strip()
        if conversation_id:
            return conversation_id
        return parse_conversation_id((item.get("page_url") or "").strip()) or ""

    def _tm_client_id(self, item):
        if not isinstance(item, dict):
            return ""
        return (item.get("client_id") or "").strip()

    def _tm_page_instance_id(self, item):
        if not isinstance(item, dict):
            return ""
        return (item.get("page_instance_id") or "").strip()

    def _tm_page_url(self, item):
        if not isinstance(item, dict):
            return ""
        return (item.get("page_url") or "").strip()

    @staticmethod
    def _remote_bind_state(remote):
        return normalize_remote_chatgpt(remote).get("bind_state") or BIND_STATE_UNBOUND

    def _effective_bind_state(self, session):
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        state = self._remote_bind_state(remote)
        if not remote.get("enabled"):
            return BIND_STATE_UNBOUND
        if state == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return BIND_STATE_WAITING_BOUND_CONVERSATION
        if state in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        ):
            if self._session_has_prebound_home_online(remote):
                return state
            return BIND_STATE_BOUND_OFFLINE
        if state == BIND_STATE_BOUND_CONVERSATION:
            if self._session_has_sendable_bound_page(remote):
                return BIND_STATE_BOUND_CONVERSATION
            return BIND_STATE_BOUND_OFFLINE
        return state

    @staticmethod
    def _short_page_display(url):
        return short_page_display(url)

    @staticmethod
    def _format_last_seen_ago(last_seen):
        if not last_seen:
            return "-"
        try:
            seconds = max(0, int(time.time() - float(last_seen)))
        except (TypeError, ValueError):
            return "-"
        if seconds < 1:
            return "刚刚"
        return f"{seconds}秒前"

    @staticmethod
    def _short_conv_id(conversation_id):
        return short_id(conversation_id, length=12)

    @staticmethod
    def _is_persistable_page_url(url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return False
        lower = raw.lower()
        if not (lower.startswith("http://") or lower.startswith("https://")):
            return False
        noisy_fragments = (
            "/backend-api/",
            "/sentinel/",
            "frame.html",
            "/oauth",
            "challenge-platform",
        )
        if any(fragment in lower for fragment in noisy_fragments):
            return False
        return True

    @staticmethod
    def _is_bindable_chatgpt_url(url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return False
        if not PageTmClientMixin._is_persistable_page_url(raw):
            return False
        try:
            parsed = urlparse(raw)
        except ValueError:
            return False
        host = (parsed.netloc or "").lower()
        if host not in (
            "chatgpt.com",
            "www.chatgpt.com",
            "chat.openai.com",
            "www.chat.openai.com",
        ):
            return False
        path = parsed.path or "/"
        if path in ("", "/"):
            return True
        if path.startswith("/c/"):
            return True
        return False

    def _client_info_by_id(self, client_id, status=None):
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        status = status or self._last_bridge_status or {}
        for item in self._iter_tm_clients(status):
            if self._tm_client_id(item) == client_id:
                return item
        return None

    def _client_info_from_status(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        item = self._client_info_by_id(client_id)
        if item:
            return dict(item)
        return {"client_id": client_id, "page_url": ""}

    def _is_client_online(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return False
        for item in self._iter_tm_clients(self._last_bridge_status):
            if self._tm_client_id(item) == client_id:
                return bool(item.get("online"))
        return False

    def _client_conversation_id(self, client_info):
        if not isinstance(client_info, dict):
            return ""
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if conversation_id and conversation_id != "-":
            return conversation_id
        return self._tm_client_conversation_id(client_info)
