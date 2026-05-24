# 僵尸代码清理：验收标准与观察期规则

本文档定义删除候选代码前的三层门槛、观察期退出条件，以及与工具链的配合方式。**不要仅凭静态搜索“只有定义处”就大规模删除。**

## 禁止直接删除的情形

1. **Qt 槽函数**：不允许仅凭 `rg` 只有定义处就删除；按钮 `.connect()`、信号链、反射调用无法被纯文本搜索完全覆盖。
2. **Flask route / API**：不允许仅凭 Python 内部无直接调用就删除；路由由框架注册，动态入口需用 `tools/find_dynamic_reference_entries.py` 等扫描。
3. **Guard / 校验类函数**：`validate` / `assert` / `reject` / `sanitize` / `normalize` / `migrate` 语义默认**不按** dead code 删除。
4. **生成产物**：`client.user.js`、`chatgpt-toolbox/dist/client.user.js` 不作为源码修改入口；功能改动只改 `chatgpt-toolbox/tampermonkey-userscript-src/` 并 `npm run build`。
5. **明确保留**（示例，非穷举）：
   - `app/utils/legacy_cleanup.py`
   - `assert_no_legacy_fields()`、`reject_legacy_fields()`
   - `validate_outbound_queue_message()` 中的旧字段拒绝逻辑
   - 日志已证明仍在拦截污染的 guard（例如 `payload.request_id`）

## 第一层：静态引用门槛

删除候选前必须先做静态搜索（示例）：

```bash
rg "函数名|变量名|常量名" app gui.py server.py client.user.js
rg "getattr\(.*函数名|setattr\(.*函数名" app gui.py server.py
rg "\.connect\(.*函数名|partial\(.*函数名" app gui.py server.py
rg "fetch\(.*接口路径|requests\.(get|post|put|delete|patch).*接口路径" .
```

### 允许进入删除候选

- 只有定义处；
- 没有字符串动态调用；
- 没有 Qt `connect`；
- 没有 Flask route / `fetch` / `requests`；
- 没有配置项引用；
- 没有日志关键字依赖。

### 不允许进入删除候选

- 有 route、`connect`、`getattr` / `setattr`；
- 有 migrate / validate / assert / reject / normalize / sanitize 语义；
- 属于配置迁移、旧字段拒绝、兼容导入、日志诊断入口。

## 第二层：运行日志门槛

删除候选后，至少跑一次完整 GUI 启动和核心操作。日志中**不得**出现：

- `ImportError`、`AttributeError`、`NameError`、`KeyError`
- `[PYTHON_UNCAUGHT_EXCEPTION]`
- `[UI_BIND][ERROR]`、`[ROUTE][ERROR]`、`[BRIDGE][ERROR]`、`[SYNC][ERROR]`、`[CONTROL_COMMAND][ERROR]`
- `legacy fields still exist before save`（需区分场景，见下）

### `legacy fields still exist before save` 的区分

| 场景 | 期望 |
|------|------|
| 正在修旧字段污染上游 | 该错误应**消失** |
| 正在保护 `legacy_cleanup.py` guard | 该错误表示 guard **仍在工作**，不能因此删除 guard |

## 第三层：功能回归门槛

至少验证：

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

## 观察期：暂不删除的项

以下代码**先观察、后删除**（命中时打日志，不在每次启动无条件刷日志）：

| 名称 | 观察日志 |
|------|----------|
| `LEGACY_KEYS` / `DEPRECATED_TOOLBOX_PATCH_KEYS`（若存在） | `[MIGRATION_HIT]` / `[DEPRECATED_HIT]` |
| `remote_binding_enabled()` | `[DEPRECATED_HIT]`（进程内首次调用，避免刷屏） |
| `persist_qsettings_last_url()` 清理旧 QSettings key | `[MIGRATION_HIT]` |
| `PENDING_REPLY_STALE_TIMEOUT_SEC` | 待接入 |
| `status_chip_text()` | 待接入 |

统一格式（实现见 `app/utils/deprecation_log.py`）：

```
[DEPRECATED_HIT] name=<名称> reason=<原因> replacement=<替代方案> caller=<调用方>
[MIGRATION_HIT] name=<名称> old=<旧字段> new=<新字段> reason=<原因>
```

**注意**：不要给高频热路径每次调用都打 `warning`，否则日志会被刷爆；仅低频兼容包装、导入迁移、旧字段命中时记录。

## 观察期退出条件（满足后再删）

1. 连续**两个导出版本**没有 `DEPRECATED_HIT` / `MIGRATION_HIT` / `COMPAT_HIT`；
2. `rg` 只有定义处；
3. 动态引用扫描无命中；
4. GUI 全量启动无异常；
5. 相关回归测试通过；
6. 删除后配置导入、同步、发送、上传、Prompt 管理均正常。

## 观察期不可删除（任一即保留）

1. 日志仍有命中；  
2. 旧配置导入仍依赖；  
3. 用户本地历史数据可能仍会触发迁移；  
4. Flask / API / Qt 动态入口无法排除；  
5. 删除后只能靠人工点击才发现问题；  
6. 代码属于 **guard**，而非业务流程。

## 当前分类摘要

### A. 可修复后清理

- `DEFAULT_AUTO_CONFIG`（缺 `modeSettings` 等，应先替换引用）
- `job.get("status")` / `j.get("status")` 等旧字段残留读取

### B. 观察后再删

见上表「观察期」项。

### C. 明确不能删

- `legacy_cleanup.py` 及 `assert_no_legacy_fields` / `reject_legacy_fields` 链路
- Qt 信号槽入口、Flask route/API 入口
- 生成产物 `client.user.js` 本身（改源码后构建）

## 验证命令

```bash
python -m compileall -q app gui.py server.py
python tools/find_dead_code_candidates.py
python tools/find_dynamic_reference_entries.py
python tools/check_dead_code_regression.py
pytest -q
```

## 相关工具

| 工具 | 用途 |
|------|------|
| `tools/find_dead_code_candidates.py` | 候选符号与旧模式扫描 |
| `tools/find_dynamic_reference_entries.py` | 动态引用入口 |
| `tools/check_dead_code_regression.py` | 回归检查脚本 |
| `app/utils/deprecation_log.py` | 观察期统一日志 |
