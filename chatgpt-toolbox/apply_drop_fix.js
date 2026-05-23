const fs = require('fs');
const filepath = 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\upload\\upload-module.js';
let content = fs.readFileSync(filepath, 'utf-8');

// ============================================================
// 1. Add UPLOAD_DROP_HANDLED_PROP constant
// ============================================================
const marker1 = '    const COPY_CONTINUE_STABLE_INTERVAL_MS = 350;';
const insert1 = marker1 + '\n\n    const UPLOAD_DROP_HANDLED_PROP = \x27__cgptToolboxUploadDropHandledV1\x27;\n    let lastDropSignature = \x27\x27;\n    let lastDropSignatureAt = 0;';
if (content.includes(marker1)) {
  content = content.replace(marker1, insert1);
  console.log('1. Added UPLOAD_DROP_HANDLED_PROP + drop signature vars');
}

// ============================================================
// 2. Add claimUploadDropEvent function
//    Insert after prepareUploadDragEvent
// ============================================================
const marker2 = '    function prepareUploadDragEvent(e, options = {})';
const insert2 = '    function claimUploadDropEvent(e, source) {\n      if (!e) return false;\n\n      if (e[UPLOAD_DROP_HANDLED_PROP]) {\n        ToolboxShell.appendLog(\n          [UPLOAD_DIAG][drop:skip-already-handled] source=\n        );\n        return false;\n      }\n\n      e[UPLOAD_DROP_HANDLED_PROP] = {\n        source: source || \x27\x27,\n        at: Date.now(),\n      };\n\n      return true;\n    }\n\n    ' + marker2;
content = content.replace(marker2, insert2);
console.log('2. Added claimUploadDropEvent function');

// ============================================================
// 3. Add buildDropSignature + shouldSkipRecentDuplicateDrop
//    Insert before handleUploadDropEvent
// ============================================================
const marker3 = '    async function handleUploadDropEvent(e) {';
const insert3 = '    function buildDropSignature(dataTransfer) {\n      const files = Array.from(dataTransfer && dataTransfer.files ? dataTransfer.files : []);\n      return files\n        .map((file) => [\n          String(file.name || \x27\x27).trim().toLowerCase(),\n          Number(file.size) || 0,\n          Number(file.lastModified) || 0,\n          String(file.type || \x27\x27).trim().toLowerCase(),\n        ].join(\x27::\x27))\n        .sort()\n        .join(\x27||\x27);\n    }\n\n    function shouldSkipRecentDuplicateDrop(dataTransfer) {\n      const signature = buildDropSignature(dataTransfer);\n      if (!signature) return false;\n\n      const now = Date.now();\n      if (signature === lastDropSignature && now - lastDropSignatureAt < 1200) {\n        ToolboxShell.appendLog(\n          [UPLOAD_DIAG][drop:skip-recent-duplicate] signature=\n        );\n        return true;\n      }\n\n      lastDropSignature = signature;\n      lastDropSignatureAt = now;\n      return false;\n    }\n\n    ' + marker3;
content = content.replace(marker3, insert3);
console.log('3. Added buildDropSignature + shouldSkipRecentDuplicateDrop');

// ============================================================
// 4. Add dedupeActiveGroupQueue function
//    Insert before buildQueueFileKey
// ============================================================
const marker4 = '    function buildQueueFileKey(fileOrItem) {';
const insert4 = '    function dedupeActiveGroupQueue(reason) {\n      const groupId = getActiveGroupId();\n      if (!groupId) return;\n\n      const seen = new Map();\n      const kept = [];\n\n      for (const item of state.queue) {\n        if (item.groupId !== groupId) {\n          kept.push(item);\n          continue;\n        }\n\n        let looseKey = buildQueueLooseFileKey(item);\n        if (!looseKey) {\n          looseKey = buildQueueFileKey(item);\n        }\n\n        if (seen.has(looseKey)) {\n          state.queue = state.queue.filter(function(q) { return q.id !== item.id; });\n          ToolboxShell.appendLog(\n            [UPLOAD_DIAG][dedupe-active-group:remove] reason= name= size= id=\n          );\n          continue;\n        }\n\n        if (looseKey) {\n          seen.set(looseKey, true);\n        }\n        kept.push(item);\n      }\n\n      state.queue = kept;\n    }\n\n    ' + marker4;
content = content.replace(marker4, insert4);
console.log('4. Added dedupeActiveGroupQueue function');

// ============================================================
// 5. Modify onUploadRootDrop: add claimUploadDropEvent
// ============================================================
const oldRootDrop = '    async function onUploadRootDrop(e) {\n      if (!prepareUploadDragEvent(e)) return;\n\n      if (rootElRef) {\n        rootElRef.classList.remove(\x27cgpt-upload-dragging\x27);\n      }\n\n      await handleUploadDropEvent(e);\n    }';
const newRootDrop = '    async function onUploadRootDrop(e) {\n      if (!prepareUploadDragEvent(e)) return;\n      if (!claimUploadDropEvent(e, \x27root\x27)) return;\n\n      if (rootElRef) {\n        rootElRef.classList.remove(\x27cgpt-upload-dragging\x27);\n      }\n\n      await handleUploadDropEvent(e);\n    }';
if (content.includes(oldRootDrop)) {
  content = content.replace(oldRootDrop, newRootDrop);
  console.log('5. Modified onUploadRootDrop');
} else {
  console.log('5. WARN: onUploadRootDrop pattern not found');
}

// ============================================================
// 6. Modify onGlobalUploadDrop: add claimUploadDropEvent
// ============================================================
const oldGlobalDrop = '    async function onGlobalUploadDrop(e) {\n      if (!prepareUploadDragEvent(e)) return;\n\n      if (panelDropEl) {\n        panelDropEl.classList.remove(\x27cgpt-toolbox-file-dragover\x27);\n      }\n\n      await handleUploadDropEvent(e);\n    }';
const newGlobalDrop = '    async function onGlobalUploadDrop(e) {\n      if (!prepareUploadDragEvent(e)) return;\n      if (!claimUploadDropEvent(e, \x27global\x27)) return;\n\n      if (panelDropEl) {\n        panelDropEl.classList.remove(\x27cgpt-toolbox-file-dragover\x27);\n      }\n\n      await handleUploadDropEvent(e);\n    }';
if (content.includes(oldGlobalDrop)) {
  content = content.replace(oldGlobalDrop, newGlobalDrop);
  console.log('6. Modified onGlobalUploadDrop');
} else {
  console.log('6. WARN: onGlobalUploadDrop pattern not found');
}

// ============================================================
// 7. Modify handleUploadDropEvent: add shouldSkipRecentDuplicateDrop
//    Insert after transfer check and before activeGroupId check
// ============================================================
const oldHandlePart = '      if (!transfer) {\n        setStatus(\x27鎷栨嫋澶辫触锛氭病鏈夋枃浠舵暟鎹\x27);\n        ToolboxShell.appendLog(\x27[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer\x27);\n        return;\n      }\n\n      if (!state.activeGroupId) {';
const newHandlePart = '      if (!transfer) {\n        setStatus(\x27鎷栨嫋澶辫触锛氭病鏈夋枃浠舵暟鎹\x27);\n        ToolboxShell.appendLog(\x27[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer\x27);\n        return;\n      }\n\n      if (shouldSkipRecentDuplicateDrop(transfer)) {\n        setStatus(\x27宸插拷鐣ラ噸澶嶆嫋鎷界簨浠\x27);\n        return;\n      }\n\n      if (!state.activeGroupId) {';
if (content.includes(oldHandlePart)) {
  content = content.replace(oldHandlePart, newHandlePart);
  console.log('7. Modified handleUploadDropEvent (skip-recent-duplicate)');
} else {
  console.log('7. WARN: handleUploadDropEvent pattern not found');
}

// ============================================================
// 8. Add dedupeActiveGroupQueue call after addDroppedFiles in handleUploadDropEvent
// ============================================================
const oldDoneEnd = '      await addDroppedFiles(dropped);\n\n      const afterCount = state.queue.length;';
const newDoneEnd = '      await addDroppedFiles(dropped);\n\n      dedupeActiveGroupQueue(\x27drop:after-add\x27);\n\n      const afterCount = state.queue.length;';
if (content.includes(oldDoneEnd)) {
  content = content.replace(oldDoneEnd, newDoneEnd);
  console.log('8. Added dedupeActiveGroupQueue after addDroppedFiles');
} else {
  console.log('8. WARN: addDroppedFiles done pattern not found');
}

// ============================================================
// 9. Add dedupeActiveGroupQueue in addFiles before schedulePersistQueue
// ============================================================
const oldAddEnd = '      await schedulePersistQueue();\n      await refreshUploadGroupCounts();';
const newAddEnd = '      dedupeActiveGroupQueue(\x27add-files\x27);\n\n      await schedulePersistQueue();\n      await refreshUploadGroupCounts();';
if (content.includes(oldAddEnd)) {
  content = content.replace(oldAddEnd, newAddEnd);
  console.log('9. Added dedupeActiveGroupQueue in addFiles');
} else {
  console.log('9. WARN: addFiles end pattern not found');
}

// ============================================================
// 10. Add dedupeActiveGroupQueue in loadQueueForActiveGroup before render
//     Find the render call at the end of loadQueueForActiveGroup
// ============================================================
// The loadQueueForActiveGroup function ends with a render() call.
// Let me find the last render() call within the function bounds
// by finding the pattern where render() follows queue manipulation
const oldLoadEnd = '      render();\n    }\n\n    function getActiveGroup() {';
const newLoadEnd = '      dedupeActiveGroupQueue(\x27load-queue\x27);\n      render();\n    }\n\n    function getActiveGroup() {';
if (content.includes(oldLoadEnd)) {
  content = content.replace(oldLoadEnd, newLoadEnd);
  console.log('10. Added dedupeActiveGroupQueue in loadQueueForActiveGroup');
} else {
  console.log('10. WARN: loadQueueForActiveGroup end pattern not found');
}

fs.writeFileSync(filepath, content, 'utf-8');
console.log('\\nAll changes applied successfully');
