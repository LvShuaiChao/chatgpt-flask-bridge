const fs = require('fs');
const filepath = 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\upload\\upload-module.js';
let content = fs.readFileSync(filepath, 'utf-8');
const lines = content.split('\n');

// Fix 1: Add shouldSkipRecentDuplicateDrop at line 5282 (before first !state.activeGroupId)
const target1Idx = 5281; // 0-indexed
const indent1 = lines[target1Idx].match(/^\s+/)[0];
lines.splice(target1Idx, 0,
  indent1 + 'if (shouldSkipRecentDuplicateDrop(transfer)) {',
  indent1 + '  setStatus(\x27宸插拷鐣ラ噸澶嶆嫋鎷界簨浠\x27);',
  indent1 + '  return;',
  indent1 + '}',
  ''
);
console.log('Added shouldSkipRecentDuplicateDrop check');

// Fix 2: Add dedupeActiveGroupQueue before render() in loadQueueForActiveGroup try block
// render() is now at a shifted position. Let me find it.
let targetLines = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].match(/^\s+render\(\);\s*$/) && i > 1830 && i < 1950) {
    targetLines.push(i);
  }
}
console.log('render() lines found:', targetLines.map(i => i+1));

for (const idx of targetLines) {
  const indent = lines[idx].match(/^\s+/)[0];
  // Check if dedupe is already before this render
  if (idx > 0 && lines[idx-1].includes('dedupeActiveGroupQueue')) {
    console.log('  Line ' + (idx+1) + ' already has dedupe before it');
    continue;
  }
  lines.splice(idx, 0, indent + 'dedupeActiveGroupQueue(\x27load-queue\x27);');
  console.log('  Added dedupe before line ' + (idx+1));
}

content = lines.join('\n');
fs.writeFileSync(filepath, content, 'utf-8');
console.log('Remaining fixes applied');
