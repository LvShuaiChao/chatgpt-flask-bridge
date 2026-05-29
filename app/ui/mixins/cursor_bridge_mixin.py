from app.server.cursor_api import get_cursor_bridge_status
from app.server import is_server_running

import traceback


class CursorBridgeMixin:
    def _refresh_cursor_bridge_status(self, cursor_status=None):
        if cursor_status is None:
            if not is_server_running():
                self._set_cursor_bridge_status_badge(
                    text="Cursor：未连接",
                    level="neutral",
                    tooltip="服务未启动，无法获取 Cursor Bridge 状态。",
                )
                return

            try:
                status = get_cursor_bridge_status()
            except AttributeError as exc:
                self._append_log(
                    "[CURSOR_STATUS][FAILED] "
                    f"reason=server_missing_get_cursor_bridge_status error={exc}",
                    echo=False,
                )
                self._set_cursor_bridge_status_badge(
                    text="Cursor：接口缺失",
                    level="error",
                    tooltip="py 缺少 get_cursor_bridge_status()",
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
            if (
                hasattr(self, "_is_ui_verbose_status_enabled")
                and not self._is_ui_verbose_status_enabled()
            ):
                text = "Cursor：在线"
            else:
                text = f"Cursor：在线｜待处理 {pending_count}"

            level = "ok"

        elif state == "never_seen":
            age_text = "-"
            text = "Cursor：未连接"
            level = "neutral"

        else:
            age_text = f"{int(age)}秒前" if age is not None else "-"
            if (
                hasattr(self, "_is_ui_verbose_status_enabled")
                and not self._is_ui_verbose_status_enabled()
            ):
                text = "Cursor：未连接"
            else:
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

        self._set_cursor_bridge_status_badge(text, level, tooltip)
        if hasattr(self, "_update_task_queue_card"):
            self._update_task_queue_card()

    def _set_cursor_bridge_status_badge(self, text, level="neutral", tooltip=""):
        label = getattr(self, "cursor_bridge_status_label", None)
        if label is None:
            return

        if (
            hasattr(self, "_is_ui_verbose_status_enabled")
            and not self._is_ui_verbose_status_enabled()
        ):
            text = "Cursor：已连接" if level == "ok" else "Cursor：未连接"
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
