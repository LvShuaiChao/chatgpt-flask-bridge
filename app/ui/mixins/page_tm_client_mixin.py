"""油猴客户端遍历、URL 摘要与绑定状态基础判断。"""

import time
import traceback
from urllib.parse import urlsplit, urlunsplit, urlparse

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
from app.utils.page_status import (
    classify_page_state,
    evaluate_send_page,
    explain_page_decision,
    get_page_liveness,
    can_sync_conversation,
    is_conversation_syncable,
    is_dialog_ready_page,
    is_page_online,
    is_page_syncable,
    is_page_url_syncable,
    is_prebound_home_page,
    page_registry_key,
    page_url_from,
)
from app.utils.tm_activity import (
    classify_tm_client_activity,
    compute_tm_activity_metrics,
    tm_send_allowed,
)


class PageTmClientMixin:
    def _page_is_online_for_ui(self, page):
        """UI 展示用在线判断：与下拉框 [在线] 文案、绿色样式共用，含 recently_seen。"""
        if not isinstance(page, dict):
            return False
        state = str(
            page.get("liveness")
            or page.get("page_liveness")
            or page.get("state")
            or ""
        ).strip().lower()
        if state in {
            "online",
            "recently_seen",
            "active",
            "active_visible",
            "active_hidden",
        }:
            return True
        if page.get("online") is True:
            return True
        liveness = get_page_liveness(page)
        if liveness in ("online", "recently_seen"):
            return True
        last_seen = float(
            page.get("last_seen")
            or page.get("last_heartbeat_at")
            or page.get("last_poll_at")
            or 0
        )
        if last_seen > 0:
            return time.time() - last_seen <= TM_HEARTBEAT_ONLINE_SECONDS
        return False

    def _tm_page_is_online_simple(self, item):
        """仅按心跳 last_seen 判断在线（统一 get_page_liveness == online）。"""
        liveness = get_page_liveness(item)
        if liveness != "online" and isinstance(item, dict):
            client_id = (item.get("client_id") or "-").strip() or "-"
            last_key = getattr(self, "_last_page_liveness_log_key", None)
            key = (client_id, liveness)
            if key != last_key and hasattr(self, "_append_log"):
                self._last_page_liveness_log_key = key
                self._append_log(
                    f"[PAGE_LIVENESS][STATE] client_id={client_id} "
                    f"state={liveness}",
                    echo=False,
                )
        return liveness == "online"

    def _page_url_from_item(self, item):
        if not isinstance(item, dict):
            return ""
        return page_url_from(item)

    def _is_dialog_ready_page(self, item):
        """可同步对话页（统一 app.utils.page_status.is_dialog_ready_page）。"""
        return is_dialog_ready_page(item)

    def _is_prebound_home_page(self, item):
        """首页预绑定（统一 app.utils.page_status.is_prebound_home_page）。"""
        return is_prebound_home_page(item)

    def _classify_page_state(self, item, *, log=True):
        classified = (
            classify_page_state(item) if isinstance(item, dict) else {}
        )
        online = bool(classified.get("online"))
        dialog_ready = bool(classified.get("dialog_ready"))
        prebound_home = bool(classified.get("prebound_home"))
        if log and isinstance(item, dict):
            client_id = (item.get("client_id") or "-").strip() or "-"
            page_type = (item.get("page_type") or "-").strip() or "-"
            conversation_id = (
                item.get("conversation_id")
                or item.get("chatgpt_conversation_id")
                or self._client_conversation_id(item)
                or "-"
            )
            url = self._page_url_from_item(item) or "-"
            key = (
                client_id,
                page_type,
                conversation_id,
                url,
                online,
                dialog_ready,
                prebound_home,
            )
            last = getattr(self, "_last_page_state_classify_key", None)
            if key != last:
                self._last_page_state_classify_key = key
                self._append_log(
                    "[PAGE_STATE][CLASSIFY] "
                    f"client_id={client_id} "
                    f"page_type={page_type} "
                    f"conversation_id={conversation_id} "
                    f"url={url} "
                    f"online={'true' if online else 'false'} "
                    f"dialog_ready={'true' if dialog_ready else 'false'} "
                    f"prebound_home={'true' if prebound_home else 'false'}",
                    echo=False,
                )
        return {
            "online": online,
            "dialog_ready": dialog_ready,
            "prebound_home": prebound_home,
        }

    def _find_online_page_by_conversation_id(self, conversation_id, status=None):
        return self._find_online_tm_client_by_conversation_id(
            conversation_id, status=status, sync_only=False
        )

    def _get_selected_tm_page_from_combo(self, status=None):
        status = status or self._last_bridge_status or {}
        if hasattr(self, "tm_page_combo") and self.tm_page_combo.count() > 0:
            idx = self.tm_page_combo.currentIndex()
            if idx >= 0 and hasattr(self, "_tm_page_combo_page_from_index"):
                page = self._tm_page_combo_page_from_index(idx)
                if isinstance(page, dict):
                    return page
        client_id = ""
        if hasattr(self, "_selected_tm_page_client_id"):
            client_id = (self._selected_tm_page_client_id() or "").strip()
        if client_id:
            return self._find_tm_client_by_client_id(client_id, status=status)
        return None

    def _get_current_or_recent_online_tm_page(self, status=None):
        status = status or self._last_bridge_status or {}
        for getter in (
            lambda: self._pick_current_page_client_info(status),
            lambda: self._find_focused_tm_page(status),
        ):
            info = getter()
            if self._tm_page_is_online_simple(info):
                return info
        last_focus_info, _last_focus_age = self._find_last_focused_tm_page(status=status)
        if (
            isinstance(last_focus_info, dict)
            and last_focus_info.get("realtime") is not False
            and self._tm_page_is_online_simple(last_focus_info)
        ):
            return last_focus_info
        best = None
        best_seen = 0.0
        for item in self._iter_tm_clients(status, online_only=False):
            if not self._tm_page_is_online_simple(item):
                continue
            seen = max(
                self._tm_float_field(
                    item,
                    "last_seen",
                    0,
                    context="_get_current_or_recent_online_tm_page",
                ),
                self._tm_float_field(
                    item,
                    "last_heartbeat_at",
                    0,
                    context="_get_current_or_recent_online_tm_page",
                ),
                self._tm_float_field(
                    item,
                    "last_poll_at",
                    0,
                    context="_get_current_or_recent_online_tm_page",
                ),
            )
            if seen >= best_seen:
                best_seen = seen
                best = item
        return best

    @staticmethod
    def _normalize_visibility_state(item):
        raw = (item.get("visibility_state") or item.get("visible") or "").strip().lower()
        if raw in ("true", "1"):
            return "visible"
        if raw in ("false", "0"):
            return "hidden"
        return raw

    def _age_from_ts(self, ts, *, context=""):
        try:
            value = float(ts or 0)
        except (TypeError, ValueError) as error:
            if (
                context
                and hasattr(self, "_is_debug_mode_enabled")
                and self._is_debug_mode_enabled()
                and hasattr(self, "_append_log")
            ):
                self._append_log(
                    "[TM_PAGE][AGE_TS_PARSE_FAILED] "
                    f"context={context} ts={ts!r} "
                    f"error_type={type(error).__name__} error={error}",
                    echo=False,
                )
            return -1.0
        if value <= 0:
            return -1.0
        return max(0.0, time.time() - value)

    def _tm_float_field(self, item, field, default=0.0, *, context=""):
        item_dict = item if isinstance(item, dict) else {}
        raw = item_dict.get(field) if item_dict else None
        try:
            return float(raw if raw not in (None, "") else default)
        except (TypeError, ValueError) as error:
            if hasattr(self, "_append_log"):
                self._append_log(
                    "[TM_PAGE][FLOAT_FIELD_FALLBACK] "
                    f"context={context or '-'} "
                    f"field={field} value={raw!r} default={default!r} "
                    f"client_id={item_dict.get('client_id') or '-'} "
                    f"page_instance_id={item_dict.get('page_instance_id') or '-'} "
                    f"error_type={type(error).__name__} error={error}",
                    echo=False,
                )
            return float(default)

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
                "sendable": False,
                "sync_readable": False,
                "syncable": False,
                "stale": False,
                "state": "offline",
                "reason": "invalid_client",
                "responding": False,
                "input_ok": False,
            }

        client_id = (item.get("client_id") or "").strip()
        conversation_id = self._client_conversation_id(item)
        visibility = self._normalize_visibility_state(item)
        activity = classify_tm_client_activity(item)

        _, seen_age, poll_age, _ = compute_tm_activity_metrics(item)

        heartbeat_age = self._age_from_ts(
            item.get("last_heartbeat_at"),
            context="last_heartbeat_at",
        )
        if heartbeat_age < 0:
            heartbeat_age = self._age_from_ts(
                item.get("last_seen"),
                context="last_seen",
            )

        last_seen_age = self._age_from_ts(item.get("last_seen"), context="last_seen")

        decision = explain_page_decision(item, action="sync")
        send_decision, send_block_reason = evaluate_send_page(
            item,
            expected_conversation_id=expected_conversation_id,
        )

        client_match = not expected_client_id or client_id == expected_client_id
        conv_match = not expected_conversation_id or conversation_id == expected_conversation_id
        online = bool(decision.get("online"))
        dialog_ready = bool(decision.get("dialog_ready"))
        prebound_home = bool(decision.get("prebound_home"))
        conversation_syncable = bool(decision.get("conversation_syncable"))
        syncable = bool(decision.get("syncable"))
        sendable = bool(
            online
            and client_match
            and conv_match
            and send_decision == "allowed"
        )
        queueable = bool(
            online
            and client_match
            and conv_match
            and send_decision == "queued"
        )

        responding = bool(item.get("is_responding") or item.get("responding"))
        if isinstance(item.get("responding"), str):
            responding = item.get("responding").lower() in (
                "yes",
                "true",
                "1",
                "generating",
            )
        response_state = str(item.get("response_state") or "").lower()
        if response_state == "generating":
            responding = True

        input_ok = bool(item.get("can_accept_input", True))

        reason = (decision.get("blocked_reason") or "").strip()
        if not reason:
            if not online:
                reason = "offline"
            elif not client_match:
                reason = "client_mismatch"
            elif not conv_match:
                reason = "conversation_mismatch"
            elif not dialog_ready:
                reason = "not_dialog_ready"

        stale = bool(online and activity in ("stale_hidden",))
        state = "offline"
        if online:
            state = "online"
        if prebound_home:
            state = "prebound_home"
        if stale:
            state = "stale"
        if conversation_syncable and dialog_ready:
            state = "syncable"
        if sendable and dialog_ready:
            state = "sendable"
        if queueable:
            state = "queueable"

        return {
            "client_id": client_id,
            "conversation_id": conversation_id,
            "visibility": visibility or "-",
            "activity": activity or "-",
            "online": online,
            "sendable": sendable,
            "queueable": queueable,
            "sync_readable": conversation_syncable,
            "syncable": syncable,
            "can_sync_conversation": conversation_syncable,
            "url_syncable": bool(decision.get("url_syncable")),
            "conversation_syncable": conversation_syncable,
            "dialog_ready": dialog_ready,
            "prebound_home": prebound_home,
            "blocked_reason": reason,
            "stale": stale,
            "state": state,
            "reason": reason,
            "send_reason": send_block_reason or "",
            "send_decision": send_decision,
            "client_match": client_match,
            "conversation_match": conv_match,
            "input_ok": input_ok,
            "responding": responding,
            "page_type": (item.get("page_type") or "").strip(),
            "heartbeat_age": round(heartbeat_age, 3) if heartbeat_age >= 0 else -1.0,
            "last_seen_age": round(last_seen_age, 3) if last_seen_age >= 0 else -1.0,
            "poll_age": round(poll_age, 3) if poll_age >= 0 else -1.0,
        }

    def _is_chatgpt_home_url_for_binding(self, page_url):
        url = (page_url or "").strip()
        if not url:
            return True
        if "xz_bind_token=" in url:
            return True
        try:
            parsed = urlparse(url)
        except ValueError as exc:
            self._append_log(
                "[TM_PAGE][NORMALIZE][URL_PARSE_FAIL] "
                f"url={url} error={exc}",
                echo=True,
            )
            return False
        path = (parsed.path or "/").rstrip("/") or "/"
        host = (parsed.netloc or "").lower()
        if host in ("chatgpt.com", "chat.openai.com", "www.chatgpt.com") and path == "/":
            return True
        return False

    def _normalize_tm_page_for_binding(self, item):
        """绑定前归一化页面字段：/c/ 对话页优先于 xz_bind_token 首页地址。"""
        if not isinstance(item, dict):
            return {}
        client_id = (item.get("client_id") or "").strip()
        page_instance_id = (item.get("page_instance_id") or "").strip()
        page_url = page_url_from(item)
        conversation_id = (
            item.get("conversation_id")
            or item.get("chatgpt_conversation_id")
            or ""
        ).strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(page_url)
        if conversation_id:
            page_url = f"https://chatgpt.com/c/{conversation_id}"
            page_type = "conversation"
        elif self._is_chatgpt_home_url_for_binding(page_url):
            page_type = "home"
        else:
            page_type = (item.get("page_type") or "").strip() or "home"
        return {
            "client_id": client_id,
            "page_instance_id": page_instance_id,
            "conversation_id": conversation_id,
            "url": page_url,
            "page_type": page_type,
            "bound_at": time.time(),
        }

    def _tm_page_identity_fields(self, item):
        if not isinstance(item, dict):
            return {
                "client_id": "",
                "page_instance_id": "",
                "conversation_id": "",
                "url": "",
            }
        norm = self._normalize_tm_page_for_binding(item)
        return {
            "client_id": norm.get("client_id") or "",
            "page_instance_id": norm.get("page_instance_id") or "",
            "conversation_id": norm.get("conversation_id") or "",
            "url": norm.get("url") or "",
        }

    def _tm_client_bindable(self, item):
        """手动绑定必须使用实时在线页面，避免绑定到历史快照或离线页。"""
        if not isinstance(item, dict):
            return False, "invalid_page"
        if item.get("realtime") is False:
            return False, "not_realtime_page"
        if not self._tm_page_is_online_simple(item):
            return False, "offline"
        identity = self._tm_page_identity_fields(item)
        if any(
            identity.get(key)
            for key in ("client_id", "page_instance_id", "conversation_id", "url")
        ):
            return True, ""
        return False, "missing_page_identity"

    def _find_online_tm_client_by_conversation_id(
        self, conversation_id, status=None, *, sync_only=False
    ):
        """按 conversation_id 查找在线页面（与 sync/send 共用 _pick_best_conversation_page）。"""
        conversation_id = (conversation_id or "").strip()
        if not conversation_id:
            return None
        if hasattr(self, "_pick_best_conversation_page"):
            item = self._pick_best_conversation_page(conversation_id, status=status)
            if not isinstance(item, dict):
                return None
            if sync_only:
                profile = self._tm_client_sync_profile(
                    item, expected_conversation_id=conversation_id
                )
                if not (profile.get("sync_readable") or profile.get("syncable")):
                    return None
            return item
        status = status or self._last_bridge_status or {}
        candidates = []
        for item in self._iter_tm_clients(status, online_only=False):
            item_conv = self._client_conversation_id(item)
            if item_conv != conversation_id:
                continue
            if not self._tm_page_is_online_simple(item):
                continue
            if sync_only:
                profile = self._tm_client_sync_profile(
                    item, expected_conversation_id=conversation_id
                )
                if not (profile.get("sync_readable") or profile.get("syncable")):
                    continue
            poll_age = self._age_from_ts(
                item.get("last_poll_at"),
                context="last_poll_at",
            )
            if poll_age < 0:
                poll_age = self._age_from_ts(
                    item.get("last_seen"),
                    context="last_seen",
                )
            if poll_age < 0:
                poll_age = 999999.0
            last_seen = max(
                self._tm_float_field(
                    item,
                    "last_seen",
                    0,
                    context="_find_tm_client_by_conversation_id",
                ),
                self._tm_float_field(
                    item,
                    "last_heartbeat_at",
                    0,
                    context="_find_tm_client_by_conversation_id",
                ),
            )
            candidates.append((last_seen, poll_age, item))
        if not candidates:
            return None
        candidates.sort(key=lambda row: (-row[0], row[1]))
        return dict(candidates[0][2])

    def _count_online_sync_clients_by_conversation_id(
        self, conversation_id, status=None
    ):
        conversation_id = (conversation_id or "").strip()
        if not conversation_id:
            return 0
        status = status or self._last_bridge_status or {}
        count = 0
        for item in self._iter_tm_clients(status, online_only=False):
            if self._client_conversation_id(item) != conversation_id:
                continue
            if self._tm_page_is_online_simple(item):
                count += 1
        return count

    def _normalize_chatgpt_page_url(self, url):
        text = str(url or "").strip()
        if not text:
            return ""
        if "#xz_reopen_token=" in text:
            text = text.split("#xz_reopen_token=", 1)[0]
        parts = urlsplit(text)
        scheme = (parts.scheme or "https").lower()
        netloc = parts.netloc.lower()
        path = parts.path.rstrip("/")
        return urlunsplit((scheme, netloc, path, "", ""))

    def _choose_better_page_record(self, old, new):
        def score(page):
            if not isinstance(page, dict):
                return 0
            value = 0
            if page.get("is_bound") or page.get("bound"):
                value += 100
            if page.get("is_current_session") or page.get("current_session"):
                value += 80
            if page.get("is_focused") or page.get("focused") or page.get("has_focus"):
                value += 60
            if page.get("is_active") or page.get("active"):
                value += 40
            if page.get("is_online") or page.get("online"):
                value += 20
            title = str(page.get("title") or "").strip()
            page_url = str(
                page.get("url")
                or page.get("href")
                or page.get("page_url")
                or ""
            ).strip()
            if title:
                value += 5
            if page_url:
                value += 5
            updated_at = (
                page.get("updated_at")
                or page.get("ts")
                or page.get("timestamp")
                or 0
            )
            if isinstance(updated_at, (int, float)):
                value += min(int(updated_at), 10)
            return value

        old_score = score(old)
        new_score = score(new)
        if new_score > old_score:
            merged = dict(old)
            merged.update(new)
        else:
            merged = dict(new)
            merged.update(old)
        if "_normalized_url" not in merged:
            merged["_normalized_url"] = self._normalize_chatgpt_page_url(
                str(
                    merged.get("url")
                    or merged.get("href")
                    or merged.get("page_url")
                    or ""
                )
            )
        return merged

    def _annotate_pages_for_url_dedup(self, pages, status=None):
        if not pages:
            return
        status = status or getattr(self, "_last_bridge_status", None) or {}
        current_client_id = str(status.get("tampermonkey_client_id") or "").strip()
        bound_page_instance_id = ""
        resolved_bound_client_id = ""
        bound_conversation_id = ""
        # 仅从 session.remote 读取绑定字段，勿调用 _resolve_bound_page_info：
        # 后者会通过 _find_online_page_by_conversation_id → _iter_tm_clients
        # → _extract_tm_pages_from_status → 本方法 形成无限递归。
        session = self._current_session() if hasattr(self, "_current_session") else None
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote.get("enabled"):
                resolved_bound_client_id = (remote.get("client_id") or "").strip()
                bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
                if hasattr(self, "_remote_conversation_id"):
                    bound_conversation_id = self._remote_conversation_id(remote) or ""
                else:
                    bound_conversation_id = (remote.get("conversation_id") or "").strip()

        for page in pages:
            if not isinstance(page, dict):
                continue
            client_id = (page.get("client_id") or "").strip()
            item_instance = (page.get("page_instance_id") or "").strip()
            item_conv = self._tm_client_conversation_id(page)
            is_bound = bool(
                bound_page_instance_id
                and item_instance
                and item_instance == bound_page_instance_id
            ) or bool(
                resolved_bound_client_id
                and client_id
                and client_id == resolved_bound_client_id
            ) or bool(
                bound_conversation_id
                and item_conv
                and item_conv == bound_conversation_id
            )
            page["is_bound"] = is_bound
            page["is_current_session"] = bool(
                current_client_id and client_id and client_id == current_client_id
            )
            page["is_focused"] = (
                self._page_has_focus(page)
                if hasattr(self, "_page_has_focus")
                else False
            )
            page["is_online"] = self._tm_page_is_online_simple(page)

    def _dedupe_chatgpt_pages(self, pages):
        if not pages:
            return []
        deduped = {}
        duplicate_urls = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            raw_url = str(
                page.get("url")
                or page.get("href")
                or page.get("page_url")
                or ""
            ).strip()
            norm_url = self._normalize_chatgpt_page_url(raw_url)
            page_id = str(
                page.get("page_id")
                or page.get("id")
                or page.get("window_id")
                or ""
            ).strip()
            key = norm_url or f"page_id:{page_id}"
            if not key:
                continue
            old = deduped.get(key)
            if old is None:
                new_page = dict(page)
                new_page["_normalized_url"] = norm_url
                deduped[key] = new_page
                continue
            duplicate_urls.append(norm_url or key)
            deduped[key] = self._choose_better_page_record(old, page)

        unique_pages = list(deduped.values())
        raw_count = len([p for p in pages if isinstance(p, dict)])
        duplicate_count = max(0, raw_count - len(unique_pages))
        if hasattr(self, "_append_log"):
            self._append_log(
                "[PAGE_LIST][DEDUP] "
                f"raw={raw_count} unique={len(unique_pages)} duplicate={duplicate_count}",
                echo=False,
            )
            if duplicate_count and (
                not hasattr(self, "_is_debug_mode_enabled")
                or self._is_debug_mode_enabled()
            ):
                seen_urls = set()
                for norm in duplicate_urls:
                    if not norm or norm in seen_urls:
                        continue
                    seen_urls.add(norm)
                    kept = deduped.get(norm) or deduped.get(f"page_id:{norm}")
                    if not isinstance(kept, dict):
                        kept = next(
                            (
                                item
                                for item in unique_pages
                                if item.get("_normalized_url") == norm
                            ),
                            None,
                        )
                    keep_title = (
                        str(kept.get("title") or "").strip() if isinstance(kept, dict) else ""
                    )
                    self._append_log(
                        "[PAGE_LIST][DEDUP_DUPLICATE] "
                        f"url={norm} keep_title={keep_title!r}",
                        echo=False,
                    )
        return unique_pages

    def _extract_tm_pages_from_status(self, status=None):
        status = status or getattr(self, "_last_bridge_status", None) or {}
        pages = []
        candidate_keys = (
            "clients",
            "tm_clients",
            "tampermonkey_clients",
            "pages",
            "tm_pages",
            "browser_pages",
        )

        def extend_from(value):
            if isinstance(value, dict):
                pages.extend(value.values())
            elif isinstance(value, list):
                pages.extend(value)

        for key in candidate_keys:
            extend_from(status.get(key))

        nested = status.get("summary")
        if isinstance(nested, dict):
            for key in candidate_keys:
                extend_from(nested.get(key))

        def as_timestamp(value):
            if isinstance(value, (int, float)):
                return float(value)

            text = str(value or "").strip()
            if not text:
                return 0.0

            normalized = text.replace(".", "", 1)
            if normalized.isdigit():
                return float(text)

            return 0.0

        def latest_seen_timestamp(item):
            values = [
                as_timestamp(item.get("last_heartbeat_at")),
                as_timestamp(item.get("last_poll_at")),
                as_timestamp(item.get("last_report_at")),
                as_timestamp(item.get("last_seen")),
                as_timestamp(item.get("last_focus_at")),
            ]
            return max(values) if values else 0.0

        prepared = []
        for page in pages:
            if not isinstance(page, dict):
                continue

            client_id = str(page.get("client_id") or "").strip()
            page_instance_id = str(page.get("page_instance_id") or "").strip()
            conversation_id = str(page.get("conversation_id") or "").strip()
            url = (
                page.get("url")
                or page.get("page_url")
                or page.get("normalized_url")
                or page.get("href")
                or ""
            )
            url = str(url).strip()

            if not client_id and not page_instance_id and not url:
                continue

            item = dict(page)
            item["client_id"] = client_id
            item["page_instance_id"] = page_instance_id
            item["conversation_id"] = conversation_id
            item["url"] = url
            prepared.append(item)

        self.raw_available_pages = list(prepared)
        self._annotate_pages_for_url_dedup(prepared, status=status)
        normalized = self._dedupe_chatgpt_pages(prepared)
        normalized.sort(key=latest_seen_timestamp, reverse=True)
        self.available_pages = list(normalized)

        return normalized

    def _page_is_stale(self, page, max_age_sec=None):
        if max_age_sec is None:
            max_age_sec = TM_HEARTBEAT_ONLINE_SECONDS
        if not isinstance(page, dict):
            return False
        last_seen = (
            page.get("last_seen")
            or page.get("last_seen_at")
            or page.get("seen_at")
        )
        if last_seen is None or last_seen == "":
            return True
        try:
            age = time.time() - float(last_seen)
            return age > max_age_sec
        except (TypeError, ValueError) as exc:
            if hasattr(self, "_append_log"):
                self._append_log(
                    f"[TM_PAGE][STALE_CHECK_FAILED] error={exc} "
                    f"traceback={traceback.format_exc()}",
                    echo=False,
                )
            return False

    def _tm_display_counts_from_status(self, status=None, summary=None):
        status = status or getattr(self, "_last_bridge_status", None) or {}
        pages = self._extract_tm_pages_from_status(status)
        extracted_total = len(pages)
        extracted_online = sum(
            1 for page in pages if not self._page_is_stale(page)
        )
        if summary is None:
            summary = {}
        summary_total = int(summary.get("total_clients") or 0)
        summary_online = int(summary.get("online_clients") or 0)
        if summary_total == 0 and extracted_total > 0:
            if hasattr(self, "_append_log"):
                self._append_log(
                    "[TM_SUMMARY][MISMATCH] "
                    f"summary_total={summary_total} "
                    f"summary_online={summary_online} "
                    f"extracted_pages={extracted_total} "
                    f"extracted_online={extracted_online}",
                    echo=False,
                )
            return extracted_online, extracted_total
        return summary_online, summary_total

    def _iter_tm_clients(self, status=None, *, online_only=False, bindable_only=False, page_type=""):
        status = status or self._last_bridge_status or {}
        for item in self._extract_tm_pages_from_status(status):
            client_id = (item.get("client_id") or "").strip()
            if not client_id:
                continue

            if online_only and not self._tm_page_is_online_simple(item):
                continue

            if page_type:
                current_page_type = (item.get("page_type") or "").strip()
                if current_page_type != page_type:
                    continue

            if bindable_only:
                bindable, reason = self._tm_client_bindable(item)
                if not bindable:
                    if (
                        hasattr(self, "_is_debug_mode_enabled")
                        and self._is_debug_mode_enabled()
                        and hasattr(self, "_append_log")
                    ):
                        self._append_log(
                            "[TM_CLIENT][SKIP_NOT_BINDABLE] "
                            f"reason={reason or '-'} "
                            f"client_id={(item.get('client_id') or '-')} "
                            f"page_instance_id={(item.get('page_instance_id') or '-')} "
                            f"conversation_id={(item.get('conversation_id') or '-')} "
                            f"url={(item.get('page_url') or item.get('url') or '-')}",
                            echo=False,
                        )
                    continue

            yield item

    def _tm_client_conversation_id(self, item):
        if not isinstance(item, dict):
            return ""
        conversation_id = (item.get("conversation_id") or "").strip()
        if conversation_id:
            return conversation_id
        chatgpt_id = (item.get("chatgpt_conversation_id") or "").strip()
        if chatgpt_id:
            return chatgpt_id
        for field in ("page_url", "url", "normalized_url", "conversation_url"):
            conv = parse_conversation_id((item.get(field) or "").strip())
            if conv:
                return conv
        return ""

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
        return page_url_from(item)

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
        conversation_id = self._remote_conversation_id(remote)
        url = (
            remote.get("conversation_url")
            or remote.get("url")
            or remote.get("page_url")
            or ""
        ).strip()
        if conversation_id and (not url or "xz_bind_token=" in url):
            return f"https://chatgpt.com/c/{conversation_id}"
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
            bound_client_id = (remote.get("client_id") or "").strip()
            bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
            if not bound_client_id:
                return BIND_STATE_BOUND_OFFLINE
            bound_page = self._client_info_by_page_identity(
                bound_client_id,
                bound_page_instance_id,
            )
            if isinstance(bound_page, dict) and is_page_online(bound_page):
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

    def _format_last_seen_ago(self, last_seen):
        if not last_seen:
            return "-"
        try:
            seconds = max(0, int(time.time() - float(last_seen)))
        except (TypeError, ValueError) as error:
            if (
                hasattr(self, "_is_debug_mode_enabled")
                and self._is_debug_mode_enabled()
                and hasattr(self, "_append_log")
            ):
                self._append_log(
                    "[TM_PAGE][LAST_SEEN_FORMAT_FAILED] "
                    f"last_seen={last_seen!r} "
                    f"error_type={type(error).__name__} error={error}",
                    echo=False,
                )
            return "-"
        if seconds < 1:
            return "刚刚"
        return f"{seconds}秒前"

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

    def _is_bindable_chatgpt_url(self, url):
        raw = (url or "").strip()
        if not raw or raw == "-":
            return False
        if not self._is_persistable_page_url(raw):
            return False
        try:
            parsed = urlparse(raw)
        except ValueError as error:
            if (
                hasattr(self, "_is_debug_mode_enabled")
                and self._is_debug_mode_enabled()
                and hasattr(self, "_append_log")
            ):
                self._append_log(
                    "[TM_PAGE][BINDABLE_URL_PARSE_FAILED] "
                    f"url={raw!r} "
                    f"error_type={type(error).__name__} error={error}",
                    echo=False,
                )
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

    def _client_info_by_page_identity(
        self, client_id, page_instance_id="", status=None
    ):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()
        if not client_id:
            return None
        status = status or self._last_bridge_status or {}
        if page_instance_id:
            for item in self._iter_tm_clients(status):
                if (
                    self._tm_client_id(item) == client_id
                    and self._tm_page_instance_id(item) == page_instance_id
                ):
                    return item
        for item in self._iter_tm_clients(status):
            if self._tm_client_id(item) == client_id:
                if page_instance_id:
                    self._append_log(
                        "[TM][PAGE_LOOKUP_FALLBACK] "
                        f"client_id={client_id} "
                        f"page_instance_id={page_instance_id} "
                        f"conversation_id={self._client_conversation_id(item) or '-'} "
                        f"url={page_url_from(item) or '-'}",
                        echo=False,
                    )
                return item
        return None

    def _client_info_by_id(self, client_id, status=None, page_instance_id=None):
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        instance = page_instance_id
        if instance is None:
            session = self._current_session() if hasattr(self, "_current_session") else None
            if session is not None:
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                if (remote.get("client_id") or "").strip() == client_id:
                    instance = (remote.get("page_instance_id") or "").strip()
        if instance:
            found = self._client_info_by_page_identity(
                client_id, instance, status=status
            )
            if found is not None:
                return found
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
        return {"client_id": client_id, "url": ""}

    def _is_client_online(self, client_id):
        client_id = (client_id or "").strip()
        if not client_id:
            return False
        for item in self._iter_tm_clients(self._last_bridge_status, online_only=True):
            if self._tm_client_id(item) == client_id:
                return True
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
            except ValueError as error:
                if (
                    hasattr(self, "_is_debug_mode_enabled")
                    and self._is_debug_mode_enabled()
                    and hasattr(self, "_append_log")
                ):
                    self._append_log(
                        "[TM_PAGE][NEW_PAGE_URL_PARSE_FAILED] "
                        f"url={page_url!r} "
                        f"client_id={item.get('client_id') or '-'} "
                        f"page_instance_id={item.get('page_instance_id') or '-'} "
                        f"error_type={type(error).__name__} error={error}",
                        echo=False,
                    )
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
                if self._tm_page_is_online_simple(item):
                    blank_home_online += 1
                else:
                    blank_home_offline += 1
                if session is not None:
                    blank_home_bound += 1
                    title = (session.title or session.session_id or "对话").strip()
                    if title not in seen_blank_bound:
                        seen_blank_bound.add(title)
                        blank_home_bound_labels.append(title)
                elif self._tm_page_is_online_simple(item):
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
            if self._tm_page_is_online_simple(item):
                unbound_count += 1
                label = self._monkey_unbound_page_label(item)
                if label not in seen_unbound:
                    seen_unbound.add(label)
                    unbound_labels.append(label)

        raw_pages = getattr(self, "raw_available_pages", None) or []
        raw_count = len(raw_pages)
        unique_count = total
        duplicate_count = max(0, raw_count - unique_count)

        return {
            "total": total,
            "raw_count": raw_count,
            "unique_count": unique_count,
            "duplicate_count": duplicate_count,
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
        raw_count = int(stats.get("raw_count") or stats.get("total") or 0)
        unique_count = int(stats.get("unique_count") or stats.get("total") or 0)
        duplicate_count = int(stats.get("duplicate_count") or 0)
        window_line = (
            "窗口统计："
            f"总数 {raw_count}｜"
            f"去重后 {unique_count}｜"
            f"重复 {duplicate_count}｜"
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
        """页面概览 UI 已移除；统计仍由 _collect_monkey_window_binding_stats 供日志使用。"""
        return
