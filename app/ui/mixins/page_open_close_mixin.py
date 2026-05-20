"""打开 / 关闭 / 刷新 ChatGPT 页面与油猴页面表格。"""

import traceback
import time
import uuid
import webbrowser
from urllib.parse import urlparse

import server

from app.constants import CHATGPT_HOME_URL
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from PyQt5.QtCore import QUrl, Qt
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QTableWidgetItem


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

        if server.is_server_running():
            msg = self._push_open_url(target, active=True, label=label)
            if msg is not None:
                self._append_log(
                    f"[打开网页] 系统浏览器打开失败，已通过油猴队列打开："
                    f"{label or target}"
                )
                return True

        self._append_log(f"[打开网页] 打开失败：{target}")
        return False
    def _auto_open_url_once(self, session, url, label="", interval=20):
        target = (url or "").strip()
        if not target:
            return False

        session_id = session.session_id if session else "-"
        key = f"{session_id}|{target}"
        now = time.time()
        last_open_at = self._last_auto_open_url_at.get(key, 0)

        if now - last_open_at < interval:
            self._append_log(
                f"[打开网页] 跳过重复自动打开，{interval} 秒内已打开过：{target}"
            )
            return False

        self._last_auto_open_url_at[key] = now
        self._mark_auto_bind_waiting()

        if self._open_url_in_browser(target, label):
            self._append_log(
                f"[打开网页] 已通过系统浏览器打开：{label or target}"
            )
            return True

        if server.is_server_running():
            msg = self._push_open_url(target, active=True, label=label)
            if msg is not None:
                self._append_log(
                    f"[打开网页] 已通过油猴队列打开：{label or target}"
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
    def _open_tampermonkey_page(self, url=None):
        target = (url or self._tampermonkey_page_url or "").strip()
        if not target or target == "-":
            self._add_system_message("当前没有可打开的 ChatGPT 页面地址。")
            return
        if self._open_url_in_browser(target, target):
            return
        self._add_system_message(f"无法打开页面：{target}")
    def _chatgpt_url_from_remote(self, remote):
        remote = normalize_remote_chatgpt(remote)
        url = (remote.get("conversation_url") or "").strip()
        if url and self._is_bindable_chatgpt_url(url):
            return url
        conversation_id = (remote.get("conversation_id") or "").strip()
        if conversation_id:
            return f"https://chatgpt.com/c/{conversation_id}"
        return ""
    def _session_openable_chatgpt_url(self, session):
        if session is None:
            return ""
        return self._chatgpt_url_from_remote(session.remote_chatgpt)
    def _live_openable_chatgpt_url(self):
        status = self._last_bridge_status or {}
        if not status.get("tampermonkey_online"):
            return ""
        url = (status.get("tampermonkey_page_url") or "").strip()
        if self._is_bindable_chatgpt_url(url):
            return url
        return ""
    def _session_bound_conversation_url(self, session):
        if session is None:
            return ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return ""
        return self._chatgpt_url_from_remote(remote)
    def _bound_conversation_url(self):
        return self._session_bound_conversation_url(self._current_session())
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
        page_url = (client_info.get("page_url") or "").strip()
        if not self._is_bindable_chatgpt_url(page_url):
            return
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bound_client = (remote.get("client_id") or "").strip()
        if remote.get("enabled") and bound_client and bound_client != client_id:
            bound_conv = (remote.get("conversation_id") or "").strip()
            if not bound_conv:
                bound_conv = parse_conversation_id(
                    remote.get("conversation_url") or ""
                )
            new_conv = self._client_conversation_id(client_info)
            if not (bound_conv and new_conv and bound_conv == new_conv):
                return
        conversation_id = (client_info.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(page_url)
        page_type = (client_info.get("page_type") or "").strip()
        if conversation_id or page_type == "conversation":
            session.remote_chatgpt = {
                **remote,
                "enabled": True,
                "bind_state": BIND_STATE_BOUND_CONVERSATION,
                "conversation_id": conversation_id,
                "conversation_url": page_url,
                "url": page_url,
                "client_id": client_id,
                "page_instance_id": (client_info.get("page_instance_id") or "").strip(),
                "page_type": "conversation",
                "page_title": (client_info.get("page_title") or "").strip(),
                "last_seen": time.time(),
                "bootstrap_in_progress": False,
            }
        else:
            session.remote_chatgpt = {
                **remote,
                "enabled": bool(remote.get("enabled")),
                "last_seen": time.time(),
            }
        self._save_sessions_to_disk()
    def _open_bound_page_for_session(self, session, label="", fallback_live=False):
        if session is None:
            return False

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )

        url = ""
        if conversation_id:
            url = self._chatgpt_url_from_remote(remote)
            if not url:
                url = f"https://chatgpt.com/c/{conversation_id}"
                session.remote_chatgpt = {
                    **remote,
                    "enabled": True,
                    "conversation_id": conversation_id,
                    "conversation_url": url,
                    "url": url,
                    "page_type": "conversation",
                }
                session.updated_at = time.time()
                self._save_sessions_to_disk()
        else:
            url = self._session_openable_chatgpt_url(session)
            if not url and fallback_live:
                url = self._live_openable_chatgpt_url()
                if url:
                    cid = (
                        self._last_bridge_status.get("tampermonkey_client_id") or ""
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

        self._append_log(
            "[OLD_SESSION][OPEN] "
            f"session_id={session.session_id} "
            f"conversation_id={conversation_id or '-'} "
            f"url={url}"
        )
        return self._open_page_once(url, label or "打开 ChatGPT 页面")
    def _push_open_url(self, url, active=True, label=""):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return None
        target = (url or "").strip()
        if not target:
            self._add_system_message("URL 为空，无法下发打开命令。")
            return None
        status = server.get_bridge_status()
        if not status.get("tampermonkey_online"):
            self._append_log(
                "[打开网页] 警告：油猴当前离线，命令已入队，需有已加载脚本的 ChatGPT 标签页在线后才会执行。"
            )
        try:
            msg = server.push_open_url(target, active=active)
        except Exception as error:
            detail = f"open_url 入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"打开网页命令入队失败：{error}")
            return None
        short_id = (msg.get("id") or "")[:8]
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
        if server.is_server_running():
            msg = self._push_open_url(CHATGPT_HOME_URL, active=True, label=label)
            if msg is not None:
                self._set_settings_hint("系统浏览器打开失败，已通过油猴尝试打开 ChatGPT。")
                return
        self._add_system_message(
            "无法打开 ChatGPT。请检查默认浏览器，或确认服务和油猴在线。"
        )
    def _on_open_new_chatgpt_tab(self):
        self._mark_auto_bind_waiting()
        label = "新 ChatGPT 标签页"
        if self._open_url_in_browser(CHATGPT_HOME_URL, label):
            self._set_settings_hint("已在默认浏览器中打开新的 ChatGPT 页面。")
            self._append_log("[打开网页] 已通过系统浏览器打开新的 ChatGPT 页面。")
            return
        if server.is_server_running():
            msg = self._push_open_url(CHATGPT_HOME_URL, active=True, label=label)
            if msg is not None:
                self._set_settings_hint("系统浏览器打开失败，已通过油猴尝试打开新页面。")
                return
        self._add_system_message(
            "无法打开新 ChatGPT 页面。请检查默认浏览器，或确认服务和油猴在线。"
        )
    def _on_open_bound_chatgpt_page(self, _url=None):
        session = self._current_session()
        if session is None:
            self._add_system_message("当前没有选中的对话。")
            return
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        conversation_id = (remote.get("conversation_id") or "").strip()
        if not conversation_id:
            conversation_id = parse_conversation_id(
                remote.get("conversation_url") or remote.get("url") or ""
            )
            if conversation_id:
                conversation_url = f"https://chatgpt.com/c/{conversation_id}"
                session.remote_chatgpt = {
                    **remote,
                    "enabled": True,
                    "conversation_id": conversation_id,
                    "conversation_url": conversation_url,
                    "url": conversation_url,
                    "page_type": "conversation",
                }
                session.updated_at = time.time()
                self._save_sessions_to_disk()
                remote = normalize_remote_chatgpt(session.remote_chatgpt)

        if conversation_id:
            target_url = self._bound_conversation_target_url(remote)
            if not target_url:
                target_url = f"https://chatgpt.com/c/{conversation_id}"
            self._append_log(
                "[OLD_SESSION][OPEN] "
                f"session_id={session.session_id} "
                f"conversation_id={conversation_id} "
                f"url={target_url}"
            )
            reopen_request_id = (remote.get("reopen_request_id") or "").strip()
            if not reopen_request_id:
                reopen_request_id = uuid.uuid4().hex
            self._open_bound_conversation_url(
                target_url, reopen_request_id=reopen_request_id
            )
            return

        self._open_bound_page_for_session(
            session, label="当前对话 ChatGPT 页面", fallback_live=False
        )
    def _flash_bound_chatgpt_page(self):
        session = self._current_session()
        if not session:
            self._append_log(
                "[BIND][FLASH] 当前没有选中的 GUI 对话", echo=True
            )
            self._add_system_message("当前没有选中的 GUI 对话。")
            return

        if not server.is_server_running():
            self._append_log("[BIND][FLASH] 服务未启动", echo=True)
            self._add_system_message("请先启动服务。")
            return

        remote = normalize_remote_chatgpt(session.remote_chatgpt if session else None)
        client_id = (remote.get("client_id") or remote.get("bound_client_id") or "").strip()
        page_instance_id = (remote.get("page_instance_id") or "").strip()
        conversation_id = (remote.get("conversation_id") or "").strip()
        page_type = (remote.get("page_type") or "").strip()
        url = (remote.get("url") or remote.get("page_url") or remote.get("conversation_url") or "").strip()

        if not client_id:
            self._append_log(
                "[BIND][FLASH] 当前 GUI 对话尚未绑定 ChatGPT 页面", echo=True
            )
            self._add_system_message("当前 GUI 对话尚未绑定 ChatGPT 页面。")
            return

        status = server.get_bridge_status()
        client_info = self._client_info_by_id(client_id, status=status)

        if not client_info or not client_info.get("online"):
            self._append_log(
                f"[BIND][FLASH] 绑定页面离线 client_id={client_id} "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
            self._add_system_message("绑定的 ChatGPT 页面当前离线，无法定位绑定页。")
            return

        ok = server.enqueue_control_command(
            command="flash_page",
            target_client_id=client_id,
            target_page_instance_id=page_instance_id,
            target_conversation_id=conversation_id,
            payload={
                "title": "GUI 已定位此页面",
                "message": "当前 ChatGPT 页面已绑定到当前 GUI 对话。",
                "duration_ms": 5000,
                "blink_count": 8,
                "page_type": page_type,
                "url": url,
                "client_id": client_id,
                "conversation_id": conversation_id,
                "page_instance_id": page_instance_id,
                "flash_title": True,
                "flash_favicon": True,
            },
        )

        if ok:
            self._append_log(
                f"[BIND][FLASH] 已发送定位命令 "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
                f"conversation_id={conversation_id or '-'} "
                f"flash_title=true flash_favicon=true",
                echo=True,
            )
            self._add_system_message(
                "已向绑定的 ChatGPT 页面发送定位命令（边框、标题、favicon 将闪烁）。"
            )
        else:
            self._append_log(
                f"[BIND][FLASH][ERROR] 定位命令发送失败 client_id={client_id}",
                echo=True,
            )
            self._add_system_message("定位绑定页命令发送失败，请查看日志。")
    def _render_tampermonkey_clients(self, status=None):
        status = status or {}
        session_bound_id = self._session_bound_client_id()
        self.tm_pages_table.setRowCount(0)
        for item in self._iter_tm_clients(status):
            row = self.tm_pages_table.rowCount()
            self.tm_pages_table.insertRow(row)
            client_id = item.get("client_id") or "-"
            full_url = item.get("page_url") or ""
            display_url = item.get("pathname") or self._short_page_display(full_url) or "-"
            if len(display_url) > 80:
                display_url = display_url[:80] + "..."
            page_instance_id = item.get("page_instance_id") or "-"
            if len(page_instance_id) > 24:
                page_instance_id = page_instance_id[:24] + "…"
            page_type = item.get("page_type") or "-"
            conversation_id = item.get("conversation_id") or "-"
            if len(conversation_id) > 16:
                conversation_id = conversation_id[:16] + "…"
            visibility = item.get("visibility_state") or "-"
            has_focus = "是" if item.get("has_focus") else "否"
            last_focus = self._format_last_seen_ago(item.get("last_focus_at"))
            last_seen = self._format_ts(item.get("last_seen"))
            online_text = "在线" if item.get("online") else "离线"
            is_bound = "是" if session_bound_id and client_id == session_bound_id else "否"
            online_item = QTableWidgetItem(online_text)
            if item.get("online"):
                online_item.setForeground(Qt.darkGreen)
            else:
                online_item.setForeground(Qt.gray)
            self.tm_pages_table.setItem(row, 0, online_item)
            self.tm_pages_table.setItem(row, 1, QTableWidgetItem(client_id))
            self.tm_pages_table.setItem(row, 2, QTableWidgetItem(page_instance_id))
            self.tm_pages_table.setItem(row, 3, QTableWidgetItem(page_type))
            self.tm_pages_table.setItem(row, 4, QTableWidgetItem(conversation_id))
            self.tm_pages_table.setItem(row, 5, QTableWidgetItem(visibility))
            focus_text = f"{has_focus}/{last_focus}"
            self.tm_pages_table.setItem(row, 6, QTableWidgetItem(focus_text))
            self.tm_pages_table.setItem(row, 7, QTableWidgetItem(last_seen))
            url_item = QTableWidgetItem(display_url)
            url_item.setToolTip(full_url)
            self.tm_pages_table.setItem(row, 8, url_item)
            bound_item = QTableWidgetItem(is_bound)
            if is_bound == "是":
                bound_item.setForeground(Qt.darkGreen)
            self.tm_pages_table.setItem(row, 9, bound_item)
    def _on_refresh_tm_pages(self):
        if not server.is_server_running():
            self._set_tm_action_hint("请先启动服务。")
            return
        status = server.get_bridge_status()
        self._apply_bridge_status(status)
        count = len(status.get("tampermonkey_clients") or [])
        self._set_tm_action_hint(f"已刷新，共 {count} 个页面。")
    def _on_reload_bound_tm_page(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            self._append_log("[刷新网页] 服务未启动，无法刷新绑定页面。")
            return
        client_id = self._session_bound_client_id()
        if not client_id:
            self._add_system_message(
                "当前对话未绑定在线 ChatGPT 页面，无法刷新绑定网页。"
            )
            self._append_log("[刷新网页] 当前对话未绑定 client_id。")
            return
        try:
            msg = server.push_reload_page(client_id)
        except Exception as error:
            detail = f"reload_self 入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"刷新绑定网页失败：{error}")
            return
        short_id = (msg.get("id") or "")[:8]
        self._append_log(
            f"[刷新网页] 已向绑定页面下发 reload_self ({short_id}…) "
            f"client_id={client_id}"
        )
        self._set_settings_hint(f"已向绑定页面 {client_id} 下发刷新命令。")
    def _enqueue_close_page(self, client_id, label=""):
        if not server.is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            return None
        client_id = (client_id or "").strip()
        if not client_id:
            self._append_log("[关闭页面] 未指定 client_id。")
            return None
        try:
            msg = server.push_close_page(client_id)
        except Exception as error:
            detail = f"close_self 入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            return None
        short_id = (msg.get("id") or "")[:8]
        desc = label or client_id
        self._append_log(f"[关闭页面] 已下发 close_self ({short_id}…) {desc}")
        return msg
    def _on_close_selected_tm_page(self):
        client_id = self._selected_tm_page_client_id()
        if not client_id:
            self._set_tm_action_hint(
                "请先在页面下拉框或设置页表格中选择要关闭的页面。"
            )
            self._append_log("[关闭页面] 未选中页面，已取消。")
            return
        self._enqueue_close_page(client_id, label=f"选中页面 {client_id}")
        self._set_tm_action_hint(f"已向 {client_id} 下发关闭命令。")
    def _on_close_other_tm_pages(self):
        if not server.is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            self._set_tm_action_hint("请先启动服务。")
            return
        status = server.get_bridge_status()
        self._last_bridge_status = status
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
        if not bool(keep_info.get("online")):
            current_client_id = (status.get("tampermonkey_client_id") or "").strip()
            self._set_tm_action_hint(
                "当前绑定页面已离线，为避免误关所有在线页面，已取消。请先点击「绑定当前页面」。"
            )
            self._append_log(
                f"[关闭页面][取消] 绑定页面离线，已阻止关闭其他页面"
                f" keep_client_id={except_id} current_client_id={current_client_id or '-'}"
            )
            return
        current_client_id = (status.get("tampermonkey_client_id") or "").strip()
        if current_client_id and current_client_id != except_id:
            self._set_tm_action_hint(
                "当前可见页面不是本对话绑定页，请先绑定当前页面后再关闭其他页面。"
            )
            self._append_log(
                "[关闭页面][取消] 当前可见页面不是本对话绑定页，已阻止关闭其他页面。"
                f" keep_client_id={except_id} current_client_id={current_client_id}"
            )
            return
        try:
            msgs = server.push_close_other_pages(except_id)
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
        if not server.is_server_running():
            self._append_log("[关闭页面] 服务未启动，无法下发命令。")
            self._set_tm_action_hint("请先启动服务。")
            return
        client_id = self._session_bound_client_id()
        if not client_id:
            self._set_tm_action_hint("当前对话未绑定在线 ChatGPT 页面。")
            self._append_log("[关闭页面] 当前对话未绑定 client_id，已取消。")
            return
        self._enqueue_close_page(client_id, label=f"绑定页面 {client_id}")
        self._set_tm_action_hint(f"已向绑定页面 {client_id} 下发关闭命令。")

