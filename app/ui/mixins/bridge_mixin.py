import html
import json
import re
import sys
import time
import traceback
import uuid
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

import server
from log_utils import append_log, append_exception, clear_log_file, get_log_file_path

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
    PENDING_ASSISTANT_STATUSES,
    CHATGPT_HOME_URL,
    DEFAULT_APP_SETTINGS,
    RUNTIME_DIR,
    SESSIONS_FILE,
    SESSIONS_JSON_VERSION,
    SETTINGS_APP,
    SETTINGS_ORG,
)
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    ChatMessage,
    ChatSession,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from app.ui.widgets.bridge_notifier import BridgeNotifier
from app.ui.widgets.chat_bubble import ChatBubble, SystemBubble
from app.ui.widgets.chat_input import ChatInput
from app.ui.widgets.session_list import SessionListWidget
from PyQt5.QtCore import QObject, QSettings, QUrl, Qt, QTimer, pyqtSignal
from PyQt5.QtGui import QDesktopServices, QFont
from PyQt5.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMainWindow,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class BridgeMixin:
    def _render_status_summary(self, status):
        status = status or {}
        host = self.host_edit.text().strip() or "127.0.0.1"
        port = self.port_edit.text().strip() or "5000"
        last_seen = status.get("tampermonkey_last_seen")
        page_url = self._tampermonkey_page_url or status.get("tampermonkey_page_url") or "-"
        if status.get("tampermonkey_online"):
            tm_text = "在线"
        elif last_seen:
            tm_text = "离线"
        else:
            tm_text = "未连接"
        lines = [
            f"服务运行：{'是' if status.get('server_running') else '否'}",
            f"监听地址：{host}:{port}",
            f"油猴状态：{tm_text}",
            f"最后心跳：{self._format_ts(last_seen)}",
            f"油猴 client_id：{status.get('tampermonkey_client_id') or '-'}",
            f"全局绑定 client_id：{status.get('bound_client_id') or '-'}",
            f"本对话绑定 client_id：{self._session_bound_client_id() or '-'}",
            f"已知 ChatGPT 页面数：{len(status.get('tampermonkey_clients') or [])}",
        ]
        summary = self._tm_summary_for_session()
        lines.extend([
            f"油猴在线：{summary.get('online_clients', 0)} / 总 {summary.get('total_clients', 0)}",
            f"会话页在线：{summary.get('online_conversation_clients', 0)}",
            f"首页在线：{summary.get('online_home_clients', 0)}",
            f"绑定在线：{summary.get('bound_online')}",
            f"活跃 client：{summary.get('active_client_id') or '-'}",
        ])
        lines.extend([
            f"待发队列：{status.get('queue_length', 0)}",
            f"控制命令队列：{status.get('control_queue_length', 0)}",
            f"控制命令等待：{status.get('control_waiting_count', 0)}",
            f"入站事件数：{status.get('inbound_count', 0)}",
            f"当前油猴页面：{page_url}",
            f"本对话绑定页面：{self._bound_conversation_url() or '未绑定'}",
        ])
        waiting_acks = status.get("waiting_acks") or []
        if not waiting_acks and status.get("waiting_ack"):
            waiting_acks = [status.get("waiting_ack")]
        if waiting_acks:
            lines.append(f"等待回执消息数：{len(waiting_acks)}")
            for waiting in waiting_acks[:5]:
                lines.append(
                    f"  · {waiting.get('id', '?')[:8]}… "
                    f"status={waiting.get('status', '?')} "
                    f"delivered_to={waiting.get('delivered_to', '-')}"
                )
        self.status_log_edit.setPlainText("\n".join(lines))
    @staticmethod
    def _refresh_status_chip(label, state=""):
        label.setProperty("state", state or "")
        style = label.style()
        style.unpolish(label)
        style.polish(label)
    def _apply_bridge_status(self, status):
        status = status or {}

        if getattr(self, "_applying_bridge_status", False):
            self._pending_bridge_status = status
            return

        self._applying_bridge_status = True
        try:
            self._apply_bridge_status_impl(status)
        except Exception as error:
            detail = f"刷新桥接状态失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
        finally:
            self._applying_bridge_status = False
            pending = getattr(self, "_pending_bridge_status", None)
            self._pending_bridge_status = None
            if pending is not None:
                QTimer.singleShot(0, lambda s=pending: self._apply_bridge_status(s))

    def _apply_bridge_status_impl(self, status):
        status = status or {}
        self._last_bridge_status = status
        self._append_log("[STATUS_APPLY][STEP] start")
        server_running = bool(status.get("server_running"))
        if server_running:
            self.status_label.setText("服务：运行中")
            self.statusBar().showMessage("服务运行中")
            self._refresh_status_chip(self.status_label, "ok")
        else:
            self.status_label.setText("服务：未启动")
            self.statusBar().showMessage("服务未启动")
            self._refresh_status_chip(self.status_label, "")
        self._append_log("[STATUS_APPLY][STEP] service_label")
        last_seen = status.get("tampermonkey_last_seen")
        last_seen_text = self._format_ts(last_seen)
        summary = self._tm_summary_for_session()
        if last_seen is None and int(summary.get("total_clients") or 0) <= 0:
            self.tm_online_label.setText("油猴：未连接")
            self._refresh_status_chip(self.tm_online_label, "")
            self.tm_online_label.setToolTip("")
        else:
            chip_text, chip_state = self._format_tm_online_chip_text(summary)
            self.tm_online_label.setText(chip_text)
            self._refresh_status_chip(self.tm_online_label, chip_state or "")
        if last_seen is not None or int(summary.get("total_clients") or 0) > 0:
            recent_focus_id = self._recent_focus_home_client_id(status)
            tooltip_lines = [
                f"最后全局心跳：{last_seen_text}",
                f"在线 {summary.get('online_clients', 0)} / 总 {summary.get('total_clients', 0)}",
                f"会话页 {summary.get('online_conversation_clients', 0)} / "
                f"首页 {summary.get('online_home_clients', 0)}",
                f"最近焦点首页：{recent_focus_id or '-'}",
                f"绑定 client={summary.get('bound_client_id') or '-'} "
                f"在线={summary.get('bound_online')}",
                f"活跃 client={summary.get('active_client_id') or '-'}",
            ]
            self.tm_online_label.setToolTip("\n".join(tooltip_lines))
        self._log_tm_status_summary(summary)
        self._log_bind_mismatch_if_needed(summary)
        chat_q = status.get("queue_length", 0)
        ctrl_q = status.get("control_queue_length", 0)
        self.tm_queue_label.setText(f"聊天队列：{chat_q}  控制队列：{ctrl_q}")
        self._append_log("[STATUS_APPLY][STEP] tm_summary")
        live_url = status.get("tampermonkey_page_url") if summary.get("online_clients") else None
        self._update_live_page_display(live_url, summary=summary)
        self._append_log("[STATUS_APPLY][STEP] live_page")
        QTimer.singleShot(0, lambda s=status: self._try_finish_pending_auto_bind(s))
        QTimer.singleShot(0, lambda: self._check_bootstrap_claim_timeouts())
        QTimer.singleShot(0, lambda s=status: self._sync_bound_session_urls_from_clients(s))
        QTimer.singleShot(0, lambda s=status: self._auto_bind_current_session_if_needed(s))
        self._update_bound_page_display(summary=summary)
        self._append_log("[STATUS_APPLY][STEP] bound_page")
        self._refresh_tm_page_selector(summary=summary)
        self._append_log("[STATUS_APPLY][STEP] page_selector")
        self._render_tampermonkey_clients(status)
        self._append_log("[STATUS_APPLY][STEP] tm_table")
        inbound_items = status.get("recent_inbound") or []
        outbound_items = status.get("recent_outbound") or []
        self._handle_inbound_events(inbound_items)
        self._render_inbound_log(inbound_items)
        self._render_outbound(outbound_items)
        self._render_status_summary(status)
        self._append_log("[STATUS_APPLY][STEP] status_summary")
        self._update_tampermonkey_settings_labels(status)
        self._update_service_settings_status()
        self._append_log("[STATUS_APPLY][STEP] done")
    def _handle_inbound_events(self, items):
        for item in items:
            event_key = (
                item.get("event_id") or item.get("id") or self._make_inbound_key(item)
            )
            if event_key in self._processed_inbound_ids:
                continue
            self._processed_inbound_ids.add(event_key)
            kind = item.get("kind", "?")
            payload = item.get("payload") or {}
            if kind == "report_unknown":
                bridge_id = item.get("message_id") or "-"
                payload = item.get("payload") or {}
                waiting_ids = payload.get("waiting_message_ids") or []
                self._append_log(
                    f"[回传未知] message_id={bridge_id} event={payload.get('event') or '-'} "
                    f"client_id={item.get('client_id') or '-'} "
                    f"waiting_message_ids={waiting_ids}"
                )
                continue
            if kind == "report_mismatch":
                bridge_id = item.get("message_id") or "-"
                payload = item.get("payload") or {}
                self._append_log(
                    f"[回传不匹配] message_id={bridge_id} "
                    f"session_id={item.get('session_id') or '-'} "
                    f"turn_id={item.get('turn_id') or '-'} "
                    f"event={payload.get('event') or '-'} "
                    f"owner_client_id={payload.get('owner_client_id') or '-'} "
                    f"report_client_id={payload.get('report_client_id') or item.get('client_id') or '-'}"
                )
                continue
            if kind in ("ack_mismatch", "report_ignored"):
                if kind == "ack_mismatch":
                    bridge_id = item.get("message_id") or "-"
                    payload = item.get("payload") or {}
                    self._append_log(
                        f"[ACK不匹配] message_id={bridge_id} "
                        f"session_id={item.get('session_id') or '-'} "
                        f"turn_id={item.get('turn_id') or '-'} "
                        f"detail={payload.get('detail') or '-'} "
                        f"owner_client_id={payload.get('owner_client_id') or '-'} "
                        f"report_client_id={payload.get('report_client_id') or item.get('client_id') or '-'}"
                    )
                continue
            if kind in ("open_url_success", "open_url_failed"):
                url = payload.get("url") or ""
                detail = payload.get("detail") or ""
                if kind == "open_url_success":
                    self._append_log(f"[打开网页] 成功：{url} {detail}".strip())
                else:
                    self._append_log(f"[打开网页] 失败：{url} {detail}".strip())
                continue
            if kind == "reload_page_requested":
                client_id = item.get("client_id") or "-"
                page_url = payload.get("page_url") or ""
                detail = payload.get("detail") or ""
                self._append_log(
                    f"[刷新网页] 已向页面发送刷新请求 client_id={client_id} "
                    f"{page_url} {detail}".strip()
                )
                continue
            if kind == "reload_page_failed":
                client_id = item.get("client_id") or "-"
                page_url = payload.get("page_url") or ""
                detail = payload.get("detail") or ""
                self._append_log(
                    f"[刷新网页] 失败 client_id={client_id} {page_url} {detail}".strip()
                )
                continue
            if kind == "close_page_requested":
                client_id = item.get("client_id") or "-"
                self._append_log(f"[关闭页面] 已向页面发送关闭请求 client_id={client_id}")
                continue
            if kind == "close_page_still_open":
                page_url = payload.get("page_url") or ""
                detail = payload.get("detail") or ""
                client_id = item.get("client_id") or "-"
                self._append_log(
                    f"[关闭页面] 页面仍在运行 client_id={client_id} {page_url} {detail}".strip()
                )
                self._set_settings_hint(
                    "页面仍在运行，浏览器可能拦截了 window.close()"
                )
                continue
            if kind in ("close_page_success", "close_page_failed", "command_failed"):
                page_url = payload.get("page_url") or ""
                detail = payload.get("detail") or ""
                client_id = item.get("client_id") or "-"
                if kind == "close_page_success":
                    self._append_log(
                        f"[关闭页面] 成功 client_id={client_id} {page_url} {detail}".strip()
                    )
                elif kind == "close_page_failed":
                    self._append_log(
                        f"[关闭页面] 失败 client_id={client_id} {page_url} {detail}".strip()
                    )
                else:
                    self._append_log(
                        f"[命令] 失败 client_id={client_id} {detail}".strip()
                    )
                continue
            if kind == "conversation_created":
                conv_session = self._resolve_session_for_conversation_created(item)
                if conv_session is not None:
                    report_client = (item.get("client_id") or "").strip()
                    self._apply_conversation_created_binding(
                        conv_session, payload, client_id=report_client
                    )
                else:
                    payload = item.get("payload") or {}
                    self._append_log(
                        f"[BIND][MISMATCH] reason=conversation_created_no_session "
                        f"message_id={(item.get('message_id') or '-')[:8]} "
                        f"bind_request_id="
                        f"{payload.get('bind_request_id') or payload.get('launch_token') or '-'} "
                        f"client_id={item.get('client_id') or '-'} "
                        f"page_instance_id={payload.get('page_instance_id') or '-'}"
                    )
                continue
            session, turn_id, bridge_id = self._resolve_inbound_binding(item)
            if session is None or not turn_id:
                continue
            if kind == "ack":
                success = bool(payload.get("success"))
                detail = payload.get("detail") or ""
                if not self._has_assistant_for_turn(session, turn_id):
                    continue
                if self._is_finalized(bridge_id):
                    continue
                if success:
                    self._ack_success_message_ids.add(bridge_id)
                    self._set_reply_waiting(session, turn_id)
                    report_client = (item.get("client_id") or "").strip()
                    if report_client:
                        remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
                        if remote_now.get("bootstrap_in_progress"):
                            pass
                        else:
                            self._remember_session_page_from_client(
                                session, report_client
                            )
                        self._update_bound_page_display()
                else:
                    self._ack_success_message_ids.discard(bridge_id)
                    remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
                    if remote_now.get("bootstrap_in_progress"):
                        session.remote_chatgpt = {
                            **remote_now,
                            "bootstrap_in_progress": False,
                        }
                        self._save_sessions_to_disk()
                    self._set_reply_error(
                        session,
                        turn_id,
                        f"发送失败：{detail or '油猴返回失败'}",
                        "发送失败",
                    )
                    self._finalize_bridge(bridge_id)
                continue
            if kind == "send_failed":
                if not self._has_assistant_for_turn(
                    session, turn_id
                ) or self._is_finalized(bridge_id):
                    continue
                self._ack_success_message_ids.discard(bridge_id)
                remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
                if remote_now.get("bootstrap_in_progress"):
                    session.remote_chatgpt = {
                        **remote_now,
                        "bootstrap_in_progress": False,
                    }
                    self._save_sessions_to_disk()
                detail = (
                    payload.get("detail")
                    or payload.get("reason")
                    or str(payload)
                )
                reason_labels = {
                    "target_client_id_mismatch": "目标 client_id 与当前页面不一致",
                    "conversation_id_mismatch": "目标会话与当前页面不一致",
                    "target_page_url_mismatch": "目标页面 URL 与当前页面不一致",
                    "not_conversation_page": "当前页面不是 ChatGPT 对话页",
                    "not_home_page": "bootstrap 要求 ChatGPT 首页",
                    "home_already_has_conversation": "首页不应已有 conversation_id",
                    "target_page_instance_id_mismatch": "预绑定首页 page_instance_id 不一致",
                    "bind_request_id_mismatch": "绑定令牌与当前页面不一致",
                    "conversation_created_timeout": "首条消息已发送，但未检测到新对话页",
                }
                if payload.get("reason") in reason_labels:
                    detail = reason_labels[payload["reason"]]
                self._set_reply_error(
                    session, turn_id, f"发送失败：{detail}", "发送失败"
                )
                self._finalize_bridge(bridge_id)
                continue
            if kind == "assistant_reply":
                if self._is_finalized(bridge_id):
                    continue
                if not self._has_assistant_for_turn(session, turn_id):
                    continue
                text = payload.get("text") or payload.get("content") or ""
                if text.strip():
                    self._set_reply_text(
                        session, turn_id, text.strip(), "已回复"
                    )
                    self._finalize_bridge(bridge_id)
                    self._ack_success_message_ids.discard(bridge_id)
                    report_client = (item.get("client_id") or "").strip()
                    if report_client:
                        self._remember_session_page_from_client(
                            session, report_client
                        )
                        self._update_bound_page_display()
                else:
                    self._set_reply_error(
                        session, turn_id, "ChatGPT 返回了空回复。", "空回复"
                    )
                    self._finalize_bridge(bridge_id)
                continue
            if kind in ("assistant_reply_empty", "assistant_reply_failed"):
                if not self._has_assistant_for_turn(
                    session, turn_id
                ) or self._is_finalized(bridge_id):
                    continue
                self._ack_success_message_ids.discard(bridge_id)
                detail = (
                    payload.get("reason")
                    or payload.get("detail")
                    or payload.get("error_message")
                    or ""
                )
                if not detail:
                    if kind == "assistant_reply_empty":
                        detail = "ChatGPT 已发送，但未读取到回复内容。"
                    else:
                        detail = "读取 ChatGPT 回复失败。"
                busy = payload.get("busy")
                busy_reason = payload.get("busy_reason") or ""
                if busy:
                    detail = f"{detail}（busy={busy_reason or 'yes'}）"
                elapsed = payload.get("elapsed_ms")
                if elapsed is not None:
                    detail = f"{detail}（等待 {elapsed}ms）"
                prefix = "读取回复失败："
                if not str(detail).startswith(prefix) and kind == "assistant_reply_failed":
                    detail = f"{prefix}{detail}"
                status_text = "读取失败" if kind == "assistant_reply_failed" else "空回复"
                self._set_reply_error(session, turn_id, detail, status_text)
                self._finalize_bridge(bridge_id)
                continue
            continue
    def _render_inbound_log(self, items):
        if not items:
            self.event_log_edit.setPlainText("（暂无回传）")
            return
        lines = []
        for item in reversed(items):
            kind = item.get("kind", "?")
            if kind in ("open_url_success", "open_url_failed"):
                continue
            if kind == "ack" and not self._log_ack_events:
                continue
            if kind == "assistant_reply" and not self._log_assistant_reply_events:
                continue
            if kind == "send_failed" and not self._log_send_failed_events:
                continue
            ts = self._format_ts(item.get("time"))
            payload = item.get("payload") or {}
            event_id = item.get("event_id") or item.get("id") or "-"
            message_id = item.get("message_id") or "-"
            session_id = item.get("session_id") or "-"
            turn_id = item.get("turn_id") or "-"
            client_id = item.get("client_id") or "-"
            page_hint = ""
            if client_id and client_id != "-":
                pinfo = self._client_info_from_status(client_id)
                if pinfo:
                    page_hint = (
                        f" page_type={pinfo.get('page_type') or '-'} "
                        f"conv={pinfo.get('conversation_id') or '-'}"
                    )
            id_part = (
                f"event_id={event_id} message_id={message_id} "
                f"session_id={session_id} turn_id={turn_id} client_id={client_id}{page_hint}"
            )
            if self._show_raw_payload or self._debug_mode:
                lines.append(f"[{ts}] {kind} {id_part} payload={payload}")
            else:
                text = (
                    payload.get("text")
                    or payload.get("detail")
                    or payload.get("reason")
                    or ""
                )
                lines.append(f"[{ts}] {kind} {id_part} {text}")
        if not lines:
            self.event_log_edit.setPlainText("（暂无回传，或被调试过滤规则隐藏）")
            return
        self.event_log_edit.setPlainText("\n".join(lines))
    def _render_outbound(self, items):
        self.outbound_table.setRowCount(0)
        for item in reversed(items):
            if item.get("type") == "command":
                content = (
                    f"command:{item.get('command', '?')} "
                    f"{item.get('url', '')}"
                )
            else:
                content = item.get("content", "")
            target_client = (item.get("target_client_id") or "").strip()
            target_page = (item.get("target_page_url") or "").strip()
            if target_client or target_page:
                page_short = self._short_page_display(target_page) if target_page else "-"
                content = f"[→{target_client or '?'} @ {page_short}] {content}"
            if len(content) > 80:
                content = content[:80] + "..."
            row = self.outbound_table.rowCount()
            self.outbound_table.insertRow(row)
            ts = self._format_ts(
                item.get("acked_at")
                or item.get("delivered_at")
                or item.get("created_at")
            )
            message_id = item.get("id") or ""
            short_id = message_id[:8] + "…" if message_id else "-"
            self.outbound_table.setItem(row, 0, QTableWidgetItem(ts))
            self.outbound_table.setItem(row, 1, QTableWidgetItem(short_id))
            self.outbound_table.setItem(row, 2, QTableWidgetItem(item.get("status", "")))
            self.outbound_table.setItem(row, 3, QTableWidgetItem(content))
    def _refresh_status_tick(self):
        if server.is_server_running():
            self._apply_bridge_status(server.get_bridge_status())
    def _append_log(self, message, echo=False):
        line = append_log(message, source="GUI", echo=echo)
        if hasattr(self, "log_edit") and self.log_edit is not None:
            self.log_edit.append(line)
        return line
    def _update_running_ui(self, running):
        self.host_edit.setEnabled(not running)
        self.port_edit.setEnabled(not running)
        self.settings_start_btn.setEnabled(not running)
        self.settings_stop_btn.setEnabled(running)
        self.chat_quick_start_btn.setEnabled(not running)
        self.chat_quick_stop_btn.setEnabled(running)
    def _parse_port(self):
        raw = self.port_edit.text().strip()
        try:
            port = int(raw)
        except ValueError:
            self._set_settings_hint(f"端口错误：{raw} 不是数字。")
            return None
        if not (1 <= port <= 65535):
            self._set_settings_hint(f"端口错误：{port} 不在 1-65535 范围内。")
            return None
        return port
    def _start_server(self):
        host = self.host_edit.text().strip() or "127.0.0.1"
        port = self._parse_port()
        if port is None:
            return
        server.set_debug_mode(self._debug_mode)
        try:
            started = server.start_server(host, port)
        except Exception as error:
            detail = f"服务启动失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"服务启动失败：{error}")
            return
        if started:
            self._update_running_ui(True)
            QTimer.singleShot(
                200, lambda: self._apply_bridge_status(server.get_bridge_status())
            )
            self._update_service_settings_status()
            self._append_log(f"服务已启动：http://{host}:{port}", echo=True)
        else:
            self._add_system_message("服务已经在运行中。")
    def _stop_server(self):
        try:
            stopped = server.stop_server()
        except Exception as error:
            detail = f"服务停止失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"服务停止失败：{error}")
            return
        if stopped:
            self._update_running_ui(False)
            self._apply_bridge_status(server.get_bridge_status())
            self._update_service_settings_status()
            self._add_system_message("服务已停止。")
        else:
            self._add_system_message("服务当前没有运行。")
    def _session_has_pending_assistant_reply(self, session):
        if not session:
            return False
        for message in session.messages:
            if message.role != "assistant":
                continue
            status = (message.status or "").strip()
            if status not in PENDING_ASSISTANT_STATUSES:
                continue
            bridge_id = (message.bridge_message_id or "").strip()
            if bridge_id and self._is_finalized(bridge_id):
                continue
            return True
        return False

    def _push_message(self):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return
        content = self.message_edit.toPlainText().strip()
        if not content:
            self._add_system_message("请输入要发送的内容。")
            return
        session = self._ensure_current_session()
        if self._session_has_pending_assistant_reply(session):
            if self._session_has_retryable_unclaimed_bootstrap(session):
                self._retry_bootstrap_after_claim_timeout(session)
                return
            self._add_system_message(
                "当前对话上一条消息仍在等待回复，请等回复完成后再发送。"
            )
            return

        if self._bind_each_chat_to_page and self._session_needs_first_message_bind(
            session
        ):
            ready, reason = self._prepare_first_message_binding(session, content)
            if not ready:
                if reason == "__WAITING_HOME_PENDING__":
                    if self._auto_clear_input_after_send:
                        self.message_edit.clear()
                    self._save_sessions_to_disk()
                    return
                if reason:
                    self._add_system_message(reason)
                return

        self._push_message_text(session, content)

    def _flush_pending_bootstrap_message(self, session, text):
        text = (text or "").strip()
        if not text or session is None:
            return
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return
        if self._session_has_pending_assistant_reply(session):
            self._append_log(
                f"[SEND][BOOTSTRAP] 跳过：session={session.session_id} 仍有未完成回复"
            )
            return
        self._push_message_text(session, text, from_pending_bootstrap=True)

    def _push_message_text(self, session, content, from_pending_bootstrap=False):
        raw_user_text = content.strip()
        if not raw_user_text:
            return
        final_prompt = raw_user_text
        turn_id = str(uuid.uuid4())
        user_message_id = str(uuid.uuid4())
        assistant_message_id = str(uuid.uuid4())
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)
        if bind_state == BIND_STATE_PREBOUND_HOME:
            client_id = (
                remote.get("prebound_home_client_id") or remote.get("client_id") or ""
            ).strip()
            page_instance_id = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            self._append_log(
                f"[SEND][BOOTSTRAP] session_id={session.session_id} "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
                f"text_len={len(raw_user_text)} pending={from_pending_bootstrap}"
            )
        prereq_ok, prereq_reason = self._check_tm_send_prerequisites(session)
        if not prereq_ok:
            self._append_log(f"[发送] {prereq_reason}")
            self._add_system_message(prereq_reason)
            self._apply_chat_bind_visual_state()
            return

        self._rebind_current_session_to_online_client_if_needed()
        self._log_send_bind_check(session, action="before_send")

        target_client_id, target_page_url, allowed, reason = (
            self._resolve_target_page_for_session(session)
        )
        self._append_log(f"[发送] {reason}")
        if not allowed:
            self._add_system_message(reason)
            self._apply_chat_bind_visual_state()
            return

        target_client_id, target_page_url, allowed, verify_reason = (
            self._verify_send_target_binding(
                session, target_client_id, target_page_url
            )
        )
        if verify_reason:
            self._append_log(f"[发送] {verify_reason}")
        if not allowed:
            self._add_system_message(verify_reason or "发送前绑定校验失败。")
            self._apply_chat_bind_visual_state()
            return

        payload = {
            "session_id": session.session_id,
            "turn_id": turn_id,
            "raw_user_text": raw_user_text,
            "final_prompt": final_prompt,
        }
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)
        if bind_state == BIND_STATE_PREBOUND_HOME:
            payload["bootstrap_conversation"] = True
            page_instance_id = (
                remote.get("prebound_home_page_instance_id")
                or remote.get("page_instance_id")
                or ""
            ).strip()
            if page_instance_id:
                payload["target_page_instance_id"] = page_instance_id
            bind_request_id = self._session_bind_request_id(remote)
            if bind_request_id:
                payload["bind_request_id"] = bind_request_id
                payload["launch_token"] = bind_request_id
            session.remote_chatgpt = {
                **remote,
                "bootstrap_in_progress": True,
            }
            self._save_sessions_to_disk()
            self._append_log(
                f"[发送][BOOTSTRAP] 目标 client_id={target_client_id} "
                f"page_instance_id={page_instance_id or '-'} "
                f"page={self._short_page_display(target_page_url)}"
            )
        if target_client_id:
            payload["target_client_id"] = target_client_id
        if target_page_url:
            payload["target_page_url"] = target_page_url
            if bind_state == BIND_STATE_BOUND_CONVERSATION:
                payload["conversation_url"] = target_page_url
                conversation_id = (remote.get("conversation_id") or "").strip()
                if not conversation_id:
                    conversation_id = parse_conversation_id(target_page_url)
                if conversation_id:
                    payload["conversation_id"] = conversation_id
            self._append_log(
                f"[发送] 目标 client_id={target_client_id} "
                f"conversation_id={payload.get('conversation_id') or '-'} "
                f"bootstrap={payload.get('bootstrap_conversation', False)} "
                f"page={self._short_page_display(target_page_url)}"
            )
        try:
            msg = server.push_message(payload)
        except Exception as error:
            detail = f"消息入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"消息入队失败：{error}")
            return
        if not target_client_id:
            live_client = (
                self._last_bridge_status.get("tampermonkey_client_id") or ""
            ).strip()
            if live_client:
                self._remember_session_page_from_client(session, live_client)
        bridge_message_id = msg.get("id") if isinstance(msg, dict) else None
        if not bridge_message_id:
            self._add_system_message("服务端未返回 bridge_message_id，无法跟踪回复。")
            return
        self._message_to_session[bridge_message_id] = session.session_id
        self._message_to_turn[bridge_message_id] = turn_id
        if self._auto_name_new_chat and session.title == "新对话":
            session.title = raw_user_text[:20] + (
                "…" if len(raw_user_text) > 20 else ""
            )
        self._append_session_message(
            session,
            "user",
            raw_user_text,
            message_id=user_message_id,
            turn_id=turn_id,
            bridge_message_id=bridge_message_id,
            status="已加入队列",
        )
        if self._show_assistant_placeholder:
            self._append_session_message(
                session,
                "assistant",
                ASSISTANT_WAIT_TEXT,
                message_id=assistant_message_id,
                turn_id=turn_id,
                bridge_message_id=bridge_message_id,
                parent_message_id=user_message_id,
                status="等待中",
            )
        self._refresh_session_list(select_session_id=session.session_id)
        self._render_session_chat(session)
        self._save_sessions_to_disk()
        if self._auto_clear_input_after_send and not from_pending_bootstrap:
            self.message_edit.clear()
    def _copy_last_reply(self):
        session = self._current_session()
        text = self._last_assistant_text(session)
        if not text:
            self._add_system_message("当前没有可复制的 ChatGPT 回复。")
            return
        QApplication.clipboard().setText(text)
        self._add_system_message("已复制最后一条 ChatGPT 回复。")
    def closeEvent(self, event):
        self._save_sessions_to_disk()
        self._save_app_settings()
        if server.is_server_running():
            try:
                server.stop_server()
            except Exception as error:
                detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"
                self._append_log(detail, echo=True)
        event.accept()
