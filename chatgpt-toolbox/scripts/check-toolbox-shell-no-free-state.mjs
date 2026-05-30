import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve('tampermonkey-userscript-src/ui/toolbox-shell.js');
const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);

const allowPatterns = [
  /APP\.state/,
  /__CGPT_TOOLBOX_STATE__/,
  /runtimeState\./,
  /\bs\./,
  /\bconst\s+state\b/,
  /\blet\s+state\b/,
  /\bvar\s+state\b/,
  /function\s*\(\s*state\b/,
  /function\s+\w+\s*\(\s*state\b/,
  /\(\s*state\s*,/,
  /,\s*state\s*\)/,
  /pageState\./,
  /domState\./,
  /autoState\./,
  /replyState\./,
  /listState\./,
  /uploadState\./,
  /composerState\./,
  /tabTitleState/,
  /response_state/,
  /page_state/,
  /empty-state/,
  /input-state/,
  /#cgpt-page-input-state/,
  /getToolboxPageState/,
  /readToolboxStateField/,
  /MemoryManager\.getToolboxState/,
  /repairInvisibleToolboxState/,
  /normalizeToolboxState/,
  /\bstate\.(dragRafId|moved|committedDx|committedDy|latestDx|latestDy|startLeft|startTop)\b/,
];

const hits = [];
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (!/\bstate\.[a-zA-Z_$]/.test(line)) {
    continue;
  }
  if (allowPatterns.some((pattern) => pattern.test(line))) {
    continue;
  }
  hits.push({ lineNo: i + 1, text: line.trim() });
}

if (hits.length > 0) {
  console.error('[TOOLBOX_SHELL][FREE_STATE_FOUND]');
  hits.forEach((hit) => {
    console.error(`- ${hit.lineNo}: ${hit.text}`);
  });
  process.exit(1);
}

console.log('[TOOLBOX_SHELL][NO_FREE_STATE_OK]');
