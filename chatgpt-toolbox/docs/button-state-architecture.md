# 工具箱按鈕狀態架構（審查表 / 代碼結構 / 改造順序）

## 最小落地代碼結構

```
tampermonkey-userscript-src/
├── core/
│   ├── button-state.js      # setToolboxButtonState / setButton* / 一致性日誌
│   ├── button-tasks.js      # window.CGPT_BUTTON_TASKS + mirror / assert / renderAll
│   └── state.js
├── upload/
│   ├── upload-button-vm.js    # 上傳區按鈕 phase → 文案/disabled 矩陣
│   ├── upload-send-button-vm.js
│   └── upload-module.js         # sync*FromLegacyState、renderUploadButtonsOnly
└── autoqueue/
    ├── auto-queue-core.js       # batchTask、renderQueueActionButtons
    └── prompt-manager-module.js # Prompt 獨立短暫狀態
```

**數據流：**

1. 模組內部 `state.uploadTask` / `sendTask` / `copyTask` / `batchTask`（真實運行態）
2. `sync*FromLegacyState()` 從 legacy flags（`state.running`、`waitingSend` 等）推導 phase
3. `syncButtonTasksFromModuleState()` → `window.CGPT_BUTTON_TASKS`
4. `UploadButtonVm` / `applySendMessageButtonState` → `ButtonState.setToolboxButtonState`
5. `assertButtonStateConsistency` / `assertRenderedUploadButtonConsistency` 開發期告警

---

## 15. 按模組逐按鈕審查表

### 15.1 上傳模組（`#cgpt-upload-start`）

| 按鈕 UI | 正確狀態變量 | 當前重點風險 | 修復要求 | 實作位置 |
|--------|-------------|-------------|---------|---------|
| 開始上傳 | `uploadTask.phase === idle` | 只看 `state.running` | 只看 `uploadTask.phase` | `syncUploadTaskFromLegacyState` + `UploadButtonVm` |
| 上傳中 | `uploading` | disabled 導致無法取消 | 不 disabled，紅色可取消 | `getUploadButtonViewState` |
| 等待可發送 | `waiting_send` | 仍顯示「上傳中」 | 文案「等待可发送，点击取消」 | 同上（合併 send 等待態到 uploadTask） |
| 發送中 | `sending` | 與上傳混用 | `sendTask` / uploadTask 鏡像 | `syncUploadTaskFromLegacyState` |
| 等待回覆 | `waiting_reply` | 提前恢復 idle | 回覆結束前保持 | 同上 |
| 上傳完成 | `success` | 永久綠色 | 短暫 success 後 idle | `flashButtonThenIdle`（待接入上傳完成路徑） |
| 上傳失敗 | `failed` | 按鈕不恢復 | finally 恢復 | 上傳 catch/finally |
| 已取消 | `cancelled` | — | 短暫灰色後 idle | `cancelUploadFlow` |

### 15.2 發送模組（`#cgpt-upload-start-send`）

| 按鈕 UI | 狀態變量 | 風險 | 修復 | 實作 |
|--------|---------|------|------|------|
| 發送信息 | `sendTask.phase === idle` | 依賴原生 send disabled | 自有 `sendTask` | `applySendMessageButtonState` |
| 等待可發送 | `waiting_ready` → mirror `waiting_send` | disabled | 可取消 | `setButtonSending` |
| 正在發送 | `sending` | 失敗不恢復 | catch/finally | `resetUploadSendUiState` |
| 等待回覆 | `waiting_reply` | 提前 idle | 保持至結束 | 同上 |
| 取消 | `cancelRequested` + abort | 只改字 | `cancelUploadFlow` | `clearWaitingSendTimersForCancel` |

### 15.3 自動繼續（`#cgpt-auto-continue-once`）

| 狀態 | 變量 | 要求 |
|------|------|------|
| 繼續一次 | `continueTask.phase`（規劃） | 單次加鎖，勿與 `upload.running` 混用 |
| 自動繼續 | `autoContinueTask` | 獨立對象 + `stopRequested` |
| 等待回覆後繼續 | `waiting_reply` | 允許停止 |

### 15.4 複製按鈕

| 按鈕 | phase 集合 | 要求 | 實作 |
|------|-----------|------|------|
| 複製最後回覆 | idle / waiting_reply / copying / success / failed | 等待時勿顯示「複製中」 | `getCopyLastReplyButtonViewState` |
| 複製+快捷鍵 | 運行中可短暫 disabled | 防重複點擊 | `getCopyHotkeyOnceButtonViewState` |
| 連續複製+繼續 | running | 運行中必須可停止 | `getCopyHotkeyLoopButtonViewState` |

### 15.5 批量任務（AutoQueue `start` / `stop`）

| 按鈕 | 變量 | 要求 | 實作 |
|------|------|------|------|
| 開始批量 | `batchTask.phase === idle` | 勿用 `uploadTask` | `syncBatchTaskPhase` |
| 停止 | `stopRequested` + `cancelling` | 不可 disabled | `renderQueueActionButtons` + `setButtonDanger` |
| 等待回覆 | `waiting_reply` | 勿誤恢復 idle | `AUTO_QUEUE_PHASES` |
| 完成 | `completed` | 短暫「已完成」 | `ButtonState.flashButtonThenIdle` |

### 15.6 Prompt 管理

| 按鈕 | 狀態 | 要求 |
|------|------|------|
| 保存 / 導入 | `promptTask.phase` 短暫 busy | 保存中可 disabled |
| 刪除 | 無長期狀態 | 始終 danger 紅色 |
| 上移 / 下移 | 列表位置 | 不受上傳/批量 running 影響 |
| 應用 | 短暫 success | 與全局 running 解耦 |

---

## 16. 全局任務對象

```javascript
window.CGPT_BUTTON_TASKS = {
  upload, send, copy, continue, batch, prompt
};
// 各含：phase, runId, cancelRequested, stopRequested, abortController, lastError
```

同步入口：`UploadModule.syncButtonTasksFromModuleState()`、`AutoQueueModule.syncBatchButtonTask()`。

---

## 17–18. 點擊行為與運行時斷言

- 上傳點擊：`idle` → `startUploadOnlyFlow`；可取消 phase → `cancelUploadFlow`；`cancelling` → 忽略並打日誌。
- 批量點擊：運行中 → `stop` + `batchTask.stopRequested`。
- 連續複製：運行中 → `stopContinuousCopy`。
- 斷言：`ButtonTasks.assertButtonStateConsistency` + `ButtonState.assertCancellableButtonConsistency`。

日誌前綴：`[BUTTON_STATE][CHANGE|CLICK|CANCEL|MISMATCH]`。

---

## 19. 最小遷移順序（Cursor 可執行）

| 步驟 | 內容 | 狀態 |
|------|------|------|
| 1 | 新增 `button-tasks.js` + `CGPT_BUTTON_TASKS` | ✅ |
| 2 | 接管上傳按鈕（`UploadButtonVm` + `syncUploadTaskFromLegacyState`） | ✅ |
| 3 | 接管發送按鈕（`applySendMessageButtonState`） | ✅ |
| 4 | 接管批量按鈕（`syncBatchButtonTask` + `renderQueueActionButtons`） | ✅ |
| 5 | 接管複製/繼續（VM + 連續複製 danger） | ✅ 主路徑 |
| 6 | Prompt 按鈕獨立 | 🔲 待 `prompt-manager-module` 接入 `prompt` task |
| 7 | 刪除散落 `textContent` / `classList` 直改 | 🔲 逐步替換剩餘直寫 |
| 8 | 斷言與日誌全開 | ✅ 主按鈕已接 |

---

## 20. 驗收清單

1. 上傳中可點擊取消 — `allowCancel: true`
2. 等待可發送可取消 — `waiting_send` 文案
3. 發送中可取消 — `applySendMessageButtonState`
4. 回覆中複製顯示「等待回复后复制」— `getCopyLastReplyButtonViewState`
5. 批量運行不污染上傳按鈕 — 分離 `batchTask` / `UploadModule.applyStartUploadButtonState` 僅 task 模式副按鈕
6. 多入口狀態同步 — `renderAllButtonStates` + `syncButtonTasksFromModuleState`
7. 異常後恢復 — finally + `resetUploadSendUiState`
8. 取消後 timer 清理 — `clearWaitingSendTimersForCancel`
9. 禁止只改字不改狀態 — VM 單一路徑
10. 禁止顯示開始但後台仍跑 — `assertButtonStateConsistency`
