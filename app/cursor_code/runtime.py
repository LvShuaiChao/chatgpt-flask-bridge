"""全局暂停保护器：升级处理期间暂停其他自动任务。"""
import threading
import uuid


def _default_log(msg: str) -> None:
    print(msg)


class CursorAutomationRuntime:
    def __init__(self):
        self._lock = threading.RLock()
        self._pause_tokens: dict[str, str] = {}
        self._last_reason = ""

    def pause_all(self, reason: str, log=_default_log) -> str:
        token = uuid.uuid4().hex
        with self._lock:
            self._pause_tokens[token] = reason
            self._last_reason = reason
        log(f"[CURSOR_CODE][PAUSE_ALL] reason={reason} token={token[:8]}")
        return token

    def resume(self, token: str, log=_default_log) -> None:
        with self._lock:
            removed = self._pause_tokens.pop(token, None)
            if not self._pause_tokens:
                self._last_reason = ""
            elif removed is None:
                log(
                    f"[CURSOR_CODE][RESUME_ALL] unknown token={token[:8]}"
                )
                return
        log(f"[CURSOR_CODE][RESUME_ALL] token={token[:8]}")

    def is_paused(self) -> bool:
        with self._lock:
            return bool(self._pause_tokens)

    def pause_reason(self) -> str:
        with self._lock:
            if self._pause_tokens:
                return self._last_reason or next(iter(self._pause_tokens.values()))
            return ""


_runtime = CursorAutomationRuntime()


def pause_all_for_cursor_upgrade(reason: str = "cursor_upgrade_required") -> str:
    return _runtime.pause_all(reason)


def resume_after_cursor_upgrade(token: str) -> None:
    _runtime.resume(token)


def is_cursor_code_paused() -> bool:
    return _runtime.is_paused()


def get_cursor_code_pause_reason() -> str:
    return _runtime.pause_reason()
