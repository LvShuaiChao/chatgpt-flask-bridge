"""模板发现与加载。"""
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import cv2
import numpy as np

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif"}

UPGRADE_PRO_FILENAME = "upgrade to Pro.png"
INPUT_BOX_FILENAME = "编辑框的输入框位置.png"
AGENT_BUTTON_FILENAME = "输入框的agent按钮.png"
MIC_EDITBOX_FILENAME = "麦克风_editbox_bottom.png"

TEMPLATE_OVERRIDES: dict = {
    MIC_EDITBOX_FILENAME: {
        "state": "editbox_bottom",
        "label": "麦克风 · 编辑框在底部",
        "kind": "mic",
        "close_interface": True,
    },
    UPGRADE_PRO_FILENAME: {
        "state": "cursor_upgrade_required",
        "label": "Cursor 需要升级 Pro（账号额度已用完）",
        "kind": "upgrade",
    },
    INPUT_BOX_FILENAME: {
        "state": "editbox_input",
        "label": "编辑框 · 输入框位置",
        "kind": "input",
    },
    AGENT_BUTTON_FILENAME: {
        "state": "editbox_agent",
        "label": "输入框 · Agent 按钮",
        "kind": "input",
    },
}


def infer_template_meta(filename: str) -> dict:
    stem = Path(filename).stem
    lower = filename.lower()
    if "upgrade" in lower or "pro" in lower:
        return {
            "state": "cursor_upgrade_required",
            "label": stem,
            "kind": "upgrade",
        }
    if "麦克风" in filename or "mic" in lower:
        state = stem
        if stem.startswith("麦克风_"):
            state = stem[len("麦克风_") :]
        elif stem == "麦克风":
            state = "mic"
        return {
            "state": state,
            "label": stem,
            "kind": "mic",
            "close_interface": True,
        }
    if "输入框" in filename or "input" in lower or "agent" in lower:
        return {
            "state": stem,
            "label": stem,
            "kind": "input",
        }
    return {
        "state": stem,
        "label": stem,
        "kind": "unknown",
    }


def discover_templates(template_root: Path) -> List[dict]:
    """扫描 template_root 下的图片，返回元数据列表（path 为相对文件名）。"""
    root = Path(template_root)
    if not root.is_dir():
        return []
    items: List[dict] = []
    for path in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        meta = infer_template_meta(path.name)
        override = TEMPLATE_OVERRIDES.get(path.name)
        if override:
            meta = {**meta, **override}
        items.append({"path": path.name, **meta})
    return items


def imread_unicode(path, flags=cv2.IMREAD_COLOR):
    file_path = Path(path)
    if not file_path.is_file():
        return None
    data = np.fromfile(file_path, dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, flags)


def load_templates(
    template_root: Path,
    log: Optional[Callable[[str], None]] = None,
) -> Tuple[List[dict], List[str]]:
    """
    加载模板图像。返回 (templates_with_image, errors)。
    无模板或全部读取失败时 templates 为空，errors 含说明。
    """
    _log = log or (lambda _msg: None)
    defs = discover_templates(template_root)
    if not defs:
        msg = f"[CURSOR_CODE][TEMPLATE_LOAD] 模板目录为空或不存在: {template_root}"
        _log(msg)
        return [], [msg]

    templates: List[dict] = []
    errors: List[str] = []
    for item in defs:
        abs_path = template_root / item["path"]
        img = imread_unicode(abs_path)
        if img is None:
            err = f"[CURSOR_CODE][TEMPLATE_LOAD] 无法读取: {abs_path}"
            _log(err)
            errors.append(err)
            continue
        templates.append({**item, "image": img})

    if not templates and not errors:
        err = f"[CURSOR_CODE][TEMPLATE_LOAD] 目录下无可用图片: {template_root}"
        _log(err)
        errors.append(err)
    elif templates:
        _log(
            f"[CURSOR_CODE][TEMPLATE_LOAD] 已加载 {len(templates)} 个模板 "
            f"from {template_root}"
        )
    return templates, errors


def template_abs_path(template_root: Path, rel_path: str) -> Path:
    name = Path(rel_path).name
    return template_root / name
