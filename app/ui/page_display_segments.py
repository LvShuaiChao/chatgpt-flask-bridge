"""页面下拉 / 绑定行分段配色与绘制（供 delegate、label 复用）。"""

from __future__ import annotations

from PyQt5.QtCore import Qt, QRect
from PyQt5.QtGui import QColor, QFont, QFontMetrics, QPainter
from PyQt5.QtWidgets import QStyle, QStyleOptionViewItem


# 页面选择 QComboBox 下拉列表专用配色（深色系，易读）
PAGE_SELECTOR_COLORS = {
    "online": "#047857",
    "unbound": "#92400e",
    "bound": "#065f46",
    "offline": "#374151",
    "stale": "#92400e",
    "page_id": "#111827",
    "url": "#1d4ed8",
    "text": "#111827",
    "muted": "#4b5563",
    "selected_bg": "#bfdbfe",
    "hover_bg": "#e0f2fe",
}

COLOR_PAGE_ID = PAGE_SELECTOR_COLORS["page_id"]
COLOR_URL = PAGE_SELECTOR_COLORS["url"]
COLOR_MUTED = PAGE_SELECTOR_COLORS["muted"]
COLOR_MUTED_SELECTED = PAGE_SELECTOR_COLORS["muted"]
COLOR_ONLINE = PAGE_SELECTOR_COLORS["online"]
COLOR_OFFLINE = PAGE_SELECTOR_COLORS["offline"]
COLOR_STALE = PAGE_SELECTOR_COLORS["stale"]
COLOR_BIND_BOUND = PAGE_SELECTOR_COLORS["bound"]
COLOR_BIND_UNBOUND = PAGE_SELECTOR_COLORS["unbound"]
COLOR_BIND_OTHER = PAGE_SELECTOR_COLORS["unbound"]
COLOR_TEXT_DEFAULT = PAGE_SELECTOR_COLORS["text"]
COLOR_TEXT_SELECTED = PAGE_SELECTOR_COLORS["text"]


def liveness_tag_color(tag: str, *, selected: bool = False) -> QColor:
    text = str(tag or "").strip()
    if text == "在线":
        return QColor(COLOR_ONLINE)
    if text == "过期":
        return QColor(COLOR_STALE)
    return QColor(COLOR_OFFLINE)


def bind_tag_color(tag: str, *, selected: bool = False) -> QColor:
    text = str(tag or "").strip()
    if text in ("同对话", "旧绑定"):
        return QColor(COLOR_BIND_OTHER)
    if "未绑定" in text:
        return QColor(COLOR_BIND_UNBOUND)
    if "已绑定" in text or text.startswith("绑定") or "预绑定" in text:
        return QColor(COLOR_BIND_BOUND)
    return QColor(COLOR_BIND_UNBOUND)


def segment_color(segment: dict, *, selected: bool = False) -> QColor:
    role = str(segment.get("role") or "").strip()
    tag = str(segment.get("tag") or "").strip()
    if role == "liveness":
        return liveness_tag_color(tag, selected=selected)
    if role == "bind":
        return bind_tag_color(tag, selected=selected)
    if role == "page_id":
        return QColor(COLOR_PAGE_ID)
    if role == "url":
        return QColor(COLOR_URL)
    if role in ("separator", "prefix"):
        return QColor(COLOR_MUTED_SELECTED if selected else COLOR_MUTED)
    if selected:
        return QColor(COLOR_TEXT_SELECTED)
    return QColor(COLOR_TEXT_DEFAULT)


def segment_font(base_font: QFont, segment: dict) -> QFont:
    font = QFont(base_font)
    if str(segment.get("role") or "").strip() == "page_id":
        font.setBold(True)
    return font


def _segment_draw_text(segment: dict) -> str:
    return str(segment.get("text") or "")


def measure_segments_width(segments, base_font: QFont) -> int:
    total = 0
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        text = _segment_draw_text(segment)
        if not text:
            continue
        font = segment_font(base_font, segment)
        total += QFontMetrics(font).horizontalAdvance(text)
    return total


def paint_text_segments(
    painter: QPainter,
    rect: QRect,
    base_font: QFont,
    segments,
    *,
    selected: bool = False,
    content_margin: int = 4,
) -> None:
    if not segments:
        return

    painter.save()
    painter.setRenderHint(QPainter.TextAntialiasing, True)

    inner = rect.adjusted(content_margin, 0, -content_margin, 0)
    available = max(0, inner.width())
    x = inner.left()

    pieces = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        text = _segment_draw_text(segment)
        if not text:
            continue
        font = segment_font(base_font, segment)
        metrics = QFontMetrics(font)
        pieces.append(
            {
                "segment": segment,
                "font": font,
                "metrics": metrics,
                "text": text,
                "width": metrics.horizontalAdvance(text),
                "elide": bool(segment.get("elide")),
            }
        )

    if not pieces:
        painter.restore()
        return

    total_width = sum(item["width"] for item in pieces)
    if total_width > available:
        elide_indices = [i for i, item in enumerate(pieces) if item["elide"]]
        if not elide_indices:
            elide_indices = [len(pieces) - 1]
        for idx in reversed(elide_indices):
            fixed_width = sum(
                item["width"] for j, item in enumerate(pieces) if j != idx
            )
            room = max(0, available - fixed_width)
            item = pieces[idx]
            item["text"] = item["metrics"].elidedText(
                item["text"], Qt.ElideRight, room
            )
            item["width"] = item["metrics"].horizontalAdvance(item["text"])
            total_width = sum(p["width"] for p in pieces)
            if total_width <= available:
                break

    fm_base = QFontMetrics(base_font)
    baseline_y = inner.top() + (inner.height() + fm_base.ascent() - fm_base.descent()) // 2

    for item in pieces:
        segment = item["segment"]
        painter.setFont(item["font"])
        painter.setPen(segment_color(segment, selected=selected))
        painter.drawText(x, baseline_y, item["text"])
        x += item["width"]

    painter.restore()


def paint_item_view_segments(
    painter: QPainter,
    option: QStyleOptionViewItem,
    segments,
    *,
    content_margin: int = 4,
) -> None:
    style = option.widget.style() if option.widget is not None else None
    if style is not None:
        style.drawPrimitive(QStyle.PE_PanelItemViewItem, option, painter, option.widget)

    selected = bool(option.state & QStyle.State_Selected)
    enabled = bool(option.state & QStyle.State_Enabled)
    if not enabled:
        painter.save()
        painter.setOpacity(0.45)
        paint_text_segments(
            painter,
            option.rect,
            option.font,
            segments,
            selected=selected,
            content_margin=content_margin,
        )
        painter.restore()
        return

    paint_text_segments(
        painter,
        option.rect,
        option.font,
        segments,
        selected=selected,
        content_margin=content_margin,
    )
