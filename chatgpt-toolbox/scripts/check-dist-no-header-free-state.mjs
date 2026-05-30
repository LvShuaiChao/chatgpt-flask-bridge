import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve('dist/client.user.js');
const source = fs.readFileSync(target, 'utf8');

const startNeedle = 'function resolveWaitingReplyFlag';
const endNeedle = 'function resolveRespondingFlag';

const startIndex = source.indexOf(startNeedle);
const endIndex = source.indexOf(endNeedle, startIndex + startNeedle.length);

if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
  console.error('[DIST_HEADER_STATUS][SECTION_NOT_FOUND]');
  console.error(`- start=${startIndex} end=${endIndex}`);
  process.exit(1);
}

const section = source.slice(startIndex, endIndex);

const forbiddenPatterns = [
  { label: 'state.waitingReply', re: /\bstate\.waitingReply\b/ },
  { label: 'state.autoQueueWaitingReply', re: /\bstate\.autoQueueWaitingReply\b/ },
  { label: 'state.waiting_reply', re: /\bstate\.waiting_reply\b/ },
  { label: 'state.auto_queue_waiting_reply', re: /\bstate\.auto_queue_waiting_reply\b/ },
];

const hits = [];
const lines = section.split(/\r?\n/);

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  for (const { label, re } of forbiddenPatterns) {
    if (re.test(line)) {
      hits.push({ lineNo: i + 1, label, text: line.trim() });
    }
  }
}

if (hits.length > 0) {
  console.error('[DIST_HEADER_STATUS][FREE_STATE_FOUND]');
  hits.forEach((hit) => {
    console.error(`- ${hit.label} (section line ${hit.lineNo}): ${hit.text}`);
  });
  process.exit(1);
}

console.log('[DIST_HEADER_STATUS][NO_FREE_STATE_OK]');
