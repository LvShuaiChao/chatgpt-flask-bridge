"""聊天页「开始上传」：向油猴下发 start_upload，触发工具箱队列上传。"""

import traceback

import server

from app.models import normalize_remote_chatgpt
from app.url_utils import parse_conversation_id
from app.utils.page_status import page_url_from


class ChatFileUploadMixin:
    def _init_chat_file_upload_state(self):
        pass

    def _resolve_bound_or_selected_tm_page(self, session=None):
        """
        解析 start_upload 目标页：优先当前会话绑定，其次页面下拉框选中项。
        返回 dict(client_id, page_instance_id, conversation_id) 或 None。
        """
        session = session if session is not None else self._current_session()
        status = getattr(self, "_last_bridge_status", None) or {}

        if session is not None:
            remote = normalize_remote_chatgpt(session.remote_chatgpt)
            if remote.get("enabled"):
                client_id = (remote.get("client_id") or "").strip()
                page_instance_id = (remote.get("page_instance_id") or "").strip()
                conversation_id = (remote.get("conversation_id") or "").strip()
                if not conversation_id:
                    conversation_id = (
                        parse_conversation_id(
                            remote.get("conversation_url") or remote.get("url") or ""
                        )
                        or ""
                    ).strip()
                if client_id:
                    return {
                        "client_id": client_id,
                        "page_instance_id": page_instance_id,
                        "conversation_id": conversation_id,
                    }

        page = None
        if hasattr(self, "_get_selected_tm_page_from_combo"):
            page = self._get_selected_tm_page_from_combo(status=status)
        if isinstance(page, dict):
            client_id = (page.get("client_id") or "").strip()
            if client_id:
                page_instance_id = (page.get("page_instance_id") or "").strip()
                conversation_id = (page.get("conversation_id") or "").strip()
                if not conversation_id:
                    conversation_id = (
                        parse_conversation_id(page_url_from(page) or "")
                        or ""
                    ).strip()
                return {
                    "client_id": client_id,
                    "page_instance_id": page_instance_id,
                    "conversation_id": conversation_id,
                }

        return None

    def _update_upload_current_file_btn_state(self):
        btn = getattr(self, "upload_current_file_btn", None)
        if btn is None:
            return
        btn.setEnabled(True)
        btn.setToolTip(
            "向当前绑定或页面列表选中的 ChatGPT 页下发 start_upload，"
            "触发油猴工具箱「开始上传」（不上传 Python 本地文件）。"
        )

    def _trigger_tm_start_upload(self):
        if not server.is_server_running():
            self._add_system_message("请先启动桥接服务。")
            self.statusBar().showMessage("请先启动桥接服务", 5000)
            self._append_log(
                "[TM_CONTROL][START_UPLOAD][SKIP] reason=server_not_running",
                echo=True,
            )
            return

        session = self._current_session()
        target = self._resolve_bound_or_selected_tm_page(session)
        client_id = (target or {}).get("client_id") or ""
        if not client_id:
            msg = "当前会话未绑定 ChatGPT 页面，请先绑定页面后再触发上传。"
            self._add_system_message(msg)
            self.statusBar().showMessage(msg, 5000)
            self._append_log(
                "[TM_CONTROL][START_UPLOAD][SKIP] reason=no_target_page",
                echo=True,
            )
            return

        page_instance_id = (target.get("page_instance_id") or "").strip()
        conversation_id = (target.get("conversation_id") or "").strip()
        payload = {
            "source": "python_gui",
            "session_id": session.session_id if session else "",
            "require_all_success": False,
            "block_next_chat_on_failed": False,
        }
        try:
            queued = server.enqueue_control_command(
                command="start_upload",
                target_client_id=client_id,
                target_page_instance_id=page_instance_id,
                target_conversation_id=conversation_id,
                payload=payload,
            )
        except Exception as error:
            detail = (
                f"[TM_CONTROL][START_UPLOAD][FAILED] reason=exception {error}\n"
                f"{traceback.format_exc()}"
            )
            self._append_log(detail, echo=True)
            self._add_system_message(f"开始上传指令入队失败：{error}")
            self.statusBar().showMessage("开始上传指令发送失败", 5000)
            return

        if not queued:
            self._append_log(
                "[TM_CONTROL][START_UPLOAD][FAILED] reason=enqueue_returned_falsy",
                echo=True,
            )
            self._add_system_message("开始上传指令入队失败，请查看日志。")
            self.statusBar().showMessage("开始上传指令发送失败", 5000)
            return

        message_id = ""
        if isinstance(queued, dict):
            message_id = (queued.get("id") or queued.get("message_id") or "").strip()

        self._append_log(
            "[TM_CONTROL][START_UPLOAD][QUEUE] "
            f"target_client_id={client_id} "
            f"target_page_instance_id={page_instance_id or '-'} "
            f"conversation_id={conversation_id or '-'} "
            f"source=python_gui "
            f"command_message_id={message_id or '-'}",
            echo=True,
        )
        ok_msg = "已发送开始上传指令到油猴脚本。"
        self._add_system_message(ok_msg)
        self.statusBar().showMessage(ok_msg, 5000)

    def _on_upload_current_file_control_done(self, item, payload):
        """兼容历史 upload_current_file 控制命令回执。"""
        message_id = (item.get("message_id") or "").strip()
        result = payload.get("result") or {}
        ok = bool(payload.get("ok") if payload.get("ok") is not None else result.get("ok", True))
        detail = (
            (payload.get("message") or "")
            or (payload.get("detail") or "")
            or (result.get("message") or "")
            or (result.get("reason") or "")
            or ""
        ).strip()
        tag = "OK" if ok else "FAILED"
        self._append_log(
            f"[TM_UPLOAD][LEGACY][{tag}] command=upload_current_file "
            f"message_id={message_id or '-'} detail={detail or '-'}",
            echo=True,
        )

    def _on_upload_current_file_command_failed(self, item, payload):
        """兼容历史 upload_current_file 控制命令失败。"""
        message_id = (item.get("message_id") or "").strip()
        detail = (
            (payload.get("detail") or "")
            or (payload.get("reason") or "")
            or (payload.get("error") or "")
            or "命令执行失败"
        ).strip()
        self._append_log(
            f"[TM_UPLOAD][LEGACY][FAILED] command=upload_current_file "
            f"message_id={message_id or '-'} detail={detail}",
            echo=True,
        )
        self._add_system_message(f"文件上传失败：{detail}")
