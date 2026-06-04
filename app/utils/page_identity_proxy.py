from __future__ import annotations

from app.utils.page_identity import PageIdentity


class PageIdentityProxyMixin:
    @property
    def client_id(self) -> str:
        return self.identity.client_id

    @property
    def page_instance_id(self) -> str:
        return self.identity.page_instance_id

    @property
    def conversation_id(self) -> str:
        return self.identity.conversation_id

    @property
    def url(self) -> str:
        return self.identity.url
