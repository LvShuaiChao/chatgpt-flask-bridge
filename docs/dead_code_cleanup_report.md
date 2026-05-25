# Dead Code Cleanup Report

本文档记录当前项目的僵尸代码清理计划、风险评估、执行结果和回滚方式。清理规则见 `docs/dead_code_cleanup_rules.md`。

**给 Cursor 的一次性总控指令**：见 [`cursor_dead_code_cleanup_master_task.md`](cursor_dead_code_cleanup_master_task.md)。

> **精简发布包说明**：当前常见导出快照不含 `tools/`、`tests/`、独立 `server.py`。下文批次模板与历史记录中的 `python tools/…`、`pytest`、`gui.py`/`server.py` 属于**完整开发仓库**流程；精简包验收以 `python -m compileall -q app GUI.py` 与 `cd chatgpt-toolbox && npm run build` 为准（见 `docs/dead_code_cleanup_rules.md` §0）。

---

## 1. 删除计划模板

```text
[DEAD_CODE_DELETE_PLAN]
path=
symbol=
reason=
risk=
dynamic_checked=
tests=
rollback=
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `path` | 文件路径 |
| `symbol` | 函数、变量、常量、分支或代码块名称 |
| `reason` | 为什么判定为僵尸代码 |
| `risk` | `low` / `medium` / `high` |
| `dynamic_checked` | 是否检查过 Qt connect、Flask route、getattr、fetch、requests 等动态引用 |
| `tests` | 删除前后要跑的测试命令 |
| `rollback` | 回滚命令 |

---

## 2. 删除结果模板

```text
[DEAD_CODE_DELETE_RESULT]
path=
symbol=
result=
tests=
logs=
rollback_needed=
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `result` | `deleted` / `kept` / `deprecated` / `observe` / `replace` / `replace_then_delete` |
| `tests` | 实际执行的测试结果 |
| `logs` | 运行日志是否有异常 |
| `rollback_needed` | `yes` / `no` |

---

## 3. 批次记录模板

每完成一批 dead code 清理（通常对应一个独立 commit），在本节下方追加一条 `[DEAD_CODE_BATCH]` 记录。

```text
[DEAD_CODE_BATCH]
batch_id=
scope=
risk=
items=
tests=
result=
rollback=
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `batch_id` | 批次唯一标识（建议含日期与范围，如 `2026-05-25-job-status-migration`） |
| `scope` | 本批涉及的模块或文件范围 |
| `risk` | `low` / `medium` / `high` |
| `items` | 本批处理的具体项（替换、删除、observe 等），可多行列表 |
| `tests` | 本批独立执行的测试与检查命令 |
| `result` | `passed` / `failed` / `partial` / `rolled_back` |
| `rollback` | 本批独立回滚命令（`git restore ...` 等） |

### 示例

```text
[DEAD_CODE_BATCH]
batch_id=2026-05-25-job-status-migration
scope=app/core/job_scheduler.py
risk=low
items=
- job.get("status") == "cancelled" -> job_status_from(job) == "cancelled"
- j.get("status") == "waiting_chatgpt_reply" -> job_status_from(j) == "waiting_chatgpt_reply"
tests=
- pytest -q tests/test_job_scheduler_status_migration.py
- python -m compileall -q app GUI.py
- python tools/run_dead_code_cleanup_checks.py
result=passed
rollback=git restore app/core/job_scheduler.py tests/test_job_scheduler_status_migration.py
```

<!-- 在此下方追加新的 [DEAD_CODE_BATCH] 记录 -->

```text
[DEAD_CODE_BATCH]
batch_id=2026-05-25-ui-mixins-batch-4-low-risk
scope=app/ui/mixins page_binding_diagnostics, page_binding_display, page_binding_state, page_open_close, page_tm_client, session
risk=low
items=
- deleted: page_binding_diagnostics_mixin._log_send_bind_check, _log_bind_auto_rebind, _sync_target_unavailable_reason_text
- deleted: page_binding_display_mixin._bool_alias_value, _page_identity_text
- deleted: page_binding_state_mixin._gc_orphan_bindings, _update_session_binding_from_normalized_page
- deleted: page_open_close_mixin._tm_table_signature, _page_list_refresh_metrics
- deleted: page_tm_client_mixin._classify_page_state, _short_page_display, build_monkey_binding_summary_text
- deleted: session_mixin._render_pending_chat_if_needed
- observe (not deleted): page_open_close / page_selector / page_send_target / page_sync 敏感域函数（见 §5.3）
tests=
- python -m compileall -q app GUI.py
- rg 验证各 mixin 内已删符号无残留
result=passed
rollback=git restore app/ui/mixins/page_binding_diagnostics_mixin.py app/ui/mixins/page_binding_display_mixin.py app/ui/mixins/page_binding_state_mixin.py app/ui/mixins/page_open_close_mixin.py app/ui/mixins/page_tm_client_mixin.py app/ui/mixins/session_mixin.py
```

```text
[DEAD_CODE_BATCH]
batch_id=2026-05-25-batch-5-wrapup-guardrails
scope=docs + must-keep guardrails (no new mass deletions)
risk=low
items=
- conclusion: no new low-risk Python functions to delete (single-occurrence methods largely covered in batches 1–4)
- document: framework callbacks, named IIFE, state/mixin classes must-not-delete
- document: precise boundaries for state.py / matcher.py / page_identity.py
- document: post-delete rg checks + runtime import smoke + userscript build
- document: commit order commits 1–5 + isolated page_snapshot fix
tests=
- python tools/check_must_keep_symbols.py
- docs/dead_code_cleanup_rules.md §22 rg checklist (when executing deletions)
result=passed
rollback=git restore docs/dead_code_cleanup_rules.md docs/dead_code_cleanup_report.md docs/cursor_dead_code_cleanup_master_task.md docs/dead_code_cleanup_manifest.json docs/dead_code_ignore_manifest.json tools/check_must_keep_symbols.py
```

---

### 5.3 第四批观察项（暂不删除）

以下符号静态无引用，但与页面打开/关闭、选择、发送目标、同步保护强相关；**不要与低风险 helper 同批删除**。

| path | symbols |
|------|---------|
| `app/ui/mixins/page_open_close_mixin.py` | `_auto_open_url_once`, `_on_open_bound_chatgpt_page`, `_on_close_selected_tm_page`, `_on_close_current_bound_tm_page` |
| `app/ui/mixins/page_selector_mixin.py` | `_extract_chatgpt_conversation_id_from_url`, `_get_page_combo_selection_ids`, `_sync_tm_page_combo_selection`, `_on_bind_selected_tm_page`, `_current_focused_tm_page` |
| `app/ui/mixins/page_send_target_mixin.py` | `_bound_page_usable_for_action`, `_explain_page_decision_for_session`, `_log_action_target_*`, `_is_sendable_chatgpt_client`, `_session_bound_page_online`, `_binding_status_details` |
| `app/ui/mixins/page_sync_mixin.py` | `_build_sync_target_snapshot_from_decision`, `_is_protected_local_message` |

---

### 5.4 第五批复核后：仍存在少量低风险可删除项

第五批复核后，仍存在少量低风险可删除项，主要集中在：

- `app/ui/mixins/page_auto_bind_mixin.py`：`::_apply_remote_and_runtime`（已在先前批次删除）
- `app/ui/main_window_state.py`：`LogUiState`（已在先前批次删除）
- `PageSelectorState` 未使用字段（已精简为仅 `last_fingerprint`；`selector_refreshing` 等已删除）
- UI mixin 未使用常量
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js`：`SEND_STABLE_SINGLE_ATTEMPT_WINDOW_MS`（已删除）

按「函数 / 方法定义名在源码内出现次数」复核后，**出现 1 次** 的普通 Python 方法已基本被前几批覆盖；上表为第五批复核后仍待清理或已在本轮补充中处理的项。

剩余未列入删除清单的，主要是框架回调 / 魔术方法 / 生命周期方法（见 §5.5、§6），不能按无引用删除。

### 5.5 第五批：框架回调与模块 hook（禁止删除）

| path | symbol | 不能删的原因 |
|------|--------|----------------|
| `app/server/__init__.py` | `__getattr__()` | 模块级动态属性加载入口 |
| `app/server/__init__.py` | `__dir__()` | 模块级动态补全 / 反射入口 |
| `app/server/runtime_state.py` | `SilentWSGIRequestHandler.log_request()` | Werkzeug / HTTP server 生命周期回调 |
| `app/ui/main_window.py` | `MainWindow.closeEvent()` | Qt 关闭窗口事件回调 |
| `app/ui/widgets/no_wheel_combo_box.py` | `NoWheelComboBox.wheelEvent()` | Qt 鼠标滚轮事件回调 |

### 5.6 第五批：已确认可删的普通 import（无新增）

前几批已列项仍为**主要** unused import 候选；第五批复核**未发现**其他明确可删的普通 import（各 mixin 现状以 `find_python_dead_statements.py` 为准）。

历史候选（执行删除前须再 `rg` 确认文件内未使用）：

| path | import / symbol |
|------|-----------------|
| `app/ui/mixins/page_auto_bind_mixin.py` | `UNBOUND_SESSION_SEND_HINT`（若 import 仍存在且未使用） |
| `app/ui/mixins/page_sync_mixin.py` | `BIND_STATE_WAITING_HOME`、`explain_page_decision`（若 import 仍存在且未使用） |
| `app/ui/mixins/send_flow_mixin.py` | `BIND_STATE_UNBOUND`（若 import 仍存在且未使用） |

**注意**：`from __future__ import annotations` 在静态扫描中常被误报；**不要删**（见 `dead_code_cleanup_rules.md` §3.3、`cursor_dead_code_cleanup_master_task.md` §84）。

### 5.6.1 第六轮补充：`from __future__ import annotations` 扫描边界（无新增可删函数）

| 项 | 结论 |
|----|------|
| 还原快照 | `0_merged_for_chatgpt(434).zip` → 143 文件 |
| `compileall` + 油猴 build | 通过 |
| 新高置信度可删函数 | **无** |
| 新增边界 | **`from __future__ import annotations` 不能当普通 unused import 删除** |

**误报原因**：简易脚本按「局部名是否在文件内被引用」判断；`annotations` 来自 `__future__`，不是运行时变量。

**禁止删除范围**（与 rules §3.3 一致）：`app/client/*.py`、`app/server/*.py`、`app/ui/main_window_state.py`、`app/utils/*.py`、`app/ui/mixins/*.py`、`app/ui/widgets/*.py`，及仓库内其他含该行的 `.py`。

**扫描器**：`tools/find_python_dead_statements.py` 已忽略 `__future__` 模块；豁免见 `docs/dead_code_ignore_manifest.json` → `keep-future-annotations-import-global`。

### 5.7 第五批：油猴命名 IIFE 与运行态类（禁止删除）

| path | symbol | 结论 |
|------|--------|------|
| `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js` | `tickWaitingReplyOrSendOpportunity` | **保留**。`setInterval` 内命名异步 IIFE；只出现一次正常 |
| `app/cursor_code/runtime.py` | `CursorAutomationRuntime` | **保留**。`_runtime = CursorAutomationRuntime()` 单例 |
| `app/cursor_code/upgrade_monitor.py` | `CursorFindOnceWorker` / `CursorUpgradeMonitorWorker` | **保留**。`cursor_code_mixin.py` 实例化 |
| `app/ui/main_window_state.py` | `BridgeUiState` 等状态类 | **保留**。`main_window.py` 运行态状态对象 |
| `app/ui/mixins/*.py` | 各 `*Mixin` 类 | **保留**。`main_window.py` 多继承组合 |
| `app/ui/widgets/*.py` | 自定义 Widget 类 | **保留**。UI 构建逻辑实例化 |

### 5.8 第五批：删除项精确边界

#### `app/server/state.py`

可删（若仍存在）：

- `BridgeQueueFullError`
- `_server_instance_id`
- `_server_start_time`

删除 `_server_instance_id` / `_server_start_time` 后，`import uuid` 通常可删；`import time` **须**确认文件后半是否仍用 `time`，勿机械删除。

#### `app/cursor_code/matcher.py`

可删（若仍存在）：`CursorMatchResult`。删后若无其他 `@dataclass`，可一并去掉 `from dataclasses import dataclass, field`。

**勿删**：`match_template_multiscale()`、`match_best_template()`、`find_template_on_screen()`、`find_icon_position()`（模板匹配主链路）。

#### `app/utils/page_identity.py`

可删（若仍存在）：`PageIdentity.has_page_channel()`、`PageIdentity.display_key()`。

`PageIdentity.has_conversation()` 若无真实**方法调用**，但源码有 `"has_conversation"` 字符串或 `has_conversation = ...` 局部变量时：只删**方法定义**，勿误删字符串状态码或局部变量名。

### 5.9 第五批：清理后 `rg` 与保留项清单

完整命令见 `docs/dead_code_cleanup_rules.md` §22.6–§22.7。

**已删项应无命中**（示例）：`BridgeQueueFullError`、`CursorMatchResult`、`should_emit_log`、`has_page_channel`、`display_key`、油猴一批已删 helper 等。

**必须保留**（示例）：`__getattr__` / `__dir__`、`log_request`、`closeEvent`、`wheelEvent`、`tickWaitingReplyOrSendOpportunity`。

### 5.10 推荐提交顺序（第 1–5 批）

| # | 提交内容 |
|---|----------|
| 1 | `constants.py`、`cursor_bridge_mixin.py`、油猴 `main.js` / `upload-module.js` / `toolbox-shell.js` |
| 2 | `state.py`、`matcher.py`、`gui_logging.py`、`page_identity.py`、`session_list_item.py` |
| 3 | UI helper mixins：`settings_mixin`、`ui_chat_panel_mixin`、`ui_page_selector_mixin`、`ui_status_compact_mixin`、`waiting_timer_mixin`、`conversation_stats_mixin` |
| 4 | 页面状态/诊断 mixins：`page_binding_diagnostics_mixin`、`page_binding_display_mixin`、`page_binding_state_mixin`、`page_open_close_mixin`、`page_tm_client_mixin`、`session_mixin` |
| 5 | **仅** `app/utils/page_snapshot.py` 缺失修复（运行时断裂，**不与** dead code 混提） |

---

## 4. 当前已确认候选

### 4.1 `app/core/job_scheduler.py`

```text
[DEAD_CODE_DELETE_PLAN]
path=app/core/job_scheduler.py
symbol=job.get("status") == "cancelled"
reason=任务状态字段已迁移到 job_status，直接读取旧 status 会导致取消保护失效
risk=low
dynamic_checked=yes
tests=pytest -q tests/test_job_scheduler_status_migration.py && python -m compileall -q app GUI.py
rollback=git restore app/core/job_scheduler.py
```

**处理建议**：`result=replace` — 替换为 `job_status_from(job) == "cancelled"`。

---

### 4.2 `app/core/job_scheduler.py`

```text
[DEAD_CODE_DELETE_PLAN]
path=app/core/job_scheduler.py
symbol=j.get("status") == "waiting_chatgpt_reply"
reason=任务状态字段已迁移到 job_status，直接读取旧 status 会导致 pending_chatgpt 统计失效
risk=low
dynamic_checked=yes
tests=pytest -q tests/test_job_scheduler_status_migration.py && python -m compileall -q app GUI.py
rollback=git restore app/core/job_scheduler.py
```

**处理建议**：`result=replace` — 替换为 `job_status_from(j) == "waiting_chatgpt_reply"`。

---

### 4.3 油猴源码

```text
[DEAD_CODE_DELETE_PLAN]
path=chatgpt-toolbox/tampermonkey-userscript-src/**
symbol=DEFAULT_AUTO_CONFIG
reason=与 createDefaultAutoConfig() 重复，且缺少 modeSettings，属于重复默认配置源
risk=medium
dynamic_checked=yes
tests=cd chatgpt-toolbox && npm run build
rollback=git restore chatgpt-toolbox/tampermonkey-userscript-src client.user.js chatgpt-toolbox/dist/client.user.js
```

**处理建议**：`result=replace_then_delete` — 先用 `getDefaultAutoListPromptsText()` 替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用，再删除 `DEFAULT_AUTO_CONFIG`。

---

## 5. 当前观察项

### 5.1 `app/models.py`

```text
[DEAD_CODE_DELETE_PLAN]
path=app/models.py
symbol=remote_binding_enabled(remote)
reason=当前只是 remote_binding_active(remote) 的兼容包装
risk=medium
dynamic_checked=no
tests=python -m compileall -q app GUI.py
rollback=git restore app/models.py
```

**处理建议**：`result=observe` — 暂不删除，只加 `@deprecated` 注释和 `[DEPRECATED_HIT]` 日志。

---

### 5.2 `app/utils/bridge_payload.py`

```text
[DEAD_CODE_DELETE_PLAN]
path=app/utils/bridge_payload.py
symbol=persist_qsettings_last_url() 中清理 last_page_url/page_url/conversation_url 的循环
reason=旧 QSettings key 迁移清理逻辑，低频但仍可能保护用户历史配置
risk=medium
dynamic_checked=yes
tests=python -m compileall -q app GUI.py
rollback=git restore app/utils/bridge_payload.py
```

**处理建议**：`result=observe` — 暂不删除，命中旧 key 时打印 `[MIGRATION_HIT]`。

---

## 6. 明确不能删除项

| path | symbol | reason | result |
|------|--------|--------|--------|
| `app/utils/legacy_cleanup.py` | `LEGACY_FIELD_NAMES` / `assert_no_legacy_fields` / `reject_legacy_fields` | 旧字段拒绝逻辑仍在保护 bridge payload | `keep` |
| `app/utils/bridge_payload.py` | `validate_outbound_queue_message()` 中旧字段拒绝逻辑 | 防止 `payload.request_id` 等旧字段进入队列 | `keep` |
| `client.user.js` | 整个文件 | 生成产物，不作为源码级修改入口，但不能直接删除运行产物 | `generated_keep` |
| `chatgpt-toolbox/dist/client.user.js` | 整个文件 | 同上，构建产物 | `generated_keep` |
| `app/server/__init__.py` | `__getattr__` / `__dir__` | Python 模块 hook | `keep` |
| `app/server/runtime_state.py` | `SilentWSGIRequestHandler.log_request` | Werkzeug 回调 | `keep` |
| `app/ui/main_window.py` | `MainWindow.closeEvent` | Qt 事件回调 | `keep` |
| `app/ui/widgets/no_wheel_combo_box.py` | `NoWheelComboBox.wheelEvent` | Qt 事件回调 | `keep` |
| `upload/upload-module.js` | `tickWaitingReplyOrSendOpportunity` | setInterval 内命名异步 IIFE | `keep` |
| `app/cursor_code/runtime.py` | `CursorAutomationRuntime` | 模块级运行态单例 | `keep` |
| `app/cursor_code/upgrade_monitor.py` | `CursorFindOnceWorker` / `CursorUpgradeMonitorWorker` | cursor_code_mixin 任务 worker | `keep` |
| `app/ui/main_window_state.py` | `BridgeUiState` 等 | main_window 运行态状态 | `keep` |
| `app/ui/mixins/*.py` | `*Mixin` 类 | main_window 多继承 | `keep` |
| 任意 `.py` | `from __future__ import annotations` | 类型注解延迟解析 | `keep` |

---

## 7. 一键验收

清理或删除后执行：

```bash
python tools/run_dead_code_cleanup_checks.py
```

等价分步：

```bash
python -m compileall -q app GUI.py
python tools/find_dead_code_candidates.py
python tools/find_dynamic_reference_entries.py
python tools/check_dead_code_regression.py
python tools/check_must_keep_symbols.py
pytest -q
```

---

## 8. 执行记录区

以下区域用于追加实际删除结果。每次执行后复制「删除结果模板」并填写。

```text
[DEAD_CODE_DELETE_RESULT]
path=app/core/job_scheduler.py
symbol=job.get("status") / j.get("status")
result=replace
tests=pytest -q tests/test_job_scheduler_status_migration.py (2 passed); check_dead_code_regression OK
logs=python tools/run_dead_code_cleanup_checks.py → [DEAD_CODE_CLEANUP_CHECKS][OK]
rollback_needed=no
```

```text
[DEAD_CODE_DELETE_RESULT]
path=chatgpt-toolbox/tampermonkey-userscript-src/core/state.js
symbol=DEFAULT_AUTO_CONFIG
result=replace_then_delete
tests=npm run build; client.user.js 无 DEFAULT_AUTO_CONFIG
logs=regression check OK
rollback_needed=no
```

```text
[DEAD_CODE_DELETE_RESULT]
path=app/models.py
symbol=remote_binding_enabled(remote)
result=deprecated
tests=compileall OK
logs=[DEPRECATED_HIT] 进程内仅一次
rollback_needed=no
```

```text
[DEAD_CODE_DELETE_RESULT]
path=app/utils/bridge_payload.py
symbol=persist_qsettings_last_url legacy key loop
result=observe
tests=compileall OK
logs=命中旧 key 时 [MIGRATION_HIT]
rollback_needed=no
```

```text
[DEAD_CODE_DELETE_PLAN]
path=app/constants.py
symbol=PENDING_REPLY_STALE_TIMEOUT_SEC
reason=仅作为 PENDING_REPLY_HARD_TIMEOUT_SECONDS 的别名；引用已统一为主常量
risk=low
dynamic_checked=yes
tests=python -m compileall -q app GUI.py && rg "PENDING_REPLY_STALE_TIMEOUT_SEC" app GUI.py
rollback=git restore app/constants.py app/ui/mixins/session_mixin.py tests/test_stale_pending_reply.py
```

```text
[DEAD_CODE_DELETE_RESULT]
path=app/constants.py
symbol=PENDING_REPLY_STALE_TIMEOUT_SEC
result=deleted
tests=passed
logs=no runtime log required
rollback_needed=no
```

```text
[DEAD_CODE_DELETE_PLAN]
path=app/constants.py
symbol=status_chip_text(prefix, state)
reason=多处 UI 调用（page_binding_display_mixin、ui_status_compact_mixin），保留以统一「前缀：状态」中文冒号格式
risk=low
dynamic_checked=yes
tests=python -m compileall -q app GUI.py
rollback=git restore app/constants.py
```

```text
[DEAD_CODE_DELETE_RESULT]
path=app/constants.py
symbol=status_chip_text(prefix, state)
result=kept
tests=compileall passed; 3+ UI call sites
logs=no runtime log required
rollback_needed=no
```

<!-- 在此下方追加新的 [DEAD_CODE_DELETE_RESULT] 记录 -->

---

## 9. 回滚方案

本节描述「删错或修复引入回归后如何恢复」。回滚优先**局部止血**，确认根因后再拆小提交重新修复。清理规则见 `docs/dead_code_cleanup_rules.md` §12。

### 9.1 P0：`job_scheduler.py` 回滚

**涉及文件**

- `app/core/job_scheduler.py`
- `tests/test_job_scheduler_status_migration.py`

**先判断是否真的需要回滚**

修复后若出现任务调度异常，先确认是否仅为测试或字段判断写错，不要立刻回滚全部相关改动。

```bash
rg "job_status_from" app/core/job_scheduler.py
rg 'job\.get\("status"\)|j\.get\("status"\)' app/core/job_scheduler.py
pytest -q tests/test_job_scheduler_status_migration.py
```

**回滚命令**（确认需要回滚时执行）

```bash
git restore app/core/job_scheduler.py
git restore tests/test_job_scheduler_status_migration.py
```

**回滚后检查**

```bash
python tools/check_dead_code_regression.py
```

**说明**

- 若回滚后 `rg` 再次命中 `job.get("status")` / `j.get("status")`，说明旧问题会重现；此状态**只能临时止血**，必须在排查后重新改为 `job_status_from(...)` 并补测试。
- 可选完整验收：`python -m compileall -q app GUI.py && python tools/check_dead_code_regression.py`

---

### 9.2 P1：`DEFAULT_AUTO_CONFIG` 回滚

**涉及文件**

- `chatgpt-toolbox/tampermonkey-userscript-src/**`（源码，唯一可改入口）
- `chatgpt-toolbox/dist/client.user.js`（构建产物）
- `client.user.js`（根目录同步产物）

**先判断是否真的需要回滚**

油猴构建后若自动指令、Prompt 列表、列表模式默认文本异常，先检查 `getDefaultAutoListPromptsText()` 是否已完整替换所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用。

```bash
rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js
rg "getDefaultAutoListPromptsText" chatgpt-toolbox/tampermonkey-userscript-src
rg "createDefaultAutoConfig" chatgpt-toolbox/tampermonkey-userscript-src
```

**回滚命令**

```bash
git restore chatgpt-toolbox/tampermonkey-userscript-src
git restore chatgpt-toolbox/dist/client.user.js
git restore client.user.js
```

**回滚后检查**

```bash
rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js
cd chatgpt-toolbox && npm run build
```

**说明**

- 回滚后 `DEFAULT_AUTO_CONFIG` 与 `createDefaultAutoConfig()` 重复的问题**仍然存在**，不要长期停在回滚态。
- 建议拆小提交重新处理：
  1. 只新增 `getDefaultAutoListPromptsText()`
  2. 只替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用
  3. 只删除 `DEFAULT_AUTO_CONFIG`
  4. 在 `chatgpt-toolbox` 目录执行 `npm run build`，确认根目录 `client.user.js` 已同步

---

### 9.3 P2：legacy guard 回滚

**涉及文件**

- `app/utils/legacy_cleanup.py`
- `app/utils/bridge_payload.py`
- `tests/test_bridge_payload_legacy_guard.py`
- `tools/check_must_keep_symbols.py`

**先判断是否真的需要回滚**

出现旧字段拦截相关问题时：

- **不要**直接删除 guard
- **不要**把 `ValueError` 改成 `warning` 后继续入队
- `payload.request_id` 等旧字段被拒绝是**正确行为**；应修上游，勿弱化 guard

```bash
python tools/check_must_keep_symbols.py
pytest -q tests/test_bridge_payload_legacy_guard.py
```

**回滚命令**（guard 被误删或 bridge_payload 校验被改坏时）

```bash
git restore app/utils/legacy_cleanup.py
git restore app/utils/bridge_payload.py
git restore tests/test_bridge_payload_legacy_guard.py
git restore tools/check_must_keep_symbols.py
```

**回滚后检查**

```bash
python tools/check_must_keep_symbols.py
pytest -q tests/test_bridge_payload_legacy_guard.py
```

**说明**

- legacy guard 必须保持「拒绝旧字段」语义；允许的唯一演进方向是上游不再发送旧字段，而不是放宽校验。

---

### 9.4 P3：工具脚本回滚

**涉及文件**

- `tools/find_dead_code_candidates.py`
- `tools/find_dynamic_reference_entries.py`
- `tools/check_dead_code_regression.py`
- `tools/check_must_keep_symbols.py`
- `tools/run_dead_code_cleanup_checks.py`

**设计约束**

这些脚本**只允许检查和打印**，不得修改 `app/`、`GUI.py` 等业务文件。若运行脚本后发现业务文件被改动，说明脚本设计错误，必须回滚脚本（并调查为何写了文件）。

**回滚前先确认是否有非预期变更**

```bash
git diff --stat
git diff -- app GUI.py
git diff -- tools
```

**回滚命令**（脚本被改坏时）

```bash
git restore tools/find_dead_code_candidates.py
git restore tools/find_dynamic_reference_entries.py
git restore tools/check_dead_code_regression.py
git restore tools/check_must_keep_symbols.py
git restore tools/run_dead_code_cleanup_checks.py
```

若上述文件为本轮**新增**且不应保留，可删除：

```bash
git rm tools/find_dead_code_candidates.py
git rm tools/find_dynamic_reference_entries.py
git rm tools/check_dead_code_regression.py
git rm tools/check_must_keep_symbols.py
git rm tools/run_dead_code_cleanup_checks.py
```

**回滚后检查**

```bash
python tools/run_dead_code_cleanup_checks.py
```

---

## 10. 回滚记录模板

每次执行回滚后，在本节下方追加一条记录（可复制模板填写）。

```text
[DEAD_CODE_ROLLBACK_PLAN]
path=
symbol=
reason_for_rollback=
rollback_command=
post_rollback_tests=
remaining_risk=
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `path` | 回滚涉及的文件或目录 |
| `symbol` | 回滚相关的函数、常量、分支或行为 |
| `reason_for_rollback` | 为何需要回滚（现象、日志、失败测试） |
| `rollback_command` | 实际执行的 `git restore` / `git rm` 等命令 |
| `post_rollback_tests` | 回滚后执行的检查命令及结果摘要 |
| `remaining_risk` | 回滚后仍存在的已知风险（例如旧字段读取回归） |

### 示例

```text
[DEAD_CODE_ROLLBACK_PLAN]
path=app/core/job_scheduler.py
symbol=job_status_from(job) == "cancelled"
reason_for_rollback=修复后 Cursor 队列发送流程出现异常，需要临时恢复上一版本排查
rollback_command=git restore app/core/job_scheduler.py
post_rollback_tests=python -m compileall -q app GUI.py && python tools/check_dead_code_regression.py
remaining_risk=回滚后旧 status 字段读取问题会重新出现，必须重新修复
```

<!-- 在此下方追加新的 [DEAD_CODE_ROLLBACK_PLAN] 记录 -->

---

## 11. 回滚方案文档验收标准

| # | 标准 | 状态 |
|---|------|------|
| 1 | 文档包含 P0 / P1 / P2 / P3 四类回滚流程 | 见 §9.1–§9.4 |
| 2 | 每类回滚均有具体 `git restore`（或 `git rm`）命令 | 见各小节「回滚命令」 |
| 3 | 每类回滚均有回滚后测试/检查命令 | 见各小节「回滚后检查」 |
| 4 | 文档明确 legacy guard 不可弱化（禁止 warning 替代 ValueError） | 见 §9.3 |
| 5 | 本轮仅修改本文档，不修改业务代码 | — |
| 6 | 不引入 `try/except pass` | — |
