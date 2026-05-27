"""当前会话 messages 统计口径。"""

import time

import pytest

from app.constants import STARTUP_PENDING_RESET_MESSAGE
from app.models import ChatMessage, ChatSession
from app.ui.mixins.conversation_stats_mixin import ConversationStatsMixin


class _Host(ConversationStatsMixin):
    pass


@pytest.fixture
def host():
    return _Host()


def _session_with_messages(messages):
    return ChatSession(
        session_id="s1",
        title="测试",
        created_at=time.time(),
        updated_at=time.time(),
        messages=messages,
    )


def test_empty_session_stats(host):
    stats = host._calc_conversation_stats(None)
    assert stats["total_count"] == 0
    assert stats["total_chars"] == 0
    assert host._format_conversation_stats_text(stats) == (
        "本地统计：共 0 条｜我 0 条 0 字｜AI 0 条 0 字｜总 0 字"
    )


def test_user_and_assistant_chars_exclude_whitespace(host):
    messages = [
        ChatMessage(role="user", content="  hi\n there  "),
        ChatMessage(role="assistant", content="Hello\nWorld"),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    assert stats["total_count"] == 2
    assert stats["user_count"] == 1
    assert stats["assistant_count"] == 1
    assert stats["user_chars"] == len("hithere")
    assert stats["assistant_chars"] == len("HelloWorld")
    assert stats["total_chars"] == stats["user_chars"] + stats["assistant_chars"]


def test_failed_and_system_chars_included_in_total(host):
    messages = [
        ChatMessage(role="user", content="你好"),
        ChatMessage(role="system", content="系统提示内容"),
        ChatMessage(
            role="error",
            content="读取回复失败：超时",
            ui_status="读取失败",
        ),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    assert stats["user_count"] == 1
    assert stats["system_count"] == 1
    assert stats["failed_count"] == 1
    assert stats["total_count"] == 3
    assert stats["total_chars"] == (
        stats["user_chars"]
        + stats["system_chars"]
        + stats["failed_chars"]
    )


def test_assistant_failed_counted_in_both_ai_and_failed(host):
    messages = [
        ChatMessage(role="user", content="问"),
        ChatMessage(
            role="error",
            content="读取回复失败：超时",
            ui_status="读取失败",
        ),
        ChatMessage(
            role="assistant",
            content=STARTUP_PENDING_RESET_MESSAGE,
            ui_status="failed",
        ),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    assert stats["total_count"] == 3
    assert stats["user_count"] == 1
    assert stats["assistant_count"] == 1
    assert stats["failed_count"] == 2
    assistant_chars = host._count_message_chars(STARTUP_PENDING_RESET_MESSAGE)
    error_chars = host._count_message_chars("读取回复失败：超时")
    assert stats["assistant_chars"] == assistant_chars
    assert stats["user_chars"] == 1
    assert stats["failed_chars"] == assistant_chars + error_chars
    assert stats["total_chars"] == stats["user_chars"] + assistant_chars + error_chars


def test_waiting_placeholder_not_counted_as_ai(host):
    from app.constants import ASSISTANT_WAIT_TEXT

    messages = [
        ChatMessage(role="user", content="你好"),
        ChatMessage(
            role="assistant",
            content=ASSISTANT_WAIT_TEXT,
            ui_status="等待中",
            message_source="local_placeholder",
        ),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    assert stats["total_count"] == 1
    assert stats["user_count"] == 1
    assert stats["assistant_count"] == 0
    assert stats["unknown_count"] == 0
    assert stats["total_chars"] == 2


def test_assistant_failed_status_counts_as_ai_and_failed(host):
    messages = [
        ChatMessage(role="user", content="你好"),
        ChatMessage(
            role="assistant",
            content="读取回复失败：超时",
            ui_status="读取失败",
        ),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    assert stats["total_count"] == 2
    assert stats["user_count"] == 1
    assert stats["assistant_count"] == 1
    assert stats["failed_count"] == 1
    assert stats["assistant_chars"] == stats["failed_chars"]
    assert stats["total_chars"] == stats["user_chars"] + stats["assistant_chars"]


def test_format_includes_failed_segment(host):
    messages = [
        ChatMessage(role="user", content="a"),
        ChatMessage(role="error", content="错误：测试"),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    text = host._format_conversation_stats_text(stats)
    assert "失败 1 条" in text
    assert "失败 1 条 5 字" in text
    assert "AI 0 条 0 字" in text


def test_dict_message_roles(host):
    conversation = {
        "messages": [
            {"role": "user", "sender": "me", "content": "abc"},
            {"role": "assistant", "type": "assistant", "content": "xyz"},
        ]
    }
    stats = host._calc_conversation_stats(conversation)
    assert stats["user_count"] == 1
    assert stats["assistant_count"] == 1
    assert stats["user_chars"] == 3
    assert stats["assistant_chars"] == 3


def test_format_local_stats_summary_empty(host):
    stats = host._calc_conversation_stats(None)
    assert host._format_local_stats_summary(stats) == "本地：0条 · 0字"


def test_format_local_stats_summary_system_only(host):
    messages = [
        ChatMessage(role="system", content="系统提示内容"),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    expected_chars = host._count_message_chars("系统提示内容")
    assert host._format_local_stats_summary(stats) == f"本地：1条 · {expected_chars}字"


def test_format_local_stats_tooltip_system_only(host):
    messages = [
        ChatMessage(role="system", content="系统提示内容"),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    expected_chars = host._count_message_chars("系统提示内容")
    tooltip = host._format_local_stats_tooltip(stats)
    assert "本地统计详情：" in tooltip
    assert f"总消息：1 条 / {expected_chars} 字" in tooltip
    assert "用户消息：0 条 / 0 字" in tooltip
    assert "AI消息：0 条 / 0 字" in tooltip
    assert f"系统消息：1 条 / {expected_chars} 字" in tooltip


def test_format_local_stats_tooltip_includes_failed_when_present(host):
    messages = [
        ChatMessage(role="error", content="错误：测试"),
    ]
    stats = host._calc_conversation_stats(_session_with_messages(messages))
    expected_chars = host._count_message_chars("错误：测试")
    tooltip = host._format_local_stats_tooltip(stats)
    assert f"失败消息：1 条 / {expected_chars} 字" in tooltip
