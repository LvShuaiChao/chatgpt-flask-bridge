"""主界面状态条 / 页面下拉 / 底部提示的精简显示（技术字段见顶部「详情」弹窗）。"""

from app.models import (
    BIND_MODE_HOME_PENDING,
    derive_bind_mode,
    normalize_remote_chatgpt,
    remote_binding_enabled,
)
from app.utils.page_status import BUSY_RESPONSE_STATES


class UiStatusCompactMixin:
    def _compact_bind_channel_label(self, bind_mode: str) -> str:
        mode = (bind_mode or "").strip()
        if mode == BIND_MODE_HOME_PENDING:
            return "首页临时通道"
        if mode == "page_channel":
            return "页面通道"
        return "对话已绑定"

    def _is_ui_verbose_status_enabled(self):
        if hasattr(self, "_is_debug_mode_enabled"):
            return bool(self._is_debug_mode_enabled())
        return bool(getattr(self, "_debug_mode", False))

    def _tm_page_no_text(self, page):
        if not isinstance(page, dict):
            return "-"
        text = str(
            page.get("page_no") or page.get("page_display_id") or ""
        ).strip()
        return text or "-"

    def _bound_tm_page_for_session(self, session, status=None):
        if session is None:
            return None
        if hasattr(self, "_current_bound_tm_page"):
            return self._current_bound_tm_page(status=status, session=session)
        return None

    def _page_no_from_registry(
        self, client_id, page_instance_id, status=None
    ):
        client_id = (client_id or "").strip()
        page_instance_id = (page_instance_id or "").strip()
        if not client_id:
            return ""
        status = status or (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        page = None
        if page_instance_id and hasattr(self, "_client_info_by_page_identity"):
            page = self._client_info_by_page_identity(
                client_id, page_instance_id, status=status
            )
        if not isinstance(page, dict) and hasattr(self, "_client_info_by_id"):
            page = self._client_info_by_id(
                client_id, status=status, page_instance_id=page_instance_id
            )
        if isinstance(page, dict):
            text = self._tm_page_no_text(page)
            return text if text != "-" else ""
        return ""

    def _session_bound_page_no_text(self, session, status=None):
        """解析指定会话绑定页的 page_no（不含下拉框选中项）。"""
        status = status or (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        bound_page = self._bound_tm_page_for_session(session, status=status)
        if isinstance(bound_page, dict):
            page_no = self._tm_page_no_text(bound_page)
            if page_no != "-":
                return page_no

        remote = normalize_remote_chatgpt(
            getattr(session, "remote_chatgpt", {}) or {}
        ) if session else {}
        if remote_binding_enabled(remote):
            saved_page_no = str(remote.get("page_display_id") or "").strip()
            if saved_page_no and saved_page_no != "-":
                return saved_page_no
            registry_id = self._page_no_from_registry(
                remote.get("client_id"),
                remote.get("page_instance_id"),
                status=status,
            )
            if registry_id:
                return registry_id
        return "-"

    def _current_bound_page_no_text(self, session=None, status=None):
        """当前会话区展示的 page_no；优先绑定页，其次下拉选中，再查 registry。"""
        status = status or (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        session = session if session is not None else (
            self._current_session() if hasattr(self, "_current_session") else None
        )

        bound_page = self._bound_tm_page_for_session(session, status=status)
        if isinstance(bound_page, dict):
            page_no = self._tm_page_no_text(bound_page)
            if page_no != "-":
                return page_no

        current = (
            self._current_session() if hasattr(self, "_current_session") else None
        )
        is_current_session = bool(
            session is not None
            and current is not None
            and getattr(session, "session_id", None)
            == getattr(current, "session_id", None)
        )
        if is_current_session:
            selected_page = None
            if hasattr(self, "_get_selected_tm_page_from_combo"):
                selected_page = self._get_selected_tm_page_from_combo(status=status)
            if not isinstance(selected_page, dict) and hasattr(
                self, "_get_manual_current_tm_page"
            ):
                selected_page = self._get_manual_current_tm_page(status=status)
            if isinstance(selected_page, dict):
                page_no = self._tm_page_no_text(selected_page)
                if page_no != "-":
                    return page_no

        remote = normalize_remote_chatgpt(
            getattr(session, "remote_chatgpt", {}) or {}
        ) if session else {}
        if remote_binding_enabled(remote):
            saved_page_no = str(remote.get("page_display_id") or "").strip()
            if saved_page_no and saved_page_no != "-":
                return saved_page_no
            registry_id = self._page_no_from_registry(
                remote.get("client_id"),
                remote.get("page_instance_id"),
                status=status,
            )
            if registry_id:
                return registry_id
        return "-"

    def _format_bound_page_line_text(self, page_no, url="", state_text=""):
        page_no = str(page_no or "").strip() or "-"
        state_text = str(state_text or "").strip()
        if state_text == "页面通道":
            return f"绑定：页面ID:{page_no} / 页面通道"
        if state_text in ("对话已绑定", "已绑定对话"):
            conv_hint = ""
            if url and "/c/" in url:
                conv_hint = url.split("/c/", 1)[1].split("?", 1)[0].split("#", 1)[0][:12]
            if conv_hint:
                return f"绑定：页面ID:{page_no} / 对话已绑定"
            return f"绑定：页面ID:{page_no} / 对话已绑定"
        if state_text in ("未绑定", ""):
            return "绑定：未绑定"
        url = str(url or "").strip()
        if url:
            return f"绑定页面：页面ID:{page_no} ｜ {url}"
        fallback = state_text or "未绑定"
        return f"绑定页面：页面ID:{page_no} ｜ {fallback}"

    def _format_bound_page_line_segments(self, page_no, url="", state_text=""):
        page_no = str(page_no or "").strip() or "-"
        state_text = str(state_text or "").strip()
        if state_text == "页面通道":
            tail = "页面通道"
        elif state_text in ("对话已绑定", "已绑定对话"):
            tail = "对话已绑定"
        elif state_text in ("未绑定", ""):
            return [
                {"role": "prefix", "text": "绑定："},
                {"role": "bind", "tag": "未绑定", "text": "未绑定"},
            ]
        else:
            url = str(url or "").strip()
            tail = url or state_text or "未绑定"
        return [
            {"role": "prefix", "text": "绑定："},
            {"role": "page_id", "text": f"页面ID:{page_no}"},
            {"role": "separator", "text": " / "},
            {"role": "url", "text": tail, "elide": True},
        ]

    def _format_current_session_header_segments(self, session=None):
        if session is None:
            return [
                {"role": "prefix", "text": "当前会话：新对话 ｜ "},
                {"role": "bind", "tag": "未绑定", "text": "未绑定"},
            ]
        title = ""
        if hasattr(self, "_session_display_title"):
            title = self._session_display_title(session)
        remote = normalize_remote_chatgpt(getattr(session, "remote_chatgpt", {}) or {})
        bind_mode = derive_bind_mode(remote)
        page_no = self._current_bound_page_no_text(session=session)
        if not title or title == "新对话":
            if remote_binding_enabled(remote) and page_no != "-":
                if bind_mode in ("page_channel", BIND_MODE_HOME_PENDING):
                    channel = self._compact_bind_channel_label(bind_mode)
                    bind_text = f"{channel}：页面ID:{page_no}"
                elif bind_mode == "conversation":
                    bind_text = f"对话绑定：页面ID:{page_no}"
                else:
                    bind_text = f"页面ID：{page_no}"
                return [
                    {"role": "prefix", "text": "当前会话：新对话 ｜ "},
                    {"role": "page_id", "text": bind_text},
                ]
            return [
                {"role": "prefix", "text": "当前会话：新对话 ｜ "},
                {"role": "bind", "tag": "未绑定", "text": "未绑定"},
            ]
        if remote_binding_enabled(remote):
            if bind_mode in ("page_channel", BIND_MODE_HOME_PENDING):
                channel = self._compact_bind_channel_label(bind_mode)
                bind_text = f"{channel}：页面ID:{page_no}"
            elif bind_mode == "conversation":
                bind_text = f"对话绑定：页面ID:{page_no}"
            else:
                bind_text = f"页面ID：{page_no}"
        else:
            bind_text = "未绑定"
        return [
            {"role": "prefix", "text": f"当前会话：{title} ｜ "},
            {"role": "page_id", "text": bind_text},
        ]

    def _format_current_session_header_with_page_id(self, session=None):
        if session is None:
            return "当前会话：新对话 ｜ 未绑定"
        title = ""
        if hasattr(self, "_session_display_title"):
            title = self._session_display_title(session)
        remote = normalize_remote_chatgpt(getattr(session, "remote_chatgpt", {}) or {})
        bind_mode = derive_bind_mode(remote)
        page_no = self._current_bound_page_no_text(session=session)
        if not title or title == "新对话":
            if remote_binding_enabled(remote) and page_no != "-":
                if bind_mode in ("page_channel", BIND_MODE_HOME_PENDING):
                    channel = self._compact_bind_channel_label(bind_mode)
                    return f"当前会话：新对话 ｜ {channel}：页面ID:{page_no}"
                if bind_mode == "conversation":
                    return f"当前会话：新对话 ｜ 对话绑定：页面ID:{page_no}"
                return f"当前会话：新对话 ｜ 页面ID：{page_no}"
            return "当前会话：新对话 ｜ 未绑定"
        if remote_binding_enabled(remote):
            if bind_mode in ("page_channel", BIND_MODE_HOME_PENDING):
                channel = self._compact_bind_channel_label(bind_mode)
                bind_text = f"{channel}：页面ID:{page_no}"
            elif bind_mode == "conversation":
                bind_text = f"对话绑定：页面ID:{page_no}"
            else:
                bind_text = f"页面ID：{page_no}"
        else:
            bind_text = "未绑定"
        return f"当前会话：{title} ｜ {bind_text}"

    def _log_chat_header_bound_page_id(
        self,
        *,
        session=None,
        page_no="-",
        bound_url="",
        reason="",
    ):
        if not hasattr(self, "_append_log"):
            return
        session = session if session is not None else (
            self._current_session() if hasattr(self, "_current_session") else None
        )
        remote = normalize_remote_chatgpt(
            getattr(session, "remote_chatgpt", {}) or {}
        ) if session else {}
        conversation_title = ""
        if session is not None and hasattr(self, "_session_display_title"):
            conversation_title = self._session_display_title(session)
        bound_client_id = (remote.get("client_id") or "").strip()
        bound_page_instance_id = (remote.get("page_instance_id") or "").strip()
        bound_conversation_id = ""
        if hasattr(self, "_remote_conversation_id"):
            bound_conversation_id = (self._remote_conversation_id(remote) or "").strip()
        else:
            bound_conversation_id = (remote.get("conversation_id") or "").strip()

        if str(page_no or "").strip() in ("", "-"):
            from app.utils.gui_logging import LogThrottle

            throttle = getattr(self, "_chat_header_log_throttle", None)
            if throttle is None:
                throttle = LogThrottle()
                self._chat_header_log_throttle = throttle
            log_key = f"bound_page_id_missing|{bound_client_id}|{bound_page_instance_id}"
            msg = (
                "[CHAT_HEADER][BOUND_PAGE_ID_MISSING] "
                f"reason={reason or 'page_no_empty'} "
                f"conversation_title={conversation_title or '-'} "
                f"bound_client_id={bound_client_id or '-'} "
                f"bound_page_instance_id={bound_page_instance_id or '-'} "
                f"bound_conversation_id={bound_conversation_id or '-'} "
                f"bound_url={bound_url or '-'}"
            )
            debug_on = (
                hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled()
            )
            if debug_on or throttle.allow(log_key, msg, interval_ms=10000):
                self._append_log(msg, echo=False)
            return
        self._append_log(
            "[CHAT_HEADER][BOUND_PAGE_ID] "
            f"conversation_title={conversation_title or '-'} "
            f"page_no={page_no} "
            f"bound_client_id={bound_client_id or '-'} "
            f"bound_page_instance_id={bound_page_instance_id or '-'} "
            f"bound_conversation_id={bound_conversation_id or '-'} "
            f"bound_url={bound_url or '-'}",
            echo=False,
        )

    def _session_list_bind_status_text(self, session, bind_state):
        from app.constants import SESSION_BIND_LIST_STYLES

        style = SESSION_BIND_LIST_STYLES.get(
            bind_state, SESSION_BIND_LIST_STYLES["unbound"]
        )
        base_label = style.get("label") or "未绑定"
        page_no = self._session_bound_page_no_text(session)
        if page_no != "-":
            return f"页面ID:{page_no} ｜ {base_label}"
        return base_label

    def _session_list_bind_status_segments(self, session, bind_state):
        from app.constants import SESSION_BIND_LIST_STYLES

        style = SESSION_BIND_LIST_STYLES.get(
            bind_state, SESSION_BIND_LIST_STYLES["unbound"]
        )
        base_label = style.get("label") or "未绑定"
        page_no = self._session_bound_page_no_text(session)
        if page_no != "-":
            return [
                {"role": "page_id", "text": f"页面ID:{page_no}"},
                {"role": "separator", "text": " ｜ "},
                {"role": "bind", "tag": base_label, "text": base_label},
            ]
        return [{"role": "bind", "tag": base_label, "text": base_label}]

    def _tm_page_bind_state_text(self, page, *, session=None, status=None):
        if not isinstance(page, dict):
            return "未知"
        session = session if session is not None else (
            self._current_session() if hasattr(self, "_current_session") else None
        )
        status = status if status is not None else (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if not remote_binding_enabled(remote):
            return "未绑定"

        item_instance = (page.get("page_instance_id") or "").strip()
        item_conv = (page.get("conversation_id") or "").strip()
        if not item_conv and hasattr(self, "_client_conversation_id"):
            item_conv = (self._client_conversation_id(page) or "").strip()
        bound_instance = (remote.get("page_instance_id") or "").strip()
        bound_conv = ""
        if hasattr(self, "_remote_conversation_id"):
            bound_conv = (self._remote_conversation_id(remote) or "").strip()
        else:
            bound_conv = (remote.get("conversation_id") or "").strip()

        if bound_instance and item_instance and item_instance == bound_instance:
            return "已绑定"
        if bound_conv and item_conv and item_conv == bound_conv:
            bound_client = (remote.get("client_id") or "").strip()
            item_client = (page.get("client_id") or "").strip()
            if not bound_client or bound_client == item_client:
                return "已绑定"
            return "同对话"
        return "未绑定"

    def _format_compact_tm_online_chip(self, summary):
        summary = summary or {}
        online = int(summary.get("online_clients") or 0)
        total = int(summary.get("total_clients") or 0)
        chip = "ok" if online > 0 else "error"
        return f"页面：在线 {online} / 总 {total}", chip

    def _format_compact_page_chip(self, page=None, *, session=None, status=None):
        from app.constants import STATUS_CHIP_SESSION_BIND_TOOLTIP

        status = status if status is not None else (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        session = session if session is not None else (
            self._current_session() if hasattr(self, "_current_session") else None
        )
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        bind_mode = derive_bind_mode(remote)
        page_no = "-"
        if isinstance(page, dict) and hasattr(self, "_tm_page_no_text"):
            page_no = self._tm_page_no_text(page)
        if page_no == "-" and hasattr(self, "_current_bound_page_no_text"):
            page_no = self._current_bound_page_no_text(
                session=session,
                status=status,
            )

        if not remote_binding_enabled(remote):
            text = "绑定：未绑定"
            chip = ""
            tip = STATUS_CHIP_SESSION_BIND_TOOLTIP
            return text, chip, tip

        list_state = ""
        if session is not None and hasattr(self, "_session_bind_list_state"):
            list_state = self._session_bind_list_state(session, status)

        if list_state == "bind_mismatch":
            chip = "error"
            bind_label = "不一致"
        elif list_state in ("bound_online", "prebound_home"):
            chip = "ok"
            bind_label = self._compact_bind_channel_label(bind_mode)
            if bind_mode == "conversation":
                bind_label = "对话已绑定"
        elif list_state in ("bound_offline", "bound_stale"):
            chip = "warn"
            bind_label = self._compact_bind_channel_label(bind_mode)
            if bind_mode == "conversation":
                bind_label = "对话已绑定"
        else:
            chip = "warn"
            bind_label = self._compact_bind_channel_label(bind_mode)
            if bind_mode == "conversation":
                bind_label = "对话已绑定"

        if page_no and page_no != "-":
            text = f"绑定：页面ID:{page_no} / {bind_label}"
            tip = f"页面 ID：{page_no}\n{STATUS_CHIP_SESSION_BIND_TOOLTIP}"
        else:
            text = f"绑定：{bind_label}"
            tip = STATUS_CHIP_SESSION_BIND_TOOLTIP
        return text, chip, tip

    def _merge_status_target_profile(self, target, profile=None):
        target = target or {}
        profile = profile or {}
        merged = dict(profile)
        merged.update(target)
        return merged

    def _format_compact_sync_chip(self, target, profile=None):
        data = self._merge_status_target_profile(target, profile)
        conversation_id = (data.get("conversation_id") or "").strip()
        page_type = (data.get("page_type") or "").strip()
        liveness = (data.get("page_liveness") or "").strip()
        online = bool(data.get("online")) or liveness == "online"
        bind_mode = (data.get("bind_mode") or "").strip()
        if data.get("prebound_home") or bind_mode in ("page_channel", BIND_MODE_HOME_PENDING):
            if online:
                return "同步：等待生成对话ID", "warn"
            return "同步：页面离线", "warn"
        sync_readable = bool(
            data.get("conversation_syncable")
            or data.get("sync_readable")
            or (profile or {}).get("sync_ok")
            or (profile or {}).get("conversation_syncable")
        )
        if sync_readable and online:
            return "同步：可同步", "ok"
        if conversation_id and online and page_type == "conversation":
            return f"同步：conversation_id: {conversation_id[:12]}...", "ok"
        if conversation_id and not online:
            return "同步：页面离线", "warn"
        if not conversation_id and not online:
            return "同步：未绑定", "warn"
        return "同步：不可同步", "error"

    def _format_compact_send_chip(self, target, profile=None):
        data = self._merge_status_target_profile(target, profile)
        send_decision = (data.get("send_decision") or "").strip()
        response_state = (data.get("response_state") or "unknown").strip().lower()
        reason_code = (data.get("reason_code") or "").strip()
        if send_decision == "allowed":
            return "发送：可发送", "ok"
        if send_decision == "queued":
            return "发送：可排队", "warn"
        legacy_is_responding = bool(data.get("is_responding"))
        response_busy = (
            response_state in BUSY_RESPONSE_STATES
            or (
                response_state == "unknown"
                and legacy_is_responding
            )
        )
        if response_busy:
            return "发送：等待回复", "warn"
        if reason_code:
            return f"发送：不可发送（{reason_code}）", "error"
        return "发送：不可发送", "error"

    def _format_compact_sync_target_tooltip(self, target, profile=None, *, status=None):
        del status
        from app.constants import STATUS_DETAIL_TECH_HINT

        data = self._merge_status_target_profile(target, profile)
        lines = [
            f"conversation_id：{data.get('conversation_id') or '-'}",
            f"send_decision：{data.get('send_decision') or '-'}",
            f"reason_code：{data.get('reason_code') or '-'}",
            STATUS_DETAIL_TECH_HINT,
        ]
        return "\n".join(lines)

    def _page_browser_probably_throttled(self, page):
        if not isinstance(page, dict):
            return False
        raw = page.get("browser_probably_throttled")
        if raw in (1, True, "1", "true", "yes"):
            return True
        if str(raw or "").strip().lower() in ("1", "true", "yes"):
            return True
        return False

    def _bound_page_browser_probably_throttled(self, *, session=None, status=None):
        if not hasattr(self, "_resolve_bound_page_info"):
            return False
        bound_info, _bound_state, _bound_reason = self._resolve_bound_page_info(
            status=status,
        )
        return self._page_browser_probably_throttled(bound_info)

    def _format_compact_send_target_action_hint(self, *, session=None, status=None):
        session = session if session is not None else (
            self._current_session() if hasattr(self, "_current_session") else None
        )
        status = status if status is not None else (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        if not remote_binding_enabled(remote):
            return "未绑定页面，请先绑定所选页面", (
                "当前本地对话尚未绑定 ChatGPT 页面。\n"
                "请从可用页面列表选择页面后点击「绑定所选页面」。"
            )

        if self._bound_page_browser_probably_throttled(session=session, status=status):
            return (
                "ChatGPT 页面处于后台限速，建议切回该页面或保持窗口可见",
                "绑定页在后台标签、最小化或被遮挡时，Chrome 可能限制定时器与 DOM 轮询；\n"
                "自动化发送/等待回复会延迟，切回页面后会自动补偿扫描。",
            )

        bound_info, bound_state, bound_reason = (
            self._resolve_bound_page_info(status=status)
            if hasattr(self, "_resolve_bound_page_info")
            else (None, "missing", "")
        )
        bound_id = self._tm_page_no_text(bound_info) if isinstance(bound_info, dict) else "-"

        selected_page = None
        if hasattr(self, "_get_manual_current_tm_page"):
            selected_page = self._get_manual_current_tm_page(status=status)
        selected_id = self._tm_page_no_text(selected_page) if isinstance(
            selected_page, dict
        ) else "-"

        bound_instance = (remote.get("page_instance_id") or "").strip()
        selected_instance = (
            (selected_page or {}).get("page_instance_id") or ""
        ).strip() if isinstance(selected_page, dict) else ""
        same_page = bool(
            bound_instance
            and selected_instance
            and bound_instance == selected_instance
        )

        bound_online = bound_state == "online"
        same_conv_fallback = False
        if isinstance(bound_info, dict) and isinstance(selected_page, dict) and not same_page:
            bound_conv = ""
            if hasattr(self, "_remote_conversation_id"):
                bound_conv = (self._remote_conversation_id(remote) or "").strip()
            sel_conv = (selected_page.get("conversation_id") or "").strip()
            if not sel_conv and hasattr(self, "_client_conversation_id"):
                sel_conv = (self._client_conversation_id(selected_page) or "").strip()
            if (
                bound_conv
                and sel_conv == bound_conv
                and hasattr(self, "_tm_page_is_online_simple")
                and self._tm_page_is_online_simple(selected_page)
            ):
                same_conv_fallback = True

        if same_page or (
            isinstance(bound_info, dict)
            and isinstance(selected_page, dict)
            and (bound_info.get("client_id") or "").strip()
            == (selected_page.get("client_id") or "").strip()
        ):
            return f"当前发送目标：页面 ID {bound_id}", (
                f"发送与同步使用绑定页（页面 ID {bound_id}）。"
            )

        if not bound_online and same_conv_fallback:
            return f"原绑定页失效，同会话页面 ID {selected_id} 在线", (
                "精确绑定的页面实例已离线，但同一会话的其他页面仍在线；\n"
                f"临时使用页面 ID {selected_id}。如需固定，请重新绑定。"
            )

        if bound_online:
            return (
                f"当前发送目标：绑定页 ID {bound_id}，选中页未绑定",
                (
                    f"绑定页：页面 ID {bound_id}；"
                    f"列表选中：页面 ID {selected_id}（未绑定到本会话）。\n"
                    "发送/同步仍发往绑定页；若要改用选中页，请点击「绑定所选页面」。"
                ),
            )

        return (
            f"当前发送目标：绑定页 ID {bound_id}（离线）",
            (
                f"绑定页 ID {bound_id} 当前离线。"
                + (f" 已选中页面 ID {selected_id}。" if selected_id != "-" else "")
                + "\n请打开绑定页或重新绑定。"
            ),
        )

    def _apply_top_status_chip_visibility(self):
        """顶部状态栏仅保留：服务、油猴、绑定页、同步、Cursor。"""
        return

    def _refresh_send_target_action_hint(self, *, status=None):
        if not hasattr(self, "_set_tm_action_hint"):
            return
        if self._is_ui_verbose_status_enabled():
            return
        hint, tip = self._format_compact_send_target_action_hint(status=status)
        self._set_tm_action_hint(hint)
        status_bar = self.statusBar() if hasattr(self, "statusBar") else None
        if status_bar is not None:
            status_bar.setToolTip(tip or hint)

    def _sync_page_url_detail_widgets(self):
        """UI 构建或设置变更后，同步状态栏上的页面 URL / 绑定详情控件。"""
        if not hasattr(self, "tm_bound_page_label"):
            return
        self._refresh_compact_status_displays()
        if hasattr(self, "_update_bound_page_display"):
            self._update_bound_page_display()

    def _refresh_compact_status_displays(self, *, status=None, summary=None):
        status = status if status is not None else (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        if summary is None and hasattr(self, "_tm_summary_for_session"):
            summary = self._tm_summary_for_session()
        verbose = self._is_ui_verbose_status_enabled()
        self._apply_top_status_chip_visibility()

        online_label = getattr(self, "tm_online_label", None)
        if online_label is not None:
            if verbose and hasattr(self, "_format_tm_online_chip_text"):
                chip_text, chip_state = self._format_tm_online_chip_text(summary or {})
            else:
                chip_text, chip_state = self._format_compact_tm_online_chip(summary or {})
            online_label.setText(chip_text)
            if hasattr(self, "_refresh_status_chip"):
                self._refresh_status_chip(online_label, chip_state or "")

        page_label = getattr(self, "tm_bound_page_label", None)
        if page_label is not None:
            text, chip, tip = self._format_compact_page_chip(status=status)
            page_label.setText(text)
            if hasattr(self, "_refresh_status_chip"):
                self._refresh_status_chip(page_label, chip or "")
            page_label.setToolTip(tip or text)

        if hasattr(self, "_update_sync_target_display"):
            self._update_sync_target_display()

        if hasattr(self, "_refresh_send_target_action_hint"):
            self._refresh_send_target_action_hint(status=status)

        status_bar = self.statusBar() if hasattr(self, "statusBar") else None
        if status_bar is not None and hasattr(self, "_bound_page_browser_probably_throttled"):
            if self._bound_page_browser_probably_throttled(status=status):
                status_bar.showMessage(
                    "ChatGPT 页面处于后台限速，建议切回该页面或保持窗口可见",
                    12000,
                )
