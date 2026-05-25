# Dead Code Review Summary

created_at=2026-05-25T02:08:43

> **历史扫描产物**：正文含大量 `gui.py`/`server.py`/`python tools/…` 行内引用，来自完整开发仓库某次扫描。精简发布包无 `tools/` 时勿按正文命令执行；可执行验收见 `docs/dead_code_cleanup_rules.md` §0。

本报告由候选扫描脚本生成，只用于人工审查，不允许自动删除代码。

## Failed Commands

- `js_dead_code_candidates` returncode=`2`
- `commented_dead_code_candidates` returncode=`2`
- `dead_config_keys` returncode=`2`

## High Priority / High Risk Candidates

- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_audit_convergence_flow.py:11 pattern=page_url context=possible_stale_behavior_test line=page_url_from,`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_audit_convergence_flow.py:111 pattern=page_url context=possible_stale_behavior_test line=def test_page_url_from_runtime_canonical_only():`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_audit_convergence_flow.py:112 pattern=page_url context=possible_stale_behavior_test line=assert page_url_from({"target_url": "https://chatgpt.com/c/x"}) == ""`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_audit_convergence_flow.py:113 pattern=page_url context=possible_stale_behavior_test line=assert page_url_from({"url": "https://chatgpt.com/c/x"}) == "https://chatgpt.com/c/x"`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_client_report.py:114 pattern=conversation_url context=possible_stale_behavior_test line=def test_chatgpt_home_and_conversation_url_capabilities():`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:17 pattern=page_url context=safe_guard_or_migration_test line=from app.utils.page_status import page_url_from`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:113 pattern=page_url context=safe_guard_or_migration_test line=def test_page_url_from_reads_url(self):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:116 pattern=page_url context=safe_guard_or_migration_test line="tampermonkey_page_url": "https://legacy",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:118 pattern=page_url context=safe_guard_or_migration_test line=self.assertEqual(page_url_from(status), "https://chatgpt.com/c/new")`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:120 pattern=page_url context=safe_guard_or_migration_test line=def test_page_url_from_ignores_tampermonkey_page_url(self):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:121 pattern=page_url context=safe_guard_or_migration_test line=status = {"tampermonkey_page_url": "https://chatgpt.com/c/legacy"}`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:122 pattern=page_url context=safe_guard_or_migration_test line=self.assertEqual(page_url_from(status), "")`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:125 pattern=last_page_url context=safe_guard_or_migration_test line=settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/old"})`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:125 pattern=page_url context=safe_guard_or_migration_test line=settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/old"})`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:129 pattern=last_page_url context=possible_stale_behavior_test line=settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/stale"})`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:129 pattern=page_url context=possible_stale_behavior_test line=settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/stale"})`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:133 pattern=last_page_url context=possible_stale_behavior_test line=self.assertFalse(settings.contains("last_page_url"))`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:133 pattern=page_url context=possible_stale_behavior_test line=self.assertFalse(settings.contains("last_page_url"))`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:137 pattern=last_page_url context=possible_stale_behavior_test line="[MIGRATION_HIT]" in line and "old=last_page_url" in line`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:137 pattern=page_url context=possible_stale_behavior_test line="[MIGRATION_HIT]" in line and "old=last_page_url" in line`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:149 pattern=page_url context=safe_guard_or_migration_test line=def test_normalize_inbound_push_payload_rejects_legacy_page_url(self):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:152 pattern=page_url context=safe_guard_or_migration_test line={"content": "hi", "page_url": "https://chatgpt.com/c/page"}`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:185 pattern=page_url context=possible_stale_behavior_test line=self.assertNotIn("target_page_url", sig.parameters)`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:196 pattern=page_url context=possible_stale_behavior_test line="target_page_url",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:16 pattern=request_id context=safe_guard_or_migration_test line=1. ``bridge_payload.validate_outbound_queue_message`` 在嵌套 ``payload.request_id```
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:16 pattern=payload.request_id context=safe_guard_or_migration_test line=1. ``bridge_payload.validate_outbound_queue_message`` 在嵌套 ``payload.request_id```
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:18 pattern=request_id context=safe_guard_or_migration_test line=与 ``payload.request_id``（由 ``assert_no_legacy_fields`` 深检触发）。`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:18 pattern=payload.request_id context=safe_guard_or_migration_test line=与 ``payload.request_id``（由 ``assert_no_legacy_fields`` 深检触发）。`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:19 pattern=request_id context=safe_guard_or_migration_test line=2. 不含 ``request_id`` 的 canonical 出站消息必须通过校验并返回规范化结果。`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:20 pattern=request_id context=safe_guard_or_migration_test line=3. 不得将 ``payload.request_id`` 加回白名单；上游漏字段应修同步流程，而非删除拦截。`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:20 pattern=payload.request_id context=safe_guard_or_migration_test line=3. 不得将 ``payload.request_id`` 加回白名单；上游漏字段应修同步流程，而非删除拦截。`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:48 pattern=request_id context=safe_guard_or_migration_test line=def test_validate_outbound_queue_message_rejects_payload_request_id():`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:49 pattern=request_id context=safe_guard_or_migration_test line=msg = _canonical_outbound_msg(request_id="legacy-request-id")`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:56 pattern=request_id context=safe_guard_or_migration_test line=assert "payload.request_id" in err`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:56 pattern=payload.request_id context=safe_guard_or_migration_test line=assert "payload.request_id" in err`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:59 pattern=request_id context=safe_guard_or_migration_test line=def test_validate_outbound_queue_message_accepts_current_fields_without_request_id():`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:78 pattern=request_id context=possible_stale_behavior_test line=assert "request_id" not in out["payload"]`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_chat_header_bound_page_id.py:64 pattern=conversation_url context=possible_stale_behavior_test line=def _remote_conversation_url(self, remote):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_chat_header_bound_page_id.py:95 pattern=conversation_url context=possible_stale_behavior_test line="conversation_url": "https://chatgpt.com/c/6a10768a-de10-83a6-8b4d-629fec09c77a",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_chat_header_bound_page_id.py:157 pattern=conversation_url context=possible_stale_behavior_test line="conversation_url": "https://chatgpt.com/c/abc",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_chat_message_ui_status.py:55 pattern="status" context=possible_stale_behavior_test line=self.assertNotIn("status", data)`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_chat_message_ui_status.py:99 pattern="status" context=possible_stale_behavior_test line="status": "发送中",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_deprecation_log.py:29 pattern=last_page_url context=safe_guard_or_migration_test line=old="last_page_url",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_deprecation_log.py:29 pattern=page_url context=safe_guard_or_migration_test line=old="last_page_url",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_deprecation_log.py:36 pattern=last_page_url context=possible_stale_behavior_test line=self.assertIn("old=last_page_url", message)`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_deprecation_log.py:36 pattern=page_url context=possible_stale_behavior_test line=self.assertIn("old=last_page_url", message)`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_aliases_parity.py:1 pattern=page_url context=possible_stale_behavior_test line="""Python page_url_from 与 client.user.js bridgeUrlFrom 均只读 canonical url。"""`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_aliases_parity.py:6 pattern=page_url context=possible_stale_behavior_test line=from app.utils.page_status import page_url_from as url_from`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_aliases_parity.py:25 pattern=page_url context=possible_stale_behavior_test line=assert "page_url" not in body`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_convergence_p1.py:151 pattern="status" context=safe_guard_or_migration_test line=assert "status" not in req`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_convergence_p1.py:152 pattern="status" context=safe_guard_or_migration_test line=legacy = {"status": "waiting", "request_status": "queued"}`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_convergence_p2.py:20 pattern=page_url context=safe_guard_or_migration_test line=from app.utils.page_status import page_url_from as url_from`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_convergence_p2.py:93 pattern="status" context=possible_stale_behavior_test line=stored["status"] = "waiting_chatgpt_reply"`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_convergence_p2.py:98 pattern="status" context=possible_stale_behavior_test line=assert "status" not in fetched`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_convergence_p2.py:100 pattern="status" context=possible_stale_behavior_test line=assert "status" not in (get_job(job_id) or {})`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:18 pattern=request_id context=possible_stale_behavior_test line="bind_request_id",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:33 pattern=request_id context=possible_stale_behavior_test line="bind_request_id": "tok-abc",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:41 pattern=request_id context=possible_stale_behavior_test line=assert remote["bind_request_id"] == "tok-abc"`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:75 pattern="status" context=safe_guard_or_migration_test line=for legacy in ("status", "source", "visible", "request_id", "text"):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:75 pattern=request_id context=safe_guard_or_migration_test line=for legacy in ("status", "source", "visible", "request_id", "text"):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_job_scheduler_status_migration.py:26 pattern="status" context=possible_stale_behavior_test line=stored.pop("status", None)`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_job_scheduler_status_migration.py:55 pattern="status" context=possible_stale_behavior_test line=stored.pop("status", None)`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_legacy_cleanup.py:14 pattern="status" context=safe_guard_or_migration_test line={"content": "x", "id": "m1", "status": "queued"},`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_legacy_cleanup.py:82 pattern=page_url context=possible_stale_behavior_test line="page_url",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_legacy_cleanup.py:87 pattern="status" context=possible_stale_behavior_test line=for key in ("id", "status", "title", "message", "prompt"):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_normalize_remote_chatgpt.py:28 pattern=request_id context=possible_stale_behavior_test line="bind_request_id",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_p0_convergence.py:123 pattern=request_id context=possible_stale_behavior_test line=payload={"request_id": "req-1"},`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_p0_field_flow_fixes.py:209 pattern=page_url context=possible_stale_behavior_test line=def _page_url_from_item(self, item):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_list_auto_refresh.py:1 pattern=page_url context=possible_stale_behavior_test line="""页面列表自动刷新与 page_url_from 导入修复。"""`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_list_auto_refresh.py:72 pattern=page_url context=possible_stale_behavior_test line=def test_short_page_label_uses_page_url_from():`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_list_auto_refresh.py:80 pattern=page_url context=possible_stale_behavior_test line=def test_page_binding_display_imports_page_url_from():`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_list_auto_refresh.py:83 pattern=page_url context=possible_stale_behavior_test line=assert "page_url_from" in mod.__dict__`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_registry_refresh.py:263 pattern=request_id context=possible_stale_behavior_test line=host.start_page_command("sync_conversation", payload={"request_id": "r1"})`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:11 pattern=page_url context=possible_stale_behavior_test line=is_page_url_syncable,`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:13 pattern=page_url context=possible_stale_behavior_test line=page_url_from,`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:18 pattern=page_url context=possible_stale_behavior_test line=def test_page_url_from_reads_canonical_only(self):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:19 pattern=page_url context=possible_stale_behavior_test line=raw = {"page_url": "https://chatgpt.com/c/abc123"}`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:20 pattern=page_url context=possible_stale_behavior_test line=self.assertEqual(page_url_from(raw), "")`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:27 pattern=page_url context=possible_stale_behavior_test line=migrated.pop("page_url", None)`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:31 pattern=page_url context=possible_stale_behavior_test line=def test_page_url_from_canonical_url(self):`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:33 pattern=page_url context=safe_guard_or_migration_test line=self.assertEqual(page_url_from(raw), "https://chatgpt.com/c/tampermonkey")`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:52 pattern=page_url context=safe_guard_or_migration_test line="page_url": "https://chatgpt.com/c/legacy-only",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_status.py:56 pattern=page_url context=possible_stale_behavior_test line=self.assertNotIn("page_url", norm)`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_url_dedup.py:23 pattern=page_url context=possible_stale_behavior_test line=def test_normalize_chatgpt_page_url_strips_query_and_fragment():`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_page_url_dedup.py:26 pattern=page_url context=possible_stale_behavior_test line=assert host._normalize_chatgpt_page_url(url) == "https://chatgpt.com/c/abc-123"`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_poll_response_fields.py:8 pattern="status" context=possible_stale_behavior_test line="status",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_poll_response_fields.py:10 pattern=page_url context=possible_stale_behavior_test line="target_page_url",`
- `stale_tests_candidates`: `[STALE_TEST_CANDIDATE] tests/test_tm_page_snapshot.py:28 pattern=page_url context=possible_stale_behavior_test line=def _normalize_chatgpt_page_url(self, url):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101163 pattern=fallback context=likely_guard_or_diagnostic line=输出标签：`[UNUSED_ROUTE_CANDIDATE]`、`[MISSING_ROUTE_CANDIDATE]`。出现候选后须结合 `rg`、`tools/search_text_fallback.py` 与动态引用扫描人工确认。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101507 pattern=legacy context=likely_guard_or_diagnostic line=| **high** | `[MISSING_ROUTE_CANDIDATE]`、`possible_live_legacy_usage`、`possible_stale_behavior_test`、`[DEAD_CODE_REGRESSION][FAILED]`、`[MUST_KEEP_SYMBOLS][FAILED]`、`[STALE_TEST_CANDIDATE]` | 不直接删除；区分旧代码残留、guard/migration`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:349 pattern=fallback context=likely_guard_or_diagnostic line=输出标签：`[UNUSED_ROUTE_CANDIDATE]`、`[MISSING_ROUTE_CANDIDATE]`。出现候选后须结合 `rg`、`tools/search_text_fallback.py` 与动态引用扫描人工确认。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:693 pattern=legacy context=likely_guard_or_diagnostic line=| **high** | `[MISSING_ROUTE_CANDIDATE]`、`possible_live_legacy_usage`、`possible_stale_behavior_test`、`[DEAD_CODE_REGRESSION][FAILED]`、`[MUST_KEEP_SYMBOLS][FAILED]`、`[STALE_TEST_CANDIDATE]` | 不直接删除；区分旧代码残留、guard/migration`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_dead_code_review_summary.py:62 pattern=legacy context=likely_guard_or_diagnostic line="possible_live_legacy_usage",`
- `api_route_usage_candidates`: `[MISSING_ROUTE_CANDIDATE] app/client/bridge_client.py:430 kind=url_literal path=/api/v1`

## Medium Priority Candidates

- `python_dead_statements`: `[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1375 scope=module.ClassDef@47.FunctionDef@1270 node=Expr`
- `python_dead_statements`: `[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1379 scope=module.ClassDef@47.FunctionDef@1270 node=Return`
- `python_dead_statements`: `[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1375 scope=PageAutoBindMixin.FunctionDef@1270 node=Expr`
- `python_dead_statements`: `[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1379 scope=PageAutoBindMixin.FunctionDef@1270 node=Return`
- `python_dead_statements`: `[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1375 scope=_prepare_first_message_binding node=Expr`
- `python_dead_statements`: `[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1379 scope=_prepare_first_message_binding node=Return`
- `orphan_python_modules`: `[ORPHAN_PY_MODULE_CANDIDATE] app/core/job_scheduler.py module=app.core.job_scheduler`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:117 pattern=legacy context=likely_guard_or_diagnostic line=95. app/utils/legacy_cleanup.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:118 pattern=legacy context=likely_guard_or_diagnostic line=96. app/utils/legacy_fields.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:130 pattern=trace context=likely_guard_or_diagnostic line=108. app/utils/trace_log.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:306 pattern=os.environ context=needs_manual_review line=env_url = (os.environ.get("CHATGPT_PAGE_BRIDGE_URL") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:397 pattern=os.environ context=needs_manual_review line=self.token = (token if token is not None else os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")).strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:748 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:965 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:994 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1010 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1033 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1054 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1079 pattern=os.environ context=needs_manual_review line=default=os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", ""),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1324 pattern=os.environ context=needs_manual_review line=if os.environ.get("BRIDGE_CLIENT_NO_PAUSE") == "1":`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1392 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1394 pattern=trace context=likely_guard_or_diagnostic line=traceback.print_exc()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1500 pattern=DEBUG_ context=likely_guard_or_diagnostic line=DEBUG_FULL_BRIDGE_JSON = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1620 pattern=AUTO_ context=needs_manual_review line=STATUS_CHIP_AUTO_FOCUS_PREFIX = "自动焦点页"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1624 pattern=AUTO_ context=needs_manual_review line=STATUS_CHIP_AUTO_FOCUS_TOOLTIP = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1661 pattern=enable_ context=needs_manual_review line="enable_lan_access": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1676 pattern=debug context=likely_guard_or_diagnostic line="debug_mode": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1707 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1743 pattern=migrate context=needs_manual_review line=def _migrate_job_status_inplace(job):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1876 pattern=migrate context=needs_manual_review line=_migrate_job_status_inplace(job)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1888 pattern=migrate context=needs_manual_review line=jobs.append(dict(_migrate_job_status_inplace(job)))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1959 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1963 pattern=AUTO_ context=needs_manual_review line=f"[JOB][AUTO_SEND_CURSOR_FAILED] job_id={job_id} error={exc}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2020 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2275 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2294 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2335 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2451 pattern=trace context=likely_guard_or_diagnostic line=f"{type(e).__name__}: {e}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2476 pattern=enable_ context=needs_manual_review line=def enable_dpi_awareness() -> None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3432 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3469 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3551 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3728 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3734 pattern=deprecated context=likely_guard_or_diagnostic line=from app.utils.deprecation_log import log_deprecated_hit`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3737 pattern=deprecated context=likely_guard_or_diagnostic line=log_deprecated_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3739 pattern=compat context=likely_guard_or_diagnostic line=reason="compat_wrapper",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3854 pattern=fallback context=likely_guard_or_diagnostic line="[REMOTE][INVALID_REMOTE_TYPE] type=%s fallback=default",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3858 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3886 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote_work, owner="normalize_remote_chatgpt")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3898 pattern=legacy context=likely_guard_or_diagnostic line=legacy_conversation_id = (base.get("conversation_id") or "").strip() or (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3902 pattern=legacy context=likely_guard_or_diagnostic line=if not legacy_conversation_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3903 pattern=legacy context=likely_guard_or_diagnostic line=legacy_conversation_id = parse_conversation_id(url)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3904 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_conversation_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3905 pattern=legacy context=likely_guard_or_diagnostic line=base["conversation_id"] = legacy_conversation_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3907 pattern=legacy context=likely_guard_or_diagnostic line=base["url"] = f"https://chatgpt.com/c/{legacy_conversation_id}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3947 pattern=debug context=likely_guard_or_diagnostic line=logger.debug(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3954 pattern=debug context=likely_guard_or_diagnostic line=logger.debug(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3987 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3989 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote, owner="GUI session.remote_chatgpt")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4197 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4199 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4253 pattern=debug context=likely_guard_or_diagnostic line="is_debug_mode",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4255 pattern=debug context=likely_guard_or_diagnostic line="set_debug_mode",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4347 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import reject_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4363 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _dispatch_to_gui, _log, _now, _notify_status, is_debug_mode`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4410 pattern=legacy context=likely_guard_or_diagnostic line=legacy_err = reject_legacy_fields(body, context="api_bridge")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4411 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_err:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4412 pattern=legacy context=likely_guard_or_diagnostic line=return jsonify(legacy_err[0]), legacy_err[1]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4419 pattern=debug context=likely_guard_or_diagnostic line=elif not _is_local_remote_addr(remote_addr) and is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4449 pattern=debug context=likely_guard_or_diagnostic line=debug_status = bool(body.get("debug_status")) or is_debug_mode()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4455 pattern=debug context=likely_guard_or_diagnostic line=if debug_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4458 pattern=debug context=likely_guard_or_diagnostic line=if debug_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4477 pattern=DEBUG_ context=likely_guard_or_diagnostic line=from app.constants import DEBUG_FULL_BRIDGE_JSON`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4478 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _is_bridge_debug_enabled, _log`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4497 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if not DEBUG_FULL_BRIDGE_JSON:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4508 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4511 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4519 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4522 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4523 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4676 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4681 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server._queue_control_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4789 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server._make_command_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5087 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5093 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _log, is_debug_mode`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5103 pattern=debug context=likely_guard_or_diagnostic line=if not is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5118 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5136 pattern=debug context=likely_guard_or_diagnostic line=should_log = is_debug_mode() or status_code >= 400`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5154 pattern=trace context=likely_guard_or_diagnostic line=f"error_type={type(error).__name__} error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5197 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5366 pattern=trace context=likely_guard_or_diagnostic line=f"task_id={task_id} error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5566 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5763 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5968 pattern=fallback context=likely_guard_or_diagnostic line=f"type={type(gui_result).__name__} fallback=empty"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6037 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6239 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6338 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6475 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6705 pattern=fallback context=likely_guard_or_diagnostic line=f"limit={raw_limit!r} fallback=50 "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6784 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6804 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6817 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6949 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (payload.get("trace_id") or "").strip() or None`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6956 pattern=trace context=likely_guard_or_diagnostic line="trace_id": trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6975 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server.push_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6980 pattern=trace context=likely_guard_or_diagnostic line=f"[CHAT_QUEUE][PUT_FAIL] trace_id={trace_id or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6995 pattern=trace context=likely_guard_or_diagnostic line=f"[CHAT_QUEUE][PUT_OK] trace_id={trace_id or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7191 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7402 pattern=fallback context=likely_guard_or_diagnostic line=def _sync_conversation_fallback_match(msg, body):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7722 pattern=fallback context=likely_guard_or_diagnostic line=msg = _rotate(lambda m: _sync_conversation_fallback_match(m, body))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7739 pattern=fallback context=likely_guard_or_diagnostic line=f"command_count=1 fallback=same_conversation"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7905 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(dict(msg), owner="server._poll_response")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7944 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(resp, owner="server._poll_response")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8046 pattern=debug context=likely_guard_or_diagnostic line=if not st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8066 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8080 pattern=trace context=likely_guard_or_diagnostic line=f"trace_id={(msg.get('trace_id') or '-')} text_len={len(text)} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8088 pattern=trace context=likely_guard_or_diagnostic line=f"trace_id={(msg.get('trace_id') or '-')}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8101 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode or bool(body.get("debug_status")):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8112 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8120 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8142 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8164 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8226 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8269 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8279 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8317 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9123 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9177 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9330 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9390 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9405 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9427 pattern=trace context=likely_guard_or_diagnostic line=f"body_preview={preview!r}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9446 pattern=trace context=likely_guard_or_diagnostic line=f"body_preview={preview!r}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9510 pattern=enable_ context=needs_manual_review line=def enable_external_api() -> bool:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9512 pattern=os.environ context=needs_manual_review line=flag = os.environ.get("CHATGPT_BRIDGE_ENABLE_EXTERNAL_API", "").strip().lower()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9525 pattern=enable_ context=needs_manual_review line=from app.server.route_flags import enable_external_api`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9539 pattern=enable_ context=needs_manual_review line=if not enable_external_api():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9554 pattern=debug context=likely_guard_or_diagnostic line="""Server lifecycle, logging, callbacks, debug mode."""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9561 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9582 pattern=debug context=likely_guard_or_diagnostic line=if not is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9586 pattern=debug context=likely_guard_or_diagnostic line=def set_debug_mode(enabled):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9587 pattern=debug context=likely_guard_or_diagnostic line=st._debug_mode = bool(enabled)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9591 pattern=debug context=likely_guard_or_diagnostic line=def is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9593 pattern=debug context=likely_guard_or_diagnostic line=return bool(st._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9637 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9670 pattern=debug context=likely_guard_or_diagnostic line=def _is_bridge_debug_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9671 pattern=debug context=likely_guard_or_diagnostic line=return bool(st._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9675 pattern=debug context=likely_guard_or_diagnostic line=if _is_bridge_debug_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9715 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9741 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9750 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9800 pattern=deprecated context=likely_guard_or_diagnostic line="""@deprecated 仅兼容旧调用；业务判断请用 is_page_online(page)。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9811 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9826 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9921 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9990 pattern=enable_ context=needs_manual_review line=from app.server.route_flags import enable_external_api`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9992 pattern=enable_ context=needs_manual_review line=if enable_external_api():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9997 pattern=fallback context=likely_guard_or_diagnostic line=def start_server(host="127.0.0.1", port=5000, fallback_ports=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10003 pattern=fallback context=likely_guard_or_diagnostic line=extra_ports = list(fallback_ports if fallback_ports is not None else st.FALLBACK_PORTS)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10006 pattern=fallback context=likely_guard_or_diagnostic line=f"host={bind_host} port={port} fallback_ports={extra_ports} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10007 pattern=debug context=likely_guard_or_diagnostic line=f"debug={is_debug_mode()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10043 pattern=fallback context=likely_guard_or_diagnostic line=field="fallback_port",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10059 pattern=debug context=likely_guard_or_diagnostic line=if not is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10101 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback_used={candidate_port != configured_port} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10116 pattern=fallback context=likely_guard_or_diagnostic line="fallback_used": candidate_port != configured_port,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10142 pattern=fallback context=likely_guard_or_diagnostic line="fallback_used": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10166 pattern=trace context=likely_guard_or_diagnostic line=f"error_type={type(error).__name__} error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10220 pattern=debug context=likely_guard_or_diagnostic line=_debug_mode = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10223 pattern=os.environ context=needs_manual_review line=API_TOKEN = os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10317 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10452 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10479 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10500 pattern=fallback context=likely_guard_or_diagnostic line=gui_result = execute_system_hotkey(hotkey, source=source or "api_fallback")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10537 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10554 pattern=debug context=likely_guard_or_diagnostic line=_is_bridge_debug_enabled,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10561 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10645 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10655 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode or bool(body.get("debug_status")):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10765 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode or _is_bridge_debug_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10921 pattern=fallback context=likely_guard_or_diagnostic line=conversation_fallback_info = None`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10955 pattern=fallback context=likely_guard_or_diagnostic line=context="get_tm_online_summary.conversation_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10959 pattern=fallback context=likely_guard_or_diagnostic line=conversation_fallback_info,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10961 pattern=fallback context=likely_guard_or_diagnostic line=context="get_tm_online_summary.conversation_fallback_old",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10963 pattern=fallback context=likely_guard_or_diagnostic line=if conversation_fallback_info`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10966 pattern=fallback context=likely_guard_or_diagnostic line=if conversation_fallback_info is None or current_seen >= old_seen:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10967 pattern=fallback context=likely_guard_or_diagnostic line=conversation_fallback_info = info`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10996 pattern=fallback context=likely_guard_or_diagnostic line=fallback_online = bool(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10997 pattern=fallback context=likely_guard_or_diagnostic line=isinstance(conversation_fallback_info, dict)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:10998 pattern=fallback context=likely_guard_or_diagnostic line=and is_page_online(conversation_fallback_info)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11001 pattern=fallback context=likely_guard_or_diagnostic line=bound_effective_online = exact_bound_online or fallback_online`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11007 pattern=fallback context=likely_guard_or_diagnostic line=same_conversation_online = fallback_online`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11019 pattern=fallback context=likely_guard_or_diagnostic line=elif fallback_online:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11020 pattern=fallback context=likely_guard_or_diagnostic line=bound_page_type = (conversation_fallback_info.get("page_type") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11022 pattern=fallback context=likely_guard_or_diagnostic line=(conversation_fallback_info.get("client_id") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11025 pattern=fallback context=likely_guard_or_diagnostic line=bound_match_mode = "conversation_fallback"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11026 pattern=fallback context=likely_guard_or_diagnostic line=binding_match_mode = "conversation_fallback"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11029 pattern=fallback context=likely_guard_or_diagnostic line=conversation_fallback_info.get("page_instance_id") or ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11106 pattern=debug context=likely_guard_or_diagnostic line=if is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11107 pattern=debug context=likely_guard_or_diagnostic line=row["debug_detail"] = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11110 pattern=debug context=likely_guard_or_diagnostic line=row["debug_detail"].update({`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11157 pattern=debug context=likely_guard_or_diagnostic line=if not st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11241 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import reject_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11244 pattern=legacy context=likely_guard_or_diagnostic line=legacy_reject = reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11247 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_reject:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11248 pattern=legacy context=likely_guard_or_diagnostic line=body, _status = legacy_reject`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11249 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(body.get("error") or "legacy_fields_not_allowed")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11421 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11626 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11862 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11882 pattern=legacy context=likely_guard_or_diagnostic line="error": "legacy field file_path is not allowed, use path",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11912 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11937 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11966 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11973 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11975 pattern=enable_ context=needs_manual_review line=from app.server.route_flags import enable_external_api`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:11982 pattern=QSettings context=needs_manual_review line=from PyQt5.QtCore import QSettings, Qt, QTimer`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12027 pattern=enable_ context=needs_manual_review line=if enable_external_api():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12045 pattern=QSettings context=needs_manual_review line=self._settings = QSettings(SETTINGS_ORG, SETTINGS_APP)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12069 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12084 pattern=settings.value context=needs_manual_review line=saved_session_id = self._settings.value("current_session_id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12150 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12157 pattern=trace context=likely_guard_or_diagnostic line=detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12455 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12465 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12494 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, make_send_trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12697 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12713 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12722 pattern=trace context=likely_guard_or_diagnostic line=+ f"\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12759 pattern=ENV context=needs_manual_review line=_PENDING_ENVELOPE_KEYS = frozenset(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12776 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import LEGACY_FIELD_NAMES`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12779 pattern=legacy context=likely_guard_or_diagnostic line=envelope_legacy = sorted(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12782 pattern=ENV context=likely_guard_or_diagnostic line=if k in LEGACY_FIELD_NAMES and k not in self._PENDING_ENVELOPE_KEYS`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12784 pattern=legacy context=likely_guard_or_diagnostic line=if envelope_legacy:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12785 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(f"legacy fields in pending: {envelope_legacy}")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12787 pattern=legacy context=likely_guard_or_diagnostic line=payload_legacy = sorted(set(payload.keys()) & LEGACY_FIELD_NAMES)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12788 pattern=legacy context=likely_guard_or_diagnostic line=if payload_legacy:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12789 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(f"legacy fields in pending payload: {payload_legacy}")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12807 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12808 pattern=trace context=likely_guard_or_diagnostic line=payload.get("trace_id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12810 pattern=trace context=likely_guard_or_diagnostic line=self._get_active_send_trace_id()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12811 pattern=trace context=likely_guard_or_diagnostic line=if hasattr(self, "_get_active_send_trace_id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12828 pattern=trace context=likely_guard_or_diagnostic line="trace_id": trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12923 pattern=trace context=likely_guard_or_diagnostic line=def _log_chat_queue_event(self, tag, *, trace_id="-", **fields):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12925 pattern=trace context=likely_guard_or_diagnostic line=tag + " " + kv_line(trace_id=trace_id or "-", **fields),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12950 pattern=trace context=likely_guard_or_diagnostic line=trace_id = ctx["trace_id"]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12955 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12965 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:12986 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13000 pattern=trace context=likely_guard_or_diagnostic line=detail = traceback.format_exc()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13004 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13023 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13035 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13051 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13381 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13464 pattern=debug context=likely_guard_or_diagnostic line=def _is_debug_mode_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13466 pattern=debug context=likely_guard_or_diagnostic line=getattr(self, "_debug_mode_enabled", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13467 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "debug_mode_enabled", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13468 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "_debug_mode", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13469 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "debug_mode", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13478 pattern=debug context=likely_guard_or_diagnostic line=debug_mode=self._is_debug_mode_enabled(),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13504 pattern=debug context=likely_guard_or_diagnostic line=def _debug_status_step(self, text):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13505 pattern=debug context=likely_guard_or_diagnostic line=if not self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13597 pattern=trace context=likely_guard_or_diagnostic line=detail = f"刷新桥接状态失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13739 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] start")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13769 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] service_label")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13791 pattern=verbose context=needs_manual_review line=if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13800 pattern=verbose context=needs_manual_review line=verbose_tm_tip = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13801 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13802 pattern=verbose context=needs_manual_review line=and self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13804 pattern=verbose context=needs_manual_review line=if verbose_tm_tip:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13841 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] tm_summary")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13850 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] page_registry_deferred")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13857 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13875 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] page_registry_scheduled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13878 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] status_summary")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13905 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] done")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:13907 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:14763 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:14807 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:14814 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:14848 pattern=fallback context=likely_guard_or_diagnostic line=if result.get("fallback_used"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:14867 pattern=trace context=likely_guard_or_diagnostic line=detail = f"服务停止失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15099 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15199 pattern=trace context=likely_guard_or_diagnostic line=trace_id = make_send_trace_id(session.session_id if session else "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15200 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id(trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15204 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15216 pattern=trace context=likely_guard_or_diagnostic line=content, session=session, trace_id=trace_id, button=button`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15270 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id("")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15297 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15321 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15393 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15394 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15422 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:15579 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:16077 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:16181 pattern=legacy context=likely_guard_or_diagnostic line=if hasattr(self, "_normalize_legacy_message_dict"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:16183 pattern=legacy context=likely_guard_or_diagnostic line=item = self._normalize_legacy_message_dict(item)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:16225 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote, owner="GUI save session.remote_chatgpt")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17122 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17130 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17132 pattern=fallback context=likely_guard_or_diagnostic line=fallback = self._format_conversation_stats_text(self._EMPTY_CONVERSATION_STATS)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17133 pattern=fallback context=likely_guard_or_diagnostic line=label.setText(fallback)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17134 pattern=fallback context=likely_guard_or_diagnostic line=label.setToolTip(fallback)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17140 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc} traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17147 pattern=trace context=likely_guard_or_diagnostic line=traceback.format_exc(),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17167 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17475 pattern=trace context=likely_guard_or_diagnostic line=detail_body = f"{read_error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17481 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17497 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17511 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17531 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\nraw={raw}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17605 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17656 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17657 pattern=verbose context=needs_manual_review line=and not self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17678 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17679 pattern=verbose context=needs_manual_review line=and not self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17720 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17721 pattern=verbose context=needs_manual_review line=and not self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17898 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:17985 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18094 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18144 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18503 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18505 pattern=fallback context=likely_guard_or_diagnostic line=allow_same_conversation_fallback=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18517 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18518 pattern=fallback context=likely_guard_or_diagnostic line=allow_same_conversation_fallback=allow_same_conversation_fallback,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18689 pattern=trace context=likely_guard_or_diagnostic line=detail = f"消息入队失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18828 pattern=legacy context=likely_guard_or_diagnostic line=legacy = remote.get(key, default)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18829 pattern=legacy context=likely_guard_or_diagnostic line=if legacy not in (None, "", 0, 0.0, False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:18830 pattern=legacy context=likely_guard_or_diagnostic line=return legacy`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19416 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][SKIP_IDLE_HOME] client_id={client_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19442 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][IDLE_HOME_CANDIDATES] session_id={session_id or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19457 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][SELECT_IDLE_HOME] session_id={session_id or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19516 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][REPLACE] old={self._auto_bind.pending_session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19561 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][OPEN_HOME_ON_SEND] session_id={session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19567 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][WAITING_HOME] session_id={session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19573 pattern=AUTO_ context=needs_manual_review line=_AUTO_BIND_HOME_WAIT_SEC = 8.0`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19574 pattern=AUTO_ context=needs_manual_review line=_AUTO_BIND_HOME_POLL_SEC = 0.3`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19608 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][STATUS_FETCH_FAILED] error={exc!r}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19636 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][STATUS_FETCH_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19694 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][SUCCESS] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19708 pattern=AUTO_ context=needs_manual_review line=deadline = time.time() + self._AUTO_BIND_HOME_WAIT_SEC`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19717 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][POLL_STATUS_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19735 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][PROCESS_EVENTS_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19739 pattern=AUTO_ context=needs_manual_review line=time.sleep(self._AUTO_BIND_HOME_POLL_SEC)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19741 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][TIMEOUT] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19744 pattern=AUTO_ context=needs_manual_review line=f"wait_sec={int(self._AUTO_BIND_HOME_WAIT_SEC)}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19752 pattern=AUTO_ context=needs_manual_review line=deadline = time.time() + self._AUTO_BIND_HOME_WAIT_SEC`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19761 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][POLL_STATUS_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19777 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][FOUND] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19794 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][PROCESS_EVENTS_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19798 pattern=AUTO_ context=needs_manual_review line=time.sleep(self._AUTO_BIND_HOME_POLL_SEC)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19800 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][TIMEOUT] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19802 pattern=AUTO_ context=needs_manual_review line=f"wait_sec={int(self._AUTO_BIND_HOME_WAIT_SEC)}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19902 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][SKIP_DUPLICATE] reason=in_progress "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19915 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][START] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19933 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][OPEN_FAILED] reason=no_open_handler",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19940 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][OPEN_REQUESTED] opened={'true' if opened else 'false'}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19947 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19950 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][ERROR] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:19951 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc!r}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:20057 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][RELEASE_STALE_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:20113 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][USE_IDLE_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:20117 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][RESERVE_IDLE_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:20142 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][FIRST_SEND_BLOCKED] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:20556 pattern=fallback context=likely_guard_or_diagnostic line=f"reason=missing_page_instance_id fallback=page_no_only",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21169 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][MANUAL_HINT] session={current_session_id[:8]} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21272 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][RECOVER_WAITING_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21314 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][REPAIR_TOKEN_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21345 pattern=AUTO_ context=needs_manual_review line=self._append_log(f"[AUTO_BIND][TIMEOUT] session_id={session_id}")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21385 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][SKIP_HOME_TOKEN_MISMATCH] session_id={session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21444 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][WAITING_HOME_MATCH] session_id={session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21648 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][UPDATE_URL] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21776 pattern=trace context=likely_guard_or_diagnostic line=def _get_active_trace_id(self, attr_name, log_prefix):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21787 pattern=trace context=likely_guard_or_diagnostic line=def _set_active_trace_id(self, attr_name, trace_id, log_prefix):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21788 pattern=trace context=likely_guard_or_diagnostic line=if trace_id is None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21791 pattern=trace context=likely_guard_or_diagnostic line=if callable(trace_id):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21793 pattern=trace context=likely_guard_or_diagnostic line=f"[{log_prefix}][TRACE_ID_INVALID] trying to set callable trace_id, ignored"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21797 pattern=trace context=likely_guard_or_diagnostic line=setattr(self, attr_name, str(trace_id).strip())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21799 pattern=trace context=likely_guard_or_diagnostic line=def _get_active_send_trace_id(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21800 pattern=trace context=likely_guard_or_diagnostic line=return self._get_active_trace_id("_active_send_trace_id_value", "SEND")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21802 pattern=trace context=likely_guard_or_diagnostic line=def _set_active_send_trace_id(self, trace_id):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21803 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_trace_id("_active_send_trace_id_value", trace_id, "SEND")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21805 pattern=trace context=likely_guard_or_diagnostic line=def _get_active_sync_trace_id(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21806 pattern=trace context=likely_guard_or_diagnostic line=return self._get_active_trace_id("_active_sync_trace_id_value", "SYNC")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21808 pattern=trace context=likely_guard_or_diagnostic line=def _set_active_sync_trace_id(self, trace_id):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21809 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_trace_id("_active_sync_trace_id_value", trace_id, "SYNC")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21935 pattern=fallback context=likely_guard_or_diagnostic line=fallback_info = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21967 pattern=fallback context=likely_guard_or_diagnostic line=**fallback_info,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21970 pattern=fallback context=likely_guard_or_diagnostic line="conversation_id": page.conversation_id or fallback_info["conversation_id"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21971 pattern=fallback context=likely_guard_or_diagnostic line="url": page.url or fallback_info["url"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21972 pattern=fallback context=likely_guard_or_diagnostic line="page_type": page.page_type or fallback_info["page_type"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:21990 pattern=fallback context=likely_guard_or_diagnostic line=return fallback_info, "offline", reason_code or "bound_info_missing"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22177 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][BOOTSTRAP_RETRY] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22302 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22575 pattern=debug context=likely_guard_or_diagnostic line=self, "_debug_logging_enabled"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22576 pattern=debug context=likely_guard_or_diagnostic line=) and self._debug_logging_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22624 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22625 pattern=fallback context=likely_guard_or_diagnostic line=allow_same_conversation_fallback=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22659 pattern=fallback context=likely_guard_or_diagnostic line=del allow_same_conversation_fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22664 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22704 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22714 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, page_type_label`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22721 pattern=trace context=likely_guard_or_diagnostic line=def _log_send_bind_check(self, session, action="send", *, trace_id=""):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22722 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (trace_id or self._get_active_send_trace_id() or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22809 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22841 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:22857 pattern=AUTO_ context=needs_manual_review line="[BIND][AUTO_REBIND] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23231 pattern=fallback context=likely_guard_or_diagnostic line="unbound_fallback_current_page": "未绑定，回退到当前页",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23450 pattern=fallback context=likely_guard_or_diagnostic line=if bound_match_mode == "conversation_fallback":`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23707 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23934 pattern=verbose context=needs_manual_review line=if self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23937 pattern=verbose context=needs_manual_review line=verbose_state = "在线"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23938 pattern=verbose context=needs_manual_review line=verbose_chip = "ok"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23940 pattern=verbose context=needs_manual_review line=verbose_state = "离线"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23941 pattern=verbose context=needs_manual_review line=verbose_chip = "warn"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23943 pattern=verbose context=needs_manual_review line=verbose_state = "未绑定"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23944 pattern=verbose context=needs_manual_review line=verbose_chip = "warn"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23946 pattern=verbose context=needs_manual_review line=verbose_state = "未绑定"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23947 pattern=verbose context=needs_manual_review line=verbose_chip = "warn"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23949 pattern=verbose context=needs_manual_review line=STATUS_CHIP_SESSION_BIND_PREFIX, verbose_state`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:23951 pattern=verbose context=needs_manual_review line=chip_state = verbose_chip`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24001 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24159 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24212 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24245 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24255 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24306 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24327 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback={last_seen_val} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24399 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24712 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24814 pattern=trace context=likely_guard_or_diagnostic line=detail = f"打开页面失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24828 pattern=enable_ context=needs_manual_review line=def _session_openable_chatgpt_url(self, session):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24832 pattern=enable_ context=needs_manual_review line=def _live_openable_chatgpt_url(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24936 pattern=fallback context=likely_guard_or_diagnostic line=def _open_bound_page_for_session(self, session, label="", fallback_live=False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24957 pattern=enable_ context=needs_manual_review line=url = self._session_openable_chatgpt_url(session)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24958 pattern=fallback context=likely_guard_or_diagnostic line=if not url and fallback_live:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:24959 pattern=enable_ context=needs_manual_review line=url = self._live_openable_chatgpt_url()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:25003 pattern=trace context=likely_guard_or_diagnostic line=detail = f"open_url 入队失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:25197 pattern=trace context=likely_guard_or_diagnostic line=detail = f"close_self 入队失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:25259 pattern=trace context=likely_guard_or_diagnostic line=detail = f"批量关闭页面失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:25411 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:25509 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:25528 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:25717 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:25814 pattern=verbose context=needs_manual_review line=if hasattr(self, "_is_ui_verbose_status_enabled") and self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26259 pattern=fallback context=likely_guard_or_diagnostic line=self._safe_log_fallback(log_exc, message)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26261 pattern=fallback context=likely_guard_or_diagnostic line=self._safe_log_fallback(log_exc, message)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26264 pattern=fallback context=likely_guard_or_diagnostic line=def _safe_log_fallback(self, log_exc, message):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26267 pattern=trace context=likely_guard_or_diagnostic line=f"error={log_exc} traceback={traceback.format_exc()} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26371 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26372 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26460 pattern=verbose context=needs_manual_review line=if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26849 pattern=fallback context=likely_guard_or_diagnostic line=from app.utils.page_status import PageRegistry, find_online_fallback_page_for_binding`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26855 pattern=fallback context=likely_guard_or_diagnostic line=fallback, _matched_by = find_online_fallback_page_for_binding(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26860 pattern=fallback context=likely_guard_or_diagnostic line=if fallback is not None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26861 pattern=fallback context=likely_guard_or_diagnostic line=raw = fallback._raw if isinstance(fallback._raw, dict) else {}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26961 pattern=AUTO_ context=needs_manual_review line=AUTO_RELINK_FRESH_PAGE_REASONS = frozenset(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26965 pattern=fallback context=likely_guard_or_diagnostic line="before_send_offline_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:26970 pattern=AUTO_ context=needs_manual_review line=AUTO_BIND_MISMATCH_BLOCK_TYPES = frozenset(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27038 pattern=AUTO_ context=needs_manual_review line=if (bind_reason or "").strip() in self.AUTO_RELINK_FRESH_PAGE_REASONS:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27043 pattern=AUTO_ context=needs_manual_review line=if mismatch in self.AUTO_BIND_MISMATCH_BLOCK_TYPES:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27180 pattern=fallback context=likely_guard_or_diagnostic line=def _log_action_target_fallback(self, session, remote, target, *, reason=""):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27191 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback_client_id={target.get('client_id') or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27192 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback_page_instance_id={target.get('page_instance_id') or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27193 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback_conversation_id={target.get('conversation_id') or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27229 pattern=deprecated context=likely_guard_or_diagnostic line=def _selected_page_mismatch_blocks_action_deprecated(self, session, action, *, status=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27431 pattern=deprecated context=likely_guard_or_diagnostic line=mismatch, mismatch_reason = self._selected_page_mismatch_blocks_action_deprecated(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27484 pattern=debug context=likely_guard_or_diagnostic line=not hasattr(self, "_is_debug_mode_enabled") or self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27486 pattern=debug context=likely_guard_or_diagnostic line=debug_on = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27487 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27499 pattern=debug context=likely_guard_or_diagnostic line=compact=not debug_on,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27600 pattern=fallback context=likely_guard_or_diagnostic line=if resolved.get("offline_fallback") and page is not None and hasattr(self, "_append_log"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27634 pattern=fallback context=likely_guard_or_diagnostic line="before_send_offline_fallback"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27635 pattern=fallback context=likely_guard_or_diagnostic line=if resolved.get("offline_fallback") and action == "send"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27642 pattern=fallback context=likely_guard_or_diagnostic line=if resolved.get("offline_fallback") and hasattr(self, "_append_log"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27673 pattern=fallback context=likely_guard_or_diagnostic line=reason="offline_fallback_rebind",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27675 pattern=fallback context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and not resolved.get("offline_fallback"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:27946 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][USE_IDLE_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28127 pattern=enable_ context=needs_manual_review line=live = self._live_openable_chatgpt_url()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28334 pattern=fallback context=likely_guard_or_diagnostic line=def is_same_conversation_fallback_enabled(self, action="", session=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28335 pattern=fallback context=likely_guard_or_diagnostic line="""强绑定模式：禁止同 conversation / 其它页面 fallback。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28339 pattern=fallback context=likely_guard_or_diagnostic line=def _same_conversation_fallback_enabled(self, action="", session=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28340 pattern=fallback context=likely_guard_or_diagnostic line=return self.is_same_conversation_fallback_enabled(action, session=session)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28464 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28491 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, make_sync_trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28505 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str = ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28540 pattern=legacy context=likely_guard_or_diagnostic line=legacy = getattr(self, "_pending_web_sync_requests", None)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28541 pattern=legacy context=likely_guard_or_diagnostic line=if isinstance(legacy, dict):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28542 pattern=legacy context=likely_guard_or_diagnostic line=return legacy`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28598 pattern=legacy context=likely_guard_or_diagnostic line=# legacy fallback: 无当前 session 时返回空快照，保持原 UI 字段集合。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28621 pattern=verbose context=needs_manual_review line=if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28744 pattern=verbose context=needs_manual_review line=verbose_status = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28745 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28746 pattern=verbose context=needs_manual_review line=and self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28748 pattern=verbose context=needs_manual_review line=if verbose_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28767 pattern=verbose context=needs_manual_review line=if verbose_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28770 pattern=verbose context=needs_manual_review line=if verbose_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28812 pattern=verbose context=needs_manual_review line=if verbose_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28926 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:28980 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:29508 pattern=trace context=likely_guard_or_diagnostic line=sync_trace_id = (pending_sync.get("trace_id") or web_pending.get("trace_id") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:29525 pattern=trace context=likely_guard_or_diagnostic line=trace_id=sync_trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:29908 pattern=trace context=likely_guard_or_diagnostic line=trace_id = self._get_active_sync_trace_id()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:29909 pattern=trace context=likely_guard_or_diagnostic line=if not trace_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:29910 pattern=trace context=likely_guard_or_diagnostic line=trace_id = make_sync_trace_id(session_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:29911 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_sync_trace_id(trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:29921 pattern=fallback context=likely_guard_or_diagnostic line=f"raw={raw_max_messages!r} fallback=10 "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30043 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30113 pattern=trace context=likely_guard_or_diagnostic line=trace_id = plan.trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30140 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30235 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30272 pattern=trace context=likely_guard_or_diagnostic line="trace_id": plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30311 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30557 pattern=fallback context=likely_guard_or_diagnostic line=session, label="wait_conversation_sync", fallback_live=False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30845 pattern=enable_ context=needs_manual_review line=url = self._session_openable_chatgpt_url(session)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:30856 pattern=fallback context=likely_guard_or_diagnostic line=fallback_live=True,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:31041 pattern=trace context=likely_guard_or_diagnostic line=error_text = traceback.format_exc()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:31045 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc} traceback={error_text}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:31703 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:31966 pattern=debug context=likely_guard_or_diagnostic line=and hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:31967 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32392 pattern=fallback context=likely_guard_or_diagnostic line=identity_key = f"url_fallback:{norm_url}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32535 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32608 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32609 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32755 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32756 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32799 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32800 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32919 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:32920 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33187 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33215 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, make_send_trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33342 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str = "",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33347 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (trace_id or make_send_trace_id(session.session_id)).strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33354 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33516 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str = "",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33522 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (trace_id or self._get_active_send_trace_id() or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33523 pattern=trace context=likely_guard_or_diagnostic line=if trace_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33524 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id(trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33546 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:33728 pattern=deprecated context=likely_guard_or_diagnostic line=send_decision, send_reason, target_page, send_detail = ("blocked", "deprecated_resolve_send_decision", None, {})`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34051 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34063 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34071 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34100 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34188 pattern=trace context=likely_guard_or_diagnostic line=tb = traceback.format_exc() if error else ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34192 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34200 pattern=trace context=likely_guard_or_diagnostic line=+ (f" traceback={tb}" if tb else ""),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34274 pattern=fallback context=likely_guard_or_diagnostic line=allow_fallback = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34275 pattern=fallback context=likely_guard_or_diagnostic line=if hasattr(self, "is_same_conversation_fallback_enabled"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34276 pattern=fallback context=likely_guard_or_diagnostic line=allow_fallback = self.is_same_conversation_fallback_enabled(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34291 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34292 pattern=fallback context=likely_guard_or_diagnostic line=allow_same_conversation_fallback=allow_fallback,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34299 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34314 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34323 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34327 pattern=trace context=likely_guard_or_diagnostic line=f"error_type={type(exc).__name__} error={exc}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34348 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34362 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34397 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34416 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34448 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34472 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34489 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34534 pattern=settings.value context=needs_manual_review line=value = self._settings.value("auto_open_chatgpt_on_new_session")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34612 pattern=debug context=likely_guard_or_diagnostic line=if not self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34646 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34822 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:34937 pattern=AUTO_ context=needs_manual_review line="[SESSION_TITLE][AUTO_FROM_MESSAGES] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:35775 pattern=verbose context=needs_manual_review line=verbose = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:35776 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:35777 pattern=verbose context=needs_manual_review line=and self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:35779 pattern=verbose context=needs_manual_review line=if verbose and remote_binding_enabled(remote):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:35992 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36026 pattern=fallback context=likely_guard_or_diagnostic line=fallback_live=(session_id == self._current_session_id),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36038 pattern=enable_ context=needs_manual_review line=open_url = self._session_openable_chatgpt_url(session)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36040 pattern=enable_ context=needs_manual_review line=open_url = self._live_openable_chatgpt_url()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36060 pattern=fallback context=likely_guard_or_diagnostic line=fallback_live=(session_id == self._current_session_id),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36480 pattern=migrate context=needs_manual_review line=def _migrate_loaded_session_messages(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36671 pattern=fallback context=likely_guard_or_diagnostic line=fallback = time.time() if default is None else default`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36672 pattern=fallback context=likely_guard_or_diagnostic line=return safe_float_field(data, field, fallback)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36675 pattern=legacy context=likely_guard_or_diagnostic line=def _normalize_legacy_message_dict(data):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36677 pattern=legacy context=likely_guard_or_diagnostic line=for legacy_key in ("text", "message", "prompt", "raw_content"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36678 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_key in item and not (item.get("content") or "").strip():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36679 pattern=legacy context=likely_guard_or_diagnostic line=item["content"] = item.pop(legacy_key)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36681 pattern=legacy context=likely_guard_or_diagnostic line=item.pop(legacy_key, None)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36705 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36708 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(item, owner="session_message_load")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36733 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote, owner="GUI save session.remote_chatgpt")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36761 pattern=legacy context=likely_guard_or_diagnostic line=messages.append(self._message_from_dict(self._normalize_legacy_message_dict(item)))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36839 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36870 pattern=trace context=likely_guard_or_diagnostic line=detail = f"加载对话记录失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36882 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36908 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36918 pattern=settings.value context=needs_manual_review line=saved_tabs = self._settings.value("tab_session_ids")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36927 pattern=migrate context=needs_manual_review line=self._migrate_loaded_session_messages()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36928 pattern=migrate context=needs_manual_review line=self._migrate_loaded_remote_bindings()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36943 pattern=migrate context=needs_manual_review line=def _migrate_loaded_remote_bindings(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36944 pattern=migrate context=needs_manual_review line=from app.utils.bind_runtime import migrate_transient_from_remote`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36950 pattern=migrate context=needs_manual_review line=cleaned = migrate_transient_from_remote(self, session, old_remote)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:36999 pattern=settings.value context=needs_manual_review line=geometry = self._settings.value("geometry")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37002 pattern=settings.value context=needs_manual_review line=window_state = self._settings.value("window_state")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37007 pattern=settings.value context=needs_manual_review line=main_tab_index = int(self._settings.value("main_tab_index", 0))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37046 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37050 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37058 pattern=QSettings context=needs_manual_review line=# 无设置页 UI 的布尔项：仅用 DEFAULT_APP_SETTINGS 固定值，不写入 QSettings。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37065 pattern=debug context=likely_guard_or_diagnostic line="debug_mode",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37138 pattern=legacy context=likely_guard_or_diagnostic line=def _remove_legacy_bool_qsettings(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37172 pattern=enable_ context=needs_manual_review line=self._enable_lan_access = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37182 pattern=enable_ context=needs_manual_review line="enable_lan_access",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37192 pattern=settings.value context=needs_manual_review line=self._settings.value("font_size", defaults["font_size"]),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37200 pattern=settings.value context=needs_manual_review line=self._settings.value("enter_send_mode", defaults["enter_send_mode"])`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37203 pattern=settings.value context=needs_manual_review line=self._settings.value(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37216 pattern=enable_ context=needs_manual_review line=self._enable_lan_access = bool(defaults.get("enable_lan_access", False))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37220 pattern=debug context=likely_guard_or_diagnostic line=self._debug_mode = bool(defaults.get("debug_mode", False))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37279 pattern=trace context=likely_guard_or_diagnostic line=detail = f"加载设置失败，已使用默认值：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37286 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37288 pattern=debug context=likely_guard_or_diagnostic line=verbose=self._debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37297 pattern=debug context=likely_guard_or_diagnostic line=verbose=self._debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37310 pattern=legacy context=likely_guard_or_diagnostic line=self._remove_legacy_bool_qsettings()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37315 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37638 pattern=verbose context=needs_manual_review line=if self._is_ui_verbose_status_enabled() if hasattr(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:37640 pattern=verbose context=needs_manual_review line=self, "_is_ui_verbose_status_enabled"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38356 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38553 pattern=debug context=likely_guard_or_diagnostic line=def _build_debug_page(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38630 pattern=debug context=likely_guard_or_diagnostic line=self.debug_page = self._build_debug_page()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38636 pattern=debug context=likely_guard_or_diagnostic line=self.main_tabs.addTab(self.debug_page, "调试")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38689 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38842 pattern=settings.value context=needs_manual_review line=raw = self._settings.value("ui/chat_splitter_sizes", "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38851 pattern=trace context=likely_guard_or_diagnostic line=f"invalid={raw} error={error}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38857 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38865 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:38889 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:39376 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:39673 pattern=debug context=likely_guard_or_diagnostic line=getattr(self, "_debug_mode", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:39675 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:39676 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40036 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40072 pattern=AUTO_ context=needs_manual_review line="[PAGE_SELECTOR][AUTO_REFRESH] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40074 pattern=fallback context=likely_guard_or_diagnostic line=f"reason={'matched_or_fallback_page' if restore_index >= 0 else 'no_pages_available'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40145 pattern=os.environ context=needs_manual_review line=token = (os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40297 pattern=verbose context=needs_manual_review line=def _is_ui_verbose_status_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40298 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40299 pattern=debug context=likely_guard_or_diagnostic line=return bool(self._is_debug_mode_enabled())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40300 pattern=debug context=likely_guard_or_diagnostic line=return bool(getattr(self, "_debug_mode", False))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40453 pattern=fallback context=likely_guard_or_diagnostic line=fallback = state_text or "未绑定"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40454 pattern=fallback context=likely_guard_or_diagnostic line=return f"绑定页面：页面ID:{page_no} ｜ {fallback}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40596 pattern=debug context=likely_guard_or_diagnostic line=debug_on = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40597 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40599 pattern=debug context=likely_guard_or_diagnostic line=if debug_on or throttle.allow(log_key, msg, interval_ms=10000):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40682 pattern=verbose context=needs_manual_review line=def _format_compact_tm_online_chip_verbose(self, summary):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40921 pattern=fallback context=likely_guard_or_diagnostic line=same_conv_fallback = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40935 pattern=fallback context=likely_guard_or_diagnostic line=same_conv_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:40947 pattern=fallback context=likely_guard_or_diagnostic line=if not bound_online and same_conv_fallback:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:41021 pattern=verbose context=needs_manual_review line=if self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:41041 pattern=verbose context=needs_manual_review line=verbose = self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:41046 pattern=verbose context=needs_manual_review line=if verbose and hasattr(self, "_format_tm_online_chip_text"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:41085 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:41348 pattern=trace context=likely_guard_or_diagnostic line=f"reason={fail_reason}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:41410 pattern=debug context=likely_guard_or_diagnostic line=if not getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42515 pattern=debug context=likely_guard_or_diagnostic line=def _append_input_debug_log(self, message):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42519 pattern=debug context=likely_guard_or_diagnostic line=if not getattr(main_window, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42529 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42539 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42547 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42555 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42566 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42579 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:42586 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43403 pattern=migrate context=needs_manual_review line=def migrate_transient_from_remote(host: Any, session: Any, remote: Dict[str, Any]) -> Dict[str, Any]:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43407 pattern=migrate context=needs_manual_review line=migrated = {}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43414 pattern=migrate context=needs_manual_review line=migrated[key] = val`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43415 pattern=migrate context=needs_manual_review line=if migrated:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43416 pattern=migrate context=needs_manual_review line=update_bind_runtime(host, session, **migrated)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43428 pattern=migrate context=needs_manual_review line="migrate_transient_from_remote",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43443 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43469 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43492 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43494 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43495 pattern=legacy context=likely_guard_or_diagnostic line=reject_legacy_fields,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43566 pattern=settings.value context=needs_manual_review line=val = (settings.value("last_url") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43588 pattern=deprecated context=likely_guard_or_diagnostic line=# @deprecated-migration:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43591 pattern=migration context=likely_guard_or_diagnostic line=from app.utils.deprecation_log import log_migration_hit`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43593 pattern=legacy context=likely_guard_or_diagnostic line=for legacy_key in ("last_page_url", "page_url", "conversation_url"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43594 pattern=legacy context=likely_guard_or_diagnostic line=if settings.contains(legacy_key):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43595 pattern=migration context=likely_guard_or_diagnostic line=log_migration_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43597 pattern=legacy context=likely_guard_or_diagnostic line=old=legacy_key,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43599 pattern=legacy context=likely_guard_or_diagnostic line=reason="cleanup_legacy_qsettings_key",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43601 pattern=legacy context=likely_guard_or_diagnostic line=settings.remove(legacy_key)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43609 pattern=legacy context=likely_guard_or_diagnostic line="""只读 payload['url']；旧 URL 字段由 reject_legacy_fields 拒绝。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43635 pattern=legacy context=likely_guard_or_diagnostic line=legacy_reject = reject_legacy_fields(data, context="normalize_inbound_push_payload")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43636 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_reject:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43637 pattern=legacy context=likely_guard_or_diagnostic line=body, _status = legacy_reject`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43638 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(body.get("error") or "legacy_fields_not_allowed")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43664 pattern=trace context=likely_guard_or_diagnostic line="trace_id",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43700 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str = "",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43734 pattern=trace context=likely_guard_or_diagnostic line="trace_id": (trace_id or "").strip(),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43765 pattern=legacy context=likely_guard_or_diagnostic line=legacy_err = reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43766 pattern=migrate context=needs_manual_review line=out, context="validate_outbound_queue_message", migrate=False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43768 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_err:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43769 pattern=legacy context=likely_guard_or_diagnostic line=body, _status = legacy_err`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43770 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(body.get("error") or "legacy_fields_not_allowed")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43771 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(out, owner="validate_outbound_queue_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43811 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(out, owner="normalize_outbound_bridge_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43831 pattern=deprecated context=likely_guard_or_diagnostic line=def log_deprecated_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43850 pattern=migration context=likely_guard_or_diagnostic line=def log_migration_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43878 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43887 pattern=trace context=likely_guard_or_diagnostic line=trace_id="-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43898 pattern=trace context=likely_guard_or_diagnostic line=f"trace_id={trace_id or '-'}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:43925 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44046 pattern=DEBUG_ context=likely_guard_or_diagnostic line=DEBUG_ONLY_GUI_TAGS = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44169 pattern=debug context=likely_guard_or_diagnostic line=def should_emit_log(level, *, debug_mode: bool = False, min_level: str = _DEFAULT_MIN_LEVEL) -> bool:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44170 pattern=debug context=likely_guard_or_diagnostic line="""默认仅 INFO 及以上；DEBUG/TRACE 需 debug_mode。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44172 pattern=debug context=likely_guard_or_diagnostic line=if norm in ("DEBUG", "TRACE") and not debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44174 pattern=debug context=likely_guard_or_diagnostic line=effective_min = "TRACE" if debug_mode else min_level`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44372 pattern=debug context=likely_guard_or_diagnostic line=def should_show_gui_log(message: str, level: str = "INFO", *, debug_mode: bool = False) -> bool:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44389 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if not debug_mode and any(tag in text for tag in DEBUG_ONLY_GUI_TAGS):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44392 pattern=debug context=likely_guard_or_diagnostic line=if level_text in ("DEBUG", "TRACE") and not debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44395 pattern=debug context=likely_guard_or_diagnostic line=if debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44519 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44564 pattern=trace context=likely_guard_or_diagnostic line="traceback": traceback.format_exc(),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44582 pattern=legacy context=likely_guard_or_diagnostic line=FILE: app/utils/legacy_cleanup.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44592 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_fields import (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44597 pattern=legacy context=likely_guard_or_diagnostic line=# reject_legacy_fields：API 入站（URL + 绑定别名 + 部分消息旧字段）。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44604 pattern=fallback context=likely_guard_or_diagnostic line="conversation_id_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44605 pattern=fallback context=likely_guard_or_diagnostic line="conversation_only_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44616 pattern=legacy context=likely_guard_or_diagnostic line=def _collect_legacy_fields(obj: Any, *, path: str = "") -> List[str]:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44626 pattern=legacy context=likely_guard_or_diagnostic line=found.extend(_collect_legacy_fields(value, path=sub))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44631 pattern=legacy context=likely_guard_or_diagnostic line=found.extend(_collect_legacy_fields(item, path=sub))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44635 pattern=legacy context=likely_guard_or_diagnostic line=def assert_no_legacy_fields(obj: Any, *, owner: str = "-") -> None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44636 pattern=legacy context=likely_guard_or_diagnostic line=found = _collect_legacy_fields(obj)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44646 pattern=legacy context=likely_guard_or_diagnostic line=f"legacy fields still exist before save: owner={owner}, fields={found}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44650 pattern=legacy context=likely_guard_or_diagnostic line=def reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44654 pattern=migrate context=needs_manual_review line=migrate: bool = False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44659 pattern=migrate context=needs_manual_review line=if migrate:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44661 pattern=legacy context=likely_guard_or_diagnostic line="legacy field migration is disabled; use canonical fields only"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44663 pattern=legacy context=likely_guard_or_diagnostic line=legacy = sorted(set(payload.keys()) & LEGACY_FIELD_NAMES)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44664 pattern=legacy context=likely_guard_or_diagnostic line=if legacy:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44668 pattern=legacy context=likely_guard_or_diagnostic line="error": "legacy_fields_not_allowed",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44670 pattern=legacy context=likely_guard_or_diagnostic line="legacy_fields": legacy,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44679 pattern=legacy context=likely_guard_or_diagnostic line="error": "legacy_fields_not_allowed",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44681 pattern=legacy context=likely_guard_or_diagnostic line="legacy_fields": [f"target_source={target_source}"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44692 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44693 pattern=legacy context=likely_guard_or_diagnostic line="reject_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44699 pattern=legacy context=likely_guard_or_diagnostic line=FILE: app/utils/legacy_fields.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44703 pattern=legacy context=likely_guard_or_diagnostic line="""Central registry of legacy field names for reject/cleanup only.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44707 pattern=fallback context=likely_guard_or_diagnostic line=These fields MUST NOT be read as valid fallback sources except via explicit`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44709 pattern=legacy context=likely_guard_or_diagnostic line=migration helpers (e.g. ``_normalize_legacy_message_dict``).`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44795 pattern=debug context=likely_guard_or_diagnostic line="debug_tm_url_syncable",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44797 pattern=debug context=likely_guard_or_diagnostic line="debug_tm_conversation_syncable",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44869 pattern=fallback context=likely_guard_or_diagnostic line=# 全量旧字段表：禁止作为 fallback 读取。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44938 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44945 pattern=os.environ context=needs_manual_review line=_LOG_VERBOSE = os.environ.get("CHATGPT_BRIDGE_VERBOSE_LOG", "0").strip().lower() in (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44951 pattern=os.environ context=needs_manual_review line=_LOG_MIRROR_TO_CONSOLE = os.environ.get("CHATGPT_BRIDGE_LOG_TO_CONSOLE", "0").strip().lower() in (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44957 pattern=os.environ context=needs_manual_review line=_LOG_INCLUDE_CALLSITE = os.environ.get("CHATGPT_BRIDGE_LOG_CALLSITE", "0").strip().lower() in (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:44963 pattern=os.environ context=needs_manual_review line=_LOG_MIN_LEVEL = os.environ.get("CHATGPT_BRIDGE_LOG_MIN_LEVEL", "INFO").strip().upper() or "INFO"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45028 pattern=verbose context=needs_manual_review line=def set_log_runtime_options(verbose=None, mirror_to_console=None, include_callsite=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45030 pattern=verbose context=needs_manual_review line=if verbose is not None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45031 pattern=verbose context=needs_manual_review line=_LOG_VERBOSE = bool(verbose)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45041 pattern=verbose context=needs_manual_review line="verbose": _LOG_VERBOSE,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45078 pattern=trace context=likely_guard_or_diagnostic line=print(f"[LOG_LEVEL][ERROR] {error}\n{traceback.format_exc()}")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45211 pattern=trace context=likely_guard_or_diagnostic line=print(traceback.format_exc())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45221 pattern=ENV context=needs_manual_review line="[APP][ENV]",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45241 pattern=trace context=likely_guard_or_diagnostic line=print(traceback.format_exc())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45273 pattern=trace context=likely_guard_or_diagnostic line=print(traceback.format_exc())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45353 pattern=fallback context=likely_guard_or_diagnostic line=find_online_fallback_page_for_binding,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45614 pattern=fallback context=likely_guard_or_diagnostic line=fallback, _matched_by = find_online_fallback_page_for_binding(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45620 pattern=fallback context=likely_guard_or_diagnostic line=if fallback is None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45623 pattern=fallback context=likely_guard_or_diagnostic line=poll_ok, _, _ = evaluate_sync_poll_freshness(fallback, now=now)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45626 pattern=fallback context=likely_guard_or_diagnostic line=return fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45841 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45855 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45861 pattern=fallback context=likely_guard_or_diagnostic line=offline_fallback_attempted = bool(bound_conv)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45862 pattern=fallback context=likely_guard_or_diagnostic line=if offline_fallback_attempted:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45874 pattern=fallback context=likely_guard_or_diagnostic line=fallback, fb_matched_by = find_online_fallback_page_for_binding(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45880 pattern=fallback context=likely_guard_or_diagnostic line=if fallback is not None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45881 pattern=fallback context=likely_guard_or_diagnostic line=fb_raw = fallback._raw if isinstance(fallback._raw, dict) else {}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45885 pattern=fallback context=likely_guard_or_diagnostic line=context="page_command.resolve.offline_fallback_poll",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45888 pattern=fallback context=likely_guard_or_diagnostic line=(fallback.client_id or "").strip() != bound_client`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45889 pattern=fallback context=likely_guard_or_diagnostic line=or (fallback.page_instance_id or "").strip() != bound_instance`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45899 pattern=fallback context=likely_guard_or_diagnostic line=(fallback.client_id or "-"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45900 pattern=fallback context=likely_guard_or_diagnostic line=(fallback.page_instance_id or "-"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45901 pattern=fallback context=likely_guard_or_diagnostic line=str(fb_raw.get("page_no") or fallback.page_display_id or "-"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45906 pattern=fallback context=likely_guard_or_diagnostic line="page": fallback,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45912 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": True,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45931 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45934 pattern=fallback context=likely_guard_or_diagnostic line=fallback = _pick_fresh_conversation_page(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45937 pattern=fallback context=likely_guard_or_diagnostic line=if fallback is None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45945 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45948 pattern=fallback context=likely_guard_or_diagnostic line=raw = fallback._raw if isinstance(fallback._raw, dict) else {}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45952 pattern=fallback context=likely_guard_or_diagnostic line=context="page_command.resolve.fallback_poll",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45955 pattern=fallback context=likely_guard_or_diagnostic line=fallback.client_id != bound_client`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45956 pattern=fallback context=likely_guard_or_diagnostic line=or fallback.page_instance_id != bound_instance`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45959 pattern=fallback context=likely_guard_or_diagnostic line="page": fallback,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:45965 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": True,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:46032 pattern=fallback context=likely_guard_or_diagnostic line=need_fallback = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:46034 pattern=fallback context=likely_guard_or_diagnostic line=need_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:46038 pattern=fallback context=likely_guard_or_diagnostic line=need_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:46039 pattern=fallback context=likely_guard_or_diagnostic line=if need_fallback and allow_same_conversation:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:46260 pattern=fallback context=likely_guard_or_diagnostic line="find_online_fallback_page_for_binding",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:46343 pattern=migrate context=needs_manual_review line="""规范化页面对象；只读规范字段（旧字段须在入站/加载边界先 migrate）。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:46595 pattern=fallback context=likely_guard_or_diagnostic line=def find_online_fallback_page_for_binding(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47448 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47485 pattern=trace context=likely_guard_or_diagnostic line=def trace_id(self) -> str:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47486 pattern=trace context=likely_guard_or_diagnostic line=return self.turn.trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47681 pattern=debug context=likely_guard_or_diagnostic line=debug_log: bool = False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47690 pattern=debug context=likely_guard_or_diagnostic line=if debug_log or log_on_error:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47935 pattern=trace context=likely_guard_or_diagnostic line=FILE: app/utils/trace_log.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47939 pattern=trace context=likely_guard_or_diagnostic line="""发送 / 绑定 / 同步链路的 trace_id 与 key=value 日志辅助。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47946 pattern=trace context=likely_guard_or_diagnostic line=def make_send_trace_id(session_id=""):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:47951 pattern=trace context=likely_guard_or_diagnostic line=def make_sync_trace_id(session_id=""):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48762 pattern=migrate context=needs_manual_review line=if (typeof migrateContinuePromptTextIfNeeded === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48763 pattern=migration context=likely_guard_or_diagnostic line=const migration = migrateContinuePromptTextIfNeeded(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48767 pattern=migration context=likely_guard_or_diagnostic line=if (migration.migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48768 pattern=migration context=likely_guard_or_diagnostic line=config.continuePromptsText = migration.value;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48798 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '未命名列表',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48812 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '默认列表',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48980 pattern=migrate context=needs_manual_review line=function migrateTaskDoneSignalForAutoQueue(value) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48981 pattern=migrate context=needs_manual_review line=if (typeof migrateTaskDoneSignalValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:48982 pattern=migrate context=needs_manual_review line=return migrateTaskDoneSignalValue(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49016 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeContinueRoundLimit(value, fallback = UNLIMITED_CONTINUE_ROUNDS) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49019 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49101 pattern=legacy context=likely_guard_or_diagnostic line=const legacyTemplate = String(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49113 pattern=legacy context=likely_guard_or_diagnostic line=continuePromptTemplate: String(legacyTemplate || ''),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49308 pattern=migrate context=needs_manual_review line=const migrateNotes = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49313 pattern=migrate context=needs_manual_review line=migrateNotes.push('init-taskProfiles-array');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49324 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '默认任务组',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49329 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:init-tasks-array`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49336 pattern=migrate context=needs_manual_review line=normalized.doneSignal = migrateTaskDoneSignalForAutoQueue(normalized.doneSignal);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49356 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:migrate-max-continue-unlimited`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49377 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:repair-template`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49395 pattern=migrate context=needs_manual_review line=migrateNotes.push('seed-default-profile-with-example-tasks');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49400 pattern=migrate context=needs_manual_review line=const summary = migrateNotes.includes('seed-default-profile-with-example-tasks')`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49403 pattern=migrate context=needs_manual_review line=const detail = migrateNotes.length ? `${migrateNotes.join('; ')}; ` : '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49405 pattern=migrate context=needs_manual_review line=} else if (migrateNotes.length) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49406 pattern=migrate context=needs_manual_review line=ToolboxShell.appendLog(`[AUTOQ][TASK][MIGRATE] ${migrateNotes.join('; ')}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49812 pattern=legacy context=likely_guard_or_diagnostic line=const legacyHeader = taskPanelEl.querySelector(':scope > .cgpt-autoq-list-header');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49813 pattern=legacy context=likely_guard_or_diagnostic line=const legacyNameRow = taskPanelEl.querySelector(':scope > .cgpt-autoq-list-name-row');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49814 pattern=legacy context=likely_guard_or_diagnostic line=const legacyList = qs('#cgpt-autoq-task-list', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49815 pattern=legacy context=likely_guard_or_diagnostic line=const legacyEditor = qs('#cgpt-autoq-task-editor', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49816 pattern=legacy context=likely_guard_or_diagnostic line=const legacyDefaults = qs('#cgpt-autoq-task-profile-defaults', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49860 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyHeader && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49864 pattern=legacy context=likely_guard_or_diagnostic line=shellHeader.replaceWith(legacyHeader);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49868 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyNameRow && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49871 pattern=legacy context=likely_guard_or_diagnostic line=if (shellNameRow && shellNameRow !== legacyNameRow) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49872 pattern=legacy context=likely_guard_or_diagnostic line=shellNameRow.replaceWith(legacyNameRow);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49876 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyList && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49879 pattern=legacy context=likely_guard_or_diagnostic line=if (shellList && shellList !== legacyList) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49880 pattern=legacy context=likely_guard_or_diagnostic line=shellList.replaceWith(legacyList);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49886 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyEditor && currentPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49889 pattern=legacy context=likely_guard_or_diagnostic line=if (shellEditor && shellEditor !== legacyEditor) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49890 pattern=legacy context=likely_guard_or_diagnostic line=shellEditor.replaceWith(legacyEditor);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49896 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyDefaults && rulesPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49899 pattern=legacy context=likely_guard_or_diagnostic line=if (shellDefaults && shellDefaults !== legacyDefaults) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49900 pattern=legacy context=likely_guard_or_diagnostic line=shellDefaults.replaceWith(legacyDefaults);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49904 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyHeader && legacyHeader.parentElement === taskPanelEl) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49905 pattern=legacy context=likely_guard_or_diagnostic line=legacyHeader.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49908 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyNameRow && legacyNameRow.parentElement === taskPanelEl) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:49909 pattern=legacy context=likely_guard_or_diagnostic line=legacyNameRow.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:51876 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_REPLY_DONE]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:53213 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_SKIP] reason=missing_context task_id=${taskId || '-'} direction=${direction || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:53224 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_SKIP] reason=button_not_found task_id=${taskId} direction=${actionName} selector=${selector}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:53243 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_OK] task_id=${taskId} direction=${actionName} delta_y=${Math.round(deltaY)} scroll_top=${Math.round(listEl.scrollTop)}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:53265 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][START] task_id=${taskId} direction=${direction} before_scroll_top=${beforeListScrollTop}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:53275 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][SKIP] task_id=${taskId} direction=${direction} reason=${reason}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:53743 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH_START_CLICK] mode=task group_id=${profile ? profile.id : '-'} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:53865 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BACKGROUND_THROTTLED] action=${actionName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:53980 pattern=legacy context=likely_guard_or_diagnostic line=kind: 'legacy',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54260 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][WAIT_SEND_BUTTON] attempt=${attempt} found=${found} disabled=${disabledFlag} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54276 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'send_button_disabled_use_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54295 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'send_button_missing_use_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54330 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=stableSendMessage_unavailable');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54386 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][TEXT_SYNC_OK] retryIndex=${retryIndex} prompt_len=${prompt.length} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54403 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][TEXT_SYNC_FAILED] reason=${lastSyncReason} prompt_len=${prompt.length} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54414 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_START]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54428 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${failReason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54434 pattern=fallback context=likely_guard_or_diagnostic line=`[AUTOQ][SEND_CLICK] task=${taskName} note=button_disabled_will_use_enter_fallback ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54458 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_OK]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54459 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][WAIT_INITIAL_REPLY]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54464 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54502 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54506 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_SEND_DONE]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54507 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_WAIT_REPLY_START]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54536 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${errText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54572 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_WAIT_RESPONDING]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54626 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH_INITIAL_PROMPT_PICKED] text_len=${initial.length} task_title=${currentTask.title}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54641 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:54660 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${errText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55186 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][FOREGROUND_RESUME] reason=${tag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55412 pattern=debug context=likely_guard_or_diagnostic line=function debugLog(text) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55555 pattern=legacy context=likely_guard_or_diagnostic line=const legacy = String(sessionStorage.getItem('xz_bind_token') || '').trim();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55556 pattern=legacy context=likely_guard_or_diagnostic line=if (legacy) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55557 pattern=legacy context=likely_guard_or_diagnostic line=clearStoredBindRequestToken('legacy-without-meta');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55763 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPathname = location && location.pathname ? location.pathname : '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55764 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackConversationId = parseConversationIdFromPath(fallbackPathname);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55767 pattern=fallback context=likely_guard_or_diagnostic line=`[getPageIdentity][failed] type=${errName} pathname=${fallbackPathname || '-'} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55773 pattern=fallback context=likely_guard_or_diagnostic line=`[BRIDGE][IDENTITY][FAILED] type=${errName} pathname=${fallbackPathname || '-'} conversation_id=${fallbackConversationId || '-'} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55777 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPageDisplayId = getCurrentBridgePageDisplayId();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55781 pattern=fallback context=likely_guard_or_diagnostic line=page_display_id: fallbackPageDisplayId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55782 pattern=fallback context=likely_guard_or_diagnostic line=page_no: fallbackPageDisplayId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55788 pattern=fallback context=likely_guard_or_diagnostic line=page_type: fallbackConversationId ? 'conversation' : 'unknown',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55789 pattern=fallback context=likely_guard_or_diagnostic line=conversation_id: fallbackConversationId || '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55794 pattern=fallback context=likely_guard_or_diagnostic line=pathname: fallbackPathname,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55807 pattern=DEBUG_ context=likely_guard_or_diagnostic line=const DEBUG_FULL_BRIDGE_JSON = false;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55843 pattern=debug context=likely_guard_or_diagnostic line=const debugEnabled = !!cfg.bridgeDebugEnabled;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:55847 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if (!DEBUG_FULL_BRIDGE_JSON && !debugEnabled) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56287 pattern=localStorage context=needs_manual_review line=localStorage.removeItem(getPendingReplyContextKey());`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56288 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56304 pattern=localStorage context=needs_manual_review line=Object.keys(localStorage).forEach((key) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56310 pattern=localStorage context=needs_manual_review line=ctx = JSON.parse(localStorage.getItem(key) || 'null');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56321 pattern=localStorage context=needs_manual_review line=localStorage.removeItem(key);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56324 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56325 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56326 pattern=legacy context=likely_guard_or_diagnostic line=let legacyCtx = null;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56328 pattern=legacy context=likely_guard_or_diagnostic line=legacyCtx = JSON.parse(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56329 pattern=legacy context=likely_guard_or_diagnostic line=} catch (legacyParseError) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56331 pattern=legacy context=likely_guard_or_diagnostic line=error_type: legacyParseError && legacyParseError.name,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56332 pattern=legacy context=likely_guard_or_diagnostic line=error: legacyParseError && legacyParseError.message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56333 pattern=legacy context=likely_guard_or_diagnostic line=stack: legacyParseError && legacyParseError.stack,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56336 pattern=legacy context=likely_guard_or_diagnostic line=const legacySentAt = Number((legacyCtx && legacyCtx.sent_at) || 0);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56337 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx || legacyCtx.reply_reported || !legacySentAt || now - legacySentAt > ttlMs) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56338 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56458 pattern=localStorage context=needs_manual_review line=localStorage.setItem(pageKey, JSON.stringify(ctx));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56460 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56461 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56462 pattern=legacy context=likely_guard_or_diagnostic line=let legacyCtx = null;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56464 pattern=legacy context=likely_guard_or_diagnostic line=legacyCtx = JSON.parse(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56465 pattern=legacy context=likely_guard_or_diagnostic line=} catch (legacyParseError) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56467 pattern=legacy context=likely_guard_or_diagnostic line=error_type: legacyParseError && legacyParseError.name,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56468 pattern=legacy context=likely_guard_or_diagnostic line=error: legacyParseError && legacyParseError.message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56469 pattern=legacy context=likely_guard_or_diagnostic line=stack: legacyParseError && legacyParseError.stack,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56473 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx || isPendingReplyContextForCurrentPage(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56474 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56500 pattern=localStorage context=needs_manual_review line=let raw = localStorage.getItem(pageKey) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56503 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56504 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56508 pattern=legacy context=likely_guard_or_diagnostic line=const legacyCtx = parsePendingReplyContextRaw(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56509 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56513 pattern=legacy context=likely_guard_or_diagnostic line=if (!hasAnyPendingReplyContextIdentity(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56518 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56522 pattern=legacy context=likely_guard_or_diagnostic line=if (!isPendingReplyContextForCurrentPage(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56523 pattern=legacy context=likely_guard_or_diagnostic line=logIgnoredForeignPendingReplyContext(legacyCtx, 'legacy-load');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56527 pattern=legacy context=likely_guard_or_diagnostic line=localStorage.setItem(pageKey, legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56528 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:56529 pattern=legacy context=likely_guard_or_diagnostic line=raw = legacyRaw;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:58265 pattern=debug context=likely_guard_or_diagnostic line=debugLog(`identity changed: ${oldKey || '-'} -> ${key}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:58285 pattern=debug context=likely_guard_or_diagnostic line=debugLog(`route identity changed: ${oldKey || '-'} -> ${key}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:58488 pattern=debug context=likely_guard_or_diagnostic line=selector: '#cgpt-bridge-debug',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:58919 pattern=debug context=likely_guard_or_diagnostic line=<input type="checkbox" id="cgpt-bridge-debug">`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:59106 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] buildChatExportText records failed, fallback to ComposerApi', exportErr);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:59249 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] skip invalid JSON candidate', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:59280 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] JSON stringify failed during dedupe', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:60060 pattern=trace context=likely_guard_or_diagnostic line='error', 'warn', 'failed', 'fail', 'exception', 'traceback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:62159 pattern=migrate context=needs_manual_review line=function migrateCompactContinuePromptIfNeeded(cfg, options = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:62163 pattern=migrate context=needs_manual_review line=if (typeof migrateContinuePromptTextIfNeeded !== 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:62171 pattern=migration context=likely_guard_or_diagnostic line=const migration = migrateContinuePromptTextIfNeeded(stored, logFn);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:62173 pattern=migration context=likely_guard_or_diagnostic line=if (migration.migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:62174 pattern=migration context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinuePromptText = migration.value;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:62194 pattern=migrate context=needs_manual_review line=cfg = migrateCompactContinuePromptIfNeeded(cfg, { log: true });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:62205 pattern=migrate context=needs_manual_review line=const cfg = migrateCompactContinuePromptIfNeeded(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:63887 pattern=fallback context=likely_guard_or_diagnostic line=function getValue(root, selector, fallback, moduleName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:63889 pattern=fallback context=likely_guard_or_diagnostic line=if (!el) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:63890 pattern=fallback context=likely_guard_or_diagnostic line=return String(el.value ?? fallback ?? '');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:63893 pattern=fallback context=likely_guard_or_diagnostic line=function getChecked(root, selector, fallback, moduleName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:63895 pattern=fallback context=likely_guard_or_diagnostic line=if (!el) return !!fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:63968 pattern=fallback context=likely_guard_or_diagnostic line=function normalizePromptCategoryName(item, fallback = '默认') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:63973 pattern=fallback context=likely_guard_or_diagnostic line=return text || fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64027 pattern=fallback context=likely_guard_or_diagnostic line=function readStorage(key, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64028 pattern=fallback context=likely_guard_or_diagnostic line=return StorageKit.readJson(key, fallback, { scoped: true });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64035 pattern=fallback context=likely_guard_or_diagnostic line=function readLocalJson(key, fallback, tag = '[STORAGE]') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64036 pattern=fallback context=likely_guard_or_diagnostic line=return StorageKit.readJson(key, fallback, { scoped: false, tag });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64043 pattern=fallback context=likely_guard_or_diagnostic line=function clonePlainObject(value, fallback = null, tag = '[CLONE]') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64062 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64741 pattern=fallback context=likely_guard_or_diagnostic line=function readJson(key, fallback, options = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64747 pattern=GM_getValue context=needs_manual_review line=if (scoped && typeof GM_getValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64748 pattern=GM_getValue context=needs_manual_review line=const value = GM_getValue(resolvedKey, null);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64752 pattern=GM_getValue context=needs_manual_review line=logError(`${tag}[GM_getValue-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64756 pattern=localStorage context=needs_manual_review line=const raw = window.localStorage.getItem(resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64757 pattern=fallback context=likely_guard_or_diagnostic line=if (raw == null || raw === '') return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64760 pattern=fallback context=likely_guard_or_diagnostic line=return parsed == null ? fallback : parsed;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64762 pattern=localStorage context=needs_manual_review line=logError(`${tag}[localStorage-read-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64763 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64773 pattern=GM_setValue context=needs_manual_review line=if (scoped && typeof GM_setValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64774 pattern=GM_setValue context=needs_manual_review line=GM_setValue(resolvedKey, value);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64778 pattern=GM_setValue context=needs_manual_review line=logError(`${tag}[GM_setValue-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64783 pattern=localStorage context=needs_manual_review line=window.localStorage.removeItem(resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64785 pattern=localStorage context=needs_manual_review line=window.localStorage.setItem(resolvedKey, JSON.stringify(value));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64790 pattern=localStorage context=needs_manual_review line=logError(`${tag}[localStorage-write-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64876 pattern=DEBUG_ context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[DEBUG_API][skip-existing] ${fullName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:64884 pattern=DEBUG_ context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[DEBUG_API][registered] ${fullName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65177 pattern=fallback context=likely_guard_or_diagnostic line=function clampNumber(value, fallback, min, max) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65179 pattern=fallback context=likely_guard_or_diagnostic line=const safe = Number.isFinite(n) ? n : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65347 pattern=fallback context=likely_guard_or_diagnostic line=function get(key, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65348 pattern=fallback context=likely_guard_or_diagnostic line=return readStorage(key, fallback);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65473 pattern=fallback context=likely_guard_or_diagnostic line=function readToolboxStateField(state, fieldName, fallback = '') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65477 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65500 pattern=legacy context=likely_guard_or_diagnostic line=const legacyKeys = TOOLBOX_PAGE_STATE_LEGACY_READ_ALIASES[key];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65501 pattern=legacy context=likely_guard_or_diagnostic line=if (Array.isArray(legacyKeys)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65502 pattern=legacy context=likely_guard_or_diagnostic line=for (let i = 0; i < legacyKeys.length; i += 1) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65503 pattern=legacy context=likely_guard_or_diagnostic line=const legacyValue = readValue(legacyKeys[i]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65504 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyValue !== undefined) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65505 pattern=legacy context=likely_guard_or_diagnostic line=return legacyValue;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65510 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65583 pattern=legacy context=likely_guard_or_diagnostic line=const legacyTaskFields = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65589 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].continuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65592 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].defaultContinuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65596 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].tasks[${taskIndex}].continuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65600 pattern=legacy context=likely_guard_or_diagnostic line=logLegacyFieldFinding('autoQueueConfig', legacyTaskFields);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65614 pattern=legacy context=likely_guard_or_diagnostic line=TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS.forEach((legacyKey) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65615 pattern=legacy context=likely_guard_or_diagnostic line=if (Object.prototype.hasOwnProperty.call(state, legacyKey)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65616 pattern=legacy context=likely_guard_or_diagnostic line=pageLegacyFields.push(`${routeKey}.${legacyKey}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65623 pattern=migrate context=needs_manual_review line=let migrated = false;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65634 pattern=legacy context=likely_guard_or_diagnostic line=TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS.forEach((legacyKey) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65635 pattern=legacy context=likely_guard_or_diagnostic line=if (Object.prototype.hasOwnProperty.call(nextState, legacyKey)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65636 pattern=legacy context=likely_guard_or_diagnostic line=delete nextState[legacyKey];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65637 pattern=migrate context=needs_manual_review line=migrated = true;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65642 pattern=migrate context=needs_manual_review line=if (migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65997 pattern=fallback context=likely_guard_or_diagnostic line=function normalizePositiveInt(value, fallback, min, max) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:65999 pattern=fallback context=likely_guard_or_diagnostic line=if (!Number.isFinite(n)) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66001 pattern=fallback context=likely_guard_or_diagnostic line=if (intValue < min) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66013 pattern=legacy context=likely_guard_or_diagnostic line=const legacyLoopPrompt = typeof cfg.copyHotkeyLoopContinuePrompt === 'string'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66016 pattern=legacy context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinuePromptText = String(cfg.copyHotkeyContinuePromptText || legacyLoopPrompt || '').trim();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66018 pattern=legacy context=likely_guard_or_diagnostic line=const legacyLoopStop = typeof cfg.copyHotkeyLoopStopSignal === 'string'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66030 pattern=legacy context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinueStopSignal || legacyLoopStop || DEFAULT_BATCH_TASK_DONE_SIGNAL,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66097 pattern=fallback context=likely_guard_or_diagnostic line=function cloneShortcutItem(item, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66098 pattern=fallback context=likely_guard_or_diagnostic line=const src = item && typeof item === 'object' ? item : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66417 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeTimestamp(value, fallback = nowMs()) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66419 pattern=fallback context=likely_guard_or_diagnostic line=return Number.isFinite(n) && n > 0 ? n : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66434 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackName = options.fallbackName || '未命名';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66439 pattern=fallback context=likely_guard_or_diagnostic line=input && input.name != null ? input.name : fallbackName,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66441 pattern=fallback context=likely_guard_or_diagnostic line=) || fallbackName;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66542 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeToNativeFile(value, fallbackName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66548 pattern=fallback context=likely_guard_or_diagnostic line=return new File([value], fallbackName || 'upload.bin', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66555 pattern=fallback context=likely_guard_or_diagnostic line=return new File([value], value.name || fallbackName || 'upload.bin', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66663 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] textarea fallback copy failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66664 pattern=fallback context=likely_guard_or_diagnostic line=console.error('[ChatGPT toolbox] textarea fallback copy failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66693 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] GM_setClipboard failed, fallback to browser clipboard', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:66713 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] navigator.clipboard.writeText failed, fallback to execCommand', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:67454 pattern=GM_setValue context=needs_manual_review line=// @grant        GM_setValue`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:67455 pattern=GM_getValue context=needs_manual_review line=// @grant        GM_getValue`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:67755 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'no-latest-user-fallback-last-assistant',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:68598 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackStartedAt = Date.now();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:68610 pattern=fallback context=likely_guard_or_diagnostic line=`[CHAT_MSG][LATEST_FALLBACK_FULL_SCAN] reason=${reason} cost=${Date.now() - fallbackStartedAt}ms records=${fullRecords.length}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:68636 pattern=fallback context=likely_guard_or_diagnostic line=reason: mode === 'fast' ? 'fast-tail' : 'full-scan-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:69161 pattern=fallback context=likely_guard_or_diagnostic line=source: 'svg-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:69656 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] execCommand insertText failed; fallback to textContent', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:69766 pattern=debug context=likely_guard_or_diagnostic line=const debugText = [`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:69774 pattern=debug context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[COMPOSER][click-send] ${debugText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:70496 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] attachment evidence timeout', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:70660 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input upload failed: no file inputs');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:70677 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] legacy input upload try', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:70774 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input dispatch failed', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:73278 pattern=fallback context=likely_guard_or_diagnostic line=result.reason = 'sent_by_enter_fallback_disabled_button';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:73356 pattern=fallback context=likely_guard_or_diagnostic line=result.reason = result.usedFallbackEnter ? 'sent_by_enter_fallback' : 'sent';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74158 pattern=fallback context=likely_guard_or_diagnostic line=const ctrlEnter = await runActionAndConfirm('ctrl_enter_fallback', () => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74173 pattern=fallback context=likely_guard_or_diagnostic line=const enter = await runActionAndConfirm('enter_fallback', () => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74189 pattern=fallback context=likely_guard_or_diagnostic line='native_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74195 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][ACTION_SKIP] method=native_enter_fallback reason=composer-focus-failed');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74204 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][ACTION_SKIP] method=native_enter_fallback reason=bridge-unavailable');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74576 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][WAIT_BUTTON_SKIP] reason=existing-composer-use-action-fallback');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74678 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_READY] source=${source}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74685 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_READY_TIMEOUT] source=${source}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74702 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_BUTTON_MISS] source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74708 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_FOUND] source=${sourceTag} selector=${info.selector || '-'} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74714 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_REJECT] source=${sourceTag} reason=voice_button ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74722 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_DISABLED] source=${sourceTag} aria=${info.aria || '-'} testid=${info.testid || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74729 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_BUTTON_CLICK] source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74740 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_SKIP] reason=empty_text source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74744 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_START] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74752 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_not_ready`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74760 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog('[AUTO_QUEUE][BATCH_INITIAL_WAIT_RESPONDING]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74768 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_not_found`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74774 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_set_failed`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74778 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_TEXT_SET] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74785 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_text_not_synced`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74789 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_TEXT_SYNCED] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74802 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=sendContentViaComposer`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74812 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_STABLE_FAILED] source=${sourceTag} reason=${viaComposer.reason || 'unknown'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74826 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=stableSendMessage`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74836 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_STABLE_FAILED] source=${sourceTag} reason=${stableResult.reason || 'unknown'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74848 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=click_button`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74855 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=click_button`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74881 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=keyboard_enter`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74886 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=no_send_method`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74960 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 旧缓存可能含 READY；新流程不再产生，normalizeUploadState 会归一化为 IDLE。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:74971 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 仅用于兼容旧版本上传缓存状态，新上传流程不再产生这些状态。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75276 pattern=migrate context=needs_manual_review line=function migrateTaskDoneSignalValue(value, logFn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75594 pattern=migrate context=needs_manual_review line=function migrateContinuePromptTextIfNeeded(storedText, logFn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75598 pattern=migrate context=needs_manual_review line=return { value: '', migrated: false, reason: 'empty-use-runtime-default' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75605 pattern=migrate context=needs_manual_review line=return { value: '', migrated: true, reason: 'old-continue' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75610 pattern=legacy context=likely_guard_or_diagnostic line=logFn('[CONTINUE_PROMPT][MIGRATE_DEFAULT] old=legacy-prompt new=explicit-task-done');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75612 pattern=legacy context=likely_guard_or_diagnostic line=return { value: '', migrated: true, reason: 'legacy-prompt' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75618 pattern=migrate context=needs_manual_review line=return { value: trimmed, migrated: false, reason: 'user-customized' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75658 pattern=deprecated context=likely_guard_or_diagnostic line=- 建议保留但标记 @deprecated`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75819 pattern=AUTO_ context=needs_manual_review line=const EDGE_AUTO_HIDE_SIDE = 'right';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75820 pattern=AUTO_ context=needs_manual_review line=const VALID_EDGE_SIDES = Object.freeze([EDGE_AUTO_HIDE_SIDE]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:75882 pattern=AUTO_ context=needs_manual_review line=return String(side || '').trim() === EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:79996 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('create-existing-root-detached');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:80045 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('reuse-existing-dom');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:80144 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('create-new-root');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:80497 pattern=fallback context=likely_guard_or_diagnostic line=const fallback = normalizePanelSize(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:80500 pattern=fallback context=likely_guard_or_diagnostic line=if (!panel) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:80510 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:80958 pattern=AUTO_ context=needs_manual_review line=if (text && text !== EDGE_AUTO_HIDE_SIDE) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:80961 pattern=AUTO_ context=needs_manual_review line=return VALID_EDGE_SIDES.includes(text) ? text : EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81174 pattern=AUTO_ context=needs_manual_review line=if (isStrictlyTouchingEdge(panelRect, EDGE_AUTO_HIDE_SIDE)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81175 pattern=AUTO_ context=needs_manual_review line=return EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81642 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 控制台救援 API，确认无旧版救援脚本依赖后再删除`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81741 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackLeft = Number.isFinite(Number(savedPos.left))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81745 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackTop = Number.isFinite(Number(savedPos.top))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81750 pattern=fallback context=likely_guard_or_diagnostic line=left: fallbackLeft,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81751 pattern=fallback context=likely_guard_or_diagnostic line=top: fallbackTop,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81752 pattern=fallback context=likely_guard_or_diagnostic line=right: fallbackLeft + size.width,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81753 pattern=fallback context=likely_guard_or_diagnostic line=bottom: fallbackTop + size.height,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:81971 pattern=AUTO_ context=needs_manual_review line=const nextSide = EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:82402 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] resize releasePointerCapture failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:82414 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] resize setPointerCapture failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83017 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackWidth = 110;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83018 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackHeight = 28;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83021 pattern=fallback context=likely_guard_or_diagnostic line=const width = rect && rect.width > 0 ? rect.width : fallbackWidth;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83022 pattern=fallback context=likely_guard_or_diagnostic line=const height = rect && rect.height > 0 ? rect.height : fallbackHeight;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83095 pattern=fallback context=likely_guard_or_diagnostic line=source = 'last-panel-visible-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83102 pattern=fallback context=likely_guard_or_diagnostic line=source = 'saved-panel-position-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83206 pattern=fallback context=likely_guard_or_diagnostic line=const fallback = getPanelSizeFallback();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83218 pattern=fallback context=likely_guard_or_diagnostic line=applyPanelSize(fallback);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83415 pattern=AUTO_ context=needs_manual_review line=edge = EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83525 pattern=AUTO_ context=needs_manual_review line=const shouldHide = enabled && edge === EDGE_AUTO_HIDE_SIDE && panelHidden && !isEdgeHidden();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83564 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPos = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83568 pattern=fallback context=likely_guard_or_diagnostic line=saveHiddenTitlePosition(fallbackPos, `${reason}:fallback`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83569 pattern=fallback context=likely_guard_or_diagnostic line=const lockedFallback = getLockedHiddenTitlePosition(`${reason}:fallback-locked`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83573 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-apply] reason=${reason || '-'} left=${Math.round(lockedFallback.left)} top=${Math.round(lockedFallback.top)} panelLeft=${Math.round(Number(rect.left))} panelTop=${Math.round(Number(rect.to`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83576 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] hidePanel fallback locked position missing', rect);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83578 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} missing-locked-fallback`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83582 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] hidePanel fallback apply skipped: invalid panel rect', rect);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:83584 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} invalid-panel-rect`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:84529 pattern=debug context=likely_guard_or_diagnostic line=if (window.console && typeof console.debug === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:84530 pattern=debug context=likely_guard_or_diagnostic line=console.debug(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:84618 pattern=migrate context=needs_manual_review line=function migrateToolboxToastToPanel(reason = '') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:84626 pattern=migrate context=needs_manual_review line=appendLog(`[TOOLBOX_TOAST][migrate] from=root to=panel reason=${reason || '-'}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:84790 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] ignored page error', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:84822 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] ignored page rejection', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:84838 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox][LOG_REENTER]', message);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:84848 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox][LOG_BEFORE_READY]', message);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:85277 pattern=fallback context=likely_guard_or_diagnostic line=source = 'full-turn-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:85631 pattern=fallback context=likely_guard_or_diagnostic line=function chooseAssistantFinalAnswerText(rawText, fallbackText, meta = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:85640 pattern=fallback context=likely_guard_or_diagnostic line=const cleanedFallback = cleanFn(fallbackText || '');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:85648 pattern=fallback context=likely_guard_or_diagnostic line=`[CHAT_PAGE][assistant-final-answer-picked] source=after-thinking chars=${cleanedAfterThinking.length} fallbackChars=${String(cleanedFallback || '').length} turn=${meta.turnId || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:85659 pattern=fallback context=likely_guard_or_diagnostic line=let source = 'fallback-content';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:85712 pattern=AUTO_ context=needs_manual_review line=const QUICK_PROMPT_CLICK_AUTO_SEND = true;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:85910 pattern=fallback context=likely_guard_or_diagnostic line=+ 'fallback=hasAssistantDoneSignalInText',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86024 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackGroupId = restored.resolvedGroupId || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86026 pattern=fallback context=likely_guard_or_diagnostic line=if (!fallbackGroupId) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86027 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] ensureActiveUploadGroupIdValid: no fallback group', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86034 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] activeUploadGroupId invalid, fallback to restored group', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86037 pattern=fallback context=likely_guard_or_diagnostic line=fallbackGroupId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86041 pattern=fallback context=likely_guard_or_diagnostic line=state.activeGroupId = fallbackGroupId;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86045 pattern=fallback context=likely_guard_or_diagnostic line=fallbackGroupId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86126 pattern=fallback context=likely_guard_or_diagnostic line=fallback: files.length ? getUploadFileFolderKey(files[0]) : '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86130 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackFolderKey = getUploadFileFolderKey(files[0]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86133 pattern=fallback context=likely_guard_or_diagnostic line=folderKey: fallbackFolderKey,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86579 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload item source', stage, info, extra);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86593 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload queue snapshot', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86887 pattern=debug context=likely_guard_or_diagnostic line=debugSavedFrom: '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86934 pattern=debug context=likely_guard_or_diagnostic line=if (hasBlob || record.blobSaved || record.blobSavedAt || record.debugSavedFrom) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:86942 pattern=debug context=likely_guard_or_diagnostic line=record.debugSavedFrom = '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87288 pattern=debug context=likely_guard_or_diagnostic line=async function debugReadBackPersistedQueue(stage) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87298 pattern=debug context=likely_guard_or_diagnostic line=req.onerror = () => reject(req.error || new Error('IndexedDB debug getAll failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87313 pattern=debug context=likely_guard_or_diagnostic line=debugSavedFrom: r.debugSavedFrom || '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87319 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] persisted queue readback', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87325 pattern=debug context=likely_guard_or_diagnostic line=console.error('[ChatGPT toolbox] debugReadBackPersistedQueue failed', stage, e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87402 pattern=debug context=likely_guard_or_diagnostic line=await debugReadBackPersistedQueue('persistQueue:after-write');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87683 pattern=migrate context=likely_guard_or_diagnostic line=migrateLegacyUploadSelectionIfNeeded();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87728 pattern=legacy context=likely_guard_or_diagnostic line=reason: 'legacy-missing-group',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87733 pattern=migrate context=needs_manual_review line=async function migrateMissingGroupIdRows() {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87737 pattern=migrate context=needs_manual_review line=ToolboxShell.appendLog('[UPLOAD_GROUP][migrate-missing-group-skip] reason=no-target-group');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87749 pattern=migration context=likely_guard_or_diagnostic line=req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll for migration failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87764 pattern=migrate context=needs_manual_review line=`[UPLOAD_GROUP][migrate-missing-group] target=${targetId} changed=${changed}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87774 pattern=migration context=likely_guard_or_diagnostic line=tx.onerror = () => reject(tx.error || new Error('IndexedDB queue migration transaction failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87775 pattern=migration context=likely_guard_or_diagnostic line=tx.onabort = () => reject(tx.error || new Error('IndexedDB queue migration transaction aborted'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87783 pattern=migrate context=needs_manual_review line=console.error('[ChatGPT toolbox] migrate missing groupId rows failed', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87786 pattern=migrate context=needs_manual_review line=`[UPLOAD_GROUP][migrate-missing-group-error] target=${targetId || '-'} type=${errName} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87823 pattern=deprecated context=likely_guard_or_diagnostic line=`[UPLOAD_DIAG][restore-blob:deprecated] name=${item.name || '-'} id=${item.id || '-'}``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87876 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] loadQueue row restore', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87909 pattern=migrate context=needs_manual_review line=const migrated = await migrateMissingGroupIdRows();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87911 pattern=migrate context=needs_manual_review line=if (migrated === false) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:87913 pattern=legacy context=likely_guard_or_diagnostic line=`[UPLOAD_GROUP][load-queue:migrate-skipped] groupId=${state.activeGroupId || '-'} note=legacy-rows-without-groupId-may-be-invisible`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:88159 pattern=migrate context=likely_guard_or_diagnostic line=function migrateLegacyUploadSelectionIfNeeded() {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:88165 pattern=legacy context=likely_guard_or_diagnostic line=const legacyId = String(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:88168 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyId) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:88172 pattern=legacy context=likely_guard_or_diagnostic line=const group = state.groups.find((item) => item && item.id === legacyId);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:88280 pattern=fallback context=likely_guard_or_diagnostic line=fallback: resolvedFolderKey,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:88922 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:88927 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:89145 pattern=fallback context=likely_guard_or_diagnostic line=`[UPLOAD][IMPORT][QUEUE_GROUP_FALLBACK] old=${rawGroupId} fallback=${groupId}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:89282 pattern=fallback context=likely_guard_or_diagnostic line=appendUploadGroupLog('RENDER', { phase: 'fallback-after-error' });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:89578 pattern=AUTO_ context=needs_manual_review line=if (QUICK_PROMPT_CLICK_AUTO_SEND !== true) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:93146 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:93156 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 supported=0');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:93341 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] fileHandle.getFile failed, no fallback to cache', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:93349 pattern=fallback context=likely_guard_or_diagnostic line=`[UPLOAD_DIAG][readFreshFile:handle-failed-no-fallback] name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} type=${errName} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:93611 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] makeUploadFile failed; fallback to original file', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:93629 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload file name resolved', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:93706 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input upload failed', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:94701 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'quick-category-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98185 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRows = rootEl.querySelectorAll(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98188 pattern=legacy context=likely_guard_or_diagnostic line=legacyRows.forEach((row) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98194 pattern=legacy context=likely_guard_or_diagnostic line=const legacyStatusCounts = qs('#cgpt-upload-status-counts', rootEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98195 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyStatusCounts) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98196 pattern=legacy context=likely_guard_or_diagnostic line=legacyStatusCounts.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98220 pattern=legacy context=likely_guard_or_diagnostic line=const legacyUploadAndSendBtn = qs('#cgpt-upload-start-and-send', actionRow);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98221 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyUploadAndSendBtn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98222 pattern=legacy context=likely_guard_or_diagnostic line=legacyUploadAndSendBtn.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:98355 pattern=AUTO_ context=needs_manual_review line=console.error('[AUTO_CONTINUE][FAILED]', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99088 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRowFields = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99112 pattern=legacy context=likely_guard_or_diagnostic line=legacyRowFields.push(`queue[${index}].upload_active_group_id`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99125 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRowFields.length) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99126 pattern=legacy context=likely_guard_or_diagnostic line=const line = `[FIELD][LEGACY_FOUND] scope=uploadQueue fields=${legacyRowFields.join(',')}`;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99294 pattern=legacy context=likely_guard_or_diagnostic line=识别并清理当前代码中的 dead code / unreachable code / 被新逻辑替代的旧代码，同时保护 Qt 动态入口、Flask 路由、legacy guard、配置迁移逻辑，避免误删。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99309 pattern=migration context=likely_guard_or_diagnostic line=| 1 | 修 `app/core/job_scheduler.py` 旧 `status` 读取 + `tests/test_job_scheduler_status_migration.py` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99310 pattern=legacy context=likely_guard_or_diagnostic line=| 2 | 加 `tests/test_bridge_payload_legacy_guard.py`，确认不误删 `legacy_cleanup.py` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99314 pattern=AUTO_ context=needs_manual_review line=| 6 | 油猴 `DEFAULT_AUTO_CONFIG` → `getDefaultAutoListPromptsText()`，再 `npm run build` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99315 pattern=deprecated context=likely_guard_or_diagnostic line=| 7 | `remote_binding_enabled()`、`persist_qsettings_last_url()` 加 deprecated / migration 注释与观察日志 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99338 pattern=migrate context=needs_manual_review line=5. **不要**删除 `_migrate_job_status_inplace()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99340 pattern=migration context=likely_guard_or_diagnostic line=### 测试：`tests/test_job_scheduler_status_migration.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99362 pattern=AUTO_ context=needs_manual_review line=3. 将所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 替换为 `getDefaultAutoListPromptsText()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99363 pattern=AUTO_ context=needs_manual_review line=4. 删除 `DEFAULT_AUTO_CONFIG` 常量。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99364 pattern=AUTO_ context=needs_manual_review line=5. 确认全项目无 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99369 pattern=legacy context=likely_guard_or_diagnostic line=## 三、P2：保护 legacy guard（禁止误删）`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99373 pattern=legacy context=likely_guard_or_diagnostic line=- `app/utils/legacy_cleanup.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99375 pattern=legacy context=likely_guard_or_diagnostic line=- `assert_no_legacy_fields()` / `reject_legacy_fields()``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99378 pattern=legacy context=likely_guard_or_diagnostic line=### 测试：`tests/test_bridge_payload_legacy_guard.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99383 pattern=legacy context=likely_guard_or_diagnostic line=断言：错误含 `legacy fields still exist before save` 与 `payload.request_id`；合法结果 `payload` 中无 `request_id`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99392 pattern=deprecated context=likely_guard_or_diagnostic line=- 添加 `@deprecated` docstring。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99394 pattern=deprecated context=likely_guard_or_diagnostic line=- 可低频调用 `log_deprecated_hit(...)`（见 `app/utils/deprecation_log.py`）。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99399 pattern=QSettings context=likely_guard_or_diagnostic line=- 添加注释：旧 QSettings key 迁移清理。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99400 pattern=migration context=likely_guard_or_diagnostic line=- 可低频调用 `log_migration_hit(...)`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99408 pattern=deprecated context=likely_guard_or_diagnostic line=log_deprecated_hit(name, reason="", replacement="", caller="")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99411 pattern=migration context=likely_guard_or_diagnostic line=log_migration_hit(name, old="", new="", reason="")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99424 pattern=deprecated context=likely_guard_or_diagnostic line=| `tools/find_dead_code_candidates.py` | 扫描 `app/**/*.py`、`gui.py`、`server.py`、`client.user.js`；旧 status / deprecated 关键词 / 仅定义无引用；只打印 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99426 pattern=AUTO_ context=needs_manual_review line=| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99427 pattern=legacy context=likely_guard_or_diagnostic line=| `tools/check_must_keep_symbols.py` | 确认 `legacy_cleanup.py`、guard 函数、`validate_outbound_queue_message` 未被误删 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99473 pattern=AUTO_ context=needs_manual_review line=- [ ] `DEFAULT_AUTO_CONFIG` 已删除，默认配置仅 `createDefaultAutoConfig()``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99474 pattern=legacy context=likely_guard_or_diagnostic line=- [ ] `legacy_cleanup.py` 及 guard 函数保留`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99476 pattern=deprecated context=likely_guard_or_diagnostic line=- [ ] `remote_binding_enabled()` 保留并 `@deprecated``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99533 pattern=AUTO_ context=needs_manual_review line=| 不再出现 `DEFAULT_AUTO_CONFIG` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99546 pattern=legacy context=likely_guard_or_diagnostic line=| `legacy_cleanup.py` 仍存在 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99547 pattern=legacy context=likely_guard_or_diagnostic line=| `assert_no_legacy_fields` / `reject_legacy_fields` 仍存在 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99571 pattern=migration context=likely_guard_or_diagnostic line=| `tests/test_job_scheduler_status_migration.py` 通过 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99572 pattern=legacy context=likely_guard_or_diagnostic line=| `tests/test_bridge_payload_legacy_guard.py` 通过 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99627 pattern=legacy context=likely_guard_or_diagnostic line=- app/utils/legacy_cleanup.py missing symbol assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99633 pattern=legacy context=likely_guard_or_diagnostic line=2. **不要**把 legacy guard 改成空函数。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99639 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99644 pattern=legacy context=likely_guard_or_diagnostic line=### 12.3 `test_bridge_payload_legacy_guard.py` 失败`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99650 pattern=legacy context=likely_guard_or_diagnostic line=1. 检查 `validate_outbound_queue_message()` 是否仍调用 `assert_no_legacy_fields()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99664 pattern=migration context=likely_guard_or_diagnostic line=### 12.4 `test_job_scheduler_status_migration.py` 失败`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99680 pattern=AUTO_ context=needs_manual_review line=### 12.5 `npm run build` 后 `DEFAULT_AUTO_CONFIG` 又出现`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99682 pattern=AUTO_ context=needs_manual_review line=若构建后 `rg "DEFAULT_AUTO_CONFIG"` 仍有命中：`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99689 pattern=AUTO_ context=needs_manual_review line=2. 找到 `DEFAULT_AUTO_CONFIG` 的定义和引用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99692 pattern=AUTO_ context=needs_manual_review line=5. 再执行：`rg "DEFAULT_AUTO_CONFIG"``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99702 pattern=legacy context=likely_guard_or_diagnostic line=3. **不要**删除 `legacy_cleanup.py`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99703 pattern=legacy context=likely_guard_or_diagnostic line=4. **不要**把 `assert_no_legacy_fields()` 改成空函数。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99709 pattern=legacy context=likely_guard_or_diagnostic line=10. **不要**一次性混合提交：Python 调度修复、油猴默认配置清理、legacy guard 调整、文档脚本新增——应分步提交便于回滚。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99719 pattern=migration context=likely_guard_or_diagnostic line=git diff -- tests/test_job_scheduler_status_migration.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99720 pattern=legacy context=likely_guard_or_diagnostic line=git diff -- tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99730 pattern=legacy context=likely_guard_or_diagnostic line=| `legacy_cleanup.py` | 未被删除 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99734 pattern=AUTO_ context=needs_manual_review line=| 油猴 | 源码删除 `DEFAULT_AUTO_CONFIG` 后，`client.user.js` 是构建产物更新，非手工乱改 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99747 pattern=deprecated context=likely_guard_or_diagnostic line=│   ├── models.py                           [可选] remote_binding_enabled() 仅 @deprecated 注释`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99750 pattern=migration context=likely_guard_or_diagnostic line=│       ├── bridge_payload.py               [可选] persist_qsettings 旧 key 循环加 migration 注释`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99753 pattern=AUTO_ context=needs_manual_review line=│   └── tampermonkey-userscript-src/**      [必改-P1] 删 DEFAULT_AUTO_CONFIG，唯一入口 createDefaultAutoConfig()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99756 pattern=migration context=likely_guard_or_diagnostic line=│   ├── test_job_scheduler_status_migration.py   [建议]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99757 pattern=legacy context=likely_guard_or_diagnostic line=│   └── test_bridge_payload_legacy_guard.py      [建议]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99782 pattern=migrate context=needs_manual_review line=3. 不要删除 `_migrate_job_status_inplace()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99789 pattern=migration context=likely_guard_or_diagnostic line=| `tests/test_job_scheduler_status_migration.py` | 防止迁移后再次读取旧 `status` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99790 pattern=legacy context=likely_guard_or_diagnostic line=| `tests/test_bridge_payload_legacy_guard.py` | 防止 `legacy_cleanup.py` / `assert_no_legacy_fields()` 被误删或弱化 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99798 pattern=AUTO_ context=needs_manual_review line=| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99799 pattern=legacy context=likely_guard_or_diagnostic line=| `tools/check_must_keep_symbols.py` | 防 legacy guard 关键符号被删 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99813 pattern=deprecated context=likely_guard_or_diagnostic line=| `app/models.py` | `remote_binding_enabled()` 只加 `@deprecated` 注释，不删函数 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99814 pattern=migration context=likely_guard_or_diagnostic line=| `app/utils/bridge_payload.py` | `persist_qsettings_last_url()` 旧 key 清理循环只加 migration 注释 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99822 pattern=AUTO_ context=needs_manual_review line=| `chatgpt-toolbox/tampermonkey-userscript-src/**` | `DEFAULT_AUTO_CONFIG` 只在此清理 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99825 pattern=legacy context=likely_guard_or_diagnostic line=**明确不要改（本轮）：** `app/utils/legacy_cleanup.py` 及其中 `assert_no_legacy_fields()`、`reject_legacy_fields()`、`validate_outbound_queue_message()` 的旧字段拒绝逻辑。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99848 pattern=legacy context=likely_guard_or_diagnostic line=| `tests/` | 只验证 dead code / legacy guard；不依赖真实浏览器、网络、Cursor 进程 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99854 pattern=AUTO_ context=needs_manual_review line=| `tampermonkey-userscript-src/` | 删 `DEFAULT_AUTO_CONFIG`；`createDefaultAutoConfig()` 为唯一默认配置入口 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99865 pattern=migration context=likely_guard_or_diagnostic line=| 1 | `fix:` | `app/core/job_scheduler.py`、`tests/test_job_scheduler_status_migration.py` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99866 pattern=legacy context=likely_guard_or_diagnostic line=| 2 | `test:` | `tests/test_bridge_payload_legacy_guard.py`、`tools/check_must_keep_symbols.py` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99891 pattern=migration context=likely_guard_or_diagnostic line=pytest -q tests/test_job_scheduler_status_migration.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99892 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99903 pattern=AUTO_ context=needs_manual_review line=rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99910 pattern=AUTO_ context=needs_manual_review line=rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99911 pattern=legacy context=likely_guard_or_diagnostic line=# 须存在：legacy_cleanup.py、assert_no_legacy_fields、reject_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99922 pattern=AUTO_ context=needs_manual_review line=| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99923 pattern=legacy context=likely_guard_or_diagnostic line=| **高（本轮不做删除）** | 删 `legacy_cleanup.py`、`assert_no_legacy_fields()`、Flask route、Qt 槽；手工改 `client.user.js`；弱化旧字段 `ValueError` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99925 pattern=deprecated context=likely_guard_or_diagnostic line=高风险项本轮只能：**保护、测试、标记 deprecated**。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99936 pattern=migration context=likely_guard_or_diagnostic line=| 测试 | `tests/test_job_scheduler_status_migration.py` | 已有 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99937 pattern=legacy context=likely_guard_or_diagnostic line=| 测试 | `tests/test_bridge_payload_legacy_guard.py` | 已有 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:99942 pattern=AUTO_ context=needs_manual_review line=| 油猴 | `tampermonkey-userscript-src/` | 已无 `DEFAULT_AUTO_CONFIG` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100023 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `True` | `339c52c1867e702ece203b9eea374b98a8430307f26bfe35a580532d25e9b548` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100033 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `LEGACY_FIELD_NAMES` | `True` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100034 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `assert_no_legacy_fields` | `True` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100035 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `reject_legacy_fields` | `True` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100037 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/bridge_payload.py` | `assert_no_legacy_fields` | `True` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100049 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100057 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100076 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100082 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100096 pattern=AUTO_ context=needs_manual_review line=pattern=`DEFAULT_AUTO_CONFIG``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100099 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:30:| 6 | 油猴 `DEFAULT_AUTO_CONFIG` → `getDefaultAutoListPromptsText()`，再 `npm run build` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100100 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:78:3. 将所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 替换为 `getDefaultAutoListPromptsText()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100101 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:79:4. 删除 `DEFAULT_AUTO_CONFIG` 常量。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100102 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:80:5. 确认全项目无 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100103 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100104 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:189:- [ ] `DEFAULT_AUTO_CONFIG` 已删除，默认配置仅 `createDefaultAutoConfig()``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100105 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:249:| 不再出现 `DEFAULT_AUTO_CONFIG` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100106 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:396:### 12.5 `npm run build` 后 `DEFAULT_AUTO_CONFIG` 又出现`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100107 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:398:若构建后 `rg "DEFAULT_AUTO_CONFIG"` 仍有命中：`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100108 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:405:2. 找到 `DEFAULT_AUTO_CONFIG` 的定义和引用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100109 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:408:5. 再执行：`rg "DEFAULT_AUTO_CONFIG"``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100110 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:450:| 油猴 | 源码删除 `DEFAULT_AUTO_CONFIG` 后，`client.user.js` 是构建产物更新，非手工乱改 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100111 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:469:│   └── tampermonkey-userscript-src/**      [必改-P1] 删 DEFAULT_AUTO_CONFIG，唯一入口 createDefaultAutoConfig()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100112 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100113 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:538:| `chatgpt-toolbox/tampermonkey-userscript-src/**` | `DEFAULT_AUTO_CONFIG` 只在此清理 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100114 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:570:| `tampermonkey-userscript-src/` | 删 `DEFAULT_AUTO_CONFIG`；`createDefaultAutoConfig()` 为唯一默认配置入口 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100115 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:619:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100116 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:626:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100117 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100118 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:658:| 油猴 | `tampermonkey-userscript-src/` | 已无 `DEFAULT_AUTO_CONFIG` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100119 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_manifest.json:31:        "symbol": "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100120 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_manifest.json:37:          "rg \"DEFAULT_AUTO_CONFIG\""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100121 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:100:symbol=DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100122 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:108:**处理建议**：`result=replace_then_delete` — 先用 `getDefaultAutoListPromptsText()` 替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用，再删除 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100123 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:197:symbol=DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100124 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:199:tests=npm run build; client.user.js 无 DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100125 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:311:### 8.2 P1：`DEFAULT_AUTO_CONFIG` 回滚`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100126 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:321:油猴构建后若自动指令、Prompt 列表、列表模式默认文本异常，先检查 `getDefaultAutoListPromptsText()` 是否已完整替换所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100127 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:324:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100128 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:340:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100129 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:346:- 回滚后 `DEFAULT_AUTO_CONFIG` 与 `createDefaultAutoConfig()` 重复的问题**仍然存在**，不要长期停在回滚态。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100130 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:349:  2. 只替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100131 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:350:  3. 只删除 `DEFAULT_AUTO_CONFIG``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100132 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_rules.md:121:| 构建后仍有 `DEFAULT_AUTO_CONFIG` | 源码未清干净 | §12.5：改 `tampermonkey-userscript-src/`，再 `npm run build` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100133 pattern=AUTO_ context=needs_manual_review line=tools/check_dead_code_docs_consistency.py:36:    "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100134 pattern=AUTO_ context=needs_manual_review line=tools/check_dead_code_docs_consistency.py:49:    "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100135 pattern=AUTO_ context=needs_manual_review line=tools/check_dead_code_regression.py:52:        "forbidden": "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100136 pattern=AUTO_ context=needs_manual_review line=tools/check_dead_code_regression.py:54:            "生成产物中不应再出现 DEFAULT_AUTO_CONFIG；"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100137 pattern=AUTO_ context=needs_manual_review line=tools/create_dead_code_cleanup_baseline.py:36:    ("default_auto_config", "DEFAULT_AUTO_CONFIG"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100138 pattern=AUTO_ context=needs_manual_review line=tools/find_dead_code_candidates.py:25:    "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100149 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100169 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100204 pattern=migration context=likely_guard_or_diagnostic line="reason": "job status field has migrated to job_status; direct status reads become stale after migration",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100207 pattern=migration context=likely_guard_or_diagnostic line="pytest -q tests/test_job_scheduler_status_migration.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100215 pattern=migrate context=needs_manual_review line="reason": "job status field has migrated to job_status; direct status reads break pending_chatgpt counting",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100218 pattern=migration context=likely_guard_or_diagnostic line="pytest -q tests/test_job_scheduler_status_migration.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100224 pattern=AUTO_ context=needs_manual_review line="symbol": "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100230 pattern=AUTO_ context=needs_manual_review line="rg \"DEFAULT_AUTO_CONFIG\""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100239 pattern=compat context=likely_guard_or_diagnostic line="reason": "compatibility wrapper for old call name",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100245 pattern=legacy context=likely_guard_or_diagnostic line="symbol": "persist_qsettings_last_url() legacy key cleanup loop",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100247 pattern=legacy context=likely_guard_or_diagnostic line="reason": "legacy QSettings key cleanup for last_page_url/page_url/conversation_url",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100262 pattern=legacy context=likely_guard_or_diagnostic line="path": "app/utils/legacy_cleanup.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100265 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100266 pattern=legacy context=likely_guard_or_diagnostic line="reject_legacy_fields"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100268 pattern=legacy context=likely_guard_or_diagnostic line="reason": "legacy field guard must remain active to block stale payload fields"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100274 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100276 pattern=legacy context=likely_guard_or_diagnostic line="reason": "outbound queue payload validation must continue rejecting legacy fields"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100359 pattern=deprecated context=likely_guard_or_diagnostic line=| `result` | `deleted` / `kept` / `deprecated` / `observe` / `replace` / `replace_then_delete` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100377 pattern=migration context=likely_guard_or_diagnostic line=tests=pytest -q tests/test_job_scheduler_status_migration.py && python -m compileall -q app gui.py server.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100394 pattern=migration context=likely_guard_or_diagnostic line=tests=pytest -q tests/test_job_scheduler_status_migration.py && python -m compileall -q app gui.py server.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100407 pattern=AUTO_ context=needs_manual_review line=symbol=DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100415 pattern=AUTO_ context=needs_manual_review line=**处理建议**：`result=replace_then_delete` — 先用 `getDefaultAutoListPromptsText()` 替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用，再删除 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100434 pattern=deprecated context=likely_guard_or_diagnostic line=**处理建议**：`result=observe` — 暂不删除，只加 `@deprecated` 注释和 `[DEPRECATED_HIT]` 日志。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100444 pattern=QSettings context=likely_guard_or_diagnostic line=reason=旧 QSettings key 迁移清理逻辑，低频但仍可能保护用户历史配置`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100459 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `LEGACY_FIELD_NAMES` / `assert_no_legacy_fields` / `reject_legacy_fields` | 旧字段拒绝逻辑仍在保护 bridge payload | `keep` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100496 pattern=migration context=likely_guard_or_diagnostic line=tests=pytest -q tests/test_job_scheduler_status_migration.py (2 passed); check_dead_code_regression OK`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100504 pattern=AUTO_ context=needs_manual_review line=symbol=DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100506 pattern=AUTO_ context=needs_manual_review line=tests=npm run build; client.user.js 无 DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100515 pattern=deprecated context=likely_guard_or_diagnostic line=result=deprecated`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100524 pattern=legacy context=likely_guard_or_diagnostic line=symbol=persist_qsettings_last_url legacy key loop`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100586 pattern=migration context=likely_guard_or_diagnostic line=- `tests/test_job_scheduler_status_migration.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100595 pattern=migration context=likely_guard_or_diagnostic line=pytest -q tests/test_job_scheduler_status_migration.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100602 pattern=migration context=likely_guard_or_diagnostic line=git restore tests/test_job_scheduler_status_migration.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100618 pattern=AUTO_ context=needs_manual_review line=### 8.2 P1：`DEFAULT_AUTO_CONFIG` 回滚`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100628 pattern=AUTO_ context=needs_manual_review line=油猴构建后若自动指令、Prompt 列表、列表模式默认文本异常，先检查 `getDefaultAutoListPromptsText()` 是否已完整替换所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100631 pattern=AUTO_ context=needs_manual_review line=rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100647 pattern=AUTO_ context=needs_manual_review line=rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100653 pattern=AUTO_ context=needs_manual_review line=- 回滚后 `DEFAULT_AUTO_CONFIG` 与 `createDefaultAutoConfig()` 重复的问题**仍然存在**，不要长期停在回滚态。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100656 pattern=AUTO_ context=needs_manual_review line=2. 只替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100657 pattern=AUTO_ context=needs_manual_review line=3. 只删除 `DEFAULT_AUTO_CONFIG``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100662 pattern=legacy context=likely_guard_or_diagnostic line=### 8.3 P2：legacy guard 回滚`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100666 pattern=legacy context=likely_guard_or_diagnostic line=- `app/utils/legacy_cleanup.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100668 pattern=legacy context=likely_guard_or_diagnostic line=- `tests/test_bridge_payload_legacy_guard.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100681 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100687 pattern=legacy context=likely_guard_or_diagnostic line=git restore app/utils/legacy_cleanup.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100689 pattern=legacy context=likely_guard_or_diagnostic line=git restore tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100697 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100702 pattern=legacy context=likely_guard_or_diagnostic line=- legacy guard 必须保持「拒绝旧字段」语义；允许的唯一演进方向是上游不再发送旧字段，而不是放宽校验。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100804 pattern=legacy context=likely_guard_or_diagnostic line=| 4 | 文档明确 legacy guard 不可弱化（禁止 warning 替代 ValueError） | 见 §8.3 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100833 pattern=localStorage context=likely_guard_or_diagnostic line=- localStorage / QSettings 迁移逻辑`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100834 pattern=migrate context=likely_guard_or_diagnostic line=- validate / assert / reject / sanitize / normalize / migrate 类 guard 函数`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100861 pattern=migrate context=needs_manual_review line=5. validate / assert / reject / sanitize / normalize / migrate 类函数。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100862 pattern=legacy context=likely_guard_or_diagnostic line=6. legacy / compatibility / migration guard。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100863 pattern=localStorage context=likely_guard_or_diagnostic line=7. localStorage / QSettings 旧字段迁移代码。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100899 pattern=feature context=needs_manual_review line=python tools/find_feature_flag_dead_code_candidates.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100938 pattern=legacy context=likely_guard_or_diagnostic line=| `test_bridge_payload_legacy_guard` 失败 | 旧字段又能入队 | §12.3：恢复 fail-fast，勿 `pop("request_id")` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100939 pattern=migration context=likely_guard_or_diagnostic line=| `test_job_scheduler_status_migration` 失败 | 取消/统计仍读旧字段 | §12.4：检查 `send_job_to_cursor` / `get_job_scheduler_snapshot` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100940 pattern=AUTO_ context=needs_manual_review line=| 构建后仍有 `DEFAULT_AUTO_CONFIG` | 源码未清干净 | §12.5：改 `tampermonkey-userscript-src/`，再 `npm run build` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100960 pattern=legacy context=likely_guard_or_diagnostic line=如果出现 `legacy fields still exist before save`，**不要**直接删除 legacy guard，应定位上游旧字段来源。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100962 pattern=legacy context=likely_guard_or_diagnostic line=### `legacy fields still exist before save` 的区分`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100967 pattern=legacy context=likely_guard_or_diagnostic line=| 正在保护 `legacy_cleanup.py` guard | 该错误表示 guard 仍在工作，不能因此删除 guard |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:100978 pattern=QSettings context=needs_manual_review line=- `persist_qsettings_last_url()` 中旧 QSettings key 清理循环`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101059 pattern=localStorage context=likely_guard_or_diagnostic line=这些路径覆盖：Qt 槽、Flask API、control command、bridge payload、油猴 DOM selector、localStorage / GM 迁移、Cursor 队列、Prompt 默认配置等动态入口。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101205 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "模块名"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101206 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "importlib"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101207 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "register_blueprint"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101253 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "文件名"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101254 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "模块名"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101292 pattern=legacy context=likely_guard_or_diagnostic line=| `safe_guard_or_migration_test` | 上下文含 reject / raises / legacy / guard / migration 等，多为**故意**验证旧字段被拒绝或迁移 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101305 pattern=legacy context=likely_guard_or_diagnostic line=1. 验证 legacy guard **会拒绝**旧字段的测试。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101306 pattern=migration context=likely_guard_or_diagnostic line=2. 验证 migration 能把旧字段迁移到新字段的测试。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101316 pattern=legacy context=likely_guard_or_diagnostic line="request_id": "legacy-id"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101326 pattern=AUTO_ context=needs_manual_review line=4. 断言 `DEFAULT_AUTO_CONFIG` 是默认配置源的测试。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101359 pattern=AUTO_ context=needs_manual_review line=旧默认配置源断言应改为对 `createDefaultAutoConfig()`（或项目当前 canonical 默认工厂）的断言，而不是 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101365 pattern=debug context=likely_guard_or_diagnostic line=`tools/find_feature_flag_dead_code_candidates.py` 扫描 Python / JS / TS / JSON / MD / TXT 中与 debug、feature flag、legacy、fallback、migration 等相关的行，输出 `[FEATURE_FLAG_CANDIDATE]`。**只输出候选，不自动删除、不修改业务文件。**`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101371 pattern=debug context=likely_guard_or_diagnostic line=| `likely_guard_or_diagnostic` | 行内或上下文含 guard / migration / fallback / debug / compat / legacy 等，多为**低频但必要**的诊断或兜底 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101377 pattern=feature context=needs_manual_review line=python tools/find_feature_flag_dead_code_candidates.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101380 pattern=feature context=needs_manual_review line=已接入 `tools/run_dead_code_cleanup_checks.py`（`feature_flag_dead_code_candidates` 步骤，位于 `stale_tests_candidates` 与 `api_route_usage_candidates` 之间）。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101386 pattern=debug context=likely_guard_or_diagnostic line=1. debug / verbose / trace 相关分支。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101387 pattern=feature context=needs_manual_review line=2. feature flag 控制的新旧流程切换。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101391 pattern=fallback context=likely_guard_or_diagnostic line=6. 只在失败兜底时触发的 fallback。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101392 pattern=migration context=likely_guard_or_diagnostic line=7. 只在旧配置导入时触发的 migration。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101398 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if DEBUG_FULL_BRIDGE_JSON:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101405 pattern=legacy context=likely_guard_or_diagnostic line=if settings.value("use_legacy_import", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101406 pattern=migrate context=needs_manual_review line=migrate_old_import_data()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101427 pattern=debug context=likely_guard_or_diagnostic line=1. debug 模式使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101430 pattern=fallback context=likely_guard_or_diagnostic line=4. fallback 仅在失败时触发。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101431 pattern=migration context=likely_guard_or_diagnostic line=5. migration 仅在旧配置中触发。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101434 pattern=GM_getValue context=likely_guard_or_diagnostic line=8. 油猴 `GM_getValue` / `localStorage` 迁移逻辑。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101436 pattern=DEBUG_ context=likely_guard_or_diagnostic line=**明确**：`DEBUG_FULL_BRIDGE_JSON` 等调试常量**不应**按 dead code 直接删除；若需调整，应迁移到设置项或配置项，属于单独任务。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101509 pattern=migration context=likely_guard_or_diagnostic line=| **low** | `[UNUSED_IMPORT_CANDIDATE]`、`[DEAD_ARTIFACT_FILE_CANDIDATE]`、`generated_runtime_artifact_keep`、`safe_guard_or_migration_*` | unused import 可小批量清理；缓存/备份加 `.gitignore` 或人工删；生成产物只排除审查；guard 保留 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101525 pattern=feature context=likely_guard_or_diagnostic line=| `tools/find_feature_flag_dead_code_candidates.py` | 功能开关 / 调试 / fallback / migration 伪僵尸代码候选（只读，不自动删） |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101700 pattern=legacy context=likely_guard_or_diagnostic line=如果出现 `legacy fields still exist before save`，不要直接删除 legacy guard。应继续定位上游旧字段来源。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101743 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101749 pattern=enable_ context=needs_manual_review line=from app.cursor_code.capture import enable_dpi_awareness`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101762 pattern=trace context=likely_guard_or_diagnostic line=def handle_exception(exc_type, exc_value, exc_traceback):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101764 pattern=trace context=likely_guard_or_diagnostic line=traceback.format_exception(exc_type, exc_value, exc_traceback)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:101779 pattern=enable_ context=needs_manual_review line=enable_dpi_awareness()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12 pattern=GM_setValue context=needs_manual_review line=// @grant        GM_setValue`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13 pattern=GM_getValue context=needs_manual_review line=// @grant        GM_getValue`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:148 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 旧缓存可能含 READY；新流程不再产生，normalizeUploadState 会归一化为 IDLE。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:159 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 仅用于兼容旧版本上传缓存状态，新上传流程不再产生这些状态。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:464 pattern=migrate context=needs_manual_review line=function migrateTaskDoneSignalValue(value, logFn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:782 pattern=migrate context=needs_manual_review line=function migrateContinuePromptTextIfNeeded(storedText, logFn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:786 pattern=migrate context=needs_manual_review line=return { value: '', migrated: false, reason: 'empty-use-runtime-default' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:793 pattern=migrate context=needs_manual_review line=return { value: '', migrated: true, reason: 'old-continue' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:798 pattern=legacy context=likely_guard_or_diagnostic line=logFn('[CONTINUE_PROMPT][MIGRATE_DEFAULT] old=legacy-prompt new=explicit-task-done');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:800 pattern=legacy context=likely_guard_or_diagnostic line=return { value: '', migrated: true, reason: 'legacy-prompt' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:806 pattern=migrate context=needs_manual_review line=return { value: trimmed, migrated: false, reason: 'user-customized' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:846 pattern=deprecated context=likely_guard_or_diagnostic line=- 建议保留但标记 @deprecated`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1030 pattern=fallback context=likely_guard_or_diagnostic line=function getValue(root, selector, fallback, moduleName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1032 pattern=fallback context=likely_guard_or_diagnostic line=if (!el) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1033 pattern=fallback context=likely_guard_or_diagnostic line=return String(el.value ?? fallback ?? '');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1036 pattern=fallback context=likely_guard_or_diagnostic line=function getChecked(root, selector, fallback, moduleName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1038 pattern=fallback context=likely_guard_or_diagnostic line=if (!el) return !!fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1111 pattern=fallback context=likely_guard_or_diagnostic line=function normalizePromptCategoryName(item, fallback = '默认') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1116 pattern=fallback context=likely_guard_or_diagnostic line=return text || fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1170 pattern=fallback context=likely_guard_or_diagnostic line=function readStorage(key, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1171 pattern=fallback context=likely_guard_or_diagnostic line=return StorageKit.readJson(key, fallback, { scoped: true });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1178 pattern=fallback context=likely_guard_or_diagnostic line=function readLocalJson(key, fallback, tag = '[STORAGE]') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1179 pattern=fallback context=likely_guard_or_diagnostic line=return StorageKit.readJson(key, fallback, { scoped: false, tag });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1186 pattern=fallback context=likely_guard_or_diagnostic line=function clonePlainObject(value, fallback = null, tag = '[CLONE]') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1205 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1884 pattern=fallback context=likely_guard_or_diagnostic line=function readJson(key, fallback, options = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1890 pattern=GM_getValue context=needs_manual_review line=if (scoped && typeof GM_getValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1891 pattern=GM_getValue context=needs_manual_review line=const value = GM_getValue(resolvedKey, null);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1895 pattern=GM_getValue context=needs_manual_review line=logError(`${tag}[GM_getValue-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1899 pattern=localStorage context=needs_manual_review line=const raw = window.localStorage.getItem(resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1900 pattern=fallback context=likely_guard_or_diagnostic line=if (raw == null || raw === '') return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1903 pattern=fallback context=likely_guard_or_diagnostic line=return parsed == null ? fallback : parsed;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1905 pattern=localStorage context=needs_manual_review line=logError(`${tag}[localStorage-read-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1906 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1916 pattern=GM_setValue context=needs_manual_review line=if (scoped && typeof GM_setValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1917 pattern=GM_setValue context=needs_manual_review line=GM_setValue(resolvedKey, value);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1921 pattern=GM_setValue context=needs_manual_review line=logError(`${tag}[GM_setValue-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1926 pattern=localStorage context=needs_manual_review line=window.localStorage.removeItem(resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1928 pattern=localStorage context=needs_manual_review line=window.localStorage.setItem(resolvedKey, JSON.stringify(value));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:1933 pattern=localStorage context=needs_manual_review line=logError(`${tag}[localStorage-write-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2019 pattern=DEBUG_ context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[DEBUG_API][skip-existing] ${fullName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2027 pattern=DEBUG_ context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[DEBUG_API][registered] ${fullName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2320 pattern=fallback context=likely_guard_or_diagnostic line=function clampNumber(value, fallback, min, max) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2322 pattern=fallback context=likely_guard_or_diagnostic line=const safe = Number.isFinite(n) ? n : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2490 pattern=fallback context=likely_guard_or_diagnostic line=function get(key, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2491 pattern=fallback context=likely_guard_or_diagnostic line=return readStorage(key, fallback);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2616 pattern=fallback context=likely_guard_or_diagnostic line=function readToolboxStateField(state, fieldName, fallback = '') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2620 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2643 pattern=legacy context=likely_guard_or_diagnostic line=const legacyKeys = TOOLBOX_PAGE_STATE_LEGACY_READ_ALIASES[key];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2644 pattern=legacy context=likely_guard_or_diagnostic line=if (Array.isArray(legacyKeys)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2645 pattern=legacy context=likely_guard_or_diagnostic line=for (let i = 0; i < legacyKeys.length; i += 1) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2646 pattern=legacy context=likely_guard_or_diagnostic line=const legacyValue = readValue(legacyKeys[i]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2647 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyValue !== undefined) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2648 pattern=legacy context=likely_guard_or_diagnostic line=return legacyValue;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2653 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2726 pattern=legacy context=likely_guard_or_diagnostic line=const legacyTaskFields = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2732 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].continuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2735 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].defaultContinuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2739 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].tasks[${taskIndex}].continuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2743 pattern=legacy context=likely_guard_or_diagnostic line=logLegacyFieldFinding('autoQueueConfig', legacyTaskFields);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2757 pattern=legacy context=likely_guard_or_diagnostic line=TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS.forEach((legacyKey) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2758 pattern=legacy context=likely_guard_or_diagnostic line=if (Object.prototype.hasOwnProperty.call(state, legacyKey)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2759 pattern=legacy context=likely_guard_or_diagnostic line=pageLegacyFields.push(`${routeKey}.${legacyKey}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2766 pattern=migrate context=needs_manual_review line=let migrated = false;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2777 pattern=legacy context=likely_guard_or_diagnostic line=TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS.forEach((legacyKey) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2778 pattern=legacy context=likely_guard_or_diagnostic line=if (Object.prototype.hasOwnProperty.call(nextState, legacyKey)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2779 pattern=legacy context=likely_guard_or_diagnostic line=delete nextState[legacyKey];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2780 pattern=migrate context=needs_manual_review line=migrated = true;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:2785 pattern=migrate context=needs_manual_review line=if (migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3140 pattern=fallback context=likely_guard_or_diagnostic line=function normalizePositiveInt(value, fallback, min, max) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3142 pattern=fallback context=likely_guard_or_diagnostic line=if (!Number.isFinite(n)) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3144 pattern=fallback context=likely_guard_or_diagnostic line=if (intValue < min) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3156 pattern=legacy context=likely_guard_or_diagnostic line=const legacyLoopPrompt = typeof cfg.copyHotkeyLoopContinuePrompt === 'string'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3159 pattern=legacy context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinuePromptText = String(cfg.copyHotkeyContinuePromptText || legacyLoopPrompt || '').trim();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3161 pattern=legacy context=likely_guard_or_diagnostic line=const legacyLoopStop = typeof cfg.copyHotkeyLoopStopSignal === 'string'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3173 pattern=legacy context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinueStopSignal || legacyLoopStop || DEFAULT_BATCH_TASK_DONE_SIGNAL,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3240 pattern=fallback context=likely_guard_or_diagnostic line=function cloneShortcutItem(item, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3241 pattern=fallback context=likely_guard_or_diagnostic line=const src = item && typeof item === 'object' ? item : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3560 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeTimestamp(value, fallback = nowMs()) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3562 pattern=fallback context=likely_guard_or_diagnostic line=return Number.isFinite(n) && n > 0 ? n : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3577 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackName = options.fallbackName || '未命名';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3582 pattern=fallback context=likely_guard_or_diagnostic line=input && input.name != null ? input.name : fallbackName,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3584 pattern=fallback context=likely_guard_or_diagnostic line=) || fallbackName;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3685 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeToNativeFile(value, fallbackName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3691 pattern=fallback context=likely_guard_or_diagnostic line=return new File([value], fallbackName || 'upload.bin', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3698 pattern=fallback context=likely_guard_or_diagnostic line=return new File([value], value.name || fallbackName || 'upload.bin', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3806 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] textarea fallback copy failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3807 pattern=fallback context=likely_guard_or_diagnostic line=console.error('[ChatGPT toolbox] textarea fallback copy failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3836 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] GM_setClipboard failed, fallback to browser clipboard', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:3856 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] navigator.clipboard.writeText failed, fallback to execCommand', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:4791 pattern=AUTO_ context=needs_manual_review line=const EDGE_AUTO_HIDE_SIDE = 'right';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:4792 pattern=AUTO_ context=needs_manual_review line=const VALID_EDGE_SIDES = Object.freeze([EDGE_AUTO_HIDE_SIDE]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:4854 pattern=AUTO_ context=needs_manual_review line=return String(side || '').trim() === EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:8968 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('create-existing-root-detached');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:9017 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('reuse-existing-dom');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:9116 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('create-new-root');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:9469 pattern=fallback context=likely_guard_or_diagnostic line=const fallback = normalizePanelSize(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:9472 pattern=fallback context=likely_guard_or_diagnostic line=if (!panel) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:9482 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:9930 pattern=AUTO_ context=needs_manual_review line=if (text && text !== EDGE_AUTO_HIDE_SIDE) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:9933 pattern=AUTO_ context=needs_manual_review line=return VALID_EDGE_SIDES.includes(text) ? text : EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10146 pattern=AUTO_ context=needs_manual_review line=if (isStrictlyTouchingEdge(panelRect, EDGE_AUTO_HIDE_SIDE)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10147 pattern=AUTO_ context=needs_manual_review line=return EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10614 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 控制台救援 API，确认无旧版救援脚本依赖后再删除`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10713 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackLeft = Number.isFinite(Number(savedPos.left))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10717 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackTop = Number.isFinite(Number(savedPos.top))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10722 pattern=fallback context=likely_guard_or_diagnostic line=left: fallbackLeft,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10723 pattern=fallback context=likely_guard_or_diagnostic line=top: fallbackTop,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10724 pattern=fallback context=likely_guard_or_diagnostic line=right: fallbackLeft + size.width,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10725 pattern=fallback context=likely_guard_or_diagnostic line=bottom: fallbackTop + size.height,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:10943 pattern=AUTO_ context=needs_manual_review line=const nextSide = EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:11374 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] resize releasePointerCapture failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:11386 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] resize setPointerCapture failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:11989 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackWidth = 110;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:11990 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackHeight = 28;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:11993 pattern=fallback context=likely_guard_or_diagnostic line=const width = rect && rect.width > 0 ? rect.width : fallbackWidth;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:11994 pattern=fallback context=likely_guard_or_diagnostic line=const height = rect && rect.height > 0 ? rect.height : fallbackHeight;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12067 pattern=fallback context=likely_guard_or_diagnostic line=source = 'last-panel-visible-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12074 pattern=fallback context=likely_guard_or_diagnostic line=source = 'saved-panel-position-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12178 pattern=fallback context=likely_guard_or_diagnostic line=const fallback = getPanelSizeFallback();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12190 pattern=fallback context=likely_guard_or_diagnostic line=applyPanelSize(fallback);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12387 pattern=AUTO_ context=needs_manual_review line=edge = EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12497 pattern=AUTO_ context=needs_manual_review line=const shouldHide = enabled && edge === EDGE_AUTO_HIDE_SIDE && panelHidden && !isEdgeHidden();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12536 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPos = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12540 pattern=fallback context=likely_guard_or_diagnostic line=saveHiddenTitlePosition(fallbackPos, `${reason}:fallback`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12541 pattern=fallback context=likely_guard_or_diagnostic line=const lockedFallback = getLockedHiddenTitlePosition(`${reason}:fallback-locked`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12545 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-apply] reason=${reason || '-'} left=${Math.round(lockedFallback.left)} top=${Math.round(lockedFallback.top)} panelLeft=${Math.round(Number(rect.left))} panelTop=${Math.round(Number(rect.to`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12548 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] hidePanel fallback locked position missing', rect);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12550 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} missing-locked-fallback`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12554 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] hidePanel fallback apply skipped: invalid panel rect', rect);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:12556 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} invalid-panel-rect`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13501 pattern=debug context=likely_guard_or_diagnostic line=if (window.console && typeof console.debug === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13502 pattern=debug context=likely_guard_or_diagnostic line=console.debug(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13590 pattern=migrate context=needs_manual_review line=function migrateToolboxToastToPanel(reason = '') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13598 pattern=migrate context=needs_manual_review line=appendLog(`[TOOLBOX_TOAST][migrate] from=root to=panel reason=${reason || '-'}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13762 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] ignored page error', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13794 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] ignored page rejection', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13810 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox][LOG_REENTER]', message);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:13820 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox][LOG_BEFORE_READY]', message);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14249 pattern=fallback context=likely_guard_or_diagnostic line=source = 'full-turn-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14603 pattern=fallback context=likely_guard_or_diagnostic line=function chooseAssistantFinalAnswerText(rawText, fallbackText, meta = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14612 pattern=fallback context=likely_guard_or_diagnostic line=const cleanedFallback = cleanFn(fallbackText || '');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14620 pattern=fallback context=likely_guard_or_diagnostic line=`[CHAT_PAGE][assistant-final-answer-picked] source=after-thinking chars=${cleanedAfterThinking.length} fallbackChars=${String(cleanedFallback || '').length} turn=${meta.turnId || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14631 pattern=fallback context=likely_guard_or_diagnostic line=let source = 'fallback-content';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14677 pattern=AUTO_ context=needs_manual_review line=const QUICK_PROMPT_CLICK_AUTO_SEND = true;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14875 pattern=fallback context=likely_guard_or_diagnostic line=+ 'fallback=hasAssistantDoneSignalInText',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14989 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackGroupId = restored.resolvedGroupId || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14991 pattern=fallback context=likely_guard_or_diagnostic line=if (!fallbackGroupId) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14992 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] ensureActiveUploadGroupIdValid: no fallback group', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:14999 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] activeUploadGroupId invalid, fallback to restored group', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15002 pattern=fallback context=likely_guard_or_diagnostic line=fallbackGroupId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15006 pattern=fallback context=likely_guard_or_diagnostic line=state.activeGroupId = fallbackGroupId;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15010 pattern=fallback context=likely_guard_or_diagnostic line=fallbackGroupId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15091 pattern=fallback context=likely_guard_or_diagnostic line=fallback: files.length ? getUploadFileFolderKey(files[0]) : '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15095 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackFolderKey = getUploadFileFolderKey(files[0]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15098 pattern=fallback context=likely_guard_or_diagnostic line=folderKey: fallbackFolderKey,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15544 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload item source', stage, info, extra);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15558 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload queue snapshot', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15852 pattern=debug context=likely_guard_or_diagnostic line=debugSavedFrom: '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15899 pattern=debug context=likely_guard_or_diagnostic line=if (hasBlob || record.blobSaved || record.blobSavedAt || record.debugSavedFrom) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:15907 pattern=debug context=likely_guard_or_diagnostic line=record.debugSavedFrom = '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16253 pattern=debug context=likely_guard_or_diagnostic line=async function debugReadBackPersistedQueue(stage) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16263 pattern=debug context=likely_guard_or_diagnostic line=req.onerror = () => reject(req.error || new Error('IndexedDB debug getAll failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16278 pattern=debug context=likely_guard_or_diagnostic line=debugSavedFrom: r.debugSavedFrom || '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16284 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] persisted queue readback', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16290 pattern=debug context=likely_guard_or_diagnostic line=console.error('[ChatGPT toolbox] debugReadBackPersistedQueue failed', stage, e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16367 pattern=debug context=likely_guard_or_diagnostic line=await debugReadBackPersistedQueue('persistQueue:after-write');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16648 pattern=migrate context=likely_guard_or_diagnostic line=migrateLegacyUploadSelectionIfNeeded();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16693 pattern=legacy context=likely_guard_or_diagnostic line=reason: 'legacy-missing-group',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16698 pattern=migrate context=needs_manual_review line=async function migrateMissingGroupIdRows() {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16702 pattern=migrate context=needs_manual_review line=ToolboxShell.appendLog('[UPLOAD_GROUP][migrate-missing-group-skip] reason=no-target-group');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16714 pattern=migration context=likely_guard_or_diagnostic line=req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll for migration failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16729 pattern=migrate context=needs_manual_review line=`[UPLOAD_GROUP][migrate-missing-group] target=${targetId} changed=${changed}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16739 pattern=migration context=likely_guard_or_diagnostic line=tx.onerror = () => reject(tx.error || new Error('IndexedDB queue migration transaction failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16740 pattern=migration context=likely_guard_or_diagnostic line=tx.onabort = () => reject(tx.error || new Error('IndexedDB queue migration transaction aborted'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16748 pattern=migrate context=needs_manual_review line=console.error('[ChatGPT toolbox] migrate missing groupId rows failed', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16751 pattern=migrate context=needs_manual_review line=`[UPLOAD_GROUP][migrate-missing-group-error] target=${targetId || '-'} type=${errName} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16788 pattern=deprecated context=likely_guard_or_diagnostic line=`[UPLOAD_DIAG][restore-blob:deprecated] name=${item.name || '-'} id=${item.id || '-'}``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16841 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] loadQueue row restore', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16874 pattern=migrate context=needs_manual_review line=const migrated = await migrateMissingGroupIdRows();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16876 pattern=migrate context=needs_manual_review line=if (migrated === false) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:16878 pattern=legacy context=likely_guard_or_diagnostic line=`[UPLOAD_GROUP][load-queue:migrate-skipped] groupId=${state.activeGroupId || '-'} note=legacy-rows-without-groupId-may-be-invisible`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:17124 pattern=migrate context=likely_guard_or_diagnostic line=function migrateLegacyUploadSelectionIfNeeded() {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:17130 pattern=legacy context=likely_guard_or_diagnostic line=const legacyId = String(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:17133 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyId) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:17137 pattern=legacy context=likely_guard_or_diagnostic line=const group = state.groups.find((item) => item && item.id === legacyId);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:17245 pattern=fallback context=likely_guard_or_diagnostic line=fallback: resolvedFolderKey,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:17887 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:17892 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:18110 pattern=fallback context=likely_guard_or_diagnostic line=`[UPLOAD][IMPORT][QUEUE_GROUP_FALLBACK] old=${rawGroupId} fallback=${groupId}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:18247 pattern=fallback context=likely_guard_or_diagnostic line=appendUploadGroupLog('RENDER', { phase: 'fallback-after-error' });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:18543 pattern=AUTO_ context=needs_manual_review line=if (QUICK_PROMPT_CLICK_AUTO_SEND !== true) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:22111 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:22121 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 supported=0');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:22306 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] fileHandle.getFile failed, no fallback to cache', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:22314 pattern=fallback context=likely_guard_or_diagnostic line=`[UPLOAD_DIAG][readFreshFile:handle-failed-no-fallback] name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} type=${errName} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:22576 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] makeUploadFile failed; fallback to original file', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:22594 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload file name resolved', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:22671 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input upload failed', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:23666 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'quick-category-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27150 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRows = rootEl.querySelectorAll(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27153 pattern=legacy context=likely_guard_or_diagnostic line=legacyRows.forEach((row) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27159 pattern=legacy context=likely_guard_or_diagnostic line=const legacyStatusCounts = qs('#cgpt-upload-status-counts', rootEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27160 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyStatusCounts) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27161 pattern=legacy context=likely_guard_or_diagnostic line=legacyStatusCounts.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27185 pattern=legacy context=likely_guard_or_diagnostic line=const legacyUploadAndSendBtn = qs('#cgpt-upload-start-and-send', actionRow);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27186 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyUploadAndSendBtn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27187 pattern=legacy context=likely_guard_or_diagnostic line=legacyUploadAndSendBtn.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:27320 pattern=AUTO_ context=needs_manual_review line=console.error('[AUTO_CONTINUE][FAILED]', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28053 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRowFields = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28077 pattern=legacy context=likely_guard_or_diagnostic line=legacyRowFields.push(`queue[${index}].upload_active_group_id`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28090 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRowFields.length) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28091 pattern=legacy context=likely_guard_or_diagnostic line=const line = `[FIELD][LEGACY_FOUND] scope=uploadQueue fields=${legacyRowFields.join(',')}`;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28525 pattern=migrate context=needs_manual_review line=if (typeof migrateContinuePromptTextIfNeeded === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28526 pattern=migration context=likely_guard_or_diagnostic line=const migration = migrateContinuePromptTextIfNeeded(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28530 pattern=migration context=likely_guard_or_diagnostic line=if (migration.migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28531 pattern=migration context=likely_guard_or_diagnostic line=config.continuePromptsText = migration.value;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28561 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '未命名列表',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28575 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '默认列表',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28743 pattern=migrate context=needs_manual_review line=function migrateTaskDoneSignalForAutoQueue(value) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28744 pattern=migrate context=needs_manual_review line=if (typeof migrateTaskDoneSignalValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28745 pattern=migrate context=needs_manual_review line=return migrateTaskDoneSignalValue(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28779 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeContinueRoundLimit(value, fallback = UNLIMITED_CONTINUE_ROUNDS) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28782 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28864 pattern=legacy context=likely_guard_or_diagnostic line=const legacyTemplate = String(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:28876 pattern=legacy context=likely_guard_or_diagnostic line=continuePromptTemplate: String(legacyTemplate || ''),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29071 pattern=migrate context=needs_manual_review line=const migrateNotes = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29076 pattern=migrate context=needs_manual_review line=migrateNotes.push('init-taskProfiles-array');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29087 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '默认任务组',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29092 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:init-tasks-array`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29099 pattern=migrate context=needs_manual_review line=normalized.doneSignal = migrateTaskDoneSignalForAutoQueue(normalized.doneSignal);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29119 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:migrate-max-continue-unlimited`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29140 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:repair-template`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29158 pattern=migrate context=needs_manual_review line=migrateNotes.push('seed-default-profile-with-example-tasks');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29163 pattern=migrate context=needs_manual_review line=const summary = migrateNotes.includes('seed-default-profile-with-example-tasks')`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29166 pattern=migrate context=needs_manual_review line=const detail = migrateNotes.length ? `${migrateNotes.join('; ')}; ` : '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29168 pattern=migrate context=needs_manual_review line=} else if (migrateNotes.length) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29169 pattern=migrate context=needs_manual_review line=ToolboxShell.appendLog(`[AUTOQ][TASK][MIGRATE] ${migrateNotes.join('; ')}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29575 pattern=legacy context=likely_guard_or_diagnostic line=const legacyHeader = taskPanelEl.querySelector(':scope > .cgpt-autoq-list-header');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29576 pattern=legacy context=likely_guard_or_diagnostic line=const legacyNameRow = taskPanelEl.querySelector(':scope > .cgpt-autoq-list-name-row');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29577 pattern=legacy context=likely_guard_or_diagnostic line=const legacyList = qs('#cgpt-autoq-task-list', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29578 pattern=legacy context=likely_guard_or_diagnostic line=const legacyEditor = qs('#cgpt-autoq-task-editor', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29579 pattern=legacy context=likely_guard_or_diagnostic line=const legacyDefaults = qs('#cgpt-autoq-task-profile-defaults', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29623 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyHeader && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29627 pattern=legacy context=likely_guard_or_diagnostic line=shellHeader.replaceWith(legacyHeader);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29631 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyNameRow && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29634 pattern=legacy context=likely_guard_or_diagnostic line=if (shellNameRow && shellNameRow !== legacyNameRow) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29635 pattern=legacy context=likely_guard_or_diagnostic line=shellNameRow.replaceWith(legacyNameRow);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29639 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyList && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29642 pattern=legacy context=likely_guard_or_diagnostic line=if (shellList && shellList !== legacyList) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29643 pattern=legacy context=likely_guard_or_diagnostic line=shellList.replaceWith(legacyList);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29649 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyEditor && currentPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29652 pattern=legacy context=likely_guard_or_diagnostic line=if (shellEditor && shellEditor !== legacyEditor) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29653 pattern=legacy context=likely_guard_or_diagnostic line=shellEditor.replaceWith(legacyEditor);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29659 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyDefaults && rulesPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29662 pattern=legacy context=likely_guard_or_diagnostic line=if (shellDefaults && shellDefaults !== legacyDefaults) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29663 pattern=legacy context=likely_guard_or_diagnostic line=shellDefaults.replaceWith(legacyDefaults);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29667 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyHeader && legacyHeader.parentElement === taskPanelEl) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29668 pattern=legacy context=likely_guard_or_diagnostic line=legacyHeader.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29671 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyNameRow && legacyNameRow.parentElement === taskPanelEl) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:29672 pattern=legacy context=likely_guard_or_diagnostic line=legacyNameRow.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:31639 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_REPLY_DONE]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:32976 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_SKIP] reason=missing_context task_id=${taskId || '-'} direction=${direction || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:32987 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_SKIP] reason=button_not_found task_id=${taskId} direction=${actionName} selector=${selector}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:33006 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_OK] task_id=${taskId} direction=${actionName} delta_y=${Math.round(deltaY)} scroll_top=${Math.round(listEl.scrollTop)}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:33028 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][START] task_id=${taskId} direction=${direction} before_scroll_top=${beforeListScrollTop}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:33038 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][SKIP] task_id=${taskId} direction=${direction} reason=${reason}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:33506 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH_START_CLICK] mode=task group_id=${profile ? profile.id : '-'} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:33628 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BACKGROUND_THROTTLED] action=${actionName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:33743 pattern=legacy context=likely_guard_or_diagnostic line=kind: 'legacy',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34023 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][WAIT_SEND_BUTTON] attempt=${attempt} found=${found} disabled=${disabledFlag} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34039 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'send_button_disabled_use_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34058 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'send_button_missing_use_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34093 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=stableSendMessage_unavailable');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34149 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][TEXT_SYNC_OK] retryIndex=${retryIndex} prompt_len=${prompt.length} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34166 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][TEXT_SYNC_FAILED] reason=${lastSyncReason} prompt_len=${prompt.length} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34177 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_START]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34191 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${failReason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34197 pattern=fallback context=likely_guard_or_diagnostic line=`[AUTOQ][SEND_CLICK] task=${taskName} note=button_disabled_will_use_enter_fallback ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34221 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_OK]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34222 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][WAIT_INITIAL_REPLY]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34227 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34265 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34269 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_SEND_DONE]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34270 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_WAIT_REPLY_START]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34299 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${errText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34335 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_WAIT_RESPONDING]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34389 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH_INITIAL_PROMPT_PICKED] text_len=${initial.length} task_title=${currentTask.title}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34404 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34423 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${errText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:34949 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][FOREGROUND_RESUME] reason=${tag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:36898 pattern=migrate context=needs_manual_review line=function migrateCompactContinuePromptIfNeeded(cfg, options = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:36902 pattern=migrate context=needs_manual_review line=if (typeof migrateContinuePromptTextIfNeeded !== 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:36910 pattern=migration context=likely_guard_or_diagnostic line=const migration = migrateContinuePromptTextIfNeeded(stored, logFn);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:36912 pattern=migration context=likely_guard_or_diagnostic line=if (migration.migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:36913 pattern=migration context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinuePromptText = migration.value;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:36933 pattern=migrate context=needs_manual_review line=cfg = migrateCompactContinuePromptIfNeeded(cfg, { log: true });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:36944 pattern=migrate context=needs_manual_review line=const cfg = migrateCompactContinuePromptIfNeeded(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38057 pattern=debug context=likely_guard_or_diagnostic line=function debugLog(text) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38200 pattern=legacy context=likely_guard_or_diagnostic line=const legacy = String(sessionStorage.getItem('xz_bind_token') || '').trim();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38201 pattern=legacy context=likely_guard_or_diagnostic line=if (legacy) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38202 pattern=legacy context=likely_guard_or_diagnostic line=clearStoredBindRequestToken('legacy-without-meta');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38408 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPathname = location && location.pathname ? location.pathname : '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38409 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackConversationId = parseConversationIdFromPath(fallbackPathname);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38412 pattern=fallback context=likely_guard_or_diagnostic line=`[getPageIdentity][failed] type=${errName} pathname=${fallbackPathname || '-'} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38418 pattern=fallback context=likely_guard_or_diagnostic line=`[BRIDGE][IDENTITY][FAILED] type=${errName} pathname=${fallbackPathname || '-'} conversation_id=${fallbackConversationId || '-'} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38422 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPageDisplayId = getCurrentBridgePageDisplayId();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38426 pattern=fallback context=likely_guard_or_diagnostic line=page_display_id: fallbackPageDisplayId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38427 pattern=fallback context=likely_guard_or_diagnostic line=page_no: fallbackPageDisplayId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38433 pattern=fallback context=likely_guard_or_diagnostic line=page_type: fallbackConversationId ? 'conversation' : 'unknown',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38434 pattern=fallback context=likely_guard_or_diagnostic line=conversation_id: fallbackConversationId || '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38439 pattern=fallback context=likely_guard_or_diagnostic line=pathname: fallbackPathname,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38452 pattern=DEBUG_ context=likely_guard_or_diagnostic line=const DEBUG_FULL_BRIDGE_JSON = false;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38488 pattern=debug context=likely_guard_or_diagnostic line=const debugEnabled = !!cfg.bridgeDebugEnabled;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38492 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if (!DEBUG_FULL_BRIDGE_JSON && !debugEnabled) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38932 pattern=localStorage context=needs_manual_review line=localStorage.removeItem(getPendingReplyContextKey());`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38933 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38949 pattern=localStorage context=needs_manual_review line=Object.keys(localStorage).forEach((key) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38955 pattern=localStorage context=needs_manual_review line=ctx = JSON.parse(localStorage.getItem(key) || 'null');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38966 pattern=localStorage context=needs_manual_review line=localStorage.removeItem(key);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38969 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38970 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38971 pattern=legacy context=likely_guard_or_diagnostic line=let legacyCtx = null;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38973 pattern=legacy context=likely_guard_or_diagnostic line=legacyCtx = JSON.parse(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38974 pattern=legacy context=likely_guard_or_diagnostic line=} catch (legacyParseError) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38976 pattern=legacy context=likely_guard_or_diagnostic line=error_type: legacyParseError && legacyParseError.name,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38977 pattern=legacy context=likely_guard_or_diagnostic line=error: legacyParseError && legacyParseError.message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38978 pattern=legacy context=likely_guard_or_diagnostic line=stack: legacyParseError && legacyParseError.stack,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38981 pattern=legacy context=likely_guard_or_diagnostic line=const legacySentAt = Number((legacyCtx && legacyCtx.sent_at) || 0);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38982 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx || legacyCtx.reply_reported || !legacySentAt || now - legacySentAt > ttlMs) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:38983 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39103 pattern=localStorage context=needs_manual_review line=localStorage.setItem(pageKey, JSON.stringify(ctx));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39105 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39106 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39107 pattern=legacy context=likely_guard_or_diagnostic line=let legacyCtx = null;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39109 pattern=legacy context=likely_guard_or_diagnostic line=legacyCtx = JSON.parse(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39110 pattern=legacy context=likely_guard_or_diagnostic line=} catch (legacyParseError) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39112 pattern=legacy context=likely_guard_or_diagnostic line=error_type: legacyParseError && legacyParseError.name,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39113 pattern=legacy context=likely_guard_or_diagnostic line=error: legacyParseError && legacyParseError.message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39114 pattern=legacy context=likely_guard_or_diagnostic line=stack: legacyParseError && legacyParseError.stack,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39118 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx || isPendingReplyContextForCurrentPage(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39119 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39145 pattern=localStorage context=needs_manual_review line=let raw = localStorage.getItem(pageKey) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39148 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39149 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39153 pattern=legacy context=likely_guard_or_diagnostic line=const legacyCtx = parsePendingReplyContextRaw(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39154 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39158 pattern=legacy context=likely_guard_or_diagnostic line=if (!hasAnyPendingReplyContextIdentity(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39163 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39167 pattern=legacy context=likely_guard_or_diagnostic line=if (!isPendingReplyContextForCurrentPage(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39168 pattern=legacy context=likely_guard_or_diagnostic line=logIgnoredForeignPendingReplyContext(legacyCtx, 'legacy-load');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39172 pattern=legacy context=likely_guard_or_diagnostic line=localStorage.setItem(pageKey, legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39173 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:39174 pattern=legacy context=likely_guard_or_diagnostic line=raw = legacyRaw;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:40910 pattern=debug context=likely_guard_or_diagnostic line=debugLog(`identity changed: ${oldKey || '-'} -> ${key}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:40930 pattern=debug context=likely_guard_or_diagnostic line=debugLog(`route identity changed: ${oldKey || '-'} -> ${key}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:41133 pattern=debug context=likely_guard_or_diagnostic line=selector: '#cgpt-bridge-debug',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:41564 pattern=debug context=likely_guard_or_diagnostic line=<input type="checkbox" id="cgpt-bridge-debug">`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:41743 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] buildChatExportText records failed, fallback to ComposerApi', exportErr);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:41886 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] skip invalid JSON candidate', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:41917 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] JSON stringify failed during dedupe', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:42400 pattern=trace context=likely_guard_or_diagnostic line='error', 'warn', 'failed', 'fail', 'exception', 'traceback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:43268 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'no-latest-user-fallback-last-assistant',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:44111 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackStartedAt = Date.now();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:44123 pattern=fallback context=likely_guard_or_diagnostic line=`[CHAT_MSG][LATEST_FALLBACK_FULL_SCAN] reason=${reason} cost=${Date.now() - fallbackStartedAt}ms records=${fullRecords.length}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:44149 pattern=fallback context=likely_guard_or_diagnostic line=reason: mode === 'fast' ? 'fast-tail' : 'full-scan-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:44674 pattern=fallback context=likely_guard_or_diagnostic line=source: 'svg-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:45169 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] execCommand insertText failed; fallback to textContent', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:45279 pattern=debug context=likely_guard_or_diagnostic line=const debugText = [`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:45287 pattern=debug context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[COMPOSER][click-send] ${debugText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:46009 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] attachment evidence timeout', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:46173 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input upload failed: no file inputs');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:46190 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] legacy input upload try', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:46287 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input dispatch failed', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:48791 pattern=fallback context=likely_guard_or_diagnostic line=result.reason = 'sent_by_enter_fallback_disabled_button';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:48869 pattern=fallback context=likely_guard_or_diagnostic line=result.reason = result.usedFallbackEnter ? 'sent_by_enter_fallback' : 'sent';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:49671 pattern=fallback context=likely_guard_or_diagnostic line=const ctrlEnter = await runActionAndConfirm('ctrl_enter_fallback', () => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:49686 pattern=fallback context=likely_guard_or_diagnostic line=const enter = await runActionAndConfirm('enter_fallback', () => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:49702 pattern=fallback context=likely_guard_or_diagnostic line='native_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:49708 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][ACTION_SKIP] method=native_enter_fallback reason=composer-focus-failed');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:49717 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][ACTION_SKIP] method=native_enter_fallback reason=bridge-unavailable');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50089 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][WAIT_BUTTON_SKIP] reason=existing-composer-use-action-fallback');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50191 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_READY] source=${source}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50198 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_READY_TIMEOUT] source=${source}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50215 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_BUTTON_MISS] source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50221 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_FOUND] source=${sourceTag} selector=${info.selector || '-'} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50227 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_REJECT] source=${sourceTag} reason=voice_button ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50235 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_DISABLED] source=${sourceTag} aria=${info.aria || '-'} testid=${info.testid || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50242 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_BUTTON_CLICK] source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50253 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_SKIP] reason=empty_text source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50257 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_START] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50265 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_not_ready`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50273 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog('[AUTO_QUEUE][BATCH_INITIAL_WAIT_RESPONDING]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50281 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_not_found`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50287 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_set_failed`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50291 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_TEXT_SET] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50298 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_text_not_synced`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50302 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_TEXT_SYNCED] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50315 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=sendContentViaComposer`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50325 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_STABLE_FAILED] source=${sourceTag} reason=${viaComposer.reason || 'unknown'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50339 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=stableSendMessage`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50349 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_STABLE_FAILED] source=${sourceTag} reason=${stableResult.reason || 'unknown'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50361 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=click_button`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50368 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=click_button`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50394 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=keyboard_enter`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] client.user.js:50399 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=no_send_method`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] export_for_chatgpt.py:273 pattern=AUTO_ context=needs_manual_review line=EXPORT_WORKERS_AUTO_CAP = 32`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] export_for_chatgpt.py:305 pattern=AUTO_ context=needs_manual_review line=return max(1, min(EXPORT_WORKERS_AUTO_CAP, n))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] export_for_chatgpt.py:1202 pattern=legacy context=likely_guard_or_diagnostic line=for legacy in (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] export_for_chatgpt.py:1207 pattern=legacy context=likely_guard_or_diagnostic line=if legacy.is_file():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] export_for_chatgpt.py:1208 pattern=legacy context=likely_guard_or_diagnostic line=out.add(legacy.resolve())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] export_for_chatgpt.py:1210 pattern=legacy context=likely_guard_or_diagnostic line=logger.warning("[export] resolve legacy export path failed path=%s", legacy, exc_info=True)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] export_for_chatgpt.py:2503 pattern=AUTO_ context=needs_manual_review line=f"0=自动（min({EXPORT_WORKERS_AUTO_CAP}, CPU 核数)），1=单线程"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] GUI.py:3 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] GUI.py:9 pattern=enable_ context=needs_manual_review line=from app.cursor_code.capture import enable_dpi_awareness`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] GUI.py:22 pattern=trace context=likely_guard_or_diagnostic line=def handle_exception(exc_type, exc_value, exc_traceback):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] GUI.py:24 pattern=trace context=likely_guard_or_diagnostic line=traceback.format_exception(exc_type, exc_value, exc_traceback)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] GUI.py:39 pattern=enable_ context=needs_manual_review line=enable_dpi_awareness()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/constants.py:95 pattern=DEBUG_ context=likely_guard_or_diagnostic line=DEBUG_FULL_BRIDGE_JSON = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/constants.py:215 pattern=AUTO_ context=needs_manual_review line=STATUS_CHIP_AUTO_FOCUS_PREFIX = "自动焦点页"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/constants.py:219 pattern=AUTO_ context=needs_manual_review line=STATUS_CHIP_AUTO_FOCUS_TOOLTIP = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/constants.py:256 pattern=enable_ context=needs_manual_review line="enable_lan_access": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/constants.py:271 pattern=debug context=likely_guard_or_diagnostic line="debug_mode": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:156 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:162 pattern=deprecated context=likely_guard_or_diagnostic line=from app.utils.deprecation_log import log_deprecated_hit`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:165 pattern=deprecated context=likely_guard_or_diagnostic line=log_deprecated_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:167 pattern=compat context=likely_guard_or_diagnostic line=reason="compat_wrapper",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:282 pattern=fallback context=likely_guard_or_diagnostic line="[REMOTE][INVALID_REMOTE_TYPE] type=%s fallback=default",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:286 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:314 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote_work, owner="normalize_remote_chatgpt")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:326 pattern=legacy context=likely_guard_or_diagnostic line=legacy_conversation_id = (base.get("conversation_id") or "").strip() or (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:330 pattern=legacy context=likely_guard_or_diagnostic line=if not legacy_conversation_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:331 pattern=legacy context=likely_guard_or_diagnostic line=legacy_conversation_id = parse_conversation_id(url)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:332 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_conversation_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:333 pattern=legacy context=likely_guard_or_diagnostic line=base["conversation_id"] = legacy_conversation_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:335 pattern=legacy context=likely_guard_or_diagnostic line=base["url"] = f"https://chatgpt.com/c/{legacy_conversation_id}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:375 pattern=debug context=likely_guard_or_diagnostic line=logger.debug(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:382 pattern=debug context=likely_guard_or_diagnostic line=logger.debug(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:415 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/models.py:417 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote, owner="GUI session.remote_chatgpt")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:10 pattern=legacy context=likely_guard_or_diagnostic line=识别并清理当前代码中的 dead code / unreachable code / 被新逻辑替代的旧代码，同时保护 Qt 动态入口、Flask 路由、legacy guard、配置迁移逻辑，避免误删。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:25 pattern=migration context=likely_guard_or_diagnostic line=| 1 | 修 `app/core/job_scheduler.py` 旧 `status` 读取 + `tests/test_job_scheduler_status_migration.py` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:26 pattern=legacy context=likely_guard_or_diagnostic line=| 2 | 加 `tests/test_bridge_payload_legacy_guard.py`，确认不误删 `legacy_cleanup.py` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:30 pattern=AUTO_ context=needs_manual_review line=| 6 | 油猴 `DEFAULT_AUTO_CONFIG` → `getDefaultAutoListPromptsText()`，再 `npm run build` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:31 pattern=deprecated context=likely_guard_or_diagnostic line=| 7 | `remote_binding_enabled()`、`persist_qsettings_last_url()` 加 deprecated / migration 注释与观察日志 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:54 pattern=migrate context=needs_manual_review line=5. **不要**删除 `_migrate_job_status_inplace()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:56 pattern=migration context=likely_guard_or_diagnostic line=### 测试：`tests/test_job_scheduler_status_migration.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:78 pattern=AUTO_ context=needs_manual_review line=3. 将所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 替换为 `getDefaultAutoListPromptsText()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:79 pattern=AUTO_ context=needs_manual_review line=4. 删除 `DEFAULT_AUTO_CONFIG` 常量。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:80 pattern=AUTO_ context=needs_manual_review line=5. 确认全项目无 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:85 pattern=legacy context=likely_guard_or_diagnostic line=## 三、P2：保护 legacy guard（禁止误删）`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:89 pattern=legacy context=likely_guard_or_diagnostic line=- `app/utils/legacy_cleanup.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:91 pattern=legacy context=likely_guard_or_diagnostic line=- `assert_no_legacy_fields()` / `reject_legacy_fields()``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:94 pattern=legacy context=likely_guard_or_diagnostic line=### 测试：`tests/test_bridge_payload_legacy_guard.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:99 pattern=legacy context=likely_guard_or_diagnostic line=断言：错误含 `legacy fields still exist before save` 与 `payload.request_id`；合法结果 `payload` 中无 `request_id`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:108 pattern=deprecated context=likely_guard_or_diagnostic line=- 添加 `@deprecated` docstring。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:110 pattern=deprecated context=likely_guard_or_diagnostic line=- 可低频调用 `log_deprecated_hit(...)`（见 `app/utils/deprecation_log.py`）。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:115 pattern=QSettings context=likely_guard_or_diagnostic line=- 添加注释：旧 QSettings key 迁移清理。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:116 pattern=migration context=likely_guard_or_diagnostic line=- 可低频调用 `log_migration_hit(...)`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:124 pattern=deprecated context=likely_guard_or_diagnostic line=log_deprecated_hit(name, reason="", replacement="", caller="")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:127 pattern=migration context=likely_guard_or_diagnostic line=log_migration_hit(name, old="", new="", reason="")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:140 pattern=deprecated context=likely_guard_or_diagnostic line=| `tools/find_dead_code_candidates.py` | 扫描 `app/**/*.py`、`gui.py`、`server.py`、`client.user.js`；旧 status / deprecated 关键词 / 仅定义无引用；只打印 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:142 pattern=AUTO_ context=needs_manual_review line=| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:143 pattern=legacy context=likely_guard_or_diagnostic line=| `tools/check_must_keep_symbols.py` | 确认 `legacy_cleanup.py`、guard 函数、`validate_outbound_queue_message` 未被误删 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:189 pattern=AUTO_ context=needs_manual_review line=- [ ] `DEFAULT_AUTO_CONFIG` 已删除，默认配置仅 `createDefaultAutoConfig()``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:190 pattern=legacy context=likely_guard_or_diagnostic line=- [ ] `legacy_cleanup.py` 及 guard 函数保留`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:192 pattern=deprecated context=likely_guard_or_diagnostic line=- [ ] `remote_binding_enabled()` 保留并 `@deprecated``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:249 pattern=AUTO_ context=needs_manual_review line=| 不再出现 `DEFAULT_AUTO_CONFIG` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:262 pattern=legacy context=likely_guard_or_diagnostic line=| `legacy_cleanup.py` 仍存在 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:263 pattern=legacy context=likely_guard_or_diagnostic line=| `assert_no_legacy_fields` / `reject_legacy_fields` 仍存在 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:287 pattern=migration context=likely_guard_or_diagnostic line=| `tests/test_job_scheduler_status_migration.py` 通过 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:288 pattern=legacy context=likely_guard_or_diagnostic line=| `tests/test_bridge_payload_legacy_guard.py` 通过 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:343 pattern=legacy context=likely_guard_or_diagnostic line=- app/utils/legacy_cleanup.py missing symbol assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:349 pattern=legacy context=likely_guard_or_diagnostic line=2. **不要**把 legacy guard 改成空函数。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:355 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:360 pattern=legacy context=likely_guard_or_diagnostic line=### 12.3 `test_bridge_payload_legacy_guard.py` 失败`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:366 pattern=legacy context=likely_guard_or_diagnostic line=1. 检查 `validate_outbound_queue_message()` 是否仍调用 `assert_no_legacy_fields()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:380 pattern=migration context=likely_guard_or_diagnostic line=### 12.4 `test_job_scheduler_status_migration.py` 失败`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:396 pattern=AUTO_ context=needs_manual_review line=### 12.5 `npm run build` 后 `DEFAULT_AUTO_CONFIG` 又出现`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:398 pattern=AUTO_ context=needs_manual_review line=若构建后 `rg "DEFAULT_AUTO_CONFIG"` 仍有命中：`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:405 pattern=AUTO_ context=needs_manual_review line=2. 找到 `DEFAULT_AUTO_CONFIG` 的定义和引用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:408 pattern=AUTO_ context=needs_manual_review line=5. 再执行：`rg "DEFAULT_AUTO_CONFIG"``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:418 pattern=legacy context=likely_guard_or_diagnostic line=3. **不要**删除 `legacy_cleanup.py`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:419 pattern=legacy context=likely_guard_or_diagnostic line=4. **不要**把 `assert_no_legacy_fields()` 改成空函数。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:425 pattern=legacy context=likely_guard_or_diagnostic line=10. **不要**一次性混合提交：Python 调度修复、油猴默认配置清理、legacy guard 调整、文档脚本新增——应分步提交便于回滚。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:435 pattern=migration context=likely_guard_or_diagnostic line=git diff -- tests/test_job_scheduler_status_migration.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:436 pattern=legacy context=likely_guard_or_diagnostic line=git diff -- tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:446 pattern=legacy context=likely_guard_or_diagnostic line=| `legacy_cleanup.py` | 未被删除 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:450 pattern=AUTO_ context=needs_manual_review line=| 油猴 | 源码删除 `DEFAULT_AUTO_CONFIG` 后，`client.user.js` 是构建产物更新，非手工乱改 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:463 pattern=deprecated context=likely_guard_or_diagnostic line=│   ├── models.py                           [可选] remote_binding_enabled() 仅 @deprecated 注释`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:466 pattern=migration context=likely_guard_or_diagnostic line=│       ├── bridge_payload.py               [可选] persist_qsettings 旧 key 循环加 migration 注释`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:469 pattern=AUTO_ context=needs_manual_review line=│   └── tampermonkey-userscript-src/**      [必改-P1] 删 DEFAULT_AUTO_CONFIG，唯一入口 createDefaultAutoConfig()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:472 pattern=migration context=likely_guard_or_diagnostic line=│   ├── test_job_scheduler_status_migration.py   [建议]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:473 pattern=legacy context=likely_guard_or_diagnostic line=│   └── test_bridge_payload_legacy_guard.py      [建议]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:498 pattern=migrate context=needs_manual_review line=3. 不要删除 `_migrate_job_status_inplace()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:505 pattern=migration context=likely_guard_or_diagnostic line=| `tests/test_job_scheduler_status_migration.py` | 防止迁移后再次读取旧 `status` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:506 pattern=legacy context=likely_guard_or_diagnostic line=| `tests/test_bridge_payload_legacy_guard.py` | 防止 `legacy_cleanup.py` / `assert_no_legacy_fields()` 被误删或弱化 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:514 pattern=AUTO_ context=needs_manual_review line=| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:515 pattern=legacy context=likely_guard_or_diagnostic line=| `tools/check_must_keep_symbols.py` | 防 legacy guard 关键符号被删 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:529 pattern=deprecated context=likely_guard_or_diagnostic line=| `app/models.py` | `remote_binding_enabled()` 只加 `@deprecated` 注释，不删函数 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:530 pattern=migration context=likely_guard_or_diagnostic line=| `app/utils/bridge_payload.py` | `persist_qsettings_last_url()` 旧 key 清理循环只加 migration 注释 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:538 pattern=AUTO_ context=needs_manual_review line=| `chatgpt-toolbox/tampermonkey-userscript-src/**` | `DEFAULT_AUTO_CONFIG` 只在此清理 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:541 pattern=legacy context=likely_guard_or_diagnostic line=**明确不要改（本轮）：** `app/utils/legacy_cleanup.py` 及其中 `assert_no_legacy_fields()`、`reject_legacy_fields()`、`validate_outbound_queue_message()` 的旧字段拒绝逻辑。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:564 pattern=legacy context=likely_guard_or_diagnostic line=| `tests/` | 只验证 dead code / legacy guard；不依赖真实浏览器、网络、Cursor 进程 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:570 pattern=AUTO_ context=needs_manual_review line=| `tampermonkey-userscript-src/` | 删 `DEFAULT_AUTO_CONFIG`；`createDefaultAutoConfig()` 为唯一默认配置入口 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:581 pattern=migration context=likely_guard_or_diagnostic line=| 1 | `fix:` | `app/core/job_scheduler.py`、`tests/test_job_scheduler_status_migration.py` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:582 pattern=legacy context=likely_guard_or_diagnostic line=| 2 | `test:` | `tests/test_bridge_payload_legacy_guard.py`、`tools/check_must_keep_symbols.py` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:607 pattern=migration context=likely_guard_or_diagnostic line=pytest -q tests/test_job_scheduler_status_migration.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:608 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:619 pattern=AUTO_ context=needs_manual_review line=rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:626 pattern=AUTO_ context=needs_manual_review line=rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:627 pattern=legacy context=likely_guard_or_diagnostic line=# 须存在：legacy_cleanup.py、assert_no_legacy_fields、reject_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:638 pattern=AUTO_ context=needs_manual_review line=| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:639 pattern=legacy context=likely_guard_or_diagnostic line=| **高（本轮不做删除）** | 删 `legacy_cleanup.py`、`assert_no_legacy_fields()`、Flask route、Qt 槽；手工改 `client.user.js`；弱化旧字段 `ValueError` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:641 pattern=deprecated context=likely_guard_or_diagnostic line=高风险项本轮只能：**保护、测试、标记 deprecated**。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:652 pattern=migration context=likely_guard_or_diagnostic line=| 测试 | `tests/test_job_scheduler_status_migration.py` | 已有 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:653 pattern=legacy context=likely_guard_or_diagnostic line=| 测试 | `tests/test_bridge_payload_legacy_guard.py` | 已有 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/cursor_dead_code_cleanup_master_task.md:658 pattern=AUTO_ context=needs_manual_review line=| 油猴 | `tampermonkey-userscript-src/` | 已无 `DEFAULT_AUTO_CONFIG` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:11 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `True` | `339c52c1867e702ece203b9eea374b98a8430307f26bfe35a580532d25e9b548` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:21 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `LEGACY_FIELD_NAMES` | `True` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:22 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `assert_no_legacy_fields` | `True` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:23 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `reject_legacy_fields` | `True` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:25 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/bridge_payload.py` | `assert_no_legacy_fields` | `True` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:37 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:45 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:64 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:70 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:84 pattern=AUTO_ context=needs_manual_review line=pattern=`DEFAULT_AUTO_CONFIG``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:87 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:30:| 6 | 油猴 `DEFAULT_AUTO_CONFIG` → `getDefaultAutoListPromptsText()`，再 `npm run build` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:88 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:78:3. 将所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 替换为 `getDefaultAutoListPromptsText()`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:89 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:79:4. 删除 `DEFAULT_AUTO_CONFIG` 常量。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:90 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:80:5. 确认全项目无 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:91 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:92 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:189:- [ ] `DEFAULT_AUTO_CONFIG` 已删除，默认配置仅 `createDefaultAutoConfig()``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:93 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:249:| 不再出现 `DEFAULT_AUTO_CONFIG` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:94 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:396:### 12.5 `npm run build` 后 `DEFAULT_AUTO_CONFIG` 又出现`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:95 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:398:若构建后 `rg "DEFAULT_AUTO_CONFIG"` 仍有命中：`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:96 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:405:2. 找到 `DEFAULT_AUTO_CONFIG` 的定义和引用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:97 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:408:5. 再执行：`rg "DEFAULT_AUTO_CONFIG"``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:98 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:450:| 油猴 | 源码删除 `DEFAULT_AUTO_CONFIG` 后，`client.user.js` 是构建产物更新，非手工乱改 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:99 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:469:│   └── tampermonkey-userscript-src/**      [必改-P1] 删 DEFAULT_AUTO_CONFIG，唯一入口 createDefaultAutoConfig()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:100 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:101 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:538:| `chatgpt-toolbox/tampermonkey-userscript-src/**` | `DEFAULT_AUTO_CONFIG` 只在此清理 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:102 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:570:| `tampermonkey-userscript-src/` | 删 `DEFAULT_AUTO_CONFIG`；`createDefaultAutoConfig()` 为唯一默认配置入口 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:103 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:619:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:104 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:626:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:105 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:106 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:658:| 油猴 | `tampermonkey-userscript-src/` | 已无 `DEFAULT_AUTO_CONFIG` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:107 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_manifest.json:31:        "symbol": "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:108 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_manifest.json:37:          "rg \"DEFAULT_AUTO_CONFIG\""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:109 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:100:symbol=DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:110 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:108:**处理建议**：`result=replace_then_delete` — 先用 `getDefaultAutoListPromptsText()` 替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用，再删除 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:111 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:197:symbol=DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:112 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:199:tests=npm run build; client.user.js 无 DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:113 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:311:### 8.2 P1：`DEFAULT_AUTO_CONFIG` 回滚`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:114 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:321:油猴构建后若自动指令、Prompt 列表、列表模式默认文本异常，先检查 `getDefaultAutoListPromptsText()` 是否已完整替换所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:115 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:324:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:116 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:340:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:117 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:346:- 回滚后 `DEFAULT_AUTO_CONFIG` 与 `createDefaultAutoConfig()` 重复的问题**仍然存在**，不要长期停在回滚态。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:118 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:349:  2. 只替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:119 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_report.md:350:  3. 只删除 `DEFAULT_AUTO_CONFIG``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:120 pattern=AUTO_ context=needs_manual_review line=docs/dead_code_cleanup_rules.md:121:| 构建后仍有 `DEFAULT_AUTO_CONFIG` | 源码未清干净 | §12.5：改 `tampermonkey-userscript-src/`，再 `npm run build` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:121 pattern=AUTO_ context=needs_manual_review line=tools/check_dead_code_docs_consistency.py:36:    "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:122 pattern=AUTO_ context=needs_manual_review line=tools/check_dead_code_docs_consistency.py:49:    "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:123 pattern=AUTO_ context=needs_manual_review line=tools/check_dead_code_regression.py:52:        "forbidden": "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:124 pattern=AUTO_ context=needs_manual_review line=tools/check_dead_code_regression.py:54:            "生成产物中不应再出现 DEFAULT_AUTO_CONFIG；"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:125 pattern=AUTO_ context=needs_manual_review line=tools/create_dead_code_cleanup_baseline.py:36:    ("default_auto_config", "DEFAULT_AUTO_CONFIG"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:126 pattern=AUTO_ context=needs_manual_review line=tools/find_dead_code_candidates.py:25:    "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:137 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_baseline.md:157 pattern=AUTO_ context=needs_manual_review line=docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:11 pattern=migration context=likely_guard_or_diagnostic line="reason": "job status field has migrated to job_status; direct status reads become stale after migration",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:14 pattern=migration context=likely_guard_or_diagnostic line="pytest -q tests/test_job_scheduler_status_migration.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:22 pattern=migrate context=needs_manual_review line="reason": "job status field has migrated to job_status; direct status reads break pending_chatgpt counting",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:25 pattern=migration context=likely_guard_or_diagnostic line="pytest -q tests/test_job_scheduler_status_migration.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:31 pattern=AUTO_ context=needs_manual_review line="symbol": "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:37 pattern=AUTO_ context=needs_manual_review line="rg \"DEFAULT_AUTO_CONFIG\""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:46 pattern=compat context=likely_guard_or_diagnostic line="reason": "compatibility wrapper for old call name",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:52 pattern=legacy context=likely_guard_or_diagnostic line="symbol": "persist_qsettings_last_url() legacy key cleanup loop",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:54 pattern=legacy context=likely_guard_or_diagnostic line="reason": "legacy QSettings key cleanup for last_page_url/page_url/conversation_url",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:69 pattern=legacy context=likely_guard_or_diagnostic line="path": "app/utils/legacy_cleanup.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:72 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:73 pattern=legacy context=likely_guard_or_diagnostic line="reject_legacy_fields"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:75 pattern=legacy context=likely_guard_or_diagnostic line="reason": "legacy field guard must remain active to block stale payload fields"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:81 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_manifest.json:83 pattern=legacy context=likely_guard_or_diagnostic line="reason": "outbound queue payload validation must continue rejecting legacy fields"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:52 pattern=deprecated context=likely_guard_or_diagnostic line=| `result` | `deleted` / `kept` / `deprecated` / `observe` / `replace` / `replace_then_delete` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:70 pattern=migration context=likely_guard_or_diagnostic line=tests=pytest -q tests/test_job_scheduler_status_migration.py && python -m compileall -q app gui.py server.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:87 pattern=migration context=likely_guard_or_diagnostic line=tests=pytest -q tests/test_job_scheduler_status_migration.py && python -m compileall -q app gui.py server.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:100 pattern=AUTO_ context=needs_manual_review line=symbol=DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:108 pattern=AUTO_ context=needs_manual_review line=**处理建议**：`result=replace_then_delete` — 先用 `getDefaultAutoListPromptsText()` 替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用，再删除 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:127 pattern=deprecated context=likely_guard_or_diagnostic line=**处理建议**：`result=observe` — 暂不删除，只加 `@deprecated` 注释和 `[DEPRECATED_HIT]` 日志。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:137 pattern=QSettings context=likely_guard_or_diagnostic line=reason=旧 QSettings key 迁移清理逻辑，低频但仍可能保护用户历史配置`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:152 pattern=legacy context=likely_guard_or_diagnostic line=| `app/utils/legacy_cleanup.py` | `LEGACY_FIELD_NAMES` / `assert_no_legacy_fields` / `reject_legacy_fields` | 旧字段拒绝逻辑仍在保护 bridge payload | `keep` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:189 pattern=migration context=likely_guard_or_diagnostic line=tests=pytest -q tests/test_job_scheduler_status_migration.py (2 passed); check_dead_code_regression OK`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:197 pattern=AUTO_ context=needs_manual_review line=symbol=DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:199 pattern=AUTO_ context=needs_manual_review line=tests=npm run build; client.user.js 无 DEFAULT_AUTO_CONFIG`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:208 pattern=deprecated context=likely_guard_or_diagnostic line=result=deprecated`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:217 pattern=legacy context=likely_guard_or_diagnostic line=symbol=persist_qsettings_last_url legacy key loop`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:279 pattern=migration context=likely_guard_or_diagnostic line=- `tests/test_job_scheduler_status_migration.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:288 pattern=migration context=likely_guard_or_diagnostic line=pytest -q tests/test_job_scheduler_status_migration.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:295 pattern=migration context=likely_guard_or_diagnostic line=git restore tests/test_job_scheduler_status_migration.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:311 pattern=AUTO_ context=needs_manual_review line=### 8.2 P1：`DEFAULT_AUTO_CONFIG` 回滚`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:321 pattern=AUTO_ context=needs_manual_review line=油猴构建后若自动指令、Prompt 列表、列表模式默认文本异常，先检查 `getDefaultAutoListPromptsText()` 是否已完整替换所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:324 pattern=AUTO_ context=needs_manual_review line=rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:340 pattern=AUTO_ context=needs_manual_review line=rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:346 pattern=AUTO_ context=needs_manual_review line=- 回滚后 `DEFAULT_AUTO_CONFIG` 与 `createDefaultAutoConfig()` 重复的问题**仍然存在**，不要长期停在回滚态。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:349 pattern=AUTO_ context=needs_manual_review line=2. 只替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:350 pattern=AUTO_ context=needs_manual_review line=3. 只删除 `DEFAULT_AUTO_CONFIG``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:355 pattern=legacy context=likely_guard_or_diagnostic line=### 8.3 P2：legacy guard 回滚`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:359 pattern=legacy context=likely_guard_or_diagnostic line=- `app/utils/legacy_cleanup.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:361 pattern=legacy context=likely_guard_or_diagnostic line=- `tests/test_bridge_payload_legacy_guard.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:374 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:380 pattern=legacy context=likely_guard_or_diagnostic line=git restore app/utils/legacy_cleanup.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:382 pattern=legacy context=likely_guard_or_diagnostic line=git restore tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:390 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:395 pattern=legacy context=likely_guard_or_diagnostic line=- legacy guard 必须保持「拒绝旧字段」语义；允许的唯一演进方向是上游不再发送旧字段，而不是放宽校验。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_report.md:497 pattern=legacy context=likely_guard_or_diagnostic line=| 4 | 文档明确 legacy guard 不可弱化（禁止 warning 替代 ValueError） | 见 §8.3 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:19 pattern=localStorage context=likely_guard_or_diagnostic line=- localStorage / QSettings 迁移逻辑`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:20 pattern=migrate context=likely_guard_or_diagnostic line=- validate / assert / reject / sanitize / normalize / migrate 类 guard 函数`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:47 pattern=migrate context=needs_manual_review line=5. validate / assert / reject / sanitize / normalize / migrate 类函数。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:48 pattern=legacy context=likely_guard_or_diagnostic line=6. legacy / compatibility / migration guard。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:49 pattern=localStorage context=likely_guard_or_diagnostic line=7. localStorage / QSettings 旧字段迁移代码。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:85 pattern=feature context=needs_manual_review line=python tools/find_feature_flag_dead_code_candidates.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:124 pattern=legacy context=likely_guard_or_diagnostic line=| `test_bridge_payload_legacy_guard` 失败 | 旧字段又能入队 | §12.3：恢复 fail-fast，勿 `pop("request_id")` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:125 pattern=migration context=likely_guard_or_diagnostic line=| `test_job_scheduler_status_migration` 失败 | 取消/统计仍读旧字段 | §12.4：检查 `send_job_to_cursor` / `get_job_scheduler_snapshot` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:126 pattern=AUTO_ context=needs_manual_review line=| 构建后仍有 `DEFAULT_AUTO_CONFIG` | 源码未清干净 | §12.5：改 `tampermonkey-userscript-src/`，再 `npm run build` |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:146 pattern=legacy context=likely_guard_or_diagnostic line=如果出现 `legacy fields still exist before save`，**不要**直接删除 legacy guard，应定位上游旧字段来源。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:148 pattern=legacy context=likely_guard_or_diagnostic line=### `legacy fields still exist before save` 的区分`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:153 pattern=legacy context=likely_guard_or_diagnostic line=| 正在保护 `legacy_cleanup.py` guard | 该错误表示 guard 仍在工作，不能因此删除 guard |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:164 pattern=QSettings context=needs_manual_review line=- `persist_qsettings_last_url()` 中旧 QSettings key 清理循环`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:245 pattern=localStorage context=likely_guard_or_diagnostic line=这些路径覆盖：Qt 槽、Flask API、control command、bridge payload、油猴 DOM selector、localStorage / GM 迁移、Cursor 队列、Prompt 默认配置等动态入口。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:391 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "模块名"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:392 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "importlib"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:393 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "register_blueprint"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:439 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "文件名"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:440 pattern=fallback context=likely_guard_or_diagnostic line=python tools/search_text_fallback.py "模块名"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:478 pattern=legacy context=likely_guard_or_diagnostic line=| `safe_guard_or_migration_test` | 上下文含 reject / raises / legacy / guard / migration 等，多为**故意**验证旧字段被拒绝或迁移 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:491 pattern=legacy context=likely_guard_or_diagnostic line=1. 验证 legacy guard **会拒绝**旧字段的测试。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:492 pattern=migration context=likely_guard_or_diagnostic line=2. 验证 migration 能把旧字段迁移到新字段的测试。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:502 pattern=legacy context=likely_guard_or_diagnostic line="request_id": "legacy-id"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:512 pattern=AUTO_ context=needs_manual_review line=4. 断言 `DEFAULT_AUTO_CONFIG` 是默认配置源的测试。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:545 pattern=AUTO_ context=needs_manual_review line=旧默认配置源断言应改为对 `createDefaultAutoConfig()`（或项目当前 canonical 默认工厂）的断言，而不是 `DEFAULT_AUTO_CONFIG`。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:551 pattern=debug context=likely_guard_or_diagnostic line=`tools/find_feature_flag_dead_code_candidates.py` 扫描 Python / JS / TS / JSON / MD / TXT 中与 debug、feature flag、legacy、fallback、migration 等相关的行，输出 `[FEATURE_FLAG_CANDIDATE]`。**只输出候选，不自动删除、不修改业务文件。**`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:557 pattern=debug context=likely_guard_or_diagnostic line=| `likely_guard_or_diagnostic` | 行内或上下文含 guard / migration / fallback / debug / compat / legacy 等，多为**低频但必要**的诊断或兜底 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:563 pattern=feature context=needs_manual_review line=python tools/find_feature_flag_dead_code_candidates.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:566 pattern=feature context=needs_manual_review line=已接入 `tools/run_dead_code_cleanup_checks.py`（`feature_flag_dead_code_candidates` 步骤，位于 `stale_tests_candidates` 与 `api_route_usage_candidates` 之间）。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:572 pattern=debug context=likely_guard_or_diagnostic line=1. debug / verbose / trace 相关分支。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:573 pattern=feature context=needs_manual_review line=2. feature flag 控制的新旧流程切换。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:577 pattern=fallback context=likely_guard_or_diagnostic line=6. 只在失败兜底时触发的 fallback。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:578 pattern=migration context=likely_guard_or_diagnostic line=7. 只在旧配置导入时触发的 migration。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:584 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if DEBUG_FULL_BRIDGE_JSON:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:591 pattern=legacy context=likely_guard_or_diagnostic line=if settings.value("use_legacy_import", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:592 pattern=migrate context=needs_manual_review line=migrate_old_import_data()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:613 pattern=debug context=likely_guard_or_diagnostic line=1. debug 模式使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:616 pattern=fallback context=likely_guard_or_diagnostic line=4. fallback 仅在失败时触发。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:617 pattern=migration context=likely_guard_or_diagnostic line=5. migration 仅在旧配置中触发。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:620 pattern=GM_getValue context=likely_guard_or_diagnostic line=8. 油猴 `GM_getValue` / `localStorage` 迁移逻辑。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:622 pattern=DEBUG_ context=likely_guard_or_diagnostic line=**明确**：`DEBUG_FULL_BRIDGE_JSON` 等调试常量**不应**按 dead code 直接删除；若需调整，应迁移到设置项或配置项，属于单独任务。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:695 pattern=migration context=likely_guard_or_diagnostic line=| **low** | `[UNUSED_IMPORT_CANDIDATE]`、`[DEAD_ARTIFACT_FILE_CANDIDATE]`、`generated_runtime_artifact_keep`、`safe_guard_or_migration_*` | unused import 可小批量清理；缓存/备份加 `.gitignore` 或人工删；生成产物只排除审查；guard 保留 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_cleanup_rules.md:711 pattern=feature context=likely_guard_or_diagnostic line=| `tools/find_feature_flag_dead_code_candidates.py` | 功能开关 / 调试 / fallback / migration 伪僵尸代码候选（只读，不自动删） |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_manual_smoke_test.md:146 pattern=legacy context=likely_guard_or_diagnostic line=如果出现 `legacy fields still exist before save`，不要直接删除 legacy guard。应继续定位上游旧字段来源。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_reachability_snapshot.md:94 pattern=legacy context=likely_guard_or_diagnostic line=- `app.utils.legacy_cleanup` -> `app/utils/legacy_cleanup.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_reachability_snapshot.md:95 pattern=legacy context=likely_guard_or_diagnostic line=- `app.utils.legacy_fields` -> `app/utils/legacy_fields.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/dead_code_reachability_snapshot.md:108 pattern=trace context=likely_guard_or_diagnostic line=- `app.utils.trace_log` -> `app/utils/trace_log.py``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_append_local_send_turn.py:30 pattern=trace context=likely_guard_or_diagnostic line=trace_id="trace-1",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_append_local_send_turn.py:69 pattern=trace context=likely_guard_or_diagnostic line=trace_id="t1",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_audit_convergence_flow.py:7 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import LEGACY_FIELD_NAMES, assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_audit_convergence_flow.py:104 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(pending, owner="test_sync_pending")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_audit_convergence_flow.py:107 pattern=legacy context=likely_guard_or_diagnostic line=def test_title_in_legacy_field_names():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bound_instance_same_conversation.py:17 pattern=fallback context=likely_guard_or_diagnostic line=def __init__(self, clients, *, auto_refresh=True, allow_send_fallback=True):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bound_instance_same_conversation.py:21 pattern=fallback context=likely_guard_or_diagnostic line=self._allow_send_same_conversation_fallback = allow_send_fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bound_instance_same_conversation.py:22 pattern=fallback context=likely_guard_or_diagnostic line=self._allow_sync_same_conversation_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bound_instance_same_conversation.py:73 pattern=fallback context=likely_guard_or_diagnostic line=def _find_page_by_bound_identity(self, remote, *, status=None, allow_fallback=True):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bound_instance_same_conversation.py:74 pattern=fallback context=likely_guard_or_diagnostic line=del allow_fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bound_instance_same_conversation.py:189 pattern=fallback context=likely_guard_or_diagnostic line=def test_resolve_send_fallback_without_auto_refresh():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bound_instance_same_conversation.py:191 pattern=fallback context=likely_guard_or_diagnostic line=host = _BoundInstanceHost([new_page], auto_refresh=False, allow_send_fallback=True)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_mixin_append_log.py:11 pattern=debug context=likely_guard_or_diagnostic line=def _is_debug_mode_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_mixin_pending.py:19 pattern=trace context=likely_guard_or_diagnostic line="payload": {"trace_id": "t1"},`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_mixin_pending.py:28 pattern=legacy context=likely_guard_or_diagnostic line=def test_prepare_chat_send_from_pending_rejects_legacy_raw_user_text():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_mixin_pending.py:32 pattern=legacy context=likely_guard_or_diagnostic line="raw_user_text": "legacy text",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_mixin_pending.py:34 pattern=legacy context=likely_guard_or_diagnostic line=with pytest.raises(ValueError, match="legacy fields"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:18 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:46 pattern=legacy context=likely_guard_or_diagnostic line="text": "legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:52 pattern=legacy context=likely_guard_or_diagnostic line=def test_read_helpers_ignore_legacy_fields(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:54 pattern=legacy context=likely_guard_or_diagnostic line="target_client_id": "c-legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:55 pattern=legacy context=likely_guard_or_diagnostic line="target_page_instance_id": "p-legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:79 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_outbound_rejects_legacy_id(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:84 pattern=legacy context=likely_guard_or_diagnostic line="id": "legacy-id",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:89 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_outbound_rejects_legacy_raw_user_text(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:99 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_outbound_rejects_legacy_target_url(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:103 pattern=legacy context=likely_guard_or_diagnostic line="message_id": "msg-legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:104 pattern=legacy context=likely_guard_or_diagnostic line="content": "from legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:105 pattern=legacy context=likely_guard_or_diagnostic line="target_url": "https://chatgpt.com/c/legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:111 pattern=legacy context=likely_guard_or_diagnostic line=self.assertEqual(get_bridge_message_id({"id": "legacy-only"}), "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:116 pattern=legacy context=likely_guard_or_diagnostic line="tampermonkey_page_url": "https://legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:121 pattern=legacy context=likely_guard_or_diagnostic line=status = {"tampermonkey_page_url": "https://chatgpt.com/c/legacy"}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:124 pattern=legacy context=likely_guard_or_diagnostic line=def test_load_qsettings_last_url_no_legacy_migration(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:132 pattern=settings.value context=needs_manual_review line=self.assertEqual(settings.value("last_url"), "https://chatgpt.com/c/fresh")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:143 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_inbound_push_payload_rejects_legacy_target_url(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:149 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_inbound_push_payload_rejects_legacy_page_url(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:189 pattern=legacy context=likely_guard_or_diagnostic line=def test_assert_no_legacy_fields_lists_all_banned_keys(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:190 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import LEGACY_FIELD_NAMES`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:205 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields({key: "x"}, owner="test")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload.py:208 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields({"id": "legacy-id"}, owner="test")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:3 pattern=legacy context=likely_guard_or_diagnostic line=本模块保护 ``legacy_cleanup`` / ``bridge_payload`` 中的 fail-fast 边界，避免在`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:8 pattern=legacy context=likely_guard_or_diagnostic line=- ``app/utils/legacy_cleanup.py```
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:9 pattern=legacy context=likely_guard_or_diagnostic line=- ``app/utils/bridge_payload.py`` 中对 ``legacy_cleanup`` 的导入与调用`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:10 pattern=legacy context=likely_guard_or_diagnostic line=- ``app/server/control_commands.py`` 中的 ``assert_no_legacy_fields`` 调用`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:11 pattern=legacy context=likely_guard_or_diagnostic line=- ``LEGACY_FIELD_NAMES``、``assert_no_legacy_fields``、``reject_legacy_fields```
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:17 pattern=legacy context=likely_guard_or_diagnostic line=时必须抛出 ``ValueError``，且错误信息含 ``legacy fields still exist before save```
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:18 pattern=legacy context=likely_guard_or_diagnostic line=与 ``payload.request_id``（由 ``assert_no_legacy_fields`` 深检触发）。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:24 pattern=legacy context=likely_guard_or_diagnostic line=pytest -q tests/test_bridge_payload_legacy_guard.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:49 pattern=legacy context=likely_guard_or_diagnostic line=msg = _canonical_outbound_msg(request_id="legacy-request-id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:55 pattern=legacy context=likely_guard_or_diagnostic line=assert "legacy fields still exist before save" in err`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:70 pattern=trace context=likely_guard_or_diagnostic line="trace_id": "trace-test",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_chat_header_bound_page_id.py:138 pattern=fallback context=likely_guard_or_diagnostic line=def test_fallback_to_combo_when_bound_record_missing_page_id(host):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_chat_message_ui_status.py:85 pattern=legacy context=likely_guard_or_diagnostic line=def test_message_from_dict_rejects_legacy_status(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_chat_message_ui_status.py:89 pattern=legacy context=likely_guard_or_diagnostic line=with pytest.raises(ValueError, match="legacy fields"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_chat_scroll_policy.py:72 pattern=compat context=likely_guard_or_diagnostic line=def test_resolve_force_bottom_compat(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_default_compose_message.py:9 pattern=QSettings context=needs_manual_review line=class _FakeQSettings:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_default_compose_message.py:29 pattern=QSettings context=needs_manual_review line=self._settings = _FakeQSettings(settings_data)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_default_compose_message.py:31 pattern=enable_ context=needs_manual_review line=self._enable_lan_access = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_default_compose_message.py:35 pattern=debug context=likely_guard_or_diagnostic line=self._debug_mode = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_default_compose_message.py:56 pattern=legacy context=likely_guard_or_diagnostic line=def test_save_app_settings_removes_legacy_key():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_default_compose_message.py:60 pattern=settings.value context=needs_manual_review line=assert stub._settings.value("default_compose_message") is None`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_deprecation_log.py:7 pattern=deprecated context=likely_guard_or_diagnostic line=from app.utils.deprecation_log import log_deprecated_hit, log_migration_hit`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_deprecation_log.py:11 pattern=deprecated context=likely_guard_or_diagnostic line=def test_log_deprecated_hit_format(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_deprecation_log.py:13 pattern=deprecated context=likely_guard_or_diagnostic line=log_deprecated_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_deprecation_log.py:15 pattern=compat context=likely_guard_or_diagnostic line=reason="compat_wrapper",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_deprecation_log.py:22 pattern=compat context=likely_guard_or_diagnostic line=self.assertIn("reason=compat_wrapper", message)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_deprecation_log.py:25 pattern=migration context=likely_guard_or_diagnostic line=def test_log_migration_hit_format(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_deprecation_log.py:27 pattern=migration context=likely_guard_or_diagnostic line=log_migration_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_deprecation_log.py:31 pattern=legacy context=likely_guard_or_diagnostic line=reason="cleanup_legacy_qsettings_key",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_enqueue_control_command_result.py:51 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_enqueue_result_structured_and_legacy_msg():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_aliases_parity.py:26 pattern=migrate context=likely_guard_or_diagnostic line=assert "migrateEntryLegacyFields" not in body`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:24 pattern=legacy context=likely_guard_or_diagnostic line=with pytest.raises(ValueError, match="legacy fields"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:34 pattern=fallback context=likely_guard_or_diagnostic line=def test_send_binding_verify_blocks_conversation_mismatch_even_with_fallback():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:54 pattern=fallback context=likely_guard_or_diagnostic line=def test_send_binding_verify_allows_page_instance_fallback_same_conversation():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:56 pattern=fallback context=likely_guard_or_diagnostic line=host._allow_send_same_conversation_fallback = True  # type: ignore[attr-defined]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:75 pattern=fallback context=likely_guard_or_diagnostic line=def test_send_binding_verify_allows_client_id_fallback_same_conversation():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:77 pattern=fallback context=likely_guard_or_diagnostic line=host._allow_send_same_conversation_fallback = True  # type: ignore[attr-defined]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:133 pattern=fallback context=likely_guard_or_diagnostic line=def test_message_allow_fallback_only_from_payload():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:135 pattern=fallback context=likely_guard_or_diagnostic line=assert not bool(msg.get("allow_same_conversation_fallback"))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:136 pattern=fallback context=likely_guard_or_diagnostic line=msg["allow_same_conversation_fallback"] = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:137 pattern=fallback context=likely_guard_or_diagnostic line=assert bool(msg.get("allow_same_conversation_fallback"))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:152 pattern=legacy context=likely_guard_or_diagnostic line=legacy = {"status": "waiting", "request_status": "queued"}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p1.py:153 pattern=legacy context=likely_guard_or_diagnostic line=assert server_module._external_request_status(legacy) == "queued"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:1 pattern=legacy context=likely_guard_or_diagnostic line="""P2 字段收敛：审查清单 7 项回归（无 legacy 字段迁移）。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:21 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:24 pattern=migrate context=needs_manual_review line=def test_remote_chatgpt_setter_migrates_bound_offline():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:33 pattern=legacy context=likely_guard_or_diagnostic line="conversation_id": "conv-legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:37 pattern=legacy context=likely_guard_or_diagnostic line=assert remote["conversation_id"] == "conv-legacy"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:70 pattern=legacy context=likely_guard_or_diagnostic line=with pytest.raises(ValueError, match="legacy"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:82 pattern=legacy context=likely_guard_or_diagnostic line="target_url": "https://chatgpt.com/c/legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:87 pattern=migration context=likely_guard_or_diagnostic line=def test_job_status_migration_on_get_job():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:119 pattern=fallback context=likely_guard_or_diagnostic line=def test_registry_no_clients_fallback_when_pages_exist(server_module):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_convergence_p2.py:173 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(payload, owner="test_prepare_pending")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_uniformity_fixes.py:75 pattern=legacy context=likely_guard_or_diagnostic line=for legacy in ("status", "source", "visible", "request_id", "text"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_uniformity_fixes.py:76 pattern=legacy context=likely_guard_or_diagnostic line=assert legacy not in data`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_uniformity_fixes.py:83 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_legacy_message_visible_in_chat_priority():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_field_uniformity_fixes.py:84 pattern=legacy context=likely_guard_or_diagnostic line=item = SessionMixin._normalize_legacy_message_dict(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_fixed_bridge_behavior_settings.py:1 pattern=QSettings context=needs_manual_review line="""页面绑定/上传/同步固定默认值与 QSettings 遗留键清理。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_fixed_bridge_behavior_settings.py:10 pattern=QSettings context=needs_manual_review line=class _FakeQSettings:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_fixed_bridge_behavior_settings.py:30 pattern=QSettings context=needs_manual_review line=self._settings = _FakeQSettings(settings_data)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_fixed_bridge_behavior_settings.py:32 pattern=enable_ context=needs_manual_review line=self._enable_lan_access = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_fixed_bridge_behavior_settings.py:36 pattern=debug context=likely_guard_or_diagnostic line=self._debug_mode = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_fixed_bridge_behavior_settings.py:56 pattern=legacy context=likely_guard_or_diagnostic line=def test_load_overrides_legacy_qsettings():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_fixed_bridge_behavior_settings.py:57 pattern=legacy context=likely_guard_or_diagnostic line=legacy = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_fixed_bridge_behavior_settings.py:61 pattern=legacy context=likely_guard_or_diagnostic line=stub = _SettingsStub(legacy)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:10 pattern=debug context=likely_guard_or_diagnostic line=def test_should_emit_log_default_blocks_debug():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:11 pattern=debug context=likely_guard_or_diagnostic line=assert should_emit_log("DEBUG", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:12 pattern=debug context=likely_guard_or_diagnostic line=assert should_emit_log("INFO", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:13 pattern=debug context=likely_guard_or_diagnostic line=assert should_emit_log("ERROR", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:16 pattern=debug context=likely_guard_or_diagnostic line=def test_should_emit_log_debug_mode_allows_debug():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:17 pattern=debug context=likely_guard_or_diagnostic line=assert should_emit_log("DEBUG", debug_mode=True) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:18 pattern=debug context=likely_guard_or_diagnostic line=assert should_emit_log("TRACE", debug_mode=True) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:33 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("[TM][HEARTBEAT] client_id=x", "DEBUG", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:34 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("[BRIDGE_CLIENT_REPORT][RECV] client_id=x", "INFO", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:35 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("[TM_PAGE_LIST][REFRESH] client_id=x", "INFO", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:36 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("[SEND][DECISION] client_id=x", "INFO", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:37 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("[BRIDGE][POLL][REQUEST] client_id=x", "INFO", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:41 pattern=debug context=likely_guard_or_diagnostic line=debug_mode=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:43 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("油猴页面已连接", "INFO", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:44 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("[SEND][FAILED] timeout", "ERROR", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:47 pattern=debug context=likely_guard_or_diagnostic line=def test_should_show_gui_log_debug_mode_still_hides_noisy():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:48 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("[TM][HEARTBEAT] client_id=x", "DEBUG", debug_mode=True) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:49 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log("[ACTION_DECISION] allowed=true", "DEBUG", debug_mode=True) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:54 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "INFO", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:62 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "WARNING", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:120 pattern=trace context=likely_guard_or_diagnostic line=line = "[SYNC][TARGET_RESOLVE] trace_id=t1 client_id=c1 conversation_id=conv1"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:121 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "INFO", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:129 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "WARNING", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:134 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "INFO", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:142 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "INFO", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:149 pattern=debug context=likely_guard_or_diagnostic line=debug_mode=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:154 pattern=debug context=likely_guard_or_diagnostic line=debug_mode=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:159 pattern=debug context=likely_guard_or_diagnostic line=debug_mode=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:164 pattern=debug context=likely_guard_or_diagnostic line=debug_mode=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_logging.py:169 pattern=debug context=likely_guard_or_diagnostic line=debug_mode=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_selected_page_target.py:26 pattern=fallback context=likely_guard_or_diagnostic line=self._allow_send_same_conversation_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_selected_page_target.py:90 pattern=fallback context=likely_guard_or_diagnostic line=def _find_page_by_bound_identity(self, remote, *, status=None, allow_fallback=True):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_gui_selected_page_target.py:91 pattern=fallback context=likely_guard_or_diagnostic line=del allow_fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_job_scheduler_status_migration.py:11 pattern=migration context=likely_guard_or_diagnostic line=def test_send_job_to_cursor_rejects_cancelled_job_after_status_migration():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_job_scheduler_status_migration.py:41 pattern=migration context=likely_guard_or_diagnostic line=def test_get_job_scheduler_snapshot_counts_waiting_chatgpt_reply_after_status_migration():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:1 pattern=legacy context=likely_guard_or_diagnostic line="""legacy_cleanup：仅拒绝旧绑定/发送链路字段。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:5 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:7 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:8 pattern=legacy context=likely_guard_or_diagnostic line=reject_legacy_fields,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:12 pattern=legacy context=likely_guard_or_diagnostic line=def test_reject_legacy_fields_allows_id_status():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:13 pattern=legacy context=likely_guard_or_diagnostic line=err = reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:16 pattern=migrate context=needs_manual_review line=migrate=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:21 pattern=legacy context=likely_guard_or_diagnostic line=def test_reject_legacy_fields_migrate_flag_raises():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:22 pattern=migration context=likely_guard_or_diagnostic line=with pytest.raises(ValueError, match="migration is disabled"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:23 pattern=legacy context=likely_guard_or_diagnostic line=reject_legacy_fields({"target_client_id": "c1"}, context="api", migrate=True)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:26 pattern=legacy context=likely_guard_or_diagnostic line=def test_reject_legacy_fields_returns_400_for_target_client_id():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:27 pattern=legacy context=likely_guard_or_diagnostic line=err = reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:30 pattern=migrate context=needs_manual_review line=migrate=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:35 pattern=legacy context=likely_guard_or_diagnostic line=assert body["error"] == "legacy_fields_not_allowed"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:36 pattern=legacy context=likely_guard_or_diagnostic line=assert "target_client_id" in body["legacy_fields"]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:39 pattern=legacy context=likely_guard_or_diagnostic line=def test_reject_legacy_fields_returns_400_for_raw_user_text():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:40 pattern=legacy context=likely_guard_or_diagnostic line=err = reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:41 pattern=legacy context=likely_guard_or_diagnostic line={"content": "x", "raw_user_text": "legacy"},`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:43 pattern=migrate context=needs_manual_review line=migrate=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:47 pattern=legacy context=likely_guard_or_diagnostic line=assert "raw_user_text" in body["legacy_fields"]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:50 pattern=legacy context=likely_guard_or_diagnostic line=def test_reject_legacy_target_source_values():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:51 pattern=legacy context=likely_guard_or_diagnostic line=err = reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:54 pattern=migrate context=needs_manual_review line=migrate=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:58 pattern=legacy context=likely_guard_or_diagnostic line=assert "target_source=bound" in body["legacy_fields"]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:61 pattern=legacy context=likely_guard_or_diagnostic line=def test_assert_no_legacy_fields_raises_for_target_url():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:62 pattern=legacy context=likely_guard_or_diagnostic line=with pytest.raises(ValueError, match="legacy fields still exist"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:63 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields({"target_url": "https://x"}, owner="save")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:66 pattern=legacy context=likely_guard_or_diagnostic line=def test_assert_no_legacy_fields_passes_canonical():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:67 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_legacy_cleanup.py:78 pattern=legacy context=likely_guard_or_diagnostic line=def test_legacy_field_names_binding_aliases_only():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_file_debug_retention.py:6 pattern=debug context=likely_guard_or_diagnostic line=def test_append_log_writes_debug_to_file_when_ui_min_is_info(tmp_path, monkeypatch):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_file_debug_retention.py:23 pattern=trace context=likely_guard_or_diagnostic line=def test_append_log_skips_trace_in_file(tmp_path, monkeypatch):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_file_debug_retention.py:28 pattern=trace context=likely_guard_or_diagnostic line=line = append_log("trace line", source="TEST", level="TRACE")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_runtime_options.py:12 pattern=verbose context=needs_manual_review line=verbose=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_runtime_options.py:17 pattern=verbose context=needs_manual_review line=assert opts["verbose"] is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_runtime_options.py:21 pattern=verbose context=needs_manual_review line=verbose=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_runtime_options.py:27 pattern=verbose context=needs_manual_review line=def test_verbose_no_longer_bypasses_noisy_file_suppression(tmp_path, monkeypatch):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_runtime_options.py:32 pattern=verbose context=needs_manual_review line=set_log_runtime_options(verbose=True, mirror_to_console=False, include_callsite=False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_runtime_options.py:43 pattern=verbose context=needs_manual_review line=set_log_runtime_options(verbose=False, mirror_to_console=False, include_callsite=False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_log_runtime_options.py:54 pattern=verbose context=needs_manual_review line=set_log_runtime_options(verbose=False, mirror_to_console=False, include_callsite=False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_message_matches_page_p0.py:46 pattern=legacy context=likely_guard_or_diagnostic line=@pytest.mark.skip(reason="legacy poll registration smoke test")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_remote_chatgpt.py:37 pattern=legacy context=likely_guard_or_diagnostic line=def test_legacy_conversation_id_sets_bound_conversation():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_remote_chatgpt.py:40 pattern=legacy context=likely_guard_or_diagnostic line="conversation_id": "conv-legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_remote_chatgpt.py:44 pattern=legacy context=likely_guard_or_diagnostic line=assert remote["conversation_id"] == "conv-legacy"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_remote_chatgpt.py:49 pattern=migrate context=needs_manual_review line=def test_bound_offline_migrates_to_bound_conversation_when_has_conversation():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_remote_chatgpt.py:59 pattern=migrate context=needs_manual_review line=def test_bound_offline_without_conversation_migrates_unbound():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_remote_chatgpt.py:78 pattern=legacy context=likely_guard_or_diagnostic line=def test_strips_enabled_and_duplicate_legacy_ids():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_target_source.py:11 pattern=legacy context=likely_guard_or_diagnostic line=def test_canonical_target_source_rejects_legacy_bound():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_target_source.py:15 pattern=legacy context=likely_guard_or_diagnostic line=def test_canonical_target_source_rejects_legacy_auto_rebind():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_target_source.py:19 pattern=legacy context=likely_guard_or_diagnostic line=def test_canonical_target_source_rejects_legacy_conversation_fallbacks():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_target_source.py:20 pattern=fallback context=likely_guard_or_diagnostic line=assert canonical_target_source("conversation_id_fallback") == ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_target_source.py:21 pattern=fallback context=likely_guard_or_diagnostic line=assert canonical_target_source("conversation_only_fallback") == ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_target_source.py:22 pattern=fallback context=likely_guard_or_diagnostic line=assert canonical_target_source("same_conversation_latest_fallback") == ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_normalize_target_source.py:32 pattern=legacy context=likely_guard_or_diagnostic line=def test_target_source_from_rejects_legacy_bound_client():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:1 pattern=fallback context=likely_guard_or_diagnostic line="""P0 收敛：同会话 fallback 策略、严格控制命令匹配、当前页身份。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:25 pattern=fallback context=likely_guard_or_diagnostic line=def test_same_conversation_fallback_send_default_off():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:27 pattern=fallback context=likely_guard_or_diagnostic line=assert host.is_same_conversation_fallback_enabled("send") is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:30 pattern=fallback context=likely_guard_or_diagnostic line=def test_same_conversation_fallback_sync_default_off():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:32 pattern=fallback context=likely_guard_or_diagnostic line=assert host.is_same_conversation_fallback_enabled("sync") is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:33 pattern=fallback context=likely_guard_or_diagnostic line=assert host.is_same_conversation_fallback_enabled("sync_conversation") is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:36 pattern=fallback context=likely_guard_or_diagnostic line=def test_same_conversation_fallback_always_off():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:38 pattern=fallback context=likely_guard_or_diagnostic line=assert host.is_same_conversation_fallback_enabled("send") is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:39 pattern=fallback context=likely_guard_or_diagnostic line=assert host.is_same_conversation_fallback_enabled("sync") is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:57 pattern=fallback context=likely_guard_or_diagnostic line=def test_targeted_control_sync_fallback_without_page_instance(server_module):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:63 pattern=fallback context=likely_guard_or_diagnostic line="allow_same_conversation_fallback": True,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:88 pattern=fallback context=likely_guard_or_diagnostic line=def test_targeted_control_sync_no_fallback_on_instance_mismatch(server_module):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:105 pattern=legacy context=likely_guard_or_diagnostic line=def test_enqueue_control_command_writes_conversation_id_not_legacy(server_module):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:223 pattern=fallback context=likely_guard_or_diagnostic line="""conversation fallback 不得把 bound_online 置为 True。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:232 pattern=fallback context=likely_guard_or_diagnostic line=fallback = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:243 pattern=fallback context=likely_guard_or_diagnostic line=snapshot_clients=[exact, fallback],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_convergence.py:250 pattern=fallback context=likely_guard_or_diagnostic line=assert summary["binding_match_mode"] == "conversation_fallback"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:12 pattern=fallback context=likely_guard_or_diagnostic line=def __init__(self, *, bind_each=True, allow_fallback=False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:14 pattern=fallback context=likely_guard_or_diagnostic line=self._allow_send_same_conversation_fallback = allow_fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:15 pattern=fallback context=likely_guard_or_diagnostic line=self._allow_sync_same_conversation_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:16 pattern=debug context=likely_guard_or_diagnostic line=self._debug_logging_enabled = lambda: False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:35 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_rejects_legacy_pending_text_fields():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:41 pattern=legacy context=likely_guard_or_diagnostic line=with pytest.raises(ValueError, match="legacy fields"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:45 pattern=fallback context=likely_guard_or_diagnostic line=def test_send_binding_verify_merged_into_page_action_blocks_mismatch_without_fallback():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:46 pattern=fallback context=likely_guard_or_diagnostic line=host = _SendVerifyHost(allow_fallback=False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:79 pattern=legacy context=likely_guard_or_diagnostic line=def test_send_binding_verify_blocks_client_mismatch_even_with_legacy_fallback_flag():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:80 pattern=fallback context=likely_guard_or_diagnostic line=host = _SendVerifyHost(allow_fallback=True)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:113 pattern=fallback context=likely_guard_or_diagnostic line=def test_send_binding_verify_blocks_conversation_id_mismatch_even_with_fallback():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:114 pattern=fallback context=likely_guard_or_diagnostic line=host = _SendVerifyHost(allow_fallback=True)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:154 pattern=fallback context=likely_guard_or_diagnostic line=host = _SendVerifyHost(allow_fallback=True)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_field_flow_fixes.py:275 pattern=fallback context=likely_guard_or_diagnostic line=def is_same_conversation_fallback_enabled(self, action, session=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_p0_realtime_and_sync_retry.py:29 pattern=debug context=likely_guard_or_diagnostic line=def _append_debug_log(self, text, echo=False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_action_plan.py:47 pattern=fallback context=likely_guard_or_diagnostic line=def test_capability_fallback_when_page_missing():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_action_plan.py:66 pattern=legacy context=likely_guard_or_diagnostic line=def test_from_resolve_result_accepts_legacy_page_aliases():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_action_plan.py:78 pattern=legacy context=likely_guard_or_diagnostic line=def test_to_sync_target_snapshot_uses_plan_not_legacy_aliases():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_display_segments.py:25 pattern=debug context=likely_guard_or_diagnostic line=_debug_mode = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_display_segments.py:43 pattern=debug context=likely_guard_or_diagnostic line=def _is_debug_mode_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_list_display_id_sort.py:40 pattern=fallback context=likely_guard_or_diagnostic line=def test_page_display_id_sort_key_uses_page_no_fallback():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_registry.py:113 pattern=legacy context=likely_guard_or_diagnostic line="url": "https://chatgpt.com/c/legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_registry.py:118 pattern=legacy context=likely_guard_or_diagnostic line=self.assertEqual(snap.url, "https://chatgpt.com/c/legacy")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_status.py:21 pattern=migrate context=needs_manual_review line=migrated = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_status.py:27 pattern=migrate context=needs_manual_review line=migrated.pop("page_url", None)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_status.py:28 pattern=migrate context=needs_manual_review line=norm = normalize_page(migrated)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_status.py:35 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_page_strips_legacy_url_after_boundary_migrate(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_status.py:48 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_page_does_not_read_legacy_url_without_migrate(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_status.py:52 pattern=legacy context=likely_guard_or_diagnostic line="page_url": "https://chatgpt.com/c/legacy-only",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_page_url_dedup.py:52 pattern=fallback context=likely_guard_or_diagnostic line=def test_dedupe_empty_url_uses_page_id_fallback():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_patch_chat_send_target.py:79 pattern=legacy context=likely_guard_or_diagnostic line=def test_patch_does_not_fill_from_session_when_only_client_id_legacy():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_poll_response_fields.py:1 pattern=legacy context=likely_guard_or_diagnostic line="""Poll 响应只输出规范 bridge 字段，不含 legacy 别名。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_poll_response_fields.py:47 pattern=trace context=likely_guard_or_diagnostic line=assert "trace_id" not in resp`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_poll_response_fields.py:71 pattern=legacy context=likely_guard_or_diagnostic line=def test_poll_response_rejects_legacy_id_in_queue_message(server_module):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_poll_response_fields.py:73 pattern=legacy context=likely_guard_or_diagnostic line="id": "legacy-id",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_resolve_bound_page_registry.py:11 pattern=fallback context=likely_guard_or_diagnostic line=def test_same_conversation_fallback_when_instance_stale(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_resolve_bound_page_registry.py:102 pattern=fallback context=likely_guard_or_diagnostic line=self.assertTrue(resolved.get("offline_fallback"))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_resolve_bound_page_registry.py:141 pattern=fallback context=likely_guard_or_diagnostic line=self.assertTrue(resolved.get("offline_fallback"))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_runtime_field_slim.py:1 pattern=legacy context=likely_guard_or_diagnostic line="""运行时字段精简：poll 载荷、idle 响应、binding、legacy 拒绝。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_runtime_field_slim.py:6 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields, reject_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_runtime_field_slim.py:111 pattern=debug context=likely_guard_or_diagnostic line=def test_poll_rejects_legacy_debug_tm_fields():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_runtime_field_slim.py:116 pattern=debug context=likely_guard_or_diagnostic line="debug_tm_url_syncable": True,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_runtime_field_slim.py:118 pattern=legacy context=likely_guard_or_diagnostic line=rejected = reject_legacy_fields(payload, context="test", migrate=False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_runtime_field_slim.py:122 pattern=legacy context=likely_guard_or_diagnostic line=def test_normalize_remote_chatgpt_rejects_legacy_bound_fields():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_runtime_field_slim.py:123 pattern=legacy context=likely_guard_or_diagnostic line=with pytest.raises(ValueError, match="legacy fields"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_send_flow_plan.py:31 pattern=trace context=likely_guard_or_diagnostic line=trace_id="t1",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_send_flow_plan.py:66 pattern=trace context=likely_guard_or_diagnostic line=trace_id="t1",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_send_flow_plan.py:92 pattern=legacy context=likely_guard_or_diagnostic line=page={"client_id": "legacy-dict"},`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_send_flow_plan.py:98 pattern=trace context=likely_guard_or_diagnostic line=trace_id="t1",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_send_flow_plan.py:113 pattern=trace context=likely_guard_or_diagnostic line=line = "[SEND][PLAN] trace_id=t1 decision=allowed client_id=c1"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_send_flow_plan.py:114 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "INFO", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_server_bridge_logging.py:5 pattern=DEBUG_ context=likely_guard_or_diagnostic line=from app.constants import DEBUG_FULL_BRIDGE_JSON`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_server_bridge_logging.py:15 pattern=debug context=likely_guard_or_diagnostic line=def test_bridge_json_should_log_poll_only_when_has_message_or_debug(server_module):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_server_bridge_logging.py:16 pattern=DEBUG_ context=likely_guard_or_diagnostic line=assert DEBUG_FULL_BRIDGE_JSON is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_server_bridge_logging.py:35 pattern=debug context=likely_guard_or_diagnostic line=def test_bridge_json_should_log_conversation_snapshot_report_only_in_debug(server_module):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_stale_pending_reply.py:238 pattern=trace context=likely_guard_or_diagnostic line=trace_id="tr1",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_stale_pending_reply.py:273 pattern=trace context=likely_guard_or_diagnostic line=trace_id="t",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_startup_clear_waiting_state.py:32 pattern=settings.value context=needs_manual_review line=self._settings.value.return_value = None`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_control_match.py:6 pattern=fallback context=likely_guard_or_diagnostic line=_sync_conversation_fallback_match,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_control_match.py:48 pattern=fallback context=likely_guard_or_diagnostic line=def test_fallback_same_conversation(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_control_match.py:50 pattern=fallback context=likely_guard_or_diagnostic line=_sync_conversation_fallback_match(self._sync_msg(), self._body())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_control_match.py:53 pattern=fallback context=likely_guard_or_diagnostic line=def test_fallback_disabled_without_policy(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_control_match.py:56 pattern=fallback context=likely_guard_or_diagnostic line=self.assertFalse(_sync_conversation_fallback_match(msg, self._body()))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_control_match.py:58 pattern=fallback context=likely_guard_or_diagnostic line=def test_fallback_rejects_home_body(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_control_match.py:60 pattern=fallback context=likely_guard_or_diagnostic line=_sync_conversation_fallback_match(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_target_status_text.py:59 pattern=legacy context=likely_guard_or_diagnostic line=def test_to_dict_has_no_legacy_aliases(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_target_status_text.py:76 pattern=legacy context=likely_guard_or_diagnostic line=for legacy in ("sendable", "queueable", "syncable", "dialog_ready", "can_request_send"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_sync_target_status_text.py:77 pattern=legacy context=likely_guard_or_diagnostic line=self.assertNotIn(legacy, d)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_temp_home_send_plan.py:80 pattern=trace context=likely_guard_or_diagnostic line=trace_id="t1",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_combo_rich_text.py:10 pattern=debug context=likely_guard_or_diagnostic line=_debug_mode = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_combo_rich_text.py:27 pattern=debug context=likely_guard_or_diagnostic line=def _is_debug_mode_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_combo_rich_text.py:28 pattern=debug context=likely_guard_or_diagnostic line=return bool(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_combo_rich_text.py:66 pattern=verbose context=needs_manual_review line=def test_format_tm_page_option_tooltip_verbose_includes_tech_ids(host):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_combo_rich_text.py:67 pattern=debug context=likely_guard_or_diagnostic line=host._debug_mode = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_list_fingerprint.py:15 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "INFO", debug_mode=False) is False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_list_fingerprint.py:23 pattern=debug context=likely_guard_or_diagnostic line=assert should_show_gui_log(line, "INFO", debug_mode=False) is True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_list_fingerprint.py:28 pattern=debug context=likely_guard_or_diagnostic line=should_show_gui_log("[TM_PAGE_LIST][FETCH] raw_count=14", "INFO", debug_mode=False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_tm_page_snapshot.py:14 pattern=deprecated context=likely_guard_or_diagnostic line=self._deprecated_page_list_key_logged = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_ui_status_compact_display.py:1 pattern=debug context=likely_guard_or_diagnostic line="""主界面精简状态显示与 debug_mode 切换。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_ui_status_compact_display.py:11 pattern=debug context=likely_guard_or_diagnostic line=_debug_mode = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_ui_status_compact_display.py:31 pattern=debug context=likely_guard_or_diagnostic line=def _is_debug_mode_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_ui_status_compact_display.py:32 pattern=debug context=likely_guard_or_diagnostic line=return bool(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_ui_status_compact_display.py:117 pattern=debug context=likely_guard_or_diagnostic line=def test_debug_mode_tooltip_includes_tech_ids(host):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tests/test_ui_status_compact_display.py:126 pattern=debug context=likely_guard_or_diagnostic line=host._debug_mode = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_docs_consistency.py:25 pattern=migrate context=needs_manual_review line="migrate",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_docs_consistency.py:36 pattern=AUTO_ context=needs_manual_review line="DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_docs_consistency.py:39 pattern=legacy context=likely_guard_or_diagnostic line="legacy_cleanup.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_docs_consistency.py:40 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_docs_consistency.py:41 pattern=legacy context=likely_guard_or_diagnostic line="reject_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_docs_consistency.py:49 pattern=AUTO_ context=needs_manual_review line="DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_docs_consistency.py:53 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_docs_consistency.py:54 pattern=legacy context=likely_guard_or_diagnostic line="reject_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:1 pattern=migration context=likely_guard_or_diagnostic line="""Static checks to prevent dead-code / field-migration regressions."""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:6 pattern=legacy context=likely_guard_or_diagnostic line=# 僵尸代码清理时不得删除的 legacy 边界（须存在于源码中）。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:9 pattern=legacy context=likely_guard_or_diagnostic line="path": "app/utils/legacy_cleanup.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:12 pattern=legacy context=likely_guard_or_diagnostic line="def assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:13 pattern=legacy context=likely_guard_or_diagnostic line="def reject_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:15 pattern=legacy context=likely_guard_or_diagnostic line="message": "legacy_cleanup.py 是出站/入站旧字段 fail-fast 保护，不能当 dead code 删除",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:20 pattern=legacy context=likely_guard_or_diagnostic line="from app.utils.legacy_cleanup import",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:21 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:24 pattern=legacy context=likely_guard_or_diagnostic line="message": "bridge_payload 须继续调用 legacy_cleanup 做出站校验",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:28 pattern=legacy context=likely_guard_or_diagnostic line="required": ("assert_no_legacy_fields",),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:29 pattern=legacy context=likely_guard_or_diagnostic line="message": "control_commands 须保留 assert_no_legacy_fields 深检",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:52 pattern=AUTO_ context=needs_manual_review line="forbidden": "DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_regression.py:54 pattern=AUTO_ context=needs_manual_review line="生成产物中不应再出现 DEFAULT_AUTO_CONFIG；"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_toolchain.py:50 pattern=fallback context=likely_guard_or_diagnostic line="tools/search_text_fallback.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_toolchain.py:53 pattern=fallback context=likely_guard_or_diagnostic line=SEARCH_TEXT_FALLBACK_REL = "tools/search_text_fallback.py"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_toolchain.py:116 pattern=fallback context=likely_guard_or_diagnostic line=def check_rg_fallback() -> None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_toolchain.py:121 pattern=fallback context=likely_guard_or_diagnostic line=fallback_path = ROOT / SEARCH_TEXT_FALLBACK_REL`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_toolchain.py:122 pattern=fallback context=likely_guard_or_diagnostic line=if fallback_path.is_file():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_toolchain.py:124 pattern=fallback context=likely_guard_or_diagnostic line="[TOOLCHAIN][WARN] rg missing; fallback available: "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_toolchain.py:129 pattern=fallback context=likely_guard_or_diagnostic line=f"[TOOLCHAIN][WARN] rg missing; fallback script not found: "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_dead_code_toolchain.py:171 pattern=fallback context=likely_guard_or_diagnostic line=check_rg_fallback()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_must_keep_symbols.py:10 pattern=legacy context=likely_guard_or_diagnostic line="path": "app/utils/legacy_cleanup.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_must_keep_symbols.py:13 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_must_keep_symbols.py:14 pattern=legacy context=likely_guard_or_diagnostic line="reject_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/check_must_keep_symbols.py:21 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/create_dead_code_cleanup_baseline.py:18 pattern=legacy context=likely_guard_or_diagnostic line="app/utils/legacy_cleanup.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/create_dead_code_cleanup_baseline.py:26 pattern=legacy context=likely_guard_or_diagnostic line=("app/utils/legacy_cleanup.py", "LEGACY_FIELD_NAMES"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/create_dead_code_cleanup_baseline.py:27 pattern=legacy context=likely_guard_or_diagnostic line=("app/utils/legacy_cleanup.py", "assert_no_legacy_fields"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/create_dead_code_cleanup_baseline.py:28 pattern=legacy context=likely_guard_or_diagnostic line=("app/utils/legacy_cleanup.py", "reject_legacy_fields"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/create_dead_code_cleanup_baseline.py:30 pattern=legacy context=likely_guard_or_diagnostic line=("app/utils/bridge_payload.py", "assert_no_legacy_fields"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/create_dead_code_cleanup_baseline.py:36 pattern=AUTO_ context=needs_manual_review line=("default_auto_config", "DEFAULT_AUTO_CONFIG"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/create_dead_code_cleanup_baseline.py:75 pattern=fallback context=likely_guard_or_diagnostic line=def python_rg_fallback(pattern: str) -> str:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/create_dead_code_cleanup_baseline.py:106 pattern=fallback context=likely_guard_or_diagnostic line=return python_rg_fallback(pattern)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:11 pattern=AUTO_ context=needs_manual_review line=AUTO_BIND_METHODS = frozenset({`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:61 pattern=enable_ context=needs_manual_review line="_session_openable_chatgpt_url",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:62 pattern=enable_ context=needs_manual_review line="_live_openable_chatgpt_url",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:100 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:135 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:185 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:230 pattern=AUTO_ context=needs_manual_review line=if name in AUTO_BIND_METHODS:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:297 pattern=AUTO_ context=needs_manual_review line=all_assigned = AUTO_BIND_METHODS | OPEN_CLOSE_METHODS | SEND_TARGET_METHODS`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/extract_page_bind_submixins.py:314 pattern=AUTO_ context=needs_manual_review line=if name not in AUTO_BIND_METHODS:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_dead_code_candidates.py:25 pattern=AUTO_ context=needs_manual_review line="DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:1 pattern=feature context=needs_manual_review line=# tools/find_feature_flag_dead_code_candidates.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:31 pattern=DEBUG_ context=likely_guard_or_diagnostic line="DEBUG_",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:32 pattern=debug context=likely_guard_or_diagnostic line="debug",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:33 pattern=verbose context=needs_manual_review line="verbose",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:34 pattern=trace context=likely_guard_or_diagnostic line="trace",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:35 pattern=feature context=needs_manual_review line="feature",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:36 pattern=Feature context=needs_manual_review line="Feature",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:37 pattern=experimental context=needs_manual_review line="experimental",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:38 pattern=legacy context=likely_guard_or_diagnostic line="legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:39 pattern=deprecated context=likely_guard_or_diagnostic line="deprecated",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:40 pattern=compat context=likely_guard_or_diagnostic line="compat",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:41 pattern=fallback context=likely_guard_or_diagnostic line="fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:42 pattern=migration context=likely_guard_or_diagnostic line="migration",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:43 pattern=migrate context=needs_manual_review line="migrate",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:44 pattern=legacy context=likely_guard_or_diagnostic line="use_legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:45 pattern=enable_ context=needs_manual_review line="enable_",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:46 pattern=disable_ context=needs_manual_review line="disable_",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:47 pattern=AUTO_ context=needs_manual_review line="AUTO_",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:48 pattern=ENV context=needs_manual_review line="ENV",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:49 pattern=os.environ context=needs_manual_review line="os.environ",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:50 pattern=process.env context=needs_manual_review line="process.env",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:51 pattern=GM_getValue context=needs_manual_review line="GM_getValue",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:52 pattern=GM_setValue context=needs_manual_review line="GM_setValue",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:53 pattern=localStorage context=needs_manual_review line="localStorage",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:54 pattern=settings.value context=needs_manual_review line="settings.value",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:55 pattern=QSettings context=needs_manual_review line="QSettings",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:60 pattern=migration context=likely_guard_or_diagnostic line="migration",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:61 pattern=fallback context=likely_guard_or_diagnostic line="fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:62 pattern=debug context=likely_guard_or_diagnostic line="debug",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:63 pattern=trace context=likely_guard_or_diagnostic line="trace",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:65 pattern=compat context=likely_guard_or_diagnostic line="compat",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:66 pattern=legacy context=likely_guard_or_diagnostic line="legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:67 pattern=deprecated context=likely_guard_or_diagnostic line="deprecated",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_feature_flag_dead_code_candidates.py:131 pattern=legacy context=likely_guard_or_diagnostic line="以上只是候选清单。功能开关、调试开关、fallback、migration、legacy guard "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_stale_tests_candidates.py:23 pattern=AUTO_ context=needs_manual_review line="DEFAULT_AUTO_CONFIG",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_stale_tests_candidates.py:34 pattern=legacy context=likely_guard_or_diagnostic line="legacy",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_stale_tests_candidates.py:36 pattern=migration context=likely_guard_or_diagnostic line="migration",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_stale_tests_candidates.py:37 pattern=deprecated context=likely_guard_or_diagnostic line="deprecated",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_stale_tests_candidates.py:38 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_stale_tests_candidates.py:39 pattern=legacy context=likely_guard_or_diagnostic line="reject_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_stale_tests_candidates.py:68 pattern=migration context=likely_guard_or_diagnostic line=return "safe_guard_or_migration_test"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/find_stale_tests_candidates.py:104 pattern=legacy context=likely_guard_or_diagnostic line="以上只是候选清单。用于验证 legacy guard / migration 的测试不能删除；"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_dead_code_review_summary.py:43 pattern=feature context=needs_manual_review line="name": "feature_flag_dead_code_candidates",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_dead_code_review_summary.py:44 pattern=feature context=needs_manual_review line="cmd": [sys.executable, "tools/find_feature_flag_dead_code_candidates.py"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_dead_code_review_summary.py:79 pattern=migration context=likely_guard_or_diagnostic line="safe_guard_or_migration_context",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_dead_code_review_summary.py:80 pattern=migration context=likely_guard_or_diagnostic line="safe_guard_or_migration_test",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:15 pattern=debug context=likely_guard_or_diagnostic line="set_debug_mode": "runtime_state",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:16 pattern=debug context=likely_guard_or_diagnostic line="is_debug_mode": "runtime_state",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:31 pattern=debug context=likely_guard_or_diagnostic line="_is_bridge_debug_enabled": "runtime_state",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:148 pattern=fallback context=likely_guard_or_diagnostic line="_message_allow_same_conversation_fallback": "external_api",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:199 pattern=debug context=likely_guard_or_diagnostic line="runtime_state": '''"""Server lifecycle, logging, callbacks, debug mode."""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:207 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:226 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _is_bridge_debug_enabled, _log, _log_callback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:233 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:253 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:261 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:268 pattern=migrate context=needs_manual_review line=migrate_outbound_queue_message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:274 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:281 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:312 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:334 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _log, _now, _notify_status, is_debug_mode`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:345 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:352 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _log, is_debug_mode`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:408 pattern=debug context=likely_guard_or_diagnostic line=(r"\b_debug_mode\b", "st._debug_mode"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:578 pattern=compat context=likely_guard_or_diagnostic line=# Backward compatibility: delegate unknown attributes to app.server`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:601 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_server_split.py:602 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/generate_userscript_modules.py:2 pattern=feature context=needs_manual_review line="""Slice repo-root client.user.js into chatgpt-toolbox/tampermonkey-userscript-src/ organized by feature."""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/run_dead_code_cleanup_checks.py:42 pattern=feature context=needs_manual_review line="name": "feature_flag_dead_code_candidates",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/run_dead_code_cleanup_checks.py:43 pattern=feature context=needs_manual_review line="cmd": [sys.executable, "tools/find_feature_flag_dead_code_candidates.py"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/run_dead_code_cleanup_checks.py:90 pattern=migration context=likely_guard_or_diagnostic line="name": "job_scheduler_status_migration_tests",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/run_dead_code_cleanup_checks.py:96 pattern=migration context=likely_guard_or_diagnostic line="tests/test_job_scheduler_status_migration.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/run_dead_code_cleanup_checks.py:100 pattern=legacy context=likely_guard_or_diagnostic line="name": "bridge_payload_legacy_guard_tests",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/run_dead_code_cleanup_checks.py:106 pattern=legacy context=likely_guard_or_diagnostic line="tests/test_bridge_payload_legacy_guard.py",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/scan_runtime_logs_after_dead_code_cleanup.py:33 pattern=legacy context=likely_guard_or_diagnostic line="legacy fields still exist before save",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/search_text_fallback.py:1 pattern=fallback context=likely_guard_or_diagnostic line=# tools/search_text_fallback.py`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/search_text_fallback.py:68 pattern=fallback context=likely_guard_or_diagnostic line=print("usage: python tools/search_text_fallback.py <plain_text_pattern>")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/split_server_refactor.py:39 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/split_server_refactor.py:57 pattern=migrate context=needs_manual_review line=migrate_outbound_queue_message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/split_server_refactor.py:63 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/split_server_refactor.py:83 pattern=debug context=likely_guard_or_diagnostic line=_debug_mode = st._debug_mode`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_extract_external_api_mixin.py:14 pattern=trace context=likely_guard_or_diagnostic line="import traceback\n"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:27 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, make_send_trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:155 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:156 pattern=trace context=likely_guard_or_diagnostic line=payload.get("trace_id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:158 pattern=trace context=likely_guard_or_diagnostic line=self._get_active_send_trace_id()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:159 pattern=trace context=likely_guard_or_diagnostic line=if hasattr(self, "_get_active_send_trace_id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:175 pattern=trace context=likely_guard_or_diagnostic line=+ kv_line(trace_id=trace_id or "-", reason="queue_before_read_failed", error=repr(exc)),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:181 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:204 pattern=trace context=likely_guard_or_diagnostic line=detail = traceback.format_exc()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:208 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:252 pattern=trace context=likely_guard_or_diagnostic line=+ kv_line(trace_id=trace_id or "-", reason="queue_after_read_failed", error=repr(exc)),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:259 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:276 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:613 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:696 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1073 pattern=debug context=likely_guard_or_diagnostic line=def _is_debug_mode_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1075 pattern=debug context=likely_guard_or_diagnostic line=getattr(self, "_debug_mode_enabled", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1076 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "debug_mode_enabled", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1077 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "_debug_mode", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1078 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "debug_mode", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1084 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1238 pattern=debug context=likely_guard_or_diagnostic line=def _debug_status_step(self, text):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1239 pattern=debug context=likely_guard_or_diagnostic line=if not self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1504 pattern=trace context=likely_guard_or_diagnostic line=detail = f"刷新桥接状态失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1553 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] start")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1583 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] service_label")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1643 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] tm_summary")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1648 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] live_page")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1658 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] bound_page")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1660 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1676 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] page_selector")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1682 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] tm_table")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1683 pattern=debug context=likely_guard_or_diagnostic line=elif self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1697 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] status_summary")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1729 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] done")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:1731 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2245 pattern=debug context=likely_guard_or_diagnostic line=if self._show_raw_payload or self._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2307 pattern=enable_ context=needs_manual_review line=if hasattr(self, "enable_lan_access_cb"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2308 pattern=enable_ context=needs_manual_review line=self.enable_lan_access_cb.setEnabled(not running)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2333 pattern=debug context=likely_guard_or_diagnostic line=server.set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2340 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2371 pattern=fallback context=likely_guard_or_diagnostic line=if result.get("fallback_used"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2391 pattern=trace context=likely_guard_or_diagnostic line=detail = f"服务停止失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2571 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2677 pattern=trace context=likely_guard_or_diagnostic line=trace_id = make_send_trace_id(session.session_id if session else "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2678 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id(trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2682 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2694 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2783 pattern=trace context=likely_guard_or_diagnostic line=+ kv_line(trace_id=trace_id, reason=reason, action=render_reason),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2981 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:2988 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id("")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3017 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3022 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (trace_id or self._get_active_send_trace_id() or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3023 pattern=trace context=likely_guard_or_diagnostic line=if trace_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3024 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id(trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3072 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3098 pattern=trace context=likely_guard_or_diagnostic line=self._log_send_bind_check(session, action="before_send", trace_id=trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3120 pattern=fallback context=likely_guard_or_diagnostic line=fallback_url = f"https://chatgpt.com/c/{target_conversation_id}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3124 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3126 pattern=fallback context=likely_guard_or_diagnostic line=fallback_url=fallback_url,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3130 pattern=fallback context=likely_guard_or_diagnostic line=target_page_url = fallback_url`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3134 pattern=trace context=likely_guard_or_diagnostic line=+ kv_line(trace_id=trace_id or "-", reason="no_bound_client"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3138 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3142 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3158 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3171 pattern=trace context=likely_guard_or_diagnostic line=+ kv_line(trace_id=trace_id or "-", reason=block_reason),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3224 pattern=trace context=likely_guard_or_diagnostic line=+ kv_line(trace_id=trace_id or "-", reason=verify_reason),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3232 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3284 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3411 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3875 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:3889 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:4061 pattern=trace context=likely_guard_or_diagnostic line=detail = f"消息入队失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_inbound_original_utf8.py:4139 pattern=trace context=likely_guard_or_diagnostic line=detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_migrate_gui_server_imports.py:27 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_migrate_gui_server_imports.py:42 pattern=migrate context=needs_manual_review line=def migrate_file(path: Path) -> bool:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_migrate_gui_server_imports.py:82 pattern=migrate context=needs_manual_review line=if migrate_file(path):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_migrate_gui_server_imports.py:84 pattern=migrate context=needs_manual_review line=print("migrated:", len(changed))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_migrate_main_window_state.py:92 pattern=migrate context=needs_manual_review line=SKIP = {"main_window_state.py", "_migrate_main_window_state.py"}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_migrate_main_window_state.py:95 pattern=migrate context=needs_manual_review line=def migrate_text(text: str) -> str:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_migrate_main_window_state.py:109 pattern=migrate context=needs_manual_review line=new = migrate_text(raw)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_migrate_main_window_state_getattr.py:145 pattern=migrate context=needs_manual_review line=SKIP = {"_migrate_main_window_state_getattr.py", "_migrate_main_window_state.py"}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_repair_page_selector_mixins.py:233 pattern=AUTO_ context=needs_manual_review line="[PAGE_SELECTOR][AUTO_REFRESH] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_repair_page_selector_mixins.py:296 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_round2_extract_mixins.py:105 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_round2_extract_mixins.py:115 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, page_type_label`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_slim_refactor_batch.py:77 pattern=fallback context=likely_guard_or_diagnostic line=# get_tm_online_summary fallback branch`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_slim_refactor_batch.py:117 pattern=fallback context=likely_guard_or_diagnostic line=# _registry_entry_for_client - remove clients.get fallback at end`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_gui_refactor.py:44 pattern=debug context=likely_guard_or_diagnostic line="_build_tm_debug_action_buttons",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_gui_refactor.py:79 pattern=migrate context=needs_manual_review line="_migrate_loaded_session_messages",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_gui_refactor.py:157 pattern=enable_ context=needs_manual_review line="_session_openable_chatgpt_url",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_gui_refactor.py:158 pattern=enable_ context=needs_manual_review line="_live_openable_chatgpt_url",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_gui_refactor.py:283 pattern=debug context=likely_guard_or_diagnostic line="debug_mode": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_gui_refactor.py:290 pattern=fallback context=likely_guard_or_diagnostic line="allow_fallback_to_any_page": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_gui_refactor.py:371 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_gui_refactor.py:397 pattern=QSettings context=needs_manual_review line=from PyQt5.QtCore import QObject, QSettings, QUrl, Qt, QTimer, pyqtSignal`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_modules.py:71 pattern=debug context=likely_guard_or_diagnostic line=_debug_mode = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_modules.py:74 pattern=os.environ context=needs_manual_review line=API_TOKEN = os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:17 pattern=debug context=likely_guard_or_diagnostic line="set_debug_mode",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:18 pattern=debug context=likely_guard_or_diagnostic line="is_debug_mode",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:32 pattern=debug context=likely_guard_or_diagnostic line="_is_bridge_debug_enabled",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:163 pattern=fallback context=likely_guard_or_diagnostic line="_message_allow_same_conversation_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:233 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:300 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:311 pattern=migrate context=needs_manual_review line=migrate_outbound_queue_message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:317 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:344 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:361 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:373 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:376 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:416 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:423 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:431 pattern=fallback context=likely_guard_or_diagnostic line=from app.server.message_queue import _message_allow_same_conversation_fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:444 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_server_refactor.py:472 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_ui_builder.py:158 pattern=verbose context=needs_manual_review line=def _format_tm_page_option_label_verbose(self, page):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_ui_builder.py:210 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_ui_builder.py:230 pattern=trace context=likely_guard_or_diagnostic line=IMPORTS_CHAT = """import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] tools/_split_ui_builder.py:299 pattern=trace context=likely_guard_or_diagnostic line=IMPORTS_CORE = """import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:7 pattern=feature context=needs_manual_review line=You are an agent that specializes in working with Specs in Claude Code. Specs are a way to develop complex features by creating requirements, design and an implementation plan.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:11 pattern=feature context=needs_manual_review line=When a user wants to create a new feature or use the spec workflow, you need to act as a spec-manager to coordinate the entire process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:19 pattern=Feature context=needs_manual_review line=# Feature Spec Creation Workflow`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:23 pattern=feature context=needs_manual_review line=You are helping guide the user through the process of transforming a rough idea for a feature into a detailed design document with an implementation plan and todo list. It follows the spec driven development methodology `
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:27 pattern=feature context=needs_manual_review line=Before you get started, think of a short feature name based on the user's rough idea. This will be used for the feature directory. Use kebab-case format for the feature_name (e.g. "user-authentication")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:36 pattern=feature context=needs_manual_review line=When the user describes a new feature: (user_input: feature description)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:38 pattern=feature context=needs_manual_review line=1. Based on {user_input}, choose a feature_name (kebab-case format, e.g. "user-authentication")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:44 pattern=feature context=needs_manual_review line=4. Create directory structure: {spec_base_path:.claude/specs}/{feature_name}/`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:48 pattern=feature context=needs_manual_review line=First, generate an initial set of requirements in EARS format based on the feature idea, then iterate with the user to refine them until they are complete and accurate.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:51 pattern=Feature context=needs_manual_review line=### 2. Create Feature Design Document`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:53 pattern=feature context=needs_manual_review line=After the user approves the Requirements, you should develop a comprehensive design document based on the feature requirements, conducting necessary research during the design process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:88 pattern=feature context=needs_manual_review line=- The model SHOULD return to requirements clarification to prioritize features if needed`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:96 pattern=feature context=needs_manual_review line=- Creating a new spec (for a new feature that we don't have a spec for already)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:132 pattern=Feature context=needs_manual_review line=## Feature and sub agent mapping`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:134 pattern=Feature context=needs_manual_review line=| Feature                        | sub agent                           | path                                                         |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:136 pattern=feature context=needs_manual_review line=| Requirement Gathering          | spec-requirements(support parallel) | .claude/specs/{feature_name}/requirements.md                 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:137 pattern=feature context=needs_manual_review line=| Create Feature Design Document | spec-design(support parallel)       | .claude/specs/{feature_name}/design.md                       |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:138 pattern=feature context=needs_manual_review line=| Create Task List               | spec-tasks(support parallel)        | .claude/specs/{feature_name}/tasks.md                        |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:154 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:155 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:170 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:185 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:200 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:201 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:207 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:216 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:247 pattern=feature context=needs_manual_review line=- After confirming the user's initial feature description, you MUST ask: "How many spec-requirements agents to use? (1-128)"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/system-prompts/spec-workflow-starter.md:293 pattern=feature context=needs_manual_review line=- Find and replace operations, including deleting all references to a specific feature, global renaming (such as variable names, function names), removing specific configuration items MUST be handled by main thread`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:98 pattern=trace context=likely_guard_or_diagnostic line=%% This ensures design consistency and traceability`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:103 pattern=feature context=needs_manual_review line=After the user approves the Requirements, you should develop a comprehensive design document based on the feature requirements, conducting necessary research during the design process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:127 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/design.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:128 pattern=feature context=needs_manual_review line=- The model MUST identify areas where research is needed based on the feature requirements`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:131 pattern=feature context=needs_manual_review line=- The model MUST summarize key findings that will inform the feature design`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:133 pattern=feature context=needs_manual_review line=- The model MUST create a detailed design document at '.kiro/specs/{feature_name}/design.md'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:148 pattern=feature context=needs_manual_review line=- The model MUST ensure the design addresses all feature requirements identified during the clarification process`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-design.md:157 pattern=feature context=needs_manual_review line=- The model MUST offer to return to feature requirements clarification if gaps are identified during design`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-impl.md:13 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:14 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:15 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:24 pattern=feature context=needs_manual_review line=feature_name: test-feature`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:25 pattern=feature context=needs_manual_review line=feature_description: Test`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:27 pattern=feature context=needs_manual_review line=documents: .claude/specs/test-feature/requirements_v5.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:28 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v6.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:29 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v7.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:30 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v8.md`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:102 pattern=feature context=needs_manual_review line=- Requirements: Refer to user's original requirement description (feature_name, feature_description)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-judge.md:125 pattern=feature context=needs_manual_review line=- Generate final_document_path with a random 4-digit suffix (e.g., `.claude/specs/test-feature/requirements_v1234.md`)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:16 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:40 pattern=feature context=needs_manual_review line=First, generate an initial set of requirements in EARS format based on the feature idea, then iterate with the user to refine them until they are complete and accurate.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:46 pattern=feature context=needs_manual_review line=1. Analyze the user's feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:72 pattern=feature context=needs_manual_review line=- The directory '.claude/specs/{feature_name}' is already created by the main thread, DO NOT attempt to create this directory`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:73 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/requirements_{output_suffix}.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:76 pattern=feature context=needs_manual_review line=- A clear introduction section that summarizes the feature`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:78 pattern=feature context=needs_manual_review line=- A user story in the format "As a [role], I want [feature], so that [benefit]"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:93 pattern=feature context=needs_manual_review line=**User Story:** As a [role], I want [feature], so that [benefit]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-requirements.md:103 pattern=feature context=needs_manual_review line=**User Story:** As a [role], I want [feature], so that [benefit]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-tasks.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-tasks.md:82 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/tasks.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-tasks.md:85 pattern=feature context=needs_manual_review line=- The model MUST create an implementation plan at '.claude/specs/{feature_name}/tasks.md'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-tasks.md:89 pattern=feature context=needs_manual_review line=Convert the feature design into a series of prompts for a code-generation LLM that will implement each step in a test-driven manner. Prioritize best practices, incremental progress, and early testing, ensuring no big jum`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-tasks.md:104 pattern=feature context=needs_manual_review line=- The model MUST assume that all context documents (feature requirements, design) will be available during implementation`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-tasks.md:119 pattern=feature context=needs_manual_review line=- Tasks should be scoped to specific coding activities (e.g., "Implement X function" rather than "Support X feature")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-tasks.md:137 pattern=feature context=needs_manual_review line=**This workflow is ONLY for creating design and planning artifacts. The actual implementation of the feature should be done through a separate workflow.**`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-tasks.md:139 pattern=feature context=needs_manual_review line=- The model MUST NOT attempt to implement the feature as part of this workflow`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-test.md:7 pattern=feature context=needs_manual_review line=You are a professional test and acceptance expert. Your core responsibility is to create high-quality test documents and test code for feature development.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-test.md:9 pattern=feature context=needs_manual_review line=You are responsible for providing complete, executable initial test code, ensuring correct syntax and clear logic. Users will collaborate with the main thread for cross-validation, and your test code will serve as an imp`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-test.md:17 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] .claude/agents/kfc/spec-test.md:39 pattern=Feature context=needs_manual_review line=| Case ID | Feature Description | Test Type     |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:43 pattern=os.environ context=needs_manual_review line=env_url = (os.environ.get("CHATGPT_PAGE_BRIDGE_URL") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:134 pattern=os.environ context=needs_manual_review line=self.token = (token if token is not None else os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")).strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:485 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:702 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:731 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:747 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:770 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:791 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:816 pattern=os.environ context=needs_manual_review line=default=os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", ""),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:1061 pattern=os.environ context=needs_manual_review line=if os.environ.get("BRIDGE_CLIENT_NO_PAUSE") == "1":`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:1129 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/client/bridge_client.py:1131 pattern=trace context=likely_guard_or_diagnostic line=traceback.print_exc()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:3 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:39 pattern=migrate context=needs_manual_review line=def _migrate_job_status_inplace(job):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:172 pattern=migrate context=needs_manual_review line=_migrate_job_status_inplace(job)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:184 pattern=migrate context=needs_manual_review line=jobs.append(dict(_migrate_job_status_inplace(job)))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:255 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:259 pattern=AUTO_ context=needs_manual_review line=f"[JOB][AUTO_SEND_CURSOR_FAILED] job_id={job_id} error={exc}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:316 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:571 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/core/job_scheduler.py:590 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/cursor_code/automation.py:4 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/cursor_code/automation.py:120 pattern=trace context=likely_guard_or_diagnostic line=f"{type(e).__name__}: {e}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/cursor_code/capture.py:15 pattern=enable_ context=needs_manual_review line=def enable_dpi_awareness() -> None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/cursor_code/upgrade_monitor.py:3 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/cursor_code/upgrade_monitor.py:40 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/cursor_code/upgrade_monitor.py:122 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:9 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import reject_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:25 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _dispatch_to_gui, _log, _now, _notify_status, is_debug_mode`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:72 pattern=legacy context=likely_guard_or_diagnostic line=legacy_err = reject_legacy_fields(body, context="api_bridge")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:73 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_err:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:74 pattern=legacy context=likely_guard_or_diagnostic line=return jsonify(legacy_err[0]), legacy_err[1]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:81 pattern=debug context=likely_guard_or_diagnostic line=elif not _is_local_remote_addr(remote_addr) and is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:111 pattern=debug context=likely_guard_or_diagnostic line=debug_status = bool(body.get("debug_status")) or is_debug_mode()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:117 pattern=debug context=likely_guard_or_diagnostic line=if debug_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_api.py:120 pattern=debug context=likely_guard_or_diagnostic line=if debug_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_logging.py:4 pattern=DEBUG_ context=likely_guard_or_diagnostic line=from app.constants import DEBUG_FULL_BRIDGE_JSON`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_logging.py:5 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _is_bridge_debug_enabled, _log`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_logging.py:24 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if not DEBUG_FULL_BRIDGE_JSON:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_logging.py:35 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_logging.py:38 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_logging.py:46 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_logging.py:49 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/bridge_logging.py:50 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/control_commands.py:21 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/control_commands.py:26 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server._queue_control_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/control_commands.py:134 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server._make_command_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/core_routes.py:5 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/core_routes.py:11 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _log, is_debug_mode`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/core_routes.py:21 pattern=debug context=likely_guard_or_diagnostic line=if not is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/core_routes.py:36 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/core_routes.py:54 pattern=debug context=likely_guard_or_diagnostic line=should_log = is_debug_mode() or status_code >= 400`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/core_routes.py:72 pattern=trace context=likely_guard_or_diagnostic line=f"error_type={type(error).__name__} error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/cursor_api.py:5 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/cursor_api.py:174 pattern=trace context=likely_guard_or_diagnostic line=f"task_id={task_id} error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/external_api.py:4 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/external_api.py:201 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/external_api.py:406 pattern=fallback context=likely_guard_or_diagnostic line=f"type={type(gui_result).__name__} fallback=empty"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/external_api.py:475 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/external_routes.py:5 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/external_routes.py:104 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/external_routes.py:241 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/job_routes.py:74 pattern=fallback context=likely_guard_or_diagnostic line=f"limit={raw_limit!r} fallback=50 "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:4 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:24 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:37 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:169 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (payload.get("trace_id") or "").strip() or None`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:176 pattern=trace context=likely_guard_or_diagnostic line="trace_id": trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:195 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server.push_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:200 pattern=trace context=likely_guard_or_diagnostic line=f"[CHAT_QUEUE][PUT_FAIL] trace_id={trace_id or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:215 pattern=trace context=likely_guard_or_diagnostic line=f"[CHAT_QUEUE][PUT_OK] trace_id={trace_id or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:411 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:622 pattern=fallback context=likely_guard_or_diagnostic line=def _sync_conversation_fallback_match(msg, body):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:942 pattern=fallback context=likely_guard_or_diagnostic line=msg = _rotate(lambda m: _sync_conversation_fallback_match(m, body))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:959 pattern=fallback context=likely_guard_or_diagnostic line=f"command_count=1 fallback=same_conversation"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1125 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(dict(msg), owner="server._poll_response")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1164 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(resp, owner="server._poll_response")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1266 pattern=debug context=likely_guard_or_diagnostic line=if not st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1286 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1300 pattern=trace context=likely_guard_or_diagnostic line=f"trace_id={(msg.get('trace_id') or '-')} text_len={len(text)} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1308 pattern=trace context=likely_guard_or_diagnostic line=f"trace_id={(msg.get('trace_id') or '-')}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1321 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode or bool(body.get("debug_status")):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1332 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1340 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1362 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1384 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1446 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1489 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1499 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:1537 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:2343 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:2397 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/message_queue.py:2550 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/request_utils.py:3 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/request_utils.py:18 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/request_utils.py:40 pattern=trace context=likely_guard_or_diagnostic line=f"body_preview={preview!r}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/request_utils.py:59 pattern=trace context=likely_guard_or_diagnostic line=f"body_preview={preview!r}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/routes.py:4 pattern=enable_ context=needs_manual_review line=from app.server.route_flags import enable_external_api`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/routes.py:18 pattern=enable_ context=needs_manual_review line=if not enable_external_api():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/route_flags.py:7 pattern=enable_ context=needs_manual_review line=def enable_external_api() -> bool:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/route_flags.py:9 pattern=os.environ context=needs_manual_review line=flag = os.environ.get("CHATGPT_BRIDGE_ENABLE_EXTERNAL_API", "").strip().lower()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:1 pattern=debug context=likely_guard_or_diagnostic line="""Server lifecycle, logging, callbacks, debug mode."""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:8 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:29 pattern=debug context=likely_guard_or_diagnostic line=if not is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:33 pattern=debug context=likely_guard_or_diagnostic line=def set_debug_mode(enabled):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:34 pattern=debug context=likely_guard_or_diagnostic line=st._debug_mode = bool(enabled)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:38 pattern=debug context=likely_guard_or_diagnostic line=def is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:40 pattern=debug context=likely_guard_or_diagnostic line=return bool(st._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:84 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:117 pattern=debug context=likely_guard_or_diagnostic line=def _is_bridge_debug_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:118 pattern=debug context=likely_guard_or_diagnostic line=return bool(st._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:122 pattern=debug context=likely_guard_or_diagnostic line=if _is_bridge_debug_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:162 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:188 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:197 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:247 pattern=deprecated context=likely_guard_or_diagnostic line="""@deprecated 仅兼容旧调用；业务判断请用 is_page_online(page)。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:258 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:273 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:368 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:437 pattern=enable_ context=needs_manual_review line=from app.server.route_flags import enable_external_api`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:439 pattern=enable_ context=needs_manual_review line=if enable_external_api():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:444 pattern=fallback context=likely_guard_or_diagnostic line=def start_server(host="127.0.0.1", port=5000, fallback_ports=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:450 pattern=fallback context=likely_guard_or_diagnostic line=extra_ports = list(fallback_ports if fallback_ports is not None else st.FALLBACK_PORTS)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:453 pattern=fallback context=likely_guard_or_diagnostic line=f"host={bind_host} port={port} fallback_ports={extra_ports} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:454 pattern=debug context=likely_guard_or_diagnostic line=f"debug={is_debug_mode()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:490 pattern=fallback context=likely_guard_or_diagnostic line=field="fallback_port",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:506 pattern=debug context=likely_guard_or_diagnostic line=if not is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:548 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback_used={candidate_port != configured_port} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:563 pattern=fallback context=likely_guard_or_diagnostic line="fallback_used": candidate_port != configured_port,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:589 pattern=fallback context=likely_guard_or_diagnostic line="fallback_used": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/runtime_state.py:613 pattern=trace context=likely_guard_or_diagnostic line=f"error_type={type(error).__name__} error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/state.py:34 pattern=debug context=likely_guard_or_diagnostic line=_debug_mode = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/state.py:37 pattern=os.environ context=needs_manual_review line=API_TOKEN = os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/system_hotkey.py:10 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/system_hotkey.py:145 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/system_hotkey.py:172 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/system_hotkey.py:193 pattern=fallback context=likely_guard_or_diagnostic line=gui_result = execute_system_hotkey(hotkey, source=source or "api_fallback")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:5 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:22 pattern=debug context=likely_guard_or_diagnostic line=_is_bridge_debug_enabled,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:29 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:113 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:123 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode or bool(body.get("debug_status")):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:233 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode or _is_bridge_debug_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:389 pattern=fallback context=likely_guard_or_diagnostic line=conversation_fallback_info = None`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:423 pattern=fallback context=likely_guard_or_diagnostic line=context="get_tm_online_summary.conversation_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:427 pattern=fallback context=likely_guard_or_diagnostic line=conversation_fallback_info,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:429 pattern=fallback context=likely_guard_or_diagnostic line=context="get_tm_online_summary.conversation_fallback_old",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:431 pattern=fallback context=likely_guard_or_diagnostic line=if conversation_fallback_info`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:434 pattern=fallback context=likely_guard_or_diagnostic line=if conversation_fallback_info is None or current_seen >= old_seen:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:435 pattern=fallback context=likely_guard_or_diagnostic line=conversation_fallback_info = info`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:464 pattern=fallback context=likely_guard_or_diagnostic line=fallback_online = bool(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:465 pattern=fallback context=likely_guard_or_diagnostic line=isinstance(conversation_fallback_info, dict)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:466 pattern=fallback context=likely_guard_or_diagnostic line=and is_page_online(conversation_fallback_info)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:469 pattern=fallback context=likely_guard_or_diagnostic line=bound_effective_online = exact_bound_online or fallback_online`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:475 pattern=fallback context=likely_guard_or_diagnostic line=same_conversation_online = fallback_online`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:487 pattern=fallback context=likely_guard_or_diagnostic line=elif fallback_online:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:488 pattern=fallback context=likely_guard_or_diagnostic line=bound_page_type = (conversation_fallback_info.get("page_type") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:490 pattern=fallback context=likely_guard_or_diagnostic line=(conversation_fallback_info.get("client_id") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:493 pattern=fallback context=likely_guard_or_diagnostic line=bound_match_mode = "conversation_fallback"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:494 pattern=fallback context=likely_guard_or_diagnostic line=binding_match_mode = "conversation_fallback"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:497 pattern=fallback context=likely_guard_or_diagnostic line=conversation_fallback_info.get("page_instance_id") or ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:574 pattern=debug context=likely_guard_or_diagnostic line=if is_debug_mode():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:575 pattern=debug context=likely_guard_or_diagnostic line=row["debug_detail"] = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:578 pattern=debug context=likely_guard_or_diagnostic line=row["debug_detail"].update({`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:625 pattern=debug context=likely_guard_or_diagnostic line=if not st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:709 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import reject_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:712 pattern=legacy context=likely_guard_or_diagnostic line=legacy_reject = reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:715 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_reject:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:716 pattern=legacy context=likely_guard_or_diagnostic line=body, _status = legacy_reject`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:717 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(body.get("error") or "legacy_fields_not_allowed")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/tm_page_registry.py:889 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/upload_files.py:5 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/upload_files.py:241 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/upload_files.py:261 pattern=legacy context=likely_guard_or_diagnostic line="error": "legacy field file_path is not allowed, use path",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/upload_files.py:291 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/upload_files.py:316 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/__init__.py:15 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/__init__.py:17 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/__init__.py:71 pattern=debug context=likely_guard_or_diagnostic line="is_debug_mode",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/server/__init__.py:73 pattern=debug context=likely_guard_or_diagnostic line="set_debug_mode",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:3 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:10 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:12 pattern=enable_ context=needs_manual_review line=from app.server.route_flags import enable_external_api`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:19 pattern=QSettings context=needs_manual_review line=from PyQt5.QtCore import QSettings, Qt, QTimer`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:64 pattern=enable_ context=needs_manual_review line=if enable_external_api():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:82 pattern=QSettings context=needs_manual_review line=self._settings = QSettings(SETTINGS_ORG, SETTINGS_APP)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:106 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:121 pattern=settings.value context=needs_manual_review line=saved_session_id = self._settings.value("current_session_id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:187 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/main_window.py:194 pattern=trace context=likely_guard_or_diagnostic line=detail = f"关闭窗口时停止服务失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bind_runtime.py:70 pattern=migrate context=needs_manual_review line=def migrate_transient_from_remote(host: Any, session: Any, remote: Dict[str, Any]) -> Dict[str, Any]:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bind_runtime.py:74 pattern=migrate context=needs_manual_review line=migrated = {}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bind_runtime.py:81 pattern=migrate context=needs_manual_review line=migrated[key] = val`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bind_runtime.py:82 pattern=migrate context=needs_manual_review line=if migrated:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bind_runtime.py:83 pattern=migrate context=needs_manual_review line=update_bind_runtime(host, session, **migrated)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bind_runtime.py:95 pattern=migrate context=needs_manual_review line="migrate_transient_from_remote",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_json_file_log.py:6 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_json_file_log.py:32 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:13 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:15 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:16 pattern=legacy context=likely_guard_or_diagnostic line=reject_legacy_fields,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:87 pattern=settings.value context=needs_manual_review line=val = (settings.value("last_url") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:109 pattern=deprecated context=likely_guard_or_diagnostic line=# @deprecated-migration:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:112 pattern=migration context=likely_guard_or_diagnostic line=from app.utils.deprecation_log import log_migration_hit`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:114 pattern=legacy context=likely_guard_or_diagnostic line=for legacy_key in ("last_page_url", "page_url", "conversation_url"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:115 pattern=legacy context=likely_guard_or_diagnostic line=if settings.contains(legacy_key):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:116 pattern=migration context=likely_guard_or_diagnostic line=log_migration_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:118 pattern=legacy context=likely_guard_or_diagnostic line=old=legacy_key,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:120 pattern=legacy context=likely_guard_or_diagnostic line=reason="cleanup_legacy_qsettings_key",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:122 pattern=legacy context=likely_guard_or_diagnostic line=settings.remove(legacy_key)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:130 pattern=legacy context=likely_guard_or_diagnostic line="""只读 payload['url']；旧 URL 字段由 reject_legacy_fields 拒绝。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:156 pattern=legacy context=likely_guard_or_diagnostic line=legacy_reject = reject_legacy_fields(data, context="normalize_inbound_push_payload")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:157 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_reject:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:158 pattern=legacy context=likely_guard_or_diagnostic line=body, _status = legacy_reject`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:159 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(body.get("error") or "legacy_fields_not_allowed")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:185 pattern=trace context=likely_guard_or_diagnostic line="trace_id",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:221 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str = "",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:255 pattern=trace context=likely_guard_or_diagnostic line="trace_id": (trace_id or "").strip(),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:286 pattern=legacy context=likely_guard_or_diagnostic line=legacy_err = reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:287 pattern=migrate context=needs_manual_review line=out, context="validate_outbound_queue_message", migrate=False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:289 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_err:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:290 pattern=legacy context=likely_guard_or_diagnostic line=body, _status = legacy_err`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:291 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(body.get("error") or "legacy_fields_not_allowed")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:292 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(out, owner="validate_outbound_queue_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/bridge_payload.py:332 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(out, owner="normalize_outbound_bridge_message")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/deprecation_log.py:10 pattern=deprecated context=likely_guard_or_diagnostic line=def log_deprecated_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/deprecation_log.py:29 pattern=migration context=likely_guard_or_diagnostic line=def log_migration_hit(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_bridge_json_log.py:4 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_bridge_json_log.py:13 pattern=trace context=likely_guard_or_diagnostic line=trace_id="-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_bridge_json_log.py:24 pattern=trace context=likely_guard_or_diagnostic line=f"trace_id={trace_id or '-'}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_bridge_json_log.py:51 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:110 pattern=DEBUG_ context=likely_guard_or_diagnostic line=DEBUG_ONLY_GUI_TAGS = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:233 pattern=debug context=likely_guard_or_diagnostic line=def should_emit_log(level, *, debug_mode: bool = False, min_level: str = _DEFAULT_MIN_LEVEL) -> bool:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:234 pattern=debug context=likely_guard_or_diagnostic line="""默认仅 INFO 及以上；DEBUG/TRACE 需 debug_mode。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:236 pattern=debug context=likely_guard_or_diagnostic line=if norm in ("DEBUG", "TRACE") and not debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:238 pattern=debug context=likely_guard_or_diagnostic line=effective_min = "TRACE" if debug_mode else min_level`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:436 pattern=debug context=likely_guard_or_diagnostic line=def should_show_gui_log(message: str, level: str = "INFO", *, debug_mode: bool = False) -> bool:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:453 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if not debug_mode and any(tag in text for tag in DEBUG_ONLY_GUI_TAGS):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:456 pattern=debug context=likely_guard_or_diagnostic line=if level_text in ("DEBUG", "TRACE") and not debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/gui_logging.py:459 pattern=debug context=likely_guard_or_diagnostic line=if debug_mode:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/json_log.py:6 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/json_log.py:51 pattern=trace context=likely_guard_or_diagnostic line="traceback": traceback.format_exc(),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:7 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_fields import (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:12 pattern=legacy context=likely_guard_or_diagnostic line=# reject_legacy_fields：API 入站（URL + 绑定别名 + 部分消息旧字段）。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:19 pattern=fallback context=likely_guard_or_diagnostic line="conversation_id_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:20 pattern=fallback context=likely_guard_or_diagnostic line="conversation_only_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:31 pattern=legacy context=likely_guard_or_diagnostic line=def _collect_legacy_fields(obj: Any, *, path: str = "") -> List[str]:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:41 pattern=legacy context=likely_guard_or_diagnostic line=found.extend(_collect_legacy_fields(value, path=sub))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:46 pattern=legacy context=likely_guard_or_diagnostic line=found.extend(_collect_legacy_fields(item, path=sub))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:50 pattern=legacy context=likely_guard_or_diagnostic line=def assert_no_legacy_fields(obj: Any, *, owner: str = "-") -> None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:51 pattern=legacy context=likely_guard_or_diagnostic line=found = _collect_legacy_fields(obj)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:61 pattern=legacy context=likely_guard_or_diagnostic line=f"legacy fields still exist before save: owner={owner}, fields={found}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:65 pattern=legacy context=likely_guard_or_diagnostic line=def reject_legacy_fields(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:69 pattern=migrate context=needs_manual_review line=migrate: bool = False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:74 pattern=migrate context=needs_manual_review line=if migrate:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:76 pattern=legacy context=likely_guard_or_diagnostic line="legacy field migration is disabled; use canonical fields only"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:78 pattern=legacy context=likely_guard_or_diagnostic line=legacy = sorted(set(payload.keys()) & LEGACY_FIELD_NAMES)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:79 pattern=legacy context=likely_guard_or_diagnostic line=if legacy:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:83 pattern=legacy context=likely_guard_or_diagnostic line="error": "legacy_fields_not_allowed",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:85 pattern=legacy context=likely_guard_or_diagnostic line="legacy_fields": legacy,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:94 pattern=legacy context=likely_guard_or_diagnostic line="error": "legacy_fields_not_allowed",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:96 pattern=legacy context=likely_guard_or_diagnostic line="legacy_fields": [f"target_source={target_source}"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:107 pattern=legacy context=likely_guard_or_diagnostic line="assert_no_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_cleanup.py:108 pattern=legacy context=likely_guard_or_diagnostic line="reject_legacy_fields",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_fields.py:1 pattern=legacy context=likely_guard_or_diagnostic line="""Central registry of legacy field names for reject/cleanup only.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_fields.py:5 pattern=fallback context=likely_guard_or_diagnostic line=These fields MUST NOT be read as valid fallback sources except via explicit`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_fields.py:7 pattern=legacy context=likely_guard_or_diagnostic line=migration helpers (e.g. ``_normalize_legacy_message_dict``).`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_fields.py:93 pattern=debug context=likely_guard_or_diagnostic line="debug_tm_url_syncable",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_fields.py:95 pattern=debug context=likely_guard_or_diagnostic line="debug_tm_conversation_syncable",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/legacy_fields.py:167 pattern=fallback context=likely_guard_or_diagnostic line=# 全量旧字段表：禁止作为 fallback 读取。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:9 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:16 pattern=os.environ context=needs_manual_review line=_LOG_VERBOSE = os.environ.get("CHATGPT_BRIDGE_VERBOSE_LOG", "0").strip().lower() in (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:22 pattern=os.environ context=needs_manual_review line=_LOG_MIRROR_TO_CONSOLE = os.environ.get("CHATGPT_BRIDGE_LOG_TO_CONSOLE", "0").strip().lower() in (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:28 pattern=os.environ context=needs_manual_review line=_LOG_INCLUDE_CALLSITE = os.environ.get("CHATGPT_BRIDGE_LOG_CALLSITE", "0").strip().lower() in (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:34 pattern=os.environ context=needs_manual_review line=_LOG_MIN_LEVEL = os.environ.get("CHATGPT_BRIDGE_LOG_MIN_LEVEL", "INFO").strip().upper() or "INFO"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:99 pattern=verbose context=needs_manual_review line=def set_log_runtime_options(verbose=None, mirror_to_console=None, include_callsite=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:101 pattern=verbose context=needs_manual_review line=if verbose is not None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:102 pattern=verbose context=needs_manual_review line=_LOG_VERBOSE = bool(verbose)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:112 pattern=verbose context=needs_manual_review line="verbose": _LOG_VERBOSE,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:149 pattern=trace context=likely_guard_or_diagnostic line=print(f"[LOG_LEVEL][ERROR] {error}\n{traceback.format_exc()}")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:282 pattern=trace context=likely_guard_or_diagnostic line=print(traceback.format_exc())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:292 pattern=ENV context=needs_manual_review line="[APP][ENV]",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:312 pattern=trace context=likely_guard_or_diagnostic line=print(traceback.format_exc())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/log_utils.py:344 pattern=trace context=likely_guard_or_diagnostic line=print(traceback.format_exc())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:14 pattern=fallback context=likely_guard_or_diagnostic line=find_online_fallback_page_for_binding,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:275 pattern=fallback context=likely_guard_or_diagnostic line=fallback, _matched_by = find_online_fallback_page_for_binding(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:281 pattern=fallback context=likely_guard_or_diagnostic line=if fallback is None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:284 pattern=fallback context=likely_guard_or_diagnostic line=poll_ok, _, _ = evaluate_sync_poll_freshness(fallback, now=now)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:287 pattern=fallback context=likely_guard_or_diagnostic line=return fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:502 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:516 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:522 pattern=fallback context=likely_guard_or_diagnostic line=offline_fallback_attempted = bool(bound_conv)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:523 pattern=fallback context=likely_guard_or_diagnostic line=if offline_fallback_attempted:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:535 pattern=fallback context=likely_guard_or_diagnostic line=fallback, fb_matched_by = find_online_fallback_page_for_binding(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:541 pattern=fallback context=likely_guard_or_diagnostic line=if fallback is not None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:542 pattern=fallback context=likely_guard_or_diagnostic line=fb_raw = fallback._raw if isinstance(fallback._raw, dict) else {}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:546 pattern=fallback context=likely_guard_or_diagnostic line=context="page_command.resolve.offline_fallback_poll",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:549 pattern=fallback context=likely_guard_or_diagnostic line=(fallback.client_id or "").strip() != bound_client`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:550 pattern=fallback context=likely_guard_or_diagnostic line=or (fallback.page_instance_id or "").strip() != bound_instance`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:560 pattern=fallback context=likely_guard_or_diagnostic line=(fallback.client_id or "-"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:561 pattern=fallback context=likely_guard_or_diagnostic line=(fallback.page_instance_id or "-"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:562 pattern=fallback context=likely_guard_or_diagnostic line=str(fb_raw.get("page_no") or fallback.page_display_id or "-"),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:567 pattern=fallback context=likely_guard_or_diagnostic line="page": fallback,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:573 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": True,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:592 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:595 pattern=fallback context=likely_guard_or_diagnostic line=fallback = _pick_fresh_conversation_page(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:598 pattern=fallback context=likely_guard_or_diagnostic line=if fallback is None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:606 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:609 pattern=fallback context=likely_guard_or_diagnostic line=raw = fallback._raw if isinstance(fallback._raw, dict) else {}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:613 pattern=fallback context=likely_guard_or_diagnostic line=context="page_command.resolve.fallback_poll",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:616 pattern=fallback context=likely_guard_or_diagnostic line=fallback.client_id != bound_client`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:617 pattern=fallback context=likely_guard_or_diagnostic line=or fallback.page_instance_id != bound_instance`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:620 pattern=fallback context=likely_guard_or_diagnostic line="page": fallback,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:626 pattern=fallback context=likely_guard_or_diagnostic line="offline_fallback": True,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:693 pattern=fallback context=likely_guard_or_diagnostic line=need_fallback = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:695 pattern=fallback context=likely_guard_or_diagnostic line=need_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:699 pattern=fallback context=likely_guard_or_diagnostic line=need_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_command.py:700 pattern=fallback context=likely_guard_or_diagnostic line=if need_fallback and allow_same_conversation:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_status.py:67 pattern=fallback context=likely_guard_or_diagnostic line="find_online_fallback_page_for_binding",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_status.py:150 pattern=migrate context=needs_manual_review line="""规范化页面对象；只读规范字段（旧字段须在入站/加载边界先 migrate）。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/page_status.py:402 pattern=fallback context=likely_guard_or_diagnostic line=def find_online_fallback_page_for_binding(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/send_plan.py:16 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/send_plan.py:53 pattern=trace context=likely_guard_or_diagnostic line=def trace_id(self) -> str:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/send_plan.py:54 pattern=trace context=likely_guard_or_diagnostic line=return self.turn.trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/time_utils.py:9 pattern=debug context=likely_guard_or_diagnostic line=debug_log: bool = False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/time_utils.py:18 pattern=debug context=likely_guard_or_diagnostic line=if debug_log or log_on_error:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/trace_log.py:1 pattern=trace context=likely_guard_or_diagnostic line="""发送 / 绑定 / 同步链路的 trace_id 与 key=value 日志辅助。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/trace_log.py:8 pattern=trace context=likely_guard_or_diagnostic line=def make_send_trace_id(session_id=""):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/utils/trace_log.py:13 pattern=trace context=likely_guard_or_diagnostic line=def make_sync_trace_id(session_id=""):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:7 pattern=feature context=needs_manual_review line=You are an agent that specializes in working with Specs in Claude Code. Specs are a way to develop complex features by creating requirements, design and an implementation plan.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:11 pattern=feature context=needs_manual_review line=When a user wants to create a new feature or use the spec workflow, you need to act as a spec-manager to coordinate the entire process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:19 pattern=Feature context=needs_manual_review line=# Feature Spec Creation Workflow`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:23 pattern=feature context=needs_manual_review line=You are helping guide the user through the process of transforming a rough idea for a feature into a detailed design document with an implementation plan and todo list. It follows the spec driven development methodology `
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:27 pattern=feature context=needs_manual_review line=Before you get started, think of a short feature name based on the user's rough idea. This will be used for the feature directory. Use kebab-case format for the feature_name (e.g. "user-authentication")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:36 pattern=feature context=needs_manual_review line=When the user describes a new feature: (user_input: feature description)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:38 pattern=feature context=needs_manual_review line=1. Based on {user_input}, choose a feature_name (kebab-case format, e.g. "user-authentication")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:44 pattern=feature context=needs_manual_review line=4. Create directory structure: {spec_base_path:.claude/specs}/{feature_name}/`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:48 pattern=feature context=needs_manual_review line=First, generate an initial set of requirements in EARS format based on the feature idea, then iterate with the user to refine them until they are complete and accurate.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:51 pattern=Feature context=needs_manual_review line=### 2. Create Feature Design Document`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:53 pattern=feature context=needs_manual_review line=After the user approves the Requirements, you should develop a comprehensive design document based on the feature requirements, conducting necessary research during the design process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:88 pattern=feature context=needs_manual_review line=- The model SHOULD return to requirements clarification to prioritize features if needed`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:96 pattern=feature context=needs_manual_review line=- Creating a new spec (for a new feature that we don't have a spec for already)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:132 pattern=Feature context=needs_manual_review line=## Feature and sub agent mapping`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:134 pattern=Feature context=needs_manual_review line=| Feature                        | sub agent                           | path                                                         |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:136 pattern=feature context=needs_manual_review line=| Requirement Gathering          | spec-requirements(support parallel) | .claude/specs/{feature_name}/requirements.md                 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:137 pattern=feature context=needs_manual_review line=| Create Feature Design Document | spec-design(support parallel)       | .claude/specs/{feature_name}/design.md                       |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:138 pattern=feature context=needs_manual_review line=| Create Task List               | spec-tasks(support parallel)        | .claude/specs/{feature_name}/tasks.md                        |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:154 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:155 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:170 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:185 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:200 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:201 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:207 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:216 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:247 pattern=feature context=needs_manual_review line=- After confirming the user's initial feature description, you MUST ask: "How many spec-requirements agents to use? (1-128)"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/system-prompts/spec-workflow-starter.md:293 pattern=feature context=needs_manual_review line=- Find and replace operations, including deleting all references to a specific feature, global renaming (such as variable names, function names), removing specific configuration items MUST be handled by main thread`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:98 pattern=trace context=likely_guard_or_diagnostic line=%% This ensures design consistency and traceability`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:103 pattern=feature context=needs_manual_review line=After the user approves the Requirements, you should develop a comprehensive design document based on the feature requirements, conducting necessary research during the design process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:127 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/design.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:128 pattern=feature context=needs_manual_review line=- The model MUST identify areas where research is needed based on the feature requirements`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:131 pattern=feature context=needs_manual_review line=- The model MUST summarize key findings that will inform the feature design`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:133 pattern=feature context=needs_manual_review line=- The model MUST create a detailed design document at '.kiro/specs/{feature_name}/design.md'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:148 pattern=feature context=needs_manual_review line=- The model MUST ensure the design addresses all feature requirements identified during the clarification process`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-design.md:157 pattern=feature context=needs_manual_review line=- The model MUST offer to return to feature requirements clarification if gaps are identified during design`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-impl.md:13 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:14 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:15 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:24 pattern=feature context=needs_manual_review line=feature_name: test-feature`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:25 pattern=feature context=needs_manual_review line=feature_description: Test`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:27 pattern=feature context=needs_manual_review line=documents: .claude/specs/test-feature/requirements_v5.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:28 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v6.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:29 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v7.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:30 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v8.md`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:102 pattern=feature context=needs_manual_review line=- Requirements: Refer to user's original requirement description (feature_name, feature_description)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-judge.md:125 pattern=feature context=needs_manual_review line=- Generate final_document_path with a random 4-digit suffix (e.g., `.claude/specs/test-feature/requirements_v1234.md`)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:16 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:40 pattern=feature context=needs_manual_review line=First, generate an initial set of requirements in EARS format based on the feature idea, then iterate with the user to refine them until they are complete and accurate.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:46 pattern=feature context=needs_manual_review line=1. Analyze the user's feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:72 pattern=feature context=needs_manual_review line=- The directory '.claude/specs/{feature_name}' is already created by the main thread, DO NOT attempt to create this directory`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:73 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/requirements_{output_suffix}.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:76 pattern=feature context=needs_manual_review line=- A clear introduction section that summarizes the feature`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:78 pattern=feature context=needs_manual_review line=- A user story in the format "As a [role], I want [feature], so that [benefit]"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:93 pattern=feature context=needs_manual_review line=**User Story:** As a [role], I want [feature], so that [benefit]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-requirements.md:103 pattern=feature context=needs_manual_review line=**User Story:** As a [role], I want [feature], so that [benefit]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-tasks.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-tasks.md:82 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/tasks.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-tasks.md:85 pattern=feature context=needs_manual_review line=- The model MUST create an implementation plan at '.claude/specs/{feature_name}/tasks.md'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-tasks.md:89 pattern=feature context=needs_manual_review line=Convert the feature design into a series of prompts for a code-generation LLM that will implement each step in a test-driven manner. Prioritize best practices, incremental progress, and early testing, ensuring no big jum`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-tasks.md:104 pattern=feature context=needs_manual_review line=- The model MUST assume that all context documents (feature requirements, design) will be available during implementation`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-tasks.md:119 pattern=feature context=needs_manual_review line=- Tasks should be scoped to specific coding activities (e.g., "Implement X function" rather than "Support X feature")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-tasks.md:137 pattern=feature context=needs_manual_review line=**This workflow is ONLY for creating design and planning artifacts. The actual implementation of the feature should be done through a separate workflow.**`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-tasks.md:139 pattern=feature context=needs_manual_review line=- The model MUST NOT attempt to implement the feature as part of this workflow`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-test.md:7 pattern=feature context=needs_manual_review line=You are a professional test and acceptance expert. Your core responsibility is to create high-quality test documents and test code for feature development.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-test.md:9 pattern=feature context=needs_manual_review line=You are responsible for providing complete, executable initial test code, ensuring correct syntax and clear logic. Users will collaborate with the main thread for cross-validation, and your test code will serve as an imp`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-test.md:17 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/.claude/agents/kfc/spec-test.md:39 pattern=Feature context=needs_manual_review line=| Case ID | Feature Description | Test Type     |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:9 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:19 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:48 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, make_send_trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:251 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:267 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:276 pattern=trace context=likely_guard_or_diagnostic line=+ f"\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:313 pattern=ENV context=needs_manual_review line=_PENDING_ENVELOPE_KEYS = frozenset(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:330 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import LEGACY_FIELD_NAMES`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:333 pattern=legacy context=likely_guard_or_diagnostic line=envelope_legacy = sorted(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:336 pattern=ENV context=likely_guard_or_diagnostic line=if k in LEGACY_FIELD_NAMES and k not in self._PENDING_ENVELOPE_KEYS`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:338 pattern=legacy context=likely_guard_or_diagnostic line=if envelope_legacy:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:339 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(f"legacy fields in pending: {envelope_legacy}")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:341 pattern=legacy context=likely_guard_or_diagnostic line=payload_legacy = sorted(set(payload.keys()) & LEGACY_FIELD_NAMES)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:342 pattern=legacy context=likely_guard_or_diagnostic line=if payload_legacy:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:343 pattern=legacy context=likely_guard_or_diagnostic line=raise ValueError(f"legacy fields in pending payload: {payload_legacy}")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:361 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:362 pattern=trace context=likely_guard_or_diagnostic line=payload.get("trace_id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:364 pattern=trace context=likely_guard_or_diagnostic line=self._get_active_send_trace_id()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:365 pattern=trace context=likely_guard_or_diagnostic line=if hasattr(self, "_get_active_send_trace_id")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:382 pattern=trace context=likely_guard_or_diagnostic line="trace_id": trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:477 pattern=trace context=likely_guard_or_diagnostic line=def _log_chat_queue_event(self, tag, *, trace_id="-", **fields):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:479 pattern=trace context=likely_guard_or_diagnostic line=tag + " " + kv_line(trace_id=trace_id or "-", **fields),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:504 pattern=trace context=likely_guard_or_diagnostic line=trace_id = ctx["trace_id"]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:509 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:519 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:540 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:554 pattern=trace context=likely_guard_or_diagnostic line=detail = traceback.format_exc()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:558 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:577 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:589 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:605 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:935 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1018 pattern=debug context=likely_guard_or_diagnostic line=def _is_debug_mode_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1020 pattern=debug context=likely_guard_or_diagnostic line=getattr(self, "_debug_mode_enabled", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1021 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "debug_mode_enabled", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1022 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "_debug_mode", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1023 pattern=debug context=likely_guard_or_diagnostic line=or getattr(self, "debug_mode", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1032 pattern=debug context=likely_guard_or_diagnostic line=debug_mode=self._is_debug_mode_enabled(),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1058 pattern=debug context=likely_guard_or_diagnostic line=def _debug_status_step(self, text):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1059 pattern=debug context=likely_guard_or_diagnostic line=if not self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1151 pattern=trace context=likely_guard_or_diagnostic line=detail = f"刷新桥接状态失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1293 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] start")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1323 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] service_label")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1345 pattern=verbose context=needs_manual_review line=if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1354 pattern=verbose context=needs_manual_review line=verbose_tm_tip = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1355 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1356 pattern=verbose context=needs_manual_review line=and self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1358 pattern=verbose context=needs_manual_review line=if verbose_tm_tip:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1395 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] tm_summary")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1404 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] page_registry_deferred")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1411 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1429 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] page_registry_scheduled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1432 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] status_summary")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1459 pattern=debug context=likely_guard_or_diagnostic line=self._debug_status_step("[STATUS_APPLY][STEP] done")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:1461 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2317 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2361 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2368 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2402 pattern=fallback context=likely_guard_or_diagnostic line=if result.get("fallback_used"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2421 pattern=trace context=likely_guard_or_diagnostic line=detail = f"服务停止失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2653 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2753 pattern=trace context=likely_guard_or_diagnostic line=trace_id = make_send_trace_id(session.session_id if session else "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2754 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id(trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2758 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2770 pattern=trace context=likely_guard_or_diagnostic line=content, session=session, trace_id=trace_id, button=button`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2824 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id("")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2851 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2875 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2947 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/bridge_mixin.py:2948 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/chat_render_mixin.py:4 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/chat_render_mixin.py:161 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/chat_session_mixin.py:25 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/chat_session_mixin.py:129 pattern=legacy context=likely_guard_or_diagnostic line=if hasattr(self, "_normalize_legacy_message_dict"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/chat_session_mixin.py:131 pattern=legacy context=likely_guard_or_diagnostic line=item = self._normalize_legacy_message_dict(item)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/chat_session_mixin.py:173 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote, owner="GUI save session.remote_chatgpt")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/conversation_stats_mixin.py:273 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/conversation_stats_mixin.py:281 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/conversation_stats_mixin.py:283 pattern=fallback context=likely_guard_or_diagnostic line=fallback = self._format_conversation_stats_text(self._EMPTY_CONVERSATION_STATS)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/conversation_stats_mixin.py:284 pattern=fallback context=likely_guard_or_diagnostic line=label.setText(fallback)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/conversation_stats_mixin.py:285 pattern=fallback context=likely_guard_or_diagnostic line=label.setToolTip(fallback)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/conversation_stats_mixin.py:291 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc} traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/conversation_stats_mixin.py:298 pattern=trace context=likely_guard_or_diagnostic line=traceback.format_exc(),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:10 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:318 pattern=trace context=likely_guard_or_diagnostic line=detail_body = f"{read_error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:324 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:340 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:354 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:374 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\nraw={raw}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:448 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:499 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:500 pattern=verbose context=needs_manual_review line=and not self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:521 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:522 pattern=verbose context=needs_manual_review line=and not self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:563 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_bridge_mixin.py:564 pattern=verbose context=needs_manual_review line=and not self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_code_mixin.py:2 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/cursor_code_mixin.py:89 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/external_api_gui_mixin.py:5 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/external_api_gui_mixin.py:55 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/external_api_gui_mixin.py:414 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/external_api_gui_mixin.py:416 pattern=fallback context=likely_guard_or_diagnostic line=allow_same_conversation_fallback=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/external_api_gui_mixin.py:428 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/external_api_gui_mixin.py:429 pattern=fallback context=likely_guard_or_diagnostic line=allow_same_conversation_fallback=allow_same_conversation_fallback,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/external_api_gui_mixin.py:600 pattern=trace context=likely_guard_or_diagnostic line=detail = f"消息入队失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:62 pattern=legacy context=likely_guard_or_diagnostic line=legacy = remote.get(key, default)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:63 pattern=legacy context=likely_guard_or_diagnostic line=if legacy not in (None, "", 0, 0.0, False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:64 pattern=legacy context=likely_guard_or_diagnostic line=return legacy`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:650 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][SKIP_IDLE_HOME] client_id={client_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:676 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][IDLE_HOME_CANDIDATES] session_id={session_id or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:691 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][SELECT_IDLE_HOME] session_id={session_id or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:750 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][REPLACE] old={self._auto_bind.pending_session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:795 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][OPEN_HOME_ON_SEND] session_id={session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:801 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][WAITING_HOME] session_id={session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:807 pattern=AUTO_ context=needs_manual_review line=_AUTO_BIND_HOME_WAIT_SEC = 8.0`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:808 pattern=AUTO_ context=needs_manual_review line=_AUTO_BIND_HOME_POLL_SEC = 0.3`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:842 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][STATUS_FETCH_FAILED] error={exc!r}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:870 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][STATUS_FETCH_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:928 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][SUCCESS] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:942 pattern=AUTO_ context=needs_manual_review line=deadline = time.time() + self._AUTO_BIND_HOME_WAIT_SEC`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:951 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][POLL_STATUS_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:969 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][PROCESS_EVENTS_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:973 pattern=AUTO_ context=needs_manual_review line=time.sleep(self._AUTO_BIND_HOME_POLL_SEC)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:975 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][TIMEOUT] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:978 pattern=AUTO_ context=needs_manual_review line=f"wait_sec={int(self._AUTO_BIND_HOME_WAIT_SEC)}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:986 pattern=AUTO_ context=needs_manual_review line=deadline = time.time() + self._AUTO_BIND_HOME_WAIT_SEC`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:995 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][POLL_STATUS_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1011 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][FOUND] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1028 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][PROCESS_EVENTS_FAILED] error={exc!r}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1032 pattern=AUTO_ context=needs_manual_review line=time.sleep(self._AUTO_BIND_HOME_POLL_SEC)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1034 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][TIMEOUT] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1036 pattern=AUTO_ context=needs_manual_review line=f"wait_sec={int(self._AUTO_BIND_HOME_WAIT_SEC)}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1136 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][SKIP_DUPLICATE] reason=in_progress "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1149 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][START] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1167 pattern=AUTO_ context=needs_manual_review line="[AUTO_BIND_HOME][OPEN_FAILED] reason=no_open_handler",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1174 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][OPEN_REQUESTED] opened={'true' if opened else 'false'}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1181 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1184 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND_HOME][ERROR] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1185 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc!r}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1291 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][RELEASE_STALE_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1347 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][USE_IDLE_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1351 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][RESERVE_IDLE_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1376 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][FIRST_SEND_BLOCKED] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1790 pattern=fallback context=likely_guard_or_diagnostic line=f"reason=missing_page_instance_id fallback=page_no_only",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:2403 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][MANUAL_HINT] session={current_session_id[:8]} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:2506 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][RECOVER_WAITING_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:2548 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][REPAIR_TOKEN_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:2579 pattern=AUTO_ context=needs_manual_review line=self._append_log(f"[AUTO_BIND][TIMEOUT] session_id={session_id}")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:2619 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][SKIP_HOME_TOKEN_MISMATCH] session_id={session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:2678 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][WAITING_HOME_MATCH] session_id={session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:2882 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][UPDATE_URL] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:4 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:14 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, page_type_label`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:21 pattern=trace context=likely_guard_or_diagnostic line=def _log_send_bind_check(self, session, action="send", *, trace_id=""):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:22 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (trace_id or self._get_active_send_trace_id() or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:109 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:141 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:157 pattern=AUTO_ context=needs_manual_review line="[BIND][AUTO_REBIND] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:531 pattern=fallback context=likely_guard_or_diagnostic line="unbound_fallback_current_page": "未绑定，回退到当前页",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:197 pattern=fallback context=likely_guard_or_diagnostic line=if bound_match_mode == "conversation_fallback":`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:454 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:681 pattern=verbose context=needs_manual_review line=if self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:684 pattern=verbose context=needs_manual_review line=verbose_state = "在线"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:685 pattern=verbose context=needs_manual_review line=verbose_chip = "ok"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:687 pattern=verbose context=needs_manual_review line=verbose_state = "离线"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:688 pattern=verbose context=needs_manual_review line=verbose_chip = "warn"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:690 pattern=verbose context=needs_manual_review line=verbose_state = "未绑定"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:691 pattern=verbose context=needs_manual_review line=verbose_chip = "warn"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:693 pattern=verbose context=needs_manual_review line=verbose_state = "未绑定"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:694 pattern=verbose context=needs_manual_review line=verbose_chip = "warn"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:696 pattern=verbose context=needs_manual_review line=STATUS_CHIP_SESSION_BIND_PREFIX, verbose_state`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_display_mixin.py:698 pattern=verbose context=needs_manual_review line=chip_state = verbose_chip`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:6 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:164 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:217 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:250 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:260 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:311 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:332 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback={last_seen_val} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:404 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:113 pattern=trace context=likely_guard_or_diagnostic line=def _get_active_trace_id(self, attr_name, log_prefix):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:124 pattern=trace context=likely_guard_or_diagnostic line=def _set_active_trace_id(self, attr_name, trace_id, log_prefix):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:125 pattern=trace context=likely_guard_or_diagnostic line=if trace_id is None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:128 pattern=trace context=likely_guard_or_diagnostic line=if callable(trace_id):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:130 pattern=trace context=likely_guard_or_diagnostic line=f"[{log_prefix}][TRACE_ID_INVALID] trying to set callable trace_id, ignored"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:134 pattern=trace context=likely_guard_or_diagnostic line=setattr(self, attr_name, str(trace_id).strip())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:136 pattern=trace context=likely_guard_or_diagnostic line=def _get_active_send_trace_id(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:137 pattern=trace context=likely_guard_or_diagnostic line=return self._get_active_trace_id("_active_send_trace_id_value", "SEND")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:139 pattern=trace context=likely_guard_or_diagnostic line=def _set_active_send_trace_id(self, trace_id):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:140 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_trace_id("_active_send_trace_id_value", trace_id, "SEND")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:142 pattern=trace context=likely_guard_or_diagnostic line=def _get_active_sync_trace_id(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:143 pattern=trace context=likely_guard_or_diagnostic line=return self._get_active_trace_id("_active_sync_trace_id_value", "SYNC")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:145 pattern=trace context=likely_guard_or_diagnostic line=def _set_active_sync_trace_id(self, trace_id):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:146 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_trace_id("_active_sync_trace_id_value", trace_id, "SYNC")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:272 pattern=fallback context=likely_guard_or_diagnostic line=fallback_info = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:304 pattern=fallback context=likely_guard_or_diagnostic line=**fallback_info,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:307 pattern=fallback context=likely_guard_or_diagnostic line="conversation_id": page.conversation_id or fallback_info["conversation_id"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:308 pattern=fallback context=likely_guard_or_diagnostic line="url": page.url or fallback_info["url"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:309 pattern=fallback context=likely_guard_or_diagnostic line="page_type": page.page_type or fallback_info["page_type"],`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:327 pattern=fallback context=likely_guard_or_diagnostic line=return fallback_info, "offline", reason_code or "bound_info_missing"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:514 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][BOOTSTRAP_RETRY] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:639 pattern=trace context=likely_guard_or_diagnostic line="traceback=-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:912 pattern=debug context=likely_guard_or_diagnostic line=self, "_debug_logging_enabled"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:913 pattern=debug context=likely_guard_or_diagnostic line=) and self._debug_logging_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:961 pattern=trace context=likely_guard_or_diagnostic line=trace_id="",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:962 pattern=fallback context=likely_guard_or_diagnostic line=allow_same_conversation_fallback=False,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:996 pattern=fallback context=likely_guard_or_diagnostic line=del allow_same_conversation_fallback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_bind_mixin.py:1001 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:12 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:114 pattern=trace context=likely_guard_or_diagnostic line=detail = f"打开页面失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:128 pattern=enable_ context=needs_manual_review line=def _session_openable_chatgpt_url(self, session):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:132 pattern=enable_ context=needs_manual_review line=def _live_openable_chatgpt_url(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:236 pattern=fallback context=likely_guard_or_diagnostic line=def _open_bound_page_for_session(self, session, label="", fallback_live=False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:257 pattern=enable_ context=needs_manual_review line=url = self._session_openable_chatgpt_url(session)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:258 pattern=fallback context=likely_guard_or_diagnostic line=if not url and fallback_live:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:259 pattern=enable_ context=needs_manual_review line=url = self._live_openable_chatgpt_url()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:303 pattern=trace context=likely_guard_or_diagnostic line=detail = f"open_url 入队失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:497 pattern=trace context=likely_guard_or_diagnostic line=detail = f"close_self 入队失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:559 pattern=trace context=likely_guard_or_diagnostic line=detail = f"批量关闭页面失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:711 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_open_close_mixin.py:809 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:6 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:195 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:292 pattern=verbose context=needs_manual_review line=if hasattr(self, "_is_ui_verbose_status_enabled") and self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:737 pattern=fallback context=likely_guard_or_diagnostic line=self._safe_log_fallback(log_exc, message)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:739 pattern=fallback context=likely_guard_or_diagnostic line=self._safe_log_fallback(log_exc, message)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:742 pattern=fallback context=likely_guard_or_diagnostic line=def _safe_log_fallback(self, log_exc, message):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:745 pattern=trace context=likely_guard_or_diagnostic line=f"error={log_exc} traceback={traceback.format_exc()} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_selector_mixin.py:88 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_selector_mixin.py:89 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_selector_mixin.py:177 pattern=verbose context=needs_manual_review line=if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:100 pattern=fallback context=likely_guard_or_diagnostic line=from app.utils.page_status import PageRegistry, find_online_fallback_page_for_binding`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:106 pattern=fallback context=likely_guard_or_diagnostic line=fallback, _matched_by = find_online_fallback_page_for_binding(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:111 pattern=fallback context=likely_guard_or_diagnostic line=if fallback is not None:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:112 pattern=fallback context=likely_guard_or_diagnostic line=raw = fallback._raw if isinstance(fallback._raw, dict) else {}`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:212 pattern=AUTO_ context=needs_manual_review line=AUTO_RELINK_FRESH_PAGE_REASONS = frozenset(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:216 pattern=fallback context=likely_guard_or_diagnostic line="before_send_offline_fallback",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:221 pattern=AUTO_ context=needs_manual_review line=AUTO_BIND_MISMATCH_BLOCK_TYPES = frozenset(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:289 pattern=AUTO_ context=needs_manual_review line=if (bind_reason or "").strip() in self.AUTO_RELINK_FRESH_PAGE_REASONS:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:294 pattern=AUTO_ context=needs_manual_review line=if mismatch in self.AUTO_BIND_MISMATCH_BLOCK_TYPES:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:431 pattern=fallback context=likely_guard_or_diagnostic line=def _log_action_target_fallback(self, session, remote, target, *, reason=""):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:442 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback_client_id={target.get('client_id') or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:443 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback_page_instance_id={target.get('page_instance_id') or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:444 pattern=fallback context=likely_guard_or_diagnostic line=f"fallback_conversation_id={target.get('conversation_id') or '-'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:480 pattern=deprecated context=likely_guard_or_diagnostic line=def _selected_page_mismatch_blocks_action_deprecated(self, session, action, *, status=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:682 pattern=deprecated context=likely_guard_or_diagnostic line=mismatch, mismatch_reason = self._selected_page_mismatch_blocks_action_deprecated(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:735 pattern=debug context=likely_guard_or_diagnostic line=not hasattr(self, "_is_debug_mode_enabled") or self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:737 pattern=debug context=likely_guard_or_diagnostic line=debug_on = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:738 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:750 pattern=debug context=likely_guard_or_diagnostic line=compact=not debug_on,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:851 pattern=fallback context=likely_guard_or_diagnostic line=if resolved.get("offline_fallback") and page is not None and hasattr(self, "_append_log"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:885 pattern=fallback context=likely_guard_or_diagnostic line="before_send_offline_fallback"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:886 pattern=fallback context=likely_guard_or_diagnostic line=if resolved.get("offline_fallback") and action == "send"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:893 pattern=fallback context=likely_guard_or_diagnostic line=if resolved.get("offline_fallback") and hasattr(self, "_append_log"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:924 pattern=fallback context=likely_guard_or_diagnostic line=reason="offline_fallback_rebind",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:926 pattern=fallback context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and not resolved.get("offline_fallback"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:1197 pattern=AUTO_ context=needs_manual_review line=f"[AUTO_BIND][USE_IDLE_HOME] session_id={session.session_id} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:1378 pattern=enable_ context=needs_manual_review line=live = self._live_openable_chatgpt_url()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:1585 pattern=fallback context=likely_guard_or_diagnostic line=def is_same_conversation_fallback_enabled(self, action="", session=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:1586 pattern=fallback context=likely_guard_or_diagnostic line="""强绑定模式：禁止同 conversation / 其它页面 fallback。"""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:1590 pattern=fallback context=likely_guard_or_diagnostic line=def _same_conversation_fallback_enabled(self, action="", session=None):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:1591 pattern=fallback context=likely_guard_or_diagnostic line=return self.is_same_conversation_fallback_enabled(action, session=session)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:8 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:35 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, make_sync_trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:49 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str = ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:84 pattern=legacy context=likely_guard_or_diagnostic line=legacy = getattr(self, "_pending_web_sync_requests", None)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:85 pattern=legacy context=likely_guard_or_diagnostic line=if isinstance(legacy, dict):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:86 pattern=legacy context=likely_guard_or_diagnostic line=return legacy`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:142 pattern=legacy context=likely_guard_or_diagnostic line=# legacy fallback: 无当前 session 时返回空快照，保持原 UI 字段集合。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:165 pattern=verbose context=needs_manual_review line=if hasattr(self, "_is_ui_verbose_status_enabled") and not self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:288 pattern=verbose context=needs_manual_review line=verbose_status = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:289 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:290 pattern=verbose context=needs_manual_review line=and self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:292 pattern=verbose context=needs_manual_review line=if verbose_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:311 pattern=verbose context=needs_manual_review line=if verbose_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:314 pattern=verbose context=needs_manual_review line=if verbose_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:356 pattern=verbose context=needs_manual_review line=if verbose_status:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:470 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:524 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1052 pattern=trace context=likely_guard_or_diagnostic line=sync_trace_id = (pending_sync.get("trace_id") or web_pending.get("trace_id") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1069 pattern=trace context=likely_guard_or_diagnostic line=trace_id=sync_trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1452 pattern=trace context=likely_guard_or_diagnostic line=trace_id = self._get_active_sync_trace_id()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1453 pattern=trace context=likely_guard_or_diagnostic line=if not trace_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1454 pattern=trace context=likely_guard_or_diagnostic line=trace_id = make_sync_trace_id(session_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1455 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_sync_trace_id(trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1465 pattern=fallback context=likely_guard_or_diagnostic line=f"raw={raw_max_messages!r} fallback=10 "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1587 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1657 pattern=trace context=likely_guard_or_diagnostic line=trace_id = plan.trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1684 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1779 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1816 pattern=trace context=likely_guard_or_diagnostic line="trace_id": plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:1855 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:2101 pattern=fallback context=likely_guard_or_diagnostic line=session, label="wait_conversation_sync", fallback_live=False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:2389 pattern=enable_ context=needs_manual_review line=url = self._session_openable_chatgpt_url(session)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:2400 pattern=fallback context=likely_guard_or_diagnostic line=fallback_live=True,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:2585 pattern=trace context=likely_guard_or_diagnostic line=error_text = traceback.format_exc()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_sync_mixin.py:2589 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc} traceback={error_text}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:6 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:269 pattern=debug context=likely_guard_or_diagnostic line=and hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:270 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:695 pattern=fallback context=likely_guard_or_diagnostic line=identity_key = f"url_fallback:{norm_url}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:838 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:911 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:912 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:1058 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:1059 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:1102 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:1103 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:1222 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:1223 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:6 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:34 pattern=trace context=likely_guard_or_diagnostic line=from app.utils.trace_log import kv_line, make_send_trace_id`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:161 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str = "",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:166 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (trace_id or make_send_trace_id(session.session_id)).strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:173 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:335 pattern=trace context=likely_guard_or_diagnostic line=trace_id: str = "",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:341 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (trace_id or self._get_active_send_trace_id() or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:342 pattern=trace context=likely_guard_or_diagnostic line=if trace_id:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:343 pattern=trace context=likely_guard_or_diagnostic line=self._set_active_send_trace_id(trace_id)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:365 pattern=trace context=likely_guard_or_diagnostic line=trace_id=trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:547 pattern=deprecated context=likely_guard_or_diagnostic line=send_decision, send_reason, target_page, send_detail = ("blocked", "deprecated_resolve_send_decision", None, {})`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:870 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:882 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:890 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:919 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1007 pattern=trace context=likely_guard_or_diagnostic line=tb = traceback.format_exc() if error else ""`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1011 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1019 pattern=trace context=likely_guard_or_diagnostic line=+ (f" traceback={tb}" if tb else ""),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1093 pattern=fallback context=likely_guard_or_diagnostic line=allow_fallback = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1094 pattern=fallback context=likely_guard_or_diagnostic line=if hasattr(self, "is_same_conversation_fallback_enabled"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1095 pattern=fallback context=likely_guard_or_diagnostic line=allow_fallback = self.is_same_conversation_fallback_enabled(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1110 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1111 pattern=fallback context=likely_guard_or_diagnostic line=allow_same_conversation_fallback=allow_fallback,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1118 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1133 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1142 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1146 pattern=trace context=likely_guard_or_diagnostic line=f"error_type={type(exc).__name__} error={exc}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1167 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1181 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/send_flow_mixin.py:1216 pattern=trace context=likely_guard_or_diagnostic line=trace_id=plan.trace_id or "-",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:4 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:36 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:60 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:77 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:122 pattern=settings.value context=needs_manual_review line=value = self._settings.value("auto_open_chatgpt_on_new_session")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:200 pattern=debug context=likely_guard_or_diagnostic line=if not self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:234 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:410 pattern=debug context=likely_guard_or_diagnostic line=if self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:525 pattern=AUTO_ context=needs_manual_review line="[SESSION_TITLE][AUTO_FROM_MESSAGES] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1363 pattern=verbose context=needs_manual_review line=verbose = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1364 pattern=verbose context=needs_manual_review line=hasattr(self, "_is_ui_verbose_status_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1365 pattern=verbose context=needs_manual_review line=and self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1367 pattern=verbose context=needs_manual_review line=if verbose and remote_binding_enabled(remote):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1580 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_append_log") and getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1614 pattern=fallback context=likely_guard_or_diagnostic line=fallback_live=(session_id == self._current_session_id),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1626 pattern=enable_ context=needs_manual_review line=open_url = self._session_openable_chatgpt_url(session)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1628 pattern=enable_ context=needs_manual_review line=open_url = self._live_openable_chatgpt_url()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:1648 pattern=fallback context=likely_guard_or_diagnostic line=fallback_live=(session_id == self._current_session_id),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2068 pattern=migrate context=needs_manual_review line=def _migrate_loaded_session_messages(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2259 pattern=fallback context=likely_guard_or_diagnostic line=fallback = time.time() if default is None else default`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2260 pattern=fallback context=likely_guard_or_diagnostic line=return safe_float_field(data, field, fallback)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2263 pattern=legacy context=likely_guard_or_diagnostic line=def _normalize_legacy_message_dict(data):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2265 pattern=legacy context=likely_guard_or_diagnostic line=for legacy_key in ("text", "message", "prompt", "raw_content"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2266 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_key in item and not (item.get("content") or "").strip():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2267 pattern=legacy context=likely_guard_or_diagnostic line=item["content"] = item.pop(legacy_key)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2269 pattern=legacy context=likely_guard_or_diagnostic line=item.pop(legacy_key, None)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2293 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2296 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(item, owner="session_message_load")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2321 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote, owner="GUI save session.remote_chatgpt")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2349 pattern=legacy context=likely_guard_or_diagnostic line=messages.append(self._message_from_dict(self._normalize_legacy_message_dict(item)))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2427 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2458 pattern=trace context=likely_guard_or_diagnostic line=detail = f"加载对话记录失败：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2470 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2496 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2506 pattern=settings.value context=needs_manual_review line=saved_tabs = self._settings.value("tab_session_ids")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2515 pattern=migrate context=needs_manual_review line=self._migrate_loaded_session_messages()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2516 pattern=migrate context=needs_manual_review line=self._migrate_loaded_remote_bindings()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2531 pattern=migrate context=needs_manual_review line=def _migrate_loaded_remote_bindings(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2532 pattern=migrate context=needs_manual_review line=from app.utils.bind_runtime import migrate_transient_from_remote`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2538 pattern=migrate context=needs_manual_review line=cleaned = migrate_transient_from_remote(self, session, old_remote)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2587 pattern=settings.value context=needs_manual_review line=geometry = self._settings.value("geometry")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2590 pattern=settings.value context=needs_manual_review line=window_state = self._settings.value("window_state")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/session_mixin.py:2595 pattern=settings.value context=needs_manual_review line=main_tab_index = int(self._settings.value("main_tab_index", 0))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:7 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:11 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:19 pattern=QSettings context=needs_manual_review line=# 无设置页 UI 的布尔项：仅用 DEFAULT_APP_SETTINGS 固定值，不写入 QSettings。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:26 pattern=debug context=likely_guard_or_diagnostic line="debug_mode",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:99 pattern=legacy context=likely_guard_or_diagnostic line=def _remove_legacy_bool_qsettings(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:133 pattern=enable_ context=needs_manual_review line=self._enable_lan_access = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:143 pattern=enable_ context=needs_manual_review line="enable_lan_access",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:153 pattern=settings.value context=needs_manual_review line=self._settings.value("font_size", defaults["font_size"]),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:161 pattern=settings.value context=needs_manual_review line=self._settings.value("enter_send_mode", defaults["enter_send_mode"])`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:164 pattern=settings.value context=needs_manual_review line=self._settings.value(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:177 pattern=enable_ context=needs_manual_review line=self._enable_lan_access = bool(defaults.get("enable_lan_access", False))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:181 pattern=debug context=likely_guard_or_diagnostic line=self._debug_mode = bool(defaults.get("debug_mode", False))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:240 pattern=trace context=likely_guard_or_diagnostic line=detail = f"加载设置失败，已使用默认值：{error}\n{traceback.format_exc()}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:247 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:249 pattern=debug context=likely_guard_or_diagnostic line=verbose=self._debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:258 pattern=debug context=likely_guard_or_diagnostic line=verbose=self._debug_mode,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:271 pattern=legacy context=likely_guard_or_diagnostic line=self._remove_legacy_bool_qsettings()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/settings_mixin.py:276 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode(self._debug_mode)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/tm_page_selector_format_mixin.py:268 pattern=verbose context=needs_manual_review line=if self._is_ui_verbose_status_enabled() if hasattr(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/tm_page_selector_format_mixin.py:270 pattern=verbose context=needs_manual_review line=self, "_is_ui_verbose_status_enabled"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_builder_core_mixin.py:2 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_builder_core_mixin.py:199 pattern=debug context=likely_guard_or_diagnostic line=def _build_debug_page(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_builder_core_mixin.py:276 pattern=debug context=likely_guard_or_diagnostic line=self.debug_page = self._build_debug_page()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_builder_core_mixin.py:282 pattern=debug context=likely_guard_or_diagnostic line=self.main_tabs.addTab(self.debug_page, "调试")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_chat_panel_mixin.py:2 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_chat_panel_mixin.py:155 pattern=settings.value context=needs_manual_review line=raw = self._settings.value("ui/chat_splitter_sizes", "")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_chat_panel_mixin.py:164 pattern=trace context=likely_guard_or_diagnostic line=f"invalid={raw} error={error}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_chat_panel_mixin.py:170 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_chat_panel_mixin.py:178 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_chat_panel_mixin.py:202 pattern=debug context=likely_guard_or_diagnostic line=if getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:5 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:302 pattern=debug context=likely_guard_or_diagnostic line=getattr(self, "_debug_mode", False)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:304 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:305 pattern=debug context=likely_guard_or_diagnostic line=and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:665 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:701 pattern=AUTO_ context=needs_manual_review line="[PAGE_SELECTOR][AUTO_REFRESH] "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:703 pattern=fallback context=likely_guard_or_diagnostic line=f"reason={'matched_or_fallback_page' if restore_index >= 0 else 'no_pages_available'} "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_settings_page_mixin.py:28 pattern=os.environ context=needs_manual_review line=token = (os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN") or "").strip()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:21 pattern=verbose context=needs_manual_review line=def _is_ui_verbose_status_enabled(self):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:22 pattern=debug context=likely_guard_or_diagnostic line=if hasattr(self, "_is_debug_mode_enabled"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:23 pattern=debug context=likely_guard_or_diagnostic line=return bool(self._is_debug_mode_enabled())`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:24 pattern=debug context=likely_guard_or_diagnostic line=return bool(getattr(self, "_debug_mode", False))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:177 pattern=fallback context=likely_guard_or_diagnostic line=fallback = state_text or "未绑定"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:178 pattern=fallback context=likely_guard_or_diagnostic line=return f"绑定页面：页面ID:{page_no} ｜ {fallback}"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:320 pattern=debug context=likely_guard_or_diagnostic line=debug_on = (`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:321 pattern=debug context=likely_guard_or_diagnostic line=hasattr(self, "_is_debug_mode_enabled") and self._is_debug_mode_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:323 pattern=debug context=likely_guard_or_diagnostic line=if debug_on or throttle.allow(log_key, msg, interval_ms=10000):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:406 pattern=verbose context=needs_manual_review line=def _format_compact_tm_online_chip_verbose(self, summary):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:645 pattern=fallback context=likely_guard_or_diagnostic line=same_conv_fallback = False`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:659 pattern=fallback context=likely_guard_or_diagnostic line=same_conv_fallback = True`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:671 pattern=fallback context=likely_guard_or_diagnostic line=if not bound_online and same_conv_fallback:`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:745 pattern=verbose context=needs_manual_review line=if self._is_ui_verbose_status_enabled():`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:765 pattern=verbose context=needs_manual_review line=verbose = self._is_ui_verbose_status_enabled()`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/ui_status_compact_mixin.py:770 pattern=verbose context=needs_manual_review line=if verbose and hasattr(self, "_format_tm_online_chip_text"):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/waiting_timer_mixin.py:3 pattern=trace context=likely_guard_or_diagnostic line=import traceback`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/waiting_timer_mixin.py:266 pattern=trace context=likely_guard_or_diagnostic line=f"reason={fail_reason}\n{traceback.format_exc()}",`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/mixins/waiting_timer_mixin.py:328 pattern=debug context=likely_guard_or_diagnostic line=if not getattr(self, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:16 pattern=debug context=likely_guard_or_diagnostic line=def _append_input_debug_log(self, message):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:20 pattern=debug context=likely_guard_or_diagnostic line=if not getattr(main_window, "_debug_mode", False):`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:30 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:40 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:48 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:56 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:67 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:80 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] app/ui/widgets/chat_input.py:87 pattern=debug context=likely_guard_or_diagnostic line=self._append_input_debug_log(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:21 pattern=migrate context=needs_manual_review line=if (typeof migrateContinuePromptTextIfNeeded === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:22 pattern=migration context=likely_guard_or_diagnostic line=const migration = migrateContinuePromptTextIfNeeded(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:26 pattern=migration context=likely_guard_or_diagnostic line=if (migration.migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:27 pattern=migration context=likely_guard_or_diagnostic line=config.continuePromptsText = migration.value;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:57 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '未命名列表',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:71 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '默认列表',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:239 pattern=migrate context=needs_manual_review line=function migrateTaskDoneSignalForAutoQueue(value) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:240 pattern=migrate context=needs_manual_review line=if (typeof migrateTaskDoneSignalValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:241 pattern=migrate context=needs_manual_review line=return migrateTaskDoneSignalValue(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:275 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeContinueRoundLimit(value, fallback = UNLIMITED_CONTINUE_ROUNDS) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:278 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:360 pattern=legacy context=likely_guard_or_diagnostic line=const legacyTemplate = String(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:372 pattern=legacy context=likely_guard_or_diagnostic line=continuePromptTemplate: String(legacyTemplate || ''),`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:567 pattern=migrate context=needs_manual_review line=const migrateNotes = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:572 pattern=migrate context=needs_manual_review line=migrateNotes.push('init-taskProfiles-array');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:583 pattern=fallback context=likely_guard_or_diagnostic line=fallbackName: '默认任务组',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:588 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:init-tasks-array`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:595 pattern=migrate context=needs_manual_review line=normalized.doneSignal = migrateTaskDoneSignalForAutoQueue(normalized.doneSignal);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:615 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:migrate-max-continue-unlimited`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:636 pattern=migrate context=needs_manual_review line=migrateNotes.push(`profile-${base.id}:repair-template`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:654 pattern=migrate context=needs_manual_review line=migrateNotes.push('seed-default-profile-with-example-tasks');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:659 pattern=migrate context=needs_manual_review line=const summary = migrateNotes.includes('seed-default-profile-with-example-tasks')`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:662 pattern=migrate context=needs_manual_review line=const detail = migrateNotes.length ? `${migrateNotes.join('; ')}; ` : '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:664 pattern=migrate context=needs_manual_review line=} else if (migrateNotes.length) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:665 pattern=migrate context=needs_manual_review line=ToolboxShell.appendLog(`[AUTOQ][TASK][MIGRATE] ${migrateNotes.join('; ')}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1071 pattern=legacy context=likely_guard_or_diagnostic line=const legacyHeader = taskPanelEl.querySelector(':scope > .cgpt-autoq-list-header');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1072 pattern=legacy context=likely_guard_or_diagnostic line=const legacyNameRow = taskPanelEl.querySelector(':scope > .cgpt-autoq-list-name-row');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1073 pattern=legacy context=likely_guard_or_diagnostic line=const legacyList = qs('#cgpt-autoq-task-list', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1074 pattern=legacy context=likely_guard_or_diagnostic line=const legacyEditor = qs('#cgpt-autoq-task-editor', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1075 pattern=legacy context=likely_guard_or_diagnostic line=const legacyDefaults = qs('#cgpt-autoq-task-profile-defaults', taskPanelEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1119 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyHeader && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1123 pattern=legacy context=likely_guard_or_diagnostic line=shellHeader.replaceWith(legacyHeader);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1127 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyNameRow && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1130 pattern=legacy context=likely_guard_or_diagnostic line=if (shellNameRow && shellNameRow !== legacyNameRow) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1131 pattern=legacy context=likely_guard_or_diagnostic line=shellNameRow.replaceWith(legacyNameRow);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1135 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyList && tasksPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1138 pattern=legacy context=likely_guard_or_diagnostic line=if (shellList && shellList !== legacyList) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1139 pattern=legacy context=likely_guard_or_diagnostic line=shellList.replaceWith(legacyList);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1145 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyEditor && currentPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1148 pattern=legacy context=likely_guard_or_diagnostic line=if (shellEditor && shellEditor !== legacyEditor) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1149 pattern=legacy context=likely_guard_or_diagnostic line=shellEditor.replaceWith(legacyEditor);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1155 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyDefaults && rulesPanel) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1158 pattern=legacy context=likely_guard_or_diagnostic line=if (shellDefaults && shellDefaults !== legacyDefaults) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1159 pattern=legacy context=likely_guard_or_diagnostic line=shellDefaults.replaceWith(legacyDefaults);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1163 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyHeader && legacyHeader.parentElement === taskPanelEl) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1164 pattern=legacy context=likely_guard_or_diagnostic line=legacyHeader.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1167 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyNameRow && legacyNameRow.parentElement === taskPanelEl) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1168 pattern=legacy context=likely_guard_or_diagnostic line=legacyNameRow.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:3135 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_REPLY_DONE]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:4472 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_SKIP] reason=missing_context task_id=${taskId || '-'} direction=${direction || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:4483 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_SKIP] reason=button_not_found task_id=${taskId} direction=${actionName} selector=${selector}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:4502 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][RESTORE_OK] task_id=${taskId} direction=${actionName} delta_y=${Math.round(deltaY)} scroll_top=${Math.round(listEl.scrollTop)}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:4524 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][START] task_id=${taskId} direction=${direction} before_scroll_top=${beforeListScrollTop}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:4534 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][TASK_MOVE][SKIP] task_id=${taskId} direction=${direction} reason=${reason}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5002 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH_START_CLICK] mode=task group_id=${profile ? profile.id : '-'} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5124 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BACKGROUND_THROTTLED] action=${actionName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5239 pattern=legacy context=likely_guard_or_diagnostic line=kind: 'legacy',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5519 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][WAIT_SEND_BUTTON] attempt=${attempt} found=${found} disabled=${disabledFlag} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5535 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'send_button_disabled_use_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5554 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'send_button_missing_use_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5589 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=stableSendMessage_unavailable');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5645 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][TEXT_SYNC_OK] retryIndex=${retryIndex} prompt_len=${prompt.length} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5662 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH][TEXT_SYNC_FAILED] reason=${lastSyncReason} prompt_len=${prompt.length} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5673 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_START]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5687 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${failReason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5693 pattern=fallback context=likely_guard_or_diagnostic line=`[AUTOQ][SEND_CLICK] task=${taskName} note=button_disabled_will_use_enter_fallback ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5717 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][INITIAL_SEND_OK]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5718 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH][WAIT_INITIAL_REPLY]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5723 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5761 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5765 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_SEND_DONE]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5766 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_WAIT_REPLY_START]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5795 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH][INITIAL_SEND_FAILED] reason=${errText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5831 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog('[AUTO_QUEUE][BATCH_INITIAL_WAIT_RESPONDING]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5885 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][BATCH_INITIAL_PROMPT_PICKED] text_len=${initial.length} task_title=${currentTask.title}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5900 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${reason}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5919 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][BATCH_INITIAL_SEND_FAILED] reason=${errText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:6445 pattern=AUTO_ context=needs_manual_review line=ToolboxShell.appendLog(`[AUTO_QUEUE][FOREGROUND_RESUME] reason=${tag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:152 pattern=debug context=likely_guard_or_diagnostic line=function debugLog(text) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:295 pattern=legacy context=likely_guard_or_diagnostic line=const legacy = String(sessionStorage.getItem('xz_bind_token') || '').trim();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:296 pattern=legacy context=likely_guard_or_diagnostic line=if (legacy) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:297 pattern=legacy context=likely_guard_or_diagnostic line=clearStoredBindRequestToken('legacy-without-meta');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:503 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPathname = location && location.pathname ? location.pathname : '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:504 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackConversationId = parseConversationIdFromPath(fallbackPathname);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:507 pattern=fallback context=likely_guard_or_diagnostic line=`[getPageIdentity][failed] type=${errName} pathname=${fallbackPathname || '-'} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:513 pattern=fallback context=likely_guard_or_diagnostic line=`[BRIDGE][IDENTITY][FAILED] type=${errName} pathname=${fallbackPathname || '-'} conversation_id=${fallbackConversationId || '-'} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:517 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPageDisplayId = getCurrentBridgePageDisplayId();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:521 pattern=fallback context=likely_guard_or_diagnostic line=page_display_id: fallbackPageDisplayId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:522 pattern=fallback context=likely_guard_or_diagnostic line=page_no: fallbackPageDisplayId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:528 pattern=fallback context=likely_guard_or_diagnostic line=page_type: fallbackConversationId ? 'conversation' : 'unknown',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:529 pattern=fallback context=likely_guard_or_diagnostic line=conversation_id: fallbackConversationId || '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:534 pattern=fallback context=likely_guard_or_diagnostic line=pathname: fallbackPathname,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:547 pattern=DEBUG_ context=likely_guard_or_diagnostic line=const DEBUG_FULL_BRIDGE_JSON = false;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:583 pattern=debug context=likely_guard_or_diagnostic line=const debugEnabled = !!cfg.bridgeDebugEnabled;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:587 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if (!DEBUG_FULL_BRIDGE_JSON && !debugEnabled) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1027 pattern=localStorage context=needs_manual_review line=localStorage.removeItem(getPendingReplyContextKey());`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1028 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1044 pattern=localStorage context=needs_manual_review line=Object.keys(localStorage).forEach((key) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1050 pattern=localStorage context=needs_manual_review line=ctx = JSON.parse(localStorage.getItem(key) || 'null');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1061 pattern=localStorage context=needs_manual_review line=localStorage.removeItem(key);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1064 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1065 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1066 pattern=legacy context=likely_guard_or_diagnostic line=let legacyCtx = null;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1068 pattern=legacy context=likely_guard_or_diagnostic line=legacyCtx = JSON.parse(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1069 pattern=legacy context=likely_guard_or_diagnostic line=} catch (legacyParseError) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1071 pattern=legacy context=likely_guard_or_diagnostic line=error_type: legacyParseError && legacyParseError.name,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1072 pattern=legacy context=likely_guard_or_diagnostic line=error: legacyParseError && legacyParseError.message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1073 pattern=legacy context=likely_guard_or_diagnostic line=stack: legacyParseError && legacyParseError.stack,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1076 pattern=legacy context=likely_guard_or_diagnostic line=const legacySentAt = Number((legacyCtx && legacyCtx.sent_at) || 0);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1077 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx || legacyCtx.reply_reported || !legacySentAt || now - legacySentAt > ttlMs) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1078 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1198 pattern=localStorage context=needs_manual_review line=localStorage.setItem(pageKey, JSON.stringify(ctx));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1200 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1201 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1202 pattern=legacy context=likely_guard_or_diagnostic line=let legacyCtx = null;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1204 pattern=legacy context=likely_guard_or_diagnostic line=legacyCtx = JSON.parse(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1205 pattern=legacy context=likely_guard_or_diagnostic line=} catch (legacyParseError) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1207 pattern=legacy context=likely_guard_or_diagnostic line=error_type: legacyParseError && legacyParseError.name,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1208 pattern=legacy context=likely_guard_or_diagnostic line=error: legacyParseError && legacyParseError.message,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1209 pattern=legacy context=likely_guard_or_diagnostic line=stack: legacyParseError && legacyParseError.stack,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1213 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx || isPendingReplyContextForCurrentPage(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1214 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1240 pattern=localStorage context=needs_manual_review line=let raw = localStorage.getItem(pageKey) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1243 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1244 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyRaw) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1248 pattern=legacy context=likely_guard_or_diagnostic line=const legacyCtx = parsePendingReplyContextRaw(legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1249 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyCtx) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1253 pattern=legacy context=likely_guard_or_diagnostic line=if (!hasAnyPendingReplyContextIdentity(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1258 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1262 pattern=legacy context=likely_guard_or_diagnostic line=if (!isPendingReplyContextForCurrentPage(legacyCtx)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1263 pattern=legacy context=likely_guard_or_diagnostic line=logIgnoredForeignPendingReplyContext(legacyCtx, 'legacy-load');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1267 pattern=legacy context=likely_guard_or_diagnostic line=localStorage.setItem(pageKey, legacyRaw);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1268 pattern=localStorage context=likely_guard_or_diagnostic line=localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:1269 pattern=legacy context=likely_guard_or_diagnostic line=raw = legacyRaw;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3005 pattern=debug context=likely_guard_or_diagnostic line=debugLog(`identity changed: ${oldKey || '-'} -> ${key}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3025 pattern=debug context=likely_guard_or_diagnostic line=debugLog(`route identity changed: ${oldKey || '-'} -> ${key}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3228 pattern=debug context=likely_guard_or_diagnostic line=selector: '#cgpt-bridge-debug',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3659 pattern=debug context=likely_guard_or_diagnostic line=<input type="checkbox" id="cgpt-bridge-debug">`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:78 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] buildChatExportText records failed, fallback to ComposerApi', exportErr);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:221 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] skip invalid JSON candidate', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:252 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] JSON stringify failed during dedupe', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/log-module.js:140 pattern=trace context=likely_guard_or_diagnostic line='error', 'warn', 'failed', 'fail', 'exception', 'traceback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:43 pattern=migrate context=needs_manual_review line=function migrateCompactContinuePromptIfNeeded(cfg, options = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:47 pattern=migrate context=needs_manual_review line=if (typeof migrateContinuePromptTextIfNeeded !== 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:55 pattern=migration context=likely_guard_or_diagnostic line=const migration = migrateContinuePromptTextIfNeeded(stored, logFn);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:57 pattern=migration context=likely_guard_or_diagnostic line=if (migration.migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:58 pattern=migration context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinuePromptText = migration.value;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:78 pattern=migrate context=needs_manual_review line=cfg = migrateCompactContinuePromptIfNeeded(cfg, { log: true });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:89 pattern=migrate context=needs_manual_review line=const cfg = migrateCompactContinuePromptIfNeeded(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:74 pattern=fallback context=likely_guard_or_diagnostic line=function getValue(root, selector, fallback, moduleName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:76 pattern=fallback context=likely_guard_or_diagnostic line=if (!el) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:77 pattern=fallback context=likely_guard_or_diagnostic line=return String(el.value ?? fallback ?? '');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:80 pattern=fallback context=likely_guard_or_diagnostic line=function getChecked(root, selector, fallback, moduleName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:82 pattern=fallback context=likely_guard_or_diagnostic line=if (!el) return !!fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:155 pattern=fallback context=likely_guard_or_diagnostic line=function normalizePromptCategoryName(item, fallback = '默认') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:160 pattern=fallback context=likely_guard_or_diagnostic line=return text || fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:214 pattern=fallback context=likely_guard_or_diagnostic line=function readStorage(key, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:215 pattern=fallback context=likely_guard_or_diagnostic line=return StorageKit.readJson(key, fallback, { scoped: true });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:222 pattern=fallback context=likely_guard_or_diagnostic line=function readLocalJson(key, fallback, tag = '[STORAGE]') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:223 pattern=fallback context=likely_guard_or_diagnostic line=return StorageKit.readJson(key, fallback, { scoped: false, tag });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:230 pattern=fallback context=likely_guard_or_diagnostic line=function clonePlainObject(value, fallback = null, tag = '[CLONE]') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:249 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:928 pattern=fallback context=likely_guard_or_diagnostic line=function readJson(key, fallback, options = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:934 pattern=GM_getValue context=needs_manual_review line=if (scoped && typeof GM_getValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:935 pattern=GM_getValue context=needs_manual_review line=const value = GM_getValue(resolvedKey, null);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:939 pattern=GM_getValue context=needs_manual_review line=logError(`${tag}[GM_getValue-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:943 pattern=localStorage context=needs_manual_review line=const raw = window.localStorage.getItem(resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:944 pattern=fallback context=likely_guard_or_diagnostic line=if (raw == null || raw === '') return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:947 pattern=fallback context=likely_guard_or_diagnostic line=return parsed == null ? fallback : parsed;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:949 pattern=localStorage context=needs_manual_review line=logError(`${tag}[localStorage-read-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:950 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:960 pattern=GM_setValue context=needs_manual_review line=if (scoped && typeof GM_setValue === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:961 pattern=GM_setValue context=needs_manual_review line=GM_setValue(resolvedKey, value);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:965 pattern=GM_setValue context=needs_manual_review line=logError(`${tag}[GM_setValue-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:970 pattern=localStorage context=needs_manual_review line=window.localStorage.removeItem(resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:972 pattern=localStorage context=needs_manual_review line=window.localStorage.setItem(resolvedKey, JSON.stringify(value));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:977 pattern=localStorage context=needs_manual_review line=logError(`${tag}[localStorage-write-failed]`, error, resolvedKey);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1063 pattern=DEBUG_ context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[DEBUG_API][skip-existing] ${fullName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1071 pattern=DEBUG_ context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[DEBUG_API][registered] ${fullName}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1364 pattern=fallback context=likely_guard_or_diagnostic line=function clampNumber(value, fallback, min, max) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1366 pattern=fallback context=likely_guard_or_diagnostic line=const safe = Number.isFinite(n) ? n : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1534 pattern=fallback context=likely_guard_or_diagnostic line=function get(key, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1535 pattern=fallback context=likely_guard_or_diagnostic line=return readStorage(key, fallback);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1660 pattern=fallback context=likely_guard_or_diagnostic line=function readToolboxStateField(state, fieldName, fallback = '') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1664 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1687 pattern=legacy context=likely_guard_or_diagnostic line=const legacyKeys = TOOLBOX_PAGE_STATE_LEGACY_READ_ALIASES[key];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1688 pattern=legacy context=likely_guard_or_diagnostic line=if (Array.isArray(legacyKeys)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1689 pattern=legacy context=likely_guard_or_diagnostic line=for (let i = 0; i < legacyKeys.length; i += 1) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1690 pattern=legacy context=likely_guard_or_diagnostic line=const legacyValue = readValue(legacyKeys[i]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1691 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyValue !== undefined) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1692 pattern=legacy context=likely_guard_or_diagnostic line=return legacyValue;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1697 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1770 pattern=legacy context=likely_guard_or_diagnostic line=const legacyTaskFields = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1776 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].continuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1779 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].defaultContinuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1783 pattern=legacy context=likely_guard_or_diagnostic line=legacyTaskFields.push(`taskProfiles[${profileIndex}].tasks[${taskIndex}].continuePrompt`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1787 pattern=legacy context=likely_guard_or_diagnostic line=logLegacyFieldFinding('autoQueueConfig', legacyTaskFields);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1801 pattern=legacy context=likely_guard_or_diagnostic line=TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS.forEach((legacyKey) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1802 pattern=legacy context=likely_guard_or_diagnostic line=if (Object.prototype.hasOwnProperty.call(state, legacyKey)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1803 pattern=legacy context=likely_guard_or_diagnostic line=pageLegacyFields.push(`${routeKey}.${legacyKey}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1810 pattern=migrate context=needs_manual_review line=let migrated = false;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1821 pattern=legacy context=likely_guard_or_diagnostic line=TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS.forEach((legacyKey) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1822 pattern=legacy context=likely_guard_or_diagnostic line=if (Object.prototype.hasOwnProperty.call(nextState, legacyKey)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1823 pattern=legacy context=likely_guard_or_diagnostic line=delete nextState[legacyKey];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1824 pattern=migrate context=needs_manual_review line=migrated = true;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1829 pattern=migrate context=needs_manual_review line=if (migrated) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2184 pattern=fallback context=likely_guard_or_diagnostic line=function normalizePositiveInt(value, fallback, min, max) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2186 pattern=fallback context=likely_guard_or_diagnostic line=if (!Number.isFinite(n)) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2188 pattern=fallback context=likely_guard_or_diagnostic line=if (intValue < min) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2200 pattern=legacy context=likely_guard_or_diagnostic line=const legacyLoopPrompt = typeof cfg.copyHotkeyLoopContinuePrompt === 'string'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2203 pattern=legacy context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinuePromptText = String(cfg.copyHotkeyContinuePromptText || legacyLoopPrompt || '').trim();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2205 pattern=legacy context=likely_guard_or_diagnostic line=const legacyLoopStop = typeof cfg.copyHotkeyLoopStopSignal === 'string'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2217 pattern=legacy context=likely_guard_or_diagnostic line=cfg.copyHotkeyContinueStopSignal || legacyLoopStop || DEFAULT_BATCH_TASK_DONE_SIGNAL,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2284 pattern=fallback context=likely_guard_or_diagnostic line=function cloneShortcutItem(item, fallback) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2285 pattern=fallback context=likely_guard_or_diagnostic line=const src = item && typeof item === 'object' ? item : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2604 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeTimestamp(value, fallback = nowMs()) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2606 pattern=fallback context=likely_guard_or_diagnostic line=return Number.isFinite(n) && n > 0 ? n : fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2621 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackName = options.fallbackName || '未命名';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2626 pattern=fallback context=likely_guard_or_diagnostic line=input && input.name != null ? input.name : fallbackName,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2628 pattern=fallback context=likely_guard_or_diagnostic line=) || fallbackName;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2729 pattern=fallback context=likely_guard_or_diagnostic line=function normalizeToNativeFile(value, fallbackName) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2735 pattern=fallback context=likely_guard_or_diagnostic line=return new File([value], fallbackName || 'upload.bin', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2742 pattern=fallback context=likely_guard_or_diagnostic line=return new File([value], value.name || fallbackName || 'upload.bin', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2850 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] textarea fallback copy failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2851 pattern=fallback context=likely_guard_or_diagnostic line=console.error('[ChatGPT toolbox] textarea fallback copy failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2880 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] GM_setClipboard failed, fallback to browser clipboard', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2900 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] navigator.clipboard.writeText failed, fallback to execCommand', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:12 pattern=GM_setValue context=needs_manual_review line=// @grant        GM_setValue`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:13 pattern=GM_getValue context=needs_manual_review line=// @grant        GM_getValue`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:313 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'no-latest-user-fallback-last-assistant',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:1156 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackStartedAt = Date.now();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:1168 pattern=fallback context=likely_guard_or_diagnostic line=`[CHAT_MSG][LATEST_FALLBACK_FULL_SCAN] reason=${reason} cost=${Date.now() - fallbackStartedAt}ms records=${fullRecords.length}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:1194 pattern=fallback context=likely_guard_or_diagnostic line=reason: mode === 'fast' ? 'fast-tail' : 'full-scan-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:1719 pattern=fallback context=likely_guard_or_diagnostic line=source: 'svg-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:2214 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] execCommand insertText failed; fallback to textContent', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:2324 pattern=debug context=likely_guard_or_diagnostic line=const debugText = [`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:2332 pattern=debug context=likely_guard_or_diagnostic line=ToolboxShell.appendLog(`[COMPOSER][click-send] ${debugText}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:3054 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] attachment evidence timeout', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:3218 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input upload failed: no file inputs');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:3235 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] legacy input upload try', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:3332 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input dispatch failed', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:5836 pattern=fallback context=likely_guard_or_diagnostic line=result.reason = 'sent_by_enter_fallback_disabled_button';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:5914 pattern=fallback context=likely_guard_or_diagnostic line=result.reason = result.usedFallbackEnter ? 'sent_by_enter_fallback' : 'sent';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:6716 pattern=fallback context=likely_guard_or_diagnostic line=const ctrlEnter = await runActionAndConfirm('ctrl_enter_fallback', () => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:6731 pattern=fallback context=likely_guard_or_diagnostic line=const enter = await runActionAndConfirm('enter_fallback', () => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:6747 pattern=fallback context=likely_guard_or_diagnostic line='native_enter_fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:6753 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][ACTION_SKIP] method=native_enter_fallback reason=composer-focus-failed');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:6762 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][ACTION_SKIP] method=native_enter_fallback reason=bridge-unavailable');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7134 pattern=fallback context=likely_guard_or_diagnostic line=appendSendLog('[SEND][WAIT_BUTTON_SKIP] reason=existing-composer-use-action-fallback');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7236 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_READY] source=${source}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7243 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_READY_TIMEOUT] source=${source}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7260 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_BUTTON_MISS] source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7266 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_FOUND] source=${sourceTag} selector=${info.selector || '-'} ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7272 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_REJECT] source=${sourceTag} reason=voice_button ``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7280 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_BUTTON_DISABLED] source=${sourceTag} aria=${info.aria || '-'} testid=${info.testid || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7287 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_BUTTON_CLICK] source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7298 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_SKIP] reason=empty_text source=${sourceTag}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7302 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_START] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7310 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_not_ready`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7318 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog('[AUTO_QUEUE][BATCH_INITIAL_WAIT_RESPONDING]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7326 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_not_found`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7332 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_set_failed`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7336 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_TEXT_SET] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7343 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=composer_text_not_synced`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7347 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][COMPOSER_TEXT_SYNCED] source=${sourceTag} text_len=${cleanText.length}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7360 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=sendContentViaComposer`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7370 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_STABLE_FAILED] source=${sourceTag} reason=${viaComposer.reason || 'unknown'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7384 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=stableSendMessage`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7394 pattern=AUTO_ context=needs_manual_review line=`[AUTO_QUEUE][SEND_STABLE_FAILED] source=${sourceTag} reason=${stableResult.reason || 'unknown'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7406 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=click_button`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7413 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=click_button`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7439 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_DONE] source=${sourceTag} method=keyboard_enter`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:7444 pattern=AUTO_ context=needs_manual_review line=appendAutoQueueLog(`[AUTO_QUEUE][SEND_FAILED] source=${sourceTag} reason=no_send_method`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:47 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 旧缓存可能含 READY；新流程不再产生，normalizeUploadState 会归一化为 IDLE。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:58 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 仅用于兼容旧版本上传缓存状态，新上传流程不再产生这些状态。`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:363 pattern=migrate context=needs_manual_review line=function migrateTaskDoneSignalValue(value, logFn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:681 pattern=migrate context=needs_manual_review line=function migrateContinuePromptTextIfNeeded(storedText, logFn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:685 pattern=migrate context=needs_manual_review line=return { value: '', migrated: false, reason: 'empty-use-runtime-default' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:692 pattern=migrate context=needs_manual_review line=return { value: '', migrated: true, reason: 'old-continue' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:697 pattern=legacy context=likely_guard_or_diagnostic line=logFn('[CONTINUE_PROMPT][MIGRATE_DEFAULT] old=legacy-prompt new=explicit-task-done');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:699 pattern=legacy context=likely_guard_or_diagnostic line=return { value: '', migrated: true, reason: 'legacy-prompt' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:705 pattern=migrate context=needs_manual_review line=return { value: trimmed, migrated: false, reason: 'user-customized' };`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:745 pattern=deprecated context=likely_guard_or_diagnostic line=- 建议保留但标记 @deprecated`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:44 pattern=AUTO_ context=needs_manual_review line=const EDGE_AUTO_HIDE_SIDE = 'right';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:45 pattern=AUTO_ context=needs_manual_review line=const VALID_EDGE_SIDES = Object.freeze([EDGE_AUTO_HIDE_SIDE]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:107 pattern=AUTO_ context=needs_manual_review line=return String(side || '').trim() === EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4221 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('create-existing-root-detached');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4270 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('reuse-existing-dom');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4369 pattern=migrate context=needs_manual_review line=migrateToolboxToastToPanel('create-new-root');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4722 pattern=fallback context=likely_guard_or_diagnostic line=const fallback = normalizePanelSize(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4725 pattern=fallback context=likely_guard_or_diagnostic line=if (!panel) return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4735 pattern=fallback context=likely_guard_or_diagnostic line=return fallback;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5183 pattern=AUTO_ context=needs_manual_review line=if (text && text !== EDGE_AUTO_HIDE_SIDE) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5186 pattern=AUTO_ context=needs_manual_review line=return VALID_EDGE_SIDES.includes(text) ? text : EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5399 pattern=AUTO_ context=needs_manual_review line=if (isStrictlyTouchingEdge(panelRect, EDGE_AUTO_HIDE_SIDE)) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5400 pattern=AUTO_ context=needs_manual_review line=return EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5867 pattern=deprecated context=likely_guard_or_diagnostic line=// @deprecated 控制台救援 API，确认无旧版救援脚本依赖后再删除`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5966 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackLeft = Number.isFinite(Number(savedPos.left))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5970 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackTop = Number.isFinite(Number(savedPos.top))`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5975 pattern=fallback context=likely_guard_or_diagnostic line=left: fallbackLeft,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5976 pattern=fallback context=likely_guard_or_diagnostic line=top: fallbackTop,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5977 pattern=fallback context=likely_guard_or_diagnostic line=right: fallbackLeft + size.width,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5978 pattern=fallback context=likely_guard_or_diagnostic line=bottom: fallbackTop + size.height,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6196 pattern=AUTO_ context=needs_manual_review line=const nextSide = EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6627 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] resize releasePointerCapture failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6639 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] resize setPointerCapture failed', err);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7242 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackWidth = 110;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7243 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackHeight = 28;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7246 pattern=fallback context=likely_guard_or_diagnostic line=const width = rect && rect.width > 0 ? rect.width : fallbackWidth;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7247 pattern=fallback context=likely_guard_or_diagnostic line=const height = rect && rect.height > 0 ? rect.height : fallbackHeight;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7320 pattern=fallback context=likely_guard_or_diagnostic line=source = 'last-panel-visible-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7327 pattern=fallback context=likely_guard_or_diagnostic line=source = 'saved-panel-position-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7431 pattern=fallback context=likely_guard_or_diagnostic line=const fallback = getPanelSizeFallback();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7443 pattern=fallback context=likely_guard_or_diagnostic line=applyPanelSize(fallback);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7640 pattern=AUTO_ context=needs_manual_review line=edge = EDGE_AUTO_HIDE_SIDE;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7750 pattern=AUTO_ context=needs_manual_review line=const shouldHide = enabled && edge === EDGE_AUTO_HIDE_SIDE && panelHidden && !isEdgeHidden();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7789 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackPos = {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7793 pattern=fallback context=likely_guard_or_diagnostic line=saveHiddenTitlePosition(fallbackPos, `${reason}:fallback`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7794 pattern=fallback context=likely_guard_or_diagnostic line=const lockedFallback = getLockedHiddenTitlePosition(`${reason}:fallback-locked`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7798 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-apply] reason=${reason || '-'} left=${Math.round(lockedFallback.left)} top=${Math.round(lockedFallback.top)} panelLeft=${Math.round(Number(rect.left))} panelTop=${Math.round(Number(rect.to`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7801 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] hidePanel fallback locked position missing', rect);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7803 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} missing-locked-fallback`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7807 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] hidePanel fallback apply skipped: invalid panel rect', rect);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7809 pattern=fallback context=likely_guard_or_diagnostic line=`[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} invalid-panel-rect`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8754 pattern=debug context=likely_guard_or_diagnostic line=if (window.console && typeof console.debug === 'function') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8755 pattern=debug context=likely_guard_or_diagnostic line=console.debug(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8843 pattern=migrate context=needs_manual_review line=function migrateToolboxToastToPanel(reason = '') {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8851 pattern=migrate context=needs_manual_review line=appendLog(`[TOOLBOX_TOAST][migrate] from=root to=panel reason=${reason || '-'}`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9015 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] ignored page error', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9047 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] ignored page rejection', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9063 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox][LOG_REENTER]', message);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9073 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox][LOG_BEFORE_READY]', message);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9502 pattern=fallback context=likely_guard_or_diagnostic line=source = 'full-turn-fallback';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9856 pattern=fallback context=likely_guard_or_diagnostic line=function chooseAssistantFinalAnswerText(rawText, fallbackText, meta = {}) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9865 pattern=fallback context=likely_guard_or_diagnostic line=const cleanedFallback = cleanFn(fallbackText || '');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9873 pattern=fallback context=likely_guard_or_diagnostic line=`[CHAT_PAGE][assistant-final-answer-picked] source=after-thinking chars=${cleanedAfterThinking.length} fallbackChars=${String(cleanedFallback || '').length} turn=${meta.turnId || '-'}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:9884 pattern=fallback context=likely_guard_or_diagnostic line=let source = 'fallback-content';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:27 pattern=AUTO_ context=needs_manual_review line=const QUICK_PROMPT_CLICK_AUTO_SEND = true;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:225 pattern=fallback context=likely_guard_or_diagnostic line=+ 'fallback=hasAssistantDoneSignalInText',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:339 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackGroupId = restored.resolvedGroupId || '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:341 pattern=fallback context=likely_guard_or_diagnostic line=if (!fallbackGroupId) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:342 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] ensureActiveUploadGroupIdValid: no fallback group', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:349 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] activeUploadGroupId invalid, fallback to restored group', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:352 pattern=fallback context=likely_guard_or_diagnostic line=fallbackGroupId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:356 pattern=fallback context=likely_guard_or_diagnostic line=state.activeGroupId = fallbackGroupId;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:360 pattern=fallback context=likely_guard_or_diagnostic line=fallbackGroupId,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:441 pattern=fallback context=likely_guard_or_diagnostic line=fallback: files.length ? getUploadFileFolderKey(files[0]) : '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:445 pattern=fallback context=likely_guard_or_diagnostic line=const fallbackFolderKey = getUploadFileFolderKey(files[0]);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:448 pattern=fallback context=likely_guard_or_diagnostic line=folderKey: fallbackFolderKey,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:894 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload item source', stage, info, extra);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:908 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload queue snapshot', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1202 pattern=debug context=likely_guard_or_diagnostic line=debugSavedFrom: '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1249 pattern=debug context=likely_guard_or_diagnostic line=if (hasBlob || record.blobSaved || record.blobSavedAt || record.debugSavedFrom) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1257 pattern=debug context=likely_guard_or_diagnostic line=record.debugSavedFrom = '';`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1603 pattern=debug context=likely_guard_or_diagnostic line=async function debugReadBackPersistedQueue(stage) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1613 pattern=debug context=likely_guard_or_diagnostic line=req.onerror = () => reject(req.error || new Error('IndexedDB debug getAll failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1628 pattern=debug context=likely_guard_or_diagnostic line=debugSavedFrom: r.debugSavedFrom || '',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1634 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] persisted queue readback', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1640 pattern=debug context=likely_guard_or_diagnostic line=console.error('[ChatGPT toolbox] debugReadBackPersistedQueue failed', stage, e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1717 pattern=debug context=likely_guard_or_diagnostic line=await debugReadBackPersistedQueue('persistQueue:after-write');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1998 pattern=migrate context=likely_guard_or_diagnostic line=migrateLegacyUploadSelectionIfNeeded();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2043 pattern=legacy context=likely_guard_or_diagnostic line=reason: 'legacy-missing-group',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2048 pattern=migrate context=needs_manual_review line=async function migrateMissingGroupIdRows() {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2052 pattern=migrate context=needs_manual_review line=ToolboxShell.appendLog('[UPLOAD_GROUP][migrate-missing-group-skip] reason=no-target-group');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2064 pattern=migration context=likely_guard_or_diagnostic line=req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll for migration failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2079 pattern=migrate context=needs_manual_review line=`[UPLOAD_GROUP][migrate-missing-group] target=${targetId} changed=${changed}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2089 pattern=migration context=likely_guard_or_diagnostic line=tx.onerror = () => reject(tx.error || new Error('IndexedDB queue migration transaction failed'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2090 pattern=migration context=likely_guard_or_diagnostic line=tx.onabort = () => reject(tx.error || new Error('IndexedDB queue migration transaction aborted'));`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2098 pattern=migrate context=needs_manual_review line=console.error('[ChatGPT toolbox] migrate missing groupId rows failed', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2101 pattern=migrate context=needs_manual_review line=`[UPLOAD_GROUP][migrate-missing-group-error] target=${targetId || '-'} type=${errName} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2138 pattern=deprecated context=likely_guard_or_diagnostic line=`[UPLOAD_DIAG][restore-blob:deprecated] name=${item.name || '-'} id=${item.id || '-'}``
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2191 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] loadQueue row restore', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2224 pattern=migrate context=needs_manual_review line=const migrated = await migrateMissingGroupIdRows();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2226 pattern=migrate context=needs_manual_review line=if (migrated === false) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2228 pattern=legacy context=likely_guard_or_diagnostic line=`[UPLOAD_GROUP][load-queue:migrate-skipped] groupId=${state.activeGroupId || '-'} note=legacy-rows-without-groupId-may-be-invisible`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2474 pattern=migrate context=likely_guard_or_diagnostic line=function migrateLegacyUploadSelectionIfNeeded() {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2480 pattern=legacy context=likely_guard_or_diagnostic line=const legacyId = String(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2483 pattern=legacy context=likely_guard_or_diagnostic line=if (!legacyId) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2487 pattern=legacy context=likely_guard_or_diagnostic line=const group = state.groups.find((item) => item && item.id === legacyId);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2595 pattern=fallback context=likely_guard_or_diagnostic line=fallback: resolvedFolderKey,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3237 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3242 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3460 pattern=fallback context=likely_guard_or_diagnostic line=`[UPLOAD][IMPORT][QUEUE_GROUP_FALLBACK] old=${rawGroupId} fallback=${groupId}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3597 pattern=fallback context=likely_guard_or_diagnostic line=appendUploadGroupLog('RENDER', { phase: 'fallback-after-error' });`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3893 pattern=AUTO_ context=needs_manual_review line=if (QUICK_PROMPT_CLICK_AUTO_SEND !== true) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:7461 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:7471 pattern=fallback context=likely_guard_or_diagnostic line=ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 supported=0');`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:7656 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] fileHandle.getFile failed, no fallback to cache', e);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:7664 pattern=fallback context=likely_guard_or_diagnostic line=`[UPLOAD_DIAG][readFreshFile:handle-failed-no-fallback] name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} type=${errName} error=${errText}`,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:7926 pattern=fallback context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] makeUploadFile failed; fallback to original file', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:7944 pattern=debug context=likely_guard_or_diagnostic line=console.debug('[ChatGPT toolbox] upload file name resolved', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:8021 pattern=legacy context=likely_guard_or_diagnostic line=console.warn('[ChatGPT toolbox] legacy input upload failed', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:9016 pattern=fallback context=likely_guard_or_diagnostic line=reason: 'quick-category-fallback',`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12500 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRows = rootEl.querySelectorAll(`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12503 pattern=legacy context=likely_guard_or_diagnostic line=legacyRows.forEach((row) => {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12509 pattern=legacy context=likely_guard_or_diagnostic line=const legacyStatusCounts = qs('#cgpt-upload-status-counts', rootEl);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12510 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyStatusCounts) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12511 pattern=legacy context=likely_guard_or_diagnostic line=legacyStatusCounts.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12535 pattern=legacy context=likely_guard_or_diagnostic line=const legacyUploadAndSendBtn = qs('#cgpt-upload-start-and-send', actionRow);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12536 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyUploadAndSendBtn) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12537 pattern=legacy context=likely_guard_or_diagnostic line=legacyUploadAndSendBtn.remove();`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12670 pattern=AUTO_ context=needs_manual_review line=console.error('[AUTO_CONTINUE][FAILED]', {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:13403 pattern=legacy context=likely_guard_or_diagnostic line=const legacyRowFields = [];`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:13427 pattern=legacy context=likely_guard_or_diagnostic line=legacyRowFields.push(`queue[${index}].upload_active_group_id`);`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:13440 pattern=legacy context=likely_guard_or_diagnostic line=if (legacyRowFields.length) {`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:13441 pattern=legacy context=likely_guard_or_diagnostic line=const line = `[FIELD][LEGACY_FOUND] scope=uploadQueue fields=${legacyRowFields.join(',')}`;`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:7 pattern=feature context=needs_manual_review line=You are an agent that specializes in working with Specs in Claude Code. Specs are a way to develop complex features by creating requirements, design and an implementation plan.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:11 pattern=feature context=needs_manual_review line=When a user wants to create a new feature or use the spec workflow, you need to act as a spec-manager to coordinate the entire process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:19 pattern=Feature context=needs_manual_review line=# Feature Spec Creation Workflow`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:23 pattern=feature context=needs_manual_review line=You are helping guide the user through the process of transforming a rough idea for a feature into a detailed design document with an implementation plan and todo list. It follows the spec driven development methodology `
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:27 pattern=feature context=needs_manual_review line=Before you get started, think of a short feature name based on the user's rough idea. This will be used for the feature directory. Use kebab-case format for the feature_name (e.g. "user-authentication")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:36 pattern=feature context=needs_manual_review line=When the user describes a new feature: (user_input: feature description)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:38 pattern=feature context=needs_manual_review line=1. Based on {user_input}, choose a feature_name (kebab-case format, e.g. "user-authentication")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:44 pattern=feature context=needs_manual_review line=4. Create directory structure: {spec_base_path:.claude/specs}/{feature_name}/`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:48 pattern=feature context=needs_manual_review line=First, generate an initial set of requirements in EARS format based on the feature idea, then iterate with the user to refine them until they are complete and accurate.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:51 pattern=Feature context=needs_manual_review line=### 2. Create Feature Design Document`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:53 pattern=feature context=needs_manual_review line=After the user approves the Requirements, you should develop a comprehensive design document based on the feature requirements, conducting necessary research during the design process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:88 pattern=feature context=needs_manual_review line=- The model SHOULD return to requirements clarification to prioritize features if needed`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:96 pattern=feature context=needs_manual_review line=- Creating a new spec (for a new feature that we don't have a spec for already)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:132 pattern=Feature context=needs_manual_review line=## Feature and sub agent mapping`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:134 pattern=Feature context=needs_manual_review line=| Feature                        | sub agent                           | path                                                         |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:136 pattern=feature context=needs_manual_review line=| Requirement Gathering          | spec-requirements(support parallel) | .claude/specs/{feature_name}/requirements.md                 |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:137 pattern=feature context=needs_manual_review line=| Create Feature Design Document | spec-design(support parallel)       | .claude/specs/{feature_name}/design.md                       |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:138 pattern=feature context=needs_manual_review line=| Create Task List               | spec-tasks(support parallel)        | .claude/specs/{feature_name}/tasks.md                        |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:154 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:155 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:170 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:185 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:200 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:201 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:207 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:216 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:247 pattern=feature context=needs_manual_review line=- After confirming the user's initial feature description, you MUST ask: "How many spec-requirements agents to use? (1-128)"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/system-prompts/spec-workflow-starter.md:293 pattern=feature context=needs_manual_review line=- Find and replace operations, including deleting all references to a specific feature, global renaming (such as variable names, function names), removing specific configuration items MUST be handled by main thread`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:98 pattern=trace context=likely_guard_or_diagnostic line=%% This ensures design consistency and traceability`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:103 pattern=feature context=needs_manual_review line=After the user approves the Requirements, you should develop a comprehensive design document based on the feature requirements, conducting necessary research during the design process.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:127 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/design.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:128 pattern=feature context=needs_manual_review line=- The model MUST identify areas where research is needed based on the feature requirements`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:131 pattern=feature context=needs_manual_review line=- The model MUST summarize key findings that will inform the feature design`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:133 pattern=feature context=needs_manual_review line=- The model MUST create a detailed design document at '.kiro/specs/{feature_name}/design.md'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:148 pattern=feature context=needs_manual_review line=- The model MUST ensure the design addresses all feature requirements identified during the clarification process`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-design.md:157 pattern=feature context=needs_manual_review line=- The model MUST offer to return to feature requirements clarification if gaps are identified during design`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-impl.md:13 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:14 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:15 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:24 pattern=feature context=needs_manual_review line=feature_name: test-feature`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:25 pattern=feature context=needs_manual_review line=feature_description: Test`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:27 pattern=feature context=needs_manual_review line=documents: .claude/specs/test-feature/requirements_v5.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:28 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v6.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:29 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v7.md,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:30 pattern=feature context=needs_manual_review line=.claude/specs/test-feature/requirements_v8.md`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:102 pattern=feature context=needs_manual_review line=- Requirements: Refer to user's original requirement description (feature_name, feature_description)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-judge.md:125 pattern=feature context=needs_manual_review line=- Generate final_document_path with a random 4-digit suffix (e.g., `.claude/specs/test-feature/requirements_v1234.md`)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:16 pattern=feature context=needs_manual_review line=- feature_description: Feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:40 pattern=feature context=needs_manual_review line=First, generate an initial set of requirements in EARS format based on the feature idea, then iterate with the user to refine them until they are complete and accurate.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:46 pattern=feature context=needs_manual_review line=1. Analyze the user's feature description`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:72 pattern=feature context=needs_manual_review line=- The directory '.claude/specs/{feature_name}' is already created by the main thread, DO NOT attempt to create this directory`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:73 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/requirements_{output_suffix}.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:76 pattern=feature context=needs_manual_review line=- A clear introduction section that summarizes the feature`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:78 pattern=feature context=needs_manual_review line=- A user story in the format "As a [role], I want [feature], so that [benefit]"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:93 pattern=feature context=needs_manual_review line=**User Story:** As a [role], I want [feature], so that [benefit]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-requirements.md:103 pattern=feature context=needs_manual_review line=**User Story:** As a [role], I want [feature], so that [benefit]`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-tasks.md:15 pattern=feature context=needs_manual_review line=- feature_name: Feature name (kebab-case)`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-tasks.md:82 pattern=feature context=needs_manual_review line=- The model MUST create a '.claude/specs/{feature_name}/tasks.md' file if it doesn't already exist`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-tasks.md:85 pattern=feature context=needs_manual_review line=- The model MUST create an implementation plan at '.claude/specs/{feature_name}/tasks.md'`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-tasks.md:89 pattern=feature context=needs_manual_review line=Convert the feature design into a series of prompts for a code-generation LLM that will implement each step in a test-driven manner. Prioritize best practices, incremental progress, and early testing, ensuring no big jum`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-tasks.md:104 pattern=feature context=needs_manual_review line=- The model MUST assume that all context documents (feature requirements, design) will be available during implementation`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-tasks.md:119 pattern=feature context=needs_manual_review line=- Tasks should be scoped to specific coding activities (e.g., "Implement X function" rather than "Support X feature")`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-tasks.md:137 pattern=feature context=needs_manual_review line=**This workflow is ONLY for creating design and planning artifacts. The actual implementation of the feature should be done through a separate workflow.**`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-tasks.md:139 pattern=feature context=needs_manual_review line=- The model MUST NOT attempt to implement the feature as part of this workflow`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-test.md:7 pattern=feature context=needs_manual_review line=You are a professional test and acceptance expert. Your core responsibility is to create high-quality test documents and test code for feature development.`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-test.md:9 pattern=feature context=needs_manual_review line=You are responsible for providing complete, executable initial test code, ensuring correct syntax and clear logic. Users will collaborate with the main thread for cross-validation, and your test code will serve as an imp`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-test.md:17 pattern=feature context=needs_manual_review line=- feature_name: Feature name`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] docs/.claude/agents/kfc/spec-test.md:39 pattern=Feature context=needs_manual_review line=| Case ID | Feature Description | Test Type     |`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/.export_for_chatgpt_mtimes.json:96 pattern=legacy context=likely_guard_or_diagnostic line="app/utils/legacy_cleanup.py": 1779614419.980555,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/.export_for_chatgpt_mtimes.json:97 pattern=legacy context=likely_guard_or_diagnostic line="app/utils/legacy_fields.py": 1779615321.196801,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/.export_for_chatgpt_mtimes.json:109 pattern=trace context=likely_guard_or_diagnostic line="app/utils/trace_log.py": 1779297917.8278606,`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:21948 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779618275763-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:21960 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": true, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": "", "page_instance_id": "page-1779615917102-94fs", "session_id": "ff66ec92-93f6-4e4d-95f8-af2`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:21962 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779618275763-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:21974 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": true, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": "", "page_instance_id": "page-1779615917102-94fs", "session_id": "ff66ec92-93f6-4e4d-95f8-af2`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:21984 pattern=trace context=likely_guard_or_diagnostic line=json={"acked_at": null, "bind_request_id": null, "bootstrap_conversation": true, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": null, "created_at": 1779618275.777114, "delivered_at": null, "delivered_to"`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22023 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779618294783-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22035 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "好的", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", "sess`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22037 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779618294783-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22049 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "好的", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", "sess`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22059 pattern=trace context=likely_guard_or_diagnostic line=json={"acked_at": null, "bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "好的", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "created_at": 1779618294.814366, "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22098 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779622610652-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22110 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", "sess`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22112 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779622610652-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22124 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", "sess`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22134 pattern=trace context=likely_guard_or_diagnostic line=json={"acked_at": null, "bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "created_at": 1779622610.689826, "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22173 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779622629416-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22185 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你在说什么呀？", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", `
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22187 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779622629416-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22199 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你在说什么呀？", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", `
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22209 pattern=trace context=likely_guard_or_diagnostic line=json={"acked_at": null, "bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你在说什么呀？", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "created_at": 1779622629.4550`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22286 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779633825331-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22298 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", "sess`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22300 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779633825331-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22312 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", "sess`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22322 pattern=trace context=likely_guard_or_diagnostic line=json={"acked_at": null, "bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "你好", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "created_at": 1779633825.3710215, `
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22361 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779633853807-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22373 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "好的，我知道", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22375 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779633853807-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22387 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "好的，我知道", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779615917102-94fs", "`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22397 pattern=trace context=likely_guard_or_diagnostic line=json={"acked_at": null, "bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-yp54gamn", "content": "好的，我知道", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "created_at": 1779633853.84146`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22436 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779633941135-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22448 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-uayqwku0", "content": "511", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779631098805-ky8o", "ses`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22450 pattern=trace context=likely_guard_or_diagnostic line=trace_id=send-1779633941135-ff66ec92…`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22462 pattern=trace context=likely_guard_or_diagnostic line=json={"bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-uayqwku0", "content": "511", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "page_instance_id": "page-1779631098805-ky8o", "ses`
- `feature_flag_dead_code_candidates`: `[FEATURE_FLAG_CANDIDATE] exports/for_chatgpt/0_export_logs_for_chatgpt.txt:22472 pattern=trace context=likely_guard_or_diagnostic line=json={"acked_at": null, "bind_request_id": null, "bootstrap_conversation": false, "client_id": "tm-uayqwku0", "content": "511", "conversation_id": "6a12d1e8-057c-83a4-bf3c-01dde3ea79e8", "created_at": 1779633941.1759644,`
- `api_route_usage_candidates`: `[UNUSED_ROUTE_CANDIDATE] app/server/core_routes.py:88 path=/health`

## Low Priority / Informational Candidates

- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/client/__init__.py:4 local=BridgeApiError source=app.client.bridge_client.BridgeApiError kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/client/__init__.py:4 local=BridgeClient source=app.client.bridge_client.BridgeClient kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:3 local=CursorCodeConfig source=app.cursor_code.config.CursorCodeConfig kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:3 local=resolve_template_root source=app.cursor_code.config.resolve_template_root kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:4 local=get_cursor_code_pause_reason source=app.cursor_code.runtime.get_cursor_code_pause_reason kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:4 local=is_cursor_code_paused source=app.cursor_code.runtime.is_cursor_code_paused kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:4 local=pause_all_for_cursor_upgrade source=app.cursor_code.runtime.pause_all_for_cursor_upgrade kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:4 local=resume_after_cursor_upgrade source=app.cursor_code.runtime.resume_after_cursor_upgrade kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:14 local=BridgeQueueFullError source=app.server.state.BridgeQueueFullError kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:15 local=validate_outbound_queue_message source=app.utils.bridge_payload.validate_outbound_queue_message kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:26 local=get_server_bind_host source=app.server.runtime_state.get_server_bind_host kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:26 local=get_server_port source=app.server.runtime_state.get_server_port kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:26 local=get_server_public_host source=app.server.runtime_state.get_server_public_host kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:26 local=is_debug_mode source=app.server.runtime_state.is_debug_mode kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_focused_tm_page source=app.server.state._last_focused_tm_page kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_focused_tm_page_at source=app.server.state._last_focused_tm_page_at kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_poll_empty_log_at source=app.server.state._last_poll_empty_log_at kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_poll_identity source=app.server.state._last_poll_identity kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_poll_other_reason_log_at source=app.server.state._last_poll_other_reason_log_at kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_poll_summaries source=app.server.state._poll_summaries kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_server_instance_id source=app.server.state._server_instance_id kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_server_start_time source=app.server.state._server_start_time kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/tm_page_registry.py:4 local=time source=time kind=import`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/tm_page_registry.py:8 local=get_page_liveness source=app.utils.page_status.get_page_liveness kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/tm_page_registry.py:19 local=_format_time source=app.server.runtime_state._format_time kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/tm_page_registry.py:19 local=_notify_status source=app.server.runtime_state._notify_status kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=complete_gui_dispatch source=app.server.runtime_state.complete_gui_dispatch kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=create_app source=app.server.runtime_state.create_app kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_bind_host source=app.server.runtime_state.get_server_bind_host kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_bridge_url source=app.server.runtime_state.get_server_bridge_url kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_port source=app.server.runtime_state.get_server_port kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_public_host source=app.server.runtime_state.get_server_public_host kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_url source=app.server.runtime_state.get_server_url kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=is_debug_mode source=app.server.runtime_state.is_debug_mode kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=is_server_running source=app.server.runtime_state.is_server_running kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=set_debug_mode source=app.server.runtime_state.set_debug_mode kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=set_external_gui_dispatch source=app.server.runtime_state.set_external_gui_dispatch kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=set_log_callback source=app.server.runtime_state.set_log_callback kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=set_status_callback source=app.server.runtime_state.set_status_callback kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=start_server source=app.server.runtime_state.start_server kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=stop_server source=app.server.runtime_state.stop_server kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=cancel_message source=app.server.message_queue.cancel_message kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=get_bridge_message_id source=app.server.message_queue.get_bridge_message_id kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=get_bridge_status source=app.server.message_queue.get_bridge_status kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=get_message_state source=app.server.message_queue.get_message_state kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=push_message source=app.server.message_queue.push_message kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:31 local=get_tm_online_summary source=app.server.tm_page_registry.get_tm_online_summary kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=close_chatgpt_pages source=app.server.control_commands.close_chatgpt_pages kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=enqueue_control_command source=app.server.control_commands.enqueue_control_command kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=push_close_bound_page source=app.server.control_commands.push_close_bound_page kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=push_close_other_pages source=app.server.control_commands.push_close_other_pages kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=push_close_page source=app.server.control_commands.push_close_page kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=push_open_url source=app.server.control_commands.push_open_url kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:40 local=_parse_hotkey_for_pyautogui source=app.server.system_hotkey._parse_hotkey_for_pyautogui kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/status_scheduler.py:5 local=Optional source=typing.Optional kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/bind_runtime.py:5 local=field source=dataclasses.field kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/bridge_payload.py:9 local=List source=typing.List kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/bridge_payload.py:9 local=Tuple source=typing.Tuple kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/bridge_payload.py:13 local=LEGACY_FIELD_NAMES source=app.utils.legacy_cleanup.LEGACY_FIELD_NAMES kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:6 local=field source=dataclasses.field kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=binding_from_session source=app.utils.page_snapshot.binding_from_session kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=bridge_status_online source=app.utils.page_snapshot.bridge_status_online kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=page_display_id_sort_key source=app.utils.page_snapshot.page_display_id_sort_key kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=page_display_ids_for_log source=app.utils.page_snapshot.page_display_ids_for_log kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=pages_from_bridge_status source=app.utils.page_snapshot.pages_from_bridge_status kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=sort_pages_by_display_id source=app.utils.page_snapshot.sort_pages_by_display_id kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=status_pages_token source=app.utils.page_snapshot.status_pages_token kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/send_plan.py:5 local=field source=dataclasses.field kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/utils/send_plan.py:6 local=Optional source=typing.Optional kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:24 local=ASSISTANT_WAIT_TEXTS source=app.constants.ASSISTANT_WAIT_TEXTS kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:24 local=PENDING_ASSISTANT_STATUSES source=app.constants.PENDING_ASSISTANT_STATUSES kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:31 local=BIND_STATE_BOUND_OFFLINE source=app.models.BIND_STATE_BOUND_OFFLINE kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:46 local=build_gui_push_payload source=app.utils.bridge_payload.build_gui_push_payload kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:51 local=QTableWidgetItem source=PyQt5.QtWidgets.QTableWidgetItem kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:4 local=traceback source=traceback kind=import`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:9 local=BIND_MODE_PAGE_CHANNEL source=app.models.BIND_MODE_PAGE_CHANNEL kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:11 local=PageSnapshot source=app.utils.page_status.PageSnapshot kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:17 local=evaluate_page_capability source=app.utils.page_status.evaluate_page_capability kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:17 local=normalize_page source=app.utils.page_status.normalize_page kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:8 local=build_page_key source=app.utils.page_status.build_page_key kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:8 local=explain_page_decision source=app.utils.page_status.explain_page_decision kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:21 local=remote_binding_active source=app.models.remote_binding_active kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_sync_mixin.py:11 local=Optional source=typing.Optional kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_sync_mixin.py:13 local=ASSISTANT_WAIT_TEXTS source=app.constants.ASSISTANT_WAIT_TEXTS kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_sync_mixin.py:16 local=BIND_STATE_WAITING_HOME source=app.models.BIND_STATE_WAITING_HOME kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_sync_mixin.py:27 local=explain_page_decision source=app.utils.page_status.explain_page_decision kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:25 local=evaluate_send_page source=app.utils.page_status.evaluate_send_page kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:25 local=is_page_url_syncable source=app.utils.page_status.is_page_url_syncable kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:43 local=tm_send_allowed source=app.utils.tm_activity.tm_send_allowed kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/send_flow_mixin.py:18 local=BIND_STATE_TEMP_HOME_BOUND source=app.models.BIND_STATE_TEMP_HOME_BOUND kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/send_flow_mixin.py:18 local=BIND_STATE_UNBOUND source=app.models.BIND_STATE_UNBOUND kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/send_flow_mixin.py:18 local=default_remote_chatgpt source=app.models.default_remote_chatgpt kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/send_flow_mixin.py:31 local=parse_conversation_id source=app.url_utils.parse_conversation_id kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/settings_mixin.py:1 local=get_server_url source=app.server.get_server_url kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/settings_mixin.py:10 local=time source=time kind=import`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/tm_page_selector_format_mixin.py:9 local=page_url_from source=app.utils.page_status.page_url_from kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_builder_core_mixin.py:2 local=traceback source=traceback kind=import`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_builder_core_mixin.py:4 local=Qt source=PyQt5.QtCore.Qt kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_chat_panel_mixin.py:6 local=ElidedLabel source=app.ui.widgets.elided_label.ElidedLabel kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:5 local=traceback source=traceback kind=import`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:8 local=is_page_online source=app.utils.page_status.is_page_online kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:20 local=QTimer source=PyQt5.QtCore.QTimer kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:22 local=QWidget source=PyQt5.QtWidgets.QWidget kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_settings_page_mixin.py:5 local=QGroupBox source=PyQt5.QtWidgets.QGroupBox kind=from`
- `python_dead_statements`: `[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/waiting_timer_mixin.py:7 local=PENDING_ASSISTANT_STATUSES source=app.constants.PENDING_ASSISTANT_STATUSES kind=from`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] 0_merged_for_chatgpt.txt category=historical_export_or_backup_candidate size=3699434`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] 0_merged_for_chatgpt.zip category=historical_export_or_backup_candidate size=892282`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] client.user.js category=generated_runtime_artifact_keep size=1689356`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/.gitignore category=generated_or_cache_dir_candidate size=39`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/CACHEDIR.TAG category=generated_or_cache_dir_candidate size=191`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/README.md category=generated_or_cache_dir_candidate size=310`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .ruff_cache/.gitignore category=generated_or_cache_dir_candidate size=35`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .ruff_cache/CACHEDIR.TAG category=generated_or_cache_dir_candidate size=43`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] cursor_templates/README.md category=historical_export_or_backup_candidate size=347`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.gitkeep category=generated_or_cache_dir_candidate size=0`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/bridge_json.log category=generated_or_cache_dir_candidate size=351926821`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/chat_sessions.json category=generated_or_cache_dir_candidate size=43644`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/chat_sessions.json.bak1 category=generated_or_cache_dir_candidate size=29328`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/chat_sessions.json.bak2 category=generated_or_cache_dir_candidate size=28845`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/chat_sessions.json.bak3 category=generated_or_cache_dir_candidate size=21616`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/server_url.txt category=generated_or_cache_dir_candidate size=23`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] tests/test_reset_placeholder_sync.py category=historical_export_or_backup_candidate size=3057`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] tests/test_temp_home_send_plan.py category=historical_export_or_backup_candidate size=3942`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/v/cache/lastfailed category=generated_or_cache_dir_candidate size=13880`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/v/cache/nodeids category=generated_or_cache_dir_candidate size=63475`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/v/cache/stepwise category=generated_or_cache_dir_candidate size=2`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] .ruff_cache/0.15.12/10709481105125173075 category=generated_or_cache_dir_candidate size=425`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] app/cursor_code/templates.py category=historical_export_or_backup_candidate size=4242`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] app/ui/mixins/_ui_builder_mixin_monolith.py.bak category=temporary_or_backup_file_candidate size=115270`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] chatgpt-toolbox/dist/client.user.js category=generated_runtime_artifact_keep size=1689356`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] exports/for_chatgpt/0_merged_for_chatgpt_export_metadata.txt category=historical_export_or_backup_candidate size=624`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/settings/kfc-settings.json category=generated_or_cache_dir_candidate size=363`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/system-prompts/spec-workflow-starter.md category=generated_or_cache_dir_candidate size=16077`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-design.md category=generated_or_cache_dir_candidate size=5896`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-impl.md category=generated_or_cache_dir_candidate size=1641`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-judge.md category=generated_or_cache_dir_candidate size=4395`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-requirements.md category=generated_or_cache_dir_candidate size=5340`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-system-prompt-loader.md category=generated_or_cache_dir_candidate size=1619`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-tasks.md category=generated_or_cache_dir_candidate size=9214`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-test.md category=generated_or_cache_dir_candidate size=3592`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/logs/log.txt.1 category=generated_or_cache_dir_candidate size=5242850`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/logs/log.txt.2 category=generated_or_cache_dir_candidate size=5242809`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/logs/log.txt.3 category=generated_or_cache_dir_candidate size=5242811`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/settings/kfc-settings.json category=generated_or_cache_dir_candidate size=363`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/system-prompts/spec-workflow-starter.md category=generated_or_cache_dir_candidate size=16077`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-design.md category=generated_or_cache_dir_candidate size=5896`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-impl.md category=generated_or_cache_dir_candidate size=1641`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-judge.md category=generated_or_cache_dir_candidate size=4395`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-requirements.md category=generated_or_cache_dir_candidate size=5340`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-system-prompt-loader.md category=generated_or_cache_dir_candidate size=1619`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-tasks.md category=generated_or_cache_dir_candidate size=9214`
- `dead_artifact_files`: `[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-test.md category=generated_or_cache_dir_candidate size=3592`

## Raw Scanner Output

### dead_code_candidates

```text
[DEAD_CODE_CANDIDATE_SCAN][START]
files=108

[OLD_STATUS_FIELD]
- app/server/cursor_api.py contains ["status"]
- app/server/external_routes.py contains ["status"]

[DEPRECATED_OR_COMPAT_PATTERN]
- app/constants.py contains status_chip_text
- app/models.py contains remote_binding_enabled
- app/utils/bridge_payload.py contains last_page_url
- app/utils/bridge_payload.py contains conversation_url
- app/utils/legacy_fields.py contains last_page_url
- app/utils/legacy_fields.py contains conversation_url
- app/utils/page_binding_identity.py contains remote_binding_enabled
- app/utils/page_status.py contains last_page_url
- app/utils/page_status.py contains conversation_url
- app/utils/page_status.py contains remote_binding_enabled
- app/ui/mixins/bridge_mixin.py contains conversation_url
- app/ui/mixins/bridge_mixin.py contains remote_binding_enabled
- app/ui/mixins/external_api_gui_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_auto_bind_mixin.py contains conversation_url
- app/ui/mixins/page_auto_bind_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_binding_diagnostics_mixin.py contains conversation_url
- app/ui/mixins/page_binding_diagnostics_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_binding_display_mixin.py contains conversation_url
- app/ui/mixins/page_binding_display_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_binding_display_mixin.py contains status_chip_text
- app/ui/mixins/page_binding_state_mixin.py contains conversation_url
- app/ui/mixins/page_binding_state_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_bind_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_open_close_mixin.py contains conversation_url
- app/ui/mixins/page_open_close_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_registry_refresh_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_selector_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_send_target_mixin.py contains conversation_url
- app/ui/mixins/page_send_target_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_sync_mixin.py contains conversation_url
- app/ui/mixins/page_sync_mixin.py contains remote_binding_enabled
- app/ui/mixins/page_tm_client_mixin.py contains conversation_url
- app/ui/mixins/page_tm_client_mixin.py contains remote_binding_enabled
- app/ui/mixins/send_flow_mixin.py contains remote_binding_enabled
- app/ui/mixins/session_mixin.py contains conversation_url
- app/ui/mixins/session_mixin.py contains remote_binding_enabled
- app/ui/mixins/ui_status_compact_mixin.py contains remote_binding_enabled
- app/ui/mixins/ui_status_compact_mixin.py contains status_chip_text

[PYTHON_DEF_SINGLE_OCCURRENCE]
- app/constants.py:41 FunctionDef is_chatgpt_platform_error_text occurrence=1
- app/models.py:592 FunctionDef mark_waiting_placeholder_failed occurrence=1
- app/client/bridge_client.py:729 FunctionDef create_session occurrence=1
- app/client/bridge_client.py:745 FunctionDef get_session occurrence=1
- app/client/bridge_client.py:760 FunctionDef bind_session occurrence=1
- app/cursor_code/matcher.py:50 FunctionDef normalize_match_dict occurrence=1
- app/server/runtime_state.py:19 FunctionDef log_request occurrence=1
- app/ui/main_window.py:173 FunctionDef closeEvent occurrence=1
- app/utils/gui_logging.py:233 FunctionDef should_emit_log occurrence=1
- app/utils/log_utils.py:110 FunctionDef get_log_runtime_options occurrence=1
- app/utils/log_utils.py:120 FunctionDef set_log_min_level occurrence=1
- app/utils/log_utils.py:320 FunctionDef read_last_lines occurrence=1
- app/utils/page_identity.py:42 FunctionDef has_page_channel occurrence=1
- app/utils/page_identity.py:48 FunctionDef display_key occurrence=1
- app/ui/mixins/bridge_mixin.py:157 FunctionDef _enqueue_upload_then_send_command occurrence=1
- app/ui/mixins/bridge_mixin.py:880 FunctionDef _trigger_upload_for_current_bound_page occurrence=1
- app/ui/mixins/bridge_mixin.py:1035 FunctionDef _make_tm_clients_signature occurrence=1
- app/ui/mixins/bridge_mixin.py:1184 FunctionDef _render_status_summary occurrence=1
- app/ui/mixins/bridge_mixin.py:2417 FunctionDef _stop_server occurrence=1
- app/ui/mixins/conversation_stats_mixin.py:113 FunctionDef _normalize_message_role occurrence=1
- app/ui/mixins/cursor_bridge_mixin.py:706 FunctionDef _on_send_to_cursor_clicked occurrence=1
- app/ui/mixins/page_auto_bind_mixin.py:70 FunctionDef _apply_remote_and_runtime occurrence=1
- app/ui/mixins/page_auto_bind_mixin.py:459 FunctionDef _recent_focus_home_client_id occurrence=1
- app/ui/mixins/page_auto_bind_mixin.py:1248 FunctionDef _selected_home_usable_for_first_send occurrence=1
- app/ui/mixins/page_auto_bind_mixin.py:2351 FunctionDef _candidate_matches_remote occurrence=1
- app/ui/mixins/page_binding_diagnostics_mixin.py:21 FunctionDef _log_send_bind_check occurrence=1
- app/ui/mixins/page_binding_diagnostics_mixin.py:150 FunctionDef _log_bind_auto_rebind occurrence=1
- app/ui/mixins/page_binding_diagnostics_mixin.py:526 FunctionDef _sync_target_unavailable_reason_text occurrence=1
- app/ui/mixins/page_binding_display_mixin.py:68 FunctionDef _bool_alias_value occurrence=1
- app/ui/mixins/page_binding_display_mixin.py:125 FunctionDef _page_identity_text occurrence=1
- app/ui/mixins/page_binding_state_mixin.py:123 FunctionDef _gc_orphan_bindings occurrence=1
- app/ui/mixins/page_binding_state_mixin.py:440 FunctionDef _update_session_binding_from_normalized_page occurrence=1
- app/ui/mixins/page_bind_mixin.py:155 FunctionDef _resolve_manual_bind_candidate occurrence=1
- app/ui/mixins/page_bind_mixin.py:766 FunctionDef request_send_message occurrence=1
- app/ui/mixins/page_open_close_mixin.py:61 FunctionDef _auto_open_url_once occurrence=1
- app/ui/mixins/page_open_close_mixin.py:326 FunctionDef _on_open_bound_chatgpt_page occurrence=1
- app/ui/mixins/page_open_close_mixin.py:404 FunctionDef _tm_table_signature occurrence=1
- app/ui/mixins/page_open_close_mixin.py:451 FunctionDef _page_list_refresh_metrics occurrence=1
- app/ui/mixins/page_open_close_mixin.py:504 FunctionDef _on_close_selected_tm_page occurrence=1
- app/ui/mixins/page_open_close_mixin.py:664 FunctionDef _on_close_current_bound_tm_page occurrence=1
- app/ui/mixins/page_selector_mixin.py:17 FunctionDef _extract_chatgpt_conversation_id_from_url occurrence=1
- app/ui/mixins/page_selector_mixin.py:274 FunctionDef _get_page_combo_selection_ids occurrence=1
- app/ui/mixins/page_selector_mixin.py:288 FunctionDef _sync_tm_page_combo_selection occurrence=1
- app/ui/mixins/page_selector_mixin.py:292 FunctionDef _on_bind_selected_tm_page occurrence=1
- app/ui/mixins/page_selector_mixin.py:337 FunctionDef _current_focused_tm_page occurrence=1
- app/ui/mixins/page_send_target_mixin.py:192 FunctionDef _bound_page_usable_for_action occurrence=1
- app/ui/mixins/page_send_target_mixin.py:322 FunctionDef _explain_page_decision_for_session occurrence=1
- app/ui/mixins/page_send_target_mixin.py:347 FunctionDef _log_action_target_bound_check occurrence=1
- app/ui/mixins/page_send_target_mixin.py:394 FunctionDef _log_action_target_mismatch occurrence=1
- app/ui/mixins/page_send_target_mixin.py:431 FunctionDef _log_action_target_fallback occurrence=1
- app/ui/mixins/page_send_target_mixin.py:1009 FunctionDef _is_sendable_chatgpt_client occurrence=1
- app/ui/mixins/page_send_target_mixin.py:1149 FunctionDef _session_bound_page_online occurrence=1
- app/ui/mixins/page_send_target_mixin.py:1365 FunctionDef _preferred_open_url_for_session occurrence=1
- app/ui/mixins/page_send_target_mixin.py:1503 FunctionDef _binding_status_details occurrence=1
- app/ui/mixins/page_send_target_mixin.py:1590 FunctionDef _same_conversation_fallback_enabled occurrence=1
- app/ui/mixins/page_sync_mixin.py:89 FunctionDef _build_sync_target_snapshot_from_decision occurrence=1
- app/ui/mixins/page_sync_mixin.py:2219 FunctionDef _build_bound_sync_target_payload occurrence=1
- app/ui/mixins/page_sync_mixin.py:2652 FunctionDef _is_protected_local_message occurrence=1
- app/ui/mixins/page_sync_mixin.py:2934 FunctionDef _check_web_sync_timeout occurrence=1
- app/ui/mixins/page_sync_mixin.py:3063 FunctionDef _schedule_auto_sync_conversation occurrence=1
- app/ui/mixins/page_tm_client_mixin.py:123 FunctionDef _classify_page_state occurrence=1
- app/ui/mixins/page_tm_client_mixin.py:1042 FunctionDef _short_page_display occurrence=1
- app/ui/mixins/page_tm_client_mixin.py:1453 FunctionDef build_monkey_binding_summary_text occurrence=1
- app/ui/mixins/session_mixin.py:180 FunctionDef _render_pending_chat_if_needed occurrence=1
- app/ui/mixins/session_mixin.py:1764 FunctionDef _clear_current_session_messages_before_rebind_or_sync occurrence=1
- app/ui/mixins/settings_mixin.py:88 FunctionDef _qsettings_bool occurrence=1
- app/ui/mixins/ui_chat_panel_mixin.py:208 FunctionDef _save_chat_splitter_sizes occurrence=1
- app/ui/mixins/ui_chat_panel_mixin.py:241 FunctionDef _sync_bridge_status_panel_height occurrence=1
- app/ui/mixins/ui_page_selector_mixin.py:123 FunctionDef _full_bridge_status_for_page_selector occurrence=1
- app/ui/mixins/ui_page_selector_mixin.py:234 FunctionDef _build_tm_action_buttons occurrence=1
- app/ui/mixins/ui_status_compact_mixin.py:26 FunctionDef _short_id occurrence=1
- app/ui/mixins/ui_status_compact_mixin.py:34 FunctionDef _shorten_url_for_combo occurrence=1
- app/ui/mixins/ui_status_compact_mixin.py:406 FunctionDef _format_compact_tm_online_chip_verbose occurrence=1
- app/ui/mixins/ui_status_compact_mixin.py:413 FunctionDef _format_compact_session_bind_chip occurrence=1
- app/ui/mixins/ui_status_compact_mixin.py:696 FunctionDef _format_compact_page_combo_tooltip occurrence=1
- app/ui/mixins/waiting_timer_mixin.py:104 FunctionDef _restore_waiting_timers_after_load occurrence=1
- app/ui/mixins/waiting_timer_mixin.py:343 FunctionDef _refresh_session_list_item_waiting_text occurrence=1
- app/ui/widgets/no_wheel_combo_box.py:10 FunctionDef wheelEvent occurrence=1
- app/ui/widgets/session_list_item.py:293 FunctionDef update_subtitle_fast occurrence=1

[NOTE]
以上只是候选清单，不能自动删除。Qt 信号、Flask 路由、getattr、字符串动态调用都可能导致误判。删除前请先运行: python tools/find_dynamic_reference_entries.py
已排除构建产物扫描: client.user.js、dist/**、build/**、runtime/**、logs/** 等。油猴请改 chatgpt-toolbox/tampermonkey-userscript-src/ 后 npm run build。

```

### python_dead_statements

```text
[PY_DEAD_STATEMENTS][START]
[UNUSED_IMPORT_CANDIDATE] app/client/__init__.py:4 local=BridgeApiError source=app.client.bridge_client.BridgeApiError kind=from
[UNUSED_IMPORT_CANDIDATE] app/client/__init__.py:4 local=BridgeClient source=app.client.bridge_client.BridgeClient kind=from
[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:3 local=CursorCodeConfig source=app.cursor_code.config.CursorCodeConfig kind=from
[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:3 local=resolve_template_root source=app.cursor_code.config.resolve_template_root kind=from
[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:4 local=get_cursor_code_pause_reason source=app.cursor_code.runtime.get_cursor_code_pause_reason kind=from
[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:4 local=is_cursor_code_paused source=app.cursor_code.runtime.is_cursor_code_paused kind=from
[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:4 local=pause_all_for_cursor_upgrade source=app.cursor_code.runtime.pause_all_for_cursor_upgrade kind=from
[UNUSED_IMPORT_CANDIDATE] app/cursor_code/__init__.py:4 local=resume_after_cursor_upgrade source=app.cursor_code.runtime.resume_after_cursor_upgrade kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:14 local=BridgeQueueFullError source=app.server.state.BridgeQueueFullError kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:15 local=validate_outbound_queue_message source=app.utils.bridge_payload.validate_outbound_queue_message kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:26 local=get_server_bind_host source=app.server.runtime_state.get_server_bind_host kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:26 local=get_server_port source=app.server.runtime_state.get_server_port kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:26 local=get_server_public_host source=app.server.runtime_state.get_server_public_host kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:26 local=is_debug_mode source=app.server.runtime_state.is_debug_mode kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_focused_tm_page source=app.server.state._last_focused_tm_page kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_focused_tm_page_at source=app.server.state._last_focused_tm_page_at kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_poll_empty_log_at source=app.server.state._last_poll_empty_log_at kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_poll_identity source=app.server.state._last_poll_identity kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_last_poll_other_reason_log_at source=app.server.state._last_poll_other_reason_log_at kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_poll_summaries source=app.server.state._poll_summaries kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_server_instance_id source=app.server.state._server_instance_id kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/message_queue.py:51 local=_server_start_time source=app.server.state._server_start_time kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/tm_page_registry.py:4 local=time source=time kind=import
[UNUSED_IMPORT_CANDIDATE] app/server/tm_page_registry.py:8 local=get_page_liveness source=app.utils.page_status.get_page_liveness kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/tm_page_registry.py:19 local=_format_time source=app.server.runtime_state._format_time kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/tm_page_registry.py:19 local=_notify_status source=app.server.runtime_state._notify_status kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=complete_gui_dispatch source=app.server.runtime_state.complete_gui_dispatch kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=create_app source=app.server.runtime_state.create_app kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_bind_host source=app.server.runtime_state.get_server_bind_host kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_bridge_url source=app.server.runtime_state.get_server_bridge_url kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_port source=app.server.runtime_state.get_server_port kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_public_host source=app.server.runtime_state.get_server_public_host kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=get_server_url source=app.server.runtime_state.get_server_url kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=is_debug_mode source=app.server.runtime_state.is_debug_mode kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=is_server_running source=app.server.runtime_state.is_server_running kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=set_debug_mode source=app.server.runtime_state.set_debug_mode kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=set_external_gui_dispatch source=app.server.runtime_state.set_external_gui_dispatch kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=set_log_callback source=app.server.runtime_state.set_log_callback kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=set_status_callback source=app.server.runtime_state.set_status_callback kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=start_server source=app.server.runtime_state.start_server kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:7 local=stop_server source=app.server.runtime_state.stop_server kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=cancel_message source=app.server.message_queue.cancel_message kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=get_bridge_message_id source=app.server.message_queue.get_bridge_message_id kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=get_bridge_status source=app.server.message_queue.get_bridge_status kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=get_message_state source=app.server.message_queue.get_message_state kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:24 local=push_message source=app.server.message_queue.push_message kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:31 local=get_tm_online_summary source=app.server.tm_page_registry.get_tm_online_summary kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=close_chatgpt_pages source=app.server.control_commands.close_chatgpt_pages kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=enqueue_control_command source=app.server.control_commands.enqueue_control_command kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=push_close_bound_page source=app.server.control_commands.push_close_bound_page kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=push_close_other_pages source=app.server.control_commands.push_close_other_pages kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=push_close_page source=app.server.control_commands.push_close_page kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:32 local=push_open_url source=app.server.control_commands.push_open_url kind=from
[UNUSED_IMPORT_CANDIDATE] app/server/__init__.py:40 local=_parse_hotkey_for_pyautogui source=app.server.system_hotkey._parse_hotkey_for_pyautogui kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/status_scheduler.py:5 local=Optional source=typing.Optional kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/bind_runtime.py:5 local=field source=dataclasses.field kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/bridge_payload.py:9 local=List source=typing.List kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/bridge_payload.py:9 local=Tuple source=typing.Tuple kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/bridge_payload.py:13 local=LEGACY_FIELD_NAMES source=app.utils.legacy_cleanup.LEGACY_FIELD_NAMES kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:6 local=field source=dataclasses.field kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=binding_from_session source=app.utils.page_snapshot.binding_from_session kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=bridge_status_online source=app.utils.page_snapshot.bridge_status_online kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=page_display_id_sort_key source=app.utils.page_snapshot.page_display_id_sort_key kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=page_display_ids_for_log source=app.utils.page_snapshot.page_display_ids_for_log kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=pages_from_bridge_status source=app.utils.page_snapshot.pages_from_bridge_status kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=sort_pages_by_display_id source=app.utils.page_snapshot.sort_pages_by_display_id kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/page_status.py:1183 local=status_pages_token source=app.utils.page_snapshot.status_pages_token kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/send_plan.py:5 local=field source=dataclasses.field kind=from
[UNUSED_IMPORT_CANDIDATE] app/utils/send_plan.py:6 local=Optional source=typing.Optional kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:24 local=ASSISTANT_WAIT_TEXTS source=app.constants.ASSISTANT_WAIT_TEXTS kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:24 local=PENDING_ASSISTANT_STATUSES source=app.constants.PENDING_ASSISTANT_STATUSES kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:31 local=BIND_STATE_BOUND_OFFLINE source=app.models.BIND_STATE_BOUND_OFFLINE kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:46 local=build_gui_push_payload source=app.utils.bridge_payload.build_gui_push_payload kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/bridge_mixin.py:51 local=QTableWidgetItem source=PyQt5.QtWidgets.QTableWidgetItem kind=from
[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1375 scope=module.ClassDef@47.FunctionDef@1270 node=Expr
[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1379 scope=module.ClassDef@47.FunctionDef@1270 node=Return
[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1375 scope=PageAutoBindMixin.FunctionDef@1270 node=Expr
[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1379 scope=PageAutoBindMixin.FunctionDef@1270 node=Return
[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1375 scope=_prepare_first_message_binding node=Expr
[UNREACHABLE_STATEMENT_CANDIDATE] app/ui/mixins/page_auto_bind_mixin.py:1379 scope=_prepare_first_message_binding node=Return
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_binding_diagnostics_mixin.py:4 local=traceback source=traceback kind=import
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_binding_state_mixin.py:9 local=BIND_MODE_PAGE_CHANNEL source=app.models.BIND_MODE_PAGE_CHANNEL kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:11 local=PageSnapshot source=app.utils.page_status.PageSnapshot kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:17 local=evaluate_page_capability source=app.utils.page_status.evaluate_page_capability kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_registry_refresh_mixin.py:17 local=normalize_page source=app.utils.page_status.normalize_page kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:8 local=build_page_key source=app.utils.page_status.build_page_key kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:8 local=explain_page_decision source=app.utils.page_status.explain_page_decision kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_send_target_mixin.py:21 local=remote_binding_active source=app.models.remote_binding_active kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_sync_mixin.py:11 local=Optional source=typing.Optional kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_sync_mixin.py:13 local=ASSISTANT_WAIT_TEXTS source=app.constants.ASSISTANT_WAIT_TEXTS kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_sync_mixin.py:16 local=BIND_STATE_WAITING_HOME source=app.models.BIND_STATE_WAITING_HOME kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_sync_mixin.py:27 local=explain_page_decision source=app.utils.page_status.explain_page_decision kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:25 local=evaluate_send_page source=app.utils.page_status.evaluate_send_page kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:25 local=is_page_url_syncable source=app.utils.page_status.is_page_url_syncable kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/page_tm_client_mixin.py:43 local=tm_send_allowed source=app.utils.tm_activity.tm_send_allowed kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/send_flow_mixin.py:18 local=BIND_STATE_TEMP_HOME_BOUND source=app.models.BIND_STATE_TEMP_HOME_BOUND kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/send_flow_mixin.py:18 local=BIND_STATE_UNBOUND source=app.models.BIND_STATE_UNBOUND kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/send_flow_mixin.py:18 local=default_remote_chatgpt source=app.models.default_remote_chatgpt kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/send_flow_mixin.py:31 local=parse_conversation_id source=app.url_utils.parse_conversation_id kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/settings_mixin.py:1 local=get_server_url source=app.server.get_server_url kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/settings_mixin.py:10 local=time source=time kind=import
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/tm_page_selector_format_mixin.py:9 local=page_url_from source=app.utils.page_status.page_url_from kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_builder_core_mixin.py:2 local=traceback source=traceback kind=import
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_builder_core_mixin.py:4 local=Qt source=PyQt5.QtCore.Qt kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_chat_panel_mixin.py:6 local=ElidedLabel source=app.ui.widgets.elided_label.ElidedLabel kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:5 local=traceback source=traceback kind=import
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:8 local=is_page_online source=app.utils.page_status.is_page_online kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:20 local=QTimer source=PyQt5.QtCore.QTimer kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_page_selector_mixin.py:22 local=QWidget source=PyQt5.QtWidgets.QWidget kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/ui_settings_page_mixin.py:5 local=QGroupBox source=PyQt5.QtWidgets.QGroupBox kind=from
[UNUSED_IMPORT_CANDIDATE] app/ui/mixins/waiting_timer_mixin.py:7 local=PENDING_ASSISTANT_STATUSES source=app.constants.PENDING_ASSISTANT_STATUSES kind=from
[PY_DEAD_STATEMENTS][DONE]
以上结果只是候选清单。动态导入、类型注解、插件注册、副作用 import 都可能导致误判，不能自动删除。

```

### orphan_python_modules

```text
[ORPHAN_MODULES][START]
[ORPHAN_PY_MODULE_CANDIDATE] app/core/job_scheduler.py module=app.core.job_scheduler
[ORPHAN_MODULES][DONE]
以上只是候选清单。动态 import、Flask 自动注册、Qt 动态加载、插件机制、字符串导入都可能导致误判，不能自动删除。

```

### js_dead_code_candidates

```text
D:\program\miniconda3\python.exe: can't open file 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\tools\\find_js_dead_code_candidates.py': [Errno 2] No such file or directory

```

### commented_dead_code_candidates

```text
D:\program\miniconda3\python.exe: can't open file 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\tools\\find_commented_dead_code_candidates.py': [Errno 2] No such file or directory

```

### dead_config_keys

```text
D:\program\miniconda3\python.exe: can't open file 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\tools\\find_dead_config_keys.py': [Errno 2] No such file or directory

```

### stale_tests_candidates

```text
[STALE_TESTS][START]
[STALE_TEST_CANDIDATE] tests/test_audit_convergence_flow.py:11 pattern=page_url context=possible_stale_behavior_test line=page_url_from,
[STALE_TEST_CANDIDATE] tests/test_audit_convergence_flow.py:111 pattern=page_url context=possible_stale_behavior_test line=def test_page_url_from_runtime_canonical_only():
[STALE_TEST_CANDIDATE] tests/test_audit_convergence_flow.py:112 pattern=page_url context=possible_stale_behavior_test line=assert page_url_from({"target_url": "https://chatgpt.com/c/x"}) == ""
[STALE_TEST_CANDIDATE] tests/test_audit_convergence_flow.py:113 pattern=page_url context=possible_stale_behavior_test line=assert page_url_from({"url": "https://chatgpt.com/c/x"}) == "https://chatgpt.com/c/x"
[STALE_TEST_CANDIDATE] tests/test_bridge_client_report.py:114 pattern=conversation_url context=possible_stale_behavior_test line=def test_chatgpt_home_and_conversation_url_capabilities():
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:17 pattern=page_url context=safe_guard_or_migration_test line=from app.utils.page_status import page_url_from
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:113 pattern=page_url context=safe_guard_or_migration_test line=def test_page_url_from_reads_url(self):
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:116 pattern=page_url context=safe_guard_or_migration_test line="tampermonkey_page_url": "https://legacy",
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:118 pattern=page_url context=safe_guard_or_migration_test line=self.assertEqual(page_url_from(status), "https://chatgpt.com/c/new")
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:120 pattern=page_url context=safe_guard_or_migration_test line=def test_page_url_from_ignores_tampermonkey_page_url(self):
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:121 pattern=page_url context=safe_guard_or_migration_test line=status = {"tampermonkey_page_url": "https://chatgpt.com/c/legacy"}
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:122 pattern=page_url context=safe_guard_or_migration_test line=self.assertEqual(page_url_from(status), "")
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:125 pattern=last_page_url context=safe_guard_or_migration_test line=settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/old"})
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:125 pattern=page_url context=safe_guard_or_migration_test line=settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/old"})
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:129 pattern=last_page_url context=possible_stale_behavior_test line=settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/stale"})
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:129 pattern=page_url context=possible_stale_behavior_test line=settings = _FakeSettings({"last_page_url": "https://chatgpt.com/c/stale"})
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:133 pattern=last_page_url context=possible_stale_behavior_test line=self.assertFalse(settings.contains("last_page_url"))
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:133 pattern=page_url context=possible_stale_behavior_test line=self.assertFalse(settings.contains("last_page_url"))
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:137 pattern=last_page_url context=possible_stale_behavior_test line="[MIGRATION_HIT]" in line and "old=last_page_url" in line
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:137 pattern=page_url context=possible_stale_behavior_test line="[MIGRATION_HIT]" in line and "old=last_page_url" in line
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:149 pattern=page_url context=safe_guard_or_migration_test line=def test_normalize_inbound_push_payload_rejects_legacy_page_url(self):
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:152 pattern=page_url context=safe_guard_or_migration_test line={"content": "hi", "page_url": "https://chatgpt.com/c/page"}
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:185 pattern=page_url context=possible_stale_behavior_test line=self.assertNotIn("target_page_url", sig.parameters)
[STALE_TEST_CANDIDATE] tests/test_bridge_payload.py:196 pattern=page_url context=possible_stale_behavior_test line="target_page_url",
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:16 pattern=request_id context=safe_guard_or_migration_test line=1. ``bridge_payload.validate_outbound_queue_message`` 在嵌套 ``payload.request_id``
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:16 pattern=payload.request_id context=safe_guard_or_migration_test line=1. ``bridge_payload.validate_outbound_queue_message`` 在嵌套 ``payload.request_id``
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:18 pattern=request_id context=safe_guard_or_migration_test line=与 ``payload.request_id``（由 ``assert_no_legacy_fields`` 深检触发）。
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:18 pattern=payload.request_id context=safe_guard_or_migration_test line=与 ``payload.request_id``（由 ``assert_no_legacy_fields`` 深检触发）。
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:19 pattern=request_id context=safe_guard_or_migration_test line=2. 不含 ``request_id`` 的 canonical 出站消息必须通过校验并返回规范化结果。
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:20 pattern=request_id context=safe_guard_or_migration_test line=3. 不得将 ``payload.request_id`` 加回白名单；上游漏字段应修同步流程，而非删除拦截。
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:20 pattern=payload.request_id context=safe_guard_or_migration_test line=3. 不得将 ``payload.request_id`` 加回白名单；上游漏字段应修同步流程，而非删除拦截。
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:48 pattern=request_id context=safe_guard_or_migration_test line=def test_validate_outbound_queue_message_rejects_payload_request_id():
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:49 pattern=request_id context=safe_guard_or_migration_test line=msg = _canonical_outbound_msg(request_id="legacy-request-id")
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:56 pattern=request_id context=safe_guard_or_migration_test line=assert "payload.request_id" in err
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:56 pattern=payload.request_id context=safe_guard_or_migration_test line=assert "payload.request_id" in err
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:59 pattern=request_id context=safe_guard_or_migration_test line=def test_validate_outbound_queue_message_accepts_current_fields_without_request_id():
[STALE_TEST_CANDIDATE] tests/test_bridge_payload_legacy_guard.py:78 pattern=request_id context=possible_stale_behavior_test line=assert "request_id" not in out["payload"]
[STALE_TEST_CANDIDATE] tests/test_chat_header_bound_page_id.py:64 pattern=conversation_url context=possible_stale_behavior_test line=def _remote_conversation_url(self, remote):
[STALE_TEST_CANDIDATE] tests/test_chat_header_bound_page_id.py:95 pattern=conversation_url context=possible_stale_behavior_test line="conversation_url": "https://chatgpt.com/c/6a10768a-de10-83a6-8b4d-629fec09c77a",
[STALE_TEST_CANDIDATE] tests/test_chat_header_bound_page_id.py:157 pattern=conversation_url context=possible_stale_behavior_test line="conversation_url": "https://chatgpt.com/c/abc",
[STALE_TEST_CANDIDATE] tests/test_chat_message_ui_status.py:55 pattern="status" context=possible_stale_behavior_test line=self.assertNotIn("status", data)
[STALE_TEST_CANDIDATE] tests/test_chat_message_ui_status.py:99 pattern="status" context=possible_stale_behavior_test line="status": "发送中",
[STALE_TEST_CANDIDATE] tests/test_deprecation_log.py:29 pattern=last_page_url context=safe_guard_or_migration_test line=old="last_page_url",
[STALE_TEST_CANDIDATE] tests/test_deprecation_log.py:29 pattern=page_url context=safe_guard_or_migration_test line=old="last_page_url",
[STALE_TEST_CANDIDATE] tests/test_deprecation_log.py:36 pattern=last_page_url context=possible_stale_behavior_test line=self.assertIn("old=last_page_url", message)
[STALE_TEST_CANDIDATE] tests/test_deprecation_log.py:36 pattern=page_url context=possible_stale_behavior_test line=self.assertIn("old=last_page_url", message)
[STALE_TEST_CANDIDATE] tests/test_field_aliases_parity.py:1 pattern=page_url context=possible_stale_behavior_test line="""Python page_url_from 与 client.user.js bridgeUrlFrom 均只读 canonical url。"""
[STALE_TEST_CANDIDATE] tests/test_field_aliases_parity.py:6 pattern=page_url context=possible_stale_behavior_test line=from app.utils.page_status import page_url_from as url_from
[STALE_TEST_CANDIDATE] tests/test_field_aliases_parity.py:25 pattern=page_url context=possible_stale_behavior_test line=assert "page_url" not in body
[STALE_TEST_CANDIDATE] tests/test_field_convergence_p1.py:151 pattern="status" context=safe_guard_or_migration_test line=assert "status" not in req
[STALE_TEST_CANDIDATE] tests/test_field_convergence_p1.py:152 pattern="status" context=safe_guard_or_migration_test line=legacy = {"status": "waiting", "request_status": "queued"}
[STALE_TEST_CANDIDATE] tests/test_field_convergence_p2.py:20 pattern=page_url context=safe_guard_or_migration_test line=from app.utils.page_status import page_url_from as url_from
[STALE_TEST_CANDIDATE] tests/test_field_convergence_p2.py:93 pattern="status" context=possible_stale_behavior_test line=stored["status"] = "waiting_chatgpt_reply"
[STALE_TEST_CANDIDATE] tests/test_field_convergence_p2.py:98 pattern="status" context=possible_stale_behavior_test line=assert "status" not in fetched
[STALE_TEST_CANDIDATE] tests/test_field_convergence_p2.py:100 pattern="status" context=possible_stale_behavior_test line=assert "status" not in (get_job(job_id) or {})
[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:18 pattern=request_id context=possible_stale_behavior_test line="bind_request_id",
[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:33 pattern=request_id context=possible_stale_behavior_test line="bind_request_id": "tok-abc",
[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:41 pattern=request_id context=possible_stale_behavior_test line=assert remote["bind_request_id"] == "tok-abc"
[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:75 pattern="status" context=safe_guard_or_migration_test line=for legacy in ("status", "source", "visible", "request_id", "text"):
[STALE_TEST_CANDIDATE] tests/test_field_uniformity_fixes.py:75 pattern=request_id context=safe_guard_or_migration_test line=for legacy in ("status", "source", "visible", "request_id", "text"):
[STALE_TEST_CANDIDATE] tests/test_job_scheduler_status_migration.py:26 pattern="status" context=possible_stale_behavior_test line=stored.pop("status", None)
[STALE_TEST_CANDIDATE] tests/test_job_scheduler_status_migration.py:55 pattern="status" context=possible_stale_behavior_test line=stored.pop("status", None)
[STALE_TEST_CANDIDATE] tests/test_legacy_cleanup.py:14 pattern="status" context=safe_guard_or_migration_test line={"content": "x", "id": "m1", "status": "queued"},
[STALE_TEST_CANDIDATE] tests/test_legacy_cleanup.py:82 pattern=page_url context=possible_stale_behavior_test line="page_url",
[STALE_TEST_CANDIDATE] tests/test_legacy_cleanup.py:87 pattern="status" context=possible_stale_behavior_test line=for key in ("id", "status", "title", "message", "prompt"):
[STALE_TEST_CANDIDATE] tests/test_normalize_remote_chatgpt.py:28 pattern=request_id context=possible_stale_behavior_test line="bind_request_id",
[STALE_TEST_CANDIDATE] tests/test_p0_convergence.py:123 pattern=request_id context=possible_stale_behavior_test line=payload={"request_id": "req-1"},
[STALE_TEST_CANDIDATE] tests/test_p0_field_flow_fixes.py:209 pattern=page_url context=possible_stale_behavior_test line=def _page_url_from_item(self, item):
[STALE_TEST_CANDIDATE] tests/test_page_list_auto_refresh.py:1 pattern=page_url context=possible_stale_behavior_test line="""页面列表自动刷新与 page_url_from 导入修复。"""
[STALE_TEST_CANDIDATE] tests/test_page_list_auto_refresh.py:72 pattern=page_url context=possible_stale_behavior_test line=def test_short_page_label_uses_page_url_from():
[STALE_TEST_CANDIDATE] tests/test_page_list_auto_refresh.py:80 pattern=page_url context=possible_stale_behavior_test line=def test_page_binding_display_imports_page_url_from():
[STALE_TEST_CANDIDATE] tests/test_page_list_auto_refresh.py:83 pattern=page_url context=possible_stale_behavior_test line=assert "page_url_from" in mod.__dict__
[STALE_TEST_CANDIDATE] tests/test_page_registry_refresh.py:263 pattern=request_id context=possible_stale_behavior_test line=host.start_page_command("sync_conversation", payload={"request_id": "r1"})
[STALE_TEST_CANDIDATE] tests/test_page_status.py:11 pattern=page_url context=possible_stale_behavior_test line=is_page_url_syncable,
[STALE_TEST_CANDIDATE] tests/test_page_status.py:13 pattern=page_url context=possible_stale_behavior_test line=page_url_from,
[STALE_TEST_CANDIDATE] tests/test_page_status.py:18 pattern=page_url context=possible_stale_behavior_test line=def test_page_url_from_reads_canonical_only(self):
[STALE_TEST_CANDIDATE] tests/test_page_status.py:19 pattern=page_url context=possible_stale_behavior_test line=raw = {"page_url": "https://chatgpt.com/c/abc123"}
[STALE_TEST_CANDIDATE] tests/test_page_status.py:20 pattern=page_url context=possible_stale_behavior_test line=self.assertEqual(page_url_from(raw), "")
[STALE_TEST_CANDIDATE] tests/test_page_status.py:27 pattern=page_url context=possible_stale_behavior_test line=migrated.pop("page_url", None)
[STALE_TEST_CANDIDATE] tests/test_page_status.py:31 pattern=page_url context=possible_stale_behavior_test line=def test_page_url_from_canonical_url(self):
[STALE_TEST_CANDIDATE] tests/test_page_status.py:33 pattern=page_url context=safe_guard_or_migration_test line=self.assertEqual(page_url_from(raw), "https://chatgpt.com/c/tampermonkey")
[STALE_TEST_CANDIDATE] tests/test_page_status.py:52 pattern=page_url context=safe_guard_or_migration_test line="page_url": "https://chatgpt.com/c/legacy-only",
[STALE_TEST_CANDIDATE] tests/test_page_status.py:56 pattern=page_url context=possible_stale_behavior_test line=self.assertNotIn("page_url", norm)
[STALE_TEST_CANDIDATE] tests/test_page_url_dedup.py:23 pattern=page_url context=possible_stale_behavior_test line=def test_normalize_chatgpt_page_url_strips_query_and_fragment():
[STALE_TEST_CANDIDATE] tests/test_page_url_dedup.py:26 pattern=page_url context=possible_stale_behavior_test line=assert host._normalize_chatgpt_page_url(url) == "https://chatgpt.com/c/abc-123"
[STALE_TEST_CANDIDATE] tests/test_poll_response_fields.py:8 pattern="status" context=possible_stale_behavior_test line="status",
[STALE_TEST_CANDIDATE] tests/test_poll_response_fields.py:10 pattern=page_url context=possible_stale_behavior_test line="target_page_url",
[STALE_TEST_CANDIDATE] tests/test_tm_page_snapshot.py:28 pattern=page_url context=possible_stale_behavior_test line=def _normalize_chatgpt_page_url(self, url):
[STALE_TESTS][DONE] hits=88
以上只是候选清单。用于验证 legacy guard / migration 的测试不能删除；继续保护旧行为的测试才需要更新或移除。

```

### feature_flag_dead_code_candidates

```text
[FEATURE_FLAG_DEAD_CODE_SCAN][START]
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:117 pattern=legacy context=likely_guard_or_diagnostic line=95. app/utils/legacy_cleanup.py
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:118 pattern=legacy context=likely_guard_or_diagnostic line=96. app/utils/legacy_fields.py
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:130 pattern=trace context=likely_guard_or_diagnostic line=108. app/utils/trace_log.py
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:306 pattern=os.environ context=needs_manual_review line=env_url = (os.environ.get("CHATGPT_PAGE_BRIDGE_URL") or "").strip()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:397 pattern=os.environ context=needs_manual_review line=self.token = (token if token is not None else os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", "")).strip()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:748 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:965 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:994 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1010 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1033 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1054 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated 当前 GUI / CLI 内部不再使用。
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1079 pattern=os.environ context=needs_manual_review line=default=os.environ.get("CHATGPT_PAGE_BRIDGE_TOKEN", ""),
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1324 pattern=os.environ context=needs_manual_review line=if os.environ.get("BRIDGE_CLIENT_NO_PAUSE") == "1":
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1392 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1394 pattern=trace context=likely_guard_or_diagnostic line=traceback.print_exc()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1500 pattern=DEBUG_ context=likely_guard_or_diagnostic line=DEBUG_FULL_BRIDGE_JSON = False
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1620 pattern=AUTO_ context=needs_manual_review line=STATUS_CHIP_AUTO_FOCUS_PREFIX = "自动焦点页"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1624 pattern=AUTO_ context=needs_manual_review line=STATUS_CHIP_AUTO_FOCUS_TOOLTIP = (
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1661 pattern=enable_ context=needs_manual_review line="enable_lan_access": False,
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1676 pattern=debug context=likely_guard_or_diagnostic line="debug_mode": False,
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1707 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1743 pattern=migrate context=needs_manual_review line=def _migrate_job_status_inplace(job):
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1876 pattern=migrate context=needs_manual_review line=_migrate_job_status_inplace(job)
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1888 pattern=migrate context=needs_manual_review line=jobs.append(dict(_migrate_job_status_inplace(job)))
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1959 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:1963 pattern=AUTO_ context=needs_manual_review line=f"[JOB][AUTO_SEND_CURSOR_FAILED] job_id={job_id} error={exc}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2020 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2275 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2294 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2335 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2451 pattern=trace context=likely_guard_or_diagnostic line=f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:2476 pattern=enable_ context=needs_manual_review line=def enable_dpi_awareness() -> None:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3432 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3469 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}",
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3551 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3728 pattern=deprecated context=likely_guard_or_diagnostic line=@deprecated
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3734 pattern=deprecated context=likely_guard_or_diagnostic line=from app.utils.deprecation_log import log_deprecated_hit
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3737 pattern=deprecated context=likely_guard_or_diagnostic line=log_deprecated_hit(
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3739 pattern=compat context=likely_guard_or_diagnostic line=reason="compat_wrapper",
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3854 pattern=fallback context=likely_guard_or_diagnostic line="[REMOTE][INVALID_REMOTE_TYPE] type=%s fallback=default",
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3858 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3886 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote_work, owner="normalize_remote_chatgpt")
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3898 pattern=legacy context=likely_guard_or_diagnostic line=legacy_conversation_id = (base.get("conversation_id") or "").strip() or (
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3902 pattern=legacy context=likely_guard_or_diagnostic line=if not legacy_conversation_id:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3903 pattern=legacy context=likely_guard_or_diagnostic line=legacy_conversation_id = parse_conversation_id(url)
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3904 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_conversation_id:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3905 pattern=legacy context=likely_guard_or_diagnostic line=base["conversation_id"] = legacy_conversation_id
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3907 pattern=legacy context=likely_guard_or_diagnostic line=base["url"] = f"https://chatgpt.com/c/{legacy_conversation_id}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3947 pattern=debug context=likely_guard_or_diagnostic line=logger.debug(
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3954 pattern=debug context=likely_guard_or_diagnostic line=logger.debug(
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3987 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:3989 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(remote, owner="GUI session.remote_chatgpt")
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4197 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4199 pattern=debug context=likely_guard_or_diagnostic line=set_debug_mode,
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4253 pattern=debug context=likely_guard_or_diagnostic line="is_debug_mode",
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4255 pattern=debug context=likely_guard_or_diagnostic line="set_debug_mode",
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4347 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import reject_legacy_fields
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4363 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _dispatch_to_gui, _log, _now, _notify_status, is_debug_mode
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4410 pattern=legacy context=likely_guard_or_diagnostic line=legacy_err = reject_legacy_fields(body, context="api_bridge")
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4411 pattern=legacy context=likely_guard_or_diagnostic line=if legacy_err:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4412 pattern=legacy context=likely_guard_or_diagnostic line=return jsonify(legacy_err[0]), legacy_err[1]
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4419 pattern=debug context=likely_guard_or_diagnostic line=elif not _is_local_remote_addr(remote_addr) and is_debug_mode():
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4449 pattern=debug context=likely_guard_or_diagnostic line=debug_status = bool(body.get("debug_status")) or is_debug_mode()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4455 pattern=debug context=likely_guard_or_diagnostic line=if debug_status:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4458 pattern=debug context=likely_guard_or_diagnostic line=if debug_status:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4477 pattern=DEBUG_ context=likely_guard_or_diagnostic line=from app.constants import DEBUG_FULL_BRIDGE_JSON
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4478 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _is_bridge_debug_enabled, _log
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4497 pattern=DEBUG_ context=likely_guard_or_diagnostic line=if not DEBUG_FULL_BRIDGE_JSON:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4508 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4511 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4519 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4522 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4523 pattern=debug context=likely_guard_or_diagnostic line=return _is_bridge_debug_enabled()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4676 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4681 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server._queue_control_message")
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:4789 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server._make_command_message")
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5087 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5093 pattern=debug context=likely_guard_or_diagnostic line=from app.server.runtime_state import _log, is_debug_mode
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5103 pattern=debug context=likely_guard_or_diagnostic line=if not is_debug_mode():
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5118 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5136 pattern=debug context=likely_guard_or_diagnostic line=should_log = is_debug_mode() or status_code >= 400
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5154 pattern=trace context=likely_guard_or_diagnostic line=f"error_type={type(error).__name__} error={error}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5197 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5366 pattern=trace context=likely_guard_or_diagnostic line=f"task_id={task_id} error={exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5566 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5763 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:5968 pattern=fallback context=likely_guard_or_diagnostic line=f"type={type(gui_result).__name__} fallback=empty"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6037 pattern=trace context=likely_guard_or_diagnostic line=f"error={error}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6239 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6338 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6475 pattern=trace context=likely_guard_or_diagnostic line=detail = f"{error}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6705 pattern=fallback context=likely_guard_or_diagnostic line=f"limit={raw_limit!r} fallback=50 "
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6784 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6804 pattern=legacy context=likely_guard_or_diagnostic line=from app.utils.legacy_cleanup import assert_no_legacy_fields
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6817 pattern=debug context=likely_guard_or_diagnostic line=is_debug_mode,
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6949 pattern=trace context=likely_guard_or_diagnostic line=trace_id = (payload.get("trace_id") or "").strip() or None
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6956 pattern=trace context=likely_guard_or_diagnostic line="trace_id": trace_id,
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6975 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(msg, owner="server.push_message")
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6980 pattern=trace context=likely_guard_or_diagnostic line=f"[CHAT_QUEUE][PUT_FAIL] trace_id={trace_id or '-'} "
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:6995 pattern=trace context=likely_guard_or_diagnostic line=f"[CHAT_QUEUE][PUT_OK] trace_id={trace_id or '-'} "
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7191 pattern=trace context=likely_guard_or_diagnostic line=f"error={exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7402 pattern=fallback context=likely_guard_or_diagnostic line=def _sync_conversation_fallback_match(msg, body):
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7722 pattern=fallback context=likely_guard_or_diagnostic line=msg = _rotate(lambda m: _sync_conversation_fallback_match(m, body))
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7739 pattern=fallback context=likely_guard_or_diagnostic line=f"command_count=1 fallback=same_conversation"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7905 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(dict(msg), owner="server._poll_response")
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:7944 pattern=legacy context=likely_guard_or_diagnostic line=assert_no_legacy_fields(resp, owner="server._poll_response")
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8046 pattern=debug context=likely_guard_or_diagnostic line=if not st._debug_mode:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8066 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8080 pattern=trace context=likely_guard_or_diagnostic line=f"trace_id={(msg.get('trace_id') or '-')} text_len={len(text)} "
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8088 pattern=trace context=likely_guard_or_diagnostic line=f"trace_id={(msg.get('trace_id') or '-')}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8101 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode or bool(body.get("debug_status")):
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8112 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8120 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8142 pattern=trace context=likely_guard_or_diagnostic line=f"traceback={traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8164 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8226 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8269 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8279 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:8317 pattern=debug context=likely_guard_or_diagnostic line=if st._debug_mode:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9123 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9177 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9330 pattern=trace context=likely_guard_or_diagnostic line=f"message_id={message_id or '-'} error={exc}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9390 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9405 pattern=trace context=likely_guard_or_diagnostic line=f"{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9427 pattern=trace context=likely_guard_or_diagnostic line=f"body_preview={preview!r}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9446 pattern=trace context=likely_guard_or_diagnostic line=f"body_preview={preview!r}\n{traceback.format_exc()}"
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9510 pattern=enable_ context=needs_manual_review line=def enable_external_api() -> bool:
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9512 pattern=os.environ context=needs_manual_review line=flag = os.environ.get("CHATGPT_BRIDGE_ENABLE_EXTERNAL_API", "").strip().lower()
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9525 pattern=enable_ context=needs_manual_review line=from app.server.route_flags import enable_external_api
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9539 pattern=enable_ context=needs_manual_review line=if not enable_external_api():
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9554 pattern=debug context=likely_guard_or_diagnostic line="""Server lifecycle, logging, callbacks, debug mode."""
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9561 pattern=trace context=likely_guard_or_diagnostic line=import traceback
[FEATURE_FLAG_CANDIDATE] 0_merged_for_chatgpt.txt:9582 pattern=debug context=likely_guard_or_diagnostic line=if not is_debug_mode():
[FEATURE_FL
```

### api_route_usage_candidates

```text
[API_ROUTE_USAGE_SCAN][START]
[API_ROUTE_USAGE_SCAN][ROUTES] count=22
[API_ROUTE] app/server/core_routes.py:87 path=/api/bridge
[API_ROUTE] app/server/core_routes.py:88 path=/health
[API_ROUTE] app/server/core_routes.py:89 path=/api/upload_files
[API_ROUTE] app/server/core_routes.py:94 path=/api/upload_files/<file_id>/content
[API_ROUTE] app/server/cursor_routes.py:12 path=/api/cursor/tasks/create
[API_ROUTE] app/server/cursor_routes.py:17 path=/api/cursor/tasks/next
[API_ROUTE] app/server/cursor_routes.py:22 path=/api/cursor/tasks/report
[API_ROUTE] app/server/cursor_routes.py:27 path=/api/cursor/tasks/status
[API_ROUTE] app/server/cursor_routes.py:32 path=/api/cursor/client/heartbeat
[API_ROUTE] app/server/external_routes.py:19 path=/api/v1/status
[API_ROUTE] app/server/external_routes.py:20 path=/api/v1/chat/send
[API_ROUTE] app/server/external_routes.py:21 path=/api/v1/chat/result/<request_id>
[API_ROUTE] app/server/external_routes.py:26 path=/api/v1/chat/ask
[API_ROUTE] app/server/external_routes.py:27 path=/api/v1/sessions
[API_ROUTE] app/server/external_routes.py:28 path=/api/v1/sessions/<session_id>
[API_ROUTE] app/server/external_routes.py:33 path=/api/v1/sessions/<session_id>/bind
[API_ROUTE] app/server/job_routes.py:14 path=/api/jobs/create
[API_ROUTE] app/server/job_routes.py:19 path=/api/jobs/list
[API_ROUTE] app/server/job_routes.py:24 path=/api/jobs/status
[API_ROUTE] app/server/job_routes.py:29 path=/api/jobs/send_to_cursor
[API_ROUTE] app/server/job_routes.py:34 path=/api/jobs/cancel
[API_ROUTE] app/server/system_hotkey.py:205 path=/api/v1/system/hotkey
[API_ROUTE_USAGE_SCAN][CALLS] count=43
[API_CALL] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:6 kind=url_literal path=/api/bridge
[API_CALL] chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3646 kind=url_literal path=/api/bridge
[API_CALL] client.user.js:37911 kind=url_literal path=/api/bridge
[API_CALL] client.user.js:41551 kind=url_literal path=/api/bridge
[API_CALL] app/client/bridge_client.py:34 kind=url_literal path=/api/v1/status
[API_CALL] app/client/bridge_client.py:221 kind=url_literal path=/api/bridge
[API_CALL] app/client/bridge_client.py:271 kind=url_literal path=/api/v1/chat/ask
[API_CALL] app/client/bridge_client.py:356 kind=url_literal path=/api/v1/status
[API_CALL] app/client/bridge_client.py:364 kind=url_literal path=/api/bridge
[API_CALL] app/client/bridge_client.py:430 kind=url_literal path=/api/v1
[API_CALL] app/client/bridge_client.py:499 kind=url_literal path=/api/v1/status
[API_CALL] app/client/bridge_client.py:591 kind=url_literal path=/api/v1/chat/ask
[API_CALL] app/client/bridge_client.py:625 kind=url_literal path=/api/v1/chat/send
[API_CALL] app/client/bridge_client.py:642 kind=url_literal path=/api/v1/chat/result/{request_id}
[API_CALL] app/client/bridge_client.py:725 kind=url_literal path=/api/v1/sessions
[API_CALL] app/client/bridge_client.py:738 kind=url_literal path=/api/v1/sessions
[API_CALL] app/client/bridge_client.py:754 kind=url_literal path=/api/v1/sessions/{session_id}
[API_CALL] app/client/bridge_client.py:778 kind=url_literal path=/api/v1/sessions/{session_id}/bind
[API_CALL] app/server/core_routes.py:87 kind=url_literal path=/api/bridge
[API_CALL] app/server/core_routes.py:90 kind=url_literal path=/api/upload_files
[API_CALL] app/server/core_routes.py:95 kind=url_literal path=/api/upload_files/<file_id>/content
[API_CALL] app/server/cursor_routes.py:13 kind=url_literal path=/api/cursor/tasks/create
[API_CALL] app/server/cursor_routes.py:18 kind=url_literal path=/api/cursor/tasks/next
[API_CALL] app/server/cursor_routes.py:23 kind=url_literal path=/api/cursor/tasks/report
[API_CALL] app/server/cursor_routes.py:28 kind=url_literal path=/api/cursor/tasks/status
[API_CALL] app/server/cursor_routes.py:33 kind=url_literal path=/api/cursor/client/heartbeat
[API_CALL] app/server/external_routes.py:19 kind=url_literal path=/api/v1/status
[API_CALL] app/server/external_routes.py:20 kind=url_literal path=/api/v1/chat/send
[API_CALL] app/server/external_routes.py:22 kind=url_literal path=/api/v1/chat/result/<request_id>
[API_CALL] app/server/external_routes.py:26 kind=url_literal path=/api/v1/chat/ask
[API_CALL] app/server/external_routes.py:27 kind=url_literal path=/api/v1/sessions
[API_CALL] app/server/external_routes.py:29 kind=url_literal path=/api/v1/sessions/<session_id>
[API_CALL] app/server/external_routes.py:34 kind=url_literal path=/api/v1/sessions/<session_id>/bind
[API_CALL] app/server/external_routes.py:56 kind=url_literal path=/api/bridge
[API_CALL] app/server/job_routes.py:15 kind=url_literal path=/api/jobs/create
[API_CALL] app/server/job_routes.py:20 kind=url_literal path=/api/jobs/list
[API_CALL] app/server/job_routes.py:25 kind=url_literal path=/api/jobs/status
[API_CALL] app/server/job_routes.py:30 kind=url_literal path=/api/jobs/send_to_cursor
[API_CALL] app/server/job_routes.py:35 kind=url_literal path=/api/jobs/cancel
[API_CALL] app/server/system_hotkey.py:206 kind=url_literal path=/api/v1/system/hotkey
[API_CALL] app/utils/gui_logging.py:362 kind=url_literal path=/api/bridge
[API_CALL] app/utils/gui_logging.py:365 kind=url_literal path=/api/bridge
[API_CALL] app/ui/mixins/cursor_bridge_mixin.py:30 kind=url_literal path=/api/cursor/tasks/create
[API_ROUTE_USAGE_SCAN][UNUSED_ROUTE_CANDIDATES]
[UNUSED_ROUTE_CANDIDATE] app/server/core_routes.py:88 path=/health
[API_ROUTE_USAGE_SCAN][MISSING_ROUTE_CANDIDATES]
[MISSING_ROUTE_CANDIDATE] app/client/bridge_client.py:430 kind=url_literal path=/api/v1
[API_ROUTE_USAGE_SCAN][DONE]
以上只是候选清单。动态拼接 URL、Blueprint 前缀、反向代理前缀、外部接口都可能导致误判，不能自动删除 route 或调用。

```

### dead_artifact_files

```text
[DEAD_ARTIFACT_FILES][START]
[DEAD_ARTIFACT_FILE_CANDIDATE] 0_merged_for_chatgpt.txt category=historical_export_or_backup_candidate size=3699434
[DEAD_ARTIFACT_FILE_CANDIDATE] 0_merged_for_chatgpt.zip category=historical_export_or_backup_candidate size=892282
[DEAD_ARTIFACT_FILE_CANDIDATE] client.user.js category=generated_runtime_artifact_keep size=1689356
[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/.gitignore category=generated_or_cache_dir_candidate size=39
[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/CACHEDIR.TAG category=generated_or_cache_dir_candidate size=191
[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/README.md category=generated_or_cache_dir_candidate size=310
[DEAD_ARTIFACT_FILE_CANDIDATE] .ruff_cache/.gitignore category=generated_or_cache_dir_candidate size=35
[DEAD_ARTIFACT_FILE_CANDIDATE] .ruff_cache/CACHEDIR.TAG category=generated_or_cache_dir_candidate size=43
[DEAD_ARTIFACT_FILE_CANDIDATE] cursor_templates/README.md category=historical_export_or_backup_candidate size=347
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.gitkeep category=generated_or_cache_dir_candidate size=0
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/bridge_json.log category=generated_or_cache_dir_candidate size=351926821
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/chat_sessions.json category=generated_or_cache_dir_candidate size=43644
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/chat_sessions.json.bak1 category=generated_or_cache_dir_candidate size=29328
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/chat_sessions.json.bak2 category=generated_or_cache_dir_candidate size=28845
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/chat_sessions.json.bak3 category=generated_or_cache_dir_candidate size=21616
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/server_url.txt category=generated_or_cache_dir_candidate size=23
[DEAD_ARTIFACT_FILE_CANDIDATE] tests/test_reset_placeholder_sync.py category=historical_export_or_backup_candidate size=3057
[DEAD_ARTIFACT_FILE_CANDIDATE] tests/test_temp_home_send_plan.py category=historical_export_or_backup_candidate size=3942
[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/v/cache/lastfailed category=generated_or_cache_dir_candidate size=13880
[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/v/cache/nodeids category=generated_or_cache_dir_candidate size=63475
[DEAD_ARTIFACT_FILE_CANDIDATE] .pytest_cache/v/cache/stepwise category=generated_or_cache_dir_candidate size=2
[DEAD_ARTIFACT_FILE_CANDIDATE] .ruff_cache/0.15.12/10709481105125173075 category=generated_or_cache_dir_candidate size=425
[DEAD_ARTIFACT_FILE_CANDIDATE] app/cursor_code/templates.py category=historical_export_or_backup_candidate size=4242
[DEAD_ARTIFACT_FILE_CANDIDATE] app/ui/mixins/_ui_builder_mixin_monolith.py.bak category=temporary_or_backup_file_candidate size=115270
[DEAD_ARTIFACT_FILE_CANDIDATE] chatgpt-toolbox/dist/client.user.js category=generated_runtime_artifact_keep size=1689356
[DEAD_ARTIFACT_FILE_CANDIDATE] exports/for_chatgpt/0_merged_for_chatgpt_export_metadata.txt category=historical_export_or_backup_candidate size=624
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/settings/kfc-settings.json category=generated_or_cache_dir_candidate size=363
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/system-prompts/spec-workflow-starter.md category=generated_or_cache_dir_candidate size=16077
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-design.md category=generated_or_cache_dir_candidate size=5896
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-impl.md category=generated_or_cache_dir_candidate size=1641
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-judge.md category=generated_or_cache_dir_candidate size=4395
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-requirements.md category=generated_or_cache_dir_candidate size=5340
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-system-prompt-loader.md category=generated_or_cache_dir_candidate size=1619
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-tasks.md category=generated_or_cache_dir_candidate size=9214
[DEAD_ARTIFACT_FILE_CANDIDATE] logs/.claude/agents/kfc/spec-test.md category=generated_or_cache_dir_candidate size=3592
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/logs/log.txt.1 category=generated_or_cache_dir_candidate size=5242850
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/logs/log.txt.2 category=generated_or_cache_dir_candidate size=5242809
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/logs/log.txt.3 category=generated_or_cache_dir_candidate size=5242811
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/settings/kfc-settings.json category=generated_or_cache_dir_candidate size=363
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/system-prompts/spec-workflow-starter.md category=generated_or_cache_dir_candidate size=16077
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-design.md category=generated_or_cache_dir_candidate size=5896
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-impl.md category=generated_or_cache_dir_candidate size=1641
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-judge.md category=generated_or_cache_dir_candidate size=4395
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-requirements.md category=generated_or_cache_dir_candidate size=5340
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-system-prompt-loader.md category=generated_or_cache_dir_candidate size=1619
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-tasks.md category=generated_or_cache_dir_candidate size=9214
[DEAD_ARTIFACT_FILE_CANDIDATE] runtime/.claude/agents/kfc/spec-test.md category=generated_or_cache_dir_candidate size=3592
[DEAD_ARTIFACT_FILES][DONE] hits=47
以上只是候选清单。client.user.js 这类运行产物不能直接删除；logs/runtime/build/dist 是否清理取决于项目发布和调试策略。

```

## Review Rule

- high：优先人工确认，通常代表旧字段真实残留、接口断链、过期测试或强校验失败。
- medium：进入候选清单，但必须结合动态引用、GUI 冒烟和测试确认。
- low：多为信息项或低风险清理项，不应影响主流程。
- 所有等级都不允许脚本自动删除。