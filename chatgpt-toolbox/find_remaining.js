const fs = require('fs');
const filepath = 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\upload\\upload-module.js';
let content = fs.readFileSync(filepath, 'utf-8');
const lines = content.split('\n');

// Find the remaining targets
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // handleUploadDropEvent: find the ensureDefaultGroupReady area
  if (l.includes('ensureDefaultGroupReady') && i > 5270 && i < 5320) {
    console.log('ensureDefaultGroupReady at line', i+1, ':', l.trim());
    // Show context
    for (let j = Math.max(0, i-3); j <= Math.min(lines.length-1, i+3); j++) {
      console.log('  ' + (j+1) + ': ' + lines[j].replace(/\r$/, ''));
    }
  }
  // render before getActiveGroup
  if (l.match(/^\s+render\(\);\s*$/) && i > 1850 && i < 1950) {
    console.log('\\nrender() at line', i+1, ':', l.trim());
    for (let j = Math.max(0, i-1); j <= Math.min(lines.length-1, i+3); j++) {
      console.log('  ' + (j+1) + ': ' + lines[j].replace(/\r$/, ''));
    }
  }
}
