import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');

const MAX_OK_CHARS = 220_000;
const MAX_WARN_CHARS = 120_000;

const FORBIDDEN_ACTIVE_FILES = [
  'core/chat-message-cache.js',
];

const FORBIDDEN_BUILD_PARTS = [
  'core/chat-message-cache.js',
  'ui/toolbox-message-extractor.js',
];

const KNOWN_LARGE_FILES = [
  'autoqueue/auto-queue-core.js',
  'upload/upload-module.js',
];

const THIN_WRAPPER_PATTERNS = [
  'legacy',
  '委托 main.js',
  '委托旧',
  'fallback to legacy',
  '旧实现',
  'old implementation',
];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[SRC_AUDIT][MISSING_FILE] file=${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function relativeToSrc(filePath) {
  return toPosixPath(path.relative(SRC_DIR, filePath));
}

function walkFiles(dir, result = []) {
  if (!fs.existsSync(dir)) {
    return result;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules'
        || entry.name === 'dist'
        || entry.name === '.git'
      ) {
        continue;
      }
      walkFiles(fullPath, result);
      continue;
    }
    if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

function getBuildOrderParts() {
  const raw = readText(BUILD_ORDER_FILE);
  const json = JSON.parse(raw);
  if (!Array.isArray(json.parts)) {
    throw new Error('[SRC_AUDIT][BUILD_ORDER_INVALID] parts is not array');
  }
  return json.parts;
}

function getSourceJsFiles() {
  return walkFiles(SRC_DIR)
    .filter((filePath) => filePath.endsWith('.js'))
    .filter((filePath) => !relativeToSrc(filePath).startsWith('_archive_unused/'))
    .map((filePath) => ({
      absPath: filePath,
      relPath: relativeToSrc(filePath),
      sizeBytes: fs.statSync(filePath).size,
      chars: readText(filePath).length,
    }));
}

function checkBuildOrderMissingFiles(parts) {
  const failures = [];
  for (const part of parts) {
    const fullPath = path.join(SRC_DIR, part);
    if (!fs.existsSync(fullPath)) {
      failures.push({
        type: 'build-order-missing-file',
        part,
      });
    }
  }
  return failures;
}

function checkForbiddenBuildParts(parts) {
  return FORBIDDEN_BUILD_PARTS
    .filter((part) => parts.includes(part))
    .map((part) => ({
      type: 'forbidden-build-part',
      part,
    }));
}

function checkForbiddenActiveFiles() {
  return FORBIDDEN_ACTIVE_FILES
    .filter((part) => fs.existsSync(path.join(SRC_DIR, part)))
    .map((part) => ({
      type: 'forbidden-active-file',
      part,
    }));
}

function checkLargeFiles(files) {
  return files
    .filter((item) => item.chars > MAX_WARN_CHARS)
    .sort((a, b) => b.chars - a.chars)
    .map((item) => ({
      type: item.chars > MAX_OK_CHARS ? 'large-file-error' : 'large-file-warn',
      file: item.relPath,
      chars: item.chars,
      sizeBytes: item.sizeBytes,
      knownLarge: KNOWN_LARGE_FILES.includes(item.relPath),
    }));
}

function countRegex(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function checkThinWrappers(files, buildParts) {
  const buildSet = new Set(buildParts);
  const findings = [];

  for (const item of files) {
    const text = readText(item.absPath);
    const lower = text.toLowerCase();
    const hasWrapperKeyword = THIN_WRAPPER_PATTERNS.some((pattern) => (
      lower.includes(String(pattern).toLowerCase())
    ));
    const functionCount = countRegex(text, /\bfunction\s+[A-Za-z0-9_$]+\s*\(/g);
    const constModuleCount = countRegex(text, /\bconst\s+[A-Za-z0-9_$]+\s*=\s*\(\(\)\s*=>\s*\{/g);
    const globalExportCount = countRegex(text, /globalThis\.[A-Za-z0-9_$]+\s*=/g);
    const createOnly = text.includes('function create(')
      && text.includes('return Object.freeze({')
      && text.includes('create')
      && functionCount <= 3;
    const looksThin = (
      hasWrapperKeyword
      || (
        createOnly
        && globalExportCount <= 1
        && item.chars < 18_000
      )
    );

    if (looksThin) {
      findings.push({
        type: 'possible-thin-wrapper',
        file: item.relPath,
        chars: item.chars,
        inBuildOrder: buildSet.has(item.relPath),
        functionCount,
        constModuleCount,
        globalExportCount,
        reason: hasWrapperKeyword ? 'legacy-keyword' : 'create-only-small-module',
      });
    }
  }

  return findings;
}

function checkDuplicateBaseNames(files) {
  const map = new Map();
  for (const item of files) {
    const base = path.basename(item.relPath);
    if (!map.has(base)) {
      map.set(base, []);
    }
    map.get(base).push(item.relPath);
  }

  const findings = [];
  for (const [base, relPaths] of map.entries()) {
    if (relPaths.length <= 1) {
      continue;
    }
    findings.push({
      type: 'duplicate-basename',
      base,
      files: relPaths,
    });
  }
  return findings;
}

function checkUnbuiltActiveModules(files, buildParts) {
  const buildSet = new Set(buildParts);
  return files
    .filter((item) => !buildSet.has(item.relPath))
    .filter((item) => !item.relPath.startsWith('_archive_unused/'))
    .filter((item) => !item.relPath.startsWith('styles/'))
    .filter((item) => !item.relPath.endsWith('.bak'))
    .map((item) => ({
      type: 'active-js-not-in-build-order',
      file: item.relPath,
      chars: item.chars,
    }));
}

function printSection(title, rows, formatter) {
  console.log('');
  console.log(`========== ${title} ==========`);
  if (!rows.length) {
    console.log('(none)');
    return;
  }
  rows.forEach((row, index) => {
    console.log(formatter(row, index));
  });
}

function main() {
  console.log(`[SRC_AUDIT][START] root=${ROOT_DIR}`);

  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`[SRC_AUDIT][SRC_DIR_MISSING] dir=${SRC_DIR}`);
  }

  const parts = getBuildOrderParts();
  const files = getSourceJsFiles();

  const buildMissing = checkBuildOrderMissingFiles(parts);
  const forbiddenBuild = checkForbiddenBuildParts(parts);
  const forbiddenActive = checkForbiddenActiveFiles();
  const largeFiles = checkLargeFiles(files);
  const thinWrappers = checkThinWrappers(files, parts);
  const duplicateBaseNames = checkDuplicateBaseNames(files);
  const unbuiltActiveModules = checkUnbuiltActiveModules(files, parts);

  printSection(
    'Top large files',
    largeFiles.slice(0, 20),
    (row, index) => `${index + 1}. [${row.type}] ${row.file} chars=${row.chars} knownLarge=${row.knownLarge ? 1 : 0}`,
  );

  printSection(
    'Build-order missing files',
    buildMissing,
    (row) => `[${row.type}] part=${row.part}`,
  );

  printSection(
    'Forbidden build parts',
    forbiddenBuild,
    (row) => `[${row.type}] part=${row.part}`,
  );

  printSection(
    'Forbidden active files',
    forbiddenActive,
    (row) => `[${row.type}] part=${row.part}`,
  );

  printSection(
    'Possible thin wrappers',
    thinWrappers.slice(0, 50),
    (row, index) => `${index + 1}. [${row.type}] file=${row.file} chars=${row.chars} inBuildOrder=${row.inBuildOrder ? 1 : 0} reason=${row.reason} functionCount=${row.functionCount}`,
  );

  printSection(
    'Duplicate basenames',
    duplicateBaseNames,
    (row) => `[${row.type}] base=${row.base} files=${row.files.join(', ')}`,
  );

  printSection(
    'Active JS not in build-order',
    unbuiltActiveModules.slice(0, 80),
    (row, index) => `${index + 1}. [${row.type}] file=${row.file} chars=${row.chars}`,
  );

  const hardFailures = [
    ...buildMissing,
    ...forbiddenBuild,
    ...forbiddenActive,
  ];

  const largeHardFailures = largeFiles.filter((row) => (
    row.type === 'large-file-error'
    && !row.knownLarge
  ));

  const failures = [
    ...hardFailures,
    ...largeHardFailures,
  ];

  console.log('');
  console.log('[SRC_AUDIT][SUMMARY]', {
    buildPartCount: parts.length,
    activeJsCount: files.length,
    largeFileCount: largeFiles.length,
    thinWrapperCount: thinWrappers.length,
    unbuiltActiveModuleCount: unbuiltActiveModules.length,
    hardFailureCount: failures.length,
  });

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error('[SRC_AUDIT][FAILED_ITEM]', item);
    });
    throw new Error(`[SRC_AUDIT][FAILED] count=${failures.length}`);
  }

  console.log('[SRC_AUDIT][OK]');
}

try {
  main();
} catch (error) {
  console.error('[SRC_AUDIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
