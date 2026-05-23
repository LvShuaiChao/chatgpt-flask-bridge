"""主界面构建入口：聚合各 UI 子 mixin。"""

from app.ui.mixins.ui_builder_core_mixin import UiBuilderCoreMixin
from app.ui.mixins.ui_chat_panel_mixin import UiChatPanelMixin
from app.ui.mixins.ui_page_selector_mixin import UiPageSelectorMixin
from app.ui.mixins.ui_settings_page_mixin import UiSettingsPageMixin
from app.ui.mixins.tm_page_selector_format_mixin import TmPageSelectorFormatMixin


class UiBuilderMixin(
    UiChatPanelMixin,
    UiPageSelectorMixin,
    UiSettingsPageMixin,
    UiBuilderCoreMixin,
):
    """向后兼容：MainWindow 与测试仍从此处导入 UiBuilderMixin。"""

    TM_PAGE_ITEM_DICT_ROLE = TmPageSelectorFormatMixin.TM_PAGE_ITEM_DICT_ROLE
    TM_PAGE_DISPLAY_ROLE = TmPageSelectorFormatMixin.TM_PAGE_DISPLAY_ROLE
