"""Python page_url_from 与 client.user.js bridgeUrlFrom 均只读 canonical url。"""

import re
from pathlib import Path

from app.utils.page_status import page_url_from as url_from

REPO_ROOT = Path(__file__).resolve().parents[1]
CLIENT_JS = REPO_ROOT / "client.user.js"


def test_url_from_reads_url_only():
    assert url_from({"target_url": "https://evil.example/t"}) == ""
    assert url_from({"url": "https://chatgpt.com/c/x"}) == "https://chatgpt.com/c/x"


def test_client_bridge_url_from_reads_url_only():
    text = CLIENT_JS.read_text(encoding="utf-8")
    start = text.find("function bridgeUrlFrom(obj)")
    assert start >= 0, "bridgeUrlFrom not found in client.user.js"
    end = text.find("function bridgeContentFrom", start)
    body = text[start:end]
    assert "obj.url" in body
    assert "target_url" not in body
    assert "page_url" not in body
    assert "migrateEntryLegacyFields" not in body
