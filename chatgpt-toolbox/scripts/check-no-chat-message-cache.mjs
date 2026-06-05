import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOLBOX_DIR = path.join(ROOT_DIR, '..');
const SRC_DIR = path.join(TOOLBOX_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const ACTIVE_FILE = path.join(SRC_DIR, 'core', 'chat-message-cache.js');
const BUILD_ORDER_PART = 'core/chat-message-cache.js';

function main() {
  const failures = [];

  if (fs.existsSync(ACTIVE_FILE)) {
    failures.push('active pseudo-module still exists at tampermonkey-userscript-src/core/chat-message-cache.js');
  }

  if (!fs.existsSync(BUILD_ORDER_FILE)) {
    failures.push('.build-order.json missing');
  } else {
    const config = JSON.parse(fs.readFileSync(BUILD_ORDER_FILE, 'utf8').replace(/^\uFEFF/, ''));
    const parts = Array.isArray(config.parts) ? config.parts : [];
    if (parts.includes(BUILD_ORDER_PART)) {
      failures.push('.build-order.json still lists core/chat-message-cache.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[CHECK_NO_CHAT_MESSAGE_CACHE][FAILED] ${item}`);
    });
    process.exit(1);
  }

  console.log('[CHECK_NO_CHAT_MESSAGE_CACHE][OK]');
}

main();
