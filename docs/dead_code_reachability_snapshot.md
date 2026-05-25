# Dead Code Reachability Snapshot

本报告从入口文件出发，记录 Python import 可达性。
它只能作为候选分析依据，不能作为自动删除依据。

## Entry Modules

- `GUI` -> `GUI.py`（主 GUI；不是 `gui.py` / 独立 `server.py`）

## Reachable Modules

- `app.constants` -> `app/constants.py`
- `app.core.job_scheduler` -> `app/core/job_scheduler.py`
- `app.cursor_code.automation` -> `app/cursor_code/automation.py`
- `app.cursor_code.capture` -> `app/cursor_code/capture.py`
- `app.cursor_code.config` -> `app/cursor_code/config.py`
- `app.cursor_code.matcher` -> `app/cursor_code/matcher.py`
- `app.cursor_code.preview_utils` -> `app/cursor_code/preview_utils.py`
- `app.cursor_code.runtime` -> `app/cursor_code/runtime.py`
- `app.cursor_code.templates` -> `app/cursor_code/templates.py`
- `app.cursor_code.upgrade_monitor` -> `app/cursor_code/upgrade_monitor.py`
- `app.models` -> `app/models.py`
- `app.server.auth_utils` -> `app/server/auth_utils.py`
- `app.server.bridge_api` -> `app/server/bridge_api.py`
- `app.server.bridge_logging` -> `app/server/bridge_logging.py`
- `app.server.control_commands` -> `app/server/control_commands.py`
- `app.server.core_routes` -> `app/server/core_routes.py`
- `app.server.cursor_api` -> `app/server/cursor_api.py`
- `app.server.cursor_routes` -> `app/server/cursor_routes.py`
- `app.server.external_api` -> `app/server/external_api.py`
- `app.server.external_routes` -> `app/server/external_routes.py`
- `app.server.job_routes` -> `app/server/job_routes.py`
- `app.server.message_queue` -> `app/server/message_queue.py`
- `app.server.request_utils` -> `app/server/request_utils.py`
- `app.server.route_flags` -> `app/server/route_flags.py`
- `app.server.routes` -> `app/server/routes.py`
- `app.server.runtime_state` -> `app/server/runtime_state.py`
- `app.server.state` -> `app/server/state.py`
- `app.server.system_hotkey` -> `app/server/system_hotkey.py`
- `app.server.tm_page_registry` -> `app/server/tm_page_registry.py`
- `app.server.upload_files` -> `app/server/upload_files.py`
- `app.ui.main_window` -> `app/ui/main_window.py`
- `app.ui.main_window_state` -> `app/ui/main_window_state.py`
- `app.ui.mixins.assistant_reply_upsert_mixin` -> `app/ui/mixins/assistant_reply_upsert_mixin.py`
- `app.ui.mixins.bridge_mixin` -> `app/ui/mixins/bridge_mixin.py`
- `app.ui.mixins.chat_render_mixin` -> `app/ui/mixins/chat_render_mixin.py`
- `app.ui.mixins.chat_session_mixin` -> `app/ui/mixins/chat_session_mixin.py`
- `app.ui.mixins.conversation_stats_mixin` -> `app/ui/mixins/conversation_stats_mixin.py`
- `app.ui.mixins.cursor_bridge_mixin` -> `app/ui/mixins/cursor_bridge_mixin.py`
- `app.ui.mixins.cursor_code_mixin` -> `app/ui/mixins/cursor_code_mixin.py`
- `app.ui.mixins.external_api_gui_mixin` -> `app/ui/mixins/external_api_gui_mixin.py`
- `app.ui.mixins.page_auto_bind_mixin` -> `app/ui/mixins/page_auto_bind_mixin.py`
- `app.ui.mixins.page_bind_mixin` -> `app/ui/mixins/page_bind_mixin.py`
- `app.ui.mixins.page_binding_diagnostics_mixin` -> `app/ui/mixins/page_binding_diagnostics_mixin.py`
- `app.ui.mixins.page_binding_display_mixin` -> `app/ui/mixins/page_binding_display_mixin.py`
- `app.ui.mixins.page_binding_state_mixin` -> `app/ui/mixins/page_binding_state_mixin.py`
- `app.ui.mixins.page_open_close_mixin` -> `app/ui/mixins/page_open_close_mixin.py`
- `app.ui.mixins.page_registry_refresh_mixin` -> `app/ui/mixins/page_registry_refresh_mixin.py`
- `app.ui.mixins.page_selector_mixin` -> `app/ui/mixins/page_selector_mixin.py`
- `app.ui.mixins.page_send_target_mixin` -> `app/ui/mixins/page_send_target_mixin.py`
- `app.ui.mixins.page_sync_mixin` -> `app/ui/mixins/page_sync_mixin.py`
- `app.ui.mixins.page_tm_client_mixin` -> `app/ui/mixins/page_tm_client_mixin.py`
- `app.ui.mixins.send_flow_mixin` -> `app/ui/mixins/send_flow_mixin.py`
- `app.ui.mixins.session_mixin` -> `app/ui/mixins/session_mixin.py`
- `app.ui.mixins.settings_mixin` -> `app/ui/mixins/settings_mixin.py`
- `app.ui.mixins.tm_page_selector_format_mixin` -> `app/ui/mixins/tm_page_selector_format_mixin.py`
- `app.ui.mixins.ui_builder_core_mixin` -> `app/ui/mixins/ui_builder_core_mixin.py`
- `app.ui.mixins.ui_builder_mixin` -> `app/ui/mixins/ui_builder_mixin.py`
- `app.ui.mixins.ui_chat_panel_mixin` -> `app/ui/mixins/ui_chat_panel_mixin.py`
- `app.ui.mixins.ui_cursor_code_page_mixin` -> `app/ui/mixins/ui_cursor_code_page_mixin.py`
- `app.ui.mixins.ui_page_selector_mixin` -> `app/ui/mixins/ui_page_selector_mixin.py`
- `app.ui.mixins.ui_settings_page_mixin` -> `app/ui/mixins/ui_settings_page_mixin.py`
- `app.ui.mixins.ui_status_compact_mixin` -> `app/ui/mixins/ui_status_compact_mixin.py`
- `app.ui.mixins.waiting_timer_mixin` -> `app/ui/mixins/waiting_timer_mixin.py`
- `app.ui.page_display_segments` -> `app/ui/page_display_segments.py`
- `app.ui.status_scheduler` -> `app/ui/status_scheduler.py`
- `app.ui.styles` -> `app/ui/styles.py`
- `app.ui.widgets.bridge_notifier` -> `app/ui/widgets/bridge_notifier.py`
- `app.ui.widgets.chat_input` -> `app/ui/widgets/chat_input.py`
- `app.ui.widgets.elided_label` -> `app/ui/widgets/elided_label.py`
- `app.ui.widgets.no_wheel_combo_box` -> `app/ui/widgets/no_wheel_combo_box.py`
- `app.ui.widgets.segmented_elided_label` -> `app/ui/widgets/segmented_elided_label.py`
- `app.ui.widgets.session_list` -> `app/ui/widgets/session_list.py`
- `app.ui.widgets.session_list_item` -> `app/ui/widgets/session_list_item.py`
- `app.ui.widgets.tm_page_combo_delegate` -> `app/ui/widgets/tm_page_combo_delegate.py`
- `app.url_utils` -> `app/url_utils.py`
- `app.utils.bind_runtime` -> `app/utils/bind_runtime.py`
- `app.utils.bridge_json_file_log` -> `app/utils/bridge_json_file_log.py`
- `app.utils.bridge_payload` -> `app/utils/bridge_payload.py`
- `app.utils.deprecation_log` -> `app/utils/deprecation_log.py`
- `app.utils.gui_bridge_json_log` -> `app/utils/gui_bridge_json_log.py`
- `app.utils.gui_logging` -> `app/utils/gui_logging.py`
- `app.utils.json_log` -> `app/utils/json_log.py`
- `app.utils.legacy_cleanup` -> `app/utils/legacy_cleanup.py`
- `app.utils.legacy_fields` -> `app/utils/legacy_fields.py`
- `app.utils.log_utils` -> `app/utils/log_utils.py`
- `app.utils.page_binding_identity` -> `app/utils/page_binding_identity.py`
- `app.utils.page_command` -> `app/utils/page_command.py`
- `app.utils.page_identity` -> `app/utils/page_identity.py`
- `app.utils.page_snapshot` -> `app/utils/page_snapshot.py`
- `app.utils.page_status` -> `app/utils/page_status.py`
- `app.utils.safe_parse` -> `app/utils/safe_parse.py`
- `app.utils.send_plan` -> `app/utils/send_plan.py`
- `app.utils.target_sources` -> `app/utils/target_sources.py`
- `app.utils.text_utils` -> `app/utils/text_utils.py`
- `app.utils.time_utils` -> `app/utils/time_utils.py`
- `app.utils.tm_activity` -> `app/utils/tm_activity.py`
- `app.utils.trace_log` -> `app/utils/trace_log.py`
## Unreachable Candidate Modules

- `app/client/bridge_client.py` module=`app.client.bridge_client` reason=`dynamic-keep-marker`

## Notes

- Flask route、Qt UI、插件、importlib、getattr 等都可能导致静态 import 图误判。
- `dynamic-keep-marker` 文件不能直接删除。
- 删除任何候选前必须运行完整 dead code 检查和 GUI 冒烟测试。