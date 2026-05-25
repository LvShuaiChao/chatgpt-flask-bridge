# Dead Code Cleanup Baseline

created_at=2026-05-25T01:47:35
python=D:\program\miniconda3\python.exe

## 1. Key File Hashes

| path | exists | sha256 |
|---|---:|---|
| `app/core/job_scheduler.py` | `True` | `fa9c2eb0b4742c0b5253e17c84deb1a1fddacb4d4abaa6765d36ad1e84938543` |
| `app/utils/legacy_cleanup.py` | `True` | `339c52c1867e702ece203b9eea374b98a8430307f26bfe35a580532d25e9b548` |
| `app/utils/bridge_payload.py` | `True` | `a2f7194623a9dc9263e71439b52dc264eb0fb7aff5a14b916b39d60b94ba2760` |
| `app/models.py` | `True` | `fc892d45b67985017b823b0094d86bc88cd47272a28cd6f7aec682857f7e1af4` |
| `app/constants.py` | `True` | `badc935528713421a685bd3e849cd51c72c91336f8311b7f81bc1e05a2af4851` |

## 生成产物说明

以下文件由 `cd chatgpt-toolbox && npm run build` 生成（见 `chatgpt-toolbox/build.userjs.mjs`），**不作为**当前导出源码快照的强制存在项，也**不做** sha256 强校验：

- `client.user.js`（仓库根目录同步副本）
- `chatgpt-toolbox/dist/client.user.js`

验证方式：

- 禁止手工编辑上述文件；源码审查对象是 `chatgpt-toolbox/tampermonkey-userscript-src/`。
- 需要产物时运行 `npm run build`；构建后可用 `rg` 在产物中做回归检查（例如 `DEFAULT_AUTO_CONFIG`），但勿把产物 hash 当作快照基线。

合并导出快照（`0_merged_for_chatgpt*.zip`）通常**不收录**上述文件；缺失不代表 dead code，也不应手工补写。

## 2. Must-Keep Symbols

| path | symbol | exists |
|---|---|---:|
| `app/utils/legacy_cleanup.py` | `LEGACY_FIELD_NAMES` | `True` |
| `app/utils/legacy_cleanup.py` | `assert_no_legacy_fields` | `True` |
| `app/utils/legacy_cleanup.py` | `reject_legacy_fields` | `True` |
| `app/utils/bridge_payload.py` | `validate_outbound_queue_message` | `True` |
| `app/utils/bridge_payload.py` | `assert_no_legacy_fields` | `True` |

## 3. rg Checks

以下结果用于记录清理前状态，不代表全部都要删除。

### job_get_status

pattern=`job.get\("status"\)`

```text
docs/cursor_dead_code_cleanup_master_task.md:44:   将 `if job.get("status") == "cancelled":`  
docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |
docs/cursor_dead_code_cleanup_master_task.md:187:- [ ] `job_scheduler.py` 不再 `job.get("status")` / `j.get("status")`  
docs/cursor_dead_code_cleanup_master_task.md:226:| 输出中**不能再出现** `job.get("status")` / `j.get("status")` 这类 P0 残留 |
docs/cursor_dead_code_cleanup_master_task.md:250:| 不再出现 `job.get("status")` |
docs/cursor_dead_code_cleanup_master_task.md:314:- app/core/job_scheduler.py: ... job.get("status")
docs/cursor_dead_code_cleanup_master_task.md:320:2. 搜索 `job.get("status")` 和 `j.get("status")`。
docs/cursor_dead_code_cleanup_master_task.md:328:status = job.get("status") or job.get("job_status")
docs/cursor_dead_code_cleanup_master_task.md:490:| `send_job_to_cursor()` | 不再 `job.get("status")`，用 `job_status_from(job)` |
docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |
docs/cursor_dead_code_cleanup_master_task.md:637:| **低** | `job.get("status")` / `j.get("status")` → `job_status_from()`；新增扫描脚本、文档、must-keep 检查 |
docs/cursor_dead_code_cleanup_master_task.md:651:| 必改 | `app/core/job_scheduler.py` | 已用 `job_status_from()`，业务代码无 `job.get("status")` / `j.get("status")` |
docs/dead_code_cleanup_report.md:66:symbol=job.get("status") == "cancelled"
docs/dead_code_cleanup_report.md:187:symbol=job.get("status") / j.get("status")
docs/dead_code_cleanup_report.md:306:- 若回滚后 `rg` 再次命中 `job.get("status")` / `j.get("status")`，说明旧问题会重现；此状态**只能临时止血**，必须在排查后重新改为 `job_status_from(...)` 并补测试。
tools/check_dead_code_docs_consistency.py:34:    'job.get("status") == "cancelled"',
tools/check_dead_code_docs_consistency.py:47:    'job.get("status") == "cancelled"',
tools/check_dead_code_regression.py:36:        "forbidden": 'job.get("status")',
tools/find_dead_code_candidates.py:36:    'job.get("status")',
app/ui/mixins/_ui_builder_mixin_monolith.py.bak:292:            status = (job.get("status") or "").strip()
```

### j_get_status

pattern=`j.get\("status"\)`

```text
docs/cursor_dead_code_cleanup_master_task.md:49:   `j.get("status") == "waiting_chatgpt_reply"`  
docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |
docs/cursor_dead_code_cleanup_master_task.md:187:- [ ] `job_scheduler.py` 不再 `job.get("status")` / `j.get("status")`  
docs/cursor_dead_code_cleanup_master_task.md:226:| 输出中**不能再出现** `job.get("status")` / `j.get("status")` 这类 P0 残留 |
docs/cursor_dead_code_cleanup_master_task.md:251:| 不再出现 `j.get("status")` |
docs/cursor_dead_code_cleanup_master_task.md:320:2. 搜索 `job.get("status")` 和 `j.get("status")`。
docs/cursor_dead_code_cleanup_master_task.md:491:| `get_job_scheduler_snapshot()` | 不再 `j.get("status")`，用 `job_status_from(j)` |
docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |
docs/cursor_dead_code_cleanup_master_task.md:637:| **低** | `job.get("status")` / `j.get("status")` → `job_status_from()`；新增扫描脚本、文档、must-keep 检查 |
docs/cursor_dead_code_cleanup_master_task.md:651:| 必改 | `app/core/job_scheduler.py` | 已用 `job_status_from()`，业务代码无 `job.get("status")` / `j.get("status")` |
docs/dead_code_cleanup_report.md:83:symbol=j.get("status") == "waiting_chatgpt_reply"
docs/dead_code_cleanup_report.md:187:symbol=job.get("status") / j.get("status")
docs/dead_code_cleanup_report.md:306:- 若回滚后 `rg` 再次命中 `job.get("status")` / `j.get("status")`，说明旧问题会重现；此状态**只能临时止血**，必须在排查后重新改为 `job_status_from(...)` 并补测试。
tools/check_dead_code_docs_consistency.py:35:    'j.get("status") == "waiting_chatgpt_reply"',
tools/check_dead_code_docs_consistency.py:48:    'j.get("status") == "waiting_chatgpt_reply"',
tools/check_dead_code_regression.py:44:        "forbidden": 'j.get("status")',
tools/find_dead_code_candidates.py:38:    'j.get("status")',
```

### default_auto_config

pattern=`DEFAULT_AUTO_CONFIG`

```text
docs/cursor_dead_code_cleanup_master_task.md:30:| 6 | 油猴 `DEFAULT_AUTO_CONFIG` → `getDefaultAutoListPromptsText()`，再 `npm run build` |
docs/cursor_dead_code_cleanup_master_task.md:78:3. 将所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 替换为 `getDefaultAutoListPromptsText()`。  
docs/cursor_dead_code_cleanup_master_task.md:79:4. 删除 `DEFAULT_AUTO_CONFIG` 常量。  
docs/cursor_dead_code_cleanup_master_task.md:80:5. 确认全项目无 `DEFAULT_AUTO_CONFIG`。  
docs/cursor_dead_code_cleanup_master_task.md:142:| `tools/check_dead_code_regression.py` | 禁止 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |
docs/cursor_dead_code_cleanup_master_task.md:189:- [ ] `DEFAULT_AUTO_CONFIG` 已删除，默认配置仅 `createDefaultAutoConfig()`  
docs/cursor_dead_code_cleanup_master_task.md:249:| 不再出现 `DEFAULT_AUTO_CONFIG` |
docs/cursor_dead_code_cleanup_master_task.md:396:### 12.5 `npm run build` 后 `DEFAULT_AUTO_CONFIG` 又出现
docs/cursor_dead_code_cleanup_master_task.md:398:若构建后 `rg "DEFAULT_AUTO_CONFIG"` 仍有命中：
docs/cursor_dead_code_cleanup_master_task.md:405:2. 找到 `DEFAULT_AUTO_CONFIG` 的定义和引用。
docs/cursor_dead_code_cleanup_master_task.md:408:5. 再执行：`rg "DEFAULT_AUTO_CONFIG"`
docs/cursor_dead_code_cleanup_master_task.md:450:| 油猴 | 源码删除 `DEFAULT_AUTO_CONFIG` 后，`client.user.js` 是构建产物更新，非手工乱改 |
docs/cursor_dead_code_cleanup_master_task.md:469:│   └── tampermonkey-userscript-src/**      [必改-P1] 删 DEFAULT_AUTO_CONFIG，唯一入口 createDefaultAutoConfig()
docs/cursor_dead_code_cleanup_master_task.md:514:| `tools/check_dead_code_regression.py` | 防 `job.get("status")`、`j.get("status")`、`DEFAULT_AUTO_CONFIG` 回归 |
docs/cursor_dead_code_cleanup_master_task.md:538:| `chatgpt-toolbox/tampermonkey-userscript-src/**` | `DEFAULT_AUTO_CONFIG` 只在此清理 |
docs/cursor_dead_code_cleanup_master_task.md:570:| `tampermonkey-userscript-src/` | 删 `DEFAULT_AUTO_CONFIG`；`createDefaultAutoConfig()` 为唯一默认配置入口 |
docs/cursor_dead_code_cleanup_master_task.md:619:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js
docs/cursor_dead_code_cleanup_master_task.md:626:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js
docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |
docs/cursor_dead_code_cleanup_master_task.md:658:| 油猴 | `tampermonkey-userscript-src/` | 已无 `DEFAULT_AUTO_CONFIG` |
docs/dead_code_cleanup_manifest.json:31:        "symbol": "DEFAULT_AUTO_CONFIG",
docs/dead_code_cleanup_manifest.json:37:          "rg \"DEFAULT_AUTO_CONFIG\""
docs/dead_code_cleanup_report.md:100:symbol=DEFAULT_AUTO_CONFIG
docs/dead_code_cleanup_report.md:108:**处理建议**：`result=replace_then_delete` — 先用 `getDefaultAutoListPromptsText()` 替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用，再删除 `DEFAULT_AUTO_CONFIG`。
docs/dead_code_cleanup_report.md:197:symbol=DEFAULT_AUTO_CONFIG
docs/dead_code_cleanup_report.md:199:tests=npm run build; client.user.js 无 DEFAULT_AUTO_CONFIG
docs/dead_code_cleanup_report.md:311:### 8.2 P1：`DEFAULT_AUTO_CONFIG` 回滚
docs/dead_code_cleanup_report.md:321:油猴构建后若自动指令、Prompt 列表、列表模式默认文本异常，先检查 `getDefaultAutoListPromptsText()` 是否已完整替换所有 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用。
docs/dead_code_cleanup_report.md:324:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js
docs/dead_code_cleanup_report.md:340:rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js
docs/dead_code_cleanup_report.md:346:- 回滚后 `DEFAULT_AUTO_CONFIG` 与 `createDefaultAutoConfig()` 重复的问题**仍然存在**，不要长期停在回滚态。
docs/dead_code_cleanup_report.md:349:  2. 只替换 `DEFAULT_AUTO_CONFIG.listPromptsText` 引用
docs/dead_code_cleanup_report.md:350:  3. 只删除 `DEFAULT_AUTO_CONFIG`
docs/dead_code_cleanup_rules.md:121:| 构建后仍有 `DEFAULT_AUTO_CONFIG` | 源码未清干净 | §12.5：改 `tampermonkey-userscript-src/`，再 `npm run build` |
tools/check_dead_code_docs_consistency.py:36:    "DEFAULT_AUTO_CONFIG",
tools/check_dead_code_docs_consistency.py:49:    "DEFAULT_AUTO_CONFIG",
tools/check_dead_code_regression.py:52:        "forbidden": "DEFAULT_AUTO_CONFIG",
tools/check_dead_code_regression.py:54:            "生成产物中不应再出现 DEFAULT_AUTO_CONFIG；"
tools/create_dead_code_cleanup_baseline.py:36:    ("default_auto_config", "DEFAULT_AUTO_CONFIG"),
tools/find_dead_code_candidates.py:25:    "DEFAULT_AUTO_CONFIG",
```

### pending_reply_stale_timeout

pattern=`PENDING_REPLY_STALE_TIMEOUT_SEC`

```text
docs/cursor_dead_code_cleanup_master_task.md:33:| 9 | 根据扫描结果再决定是否处理 `PENDING_REPLY_STALE_TIMEOUT_SEC`、`status_chip_text()` 等低优先级候选 |
docs/cursor_dead_code_cleanup_master_task.md:532:| `app/constants.py` | **仅**在确认无引用后删 `PENDING_REPLY_STALE_TIMEOUT_SEC` / `status_chip_text()` |
docs/cursor_dead_code_cleanup_master_task.md:587:| 7 | `chore:` | `app/constants.py` — **仅当** `PENDING_REPLY_STALE_TIMEOUT_SEC` / `status_chip_text()` 已搜索确认安全 |
docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |
docs/cursor_dead_code_cleanup_master_task.md:663:- `app/constants.py` 中 `status_chip_text()` 仍被 UI mixin 引用；`PENDING_REPLY_STALE_TIMEOUT_SEC` 见 `find_dead_code_candidates.py` 输出后再决定。
docs/dead_code_cleanup_manifest.json:60:        "symbol": "PENDING_REPLY_STALE_TIMEOUT_SEC",
docs/dead_code_cleanup_report.md:227:symbol=PENDING_REPLY_STALE_TIMEOUT_SEC
docs/dead_code_cleanup_report.md:231:tests=python -m compileall -q app GUI.py && rg "PENDING_REPLY_STALE_TIMEOUT_SEC" app GUI.py
docs/dead_code_cleanup_report.md:238:symbol=PENDING_REPLY_STALE_TIMEOUT_SEC
docs/dead_code_cleanup_rules.md:160:- `PENDING_REPLY_STALE_TIMEOUT_SEC`
tools/check_dead_code_docs_consistency.py:51:    "PENDING_REPLY_STALE_TIMEOUT_SEC",
tools/create_dead_code_cleanup_baseline.py:37:    ("pending_reply_stale_timeout", "PENDING_REPLY_STALE_TIMEOUT_SEC"),
```

### status_chip_text

pattern=`status_chip_text`

```text
app/constants.py:248:def status_chip_text(prefix, state):
docs/cursor_dead_code_cleanup_master_task.md:33:| 9 | 根据扫描结果再决定是否处理 `PENDING_REPLY_STALE_TIMEOUT_SEC`、`status_chip_text()` 等低优先级候选 |
docs/cursor_dead_code_cleanup_master_task.md:532:| `app/constants.py` | **仅**在确认无引用后删 `PENDING_REPLY_STALE_TIMEOUT_SEC` / `status_chip_text()` |
docs/cursor_dead_code_cleanup_master_task.md:587:| 7 | `chore:` | `app/constants.py` — **仅当** `PENDING_REPLY_STALE_TIMEOUT_SEC` / `status_chip_text()` 已搜索确认安全 |
docs/cursor_dead_code_cleanup_master_task.md:638:| **中** | 删 `DEFAULT_AUTO_CONFIG`；油猴默认配置来源替换；删 `PENDING_REPLY_STALE_TIMEOUT_SEC`；删/内联 `status_chip_text()` |
docs/cursor_dead_code_cleanup_master_task.md:663:- `app/constants.py` 中 `status_chip_text()` 仍被 UI mixin 引用；`PENDING_REPLY_STALE_TIMEOUT_SEC` 见 `find_dead_code_candidates.py` 输出后再决定。
docs/dead_code_cleanup_manifest.json:68:        "symbol": "status_chip_text(prefix, state)",
docs/dead_code_cleanup_report.md:248:symbol=status_chip_text(prefix, state)
docs/dead_code_cleanup_report.md:259:symbol=status_chip_text(prefix, state)
docs/dead_code_cleanup_rules.md:161:- `status_chip_text()`
tools/check_dead_code_docs_consistency.py:52:    "status_chip_text(prefix, state)",
tools/create_dead_code_cleanup_baseline.py:38:    ("status_chip_text", "status_chip_text"),
tools/find_dead_code_candidates.py:32:    "status_chip_text",
app/ui/mixins/page_binding_display_mixin.py:9:    status_chip_text,
app/ui/mixins/page_binding_display_mixin.py:695:                chip_text = status_chip_text(
app/ui/mixins/ui_status_compact_mixin.py:417:            status_chip_text,
app/ui/mixins/ui_status_compact_mixin.py:429:                status_chip_text(STATUS_CHIP_SESSION_BIND_PREFIX, "未绑定"),
app/ui/mixins/ui_status_compact_mixin.py:460:        return status_chip_text(STATUS_CHIP_SESSION_BIND_PREFIX, state_text), chip, tip
app/ui/mixins/_ui_builder_mixin_monolith.py.bak:10:    status_chip_text,
app/ui/mixins/_ui_builder_mixin_monolith.py.bak:2112:            status_chip_text(STATUS_CHIP_SESSION_BIND_PREFIX, "未绑定")
```
