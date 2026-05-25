# 按钮状态一致性本地扫描报告

## 1. 按钮 ID 命中清单

### cgpt-upload-start

- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:226` `startBtn: '#cgpt-upload-start',`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:227` `startSendBtn: '#cgpt-upload-start-send',`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:775` `#${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-upload-start #cgpt-upload-start {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1837` `#cgpt-upload-start {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1843` `#cgpt-upload-start:hover:not(:disabled) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1847` `#cgpt-upload-start:disabled {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1870` `#cgpt-upload-start-send {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1876` `#cgpt-upload-start-send:hover:not(:disabled) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1880` `#cgpt-upload-start-send.cgpt-wait-send-cancel,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1881` `#cgpt-upload-start-send.danger,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1882` `#cgpt-upload-start-send[data-upload-send-state="sending"],`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1883` `#cgpt-upload-start-send[data-upload-send-state="waiting-reply"],`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1884` `#cgpt-upload-start-send[aria-busy="true"],`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1885` `#cgpt-upload-start-send.cgpt-wait-send-cancel:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1886` `#cgpt-upload-start-send.danger:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1887` `#cgpt-upload-start-send[data-upload-send-state="sending"]:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1888` `#cgpt-upload-start-send[data-upload-send-state="waiting-reply"]:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1889` `#cgpt-upload-start-send[aria-busy="true"]:hover:not(:disabled) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1897` `#cgpt-upload-start-send:disabled {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8073` `'#cgpt-upload-start-send',`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8074` `'#cgpt-upload-start',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:10536` `? qsa('#cgpt-upload-start', rootElRef)`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14819` `<button type="button" class="cgpt-btn cgpt-btn-idle" id="cgpt-upload-start" data-action="start-upload" title="只上传/绑定文件到 ChatGPT 输入框，不自动发送">开始上传</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14820` `<button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send" data-action="send-message" title="发送当前输入框中的文字和附件">发送信息</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14981` `const legacyUploadAndSendBtn = qs('#cgpt-upload-start-and-send', actionRow);`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14984` `ToolboxShell.appendLog('[UPLOAD_UI][REMOVED_LEGACY] button=cgpt-upload-start-and-send');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15129` `selector: '#cgpt-upload-start',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15133` `selector: '#cgpt-upload-start-send',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15177` `before: '#cgpt-upload-start',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15184` `child: '#cgpt-upload-start',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15190` `child: '#cgpt-upload-start-send',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15227` `before: '#cgpt-upload-start',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15239` `before: '#cgpt-upload-start-send',`

### cgpt-upload-start-send

- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:227` `startSendBtn: '#cgpt-upload-start-send',`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1870` `#cgpt-upload-start-send {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1876` `#cgpt-upload-start-send:hover:not(:disabled) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1880` `#cgpt-upload-start-send.cgpt-wait-send-cancel,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1881` `#cgpt-upload-start-send.danger,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1882` `#cgpt-upload-start-send[data-upload-send-state="sending"],`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1883` `#cgpt-upload-start-send[data-upload-send-state="waiting-reply"],`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1884` `#cgpt-upload-start-send[aria-busy="true"],`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1885` `#cgpt-upload-start-send.cgpt-wait-send-cancel:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1886` `#cgpt-upload-start-send.danger:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1887` `#cgpt-upload-start-send[data-upload-send-state="sending"]:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1888` `#cgpt-upload-start-send[data-upload-send-state="waiting-reply"]:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1889` `#cgpt-upload-start-send[aria-busy="true"]:hover:not(:disabled) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1897` `#cgpt-upload-start-send:disabled {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8073` `'#cgpt-upload-start-send',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14820` `<button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send" data-action="send-message" title="发送当前输入框中的文字和附件">发送信息</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15133` `selector: '#cgpt-upload-start-send',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15190` `child: '#cgpt-upload-start-send',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15239` `before: '#cgpt-upload-start-send',`

### cgpt-upload-continue-once

- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:349` `const isCopyContinueBtn = button.id === 'cgpt-upload-continue-once';`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:453` `return id === 'cgpt-upload-continue-once' || id === 'cgpt-copy-last-message-scroll-bottom';`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:228` `copyContinueBtn: '#cgpt-upload-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1903` `#cgpt-upload-continue-once,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1904` `#cgpt-upload-continue-once.copy-continue,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1905` `#cgpt-upload-continue-once.cgpt-btn-busy {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1913` `#cgpt-upload-continue-once:hover {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1917` `#cgpt-upload-continue-once.cgpt-waiting-answer,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1918` `#cgpt-upload-continue-once.cgpt-waiting-answer:hover {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8072` `'#cgpt-upload-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14821` `<button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" data-action="copy-and-continue" title="先复制最后回复，再发送“继续”">复制并继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15137` `selector: '#cgpt-upload-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15138` `missingLog: '[UPLOAD_DOM][missing] #cgpt-upload-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15196` `child: '#cgpt-upload-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15240` `after: '#cgpt-upload-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15245` `before: '#cgpt-upload-continue-once',`

### cgpt-send-hotkey-once

- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:229` `sendHotkeyBtn: '#cgpt-send-hotkey-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14822` `<button type="button" class="cgpt-btn warning" id="cgpt-send-hotkey-once" data-action="send-hotkey">发送 Ctrl+Alt+I</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15011` `sendHotkeyBtn.id = 'cgpt-send-hotkey-once';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15142` `selector: '#cgpt-send-hotkey-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15143` `missingLog: '[UPLOAD_DOM][missing] #cgpt-send-hotkey-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15246` `after: '#cgpt-send-hotkey-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15251` `before: '#cgpt-send-hotkey-once',`

### cgpt-auto-continue-once

- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:230` `autoContinueBtn: '#cgpt-auto-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14824` `<button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-once" data-action="auto-continue">自动继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15038` `autoContinueBtn.id = 'cgpt-auto-continue-once';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15152` `selector: '#cgpt-auto-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15153` `missingLog: '[UPLOAD_DOM][missing] #cgpt-auto-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15258` `after: '#cgpt-auto-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15263` `before: '#cgpt-auto-continue-once',`

### cgpt-copy-last-message-scroll-bottom

- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:453` `return id === 'cgpt-upload-continue-once' || id === 'cgpt-copy-last-message-scroll-bottom';`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:231` `copyLastMessageBtn: '#cgpt-copy-last-message-scroll-bottom',`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1926` `#cgpt-copy-last-message-scroll-bottom {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1935` `#cgpt-copy-last-message-scroll-bottom[disabled] {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1939` `#cgpt-copy-last-message-scroll-bottom:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1940` `#cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer:hover:not(:disabled),`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1941` `#cgpt-copy-last-message-scroll-bottom.waiting:hover:not(:disabled) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1945` `#cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1946` `#cgpt-copy-last-message-scroll-bottom.waiting {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1952` `#cgpt-copy-last-message-scroll-bottom.warning {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1958` `#cgpt-copy-last-message-scroll-bottom.success,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1959` `#cgpt-copy-last-message-scroll-bottom.cgpt-btn-ok {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1966` `#cgpt-copy-last-message-scroll-bottom.cgpt-btn-error {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1972` `#cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer:disabled {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1977` `#cgpt-copy-last-message-scroll-bottom:disabled {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8071` `'#cgpt-copy-last-message-scroll-bottom',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14825` `<button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom" data-action="copy-only">复制最后回复</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15117` `selector: '#cgpt-copy-last-message-scroll-bottom',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15118` `missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-last-message-scroll-bottom',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15123` `child: '#cgpt-copy-last-message-scroll-bottom',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15264` `after: '#cgpt-copy-last-message-scroll-bottom',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15284` `before: '#cgpt-copy-last-message-scroll-bottom',`

### cgpt-copy-hotkey-continue-once

- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:233` `copyHotkeyContinueOnceBtn: '#cgpt-copy-hotkey-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14833` `<button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" data-action="copy-hotkey-continue" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">复制+快捷键+继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15068` `copyHotkeyContinueOnceBtn.id = 'cgpt-copy-hotkey-continue-once';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15274` `selector: '#cgpt-copy-hotkey-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15275` `missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15291` `after: '#cgpt-copy-hotkey-continue-once',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15296` `before: '#cgpt-copy-hotkey-continue-once',`

### cgpt-copy-hotkey-continue-loop

- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:516` `if (id === 'cgpt-copy-hotkey-continue-loop' && button.classList.contains('cgpt-action-running')) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:234` `copyHotkeyContinueLoopBtn: '#cgpt-copy-hotkey-continue-loop',`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1831` `#cgpt-copy-hotkey-continue-loop.danger {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14834` `<button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" data-action="loop-copy-hotkey-continue" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">连续复制+快捷键+继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15081` `copyHotkeyContinueLoopBtn.id = 'cgpt-copy-hotkey-continue-loop';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15279` `selector: '#cgpt-copy-hotkey-continue-loop',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15280` `missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-loop',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15297` `after: '#cgpt-copy-hotkey-continue-loop',`

### cgpt-autoq-start

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9298` `let btn = qs('#cgpt-autoq-start-upload', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9304` `const batchStartBtn = qs('#cgpt-autoq-start', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9312` `btn.id = 'cgpt-autoq-start-upload';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9330` `startBtn = qs('#cgpt-autoq-start', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9397` `<button type="button" class="cgpt-btn primary" id="cgpt-autoq-start-upload">开始上传</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9398` `<button type="button" class="cgpt-btn primary" id="cgpt-autoq-start">开始</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9442` `startBtn = qs('#cgpt-autoq-start', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9443` `startUploadBtn = qs('#cgpt-autoq-start-upload', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:2534` `#cgpt-autoq-start {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:2540` `#cgpt-autoq-start:disabled {`

### cgpt-autoq-send-once

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:6693` `const sendOnceBtn = root ? qs('#cgpt-autoq-send-once', root) : null;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:6777` `const sendOnceBtn = root ? qs('#cgpt-autoq-send-once', root) : null;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9222` `const sendOnceBtn = qs('#cgpt-autoq-send-once', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9399` `<button type="button" class="cgpt-btn primary" id="cgpt-autoq-send-once">发送一次</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:862` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-send-once,`

### cgpt-autoq-stop

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9331` `stopBtn = qs('#cgpt-autoq-stop', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9400` `<button type="button" class="cgpt-btn danger cgpt-toolbox-hidden" id="cgpt-autoq-stop" disabled aria-hidden="true">停止</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9444` `stopBtn = qs('#cgpt-autoq-stop', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:501` `'cgpt-autoq-stop',`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:2545` `#cgpt-autoq-stop {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:2551` `#cgpt-autoq-stop:disabled {`

### cgpt-autoq-clear-log

- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:857` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-clear-log,`

### cgpt-autoq-list-new

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9248` `const newListBtn = qs('#cgpt-autoq-list-new', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9373` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-new">新建列表</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:860` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-new,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:2482` `#cgpt-autoq-list-new {`

### cgpt-autoq-list-save-name

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9255` `const saveNameBtn = qs('#cgpt-autoq-list-save-name', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9378` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-save-name">保存名称</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:859` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-save-name,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:2480` `#cgpt-autoq-list-save-name,`

### cgpt-autoq-list-delete

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9262` `const deleteListBtn = qs('#cgpt-autoq-list-delete', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9379` `<button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-autoq-list-delete">删除列表</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:858` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-delete,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:2481` `#cgpt-autoq-list-delete,`

### cgpt-prompt-save-btn

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1207` `const saveBtn = modalOverlay ? qs('#cgpt-prompt-save-btn', modalOverlay) : null;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1811` `<button type="button" class="cgpt-btn primary" id="cgpt-prompt-save-btn">保存</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1825` `qs('#cgpt-prompt-save-btn', modalOverlay).addEventListener('click', saveEditor);`

### cgpt-prompt-delete-btn

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1124` `const deleteBtn = qs('#cgpt-prompt-delete-btn', modalOverlay);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1297` `const deleteBtn = modalOverlay ? qs('#cgpt-prompt-delete-btn', modalOverlay) : null;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1806` `<button type="button" class="cgpt-btn danger" id="cgpt-prompt-delete-btn">删除</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1826` `qs('#cgpt-prompt-delete-btn', modalOverlay).addEventListener('click', deleteCurrentPrompt);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:502` `'cgpt-prompt-delete-btn',`

### cgpt-prompt-duplicate-btn

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1125` `const duplicateBtn = qs('#cgpt-prompt-duplicate-btn', modalOverlay);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1336` `const duplicateBtn = modalOverlay ? qs('#cgpt-prompt-duplicate-btn', modalOverlay) : null;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1807` `<button type="button" class="cgpt-btn" id="cgpt-prompt-duplicate-btn">复制一份</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1827` `qs('#cgpt-prompt-duplicate-btn', modalOverlay).addEventListener('click', duplicateCurrentPrompt);`

### cgpt-prompt-cancel-btn

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1810` `<button type="button" class="cgpt-btn" id="cgpt-prompt-cancel-btn">取消</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1824` `qs('#cgpt-prompt-cancel-btn', modalOverlay).addEventListener('click', closeEditor);`

### cgpt-prompt-new-quick-btn

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1838` `bindClick(root, '#cgpt-prompt-new-quick-btn', () => openEditor(null), {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1840` `bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-new-quick-btn',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1975` `<button type="button" class="cgpt-btn primary" id="cgpt-prompt-new-quick-btn">+ 新建 Prompt</button>`

### cgpt-prompt-export-btn

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1842` `bindClick(root, '#cgpt-prompt-export-btn', exportPrompts, {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1844` `bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-export-btn',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1976` `<button type="button" class="cgpt-btn" id="cgpt-prompt-export-btn">导出</button>`

### cgpt-prompt-import-btn

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1846` `bindClick(root, '#cgpt-prompt-import-btn', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1850` `bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-import-btn',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1977` `<button type="button" class="cgpt-btn" id="cgpt-prompt-import-btn">导入</button>`

### cgpt-prompt-reset-btn

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1852` `bindClick(root, '#cgpt-prompt-reset-btn', resetDefaultPrompts, {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1854` `bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-reset-btn',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1978` `<button type="button" class="cgpt-btn danger" id="cgpt-prompt-reset-btn">重置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:503` `'cgpt-prompt-reset-btn',`

### cgpt-export-copy-chat

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:431` `selector: '#cgpt-export-copy-chat',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:691` `<button type="button" class="cgpt-btn primary" id="cgpt-export-copy-chat">复制完整对话</button>`

### cgpt-export-copy-panel

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:444` `selector: '#cgpt-export-copy-panel',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:692` `<button type="button" class="cgpt-btn" id="cgpt-export-copy-panel">复制工具箱配置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:914` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-panel,`

### cgpt-export-refresh-stats

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:457` `selector: '#cgpt-export-refresh-stats',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:707` `<button type="button" class="cgpt-btn primary" id="cgpt-export-refresh-stats">刷新统计</button>`

### cgpt-export-copy-stats

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:469` `selector: '#cgpt-export-copy-stats',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:708` `<button type="button" class="cgpt-btn" id="cgpt-export-copy-stats">复制统计 JSON</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:916` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-stats {`

### cgpt-export-prompts

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:508` `DomUtil.bindClick(root, '#cgpt-export-prompts', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:509` `const btn = root ? qs('#cgpt-export-prompts', root) : null;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:693` `<button type="button" class="cgpt-btn" id="cgpt-export-prompts">导出 Prompt</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:915` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-prompts,`

### cgpt-export-settings

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:528` `bindClick(root, '#cgpt-export-settings', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:529` `const btn = root ? qs('#cgpt-export-settings', root) : null;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:545` `bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:546` `bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:549` `settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:550` `settingsImportBtn = qs('#cgpt-export-settings-import', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:552` `bindClick(root, '#cgpt-export-settings-import', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:563` `bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings-import',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:564` `bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings-import',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:723` `<button type="button" class="cgpt-btn primary" id="cgpt-export-settings">导出工具箱设置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:724` `<button type="button" class="cgpt-btn" id="cgpt-export-settings-import">导入工具箱设置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:725` `<input type="file" id="cgpt-export-settings-import-file" accept="application/json,.json" class="cgpt-toolbox-hidden">`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:748` `settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);`

### cgpt-export-settings-import

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:549` `settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:550` `settingsImportBtn = qs('#cgpt-export-settings-import', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:552` `bindClick(root, '#cgpt-export-settings-import', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:563` `bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings-import',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:564` `bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings-import',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:724` `<button type="button" class="cgpt-btn" id="cgpt-export-settings-import">导入工具箱设置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:725` `<input type="file" id="cgpt-export-settings-import-file" accept="application/json,.json" class="cgpt-toolbox-hidden">`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:748` `settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);`

### cgpt-open-chatgpt-home

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:3065` `if (el.id === 'cgpt-open-chatgpt-home') continue;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:256` `homeBtn: '#cgpt-open-chatgpt-home',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14823` `<button type="button" class="cgpt-btn primary" id="cgpt-open-chatgpt-home" data-action="click-new-chat" title="点击左侧新聊天">回到首页</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15024` `homeBtn.id = 'cgpt-open-chatgpt-home';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15148` `missingLog: '[UPLOAD_DOM][missing] #cgpt-open-chatgpt-home',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15203` `child: '#cgpt-open-chatgpt-home',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15252` `after: '#cgpt-open-chatgpt-home',`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15257` `before: '#cgpt-open-chatgpt-home',`

### cgpt-toolbox-toggle

- `chatgpt-toolbox/tampermonkey-userscript-src/core/boot.js:10` `'#cgpt-toolbox-toggle',`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:31` `toggleId: 'cgpt-toolbox-toggle',`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:375` `.cgpt-toolbox-toggle-icon {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:384` `.cgpt-toolbox-toggle-icon::before {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3776` `icon.className = 'cgpt-toolbox-toggle-icon';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4371` `<span class="cgpt-toolbox-toggle-icon" aria-hidden="true"></span>`

### cgpt-toolbox-compact

- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:669` `#${APP.panelId}.cgpt-toolbox-compact {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:676` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-tabs {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:680` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-page {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:684` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-page[data-page="upload"] {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:688` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:694` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-title {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:698` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-actions {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:702` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-small-btn {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:707` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-content {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:713` `#${APP.panelId}.cgpt-toolbox-compact,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:714` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-content,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:715` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-section,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:716` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:720` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-section-title,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:721` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-hint {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:725` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-groups-head {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:729` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-bar {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:738` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-list {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:749` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-chip {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:758` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] #cgpt-upload-group-manage {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:762` `#${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module .cgpt-upload-groups-head {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:766` `#${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module .cgpt-upload-group-list {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:775` `#${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-upload-start #cgpt-upload-start {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:779` `#${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-file-list .cgpt-upload-list {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:783` `#${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-quick-prompts .cgpt-upload-quick-prompts {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:791` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-section {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:796` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-list {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:800` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-item {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:806` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-actions-cell {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:812` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-name {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:817` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-meta {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:828` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-status-row .cgpt-toolbox-top-status-badge {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:840` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-manage-panel {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:844` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-file-remove {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:855` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-settings-section,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:856` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-log,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:857` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-clear-log,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:858` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-delete,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:859` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-save-name,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:860` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-new,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:861` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-list-name-row,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:862` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-send-once,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:863` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-mode-tabs,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:864` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-list-panel,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:865` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-task-panel,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:866` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-editor-block,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:867` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-status-section {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:871` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-section {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:876` `#${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-label {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:880` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-section-title,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:881` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-hint,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:882` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] #cgpt-prompt-manage-tools,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:883` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-preview,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:884` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] #cgpt-prompt-status {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:888` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-section {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:893` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-list {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:898` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-category-bar {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:903` `#${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-category-chip {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:910` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-section-title,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:911` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-hint,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:912` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-stats-line,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:913` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-export-advanced,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:914` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-panel,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:915` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-prompts,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:916` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-stats {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:920` `#${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-section {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:925` `#${APP.panelId}.cgpt-toolbox-compact [data-page="log"] .cgpt-log-advanced {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:929` `#${APP.panelId}.cgpt-toolbox-compact [data-page="log"] .cgpt-log-list {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1062` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-status-row .cgpt-status-pill {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1106` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-status-badge {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1281` `#cgpt-toolbox-panel.cgpt-toolbox-compact .cgpt-shortcut-row {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1379` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1384` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts-title {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1388` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-groups {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1398` `#${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-list::-webkit-scrollbar,`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1399` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-groups::-webkit-scrollbar {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1405` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-group {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1412` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts-list {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:1416` `#${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-chip {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3994` `const compactBtn = qs('#cgpt-toolbox-compact', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4028` `const compactBtn = qs('#cgpt-toolbox-compact', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4097` `panel.classList.toggle('cgpt-toolbox-compact', compactMode);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4099` `const compactBtn = qs('#cgpt-toolbox-compact', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4147` `const compactBtn = qs('#cgpt-toolbox-compact', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4244` `let compactBtn = qs('#cgpt-toolbox-compact', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4253` `compactBtn.id = 'cgpt-toolbox-compact';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4381` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-toolbox-compact">简洁</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:4586` `return !!(panelEl && panelEl.classList.contains('cgpt-toolbox-compact'));`

### cgpt-setting-compact-show-upload-start

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:1015` `<input type="checkbox" id="cgpt-setting-compact-show-upload-start">`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:261` `showUploadStart: '#cgpt-setting-compact-show-upload-start',`

### cgpt-setting-compact-show-file-list

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:1020` `<input type="checkbox" id="cgpt-setting-compact-show-file-list">`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/state.js:262` `showFileList: '#cgpt-setting-compact-show-file-list',`

### cgpt-setting-compact-show-quick-prompts

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:163` `const compactQuickEl = qs('#cgpt-setting-compact-show-quick-prompts', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:255` `const quickEl = qs('#cgpt-setting-compact-show-quick-prompts', root);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:659` `'#cgpt-setting-compact-show-quick-prompts',`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:1030` `<input type="checkbox" id="cgpt-setting-compact-show-quick-prompts">`


## 2. 状态相关代码命中

### 按钮创建

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1732` `<button type="button" class="cgpt-toolbox-small-btn cgpt-autoq-import-prompt-btn" id="cgpt-autoq-task-import-prompts-top">导入 Prompt</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1733` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-profile-new">新建任务组</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1737` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-profile-save-name">保存名称</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1738` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-profile-delete">删除任务组</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1743` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-add">新增任务</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1744` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-pick-prompts">从 Prompt 导入</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1745` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-clear-examples">清空示例任务</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1898` `return `<button type="button" class="cgpt-autoq-batch-subtab${active}" data-batch-subtab="${tab.id}">${escapeHtml(tab.label)}</button>`;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:2596` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-prompt-picker-close">关闭</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:2605` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-prompt-picker-select-visible">全选当前显示</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:2606` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-prompt-picker-clear-visible">取消全选当前显示</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:2611` `<button type="button" class="cgpt-btn primary" id="cgpt-autoq-prompt-picker-apply">导入到当前任务组</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:4870` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5081` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5351` `<button type="button" class="cgpt-btn cgpt-btn-secondary" id="cgpt-autoq-task-rate-limit-clear">清空发送限速记录</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5352` `<button type="button" class="cgpt-btn cgpt-btn-secondary" id="cgpt-autoq-task-upload-rate-limit-clear">清空上传限速记录</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5473` `<button type="button" class="cgpt-toolbox-small-btn" data-task-action="edit" data-task-id="${escapeHtml(task.id)}">编辑</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5474` `<button type="button" class="cgpt-toolbox-small-btn" data-task-action="top" data-task-id="${escapeHtml(task.id)}" ${index === 0 ? 'disabled' : ''}>置顶</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5475` `<button type="button" class="cgpt-toolbox-small-btn" data-task-action="up" data-task-id="${escapeHtml(task.id)}" ${index === 0 ? 'disabled' : ''}>上移</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5476` `<button type="button" class="cgpt-toolbox-small-btn" data-task-action="down" data-task-id="${escapeHtml(task.id)}" ${index === profile.tasks.length - 1 ? 'disabled' : ''}>下移</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5477` `<button type="button" class="cgpt-toolbox-small-btn" data-task-action="bottom" data-task-id="${escapeHtml(task.id)}" ${index === profile.tasks.length - 1 ? 'disabled' : ''}>置底</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5478` `<button type="button" class="cgpt-toolbox-small-btn" data-task-action="toggle" data-task-id="${escapeHtml(task.id)}">${task.enabled ? '禁用' : '启用'}</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5479` `<button type="button" class="cgpt-toolbox-small-btn" data-task-action="delete" data-task-id="${escapeHtml(task.id)}">删除</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5572` `? `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-detach-prompt">${isPromptLinkedTask ? '转为独立任务' : '解除失效关联'}</button>``
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5613` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-task-save">保存任务</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9309` `btn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9363` `<button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'continue' ? ' active' : ''}" data-autoq-mode="continue">继续模式</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9364` `<button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'list' ? ' active' : ''}" data-autoq-mode="list">列表模式</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9365` `<button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'task' ? ' active' : ''}" data-autoq-mode="task">批量任务组模式</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9373` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-new">新建列表</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9378` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-save-name">保存名称</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9379` `<button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-autoq-list-delete">删除列表</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9392` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-continue-prompt-reset">恢复默认继续指令</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9397` `<button type="button" class="cgpt-btn primary" id="cgpt-autoq-start-upload">开始上传</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9398` `<button type="button" class="cgpt-btn primary" id="cgpt-autoq-start">开始</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9399` `<button type="button" class="cgpt-btn primary" id="cgpt-autoq-send-once">发送一次</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9400` `<button type="button" class="cgpt-btn danger cgpt-toolbox-hidden" id="cgpt-autoq-stop" disabled aria-hidden="true">停止</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9561` ``<button type="button" class="cgpt-prompt-category-chip${activeClass}" ${attrName}="${escapeHtml(text)}">`,`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3674` `<button type="button" class="cgpt-btn primary" id="cgpt-bridge-save">保存并重启桥接</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3675` `<button type="button" class="cgpt-btn" id="cgpt-bridge-test">测试连接</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3676` `<button type="button" class="cgpt-btn" id="cgpt-bridge-stop">停止轮询</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3677` `<button type="button" class="cgpt-btn" id="cgpt-bridge-copy-url">复制地址</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3695` `<button type="button" class="cgpt-btn" id="cgpt-bridge-toggle-advanced" style="font-size:11px; padding:2px 8px;">显示高级字段</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3696` `<button type="button" class="cgpt-btn" id="cgpt-bridge-copy-diag" style="font-size:11px; padding:2px 8px;">复制诊断信息</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:691` `<button type="button" class="cgpt-btn primary" id="cgpt-export-copy-chat">复制完整对话</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:692` `<button type="button" class="cgpt-btn" id="cgpt-export-copy-panel">复制工具箱配置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:693` `<button type="button" class="cgpt-btn" id="cgpt-export-prompts">导出 Prompt</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:707` `<button type="button" class="cgpt-btn primary" id="cgpt-export-refresh-stats">刷新统计</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:708` `<button type="button" class="cgpt-btn" id="cgpt-export-copy-stats">复制统计 JSON</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:723` `<button type="button" class="cgpt-btn primary" id="cgpt-export-settings">导出工具箱设置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:724` `<button type="button" class="cgpt-btn" id="cgpt-export-settings-import">导入工具箱设置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/log-module.js:180` `<button type="button" class="cgpt-btn" id="cgpt-log-copy">复制日志</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/log-module.js:181` `<button type="button" class="cgpt-btn danger" id="cgpt-log-clear">清空日志</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/log-module.js:182` `<button type="button" class="cgpt-btn" id="cgpt-log-toggle">显示最近日志</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/log-module.js:183` `<button type="button" class="cgpt-btn" id="cgpt-log-copy-errors">复制错误日志</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:323` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:329` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1079` `<button type="button" class="cgpt-btn primary" id="cgpt-prompt-close-confirm-save">保存</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1080` `<button type="button" class="cgpt-btn danger" id="cgpt-prompt-close-confirm-discard">放弃</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1081` `<button type="button" class="cgpt-btn" id="cgpt-prompt-close-confirm-continue">继续编辑</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1783` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-prompt-editor-close">关闭</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1806` `<button type="button" class="cgpt-btn danger" id="cgpt-prompt-delete-btn">删除</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1807` `<button type="button" class="cgpt-btn" id="cgpt-prompt-duplicate-btn">复制一份</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1810` `<button type="button" class="cgpt-btn" id="cgpt-prompt-cancel-btn">取消</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1811` `<button type="button" class="cgpt-btn primary" id="cgpt-prompt-save-btn">保存</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1975` `<button type="button" class="cgpt-btn primary" id="cgpt-prompt-new-quick-btn">+ 新建 Prompt</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1976` `<button type="button" class="cgpt-btn" id="cgpt-prompt-export-btn">导出</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1977` `<button type="button" class="cgpt-btn" id="cgpt-prompt-import-btn">导入</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1978` `<button type="button" class="cgpt-btn danger" id="cgpt-prompt-reset-btn">重置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1982` `<button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="list">Prompt 列表</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1983` `<button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="category">类别管理</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1997` `<button type="button" class="cgpt-btn primary" id="cgpt-prompt-category-add">新建类别</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:907` `<button type="button" class="cgpt-settings-subtab" data-settings-subtab="basic">基础</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:908` `<button type="button" class="cgpt-settings-subtab" data-settings-subtab="shortcut">快捷键</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:909` `<button type="button" class="cgpt-settings-subtab" data-settings-subtab="ui">界面</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:910` `<button type="button" class="cgpt-settings-subtab" data-settings-subtab="batch-timing">批量计时</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:921` `<button type="button" class="cgpt-btn" id="cgpt-setting-reset-toolbox-position">重置工具箱位置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:922` `<button type="button" class="cgpt-btn primary" id="cgpt-setting-force-show-toolbox">强制显示工具箱</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:944` `<button type="button" class="cgpt-btn primary" id="cgpt-setting-test-beep">测试蜂鸣器</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:945` `<button type="button" class="cgpt-btn" id="cgpt-setting-test-title-flash">测试标题闪烁</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:964` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-send-record">录制</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:965` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-send-clear">清空</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:974` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-record">录制</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:975` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-clear">清空</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:984` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-hotkey-record">录制</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:985` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-hotkey-clear">清空</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:994` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-upload-record">录制</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:995` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-upload-clear">清空</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:999` `<button type="button" class="cgpt-btn" id="cgpt-shortcut-reset-defaults">`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:1120` `<button type="button" class="cgpt-btn" id="cgpt-setting-copy-hotkey-continue-prompt-reset">`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:1155` `<button type="button" class="cgpt-btn" id="cgpt-setting-runtime-stats-reset">重置计时统计</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:714` `const btn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4250` `compactBtn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4370` `<button id="${APP.toggleId}" type="button" aria-label="打开小张工具箱" title="小张工具箱">`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4381` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-toolbox-compact">简洁</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4386` `<button type="button" class="cgpt-toolbox-tab active" data-tab="upload" data-full-label="多文件上传" data-short-label="上传">多文件上传</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4387` `<button type="button" class="cgpt-toolbox-tab" data-tab="autoq" data-full-label="自动指令" data-short-label="指令">自动指令</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4388` `<button type="button" class="cgpt-toolbox-tab" data-tab="prompt" data-full-label="Prompt 管理" data-short-label="Prompt">Prompt 管理</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4389` `<button type="button" class="cgpt-toolbox-tab" data-tab="bridge" data-full-label="浏览器桥接" data-short-label="桥接">浏览器桥接</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4390` `<button type="button" class="cgpt-toolbox-tab" data-tab="export" data-full-label="导出统计" data-short-label="导出">导出统计</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4391` `<button type="button" class="cgpt-toolbox-tab" data-tab="log" data-full-label="日志" data-short-label="日志">日志</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4392` `<button type="button" class="cgpt-toolbox-tab" data-tab="settings" data-full-label="设置" data-short-label="设置">设置</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5675` `restoreHandle = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:2642` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3623` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:4267` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:4288` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:9829` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:9852` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:10663` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:10674` `<button type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14819` `<button type="button" class="cgpt-btn cgpt-btn-idle" id="cgpt-upload-start" data-action="start-upload" title="只上传/绑定文件到 ChatGPT 输入框，不自动发送">开始上传</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14820` `<button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send" data-action="send-message" title="发送当前输入框中的文字和附件">发送信息</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14821` `<button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" data-action="copy-and-continue" title="先复制最后回复，再发送“继续”">复制并继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14822` `<button type="button" class="cgpt-btn warning" id="cgpt-send-hotkey-once" data-action="send-hotkey">发送 Ctrl+Alt+I</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14823` `<button type="button" class="cgpt-btn primary" id="cgpt-open-chatgpt-home" data-action="click-new-chat" title="点击左侧新聊天">回到首页</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14824` `<button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-once" data-action="auto-continue">自动继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14825` `<button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom" data-action="copy-only">复制最后回复</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14826` `<button`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14827` `type="button"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14833` `<button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" data-action="copy-hotkey-continue" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">复制+快捷键+继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14834` `<button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" data-action="loop-copy-hotkey-continue" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">连续复制+快捷键+继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14924` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">管理</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15008` `sendHotkeyBtn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15021` `homeBtn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15035` `autoContinueBtn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15052` `copyHotkeyOnceBtn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15065` `copyHotkeyContinueOnceBtn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15078` `copyHotkeyContinueLoopBtn = document.createElement('button');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15493` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">管理</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15503` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-add-inline">新建</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15513` `<button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-rename-inline">保存名称</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15517` `<button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-clear-inline">清空当前组</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15518` `<button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-delete-inline">删除当前组</button>`

### 点击绑定

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:2703` `promptPickerOverlay.addEventListener('click', (event) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5399` `clearRateLimitBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5414` `clearUploadRateLimitBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3607` `DomUtil.bindClick(mountRoot, '#cgpt-bridge-save', saveConfigFromUi, 'BRIDGE');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3608` `DomUtil.bindClick(mountRoot, '#cgpt-bridge-test', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3611` `DomUtil.bindClick(mountRoot, '#cgpt-bridge-stop', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3614` `DomUtil.bindClick(mountRoot, '#cgpt-bridge-copy-url', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3622` `DomUtil.bindClick(mountRoot, '#cgpt-bridge-toggle-advanced', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3626` `DomUtil.bindClick(mountRoot, '#cgpt-bridge-copy-diag', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:487` `DomUtil.bindClick(root, action.selector, () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:508` `DomUtil.bindClick(root, '#cgpt-export-prompts', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:690` `batchCheck.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:718` `fillBtn.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:724` `sendBtn.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:730` `copyBtn.addEventListener('click', async (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:741` `editBtn.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:747` `deleteBtn.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:756` `upBtn.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:765` `downBtn.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:859` `const selector = `[data-prompt-id="${CSS.escape(String(itemId))}"][data-action="${CSS.escape(String(actionName))}"]`;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1108` `saveBtn.onclick = () => finish('save');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1109` `discardBtn.onclick = () => finish('discard');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1110` `continueBtn.onclick = () => finish('continue');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1823` `qs('#cgpt-prompt-editor-close', modalOverlay).addEventListener('click', closeEditor);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1824` `qs('#cgpt-prompt-cancel-btn', modalOverlay).addEventListener('click', closeEditor);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1825` `qs('#cgpt-prompt-save-btn', modalOverlay).addEventListener('click', saveEditor);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1826` `qs('#cgpt-prompt-delete-btn', modalOverlay).addEventListener('click', deleteCurrentPrompt);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1827` `qs('#cgpt-prompt-duplicate-btn', modalOverlay).addEventListener('click', duplicateCurrentPrompt);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1895` `categoryAddBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1914` `categoryManageList.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1940` `subtabBar.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:472` `el.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:490` `el.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:589` `resetShortcutBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:599` `resetContinuePromptBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:645` `resetRuntimeStatsBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:711` `resetPosBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4633` `btn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5587` `edgeHotzone.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5752` `restoreHandle.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6119` `restoreHotzone.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7247` `floatingTitle.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8367` `toggle.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14439` `const actionBtn = target.closest('[data-action]');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14537` `addInlineBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14547` `groupManageBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14557` `groupRenameBtn.addEventListener('click', () => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14587` `groupClearBtn.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14597` `groupDeleteBtn.addEventListener('click', (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14604` `groupListEl.addEventListener('click', async (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14637` `manageGroupListEl.addEventListener('click', async (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14680` `listEl.addEventListener('click', async (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14758` `quickPromptBox.addEventListener('click', async (e) => {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14819` `<button type="button" class="cgpt-btn cgpt-btn-idle" id="cgpt-upload-start" data-action="start-upload" title="只上传/绑定文件到 ChatGPT 输入框，不自动发送">开始上传</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14820` `<button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send" data-action="send-message" title="发送当前输入框中的文字和附件">发送信息</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14821` `<button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" data-action="copy-and-continue" title="先复制最后回复，再发送“继续”">复制并继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14822` `<button type="button" class="cgpt-btn warning" id="cgpt-send-hotkey-once" data-action="send-hotkey">发送 Ctrl+Alt+I</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14823` `<button type="button" class="cgpt-btn primary" id="cgpt-open-chatgpt-home" data-action="click-new-chat" title="点击左侧新聊天">回到首页</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14824` `<button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-once" data-action="auto-continue">自动继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14825` `<button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom" data-action="copy-only">复制最后回复</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14830` `data-action="copy-and-hotkey"`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14833` `<button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" data-action="copy-hotkey-continue" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">复制+快捷键+继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14834` `<button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" data-action="loop-copy-hotkey-continue" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">连续复制+快捷键+继续</button>`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15101` `const actionButtons = rootEl.querySelectorAll('[data-action]');`

### 按钮文字修改

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5240` `previewEl.textContent = previewText;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5780` `button.textContent = '再次点击删除';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:5795` `button.textContent = '删除任务组';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9313` `btn.textContent = '开始上传';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3525` `toggleBtn.textContent = state.advancedCapabilityExpanded`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3541` `summaryEl.textContent = formatBridgeCapabilitySummaryText(record);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/bridge-module.js:3545` `textEl.textContent = formatBridgeCapabilityDiagnosticText(record);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:31` `btn.textContent = text;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:43` `btn.textContent = text;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:54` `btn.textContent = text;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:66` `btn.textContent = idleText;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:420` `statsLineEl.textContent =`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/log-module.js:132` `toggleBtnEl.textContent = state.visible ? '隐藏日志' : '显示最近日志';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:645` `empty.textContent = '没有匹配Prompt';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:663` `title.textContent = item.title;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:667` `meta.textContent = `分类：${item.category || '默认'}｜字数：${String(item.content || '').length}`;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:671` `preview.textContent = item.content.replace(/\s+/g, ' ').slice(0, 140);`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:712` `batchText.textContent = '加入批量任务';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:811` `counter.textContent = `字数：${chars}`;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1128` `modalTitle.textContent = '编辑 Prompt';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1135` `modalTitle.textContent = '新建 Prompt';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/runtime-stats.js:265` `statsLine1El.textContent = line1;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/runtime-stats.js:268` `statsLine2El.textContent = line2;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/runtime-stats.js:271` `phaseLineEl.textContent = phaseLine;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:492` `el.textContent = '按下快捷键...';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:510` `el.textContent = oldText || '录制';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:521` `el.textContent = '继续按主键...';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:527` `el.textContent = oldText || '录制';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:534` `el.textContent = oldText || '录制';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:558` `el.textContent = oldText || '录制';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:563` `el.textContent = oldText || '录制';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:806` `statusEl.textContent = '正在测试...';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:819` `statusEl.textContent = '测试失败：浏览器音频未解锁';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:834` `statusEl.textContent = ok`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:865` `statusEl.textContent = '已开始测试标题闪烁';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:873` `statusEl.textContent = '测试失败：标题闪烁模块不可用';`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:160` `button.textContent = nextText;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:58` `el.textContent = String(value ?? '');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:341` `button.textContent = text;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:466` `button.textContent = text;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:472` `button.textContent = oldText;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:717` `btn.textContent = String(text || '');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1099` `localEl.textContent = text;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:1120` `localEl.textContent = '';`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:3579` `titleEl.textContent = next;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:2662` `target.textContent = '';`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:2721` `target.textContent = textValue;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:5565` `badge.textContent = info.text;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3324` `style.textContent = TOOLBOX_STYLE;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3690` `titleEl.textContent = headerTitleFlashBaseText;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3731` `titleEl.textContent = headerTitleFlashOn ? noticeText : baseText;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3758` `titleEl.textContent = toolboxTitle;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3766` `floatingTitle.textContent = toolboxTitle;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4101` `compactBtn.textContent = compactMode ? '完整' : '简洁';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4174` `floatingTitle.textContent = toolboxTitle || TOOLBOX_DEFAULT_TITLE;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4182` `floatingTitle.textContent = toolboxTitle || TOOLBOX_DEFAULT_TITLE;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4254` `compactBtn.textContent = '简洁';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5678` `restoreHandle.textContent = '小张工具箱';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5713` `restoreHandle.textContent = TOOLBOX_RESTORE_HANDLE_TITLE;`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8654` `badge.textContent = '就绪';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8818` `badge.textContent = '';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8842` `badge.textContent = '';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8875` `badge.textContent = shortText || '状态';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8966` `box.textContent = String(text || '');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1288` `btn.textContent = String(options.idleText || '复制并继续');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1311` `btn.textContent = busyText;`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3658` `clearBtn.textContent = '清空当前组';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3663` `deleteBtn.textContent = '删除当前组';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3823` `button.textContent = '再次点击清空';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3890` `button.textContent = '再次点击清空';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6735` `btn.textContent = '等待回复...';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6741` `btn.textContent = '复制中...';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6779` `btn.textContent = '确认剪贴板...';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6795` `btn.textContent = '发送快捷键...';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6879` `btn.textContent = '复制+快捷键';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15013` `sendHotkeyBtn.textContent = '发送 Ctrl+Alt+I';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15026` `homeBtn.textContent = '回到首页';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15040` `autoContinueBtn.textContent = '自动继续';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15057` `copyHotkeyOnceBtn.textContent = '复制+快捷键';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15070` `copyHotkeyContinueOnceBtn.textContent = '复制+快捷键+继续';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15083` `copyHotkeyContinueLoopBtn.textContent = '连续复制+快捷键+继续';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-send-button-vm.js:186` `button.textContent = payload.text;`

### disabled 修改

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:6902` `stopBtn.disabled = true;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:32` `btn.disabled = true;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/export-module.js:67` `btn.disabled = false;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:235` `groupsEl.disabled = false;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:241` `startEl.disabled = false;`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/settings-module.js:247` `fileListEl.disabled = false;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:190` `button.disabled = Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:199` `button.disabled = !allowCancel && Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:208` `button.disabled = !allowCancel && Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:224` `button.disabled = !canCancel && Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:233` `button.disabled = Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:239` `button.disabled = !allowCancel && Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:248` `button.disabled = Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:254` `button.disabled = Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:260` `button.disabled = Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:269` `button.disabled = Boolean(disabled);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:275` `button.disabled = true;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:347` `disabled: extra.disabled === true,`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:352` `button.disabled = effectiveDisabled;`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:360` `button.setAttribute('aria-disabled', ariaDisabled ? 'true' : 'false');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:370` `disabled: options.disabled === true,`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:751` `btn.disabled = !!options.disabled;`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1295` `btn.disabled = false;`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1298` `btn.setAttribute('aria-disabled', 'false');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1318` `btn.disabled = true;`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1319` `btn.setAttribute('aria-disabled', 'true');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6734` `btn.disabled = true;`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6878` `btn.disabled = false;`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:10507` `copyHotkeyContinueLoopBtn.setAttribute('aria-disabled', 'false');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14085` `button.disabled = false;`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-send-button-vm.js:185` `button.disabled = payload.disabled;`

### class 修改

- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1843` `actionsEl.classList.add('cgpt-autoq-top-action-bar');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1858` `settingsEl.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:1869` `actionsEl.classList.remove('cgpt-autoq-top-action-bar');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:2590` `promptPickerOverlay.className = 'cgpt-modal-overlay';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:6901` `stopBtn.classList.add('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/auto-queue-core.js:9311` `btn.className = 'cgpt-btn cgpt-btn-idle';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/floating-panel-utils.js:193` `modal.classList.add('cgpt-modal-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/floating-panel-utils.js:251` `modal.classList.remove('cgpt-modal-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:642` `empty.className = 'cgpt-hint';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:658` `row.className = 'cgpt-prompt-item';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:662` `title.className = 'cgpt-prompt-title';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:666` `meta.className = 'cgpt-prompt-meta';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:670` `preview.className = 'cgpt-prompt-preview';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:678` `actions.className = 'cgpt-prompt-actions';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:681` `batchLabel.className = 'cgpt-checkbox-line cgpt-prompt-batch-task-check';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1068` `promptEditorCloseConfirmOverlay.className = 'cgpt-modal-overlay';`
- `chatgpt-toolbox/tampermonkey-userscript-src/autoqueue/prompt-manager-module.js:1778` `modalOverlay.className = 'cgpt-modal-overlay';`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:134` `button.classList.remove(cls);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:189` `button.classList.add('cgpt-btn-idle');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:198` `button.classList.add('cgpt-btn-waiting');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:207` `button.classList.add('cgpt-btn-running');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:222` `button.classList.add(`cgpt-btn-${phase}`);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:232` `button.classList.add('cgpt-btn-success');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:238` `button.classList.add('cgpt-btn-sending');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:247` `button.classList.add('cgpt-btn-success');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:253` `button.classList.add('cgpt-btn-failed');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:259` `button.classList.add('cgpt-btn-danger');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:268` `button.classList.add('cgpt-btn-cancelled');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/button-state.js:274` `button.classList.add('cgpt-btn-disabled');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:333` `button.classList.remove(...removeClasses);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:337` `button.classList.add(...addClasses);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:462` `button.classList.remove('cgpt-btn-ok', 'danger', 'failed', 'error');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:463` `button.classList.add('cgpt-btn-error');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:470` `button.classList.remove('cgpt-btn-error');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:485` `button.classList.remove('cgpt-btn-error', 'danger', 'failed', 'error');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:486` `button.classList.add('cgpt-btn-ok');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:489` `button.classList.remove('cgpt-btn-ok');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:529` `button.classList.add('cgpt-btn-waiting-danger');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:541` `button.classList.remove('cgpt-btn-waiting-danger');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:690` `button.classList.remove(...styleClasses, 'cgpt-btn-error', 'cgpt-btn-ok');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:693` `button.classList.add('cgpt-waiting-answer');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:695` `button.classList.add('danger');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:701` `button.classList.add(idleClass);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:707` `button.classList.add(cls);`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:744` `btn.className = classes.join(' ');`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/logger.js:2945` `function renderEmptyState(text, className = 'cgpt-empty-state') {`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:5568` `badge.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/core/main.js:5579` `badge.classList.add(info.cls || 'cgpt-state-unknown');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:66` `root.classList.add('cgpt-edge-right');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:68` `root.classList.remove('cgpt-edge-right');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:154` `document.documentElement.classList.add('cgpt-toolbox-global-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:161` `document.body.classList.add('cgpt-toolbox-global-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:170` `document.documentElement.classList.remove('cgpt-toolbox-global-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:174` `document.body.classList.remove('cgpt-toolbox-global-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:181` `root.classList.remove('cgpt-toolbox-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:196` `root.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:209` `edgeHotzone.classList.remove('active');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3583` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3589` `hotzone.classList.remove('active');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3776` `icon.className = 'cgpt-toolbox-toggle-icon';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3819` `panel.classList.add('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3821` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3843` `root.classList.add('cgpt-toolbox-edge-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3844` `root.classList.remove('cgpt-toolbox-edge-revealed');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:3848` `root.classList.remove('cgpt-toolbox-edge-hidden', 'cgpt-toolbox-edge-revealed');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4181` `floatingTitle.className = 'cgpt-toolbox-floating-title';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4216` `pageStatusRowEl.className = 'cgpt-toolbox-header-status-row';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4225` `pageStatusRowEl.className = 'cgpt-toolbox-header-status-row';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4252` `compactBtn.className = 'cgpt-toolbox-small-btn';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4866` `handle.className = 'cgpt-toolbox-resize-handle';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4901` `panel.classList.add('cgpt-resizing');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:4937` `panel.classList.remove('cgpt-resizing');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5275` `panel.classList.add('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5281` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5282` `root.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5291` `root.classList.remove('cgpt-toolbox-edge-revealed');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5368` `root.classList.add('cgpt-toolbox-edge-revealed');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5369` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5370` `root.classList.remove('cgpt-toolbox-panel-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5437` `root.classList.remove('cgpt-toolbox-edge-revealed');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5508` `edgeHotzone.classList.remove('active');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5539` `edgeHotzone.classList.add('active');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5652` `restoreHotzone.classList.remove('active');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5727` `restoreHandle.classList.add('active');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5737` `restoreHandle.classList.remove('active');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:5956` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6072` `restoreHotzone.classList.add('active');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6222` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6223` `root.classList.add('cgpt-toolbox-edge-revealed');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6274` `root.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6283` `root.classList.add('cgpt-toolbox-edge-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6284` `root.classList.remove('cgpt-toolbox-edge-revealed');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6286` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6339` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6489` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6636` `panel.classList.add('cgpt-resizing');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:6654` `panel.classList.remove('cgpt-resizing');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7155` `root.classList.add('cgpt-toolbox-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7353` `title.classList.remove('cgpt-floating-title-visible');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7354` `title.classList.add('cgpt-floating-title-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7361` `title.classList.remove('cgpt-floating-title-visible');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7362` `title.classList.add('cgpt-floating-title-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7367` `title.classList.add('cgpt-floating-title-visible');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7368` `title.classList.remove('cgpt-floating-title-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7584` `root.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7603` `root.classList.remove(...EDGE_STATE_CLASSES);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7618` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7790` `root.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7798` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7884` `panel.classList.add('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7885` `root.classList.add('cgpt-toolbox-panel-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7957` `root.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7962` `panel.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:7964` `root.classList.remove('cgpt-toolbox-panel-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8236` `root.classList.add('cgpt-toolbox-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8521` `floatingTitle.classList.remove('cgpt-floating-title-visible');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8522` `floatingTitle.classList.add('cgpt-floating-title-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8581` `root.classList.add('cgpt-toolbox-dragging');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8653` `badge.className = 'cgpt-toolbox-status-badge cgpt-status-idle';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8820` `badge.classList.add('cgpt-status-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8841` `badge.classList.add('cgpt-status-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8877` `badge.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8888` `badge.classList.add(`cgpt-status-${statusType}`);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8949` `box.className = 'cgpt-toolbox-toast';`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8967` `box.classList.remove(`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8978` `box.classList.add(`cgpt-toast-${toastType}`);`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8981` `box.classList.add('show');`
- `chatgpt-toolbox/tampermonkey-userscript-src/ui/toolbox-shell.js:8984` `box.classList.remove('show');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1287` `btn.classList.remove('cgpt-btn-busy');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1307` `btn.classList.add('cgpt-btn-busy');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:3550` `managePanelEl.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:5032` `rootElRef.classList.remove('compact-hide-upload-groups');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:9888` `el.classList.add('toolbox-upload-file-list');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:10611` `box.classList.add('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:10618` `box.classList.remove('cgpt-toolbox-hidden');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12564` `if (el.className && typeof el.className === 'string') {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14858` `toolbar.className = 'cgpt-upload-action-toolbar';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14912` `uploadSection.classList.add('toolbox-upload-drop-zone');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14919` `groupsHead.className = 'cgpt-upload-groups-head';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15010` `sendHotkeyBtn.className = 'cgpt-btn warning';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15023` `homeBtn.className = 'cgpt-btn primary';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15037` `autoContinueBtn.className = 'cgpt-btn teal';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15054` `copyHotkeyOnceBtn.className = 'cgpt-btn purple';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15067` `copyHotkeyContinueOnceBtn.className = 'cgpt-btn purple';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:15080` `copyHotkeyContinueLoopBtn.className = 'cgpt-btn cyan';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-send-button-vm.js:149` `if (stateName === 'pending-attachment' || vm.className === 'warning') {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-send-button-vm.js:155` `if (vm.className === 'disabled' || vm.disabled) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-send-button-vm.js:164` `if (vm.className === 'primary' || stateName === 'idle') {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-send-button-vm.js:167` `if (vm.className === 'danger') {`

### dataset 状态

- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1258` `if (!button || button.dataset.busy !== '1') {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1262` `const busyAt = Number(button.dataset.busyAt || 0);`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1272` `button.dataset.busy = '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1273` `button.dataset.busyAt = '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1274` `button.dataset.waitingReply = '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1284` `btn.dataset.busy = '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1285` `btn.dataset.busyAt = '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1286` `btn.dataset.waitingReply = '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1304` `btn.dataset.busy = '1';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1305` `btn.dataset.busyAt = String(startedAt);`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:1306` `btn.dataset.waitingReply = assistantBusy ? '1' : '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6413` `if (btn && btn.dataset.busy === '1') {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6733` `btn.dataset.busy = '1';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:6877` `btn.dataset.busy = '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:10377` `copyContinueBtn.dataset.busy = copyContinueTaskRunning ? '1' : '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:10378` `copyContinueBtn.dataset.waitingReply = '0';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-send-button-vm.js:126` `button.dataset.uploadSendState = vm.datasetState || '';`

### Enter 发送

- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:758` `return 'enter-send';`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:11928` `if (!assertUploadSendFlowAlive(activeFlowRun, 'enter-send-panel')) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:11933` `if (uploadSendFlowCancelCheck('enter-send-panel')) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12492` `if (editable && !editable.hasAttribute('data-enter-send')) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12669` ``[TOOLBOX_HOTKEY][enter-send-skip] reason=send-task-active phase=${sendPhase}`,`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12678` ``[TOOLBOX_HOTKEY][enter-send-skip] reason=send-not-ready detail=${blockReason}`,`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12744` `ToolboxShell.appendLog('[TOOLBOX_HOTKEY][enter-send-skip] reason=enter-send-lock');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:12758` ``[TOOLBOX_HOTKEY][enter-send] trigger=enter source=${enterSource}`,`

### runUploadActionPromise

- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:13894` `runUploadActionPromise(`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14497` `function runUploadActionPromise(promise, actionName) {`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14538` `runUploadActionPromise(createGroupInline(), '新建分组');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14558` `runUploadActionPromise(renameActiveGroupInline(), '重命名分组');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14569` `runUploadActionPromise(renameActiveGroupInline(), '重命名分组');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14578` `runUploadActionPromise(renameActiveGroupInline(), '重命名分组');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14588` `runUploadActionPromise(clearActiveGroupQueueInline(e.currentTarget), '清空当前分组');`
- `chatgpt-toolbox/tampermonkey-userscript-src/upload/upload-module.js:14598` `runUploadActionPromise(deleteActiveGroupInline(e.currentTarget), '删除当前分组');`


## 3. 人工复核重点

- running / waiting / sending 状态下，可取消按钮不能 disabled。
- 开始态不能使用 success 绿色。
- waiting 状态不能默认使用 danger 红色。
- 长流程按钮不能只靠 textContent / classList / dataset.busy 表示真实状态。
- Enter 快捷键不能只依赖 sendBtn.disabled。
- runUploadActionPromise 不应覆盖具体按钮 phase。
- 所有 async 按钮流程必须有 catch/finally，且 catch 打印具体错误。

## 10. 执行验证回传

- 生成时间: 2026-05-25 20:12:32
- 扫描命令: `python tools/button_state_audit_scan.py`
- 源码根目录: `chatgpt-toolbox/tampermonkey-userscript-src/`

### 10.1 fail_gate

- 命令: `python tools/button_state_audit_fail_gate.py`
- 结果: **PASS** (exit=0) — `[BUTTON_STATE_AUDIT][PASS] 未发现高危旧按钮状态逻辑残留`

### 10.2 构建产物

- `chatgpt-toolbox/dist/client.user.js` 存在；GENERATED 标记=有（第 27 行）
- 根目录 `client.user.js` 与 dist 已同步
- 构建命令: `cd chatgpt-toolbox && npm run build`
- 构建日志（扫描时自动执行）: exit=0

```
E:\Documents\Desktop\chatgpt-flask-bridge\chatgpt-toolbox>set http_proxy=http://127.0.0.1:7890 

E:\Documents\Desktop\chatgpt-flask-bridge\chatgpt-toolbox>set https_proxy=http://127.0.0.1:7890 

E:\Documents\Desktop\chatgpt-flask-bridge\chatgpt-toolbox>cls

> build
> node build.userjs.mjs

Wrote E:\Documents\Desktop\chatgpt-flask-bridge\chatgpt-toolbox\dist\client.user.js
Synced E:\Documents\Desktop\chatgpt-flask-bridge\client.user.js
```

### 10.3 VM 矩阵契约验收（本地自动化，对应 §131）

- 命令: `python tools/button_state_vm_matrix_test.py`
- 结果: **PASS** (exit=0) — `[VM_MATRIX][PASS] §131 六场景 VM/快捷键契约全部满足`（6/6）

### 10.4 手工测试（§131，须本机 ChatGPT + Tampermonkey）

| # | 场景 | 预期 | VM 契约 | 浏览器实测 |
|---|------|------|---------|------------|
| 1 | 开始上传 idle | #cgpt-upload-start 非 success 绿、可点 | PASS | 待测 |
| 2 | 上传运行中 | 文案含「点击取消」、按钮未 disabled | PASS | 待测 |
| 3 | 发送信息 waiting_send | warning/waiting 色、可点取消 | PASS | 待测 |
| 4 | Enter 发送 | sendTask.phase=idle 时可发；非 idle 跳过 | PASS | 待测 |
| 5 | 复制并继续 waiting_reply | 未 disabled、可取消 | PASS | 待测 |
| 6 | 连续复制循环 stopping | phase=stopping 由统一渲染 | PASS | 待测 |

- VM 契约 PASS 仅证明源码矩阵正确；**浏览器实测**全 ✅ 前禁止输出 `<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>`。