import hashlib
import json
import logging
import time
import traceback
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

from app.constants import (
    CHAT_SESSIONS_DIR,
    LEGACY_PROJECT_SESSIONS_FILE,
    SESSIONS_FILE,
    SESSIONS_JSON_VERSION,
)
from app.models import (
    BIND_STATE_BOUND_CONVERSATION,
    BIND_STATE_PREBOUND_HOME,
    BIND_STATE_UNBOUND,
    BIND_STATE_WAITING_CONVERSATION_CREATED,
    BIND_STATE_WAITING_HOME,
    ChatMessage,
    ChatSession,
    normalize_remote_chatgpt,
)
from app.ui.async_workers import SessionSaveWorker
from app.url_utils import parse_conversation_id
from PyQt5.QtCore import QTimer


class SessionPersistenceMixin:
    @staticmethod
    def _message_to_dict(message):
        return {
            "message_id": message.message_id,
            "turn_id": message.turn_id,
            "role": message.role,
            "content": message.content,
            "created_at": message.created_at,
            "ui_status": message.ui_status or "",
            "message_source": message.message_source or "",
        }

    def _session_float_field(self, data, field, default=None, *, scope="session"):
        del scope
        from app.utils.safe_parse import safe_float_field

        fallback = time.time() if default is None else default
        return safe_float_field(data, field, fallback)

    def _normalize_legacy_message_dict(self, data):
        if not isinstance(data, dict):
            return {}

        item = dict(data)
        removed = []

        detail_value = item.get("detail")
        if detail_value is not None:
            detail_text = str(detail_value).strip()
            content_text = str(item.get("content") or "").strip()
            text_text = str(item.get("text") or "").strip()
            body_text = str(item.get("body") or "").strip()
            message_text = str(item.get("message") or "").strip()

            if (
                detail_text
                and not content_text
                and not text_text
                and not body_text
                and not message_text
            ):
                item["content"] = detail_text

        for legacy_key in ("text", "body", "message", "prompt", "raw_content"):
            if legacy_key in item:
                if not str(item.get("content") or "").strip():
                    legacy_value = item.get(legacy_key)
                    if str(legacy_value or "").strip():
                        item["content"] = legacy_value
                item.pop(legacy_key, None)
                removed.append(legacy_key)

        if "status" in item:
            if not str(item.get("ui_status") or "").strip():
                item["ui_status"] = item.get("status")
            item.pop("status", None)
            removed.append("status")

        if "source" in item:
            if not str(item.get("message_source") or "").strip():
                item["message_source"] = item.get("source")
            item.pop("source", None)
            removed.append("source")

        if "visible" in item:
            if "visible_in_chat" not in item:
                item["visible_in_chat"] = item.get("visible")
            item.pop("visible", None)
            removed.append("visible")

        if "request_id" in item:
            if not str(item.get("bridge_message_id") or "").strip():
                item["bridge_message_id"] = item.get("request_id")
            item.pop("request_id", None)
            removed.append("request_id")

        if removed:
            self._session_legacy_migrated = True
            removed_fields = ",".join(dict.fromkeys(removed))
            log_info = getattr(self, "_log_info", None)
            if callable(log_info):
                try:
                    log_info(
                        "[SESSION][LEGACY_MESSAGE_NORMALIZED] removed_fields=%s",
                        removed_fields,
                    )
                except Exception as error:
                    print(
                        "[SESSION][LEGACY_MESSAGE_NORMALIZED][LOG_FAILED]",
                        type(error).__name__,
                        str(error),
                    )
            else:
                print(
                    f"[SESSION][LEGACY_MESSAGE_NORMALIZED] removed_fields={removed_fields}"
                )

        return item

    def _message_from_dict(self, data):
        from app.utils.legacy_cleanup import (
            SESSION_MESSAGE_ALLOWED_FIELDS,
            assert_no_legacy_fields,
        )

        item = self._normalize_legacy_message_dict(data)
        assert_no_legacy_fields(
            item,
            owner="session_message_load",
            allowed_fields=SESSION_MESSAGE_ALLOWED_FIELDS,
            strict_unknown=True,
        )
        content = item.get("content")
        if content is None:
            content = ""
        return ChatMessage(
            role=item.get("role", "system"),
            content=content,
            created_at=self._session_float_field(
                item,
                "created_at",
                scope="message",
            ),
            message_id=item.get("message_id", ""),
            turn_id=item.get("turn_id", ""),
            ui_status=(item.get("ui_status") or "").strip(),
            detail=item.get("detail", ""),
            message_source=(item.get("message_source") or "").strip(),
            bridge_message_id=item.get("bridge_message_id", ""),
            parent_message_id=item.get("parent_message_id", ""),
            visible_in_chat=bool(item.get("visible_in_chat", True)),
        )

    def _schedule_save_sessions_to_disk(self, delay_ms=800):
        """防抖保存：合并短时间内的多次全量 JSON 写入。"""
        if not getattr(self, "_save_chat_history", True):
            return
        save_fn = getattr(self, "_save_sessions_to_disk", None)
        if not callable(save_fn):
            return
        from PyQt5.QtCore import QObject

        if not isinstance(self, QObject):
            save_fn()
            return
        delay_ms = max(100, min(int(delay_ms or 800), 5000))
        timer = getattr(self, "_session_save_timer", None)
        if timer is None:
            timer = QTimer(self)
            timer.setSingleShot(True)
            timer.timeout.connect(self._save_sessions_to_disk)
            self._session_save_timer = timer
        timer.stop()
        timer.start(delay_ms)

    def _save_sessions_to_disk(self):
        if not self._save_chat_history:
            return
        started_at = time.perf_counter()
        try:
            payload = {
                "version": SESSIONS_JSON_VERSION,
                "current_session_id": self._current_session_id,
                "tab_order": list(self._tab_session_ids),
                "sessions": [
                    self._session_to_dict(item) for item in self._sessions.values()
                ],
                "message_to_session": dict(self._message_to_session),
                "message_to_turn": dict(self._message_to_turn),
                "finalized_bridge_message_ids": list(
                    self._bridge_msg.finalized_bridge_message_ids
                ),
            }
            payload_hash = hashlib.sha1(
                json.dumps(
                    payload,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
        except Exception as error:
            self._append_log(
                "[SESSION][SAVE_SNAPSHOT_FAILED] "
                f"error_type={type(error).__name__} error={error}\n"
                f"{traceback.format_exc()}",
                echo=True,
            )
            return

        if payload_hash == getattr(self, "_last_session_save_payload_hash", ""):
            return

        request_id = uuid.uuid4().hex
        worker = SessionSaveWorker(
            request_id=request_id,
            data_dir=str(self._chat_sessions_path or CHAT_SESSIONS_DIR),
            payload=payload,
            payload_hash=payload_hash,
        )
        pending = getattr(self, "_session_save_pending_worker", None)
        if pending is not None and pending.isRunning():
            self._session_save_queued_payload = payload
            self._session_save_queued_payload_hash = payload_hash
            return
        self._session_save_pending_worker = worker
        worker.result_ready.connect(self._on_save_sessions_worker_result)
        worker.finished.connect(lambda w=worker: self._on_save_sessions_worker_finished(w))
        worker.start()
        cost_ms = int((time.perf_counter() - started_at) * 1000)
        if cost_ms > 120 and hasattr(self, "_append_log"):
            self._append_log(
                "[PERF][SESSION_SAVE] "
                f"stage=snapshot cost={cost_ms}ms",
                echo=False,
            )

    def _load_sessions_from_disk(self):
        self._session_legacy_migrated = False
        data_dir = Path(self._chat_sessions_path or CHAT_SESSIONS_DIR)
        sessions_file = data_dir / "chat_sessions.json"
        preferred_sessions_file = sessions_file
        if not sessions_file.exists() and SESSIONS_FILE.exists():
            sessions_file = SESSIONS_FILE
        if not sessions_file.exists() and LEGACY_PROJECT_SESSIONS_FILE.exists():
            sessions_file = LEGACY_PROJECT_SESSIONS_FILE
        if not sessions_file.exists():
            return
        try:
            raw = sessions_file.read_text(encoding="utf-8")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError(
                    f"chat_sessions.json 顶层必须是 object，实际是 {type(payload).__name__}"
                )
        except Exception as error:
            detail = f"加载对话记录失败：{error}\n{traceback.format_exc()}"
            self._append_log(detail, echo=True)
            try:
                broken_file = sessions_file.with_suffix(".json.broken")
                sessions_file.replace(broken_file)
                self._append_log(
                    f"[SESSION][BACKUP_BROKEN] path={broken_file}",
                    echo=True,
                )
            except Exception as backup_error:
                self._append_log(
                    f"[SESSION][BACKUP_BROKEN_FAILED] {backup_error}\n"
                    f"{traceback.format_exc()}",
                    echo=True,
                )
            self._sessions = {}
            session = self._create_session(select=False)
            self._append_session_message(
                session,
                "system",
                "对话记录加载失败，已创建新对话。请查看运行日志了解详情。",
            )
            return
        self._sessions = {}
        for index, item in enumerate(payload.get("sessions") or []):
            if not isinstance(item, dict):
                self._append_log(
                    f"[SESSION][LOAD_SKIP_INVALID_ITEM] index={index} "
                    f"type={type(item).__name__}",
                    echo=True,
                )
                continue
            try:
                session = self._session_from_dict(item)
            except Exception as error:
                self._append_log(
                    "[SESSION][LOAD_ITEM_FAILED] "
                    f"index={index} error_type={type(error).__name__} "
                    f"error={error}\n{traceback.format_exc()}",
                    echo=True,
                )
                continue
            self._sessions[session.session_id] = session
        self._current_session_id = payload.get("current_session_id")
        self._tab_session_ids = list(
            payload.get("tab_order") or payload.get("tab_session_ids") or []
        )
        if not self._tab_session_ids:
            saved_tabs = self._settings.value("tab_session_ids")
            if saved_tabs:
                self._tab_session_ids = [str(item) for item in saved_tabs]
        self._message_to_session = dict(payload.get("message_to_session") or {})
        self._message_to_turn = dict(payload.get("message_to_turn") or {})
        finalized = payload.get("finalized_bridge_message_ids") or payload.get(
            "finalized_message_ids"
        ) or []
        self._bridge_msg.finalized_bridge_message_ids = set(finalized)
        self._migrate_loaded_session_messages()
        self._migrate_loaded_remote_bindings()
        startup_cleared = False
        for session in self._sessions.values():
            if hasattr(self, "_clear_runtime_waiting_state_on_startup"):
                if self._clear_runtime_waiting_state_on_startup(session):
                    startup_cleared = True
            else:
                self._cleanup_stale_pending_on_load(session)
            # 加载后裁剪超出上限的消息
            session.trim_messages()
        legacy_message_migrated = bool(
            getattr(self, "_session_legacy_migrated", False)
        )
        if startup_cleared or sessions_file != preferred_sessions_file or legacy_message_migrated:
            if sessions_file != preferred_sessions_file:
                logger.info(
                    "[SESSION][MIGRATE_RUNTIME] old_path=%s new_path=%s result=start",
                    str(sessions_file),
                    str(preferred_sessions_file),
                )
            try:
                self._save_sessions_to_disk()
                if legacy_message_migrated:
                    self._session_legacy_migrated = False
                if sessions_file != preferred_sessions_file:
                    logger.info(
                        "[SESSION][MIGRATE_RUNTIME] old_path=%s new_path=%s result=ok session_count=%d",
                        str(sessions_file),
                        str(preferred_sessions_file),
                        len(self._sessions),
                    )
            except Exception as error:
                if sessions_file != preferred_sessions_file:
                    logger.error(
                        (
                            "[SESSION][MIGRATE_RUNTIME] old_path=%s new_path=%s "
                            "result=failed error=%s"
                        ),
                        str(sessions_file),
                        str(preferred_sessions_file),
                        error,
                    )
                    logger.error(
                        "[SESSION][MIGRATE_RUNTIME] traceback:",
                    )
                    logger.error(traceback.format_exc())
                raise
        if hasattr(self, "_cleanup_bridge_runtime_maps"):
            self._cleanup_bridge_runtime_maps("session_changed")

    def _session_to_dict(self, session):
        from app.utils.legacy_cleanup import (
            SESSION_MESSAGE_ALLOWED_FIELDS,
            assert_no_legacy_fields,
        )

        runtime = self._session_runtime_entry(session)
        if self._session_all_messages_loaded(session):
            runtime["all_messages_raw"] = [
                self._message_to_dict(item)
                for item in getattr(session, "messages", []) or []
            ]
        if hasattr(self, "_normalize_session_for_persistence"):
            return self._normalize_session_for_persistence(session)
        remote = normalize_remote_chatgpt(session.remote_chatgpt)
        from app.utils.legacy_cleanup import assert_no_remote_chatgpt_invalid_fields

        assert_no_remote_chatgpt_invalid_fields(
            remote,
            owner=f"GUI save session.remote_chatgpt session_id={session.session_id}",
        )
        compose_draft = ""
        drafts_map = getattr(self, "_session_compose_drafts", None) or {}
        raw = drafts_map.get(session.session_id, "")
        if isinstance(raw, str) and raw.strip():
            compose_draft = raw
        messages = runtime.get("all_messages_raw")
        if not isinstance(messages, list):
            messages = [self._message_to_dict(item) for item in getattr(session, "messages", []) or []]
            runtime["all_messages_raw"] = list(messages)
        for index, message in enumerate(messages):
            assert_no_legacy_fields(
                message,
                owner=f"GUI save session.messages session_id={session.session_id} index={index}",
                allowed_fields=SESSION_MESSAGE_ALLOWED_FIELDS,
                strict_unknown=True,
            )
        return {
            "session_id": session.session_id,
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "task_type": session.task_type,
            "context_mode": session.context_mode,
            "summary": session.summary,
            "pinned_context": session.pinned_context,
            "remote_chatgpt": dict(remote),
            "web_snapshot": dict(getattr(session, "web_snapshot", {}) or {}),
            "reply_waiting_since": 0,
            "compose_draft": compose_draft,
            "messages": list(messages),
        }

    def _session_from_dict(self, data):
        if not isinstance(data, dict):
            raise ValueError(f"session item must be dict, got {type(data).__name__}")
        raw_messages = []
        for index, item in enumerate(data.get("messages") or []):
            if not isinstance(item, dict):
                self._append_log(
                    f"[SESSION][MESSAGE_SKIP_INVALID_ITEM] "
                    f"session_id={data.get('session_id') or '-'} "
                    f"index={index} type={type(item).__name__}",
                    echo=True,
                )
                continue
            try:
                raw_messages.append(self._normalize_legacy_message_dict(item))
            except Exception as error:
                logger.exception(
                    "[SESSION][MESSAGE_NORMALIZE_FAILED] message_index=%s error_type=%s error=%s item_keys=%s",
                    index,
                    type(error).__name__,
                    error,
                    list(item.keys()) if isinstance(item, dict) else type(item).__name__,
                )
        remote = normalize_remote_chatgpt(data.get("remote_chatgpt") or {})
        session = ChatSession(
            session_id=data.get("session_id") or str(uuid.uuid4()),
            title=data.get("title") or "新对话",
            created_at=self._session_float_field(data, "created_at"),
            updated_at=self._session_float_field(data, "updated_at"),
            task_type=data.get("task_type", ""),
            context_mode=data.get("context_mode", ""),
            summary=data.get("summary", ""),
            pinned_context=data.get("pinned_context", ""),
            remote_chatgpt=remote,
            web_snapshot=data.get("web_snapshot") or {},
            messages=[],
            reply_waiting_since=0,
        )
        self._set_session_messages_from_raw(
            session,
            raw_messages,
            visible_tail_count=self.SESSION_LOAD_RECENT_MESSAGES,
            all_loaded=len(raw_messages) <= self.SESSION_LOAD_RECENT_MESSAGES,
        )
        compose_draft = data.get("compose_draft", "")
        if isinstance(compose_draft, str) and compose_draft.strip():
            session_id = session.session_id
            drafts = getattr(self, "_session_compose_drafts", None)
            if drafts is None:
                drafts = {}
                self._session_compose_drafts = drafts
            drafts[session_id] = compose_draft
            logger.info(
                "[SESSION][COMPOSE_DRAFT_RESTORE] session_id=%s length=%d",
                session_id,
                len(compose_draft),
            )
        if hasattr(self, "_invalidate_session_runtime"):
            self._invalidate_session_runtime(session, reason="session_from_dict")
        return session

    def _migrate_loaded_remote_bindings(self):
        from app.utils.bind_runtime import migrate_transient_from_remote

        changed = False
        for session in self._sessions.values():
            old_remote = dict(session.remote_chatgpt or {})
            old_bind_state = (old_remote.get("bind_state") or "").strip()
            cleaned = migrate_transient_from_remote(self, session, old_remote)
            remote = normalize_remote_chatgpt(cleaned)

            conversation_id = (remote.get("conversation_id") or "").strip()
            conversation_url = (
                (remote.get("url") or "").strip()
            ).strip()

            if not conversation_id and conversation_url:
                conversation_id = parse_conversation_id(conversation_url)

            if conversation_id:
                if not conversation_url:
                    conversation_url = f"https://chatgpt.com/c/{conversation_id}"

                remote["conversation_id"] = conversation_id
                remote["url"] = conversation_url

                new_bind_state = remote.get("bind_state")
                if remote.get("bind_state") in (
                    BIND_STATE_UNBOUND,
                    BIND_STATE_WAITING_HOME,
                    BIND_STATE_PREBOUND_HOME,
                    BIND_STATE_WAITING_CONVERSATION_CREATED,
                    "",
                    None,
                ):
                    remote["bind_state"] = BIND_STATE_BOUND_CONVERSATION
                    new_bind_state = BIND_STATE_BOUND_CONVERSATION

                if remote != old_remote or old_bind_state != new_bind_state:
                    self._append_log(
                        "[SESSION][MIGRATE_REMOTE] "
                        f"session_id={session.session_id} "
                        f"old_bind_state={old_bind_state or '-'} "
                        f"new_bind_state={new_bind_state or '-'} "
                        f"conversation_id={conversation_id} "
                        f"url={conversation_url}"
                    )

            if remote != old_remote:
                session.remote_chatgpt = remote
                changed = True

        if changed:
            self._save_sessions_to_disk()

    def _restore_ui_settings(self):
        if self._remember_window_geometry:
            geometry = self._settings.value("geometry")
            if geometry is not None:
                self.restoreGeometry(geometry)
            window_state = self._settings.value("window_state")
            if window_state is not None and self._remember_window_position:
                self.restoreState(window_state)
        if self._restore_main_tab:
            try:
                main_tab_index = int(self._settings.value("main_tab_index", 0))
            except (TypeError, ValueError) as exc:
                logger.warning(
                    "[UI_SETTINGS][RESTORE][MAIN_TAB_INVALID] error=%s", exc
                )
                main_tab_index = 0
            if 0 <= main_tab_index < self.main_tabs.count():
                self.main_tabs.setCurrentIndex(main_tab_index)
        if hasattr(self, "_restore_chat_sub_tab_index"):
            self._restore_chat_sub_tab_index()

    def _save_ui_settings(self):
        if self._remember_window_geometry:
            self._settings.setValue("geometry", self.saveGeometry())
        if self._remember_window_position:
            self._settings.setValue("window_state", self.saveState())
        if hasattr(self, "_save_splitter_sizes_now"):
            self._save_splitter_sizes_now()
        if hasattr(self, "_save_chat_sub_tab_index"):
            self._save_chat_sub_tab_index()
        self._settings.setValue("main_tab_index", self.main_tabs.currentIndex())
        self._settings.setValue("tab_session_ids", self._tab_session_ids)
        if self._current_session_id:
            self._settings.setValue("current_session_id", self._current_session_id)
        if self._saved_page_url and hasattr(self, "_persist_page_url"):
            self._persist_page_url(self._saved_page_url)

    def _flush_pending_sessions_save(self):
        timer = getattr(self, "_session_save_timer", None)
        if timer is not None and timer.isActive():
            timer.stop()
        self._save_sessions_to_disk()
        worker = getattr(self, "_session_save_pending_worker", None)
        if worker is not None and worker.isRunning():
            worker.wait(5000)

    def _on_save_sessions_worker_result(self, result):
        if not isinstance(result, dict):
            return
        if result.get("ok"):
            self._last_session_save_payload_hash = result.get("payload_hash") or ""
            self._dirty_session_ids = set()
            elapsed_ms = int(result.get("elapsed_ms") or 0)
            if elapsed_ms > 120 and hasattr(self, "_append_log"):
                self._append_log(
                    "[PERF][SESSION_SAVE] "
                    f"stage=worker cost={elapsed_ms}ms "
                    f"bytes={int(result.get('bytes') or 0)}",
                    echo=False,
                )
            return
        error = result.get("error") or "unknown"
        detail = (
            "[SESSION][SAVE_FAILED] "
            f"path={result.get('path') or '-'} "
            f"tmp_path={result.get('tmp_path') or '-'} "
            f"error_type={result.get('error_type') or '-'} "
            f"error={error}\n"
            f"{result.get('traceback') or ''}"
        )
        self._append_log(detail, echo=True)
        if hasattr(self, "_set_tm_action_hint"):
            self._set_tm_action_hint(f"保存对话记录失败：{error}")
        if (
            hasattr(self, "_add_system_message")
            and not getattr(self, "_session_save_failure_notifying", False)
        ):
            self._session_save_failure_notifying = True
            try:
                self._add_system_message(
                    f"保存对话记录失败，请检查磁盘权限或路径：{error}"
                )
            finally:
                self._session_save_failure_notifying = False

    def _on_save_sessions_worker_finished(self, worker):
        if worker is None:
            return
        if getattr(worker, "result_consumed", False):
            return
        worker.result_consumed = True
        if worker is getattr(self, "_session_save_pending_worker", None):
            self._session_save_pending_worker = None
        queued_payload = getattr(self, "_session_save_queued_payload", None)
        queued_hash = getattr(self, "_session_save_queued_payload_hash", "")
        self._session_save_queued_payload = None
        self._session_save_queued_payload_hash = ""
        if queued_payload and queued_hash and queued_hash != getattr(
            self, "_last_session_save_payload_hash", ""
        ):
            next_worker = SessionSaveWorker(
                request_id=uuid.uuid4().hex,
                data_dir=str(self._chat_sessions_path or CHAT_SESSIONS_DIR),
                payload=queued_payload,
                payload_hash=queued_hash,
            )
            self._session_save_pending_worker = next_worker
            next_worker.result_ready.connect(self._on_save_sessions_worker_result)
            next_worker.finished.connect(
                lambda w=next_worker: self._on_save_sessions_worker_finished(w)
            )
            next_worker.start()

