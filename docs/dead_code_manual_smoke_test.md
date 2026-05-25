# Dead Code Cleanup Manual Smoke Test

本文档用于记录僵尸代码清理后的手工冒烟测试。

静态扫描和单元测试不能完全覆盖 PyQt 信号槽、Flask API、油猴页面交互、浏览器 DOM 状态和 Cursor 队列联动，因此每次删除候选代码后，必须至少执行一次手工冒烟测试。

> **精简发布包**：通常无 `tests/`、无 `tools/`、无独立 `server.py`。启动与桥接验收以 `python GUI.py` 为准（桥接服务内嵌于 GUI 进程）。

---

## 1. 启动验证

### 1.1 启动 GUI

命令：

```bash
python GUI.py
```

通过标准：

- GUI 能正常打开；
- 没有 ImportError；
- 没有 AttributeError；
- 没有 NameError；
- 没有 `[PYTHON_UNCAUGHT_EXCEPTION]`；
- 主窗口按钮正常显示；
- 页面状态区域正常刷新；
- 顶部状态栏显示桥接服务已监听（默认 `127.0.0.1:5000`）。

### 1.2 独立服务端（仅完整开发仓库）

当前精简包**没有**仓库根目录 `server.py`。桥接由 `GUI.py` 内嵌 `app/server/` 启动。

若你在完整仓库中单独调试 Flask，可使用：

```bash
python -c "from app.server import create_app, start_server; ..."
```

或通过 GUI 启动后观察 `log.txt` 中的 `[SERVER]` 日志。勿将 `python server.py` 当作精简包验收步骤。

---

## 2. GUI 基础功能验证

逐项点击并记录结果（`pass` / `fail` / `N/A`）：

| 项 | 操作 | 通过标准 |
|----|------|----------|
| 页面 registry | 打开页面选择/刷新列表 | 油猴在线页面能列出；无 `[BRIDGE][ERROR]` |
| 绑定页面 | 新建对话或手动绑定首页/对话页 | 绑定状态颜色与文案正确 |
| 同步对话 | 同步当前 ChatGPT 对话 | 会话标题/上下文无异常 |
| 发送 Prompt | 向已绑定页发送一条短消息 | 油猴收到并尝试发送；GUI 进入等待回复 |
| 复制最后回复 | 使用复制最后回复相关按钮 | 剪贴板或日志无异常 |
| 设置页 | 打开设置并保存一项 | 无崩溃；`runtime/` 配置可写 |

---

## 3. 上传流程

| 项 | 操作 | 通过标准 |
|----|------|----------|
| 上传面板 | 油猴工具箱切到上传 tab | 分组栏在「开始上传」上方可见 |
| 开始上传 | 选文件后点击开始上传 | 进度更新；无静默失败 |
| 停止任务 | 上传过程中停止 | 任务可中止；状态恢复 |

---

## 4. Cursor 联动

| 项 | 操作 | 通过标准 |
|----|------|----------|
| 发送到 Cursor | GUI 发送到 Cursor（若启用） | 队列无卡死；日志无未捕获异常 |
| 自动指令队列 | 触发自动队列相关路径（若使用） | 状态迁移正常 |

---

## 5. 油猴与浏览器

| 项 | 操作 | 通过标准 |
|----|------|----------|
| 脚本加载 | ChatGPT 页刷新 | 控制台有 `[联动]` 类日志；Bridge 状态栏更新 |
| poll/ack | GUI 发送后观察网络或日志 | poll 正常；ack/report 无旧字段拒绝风暴 |

---

## 6. 日志检查

检查项目根 `log.txt`（及 GUI 日志面板）：

- 无新增 `[PYTHON_UNCAUGHT_EXCEPTION]`
- 无新增 `[BRIDGE][ERROR]` / `[ROUTE][ERROR]`
- 删除相关符号无 `NameError` / `AttributeError` 堆栈

---

## 7. 记录模板

```text
gui_start=
bridge_embedded_server=
page_bind_refresh=
prompt_send=
upload_flow=
cursor_flow=
tampermonkey_load=
log_errors=
notes=
```

与 PR 模板 §5 字段一致；完整开发仓库另可在有 `tests/` 时跑 `pytest -q`。
