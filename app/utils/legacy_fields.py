"""Central registry of legacy field names for reject/cleanup only.

These fields MUST NOT be read as valid fallback sources except via explicit
migration helpers (e.g. ``_normalize_legacy_message_dict``).
"""
from __future__ import annotations

LEGACY_URL_FIELD_NAMES = frozenset({
    "page_url",
    "target_url",
    "target_page_url",
    "conversation_url",
    "tampermonkey_page_url",
    "bound_url",
    "bound_page_url",
    "normalized_url",
    "chatgpt_url",
    "last_page_url",
    "current_url",
    "reopen_target_url",
    "chat_url",
})

# 消息正文/展示旧别名；标准字段见 ChatMessage / _message_to_dict。
LEGACY_MESSAGE_FIELD_NAMES = frozenset({
    "text",
    "message",
    "prompt",
    "raw_content",
    "raw_user_text",
    "final_prompt",
    "assistant_text",
    "reply_text",
    "status",
    "source",
    "visible",
    "request_id",
    "file_path",
    "files",
    "file_list",
    "selected_files",
})

LEGACY_BINDING_FIELD_NAMES = frozenset({
    "raw_user_text",
    "final_prompt",
    "debug_tm_url_syncable",
    "debug_tm_conversation_syncable",
    "target_client_id",
    "target_page_instance_id",
    "target_conversation_id",
    "target_page_key",
    "page_key",
    "pageKey",
    "toolbox_page_key",
    "page_id",
    "window_id",
    "current_page_id",
    "bound_conversation_id",
    "bound_client_id",
    "bound_page_instance_id",
    "chatgpt_conversation_id",
    "pending_send_text",
    "pending_bootstrap_text",
    "responding",
    "activity",
    "active_tab",
    "selectedQuickCategory",
    "toolbox_state_key",
    "launch_token",
})

LEGACY_RUNTIME_FIELD_NAMES = frozenset({
    "toolboxTitle",
    "upload_active_group_id",
    "uploadLastActiveGroupId",
    "has_pending_reply",
    "pending_reply_since",
    "waiting_for_reply",
    "waiting_since_ts",
    "waiting_elapsed_sec",
})

# 全量旧字段表：禁止作为 fallback 读取。
LEGACY_FIELD_NAMES = (
    LEGACY_URL_FIELD_NAMES
    | LEGACY_MESSAGE_FIELD_NAMES
    | LEGACY_BINDING_FIELD_NAMES
    | LEGACY_RUNTIME_FIELD_NAMES
)

# 入站/保存边界拦截子集（不含 message 正文别名，避免误拦 turn_id 等仍在用的键）。
LEGACY_CLEANUP_FIELD_NAMES = LEGACY_URL_FIELD_NAMES | LEGACY_BINDING_FIELD_NAMES

# 深检/出站：在 CLEANUP 基础上再拦消息旧字段（仍不拦 API 层的 id）。
LEGACY_ASSERT_FIELD_NAMES = (
    LEGACY_CLEANUP_FIELD_NAMES
    | frozenset({"id"})
    | frozenset({"status", "source", "visible", "request_id", "text", "message", "prompt"})
)

__all__ = [
    "LEGACY_FIELD_NAMES",
    "LEGACY_URL_FIELD_NAMES",
    "LEGACY_MESSAGE_FIELD_NAMES",
    "LEGACY_BINDING_FIELD_NAMES",
    "LEGACY_RUNTIME_FIELD_NAMES",
    "LEGACY_CLEANUP_FIELD_NAMES",
    "LEGACY_ASSERT_FIELD_NAMES",
]
