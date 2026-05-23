const fs = require('fs');
const filepath = 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\tampermonkey-userscript-src\\upload\\upload-module.js';
let content = fs.readFileSync(filepath, 'utf-8');
const lines = content.split('\n');

// Verify we know exact line numbers of targets
let targets = {};
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('async function onUploadRootDrop(e)')) targets.onUploadRootDrop = i;
  if (l.includes('async function onGlobalUploadDrop(e)')) targets.onGlobalUploadDrop = i;
  if (l.includes('async function handleUploadDropEvent(e)')) targets.handleUploadDropEvent = i;
  if (l.includes('shouldSkipRecentDuplicateDrop')) targets.shouldSkipRecentDuplicateDrop = i;
  if (l.includes('claimUploadDropEvent(e, source)')) targets.claimUploadDropEvent = i;
  if (l.includes('UPLOAD_DROP_HANDLED_PROP]')) targets.claimBody = i;
  if (l.includes('[drop:skip-recent-duplicate]')) targets.brokenSkip = i;
  if (l.includes('[drop:skip-already-handled]')) targets.brokenClaim = i;
  if (l.includes('[dedupe-active-group:remove]')) targets.brokenDedup = i;
  if (l.includes('await addDroppedFiles(dropped)')) targets.afterAdd = i;
  if (l.includes('await schedulePersistQueue()') && l.includes('}');)) ;
  if (l.includes('dedupeActiveGroupQueue')) targets.dedupLine = i;
}

console.log('Targets found:', JSON.stringify(targets, null, 2));
