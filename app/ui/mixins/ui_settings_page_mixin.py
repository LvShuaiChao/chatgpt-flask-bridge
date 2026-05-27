"""设置页：当前仅保留滚动容器与占位布局。"""

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QScrollArea,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)


class UiSettingsPageMixin:

    def _create_scroll_tab(self):
        """创建设置子页用的纵向可滚动区域，返回 scroll_area、content_widget、content_layout。"""
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        content_widget = QWidget()
        content_widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Minimum)
        content_layout = QVBoxLayout(content_widget)
        content_layout.setContentsMargins(8, 8, 8, 8)
        content_layout.setSpacing(8)
        scroll_area.setWidget(content_widget)
        return scroll_area, content_widget, content_layout

    def _build_settings_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(8)

        self.settings_scroll, settings_content, self.settings_layout = self._create_scroll_tab()
        self.settings_layout.setContentsMargins(12, 10, 12, 10)
        self.settings_layout.setSpacing(10)

        layout.addWidget(self.settings_scroll, 1)
        return page
