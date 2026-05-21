"""服务端会话绑定（legacy 全局 bound_client_id；主绑定在 GUI session.remote_chatgpt）。"""
from app.server import state as st
from app.utils.page_status import page_url_from


def _server():
    import server as srv
    return srv


def set_bound_client_id(client_id, session_id=None):
    """@deprecated 当前推荐使用 GUI 的 session.remote_chatgpt 保存每个对话绑定。"""
    srv = _server()
    srv._log(
        "[DEPRECATED] set_bound_client_id called; prefer session.remote_chatgpt binding"
    )
    client_id = (client_id or "").strip()
    session_id = (session_id or "").strip() if session_id is not None else None
    with st._state_lock:
        st.bound_client_id = client_id or None
        if session_id is not None:
            st.bound_session_id = session_id or None
        if client_id:
            srv._set_bound_session_on_registry(client_id, "", session_id or "")
    srv._notify_status()


def clear_session_binding(session_id, client_id=None):
    """清空服务端全局/客户端上的会话绑定记录，不关闭 ChatGPT 网页。"""
    srv = _server()
    session_id = (session_id or "").strip()
    client_id = (client_id or "").strip()
    with st._state_lock:
        if session_id and st.bound_session_id == session_id:
            st.bound_client_id = None
            st.bound_session_id = None
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
        if st.bound_session_id and st.bound_session_id not in valid:
            removed.append(
                {
                    "session_id": st.bound_session_id,
                    "client_id": st.bound_client_id or "",
                    "conversation_id": "",
                    "url": st.tampermonkey_page_url or "",
                }
            )
            st.bound_client_id = None
            st.bound_session_id = None
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
