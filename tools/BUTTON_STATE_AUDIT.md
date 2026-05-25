# 按钮状态一致性 — 本地全源码核验

在**项目根目录**执行；只扫描 `chatgpt-toolbox/tampermonkey-userscript-src/`，不要只查生成后的 `client.user.js`。

## 100. 本地完整核验命令（PowerShell）

### 100.1 进入源码目录

```powershell
Set-Location chatgpt-toolbox
```

### 100.2 搜索所有按钮创建

```powershell
rg -n "document\.createElement\(['`"]button['`"]\)|<button|type=['`"]button['`"]" tampermonkey-userscript-src
```

### 100.3 搜索所有点击绑定

```powershell
rg -n "addEventListener\(['`"]click['`"]|DomUtil\.bindClick|onclick|data-cgpt-action|data-action" tampermonkey-userscript-src
```

### 100.4 搜索按钮文案直接修改

```powershell
rg -n "\.textContent\s*=|\.innerText\s*=" tampermonkey-userscript-src
```

重点：上传中 / 发送中 / 等待回复 / 复制中 / 停止连续 / 停止中 / 取消等待。

### 100.5 搜索按钮 disabled 直接修改

```powershell
rg -n "\.disabled\s*=|setAttribute\(['`"]aria-disabled['`"]" tampermonkey-userscript-src
```

### 100.6 搜索颜色 class 直接修改

```powershell
rg -n "classList\.add|classList\.remove|className\s*=" tampermonkey-userscript-src
```

### 100.7 搜索 dataset 状态

```powershell
rg -n "dataset\.(busy|running|actionRunning|waitingReply|buttonPhase|uploadSendState)" tampermonkey-userscript-src
```

### 100.8 搜索旧 selector 残留

```powershell
rg -n "#cgpt-upload-auto-continue|cgpt-upload-auto-continue" tampermonkey-userscript-src
```

应统一为 `#cgpt-auto-continue-once` 或兼容查找函数。

### 100.9 搜索 Enter 发送逻辑

```powershell
rg -n "triggerToolboxSendMessageByEnter|findToolboxSendMessageButton|enter-send|send-button-disabled" tampermonkey-userscript-src
```

### 100.10 搜索 runUploadActionPromise

```powershell
rg -n "function runUploadActionPromise|runUploadActionPromise\(" tampermonkey-userscript-src
```

## 101. 自动扫描脚本

```powershell
Set-Location ..   # 回到项目根目录
python tools/button_state_audit_scan.py
```

生成：`button_state_audit_report.md`（项目根目录）。

## 102. 用扫描报告判断是否真的完成

### 102.1 可以判定完成的条件（须全部满足）

1. 所有按钮 ID 都能在报告中找到创建和绑定位置。
2. 长流程按钮都能找到对应 `task.phase`。
3. 没有长流程按钮继续直接散落修改 `textContent` / `disabled` / `classList`。
4. `#cgpt-upload-start` 不再在 `state.running` 时 `disabled`。
5. `#cgpt-upload-start` 不再默认 `success` 绿色。
6. `#cgpt-upload-start-send` waiting 状态不再默认 `danger` 红色（可取消态应可点）。
7. `#cgpt-copy-hotkey-continue-once` 等待回复时不 `disabled`。
8. `#cgpt-copy-hotkey-continue-loop` 不存在 direct click + delegated click 双入口。
9. Enter 发送不再**只**依赖 `sendBtn.disabled`。
10. `runUploadActionPromise` 不再统一覆盖按钮颜色和文案。
11. Prompt / Export 按钮有 running / success / failed 反馈。
12. `npm run build` 成功。

### 102.2 仍不能判定完成的情况（任一条即未完成）

1. 报告里还有未解释的 button id。
2. 长流程函数里仍有 `btn.textContent = '等待回复'` 等直接赋值。
3. 仍有 `disabled: state.running`。
4. 仍有 waitingSend 误用 danger 且不可取消。
5. 仍有用 `textContent === '取消等待'` 反推状态。
6. 仍有 `classList.contains('cgpt-wait-send-cancel')` 反推状态。
7. Enter 发送仍然 `sendBtn.click()` 且只看 `disabled`。
8. 同一按钮同时出现在 direct bind 和 delegated bind（且无 skip 守卫）。
9. `catch` 只 `setStatus`，不 `console.error`。
10. `finally` 没有恢复按钮状态。

## 103. 构建验证

```powershell
Set-Location chatgpt-toolbox
npm run build
```

确认 `dist/client.user.js` 顶部有 `GENERATED FILE - DO NOT EDIT DIRECTLY`，且根目录 `client.user.js` 已同步。

## 104. 为何不能继续堆审查文字，也不能输出完成信号（§151–155）

### 151

任务在文字侧已交付：按钮清单、phase 方案、50+ 条不一致项、统一状态函数方案、Cursor 指令、扫描脚本、§8 判定表。  
**不是「分析没写完」**，而是**没有新的可验证信息**可再靠文字产生。

### 152

闭环需要四类**执行回传**，不是第五份 prose：

1. `button_state_audit_report.md` — 跑 `button_state_audit_scan.py`
2. 源码 diff — 证明已接 `ButtonState` / `ButtonTasks`
3. `npm run build` 日志
4. **§131 手工测试**结果（唯一常缺项）

缺第 4 项则无法断定 UI 是否真恢复。

### 153

`<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>` 仅当 §8 全部 ✅（含手工测试）时输出。  
构建成功 ≠ 任务闭环。

### 154

下一轮请提供：新 zip、build 日志、更新报告、或 §131 失败日志/截图——不要要求「再写一轮审查」。

### 155

| 项 | 状态 |
|---|---|
| 方案与指令 | 完成 |
| 源码改造（ButtonState / ButtonTasks / VM） | 完成（见下方「已落地文件」） |
| 扫描 + build（本地） | 完成（见 `button_state_audit_report.md` §10.2） |
| fail_gate | **PASS**（`python tools/button_state_audit_fail_gate.py`） |
| VM 矩阵契约（§131 对应） | **PASS**（`python tools/button_state_vm_matrix_test.py`） |
| 浏览器手工测试 | **未完成**（§10.4「浏览器实测」列仍为「待测」） |
| 终止信号 | **禁止输出**（直至 §10.4 浏览器实测全 ✅） |

已落地文件（源码，非生成物）：

- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-tasks.js`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-button-vm.js`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-send-button-vm.js`
- `chatgpt-toolbox/tampermonkey-userscript-src/.build-order.json`（已纳入构建顺序）

详见根目录 `button_state_audit_report.md` §10。
