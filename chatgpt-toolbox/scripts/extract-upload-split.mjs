/**
 * Generate Phase 2 upload split files from upload-module.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODULE_PATH = path.join(ROOT, 'tampermonkey-userscript-src/upload/upload-module.js');
const OUT_DIR = path.join(ROOT, 'tampermonkey-userscript-src/upload');
const src = fs.readFileSync(MODULE_PATH, 'utf8');

function findFunctionBodyStart(source, fnIndex) {
  let i = fnIndex;
  let parenDepth = 0;
  let inBody = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
    } else if (ch === '{' && parenDepth === 0) {
      return i;
    }
    i += 1;
  }
  return -1;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let i = openIndex;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inSingle) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === "'") {
        inSingle = false;
      }
      i += 1;
      continue;
    }
    if (inDouble) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      i += 1;
      continue;
    }
    if (inTemplate) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '`') {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i += 1;
      continue;
    }

    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

function extractFunction(source, name) {
  const re = new RegExp(`\\n    (async )?function ${name}\\s*\\(`);
  const match = re.exec(source);
  if (!match) return null;
  const fnStart = match.index + 1;
  const bodyOpen = findFunctionBodyStart(source, fnStart);
  if (bodyOpen < 0) return null;
  const bodyClose = findMatchingBrace(source, bodyOpen);
  if (bodyClose < 0) return null;
  return {
    text: source.slice(fnStart, bodyClose + 1),
    async: !!match[1],
  };
}

const SPLIT_CONFIG = {
  'upload-queue-store.js': {
    constName: 'UploadQueueStore',
    header: 'UploadQueueStore：上传队列状态（不含 UI / 上传执行）',
    functions: [
      'sanitizePersistedUploadRows',
      'getActiveGroupId',
      'getLocalUploadFileCount',
      'getActiveGroupFiles',
      'getCurrentGroupUploadNameSet',
      'getUploadItemGroupId',
      'normalizeUploadRegistryStatus',
      'normalizeUploadAttachState',
      'normalizeUploadComposerPresence',
      'normalizeUploadSendState',
      'applyUnifiedUploadAliases',
      'syncUploadItemSchemaInPlace',
      'normalizeUploadItem',
      'getUploadGroupById',
      'getActiveUploadScopeGroupId',
      'isUploadItemInActiveScope',
      'getScopedQueueItemsForUpload',
      'getScopedFlaskFilesForUpload',
      'hasActiveScopeUploadableFiles',
      'getSelectedFileIdForActiveGroup',
      'setSelectedFileIdForActiveGroup',
      'resolveSelectedFileIdForGroup',
      'syncActiveGroupSelectionAfterQueueLoad',
      'saveMultiUploadSelectionForActiveGroup',
    ],
  },
};

for (const [fileName, cfg] of Object.entries(SPLIT_CONFIG)) {
  const parts = [];
  const missing = [];
  for (const fn of cfg.functions) {
    const extracted = extractFunction(src, fn);
    if (!extracted) {
      missing.push(fn);
      continue;
    }
    parts.push(extracted.text);
  }
  console.log(`${fileName}: ${parts.length}/${cfg.functions.length} extracted`, missing.length ? `(missing: ${missing.join(', ')})` : '');
  if (parts.length) {
    const fnNames = cfg.functions.filter((n) => !missing.includes(n));
    const returnObj = fnNames.map((n) => `      ${n},`).join('\n');
    const body = parts.join('\n\n');
    const content = `  /********************************************************************
   * ${cfg.header}
   ********************************************************************/

  const ${cfg.constName} = (() => {
    function create(deps) {
      const {
        state,
        log,
        appendUploadLog,
        appendUploadSchemaAuditLog,
        isUploadDebugEnabled,
        normalizeUploadCompareName,
        resolveUploadAttachmentPresenceLevel,
        findUploadGroupById,
        getActiveGroup,
        getUploadGroupStableKey,
        getUploadFileFolderKey,
        saveMultiUploadLastSelection,
        getMultiUploadLastSelection,
        logMultiUploadLastSelectionEvent,
        isFlaskLocalDirectItem,
        isFlaskUploadGroupId,
        hasReusableUploadSourceForReset,
        hasAttemptableUploadSource,
        newId,
        logDirtyRestoreEntry,
        getRestoreDirtyValueText,
        setLastRestoreWarning,
        isPlainObject,
        normalizeRestoreArray,
      } = deps;

${body}

      return {
${returnObj}
      };
    }

    return { create };
  })();
`;
    // fs.writeFileSync(path.join(OUT_DIR, fileName), content, 'utf8');
    const totalLines = content.split('\n').length;
    console.log(`  would write ${totalLines} lines`);
  }
}
