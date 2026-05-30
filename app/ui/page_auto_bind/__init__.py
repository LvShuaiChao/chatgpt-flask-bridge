"""Auto-bind account/page resolution and diagnostics."""
from __future__ import annotations

from .state import PageAutoBindState
from .account_resolver import resolve_account_for_page
from .page_matcher import match_page_identity
from .diagnostics import diagnose_auto_bind

__all__ = [
    "PageAutoBindState",
    "resolve_account_for_page",
    "match_page_identity",
    "diagnose_auto_bind",
]
