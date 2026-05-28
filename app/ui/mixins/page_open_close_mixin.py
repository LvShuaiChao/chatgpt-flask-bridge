"""打开 / 关闭 / 刷新 ChatGPT 页面与油猴页面表格。"""

from app.server import (
    get_bridge_status,
    is_server_running,
    push_close_other_pages,
    push_close_page,
    push_open_url,
)

import traceback
import time
import webbrowser

from app.constants import CHATGPT_HOME_URL
from app.models import (
    remote_binding_enabled,
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.utils.page_status import bridge_status_online
from app.utils.page_status import page_url_from, read_snapshot_identity
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices


class PageOpenCloseMixin:

    def _open_or_queue_url(self, url, label=""):
        target = (url or "").strip()
        if not target:
            self._append_log("[打开网页] URL 为空，已取消。")
            return False

        self._mark_auto_bind_waiting()

        if self._open_url_in_browser(target, label):
            self._append_log(
                f"[打开网页] 已通过系统浏览器打开：{label or target}"
            )
            return True

        if is_server_running():
            msg = self._push_open_url(target, active=True, label=label)
            if msg is not None:
                self._append_log(
                    f"[打开网页] 系统浏览器打开失败，已通过油猴队列打开："
                    f"{label or target}"
                )
                return True

        self._append_log(f"[打开网页] 打开失败：{target}")
        return False
    def _open_page_once(self, open_url, label):
        return self._open_or_queue_url(open_url, label)
    def _open_url_in_browser(self, url, label=""):
        target = (url or "").strip()
        if not target or target == "-":
            return False
        qurl = QUrl(target)
        if not qurl.isValid():
            self._add_system_message(f"页面地址无效：{target}")
            return False
        if QDesktopServices.openUrl(qurl):
            self._append_log(f"[打开浏览器] {label or target}")
            return True
        try:
            if webbrowser.open(target):
                self._append_log(f"[打开浏览器] {label or target}")
                return True
        except Exception as error:
            detail = f"打开页面失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"打开页面失败：{error}")
            return False
        return False
    def _chatgpt_url_from_remote(self, remote):
        remote = normalize_remote_chatgpt(remote)
        url = ((remote.get("url") or "") or "").strip()
        if url and self._is_bindable_chatgpt_url(url):
            return url
        conversation_id = self._remote_conversation_id(remote)
        if conversation_id:
            return f"https://chatgpt.com/c/{conversation_id}"
        return ""
    def _session_openable_chatgpt_url(self, session):
        if session is None:
            return ""
        return self._chatgpt_url_from_remote(session.remote_chatgpt)
    def _live_openable_chatgpt_url(self):
        status = self._bridge_ui.last_bridge_status or {}
        if not bridge_status_online(status):
            return ""
        for page in status.get("pages") or []:
            if not isinstance(page, dict) or not self._tm_page_is_online_simple(page):
                continue
            url = page_url_from(page)
            if self._is_bindable_chatgpt_url(url):
                return url
        return ""
    def _remember_session_page_from_client(self, session, client_id):
        if session is None:
            return
        client_id = (client_id or "").strip()
        if not client_id:
            return
        client_info = self._client_info_from_status(client_id)
        if not client_info:
            return
        rejected, _reject_msg = self._reject_bind_existing_conversation_for_new_session(
            session, client_info, log_prefix="BIND"
        )
        if rejected:
            return
        page_url = (client_info.get("url") or "").strip()
        if not self._is_bindable_chatgpt_url(page_url):
            return
        # 防止旧首页快照覆盖已绑定对话
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = self._client_conversation_id(client_info)
        if not conversation_id and page_url.rstrip("/") in (
            "https://chatgpt.com/", "https://chatgpt.com",
        ):
            if self._remote_bind_state(remote) == BIND_STATE_BOUND_CONVERSATION:
                old_conv = (remote.get("conversation_id") or "").strip()
                if not old_conv:
                    old_conv = parse_conversation_id((remote.get("url") or "").strip()) or ""
                if old_conv:
                    self._append_log(
                        "[BIND][IGNORE_STALE_HOME_PAGE] "
                        f"reason=conversation_already_bound "
                        f"session_id={session.session_id} "
                        f"old_conversation_id={old_conv} "
                        f"incoming_page_no={(client_info.get('page_no') or '-')}",
                        echo=True,
                    )
                    return
        # 继续原有逻辑
        bound_client = (remote.get("client_id") or "").strip()
        bind_state = self._remote_bind_state(remote)
        if remote_binding_enabled(remote) and bound_client and bound_client != client_id:
            if bind_state in (
                BIND_STATE_PREBOUND_HOME,
                BIND_STATE_WAITING_HOME,
                BIND_STATE_WAITING_CONVERSATION_CREATED,
            ):
                return
            bound_conv = (remote.get("conversation_id") or "").strip()
            if not bound_conv:
                bound_conv = parse_conversation_id(
                    (remote.get("url") or "") or ""
                )
            new_conv = self._client_conversation_id(client_info)
            if not (bound_conv and new_conv and bound_conv == new_conv):
                return
        if hasattr(self, "set_bound_page"):
            self.set_bound_page(
                session,
                client_info,
                reason="remember_session_page_from_client",
                silent=True,
                allow_existing_conversation_for_new_session=True,
            )
            return
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(page_url)
        page_type = (client_info.get("page_type") or "").strip()
        if conversation_id or page_type == "conversation":
            from app.utils.bind_runtime import update_bind_runtime

            session.remote_chatgpt = {
                **remote,
                "bind_state": BIND_STATE_BOUND_CONVERSATION,
                "conversation_id": conversation_id,
                "url": page_url,
                "client_id": client_id,
                "page_instance_id": (client_info.get("page_instance_id") or "").strip(),
            }
            update_bind_runtime(self, session, bootstrap_in_progress=False)
        else:
            session.remote_chatgpt = dict(remote)
        self._schedule_save_sessions_to_disk()
    def _open_bound_page_for_session(self, session, label="", fallback_live=False):
        if session is None:
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = self._remote_conversation_id(remote)

        url = ""
        if conversation_id:
            url = self._chatgpt_url_from_remote(remote)
            if not url:
                url = f"https://chatgpt.com/c/{conversation_id}"
                session.remote_chatgpt = {
                    **remote,
                    "bind_state": BIND_STATE_BOUND_CONVERSATION,
                    "conversation_id": conversation_id,
                    "url": url,
                }
                session.updated_at = time.time()
                self._schedule_save_sessions_to_disk()
        else:
            url = self._session_openable_chatgpt_url(session)
            if not url and fallback_live:
                url = self._live_openable_chatgpt_url()
                if url:
                    cid = (
                        read_snapshot_identity(self._bridge_ui.last_bridge_status, "active")["client_id"] or ""
                    ).strip()
                    if cid:
                        self._remember_session_page_from_client(session, cid)

        if not url:
            self._append_log(
                "[OLD_SESSION][OPEN_FAILED] "
                f"session_id={session.session_id} "
                f"reason=no_conversation_url"
            )
            self._add_system_message(
                "旧记录缺少 ChatGPT 页面地址，无法打开。"
                "若该对话曾绑定过 ChatGPT，请检查 chat_sessions.json 是否包含对话 URL。"
            )
            return False

        url = url.split("#", 1)[0]
        self._append_log(
            "[OLD_SESSION][OPEN] "
            f"session_id={session.session_id} "
            f"conversation_id={conversation_id or '-'} "
            f"url={url}"
        )
        return self._open_page_once(url, label or "打开 ChatGPT 页面")
    def _push_open_url(self, url, active=True, label=""):
        if not is_server_running():
            self._add_system_message("请先启动服务。")
            return None
        target = (url or "").strip()
        if not target:
            self._add_system_message("URL 为空，无法下发打开命令。")
            return None
        status = get_bridge_status()
        if not bridge_status_online(status):
            self._append_log(
                "[打开网页] 警告：油猴当前离线，命令已入队，需有已加载脚本的 ChatGPT 标签页在线后才会执行。"
            )
        try:
            msg = push_open_url(target, active=active)
        except Exception as error:
            detail = f"open_url 入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"打开网页命令入队失败：{error}")
            return None
        short_id = (msg.get("message_id") or "")[:8]
        desc = label or target
        self._append_log(f"[打开网页] 已下发 ({short_id}…) {desc}")
        return msg
    def _on_open_chatgpt_home(self):
        self._mark_auto_bind_waiting()
        label = "ChatGPT 首页"
        if self._open_url_in_browser(CHATGPT_HOME_URL, label):
            self._set_settings_hint("已在默认浏览器中打开 ChatGPT 首页。")
            self._append_log("[打开网页] 已通过系统浏览器打开 ChatGPT 首页。")
            return
        if is_server_running():
            msg = self._push_open_url(CHATGPT_HOME_URL, active=True, label=label)
            if msg is not None:
                self._set_settings_hint("系统浏览器打开失败，已通过油猴尝试打开 ChatGPT。")
                return
        self._add_system_message(
            "无法打开 ChatGPT。请检查默认浏览器，或确认服务和油猴在线。"
        )

    def _set_page_list_refresh_busy(self, busy):
        refresh_btn = getattr(self, "refresh_page_list_btn", None)
        if refresh_btn is not None:
            refresh_btn.setEnabled(True)
        if hasattr(self, "_sync_tm_page_list_empty_ui"):
            self._sync_tm_page_list_empty_ui()

    def _auto_refresh_tm_pages_if_needed(self, reason="auto"):
        if not is_server_running():
            return
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason=reason or "auto")

    def _enqueue_close_page(self, client_id, label=""):
        if not is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            return None
        client_id = (client_id or "").strip()
        if not client_id:
            self._append_log("[关闭页面] 未指定 client_id。")
            return None
        try:
            msg = push_close_page(client_id)
        except Exception as error:
            detail = f"close_self 入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            return None
        short_id = (msg.get("message_id") or "")[:8]
        desc = label or client_id
        self._append_log(f"[关闭页面] 已下发 close_self ({short_id}…) {desc}")
        return msg
    def _on_close_other_tm_pages(self):
        if not is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            self._set_tm_action_hint("请先启动服务。")
            return
        status = get_bridge_status()
        self._bridge_ui.last_bridge_status = status
        except_id = self._session_bound_client_id()
        if not except_id:
            self._set_tm_action_hint("当前对话未绑定页面，无法关闭其他页面。")
            self._append_log("[关闭页面] 当前对话未绑定 client_id，已取消。")
            return
        keep_info = self._client_info_by_id(except_id, status=status)
        if not keep_info:
            self._set_tm_action_hint(
                "当前绑定页面不在页面列表中，为避免误关所有页面，已取消。"
            )
            self._append_log(
                f"[关闭页面][取消] 绑定页面不存在，已阻止关闭其他页面。"
                f" keep_client_id={except_id}"
            )
            return
        if not self._page_is_online(keep_info):
            current_client_id = (read_snapshot_identity(status, "active")["client_id"] or "").strip()
            self._set_tm_action_hint(
                "当前绑定页面已离线，为避免误关所有在线页面，已取消。请先点击「绑定所选页面」。"
            )
            self._append_log(
                f"[关闭页面][取消] 绑定页面离线，已阻止关闭其他页面"
                f" keep_client_id={except_id} current_client_id={current_client_id or '-'}"
            )
            return
        current_client_id = (read_snapshot_identity(status, "active")["client_id"] or "").strip()
        if current_client_id and current_client_id != except_id:
            self._set_tm_action_hint(
                "当前可见页面不是本对话绑定页，请先绑定所选页面后再关闭其他页面。"
            )
            self._append_log(
                "[关闭页面][取消] 当前可见页面不是本对话绑定页，已阻止关闭其他页面。"
                f" keep_client_id={except_id} current_client_id={current_client_id}"
            )
            return
        try:
            msgs = push_close_other_pages(except_id)
        except Exception as error:
            detail = f"批量关闭页面失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._set_tm_action_hint(f"关闭其他页面失败：{error}")
            return
        self._append_log(
            f"[关闭页面] 已关闭其他页面，保留绑定 {except_id}，共下发 {len(msgs)} 条命令。"
        )
        self._set_tm_action_hint(
            f"已向除 {except_id} 外的 {len(msgs)} 个在线页面下发关闭命令。"
        )

    def _on_close_bound_tm_page(self):
        """调试页按钮入口：关闭当前绑定 ChatGPT 页面。"""
        self._append_log("[DEBUG][CLOSE_CURRENT_BOUND][CLICK]")
        try:
            if not is_server_running():
                self._append_log(
                    "[DEBUG][CLOSE_CURRENT_BOUND][FAILED] reason=server-not-running"
                )
                self._append_log("[关闭页面] 服务未启动，无法下发命令。")
                self._set_tm_action_hint("请先启动服务。")
                return

            client_id = self._session_bound_client_id()
            if not client_id:
                self._append_log("[DEBUG][CLOSE_CURRENT_BOUND][NO_BOUND_PAGE]")
                self._set_tm_action_hint("当前对话未绑定页面，无法关闭绑定页。")
                self._append_log("[关闭页面] 当前对话未绑定 client_id，已取消。")
                return

            status = get_bridge_status()
            self._bridge_ui.last_bridge_status = status

            page_info = self._client_info_by_id(client_id, status=status)
            if not page_info:
                self._append_log(
                    "[DEBUG][CLOSE_CURRENT_BOUND][FAILED] "
                    f"reason=bound-page-missing client_id={client_id}"
                )
                self._set_tm_action_hint(
                    "当前绑定页面不在页面列表中，无法关闭。"
                )
                return

            if not self._page_is_online(page_info):
                self._append_log(
                    "[DEBUG][CLOSE_CURRENT_BOUND][FAILED] "
                    f"reason=bound-page-offline client_id={client_id}"
                )
                self._set_tm_action_hint("当前绑定页面已离线，无法关闭。")
                return

            page_url = page_url_from(page_info) or (page_info.get("url") or "").strip()
            self._append_log(
                "[DEBUG][CLOSE_CURRENT_BOUND][TARGET] "
                f"client_id={client_id} url={page_url or '-'}"
            )

            msg = self._enqueue_close_page(
                client_id, label=f"当前绑定页面 {client_id}"
            )
            if msg is None:
                self._append_log(
                    "[DEBUG][CLOSE_CURRENT_BOUND][FAILED] "
                    f"reason=enqueue-failed client_id={client_id}"
                )
                return

            self._append_log(
                f"[DEBUG][CLOSE_CURRENT_BOUND][DONE] closed=1 client_id={client_id}"
            )
            self._set_tm_action_hint(
                f"已向当前绑定页面 {client_id} 下发关闭命令。"
            )
        except Exception as error:
            detail = f"{error}\n{traceback.format_exc()}"
            self._append_log(
                f"[DEBUG][CLOSE_CURRENT_BOUND][FAILED] reason=exception error={detail}",
                echo=True,
            )
            self._set_tm_action_hint(f"关闭绑定页面失败：{error}")
