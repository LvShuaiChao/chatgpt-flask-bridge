from app.utils.log_utils import LOG_FILE, append_log, clear_log_file


def test_rotate_log_when_exceeds_limit(tmp_path, monkeypatch):
    log_path = tmp_path / "log.txt"
    monkeypatch.setattr("app.utils.log_utils.LOG_FILE", log_path)
    monkeypatch.setattr("app.utils.log_utils._LOG_MAX_BYTES", 200)
    monkeypatch.setattr("app.utils.log_utils._LOG_MAX_BACKUPS", 3)
    clear_log_file()
    append_log("x" * 300, source="TEST", level="INFO", force=True)
    append_log("y" * 300, source="TEST", level="INFO", force=True)
    assert log_path.exists()
    backups = list((tmp_path / "runtime" / "logs").glob("log.txt.*"))
    assert backups, f"expected rotated backups, size={log_path.stat().st_size}"
