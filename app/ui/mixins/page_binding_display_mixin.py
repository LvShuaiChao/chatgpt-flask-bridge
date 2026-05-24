"""绑定/页面关系 UI 显示。"""

import time

from app.constants import (
    BOUND_PAGE_OFFLINE_GRACE_SECONDS,
    STATUS_CHIP_SESSION_BIND_PREFIX,
    STATUS_CHIP_SESSION_BIND_TOOLTIP,
    status_chip_text,
)
from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    derive_bind_mode,
    normalize_remote_chatgpt,
)
from app.utils.page_status import page_url_from, read_snapshot_identity


class PageBindingDisplayMixin:
    def _update_manual_current_page_display(self):
        if hasattr(self, "_log_bind_mismatch_if_needed"):
            self._log_bind_mismatch_if_needed(self._tm_summary_for_session())

    def _page_plugin_status_text(self, page):
        if not isinstance(page, dict):
            return "未检测到"
        client_id = str(page.get("client_id") or "").strip()
        profile = self._tm_client_sync_profile(page)
        if client_id and profile.get("online"):
            return "在线"
        if client_id:
            return "离线"
        return "未检测到"

    def _page_type_text(self, page):
        if not isinstance(page, dict):
            return "未知页面"
        page_type = str(page.get("page_type") or "").strip()
        if page_type == "conversation":
            return "ChatGPT 对话页"
        if page_type == "home":
            return "首页"
        if page_type:
            return page_type
        return "其他页面"

    def _page_focus_text(self, page):
        if not isinstance(page, dict):
            return "无"
        return "有" if self._page_has_focus(page) else "无"

    def _page_visible_text(self, page):
        if not isinstance(page, dict):
            return "未知"
        visible = str(page.get("visibility_state") or "").lower()
        if visible in ("true", "1", "visible"):
            return "前台"
        if visible in ("false", "0", "hidden"):
            return "后台"
        return "未知"

    def _bool_alias_value(self, page, *keys, default=False, true_values=None):
        if not isinstance(page, dict):
            return default
        values = true_values or ("yes", "true", "1")
        for key in keys:
            value = page.get(key)
            if value is None:
                continue
            if isinstance(value, str):
                return value.strip().lower() in values
            return bool(value)
        return default

    def _yes_no_text(self, value):
        return "是" if bool(value) else "否"

    def _page_input_text(self, page):
        if not isinstance(page, dict):
            return "否"
        from app.utils.page_status import can_accept_input

        return self._yes_no_text(can_accept_input(page))

    def _page_responding_text(self, page):
        if not isinstance(page, dict):
            return "否"
        from app.utils.page_status import is_page_busy

        return self._yes_no_text(is_page_busy(page))

    def _page_conversation_syncable_text(self, page):
        if not isinstance(page, dict):
            return "否"
        profile = self._tm_client_sync_profile(page)
        syncable = bool(
            profile.get("sync_ok")
            or (page.get("send_decision") == "allowed" or can_sync_conversation(page))
        )
        return self._yes_no_text(syncable)

    def _page_sendable_text(self, page):
        if not isinstance(page, dict):
            return "否"
        profile = self._tm_client_sync_profile(page)
        send_decision = (profile.get("send_decision") or "").strip()
        if send_decision == "allowed":
            return "是"
        if send_decision == "queued" or profile.get("send_queueable"):
            return "等待"
        if profile.get("bootstrap_sendable"):
            return "首页"
        return "否"

    def _page_syncable_text(self, page):
        """对话可同步（/c/ 对话页），不等同于 URL 级 syncable。"""
        return self._page_conversation_syncable_text(page)

    def _page_identity_text(self, page, *, instance_unknown=False):
        if not isinstance(page, dict):
            return (
                "ChatGPT对话ID：-\n"
                "油猴ID：-\n"
                "页面实例ID：-\n"
                "URL：-"
            )

        self._maybe_log_conversation_id_mismatch(page)

        chatgpt_id = (page.get('conversation_id') or '').strip() or "-"
        client_id = str(page.get("client_id") or "-").strip() or "-"
        page_instance_id = str(page.get("page_instance_id") or "").strip()
        if not page_instance_id:
            page_instance_id = "未知" if instance_unknown else "-"
        full_url = self._page_full_url(page) or "-"
        last_seen_text = self._format_last_seen_ago(page.get("last_seen"))

        return (
            f"URL：{full_url}\n"
            f"conversation_id：{chatgpt_id}\n"
            f"client_id：{client_id}\n"
            f"page_instance_id：{page_instance_id}\n"
            f"last_seen：{last_seen_text}"
        )

    def _page_ids_for_log(self, page):
        if not isinstance(page, dict):
            return "-", "-", "-"
        client_id = (page.get("client_id") or "-").strip() or "-"
        page_instance_id = (page.get("page_instance_id") or "-").strip() or "-"
        conversation_id = (page.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = self._client_conversation_id(page) or "-"
        return client_id, page_instance_id, conversation_id

    def _short_page_label(self, info):
        if not isinstance(info, dict):
            return "未检测到"
        page_type = (info.get("page_type") or "").strip()
        page_url = page_url_from(info)
        conversation_id = (
            (info.get("conversation_id") or "").strip()
            or self._client_conversation_id(info)
            or ""
        )
        if conversation_id:
            return f"/c/{conversation_id[:8]}..."
        if page_type == "home":
            return "ChatGPT 首页"
        if page_url:
            return self._elide_middle(page_url, 42)
        return "未知页面"

    def _format_tm_online_chip_text(self, summary):
        summary = summary or {}
        online = int(summary.get("online_clients") or 0)
        total = int(summary.get("total_clients") or 0)
        stored_bound_client_id = ""
        if hasattr(self, "_current_session"):
            session = self._current_session()
            if session is not None:
                remote = normalize_remote_chatgpt(session.remote_chatgpt)
                stored_bound_client_id = (remote.get("client_id") or "").strip()
        bound_online = bool(summary.get("bound_online"))
        bound_page_type = str(summary.get("bound_page_type") or "").strip()
        bound_match_mode = str(summary.get("bound_match_mode") or "").strip()
        text = f"油猴：在线 {online} / 总 {total}"
        if stored_bound_client_id and not bound_online:
            return f"{text}｜绑定页离线", "error"
        if stored_bound_client_id and bound_online:
            if bound_match_mode == "conversation_fallback":
                if bound_page_type == "conversation":
                    return f"{text}｜同对话页在线", "ok"
                return f"{text}｜同对话页在线", "ok"
            if bound_page_type == "home":
                return f"{text}｜绑定首页（等待对话）", "warn"
            if bound_page_type == "conversation":
                return f"{text}｜绑定对话页", "ok"
            return f"{text}｜绑定页在线", "ok"
        if online > 0:
            return text, "warn"
        return text, "error"

    def _session_bind_list_state(self, session, bridge_status=None):
        if session is None:
            return "unbound"
        bridge_status = bridge_status if bridge_status is not None else self._bridge_ui.last_bridge_status
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        conversation_id = self._remote_conversation_id(remote)

        if self._session_has_wrong_existing_conversation_bind(session):
            return "bind_mismatch"

        if self._auto_bind.pending_session_id == session.session_id:
            return "waiting_home"

        if bind_state == BIND_STATE_WAITING_HOME:
            return "waiting_home"

        if bind_state == BIND_STATE_WAITING_CONVERSATION_CREATED:
            return "waiting_conversation_created"

        if bind_state == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return "waiting_bound_conversation"

        if bind_state == BIND_STATE_PREBOUND_HOME:
            if self._session_has_prebound_home_online(remote, bridge_status=bridge_status):
                return "prebound_home"
            return "bound_offline"

        if conversation_id:
            if self._session_bound_page_has_mismatch(session, bridge_status=bridge_status):
                raw_state = "bind_mismatch"
            else:
                matched = self._find_online_client_for_remote(
                    remote, bridge_status=bridge_status
                )
                raw_state = self._raw_bound_state_from_match(
                    session, conversation_id, matched
                )
            return self._stable_session_bind_list_state(
                session,
                raw_state,
                conversation_id=conversation_id,
            )

        return "unbound"

    def _raw_bound_state_from_match(self, session, conversation_id, matched_client):
        if session is None:
            return "bound_offline"
        if not conversation_id:
            return "bound_offline"
        if isinstance(matched_client, dict):
            last_seen = float(matched_client.get("last_seen") or 0)
            if last_seen > 0:
                cache = {
                    "conversation_id": conversation_id,
                    "client_id": (matched_client.get("client_id") or "").strip(),
                    "page_instance_id": (
                        matched_client.get("page_instance_id") or ""
                    ).strip(),
                    "last_seen_at": float(matched_client.get("last_seen") or time.time()),
                    "last_status": "bound_online",
                }
                self._bind_display.last_bound_page_seen_by_session[session.session_id] = cache
                from app.utils.page_status import get_page_liveness

                liveness = get_page_liveness(matched_client)
                if liveness in ("online", "recently_seen"):
                    return "bound_online"
                if liveness == "stale":
                    return "bound_stale"
        return "bound_offline"

    def _stable_session_bind_list_state(self, session, raw_state, conversation_id=""):
        if session is None:
            return raw_state

        prev_display = self._bind_display.last_session_bind_display_state.get(session.session_id)
        first_seen = session.session_id not in self._bind_display.last_session_bind_display_state

        if raw_state == "bound_online":
            self._bind_display.last_session_bind_display_state[session.session_id] = "bound_online"
            if not first_seen and prev_display != "bound_online":
                self._log_session_bind_state_change(
                    session,
                    raw_state,
                    "bound_online",
                    "raw_online",
                )
            return "bound_online"

        # 注意：
        # bound_stale 说明页面已经超过在线心跳窗口，不应该继续显示绿色。
        # 这里统一按离线显示，避免左侧列表出现“绑定离线但仍然绿色”的误导。
        if raw_state == "bound_stale":
            self._bind_display.last_session_bind_display_state[session.session_id] = "bound_offline"
            if not first_seen and prev_display != "bound_offline":
                self._log_session_bind_state_change(
                    session,
                    raw_state,
                    "bound_offline",
                    "stale_display_as_offline",
                    last_seen_age=self._bound_cache_seen_age(session, conversation_id),
                )
            return "bound_offline"

        if raw_state != "bound_offline":
            self._bind_display.last_session_bind_display_state[session.session_id] = raw_state
            if not first_seen and prev_display != raw_state:
                self._log_session_bind_state_change(
                    session,
                    raw_state,
                    raw_state,
                    "raw_passthrough",
                )
            return raw_state

        # 离线状态必须立即显示为离线，不再使用 offline_grace 显示绿色。
        self._bind_display.last_session_bind_display_state[session.session_id] = "bound_offline"
        if not first_seen and prev_display != "bound_offline":
            self._log_session_bind_state_change(
                session,
                "bound_offline",
                "bound_offline",
                "offline_display_immediately",
                last_seen_age=self._bound_cache_seen_age(session, conversation_id),
            )
        return "bound_offline"

    def _bound_cache_seen_age(self, session, conversation_id):
        if session is None:
            return -1.0
        cache = self._bind_display.last_bound_page_seen_by_session.get(session.session_id)
        if not isinstance(cache, dict):
            return -1.0
        if conversation_id and (cache.get("conversation_id") or "").strip() != conversation_id:
            return -1.0
        last_seen_at = float(cache.get("last_seen_at") or 0)
        if last_seen_at <= 0:
            return -1.0
        return max(0.0, time.time() - last_seen_at)

    def _log_session_bind_state_change(
        self, session, raw_state, display_state, reason, last_seen_age=-1.0
    ):
        if session is None:
            return
        if raw_state == display_state:
            last_logged = getattr(self, "_last_session_bind_logged_pair", {}).get(
                session.session_id
            )
            if last_logged == (raw_state, display_state):
                return
        now = time.time()
        state_key = f"{raw_state}->{display_state}:{reason}"
        key = (session.session_id, state_key)
        last_at = self._bind_display.last_session_bind_state_log_at.get(key, 0.0)
        if now - last_at < 1.0:
            return
        if not hasattr(self, "_last_session_bind_logged_pair"):
            self._bind_display.last_session_bind_logged_pair = {}
        self._bind_display.last_session_bind_logged_pair[session.session_id] = (
            raw_state,
            display_state,
        )
        self._bind_display.last_session_bind_state_log_at[key] = now
        age_text = f"{last_seen_age:.1f}" if last_seen_age >= 0 else "-"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = self._remote_conversation_id(remote)
        self._append_log(
            "[SESSION_BIND_STATE][CHANGE] "
            f"session_id={session.session_id} "
            f"raw={raw_state} display={display_state} "
            f"conversation_id={conversation_id or '-'} "
            f"reason={reason} "
            f"last_seen_age={age_text} "
            f"grace={BOUND_PAGE_OFFLINE_GRACE_SECONDS}"
        )

    def _session_bind_mismatch_tooltip_reason(self, session, bridge_status=None):
        if session is None:
            return ""
        bridge_status = (
            bridge_status if bridge_status is not None else self._bridge_ui.last_bridge_status
        )
        if self._session_has_wrong_existing_conversation_bind(session):
            return (
                "绑定异常原因：当前新建本地对话错误绑定到了已有 ChatGPT 对话页，"
                "与空白首页创建新会话流程冲突。请点击“绑定所选页面”覆盖后从首页重新开始。"
            )
        if self._session_bound_page_has_mismatch(session, bridge_status=bridge_status):
            return (
                "绑定异常原因：当前在线的油猴页面报告的 conversation_id 与"
                "本对话绑定的会话不一致（或绑定 client 仍在但 URL 不匹配）。"
            )
        return ""

    def _current_bind_visual_state(self):
        session = self._current_session()
        if session and self._auto_bind.pending_session_id == session.session_id:
            return "pending_bind"
        if not session:
            return (
                "unbound_required"
                if self._bind_each_chat_to_page
                else "unbound_optional"
            )
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if self._remote_bind_state(remote) == BIND_STATE_WAITING_BOUND_CONVERSATION:
            return "waiting_bound_reopen"
        if not remote_binding_enabled(remote):
            return (
                "unbound_required"
                if self._bind_each_chat_to_page
                else "unbound_optional"
            )
        list_state = self._session_bind_list_state(session, self._bridge_ui.last_bridge_status)
        if list_state == "bound_online":
            return "bound_online"
        if list_state == "prebound_home":
            return "prebound_home"
        if list_state in (
            "waiting_home",
            "waiting_conversation_created",
            "waiting_bound_conversation",
        ):
            return "pending_bind"
        if list_state == "unbound":
            return (
                "unbound_required"
                if self._bind_each_chat_to_page
                else "unbound_optional"
            )
        if list_state == "bind_mismatch":
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bound_conv = self._remote_conversation_id(remote) or "-"
            active_info = self._client_info_by_id(
                read_snapshot_identity(self._tm_summary_for_session(session), "active")["client_id"]
            )
            current_conv = "-"
            current_instance = "-"
            if isinstance(active_info, dict):
                current_conv = self._client_conversation_id(active_info) or "-"
                current_instance = (active_info.get("page_instance_id") or "-").strip() or "-"
            if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():
                self._append_log(
                    "[BIND_STATE][MISMATCH] "
                    f"session_id={session.session_id} "
                    f"bound_conversation_id={bound_conv} "
                    f"current_conversation_id={current_conv} "
                    f"bound_page_instance_id={(remote.get('page_instance_id') or '-').strip() or '-'} "
                    f"current_page_instance_id={current_instance}",
                    echo=True,
                )
            return "bind_mismatch"
        return "bound_offline"

    def _log_chat_area_style(self, state):
        session = self._current_session()
        session_id = (session.session_id if session else "") or "-"
        status = self._bridge_ui.last_bridge_status or {}
        bound_info, resolved_bound_state, _bound_reason = self._resolve_bound_page_info(
            status=status
        )
        bound_client_id = ((bound_info or {}).get("client_id") or "").strip()
        active_client_id = read_snapshot_identity(
            self._tm_summary_for_session(session), "active"
        )["client_id"]
        active_info = self._client_info_by_id(active_client_id, status=status)
        active_profile = self._tm_client_sync_profile(active_info) if active_info else {}
        active_page_syncable = bool(active_profile.get("sync_ok"))
        if not bound_client_id:
            bound_state = "unbound"
        elif resolved_bound_state == "online":
            remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
            if self._remote_bind_state(remote) == BIND_STATE_PREBOUND_HOME:
                bound_state = "prebound_home"
            else:
                bound_state = "dialog_ready" if active_page_syncable else "online"
        else:
            bound_state = "offline"
        active_matches_bound = bool(
            bound_client_id and active_client_id and active_client_id == bound_client_id
        )
        style = "yellow"
        if state in ("bound_online", "prebound_home"):
            style = "green"
        elif state == "bind_mismatch":
            style = "red"
        elif state == "bound_offline":
            style = "yellow"
        style_key = "|".join([
            str(session_id or "-"),
            str(bound_client_id or "-"),
            str(bound_state or "-"),
            str(active_client_id or "-"),
            str(active_matches_bound),
            str(active_page_syncable),
            str(style),
        ])
        if style_key != getattr(self, "_last_chat_area_style_key", ""):
            self._bind_display.last_chat_area_style_key = style_key
            self._append_log(
                "[CHAT_AREA_STYLE] "
                f"session_id={session_id} "
                f"bound_client={bound_client_id or '-'} "
                f"bound_state={bound_state} "
                f"active_client={active_client_id or '-'} "
                f"active_matches_bound={'true' if active_matches_bound else 'false'} "
                f"active_page_syncable={'true' if active_page_syncable else 'false'} "
                f"style={style}"
            )

    def _apply_chat_bind_visual_state(self):
        state = self._current_bind_visual_state()
        self._log_chat_area_style(state)
        last_state = getattr(self, "_last_chat_bind_visual_state", None)
        if state != last_state:
            self._append_log(f"[CHAT_BIND_VISUAL] old={last_state} new={state}")
            self._last_chat_bind_visual_state = state

        widgets = []
        if hasattr(self, "_chat_panel"):
            widgets.append(self._chat_panel)
        if hasattr(self, "chat_transcript"):
            widgets.append(self.chat_transcript)
        for widget in widgets:
            old = widget.property("bindState")
            if old != state:
                widget.setProperty("bindState", state)
                style = widget.style()
                style.unpolish(widget)
                style.polish(widget)
                widget.update()

    def _current_session_bound_url(self):
        session = self._current_session()
        if session is None:
            return "", "未选择本地对话"

        self._fix_session_remote_url_from_conversation(session, echo=False)
        remote = normalize_remote_chatgpt(getattr(session, "remote_chatgpt", {}) or {})
        bind_state = self._remote_bind_state(remote)
        bind_mode = derive_bind_mode(remote)

        if not remote_binding_enabled(remote):
            return "", "未绑定"

        conversation_id = self._remote_conversation_id(remote)
        url = self._remote_conversation_url(remote)
        if bind_mode in ("page_channel", "home_pending") or (
            bind_state == BIND_STATE_PREBOUND_HOME and not conversation_id
        ):
            if not url:
                url = "https://chatgpt.com/"
            if bind_mode == "home_pending":
                return url, "首页临时通道"
            return url, "页面通道"

        if url:
            if conversation_id:
                state_text = "对话已绑定"
            elif bind_state == BIND_STATE_BOUND_OFFLINE:
                state_text = "离线"
            elif bind_state == BIND_STATE_BOUND_CONVERSATION:
                state_text = "对话已绑定"
            else:
                state_text = "已记录网址"
            return url, state_text

        return "", "未绑定"

    def _update_current_session_url_display(self):
        label = getattr(self, "current_session_url_label", None)
        if label is None:
            return

        url, state_text = self._current_session_bound_url()
        session = self._current_session() if hasattr(self, "_current_session") else None
        page_no = "-"
        if hasattr(self, "_current_bound_page_no_text"):
            page_no = self._current_bound_page_no_text(session=session)
        segments = None
        if hasattr(self, "_format_bound_page_line_segments"):
            segments = self._format_bound_page_line_segments(
                page_no, url=url, state_text=state_text
            )
        if hasattr(self, "_format_bound_page_line_text"):
            text = self._format_bound_page_line_text(
                page_no, url=url, state_text=state_text
            )
        elif url:
            text = f"绑定页面：页面ID:{page_no} ｜ {url}"
        else:
            text = f"绑定：未绑定"

        if hasattr(self, "_log_chat_header_bound_page_id"):
            missing_reason = ""
            if str(page_no or "").strip() in ("", "-"):
                missing_reason = "page_no_empty"
            self._log_chat_header_bound_page_id(
                session=session,
                page_no=page_no,
                bound_url=url or state_text,
                reason=missing_reason,
            )

        if session:
            remote = normalize_remote_chatgpt(
                getattr(session, "remote_chatgpt", {}) or {}
            )
            conversation_id = self._remote_conversation_id(remote)
            bound_client = (remote.get("client_id") or "-").strip() or "-"
            bound_instance = (remote.get("page_instance_id") or "-").strip() or "-"
            bound_conv = conversation_id or "-"
            tooltip = (
                f"{text}\n"
                f"state={state_text} | "
                f"page_no={page_no} | "
                f"bound_client_id={bound_client} | "
                f"bound_page_instance_id={bound_instance} | "
                f"bound_conversation_id={bound_conv}"
            )
            if segments is not None and hasattr(label, "set_segments"):
                label.set_segments(segments, tooltip=tooltip)
            else:
                label.setText(text, tooltip=tooltip)
        else:
            if segments is not None and hasattr(label, "set_segments"):
                label.set_segments(segments, tooltip=text)
            else:
                label.setText(text)
                label.setToolTip(text)

    def _update_bound_page_display(self, summary=None):
        summary = summary or self._tm_summary_for_session()
        status = self._bridge_ui.last_bridge_status or {}
        session = self._current_session()
        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        bound_info, bound_state, _bound_reason = self._resolve_bound_page_info(status=status)

        bound_conversation_id = self._remote_conversation_id(remote)
        bound_url = self._remote_conversation_url(remote) if remote_binding_enabled(remote) else ""

        bound_display_page = None
        if isinstance(bound_info, dict):
            bound_display_page = bound_info
            if not bound_url:
                bound_url = self._page_full_url(bound_info)
            if not bound_conversation_id:
                bound_conversation_id = (self._client_conversation_id(bound_info) or "").strip()
        elif remote_binding_enabled(remote):
            bound_display_page = {
                "client_id": (remote.get("client_id") or "").strip(),
                "page_instance_id": (remote.get("page_instance_id") or "").strip(),
                "conversation_id": bound_conversation_id,
                "url": bound_url,
                "page_type": (remote.get("page_type") or "").strip(),
            }

        can_open_bound_page = bool(
            remote_binding_enabled(remote)
            and (bound_url or bound_conversation_id)
        )

        if hasattr(self, "tm_bound_page_label") and hasattr(self, "_format_compact_page_chip"):
            chip_text, chip_state, chip_tip = self._format_compact_page_chip(
                bound_display_page,
                session=session,
                status=status,
            )
            if self._is_ui_verbose_status_enabled():
                if remote_binding_enabled(remote):
                    if bound_state == "online":
                        verbose_state = "在线"
                        verbose_chip = "ok"
                    elif bound_state == "offline":
                        verbose_state = "离线"
                        verbose_chip = "warn"
                    else:
                        verbose_state = "未绑定"
                        verbose_chip = "warn"
                else:
                    verbose_state = "未绑定"
                    verbose_chip = "warn"
                chip_text = status_chip_text(
                    STATUS_CHIP_SESSION_BIND_PREFIX, verbose_state
                )
                chip_state = verbose_chip
                chip_tip = STATUS_CHIP_SESSION_BIND_TOOLTIP
                if bound_url:
                    chip_tip = f"{bound_url}\n\n{chip_tip}"
            self.tm_bound_page_label.setText(chip_text)
            self._refresh_status_chip(self.tm_bound_page_label, chip_state or "")
            self.tm_bound_page_label.setToolTip(chip_tip or chip_text)

        self._set_chat_open_bound_enabled(can_open_bound_page)

        if hasattr(self, "chat_open_bound_btn"):
            if can_open_bound_page:
                open_target = bound_url or f"https://chatgpt.com/c/{bound_conversation_id}"
                from app.constants import STATUS_DETAIL_TECH_HINT

                self.chat_open_bound_btn.setToolTip(
                    "打开当前对话绑定的 ChatGPT 页面\n"
                    f"url: {open_target or '-'}\n"
                    f"{STATUS_DETAIL_TECH_HINT}"
                )
            else:
                self.chat_open_bound_btn.setToolTip(
                    "当前对话没有可打开的绑定页面。请先绑定所选页面。"
                )

        self._apply_chat_bind_visual_state()
        if hasattr(self, "_render_sync_target_display_light"):
            self._render_sync_target_display_light()
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
        self._update_current_session_url_display()
        if hasattr(self, "_apply_top_status_chip_visibility"):
            self._apply_top_status_chip_visibility()

    def _set_chat_open_bound_enabled(self, enabled):
        if hasattr(self, "chat_open_bound_btn"):
            self.chat_open_bound_btn.setEnabled(bool(enabled))
