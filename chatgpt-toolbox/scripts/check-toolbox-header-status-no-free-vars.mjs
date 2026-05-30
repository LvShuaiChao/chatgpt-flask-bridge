import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve('tampermonkey-userscript-src/ui/toolbox-header-status.js');
const lines = fs.readFileSync(target, 'utf8').split(/\r?\n/);

const forbiddenPatterns = [
  { label: 'state.waitingReply', re: /\bstate\.waitingReply\b/ },
  { label: 'state.autoQueueWaitingReply', re: /\bstate\.autoQueueWaitingReply\b/ },
  { label: 'state.waiting_send', re: /\bstate\.waiting_send\b/ },
  { label: 'state.responseState', re: /\bstate\.responseState\b/ },
  { label: 'state.response_state', re: /\bstate\.response_state\b/ },
  { label: 'state.buttonTasks', re: /\bstate\.buttonTasks\b/ },
  { label: 'state.sendTask', re: /\bstate\.sendTask\b/ },
  { label: 'state.uploadTask', re: /\bstate\.uploadTask\b/ },
];

const allowLinePatterns = [
  /runtimeState/,
  /\bconst\s+s\b/,
  /\blet\s+s\b/,
  /\bs\.waitingReply/,
  /\bs\.autoQueueWaitingReply/,
  /\bs\.responseState/,
  /\bs\.response_state/,
  /\bs\.buttonTasks/,
  /\bs\.sendTask/,
  /\bs\.uploadTask/,
  /APP\.state/,
  /window\.__CGPT_TOOLBOX_STATE__/,
  /getToolboxRuntimeStateSafe/,
];

const hits = [];

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (allowLinePatterns.some((pattern) => pattern.test(line))) {
    continue;
  }
  for (const { label, re } of forbiddenPatterns) {
    if (re.test(line)) {
      hits.push({ lineNo: i + 1, label, text: line.trim() });
    }
  }
}

if (hits.length > 0) {
  console.error('[TOOLBOX_HEADER_STATUS][FREE_STATE_FOUND]');
  hits.forEach((hit) => {
    console.error(`- ${hit.lineNo}: ${hit.label} :: ${hit.text}`);
  });
  process.exit(1);
}

console.log('[TOOLBOX_HEADER_STATUS][NO_FREE_STATE_OK]');
