# Dead Code Cleanup PR

> 本 PR 涉及僵尸代码删除或清理。请逐项填写，**禁止**仅凭扫描脚本输出直接批量删除。
>
> 使用方式：在 GitHub 创建 PR 时，将本文件内容复制到 PR 描述中；或从仓库根目录打开本文件对照填写。
>
> **当前精简代码包**通常不含 `tools/`、`tests/`、独立 `server.py`。以下 §3–§4 为**当前可执行**验收命令。含 `python tools/…` 的完整 dead-code 工具链仅适用于恢复 `tools/` 目录后的完整开发仓库（见 `docs/dead_code_cleanup_rules.md` §0）。

---

## 1. 清理目标

本 PR 清理的对象：

```text
path=
symbol=
type=
```

`type` 只能填写以下之一：

- `replace_then_remove`
- `observe_before_remove`
- `must_keep_protection`
- `unused_import`
- `unreachable_statement`
- `commented_out_code`
- `orphan_module`
- `stale_test`
- `dead_config_key`
- `dead_artifact_file`

---

## 2. 判定依据

请勾选（全部确认后方可合并）：

- [ ] 已确认**不是** Qt 信号槽入口
- [ ] 已确认**不是** Flask route / Blueprint 入口
- [ ] 已确认**不是** fetch / requests 调用入口
- [ ] 已确认**不是** getattr / setattr / importlib 动态入口
- [ ] 已确认**不是** legacy guard
- [ ] 已确认**不是** migration / fallback / debug 低频逻辑
- [ ] 已确认**不是**生成产物源码入口误判
- [ ] 已确认**不是**测试中故意构造旧字段验证 guard

说明：

```text
reason=
evidence=
```

（`evidence` 可附 `rg` 输出摘要、manifest 条目、日志片段或相关 issue/讨论链接。）

---

## 3. 静态检查结果（当前精简包）

删除前至少执行：

```bash
python -m compileall -q app GUI.py
rg "函数名|变量名|常量名" app GUI.py client.user.js chatgpt-toolbox/tampermonkey-userscript-src
```

结果摘要：

```text
summary=
```

### 3.1 可选：完整开发仓库（含 `tools/` 时）

仅当仓库根目录存在 `tools/run_dead_code_cleanup_checks.py` 时追加运行（**勿**在精简包中当作必跑项）：

```bash
python tools/find_dead_code_candidates.py
python tools/find_python_dead_statements.py
python tools/find_dynamic_reference_entries.py
python tools/check_dead_code_regression.py
python tools/check_must_keep_symbols.py
python tools/check_dead_code_manifest.py
python tools/check_dead_code_docs_consistency.py
python tools/run_dead_code_cleanup_checks.py
```

---

## 4. 测试结果

**当前精简包必跑：**

```bash
python -m compileall -q app GUI.py
cd chatgpt-toolbox && npm run build --silent
```

**完整开发仓库**（存在 `tests/` 与 `tools/` 时）可追加：

```bash
pytest -q
python tools/run_dead_code_cleanup_checks.py
```

**仅当修改了油猴源码**（`chatgpt-toolbox/tampermonkey-userscript-src/` 或 `build.userjs.mjs`）时，还必须确认构建通过，并可选用：

```bash
cd chatgpt-toolbox && npm run build
rg "DEFAULT_AUTO_CONFIG" chatgpt-toolbox/tampermonkey-userscript-src client.user.js
```

测试结果：

```text
python_compile=
npm_build=
pytest=              # 精简包填 N/A
dead_code_checks=    # 无 tools/ 时填 N/A
rg_default_auto_config=   # 未改油猴源码填 N/A
```

---

## 5. 手工冒烟结果

至少填写（`pass` / `fail` / `N/A` + 简要说明）：

```text
gui_start=
bridge_embedded_server=   # 桥接由 GUI 内嵌启动；无独立 server.py 时填 N/A
page_bind_refresh=
prompt_send=
upload_flow=
cursor_flow=
tampermonkey_load=
log_errors=
```

（详细步骤见 `docs/dead_code_manual_smoke_test.md`。）

---

## 6. 回滚方案

```text
rollback_command=
post_rollback_tests=
remaining_risk=
```

（`rollback_command` 示例：`git revert <commit>` 或 `git restore --source=<parent> -- <paths>`。）

`post_rollback_tests` 精简包示例：`python -m compileall -q app GUI.py && cd chatgpt-toolbox && npm run build --silent`

---

## 7. 禁止事项确认

请勾选（任一项未满足则**不得合并**）：

- [ ] 没有删除 `legacy_cleanup.py`
- [ ] 没有删除 `assert_no_legacy_fields()`
- [ ] 没有删除 `reject_legacy_fields()`
- [ ] 没有弱化 `validate_outbound_queue_message()`
- [ ] 没有恢复 `job["status"]`
- [ ] 没有手工直接修改生成产物 `client.user.js`（须通过 `npm run build`）
- [ ] 没有引入 `try/except pass` 或空 `except` 吞错
- [ ] 没有删除 `from __future__ import annotations`（非普通 unused import，见 `docs/dead_code_cleanup_rules.md` §3.3）

---

## 评审人速查

| 检查项 | 通过标准 |
|--------|----------|
| 清理范围 | `path` / `symbol` / `type` 与 diff 一致，单次 PR 不宜过大 |
| 动态入口 | §2 八项均已勾选且有 `reason` / `evidence` |
| 自动化 | §4 精简包两项必跑通过；油猴改动含 build + 可选 `rg` |
| 冒烟 | §5 核心路径无回归；`log_errors` 无新增异常 |
| 回滚 | §6 可执行且 `remaining_risk` 已说明 |
| 护栏 | §7 全部勾选；有 `tools/` 时 `check_must_keep_symbols` 亦应通过 |

相关文档：`docs/dead_code_cleanup_rules.md`、`docs/dead_code_cleanup_manifest.json`、`docs/dead_code_manual_smoke_test.md`。
