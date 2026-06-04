/**
 * Split refactor_runtime_verification_20260604_runtime.txt (oneshot download)
 * into the seven exports/for_chatgpt/*.txt files required for upload.
 *
 * Usage (from repo root):
 *   node tools/split-refactor-runtime-export.mjs [path-to-runtime.txt]
 * Default input: exports/for_chatgpt/refactor_runtime_verification_20260604_runtime.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'exports/for_chatgpt');
const defaultIn = path.join(outDir, 'refactor_runtime_verification_20260604_runtime.txt');
const inputPath = path.resolve(process.argv[2] || defaultIn);

if (!fs.existsSync(inputPath)) {
  console.error('[split] missing input:', inputPath);
  console.error('[split] run browser oneshot first, save download as that path');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');
const jsonMatch = raw.match(/\{[\s\S]*"summary"[\s\S]*"report"[\s\S]*\}/);
let payload = null;
if (jsonMatch) {
  try {
    payload = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[split] JSON parse failed', err);
    process.exit(1);
  }
}

function sectionBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return '';
  const from = start + startMarker.length;
  const end = endMarker ? text.indexOf(endMarker, from) : text.length;
  return text.slice(from, end < 0 ? text.length : end).trim();
}

function linesFromPayload(filterFn) {
  if (!payload?.report?.sections?.manualHarvest) return [];
  const h = payload.report.sections.manualHarvest;
  const all = [
    ...(h.sendMessage || []),
    ...(h.sendCopyHotkey || []),
    ...(h.closedLoop || []),
    ...(h.upload || []),
    ...(h.edgeCases || []),
    ...(h.candidateViolations || []),
    ...(h.tail || []),
  ];
  return all.filter(filterFn);
}

function writeOut(name, body) {
  const p = path.join(outDir, name);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(p, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
  console.log('[split] wrote', p, `(${body.length} bytes)`);
}

const c1 = sectionBetween(raw, '# --- C1 send-message logs ---', '# --- C2');
const c2 = sectionBetween(raw, '# --- C2 send-copy-hotkey logs ---', '# --- C3');
const c3 = sectionBetween(raw, '# --- C3 closed-loop success ---', '# --- C4');
const c4 = sectionBetween(raw, '# --- C4 closed-loop fail ---', '# --- C5');
const c5 = sectionBetween(raw, '# --- C5 upload ---', '# --- C6');
const c6 = sectionBetween(raw, '# --- C6 edge cases ---', '# candidate violations:');

const header = (title) => `# ${title}\n# source: ${path.basename(inputPath)}\n# split_at: ${new Date().toISOString()}\n\n`;

writeOut('send_message_button_log_20260604.txt', header('Send message button log') + (c1 || linesFromPayload((l) => /\[SEND_PIPELINE\]/.test(l)).join('\n') || '# (empty — re-run oneshot or copy toolbox log after send-message)'));
writeOut('send_copy_hotkey_button_log_20260604.txt', header('Send+copy+hotkey log') + (c2 || linesFromPayload((l) => /SKIP_LOCAL_QUEUE|SEND_PIPELINE|send-copy-hotkey/i.test(l)).join('\n') || '# (empty)'));
writeOut('closed_loop_success_log_20260604.txt', header('Closed-loop success') + (c3 || (payload?.report?.sections?.closedLoopSuccess?.ok1 || []).join('\n') || '# (empty — need ok=1)'));
writeOut('closed_loop_failure_log_20260604.txt', header('Closed-loop failure') + (c4 || (payload?.report?.sections?.closedLoopFail?.lines || []).join('\n') || '# (empty — need ok=0 or DISPATCH_FAILED)'));
writeOut('upload_button_log_20260604.txt', header('Upload button') + (c5 || linesFromPayload((l) => /\[UPLOAD\]|\[UPLOAD_RUNNER\]|\[UPLOAD_SEND_FLOW\]|\[BRIDGE\]\[UPLOAD\]/.test(l)).join('\n') || '# (empty — add file + click #cgpt-upload-start)'));
writeOut('runtime_edge_cases_log_20260604.txt', header('Edge cases') + (c6 || linesFromPayload((l) => /empty_text|composer_empty|duplicate|another-send-running|blocked|runId=/i.test(l)).join('\n') || '# (empty)'));

console.log('[split] main runtime file unchanged:', inputPath);
console.log('[split] done — include all exports/for_chatgpt/*_20260604*.txt in next upload zip');
