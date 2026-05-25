"""页面注册表统一刷新调度与纯渲染（不触发同步决策/命令）。"""

from __future__ import annotations

import time
import traceback

from app.models import normalize_remote_chatgpt, remote_binding_enabled
from app.server import get_bridge_status, is_server_running
from app.utils.page_command import resolve_page_command_target
from app.utils.page_status import (
    PageRegistry,
    binding_from_session,
    pages_from_bridge_status,
)
from app.utils.page_status import (
    is_page_online,
    page_registry_key,
)
from PyQt5.QtCore import QTimer

PAGE_REGISTRY_REFRESH_DEBOUNCE_MS = 300
PAGE_COMMAND_TIMEOUT_SEC = 90


def _empty_page_command_runtime():
    return {
        "running": False,
        "command": "",
        "message_id": "",
        "request_id": "",
        "started_at": 0.0,
        "command_state": "idle",
        "reason": "",
    }


class PageRegistryRefreshMixin:
    """统一页面列表刷新调度；render_* 仅读数据更新 UI。"""

    def _init_page_registry_refresh_state(self):
        self.page_registry = PageRegistry.empty()
        self._page_registry_refresh_in_progress = False
        self._page_registry_refresh_pending = False
        self._page_registry_refresh_reason = "auto"
        self._page_registry_refresh_signature = ""
        self._page_registry_refresh_timer = None
        self.page_command_runtime = _empty_page_command_runtime()
        if not hasattr(self, "_page_command_timeout_timer"):
            self._page_command_timeout_timer = None

    def _make_single_shot_timer(self):
        try:
            return QTimer(self)
        except TypeError as error:
            self.safe_log(
                "[PAGE_REGISTRY][TIMER][PARENT_FALLBACK] "
                f"reason=qtimer_parent_rejected "
                f"self_type={type(self).__name__} "
                f"error_type={type(error).__name__} error={error}",
                echo=True,
                level="WARNING",
            )
            return QTimer()

    def _ensure_page_registry_refresh_timer(self):
        timer = getattr(self, "_page_registry_refresh_timer", None)
        if timer is not None:
            return timer
        timer = self._make_single_shot_timer()
        timer.setSingleShot(True)
        timer.timeout.connect(self._flush_page_registry_refresh)
        self._page_registry_refresh_timer = timer
        return timer

    def schedule_page_registry_refresh(self, reason="auto", *, status=None, force=False):
        """300ms debounce；刷新中则 pending，结束后补刷一次。"""
        if not hasattr(self, "_init_page_registry_refresh_state"):
            self._init_page_registry_refresh_state()
        self._page_registry_refresh_reason = str(reason or "auto").strip() or "auto"
        if status is not None:
            self._page_registry_refresh_status = status
        if force:
            self._page_registry_refresh_force = True
        if getattr(self, "_page_registry_refresh_in_progress", False):
            self._page_registry_refresh_pending = True
            return
        timer = self._ensure_page_registry_refresh_timer()
        if not timer.isActive():
            timer.start(PAGE_REGISTRY_REFRESH_DEBOUNCE_MS)

    def _flush_page_registry_refresh(self):
        reason = getattr(self, "_page_registry_refresh_reason", "auto") or "auto"
        if getattr(self, "_page_registry_refresh_in_progress", False):
            self._page_registry_refresh_pending = True
            return
        status = getattr(self, "_page_registry_refresh_status", None)
        self._page_registry_refresh_status = None
        force = bool(getattr(self, "_page_registry_refresh_force", False))
        self._page_registry_refresh_force = False
        self._do_page_registry_refresh(reason=reason, status=status, force=force)

    def refresh_page_registry(
        self, reason="manual", *, status=None, skip_combo_rebuild=False, force=False
    ):
        """统一刷新：拉 status → PageRegistry → 渲染 UI（不触发同步）。"""
        if getattr(self, "_page_registry_refresh_in_progress", False):
            self._page_registry_refresh_pending = True
            return
        self._page_registry_refresh_in_progress = True
        self._set_page_list_refresh_busy(True)
        reason_text = str(reason or "manual").strip() or "manual"
        self.safe_log(
            f"[PAGE_REGISTRY][REFRESH][START] reason={reason_text}",
            echo=True,
        )
        try:
            if status is None:
                status = {}
                if is_server_running():
                    status = get_bridge_status() or {}
                else:
                    self._set_tm_action_hint("请先启动服务。")
            self._bridge_ui.last_bridge_status = status
            self.page_registry = PageRegistry.from_bridge_status(status)
            if hasattr(self, "_upgrade_temp_home_sessions_from_registry"):
                self._upgrade_temp_home_sessions_from_registry(self.page_registry)
            snapshot = None
            if hasattr(self, "_get_tm_page_snapshot"):
                snapshot = self._get_tm_page_snapshot(status, log_stages=False)
            raw_pages = [
                snap._raw
                for snap in self.page_registry.pages
                if getattr(snap, "_raw", None)
            ] or pages_from_bridge_status(status)
            combo_skip = skip_combo_rebuild and not force
            self.render_page_combo(
                self.page_registry,
                reason=reason,
                skip_rebuild=combo_skip,
                force=force,
                snapshot=snapshot,
            )
            self.render_status_chips(self.page_registry, reason=reason)
            self.render_binding_panel(self.page_registry, reason=reason)
            self.render_sync_send_state()
            summary = self.page_registry.summary()
            total_pages = int(summary.get("total_count") or 0)
            online_pages = int(summary.get("online_count") or 0)
            raw_page_count = len(raw_pages)
            bridge_url = (status.get("bridge_url") or "").strip()
            server_running = status.get("server_running")
            if server_running is None:
                server_running = is_server_running()
            if is_server_running():
                if reason_text == "manual_button" and total_pages == 0:
                    self._set_tm_action_hint(
                        "未检测到 ChatGPT 油猴页面。请打开 ChatGPT 页面，"
                        "确认油猴脚本已启用，然后再点击刷新页面列表。"
                    )
                else:
                    self._set_tm_action_hint(
                        f"已刷新，共 {total_pages} 个页面。"
                    )
            self._page_registry_refresh_signature = self._page_registry_signature(
                raw_pages
            )
            self.safe_log(
                "[PAGE_REGISTRY][REFRESH][DONE]\n"
                f"reason={reason_text}\n"
                f"total_pages={total_pages}\n"
                f"online_pages={online_pages}\n"
                f"raw_pages={raw_page_count}\n"
                f"server_running={server_running}\n"
                f"bridge_url={bridge_url or '-'}",
                echo=True,
            )
            if total_pages == 0 and reason_text == "manual_button":
                self.safe_log(
                    "[PAGE_REGISTRY][REFRESH][EMPTY_AFTER_MANUAL]\n"
                    f"reason={reason_text}\n"
                    "hint=服务端没有检测到任何油猴页面，请确认 ChatGPT 页面已打开、"
                    "油猴脚本已启用、脚本正在请求 /api/bridge",
                    echo=True,
                )
        except Exception as exc:
            self.safe_log(
                "[PAGE_REGISTRY][REFRESH][FAILED] "
                f"reason={reason_text} "
                f"error_type={type(exc).__name__} "
                f"error={exc} "
                f"traceback={traceback.format_exc()}",
                echo=True,
                level="ERROR",
            )
            self._set_tm_action_hint(f"刷新页面列表失败：{exc}")
        finally:
            self._page_registry_refresh_in_progress = False
            self._set_page_list_refresh_busy(False)
            if getattr(self, "_page_registry_refresh_pending", False):
                self._page_registry_refresh_pending = False
                self.schedule_page_registry_refresh(
                    reason=getattr(self, "_page_registry_refresh_reason", "pending")
                )

    def _do_page_registry_refresh(
        self, reason="auto", *, status=None, skip_combo_rebuild=False, force=False
    ):
        self.refresh_page_registry(
            reason,
            status=status,
            skip_combo_rebuild=skip_combo_rebuild,
            force=force,
        )

    def _build_page_registry_from_status(self, status=None, snapshot=None):
        status = status or (getattr(self._bridge_ui, "last_bridge_status", None) or {})
        if snapshot is not None:
            return list(snapshot.page_dicts)
        if hasattr(self, "_get_tm_page_snapshot"):
            return list(self._get_tm_page_snapshot(status, log_stages=False).page_dicts)
        if hasattr(self, "_extract_tm_pages_from_status"):
            return list(
                self._extract_tm_pages_from_status(status, log_stages=False) or []
            )
        return pages_from_bridge_status(status)

    def _page_registry_signature(self, pages=None):
        session = self._current_session() if hasattr(self, "_current_session") else None
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        bound_key = "|".join(
            [
                (remote.get("client_id") or "").strip(),
                (remote.get("page_instance_id") or "").strip(),
                (remote.get("conversation_id") or "").strip(),
            ]
        )
        rows = []
        for page in pages or []:
            if not isinstance(page, dict):
                continue
            key = page_registry_key(page)
            online = (
                self._tm_page_is_online_simple(page)
                if hasattr(self, "_tm_page_is_online_simple")
                else is_page_online(page)
            )
            rows.append(
                "|".join(
                    [
                        key,
                        "1" if online else "0",
                        (page.get("page_type") or "").strip(),
                        (page.get("conversation_id") or "").strip(),
                    ]
                )
            )
        return f"{bound_key}#{len(rows)}#{'/'.join(sorted(rows))}"

    def should_schedule_page_registry_refresh(
        self, status=None, *, reason="auto", snapshot=None
    ):
        """仅在页面数量/在线态/绑定页状态变化时调度刷新。"""
        pages = self._build_page_registry_from_status(status, snapshot=snapshot)
        sig = self._page_registry_signature(pages)
        old = getattr(self, "_page_registry_refresh_signature", "")
        if sig != old:
            self.schedule_page_registry_refresh(reason=reason)
            return True
        return False

    def render_status_chips(self, registry=None, reason="render"):
        del reason
        reg = registry
        if not isinstance(reg, PageRegistry):
            reg = getattr(self, "page_registry", None)
        if not isinstance(reg, PageRegistry):
            reg = PageRegistry.empty()
        status = (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        summary = {}
        if hasattr(self, "_tm_summary_for_session"):
            summary = dict(self._tm_summary_for_session() or {})
        reg_summary = reg.summary()
        summary["online_clients"] = reg_summary.get("online_count", 0)
        summary["total_clients"] = reg_summary.get("total_count", 0)
        if hasattr(self, "tm_online_label"):
            if hasattr(self, "_is_ui_verbose_status_enabled") and self._is_ui_verbose_status_enabled():
                if hasattr(self, "_format_tm_online_chip_text"):
                    text, chip = self._format_tm_online_chip_text(summary)
                else:
                    text, chip = f"在线 {summary['online_clients']}", "ok"
            elif hasattr(self, "_format_compact_tm_online_chip"):
                text, chip = self._format_compact_tm_online_chip(summary)
            else:
                text, chip = f"在线 {summary['online_clients']}", "ok"
            self.tm_online_label.setText(text)
            if hasattr(self, "_refresh_status_chip"):
                self._refresh_status_chip(self.tm_online_label, chip or "")
        if hasattr(self, "update_monkey_binding_summary"):
            monkey_stats = {}
            if hasattr(self, "_collect_monkey_window_binding_stats"):
                monkey_stats = self._collect_monkey_window_binding_stats(status)
            self.update_monkey_binding_summary(status, monkey_stats=monkey_stats)

    def render_page_combo(
        self,
        registry=None,
        reason="render",
        *,
        skip_rebuild=False,
        force=False,
        snapshot=None,
    ):
        del reason
        status = getattr(self._bridge_ui, "last_bridge_status", None) or {}
        rebuild = force or not skip_rebuild
        if snapshot is None and hasattr(self, "_get_tm_page_snapshot"):
            snapshot = self._get_tm_page_snapshot(status, log_stages=False)
        if hasattr(self, "_refresh_tm_page_selector"):
            self._refresh_tm_page_selector(
                status, force_rebuild=rebuild, snapshot=snapshot
            )
        if hasattr(self, "_sync_tm_page_list_empty_ui"):
            self._sync_tm_page_list_empty_ui()

    def render_binding_panel(self, registry=None, reason="render"):
        del reason
        if hasattr(self, "_update_bound_page_display_light"):
            self._update_bound_page_display_light(registry=registry)
        elif hasattr(self, "_update_bound_page_display"):
            self._update_bound_page_display()
        self.render_sync_send_state()

    def render_sync_send_state(self):
        self._render_sync_target_display_light()
        self.render_command_buttons(reason="sync_send_state")

    def render_command_buttons(self, reason="render"):
        del reason
        runtime = (
            getattr(self, "page_command_runtime", None)
            or _empty_page_command_runtime()
        )
        running = bool(runtime.get("running"))
        command = (runtime.get("command") or "").strip()
        btn = getattr(self, "sync_web_conversation_btn", None)
        if btn is not None:
            if running and command == "sync_conversation":
                btn.setEnabled(False)
                btn.setText("同步中...")
            else:
                btn.setEnabled(True)
                btn.setText("同步网页对话")

    def get_bound_page_snapshot(self, session=None, registry=None):
        """仅判断绑定页能力；使用 PageRegistry + resolve_page_command_target。"""
        session = session or (
            self._current_session() if hasattr(self, "_current_session") else None
        )
        if session is None:
            return {
                "found": False,
                "online": False,
                "conversation_syncable": False,
                "send_decision": "blocked",
                "page": None,
                "reason_code": "no_session",
            }
        binding = binding_from_session(session) or {}
        from app.models import BIND_STATE_UNBOUND

        if (binding.get("bind_state") or BIND_STATE_UNBOUND) == BIND_STATE_UNBOUND:
            return {
                "found": False,
                "online": False,
                "conversation_syncable": False,
                "send_decision": "blocked",
                "page": None,
                "reason_code": "not_bound",
            }
        reg = registry
        if not isinstance(reg, PageRegistry):
            reg = getattr(self, "page_registry", None)
        if not isinstance(reg, PageRegistry):
            reg = PageRegistry.empty()
        from app.utils.page_command import resolve_bound_page_in_registry

        resolved = resolve_bound_page_in_registry(reg, binding, allow_same_conversation=False)
        snap = resolved.get("page")
        url = binding.get("url") or ""
        if snap is None:
            reason_code = (resolved.get("reason_code") or "bound_page_offline").strip()
            return {
                "found": remote_binding_enabled(
                    getattr(session, "remote_chatgpt", None) or {}
                ),
                "online": False,
                "conversation_syncable": False,
                "send_decision": "blocked",
                "page": None,
                "reason_code": reason_code,
                "client_id": binding.get("client_id") or "",
                "page_instance_id": binding.get("page_instance_id") or "",
                "conversation_id": binding.get("conversation_id") or "",
                "url": url,
            }
        sync_target = resolve_page_command_target(
            session, "sync_conversation", reg
        )
        send_target = resolve_page_command_target(session, "send_message", reg)
        page_dict = snap.to_dict()
        raw = snap._raw if isinstance(snap._raw, dict) else {}
        online = is_page_online(raw) if raw else snap.online
        page_display_id = (snap.page_display_id or "").strip()
        if not page_display_id and raw:
            page_display_id = str(
                raw.get("page_display_id") or raw.get("page_no") or ""
            ).strip()
        return {
            "found": True,
            "online": online,
            "conversation_syncable": bool(
                snap.conversation_syncable
            ),
            "sync_ok": bool(sync_target.get("ok")),
            "send_decision": "allowed" if send_target.get("ok") else "blocked",
            "page": page_dict,
            "page_snapshot": snap,
            "reason_code": sync_target.get("reason_code") or "",
            "client_id": snap.client_id,
            "page_instance_id": snap.page_instance_id,
            "conversation_id": snap.conversation_id,
            "url": snap.url or url,
            "page_no": page_display_id,
            "page_display_id": page_display_id,
        }

    def _render_sync_target_display_light(self):
        """轻量同步目标展示：不调用 resolve_sync_decision / resolve_page_action。"""
        if not hasattr(self, "tm_sync_target_label"):
            return
        runtime = (
            getattr(self, "page_command_runtime", None)
            or _empty_page_command_runtime()
        )
        if runtime.get("running") and (runtime.get("command") or "") == "sync_conversation":
            self.tm_sync_target_label.setText("同步：进行中")
            if hasattr(self, "_refresh_status_chip"):
                self._refresh_status_chip(self.tm_sync_target_label, "info")
            return
        session = self._current_session() if hasattr(self, "_current_session") else None
        snap = self.get_bound_page_snapshot(session=session)
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        from app.models import derive_bind_mode

        bind_mode = derive_bind_mode(remote)
        conversation_id = (snap.get("conversation_id") or "").strip()
        if not conversation_id and remote_binding_enabled(remote):
            conversation_id = (remote.get("conversation_id") or "").strip()

        if bind_mode in ("page_channel", "home_pending") or (
            remote_binding_enabled(remote) and not conversation_id
        ):
            if snap.get("online"):
                sync_text, chip = "同步：等待生成对话ID", "warn"
            elif snap.get("found"):
                sync_text, chip = "同步：页面离线", "warn"
            else:
                sync_text, chip = "同步：未绑定", "warn"
        elif snap.get("sync_ok"):
            if conversation_id:
                sync_text, chip = f"同步：conversation_id: {conversation_id[:12]}...", "ok"
            else:
                sync_text, chip = "同步：可同步", "ok"
        elif snap.get("found") and not snap.get("online"):
            sync_text, chip = "同步：页面离线", "warn"
        elif snap.get("found"):
            sync_text, chip = "同步：不可同步", "error"
        else:
            if remote_binding_enabled(remote):
                sync_text, chip = "同步：页面离线", "warn"
            else:
                sync_text, chip = "同步：未绑定", "warn"
        self.tm_sync_target_label.setText(sync_text)
        if hasattr(self, "_refresh_status_chip"):
            self._refresh_status_chip(self.tm_sync_target_label, chip)
        if hasattr(self, "_format_compact_sync_target_tooltip"):
            send_decision = (snap.get("send_decision") or "").strip()
            tip_target = {
                "conversation_syncable": snap.get("conversation_syncable"),
                "send_now_available": send_decision == "allowed",
                "send_requestable": send_decision in ("allowed", "queued"),
            }
            self.tm_sync_target_label.setToolTip(
                self._format_compact_sync_target_tooltip(tip_target, {}, status=None)
            )
        send_label = getattr(self, "tm_send_label", None)
        if send_label is not None:
            send_decision = (snap.get("send_decision") or "").strip()
            if send_decision == "allowed":
                send_text, send_chip = "发送：可发送", "ok"
            elif send_decision == "queued":
                send_text, send_chip = "发送：可排队", "warn"
            elif snap.get("found") and snap.get("online"):
                send_text, send_chip = "发送：等待", "warn"
            else:
                send_text, send_chip = "发送：不可发送", "error"
            send_label.setText(send_text)
            if hasattr(self, "_refresh_status_chip"):
                self._refresh_status_chip(send_label, send_chip)

    def _update_bound_page_display_light(self, registry=None):
        """绑定面板轻量渲染，不触发 resolve_page_action。"""
        if not hasattr(self, "tm_bound_page_label"):
            return
        session = self._current_session() if hasattr(self, "_current_session") else None
        status = (getattr(self._bridge_ui, 'last_bridge_status', None) or {})
        snap = self.get_bound_page_snapshot(session=session, registry=registry)
        page = snap.get("page")
        if hasattr(self, "_format_compact_page_chip"):
            chip_text, chip_state, chip_tip = self._format_compact_page_chip(
                page, session=session, status=status
            )
            self.tm_bound_page_label.setText(chip_text)
            if hasattr(self, "_refresh_status_chip"):
                self._refresh_status_chip(self.tm_bound_page_label, chip_state or "")
            from app.constants import STATUS_DETAIL_TECH_HINT

            tip_parts = [chip_tip or chip_text]
            page_no = str(snap.get("page_no") or "").strip()
            if page_no:
                tip_parts.append(f"页面 ID：{page_no}")
            self.tm_bound_page_label.setToolTip(
                "\n".join(p for p in tip_parts if p) + "\n" + STATUS_DETAIL_TECH_HINT
            )
        remote = normalize_remote_chatgpt(
            session.remote_chatgpt if session else None
        )
        can_open = bool(
            remote_binding_enabled(remote) and (snap.get("url") or snap.get("conversation_id"))
        )
        if hasattr(self, "_set_chat_open_bound_enabled"):
            self._set_chat_open_bound_enabled(can_open)

    # --- page_command_runtime（sync / send / upload 统一）---

    def is_page_command_active(self, command=None):
        rt = getattr(self, "page_command_runtime", None) or _empty_page_command_runtime()
        if not rt.get("running"):
            return False
        if command:
            return (rt.get("command") or "").strip() == (command or "").strip()
        return True

    def clear_page_command_runtime(self, reason=""):
        rt = getattr(self, "page_command_runtime", None) or {}
        was_running = bool(rt.get("running"))
        cmd = (rt.get("command") or "").strip()
        cleared = _empty_page_command_runtime()
        if reason:
            cleared["reason"] = str(reason)
        self.page_command_runtime = cleared
        self._stop_page_command_timeout_timer()
        if cmd == "sync_conversation":
            if hasattr(self, "_page_cmd"):
                self._page_cmd.sync_conversation_running = False
            if hasattr(self, "_web_sync"):
                self._web_sync.running = False
                self._web_sync.request_id = ""
                self._web_sync.started_at = 0.0
                self._web_sync.timeout_timer_request_id = ""
        self.render_sync_send_state()
        if was_running:
            tag = "[PAGE_COMMAND][CLEAR]"
            if reason == "done":
                tag = "[PAGE_COMMAND][DONE]"
            elif reason == "timeout":
                tag = "[PAGE_COMMAND][TIMEOUT]"
            elif reason in ("enqueue_failed", "failed", "finish"):
                tag = "[PAGE_COMMAND][FAILED]" if reason != "finish" else "[PAGE_COMMAND][DONE]"
            self.safe_log(
                f"{tag} command={cmd or '-'} reason={reason or '-'}",
                echo=True,
            )

    def _stop_page_command_timeout_timer(self):
        timer = getattr(self, "_page_command_timeout_timer", None)
        if timer is not None:
            try:
                timer.stop()
            except Exception as error:
                self.safe_log(
                    f"[PAGE_COMMAND][TIMER][STOP_FAILED] error={error}",
                    echo=True,
                    level="WARNING",
                )

    def _sync_page_command_side_effects_on_start(self, runtime):
        if (runtime.get("command") or "") != "sync_conversation":
            return
        if hasattr(self, "_page_cmd"):
            self._page_cmd.sync_conversation_running = True
        if hasattr(self, "_web_sync"):
            self._web_sync.running = True
            self._web_sync.request_id = (runtime.get("request_id") or "").strip()
            self._web_sync.started_at = float(runtime.get("started_at") or 0.0)

    def start_page_command(self, command, payload=None):
        command = (command or "").strip()
        payload = payload if isinstance(payload, dict) else {}
        message_id = (payload.get("message_id") or "").strip()
        request_id = (payload.get("request_id") or message_id or "").strip()
        runtime = _empty_page_command_runtime()
        runtime.update(
            {
                "running": True,
                "command": command,
                "message_id": message_id,
                "request_id": request_id,
                "started_at": time.time(),
                "command_state": "running",
                "reason": (payload.get("reason") or "").strip(),
            }
        )
        self.page_command_runtime = runtime
        self._sync_page_command_side_effects_on_start(runtime)
        correlation = request_id or message_id
        self._schedule_page_command_timeout(correlation)
        self.render_sync_send_state()
        self.safe_log(
            "[PAGE_COMMAND][START] "
            f"command={command} request_id={request_id or '-'} "
            f"message_id={message_id or '-'}",
            echo=True,
        )
        return runtime

    def _page_command_correlation_matches(self, runtime, correlation_id):
        mid = (correlation_id or "").strip()
        if not mid:
            return True
        rid = (runtime.get("request_id") or "").strip()
        msg = (runtime.get("message_id") or "").strip()
        if rid and mid == rid:
            return True
        if msg and mid == msg:
            return True
        if rid or msg:
            return False
        return True

    def finish_page_command(self, message_id="", result=None):
        del result
        runtime = getattr(self, "page_command_runtime", None) or {}
        if not self._page_command_correlation_matches(runtime, message_id):
            return
        self.clear_page_command_runtime("done")
        self.render_sync_send_state()
        if hasattr(self, "schedule_page_registry_refresh"):
            self.schedule_page_registry_refresh(reason="command_finish")

    def fail_page_command(self, message_id, reason):
        runtime = getattr(self, "page_command_runtime", None) or {}
        if not self._page_command_correlation_matches(runtime, message_id):
            return
        self.safe_log(
            f"[PAGE_COMMAND][FAILED] command={runtime.get('command') or '-'} "
            f"reason={reason or '-'}",
            echo=True,
            level="WARNING",
        )
        self.clear_page_command_runtime(reason or "failed")
        self.render_sync_send_state()

    def timeout_page_command(self, correlation_id=""):
        runtime = getattr(self, "page_command_runtime", None) or {}
        if not self._page_command_correlation_matches(runtime, correlation_id):
            return
        self.safe_log(
            f"[PAGE_COMMAND][TIMEOUT] command={runtime.get('command') or '-'} "
            f"after_sec={PAGE_COMMAND_TIMEOUT_SEC}",
            echo=True,
            level="WARNING",
        )
        if (runtime.get("command") or "") == "sync_conversation":
            session_id = None
            rid = (runtime.get("request_id") or "").strip()
            if hasattr(self, "_current_session"):
                session = self._current_session()
                session_id = getattr(session, "session_id", None) if session else None
            if session_id and hasattr(self, "_finish_sync_progress"):
                self._finish_sync_progress(
                    session_id=session_id,
                    request_id=rid,
                    success=False,
                    text="同步超时，请重试",
                )
        self.clear_page_command_runtime("timeout")
        self.render_sync_send_state()

    def _schedule_page_command_timeout(self, request_id=""):
        rid = (request_id or "").strip()
        timer = getattr(self, "_page_command_timeout_timer", None)
        if timer is None:
            timer = self._make_single_shot_timer()
            timer.setSingleShot(True)
            self._page_command_timeout_timer = timer
        try:
            timer.timeout.disconnect()
        except Exception as error:
            self.safe_log(
                f"[PAGE_COMMAND][TIMER][DISCONNECT_FAILED] error={error}",
                echo=True,
                level="WARNING",
            )
        timer.timeout.connect(
            lambda r=rid: self.timeout_page_command(r or "")
        )
        timer.start(int(PAGE_COMMAND_TIMEOUT_SEC * 1000))

    def safe_log(self, message, echo=False, level=None):
        """日志失败不得中断刷新/同步/发送。"""
        try:
            if hasattr(self, "_append_log"):
                return self._append_log(message, echo=echo, level=level)
        except TypeError:
            try:
                return self._append_log(message, echo=echo)
            except Exception as log_exc:
                self._safe_log_fallback(log_exc, message)
        except Exception as log_exc:
            self._safe_log_fallback(log_exc, message)
        return None

    def _safe_log_fallback(self, log_exc, message):
        detail = (
            f"[SAFE_LOG][FAILED] error_type={type(log_exc).__name__} "
            f"error={log_exc} traceback={traceback.format_exc()} "
            f"message={message!r}"
        )
        try:
            import logging

            logging.getLogger("chatgpt_bridge.gui").error(detail)
        except Exception:
            print(detail)
