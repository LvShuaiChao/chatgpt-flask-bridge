import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE_NAME = 'chatgpt-toolbox/scripts/check-installed-userscript.mjs';
const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST_FILE = path.join(ROOT_DIR, 'dist', 'client.user.js');

function fail(stage, message, error) {
  console.error(`[CHECK_INSTALLED][FAILED] stage=${stage} module=${MODULE_NAME} message=${message}`);
  if (error && error.message) {
    console.error(`[CHECK_INSTALLED][FAILED_MESSAGE] stage=${stage} module=${MODULE_NAME} error.message=${error.message}`);
  }
  if (error && error.stack) {
    console.error(`[CHECK_INSTALLED][FAILED_STACK] stage=${stage} module=${MODULE_NAME}\n${error.stack}`);
  }
  process.exit(1);
}

function assertCondition(condition, stage, message) {
  if (!condition) {
    fail(stage, message);
  }
}

function runNodeCheck(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const output = [result.stdout || '', result.stderr || ''].join('\n').trim();
    fail('node-check', `node --check failed for ${filePath}\n${output}`);
  }
}

function main() {
  let content = '';
  try {
    assertCondition(fs.existsSync(DIST_FILE), 'exists', `dist userscript not found: ${DIST_FILE}`);
    content = fs.readFileSync(DIST_FILE, 'utf8');
  } catch (error) {
    fail('read-dist', `failed to read dist userscript: ${DIST_FILE}`, error);
  }

  assertCondition(content.includes('// ==UserScript=='), 'userscript-header', 'missing // ==UserScript== header');
  assertCondition(content.includes('[TOOLBOX][BOOT_START]'), 'boot-log-marker', 'missing [TOOLBOX][BOOT_START] marker');
  assertCondition(content.includes('ToolboxShell.create'), 'shell-create-reference', 'missing ToolboxShell.create reference');

  runNodeCheck(DIST_FILE);

  console.log(`[CHECK_INSTALLED][OK] file=${DIST_FILE}`);
  console.log('[CHECK_INSTALLED][OK] node --check passed');
}

main();
