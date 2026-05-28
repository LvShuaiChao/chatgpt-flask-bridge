from app.ui.mixins.session_inbound_mixin import SessionInboundMixin
from app.ui.mixins.session_list_mixin import SessionListMixin
from app.ui.mixins.session_pending_mixin import SessionPendingMixin
from app.ui.mixins.session_persistence_mixin import SessionPersistenceMixin
from app.ui.mixins.session_reply_flash_mixin import SessionReplyFlashMixin
from app.ui.mixins.session_runtime_mixin import SessionRuntimeMixin
from app.ui.mixins.session_selection_mixin import SessionSelectionMixin


class SessionMixin(
    SessionRuntimeMixin,
    SessionSelectionMixin,
    SessionListMixin,
    SessionPendingMixin,
    SessionInboundMixin,
    SessionReplyFlashMixin,
    SessionPersistenceMixin,
):
    SESSION_RENDER_TEXT_LIMIT = 12000
    SESSION_LOAD_RECENT_MESSAGES = 24

