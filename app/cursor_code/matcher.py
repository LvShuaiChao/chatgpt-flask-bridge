"""模板匹配。"""
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import cv2
import numpy as np

from app.cursor_code.capture import capture_mode_label, screenshot_capture
from app.cursor_code.config import CursorCodeConfig, resolve_template_root
from app.cursor_code.templates import load_templates


@dataclass
class CursorMatchResult:
    ok: bool = False
    state: str = ""
    label: str = ""
    kind: str = "unknown"
    template_path: str = ""
    similarity: float = 0.0
    center: Dict[str, int] = field(default_factory=lambda: {"x": 0, "y": 0})
    capture_origin: Dict[str, int] = field(default_factory=lambda: {"x": 0, "y": 0})
    capture_size: Dict[str, int] = field(
        default_factory=lambda: {"width": 0, "height": 0}
    )
    updated_at: str = ""
    # 内部：用于预览高亮
    screen: Optional[np.ndarray] = field(default=None, repr=False)
    loc: Optional[Tuple[int, int]] = field(default=None, repr=False)
    size: Optional[Tuple[int, int]] = field(default=None, repr=False)
    match_scale: float = 1.0

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "state": self.state,
            "label": self.label,
            "kind": self.kind,
            "template_path": self.template_path,
            "similarity": round(self.similarity, 4),
            "center": dict(self.center),
            "capture_origin": dict(self.capture_origin),
            "capture_size": dict(self.capture_size),
            "updated_at": self.updated_at,
        }


def normalize_match_dict(raw: Optional[dict]) -> Optional[CursorMatchResult]:
    if not raw:
        return None
    cx, cy = raw.get("center", (0, 0))
    if isinstance(cx, dict):
        center = {"x": int(cx.get("x", 0)), "y": int(cx.get("y", 0))}
    else:
        center = {"x": int(cx), "y": int(cy)}
    ox, oy = raw.get("capture_origin", (0, 0))
    if isinstance(ox, dict):
        origin = {"x": int(ox.get("x", 0)), "y": int(ox.get("y", 0))}
    else:
        origin = {"x": int(ox), "y": int(oy)}
    cw, ch = raw.get("capture_size", (0, 0))
    if isinstance(cw, dict):
        size = {
            "width": int(cw.get("width", 0)),
            "height": int(cw.get("height", 0)),
        }
    else:
        size = {"width": int(cw), "height": int(ch)}
    return CursorMatchResult(
        ok=True,
        state=str(raw.get("state") or ""),
        label=str(raw.get("label") or ""),
        kind=str(raw.get("kind") or "unknown"),
        template_path=str(raw.get("template_path") or ""),
        similarity=float(raw.get("similarity") or 0.0),
        center=center,
        capture_origin=origin,
        capture_size=size,
        updated_at=raw.get("updated_at")
        or time.strftime("%Y-%m-%d %H:%M:%S"),
        screen=raw.get("screen"),
        loc=raw.get("loc"),
        size=raw.get("size"),
        match_scale=float(raw.get("match_scale") or 1.0),
    )


def match_template_multiscale(screen, template, scales: List[float]):
    th, tw = template.shape[:2]
    sh, sw = screen.shape[:2]
    best_val = -1.0
    best_loc = None
    best_scale = 1.0
    best_size = (tw, th)
    for scale in scales:
        w = max(5, int(tw * scale))
        h = max(5, int(th * scale))
        if w >= sw or h >= sh:
            continue
        resized = cv2.resize(template, (w, h), interpolation=cv2.INTER_AREA)
        result = cv2.matchTemplate(screen, resized, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)
        if max_val > best_val:
            best_val = max_val
            best_loc = max_loc
            best_scale = scale
            best_size = (w, h)
    return best_val, best_loc, best_scale, best_size


def match_best_template(screen, templates, cfg: CursorCodeConfig):
    best = None
    best_val = -1.0
    best_loc = None
    best_scale = 1.0
    best_size = None
    per_template = []
    scales = cfg.match_scales()
    for item in templates:
        max_val, max_loc, scale, size = match_template_multiscale(
            screen, item["image"], scales
        )
        per_template.append((item["path"], item["label"], max_val, scale))
        if max_val > best_val:
            best_val = max_val
            best = item
            best_loc = max_loc
            best_scale = scale
            best_size = size
    return best, best_val, best_loc, best_scale, best_size, per_template


def _match_dict_from_detection(
    best,
    max_val: float,
    max_loc,
    best_scale: float,
    best_size,
    screen,
    origin_x: int,
    origin_y: int,
    cap_w: int,
    cap_h: int,
) -> dict:
    template_w, template_h = best_size
    center_x = origin_x + max_loc[0] + template_w // 2
    center_y = origin_y + max_loc[1] + template_h // 2
    meta = {k: v for k, v in best.items() if k != "image"}
    return {
        **meta,
        "ok": True,
        "center": (center_x, center_y),
        "screen": screen,
        "capture_origin": (origin_x, origin_y),
        "capture_size": (cap_w, cap_h),
        "loc": max_loc,
        "size": (template_w, template_h),
        "match_scale": best_scale,
        "similarity": max_val,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def find_template_on_screen(
    cfg: CursorCodeConfig,
    template_filename: str,
    screen,
    origin_x: int,
    origin_y: int,
    cap_w: int,
    cap_h: int,
    log: Callable[[str], None] = print,
    tag: str = "",
    log_on_miss: bool = True,
    templates: Optional[List[dict]] = None,
):
    prefix = f"[{tag}] " if tag else ""
    root = resolve_template_root(cfg)
    if templates is None:
        templates, errors = load_templates(root, log=log)
        if errors and not templates:
            return None
    item = next(
        (t for t in templates if t["path"] == template_filename),
        None,
    )
    if item is None:
        log(f"{prefix}模板不存在: {template_filename}")
        return None

    max_val, max_loc, best_scale, best_size = match_template_multiscale(
        screen, item["image"], cfg.match_scales()
    )
    name = Path(template_filename).name
    mode = capture_mode_label(cfg)
    if max_val < cfg.match_threshold:
        if log_on_miss:
            log(
                f"{prefix}[CURSOR_CODE][FIND_MISS] {name} "
                f"similarity={max_val:.3f} threshold={cfg.match_threshold} "
                f"mode={mode}"
            )
        return None

    meta = {k: v for k, v in item.items() if k != "image"}
    match = _match_dict_from_detection(
        meta,
        max_val,
        max_loc,
        best_scale,
        best_size,
        screen,
        origin_x,
        origin_y,
        cap_w,
        cap_h,
    )
    cx, cy = match["center"]
    log(
        f"{prefix}[CURSOR_CODE][FIND_OK] {name} "
        f"similarity={max_val:.3f} threshold={cfg.match_threshold} "
        f"center=({cx},{cy}) mode={mode}"
    )
    return match


def find_icon_position(
    cfg: CursorCodeConfig,
    log: Callable[[str], None] = print,
    captured: Optional[tuple] = None,
):
    root = resolve_template_root(cfg)
    templates, errors = load_templates(root, log=log)
    if not templates:
        for err in errors:
            log(err)
        return None

    if captured is None:
        screen, origin_x, origin_y, cap_w, cap_h, screenshot_ms = screenshot_capture(
            cfg
        )
        log(
            f"[CURSOR_CODE][FIND_START] capture {screenshot_ms:.1f}ms "
            f"{capture_mode_label(cfg)}"
        )
    else:
        screen, origin_x, origin_y, cap_w, cap_h, screenshot_ms = captured

    best, max_val, max_loc, best_scale, best_size, per_template = match_best_template(
        screen, templates, cfg
    )
    mode = capture_mode_label(cfg)
    if max_val < cfg.match_threshold:
        log(
            f"[CURSOR_CODE][FIND_MISS] best={max_val:.3f} "
            f"threshold={cfg.match_threshold} mode={mode}"
        )
        for path, label, val, scale in per_template:
            log(f"  {path} ({label}): {val:.3f} @ scale {scale:.2f}")
        return None

    log(
        f"[CURSOR_CODE][FIND_OK] {best['path']} similarity={max_val:.3f} "
        f"kind={best.get('kind')} mode={mode}"
    )
    return _match_dict_from_detection(
        best,
        max_val,
        max_loc,
        best_scale,
        best_size,
        screen,
        origin_x,
        origin_y,
        cap_w,
        cap_h,
    )
