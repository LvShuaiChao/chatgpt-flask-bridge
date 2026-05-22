from app.ui.mixins.bridge_mixin import BridgeMixin


class _Host(BridgeMixin):
    def __init__(self):
        self.lines = []

    def _append_runtime_log_line_to_ui(self, line):
        self.lines.append(line)

    def _is_debug_mode_enabled(self):
        return False


def test_append_log_accepts_level_keyword(monkeypatch):
    captured = {}

    def fake_append_log(message, source="", echo=False, level="INFO"):
        captured.update(
            {
                "message": message,
                "source": source,
                "echo": echo,
                "level": level,
            }
        )
        return f"[00:00:00][{level}][{source}] {message}"

    monkeypatch.setattr(
        "app.ui.mixins.bridge_mixin.append_log",
        fake_append_log,
    )

    host = _Host()
    line = host._append_log("[PAGE_LIST][REFRESH][FAILED] boom", level="ERROR")

    assert captured["level"] == "ERROR"
    assert line.startswith("[00:00:00][ERROR][GUI]")
    assert host.lines == [line]
