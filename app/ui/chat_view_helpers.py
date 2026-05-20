"""聊天区气泡行布局与滚动等 GUI 共用工具。"""

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtWidgets import QHBoxLayout, QSizePolicy, QWidget


def create_bubble_row_widget(bubble, role, *, spacing=0, margins=(0, 0, 0, 0)):
    row = QWidget()
    row.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Maximum)
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


def schedule_scroll_to_bottom(scroll_area, *, enabled=True):
    if not enabled or scroll_area is None:
        return

    def do_scroll():
        bar = scroll_area.verticalScrollBar()
        if bar is None:
            return
        bar.setValue(bar.maximum())

    QTimer.singleShot(0, do_scroll)


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


def schedule_restore_scroll_state(scroll_area, state, *, force_bottom=False):
    if scroll_area is None:
        return

    state = state or {}

    def do_restore():
        bar = scroll_area.verticalScrollBar()
        if bar is None:
            return

        if force_bottom or state.get("near_bottom", True):
            bar.setValue(bar.maximum())
            return

        old_value = int(state.get("value") or 0)
        bar.setValue(max(0, min(old_value, bar.maximum())))

    QTimer.singleShot(0, do_restore)


def schedule_scroll_to_bottom_if_needed(scroll_area, state, *, enabled=True, force_bottom=False):
    if not enabled or scroll_area is None:
        return

    schedule_restore_scroll_state(
        scroll_area,
        state,
        force_bottom=force_bottom,
    )
