"""当前会话消息条数 / 字数统计。"""

from app.constants import (
    PERSIST_PENDING_RESET_MESSAGE,
    STARTUP_PENDING_RESET_MESSAGE,
)
from app.models import _message_field, is_waiting_placeholder_message, normalize_remote_chatgpt


class ConversationStatsMixin:
    _EMPTY_CONVERSATION_STATS = {
        "total_count": 0,
        "user_count": 0,
        "assistant_count": 0,
        "failed_count": 0,
        "system_count": 0,
        "unknown_count": 0,
        "user_chars": 0,
        "assistant_chars": 0,
        "failed_chars": 0,
        "system_chars": 0,
        "unknown_chars": 0,
        "total_chars": 0,
    }

    def _count_message_chars(self, text):
        text = str(text or "").strip()
        if not text:
            return 0
        compact_text = (
            text.replace(" ", "")
            .replace("\n", "")
            .replace("\r", "")
            .replace("\t", "")
        )
        return len(compact_text)

    def _conversation_stats_message_text(self, message):
        return (
            _message_field(message, "content")
            or _message_field(message, "text")
            or _message_field(message, "message")
            or _message_field(message, "body")
            or ""
        )

    def _conversation_stats_status_text(self, message):
        return (
            str(_message_field(message, "ui_status") or "").strip().lower()
            or str(_message_field(message, "status") or "").strip().lower()
        )

    def _is_visible_conversation_message(self, message):
        visible = _message_field(message, "visible_in_chat", True)
        return visible is not False

    def _is_failed_conversation_message(self, message):
        role = str(_message_field(message, "role") or "").strip().lower()
        if role == "error":
            return True

        status = self._conversation_stats_status_text(message)
        if status in {"failed", "error", "cancelled"}:
            return True

        content = str(self._conversation_stats_message_text(message) or "").strip()
        if content.startswith("错误："):
            return True
        if content in (STARTUP_PENDING_RESET_MESSAGE, PERSIST_PENDING_RESET_MESSAGE):
            return True

        ui_status_raw = str(_message_field(message, "ui_status") or "").strip()
        if ui_status_raw in ("发送失败", "读取失败", "空回复") or "失败" in ui_status_raw:
            return True

        if role == "assistant" and is_waiting_placeholder_message(message):
            if status == "failed" or ui_status_raw == "failed":
                return True

        return False

    def _base_message_role(self, message):
        if message is None:
            return "unknown"

        if is_waiting_placeholder_message(message):
            return "waiting"

        role = str(_message_field(message, "role") or "").strip().lower()
        sender = str(_message_field(message, "sender") or "").strip().lower()
        msg_type = str(_message_field(message, "type") or "").strip().lower()

        if role in {"user", "me"} or sender in {"user", "me", "我"} or msg_type in {
            "user",
            "me",
        }:
            return "user"

        if role in {"assistant", "ai"} or sender in {
            "assistant",
            "ai",
        } or msg_type in {"assistant", "ai"}:
            return "assistant"

        if role in {"system", "notice"} or msg_type in {"system", "notice", "status"}:
            return "system"

        if role == "error":
            return "error"

        return "unknown"

    def _conversation_stats_messages(self, conversation):
        if conversation is None:
            return []

        if isinstance(conversation, dict):
            messages = conversation.get("messages") or conversation.get("items") or []
        else:
            messages = getattr(conversation, "messages", None) or []

        if not isinstance(messages, list):
            return []

        return [
            message
            for message in messages
            if message is not None and self._is_visible_conversation_message(message)
        ]

    def _calc_conversation_stats(self, conversation):
        stats = dict(self._EMPTY_CONVERSATION_STATS)
        messages = self._conversation_stats_messages(conversation)
        if not messages:
            return stats

        for message in messages:
            base_role = self._base_message_role(message)
            if base_role == "waiting":
                continue

            is_failed = self._is_failed_conversation_message(message)
            text = self._conversation_stats_message_text(message)
            char_count = self._count_message_chars(text)

            stats["total_count"] += 1
            stats["total_chars"] += char_count

            if base_role == "user":
                stats["user_count"] += 1
                stats["user_chars"] += char_count
            elif base_role == "assistant":
                stats["assistant_count"] += 1
                stats["assistant_chars"] += char_count
                if is_failed:
                    stats["failed_count"] += 1
                    stats["failed_chars"] += char_count
            elif base_role == "system":
                stats["system_count"] += 1
                stats["system_chars"] += char_count
            elif is_failed or base_role == "error":
                stats["failed_count"] += 1
                stats["failed_chars"] += char_count
            else:
                stats["unknown_count"] += 1
                stats["unknown_chars"] += char_count

        return stats

    def _format_conversation_stats_text(self, stats):
        stats = stats or self._EMPTY_CONVERSATION_STATS

        parts = [
            f"本地统计：共 {stats['total_count']} 条",
            f"我 {stats['user_count']} 条 {stats['user_chars']} 字",
            f"AI {stats['assistant_count']} 条 {stats['assistant_chars']} 字",
        ]

        if int(stats.get("system_count") or 0) > 0:
            parts.append(
                f"系统 {stats['system_count']} 条 {stats['system_chars']} 字"
            )

        if int(stats.get("failed_count") or 0) > 0:
            parts.append(
                f"失败 {stats['failed_count']} 条 {stats['failed_chars']} 字"
            )

        if int(stats.get("unknown_count") or 0) > 0:
            parts.append(
                f"其他 {stats['unknown_count']} 条 {stats['unknown_chars']} 字"
            )

        parts.append(f"总 {stats['total_chars']} 字")
        return "｜".join(parts)

    def _format_local_stats_summary(self, stats):
        stats = stats or self._EMPTY_CONVERSATION_STATS
        total_count = int(stats.get("total_count") or 0)
        total_chars = int(stats.get("total_chars") or 0)
        return f"本地：{total_count}条 · {total_chars}字"

    def _format_local_stats_tooltip(self, stats):
        stats = stats or self._EMPTY_CONVERSATION_STATS

        total_count = int(stats.get("total_count") or 0)
        total_chars = int(stats.get("total_chars") or 0)
        user_count = int(stats.get("user_count") or 0)
        user_chars = int(stats.get("user_chars") or 0)
        assistant_count = int(stats.get("assistant_count") or 0)
        assistant_chars = int(stats.get("assistant_chars") or 0)
        system_count = int(stats.get("system_count") or 0)
        system_chars = int(stats.get("system_chars") or 0)

        failed_count = int(stats.get("failed_count") or 0)
        failed_chars = int(stats.get("failed_chars") or 0)
        unknown_count = int(stats.get("unknown_count") or 0)
        unknown_chars = int(stats.get("unknown_chars") or 0)

        lines = [
            "本地统计详情：",
            f"总消息：{total_count} 条 / {total_chars} 字",
            f"用户消息：{user_count} 条 / {user_chars} 字",
            f"AI消息：{assistant_count} 条 / {assistant_chars} 字",
            f"系统消息：{system_count} 条 / {system_chars} 字",
        ]

        # 失败/其他通常是调试信息，放 tooltip 里但默认不影响主界面干净度。
        if failed_count > 0:
            lines.append(f"失败消息：{failed_count} 条 / {failed_chars} 字")
        if unknown_count > 0:
            lines.append(f"其他消息：{unknown_count} 条 / {unknown_chars} 字")

        return "\n".join(lines)

    def _format_web_snapshot_stats_tooltip(self, session):
        if session is None:
            return ""

        remote = normalize_remote_chatgpt(getattr(session, "remote_chatgpt", None))
        message_count = int(remote.get("last_web_snapshot_message_count") or 0)
        if message_count <= 0 and not remote.get("last_web_snapshot_stats"):
            return ""

        web_stats = remote.get("last_web_snapshot_stats")
        if isinstance(web_stats, dict) and web_stats:
            user_count = int(web_stats.get("user_count") or remote.get("last_web_snapshot_user_count") or 0)
            assistant_count = int(
                web_stats.get("assistant_count")
                or remote.get("last_web_snapshot_assistant_count")
                or 0
            )
            round_count = int(web_stats.get("round_count") or remote.get("last_web_snapshot_round_count") or 0)
            dom_estimated = int(
                web_stats.get("dom_estimated_round_count")
                or remote.get("last_web_snapshot_dom_estimated_round_count")
                or 0
            )
            total_count = int(web_stats.get("total_count") or message_count)
        else:
            user_count = int(remote.get("last_web_snapshot_user_count") or 0)
            assistant_count = int(remote.get("last_web_snapshot_assistant_count") or 0)
            round_count = int(remote.get("last_web_snapshot_round_count") or 0)
            dom_estimated = int(remote.get("last_web_snapshot_dom_estimated_round_count") or 0)
            total_count = message_count

        page_display_id = str(remote.get("last_web_snapshot_page_display_id") or "").strip()
        page_part = f"页面ID {page_display_id}｜" if page_display_id else ""
        return (
            f"{page_part}网页快照：共 {total_count} 条｜"
            f"我 {user_count} 条｜AI {assistant_count} 条｜"
            f"问答 {round_count} 轮｜页面估轮 {dom_estimated}"
        )

    def _refresh_current_conversation_stats(self, session=None):
        label = getattr(self, "chat_stats_label", None)
        if label is None:
            return

        if session is None and hasattr(self, "_current_session"):
            session = self._current_session()

        try:
            stats = self._calc_conversation_stats(session)
            detailed_text = self._format_conversation_stats_text(stats)
            summary_text = self._format_local_stats_summary(stats)
            local_tooltip = self._format_local_stats_tooltip(stats)

            show_detailed = (
                hasattr(self, "_is_debug_mode_enabled")
                and bool(self._is_debug_mode_enabled())
            )
            text = detailed_text if show_detailed else summary_text

            tooltip = local_tooltip
            web_tooltip = self._format_web_snapshot_stats_tooltip(session)
            if web_tooltip:
                tooltip = f"{tooltip}\n{web_tooltip}"
            label.setText(text)
            label.setToolTip(tooltip)
            label.setVisible(True)
            label.adjustSize()
            label.updateGeometry()

            if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):
                self._append_log(
                    "[CONV_STATS][REFRESH] "
                    f"session_id={getattr(session, 'session_id', '-') if session else '-'} "
                    f"text={text}",
                    echo=False,
                )
        except Exception as exc:
            import traceback

            fallback_stats = self._EMPTY_CONVERSATION_STATS
            fallback_detailed = self._format_conversation_stats_text(fallback_stats)
            fallback_summary = self._format_local_stats_summary(fallback_stats)
            fallback_tooltip = self._format_local_stats_tooltip(fallback_stats)

            show_detailed = (
                hasattr(self, "_is_debug_mode_enabled")
                and bool(self._is_debug_mode_enabled())
            )
            fallback_text = fallback_detailed if show_detailed else fallback_summary

            label.setText(fallback_text)
            label.setToolTip(fallback_tooltip)
            label.setVisible(True)

            if hasattr(self, "_append_log"):
                self._append_log(
                    "[CONV_STATS][REFRESH_FAILED] "
                    f"error={exc} traceback={traceback.format_exc()}",
                    echo=True,
                )
            else:
                print(
                    "[CONV_STATS][REFRESH_FAILED]",
                    exc,
                    traceback.format_exc(),
                    flush=True,
                )
