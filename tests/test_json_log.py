from app.utils.json_log import dumps_full_json_for_log, sanitize_for_json_log


def test_sanitize_redacts_token_only():
    payload = {
        "message_id": "mid-1",
        "content": "你好",
        "token": "secret-token",
        "nested": {"authorization": "Bearer x", "text": "reply"},
    }
    safe = sanitize_for_json_log(payload)
    assert safe["message_id"] == "mid-1"
    assert safe["content"] == "你好"
    assert safe["token"] == "***REDACTED***"
    assert safe["nested"]["authorization"] == "***REDACTED***"
    assert safe["nested"]["text"] == "reply"


def test_dumps_full_json_preserves_chinese_and_long_content():
    payload = {"content": "你好" * 500, "messages": [{"role": "user", "content": "x"}]}
    text = dumps_full_json_for_log(payload)
    assert "你好" in text
    assert "\\u" not in text
    assert len(text) > 1000
