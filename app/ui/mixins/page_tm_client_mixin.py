"""油猴客户端遍历、URL 摘要与绑定状态基础判断。"""

from app.server.tm_page_registry import _is_ignored_page

import time
import traceback
from urllib.parse import urlsplit, urlunsplit, urlparse

from PyQt5.QtCore import Qt

from app.constants import TM_HEARTBEAT_ONLINE_SECONDS
from app.models import (
    remote_binding_enabled,
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
from app.utils.text_utils import short_id
from app.utils.page_status import (
    conversation_syncable_from,
    can_accept_input,
    evaluate_page_capability,
    explain_page_decision,
    get_page_liveness,
    can_sync_conversation,
    is_page_busy,
    is_page_online,
    is_prebound_home_page,
    normalize_page,
    page_registry_key,
    page_url_from,
    read_snapshot_identity,
)
from app.utils.tm_activity import (
    classify_tm_client_activity,
    compute_tm_activity_metrics,
)
from app.utils.page_snapshot import PageRegistry, sort_pages_by_display_id


class PageTmClientMixin:
    def _page_is_online(self, page):
        """页面列表统计用在线判断（与下拉框展示口径一致，含 recently_seen）。"""
        return self._page_is_online_for_ui(page)

    def _page_is_online_for_ui(self, page):
        """UI 展示用在线判断：与下拉框 [在线] 文案、绿色样式共用，含 recently_seen。"""
        if not isinstance(page, dict):
            return False
        state = str(
            page.get("liveness")
            or page.get("page_liveness")
            
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
        """可同步对话页（在线 + conversation 类型 + 可同步）。"""
        if not isinstance(item, dict):
            return False
        page_type = (item.get("page_type") or "").strip()
        if page_type and page_type not in ("conversation", "-"):
            return False
        return can_sync_conversation(item)

    def _is_prebound_home_page(self, item):
        """首页预绑定（统一 app.utils.page_status.is_prebound_home_page）。"""
        return is_prebound_home_page(item)

    def _get_selected_tm_page_from_combo(self, status=None):
        """统一从页面下拉框读取当前选中页（UserRole 完整 dict，不解析 currentText）。"""
        del status
        combo = getattr(self, "tm_page_combo", None)
        if combo is None or combo.count() <= 0:
            return None

        index = combo.currentIndex()

        if index < 0 and combo.count() == 1:
            index = 0
            combo.setCurrentIndex(0)

        if index < 0:
            return None

        data = combo.itemData(index, Qt.UserRole)
        if isinstance(data, dict):
            return data

        role = getattr(self, "TM_PAGE_ITEM_DICT_ROLE", None)
        if role is not None:
            data = combo.itemData(index, role)
            if isinstance(data, dict):
                return data

        if hasattr(self, "_tm_page_combo_page_from_index"):
            page = self._tm_page_combo_page_from_index(index)
            if isinstance(page, dict):
                return page

        return None

    @staticmethod
    def _normalize_visibility_state(item):
        raw = (item.get("visibility_state") or "").strip().lower()
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
        del context
        from app.utils.safe_parse import safe_float_field

        return safe_float_field(item, field, default)

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
                "send_now_available": False,
                "send_decision": "blocked",
                "send_queueable": False,
                "conversation_syncable": False,
                "url_syncable": False,
                "stale": False,
                "page_liveness": "offline",
                "reason_code": "invalid_client",
                "is_responding": False,
                "can_accept_input": False,
                "response_state": "unknown",
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
        send_cap = evaluate_page_capability(
            item,
            action="send",
            expected_conversation_id=expected_conversation_id,
            expected_client_id=expected_client_id,
        )
        send_decision = (send_cap.send_decision or "blocked").strip()
        send_block_reason = send_cap.reason_code or ""

        client_match = not expected_client_id or client_id == expected_client_id
        conv_match = not expected_conversation_id or conversation_id == expected_conversation_id
        online = bool(decision.get("online"))
        prebound_home = bool(decision.get("prebound_home"))
        conversation_syncable = bool(decision.get("conversation_syncable"))
        send_requestable = bool(send_cap.send_requestable)
        send_now_available = bool(send_cap.send_now_available)
        send_queueable = bool(send_cap.send_queueable)

        responding = is_page_busy(item)
        can_accept = can_accept_input(item)
        response_state = str(item.get("response_state") or "unknown")

        reason = (decision.get("reason_code") or "").strip()
        if not reason:
            if not online:
                reason = "offline"
            elif not client_match:
                reason = "client_mismatch"
            elif not conv_match:
                reason = "conversation_mismatch"
            elif not conversation_syncable:
                reason = "not_conversation_syncable"

        stale = bool(online and activity in ("stale_hidden",))

        return {
            "client_id": client_id,
            "conversation_id": conversation_id,
            "visibility_state": visibility or "-",
            "activity_state": activity or "-",
            "online": online,
            "send_requestable": send_requestable,
            "send_now_available": send_now_available,
            "send_queueable": send_queueable,
            "can_sync_conversation": conversation_syncable,
            "url_syncable": bool(decision.get("url_syncable")),
            "conversation_syncable": conversation_syncable,
            "prebound_home": prebound_home,
            "reason_code": reason,
            "stale": stale,
            "send_block_reason": send_block_reason or "",
            "send_decision": send_decision,
            "client_match": client_match,
            "conversation_match": conv_match,
            "can_accept_input": can_accept,
            "is_responding": responding,
            "response_state": response_state,
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
        conversation_id = (item.get("conversation_id") or "").strip()
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

    def _tm_client_bindable(self, item, *, for_manual_ui=False):
        """手动绑定候选校验；for_manual_ui 与下拉框 [在线] 展示口径一致。"""
        if not isinstance(item, dict):
            return False, "invalid_page"
        if not for_manual_ui and item.get("realtime") is False:
            return False, "not_realtime_page"
        online = (
            self._page_is_online_for_ui(item)
            if for_manual_ui
            else self._tm_page_is_online_simple(item)
        )
        if not online:
            return False, "offline"
        identity = self._tm_page_identity_fields(item)
        if any(
            identity.get(key)
            for key in ("client_id", "page_instance_id", "conversation_id", "url")
        ):
            return True, ""
        return False, "missing_page_identity"

    def _find_online_tm_client_by_conversation_id(
        self, conversation_id, status=None, *, sync_only=False, snapshot=None
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
                if not profile.get("sync_ok"):
                    return None
            return item
        status = status or self._bridge_ui.last_bridge_status or {}
        snapshot = snapshot or self._get_tm_page_snapshot(status, log_stages=False)
        conv_pages = snapshot.by_conversation_id_dict.get(conversation_id) or []
        candidates = []
        for item in conv_pages or self._iter_tm_clients(
            status, online_only=False, snapshot=snapshot
        ):
            if conv_pages and self._client_conversation_id(item) != conversation_id:
                continue
            item_conv = self._client_conversation_id(item)
            if item_conv != conversation_id:
                continue
            if not self._tm_page_is_online_simple(item):
                continue
            if sync_only:
                profile = self._tm_client_sync_profile(
                    item, expected_conversation_id=conversation_id
                )
                if not profile.get("sync_ok"):
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
        status = status or self._bridge_ui.last_bridge_status or {}
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
            page_title = str(page.get("page_title") or "").strip()
            page_url = page_url_from(page)
            if page_title:
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
                    or merged.get("url")
                    or ""
                )
            )
        return merged

    def _annotate_pages_for_url_dedup(self, pages, status=None):
        if not pages:
            return
        status = status or self._bridge_ui.last_bridge_status or {}
        current_client_id = read_snapshot_identity(status, "active")["client_id"]
        bound_page_instance_id = ""
        resolved_bound_client_id = ""
        bound_conversation_id = ""
        # 仅从 session.remote 读取绑定字段，勿调用 _resolve_bound_page_info：
        # 后者会通过 _find_online_tm_client_by_conversation_id → _iter_tm_clients
        # → _extract_tm_pages_from_status → 本方法 形成无限递归。
        session = self._current_session() if hasattr(self, "_current_session") else None
        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote_binding_enabled(remote):
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
        merged_keys = []
        for page in pages:
            if not isinstance(page, dict):
                continue
            norm_page = normalize_page(page)
            identity_key = page_registry_key(norm_page)
            if not identity_key:
                raw_url = page_url_from(norm_page)
                norm_url = self._normalize_chatgpt_page_url(raw_url)
                if not norm_url:
                    continue
                identity_key = f"url_fallback:{norm_url}"
            old = deduped.get(identity_key)
            if old is None:
                deduped[identity_key] = norm_page
                continue
            merged_keys.append(identity_key)
            deduped[identity_key] = self._choose_better_page_record(old, norm_page)

        unique_pages = list(deduped.values())
        raw_count = len([p for p in pages if isinstance(p, dict)])
        duplicate_count = max(0, raw_count - len(unique_pages))
        self._log_tm_page_list_stage(
            "dedupe",
            f"[TM_PAGE_LIST][DEDUPE] "
            f"total={raw_count} kept={len(unique_pages)} merged={duplicate_count}",
        )
        return unique_pages

    def _ensure_tm_page_list_log_aggregator(self):
        agg = getattr(self, "_tm_page_list_log_aggregator", None)
        if agg is None:
            from app.utils.gui_logging import TmPageListLogAggregator

            agg = TmPageListLogAggregator(interval_sec=1.0)
            self._tm_page_list_log_aggregator = agg
        return agg

    def _log_tm_page_list_stage(self, stage, message):
        """文件日志始终写入；GUI 侧聚合 FETCH/NORMALIZE/DEDUPE。"""
        text = str(message or "")
        if hasattr(self, "_append_log"):
            self._append_log(text, echo=False)
        agg = self._ensure_tm_page_list_log_aggregator()
        summary = agg.record(stage, count=1)
        if summary and hasattr(self, "_append_log"):
            self._append_log(summary, echo=False)

    def _fetch_raw_tm_pages_from_status(self, status=None):
        """从 status 拉取原始页面列表（未 normalize / dedupe）。"""
        status = status or self._bridge_ui.last_bridge_status or {}
        pages = []

        def extend_from(value):
            if isinstance(value, dict):
                pages.extend(value.values())
            elif isinstance(value, list):
                pages.extend(value)

        extend_from(status.get("pages"))
        nested = status.get("summary")
        if isinstance(nested, dict) and not pages:
            extend_from(nested.get("pages"))
        return pages

    def build_tm_page_snapshot(self, status=None, *, log_stages=True):
        """单次解析 bridge status 页面列表，构建索引与计数。"""
        status = status or self._bridge_ui.last_bridge_status or {}
        pages_raw = self._fetch_raw_tm_pages_from_status(status)
        if log_stages:
            self._log_tm_page_list_stage(
                "fetch",
                f"[TM_PAGE_LIST][FETCH] raw_count={len(pages_raw)}",
            )

        prepared = []
        for page in pages_raw:
            if not isinstance(page, dict):
                continue
            item = normalize_page(page)
            client_id = str(item.get("client_id") or "").strip()
            page_instance_id = str(item.get("page_instance_id") or "").strip()
            url = page_url_from(item)
            if not client_id and not page_instance_id and not url:
                continue
            prepared.append(item)

        if log_stages:
            self._log_tm_page_list_stage(
                "normalize",
                f"[TM_PAGE_LIST][NORMALIZE] count={len(prepared)}",
            )

        self._annotate_pages_for_url_dedup(prepared, status=status)
        normalized = self._dedupe_chatgpt_pages(prepared)
        normalized = sort_pages_by_display_id(normalized)
        online_fn = (
            self._tm_page_is_online_simple
            if hasattr(self, "_tm_page_is_online_simple")
            else is_page_online
        )
        registry = PageRegistry.from_normalized_dicts(
            normalized,
            status,
            conversation_id_of=self._client_conversation_id,
            is_online=online_fn,
        )
        self.page_registry = registry
        return registry

    def _get_tm_page_snapshot(self, status=None, *, log_stages=False):
        """返回与 status 匹配的缓存 PageRegistry，必要时单次构建。"""
        status = status or self._bridge_ui.last_bridge_status or {}
        cached = getattr(self, "page_registry", None)
        if isinstance(cached, PageRegistry) and cached.matches_status(status):
            return cached
        return self.build_tm_page_snapshot(status, log_stages=log_stages)

    def _extract_tm_pages_from_status(
        self, status=None, *, log_stages=True, snapshot=None
    ):
        if snapshot is not None:
            return list(snapshot.page_dicts)
        status = status or self._bridge_ui.last_bridge_status or {}
        cached = getattr(self, "page_registry", None)
        if isinstance(cached, PageRegistry) and cached.matches_status(status):
            return list(cached.page_dicts)
        return list(
            self.build_tm_page_snapshot(status, log_stages=log_stages).page_dicts
        )

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

    def _tm_display_counts_from_status(self, status=None, summary=None, snapshot=None):
        status = status or self._bridge_ui.last_bridge_status or {}
        snapshot = snapshot or self._get_tm_page_snapshot(status, log_stages=False)
        pages = list(snapshot.page_dicts)
        extracted_total = len(pages)
        extracted_strict_online = sum(
            1 for page in pages if is_page_online(page)
        )
        extracted_recently_seen = sum(
            1 for page in pages
            if get_page_liveness(page) == "recently_seen"
        )
        extracted_syncable = sum(
            1 for page in pages if conversation_syncable_from(page)
        )
        extracted_online = extracted_strict_online
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

    def _iter_tm_clients(
        self,
        status=None,
        *,
        online_only=False,
        bindable_only=False,
        page_type="",
        snapshot=None,
    ):
        status = status or self._bridge_ui.last_bridge_status or {}
        for item in self._extract_tm_pages_from_status(
            status, log_stages=False, snapshot=snapshot
        ):
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
                            f"url={page_url_from(item) or '-'}",
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
        for field in ("url",):
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

    def _is_temp_home_bound_state(self, bind_state: str) -> bool:
        from app.models import is_temp_home_bound_state

        return is_temp_home_bound_state(bind_state)

    def _find_page_by_display_id(self, page_display_id: str) -> dict | None:
        """按 page_display_id 在最新 registry 中查找页面摘要（含 online）。"""
        from app.utils.page_snapshot import PageRegistry
        from app.utils.page_status import is_page_online

        pid = (page_display_id or "").strip()
        if not pid:
            return None
        status = self._bridge_ui.last_bridge_status or {}
        reg = getattr(self, "page_registry", None)
        if not isinstance(reg, PageRegistry) or not reg.matches_status(status):
            reg = PageRegistry.from_bridge_status(status)
        page = reg.get_by_page_display_id(pid)
        if page is None:
            return None
        raw = page._raw if isinstance(page._raw, dict) else {}
        return {
            "online": is_page_online(raw),
            "client_id": (raw.get("client_id") or page.client_id or "").strip(),
            "page_instance_id": (
                raw.get("page_instance_id") or page.page_instance_id or ""
            ).strip(),
            "url": page_url_from(raw) or (page.url or ""),
            "page_display_id": pid,
            "raw": raw,
        }

    def _remote_conversation_id(self, remote):
        from app.utils.page_binding_identity import remote_conversation_id

        return remote_conversation_id(remote)

    def _remote_conversation_url(self, remote):
        remote = normalize_remote_chatgpt(remote)
        conversation_id = self._remote_conversation_id(remote)
        url = (remote.get("url") or "").strip()
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
        if not remote_binding_enabled(remote):
            return BIND_STATE_UNBOUND
        if state == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return BIND_STATE_WAITING_BOUND_CONVERSATION
        if state in (
            BIND_STATE_PREBOUND_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
        ):
            if self._session_has_prebound_home_online(remote):
                return state
            temp_page_id = (
                (remote.get("temp_page_id") or remote.get("page_display_id") or remote.get("page_no") or "")
                .strip()
            )
            if temp_page_id:
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
        self, client_id, page_instance_id="", status=None, snapshot=None
    ):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()
        if not client_id:
            return None
        status = status or self._bridge_ui.last_bridge_status or {}
        snapshot = snapshot or self._get_tm_page_snapshot(status, log_stages=False)
        if page_instance_id:
            hit = snapshot.by_page_instance_id.get(page_instance_id)
            if isinstance(hit, dict) and self._tm_client_id(hit) == client_id:
                return hit
        for item in self._iter_tm_clients(status, snapshot=snapshot):
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

    def _client_info_by_id(
        self, client_id, status=None, page_instance_id=None, snapshot=None
    ):
        client_id = (client_id or "").strip()
        if not client_id:
            return None
        status = status or self._bridge_ui.last_bridge_status or {}
        snapshot = snapshot or self._get_tm_page_snapshot(status, log_stages=False)
        instance = page_instance_id
        if instance is None:
            session = self._current_session() if hasattr(self, "_current_session") else None
            if session is not None:
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                if (remote.get("client_id") or "").strip() == client_id:
                    instance = (remote.get("page_instance_id") or "").strip()
        if instance:
            found = self._client_info_by_page_identity(
                client_id, instance, status=status, snapshot=snapshot
            )
            if found is not None:
                return found
        hit = snapshot.by_client_id.get(client_id)
        if isinstance(hit, dict):
            return hit
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
        for item in self._iter_tm_clients(self._bridge_ui.last_bridge_status, online_only=True):
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
        page_url = (item.get("url") or "").strip()
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

    def _find_bound_session_for_tm_client(self, item):
        if not isinstance(item, dict):
            return None
        client_id = self._tm_client_id(item)
        page_instance_id = self._tm_page_instance_id(item)
        conversation_id = self._client_conversation_id(item)

        for session in self._sessions.values():
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if not remote_binding_enabled(remote):
                continue
            bind_state = self._remote_bind_state(remote)
            bound_client = (remote.get("client_id") or "").strip()
            bound_instance = (remote.get("page_instance_id") or "").strip()
            bound_conv = (remote.get("conversation_id") or "").strip()
            if not bound_conv:
                bound_conv = parse_conversation_id(
                    (remote.get("url") or "").strip()
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
        from app.server.tm_page_registry import _is_ignored_page

        status = status or self._bridge_ui.last_bridge_status or {}
        filtered = []
        for item in self._iter_tm_clients(status):
            if _is_ignored_page(item):
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

        registry = getattr(self, "page_registry", None)
        page_dicts = (
            list(registry.page_dicts)
            if isinstance(registry, PageRegistry)
            else list(self._extract_tm_pages_from_status(status, log_stages=False))
        )
        raw_count = len(page_dicts)
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
