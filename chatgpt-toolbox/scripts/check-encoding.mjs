import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const TARGETS = [
  path.join(ROOT, 'tampermonkey-userscript-src'),
  path.join(ROOT, 'build.userjs.mjs'),
  path.join(ROOT, 'dist', 'client.user.js'),
  path.join(ROOT, '..', 'client.user.js'),
  path.join(ROOT, '..', 'app'),
  path.join(ROOT, '..', 'GUI.py'),
];

const BAD_LITERAL_MARKERS = [
  '\uFFFD',
  '锟斤拷',
  'ï¿½',
  '[QUESTION_PLACEHOLDER]',
];

const MOJIBAKE_FRAGMENTS = [
  'Ã',
  'Â',
  'å',
  'ä',
  'æ',
  'ç',
  'è',
  'é',
  'ã',
];

const BAD_QUESTION_MARK_RE = /\?{3,}/;

function isAllowedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.md' || ext === '.py' || ext === '.json') return true;
  return false;
}

function isBinaryLike(buffer) {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function listFiles(targetPath) {
  if (!fs.existsSync(targetPath)) return [];

  const st = fs.statSync(targetPath);
  if (st.isFile()) return [targetPath];

  const out = [];
  const stack = [targetPath];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        out.push(full);
        stack.push(full);
        continue;
      }
      if (ent.isFile()) out.push(full);
    }
  }

  return out;
}

function findControlChar(text) {
  let line = 1;
  let column = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '\n') {
      line += 1;
      column = 0;
      continue;
    }

    column += 1;
    const code = ch.codePointAt(0);

    if (code === 0x09 || code === 0x0d) continue; // \t \r allowed
    if (code < 0x20 || code === 0x7f) {
      return { index: i, line, column, code, ch };
    }
  }

  return null;
}

function findMarker(text) {
  for (const m of BAD_LITERAL_MARKERS) {
    const idx = text.indexOf(m);
    if (idx !== -1) return { type: 'marker', marker: m, index: idx };
  }
  for (const m of MOJIBAKE_FRAGMENTS) {
    const idx = text.indexOf(m);
    if (idx !== -1) return { type: 'mojibake_fragment', marker: m, index: idx };
  }
  return null;
}

function toLineColumn(text, index) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, column: col };
}

function snippet(text, index, radius = 40) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end);
}

function fail(filePath, line, column, charCode, snip) {
  console.error(
    [
      '[ENCODING][BAD_CHAR]',
      'file=' + filePath,
      'line=' + line,
      'column=' + column,
      'char_code=' + charCode,
      'snippet=' + JSON.stringify(snip),
    ].join(' '),
  );
  process.exitCode = 1;
}

function failText(filePath, index, reason, snip) {
  const lc = toLineColumn(snip.fullText, index);
  console.error(
    [
      reason,
      'file=' + filePath,
      'line=' + lc.line,
      'column=' + lc.column,
      'snippet=' + JSON.stringify(snippet(snip.fullText, index)),
    ].join(' '),
  );
  process.exitCode = 1;
}

function scanJsStringLiterals(text, onHit) {
  // Heuristic scanner (no AST) that walks JS text and extracts:
  // - single quoted strings '...'
  // - double quoted strings "..."
  // - template literal raw chunks `...${...}...`
  //
  // It ignores regex literals and comment bodies; it's fine for catching "????" UI texts.
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;

  function isEscaped(pos) {
    let backslashes = 0;
    for (let k = pos - 1; k >= 0 && text[k] === '\\'; k -= 1) backslashes += 1;
    return backslashes % 2 === 1;
  }

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

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

    if (ch === '\'' || ch === '"') {
      const quote = ch;
      const start = i;
      i += 1;
      let value = '';
      while (i < text.length) {
        const c = text[i];
        if (c === quote && !isEscaped(i)) break;
        value += c;
        i += 1;
      }
      const end = i;
      i += 1; // skip closing quote (or EOF)
      onHit({ type: 'string', start, end, value });
      continue;
    }

    if (ch === '`') {
      const start = i;
      i += 1;
      let chunkStart = i;
      let braceDepth = 0;
      let inExpr = false;

      while (i < text.length) {
        const c = text[i];
        const n = text[i + 1];

        if (!inExpr) {
          if (c === '`' && !isEscaped(i)) {
            const value = text.slice(chunkStart, i);
            onHit({ type: 'template_chunk', start: chunkStart, end: i, value });
            i += 1;
            break;
          }

          if (c === '$' && n === '{' && !isEscaped(i)) {
            const value = text.slice(chunkStart, i);
            onHit({ type: 'template_chunk', start: chunkStart, end: i, value });
            inExpr = true;
            braceDepth = 1;
            i += 2;
            continue;
          }

          i += 1;
          continue;
        }

        // inside ${ ... } expression (skip until it closes, accounting for nested braces)
        if (c === '{') {
          braceDepth += 1;
          i += 1;
          continue;
        }

        if (c === '}') {
          braceDepth -= 1;
          i += 1;
          if (braceDepth <= 0) {
            inExpr = false;
            chunkStart = i;
          }
          continue;
        }

        i += 1;
      }

      // if template not properly closed, we still scanned some content already
      // (the chunks were emitted as we encountered `${` or closing backtick)
      if (i >= text.length) {
        const tail = text.slice(chunkStart);
        onHit({ type: 'template_chunk', start: chunkStart, end: text.length, value: tail });
      }

      // record start to help future improvements (unused for now)
      void start;
      continue;
    }

    i += 1;
  }
}

function checkBadQuestionMarksInJsLiterals(filePath, text) {
  scanJsStringLiterals(text, (lit) => {
    const m = lit.value.match(BAD_QUESTION_MARK_RE);
    if (!m) return;

    // Map to original file index: literal content starts at lit.start (+1 for quotes, already handled by scanner)
    const hitIdxInValue = lit.value.indexOf(m[0]);
    const hitIdx = (lit.start || 0) + hitIdxInValue;

    failText(
      filePath,
      hitIdx,
      '[ENCODING][BAD_QUESTION_MARKS]',
      { fullText: text },
    );
  });
}

function checkFile(filePath) {
  if (!isAllowedFile(filePath)) return;

  const buf = fs.readFileSync(filePath);
  if (isBinaryLike(buf)) return;

  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = buf.toString('utf8');

  if (hasBom) {
    fail(filePath, 1, 1, '0xfeff', snippet(text, 0));
    return;
  }

  const ctrl = findControlChar(text);
  if (ctrl) {
    fail(
      filePath,
      ctrl.line,
      ctrl.column,
      '0x' + ctrl.code.toString(16),
      snippet(text, ctrl.index),
    );
    return;
  }

  const marker = findMarker(text);
  if (marker) {
    if (marker.type === 'marker' && marker.marker === '[QUESTION_PLACEHOLDER]') {
      failText(
        filePath,
        marker.index,
        '[ENCODING][BAD_PLACEHOLDER]',
        { fullText: text },
      );
    } else {
      const lc = toLineColumn(text, marker.index);
      const charCode = marker.type === 'marker'
        ? '0x' + marker.marker.codePointAt(0).toString(16)
        : 'n/a';
      fail(filePath, lc.line, lc.column, charCode, snippet(text, marker.index));
    }
  }

  // Only block consecutive question marks in JS sources (string/template literals).
  // We intentionally do NOT scan full file text to avoid false positives like URL/query params.
  const ext = path.extname(filePath).toLowerCase();
  const normalizedPath = filePath.split(path.sep).join('/');
  const isJsLiteralScanTarget =
    normalizedPath.includes('tampermonkey-userscript-src/')
    || normalizedPath.endsWith('/dist/client.user.js')
    || normalizedPath.endsWith('/client.user.js');
  if (isJsLiteralScanTarget && (ext === '.js' || ext === '.mjs')) {
    checkBadQuestionMarksInJsLiterals(filePath, text);
  }
}

function main() {
  const files = [];
  for (const t of TARGETS) files.push(...listFiles(t));

  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const st = fs.statSync(f);
    if (st.isDirectory()) continue;
    checkFile(f);
  }

  if (process.exitCode && process.exitCode !== 0) return;
  console.log('[ENCODING][OK]');
}

main();

