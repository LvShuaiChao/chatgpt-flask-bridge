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
    BIND_STATE_WAITING_HOME,
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

    def _remote_conversation_id(self, remote):
        remote = normalize_remote_chatgpt(remote)
        conversation_id = (remote.get("conversation_id") or "").strip()
        if conversation_id:
            return conversation_id
        return parse_conversation_id(
            remote.get("conversation_url")
            or remote.get("url")
            or remote.get("page_url")
            or ""
        ) or ""

    def _remote_conversation_url(self, remote):
        remote = normalize_remote_chatgpt(remote)
        url = (
            remote.get("conversation_url")
            or remote.get("url")
            or remote.get("page_url")
            or ""
        ).strip()
        conversation_id = self._remote_conversation_id(remote)
        if not url and conversation_id:
            return f"https://chatgpt.com/c/{conversation_id}"
        return url

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
        try:
            return short_page_display(url)
        except Exception as exc:
            print(
                f"[LOG_HELPER][SHORT_PAGE_DISPLAY_FAIL] url={url!r} error={exc!r}"
            )
            return str(url or "-")

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

    def _is_new_tm_page(self, item):
        if not isinstance(item, dict):
            return False
        conversation_id = self._client_conversation_id(item)
        if conversation_id:
            return False
        page_type = (item.get("page_type") or "").strip()
        if page_type == "home":
            return True
        page_url = (item.get("page_url") or "").strip()
        if page_url:
            try:
                parsed = urlparse(page_url)
            except ValueError:
                parsed = None
            if parsed is not None:
                path = (parsed.path or "/").rstrip("/") or "/"
                if path == "/":
                    return True
        page_title = (item.get("page_title") or "").strip().lower()
        if "new chat" in page_title:
            return True
        if not conversation_id and page_type in ("", "-", "ignored"):
            return True
        return False

    def _monkey_unbound_page_label(self, item):
        if not isinstance(item, dict):
            return "未知页面"
        page_type = (item.get("page_type") or "").strip()
        if page_type == "home":
            return "ChatGPT 首页"
        page_title = (item.get("page_title") or "").strip()
        if page_title:
            return page_title[:28]
        pathname = (item.get("pathname") or "").strip()
        if pathname and pathname not in ("/", "-"):
            short_path = pathname.strip("/")
            if short_path:
                return short_path[:28]
        if self._is_new_tm_page(item):
            return "新建 ChatGPT 页面"
        conv = self._client_conversation_id(item)
        if conv:
            return f"对话 {short_id(conv, length=8)}"
        return "ChatGPT 页面"

    @staticmethod
    def _format_monkey_label_list(labels, max_show=3):
        items = []
        seen = set()
        for raw in labels or []:
            text = str(raw or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            items.append(text)
        if not items:
            return "—"
        shown = items[:max_show]
        line = "、".join(shown)
        rest = len(items) - len(shown)
        if rest > 0:
            line += f" 等 {rest} 个"
        return line

    def _find_bound_session_for_tm_client(self, item):
        if not isinstance(item, dict):
            return None
        client_id = self._tm_client_id(item)
        page_instance_id = self._tm_page_instance_id(item)
        conversation_id = self._client_conversation_id(item)

        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote.get("enabled"):
                continue
            bind_state = self._remote_bind_state(remote)
            bound_client = (remote.get("client_id") or "").strip()
            bound_instance = (remote.get("page_instance_id") or "").strip()
            bound_conv = (remote.get("conversation_id") or "").strip()
            if not bound_conv:
                bound_conv = parse_conversation_id(
                    remote.get("conversation_url") or remote.get("url") or ""
                )
            prebound_client = (remote.get("prebound_home_client_id") or "").strip()
            prebound_instance = (
                remote.get("prebound_home_page_instance_id") or ""
            ).strip()
            reserved_client = (remote.get("reserved_client_id") or "").strip()
            reserved_instance = (remote.get("reserved_page_instance_id") or "").strip()

            def _instance_matches(expected):
                expected = (expected or "").strip()
                if not expected:
                    return True
                if not page_instance_id:
                    return True
                return page_instance_id == expected

            if client_id and client_id == bound_client and _instance_matches(bound_instance):
                return session
            if client_id and client_id == prebound_client and _instance_matches(prebound_instance):
                return session
            if client_id and client_id == reserved_client and _instance_matches(reserved_instance):
                return session
            if (
                conversation_id
                and bound_conv
                and conversation_id == bound_conv
                and bind_state
                in (
                    BIND_STATE_BOUND_CONVERSATION,
                    BIND_STATE_BOUND_OFFLINE,
                    BIND_STATE_WAITING_BOUND_CONVERSATION,
                )
            ):
                return session
            if (
                page_instance_id
                and bound_instance
                and page_instance_id == bound_instance
                and bind_state
                in (
                    BIND_STATE_BOUND_CONVERSATION,
                    BIND_STATE_BOUND_OFFLINE,
                    BIND_STATE_PREBOUND_HOME,
                    BIND_STATE_WAITING_CONVERSATION_CREATED,
                    BIND_STATE_WAITING_HOME,
                )
            ):
                return session
            if (
                page_instance_id
                and prebound_instance
                and page_instance_id == prebound_instance
            ):
                return session
        return None

    def _collect_monkey_window_binding_stats(self, status=None):
        import server as bridge_server

        status = status or self._last_bridge_status or {}
        filtered = []
        for item in self._iter_tm_clients(status):
            if bridge_server._is_ignored_page(item):
                continue
            filtered.append(item)

        total = len(filtered)
        new_count = 0
        bound_count = 0
        unbound_count = 0
        bound_labels = []
        unbound_labels = []
        seen_bound = set()
        seen_unbound = set()
        blank_home_total = 0
        blank_home_online = 0
        blank_home_bound = 0
        blank_home_available = 0
        blank_home_offline = 0
        blank_home_bound_labels = []
        blank_home_available_labels = []
        seen_blank_bound = set()
        seen_blank_available = set()

        for item in filtered:
            is_new_page = self._is_new_tm_page(item)
            session = self._find_bound_session_for_tm_client(item)
            if is_new_page:
                new_count += 1
                blank_home_total += 1
                if item.get("online"):
                    blank_home_online += 1
                else:
                    blank_home_offline += 1
                if session is not None:
                    blank_home_bound += 1
                    title = (session.title or session.session_id or "对话").strip()
                    if title not in seen_blank_bound:
                        seen_blank_bound.add(title)
                        blank_home_bound_labels.append(title)
                elif item.get("online"):
                    blank_home_available += 1
                    label = self._monkey_unbound_page_label(item)
                    if label not in seen_blank_available:
                        seen_blank_available.add(label)
                        blank_home_available_labels.append(label)
            if session is not None:
                bound_count += 1
                title = (session.title or session.session_id or "对话").strip()
                if title not in seen_bound:
                    seen_bound.add(title)
                    bound_labels.append(title)
                continue
            if item.get("online"):
                unbound_count += 1
                label = self._monkey_unbound_page_label(item)
                if label not in seen_unbound:
                    seen_unbound.add(label)
                    unbound_labels.append(label)

        return {
            "total": total,
            "new_count": new_count,
            "bound_count": bound_count,
            "unbound_count": unbound_count,
            "bound_labels": bound_labels,
            "unbound_labels": unbound_labels,
            "blank_home_total": blank_home_total,
            "blank_home_online": blank_home_online,
            "blank_home_offline": blank_home_offline,
            "blank_home_bound": blank_home_bound,
            "blank_home_available": blank_home_available,
            "blank_home_bound_labels": blank_home_bound_labels,
            "blank_home_available_labels": blank_home_available_labels,
        }

    def build_monkey_binding_summary_text(self, stats=None):
        stats = stats or self._collect_monkey_window_binding_stats()
        blank_total = int(stats.get("blank_home_total") or 0)
        blank_online = int(stats.get("blank_home_online") or 0)
        blank_available = int(stats.get("blank_home_available") or 0)
        blank_bound = int(stats.get("blank_home_bound") or 0)
        window_line = (
            "窗口统计："
            f"总数 {stats.get('total', 0)}｜"
            f"空白页 {blank_online}/{blank_total}｜"
            f"空白可用 {blank_available}｜"
            f"空白已绑 {blank_bound}｜"
            f"已绑定 {stats.get('bound_count', 0)}｜"
            f"未绑定 {stats.get('unbound_count', 0)}"
        )
        bound_text = self._format_monkey_label_list(stats.get("bound_labels") or [])
        unbound_text = self._format_monkey_label_list(stats.get("unbound_labels") or [])
        detail_line = f"绑定明细：已绑定：{bound_text}｜未绑定：{unbound_text}"
        return window_line, detail_line

    def _update_tm_blank_home_label(self, status=None, monkey_stats=None):
        if not hasattr(self, "tm_blank_home_label"):
            return
        monkey_stats = monkey_stats or self._collect_monkey_window_binding_stats(status)
        blank_total = int(monkey_stats.get("blank_home_total") or 0)
        blank_online = int(monkey_stats.get("blank_home_online") or 0)
        blank_available = int(monkey_stats.get("blank_home_available") or 0)
        blank_bound = int(monkey_stats.get("blank_home_bound") or 0)
        self.tm_blank_home_label.setText(
            f"空白页：{blank_online}/{blank_total}｜可用{blank_available}｜已绑{blank_bound}"
        )
        if blank_available > 0:
            self._refresh_status_chip(self.tm_blank_home_label, "ok")
        elif blank_online > 0:
            self._refresh_status_chip(self.tm_blank_home_label, "warn")
        else:
            self._refresh_status_chip(self.tm_blank_home_label, "")
        available_text = self._format_monkey_label_list(
            monkey_stats.get("blank_home_available_labels") or []
        )
        bound_text = self._format_monkey_label_list(
            monkey_stats.get("blank_home_bound_labels") or []
        )
        self.tm_blank_home_label.setToolTip(
            "空白 ChatGPT 首页统计\n"
            f"在线/总数：{blank_online}/{blank_total}\n"
            f"可用空白页：{blank_available}\n"
            f"已绑定/预绑定空白页：{blank_bound}\n"
            f"可用列表：{available_text}\n"
            f"已绑列表：{bound_text}"
        )

    def update_monkey_binding_summary(self, status=None, monkey_stats=None):
        if not hasattr(self, "monkey_window_summary_label"):
            return
        monkey_stats = monkey_stats or self._collect_monkey_window_binding_stats(status)
        window_line, detail_line = self.build_monkey_binding_summary_text(monkey_stats)
        self.monkey_window_summary_label.setText(window_line)
        self.monkey_binding_summary_label.setText(detail_line)
