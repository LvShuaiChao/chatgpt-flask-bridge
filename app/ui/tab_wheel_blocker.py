"""禁止 QTabBar 上鼠标滚轮切换选项卡，不影响页面内容区滚动。"""
from PyQt5.QtCore import QObject, QEvent, Qt
from PyQt5.QtWidgets import QTabWidget


class TabWheelBlocker(QObject):
    def eventFilter(self, obj, event):
        if event.type() == QEvent.Wheel:
            event.accept()
            return True
        return super().eventFilter(obj, event)


def disable_tab_wheel_switch(tab_widget: QTabWidget):
    """
    禁止鼠标滚轮在 QTabBar 上切换选项卡。
    只拦截 tab 标签栏区域的滚轮，不影响页面内容区域滚动。
    """
    if tab_widget is None:
        return

    tab_bar = tab_widget.tabBar()
    if tab_bar is None:
        return

    if getattr(tab_bar, "_wheel_switch_blocked", False):
        return
    tab_bar._wheel_switch_blocked = True

    tab_bar.setFocusPolicy(Qt.NoFocus)

    blocker = TabWheelBlocker(tab_bar)
    tab_bar.installEventFilter(blocker)

    if not hasattr(tab_widget, "_tab_wheel_blockers"):
        tab_widget._tab_wheel_blockers = []
    tab_widget._tab_wheel_blockers.append(blocker)


def disable_all_tab_wheel_switch(root_widget):
    """
    禁止 root_widget 下所有 QTabWidget 的鼠标滚轮切换。
    """
    if root_widget is None:
        return

    for tab_widget in root_widget.findChildren(QTabWidget):
        disable_tab_wheel_switch(tab_widget)
