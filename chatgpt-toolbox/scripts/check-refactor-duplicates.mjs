import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(ROOT_DIR, '..', 'tampermonkey-userscript-src');

const TARGET_FUNCTIONS = [
  'getClosedLoopModeFromAction',
  'getClosedLoopUploadFailedSource',
  'getUploadItemSchemaAuditData',
  'appendUploadSchemaAuditLog',
  'isFlaskUploadGroupId',
  'sendCurrentComposerMessage',
  'sendTextOnlyMessage',
  'startUploadFromCurrentQueue',
  'uploadSingleQueueItem',
  'waitForComposerTextSynced',
  'setComposerText',
];

const DELEGATE_MARKERS = /DELEGATE|delegate|canonical|legacy/i;

const ALLOWED_WRAPPER_PAIRS = new Map([
  [
    'getClosedLoopModeFromAction',
    [
      'upload/closed-loop-config.js',
      'upload/upload-module.js',
    ],
  ],
  [
    'getClosedLoopUploadFailedSource',
    [
      'upload/closed-loop-config.js',
      'upload/upload-module.js',
    ],
  ],
  [
    'getUploadItemSchemaAuditData',
    [
      'upload/upload-module.js',
      'upload/upload-queue-store.js',
    ],
  ],
  [
    'appendUploadSchemaAuditLog',
    [
      'upload/upload-module.js',
      'upload/upload-queue-store.js',
    ],
  ],
  [
    'isFlaskUploadGroupId',
    [
      'upload/upload-module.js',
      'upload/upload-queue-store.js',
    ],
  ],
]);

function sameFileSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

function isAllowedWrapperPair(functionName, files, occurrences) {
  const allowedFiles = ALLOWED_WRAPPER_PAIRS.get(functionName);
  if (!allowedFiles || !sameFileSet(files, allowedFiles)) {
    return false;
  }
  return occurrences.some((item) => item.delegate === true);
}

function walkJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(fullPath);
    }
  }
  return out;
}

function findFunctionBlocks(text, functionName) {
  const pattern = new RegExp(`function\\s+${functionName}\\s*\\(`, 'g');
  const blocks = [];
  let match = pattern.exec(text);
  while (match) {
    const start = match.index;
    let parenDepth = 0;
    let signatureEnd = -1;
    for (let i = match.index + match[0].length - 1; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '(') {
        parenDepth += 1;
      } else if (ch === ')') {
        parenDepth -= 1;
        if (parenDepth === 0) {
          signatureEnd = i;
          break;
        }
      }
    }
    if (signatureEnd < 0) {
      console.error(
        `[REFACTOR_DUPLICATE][PARSE_ERROR] function=${functionName} reason=signature-not-closed index=${start}`,
      );
      match = pattern.exec(text);
      continue;
    }
    const braceStart = text.indexOf('{', signatureEnd);
    if (braceStart < 0) {
      console.error(
        `[REFACTOR_DUPLICATE][PARSE_ERROR] function=${functionName} reason=body-not-found index=${start}`,
      );
      match = pattern.exec(text);
      continue;
    }
    let depth = 0;
    let end = braceStart;
    let closed = false;
    for (let i = braceStart; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) {
      console.error(
        `[REFACTOR_DUPLICATE][PARSE_ERROR] function=${functionName} reason=body-not-closed index=${start}`,
      );
      match = pattern.exec(text);
      continue;
    }
    blocks.push({
      start,
      end,
      body: text.slice(start, end),
    });
    match = pattern.exec(text);
  }
  return blocks;
}

function hasDelegateMarker(body) {
  return DELEGATE_MARKERS.test(body);
}

function rel(filePath) {
  return path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('[REFACTOR_DUPLICATE][ERROR] reason=missing-src-dir path=' + SRC_DIR);
    process.exit(1);
  }

  const files = walkJsFiles(SRC_DIR);
  let hasError = false;

  for (const functionName of TARGET_FUNCTIONS) {
    const occurrences = [];

    for (const filePath of files) {
      const text = fs.readFileSync(filePath, 'utf8');
      const blocks = findFunctionBlocks(text, functionName);
      for (const block of blocks) {
        occurrences.push({
          file: rel(filePath),
          body: block.body,
          delegate: hasDelegateMarker(block.body),
        });
      }
    }

    if (occurrences.length <= 1) {
      continue;
    }

    const fileList = [...new Set(occurrences.map((item) => item.file))];
    if (isAllowedWrapperPair(functionName, fileList, occurrences)) {
      console.warn(
        `[REFACTOR_DUPLICATE][WRAPPER_OK] function=${functionName} count=${occurrences.length} files=${fileList.join(',')}`,
      );
      continue;
    }
    console.warn(
      `[REFACTOR_DUPLICATE][WARN] function=${functionName} count=${occurrences.length} files=${fileList.join(',')}`,
    );

    const fullImplementations = occurrences.filter((item) => !item.delegate);
    if (fullImplementations.length > 1) {
      hasError = true;
      console.error(
        `[REFACTOR_DUPLICATE][ERROR] function=${functionName} reason=multiple-full-implementations files=${fullImplementations.map((item) => item.file).join(',')}`,
      );
    }
  }

  if (hasError) {
    process.exit(1);
  }
}

main();
