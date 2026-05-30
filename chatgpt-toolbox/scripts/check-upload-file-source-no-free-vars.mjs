import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const target = path.resolve('tampermonkey-userscript-src/upload/upload-file-source.js');
const source = fs.readFileSync(target, 'utf8');
const wrapped = `
/* eslint-disable */
${source}
`;
const sourceFile = ts.createSourceFile(
  target,
  wrapped,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.JS,
);
const options = {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  skipLibCheck: true,
};
const host = ts.createCompilerHost(options);
host.getSourceFile = (fileName) => {
  if (path.resolve(fileName) === target) {
    return sourceFile;
  }
  const text = fs.existsSync(fileName) ? fs.readFileSync(fileName, 'utf8') : '';
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
};
const program = ts.createProgram([target], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
const ignoredNames = new Set([
  'ToolboxShell',
  'MemoryManager',
  'unsafeWindow',
  'window',
  'document',
  'console',
  'indexedDB',
  'setTimeout',
  'clearTimeout',
  'Promise',
  'Error',
  'Date',
  'JSON',
  'Map',
  'Set',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Blob',
  'File',
  'fetch',
  'URL',
  'AbortController',
  'FormData',
  'HTMLElement',
  'HTMLInputElement',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'performance',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
]);
const missing = [];
for (const d of diagnostics) {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  const m = msg.match(/Cannot find name '([^']+)'/);
  if (!m) {
    continue;
  }
  const name = m[1];
  if (!ignoredNames.has(name)) {
    missing.push(name);
  }
}
const unique = [...new Set(missing)].sort();
if (unique.length > 0) {
  console.error('[UPLOAD_FILE_SOURCE][FREE_VARS_FOUND]');
  unique.forEach((name) => console.error(`- ${name}`));
  process.exit(1);
}
console.log('[UPLOAD_FILE_SOURCE][NO_FREE_VARS_OK]');
