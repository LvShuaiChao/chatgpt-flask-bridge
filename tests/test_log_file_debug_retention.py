from pathlib import Path

from log_utils import LOG_FILE, append_log, clear_log_file, set_log_min_level


def test_append_log_writes_debug_to_file_when_ui_min_is_info(tmp_path, monkeypatch):
    log_path = tmp_path / "log.txt"
    monkeypatch.setattr("log_utils.LOG_FILE", log_path)
    clear_log_file()
    set_log_min_level("INFO")
    line = append_log(
        "[TM][HEARTBEAT] client_id=test",
        source="TEST",
        level="DEBUG",
        force=True,
    )
    assert line
    text = log_path.read_text(encoding="utf-8")
    assert "[DEBUG]" in text
    assert "[TM][HEARTBEAT]" in text


def test_append_log_skips_trace_in_file(tmp_path, monkeypatch):
    log_path = tmp_path / "log.txt"
    monkeypatch.setattr("log_utils.LOG_FILE", log_path)
    clear_log_file()
    set_log_min_level("INFO")
    line = append_log("trace line", source="TEST", level="TRACE")
    assert line == ""
    assert log_path.read_text(encoding="utf-8") == ""
