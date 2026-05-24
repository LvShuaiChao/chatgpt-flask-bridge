"""油猴页面下拉框：按字段分段配色的 QStyledItemDelegate。"""

from __future__ import annotations

from app.ui.page_display_segments import paint_item_view_segments
from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QStyledItemDelegate, QStyleOptionViewItem


class TmPageComboDelegate(QStyledItemDelegate):
    """根据 TM_PAGE_DISPLAY_ROLE 中的分段数据绘制每一项（含收起时的当前项）。"""

    def __init__(self, parent=None, *, display_role=Qt.UserRole + 2):
        super().__init__(parent)
        self._display_role = display_role

    def paint(self, painter, option, index):
        segments = index.data(self._display_role)
        if not isinstance(segments, list) or not segments:
            super().paint(painter, option, index)
            return

        opt = QStyleOptionViewItem(option)
        self.initStyleOption(opt, index)
        opt.text = ""
        paint_item_view_segments(painter, opt, segments)

    def sizeHint(self, option, index):
        segments = index.data(self._display_role)
        if not isinstance(segments, list) or not segments:
            return super().sizeHint(option, index)
        base = super().sizeHint(option, index)
        return base
