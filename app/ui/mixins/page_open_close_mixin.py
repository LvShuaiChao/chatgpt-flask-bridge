"""打开 / 关闭 / 刷新 ChatGPT 页面与油猴页面表格。"""

import traceback
import time
import webbrowser

import server

from app.constants import CHATGPT_HOME_URL
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from PyQt5.QtCore import QUrl, Qt
from PyQt5.QtGui import QColor, QDesktopServices
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
    def _chatgpt_url_from_remote(self, remote):
        remote = normalize_remote_chatgpt(remote)
        url = (remote.get("conversation_url") or "").strip()
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
        bind_state = self._remote_bind_state(remote)
        if remote.get("enabled") and bound_client and bound_client != client_id:
            if bind_state in (
                BIND_STATE_PREBOUND_HOME,
                BIND_STATE_WAITING_HOME,
                BIND_STATE_WAITING_CONVERSATION_CREATED,
            ):
                return
            bound_conv = (remote.get("conversation_id") or "").strip()
            if not bound_conv:
                bound_conv = parse_conversation_id(
                    remote.get("conversation_url") or ""
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
            session.remote_chatgpt = {
                **remote,
                "enabled": True,
                "bind_state": BIND_STATE_BOUND_CONVERSATION,
                "conversation_id": conversation_id,
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
        conversation_id = self._remote_conversation_id(remote)

        url = ""
        if conversation_id:
            url = self._chatgpt_url_from_remote(remote)
            if not url:
                url = f"https://chatgpt.com/c/{conversation_id}"
                session.remote_chatgpt = {
                    **remote,
                    "enabled": True,
                    "conversation_id": conversation_id,
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

        url = url.split("#", 1)[0]
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
    def _on_open_bound_chatgpt_page(self, _url=None):
        session = self._current_session()
        if session is None:
            self._add_system_message("当前没有选中的对话。")
            self._append_log(
                "[OPEN_BOUND_PAGE][FAILED] reason=no_current_session",
                echo=True,
            )
            return

        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        status = self._last_bridge_status or {}
        bound_info, _, _ = self._resolve_bound_page_info(status=status)

        bound_url = (
            remote.get("conversation_url")
            or remote.get("url")
            or ""
        ).strip()

        conversation_id = self._remote_conversation_id(remote)

        if isinstance(bound_info, dict):
            if not bound_url:
                bound_url = (
                    bound_info.get("page_url")
                    or bound_info.get("url")
                    or bound_info.get("conversation_url")
                    or ""
                ).strip()
            if not conversation_id:
                conversation_id = (self._client_conversation_id(bound_info) or "").strip()
                if not conversation_id:
                    conversation_id = parse_conversation_id(bound_url)

        if not bound_url and conversation_id:
            bound_url = f"https://chatgpt.com/c/{conversation_id}"

        if not bound_url:
            self._add_system_message(
                "当前对话没有可打开的绑定页面 URL。请先打开目标 ChatGPT 页面，然后点击“绑定当前页面”。"
            )
            self._append_log(
                f"[OPEN_BOUND_PAGE][FAILED] session_id={session.session_id} "
                "reason=no_bound_url",
                echo=True,
            )
            return

        bound_url = bound_url.split("#", 1)[0]
        self._append_log(
            "[OPEN_BOUND_PAGE][START] "
            f"session_id={session.session_id} "
            f"conversation_id={conversation_id or '-'} "
            f"url={bound_url}",
            echo=True,
        )

        ok = self._open_bound_conversation_url(bound_url)

        if ok:
            self._add_system_message(f"已打开绑定页面：{bound_url}")
            self._append_log(
                "[OPEN_BOUND_PAGE][DONE] "
                f"session_id={session.session_id} "
                f"conversation_id={conversation_id or '-'}",
                echo=True,
            )
        else:
            self._add_system_message(f"打开绑定页面失败：{bound_url}")
            self._append_log(
                "[OPEN_BOUND_PAGE][FAILED] "
                f"session_id={session.session_id} "
                "reason=open_failed "
                f"url={bound_url}",
                echo=True,
            )

    def _tm_table_signature(self, status=None):
        clients = list(self._iter_tm_clients(status or {}))
        rows = []
        for c in clients:
            rows.append(
                "|".join([
                    str(c.get("client_id", "")),
                    str(c.get("page_instance_id", "")),
                    str(c.get("page_type", "")),
                    str(c.get("conversation_id", "")),
                    str(c.get("visibility_state", c.get("visible", ""))),
                    str(bool(c.get("has_focus"))),
                    str(c.get("last_focus_at", "")),
                    str(c.get("last_seen", "")),
                    str(bool(self._page_is_online(c))),
                    str(c.get("page_url", "")),
                    str(c.get("conversation_syncable")),
                    str(c.get("sendable")),
                    str(c.get("can_send_now")),
                    str(c.get("response_state", "")),
                ])
            )
        return tuple(sorted(rows))

    def _render_tampermonkey_clients(self, status=None):
        table = getattr(self, "tm_pages_table", None)
        if table is None:
            return
        if not table.isVisible():
            return

        status = status or {}
        tm_table_key = self._tm_table_signature(status)
        if tm_table_key == getattr(self, "_last_tm_pages_table_signature", None):
            return
        self._last_tm_pages_table_signature = tm_table_key
        session_bound_id = self._session_bound_client_id()

        table.setUpdatesEnabled(False)
        table.blockSignals(True)
        try:
            table.setRowCount(0)
            for item in self._iter_tm_clients(status):
                row = table.rowCount()
                table.insertRow(row)
                client_id = item.get("client_id") or "-"
                full_url = item.get("page_url") or ""
                display_url = (
                    item.get("pathname") or self._short_page_display(full_url) or "-"
                )
                if len(display_url) > 80:
                    display_url = display_url[:80] + "..."
                page_instance_id = item.get("page_instance_id") or "-"
                if len(page_instance_id) > 24:
                    page_instance_id = page_instance_id[:24] + "…"
                page_type = item.get("page_type") or "-"
                conversation_id = item.get("conversation_id") or "-"
                if len(conversation_id) > 16:
                    conversation_id = conversation_id[:16] + "…"
                conv_sync_text = self._page_conversation_syncable_text(item)
                sendable_text = self._page_sendable_text(item)
                visibility = item.get("visibility_state") or "-"
                has_focus = "是" if self._page_has_focus(item) else "否"
                last_focus = self._format_last_seen_ago(item.get("last_focus_at"))
                last_seen = self._format_ts(item.get("last_seen"))
                page_online = self._page_is_online(item)
                online_text = "在线" if page_online else "离线"
                is_bound = (
                    "是" if session_bound_id and client_id == session_bound_id else "否"
                )
                profile = self._tm_client_sync_profile(item)
                cap_tip = (
                    f"conversation_syncable={conv_sync_text} "
                    f"sendable={sendable_text} "
                    f"blocked_reason={profile.get('blocked_reason') or profile.get('reason') or '-'}"
                )
                online_item = QTableWidgetItem(online_text)
                if page_online:
                    online_item.setForeground(Qt.darkGreen)
                else:
                    online_item.setForeground(Qt.gray)
                table.setItem(row, 0, online_item)
                table.setItem(row, 1, QTableWidgetItem(client_id))
                table.setItem(row, 2, QTableWidgetItem(page_instance_id))
                table.setItem(row, 3, QTableWidgetItem(page_type))
                table.setItem(row, 4, QTableWidgetItem(conversation_id))
                conv_sync_item = QTableWidgetItem(conv_sync_text)
                if conv_sync_text == "是":
                    conv_sync_item.setForeground(Qt.darkGreen)
                else:
                    conv_sync_item.setForeground(Qt.gray)
                conv_sync_item.setToolTip(cap_tip)
                table.setItem(row, 5, conv_sync_item)
                send_item = QTableWidgetItem(sendable_text)
                if sendable_text == "是":
                    send_item.setForeground(Qt.darkGreen)
                elif sendable_text == "等待":
                    send_item.setForeground(QColor("#ca8a04"))
                else:
                    send_item.setForeground(Qt.gray)
                send_item.setToolTip(cap_tip)
                table.setItem(row, 6, send_item)
                table.setItem(row, 7, QTableWidgetItem(visibility))
                focus_text = f"{has_focus}/{last_focus}"
                table.setItem(row, 8, QTableWidgetItem(focus_text))
                table.setItem(row, 9, QTableWidgetItem(last_seen))
                url_item = QTableWidgetItem(display_url)
                url_item.setToolTip(full_url or cap_tip)
                table.setItem(row, 10, url_item)
                bound_item = QTableWidgetItem(is_bound)
                if is_bound == "是":
                    bound_item.setForeground(Qt.darkGreen)
                table.setItem(row, 11, bound_item)
        finally:
            table.blockSignals(False)
            table.setUpdatesEnabled(True)
            table.viewport().update()

    def _on_refresh_tm_pages(self):
        if not server.is_server_running():
            self._set_tm_action_hint("请先启动服务。")
            status = {}
        else:
            status = server.get_bridge_status() or {}
        self._last_bridge_status = status
        pages = self._extract_tm_pages_from_status(status)
        self._append_log(
            "[TM_SELECTOR][MANUAL_REFRESH] "
            f"pages={len(pages)} "
            f"clients={[p.get('client_id') for p in pages]}",
            echo=False,
        )
        self._refresh_tm_page_selector(status)
        self._update_live_page_display()
        self._update_manual_current_page_display()
        self._update_bound_page_display()
        if not server.is_server_running():
            return
        self._schedule_status_apply(status, reason="refresh_tm_pages", force=True)
        self._set_tm_action_hint(f"已刷新，共 {len(pages)} 个页面。")
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
        if not self._page_is_online(keep_info):
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
