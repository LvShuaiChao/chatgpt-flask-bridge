"""PyQt 表格单元格创建公共工具。"""
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QTableWidgetItem


def make_table_item(
    text="",
    *,
    editable=False,
    align=Qt.AlignVCenter | Qt.AlignLeft,
    tooltip="",
    foreground=None,
    background=None,
    data_role=None,
    data_value=None,
):
    item = QTableWidgetItem(str(text or ""))

    flags = Qt.ItemIsSelectable | Qt.ItemIsEnabled
    if editable:
        flags |= Qt.ItemIsEditable
    item.setFlags(flags)

    item.setTextAlignment(align)

    if tooltip:
        item.setToolTip(str(tooltip))

    if foreground is not None:
        item.setForeground(QColor(foreground))

    if background is not None:
        item.setBackground(QColor(background))

    if data_role is not None:
        item.setData(data_role, data_value)

    return item


def set_table_item(
    table,
    row,
    col,
    text="",
    *,
    editable=False,
    align=Qt.AlignVCenter | Qt.AlignLeft,
    tooltip="",
    foreground=None,
    background=None,
    data_role=None,
    data_value=None,
):
    item = make_table_item(
        text,
        editable=editable,
        align=align,
        tooltip=tooltip,
        foreground=foreground,
        background=background,
        data_role=data_role,
        data_value=data_value,
    )
    table.setItem(row, col, item)
    return item


def get_review_status_style(status_text):
    text = str(status_text or "").strip()

    if text in ("通过", "成功", "已完成", "正常"):
        return {
            "foreground": "#0a7f28",
            "background": "#eaf7ee",
        }

    if text in ("失败", "异常", "缺失", "错误"):
        return {
            "foreground": "#b00020",
            "background": "#fdecec",
        }

    if text in ("处理中", "等待中", "排队中"):
        return {
            "foreground": "#8a5a00",
            "background": "#fff7e6",
        }

    return {
        "foreground": None,
        "background": None,
    }


def set_status_table_item(table, row, col, status_text, tooltip=""):
    style = get_review_status_style(status_text)

    return set_table_item(
        table,
        row,
        col,
        status_text,
        align=Qt.AlignCenter,
        tooltip=tooltip or status_text,
        foreground=style["foreground"],
        background=style["background"],
    )
