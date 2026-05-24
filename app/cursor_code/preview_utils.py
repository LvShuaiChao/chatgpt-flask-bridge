"""预览图绘制与 Qt 转换。"""
from typing import Optional, Tuple

import cv2
import numpy as np
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QImage, QPixmap


def highlight_match(
    screen: np.ndarray,
    top_left: Tuple[int, int],
    w: int,
    h: int,
    found: bool = True,
    label: str = "",
) -> np.ndarray:
    x, y = top_left
    result = screen.copy()
    img_h, img_w = result.shape[:2]
    color = (0, 255, 0) if found else (0, 0, 255)
    text = label or ("MATCH" if found else "BEST")
    thickness = max(3, min(10, int(max(img_w, img_h) / 300)))
    pad = max(8, thickness * 4)
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(img_w - 1, x + w + pad)
    y2 = min(img_h - 1, y + h + pad)
    cv2.rectangle(result, (x1, y1), (x2, y2), color, thickness)
    cx = x + w // 2
    cy = y + h // 2
    cross = max(18, thickness * 8)
    cv2.line(
        result,
        (max(0, cx - cross), cy),
        (min(img_w - 1, cx + cross), cy),
        color,
        thickness,
    )
    cv2.line(
        result,
        (cx, max(0, cy - cross)),
        (cx, min(img_h - 1, cy + cross)),
        color,
        thickness,
    )
    font_px = max(16, int(max(img_w, img_h) / 55))
    text_y = max(30, y1 - 10)
    cv2.putText(
        result,
        text[:40],
        (x1, text_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_px / 32.0,
        color,
        max(1, thickness // 2),
        cv2.LINE_AA,
    )
    return result


def cv2_to_qpixmap(bgr: np.ndarray, max_w: int = 900) -> QPixmap:
    if bgr is None or bgr.size == 0:
        return QPixmap()
    if len(bgr.shape) == 2:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_GRAY2RGB)
    else:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w, ch = rgb.shape
    qimg = QImage(rgb.data, w, h, ch * w, QImage.Format_RGB888).copy()
    pix = QPixmap.fromImage(qimg)
    if w > max_w:
        pix = pix.scaledToWidth(max_w, Qt.SmoothTransformation)
    return pix


def match_preview_image(match: Optional[dict], found: bool = True) -> Optional[np.ndarray]:
    if not match or match.get("screen") is None:
        return None
    screen = match["screen"]
    loc = match.get("loc")
    size = match.get("size")
    if loc is None or size is None:
        return screen.copy()
    tw, th = size
    label = f"{match.get('label', '')} {match.get('similarity', 0):.3f}"
    return highlight_match(screen, loc, tw, th, found=found, label=label)
