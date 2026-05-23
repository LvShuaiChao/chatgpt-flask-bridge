const fs = require('fs');
const filepath = 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\upload\\upload-module.js';
let content = fs.readFileSync(filepath, 'utf-8');

// Fix 1: Fix broken template literals in shouldSkipRecentDuplicateDrop
const broken1 = '        ToolboxShell.appendLog(\n          [UPLOAD_DIAG][drop:skip-recent-duplicate] signature=\n        );';
const fixed1 = '        ToolboxShell.appendLog(\n          [UPLOAD_DIAG][drop:skip-recent-duplicate] signature=\n        );';
content = content.replace(broken1, fixed1);

// Fix 2: Fix broken template literals in claimUploadDropEvent
const broken2 = '        ToolboxShell.appendLog(\n          [UPLOAD_DIAG][drop:skip-already-handled] source=\n        );';
const fixed2 = '        ToolboxShell.appendLog(\n          [UPLOAD_DIAG][drop:skip-already-handled] source=\n        );';
content = content.replace(broken2, fixed2);

// Fix 3: Fix broken template literal in dedupeActiveGroupQueue
const broken3 = '        ToolboxShell.appendLog(\n            [UPLOAD_DIAG][dedupe-active-group:remove] reason= name= size= id=\n          );';
const fixed3 = '        ToolboxShell.appendLog(\n            [UPLOAD_DIAG][dedupe-active-group:remove] reason= name= size= id=\n          );';
content = content.replace(broken3, fixed3);

// Fix 4: Fix indentation - some functions have wrong indentation
// shouldSkipRecentDuplicateDrop -> dedupeActiveGroupQueue have 4-space indent but should be 6-space
// Let's fix: "    function shouldSkipRecentDuplicateDrop" -> "      function shouldSkipRecentDuplicateDrop"
content = content.replace(/\n    function (buildDropSignature|shouldSkipRecentDuplicateDrop|dedupeActiveGroupQueue|claimUploadDropEvent)/g, '\n      function ');

// Fix 5: Fix handleUploadDropEvent indentation (it has 8 spaces instead of 6)
content = content.replace(/\n        async function handleUploadDropEvent/, '\n    async function handleUploadDropEvent');

// Fix 6: Fix buildQueueFileKey indentation  
content = content.replace(/\n        function buildQueueFileKey/, '\n    function buildQueueFileKey');

// Fix 7: Add shouldSkipRecentDuplicateDrop check in handleUploadDropEvent
const oldHandle1 = '      if (!transfer) {\n        setStatus(\x27鎷栨嫋澶辫触锛氭病鏈夋枃浠舵暟鎹\x27);\n        ToolboxShell.appendLog(\x27[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer\x27);\n        return;\n      }\n\n      if (!state.activeGroupId) {';
const newHandle1 = '      if (!transfer) {\n        setStatus(\x27鎷栨嫋澶辫触锛氭病鏈夋枃浠舵暟鎹\x27);\n        ToolboxShell.appendLog(\x27[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer\x27);\n        return;\n      }\n\n      if (shouldSkipRecentDuplicateDrop(transfer)) {\n        setStatus(\x27宸插拷鐣ラ噸澶嶆嫋鎷界簨浠\x27);\n        return;\n      }\n\n      if (!state.activeGroupId) {';
content = content.replace(oldHandle1, newHandle1);

// Fix 8: Add claimUploadDropEvent to onUploadRootDrop
const oldRoot = '    async function onUploadRootDrop(e) {\n      if (!prepareUploadDragEvent(e)) return;\n\n      if (rootElRef) {';
const newRoot = '    async function onUploadRootDrop(e) {\n      if (!prepareUploadDragEvent(e)) return;\n      if (!claimUploadDropEvent(e, \x27root\x27)) return;\n\n      if (rootElRef) {';
content = content.replace(oldRoot, newRoot);

// Fix 9: Add claimUploadDropEvent to onGlobalUploadDrop
const oldGlobal = '    async function onGlobalUploadDrop(e) {\n      if (!prepareUploadDragEvent(e)) return;\n\n      if (panelDropEl) {';
const newGlobal = '    async function onGlobalUploadDrop(e) {\n      if (!prepareUploadDragEvent(e)) return;\n      if (!claimUploadDropEvent(e, \x27global\x27)) return;\n\n      if (panelDropEl) {';
content = content.replace(oldGlobal, newGlobal);

// Fix 10: Add dedupeActiveGroupQueue after addDroppedFiles in handleUploadDropEvent
const oldDedup1 = '      await addDroppedFiles(dropped);\n\n      const afterCount = state.queue.length;';
const newDedup1 = '      await addDroppedFiles(dropped);\n\n      dedupeActiveGroupQueue(\x27drop\x27);\n\n      const afterCount = state.queue.length;';
content = content.replace(oldDedup1, newDedup1);

// Fix 11: Add dedupeActiveGroupQueue in addFiles before schedulePersistQueue
const oldDedup2 = '      });\n\n      await schedulePersistQueue();\n      await refreshUploadGroupCounts();';
const newDedup2 = '      });\n\n      dedupeActiveGroupQueue(\x27add-files\x27);\n\n      await schedulePersistQueue();\n      await refreshUploadGroupCounts();';
content = content.replace(oldDedup2, newDedup2);

// Fix 12: Add dedupeActiveGroupQueue in loadQueueForActiveGroup before render
// Find the last render() before getActiveGroup 
const oldDedup3 = '      render();\n    }\n\n    function getActiveGroup() {';
const newDedup3 = '      dedupeActiveGroupQueue(\x27load-queue\x27);\n      render();\n    }\n\n    function getActiveGroup() {';
content = content.replace(oldDedup3, newDedup3);

fs.writeFileSync(filepath, content, 'utf-8');
console.log('All fixes applied');
