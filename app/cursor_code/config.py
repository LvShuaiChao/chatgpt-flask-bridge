"""Cursor代码 配置。"""
from dataclasses import dataclass, fields
from pathlib import Path
from typing import List

REPO_ROOT = Path(__file__).resolve().parents[2]


def resolve_template_root(cfg: "CursorCodeConfig") -> Path:
    p = Path(cfg.template_root)
    return p if p.is_absolute() else REPO_ROOT / p


@dataclass
class CursorCodeConfig:
    template_root: str = "cursor_templates"
    match_threshold: float = 0.80
    scale_min: float = 0.85
    scale_max: float = 1.20
    scale_step: float = 0.05
    use_all_screens: bool = True
    use_window_capture: bool = False
    target_window_hwnd: int = 0
    target_window_title: str = ""
    monitor_index: int = 1
    upgrade_continue_text: str = "继续"
    delay_before_type: float = 0.30
    delay_after_click: float = 0.50
    upgrade_watch_interval_ms: int = 1000
    upgrade_watch_cooldown_sec: float = 8.0
    move_mouse_on_match: bool = False
    # 找图页：持续截图间隔（毫秒），0 表示不自动
    continuous_capture_interval_ms: int = 300

    def match_scales(self) -> List[float]:
        scales: List[float] = []
        s = self.scale_min
        while s <= self.scale_max + 1e-6:
            scales.append(round(s, 2))
            s += self.scale_step
        return scales or [1.0]

    def to_dict(self) -> dict:
        return {f.name: getattr(self, f.name) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict) -> "CursorCodeConfig":
        names = {f.name for f in fields(cls)}
        return cls(**{k: data[k] for k in data if k in names})
