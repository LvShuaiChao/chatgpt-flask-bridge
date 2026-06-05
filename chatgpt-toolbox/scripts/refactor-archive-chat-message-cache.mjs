import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const ACTIVE_FILE = path.join(SRC_DIR, 'core', 'chat-message-cache.js');
const BUILD_ORDER_PART = 'core/chat-message-cache.js';
const ARCHIVE_DIR = path.join(SRC_DIR, '_archive', 'core');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getTimestampString(now = new Date()) {
  return [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
  ].join('.') + '-' + [
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join('_');
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, String(text || ''), 'utf8');
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const backupPath = `${filePath}.bak.${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`[CHAT_MESSAGE_CACHE_ARCHIVE][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function removeFromBuildOrder() {
  if (!fs.existsSync(BUILD_ORDER_FILE)) {
    throw new Error(`[CHAT_MESSAGE_CACHE_ARCHIVE][MISSING_FILE] file=${BUILD_ORDER_FILE}`);
  }

  const config = JSON.parse(readText(BUILD_ORDER_FILE));
  const parts = Array.isArray(config.parts) ? [...config.parts] : [];
  const beforeCount = parts.length;
  const nextParts = parts.filter((part) => part !== BUILD_ORDER_PART);
  const removedCount = beforeCount - nextParts.length;

  if (removedCount > 0) {
    backupFile(BUILD_ORDER_FILE);
    config.parts = nextParts;
    writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  }

  console.log('[CHAT_MESSAGE_CACHE_ARCHIVE][BUILD_ORDER_OK]', {
    removedCount,
    stillContains: nextParts.includes(BUILD_ORDER_PART),
  });

  return removedCount;
}

function archiveActiveFile() {
  if (!fs.existsSync(ACTIVE_FILE)) {
    console.log('[CHAT_MESSAGE_CACHE_ARCHIVE][ACTIVE_FILE_SKIP] reason=file-not-found path=' + ACTIVE_FILE);
    return { archived: false, archivePath: '' };
  }

  const sourceText = readText(ACTIVE_FILE);
  if (!sourceText.includes('ChatMessageCache')) {
    throw new Error(
      `[CHAT_MESSAGE_CACHE_ARCHIVE][UNEXPECTED_CONTENT] file=${ACTIVE_FILE} reason=missing-ChatMessageCache-marker`,
    );
  }

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const archivePath = path.join(
    ARCHIVE_DIR,
    `chat-message-cache.js.${getTimestampString()}.archived.js`,
  );

  if (fs.existsSync(archivePath)) {
    throw new Error(
      `[CHAT_MESSAGE_CACHE_ARCHIVE][ARCHIVE_EXISTS] path=${archivePath} reason=refusing-to-overwrite`,
    );
  }

  writeText(archivePath, sourceText);
  fs.unlinkSync(ACTIVE_FILE);

  console.log('[CHAT_MESSAGE_CACHE_ARCHIVE][ACTIVE_FILE_OK]', {
    from: ACTIVE_FILE,
    to: archivePath,
  });

  return { archived: true, archivePath };
}

function verifyResult(archiveResult) {
  const failures = [];

  if (fs.existsSync(ACTIVE_FILE)) {
    failures.push('active file still exists at core/chat-message-cache.js');
  }

  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else if (order.parts.includes(BUILD_ORDER_PART)) {
    failures.push('.build-order.json still contains core/chat-message-cache.js');
  }

  const extractorFile = path.join(SRC_DIR, 'core', 'chat-message-extractor.js');
  const extractorText = readText(extractorFile);
  if (!extractorText.includes('ChatMessageExtractor')) {
    failures.push('core/chat-message-extractor.js missing ChatMessageExtractor module');
  }
  if (!extractorText.includes('function isThinkingUiNoiseLine')) {
    failures.push('core/chat-message-extractor.js missing isThinkingUiNoiseLine');
  }

  if (archiveResult.archived) {
    if (!archiveResult.archivePath || !fs.existsSync(archiveResult.archivePath)) {
      failures.push('archive file missing after move');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[CHAT_MESSAGE_CACHE_ARCHIVE][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[CHAT_MESSAGE_CACHE_ARCHIVE][VERIFY_FAILED] count=${failures.length}`);
  }

  console.log('[CHAT_MESSAGE_CACHE_ARCHIVE][VERIFY_OK]', {
    archived: archiveResult.archived,
    archivePath: archiveResult.archivePath || '-',
  });
}

function main() {
  console.log(`[CHAT_MESSAGE_CACHE_ARCHIVE][START] root=${ROOT_DIR}`);
  const removedCount = removeFromBuildOrder();
  const archiveResult = archiveActiveFile();
  verifyResult(archiveResult);
  console.log('[CHAT_MESSAGE_CACHE_ARCHIVE][DONE]', {
    removedCount,
    archived: archiveResult.archived,
  });
}

try {
  main();
} catch (error) {
  console.error('[CHAT_MESSAGE_CACHE_ARCHIVE][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
