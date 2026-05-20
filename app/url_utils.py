import re

_CONVERSATION_ID_RE = re.compile(
    r"/c/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)


def parse_conversation_id(url):
    match = _CONVERSATION_ID_RE.search(url or "")
    return match.group(1) if match else ""
