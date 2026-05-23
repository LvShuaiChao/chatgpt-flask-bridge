"""绑定字段清理、归一化与统一写入入口。"""

from app.server import (
    cancel_message,
    complete_gui_dispatch,
    enqueue_control_command,
    get_bridge_status,
    get_message_state,
    get_server_port,
    get_server_public_host,
    get_server_url,
    get_tm_online_summary,
    is_server_running,
    push_close_other_pages,
    push_close_page,
    push_message,
    push_open_url,
    set_debug_mode,
    set_external_gui_dispatch,
    set_log_callback,
    set_status_callback,
    start_server,
    stop_server,
)

import time
import traceback
from urllib.parse import urlparse

from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_UNBOUND,
    normalize_remote_chatgpt,
    write_session_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from


def _binding_log_text(value, default="-"):
    if value is None:
        return default
    text = str(value).strip()
    return text or default


class PageBindingStateMixin:
    def _clear_session_binding(self, session_id, *, reason=""):
        if not session_id:
            self._append_log(
                "[BIND][CLEAR][SKIP] reason=missing_session_id",
                echo=True,
            )
            return False
        session = self._get_session_by_id(session_id)
        if session is None:
            self._append_log(
                f"[BIND][CLEAR][SKIP] session_id={session_id} reason=session_not_found",
                echo=True,
            )
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_client_id = (remote.get("client_id") or "").strip()
        old_page_instance_id = (remote.get("page_instance_id") or "").strip()
        old_conversation_id = (remote.get("conversation_id") or "").strip()
        old_url = (
            ((remote.get("url") or "").strip()).strip()
        )

        write_session_remote_chatgpt(
            session,
            bind_state=BIND_STATE_UNBOUND,
            url="",
            conversation_id="",
            client_id="",
            page_instance_id="",
            page_type="",
            last_seen=0,
        )
        self._purge_session_binding_caches(session_id)
        if getattr(self._auto_bind, 'pending_session_id', '') == session_id:
            if hasattr(self, "_clear_pending_auto_bind"):
                self._clear_pending_auto_bind()

        self._append_log(
            "[BIND][CLEAR][SESSION] "
            f"session_id={session_id} "
            f"reason={reason or '-'} "
            f"old_client_id={old_client_id or '-'} "
            f"old_page_instance_id={old_page_instance_id or '-'} "
            f"old_conversation_id={old_conversation_id or '-'} "
            f"old_url={old_url or '-'}",
            echo=True,
        )
        self._save_sessions_to_disk()
        return True

    def _purge_session_binding_caches(self, session_id):
        if not session_id:
            return
        getattr(self, "_last_bound_page_seen_by_session", {}).pop(session_id, None)
        getattr(self, "_last_session_bind_display_state", {}).pop(session_id, None)
        logged = getattr(self, "_last_session_bind_logged_pair", None)
        if isinstance(logged, dict):
            logged.pop(session_id, None)
        log_at = getattr(self, "_last_session_bind_state_log_at", None)
        if isinstance(log_at, dict):
            keys_to_drop = [
                key for key in log_at if isinstance(key, tuple) and key[0] == session_id
            ]
            for key in keys_to_drop:
                log_at.pop(key, None)

    def _clear_pending_web_sync_for_session(self, session_id):
        if not session_id:
            return 0
        removed = 0
        pending_map = getattr(self._web_sync, 'pending_requests', None)
        if isinstance(pending_map, dict):
            for request_id in list(pending_map.keys()):
                item = pending_map.get(request_id) or {}
                if item.get("session_id") == session_id:
                    pending_map.pop(request_id, None)
                    removed += 1
        sync_map = getattr(self._page_cmd, 'pending_sync_requests', None)
        if isinstance(sync_map, dict):
            for message_id in list(sync_map.keys()):
                item = sync_map.get(message_id) or {}
                if item.get("session_id") == session_id:
                    sync_map.pop(message_id, None)
                    removed += 1
        self._append_log(
            f"[WEB_SYNC][PENDING_CLEAR] session_id={session_id} removed={removed}",
            echo=True,
        )
        return removed

    def _gc_orphan_bindings(self):
        """清理已无对应本地会话的桥接消息映射（不再写服务端 registry）。"""
        session_ids = set(self._sessions.keys())
        removed = 0
        for bridge_id, sid in list(self._message_to_session.items()):
            if sid and sid not in session_ids:
                self._message_to_session.pop(bridge_id, None)
                self._message_to_turn.pop(bridge_id, None)
                removed += 1
        return removed

    def _refresh_current_session_binding_display(self):
        session = self._current_session()
        if session is not None:
            self._fix_session_remote_url_from_conversation(session)
        self._update_current_session_url_display()
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="binding_display")
        self._update_sync_target_display()
        self._apply_chat_bind_visual_state()

    def _bind_selected_page_to_current_session(self, selected_page=None, *, log_click=False):
        """将所选页面写入当前会话 remote_chatgpt 并刷新 UI。"""
        if log_click:
            combo = getattr(self, "tm_page_combo", None)
            combo_index = combo.currentIndex() if combo is not None else -1
            combo_text = combo.currentText() if combo is not None else ""
            combo_count = combo.count() if combo is not None else 0
            self._append_log(
                "[BIND][CLICK] "
                f"combo_index={combo_index} "
                f"combo_text={combo_text!r} "
                f"combo_count={combo_count}",
                echo=True,
            )

        if not is_server_running():
            self._add_system_message("请先启动服务。")
            self._append_log(
                "[BIND][FAILED] reason_code=server_not_running "
                "error_type=RuntimeError error=server_not_running "
                "traceback=-",
                echo=True,
            )
            return False

        if selected_page is None:
            selected_page = (
                self._get_selected_tm_page_from_combo()
                if hasattr(self, "_get_selected_tm_page_from_combo")
                else None
            )
        if not isinstance(selected_page, dict):
            combo = getattr(self, "tm_page_combo", None)
            combo_index = combo.currentIndex() if combo is not None else -1
            combo_text = combo.currentText() if combo is not None else ""
            combo_count = combo.count() if combo is not None else 0
            self._append_log(
                "[BIND][SELECTED_PAGE_MISSING] "
                f"combo_index={combo_index} "
                f"combo_text={combo_text!r} "
                f"combo_count={combo_count}",
                echo=True,
            )
            self._set_tm_action_hint(
                "页面下拉框有显示内容，但未携带页面数据，请刷新页面列表后重试。"
            )
            self._add_system_message(
                "页面下拉框有显示内容，但未携带页面数据，请刷新页面列表后重试。"
            )
            return False

        online = (
            self._page_is_online_for_ui(selected_page)
            if hasattr(self, "_page_is_online_for_ui")
            else False
        )
        self._append_log(
            "[BIND][SELECTED_PAGE] "
            f"page_no={_binding_log_text(selected_page.get('page_no'))} "
            f"client_id={_binding_log_text(selected_page.get('client_id'))} "
            f"page_instance_id={_binding_log_text(selected_page.get('page_instance_id'))} "
            f"conversation_id={_binding_log_text(selected_page.get('conversation_id'))} "
            f"url={_binding_log_text(page_url_from(selected_page))} "
            f"online={str(online).lower()} "
            f"last_poll_at={_binding_log_text(selected_page.get('last_poll_at'))}",
            echo=True,
        )

        if not online:
            self._set_tm_action_hint("所选页面当前离线，请打开页面或刷新列表后重试。")
            self._append_log(
                "[BIND][FAILED] reason_code=page_offline "
                "error_type=BindError error=selected_page_not_online_for_ui "
                "traceback=-",
                echo=True,
            )
            return False

        session = self._ensure_current_session()
        try:
            normalized = self._normalize_tm_page_for_binding(selected_page)
            client_id = (normalized.get("client_id") or "").strip()
            page_instance_id = (normalized.get("page_instance_id") or "").strip()
            conversation_id = (normalized.get("conversation_id") or "").strip()
            page_url = (normalized.get("url") or page_url_from(selected_page) or "").strip()
            if not conversation_id and page_url:
                conversation_id = parse_conversation_id(page_url) or ""
            page_type = (
                normalized.get("page_type")
                or selected_page.get("page_type")
                or ""
            ).strip()
            if not client_id and not page_url:
                self._append_log(
                    "[BIND][FAILED] reason_code=missing_page_identity "
                    "error_type=BindError error=missing_client_id_and_url "
                    "traceback=-",
                    echo=True,
                )
                return False
            if not conversation_id:
                is_home_page = False
                if page_type == "home":
                    is_home_page = True
                elif page_url and self._is_bindable_chatgpt_url(page_url):
                    parsed_path = urlparse(page_url).path or "/"
                    is_home_page = parsed_path in ("", "/")
                if is_home_page:
                    bind_candidate = dict(selected_page)
                    bind_candidate.update(normalized)
                    bind_candidate["url"] = page_url or "https://chatgpt.com/"
                    bind_candidate["page_type"] = "home"
                    bind_candidate["conversation_id"] = ""
                    temp_page_id = (
                        str(
                            bind_candidate.get("page_display_id")
                            or bind_candidate.get("page_no")
                            or selected_page.get("page_no")
                            or normalized.get("page_no")
                            or ""
                        ).strip()
                    )
                    if not client_id and not temp_page_id:
                        self._append_log(
                            "[BIND][FAILED] reason_code=missing_page_identity "
                            "error_type=BindError error=missing_client_id_and_page_id "
                            "traceback=-",
                            echo=True,
                        )
                        return False
                    ok = self._prebound_home_bind_to_session(
                        session,
                        bind_candidate,
                        silent=True,
                        reserve_reason="manual_bind_home",
                    )
                    if ok:
                        self._set_tm_action_hint(
                            "已绑定 ChatGPT 首页（页面ID 临时绑定）。发送第一条消息后将自动绑定新对话。"
                        )
                        self._refresh_current_session_binding_display()
                        self._refresh_session_list(select_session_id=session.session_id)
                        self._save_sessions_to_disk()
                        self._apply_chat_bind_visual_state()
                        return True
                    self._append_log(
                        "[BIND][MANUAL_HOME][FAILED] "
                        f"session_id={session.session_id} "
                        f"client_id={client_id or '-'} "
                        f"page_instance_id={page_instance_id or '-'} "
                        f"url={page_url or '-'}",
                        echo=True,
                    )
                    return False
                self._append_log(
                    "[BIND][FAILED] reason_code=missing_conversation_id "
                    "error_type=BindError error=missing_conversation_id "
                    "traceback=-",
                    echo=True,
                )
                self._set_tm_action_hint("所选页面既不是 ChatGPT 首页，也不是 ChatGPT 对话页，无法绑定。")
                return False

            page_no = _binding_log_text(
                selected_page.get("page_no")
                or normalized.get("page_no"),
                default="",
            )
            if hasattr(self, "_tm_page_no_text") and not page_no:
                display_text = self._tm_page_no_text(selected_page)
                if display_text and display_text != "-":
                    page_no = str(display_text).strip()

            page_type = (
                (normalized.get("page_type") or selected_page.get("page_type") or "")
                .strip()
                or "conversation"
            )
            last_seen = selected_page.get("last_seen")
            if last_seen in (None, ""):
                last_seen = selected_page.get("last_poll_at") or time.time()
            try:
                last_seen_val = float(last_seen)
            except (TypeError, ValueError) as error:
                last_seen_val = time.time()
                if hasattr(self, "_append_log"):
                    self._append_log(
                        "[PAGE_BIND][LAST_SEEN_INVALID] "
                        f"field=last_seen raw={last_seen!r} "
                        f"fallback={last_seen_val} "
                        f"error_type={type(error).__name__} error={error}",
                        echo=True,
                        level="WARNING",
                    )

            bind_url = (
                (selected_page.get("url") or page_url_from(selected_page) or page_url or "")
                .strip()
            )
            if not bind_url and conversation_id:
                bind_url = f"https://chatgpt.com/c/{conversation_id}"

            last_poll_at = str(selected_page.get("last_poll_at") or "").strip()

            write_session_remote_chatgpt(
                session,
                bind_state=BIND_STATE_BOUND_CONVERSATION,
                conversation_id=conversation_id,
                url=bind_url,
                client_id=client_id,
                page_instance_id=page_instance_id,
                page_no=page_no,
                page_type=page_type,
                page_title=(selected_page.get("page_title") or "").strip(),
                last_seen=last_seen_val,
                last_poll_at=last_poll_at,
            )
            from app.utils.bind_runtime import update_bind_runtime

            update_bind_runtime(self, session, bootstrap_in_progress=False)
            session.updated_at = time.time()

            remote_after = normalize_remote_chatgpt(session.remote_chatgpt)
            conversation_title = ""
            if hasattr(self, "_session_display_title"):
                conversation_title = self._session_display_title(session)
            self._append_log(
                "[BIND][SESSION_UPDATED] "
                f"session_id={session.session_id} "
                f"conversation_title={_binding_log_text(conversation_title)} "
                f"page_no={_binding_log_text(remote_after.get('page_no') or page_no)} "
                f"client_id={_binding_log_text(remote_after.get('client_id'))} "
                f"page_instance_id={_binding_log_text(remote_after.get('page_instance_id'))} "
                f"conversation_id={_binding_log_text(remote_after.get('conversation_id'))} "
                f"url={_binding_log_text(remote_after.get('url'))}",
                echo=True,
            )

            self._refresh_current_session_binding_display()
            self._refresh_session_list(select_session_id=session.session_id)
            self._save_sessions_to_disk()
            if hasattr(self, "_update_current_session_title"):
                self._update_current_session_title(session)
            if hasattr(self, "_update_bound_page_display_light"):
                self._update_bound_page_display_light()
            self._apply_chat_bind_visual_state()
            return True
        except Exception as exc:
            self._append_log(
                "[BIND][FAILED] "
                f"reason_code=exception "
                f"error_type={type(exc).__name__} "
                f"error={exc} "
                f"traceback={traceback.format_exc()}",
                echo=True,
            )
            self._set_tm_action_hint(f"绑定失败：{exc}")
            return False

    def _fix_session_remote_url_from_conversation(self, session, *, echo=True):
        """conversation_id 已存在但 URL 仍为 xz_bind_token 时自动修复。"""
        if session is None:
            return False
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote_binding_enabled(remote):
            return False
        conversation_id = self._remote_conversation_id(remote)
        if not conversation_id:
            return False
        url = (remote.get("url") or "").strip()
        if "xz_bind_token=" not in url:
            return False
        new_url = f"https://chatgpt.com/c/{conversation_id}"
        remote["url"] = new_url
        remote["bind_state"] = BIND_STATE_BOUND_CONVERSATION
        remote["page_type"] = "conversation"
        session.remote_chatgpt = remote
        session.updated_at = time.time()
        self._save_sessions_to_disk()
        if echo:
            self._append_log(
                "[BIND][FIX_URL_FROM_CONVERSATION] "
                f"session_id={session.session_id} "
                f"conversation_id={conversation_id} "
                f"new_url={new_url}",
                echo=True,
            )
        return True

    def _update_session_binding_from_normalized_page(
        self, session, normalized, *, reason="manual_bind"
    ):
        if session is None:
            self._append_log(
                "[BIND][WRITE][SKIP] reason=session_is_none",
                echo=True,
            )
            return False
        normalized = self._normalize_tm_page_for_binding(normalized)
        if not normalized.get("client_id") and not (
            normalized.get("url")
        ):
            self._append_log(
                "[BIND][WRITE][SKIP] reason=invalid_normalized_page",
                echo=True,
            )
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        old_url = self._remote_conversation_url(remote) if remote_binding_enabled(remote) else ""
        old_conversation_id = self._remote_conversation_id(remote) or ""
        old_client_id = (remote.get("client_id") or "").strip()
        self._append_log(
            "[BIND][WRITE][BEFORE] "
            f"session_id={session.session_id} "
            f"reason={reason or '-'} "
            f"old_url={old_url or '-'} "
            f"old_conversation_id={old_conversation_id or '-'} "
            f"old_client_id={old_client_id or '-'}",
            echo=True,
        )

        new_conversation_id = (normalized.get("conversation_id") or "").strip()
        new_url = (normalized.get("url") or "").strip()
        if (
            new_conversation_id
            and old_url
            and "xz_bind_token=" in old_url
            and "/c/" not in old_url
        ):
            self._append_log(
                "[BIND][REPLACE_PREBOUND_HOME] "
                f"session_id={session.session_id} "
                f"old_url={old_url} "
                f"new_url={new_url or '-'} "
                f"conversation_id={new_conversation_id}",
                echo=True,
            )

        ok = self.set_bound_page(
            session,
            normalized,
            reason=reason or "update_binding_from_normalized",
            silent=True,
            allow_existing_conversation_for_new_session=True,
        )

        remote_after = normalize_remote_chatgpt(session.remote_chatgpt)
        new_url_after = self._remote_conversation_url(remote_after) if remote_binding_active(remote_after) else ""
        self._append_log(
            "[BIND][WRITE][AFTER] "
            f"session_id={session.session_id} "
            f"new_url={new_url_after or '-'} "
            f"new_conversation_id={self._remote_conversation_id(remote_after) or '-'} "
            f"new_client_id={(remote_after.get('client_id') or '-')} "
            f"bind_state={self._remote_bind_state(remote_after) or '-'} "
            f"ok={'yes' if ok else 'no'}",
            echo=True,
        )
        if ok:
            self._save_sessions_to_disk()
            self._refresh_session_list(select_session_id=session.session_id)
            self._refresh_current_session_binding_display()
            if hasattr(self, "_update_sync_target_display"):
                self._update_sync_target_display()
            self._apply_chat_bind_visual_state()
        return ok

    def set_bound_page(
        self,
        session,
        page,
        *,
        reason="",
        silent=False,
        allow_existing_conversation_for_new_session=False,
    ):
        """统一绑定写入入口：client_id + page_instance_id + conversation_id + url。"""
        if getattr(self, "_set_bound_page_running", False):
            if hasattr(self, "_log_reentry_skip"):
                self._log_reentry_skip("set_bound_page")
            elif hasattr(self, "_append_log"):
                self._append_log(
                    "[REENTRY][SKIP] name=set_bound_page reason=already_running",
                    echo=False,
                )
            return False
        if session is None:
            self._append_log("[BIND][SET_BOUND_PAGE][SKIP] reason=session_is_none", echo=True)
            return False
        if not isinstance(page, dict):
            self._append_log(
                f"[BIND][SET_BOUND_PAGE][SKIP] session_id={session.session_id} reason=invalid_page",
                echo=True,
            )
            return False
        bind_reason = (reason or "").strip()
        if (
            hasattr(self, "_is_manual_set_bound_page_reason")
            and not self._is_manual_set_bound_page_reason(bind_reason)
            and hasattr(self, "_should_block_automatic_bind_actions")
        ):
            blocked, mismatch_type = self._should_block_automatic_bind_actions(
                session, bind_reason=bind_reason
            )
            if blocked:
                if hasattr(self, "_log_sync_target_blocked"):
                    self._log_sync_target_blocked(session, mismatch_type)
                else:
                    self._append_log(
                        "[BIND][SET_BOUND_PAGE][SKIP] "
                        f"reason=bound_current_mismatch mismatch_type={mismatch_type or '-'} "
                        f"bind_reason={bind_reason or '-'}",
                        echo=not silent,
                    )
                return False
        self._page_cmd.set_bound_page_running = True
        try:
            return self._set_bound_page_impl(
                session,
                page,
                reason=bind_reason,
                silent=silent,
                allow_existing_conversation_for_new_session=allow_existing_conversation_for_new_session,
            )
        finally:
            self._page_cmd.set_bound_page_running = False

    def _set_bound_page_impl(
        self,
        session,
        page,
        *,
        reason="",
        silent=False,
        allow_existing_conversation_for_new_session=False,
    ):
        norm = self._normalize_tm_page_for_binding(page)
        bind_item = dict(page)
        bind_item.update(norm)
        url = (norm.get("url") or page_url_from(page) or "").strip()
        if url:
            bind_item["url"] = url
        self._append_log(
            "[BIND][SET_BOUND_PAGE] "
            f"session_id={session.session_id} "
            f"reason={reason or '-'} "
            f"client_id={(norm.get('client_id') or '-')} "
            f"page_instance_id={(norm.get('page_instance_id') or '-')} "
            f"conversation_id={(norm.get('conversation_id') or '-')} "
            f"url={url or '-'}",
            echo=not silent,
        )
        return self._bind_page_to_session(
            session,
            bind_item,
            silent=silent,
            allow_existing_conversation_for_new_session=allow_existing_conversation_for_new_session,
        )

    def _bind_page_to_session(
        self,
        session,
        client_info,
        silent=False,
        allow_existing_conversation_for_new_session=False,
    ):
        if not isinstance(client_info, dict):
            client_info = {
                "client_id": str(client_info or "").strip(),
                "url": "",
            }
        norm = self._normalize_tm_page_for_binding(client_info)
        if norm:
            client_info = dict(client_info)
            client_info.update(norm)
            if norm.get("url"):
                client_info["url"] = norm.get("url")
        if not allow_existing_conversation_for_new_session:
            rejected, reject_msg = self._reject_bind_existing_conversation_for_new_session(
                session, client_info
            )
            if rejected:
                if not silent:
                    self._add_system_message(reject_msg)
                return False
        page_url = (
            client_info.get("url")
            or client_info.get("url")
            or (client_info.get("url") or "")
            or ""
        ).strip()
        conversation_id = (
            client_info.get("conversation_id")
            or parse_conversation_id(page_url)
            or ""
        ).strip()
        page_type = (client_info.get("page_type") or "").strip()
        if not page_type:
            if conversation_id:
                page_type = "conversation"
            elif page_url and self._is_bindable_chatgpt_url(page_url):
                try:
                    path = urlparse(page_url).path or "/"
                    page_type = "home" if path in ("", "/") else "conversation"
                except ValueError as exc:
                    self._append_log(
                        f"[BIND][PAGE_TYPE_PARSE_FAIL] url={page_url!r} error={exc!r}",
                        echo=True,
                    )
                    page_type = ""
        if conversation_id:
            return self._bind_conversation_to_session(
                session,
                client_info,
                silent=silent,
                allow_existing_conversation_for_new_session=allow_existing_conversation_for_new_session,
            )
        if page_type == "home" or page_type != "conversation":
            return self._prebound_home_bind_to_session(session, client_info, silent=silent)
        return self._bind_conversation_to_session(
            session,
            client_info,
            silent=silent,
            allow_existing_conversation_for_new_session=allow_existing_conversation_for_new_session,
        )
