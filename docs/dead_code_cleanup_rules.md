# Dead Code Cleanup Rules

本文档用于约束当前项目的僵尸代码清理流程，避免误删低频但关键的运行入口。

**给 Cursor 的一次性总控指令**：见 [`cursor_dead_code_cleanup_master_task.md`](cursor_dead_code_cleanup_master_task.md)。

## 0. 精简发布包 vs 完整开发仓库

**当前精简代码包**（常见导出/压缩快照）通常只包含：

- `GUI.py`、`app/`、`chatgpt-toolbox/tampermonkey-userscript-src/`、`chatgpt-toolbox/build.userjs.mjs`、`docs/`、`.github/`、`requirements.txt`、`README.md`

通常**不包含**：`tools/`、`tests/`、仓库根目录独立 `server.py`、生成产物（`client.user.js`、`chatgpt-toolbox/dist/client.user.js`）、`__pycache__/`、`*.pyc`、`.gitignore`（导出脚本可能过滤）。

生成产物由 `cd chatgpt-toolbox && npm run build` 产生；导出快照**可以没有**它们，不能据此判 dead code 或要求手工补文件。

因此：

1. **勿**将下文 `python tools/…` 当作精简包的可执行验收命令；恢复 `tools/` 目录后方可使用 §4.2 / §21 所列脚本。
2. Python 编译与 `rg` 入口统一为 **`GUI.py`**（不是 `gui.py` / `server.py`）。桥接服务由 `GUI.py` 启动时内嵌 `app/server/`，无独立 `server.py` 启动步骤。
3. GitHub Actions：`.github/workflows/dead-code-cleanup-checks.yml` 对精简包仅跑 `compileall` + 油猴 `npm run build`；完整仓库可再本地或 CI 中追加 `python tools/run_dead_code_cleanup_checks.py`。

**精简包删除后最低验证：**

```bash
python -m compileall -q app GUI.py
cd chatgpt-toolbox && npm run build --silent
```

### 0.1 合并导出包（`0_merged_for_chatgpt*.zip`）复核

`export_for_chatgpt.py` 生成的 zip **不是**原始目录树，解压后通常只有 `0_merged_for_chatgpt.txt`（全项目按 `FILE:` 行分隔合并）。复核 dead code 时须：

1. 按 `FILE:` 分隔符还原临时文件树（或直接在合并文本内按路径检索）。
2. 以合并文本中列出的**各文件内容**判断死活，勿把「单个 txt」当成项目结构。
3. 合并导出**不应**包含 `__pycache__/`、`*.pyc`；当前复核过的导出快照（如 `0_merged_for_chatgpt(434).zip` 还原后）通常**没有**这些路径——勿写成「当前包里包含 pyc」。若将来导出出现 pyc，视为导出污染，从工作区删除并确认 `.gitignore` 含 `__pycache__/`、`*.pyc`（`export_for_chatgpt.py` 默认已排除）。
4. 合并导出**不收录** `client.user.js`、`chatgpt-toolbox/dist/client.user.js`；缺失正常。油猴逻辑以 `tampermonkey-userscript-src/` 为准；根目录 `client.user.js` 由 **Git 提交**跟踪（`npm run build` 后提交），便于按提交恢复 Tampermonkey 单文件。

### 0.2 静态 import 图：不可误删的模块

从 `GUI.py` 出发的静态 import 图**不能**作为唯一删除依据。以下即使「不可达」也须保留：

| 路径 | 原因 |
|------|------|
| `app/client/bridge_client.py` | 外部 SDK / CLI 入口，不一定由 GUI 静态 import |
| `app/client/__init__.py` | SDK 包导出 |
| `app/cursor_code/__init__.py` | 包导出，可能被外部 import |
| `app/__init__.py`、`app/ui/__init__.py`、`app/ui/mixins/__init__.py`、`app/ui/widgets/__init__.py`、`app/utils/__init__.py` | 包标记 / 导出入口 |

本项目存在 **GUI、内嵌 Flask、油猴、外部 API** 多入口；详见 `docs/dead_code_cleanup_manifest.json` 的 `categories.must_keep` 与 `validation.notes`。

---

## 1. 基本原则

僵尸代码清理**不能只依赖** `rg 函数名`。

当前项目包含以下动态入口：

- PyQt / Qt 信号槽
- Flask route / Blueprint
- 前端 fetch API
- Python requests API
- getattr / setattr 动态访问
- QTimer / QAction / QShortcut
- localStorage / QSettings 迁移逻辑
- validate / assert / reject / sanitize / normalize / migrate 类 guard 函数
- 油猴脚本生成产物

因此，删除任何候选代码前，必须先经过：**静态引用检查**、**动态入口检查**、**运行日志检查**、**核心功能回归**。

---

## 2. 可以优先清理的类型

以下类型可优先进入清理候选：

1. 重复默认配置源。
2. 已经被新字段替代的旧字段读取。
3. 已经被新函数完全替代，且没有兼容调用需求的薄包装函数。
4. 只有定义处，且没有动态引用、配置引用、日志引用的普通工具函数。
5. 生成产物中的重复代码，不作为源码级修改入口，只通过源码重新构建更新。

---

## 3. 不能直接删除的类型

以下类型默认**不能**按 dead code 删除：

1. Qt 槽函数。
2. Flask route 函数。
3. Blueprint 注册函数。
4. 被 fetch / requests 调用的 API。
5. validate / assert / reject / sanitize / normalize / migrate 类函数。
6. legacy / compatibility / migration guard。
7. localStorage / QSettings 旧字段迁移代码。
8. 日志诊断入口。
9. 生成产物本身，例如 `client.user.js`。
10. 用户本地旧配置可能仍然依赖的迁移逻辑。
11. Python 模块级魔术方法（`__getattr__`、`__dir__` 等）。
12. Werkzeug / HTTP server 生命周期回调（如 `log_request`）。
13. Qt 事件覆写（`closeEvent`、`wheelEvent`、`showEvent` 等）。
14. 油猴 `setInterval` / `setTimeout` 内部的**命名异步 IIFE**（名字只出现一次仍会被周期性执行）。
15. 通过 `main_window.py` 多继承组合的 Mixin 类、以及 `main_window_state.py` 中的运行态状态类。
16. 文件内模块级单例（如 `CursorAutomationRuntime()` 赋给 `_runtime`）。

### 3.1 源码级清理排除路径

以下路径/通配符**不参与**源码级 dead code 清理（与 `docs/dead_code_cleanup_manifest.json` 的 `exclude_from_source_level_cleanup` 对齐）：

- `client.user.js`
- `dist/**`
- `build/**`
- `runtime/**`
- `logs/**`

### 3.2 第五批确认的框架回调（禁止按「仅定义一次」删除）

| path | symbol | 原因 |
|------|--------|------|
| `app/server/__init__.py` | `__getattr__` | 模块级动态属性加载入口 |
| `app/server/__init__.py` | `__dir__` | 模块级动态补全 / 反射入口 |
| `app/server/runtime_state.py` | `SilentWSGIRequestHandler.log_request` | Werkzeug / HTTP server 生命周期回调 |
| `app/ui/main_window.py` | `MainWindow.closeEvent` | Qt 关闭窗口事件回调 |
| `app/ui/widgets/no_wheel_combo_box.py` | `NoWheelComboBox.wheelEvent` | Qt 鼠标滚轮事件回调 |

### 3.3 `from __future__ import annotations` 勿删（扫描边界）

简单 unused-import 脚本常把 `from __future__ import annotations` 误报为「未使用 import」（因为文件内不会出现名为 `annotations` 的运行时引用）。**这不是普通 import，禁止按 unused import 删除。**

**作用**：启用 PEP 563 风格的注解延迟求值——类型注解在运行时以字符串形式保存，而非在定义时立即求值。

**高风险路径**（本仓库大量存在，勿批量删）：

- `app/client/*.py`
- `app/server/*.py`
- `app/ui/main_window_state.py`
- `app/utils/*.py`
- `app/ui/mixins/*.py`
- `app/ui/widgets/*.py`

**删除风险**（收益极低，不值得冒险）：

1. 前向引用类型可能在运行时被提前求值，引发 `NameError`。
2. 可能触发或加剧循环导入。
3. 不同 Python 版本下类型标注行为可能变化。
4. 对 dataclass、类型别名、`X | Y` 联合类型、可选类型标注尤其敏感。

**扫描器约定**：

- `tools/find_python_dead_statements.py` 已在 `IGNORE_IMPORT_NAMES` 中忽略 `__future__` 模块，**不应**输出 `[UNUSED_IMPORT_CANDIDATE]`。
- 若使用外部/简易 unused-import 工具，须显式忽略：`from __future__ import annotations`。
- 不得以「本文件没有引用 `annotations` 这个名字」作为删除依据。

**清理 unused import 时**：只处理普通 `import` / `from xxx import yyy`；**跳过**所有 `from __future__ import …` 行。

### 3.4 油猴命名闭包 / IIFE / history 补丁（勿删）

以下符号在 JS 源码里可能**只出现一次**，属于正常现象，**不得**按「无引用函数」删除：

| path | symbol | 原因 |
|------|--------|------|
| `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js` | `debouncedSave` | `debounceSave()` 返回的具名闭包，名字仅用于调试栈 |
| `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js` | `patchedToolboxPushState` | 赋给 `history.pushState`，名字仅用于调试栈 |
| `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js` | `patchedToolboxReplaceState` | 赋给 `history.replaceState`，名字仅用于调试栈 |
| `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js` | `tickWaitingReplyOrSendOpportunity` | `setInterval` 内部的命名异步 IIFE，周期性执行 |

### 3.5 BridgeClient 已弃用 SDK 方法（本批保留，勿删）

`app/client/bridge_client.py` 中以下方法当前 GUI / CLI **内部不再调用**，但 `BridgeClient` 可能作为外部 SDK 使用；docstring 已标 `@deprecated`，**本批不删除**，后续若要移除须先发版本并在发布说明中声明：

| method | 推荐替代 |
|--------|----------|
| `check_connection()` | `diagnose_connection()` |
| `send_and_wait()` | `ask()` 或 `send()` + `wait_result()` |
| `ping()` | `diagnose_connection().health_ok` 或 `status()` |
| `create_session()` | 服务端 `/api/v1/sessions` 或 GUI 会话流程 |
| `get_session()` | `list_sessions()` 或服务端 `/api/v1/sessions` |
| `bind_session()` | `/api/v1` 绑定接口；GUI 以 `session.remote_chatgpt` 为权威 |

复核命令（应只命中定义与注释，不含 GUI/CLI 业务调用）：

```bash
rg "check_connection\(|send_and_wait\(|\.ping\(|create_session\(|get_session\(|bind_session\(" app GUI.py README.md
```

---

## 4. 删除前检查命令

删除任何候选代码前，至少执行：

```bash
rg "函数名|变量名|常量名" app GUI.py client.user.js
rg "getattr\(.*函数名|setattr\(.*函数名" app GUI.py
rg "\.connect\(.*函数名|partial\(.*函数名" app GUI.py
rg "@.*route|Blueprint|add_url_rule" app/server
rg "fetch\(|requests\.(get|post|put|delete|patch)" .
```

可选：本地「只出现一次」的 Python 定义候选（**仅生成候选，禁止自动删除**）：

```bash
python scripts/find_single_occurrence_defs.py
```

忽略名与 Qt / Werkzeug 生命周期回调见该脚本内 `IGNORE_NAMES`；输出须结合 §3.2、§3.5 与动态入口人工复核。

### 4.2 完整开发仓库（含 `tools/` 时，可选）

仅当仓库根目录存在 `tools/` 时，可追加执行：

```bash
python tools/find_dead_code_candidates.py
python tools/find_python_dead_statements.py
python tools/find_orphan_python_modules.py
python tools/find_stale_tests_candidates.py
python tools/find_feature_flag_dead_code_candidates.py
python tools/find_dynamic_reference_entries.py
python tools/check_dead_code_regression.py
python tools/find_dead_artifact_files.py
python tools/run_dead_code_cleanup_checks.py
```

---

## 5. 删除后验证命令

### 5.0 精简发布包（最低必跑）

```bash
python -m compileall -q app GUI.py
cd chatgpt-toolbox && npm run build --silent
```

### 5.0.1 完整开发仓库（可选追加）

存在 `tests/` 与 `tools/` 时再执行：

```bash
pytest -q
python tools/run_dead_code_cleanup_checks.py
```

如果修改了油猴源码，还必须重新构建：

```bash
cd chatgpt-toolbox && npm run build
```

**不要**手工直接修改生成后的 `client.user.js` 或 `chatgpt-toolbox/dist/client.user.js`。

### 5.1 完整验收顺序与失败处理

分步验收清单（编译 → 候选扫描 → 动态入口 → 回归 → must-keep → 统一入口 → pytest → 油猴构建）、每项通过标准、以及各检查失败时的修复方向，见：

[`cursor_dead_code_cleanup_master_task.md` §十一–§十四](cursor_dead_code_cleanup_master_task.md#十一最终验收清单)

快速对照：

| 输出 | 含义 | 下一步 |
|------|------|--------|
| `[DEAD_CODE_REGRESSION][FAILED]` | P0 旧模式回归 | §12.1：改 `job_status_from()`，勿 `get("status") or get("job_status")` |
| `[MUST_KEEP_SYMBOLS][FAILED]` | 误删 guard | §12.2：回滚，勿空函数 / 勿 warning 替代 ValueError |
| `test_bridge_payload_legacy_guard` 失败 | 旧字段又能入队 | §12.3：恢复 fail-fast，勿 `pop("request_id")` |
| `test_job_scheduler_status_migration` 失败 | 取消/统计仍读旧字段 | §12.4：检查 `send_job_to_cursor` / `get_job_scheduler_snapshot` |
| 构建后仍有 `DEFAULT_AUTO_CONFIG` | 源码未清干净 | §12.5：改 `tampermonkey-userscript-src/`，再 `npm run build` |
| `[DEAD_CODE_CLEANUP_CHECKS][OK]` | 静态验收通过 | 仍建议跑 `pytest -q` 与 GUI 冒烟（§6、§9） |

---

## 6. 运行日志验收

删除后，启动 GUI 和服务端，日志中**不能**出现：

- `ImportError`
- `AttributeError`
- `NameError`
- `KeyError`
- `[PYTHON_UNCAUGHT_EXCEPTION]`
- `[UI_BIND][ERROR]`
- `[ROUTE][ERROR]`
- `[BRIDGE][ERROR]`
- `[SYNC][ERROR]`
- `[CONTROL_COMMAND][ERROR]`

如果出现 `legacy fields still exist before save`，**不要**直接删除 legacy guard，应定位上游旧字段来源。

### `legacy fields still exist before save` 的区分

| 场景 | 期望 |
|------|------|
| 正在修旧字段污染上游 | 该错误应消失 |
| 正在保护 `legacy_cleanup.py` guard | 该错误表示 guard 仍在工作，不能因此删除 guard |

---

## 7. 观察期删除规则

以下代码需要先观察，**不允许马上删除**：

- `LEGACY_KEYS`
- `DEPRECATED_TOOLBOX_PATCH_KEYS`
- `remote_binding_enabled()`
- `persist_qsettings_last_url()` 中旧 QSettings key 清理循环
- `PENDING_REPLY_STALE_TIMEOUT_SEC`
- `status_chip_text()`

满足以下**全部**条件后，才允许删除：

1. 连续两个导出版本没有 `DEPRECATED_HIT` / `MIGRATION_HIT` / `COMPAT_HIT`。
2. `rg` 只有定义处。
3. 动态引用扫描无命中。
4. GUI 启动无异常。
5. 回归测试通过。
6. 配置导入、同步、发送、上传、Prompt 管理都正常。

### 观察期不可删除（任一即保留）

1. 日志仍有命中。
2. 旧配置导入仍依赖。
3. 用户本地历史数据可能仍会触发迁移。
4. Flask / API / Qt 动态入口无法排除。
5. 删除后只能靠人工点击才发现问题。
6. 代码属于 **guard**，而非业务流程。

### 观察期日志格式

实现见 `app/utils/deprecation_log.py`：

```text
[DEPRECATED_HIT] name=<名称> reason=<原因> replacement=<替代方案> caller=<调用方>
[MIGRATION_HIT] name=<名称> old=<旧字段> new=<新字段> reason=<原因>
```

**注意**：不要给高频热路径每次调用都打 `warning`，否则日志会被刷爆；仅低频兼容包装、导入迁移、旧字段命中时记录。

---

## 8. 删除记录要求

每次删除前，必须在 `docs/dead_code_cleanup_report.md` 记录：

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

删除后补充：

```text
[DEAD_CODE_DELETE_RESULT]
path=
symbol=
result=
tests=
logs=
rollback_needed=
```

---

## 9. 功能回归门槛

至少验证以下路径：

1. GUI 启动
2. 服务启动
3. 页面 registry 刷新
4. 绑定页面识别
5. 同步当前对话
6. 发送 Prompt
7. 开始上传
8. 停止任务
9. 复制最后回复
10. 发送到 Cursor
11. Prompt 管理导入导出
12. 自动指令队列

这些路径覆盖：Qt 槽、Flask API、control command、bridge payload、油猴 DOM selector、localStorage / GM 迁移、Cursor 队列、Prompt 默认配置等动态入口。

---

## 10. Unused import 删除规则

`tools/find_python_dead_statements.py` 会输出 `[UNUSED_IMPORT_CANDIDATE]`。**不要**看到候选就直接删除，必须先区分类别。

### 10.1 可以优先删除

1. 普通标准库 import，确认全文件无使用。
2. 普通第三方 import，确认无副作用。
3. 复制粘贴遗留 import。
4. 已替换实现后的旧 import。

示例：`import math` 且全文件没有 `math` 或 `math.` 使用，可删除。

### 10.2 不要轻易删除

1. **`from __future__ import annotations`**（见 §3.3；不是运行时变量导入，简易扫描必误报）。
2. PyQt import（类型注解、动态绑定、信号槽、Qt meta object 可能间接使用）。
3. Flask Blueprint / route 相关 import。
4. monkey patch / plugin / side-effect import。
5. `typing.TYPE_CHECKING` 相关 import。
6. 模块级注册类 import。
7. 被字符串、`globals()`、`locals()`、`getattr()` 动态使用的对象。

示例：`from PyQt5.QtCore import Qt` 即使脚本报候选，也要先查 UI 代码、类型注解和动态绑定。

### 10.3 删除后必须验证

精简包：

```bash
python -m compileall -q app GUI.py
cd chatgpt-toolbox && npm run build --silent
python GUI.py   # 手工冒烟，见 docs/dead_code_manual_smoke_test.md
```

完整仓库可追加：`pytest -q` 与 `python tools/run_dead_code_cleanup_checks.py`。

---

## 11. Unreachable statement 删除规则

同一脚本会输出 `[UNREACHABLE_STATEMENT_CANDIDATE]`（`return` / `raise` / `break` / `continue` 后的同级语句）。

### 11.1 可以优先处理

典型形式：

```python
def foo():
    return result
    print("never reached")  # 候选
```

或：

```python
def foo():
    raise ValueError("bad")
    cleanup()  # 候选；若确属死代码可删，或移到 finally
```

同级不可达语句可作为清理候选，删除前仍须人工确认。

### 11.2 不能机械删除

1. `try` / `finally` 里的 `finalbody`（`finally` 块本身不是“return 后的死代码”）。
2. `if TYPE_CHECKING` 分支。
3. 测试里故意写的不可达断言。
4. 旧逻辑临时保留的对照代码。
5. 代码生成器输出的结构。

尤其不要把 `finally: cleanup()` 误判为可删。

---

## 12. API route / fetch / requests 清理规则

后端 Flask route 即使没有 Python 内部调用，也不能直接判定为 dead code，因为它可能由前端 fetch、GUI `requests`、油猴脚本或外部工具调用。

删除 route 前必须确认：

1. 没有 fetch 调用；
2. 没有 requests 调用；
3. 没有动态 URL 拼接；
4. 没有 Blueprint prefix 匹配问题（含 `add_url_rule` 集中注册）；
5. 没有外部工具依赖；
6. 没有文档暴露；
7. 没有测试依赖。

如果发现前端/API 调用找不到后端 route，**优先按 bug 处理**，而不是 dead code：

1. 旧接口调用改为新接口；
2. 拼错路径修正；
3. 缺 route 就补 route；
4. 外部接口加入白名单；
5. 确认废弃后再删除调用。

候选扫描（只读、不自动删）：

```bash
python tools/find_api_route_usage_candidates.py
```

输出标签：`[UNUSED_ROUTE_CANDIDATE]`、`[MISSING_ROUTE_CANDIDATE]`。出现候选后须结合 `rg`、`tools/search_text_fallback.py` 与动态引用扫描人工确认。

---

## 13. 孤立 Python 模块删除规则

`tools/find_orphan_python_modules.py` 扫描 `app/**/*.py` 以及入口 `GUI.py`，根据 `import` / `from import` 关系输出 `[ORPHAN_PY_MODULE_CANDIDATE]`。**只输出候选，不自动删除。**

### 13.1 可以进入删除候选

须**同时**满足：

1. 不在 `app/server`、`app/ui`、`app/widgets`、`app/mixins` 等动态加载目录（脚本默认跳过这些路径）。
2. 无 Flask route / Blueprint 标记（`@app.route`、`.route(`、`Blueprint(`、`register_blueprint`）。
3. 无 Qt 类、信号槽、窗口类（`QWidget`、`QDialog`、`QObject`、`pyqtSignal`、`pyqtSlot`）。
4. 无 `import` / `from import` 引用（含全名、子包前缀、末段短名匹配）。
5. 无字符串形式动态导入。
6. 无配置文件、入口脚本、打包脚本引用。
7. 删除后 `compileall`、`pytest`、GUI 启动均通过。

### 13.2 不能直接删除

1. `app/server` 下的 route 模块。
2. `app/ui` 下的 UI 模块。
3. `app/widgets` 下的控件模块。
4. `app/mixins` 下的 mixin 模块。
5. `__init__.py` 聚合导入模块。
6. 插件注册模块。
7. 被 `importlib.import_module` 动态加载的模块。
8. 被字符串、配置文件、命令名引用的模块。

### 13.3 删除前必须搜索

```bash
rg "模块名|文件名" .
rg "importlib|__import__|getattr|globals\(|locals\(" app GUI.py
rg "register_blueprint|Blueprint|route\(" app/server
```

没有 `rg` 时：

```bash
python tools/search_text_fallback.py "模块名"
python tools/search_text_fallback.py "importlib"
python tools/search_text_fallback.py "register_blueprint"
```

候选扫描（只读）：

```bash
python tools/find_orphan_python_modules.py
```

---

## 14. 入口可达性快照规则

`tools/build_reachability_snapshot.py` 从 `GUI.py` 出发构建静态 **import 图**，输出可达模块与不可达候选，写入 `docs/dead_code_reachability_snapshot.md`。**只生成报告，不修改业务代码，不自动删除。**

与 `tools/find_orphan_python_modules.py`（孤立模块，侧重「是否被 import」）不同，本脚本侧重 **「是否从主入口链路可达」**。

### 14.1 生成与对比（手动）

清理前或审查前手动执行：

```bash
python tools/build_reachability_snapshot.py
```

清理后对比快照变化：

```bash
git diff -- docs/dead_code_reachability_snapshot.md
```

**不要**接入 `tools/run_dead_code_cleanup_checks.py`：该脚本是快照生成器，每次运行会刷新报告，接入统一验收会产生工作区变更。

### 14.2 候选标记

| 标记 | 含义 |
|------|------|
| `plain-unreachable-candidate` | 静态 import 图下未被 `GUI.py` 触达，且文件中无明显动态入口标记 |
| `dynamic-keep-marker` | 虽不可达，但含 Flask route、Blueprint、Qt 类/信号槽、`importlib`、`__import__`、`getattr(` 等，**不能直接删除** |

### 14.3 `plain-unreachable-candidate` 可进一步调查

须继续搜索模块名、文件名与配置引用：

```bash
rg "文件名|模块名" .
python tools/search_text_fallback.py "文件名"
python tools/search_text_fallback.py "模块名"
```

满足以下**全部**条件后，才可进入删除候选：

1. 无 `import` / `from import` 引用。
2. 无 `importlib` 动态加载。
3. 无配置文件引用。
4. 无文档或脚本引用。
5. 不是 UI / route / plugin / mixin 模块。
6. 删除后 `compileall`、`pytest`、`python tools/run_dead_code_cleanup_checks.py`、GUI 启动均通过。

### 14.4 `dynamic-keep-marker` 不能直接删除

即使静态 import 图不可达，也须：

1. 标记为人工复核。
2. 记入 `docs/dead_code_cleanup_report.md` 的 observe 区。
3. 结合运行日志与 GUI 冒烟测试确认是否仍被使用。
4. **不允许**脚本自动删除。

### 14.5 原则摘要

1. 从 `GUI.py` 静态 import 图不可达，只能说明它是**候选**，不能单独作为删除依据。
2. 候选含 Flask / Qt / `importlib` / `getattr` 动态标记时，**不允许**直接删除。
3. `plain-unreachable-candidate` 也必须继续搜索模块名、文件名和配置引用。
4. 删除前必须通过 `compileall`、`pytest`、`run_dead_code_cleanup_checks.py` 和 GUI 冒烟测试。

---

## 15. 过期测试（stale tests）处理规则

`tools/find_stale_tests_candidates.py` 扫描 `tests/**/*.py`，输出 `[STALE_TEST_CANDIDATE]`。**只输出候选，不自动删除、不修改测试文件。**

每条候选带 `context`：

| context | 含义 |
|---------|------|
| `safe_guard_or_migration_test` | 上下文含 reject / raises / legacy / guard / migration 等，多为**故意**验证旧字段被拒绝或迁移 |
| `possible_stale_behavior_test` | 疑似仍在断言或构造「旧字段仍被正常支持」的行为 |

候选扫描（只读）：

```bash
python tools/find_stale_tests_candidates.py
```

已接入 `tools/run_dead_code_cleanup_checks.py`（`stale_tests_candidates` 步骤）。

### 15.1 必须保留的测试

1. 验证 legacy guard **会拒绝**旧字段的测试。
2. 验证 migration 能把旧字段迁移到新字段的测试。
3. 验证旧配置导入**不会污染**新结构的测试。
4. 验证错误旧 payload 会 **fail-fast** 的测试。

示例（保护「拒绝旧字段」，不是继续支持旧字段）：

```python
with pytest.raises(ValueError):
    validate_outbound_queue_message({
        "payload": {
            "request_id": "legacy-id"
        }
    })
```

### 15.2 应更新或删除的测试

1. 断言 `job["status"]` 仍然存在的测试。
2. 断言旧 `request_id` 会被**正常入队**的测试。
3. 断言 `last_page_url` / `page_url` / `conversation_url` 是**主字段**的测试。
4. 断言 `DEFAULT_AUTO_CONFIG` 是默认配置源的测试。
5. 断言旧 Prompt 配置 key 仍被正常保存为**主结构**的测试。

这类测试是在保护旧行为，会阻碍业务代码与配置的清理。

### 15.3 推荐替换方式

错误方向：

```python
assert job["status"] == "waiting_chatgpt_reply"
```

正确方向：

```python
assert job_status_from(job) == "waiting_chatgpt_reply"
assert "status" not in job
```

错误方向：

```python
assert payload["request_id"]
```

正确方向：

```python
assert "request_id" not in payload
assert payload["message_id"]
```

旧默认配置源断言应改为对 `createDefaultAutoConfig()`（或项目当前 canonical 默认工厂）的断言，而不是 `DEFAULT_AUTO_CONFIG`。

---

## 16. 功能开关 / 调试开关（伪僵尸代码）处理规则

`tools/find_feature_flag_dead_code_candidates.py` 扫描 Python / JS / TS / JSON / MD / TXT 中与 debug、feature flag、legacy、fallback、migration 等相关的行，输出 `[FEATURE_FLAG_CANDIDATE]`。**只输出候选，不自动删除、不修改业务文件。**

每条候选带 `context`：

| context | 含义 |
|---------|------|
| `likely_guard_or_diagnostic` | 行内或上下文含 guard / migration / fallback / debug / compat / legacy 等，多为**低频但必要**的诊断或兜底 |
| `needs_manual_review` | 需人工判断是可删旧逻辑，还是必须保留的开关逻辑 |

候选扫描（只读）：

```bash
python tools/find_feature_flag_dead_code_candidates.py
```

已接入 `tools/run_dead_code_cleanup_checks.py`（`feature_flag_dead_code_candidates` 步骤，位于 `stale_tests_candidates` 与 `api_route_usage_candidates` 之间）。

### 16.1 功能开关代码不能直接判死

以下代码即使平时不执行（例如开关默认为 `False`、仅在失败或旧配置时触发），也**不能**仅因静态分析「无引用 / 不执行」而按 dead code 删除：

1. debug / verbose / trace 相关分支。
2. feature flag 控制的新旧流程切换。
3. 设置项控制的兼容行为。
4. 环境变量控制的调试输出。
5. 用户设置里隐藏的实验功能。
6. 只在失败兜底时触发的 fallback。
7. 只在旧配置导入时触发的 migration。
8. 只在异常数据出现时触发的 guard。

典型误判示例：

```python
if DEBUG_FULL_BRIDGE_JSON:
    log_full_payload(payload)
```

当前配置为 `False` 时，运行时可能从不进入该分支，但这是**调试开关**，不是僵尸代码。

```python
if settings.value("use_legacy_import", False):
    migrate_old_import_data()
```

是否可删取决于**是否仍须支持旧配置**，而不是默认值是否为 `False`。

### 16.2 可以删除的情况

须**同时**满足或经人工确认等价条件：

1. 开关已没有 UI 设置入口。
2. 配置文件不再保存该开关。
3. 全库搜索确认没有任何读取和写入。
4. 文档不再说明该开关。
5. 测试不再覆盖该开关。
6. 运行日志连续多个版本没有相关命中。
7. 删除后功能回归正常。

示例：若 `old_import_mode` 已无任何设置入口、配置入口、导入入口，也没有旧数据依赖，可进入观察期后再删。

### 16.3 不能直接删除的情况

1. debug 模式使用。
2. 日志诊断使用。
3. 用户设置页仍有开关。
4. fallback 仅在失败时触发。
5. migration 仅在旧配置中触发。
6. guard 仅在异常数据时触发。
7. 环境变量开关用于排障。
8. 油猴 `GM_getValue` / `localStorage` 迁移逻辑。

**明确**：`DEBUG_FULL_BRIDGE_JSON` 等调试常量**不应**按 dead code 直接删除；若需调整，应迁移到设置项或配置项，属于单独任务。

删除前建议结合 `tools/find_dynamic_reference_entries.py`、运行日志扫描与 §7 观察期规则人工判断。

---

## 17. 非源码僵尸文件（生成产物 / 缓存 / 备份 / 历史导出）

源码级 dead code 工具**默认不审查**以下非源码文件；它们若混入 `rg` / 符号扫描，容易产生大量误判。

### 17.1 候选扫描（只读）

```bash
python tools/find_dead_artifact_files.py
```

输出 `[DEAD_ARTIFACT_FILE_CANDIDATE]`，带 `category`：

| category | 含义 |
|----------|------|
| `generated_runtime_artifact_keep` | 生成产物但须保留为运行/分发文件（如 `client.user.js`），**不能直接删除** |
| `generated_or_cache_dir_candidate` | 位于 `__pycache__`、`.pytest_cache`、`dist`、`build`、`runtime`、`logs` 等目录 |
| `temporary_or_backup_file_candidate` | 临时/备份后缀（`.tmp`、`.bak`、`.log` 等） |
| `historical_export_or_backup_candidate` | 文件名含 backup、副本、merged_for_chatgpt 等标记 |

脚本**只输出候选，不自动删除**。已接入 `tools/run_dead_code_cleanup_checks.py`（`dead_artifact_files` 步骤，`required=False`，位于末尾）。

### 17.2 可以加入 `.gitignore` 的类型

- `__pycache__/`、`.pytest_cache/`、`.mypy_cache/`、`.ruff_cache/`
- `*.pyc`、`*.pyo`、`*.tmp`、`*.bak`、`*.backup`、`*.old`、`*.orig`、`*.swp`、`*.swo`
- `logs/`、`runtime/`（若需保留空目录结构，可提交 `.gitkeep`，勿提交运行生成内容）
- `tmp/`、`temp/`、`cache/`、`caches/`
- `dist/`、`build/`（若仅为本地构建临时产物）
- `node_modules/`

### 17.3 生成产物：保留构建能力，不当作源码快照强校验项

- **`client.user.js`**、**`chatgpt-toolbox/dist/client.user.js`**：由 `npm run build` 生成；不能作为源码级修改入口；不能因导出快照缺失而判 dead code 删除。
- 源码审查对象是 `chatgpt-toolbox/tampermonkey-userscript-src/`；需要安装/回归时在本地构建后使用产物。
- 本仓库 **Git 跟踪**根目录 `client.user.js`（`npm run build` 后随提交备份）；`.gitignore` 仍忽略 `chatgpt-toolbox/dist/`。合并导出不收录 `client.user.js`。Tampermonkey 安装请使用本地 `npm run build` 后的 `dist/client.user.js` 或根目录同步副本。

### 17.4 需要人工确认的类型

- **`dist/`、`build/`**：若发布依赖则保留但排除源码级审查；若仅为本地临时产物可忽略；交付可运行包时不要直接删除。

### 17.5 与源码级清理的关系

非源码产物默认排除出源码级 dead code 审查（与 §3.1、`docs/dead_code_cleanup_manifest.json` 的 `exclude_from_source_level_cleanup` 对齐）。

---

## 18. 综合审查报告（dead code review summary）

`tools/generate_dead_code_review_summary.py` 依次运行多个候选扫描脚本，将 stdout 按 **high / medium / low** 分级，写入 `docs/dead_code_review_summary.md`。**只生成报告，不修改业务代码，不自动删除。**

### 18.1 生成与对比（手动）

审查前或需要汇总多个扫描结果时手动执行：

```bash
python tools/generate_dead_code_review_summary.py
git diff -- docs/dead_code_review_summary.md
```

**不要**接入 `tools/run_dead_code_cleanup_checks.py`：该脚本会刷新报告时间与内容，接入统一验收会在工作区自动产生变更。

### 18.2 风险分级与处理

| 等级 | 典型标记 / 场景 | 处理方式 |
|------|-----------------|----------|
| **high** | `[MISSING_ROUTE_CANDIDATE]`、`possible_live_legacy_usage`、`possible_stale_behavior_test`、`[DEAD_CODE_REGRESSION][FAILED]`、`[MUST_KEEP_SYMBOLS][FAILED]`、`[STALE_TEST_CANDIDATE]` | 不直接删除；区分旧代码残留、guard/migration 测试、接口断链；接口问题按 bug 修 |
| **medium** | `[UNUSED_ROUTE_CANDIDATE]`、`[ORPHAN_PY_MODULE_CANDIDATE]`、`[JS_UNUSED_DECL_CANDIDATE]`、不可达语句、注释旧代码、`[FEATURE_FLAG_CANDIDATE]` | 记入 `docs/dead_code_cleanup_report.md` observe/delete plan；查动态引用；跑测试与 GUI 冒烟后小提交删除 |
| **low** | `[UNUSED_IMPORT_CANDIDATE]`、`[DEAD_ARTIFACT_FILE_CANDIDATE]`、`generated_runtime_artifact_keep`、`safe_guard_or_migration_*` | unused import 可小批量清理；缓存/备份加 `.gitignore` 或人工删；生成产物只排除审查；guard 保留 |

报告须包含：**Failed Commands**、**High / Medium / Low** 候选、**Raw Scanner Output**、**Review Rule**。所有等级均不允许脚本自动删除。

---

## 19. 删除批次控制规则

dead code 清理必须小批量提交，禁止一次性删除大量候选。

### 19.1 单次提交允许范围

单次提交最多只处理**同一类型、同一风险级别、同一模块范围内**的候选。

**允许示例：**

```text
commit 1:
只处理 app/core/job_scheduler.py 中 status -> job_status 的字段迁移残留。

commit 2:
只处理 DEFAULT_AUTO_CONFIG 重复默认配置源。

commit 3:
只删除 confirmed unused import。

commit 4:
只清理一组注释掉的旧代码块。
```

**不允许示例：**

同一个 commit 同时做：

- 删除 Python unused import
- 删除 JS 函数
- 删除 Flask route
- 修改 legacy guard
- 修改油猴默认配置
- 更新测试
- 改文档

这种提交一旦出问题，无法快速定位责任范围。

### 19.2 单次提交删除上限（建议）

| 类型 | 单批上限 |
|------|----------|
| 低风险 unused import | 最多 20 个 import |
| 低风险注释旧代码 | 最多 5 个注释块 |
| 中风险函数 / 常量 | 最多 3 个 symbol |
| 中风险文件级候选 | 最多 1 个文件 |
| 高风险 route / Qt 槽函数 / legacy guard | 本轮**不直接删除**；只允许加测试、加日志、加观察标记 |

### 19.3 每批必须独立可回滚

每批提交必须满足：

1. 有独立 diff。
2. 有独立测试命令。
3. 有独立 rollback 命令。
4. 删除原因可单独说明。
5. 不能依赖下一批提交才能通过测试。

### 19.4 每批必须更新报告

每批清理后，在 `docs/dead_code_cleanup_report.md` 追加 `[DEAD_CODE_BATCH]` 记录（模板见该文档「批次记录模板」节）。

### 19.5 批次规模风险提醒（git diff）

提交前可运行：

```bash
python tools/check_dead_code_batch_size.py
```

该脚本基于当前工作区 `git diff`，对变更文件数、删除行数、高风险路径与 diff 文本标记输出 **WARN**（不阻断验收）。软上限：变更文件数 20、删除行数 400；命中 `legacy_cleanup`、`bridge_payload`、`app/server/`、`app/ui/`、`client.user.js` 等路径或 route/Qt/guard 相关 diff 标记时提醒人工确认是否应拆分提交。

已接入 `tools/run_dead_code_cleanup_checks.py`（`required=False`）。

---

## 20. 扫描豁免规则

dead code 扫描可能产生**已确认保留**的误报。为避免同一批候选反复淹没人工审查，使用 `docs/dead_code_ignore_manifest.json` 记录豁免项；结构校验由 `tools/check_dead_code_ignore_manifest.py` 执行，并接入 `tools/run_dead_code_cleanup_checks.py`。

### 20.1 允许豁免的情况

1. 已确认是 guard / migration / fallback / debug 逻辑。
2. 已确认是动态入口，静态扫描无法识别。
3. 已确认是生成产物，但运行分发仍需要保留。
4. 已确认是测试中故意构造旧字段以验证 fail-fast。
5. 已确认是文档说明旧字段废弃，而非继续推荐旧字段。

### 20.2 不允许豁免的情况

1. 为了让检查通过而隐藏真实旧字段残留。
2. 为了跳过测试失败而把问题加入白名单。
3. 没有 `reason` 的豁免。
4. 没有 `owner` 的豁免。
5. 永久豁免高风险业务逻辑，却不加测试保护。

### 20.3 每条豁免必须包含

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识，不可重复 |
| `path` | 相对仓库根路径（无通配符时须存在） |
| `symbol` | 符号名；生成产物可用 `generated userscript artifact` |
| `scanner` | 产生该候选的扫描器名称 |
| `reason` | 保留原因，不可为空 |
| `expires_after` | 复审截止策略，不可为空（如 `manual-review-required`） |
| `owner` | 负责人，不可为空 |

缺少上述字段时，`check_dead_code_ignore_manifest.py` 必须失败。

---

## 21. 相关工具

| 工具 | 用途 |
|------|------|
| `tools/check_dead_code_batch_size.py` | 基于 git diff 的批次规模与高风险 diff 提醒（只读，不阻断） |
| `tools/generate_dead_code_review_summary.py` | 多扫描器结果汇总为分级审查报告（写 `docs/dead_code_review_summary.md`，**仅手动运行**） |
| `tools/run_dead_code_cleanup_checks.py` | 统一验收入口（compileall + 静态检查 + 可选 pytest） |
| `tools/find_dead_code_candidates.py` | 候选符号与旧模式扫描 |
| `tools/find_python_dead_statements.py` | Python unused import / 不可达语句候选（只读，不自动删） |
| `tools/find_orphan_python_modules.py` | 孤立 Python 模块候选（只读，不自动删） |
| `tools/find_stale_tests_candidates.py` | tests 目录旧字段/旧接口候选（区分 guard 测试与疑似保护旧行为，只读） |
| `tools/find_feature_flag_dead_code_candidates.py` | 功能开关 / 调试 / fallback / migration 伪僵尸代码候选（只读，不自动删） |
| `tools/build_reachability_snapshot.py` | 从 `GUI.py` 入口的 import 可达性快照（写 `docs/dead_code_reachability_snapshot.md`，**仅手动运行**） |
| `tools/find_api_route_usage_candidates.py` | Flask route 与 fetch/requests 双向候选（只读） |
| `tools/find_dynamic_reference_entries.py` | 动态引用入口 |
| `tools/check_dead_code_regression.py` | 回归检查脚本 |
| `tools/check_must_keep_symbols.py` | must-keep guard 符号存在性检查 |
| `tools/check_dead_code_docs_consistency.py` | rules / report / manifest 三者关键条目一致性 |
| `tools/check_dead_code_manifest.py` | manifest JSON 结构与必填字段校验 |
| `tools/check_dead_code_ignore_manifest.py` | 扫描误报豁免清单 JSON 结构与 path/symbol 存在性校验 |
| `docs/dead_code_ignore_manifest.json` | 已确认非僵尸代码的扫描豁免条目（含 reason / owner / expires_after） |
| `tools/find_dead_artifact_files.py` | 生成产物 / 缓存 / 备份 / 历史导出等非源码僵尸文件候选（只读，不自动删） |
| `app/utils/deprecation_log.py` | 观察期统一日志 |
| `scripts/pre_commit_dead_code_check.py` | 提交前调用统一验收（供 Git hook 使用） |
| `scripts/install_git_hooks.py` | 安装 `.git/hooks/pre-commit` |
| `scripts/find_single_occurrence_defs.py` | 本地 AST 扫描：只出现一次的 def/class 候选（只读，不自动删） |

**防绕过（本地）**：一次性安装后，每次 `git commit` 前自动跑验收：

```bash
python scripts/install_git_hooks.py
```

**防绕过（远程）**：推送到 GitHub 时由 `.github/workflows/dead-code-cleanup-checks.yml` 在 PR / `main`·`master` push 上执行 `compileall` + 油猴构建；含 `tools/` 的完整仓库可再在本地运行 `python tools/run_dead_code_cleanup_checks.py`。

详细删除计划与当前候选见：`docs/dead_code_cleanup_report.md`。

---

## 22. 第五批：误删保护校验（清理前后必做）

**不要只依赖** `rg` 函数名出现次数。清理前后须对照本节与 `docs/dead_code_cleanup_report.md` §5.4–§5.9。

### 22.1 禁止误删框架回调

即使静态扫描显示只有定义，也**不得**删除 §3.2 所列符号。

### 22.2 禁止误删油猴命名闭包 / IIFE

不得删除 §3.4 所列 `logger.js` / `upload-module.js` 符号（含 `debouncedSave`、`patchedToolboxPushState`、`patchedToolboxReplaceState`、`tickWaitingReplyOrSendOpportunity`）。

### 22.3 禁止误删状态类与 Mixin 类

不得删除：

- `app/ui/main_window_state.py`：`BridgeUiState`、`PageSelectorState`、`WebSyncState`、`AutoBindState`、`PageCommandUiState`、`BridgeMessageState`、`LogUiState`、`SessionUiState`、`ServerUiState`
- `app/ui/mixins/*.py` 中的 Mixin 类定义（由 `main_window.py` 多继承组合）
- `app/ui/widgets/*.py` 中仍被 UI 构建逻辑实例化的 Widget 类
- `app/cursor_code/runtime.py` 的 `CursorAutomationRuntime`（模块级 `_runtime` 单例）
- `app/cursor_code/upgrade_monitor.py` 的 `CursorFindOnceWorker`、`CursorUpgradeMonitorWorker`（由 `cursor_code_mixin.py` 实例化）

### 22.4 删除后运行时导入检查

```bash
python -m compileall -q app GUI.py

python -c "import app.server; import app.server.runtime_state; import app.ui.main_window; import app.cursor_code.matcher; import app.utils.page_identity; print('runtime import smoke ok')"
```

### 22.5 油猴构建检查（改了油猴源码时）

```bash
cd chatgpt-toolbox
node build.userjs.mjs
```

或：`cd chatgpt-toolbox && npm run build`。

### 22.6 最终 dead-code `rg` 检查（已删项应无命中）

在项目根目录执行；**有命中**说明删除未完成或回滚不完整：

```bash
rg "BridgeQueueFullError|_server_instance_id|_server_start_time" app/server/state.py
rg "CursorMatchResult" app/cursor_code/matcher.py
rg "should_emit_log" app/utils/gui_logging.py
rg "has_page_channel|display_key" app/utils/page_identity.py
rg "is_chatgpt_platform_error_text|_CHATGPT_PLATFORM_ERROR_RE|_CHATGPT_PLATFORM_ERROR_DEPRECATED_LOGGED" app/constants.py
rg "_on_send_to_cursor_clicked" app/ui/mixins/cursor_bridge_mixin.py
rg "clickRealComposerSendButton|copyAndSendHotkeyOnce|isAssistantReallyGeneratingForCopy|forceChatPageToAbsoluteEnd|getChatScrollContainers|forceScrollContainerToEnd" chatgpt-toolbox/tampermonkey-userscript-src
```

### 22.7 保留项检查（必须仍存在）

```bash
rg "__getattr__|__dir__" app/server/__init__.py
rg "log_request" app/server/runtime_state.py
rg "closeEvent" app/ui/main_window.py
rg "wheelEvent" app/ui/widgets/no_wheel_combo_box.py
rg "tickWaitingReplyOrSendOpportunity" chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js
rg "debouncedSave|patchedToolboxPushState|patchedToolboxReplaceState" chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js
rg "def check_connection|def send_and_wait|def ping|def create_session|def get_session|def bind_session" app/client/bridge_client.py
```

`python tools/check_must_keep_symbols.py` 亦会校验 §3.2 框架回调与 legacy guard（见该脚本 `FRAMEWORK_MUST_KEEP`）。

### 22.8 推荐提交拆分（第 1–5 批 + 独立修复）

| 提交 | 范围 |
|------|------|
| 1 | `app/constants.py`、`cursor_bridge_mixin.py`、油猴 `main.js` / `upload-module.js` / `toolbox-shell.js` 低风险僵尸代码 |
| 2 | `app/server/state.py`、`matcher.py`、`gui_logging.py`、`page_identity.py`、`session_list_item.py` |
| 3 | 第三批 UI helper：`settings_mixin.py`、`ui_chat_panel_mixin.py`、`ui_page_selector_mixin.py`、`ui_status_compact_mixin.py`、`waiting_timer_mixin.py`、`conversation_stats_mixin.py` |
| 4 | 第四批页面状态/诊断：`page_binding_diagnostics_mixin.py`、`page_binding_display_mixin.py`、`page_binding_state_mixin.py`、`page_open_close_mixin.py`、`page_tm_client_mixin.py`、`session_mixin.py` |
| 5（独立） | **仅** `app/utils/page_snapshot.py` 缺失修复；**不要**与僵尸代码删除混在同一提交 |

`page_snapshot.py` 缺失属于运行时断裂（`ImportError`），不是 dead code；须单独提交便于回归定位。
