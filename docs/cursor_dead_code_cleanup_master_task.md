# Cursor 一次性总任务包：僵尸代码安全清理

> 可直接整段复制给 Cursor Agent。  
> 规则详情见 `docs/dead_code_cleanup_rules.md`；候选与观察项见 `docs/dead_code_cleanup_report.md`。

> **导出快照 vs 完整仓库**：当前 **FILE 导出快照**（约 143 个还原文件）**未包含** `tools/` 目录。下文列出的 `tools/find_dead_code_candidates.py`、`find_dynamic_reference_entries.py`、`check_dead_code_regression.py`、`check_must_keep_symbols.py`、`run_dead_code_cleanup_checks.py` 等属于**历史完整仓库方案或待恢复工具**，**不是**当前快照可直接执行项；勿按「已有 tools」去运行不存在的脚本。
>
> **当前快照可执行验证**（无 `tools/` 时以此为准）：
>
> ```bash
> python -m compileall -q app GUI.py
> cd chatgpt-toolbox && npm run build --silent
> ```
>
> **完整仓库**：若工作区已有 `tools/`、`tests/`、独立 `server.py`，可额外运行 `python tools/…` 与 `pytest`；入口仍为 **`GUI.py`**（不是 `gui.py` / `server.py`）。

---

## 任务目标

识别并清理当前代码中的 dead code / unreachable code / 被新逻辑替代的旧代码，同时保护 Qt 动态入口、Flask 路由、legacy guard、配置迁移逻辑，避免误删。

**硬性约束**

- 不要重构无关模块。
- 不要直接大规模删除代码。
- 不要引入 `try/except pass`；若必须捕获异常，须 `console.error` / `logger` 记录完整错误。
- 油猴只改 `chatgpt-toolbox/tampermonkey-userscript-src/`，改后 `cd chatgpt-toolbox && npm run build`；**禁止**手工改 `client.user.js` / `dist/client.user.js`。

---

## 最小安全落地顺序（必须按序）

| 步 | 内容 |
|----|------|
| 1 | 修 `app/core/job_scheduler.py` 旧 `status` 读取 + `tests/test_job_scheduler_status_migration.py` |
| 2 | 加 `tests/test_bridge_payload_legacy_guard.py`，确认不误删 `legacy_cleanup.py` |
| 3 | 加 `tools/find_dead_code_candidates.py`、`find_dynamic_reference_entries.py`、`check_dead_code_regression.py` |
| 4 | 加 `tools/check_must_keep_symbols.py`、`tools/run_dead_code_cleanup_checks.py` 串联验收 |
| 5 | 加 `docs/dead_code_cleanup_rules.md`、`docs/dead_code_cleanup_report.md` |
| 6 | 油猴 `DEFAULT_AUTO_CONFIG` → `getDefaultAutoListPromptsText()`，再 `npm run build` |
| 7 | `remote_binding_enabled()`、`persist_qsettings_last_url()` 加 deprecated / migration 注释与观察日志 |
| 8 | `python tools/run_dead_code_cleanup_checks.py` |
| 9 | 根据扫描结果再决定是否处理 `PENDING_REPLY_STALE_TIMEOUT_SEC`、`status_chip_text()` 等低优先级候选 |

**不要**一上来按候选清单批量删除。

---

## 一、P0：`app/core/job_scheduler.py` 旧 status 字段

文件：`app/core/job_scheduler.py`

1. **`send_job_to_cursor(job_id, enqueue_cursor_task_fn)`**  
   将 `if job.get("status") == "cancelled":`  
   改为 `if job_status_from(job) == "cancelled":`

2. **`get_job_scheduler_snapshot(limit=20)`**  
   `pending_chatgpt` 统计中将  
   `j.get("status") == "waiting_chatgpt_reply"`  
   改为 `job_status_from(j) == "waiting_chatgpt_reply"`

3. **不要**恢复 `job["status"]`。  
4. **不要**删除 `job_status_from()`。  
5. **不要**删除 `_migrate_job_status_inplace()`。

### 测试：`tests/test_job_scheduler_status_migration.py`

1. `job_status="cancelled"` 且无 `status` 时，`send_job_to_cursor()` 必须拒绝发送。  
2. `job_status="waiting_chatgpt_reply"` 且无 `status` 时，`get_job_scheduler_snapshot()` 的 `pending_chatgpt` 须正确。

要求：清空 `job_queue` / `job_map` / `cursor_task_to_job`；`create_job()` 创建；手动设 `job_status` 并 `pop` 旧 `status`；断言行为；不用 `try/except pass`。

---

## 二、P1：油猴默认配置重复源

源码目录：`chatgpt-toolbox/tampermonkey-userscript-src/`（勿改生成产物）

1. 定位 `createDefaultAutoConfig()`（通常在 `core/state.js`）。  
2. 新增：

```javascript
function getDefaultAutoListPromptsText() {
  return createDefaultAutoConfig().listPromptsText;
}
```

3. 将所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 替换为 `getDefaultAutoListPromptsText()`。  
4. 删除 `DEFAULT_AUTO_CONFIG` 常量。  
5. 确认全项目无 `DEFAULT_AUTO_CONFIG`。  
6. 执行：`cd chatgpt-toolbox && npm run build`。

---

## 三、P2：保护 legacy guard（禁止误删）

**明确不要删除：**

- `app/utils/legacy_cleanup.py`
- `LEGACY_FIELD_NAMES`
- `assert_no_legacy_fields()` / `reject_legacy_fields()`
- `validate_outbound_queue_message()` 中旧字段拒绝逻辑

### 测试：`tests/test_bridge_payload_legacy_guard.py`

1. `validate_outbound_queue_message()` 必须拒绝 `payload.request_id`。  
2. 不含 `request_id` 的 canonical 消息须通过。

断言：错误含 `legacy fields still exist before save` 与 `payload.request_id`；合法结果 `payload` 中无 `request_id`。

---

## 四、P2：兼容迁移代码只加标记

### `app/models.py` — `remote_binding_enabled(remote)`

- 保留函数。  
- 添加 `@deprecated` docstring。  
- 函数体保持 `return remote_binding_active(remote)`。  
- 可低频调用 `log_deprecated_hit(...)`（见 `app/utils/deprecation_log.py`）。

### `app/utils/bridge_payload.py` — `persist_qsettings_last_url(settings, url)`

- 保留清理旧 key 循环：`last_page_url`、`page_url`、`conversation_url`。  
- 添加注释：旧 QSettings key 迁移清理。  
- 可低频调用 `log_migration_hit(...)`。  
- **不要**删除该循环。

---

## 五、P2：`app/utils/deprecation_log.py`

```python
log_deprecated_hit(name, reason="", replacement="", caller="")
# → [DEPRECATED_HIT] name=... reason=... replacement=... caller=...

log_migration_hit(name, old="", new="", reason="")
# → [MIGRATION_HIT] name=... old=... new=... reason=...
```

- 使用 `logging.getLogger(__name__)`。  
- 不要在高频路径无条件刷日志。

---

## 六、P3：扫描与验收脚本（完整仓库；FILE 快照无 `tools/`）

> FILE 导出快照**不包含**下表脚本。快照验收见文首与 **§九**、**§83.5**。

| 文件 | 作用 |
|------|------|
| `tools/find_dead_code_candidates.py` | 扫描 `app/**/*.py`、`GUI.py`、`client.user.js`；旧 status / deprecated 关键词 / 仅定义无引用；只打印 |
| `tools/find_dynamic_reference_entries.py` | 扫描 `.py/.js/.md`；`.connect` / Flask route / `getattr` / `fetch` / `requests` 等；只打印 |
| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |
| `tools/check_must_keep_symbols.py` | 确认 `legacy_cleanup.py`、guard 函数、`validate_outbound_queue_message` 未被误删 |
| `tools/run_dead_code_cleanup_checks.py` | 串联 compileall + 上述脚本 + 存在则跑 pytest |

`run_dead_code_cleanup_checks.py` 要求：

- 测试文件不存在 → `[CHECK][SKIP]`  
- 任一必需检查或**已存在**的测试失败 → 返回 `1`  
- 全部通过 → 返回 `0`  
- subprocess 输出须打印

---

## 七、P3：文档

- `docs/dead_code_cleanup_rules.md` — 删除规则、动态入口、观察期、命令  
- `docs/dead_code_cleanup_report.md` — 计划/结果模板、已确认候选、观察项、禁止删除项

---

## 八、生成产物规则

审查默认排除：`client.user.js`、`dist/**`、`build/**`、`runtime/**`、`logs/**`、`__pycache__/**`、`.venv/**`、`venv/**`。

---

## 九、快速验证入口

完整分步验收见 **§十一**；失败时按 **§十二** 处理。

**导出快照（无 `tools/`）**：

```bash
python -m compileall -q app GUI.py
cd chatgpt-toolbox && npm run build --silent
```

**完整仓库（存在 `tools/` 时）**：

```bash
python tools/run_dead_code_cleanup_checks.py
```

若改了油猴源码，在完整仓库中可在 build 后再跑 `run_dead_code_cleanup_checks.py`。

---

## 十、验收标准（勾选）

- [ ] `job_scheduler.py` 不再 `job.get("status")` / `j.get("status")`  
- [ ] 状态统一 `job_status_from()`  
- [ ] `DEFAULT_AUTO_CONFIG` 已删除，默认配置仅 `createDefaultAutoConfig()`  
- [ ] `legacy_cleanup.py` 及 guard 函数保留  
- [ ] `validate_outbound_queue_message()` 仍拒绝 `payload.request_id`  
- [ ] `remote_binding_enabled()` 保留并 `@deprecated`  
- [ ] `persist_qsettings_last_url()` 旧 key 循环保留  
- [ ] 扫描脚本只打印、不修改文件  
- [ ] `run_dead_code_cleanup_checks.py` 可运行且通过  
- [ ] 文档齐全  
- [ ] 无 `try/except pass`

---

## 十一、最终验收清单

清理完成后，**按此顺序**验收（标记：`[DEAD_CODE_FINAL_ACCEPTANCE]`）。

> **无 `tools/` 目录时**：只执行下文 **§11.1**（Python compileall）与 **§11.8**（油猴 build，若改过油猴源码）；**跳过** §11.2–§11.6 中所有 `python tools/…` 步骤。

### 1. Python 编译检查

```bash
python -m compileall -q app GUI.py
```

| 通过标准 |
|----------|
| 无输出 |
| 返回码为 `0` |

### 2. 僵尸候选扫描

```bash
python tools/find_dead_code_candidates.py
```

| 通过标准 |
|----------|
| 脚本能正常执行 |
| 只输出候选清单，**不自动修改**文件 |
| 输出中**不能再出现** `job.get("status")` / `j.get("status")` 这类 P0 残留 |

### 3. 动态入口扫描

```bash
python tools/find_dynamic_reference_entries.py
```

| 通过标准 |
|----------|
| 脚本能正常执行 |
| 输出 Qt connect / Flask route / fetch / getattr 等动态入口 |
| 结果**仅作人工确认依据**，不作为直接删除依据 |

### 4. 回归检查

```bash
python tools/check_dead_code_regression.py
```

| 通过标准 |
|----------|
| 输出 `[DEAD_CODE_REGRESSION][OK]` |
| 不再出现 `DEFAULT_AUTO_CONFIG` |
| 不再出现 `job.get("status")` |
| 不再出现 `j.get("status")` |

### 5. must-keep 检查

```bash
python tools/check_must_keep_symbols.py
```

| 通过标准 |
|----------|
| 输出 `[MUST_KEEP_SYMBOLS][OK]` |
| `legacy_cleanup.py` 仍存在 |
| `assert_no_legacy_fields` / `reject_legacy_fields` 仍存在 |
| `validate_outbound_queue_message` 仍存在 |

### 6. 统一验收入口

```bash
python tools/run_dead_code_cleanup_checks.py
```

| 通过标准 |
|----------|
| 输出 `[DEAD_CODE_CLEANUP_CHECKS][OK]` |
| 必需检查全部通过 |
| 缺失可选测试时只显示 `[CHECK][SKIP]`，**不能**异常退出 |

### 7. 业务测试

```bash
pytest -q
```

| 通过标准 |
|----------|
| 已有测试全部通过 |
| `tests/test_job_scheduler_status_migration.py` 通过 |
| `tests/test_bridge_payload_legacy_guard.py` 通过 |

### 8. 油猴构建

```bash
cd chatgpt-toolbox && npm run build
```

| 通过标准 |
|----------|
| 构建成功 |
| `client.user.js` 由源码重新生成（顶部应有 `GENERATED FILE - DO NOT EDIT DIRECTLY`） |
| **不要**手工直接修改生成产物 |

---

## 十二、失败分支处理

跑完验收后，根据输出按下列分支处理。

### 12.1 `check_dead_code_regression.py` 失败

若看到：

```text
[DEAD_CODE_REGRESSION][FAILED]
- app/core/job_scheduler.py: ... job.get("status")
```

**处理方式：**

1. 打开 `app/core/job_scheduler.py`。
2. 搜索 `job.get("status")` 和 `j.get("status")`。
3. 全部改为 `job_status_from(job)` 或 `job_status_from(j)`。
4. 重新运行：`python tools/check_dead_code_regression.py`

**不能用下面这种方式绕过：**

```python
# 错误做法
status = job.get("status") or job.get("job_status")
```

**正确方向：**

```python
status = job_status_from(job)
```

### 12.2 `check_must_keep_symbols.py` 失败

若看到：

```text
[MUST_KEEP_SYMBOLS][FAILED]
- app/utils/legacy_cleanup.py missing symbol assert_no_legacy_fields
```

**处理方式：**

1. **立即回滚**误删文件或误删函数。
2. **不要**把 legacy guard 改成空函数。
3. **不要**把 `ValueError` 改成 `warning`。
4. 恢复后运行：

```bash
python tools/check_must_keep_symbols.py
pytest -q tests/test_bridge_payload_legacy_guard.py
```

> 这类失败说明误删了保护逻辑，不是测试太严格。

### 12.3 `test_bridge_payload_legacy_guard.py` 失败

若拒绝旧字段的测试失败，说明 `payload.request_id` 又能进入队列了。

**错误处理方向：**

1. 检查 `validate_outbound_queue_message()` 是否仍调用 `assert_no_legacy_fields()`。
2. 检查 `LEGACY_FIELD_NAMES` 是否仍包含 `request_id` / `payload.request_id` 的识别逻辑。
3. 检查是否有人把 `ValueError` 改成了静默删除。
4. 恢复 **fail-fast**。

**不要这样修：**

```python
# 错误方向：静默吞掉旧字段
payload.pop("request_id", None)
```

除非上游已明确完成字段迁移，否则静默删除会隐藏真实污染源。

### 12.4 `test_job_scheduler_status_migration.py` 失败

**取消任务仍被发送到 Cursor**

说明 `send_job_to_cursor()` 仍旧没用 `job_status_from()`。

1. 检查 `send_job_to_cursor()`。
2. 确认取消判断为：`if job_status_from(job) == "cancelled":`
3. 确认测试里的 `fake_enqueue_cursor_task` **没有被调用**。

**`pending_chatgpt` 统计失败**

1. 检查 `get_job_scheduler_snapshot()`。
2. 确认统计逻辑为：`job_status_from(j) == "waiting_chatgpt_reply"`
3. **不要**恢复旧 `status` 字段。

### 12.5 `npm run build` 后 `DEFAULT_AUTO_CONFIG` 又出现

若构建后 `rg "DEFAULT_AUTO_CONFIG"` 仍有命中：

说明油猴**源码**里还没删干净，不是生成产物的问题。

**处理方式：**

1. 搜索 `chatgpt-toolbox/tampermonkey-userscript-src/`。
2. 找到 `DEFAULT_AUTO_CONFIG` 的定义和引用。
3. 用 `createDefaultAutoConfig()` / `getDefaultAutoListPromptsText()` 替换。
4. 重新执行：`cd chatgpt-toolbox && npm run build`
5. 再执行：`rg "DEFAULT_AUTO_CONFIG"`

**不要**只改 `client.user.js`——下一次构建会恢复。

---

## 十三、最终不要做的操作

1. **不要**直接删除 `client.user.js`。
2. **不要**手工只改 `client.user.js` 而不改源码。
3. **不要**删除 `legacy_cleanup.py`。
4. **不要**把 `assert_no_legacy_fields()` 改成空函数。
5. **不要**把旧字段 `ValueError` 改成 `warning` 后继续入队。
6. **不要**恢复 `job["status"]` 旧字段。
7. **不要**用 `try/except pass` 包住检查脚本或测试。
8. **不要**因为 `find_dead_code_candidates.py` 输出了某个 Qt 槽函数，就直接删除该槽函数。
9. **不要**因为 Flask route 函数没有 Python 内部调用，就直接删除该 route。
10. **不要**一次性混合提交：Python 调度修复、油猴默认配置清理、legacy guard 调整、文档脚本新增——应分步提交便于回滚。

---

## 十四、最终提交检查

建议最终提交前查看 diff：

```bash
git diff -- app/core/job_scheduler.py
git diff -- tests/test_job_scheduler_status_migration.py
git diff -- tests/test_bridge_payload_legacy_guard.py
git diff -- tools
git diff -- docs
```

**重点确认：**

| 项 | 期望 |
|----|------|
| `job_scheduler.py` | 仅把旧 `status` 读取改为 `job_status_from()`，无扩大改动 |
| `legacy_cleanup.py` | 未被删除 |
| `bridge_payload.py` | 旧字段拒绝逻辑未被弱化 |
| `tools/` | 脚本只检查和打印，不修改业务文件 |
| `docs/` | 仅规则与记录，不影响运行时 |
| 油猴 | 源码删除 `DEFAULT_AUTO_CONFIG` 后，`client.user.js` 是构建产物更新，非手工乱改 |

---

## 十五、最终文件变更清单（§58）

落地完成后，仓库应呈现如下**新增/修改边界**（`[必改]` / `[建议]` / `[可选]` / `[构建产物]`）。

```text
chatgpt-flask-bridge/
├── app/
│   ├── core/
│   │   └── job_scheduler.py              [必改] 旧 status 读取 → job_status_from()
│   ├── models.py                           [可选] remote_binding_enabled() 仅 @deprecated 注释
│   ├── constants.py                        [可选] 确认无引用后才删 P3 常量/函数
│   └── utils/
│       ├── bridge_payload.py               [可选] persist_qsettings 旧 key 循环加 migration 注释
│       └── deprecation_log.py              [可选] 低频兼容命中日志
├── chatgpt-toolbox/
│   └── tampermonkey-userscript-src/**      [必改-P1] 删 DEFAULT_AUTO_CONFIG，唯一入口 createDefaultAutoConfig()
├── client.user.js                          [构建产物] npm run build 同步，禁止手工直改
├── tests/
│   ├── test_job_scheduler_status_migration.py   [建议]
│   └── test_bridge_payload_legacy_guard.py      [建议]
├── tools/
│   ├── find_dead_code_candidates.py             [建议] 只读扫描，不自动删
│   ├── find_dynamic_reference_entries.py        [建议]
│   ├── check_dead_code_regression.py            [建议]
│   ├── check_must_keep_symbols.py               [建议]
│   └── run_dead_code_cleanup_checks.py          [建议] 一键串联
└── docs/
    ├── dead_code_cleanup_rules.md               [建议]
    ├── dead_code_cleanup_report.md              [建议]
    └── cursor_dead_code_cleanup_master_task.md  [本文]
```

### 15.1 必改：`app/core/job_scheduler.py`

| 位置 | 改动 |
|------|------|
| `send_job_to_cursor()` | 不再 `job.get("status")`，用 `job_status_from(job)` |
| `get_job_scheduler_snapshot()` | 不再 `j.get("status")`，用 `job_status_from(j)` |
| 全局 | 任务状态判断统一走 `job_status_from()` |

**禁止：**

1. 不要恢复 `job["status"]`。
2. 不要删除 `job_status_from()`。
3. 不要删除 `_migrate_job_status_inplace()`。
4. 不要把 `job_status_from()` 改成简单读 `job["job_status"]`（仍承担旧字段兼容迁移）。

### 15.2 建议新增测试

| 文件 | 用途 |
|------|------|
| `tests/test_job_scheduler_status_migration.py` | 防止迁移后再次读取旧 `status` |
| `tests/test_bridge_payload_legacy_guard.py` | 防止 `legacy_cleanup.py` / `assert_no_legacy_fields()` 被误删或弱化 |

### 15.3 建议新增工具（只读，返回码驱动 CI）

| 文件 | 用途 |
|------|------|
| `tools/find_dead_code_candidates.py` | 输出候选僵尸代码，不自动删除 |
| `tools/find_dynamic_reference_entries.py` | Qt / Flask / fetch / getattr 等动态入口 |
| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |
| `tools/check_must_keep_symbols.py` | 防 legacy guard 关键符号被删 |
| `tools/run_dead_code_cleanup_checks.py` | 一键串联上述检查 + 可选 pytest |

### 15.4 建议新增文档

| 文件 | 用途 |
|------|------|
| `docs/dead_code_cleanup_rules.md` | 能删 / 不能删 / 观察项判定规则 |
| `docs/dead_code_cleanup_report.md` | 删除计划、结果、回滚方案记录 |

### 15.5 可选修改（低优先级，勿与 P0 混提）

| 文件 | 边界 |
|------|------|
| `app/models.py` | `remote_binding_enabled()` 只加 `@deprecated` 注释，不删函数 |
| `app/utils/bridge_payload.py` | `persist_qsettings_last_url()` 旧 key 清理循环只加 migration 注释 |
| `app/utils/deprecation_log.py` | 新增低频兼容命中日志函数 |
| `app/constants.py` | **仅**在确认无引用后删 `PENDING_REPLY_STALE_TIMEOUT_SEC` / `status_chip_text()` |

### 15.6 油猴与构建产物

| 路径 | 原则 |
|------|------|
| `chatgpt-toolbox/tampermonkey-userscript-src/**` | `DEFAULT_AUTO_CONFIG` 只在此清理 |
| `client.user.js` | 仅 `cd chatgpt-toolbox && npm run build` 生成；源码无 diff 而产物有 diff = 错误 |

**明确不要改（本轮）：** `app/utils/legacy_cleanup.py` 及其中 `assert_no_legacy_fields()`、`reject_legacy_fields()`、`validate_outbound_queue_message()` 的旧字段拒绝逻辑。

---

## 十六、最终 diff 审查重点（§59）

提交前按路径查看 diff，逐项对照：

```bash
git diff -- app/core/job_scheduler.py
git diff -- tests
git diff -- tools
git diff -- docs
git diff -- app/models.py
git diff -- app/utils/bridge_payload.py
git diff -- app/constants.py
git diff -- chatgpt-toolbox/tampermonkey-userscript-src
git diff -- client.user.js
```

| 路径 | 审查要点 |
|------|----------|
| `job_scheduler.py` | 只替换旧 `status` 读取；不扩大调度逻辑；不新增无关状态 |
| `tests/` | 只验证 dead code / legacy guard；不依赖真实浏览器、网络、Cursor 进程 |
| `tools/` | 只读、打印、退出码；**不**自动删代码、**不**改业务文件 |
| `docs/` | 规则与报告；不影响运行时 |
| `models.py` | 保留 `remote_binding_enabled()`；不改变 `remote_binding_active()` 语义 |
| `bridge_payload.py` | 旧字段拒绝逻辑不能弱化；`persist_qsettings_last_url()` 仍清旧 key |
| `constants.py` | P3 候选须先全库搜索确认无引用 |
| `tampermonkey-userscript-src/` | 删 `DEFAULT_AUTO_CONFIG`；`createDefaultAutoConfig()` 为唯一默认配置入口 |
| `client.user.js` | 只能是构建产物变化 |

---

## 十七、推荐提交拆分（§60）

**不要**一个 commit 塞完全部内容。建议顺序：

| # | 类型 | 包含路径 |
|---|------|----------|
| 1 | `fix:` | `app/core/job_scheduler.py`、`tests/test_job_scheduler_status_migration.py` |
| 2 | `test:` | `tests/test_bridge_payload_legacy_guard.py`、`tools/check_must_keep_symbols.py` |
| 3 | `chore:` | `tools/find_dead_code_candidates.py`、`find_dynamic_reference_entries.py`、`check_dead_code_regression.py`、`run_dead_code_cleanup_checks.py` |
| 4 | `docs:` | `docs/dead_code_cleanup_rules.md`、`docs/dead_code_cleanup_report.md` |
| 5 | `refactor:` | `chatgpt-toolbox/tampermonkey-userscript-src/**`、`client.user.js`（构建） |
| 6 | `chore:` | `app/models.py`、`app/utils/bridge_payload.py`、`app/utils/deprecation_log.py` |
| 7 | `chore:` | `app/constants.py` — **仅当** `PENDING_REPLY_STALE_TIMEOUT_SEC` / `status_chip_text()` 已搜索确认安全 |

---

## 十八、Cursor 总验收指令（§61）

完成修改后**按序**执行，不要跳步：

```bash
# 1. 状态
git status --short

# 2. 关键 diff（同 §59）
git diff -- app/core/job_scheduler.py tests tools docs \
  chatgpt-toolbox/tampermonkey-userscript-src client.user.js

# 3. Python 编译
python -m compileall -q app GUI.py

# 4. 新增测试
pytest -q tests/test_job_scheduler_status_migration.py
pytest -q tests/test_bridge_payload_legacy_guard.py

# 5. dead code 检查
python tools/find_dead_code_candidates.py
python tools/find_dynamic_reference_entries.py
python tools/check_dead_code_regression.py
python tools/check_must_keep_symbols.py
python tools/run_dead_code_cleanup_checks.py

# 6. 若改了油猴源码
cd chatgpt-toolbox && npm run build
rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js

# 7. 全量测试
pytest -q

# 8. 禁止项（应为 0 命中或文件仍存在）
rg 'job\.get\("status"\)|j\.get\("status"\)' app --glob '*.py'
rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js
# 须存在：legacy_cleanup.py、assert_no_legacy_fields、reject_legacy_fields
# validate_outbound_queue_message 仍拒绝 payload.request_id
```

---

## 十九、风险分级（§62）

| 级别 | 项 |
|------|-----|
| **低** | `job.get("status")` / `j.get("status")` → `job_status_from()`；新增扫描脚本、文档、must-keep 检查 |
| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |
| **高（本轮不做删除）** | 删 `legacy_cleanup.py`、`assert_no_legacy_fields()`、Flask route、Qt 槽；手工改 `client.user.js`；弱化旧字段 `ValueError` |

高风险项本轮只能：**保护、测试、标记 deprecated**。

---

## 当前仓库状态（维护者备注，§63）

对照 §58 清单。**区分两种工作区**：

| 类别 | 路径 | FILE 导出快照（~143 文件） | 完整仓库 |
|------|------|---------------------------|----------|
| 必改 | `app/core/job_scheduler.py` | 已用 `job_status_from()` | 同左 |
| 测试 | `tests/test_job_scheduler_status_migration.py` 等 | **通常不在快照内** | 完整仓库可有 |
| 工具 | `tools/find_dead_code_candidates.py` 等 5 个脚本 | **不在快照内**（勿写「已有」） | 完整仓库可有 |
| 防回退 | `scripts/pre_commit_dead_code_check.py` 等 | **通常不在快照内** | 完整仓库可有 |
| CI | `.github/workflows/dead-code-cleanup-checks.yml` | 视快照是否包含 | 完整仓库可有 |
| 文档 | `docs/dead_code_cleanup_rules.md` 等 | 可有 | 可有 |
| 油猴 | `tampermonkey-userscript-src/` | 已无 `DEFAULT_AUTO_CONFIG` | 同左 |
| 可选 | `app/models.py`、`bridge_payload.py`、`deprecation_log.py` | 已加注释/观察日志 | 同左 |

**快照验收**（无 `tools/`）：

```bash
python -m compileall -q app GUI.py
cd chatgpt-toolbox && npm run build --silent
```

**未做 / 观察中（勿强行删）：**

- `app/constants.py` 中 `status_chip_text()` 仍被 UI mixin 引用；`PENDING_REPLY_STALE_TIMEOUT_SEC` 待完整仓库扫描后再决定。

新会话：**快照**从 **§九 / §十一.1 + 油猴 build** 起；**完整仓库**可从 **§十八**（`run_dead_code_cleanup_checks.py`）起。

---

## 六十四、建议接入本地提交前检查（§64）

若不想每次手动运行 `python tools/run_dead_code_cleanup_checks.py`，可安装本地 pre-commit 钩子。

| 路径 | 作用 |
|------|------|
| `scripts/pre_commit_dead_code_check.py` | 调用 `tools/run_dead_code_cleanup_checks.py`，失败返回非 0 |
| `scripts/install_git_hooks.py` | 写入 `.git/hooks/pre-commit` |

```bash
python scripts/pre_commit_dead_code_check.py
python scripts/install_git_hooks.py
```

安装后，每次 `git commit` 前会自动执行统一验收；检查失败时阻止提交。

**Windows**：钩子为 `#!/bin/sh` 脚本，Git for Windows 自带的 Git Bash 可直接执行。

---

## 六十五、可选 GitHub Actions（§66）

`.github/workflows/dead-code-cleanup-checks.yml`：

- 触发：`pull_request`、`push` 到 `main` / `master`
- Python 3.10；安装 `pytest`；若存在则 `pip install -r requirements.txt`
- 运行：`python tools/run_dead_code_cleanup_checks.py`

---

## 六十七、Cursor 指令：接入提交前检查

基于当前代码继续完善僵尸代码清理的防回退机制。**本次只新增本地提交前检查脚本，不修改业务逻辑。**

1. **`scripts/pre_commit_dead_code_check.py`**：执行 `python tools/run_dead_code_cleanup_checks.py`；打印完整 stdout；失败非 0、通过 0；禁止 `try/except pass`。
2. **`scripts/install_git_hooks.py`**：检查 `.git/hooks` 存在；写入 `pre-commit` 调用上一脚本；失败阻止 commit；hooks 目录不存在时返回 1。
3. **可选** `.github/workflows/dead-code-cleanup-checks.yml`：push/PR 时跑同上验收。
4. **验证**：`python scripts/pre_commit_dead_code_check.py`、`python scripts/install_git_hooks.py`。
5. **验收**：两脚本可运行；hook 写入成功；检查失败阻止提交、通过允许提交；不改业务代码。

---

## 六十八、防回退覆盖点（§68）

| 层级 | 机制 |
|------|------|
| 规则与扫描 | `docs/dead_code_cleanup_rules.md`、`tools/find_*`、`check_*` |
| 一键验收 | `tools/run_dead_code_cleanup_checks.py` |
| 本地提交前 | `scripts/pre_commit_dead_code_check.py` + `install_git_hooks.py` |
| 远程 CI | `.github/workflows/dead-code-cleanup-checks.yml`（可选） |

must-keep 保护与回归测试由此从「手动流程」升级为可自动拦截回退。

---

## 六十九、第五批收尾：误删保护 + 验证清单（§69）

第五批**不是**新增大量删除项，而是对第 1–4 批的收尾校正、误删保护、验证清单补齐。详情见 `docs/dead_code_cleanup_report.md` §5.4–§5.10 与 `docs/dead_code_cleanup_rules.md` §22。

### 69.1 结论摘要

| 项 | 结论 |
|----|------|
| 新的低风险 Python 函数 | **无**（出现 1 次的普通方法已基本覆盖） |
| 新的无效 import | **无**（历史候选见 report §5.6；勿删 `from __future__ import annotations`） |
| 油猴 `tickWaitingReplyOrSendOpportunity` | **保留**（setInterval 命名异步 IIFE） |
| Mixin / 状态类 / Cursor worker | **保留**（见 report §5.7） |

### 69.2 Cursor 执行指令（清理时粘贴）

基于当前代码继续清理僵尸代码。**清理前后**必须遵守误删保护，**不要**只依赖 `rg` 函数名出现次数。

**一、禁止误删框架回调**（即使只出现定义）：

- `app/server/__init__.py`：`__getattr__`、`__dir__`
- `app/server/runtime_state.py`：`SilentWSGIRequestHandler.log_request`
- `app/ui/main_window.py`：`MainWindow.closeEvent`
- `app/ui/widgets/no_wheel_combo_box.py`：`NoWheelComboBox.wheelEvent`

**二、禁止误删命名 IIFE**：

- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js`：`tickWaitingReplyOrSendOpportunity`

**三、禁止误删状态类与 Mixin 类**：

- `app/ui/main_window_state.py`：`BridgeUiState`、`PageSelectorState`、`WebSyncState`、`AutoBindState`、`PageCommandUiState`、`BridgeMessageState`、`LogUiState`、`SessionUiState`、`ServerUiState`
- `app/ui/mixins/*.py` 中 Mixin 类
- `app/ui/widgets/*.py` 中仍被 UI 构建实例化的 Widget 类

**四、删除后运行时导入检查**：

```bash
python -m compileall -q app GUI.py
python -c "import app.server; import app.server.runtime_state; import app.ui.main_window; import app.cursor_code.matcher; import app.utils.page_identity; print('runtime import smoke ok')"
```

**五、油猴构建**（改了油猴源码时）：

```bash
cd chatgpt-toolbox && node build.userjs.mjs
```

**六、最终 dead-code `rg`**（已删项应无命中）：

```bash
rg "BridgeQueueFullError|_server_instance_id|_server_start_time" app/server/state.py
rg "CursorMatchResult" app/cursor_code/matcher.py
rg "should_emit_log" app/utils/gui_logging.py
rg "has_page_channel|display_key" app/utils/page_identity.py
rg "is_chatgpt_platform_error_text|_CHATGPT_PLATFORM_ERROR_RE|_CHATGPT_PLATFORM_ERROR_DEPRECATED_LOGGED" app/constants.py
rg "_on_send_to_cursor_clicked" app/ui/mixins/cursor_bridge_mixin.py
rg "clickRealComposerSendButton|copyAndSendHotkeyOnce|isAssistantReallyGeneratingForCopy|forceChatPageToAbsoluteEnd|getChatScrollContainers|forceScrollContainerToEnd" chatgpt-toolbox/tampermonkey-userscript-src
```

**七、保留项检查**（必须仍存在）：

```bash
rg "__getattr__|__dir__" app/server/__init__.py
rg "log_request" app/server/runtime_state.py
rg "closeEvent" app/ui/main_window.py
rg "wheelEvent" app/ui/widgets/no_wheel_combo_box.py
rg "tickWaitingReplyOrSendOpportunity" chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js
python tools/check_must_keep_symbols.py
```

### 69.3 推荐提交拆分（与前几批对齐）

| 提交 | 范围 |
|------|------|
| 1 | `constants.py`、`cursor_bridge_mixin.py`、油猴 `main.js` / `upload-module.js` / `toolbox-shell.js` |
| 2 | `state.py`、`matcher.py`、`gui_logging.py`、`page_identity.py`、`session_list_item.py` |
| 3 | 第三批 UI helper mixins |
| 4 | 第四批页面状态/诊断 mixins |
| 5 | **仅** `page_snapshot.py` 缺失修复（**不要**与 dead code 混在同一 commit） |

### 69.4 删除边界提醒

- `state.py`：删 `_server_instance_id` / `_server_start_time` 后慎删 `import time`
- `matcher.py`：可删 `CursorMatchResult`；勿删模板匹配主链路函数
- `page_identity.py`：删 `has_conversation()` **方法**时勿误删 `"has_conversation"` 字符串或同名局部变量

---

## 八十三、收口复核：低频动态字段与 JS 保留边界（§83）

**结论（本轮）**：按 FILE 还原快照复核后，**未发现新的高置信度函数级 dead code**。本轮价值是把静态扫描易误判的 lazy 字段、日志节流字段、油猴命名闭包列入**禁止误删**边界。

### 83.1 JS：可删 vs 勿删

| 符号 | 文件 | 处理 |
|------|------|------|
| `SEND_STABLE_SINGLE_ATTEMPT_WINDOW_MS` | `upload/upload-module.js` | **可删**（前几批已处理则跳过） |
| `updateCharCount` | `upload/upload-module.js` | **可删**（前几批已处理则跳过） |
| `debouncedSave` | `core/logger.js` | **勿删**（history 补丁 lazy 初始化） |
| `patchedToolboxPushState` | `core/logger.js` | **勿删** |
| `patchedToolboxReplaceState` | `core/logger.js` | **勿删** |
| `tickWaitingReplyOrSendOpportunity` | `upload/upload-module.js` | **勿删**（setInterval 命名异步 IIFE） |

**不要**因 `rg` 只出现一次就扩大 JS 删除范围。

### 83.2 Python：实例 lazy / 信号绑定保护（勿删）

| 字段 | 文件 | 用途 |
|------|------|------|
| `_bound_signal_keys` | `ui_builder_core_mixin.py` | `_connect_signal_once()` 防 Qt signal 重复连接 |
| `_chat_panel_signals_bound` | `ui_chat_panel_mixin.py` | `_bind_chat_panel_signals()` 防重复绑定 |
| `_refresh_page_list_btn_ready` | `ui_page_selector_mixin.py` | `_ensure_tm_page_combo()` 防重复初始化刷新按钮 |
| `_tm_page_selector_connected` | `ui_page_selector_mixin.py` | 页面下拉框信号绑定保护 |
| `_tm_page_selector_row_signals_bound` | `ui_page_selector_mixin.py` | 页面选择器行按钮信号绑定保护 |
| `_tm_action_buttons_ready` | `ui_builder_core_mixin.py` | 页面动作按钮样式/角色初始化保护 |
| `_reply_done_flash_timer` | `session_mixin.py` | 延迟闪烁计时器缓存 |
| `_system_message_once_cache` | `chat_render_mixin.py` | 系统提示去重缓存 |
| `_tm_page_list_log_aggregator` | `page_tm_client_mixin.py` | 页面列表日志聚合器缓存 |
| `_deferred_session_switch_token` | `session_mixin.py` | 会话切换延迟流程 token 校验 |
| `_suspend_status_ui_until` | `session_mixin.py` / `bridge_mixin.py` | 会话切换期间暂停状态 UI 刷新 |

### 83.3 Python：日志节流 / 去重 / 防重入（勿删）

`_action_target_selected_log_at`、`_bind_button_invalid_log_at`、`_chat_header_log_throttle`、`_conv_mismatch_logged_keys`、`_last_applied_snapshot_sig_by_session`、`_last_chat_bind_visual_state`、`_last_cursor_bridge_badge_signature`、`_last_focus_sync_hint_ui_key`、`_last_manual_attach_sync_at`、`_last_manual_attach_sync_key`、`_last_page_liveness_log_key`、`_last_page_relation_target_mismatch_key`、`_last_session_list_status_tick_signature`、`_last_session_list_visual_signature`、`_last_sync_click_at_by_session`、`_last_system_message_at`、`_last_system_message_text`、`_last_tm_summary_log_key`、`_session_cleared_for_rebind_sync`、`_sync_inflight_by_session`、`_wait_conversation_sync_by_session`

**判断规则**：同一流程里既有 `getattr(..., None)` 读取又有赋值更新，且用途为节流、去重、防重复绑定、防重入 → **不是** dead code。

### 83.4 真僵尸字段（与 §83.2–83.3 不同，可删）

仅**只写不读**或业务已废弃的字段，例如：`_last_cursor_bridge_status`、`_tm_liveness_counts`、`_enable_lan_access` / `_host`、`_show_raw_payload`、`_log_ack_events`、`_log_assistant_reply_events`、`_log_send_failed_events`（前几批已处理则跳过）。

### 83.5 本轮 Cursor 指令（收口，勿重复前几批函数清理）

1. **JS**：只处理 `SEND_STABLE_SINGLE_ATTEMPT_WINDOW_MS`、`updateCharCount`（若仍存在）；勿删 §83.1「勿删」项。
2. **Python**：勿按出现次数少批量删除 §83.2–83.3 字段；不做无关重构；禁止 `try/except pass`。
3. **文档**：`tools/*` 在 FILE 快照中**不可执行**；验收以 §九 两条命令为准。
4. **验证**：

```bash
python -m compileall -q app GUI.py
cd chatgpt-toolbox && npm run build --silent
rg "tools/|python tools/|已有" docs/cursor_dead_code_cleanup_master_task.md
```

对 `rg` 命中逐条确认：历史方案说明可保留；写成「当前快照可直接跑 tools」的表述必须改掉。

---

## 八十四、收口复核：`from __future__ import annotations` 扫描边界（§84）

**结论（本轮）**：还原 `0_merged_for_chatgpt(434).zip`（143 文件）后，`python -m compileall -q app GUI.py` 与 `cd chatgpt-toolbox && npm run build --silent` 均通过；**未发现新的高置信度可删除函数**。本轮补充的是 unused-import **误删边界**，不是新的函数级删除项。

### 84.1 问题

简易 unused-import 脚本会把大量文件里的：

```python
from __future__ import annotations
```

误报为未使用 import（文件内不会出现名为 `annotations` 的运行时引用）。

### 84.2 禁止删除

| 范围 | 处理 |
|------|------|
| `app/client/*.py` | **保留** |
| `app/server/*.py` | **保留** |
| `app/ui/main_window_state.py` | **保留** |
| `app/utils/*.py` | **保留** |
| `app/ui/mixins/*.py` | **保留** |
| `app/ui/widgets/*.py` | **保留** |
| 任意使用上述 future import 的 `.py` | **保留** |

**不要**因「本文件没有使用 `annotations` 这个名字」而删除该行。

### 84.3 原因（风险 > 收益）

1. 改变类型注解求值方式（延迟 vs 立即）。
2. 不是普通运行时变量导入。
3. 删除后可能导致前向引用、循环导入或 Python 版本兼容问题。
4. 对 dataclass / 类型别名 / 联合类型标注文件尤其不值得冒险。

### 84.4 扫描器与文档

| 机制 | 说明 |
|------|------|
| `tools/find_python_dead_statements.py` | `IGNORE_IMPORT_NAMES` 含 `__future__`，不输出 `[UNUSED_IMPORT_CANDIDATE]` |
| `docs/dead_code_ignore_manifest.json` | `keep-future-annotations-import-global`（`app/**/*.py`） |
| `docs/dead_code_cleanup_rules.md` | §3.3、§10.2 第 1 条 |

外部/简易 unused-import 工具须显式忽略 `from __future__ import annotations`。

### 84.5 本轮 Cursor 指令（勿重复前几批函数清理）

1. **不要**删除 `from __future__ import annotations`。
2. 若清理 unused import，**只**处理普通 `import` / `from xxx import yyy`。
3. **不要**重复前几批已处理的函数级 dead code 删除。
4. 不做无关重构；禁止 `try/except pass`。
5. **验证**（精简包必跑）：

```bash
python -m compileall -q app GUI.py
cd chatgpt-toolbox && npm run build --silent
```
