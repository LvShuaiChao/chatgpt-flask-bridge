const fs = require('fs');
const filepath = 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\upload\\upload-module.js';
let content = fs.readFileSync(filepath, 'utf-8');
const lines = content.split('\n');

// Find the loadQueueForActiveGroup render area
let inFunc = false;
let braceDepth = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('async function loadQueueForActiveGroup()')) {
    inFunc = true;
    braceDepth = 0;
  }
  if (inFunc) {
    for (const ch of l) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }
    if (braceDepth === 0 && i > 1800) {
      // Function ends here - find the render call before this
      for (let j = i - 10; j <= i; j++) {
        console.log((j+1) + ': ' + lines[j].replace(/\r$/, ''));
      }
      break;
    }
  }
}
