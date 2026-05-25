import fs from 'fs';
import path from 'path';

const root = path.resolve('tampermonkey-userscript-src');
const files = [];

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
}

walk(root);

const btnRe = /<button[^>]*>/gi;
const idRe = /id="([^"]+)"/i;
const actRe = /data-action="([^"]+)"/i;
const rows = [];

for (const f of files.sort()) {
  const t = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = btnRe.exec(t))) {
    const tag = m[0];
    const id = (idRe.exec(tag) || [])[1] || '';
    const act = (actRe.exec(tag) || [])[1] || '';
    if (id.startsWith('cgpt-') || act) {
      rows.push({ file: path.relative(root, f), id, act });
    }
  }
}

const checks = {
  textContentCancel: 0,
  classListWaitCancel: 0,
  sendBtnClickToolbox: 0,
};

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  if (/textContent\s*===\s*['"]取消/.test(t)) checks.textContentCancel++;
  if (/classList\.contains\(['"]cgpt-wait-send-cancel/.test(t)) checks.classListWaitCancel++;
}

console.log(JSON.stringify({ fileCount: files.length, buttonCount: rows.length, antiPatterns: checks, uploadCore: rows.filter((r) => r.file.startsWith('upload/') && ['cgpt-upload-start', 'cgpt-upload-start-send'].includes(r.id)) }, null, 2));
