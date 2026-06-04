/**
 * Refactor runtime verification — paste into DevTools Console on https://chatgpt.com
 *
 * Prerequisites:
 * 1. Tampermonkey enabled with ONLY chatgpt-toolbox/dist/client.user.js (fresh build).
 * 2. Toolbox panel visible; upload tab mounted (#cgpt-upload-module).
 * 3. Clear toolbox logs (#cgpt-log-clear) before running.
 * 4. Page state: idle (not replying), bridge optional for upload/closed-loop.
 *
 * Usage: copy entire file body (from (async function...) through closing })();
 * Paste in Console, Enter. Wait for "=== REFACTOR RUNTIME VERIFY DONE ===".
 * Copy printed block into exports/for_chatgpt/refactor_runtime_verification_20260604_runtime.txt
 */
(async function refactorRuntimeVerification() {
  const TAG = '[REFACTOR_VERIFY]';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(msg) {
    console.log(`${TAG} ${msg}`);
  }

  function assertToolboxReady() {
    const ver = typeof globalThis.__CGPT_TOOLBOX_VERSION__ !== 'undefined'
      ? globalThis.__CGPT_TOOLBOX_VERSION__
      : (typeof unsafeWindow !== 'undefined' && unsafeWindow.__CGPT_TOOLBOX_VERSION__);
    if (!ver) {
      throw new Error('Toolbox not loaded — install Tampermonkey script and refresh ChatGPT');
    }
    log(`toolbox_version=${ver}`);
    const host = document.querySelector('#cgpt-upload-module');
    if (!host) {
      throw new Error('#cgpt-upload-module missing — open toolbox upload tab');
    }
    return { ver, host };
  }

  function clearToolboxLogs() {
    const btn = document.querySelector('#cgpt-log-clear');
    if (btn) {
      btn.click();
      return;
    }
    log('warn: #cgpt-log-clear not found — clear logs manually');
  }

  function showToolboxLogs() {
    const toggle = document.querySelector('#cgpt-log-toggle');
    if (toggle && toggle.textContent && toggle.textContent.includes('显示')) {
      toggle.click();
    }
  }

  function collectToolboxLogLines() {
    showToolboxLogs();
    const lines = Array.from(document.querySelectorAll('.cgpt-log-line'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    return lines;
  }

  function filterLines(lines, pattern) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    return lines.filter((line) => re.test(line));
  }

  function linesSince(lines, startIndex) {
    return lines.slice(Math.max(0, startIndex));
  }

  async function setComposerText(text) {
    const selectors = [
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ];
    let el = null;
    for (const sel of selectors) {
      el = document.querySelector(sel);
      if (el) break;
    }
    if (!el) {
      throw new Error('Composer input not found');
    }
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
    await sleep(400);
  }

  function clickById(id, label) {
    const btn = document.getElementById(id);
    if (!btn) {
      throw new Error(`Button missing: ${id} (${label})`);
    }
    if (btn.disabled) {
      log(`warn: ${id} disabled — ${label} may be skipped`);
    }
    btn.click();
    return btn;
  }

  function analyzeSendMessage(lines) {
    const slice = filterLines(lines, /SEND_PIPELINE|UPLOAD\]\[START|UPLOAD\]\[QUEUE_START|SKIP_LOCAL_QUEUE|COPY_PIPELINE|\[HOTKEY\]/);
    const entry = filterLines(lines, /\[SEND_PIPELINE\]\[ENTRY\]/);
    const finish = filterLines(lines, /\[SEND_PIPELINE\]\[FINISH\]/);
    const bad = filterLines(lines, /\[UPLOAD\]\[START\]|\[UPLOAD\]\[QUEUE_START\]|\[UPLOAD\]\[SKIP_LOCAL_QUEUE|\[COPY_PIPELINE\]|\[HOTKEY\]/);
    return {
      pass: entry.length > 0 && finish.length > 0 && bad.length === 0,
      entry: entry.slice(-3),
      finish: finish.slice(-3),
      bad,
      sample: slice.slice(-20),
    };
  }

  function analyzeSendCopyHotkey(lines) {
    const skip = filterLines(lines, /\[UPLOAD\]\[SKIP_LOCAL_QUEUE_FOR_SEND_COPY_HOTKEY\]/);
    const uploadStart = filterLines(lines, /\[UPLOAD\]\[START\]|\[UPLOAD\]\[QUEUE_START\]/);
    const sendEntry = filterLines(lines, /\[SEND_PIPELINE\]\[ENTRY\]/);
    const dup = filterLines(lines, /duplicate|another-send-running|blocked|running/i);
    return {
      pass: skip.length > 0 && uploadStart.length === 0,
      skip: skip.slice(-3),
      uploadStart,
      sendEntry: sendEntry.slice(-5),
      dup: dup.slice(-10),
    };
  }

  function analyzeClosedLoop(lines) {
    const start = filterLines(lines, /\[CLOSED_LOOP\]\[START\]/);
    const dispatch = filterLines(lines, /\[CLOSED_LOOP\]\[DISPATCH\]/);
    const result = filterLines(lines, /\[CLOSED_LOOP\]\[DISPATCH_RESULT\]/);
    const ok1 = result.filter((l) => /ok=1\b/.test(l));
    const ok0 = result.filter((l) => /ok=0\b/.test(l));
    const failed = filterLines(lines, /\[CLOSED_LOOP\]\[DISPATCH_FAILED\]/);
    return { start: start.slice(-3), dispatch: dispatch.slice(-3), result: result.slice(-5), ok1, ok0, failed: failed.slice(-5) };
  }

  function analyzeUpload(lines) {
    const candidate = filterLines(lines, /candidate=1/);
    const uploadFlow = filterLines(lines, /\[UPLOAD\]\[START\]|\[UPLOAD\]\[QUEUE_START\]|\[BRIDGE\]\[UPLOAD\]/);
    return { pass: candidate.length === 0, candidate, uploadFlow: uploadFlow.slice(-15) };
  }

  function analyzeDuplicateClick(lines) {
    const runIds = [];
    const re = /runId=([^\s]+)/g;
    for (const line of filterLines(lines, /SEND_PIPELINE|send-copy-hotkey/i)) {
      let m;
      while ((m = re.exec(line)) !== null) {
        if (m[1] && m[1] !== '-') runIds.push(m[1]);
      }
    }
    const unique = [...new Set(runIds)];
    const dupLog = filterLines(lines, /duplicate|another-send-running|blocked|already-handled|skip/i);
    return { uniqueRunIds: unique, dupLog: dupLog.slice(-15), pass: unique.length <= 1 || dupLog.length > 0 };
  }

  function analyzeEmptyInput(lines) {
    const empty = filterLines(lines, /empty_text|composer_empty|empty_text_and_no_attachment/i);
    return { empty: empty.slice(-10), pass: empty.length > 0 };
  }

  const report = {
    at: new Date().toISOString(),
    sections: {},
  };

  try {
    assertToolboxReady();
    clearToolboxLogs();
    await sleep(300);

    // --- 3. Send message only ---
    log('=== TEST: send-message ===');
    let base = collectToolboxLogLines().length;
    await setComposerText('测试发送消息按钮');
    clickById('cgpt-send-message-once', 'send-message');
    await sleep(2500);
    let lines = linesSince(collectToolboxLogLines(), base);
    report.sections.sendMessage = analyzeSendMessage(lines);

    // --- 4. Send + copy + hotkey ---
    log('=== TEST: send-copy-hotkey ===');
    clearToolboxLogs();
    await sleep(200);
    base = collectToolboxLogLines().length;
    await setComposerText('测试发送复制快捷键按钮');
    clickById('cgpt-send-copy-hotkey-once', 'send-copy-hotkey');
    await sleep(3000);
    lines = linesSince(collectToolboxLogLines(), base);
    report.sections.sendCopyHotkey = analyzeSendCopyHotkey(lines);

    // --- 8. Duplicate click ---
    log('=== TEST: duplicate-click send-copy-hotkey ===');
    clearToolboxLogs();
    await sleep(200);
    base = collectToolboxLogLines().length;
    await setComposerText('测试重复点击');
    const btn = document.getElementById('cgpt-send-copy-hotkey-once');
    if (btn) {
      btn.click();
      await sleep(50);
      btn.click();
    }
    await sleep(2000);
    lines = linesSince(collectToolboxLogLines(), base);
    report.sections.duplicateClick = analyzeDuplicateClick(lines);

    // --- 9a. Empty input ---
    log('=== TEST: empty input send-message ===');
    clearToolboxLogs();
    await sleep(200);
    base = collectToolboxLogLines().length;
    await setComposerText('');
    clickById('cgpt-send-message-once', 'send-message-empty');
    await sleep(1500);
    lines = linesSince(collectToolboxLogLines(), base);
    report.sections.emptyInput = analyzeEmptyInput(lines);

    // --- 5. Closed loop success (manual: ensure queue/files if your setup requires) ---
    log('=== TEST: closed-loop success (click) ===');
    clearToolboxLogs();
    await sleep(200);
    base = collectToolboxLogLines().length;
    const clBtn = document.querySelector('#cgpt-closed-loop-upload-every5-hotkey-btn');
    if (clBtn && !clBtn.disabled) {
      clBtn.click();
      await sleep(4000);
      lines = linesSince(collectToolboxLogLines(), base);
      report.sections.closedLoopSuccess = analyzeClosedLoop(lines);
      if (clBtn.disabled || (report.sections.closedLoopSuccess.start || []).length) {
        log('If loop started, click same button again to stop before fail test');
        await sleep(500);
        if (!clBtn.disabled) clBtn.click();
        await sleep(1000);
      }
    } else {
      report.sections.closedLoopSuccess = { skipped: true, reason: 'button missing or disabled' };
      log('closed-loop button skipped — prepare queue/files or check page state');
    }

    // --- 6. Closed loop fail (mode-not-found) ---
    log('=== TEST: closed-loop fail mode-not-found ===');
    log('Injecting temporary hidden button with invalid closed-loop action');
    clearToolboxLogs();
    await sleep(200);
    base = collectToolboxLogLines().length;
    const host = document.querySelector('#cgpt-upload-module');
    const fake = document.createElement('button');
    fake.type = 'button';
    fake.id = 'cgpt-refactor-verify-fake-closed-loop';
    fake.className = 'cgpt-btn';
    fake.setAttribute('data-action', 'closed-loop-refactor-verify-invalid');
    fake.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    host.appendChild(fake);
    fake.click();
    await sleep(800);
    lines = linesSince(collectToolboxLogLines(), base);
    report.sections.closedLoopFail = {
      lines: filterLines(lines, /CLOSED_LOOP|ACTION_DISPATCH|mode-not-found|DISPATCH_FAILED|DISPATCH_RESULT/).slice(-20),
      note: 'If empty, run fail test manually: Tampermonkey cannot expose dispatchClosedLoopAction to page console. Use ok=0 from real failure or add one-line unsafeWindow hook temporarily.',
    };
    fake.remove();

    // --- 7. Upload button (optional — requires file in queue) ---
    log('=== TEST: upload start (manual queue) ===');
    report.sections.upload = {
      note: 'Click #cgpt-upload-start after adding a file to queue, then re-run collect or copy logs manually',
      preScan: analyzeUpload(collectToolboxLogLines()),
    };

    const summary = {
      sendMessage: report.sections.sendMessage && report.sections.sendMessage.pass,
      sendCopyHotkey: report.sections.sendCopyHotkey && report.sections.sendCopyHotkey.pass,
      duplicateClick: report.sections.duplicateClick && report.sections.duplicateClick.pass,
      emptyInput: report.sections.emptyInput && report.sections.emptyInput.pass,
      closedLoopSuccess: report.sections.closedLoopSuccess
        && (report.sections.closedLoopSuccess.skipped || (report.sections.closedLoopSuccess.ok1 || []).length > 0),
    };

    console.log('\n=== REFACTOR RUNTIME VERIFY DONE ===\n');
    console.log(JSON.stringify({ summary, report }, null, 2));
    console.log('\n--- COPY ABOVE JSON TO refactor_runtime_verification_20260604_runtime.txt ---\n');

    return { summary, report };
  } catch (err) {
    console.error(`${TAG} FAILED`, err);
    throw err;
  }
})();
