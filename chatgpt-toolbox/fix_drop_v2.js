const fs = require('fs');
const filepath = 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\upload\\upload-module.js';
let content = fs.readFileSync(filepath, 'utf-8');
const lines = content.split('\n');

console.log('Total lines:', lines.length);

// Find exact targets
const targets = {};
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('async function onUploadRootDrop(e)')) targets.onUploadRootDrop = i;
  if (l.includes('async function onGlobalUploadDrop(e)')) targets.onGlobalUploadDrop = i;
  if (l.includes('[drop:skip-recent-duplicate] signature=')) targets.brokenSkip = i;
  if (l.includes('[drop:skip-already-handled] source=')) targets.brokenClaim = i;
  if (l.includes('[dedupe-active-group:remove] reason=')) targets.brokenDedup = i;
  if (l.includes('await addDroppedFiles(dropped)')) targets.afterAdd = i;
  if (l.includes('await schedulePersistQueue()') && i > 5600 && i < 5700) targets.persistQueue = i;
  if (l.match(/^\s+render\(\);\s*$/) && i > 1850 && i < 1920) targets.renderBeforeGetGroup = i;
  if (l.includes('if (!state.activeGroupId)') && l.includes('ensureDefaultGroupReady') && i > 5270 && i < 5310) targets.beforeEnsureGroup = i;
}
console.log('Targets:', JSON.stringify(targets, null, 2));

// Fix 1: onUploadRootDrop - add claimUploadDropEvent
if (targets.onUploadRootDrop !== undefined) {
  const idx = targets.onUploadRootDrop;
  // lines[idx] = the function declaration
  // lines[idx+1] is "if (!prepareUploadDragEvent(e)) return;"
  // lines[idx+2] is blank line
  // Insert claimUploadDropEvent check
  const indent = lines[idx+1].match(/^\s+/)[0];
  lines.splice(idx + 2, 0, indent + 'if (!claimUploadDropEvent(e, \x27root\x27)) return;');
  console.log('Fixed onUploadRootDrop');
  // Adjust all subsequent indices
  for (const key of Object.keys(targets)) {
    if (targets[key] > idx) targets[key]++;
  }
}

// Fix 2: onGlobalUploadDrop - add claimUploadDropEvent
if (targets.onGlobalUploadDrop !== undefined) {
  const idx = targets.onGlobalUploadDrop;
  const indent = lines[idx+1].match(/^\s+/)[0];
  lines.splice(idx + 2, 0, indent + 'if (!claimUploadDropEvent(e, \x27global\x27)) return;');
  console.log('Fixed onGlobalUploadDrop');
  for (const key of Object.keys(targets)) {
    if (targets[key] > idx) targets[key]++;
  }
}

// Fix 3: Add shouldSkipRecentDuplicateDrop check in handleUploadDropEvent
if (targets.beforeEnsureGroup !== undefined) {
  const idx = targets.beforeEnsureGroup;
  const indent = lines[idx].match(/^\s+/)[0];
  lines.splice(idx, 0,
    indent + 'if (shouldSkipRecentDuplicateDrop(transfer)) {',
    indent + '  setStatus(\x27宸插拷鐣ラ噸澶嶆嫋鎷界簨浠\x27);',
    indent + '  return;',
    indent + '}',
    ''
  );
  console.log('Added shouldSkipRecentDuplicateDrop check');
  for (const key of Object.keys(targets)) {
    if (targets[key] > idx) targets[key] += 5;
  }
}

// Fix 4: Add dedupeActiveGroupQueue after addDroppedFiles
if (targets.afterAdd !== undefined) {
  const idx = targets.afterAdd;
  const indent = lines[idx].match(/^\s+/)[0];
  lines.splice(idx + 1, 0,
    '',
    indent + 'dedupeActiveGroupQueue(\x27drop\x27);'
  );
  console.log('Added dedupe after addDroppedFiles');
  for (const key of Object.keys(targets)) {
    if (targets[key] > idx) targets[key] += 2;
  }
}

// Fix 5: Add dedupeActiveGroupQueue before schedulePersistQueue in addFiles
if (targets.persistQueue !== undefined) {
  const idx = targets.persistQueue;
  const indent = lines[idx].match(/^\s+/)[0];
  lines.splice(idx, 0, indent + 'dedupeActiveGroupQueue(\x27add-files\x27);');
  console.log('Added dedupe before schedulePersistQueue');
  for (const key of Object.keys(targets)) {
    if (targets[key] > idx) targets[key]++;
  }
}

// Fix 6: Add dedupeActiveGroupQueue before render in loadQueueForActiveGroup
if (targets.renderBeforeGetGroup !== undefined) {
  const idx = targets.renderBeforeGetGroup;
  const indent = lines[idx].match(/^\s+/)[0];
  lines.splice(idx, 0, indent + 'dedupeActiveGroupQueue(\x27load-queue\x27);');
  console.log('Added dedupe before render in loadQueueForActiveGroup');
  for (const key of Object.keys(targets)) {
    if (targets[key] > idx) targets[key]++;
  }
}

// Fix 7: Fix broken template literal in shouldSkipRecentDuplicateDrop
if (targets.brokenSkip !== undefined) {
  const idx = targets.brokenSkip;
  lines[idx] = '          [UPLOAD_DIAG][drop:skip-recent-duplicate] signature=';
  console.log('Fixed broken template in shouldSkipRecentDuplicateDrop');
}

// Fix 8: Fix broken template literal in claimUploadDropEvent
if (targets.brokenClaim !== undefined) {
  const idx = targets.brokenClaim;
  lines[idx] = '          [UPLOAD_DIAG][drop:skip-already-handled] source=';
  console.log('Fixed broken template in claimUploadDropEvent');
}

// Fix 9: Fix broken template literal in dedupeActiveGroupQueue
if (targets.brokenDedup !== undefined) {
  const idx = targets.brokenDedup;
  lines[idx] = '            [UPLOAD_DIAG][dedupe-active-group:remove] reason= name= size= id=';
  console.log('Fixed broken template in dedupeActiveGroupQueue');
}

content = lines.join('\n');
fs.writeFileSync(filepath, content, 'utf-8');
console.log('All fixes applied');
