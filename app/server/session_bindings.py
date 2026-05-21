"""legacy 服务端绑定清理模块（仅用于旧数据清理，禁止新功能依赖）。

当前主绑定来源：
- GUI 本地会话的 session.remote_chatgpt

本模块只负责：
- 清理 registry 中的 bound_session_id 残留

注意：
- 本模块不再作为绑定写入入口。
- 删除条件：旧 sessions / registry 迁移完成，且连续一个版本无 legacy 绑定清理日志。
"""
from app.server import state as st
from app.utils.page_status import page_url_from


def _server():
    import server as srv
    return srv


def clear_session_binding(session_id, client_id=None):
    """清空客户端 registry 中的会话绑定记录，不关闭 ChatGPT 网页。"""
    srv = _server()
    session_id = (session_id or "").strip()
    client_id = (client_id or "").strip()
    with st._state_lock:
        srv._clear_bound_session_on_registry(session_id, client_id)
    srv._notify_status()


def gc_orphan_session_bindings(valid_session_ids):
    """移除指向已不存在本地会话的客户端绑定。"""
    srv = _server()
    valid = {
        str(item).strip()
        for item in (valid_session_ids or [])
        if str(item).strip()
    }
    removed = []
    with st._state_lock:
        seen_sessions = set()
        for entry in list(st._tampermonkey_pages.values()) + list(
            st._tampermonkey_clients.values()
        ):
            if not isinstance(entry, dict):
                continue
            entry_session_id = (entry.get("bound_session_id") or "").strip()
            if not entry_session_id or entry_session_id in valid:
                continue
            if entry_session_id in seen_sessions:
                entry["bound_session_id"] = ""
                continue
            seen_sessions.add(entry_session_id)
            removed.append(
                {
                    "session_id": entry_session_id,
                    "client_id": (entry.get("client_id") or "").strip(),
                    "conversation_id": (entry.get("conversation_id") or "").strip(),
                    "url": page_url_from(entry),
                }
            )
            entry["bound_session_id"] = ""
    if removed:
        srv._notify_status()
    return removed
