from app.utils.log_utils import (
    append_log,
    clear_log_file,
    set_log_runtime_options,
)


def test_verbose_no_longer_bypasses_noisy_file_suppression(tmp_path, monkeypatch):
    log_path = tmp_path / "log.txt"
    monkeypatch.setattr("app.utils.log_utils.LOG_FILE", log_path)
    clear_log_file()
    set_log_runtime_options(verbose=True, mirror_to_console=False, include_callsite=False)
    line = append_log("[TM][HEARTBEAT] client_id=test", source="TEST", level="DEBUG")
    assert line == ""
    assert log_path.read_text(encoding="utf-8") == ""


def test_default_info_noise_is_downgraded_before_file_write(tmp_path, monkeypatch):
    log_path = tmp_path / "log.txt"
    monkeypatch.setattr("app.utils.log_utils.LOG_FILE", log_path)
    clear_log_file()
    set_log_runtime_options(verbose=False, mirror_to_console=False, include_callsite=False)
    line = append_log("[TM_PAGE_LIST][FETCH] raw_count=15", source="TEST")
    assert line == ""
    assert log_path.read_text(encoding="utf-8") == ""


def test_important_default_info_still_writes(tmp_path, monkeypatch):
    log_path = tmp_path / "log.txt"
    monkeypatch.setattr("app.utils.log_utils.LOG_FILE", log_path)
    clear_log_file()
    set_log_runtime_options(verbose=False, mirror_to_console=False, include_callsite=False)
    line = append_log("[SEND][FAILED] timeout", source="TEST")
    assert line
    text = log_path.read_text(encoding="utf-8")
    assert "[ERROR]" in text
    assert "[SEND][FAILED]" in text
