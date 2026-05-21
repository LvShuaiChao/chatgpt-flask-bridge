import json

import os

import subprocess

import time

import traceback

import urllib.error

import urllib.request

import uuid



import server

from PyQt5.QtCore import Qt, QUrl

from PyQt5.QtGui import QDesktopServices

from PyQt5.QtWidgets import QMessageBox





class CursorBridgeMixin:

    CURSOR_TASK_CREATE_PATH = "/api/cursor/tasks/create"

    _CURSOR_DELIVERY_MODE_BY_INDEX = ("manual_confirm", "auto_send")

    _CURSOR_PROMPT_MODE_BY_INDEX = ("raw", "wrapped")

    _CURSOR_SUBMIT_MODE_BY_INDEX = ("enter", "paste_only")

    _CURSOR_COMMAND_BY_INDEX = (
        "send_message",
        "new_chat",
        "new_chat_and_send",
    )

    _CURSOR_COMMAND_TITLES = {
        "send_message": "发送 Cursor 消息",
        "new_chat": "新建 Cursor Chat",
        "new_chat_and_send": "新建 Cursor Chat 并发送",
    }

    _CURSOR_COMMAND_TYPES = {
        "send_message": "cursor_agent_prompt",
        "new_chat": "cursor_command",
        "new_chat_and_send": "cursor_command",
    }



    def _get_current_project_root(self):

        """

        获取当前项目根目录。

        优先使用用户设置中的 project_root。

        如果没有设置，则使用当前工作目录。

        """

        root = getattr(self, "_project_root", "") or ""

        root = (root or "").strip()

        if not root:

            root = os.getcwd()

        return os.path.abspath(root)



    def _cursor_bridge_server_url(self):

        if server.is_server_running():

            url = (server.get_server_url() or "").strip()

            if url:

                return url.rstrip("/")

        return "http://127.0.0.1:5000"



    def _set_cursor_status_hint(self, text):

        text = (text or "").strip()

        if text and hasattr(self, "_set_settings_hint"):

            self._set_settings_hint(text)



    def _combo_stored_value(self, combo, values_by_index, default):

        if combo is None:

            return default

        data = combo.currentData(Qt.UserRole)

        if data is not None:

            text = str(data).strip()

            if text:

                return text

        idx = combo.currentIndex()

        if 0 <= idx < len(values_by_index):

            return values_by_index[idx]

        return default



    def _get_cursor_delivery_mode(self):

        combo = getattr(self, "delivery_mode_combo", None)

        return self._combo_stored_value(

            combo,

            self._CURSOR_DELIVERY_MODE_BY_INDEX,

            "auto_send",

        )



    def _get_cursor_command(self):

        combo = getattr(self, "cursor_command_combo", None)

        return self._combo_stored_value(

            combo,

            self._CURSOR_COMMAND_BY_INDEX,

            "send_message",

        )



    def _get_cursor_prompt_mode(self):

        combo = getattr(self, "prompt_mode_combo", None)

        return self._combo_stored_value(

            combo,

            self._CURSOR_PROMPT_MODE_BY_INDEX,

            "raw",

        )



    def _get_cursor_submit_mode(self):

        combo = getattr(self, "submit_mode_combo", None)

        return self._combo_stored_value(

            combo,

            self._CURSOR_SUBMIT_MODE_BY_INDEX,

            "enter",

        )



    def _build_cursor_task(

        self,

        raw_content,

        *,

        command=None,

        task_id=None,

        delivery_mode=None,

        prompt_mode=None,

        submit_mode=None,

        project_root=None,

    ):

        """构建 Cursor 任务 dict；content 必须为输入框原文，不做 strip 或包装。"""

        if command is None:

            command = self._get_cursor_command()

        if command not in self._CURSOR_COMMAND_BY_INDEX:

            command = "send_message"

        if delivery_mode is None:

            delivery_mode = self._get_cursor_delivery_mode()

        if prompt_mode is None:

            prompt_mode = self._get_cursor_prompt_mode()

        if submit_mode is None:

            submit_mode = self._get_cursor_submit_mode()

        if project_root is None:

            project_root = self._get_current_project_root()

        if not task_id:

            task_id = f"cursor_task_{int(time.time())}_{uuid.uuid4().hex[:8]}"

        if delivery_mode == "auto_send":

            mode = "auto_send"

            require_confirm = False

        else:

            delivery_mode = "manual_confirm"

            mode = "manual_confirm"

            require_confirm = True

        if command == "new_chat":

            content = ""

        else:

            content = raw_content

        title = self._CURSOR_COMMAND_TITLES.get(command, "发送 Cursor 消息")

        task_type = self._CURSOR_COMMAND_TYPES.get(command, "cursor_agent_prompt")

        return {

            "task_id": task_id,

            "type": task_type,

            "command": command,

            "delivery_mode": delivery_mode,

            "mode": mode,

            "require_confirm": require_confirm,

            "prompt_mode": prompt_mode,

            "submit_mode": submit_mode,

            "target": "agent",

            "title": title,

            "project_root": project_root,

            "content": content,

            "files": [],

            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),

        }



    def _post_cursor_task_create(self, task):

        """通过 HTTP POST 创建 Cursor 任务，与 Cursor 插件使用同一接口。"""

        base_url = self._cursor_bridge_server_url()

        url = f"{base_url}{self.CURSOR_TASK_CREATE_PATH}"

        body = {"task": dict(task or {})}

        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

        request = urllib.request.Request(

            url,

            data=payload,

            headers={"Content-Type": "application/json; charset=utf-8"},

            method="POST",

        )

        try:

            with urllib.request.urlopen(request, timeout=15) as response:

                raw = response.read().decode("utf-8", errors="replace")

        except urllib.error.HTTPError as exc:

            detail_body = ""

            try:

                detail_body = exc.read().decode("utf-8", errors="replace")

            except Exception as read_error:

                detail_body = f"{read_error}\n{traceback.format_exc()}"

            detail = (

                f"HTTP {exc.code} url={url} body={detail_body or '-'}\n"

                f"{traceback.format_exc()}"

            )

            self._append_log(

                f"[CURSOR_BRIDGE][SEND_TASK_FAILED] {detail}",

                echo=True,

            )

            return False, f"HTTP {exc.code}: {detail_body or exc.reason}"

        except urllib.error.URLError as exc:

            detail = f"{exc}\n{traceback.format_exc()}"

            self._append_log(

                f"[CURSOR_BRIDGE][SEND_TASK_FAILED] url={url} error={detail}",

                echo=True,

            )

            return False, str(exc.reason or exc)

        except Exception as exc:

            detail = f"{exc}\n{traceback.format_exc()}"

            self._append_log(

                f"[CURSOR_BRIDGE][SEND_TASK_FAILED] url={url} error={detail}",

                echo=True,

            )

            return False, str(exc)



        try:

            data = json.loads(raw or "{}")

        except json.JSONDecodeError as exc:

            detail = f"{exc}\nraw={raw}\n{traceback.format_exc()}"

            self._append_log(

                f"[CURSOR_BRIDGE][SEND_TASK_FAILED] invalid_json error={detail}",

                echo=True,

            )

            return False, f"响应不是有效 JSON：{raw[:200]}"



        if not isinstance(data, dict):

            return False, "响应格式无效"

        if data.get("ok"):

            return True, (data.get("task_id") or task.get("task_id") or "")

        return False, (data.get("error") or "创建任务失败")



    def _refresh_cursor_bridge_status(self, cursor_status=None):

        if cursor_status is None:

            if not server.is_server_running():

                self._set_cursor_bridge_status_badge(

                    text="Cursor：未连接",

                    level="neutral",

                    tooltip="服务未启动，无法获取 Cursor Bridge 状态。",

                )

                return

            try:

                status = server.get_cursor_bridge_status()

            except AttributeError as exc:

                self._append_log(

                    "[CURSOR_STATUS][FAILED] "

                    f"reason=server_missing_get_cursor_bridge_status error={exc}",

                    echo=False,

                )

                self._set_cursor_bridge_status_badge(

                    text="Cursor：接口缺失",

                    level="error",

                    tooltip="server.py 缺少 get_cursor_bridge_status()",

                )

                return

            except Exception as exc:

                detail = f"{exc}\n{traceback.format_exc()}"

                self._append_log(

                    "[CURSOR_STATUS][FAILED] "

                    f"reason=exception error={detail}",

                    echo=False,

                )

                self._set_cursor_bridge_status_badge(

                    text="Cursor：状态异常",

                    level="error",

                    tooltip=str(exc),

                )

                return

        else:

            status = cursor_status or {}



        online = bool(status.get("online"))

        state = status.get("status") or "unknown"

        age = status.get("age_seconds")

        pending_count = int(status.get("pending_count") or 0)

        last_task_id = status.get("last_task_id") or ""

        last_report_status = status.get("last_report_status") or ""

        last_report_message = status.get("last_report_message") or ""



        if online:

            age_text = f"{int(age)}秒前" if age is not None else "-"

            text = f"Cursor：在线｜待处理 {pending_count}"

            level = "ok"

        elif state == "never_seen":

            age_text = "-"

            text = "Cursor：未连接"

            level = "neutral"

        else:

            age_text = f"{int(age)}秒前" if age is not None else "-"

            text = f"Cursor：离线｜待处理 {pending_count}"

            level = "error"



        tooltip = (

            f"Cursor Bridge 状态：{state}\n"

            f"在线：{online}\n"

            f"最近心跳：{age_text}\n"

            f"待处理任务：{pending_count}\n"

            f"最后任务：{last_task_id or '-'}\n"

            f"最后回报：{last_report_status or '-'}\n"

            f"回报消息：{last_report_message or '-'}"

        )



        self._last_cursor_bridge_status = status
        self._set_cursor_bridge_status_badge(text, level, tooltip)
        if hasattr(self, "_update_task_queue_card"):
            self._update_task_queue_card()

    def _set_cursor_bridge_status_badge(self, text, level="neutral", tooltip=""):
        label = getattr(self, "cursor_bridge_status_label", None)
        if label is None:
            return

        text = text or ""
        tooltip = tooltip or text
        signature = (text, level, tooltip)
        if getattr(self, "_last_cursor_bridge_badge_signature", None) == signature:
            return
        self._last_cursor_bridge_badge_signature = signature

        if label.text() != text:
            label.setText(text)
        if label.toolTip() != tooltip:
            label.setToolTip(tooltip)

        if level == "ok":
            object_name = "StatusBadgeOk"
        elif level == "warn":
            object_name = "StatusBadgeWarn"
        elif level == "error":
            object_name = "StatusBadgeError"
        else:
            object_name = "StatusBadgeNeutral"

        if label.objectName() != object_name:
            label.setObjectName(object_name)
            label.style().unpolish(label)
            label.style().polish(label)



    def _set_cursor_feedback(
        self,
        *,
        log_line="",
        system_message="",
        status_text="",
        hint="",
        echo=True,
    ):
        if log_line:
            self._append_log(log_line, echo=echo)
        if system_message:
            self._add_system_message(system_message)
        if status_text and hasattr(self, "cursor_status_label"):
            self.cursor_status_label.setText(status_text)
        if hint:
            self._set_cursor_status_hint(hint)

    def _send_raw_content_to_cursor(self, raw_content, *, log_prefix="SEND_TASK"):
        command = self._get_cursor_command()

        if command == "new_chat_and_send" and not raw_content.strip():
            QMessageBox.warning(
                self, "内容为空", "新建并发送需要输入消息内容。"
            )
            self._set_cursor_status_hint("发送失败：新建并发送需要输入消息内容。")
            return

        if command == "send_message" and not raw_content.strip():
            QMessageBox.warning(self, "内容为空", "请输入要发送给 Cursor 的内容。")
            self._set_cursor_status_hint("发送失败：内容为空。")
            return

        if not server.is_server_running():
            msg = "请先启动服务，再发送到 Cursor。"
            self._set_cursor_feedback(
                log_line=f"[CURSOR_BRIDGE][{log_prefix}_FAILED] reason=server_not_running",
                system_message=msg,
                hint=msg,
            )
            return

        delivery_mode = self._get_cursor_delivery_mode()
        prompt_mode = self._get_cursor_prompt_mode()
        submit_mode = self._get_cursor_submit_mode()
        task = self._build_cursor_task(
            raw_content,
            command=command,
            delivery_mode=delivery_mode,
            prompt_mode=prompt_mode,
            submit_mode=submit_mode,
        )
        task_type = task.get("type") or ""
        task_command = task.get("command") or command
        delivery_mode = task.get("delivery_mode") or "auto_send"
        submit_mode = task.get("submit_mode") or "enter"
        content_len = len(task.get("content") or "")

        self._append_log(
            f"[CURSOR_BRIDGE][{log_prefix}_START]\n"
            f"task_id={task['task_id']}\n"
            f"type={task_type}\n"
            f"command={task_command}\n"
            f"delivery_mode={delivery_mode}\n"
            f"prompt_mode={prompt_mode}\n"
            f"submit_mode={submit_mode}\n"
            f"content_len={content_len}",
            echo=True,
        )

        ok, result = self._post_cursor_task_create(task)
        if ok:
            task_id = (result or task.get("task_id") or "").strip()
            ok_msg = (
                f"已发送到 Cursor 任务队列：\n"
                f"task_id={task_id}\n"
                f"操作：{task_command}\n"
                f"提交方式：{submit_mode}"
            )
            self._set_cursor_feedback(
                log_line=f"[CURSOR_BRIDGE][{log_prefix}_OK]\ntask_id={task_id}",
                system_message=ok_msg,
                status_text=f"Cursor 状态：已排队 {task_id}",
                hint=ok_msg.replace("\n", " | "),
            )
            self._refresh_cursor_bridge_status()
            return

        fail_msg = f"发送到 Cursor 失败：{result}"
        self._set_cursor_feedback(
            log_line=f"[CURSOR_BRIDGE][{log_prefix}_FAILED] error={result}",
            system_message=fail_msg,
            hint=fail_msg,
        )

    def _bind_send_last_to_cursor_button(self):
        """绑定聊天面板「发送最后给 Cursor」按钮（由 UiBuilderMixin 在创建按钮后调用）。"""
        button = getattr(self, "send_last_to_cursor_btn", None)
        if button is None:
            return
        reconnect = getattr(self, "_reconnect_button", None)
        if not callable(reconnect):
            button.clicked.connect(self._on_send_last_message_to_cursor_clicked)
            return
        reconnect(
            button,
            self._on_send_last_message_to_cursor_clicked,
            tag="send_last_to_cursor_btn",
        )

    def _on_send_to_cursor_clicked(self):
        """ChatGPT -> Cursor Bridge：将输入框原文发送到 Cursor 任务队列。"""
        message_edit = getattr(self, "message_edit", None)
        if message_edit is None:
            self._set_cursor_feedback(
                log_line="[CURSOR_BRIDGE][SEND_TASK_FAILED] reason=no_message_edit",
                system_message="未找到输入框，无法发送到 Cursor。",
            )
            return
        self._send_raw_content_to_cursor(message_edit.toPlainText())

    def _on_send_last_message_to_cursor_clicked(self):
        """将当前会话最后一条 ChatGPT 回复发送到 Cursor 任务队列。"""
        session = self._current_session()
        raw_content = self._last_assistant_text(session)
        if not raw_content.strip():
            self._set_cursor_feedback(
                log_line="[CURSOR_BRIDGE][SEND_LAST_REPLY_FAILED] reason=no_assistant_reply",
                system_message="当前没有可发送的 ChatGPT 回复。",
                hint="发送失败：没有可发送的 ChatGPT 回复。",
            )
            return
        self._send_raw_content_to_cursor(
            raw_content,
            log_prefix="SEND_LAST_REPLY",
        )

    def _on_test_cursor_cli_clicked(self):

        """

        测试 cursor-agent 是否可用。

        只执行 cursor-agent --version，不修改任何项目文件。

        """

        self._append_log(

            "[CURSOR_TEST][CLI_START] cursor-agent --version",

            echo=True,

        )



        try:

            result = subprocess.run(

                ["cursor-agent", "--version"],

                text=True,

                encoding="utf-8",

                errors="replace",

                capture_output=True,

                timeout=10,

            )

        except FileNotFoundError as exc:

            msg = "未找到 cursor-agent，请确认 Cursor CLI 已安装并加入 PATH。"

            self._append_log(

                f"[CURSOR_TEST][CLI_FAILED] reason=file_not_found error={exc}",

                echo=True,

            )

            self._add_system_message(msg)

            self._set_cursor_feedback(status_text="Cursor 状态：CLI 未找到")

            self._set_cursor_status_hint(msg)

            return

        except subprocess.TimeoutExpired as exc:

            msg = "cursor-agent --version 执行超时。"

            self._append_log(

                f"[CURSOR_TEST][CLI_FAILED] reason=timeout error={exc}",

                echo=True,

            )

            self._add_system_message(msg)

            self._set_cursor_feedback(status_text="Cursor 状态：CLI 超时")

            self._set_cursor_status_hint(msg)

            return

        except Exception as exc:

            detail = f"{exc}\n{traceback.format_exc()}"

            msg = f"测试 Cursor CLI 失败：{exc}"

            self._append_log(

                f"[CURSOR_TEST][CLI_FAILED] reason=exception error={detail}",

                echo=True,

            )

            self._add_system_message(msg)

            self._set_cursor_feedback(status_text="Cursor 状态：CLI 异常")

            self._set_cursor_status_hint(msg)

            return



        stdout = (result.stdout or "").strip()

        stderr = (result.stderr or "").strip()



        if result.returncode == 0:

            version = stdout.splitlines()[-1] if stdout else "-"

            ok_msg = f"Cursor CLI 可用：{version}"

            self._append_log(

                f"[CURSOR_TEST][CLI_OK] version={version}",

                echo=True,

            )

            self._add_system_message(ok_msg)

            self._set_cursor_feedback(
                status_text=f"Cursor 状态：CLI 可用 {version}"
            )

            self._set_cursor_status_hint(ok_msg)

        else:

            fail_msg = (

                f"Cursor CLI 测试失败：returncode={result.returncode}，"

                f"stderr={stderr or '-'}"

            )

            self._append_log(

                f"[CURSOR_TEST][CLI_FAILED] returncode={result.returncode} "

                f"stderr={stderr}",

                echo=True,

            )

            self._add_system_message(fail_msg)

            self._set_cursor_feedback(status_text="Cursor 状态：CLI 测试失败")

            self._set_cursor_status_hint(fail_msg)



    def _on_send_cursor_test_task_clicked(self):

        """

        向 Python server.py 的 Cursor 任务队列发送一条只读测试任务。

        不直接调用 Cursor CLI，不直接修改代码。

        """

        test_prompt = (

            "请只读取当前项目结构，并总结主要模块。\n"

            "不要修改任何文件。\n"

            "不要执行删除、覆盖、重置、安装依赖等危险操作。"

        )

        project_root = self._get_current_project_root()

        task = {

            "task_id": f"cursor_test_{int(time.time())}_{uuid.uuid4().hex[:8]}",

            "type": "cursor_agent_prompt",

            "delivery_mode": "manual_confirm",

            "prompt_mode": "raw",

            "submit_mode": "enter",

            "title": "Cursor Bridge 只读联动测试",

            "project_root": project_root,

            "content": test_prompt,

            "files": [],

            "mode": "manual_confirm",

            "require_confirm": True,

            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),

        }



        self._append_log(

            f"[CURSOR_TEST][TASK_START] task_id={task['task_id']} "

            f"project_root={project_root}",

            echo=True,

        )



        if not server.is_server_running():

            fail_msg = "发送 Cursor 测试任务失败：服务未启动。"

            self._set_cursor_feedback(
                log_line="[CURSOR_TEST][TASK_FAILED] reason=server_not_running",
                system_message=fail_msg,
                status_text="Cursor 状态：服务未启动",
                hint=fail_msg,
            )

            return



        try:

            ok, result = server.enqueue_cursor_task(task)

        except AttributeError as exc:

            detail = f"{exc}\n{traceback.format_exc()}"

            fail_msg = f"发送 Cursor 测试任务失败：server 缺少 enqueue_cursor_task：{exc}"

            self._append_log(

                f"[CURSOR_TEST][TASK_FAILED] reason=missing_api error={detail}",

                echo=True,

            )

            self._add_system_message(fail_msg)

            self._set_cursor_feedback(status_text="Cursor 状态：接口缺失")

            self._set_cursor_status_hint(fail_msg)

            return

        except Exception as exc:

            detail = f"{exc}\n{traceback.format_exc()}"

            fail_msg = f"发送 Cursor 测试任务失败：{exc}"

            self._append_log(

                f"[CURSOR_TEST][TASK_FAILED] reason=exception error={detail}",

                echo=True,

            )

            self._add_system_message(fail_msg)

            self._set_cursor_feedback(status_text="Cursor 状态：任务发送失败")

            self._set_cursor_status_hint(fail_msg)

            return



        if ok:

            task_id = (result or task.get("task_id") or "").strip()

            ok_msg = (

                f"已发送到 Cursor 任务队列：task_id={task_id}\n"

                f"发送方式：manual_confirm\n"

                f"内容模式：raw"

            )

            self._set_cursor_feedback(
                log_line=f"[CURSOR_TEST][TASK_CREATED] task_id={task_id}",
                system_message=ok_msg,
                status_text=f"Cursor 状态：已排队 {task_id}",
                hint=ok_msg.replace("\n", " | "),
            )

            self._refresh_cursor_bridge_status()

        else:

            fail_msg = f"发送 Cursor 测试任务失败：{result}"

            self._set_cursor_feedback(
                log_line=f"[CURSOR_TEST][TASK_FAILED] reason=enqueue_failed error={result}",
                system_message=fail_msg,
                status_text="Cursor 状态：任务入队失败",
                hint=fail_msg,
            )



    def _on_open_cursor_task_dir_clicked(self):

        """

        打开当前项目下的 .cursor_tasks/inbox 目录。

        """

        project_root = self._get_current_project_root()

        inbox_dir = os.path.join(project_root, ".cursor_tasks", "inbox")



        try:

            os.makedirs(inbox_dir, exist_ok=True)

        except OSError as exc:

            detail = f"{exc}\n{traceback.format_exc()}"

            fail_msg = f"创建任务目录失败：{exc}"

            self._append_log(

                f"[CURSOR_TEST][OPEN_TASK_DIR][FAILED] path={inbox_dir} "

                f"error={detail}",

                echo=True,

            )

            self._add_system_message(fail_msg)

            self._set_cursor_status_hint(fail_msg)

            return



        url = QUrl.fromLocalFile(inbox_dir)

        if not url.isValid():

            fail_msg = f"任务目录路径无效：{inbox_dir}"

            self._append_log(

                f"[CURSOR_TEST][OPEN_TASK_DIR][FAILED] reason=invalid_url "

                f"path={inbox_dir}",

                echo=True,

            )

            self._add_system_message(fail_msg)

            self._set_cursor_status_hint(fail_msg)

            return



        if QDesktopServices.openUrl(url):

            ok_msg = f"已打开任务目录：{inbox_dir}"

            self._append_log(

                f"[CURSOR_TEST][OPEN_TASK_DIR] path={inbox_dir}",

                echo=True,

            )

            self._add_system_message(ok_msg)

            self._set_cursor_status_hint(ok_msg)

            return



        fail_msg = f"无法打开任务目录：{inbox_dir}"

        self._append_log(

            f"[CURSOR_TEST][OPEN_TASK_DIR][FAILED] reason=openUrl_failed "

            f"path={inbox_dir}",

            echo=True,

        )

        self._add_system_message(fail_msg)

        self._set_cursor_status_hint(fail_msg)


