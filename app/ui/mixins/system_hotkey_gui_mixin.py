from __future__ import annotations


class SystemHotkeyGuiMixin:
    def _execute_system_hotkey_from_gui_payload(self, payload, *, source: str):
        from app.server.system_hotkey import execute_system_hotkey

        combo = str((payload or {}).get("combo") or "").strip()
        if not combo:
            return {
                "ok": False,
                "error": "快捷键不能为空",
                "code": "INVALID_HOTKEY",
            }

        self._append_log(
            f"[SYSTEM_HOTKEY][EXEC] combo={combo}",
            echo=True,
        )
        result = execute_system_hotkey(combo, source=source)
        if result.get("ok"):
            self._append_log(
                "[SYSTEM_HOTKEY][DONE] "
                f"combo={result.get('hotkey') or combo} "
                f"keys={result.get('keys')}",
                echo=True,
            )
        else:
            self._append_log(
                "[SYSTEM_HOTKEY][FAILED] "
                f"combo={combo} "
                f"code={result.get('code') or '-'} "
                f"error={result.get('error') or '-'}",
                echo=True,
            )
        return result
