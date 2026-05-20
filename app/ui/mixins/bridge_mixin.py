import time
import traceback
import uuid

import server
from log_utils import append_log

from app.constants import (
    ASSISTANT_WAIT_TEXT,
    ASSISTANT_WAIT_TEXTS,
    PENDING_ASSISTANT_STATUSES,
)
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_BOUND_OFFLINE,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_BOUND_CONVERSATION,
    BIND_STATE_WAITING_HOME,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    default_remote_chatgpt,
    normalize_remote_chatgpt,
)
from app.url_utils import parse_conversation_id
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import (
    QApplication,
    QTableWidgetItem,
)

# 防御性兜底：避免导入列表改动后运行期出现 NameError。
if "BIND_STATE_WAITING_HOME" not in globals():
    BIND_STATE_WAITING_HOME = "WAITING_HOME"


class BridgeMixin:
    BRIDGE_STATUS_UI_MIN_INTERVAL_MS = 300

    def _enqueue_upload_before_send_command(
        self,
        session,
        payload,
        target_client_id,
    ):
        target_client_id = (target_client_id or "").strip()
        if not target_client_id:
            self._append_log(
                "[UPLOAD_BEFORE_SEND][SKIP] reason=empty_target_client_id",
                echo=True,
            )
            return False

        target_page_instance_id = (
            (payload.get("target_page_instance_id") or "").strip()
        )
        target_conversation_id = (
            (payload.get("conversation_id") or "").strip()
        )

        queued = server.enqueue_control_command(
            command="start_upload",
            target_client_id=target_client_id,
            target_page_instance_id=target_page_instance_id,
            target_conversation_id=target_conversation_id,
            payload={
                "source": "gui-send-before-message",
                "session_id": session.session_id if session else "",
                "turn_id": payload.get("turn_id") or "",
                "reset_before_start": True,
                "force_restart": True,
                "require_all_success": True,
                "block_next_chat_on_failed": True,
            },
        )

        if not queued:
            self._append_log(
                "[UPLOAD_BEFORE_SEND][FAILED] reason=enqueue_failed "
                f"session_id={(session.session_id if session else '-')} "
                f"client_id={target_client_id or '-'} "
                f"page_instance_id={target_page_instance_id or '-'} "
                f"conversation_id={target_conversation_id or '-'}",
                echo=True,
            )
            return False

        message_id = ""
        if isinstance(queued, dict):
            message_id = (queued.get("id") or "").strip()

        self._append_log(
            "[UPLOAD_BEFORE_SEND][QUEUED] "
            f"session_id={(session.session_id if session else '-')} "
            f"client_id={target_client_id or '-'} "
            f"page_instance_id={target_page_instance_id or '-'} "
            f"conversation_id={target_conversation_id or '-'} "
            f"command_message_id={message_id or '-'}",
            echo=True,
        )

        return True

    def _strict_targets_for_upload_command(self, session):
        """
        解析用于 start_upload 严格定向的 client / page_instance / conversation。
        返回 (target_client_id, page_instance_id, conversation_id, err)。
        err 非空表示当前不允许从 GUI 触发上传。
        """
        if session is None:
            return "", "", "", "没有当前会话"
        if not server.is_server_running():
            return "", "", "", "请先启动桥接服务"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        if not remote.get("enabled"):
            return "", "", "", "当前对话未启用远程 ChatGPT 联动"
        bind_eff = self._effective_bind_state(session)
        if bind_eff != BIND_STATE_BOUND_CONVERSATION:
            return (
                "",
                "",
                "",
                f"上传仅适用于已绑定且在线的对话页（当前状态：{bind_eff}）",
            )
        target_client_id = (remote.get("client_id") or "").strip()
        page_instance_id = (remote.get("page_instance_id") or "").strip()
        conv = (remote.get("conversation_id") or "").strip()
        if not conv:
            conv = (
                parse_conversation_id(
                    remote.get("conversation_url") or remote.get("url") or ""
                )
                or ""
            ).strip()
        if not target_client_id:
            return "", "", "", "缺少绑定页面的 client_id"
        if not page_instance_id:
            return "", "", "", "缺少 page_instance_id，请重新绑定对话页面"
        if not conv:
            return "", "", "", "缺少 conversation_id，请打开已绑定的 ChatGPT 对话页"
        info = self._client_info_by_id(
            target_client_id, getattr(self, "_last_bridge_status", None)
        )
        if not isinstance(info, dict):
            return "", "", "", "无法从桥接状态解析绑定页面信息"
        if not info.get("online"):
            return "", "", "", "当前绑定页面离线，请打开对应浏览器标签页"
        if not bool(info.get("upload_bridge_supported")):
            return (
                "",
                "",
                "",
                "绑定页面油猴脚本不支持 start_upload，请更新 Tampermonkey 脚本并刷新 ChatGPT 页面",
            )
        return target_client_id, page_instance_id, conv, ""

    def _trigger_upload_for_current_bound_page(
        self, block_next_chat_on_failed=True
    ):
        """
        向当前绑定的油猴页面下发 start_upload 控制命令。
        只负责触发上传，不负责发送文本。
        """
        session = self._current_session()
        cid, pins, conv, err = self._strict_targets_for_upload_command(session)
        if err:
            self._add_system_message(err)
            self._append_log(
                f"[UPLOAD_TRIGGER][FAILED] reason=precheck {err}",
                echo=True,
            )
            return False
        self._append_log(
            "[UPLOAD_TRIGGER][TARGET] "
            f"client_id={cid or '-'} "
            f"page_instance_id={pins or '-'} "
            f"conversation_id={conv or '-'}",
            echo=True,
        )
        self._add_system_message(
            "上传命令将发送到绑定页："
            f"client_id={cid}，page_instance_id={pins}，conversation_id={conv}。"
        )
        current_client_id = (self._selected_tm_page_client_id() or "").strip()
        if current_client_id and current_client_id != cid:
            self._add_system_message(
                "注意：当前选中的页面不是绑定页，上传命令会发送到当前会话的绑定页。"
                "如果当前页面没有反应，请点击「定位绑定页」查看。"
            )
            self._append_log(
                "[UPLOAD_TRIGGER][TARGET_NOT_CURRENT] "
                f"current_client_id={current_client_id} target_client_id={cid}",
                echo=True,
            )
        payload = {
            "source": "gui-manual-upload",
            "session_id": session.session_id if session else "",
            "reset_before_start": True,
            "force_restart": True,
            "require_all_success": True,
            "block_next_chat_on_failed": block_next_chat_on_failed,
        }
        try:
            queued = server.enqueue_control_command(
                command="start_upload",
                target_client_id=cid,
                target_page_instance_id=pins,
                target_conversation_id=conv,
                payload=payload,
            )
        except Exception as error:
            detail = (
                f"[UPLOAD_TRIGGER][FAILED] reason=exception {error}\n"
                f"{traceback.format_exc()}"
            )
            self._append_log(detail, echo=True)
            return False
        if not queued:
            self._append_log(
                "[UPLOAD_TRIGGER][FAILED] reason=enqueue_returned_falsy",
                echo=True,
            )
            return False
        message_id = ""
        if isinstance(queued, dict):
            message_id = (queued.get("id") or "").strip()
        self._append_log(
            "[UPLOAD_TRIGGER][QUEUED] "
            f"session_id={(session.session_id if session else '-')} "
            f"client_id={cid} "
            f"page_instance_id={pins} "
            f"conversation_id={conv} "
            f"command_message_id={message_id or '-'} "
            f"block_next_chat_on_failed={block_next_chat_on_failed}",
            echo=True,
        )
        return True

    def _clear_stale_pending_reply_if_bound_page_idle(self, session, reason=""):
        """
        当 GUI 本地残留 pending_reply，但绑定的 ChatGPT 页面实际已经空闲时，
        清理陈旧的等待占位，避免上传/发送流程被永久锁死。
        """
        if session is None:
            return False

        if not self._session_has_pending_assistant_reply(session):
            return False

        response_ready, response_msg = self._check_bound_client_response_ready(session)
        response_state = self._session_bound_response_state(session)
        state = (response_state.get("response_state") or "").strip().lower()

        if (
            not response_ready
            or bool(response_state.get("is_responding"))
            or state in ("generating", "waiting", "pending", "queued")
        ):
            if (reason or "").strip() != "bridge_status_tick":
                self._append_log(
                    "[PENDING_REPLY][KEEP] "
                    f"session_id={session.session_id} "
                    f"reason={reason or '-'} "
                    f"response_ready={response_ready} "
                    f"response_msg={response_msg or '-'} "
                    f"state={state or '-'}",
                    echo=True,
                )
            return False

        cleared = 0

        for message in reversed(session.messages):
            if not getattr(message, "visible_in_chat", True):
                continue

            if message.role != "assistant":
                continue

            bridge_id = (getattr(message, "bridge_message_id", "") or "").strip()
            if bridge_id and hasattr(self, "_is_finalized") and self._is_finalized(bridge_id):
                continue

            status = (message.status or "").strip()
            text = (message.content or "").strip()

            if status in PENDING_ASSISTANT_STATUSES or text in ASSISTANT_WAIT_TEXTS:
                message.role = "error"
                message.status = "已重置"
                message.content = (
                    "上一条回复的本地等待状态已重置。"
                    "如果网页中已有回复，请点击「同步网页对话」刷新完整内容。"
                )

                if bridge_id:
                    self._finalize_bridge(bridge_id)
                    if hasattr(self, "_ack_success_message_ids"):
                        self._ack_success_message_ids.discard(bridge_id)

                cleared += 1
                break

        if getattr(session, "has_pending_reply", False):
            session.has_pending_reply = False
            cleared += 1

        if cleared <= 0:
            return False

        session.updated_at = time.time()

        self._append_log(
            "[PENDING_REPLY][CLEARED_STALE] "
            f"session_id={session.session_id} "
            f"reason={reason or '-'} "
            f"state={state or '-'} "
            f"cleared={cleared}",
            echo=True,
        )

        self._add_system_message(
            "检测到当前绑定页面已空闲，但本地仍残留“等待回复”状态，已自动重置。"
            "如需网页里的完整回复，请点击「同步网页对话」。"
        )

        if session.session_id == self._current_session_id:
            self._render_session_chat(session, force_bottom=True)

        self._refresh_session_list(select_session_id=self._current_session_id)
        self._save_sessions_to_disk()

        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()

        return True

    def _update_upload_action_buttons_state(self):
        if not hasattr(self, "trigger_upload_btn") or not hasattr(
            self, "upload_and_send_btn"
        ):
            return

        session = self._current_session()
        server_running = server.is_server_running()

        if session is None:
            self.trigger_upload_btn.setEnabled(False)
            self.upload_and_send_btn.setEnabled(False)
            return

        _, _, _, err = self._strict_targets_for_upload_command(session)
        target_ready = bool(server_running and not err)

        response_ready = True
        if target_ready and session is not None:
            response_ready, _response_msg = self._check_bound_client_response_ready(
                session
            )

        busy_reason = self._session_send_busy_reason(session)
        is_busy = bool(busy_reason)

        # 只触发上传：检查绑定目标与网页端可接收输入，不受本地 pending_reply 禁用。
        self.trigger_upload_btn.setEnabled(bool(target_ready and response_ready))

        if err:
            self.trigger_upload_btn.setToolTip(f"当前可能无法触发上传：{err}")
        elif not response_ready:
            self.trigger_upload_btn.setToolTip(
                "当前绑定页面仍在回答或暂不可接收输入，请等待完成后再触发上传。"
            )
        elif busy_reason == "pending_reply":
            self.trigger_upload_btn.setToolTip(
                "本地存在 pending_reply，但不影响仅触发上传；点击后会先检查绑定页是否已空闲。"
            )
        elif is_busy:
            self.trigger_upload_btn.setToolTip(
                f"当前会话状态：{busy_reason}。仅触发上传仍可用。"
            )
        else:
            self.trigger_upload_btn.setToolTip(
                "向当前绑定的油猴页面下发 start_upload，只上传工具箱队列中的文件，不发送文字。"
            )

        # 上传并发送：需要绑定目标就绪、网页可接收输入，且本地无 pending_reply 等忙状态。
        self.upload_and_send_btn.setEnabled(
            bool(target_ready and response_ready and not is_busy)
        )

        if err:
            self.upload_and_send_btn.setToolTip(f"当前不能上传并发送：{err}")
        elif is_busy:
            self.upload_and_send_btn.setToolTip(
                f"当前会话正在处理上一条消息：{busy_reason}，请等待完成或同步网页对话后再上传并发送。"
            )
        else:
            self.upload_and_send_btn.setToolTip(
                "先触发油猴上传工具箱队列中的文件，成功后再发送输入框文字。"
            )

    def _on_trigger_upload_clicked(self):
        self._append_log("[UPLOAD_TRIGGER][CLICK]", echo=True)

        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            self._append_log(
                "[UPLOAD_TRIGGER][FAILED] reason=server_not_running",
                echo=True,
            )
            return

        session = self._current_session()
        if session is None:
            self._add_system_message("没有当前会话，无法触发上传。")
            self._append_log(
                "[UPLOAD_TRIGGER][FAILED] reason=no_current_session",
                echo=True,
            )
            return

        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            self._add_system_message(
                response_msg or "当前绑定页面暂不可上传，请等待 ChatGPT 回复完成后再试。"
            )
            self._append_log(
                "[UPLOAD_TRIGGER][BLOCKED] "
                f"reason=response_not_ready detail={response_msg or '-'}",
                echo=True,
            )
            return

        busy_reason = self._session_send_busy_reason(session)
        if busy_reason == "pending_reply":
            self._clear_stale_pending_reply_if_bound_page_idle(
                session,
                reason="manual_trigger_upload",
            )
            busy_reason = self._session_send_busy_reason(session)

        if busy_reason and busy_reason != "pending_reply":
            self._add_system_message(
                f"当前会话状态仍不可上传：{busy_reason}。"
                "请先同步网页对话或等待绑定状态恢复。"
            )
            self._append_log(
                f"[UPLOAD_TRIGGER][BLOCKED] reason=session_busy detail={busy_reason}",
                echo=True,
            )
            return

        if busy_reason == "pending_reply":
            self._append_log(
                "[UPLOAD_TRIGGER][PENDING_REPLY_BYPASS] "
                f"session_id={session.session_id} "
                "本地仍有 pending_reply，但绑定页已空闲，继续触发上传",
                echo=True,
            )

        ok = self._trigger_upload_for_current_bound_page(
            block_next_chat_on_failed=False
        )

        if ok:
            self._add_system_message(
                "已向绑定页发送 start_upload，请等待油猴完成工具箱上传。"
            )
            self.statusBar().showMessage(
                "已下发上传指令，请等待油猴侧完成上传",
                5000,
            )
        else:
            self._add_system_message(
                "触发上传失败，请查看日志中的 [UPLOAD_TRIGGER][FAILED] 详情。"
            )

    def _on_upload_and_send_clicked(self):
        self._append_log("[UPLOAD_AND_SEND][CLICK]", echo=True)
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            self._append_log(
                "[UPLOAD_AND_SEND][BLOCKED] reason=server_not_running",
                echo=True,
            )
            return
        content = self.message_edit.toPlainText().strip()
        if not content:
            self._append_log(
                "[UPLOAD_AND_SEND][EMPTY_TEXT_TO_UPLOAD_ONLY] 输入框为空，自动退化为只触发上传",
                echo=True,
            )
            self._add_system_message("输入框为空，已按「只触发上传」处理。")
            self._on_trigger_upload_clicked()
            return
        session = self._ensure_current_session()
        busy_reason = self._session_send_busy_reason(session)

        if busy_reason == "pending_reply":
            self._clear_stale_pending_reply_if_bound_page_idle(
                session,
                reason="upload_and_send",
            )
            busy_reason = self._session_send_busy_reason(session)

        if busy_reason:
            self._add_system_message(
                f"当前会话正忙（{busy_reason}），请等待完成后再使用上传并发送。"
            )
            self._append_log(
                f"[UPLOAD_AND_SEND][BLOCKED] reason=session_busy detail={busy_reason}",
                echo=True,
            )
            return
        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            self._add_system_message(
                response_msg or "当前绑定页面暂不可发送，请稍后再试。"
            )
            self._append_log(
                "[UPLOAD_AND_SEND][BLOCKED] reason=response_not_ready",
                echo=True,
            )
            return
        _, _, _, pre_err = self._strict_targets_for_upload_command(session)
        if pre_err:
            self._add_system_message(pre_err)
            self._append_log(
                f"[UPLOAD_AND_SEND][BLOCKED] reason=precheck {pre_err}",
                echo=True,
            )
            return
        if not self._trigger_upload_for_current_bound_page(
            block_next_chat_on_failed=True
        ):
            self._append_log(
                "[UPLOAD_AND_SEND][BLOCKED] reason=upload_enqueue_failed",
                echo=True,
            )
            self._add_system_message(
                "上传指令未能入队，已取消本次发送，请查看日志。"
            )
            return
        self._append_log("[UPLOAD_AND_SEND][UPLOAD_QUEUED]", echo=True)
        send_result = self._push_message(skip_upload_before_send=True)
        if isinstance(send_result, dict) and send_result.get("ok"):
            self._append_log("[UPLOAD_AND_SEND][SEND_QUEUED]", echo=True)
        else:
            reason = (
                (send_result or {}).get("reason")
                if isinstance(send_result, dict)
                else send_result
            )
            self._append_log(
                f"[UPLOAD_AND_SEND][BLOCKED] reason=send_not_queued detail={reason}",
                echo=True,
            )
            if send_result is None:
                self._add_system_message(
                    "上传指令已入队，但本次文字未能进入发送流程（例如仍在等待绑定页或首页）；"
                    "请不要重复点「上传并发送」，并留意聊天区与日志。"
                )

    def _find_session_message_by_id(self, session, message_id):
        if session is None:
            return None
        target_id = (message_id or "").strip()
        if not target_id:
            return None
        for message in session.messages:
            if (message.message_id or "").strip() == target_id:
                return message
        return None

    def _set_user_message_status(self, session, message_id, status):
        message = self._find_session_message_by_id(session, message_id)
        if message is None:
            return False
        if message.role != "user":
            return False
        message.status = (status or "").strip()
        session.updated_at = time.time()
        return True

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
        current_queue = self._current_session_queue_size()
        total_queue = self._total_session_queue_size()
        lines.extend([
            f"聊天队列：当前 {current_queue} / 总 {total_queue}",
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
        summary_text = "\n".join(lines)
        self.status_log_edit.setPlainText(summary_text)
        return summary_text
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
            self.status_label.setText("服务：运行中")
            if service_url:
                self.status_label.setToolTip(f"服务地址：{service_url}")
                self.statusBar().showMessage(f"服务运行中 {service_url}")
            else:
                self.status_label.setToolTip("")
                self.statusBar().showMessage("服务运行中")
            self._server_start_failed = False
            self._server_start_error = ""
            self._refresh_status_chip(self.status_label, "ok")
        elif getattr(self, "_server_start_failed", False):
            self.status_label.setText("服务：启动失败")
            self.status_label.setToolTip("")
            self.statusBar().showMessage("服务启动失败")
            self._refresh_status_chip(self.status_label, "error")
        else:
            self.status_label.setText("服务：停止")
            self.status_label.setToolTip("")
            self.statusBar().showMessage("服务已停止")
            self._refresh_status_chip(self.status_label, "error")
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
            bound_client_id = (self._session_bound_client_id() or "").strip()
            if not bound_client_id:
                bind_detail = "当前对话未绑定页面"
                bound_state_text = "unbound"
            else:
                bound_info = self._client_info_by_id(bound_client_id, status=status)
                bound_online = bool(bound_info and bound_info.get("online"))
                if bound_online:
                    bind_detail = f"绑定 client={bound_client_id}，状态=在线"
                    bound_state_text = "online"
                else:
                    bind_detail = f"绑定 client={bound_client_id}，状态=离线"
                    bound_state_text = "offline"
            tooltip_lines = [
                f"最后全局心跳：{last_seen_text}",
                f"在线 {summary.get('online_clients', 0)} / 总 {summary.get('total_clients', 0)}",
                f"会话页 {summary.get('online_conversation_clients', 0)} / "
                f"首页 {summary.get('online_home_clients', 0)}",
                f"最近焦点首页：{recent_focus_id or '-'}",
                f"当前对话绑定：{bind_detail}",
                f"bound_state={bound_state_text}",
                f"活跃 client={summary.get('active_client_id') or '-'}",
            ]
            self.tm_online_label.setToolTip("\n".join(tooltip_lines))
        self._log_tm_status_summary(summary)
        self._log_bind_mismatch_if_needed(summary)
        ctrl_q = status.get("control_queue_length", 0)
        current_q = self._current_session_queue_size()
        total_q = self._total_session_queue_size()
        self.tm_queue_label.setText(
            f"聊天队列：当前 {current_q}/总 {total_q}  控制队列：{ctrl_q}"
        )
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
        self._refresh_cursor_bridge_status(status.get("cursor_bridge"))
        self._refresh_session_list(select_session_id=self._current_session_id)
        self._recover_stuck_bootstrap_sessions()
        for session in list(self._sessions.values()):
            if self._session_send_queue(session.session_id):
                self._try_send_next_queued_message(session)
        current_session = self._current_session()
        if (
            current_session is not None
            and self._session_has_pending_assistant_reply(current_session)
        ):
            self._clear_stale_pending_reply_if_bound_page_idle(
                current_session,
                reason="bridge_status_tick",
            )
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
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
            if kind == "control_done":
                client_id = item.get("client_id") or "-"
                command = (payload.get("command") or "").strip()
                if command == "start_upload":
                    result = payload.get("result") or {}
                    if not isinstance(result, dict):
                        result = {}
                    upload_status = result.get("upload_status") or {}
                    if not isinstance(upload_status, dict):
                        upload_status = {}
                    success = int(result.get("success", 0) or 0)
                    failed = int(result.get("failed", 0) or 0)
                    attached = int(upload_status.get("attached", 0) or 0)
                    total = int(upload_status.get("total", 0) or 0)
                    self._append_log(
                        "[上传] 完成 "
                        f"client_id={client_id} "
                        f"success={success} failed={failed} attached={attached} total={total}",
                        echo=True,
                    )
                    self._add_system_message(
                        f"上传完成：成功 {success} 个，失败 {failed} 个，已挂载 {attached} 个，总数 {total}。"
                    )
                    continue
                self._append_log(
                    f"[控制完成] command={command or '-'} client_id={client_id}",
                    echo=True,
                )
                continue
            if kind in ("close_page_success", "close_page_failed", "command_failed"):
                page_url = payload.get("page_url") or ""
                detail = (
                    payload.get("detail")
                    or payload.get("reason")
                    or payload.get("error")
                    or ""
                )
                command = (payload.get("command") or "").strip()
                client_id = item.get("client_id") or "-"
                if kind == "close_page_success":
                    self._append_log(
                        f"[关闭页面] 成功 client_id={client_id} {page_url} {detail}".strip()
                    )
                elif kind == "close_page_failed":
                    self._append_log(
                        f"[关闭页面] 失败 client_id={client_id} {page_url} {detail}".strip()
                    )
                elif command == "start_upload":
                    if not detail:
                        result_obj = payload.get("result")
                        if isinstance(result_obj, dict):
                            detail = (
                                (result_obj.get("reason") or "")
                                or (result_obj.get("detail") or "")
                            ).strip() or detail
                    self._append_log(
                        f"[上传] 失败 client_id={client_id} reason={detail or '-'}",
                        echo=True,
                    )
                    self._add_system_message(
                        f"上传失败：{detail or '未返回具体原因，请查看油猴日志'}"
                    )
                else:
                    self._append_log(
                        f"[命令] 失败 command={command or '-'} client_id={client_id} {detail}".strip(),
                        echo=True,
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
                    if hasattr(self, "_try_send_next_queued_message"):
                        self._try_send_next_queued_message(conv_session)
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
                bind_state_now = self._remote_bind_state(remote_now)
                if (
                    remote_now.get("bootstrap_in_progress")
                    or bind_state_now == BIND_STATE_WAITING_CONVERSATION_CREATED
                    or (
                        bind_state_now == BIND_STATE_PREBOUND_HOME
                        and not (remote_now.get("conversation_id") or "").strip()
                    )
                ):
                    session.remote_chatgpt = {
                        **default_remote_chatgpt(),
                        "bind_state": BIND_STATE_UNBOUND,
                    }
                    session.updated_at = time.time()
                    self._save_sessions_to_disk()
                    self._append_log(
                        "[BIND][BOOTSTRAP_FAILED_RESET] "
                        f"session_id={session.session_id} "
                        f"message_id={bridge_id[:8] if bridge_id else '-'} "
                        f"reason={payload.get('reason') or payload.get('detail') or '-'}"
                    )
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
                target_user = None
                for message in reversed(session.messages):
                    if (
                        message.role == "user"
                        and (message.turn_id or "").strip() == (turn_id or "").strip()
                    ):
                        target_user = message
                        break
                if target_user is not None:
                    target_user.status = "发送失败"
                    session.updated_at = time.time()
                    failed_text = (target_user.content or "").strip()
                    if failed_text and hasattr(self, "message_input"):
                        self.message_input.setPlainText(failed_text)
                    elif failed_text and hasattr(self, "message_edit"):
                        self.message_edit.setPlainText(failed_text)
                self._add_system_message_once(
                    "消息发送失败，请检查绑定页面后重试。已将失败消息恢复到输入框。",
                    dedupe_seconds=10,
                )
                self._finalize_bridge(bridge_id)
                self._try_send_next_queued_message(session)
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
                    self._try_send_next_queued_message(session)
                else:
                    self._set_reply_error(
                        session, turn_id, "ChatGPT 返回了空回复。", "空回复"
                    )
                    self._finalize_bridge(bridge_id)
                    self._try_send_next_queued_message(session)
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
                self._try_send_next_queued_message(session)
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

    def _session_send_queue(self, session_id):
        sid = (session_id or "").strip()
        if not sid:
            return []
        if not hasattr(self, "_session_send_queues") or not isinstance(
            self._session_send_queues, dict
        ):
            self._session_send_queues = {}
        return self._session_send_queues.setdefault(sid, [])

    def _session_send_busy_reason(self, session):
        if session is None:
            return ""
        if self._session_has_pending_assistant_reply(session):
            return "pending_reply"
        response_state = self._session_bound_response_state(session)
        if bool(response_state.get("is_responding")):
            return "responding"
        state = (response_state.get("response_state") or "").strip().lower()
        if state in ("generating", "waiting", "pending", "queued"):
            return state
        if self._pending_auto_bind_session_id == session.session_id:
            return "waiting_bind"
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._remote_bind_state(remote)
        if bind_state in (
            BIND_STATE_WAITING_HOME,
            BIND_STATE_WAITING_CONVERSATION_CREATED,
            BIND_STATE_WAITING_BOUND_CONVERSATION,
        ):
            return bind_state.lower()
        return ""

    def _current_session_queue_size(self):
        session = self._current_session()
        if session is None:
            return 0
        return len(self._session_send_queue(session.session_id))

    def _total_session_queue_size(self):
        queues = getattr(self, "_session_send_queues", {})
        if not isinstance(queues, dict):
            return 0
        total = 0
        for items in queues.values():
            if isinstance(items, list):
                total += len(items)
        return total

    def _update_queue_badge(self):
        if not hasattr(self, "status_log_edit"):
            return
        summary = self._render_status_summary(getattr(self, "_last_bridge_status", {}) or {})
        self.status_log_edit.setPlainText(summary)

    def _enqueue_user_message_for_session(self, session, text):
        if session is None:
            return False
        text = str(text or "").strip()
        if not text:
            return False
        queue = self._session_send_queue(session.session_id)
        item = {
            "message_id": str(uuid.uuid4()),
            "text": text,
            "created_at": time.time(),
        }
        queue.append(item)
        self._append_session_message(
            session,
            "user",
            text,
            message_id=item["message_id"],
            created_at=item["created_at"],
            status="已加入队列",
            visible_in_chat=True,
        )
        session.updated_at = time.time()
        self._append_log(
            "[CHAT_QUEUE][ENQUEUE] "
            f"session_id={session.session_id} "
            f"message_id={item['message_id']} "
            f"queue_size={len(queue)} "
            f"text_len={len(text)}",
            echo=True,
        )
        self._set_tm_action_hint(
            f"当前对话正在处理上一条消息，已加入队列：{len(queue)} 条等待发送。"
        )
        self._refresh_local_conversation_after_sync(
            session.session_id,
            force_bottom=True,
            reason="queue_enqueue",
        )
        self._save_sessions_to_disk()
        self._update_queue_badge()
        return True

    def _try_send_next_queued_message(self, session):
        if session is None:
            return False
        queue = self._session_send_queue(session.session_id)
        busy_reason = self._session_send_busy_reason(session)
        if busy_reason:
            self._append_log(
                "[CHAT_QUEUE][WAIT] "
                f"session_id={session.session_id} "
                f"reason={busy_reason} "
                f"queue_size={len(queue)}",
                echo=True,
            )
            return False
        if not queue:
            self._append_log(
                f"[CHAT_QUEUE][EMPTY] session_id={session.session_id}",
                echo=True,
            )
            self._update_queue_badge()
            return False
        item = queue.pop(0)
        text = str(item.get("text") or "").strip()
        message_id = str(item.get("message_id") or "").strip()
        if not text:
            self._append_log(
                "[CHAT_QUEUE][SKIP_EMPTY] "
                f"session_id={session.session_id} "
                f"message_id={message_id or '-'}",
                echo=True,
            )
            self._update_queue_badge()
            return self._try_send_next_queued_message(session)
        self._append_log(
            "[CHAT_QUEUE][DEQUEUE_SEND] "
            f"session_id={session.session_id} "
            f"message_id={message_id or '-'} "
            f"queue_left={len(queue)} "
            f"text_len={len(text)}",
            echo=True,
        )
        self._set_tm_action_hint(f"正在发送队列中的下一条消息，剩余 {len(queue)} 条。")
        if message_id:
            self._set_user_message_status(session, message_id, "正在发送")
        self._refresh_local_conversation_after_sync(
            session.session_id,
            force_bottom=True,
            reason="queue_dequeue_send",
        )
        result = self._push_message_text(
            session,
            text,
            reuse_user_message_id=message_id,
            suppress_system_message=True,
            source="queue",
        )
        if not isinstance(result, dict):
            result = {"ok": False, "reason": "unknown"}
        if not result.get("ok"):
            reason = (result.get("reason") or "send_failed").strip() or "send_failed"
            retryable = bool(result.get("retryable", True))
            if retryable:
                queue.insert(0, item)
                if message_id:
                    self._set_user_message_status(session, message_id, "已加入队列")
            else:
                if message_id:
                    self._set_user_message_status(session, message_id, "发送失败")
            self._append_log(
                "[CHAT_QUEUE][SEND_FAILED] "
                f"session_id={session.session_id} "
                f"message_id={message_id or '-'} "
                f"reason={reason} "
                f"queue_left={len(queue)}",
                echo=True,
            )
            self._refresh_local_conversation_after_sync(
                session.session_id,
                force_bottom=True,
                reason="queue_send_failed",
            )
            self._update_queue_badge()
            return retryable
        self._update_queue_badge()
        return True

    def _push_message(self, *, skip_upload_before_send=False):
        if not server.is_server_running():
            self._add_system_message("请先启动服务。")
            return None
        content = self.message_edit.toPlainText().strip()
        if not content:
            self._add_system_message("请输入要发送的内容。")
            return None
        session = self._ensure_current_session()
        self._recover_stuck_bootstrap_sessions()
        busy_reason = self._session_send_busy_reason(session)
        if busy_reason:
            if busy_reason == "waiting_conversation_created":
                self._add_system_message("正在创建 ChatGPT 对话，请稍候…")
                return None
            self._enqueue_user_message_for_session(session, content)
            if self._auto_clear_input_after_send:
                self.message_edit.clear()
            return None
        response_ready, _response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            self._enqueue_user_message_for_session(session, content)
            if self._auto_clear_input_after_send:
                self.message_edit.clear()
            return None

        if self._bind_each_chat_to_page:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            bind_state = self._remote_bind_state(remote)
            has_conversation = bool((remote.get("conversation_id") or "").strip())
            needs_reopen_wait = (
                remote.get("enabled")
                and has_conversation
                and bind_state not in (BIND_STATE_PREBOUND_HOME, BIND_STATE_WAITING_HOME)
                and not self._session_has_sendable_bound_page(remote)
            )
            if needs_reopen_wait:
                pending_turn_id = str(uuid.uuid4())
                pending_user_message = self._append_session_message(
                    session,
                    "user",
                    content,
                    turn_id=pending_turn_id,
                    status="等待绑定页上线",
                )
                reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                    session,
                    content,
                    user_message_id=pending_user_message.message_id,
                )
                if reopen_result is False:
                    self._refresh_session_list(select_session_id=session.session_id)
                    self._render_session_chat(session)
                    self._save_sessions_to_disk()
                    if self._auto_clear_input_after_send:
                        self.message_edit.clear()
                    self._apply_chat_bind_visual_state()
                    return None
            else:
                reopen_result = self._prepare_bound_conversation_reopen_if_needed(
                    session, content
                )
                if reopen_result is False:
                    if self._auto_clear_input_after_send:
                        self.message_edit.clear()
                    self._apply_chat_bind_visual_state()
                    return None

        if self._bind_each_chat_to_page and self._session_needs_first_message_bind(
            session
        ):
            ready, reason = self._prepare_first_message_binding(session, content)
            if not ready:
                if reason == "__WAITING_HOME_PENDING__":
                    if self._auto_clear_input_after_send:
                        self.message_edit.clear()
                    self._save_sessions_to_disk()
                    return None
                if reason:
                    self._add_system_message(reason)
                return None

        return self._push_message_text(
            session,
            content,
            skip_upload_before_send=skip_upload_before_send,
        )

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

    def _push_message_text(
        self,
        session,
        content,
        from_pending_bootstrap=False,
        reuse_user_message_id="",
        suppress_system_message=False,
        source="direct",
        skip_upload_before_send=False,
    ):
        raw_user_text = content.strip()
        if not raw_user_text:
            return {"ok": False, "reason": "empty_text", "retryable": False}
        final_prompt = raw_user_text
        reuse_user_message_id = (reuse_user_message_id or "").strip()
        existing_user_message = self._find_session_message_by_id(
            session, reuse_user_message_id
        )
        turn_id = (
            (existing_user_message.turn_id or "").strip()
            if existing_user_message is not None
            else ""
        ) or str(uuid.uuid4())
        user_message_id = (
            reuse_user_message_id if existing_user_message is not None else str(uuid.uuid4())
        )
        assistant_message_id = str(uuid.uuid4())
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)
        is_bootstrap = bind_state == BIND_STATE_PREBOUND_HOME
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
            self._append_log(
                f"[NEW_SESSION][FIRST_SEND] session_id={session.session_id} "
                f"client_id={client_id} page_instance_id={page_instance_id or '-'} "
                f"text_len={len(raw_user_text)}"
            )
        prereq_ok, prereq_reason = self._check_tm_send_prerequisites(session)
        if not prereq_ok:
            self._append_log(f"[发送] {prereq_reason}")
            if not suppress_system_message:
                self._add_system_message(prereq_reason)
            self._apply_chat_bind_visual_state()
            return {"ok": False, "reason": prereq_reason, "retryable": True}

        self._rebind_current_session_to_online_client_if_needed()
        self._log_send_bind_check(session, action="before_send")

        target_client_id, target_page_url, allowed, reason = (
            self._resolve_target_page_for_session(session)
        )
        self._append_log(f"[发送] {reason}")
        if not allowed:
            if not suppress_system_message:
                self._add_system_message(reason)
            self._apply_chat_bind_visual_state()
            return {"ok": False, "reason": reason or "target_not_allowed", "retryable": True}

        target_client_id, target_page_url, allowed, verify_reason = (
            self._verify_send_target_binding(
                session, target_client_id, target_page_url
            )
        )
        if verify_reason:
            self._append_log(f"[发送] {verify_reason}")
        if not allowed:
            if not suppress_system_message:
                self._add_system_message(verify_reason or "发送前绑定校验失败。")
            self._apply_chat_bind_visual_state()
            return {
                "ok": False,
                "reason": verify_reason or "send_target_verify_failed",
                "retryable": True,
            }

        payload = {
            "session_id": session.session_id,
            "turn_id": turn_id,
            "raw_user_text": raw_user_text,
            "final_prompt": final_prompt,
        }
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        bind_state = self._effective_bind_state(session)
        if is_bootstrap:
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
                page_inst_bind = (remote.get("page_instance_id") or "").strip()
                if page_inst_bind:
                    payload["target_page_instance_id"] = page_inst_bind
            self._append_log(
                f"[发送] 目标 client_id={target_client_id} "
                f"conversation_id={payload.get('conversation_id') or '-'} "
                f"bootstrap={payload.get('bootstrap_conversation', False)} "
                f"page={self._short_page_display(target_page_url)}"
            )
        if getattr(self, "_upload_before_send_enabled", False) and not skip_upload_before_send:
            upload_queued = self._enqueue_upload_before_send_command(
                session=session,
                payload=payload,
                target_client_id=target_client_id,
            )

            if not upload_queued:
                self._add_system_message(
                    "发送前上传命令入队失败，已取消本次发送。"
                )
                self._apply_chat_bind_visual_state()
                return {"ok": False, "reason": "upload_before_send_enqueue_failed", "retryable": True}

        try:
            msg = server.push_message(payload)
        except Exception as error:
            detail = f"消息入队失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            if not suppress_system_message:
                self._add_system_message(f"消息入队失败：{error}")
            return {"ok": False, "reason": str(error), "retryable": False}
        if not target_client_id:
            if not self._session_is_local_new_chat_flow(session):
                live_client = (
                    self._last_bridge_status.get("tampermonkey_client_id") or ""
                ).strip()
                if live_client:
                    self._remember_session_page_from_client(session, live_client)
        bridge_message_id = msg.get("id") if isinstance(msg, dict) else None
        if not bridge_message_id:
            if not suppress_system_message:
                self._add_system_message("服务端未返回 bridge_message_id，无法跟踪回复。")
            return {
                "ok": False,
                "reason": "missing_bridge_message_id",
                "retryable": False,
            }
        server.attach_external_request_bridge(
            session.session_id, bridge_message_id, turn_id
        )
        self._message_to_session[bridge_message_id] = session.session_id
        self._message_to_turn[bridge_message_id] = turn_id
        if is_bootstrap:
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
            target_client = (payload.get("target_client_id") or "").strip()
            target_instance = (payload.get("target_page_instance_id") or "").strip()
            session.remote_chatgpt = {
                **remote_now,
                "bind_state": BIND_STATE_WAITING_CONVERSATION_CREATED,
                "bootstrap_in_progress": True,
                "bootstrap_message_id": bridge_message_id,
                "bootstrap_started_at": time.time(),
                "client_id": target_client or (remote_now.get("client_id") or ""),
                "page_instance_id": target_instance or (remote_now.get("page_instance_id") or ""),
            }
            session.updated_at = time.time()
            self._append_log(
                "[SEND][BOOTSTRAP_START] "
                f"session_id={session.session_id} "
                f"bridge_message_id={bridge_message_id} "
                f"client_id={target_client or '-'} "
                f"page_instance_id={target_instance or '-'}"
            )
            self._append_log(
                f"[BIND][WAITING_CONVERSATION_CREATED] session_id={session.session_id} "
                f"bridge_message_id={bridge_message_id}"
            )
        if self._auto_name_new_chat and session.title == "新对话":
            session.title = raw_user_text[:20] + (
                "…" if len(raw_user_text) > 20 else ""
            )
        if existing_user_message is not None:
            existing_user_message.bridge_message_id = bridge_message_id
            existing_user_message.turn_id = turn_id
            existing_user_message.status = "等待回复"
            existing_user_message.content = raw_user_text
            session.updated_at = time.time()
        else:
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
        self._append_log(
            "[CHAT_QUEUE][SEND_OK] "
            f"session_id={session.session_id} "
            f"source={source} "
            f"message_id={reuse_user_message_id or user_message_id} "
            f"bridge_message_id={bridge_message_id}",
            echo=True,
        )
        if hasattr(self, "_update_upload_action_buttons_state"):
            self._update_upload_action_buttons_state()
        return {
            "ok": True,
            "bridge_message_id": bridge_message_id,
            "turn_id": turn_id,
        }
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

        busy_reason = self._session_send_busy_reason(session)
        if busy_reason:
            queued = self._enqueue_user_message_for_session(session, text)
            if not queued:
                return {
                    "ok": False,
                    "error": "消息入队失败",
                    "code": "INTERNAL_ERROR",
                }
            queue = self._session_send_queue(session.session_id)
            queued_id = ""
            if queue:
                queued_id = (queue[-1].get("message_id") or "").strip()
            return {
                "ok": True,
                "session_id": session.session_id,
                "pending_home": False,
                "pending_queued": True,
                "queued_message_id": queued_id,
                "bridge_message_id": "",
                "turn_id": "",
                **session_meta,
            }
        response_ready, response_msg = self._check_bound_client_response_ready(session)
        if not response_ready:
            queued = self._enqueue_user_message_for_session(session, text)
            if not queued:
                return {
                    "ok": False,
                    "error": response_msg,
                    "code": "INTERNAL_ERROR",
                }
            queue = self._session_send_queue(session.session_id)
            queued_id = ""
            if queue:
                queued_id = (queue[-1].get("message_id") or "").strip()
            return {
                "ok": True,
                "session_id": session.session_id,
                "pending_home": False,
                "pending_queued": True,
                "queued_message_id": queued_id,
                "bridge_message_id": "",
                "turn_id": "",
                **session_meta,
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
        is_bootstrap = bind_state == BIND_STATE_PREBOUND_HOME

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
        if is_bootstrap:
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
        if is_bootstrap:
            remote_now = normalize_remote_chatgpt(session.remote_chatgpt)
            session.remote_chatgpt = {
                **remote_now,
                "bind_state": BIND_STATE_WAITING_CONVERSATION_CREATED,
                "bootstrap_in_progress": True,
                "bootstrap_message_id": bridge_message_id,
                "bootstrap_started_at": time.time(),
                "client_id": (payload.get("target_client_id") or "").strip()
                or (remote_now.get("client_id") or ""),
                "page_instance_id": (payload.get("target_page_instance_id") or "").strip()
                or (remote_now.get("page_instance_id") or ""),
            }
            session.updated_at = time.time()
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
        if hasattr(self, "_save_chat_splitter_sizes"):
            self._save_chat_splitter_sizes()
        self._save_sessions_to_disk()
        self._save_app_settings()
        if server.is_server_running():
            try:
                server.stop_server()
            except Exception as error:
                detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"
                self._append_log(detail, echo=True)
        event.accept()
