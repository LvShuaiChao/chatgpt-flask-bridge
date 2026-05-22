"""GUI / server 侧统一日志等级与节流。"""

from __future__ import annotations

import re
import time


class LogThrottle:
    """按 key + message 节流日志，避免重复刷屏。"""

    def __init__(self):
        self._records = {}

    def allow(self, key, message="", interval_ms=1000):
        now_ms = time.monotonic() * 1000.0
        key = str(key or "")
        message = str(message or "")
        interval_ms = max(0, int(interval_ms or 0))
        last = self._records.get(key)
        if last is not None:
            last_ms, last_message = last
            if now_ms - last_ms < interval_ms and last_message == message:
                return False
        self._records[key] = (now_ms, message)
        if len(self._records) > 1000:
            oldest_keys = sorted(
                self._records,
                key=lambda item: self._records[item][0],
            )[:200]
            for old_key in oldest_keys:
                self._records.pop(old_key, None)
        return True


LOG_LEVELS = ("TRACE", "DEBUG", "INFO", "WARNING", "ERROR")
_LEVEL_RANK = {name: i for i, name in enumerate(LOG_LEVELS)}
_DEFAULT_MIN_LEVEL = "INFO"

# 普通模式下不在 GUI 显示的高频诊断标签（调试模式可显示）
GUI_NOISY_TAGS = (
    "[HTTP][REQUEST]",
    "[HTTP][RESPONSE]",
    "[TM][HEARTBEAT]",
    "[TM][POLL",
    "[TM][POLL_IDLE]",
    "[TM][FOCUS_STATE]",
    "[TM][CAPABILITY]",
    "[BRIDGE][POLL][REQUEST]",
    "[BRIDGE][POLL][NO_MESSAGE]",
    "[BRIDGE][JSON][TM_TO_SERVER]",
    "[BRIDGE][JSON][SERVER_TO_TM]",
    "[BRIDGE][JSON][TM_TO_SERVER_FULL]",
    "[BRIDGE][JSON][SERVER_TO_TM_FULL]",
    "[BRIDGE][JSON][SERVER_TO_TM_QUEUE_FULL]",
    "[GUI][JSON][SEND_PAYLOAD_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_REPORT_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_RECV_FULL]",
    "[BRIDGE][JSON][ASSISTANT_REPLY_UNKNOWN_FULL]",
    "[BRIDGE][REPORT_UNKNOWN]",
    "[BRIDGE_RUNTIME_PATCH]",
    "[BRIDGE_CLIENT_REPORT]",
    "[TM_PAGE_DEDUPE][MERGE]",
    "[TM_PAGE_DEDUPE][KEEP]",
    "[REPORT_PAYLOAD_IDENTITY_IGNORED]",
    "[TM_PAGE_LIST][FETCH]",
    "[TM_PAGE_LIST][NORMALIZE]",
    "[TM_PAGE_LIST][DEDUPE]",
    "[BIND_STATE]",
    "[STATUS_APPLY]",
    "[PAGE_ACTION][DECIDE]",
    "[PAGE_ACTION][DECISION]",
    "[UPLOAD_CAPABILITY]",
    "[CHAT_AREA_STYLE]",
    "[PAGE_TYPE][CLASSIFY]",
    "[PAGE_CAPABILITY]",
    "[PAGE_ACTION][FALLBACK_POLICY]",
    "[PAGE_ACTION][CANDIDATE]",
    "[SYNC][BOUND_TARGET_CHECK]",
    "[CHAT_HEADER][BOUND_PAGE_ID_MISSING]",
    "[SYNC_UI][BUTTON_STATE]",
    "[PAGE_REGISTRY][REFRESH]",
    "[BIND][IDENTITY_FALLBACK]",
    "[TM_ACTIVITY][CLASSIFY]",
    "[BRIDGE][POLL_SUMMARY]",
    "[STATUS_APPLY][STEP]",
    "[STATUS][SNAPSHOT_ITEM]",
    "[TM_SELECTOR]",
    "[PAGE_SELECTOR]",
    "[PAGE_LIST]",
    "[PAGE_RELATION_DISPLAY]",
    "[PERF][STATUS_APPLY]",
    "[CURRENT_PAGE][RESTORE]",
    "[SYNC_CONVERSATION][TARGET]",
    "[SYNC_CONVERSATION][TARGET_SIMPLE]",
    "[TM_SUMMARY][MISMATCH]",
)

DECISION_LOG_TAGS = (
    "[ACTION_DECISION]",
    "[ACTION_CAPABILITY]",
    "[PAGE_ACTION][DECISION]",
    "[PAGE_ACTION][FALLBACK_POLICY]",
    "[SYNC][DECISION]",
    "[SEND][DECISION]",
    "[UPLOAD_CAPABILITY][DECISION]",
)

# 普通模式隐藏、调试模式可显示的诊断标签
DEBUG_ONLY_GUI_TAGS = (
    "[ACTION_DECISION]",
    "[ACTION_CAPABILITY]",
    "[PAGE_ACTION][DECISION]",
    "[PAGE_ACTION][FALLBACK_POLICY]",
    "[PAGE_ACTION][CANDIDATE]",
    "[SYNC][DECISION]",
    "[SYNC][TARGET_RESOLVE]",
    "[SYNC][TARGET_FINAL]",
    "[SEND][DECISION]",
    "[SEND][TARGET_RESOLVE]",
    "[UPLOAD_CAPABILITY][DECISION]",
    "[PAGE_ACTION][DECIDE]",
    "[PAGE_LIST][DEDUP]",
    "[TM_PAGE_LIST][SUMMARY]",
    "[TM_PAGE_LIST][SUMMARY_THROTTLED]",
    "[PAGE_SELECTOR]",
    "[TM_SELECTOR]",
    "[TM_PAGE_DEDUPE][SUMMARY]",
)

# 普通模式默认可见的结果型日志（含代码中的实际标签别名）
GUI_RESULT_LOG_TAGS = (
    "[PAGE_LIST][REFRESH][DONE]",
    "[PAGE_LIST][SKIP_REBUILD]",
    "[TM_PAGE_LIST][SKIP_REBUILD]",
    "[SYNC][TARGET_SELECTED]",
    "[SYNC][TARGET_BLOCKED]",
    "[SEND][ENQUEUE]",
    "[SEND][PLAN]",
    "[SEND][DISPATCH]",
    "[SEND][ACK]",
    "[SEND][RESULT]",
    "[CHAT_SEND][ENQUEUED]",
    "[SEND][DONE]",
    "[CHAT_SEND][ACK]",
    "[CHAT_SEND][BROWSER_SENT]",
    "[SEND][FAILED]",
    "[BRIDGE][SEND][FAILED]",
)

# 普通模式保留的关键状态/告警（低频、用户可感知）
GUI_CRITICAL_INFO_TAGS = (
    "[SERVER][STARTED]",
    "[SERVER][STOPPED]",
    "[BIND][IDENTITY_MISSING]",
    "[BIND][APPLY]",
    "[BIND][BLOCK]",
    "[SYNC][BLOCK]",
    "[SYNC][COMMAND_SEND]",
    "[SYNC][FAILED]",
    "[SYNC][DONE]",
    "[SEND][BLOCK]",
    "[UPLOAD][DONE]",
    "[UPLOAD][FAILED]",
    "[PAGE_LIST][REFRESH][FAILED]",
    "[PAGE_REGISTRY][REFRESH][FAILED]",
    "[PAGE_ACTION][BOUND_INSTANCE_CHANGED]",
    "[TM_PAGE_ID][ALLOC_FAILED]",
)

_STRUCTURED_LOG_TAG_RE = re.compile(r"\[[A-Z][A-Z0-9_]*(?:\[[A-Z0-9_]+\])*\]")

# 桥接 JSON 在普通模式下仍用 INFO 的关键 action（report 由 event 白名单单独处理）
BRIDGE_JSON_INFO_ACTIONS = frozenset({
    "ack",
    "assistant_reply",
    "send_failed",
    "start_upload",
    "sync_result",
    "upload_result",
})

BRIDGE_JSON_REPORT_INFO_EVENTS = frozenset({
    "assistant_reply",
    "assistant_reply_empty",
    "assistant_reply_failed",
    "send_failed",
    "sync_result",
    "upload_result",
    "conversation_created",
})

BRIDGE_JSON_FOCUS_NOISE_EVENTS = frozenset({
    "focus_state",
    "visibility",
    "visibility_change",
    "focus",
    "window_focus",
    "window_blur",
    "visibilitychange",
    "page_heartbeat",
    "heartbeat",
    "heartbeat_busy",
})

_LEVEL_IN_LINE_RE = re.compile(
    r"\]\[(TRACE|DEBUG|INFO|WARNING|ERROR|CRITICAL)\]\[",
    re.IGNORECASE,
)
_BLOCKED_REASON_RE = re.compile(
    r"reason_code=([^ \t]+)",
    re.IGNORECASE,
)
_KV_FIELD_RE = re.compile(
    r"(?:^|\s)(path|status|action|event)=([^\s]+)",
    re.IGNORECASE,
)


def normalize_level(level) -> str:
    text = str(level or "INFO").strip().upper()
    if text == "CRITICAL":
        return "ERROR"
    if text in _LEVEL_RANK:
        return text
    return "INFO"


def level_rank(level) -> int:
    return _LEVEL_RANK.get(normalize_level(level), _LEVEL_RANK["INFO"])


def should_emit_log(level, *, debug_mode: bool = False, min_level: str = _DEFAULT_MIN_LEVEL) -> bool:
    """默认仅 INFO 及以上；DEBUG/TRACE 需 debug_mode。"""
    norm = normalize_level(level)
    if norm in ("DEBUG", "TRACE") and not debug_mode:
        return False
    effective_min = "TRACE" if debug_mode else min_level
    return level_rank(norm) >= level_rank(effective_min)


def parse_level_from_log_line(line: str) -> str:
    text = str(line or "")
    match = _LEVEL_IN_LINE_RE.search(text)
    if match:
        return normalize_level(match.group(1))
    return infer_level_from_message(text)


def _extract_kv_fields(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for match in _KV_FIELD_RE.finditer(str(text or "")):
        fields[match.group(1).lower()] = (match.group(2) or "").strip()
    return fields


def _message_indicates_poll_noise(text: str) -> bool:
    lower = text.lower()
    if "action=poll" in lower:
        return True
    if '"action":"poll"' in lower or '"action": "poll"' in lower:
        return True
    if "heartbeat_alive" in lower:
        return True
    if "last_seen" in lower and "poll" in lower:
        return True
    return False


def _message_indicates_focus_state_noise(text: str) -> bool:
    lower = text.lower()
    fields = _extract_kv_fields(text)
    if fields.get("action") == "report" and fields.get("event") in BRIDGE_JSON_FOCUS_NOISE_EVENTS:
        return True
    if "event=focus_state" in lower:
        return True
    return False


def _decision_identity_mismatch_warning(text: str) -> bool:
    lower = text.lower()
    warning_tokens = (
        "no_bound_client",
        "no_online_page",
        "identity_mismatch",
        "bound_page_identity_not_found",
        "same_conversation_different_page",
        "target_client_differs",
        "mismatch_type=",
    )
    if any(token in lower for token in warning_tokens):
        return True

    fields = _extract_kv_fields(text)
    pairs = (
        ("bound_client_id", "target_client_id"),
        ("bound_page_instance_id", "target_page_instance_id"),
    )
    for left_key, right_key in pairs:
        left = fields.get(left_key, "")
        right = fields.get(right_key, "")
        if left and right and left != "-" and right != "-" and left != right:
            return True

    bound_conv = fields.get("conversation_id", "")
    target_conv = fields.get("target_conversation_id", "")
    if (
        bound_conv
        and target_conv
        and bound_conv != "-"
        and target_conv != "-"
        and bound_conv != target_conv
    ):
        return True
    return False


def _decision_message_is_warning(text: str) -> bool:
    lower = text.lower()
    if "allowed=false" in lower:
        return True
    if _decision_identity_mismatch_warning(text):
        return True
    match = _BLOCKED_REASON_RE.search(text)
    if match:
        reason = (match.group(1) or "").strip().lower()
        if reason and reason not in ("-", "none", "null", ""):
            return True
    if "reason_code=" in lower and "reason_code=-" not in lower:
        for part in text.split():
            if part.lower().startswith("reason_code="):
                val = part.split("=", 1)[-1].strip()
                if val and val != "-":
                    return True
    if "reason=" in lower:
        for part in text.split():
            if part.lower().startswith("reason="):
                val = part.split("=", 1)[-1].strip().lower()
                if val in ("no_bound_client", "no_online_page", "offline", "not_online"):
                    return True
    return False


def level_for_decision_message(message: str, default: str = "DEBUG") -> str:
    """决策类日志：允许且无阻断原因 -> DEBUG；否则 WARNING。"""
    text = str(message or "")
    if any(tag in text for tag in DECISION_LOG_TAGS):
        if _decision_message_is_warning(text):
            return "WARNING"
        return "DEBUG"
    return normalize_level(default)


def adjust_level_for_message(message: str, level: str) -> str:
    """按消息内容自动降级/升级日志等级。"""
    text = str(message or "")
    norm = normalize_level(level)
    fields = _extract_kv_fields(text)

    if "json_keys=" in text:
        return "DEBUG"
    if "[HTTP][REQUEST]" in text and fields.get("path") == "/api/bridge":
        return "DEBUG"
    if "[HTTP][RESPONSE]" in text:
        if fields.get("path") == "/api/bridge" and fields.get("status") == "200":
            return "DEBUG"
    if "[BRIDGE][JSON][POLL]" in text and "has_message=false" in text.lower():
        return "DEBUG"

    if "[BRIDGE][JSON]" in text:
        if _message_indicates_poll_noise(text) or _message_indicates_focus_state_noise(text):
            return "DEBUG"

    if "[TM][FOCUS_STATE]" in text:
        return "DEBUG"

    if any(tag in text for tag in DECISION_LOG_TAGS):
        return level_for_decision_message(text, default=norm)

    if any(marker in text for marker in (
        "[TM][HEARTBEAT]",
        "[TM][POLL",
        "[TM][POLL_IDLE]",
        "[TM][CAPABILITY]",
        "[BRIDGE][POLL][REQUEST]",
        "[BRIDGE][POLL][NO_MESSAGE]",
        "[BRIDGE_CLIENT_REPORT]",
        "[REPORT_PAYLOAD_IDENTITY_IGNORED]",
        "[TM_PAGE_DEDUPE][MERGE]",
        "[TM_PAGE_LIST]",
        "[STATUS_APPLY]",
        "[STATUS_APPLY][STEP]",
        "[PAGE_ACTION][DECIDE]",
        "[BIND_STATE]",
        "[UPLOAD_CAPABILITY]",
        "[STATUS][SNAPSHOT_ITEM]",
        "[TM_ACTIVITY][CLASSIFY]",
        "[TM_SELECTOR]",
        "[PAGE_SELECTOR]",
        "[PAGE_LIST]",
        "[PAGE_CAPABILITY]",
        "[PAGE_RELATION_DISPLAY]",
        "[PERF][STATUS_APPLY]",
        "[PAGE_TYPE][CLASSIFY]",
        "[ACTION_DECISION]",
        "[ACTION_CAPABILITY]",
        "[PAGE_ACTION][DECISION]",
        "[PAGE_ACTION][FALLBACK_POLICY]",
        "[PAGE_ACTION][CANDIDATE]",
        "[SYNC][DECISION]",
        "[SYNC][TARGET_RESOLVE]",
        "[SYNC][TARGET_FINAL]",
        "[SEND][DECISION]",
        "[SEND][TARGET_RESOLVE]",
        "[CURRENT_PAGE][RESTORE]",
        "[SYNC_CONVERSATION][TARGET]",
        "[TM_SUMMARY][MISMATCH]",
    )):
        return "DEBUG"

    return norm


def _message_has_structured_log_tag(text: str) -> bool:
    return bool(_STRUCTURED_LOG_TAG_RE.search(str(text or "")))


def _gui_log_visible_result_or_critical(text: str) -> bool:
    """默认模式白名单：结果型 + 少量关键状态。"""
    return any(
        tag in text
        for tag in (*GUI_RESULT_LOG_TAGS, *GUI_CRITICAL_INFO_TAGS)
    )


def should_show_gui_log(message: str, level: str = "INFO", *, debug_mode: bool = False) -> bool:
    """是否写入 GUI 日志控件（不影响文件日志策略）。"""
    level_text = normalize_level(level)
    text = str(message or "")

    if level_text in ("ERROR", "WARNING", "CRITICAL"):
        return True

    if _gui_log_visible_result_or_critical(text):
        return True

    if any(tag in text for tag in GUI_NOISY_TAGS):
        return False

    if "page_heartbeat" in text.lower():
        return False

    if not debug_mode and any(tag in text for tag in DEBUG_ONLY_GUI_TAGS):
        return False

    if level_text in ("DEBUG", "TRACE") and not debug_mode:
        return False

    if debug_mode:
        return True

    if _message_indicates_poll_noise(text):
        return False

    if "[BRIDGE][POLL][NO_MESSAGE]" in text:
        for reason in (
            "reason=queue_empty",
            "reason=home_bootstrap_only",
            "reason=client_busy",
            "reason=no_message",
        ):
            if reason in text:
                return False

    if _message_has_structured_log_tag(text):
        return False

    return True


def infer_level_from_message(message: str) -> str:
    text = str(message or "")
    upper = text.upper()
    if "[ERROR]" in upper or "失败" in text or "FAILED" in upper or "EXCEPTION" in upper:
        return "ERROR"
    if "[WARN]" in upper or "[WARNING]" in upper or "警告" in text:
        return "WARNING"
    if "[DEBUG]" in upper or "[TRACE]" in upper or "[PERF]" in upper:
        return "DEBUG"
    if any(
        marker in text
        for marker in (
            "[STATUS_APPLY][STEP]",
            "[TM][HEARTBEAT]",
            "[TM][FOCUS_STATE]",
            "[BRIDGE][POLL][REQUEST]",
            "[BRIDGE][POLL][NO_MESSAGE]",
            "[TM_ACTIVITY][CLASSIFY]",
            "[TM_SELECTOR][ITEM]",
            "[PAGE_RELATION_DISPLAY]",
            "[PERF][STATUS_APPLY]",
            "[TM_PAGE_DEDUPE][KEEP]",
            "[TM_PAGE_DEDUPE][MERGE]",
            "[PAGE_TYPE][CLASSIFY]",
        )
    ):
        return "DEBUG"
    if "[BRIDGE][JSON]" in text and (
        _message_indicates_poll_noise(text) or _message_indicates_focus_state_noise(text)
    ):
        return "DEBUG"
    if any(tag in text for tag in DECISION_LOG_TAGS):
        return level_for_decision_message(text)
    adjusted = adjust_level_for_message(text, "INFO")
    if adjusted != "INFO":
        return adjusted
    return "INFO"


TM_PAGE_LIST_STAGE_KEYS = (
    "fetch",
    "normalize",
    "dedupe",
)


class TmPageListLogAggregator:
    """聚合 TM_PAGE_LIST 高频阶段日志，避免 GUI 文本框被刷屏。"""

    def __init__(self, *, interval_sec: float = 1.0):
        self._interval_sec = max(0.1, float(interval_sec))
        self._window_start = 0.0
        self._counts = {key: 0 for key in TM_PAGE_LIST_STAGE_KEYS}
        self._window_ms = 0.0

    def record(self, stage: str, *, count: int = 1) -> str | None:
        key = str(stage or "").strip().lower()
        if key not in self._counts:
            return None
        now = time.time()
        if self._window_start <= 0:
            self._window_start = now
        self._counts[key] += max(0, int(count))
        elapsed_ms = (now - self._window_start) * 1000.0
        self._window_ms = elapsed_ms
        if elapsed_ms < self._interval_sec * 1000.0:
            return None
        return self.flush()

    def flush(self) -> str | None:
        total = sum(self._counts.values())
        if total <= 0:
            self._reset_window()
            return None
        line = (
            "[TM_PAGE_LIST][SUMMARY_THROTTLED] "
            f"fetch_count={self._counts['fetch']} "
            f"normalize_count={self._counts['normalize']} "
            f"dedupe_count={self._counts['dedupe']} "
            f"duration_ms={int(self._window_ms)}"
        )
        self._reset_window()
        return line

    def _reset_window(self) -> None:
        self._window_start = 0.0
        self._window_ms = 0.0
        for key in TM_PAGE_LIST_STAGE_KEYS:
            self._counts[key] = 0


