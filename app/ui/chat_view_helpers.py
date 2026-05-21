"""聊天区气泡行布局与滚动等 GUI 共用工具。"""

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtWidgets import QHBoxLayout, QSizePolicy, QWidget


def clear_layout(layout, *, skip_widgets=None):
    """从 layout 移除全部 item（widget / 子 layout / spacer），避免残留 stretch。"""
    if layout is None:
        return

    skip = set(skip_widgets or ())

    while layout.count():
        item = layout.takeAt(0)
        if item is None:
            continue

        widget = item.widget()
        if widget is not None:
            if widget in skip:
                widget.hide()
                widget.setVisible(False)
                continue
            widget.setParent(None)
            widget.deleteLater()
            continue

        child_layout = item.layout()
        if child_layout is not None:
            clear_layout(child_layout, skip_widgets=skip)
            continue

        # spacer / stretch item：takeAt 已移除，无需额外处理


def create_bubble_row_widget(
    bubble,
    role,
    *,
    spacing=0,
    margins=(0, 0, 0, 0),
    parent=None,
):
    row = QWidget(parent)
    row.setObjectName("ChatBubbleRow")
    row.setVisible(False)
    row.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
    row.setMinimumHeight(32)
    row_layout = QHBoxLayout(row)
    row_layout.setContentsMargins(*margins)
    if spacing:
        row_layout.setSpacing(spacing)

    if role == "user":
        row_layout.addStretch(1)
        row_layout.addWidget(bubble, 0, Qt.AlignVCenter)
    elif role in ("system", "error"):
        row_layout.addStretch(1)
        row_layout.addWidget(bubble, 0, Qt.AlignCenter)
        row_layout.addStretch(1)
    else:
        row_layout.addWidget(bubble, 0, Qt.AlignVCenter)
        row_layout.addStretch(1)

    return row


def schedule_scroll_to_last_row(
    scroll_area,
    last_row,
    *,
    enabled=True,
    x_margin=0,
    y_margin=8,
):
    """滚到最后一条气泡，避免 setValue(maximum()) 滚进底部空白区。"""
    if not enabled or scroll_area is None or last_row is None:
        return

    def do_scroll():
        if not last_row.isVisible():
            return
        scroll_area.ensureWidgetVisible(last_row, x_margin, y_margin)

    QTimer.singleShot(0, do_scroll)
    QTimer.singleShot(50, do_scroll)


def schedule_scroll_to_bottom(scroll_area, *, enabled=True, last_row=None):
    if not enabled or scroll_area is None:
        return

    if last_row is not None:
        schedule_scroll_to_last_row(scroll_area, last_row, enabled=True)
        return

    def do_scroll():
        bar = scroll_area.verticalScrollBar()
        if bar is None:
            return
        bar.setValue(bar.maximum())

    QTimer.singleShot(0, do_scroll)
    QTimer.singleShot(50, do_scroll)


def capture_scroll_state(scroll_area, threshold=80):
    if scroll_area is None:
        return {
            "value": 0,
            "maximum": 0,
            "distance_to_bottom": 0,
            "near_bottom": True,
        }

    bar = scroll_area.verticalScrollBar()
    if bar is None:
        return {
            "value": 0,
            "maximum": 0,
            "distance_to_bottom": 0,
            "near_bottom": True,
        }

    value = bar.value()
    maximum = bar.maximum()
    distance = maximum - value

    return {
        "value": value,
        "maximum": maximum,
        "distance_to_bottom": distance,
        "near_bottom": distance <= threshold,
    }


def schedule_restore_scroll_state(
    scroll_area,
    state,
    *,
    force_bottom=False,
    last_row=None,
):
    if scroll_area is None:
        return

    state = state or {}

    def do_restore():
        if (force_bottom or state.get("near_bottom", True)) and last_row is not None:
            if last_row.isVisible():
                scroll_area.ensureWidgetVisible(last_row, 0, 8)
            return

        bar = scroll_area.verticalScrollBar()
        if bar is None:
            return

        if force_bottom or state.get("near_bottom", True):
            bar.setValue(bar.maximum())
            return

        old_value = int(state.get("value") or 0)
        bar.setValue(max(0, min(old_value, bar.maximum())))

    QTimer.singleShot(0, do_restore)


def schedule_scroll_to_bottom_if_needed(
    scroll_area,
    state,
    *,
    enabled=True,
    force_bottom=False,
    last_row=None,
):
    if not enabled or scroll_area is None:
        return

    schedule_restore_scroll_state(
        scroll_area,
        state,
        force_bottom=force_bottom,
        last_row=last_row,
    )
