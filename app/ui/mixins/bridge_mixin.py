import time
import traceback
import uuid

import server
from log_utils import append_log

from app.constants import (
    ASSISTANT_WAIT_TEXT,
)
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import (
    QApplication,
    QTableWidgetItem,
)


class BridgeMixin:
    BRIDGE_STATUS_UI_MIN_INTERVAL_MS = 300

    def _debug_status_step(self, text):
        if not getattr(self, "_debug_mode", False):
            return
        self._append_log(text)

    def _render_status_summary(self, status):
        status = status or {}
        host, port = self._service_host_port_for_display(status)
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
    def _flush_deferred_bridge_status(self):
        self._bridge_status_defer_timer_active = False
        pending = getattr(self, "_deferred_bridge_status", None)
        self._deferred_bridge_status = None
        if pending is not None:
            self._apply_bridge_status(pending)

    def _apply_bridge_status(self, status):
        status = status or {}
        now_ms = int(time.time() * 1000)
        last_ms = getattr(self, "_last_bridge_status_ui_apply_ms", 0)
        interval = self.BRIDGE_STATUS_UI_MIN_INTERVAL_MS
        if now_ms - last_ms < interval:
            self._deferred_bridge_status = status
            if not getattr(self, "_bridge_status_defer_timer_active", False):
                self._bridge_status_defer_timer_active = True
                delay = max(1, interval - (now_ms - last_ms))
                QTimer.singleShot(delay, self._flush_deferred_bridge_status)
            return

        if getattr(self, "_applying_bridge_status", False):
            self._pending_bridge_status = status
            return

        self._last_bridge_status_ui_apply_ms = now_ms
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
        self._debug_status_step("[STATUS_APPLY][STEP] start")
        server_running = bool(status.get("server_running"))
        if server_running:
            service_url = (
                status.get("server_url")
                or server.get_server_url()
                or ""
            )
            if service_url:
                self.status_label.setText(f"服务：运行中 {service_url}")
                self.statusBar().showMessage(f"服务运行中 {service_url}")
            else:
                self.status_label.setText("服务：运行中")
                self.statusBar().showMessage("服务运行中")
            self._server_start_failed = False
            self._server_start_error = ""
            self._refresh_status_chip(self.status_label, "ok")
        elif getattr(self, "_server_start_failed", False):
            self.status_label.setText("服务：启动失败")
            self.statusBar().showMessage("服务启动失败")
            self._refresh_status_chip(self.status_label, "error")
        else:
            self.status_label.setText("服务：未启动")
            self.statusBar().showMessage("服务未启动")
            self._refresh_status_chip(self.status_label, "")
        self._debug_status_step("[STATUS_APPLY][STEP] service_label")
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
        self._debug_status_step("[STATUS_APPLY][STEP] tm_summary")
        live_url = status.get("tampermonkey_page_url") if summary.get("online_clients") else None
        self._update_live_page_display(live_url, summary=summary)
        self._debug_status_step("[STATUS_APPLY][STEP] live_page")
        QTimer.singleShot(0, lambda s=status: self._try_finish_pending_auto_bind(s))
        QTimer.singleShot(0, lambda s=status: self._try_finish_waiting_bound_conversations(s))
        QTimer.singleShot(0, lambda: self._check_bootstrap_claim_timeouts())
        QTimer.singleShot(0, lambda s=status: self._sync_bound_session_urls_from_clients(s))
        QTimer.singleShot(0, lambda s=status: self._auto_bind_current_session_if_needed(s))
        self._update_bound_page_display(summary=summary)
        self._debug_status_step("[STATUS_APPLY][STEP] bound_page")
        self._refresh_tm_page_selector(summary=summary)
        self._debug_status_step("[STATUS_APPLY][STEP] page_selector")
        self._render_tampermonkey_clients(status)
        self._debug_status_step("[STATUS_APPLY][STEP] tm_table")
        inbound_items = status.get("recent_inbound") or []
        outbound_items = status.get("recent_outbound") or []
        self._handle_inbound_events(inbound_items)
        self._render_inbound_log(inbound_items)
        self._render_outbound(outbound_items)
        self._render_status_summary(status)
        self._debug_status_step("[STATUS_APPLY][STEP] status_summary")
        self._update_tampermonkey_settings_labels(status)
        self._update_service_settings_status()
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._debug_status_step("[STATUS_APPLY][STEP] done")
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
            if kind == "conversation_snapshot":
                self._handle_conversation_snapshot_inbound(item)
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
                        if not remote_now.get("bootstrap_in_progress"):
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
                    "bootstrap_target_not_home": "bootstrap 只能发送到 ChatGPT 首页",
                    "home_already_has_conversation": "首页不应已有 conversation_id",
                    "bootstrap_target_has_conversation": "首页不应已有 conversation_id",
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
                    if getattr(self, "_auto_sync_conversation_after_reply", False):
                        self._schedule_auto_sync_conversation(
                            session, request_reason="auto_after_reply"
                        )
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
        if hasattr(self, "enable_lan_access_cb"):
            self.enable_lan_access_cb.setEnabled(not running)
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
        bind_host = self._resolve_listen_host()
        port = self._parse_port()
        if port is None:
            return
        self._read_settings_from_widgets()
        server.set_debug_mode(self._debug_mode)
        try:
            result = server.start_server(bind_host, port)
        except Exception as error:
            detail = (
                f"服务启动失败：{error}\n"
                f"host={bind_host} port={port}\n"
                f"{traceback.format_exc()}"
            )
            self._server_start_failed = True
            self._server_start_error = str(error)
            self._append_log(detail, echo=True)
            self._add_system_message(f"服务启动失败：{error}")
            self._update_running_ui(False)
            self._update_service_settings_status()
            return

        if result.get("ok"):
            actual_port = result.get("port")
            if actual_port and int(actual_port) != int(port):
                self.port_edit.setText(str(actual_port))
                self._port_text = str(actual_port)
                self._settings.setValue("port", str(actual_port))
            self._server_start_failed = False
            self._server_start_error = ""
            self._update_running_ui(True)
            QTimer.singleShot(
                200, lambda: self._apply_bridge_status(server.get_bridge_status())
            )
            self._update_service_settings_status()
            self._save_app_settings()
            message = result.get("message") or server.get_server_url()
            self._append_log(message, echo=True)
            if result.get("fallback_used"):
                self._add_system_message(
                    f"默认端口 {result.get('configured_port')} 不可用，"
                    f"已自动切换到 {actual_port}。\n"
                    f"油猴请填写：{result.get('bridge_url')}"
                )
        elif result.get("already_running"):
            self._add_system_message("服务已经在运行中。")
        else:
            message = result.get("message") or "服务启动失败。"
            self._server_start_failed = True
            self._server_start_error = message
            self._append_log(message, echo=True)
            self._add_system_message(message)
            self._update_running_ui(False)
            self._update_service_settings_status()
    def _stop_server(self):
        try:
            stopped = server.stop_server()
        except Exception as error:
            detail = f"服务停止失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            self._add_system_message(f"服务停止失败：{error}")
            return
        if stopped:
            self._server_start_failed = False
            self._server_start_error = ""
            self._update_running_ui(False)
            self._apply_bridge_status(server.get_bridge_status())
            self._update_service_settings_status()
            self._add_system_message("服务已停止。")
        else:
            self._add_system_message("服务当前没有运行。")

    def _check_bound_client_response_ready(self, session):
        if session is None:
            return True, ""
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        client_id = (
            remote.get("client_id")
            or remote.get("prebound_home_client_id")
            or ""
        ).strip()
        if not client_id:
            return True, ""
        client_info = self._client_info_by_id(client_id, self._last_bridge_status)
        if not isinstance(client_info, dict):
            return True, ""
        if client_info.get("is_responding"):
            return False, "当前 ChatGPT 页面仍在回答，请等待回复完成后再发送。"
        can_accept_input = bool(client_info.get("can_accept_input", True))
        if not can_accept_input:
            state = (client_info.get("response_state") or "unknown").strip() or "unknown"
            return False, f"当前 ChatGPT 页面暂不可发送（state={state}），请稍后重试。"
        return True, ""

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
        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            self._add_system_message(response_msg)
            return

        if self._bind_each_chat_to_page:
            reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                session, content
            )
            if reopen_result is False:
                if self._auto_clear_input_after_send:
                    self.message_edit.clear()
                self._apply_chat_bind_visual_state()
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
            if not self._session_is_local_new_chat_flow(session):
                live_client = (
                    self._last_bridge_status.get("tampermonkey_client_id") or ""
                ).strip()
                if live_client:
                    self._remember_session_page_from_client(session, live_client)
        bridge_message_id = msg.get("id") if isinstance(msg, dict) else None
        if not bridge_message_id:
            self._add_system_message("服务端未返回 bridge_message_id，无法跟踪回复。")
            return
        server.attach_external_request_bridge(
            session.session_id, bridge_message_id, turn_id
        )
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
        self._focus_message_input_later()
    def _copy_last_reply(self):
        session = self._current_session()
        text = self._last_assistant_text(session)
        if not text:
            self._add_system_message("当前没有可复制的 ChatGPT 回复。")
            return
        QApplication.clipboard().setText(text)
        self._add_system_message("已复制最后一条 ChatGPT 回复。")

    def _handle_external_gui_dispatch(self, action_id, action, payload):
        try:
            if action == "chat_send":
                result = self._external_api_chat_send(payload or {})
            elif action == "sessions_list":
                result = self._external_api_sessions_list()
            elif action == "sessions_create":
                result = self._external_api_sessions_create(payload or {})
            elif action == "sessions_get":
                result = self._external_api_sessions_get(payload or {})
            elif action == "sessions_bind":
                result = self._external_api_sessions_bind(payload or {})
            elif action == "sessions_summary":
                result = self._external_api_sessions_summary()
            else:
                result = {
                    "ok": False,
                    "error": f"未知 action: {action}",
                    "code": "INTERNAL_ERROR",
                }
        except Exception as error:
            detail = f"{error}\n{traceback.format_exc()}"
            self._append_log(
                f"[EXTERNAL_API][ERROR] action={action} {detail}", echo=True
            )
            result = {
                "ok": False,
                "error": str(error),
                "code": "INTERNAL_ERROR",
            }
        server.complete_gui_dispatch(action_id, result)

    def _external_api_sessions_summary(self):
        total = 0
        bound_online = 0
        bound_offline = 0
        unbound = 0
        status = self._last_bridge_status or {}
        for session in self._sessions.values():
            total += 1
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._effective_bind_state(session)
            if bind_state == BIND_STATE_UNBOUND or not remote.get("enabled"):
                unbound += 1
                continue
            if bind_state == BIND_STATE_BOUND_OFFLINE:
                bound_offline += 1
                continue
            if bind_state == BIND_STATE_BOUND_CONVERSATION:
                client_id = (remote.get("client_id") or "").strip()
                online = False
                for item in status.get("tampermonkey_clients") or []:
                    if (item.get("client_id") or "").strip() == client_id:
                        online = bool(item.get("online"))
                        break
                if online:
                    bound_online += 1
                else:
                    bound_offline += 1
                continue
            if bind_state == BIND_STATE_PREBOUND_HOME:
                if self._session_has_prebound_home_online(remote):
                    bound_online += 1
                else:
                    bound_offline += 1
                continue
            unbound += 1
        return {
            "ok": True,
            "summary": {
                "total": total,
                "bound_online": bound_online,
                "bound_offline": bound_offline,
                "unbound": unbound,
            },
        }

    def _external_api_sessions_list(self):
        items = []
        for session in sorted(
            self._sessions.values(),
            key=lambda s: float(s.updated_at or 0),
            reverse=True,
        ):
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            items.append(
                {
                    "session_id": session.session_id,
                    "title": session.title,
                    "updated_at": session.updated_at,
                    "bind_state": self._effective_bind_state(session),
                    "conversation_id": (remote.get("conversation_id") or "").strip(),
                    "client_id": (remote.get("client_id") or "").strip(),
                }
            )
        return {"ok": True, "sessions": items}

    def _external_api_sessions_create(self, payload):
        title = (payload.get("title") or "新对话").strip() or "新对话"
        session = self._create_session(title=title, select=False)
        session.remote_chatgpt = default_remote_chatgpt()
        self._save_sessions_to_disk()
        return {"ok": True, "session": self._external_session_payload(session)}

    def _external_api_sessions_get(self, payload):
        session_id = (payload.get("session_id") or "").strip()
        session = self._sessions.get(session_id)
        if not session:
            return {
                "ok": False,
                "error": "会话不存在",
                "code": "SESSION_NOT_FOUND",
            }
        return {"ok": True, "session": self._external_session_payload(session)}

    def _external_session_payload(self, session):
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        return {
            "session_id": session.session_id,
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "bind_state": self._effective_bind_state(session),
            "remote_chatgpt": dict(remote),
        }

    def _external_api_sessions_bind(self, payload):
        session_id = (payload.get("session_id") or "").strip()
        session = self._sessions.get(session_id)
        if not session:
            return {
                "ok": False,
                "error": "会话不存在",
                "code": "SESSION_NOT_FOUND",
            }
        client_id = (payload.get("client_id") or "").strip()
        if not client_id:
            return {
                "ok": False,
                "error": "client_id 不能为空",
                "code": "EMPTY_TEXT",
            }
        client_info = self._client_info_from_status(client_id)
        if not isinstance(client_info, dict):
            client_info = {"client_id": client_id}
        page_url = (payload.get("page_url") or "").strip()
        if page_url:
            client_info["page_url"] = page_url
        conversation_id = (payload.get("conversation_id") or "").strip()
        if conversation_id:
            client_info["conversation_id"] = conversation_id
        if not self._bind_page_to_session(session, client_info, silent=True):
            return {
                "ok": False,
                "error": "绑定失败",
                "code": "BIND_PAGE_OFFLINE",
            }
        self._save_sessions_to_disk()
        return {"ok": True, "session": self._external_session_payload(session)}

    def _resolve_external_chat_session(self, payload):
        session_id = (payload.get("session_id") or "").strip()
        new_session = bool(payload.get("new_session", False))
        reuse_last_session = bool(payload.get("reuse_last_session", True))
        auto_create_session = bool(payload.get("auto_create_session", True))
        client_name = (payload.get("client_name") or "default").strip() or "default"
        force_limit = int(payload.get("force_new_session_after_turns") or 0)
        if force_limit <= 0:
            force_limit = int(getattr(self, "_force_new_session_after_turns", 0) or 0)

        session_meta = {
            "new_session_created": False,
            "new_session_reason": "",
            "previous_session_id": "",
            "previous_turn_count": 0,
            "force_new_session_after_turns": force_limit,
        }

        if not hasattr(self, "_external_client_last_session"):
            self._external_client_last_session = {}

        def should_force_new(session):
            if force_limit <= 0 or session is None:
                return False
            return server.count_user_turns(session) >= force_limit

        def finish_force_new(previous_session):
            prev_count = server.count_user_turns(previous_session)
            session = self._create_session(select=False)
            session.remote_chatgpt = default_remote_chatgpt()
            self._external_client_last_session[client_name] = session.session_id
            session_meta["new_session_created"] = True
            session_meta["new_session_reason"] = "force_new_session_after_turns"
            session_meta["previous_session_id"] = previous_session.session_id
            session_meta["previous_turn_count"] = prev_count
            self._append_session_message(
                previous_session,
                "system",
                "当前会话已达到消息数量上限，后续外部客户端消息将进入新会话。",
            )
            self._append_session_message(
                session,
                "system",
                "已达到当前会话的消息数量上限，已自动创建新的 ChatGPT 对话。",
            )
            self._append_log(
                f"[EXTERNAL_API][FORCE_NEW_SESSION] client_name={client_name} "
                f"previous_session_id={previous_session.session_id} "
                f"previous_turn_count={prev_count} limit={force_limit} "
                f"new_session_id={session.session_id}",
                echo=True,
            )
            self._save_sessions_to_disk()
            return session

        if new_session:
            session = self._create_session(select=False)
            session.remote_chatgpt = default_remote_chatgpt()
            self._external_client_last_session[client_name] = session.session_id
            session_meta["new_session_created"] = True
            session_meta["new_session_reason"] = "new_session"
            self._save_sessions_to_disk()
            return session, session_meta

        if session_id:
            session = self._sessions.get(session_id)
            if session is not None:
                if should_force_new(session):
                    return finish_force_new(session), session_meta
                self._external_client_last_session[client_name] = session.session_id
                return session, session_meta
            if not auto_create_session:
                return None, session_meta
            self._append_log(
                f"[EXTERNAL_API] session_id={session_id} 不存在，"
                f"client_name={client_name}，将自动创建新会话",
                echo=True,
            )

        if reuse_last_session:
            last_id = (self._external_client_last_session.get(client_name) or "").strip()
            if last_id:
                session = self._sessions.get(last_id)
                if session is not None:
                    if should_force_new(session):
                        return finish_force_new(session), session_meta
                    return session, session_meta

        if auto_create_session:
            session = self._create_session(select=False)
            session.remote_chatgpt = default_remote_chatgpt()
            self._external_client_last_session[client_name] = session.session_id
            session_meta["new_session_created"] = True
            session_meta["new_session_reason"] = "auto_create"
            self._save_sessions_to_disk()
            return session, session_meta

        return None, session_meta

    def _external_api_chat_send(self, payload):
        if not server.is_server_running():
            return {
                "ok": False,
                "error": "服务未启动",
                "code": "INTERNAL_ERROR",
            }
        text = (payload.get("text") or "").strip()
        if not text:
            return {"ok": False, "error": "text 不能为空", "code": "EMPTY_TEXT"}

        auto_open_home = bool(payload.get("auto_open_home", True))

        session, session_meta = self._resolve_external_chat_session(payload)
        if session is None:
            session_id = (payload.get("session_id") or "").strip()
            if session_id or not bool(payload.get("auto_create_session", True)):
                return {
                    "ok": False,
                    "error": "会话不存在",
                    "code": "SESSION_NOT_FOUND",
                }
            return {
                "ok": False,
                "error": "无法解析会话",
                "code": "SESSION_NOT_FOUND",
            }

        if self._session_has_pending_assistant_reply(session):
            return {
                "ok": False,
                "error": "当前会话仍有未完成回复",
                "code": "INTERNAL_ERROR",
            }
        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            return {
                "ok": False,
                "error": response_msg,
                "code": "INTERNAL_ERROR",
            }

        if self._bind_each_chat_to_page:
            reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                session, text
            )
            if reopen_result is False:
                return {
                    "ok": True,
                    "session_id": session.session_id,
                    "pending_bound_reopen": True,
                    "bridge_message_id": "",
                    "turn_id": "",
                    **session_meta,
                }

        if self._bind_each_chat_to_page and self._session_needs_first_message_bind(
            session
        ):
            if not auto_open_home:
                idle_home = self._find_idle_chatgpt_home_client(
                    session_id=session.session_id
                )
                if not idle_home and not self._session_has_sendable_bound_page(
                    normalize_remote_chatgpt(session.remote_chatgpt)
                ):
                    return {
                        "ok": False,
                        "error": "没有可用的 ChatGPT 页面",
                        "code": "NO_AVAILABLE_CHATGPT_PAGE",
                    }
            ready, reason = self._prepare_first_message_binding(session, text)
            if not ready:
                if reason == "__WAITING_HOME_PENDING__":
                    return {
                        "ok": True,
                        "session_id": session.session_id,
                        "pending_home": True,
                        "bridge_message_id": "",
                        "turn_id": "",
                        **session_meta,
                    }
                return {
                    "ok": False,
                    "error": reason or "绑定首页失败",
                    "code": "NO_AVAILABLE_CHATGPT_PAGE",
                }

        send_result = self._external_push_message_text(session, text)
        if not send_result.get("ok"):
            return send_result
        self._external_client_last_session[
            (payload.get("client_name") or "default").strip() or "default"
        ] = session.session_id
        return {
            "ok": True,
            "session_id": session.session_id,
            "bridge_message_id": send_result.get("bridge_message_id") or "",
            "turn_id": send_result.get("turn_id") or "",
            "pending_home": False,
            **session_meta,
        }

    def _external_push_message_text(self, session, content):
        raw_user_text = content.strip()
        if not raw_user_text:
            return {"ok": False, "error": "text 为空", "code": "EMPTY_TEXT"}

        turn_id = str(uuid.uuid4())
        user_message_id = str(uuid.uuid4())
        assistant_message_id = str(uuid.uuid4())
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)

        prereq_ok, prereq_reason = self._check_tm_send_prerequisites(session)
        if not prereq_ok:
            code = "BIND_PAGE_OFFLINE"
            if "离线" in prereq_reason or "未连接" in prereq_reason:
                code = "BIND_PAGE_OFFLINE"
            elif "没有" in prereq_reason or "未找到" in prereq_reason:
                code = "NO_AVAILABLE_CHATGPT_PAGE"
            return {"ok": False, "error": prereq_reason, "code": code}

        self._rebind_current_session_to_online_client_if_needed()
        target_client_id, target_page_url, allowed, reason = (
            self._resolve_target_page_for_session(session)
        )
        if not allowed:
            code = "BIND_PAGE_OFFLINE"
            if "未找到" in (reason or "") or "没有" in (reason or ""):
                code = "NO_AVAILABLE_CHATGPT_PAGE"
            return {"ok": False, "error": reason or "无法解析发送目标", "code": code}

        target_client_id, target_page_url, allowed, verify_reason = (
            self._verify_send_target_binding(
                session, target_client_id, target_page_url
            )
        )
        if not allowed:
            return {
                "ok": False,
                "error": verify_reason or "发送前绑定校验失败",
                "code": "BIND_PAGE_OFFLINE",
            }

        payload = {
            "session_id": session.session_id,
            "turn_id": turn_id,
            "raw_user_text": raw_user_text,
            "final_prompt": raw_user_text,
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

        try:
            msg = server.push_message(payload)
        except Exception as error:
            detail = f"消息入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            return {
                "ok": False,
                "error": str(error),
                "code": "INTERNAL_ERROR",
            }

        bridge_message_id = msg.get("id") if isinstance(msg, dict) else ""
        if not bridge_message_id:
            return {
                "ok": False,
                "error": "服务端未返回 bridge_message_id",
                "code": "INTERNAL_ERROR",
            }

        server.attach_external_request_bridge(
            session.session_id, bridge_message_id, turn_id
        )
        self._message_to_session[bridge_message_id] = session.session_id
        self._message_to_turn[bridge_message_id] = turn_id
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
        session.updated_at = time.time()
        self._save_sessions_to_disk()
        return {
            "ok": True,
            "bridge_message_id": bridge_message_id,
            "turn_id": turn_id,
        }

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
