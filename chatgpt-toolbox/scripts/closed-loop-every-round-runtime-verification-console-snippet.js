/**
 * Closed-loop every-round runtime verification — paste into DevTools Console on https://chatgpt.com
 *
 * Prerequisites:
 * 1. Tampermonkey enabled with ONLY chatgpt-toolbox/dist/client.user.js (fresh build).
 * 2. Toolbox panel visible; upload tab mounted (#cgpt-upload-module).
 * 3. Closed-loop prerequisites met (bridge/files/queue per your setup).
 * 4. Page idle (not replying) before start.
 *
 * Usage: copy entire file body (from (async function...) through closing })();
 * Paste in Console, Enter. Wait for "=== CLOSED_LOOP_EVERY_ROUND VERIFY DONE ===".
 */
(async function closedLoopEveryRoundRuntimeVerification() {
  const TAG = '[CL_EVERY_ROUND_VERIFY]';
  const BTN_EVERY_ROUND_ID = 'cgpt-closed-loop-upload-every-round-hotkey-btn';
  const BTN_EVERY5_ID = 'cgpt-closed-loop-upload-every5-hotkey-btn';
  const MAX_WAIT_MS = 12 * 60 * 1000;
  const POLL_MS = 1500;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(msg) {
    console.log(`${TAG} ${msg}`);
  }

  function showToolboxLogs() {
    const toggle = document.querySelector('#cgpt-log-toggle');
    if (toggle && toggle.textContent && toggle.textContent.includes('显示')) {
      toggle.click();
    }
  }

  function collectToolboxLogLines() {
    showToolboxLogs();
    return Array.from(document.querySelectorAll('.cgpt-log-line'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
  }

  function filterLines(lines, pattern) {
    const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    return lines.filter((line) => re.test(line));
  }

  function linesSince(lines, startIndex) {
    return lines.slice(Math.max(0, startIndex));
  }

  function countTimestampLines(lines) {
    return lines.filter((line) => /^\[\d{2}:\d{2}:\d{2}\]/.test(line)).length;
  }

  function getButtonRunningSnapshot() {
    const everyRound = document.getElementById(BTN_EVERY_ROUND_ID);
    const every5 = document.getElementById(BTN_EVERY5_ID);
    const isRunning = (btn) => !!(btn && btn.classList && btn.classList.contains('cgpt-action-running'));
    return {
      everyRoundRunning: isRunning(everyRound),
      every5Running: isRunning(every5),
      everyRoundText: everyRound ? (everyRound.textContent || '').trim() : '',
      every5Text: every5 ? (every5.textContent || '').trim() : '',
    };
  }

  async function pollUntil(label, predicate, timeoutMs = MAX_WAIT_MS) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const lines = collectToolboxLogLines();
      if (predicate(lines)) {
        log(`${label} OK elapsed=${Date.now() - started}ms`);
        return { ok: true, lines, elapsedMs: Date.now() - started };
      }
      await sleep(POLL_MS);
    }
    log(`${label} TIMEOUT after ${timeoutMs}ms`);
    return { ok: false, lines: collectToolboxLogLines(), elapsedMs: timeoutMs };
  }

  function clickById(id, label) {
    const btn = document.getElementById(id);
    if (!btn) {
      throw new Error(`Button missing: ${id} (${label})`);
    }
    btn.click();
    return btn;
  }

  function assertToolboxReady() {
    const ver = typeof globalThis.__CGPT_TOOLBOX_VERSION__ !== 'undefined'
      ? globalThis.__CGPT_TOOLBOX_VERSION__
      : (typeof unsafeWindow !== 'undefined' && unsafeWindow.__CGPT_TOOLBOX_VERSION__);
    if (!ver) {
      throw new Error('Toolbox not loaded — install Tampermonkey script and refresh ChatGPT');
    }
    const host = document.querySelector('#cgpt-upload-module');
    if (!host) {
      throw new Error('#cgpt-upload-module missing — open toolbox upload tab');
    }
    return { ver, host };
  }

  const report = {
    at: new Date().toISOString(),
    sections: {},
  };

  try {
    const { ver } = assertToolboxReady();
    log(`toolbox_version=${ver}`);

    const initLines = collectToolboxLogLines();
    report.sections.tampermonkeyLoad = {
      toolboxVersion: ver,
      initLogHits: filterLines(initLines, /\[TOOLBOX\]\[VERSION\]|\[TOOLBOX_BOOT\]|\[TOOLBOX_MODULES\]\[MOUNT/),
      generatedAtNote: 'Compare Tampermonkey editor header "// Generated at:" with build_log artifact',
    };

    const clearBtn = document.querySelector('#cgpt-log-clear');
    if (clearBtn) {
      clearBtn.click();
      await sleep(300);
    } else {
      log('warn: #cgpt-log-clear not found');
    }

    const baseIndex = collectToolboxLogLines().length;

    log('=== STEP: start closed-loop every-round ===');
    clickById(BTN_EVERY_ROUND_ID, 'closed-loop-with-hotkey-upload-every-round');
    await sleep(800);

    const round1Start = await pollUntil(
      'round1_upload_start',
      (lines) => filterLines(lines, /\[CLOSED_LOOP\]\[ROUND_UPLOAD_START\].*round=1.*mode=with_hotkey_every_round/).length > 0,
      3 * 60 * 1000,
    );
    report.sections.round1Upload = {
      pass: round1Start.ok,
      lines: filterLines(round1Start.lines, /\[CLOSED_LOOP\]\[(START|UPLOAD_POLICY_CHECK|ROUND_UPLOAD_START|SHARED_UPLOAD_OPTIONS)\]/),
    };

    log('=== STEP: wait round1 copy+hotkey after reply stable ===');
    const copyHotkey = await pollUntil(
      'round1_copy_hotkey',
      (lines) => {
        const owner = filterLines(
          lines,
          /\[CLOSED_LOOP\]\[COPY_HOTKEY_OWNER_RESOLVED\].*mode=with_hotkey_every_round.*ownerAction=closed-loop-with-hotkey-upload-every-round.*ownerButtonId=cgpt-closed-loop-upload-every-round-hotkey-btn/,
        );
        const core = filterLines(lines, /\[COPY_HOTKEY_ONCE\]\[CORE_STARTED\].*ownerAction=closed-loop-with-hotkey-upload-every-round/);
        const done = filterLines(lines, /\[CLOSED_LOOP\]\[COPY_HOTKEY_ACTION_DONE\]/);
        return owner.length > 0 && core.length > 0 && done.length > 0;
      },
      MAX_WAIT_MS,
    );
    report.sections.round1CopyHotkey = {
      pass: copyHotkey.ok,
      ownerResolved: filterLines(copyHotkey.lines, /\[CLOSED_LOOP\]\[COPY_HOTKEY_OWNER_RESOLVED\]/).slice(-3),
      coreStarted: filterLines(copyHotkey.lines, /\[COPY_HOTKEY_ONCE\]\[CORE_STARTED\]/).slice(-3),
      actionDone: filterLines(copyHotkey.lines, /\[CLOSED_LOOP\]\[COPY_HOTKEY_ACTION_DONE\]/).slice(-3),
      forbidden: filterLines(copyHotkey.lines, /ownerAction=closed-loop-with-hotkey(?:\s|$)|ownerButtonId=cgpt-closed-loop-upload-every5-hotkey-btn/),
    };

    log('=== STEP: wait round2 upload ===');
    const round2Start = await pollUntil(
      'round2_upload_start',
      (lines) => filterLines(lines, /\[CLOSED_LOOP\]\[ROUND_UPLOAD_START\].*round=2.*mode=with_hotkey_every_round/).length > 0,
      MAX_WAIT_MS,
    );
    report.sections.round2Upload = {
      pass: round2Start.ok,
      lines: filterLines(round2Start.lines, /\[CLOSED_LOOP\]\[(UPLOAD_POLICY_CHECK|ROUND_UPLOAD_START|SHARED_UPLOAD_OPTIONS)\].*round=2|round=2.*mode=with_hotkey_every_round/),
    };

    log('=== STEP: stop via same button ===');
    const beforeStop = getButtonRunningSnapshot();
    clickById(BTN_EVERY_ROUND_ID, 'stop-closed-loop-every-round');
    await sleep(1200);

    const stopPoll = await pollUntil(
      'stop_click',
      (lines) => filterLines(lines, /\[CLOSED_LOOP\]\[DOCUMENT_CLICK_AS_STOP_ONLY\].*action=closed-loop-with-hotkey-upload-every-round/).length > 0,
      30 * 1000,
    );
    const afterStop = getButtonRunningSnapshot();
    report.sections.stop = {
      pass: stopPoll.ok,
      stopLines: filterLines(stopPoll.lines, /\[CLOSED_LOOP\]\[DOCUMENT_CLICK_AS_STOP_ONLY\]/).slice(-3),
      beforeStop,
      afterStop,
      bothRunningAfterStop: afterStop.everyRoundRunning && afterStop.every5Running,
      anyRunningAfterStop: afterStop.everyRoundRunning || afterStop.every5Running,
    };

    const harvestAll = linesSince(collectToolboxLogLines(), baseIndex);
    const closedLoopLines = filterLines(harvestAll, /\[CLOSED_LOOP\]|\[COPY_HOTKEY_ONCE\]/);
    const timestampCount = countTimestampLines(harvestAll);

    const summary = {
      tampermonkeyLoad: !!(ver),
      round1Upload: report.sections.round1Upload.pass,
      round1CopyHotkey: report.sections.round1CopyHotkey.pass
        && (report.sections.round1CopyHotkey.forbidden || []).length === 0,
      round2Upload: report.sections.round2Upload.pass,
      stop: report.sections.stop.pass
        && !report.sections.stop.anyRunningAfterStop,
      hasRealTimestampLogs: timestampCount > 0,
      allPass: false,
    };
    summary.allPass = summary.round1Upload
      && summary.round1CopyHotkey
      && summary.round2Upload
      && summary.stop
      && summary.hasRealTimestampLogs;

    const exportText = [
      '# Closed-loop every-round runtime verification',
      '# Generated by closed_loop_every_round_runtime_verify.js',
      '# === CLOSED_LOOP_EVERY_ROUND VERIFY DONE ===',
      '',
      JSON.stringify({ summary, report, harvest: { timestampCount, totalLines: harvestAll.length } }, null, 2),
      '',
      '# --- Tampermonkey load / init ---',
      ...(report.sections.tampermonkeyLoad.initLogHits.length
        ? report.sections.tampermonkeyLoad.initLogHits
        : [`[TOOLBOX][VERSION] ${ver}`, '# (init lines captured at verify start)']),
      '',
      '# --- Round 1 upload ---',
      ...(report.sections.round1Upload.lines.length ? report.sections.round1Upload.lines : ['# (missing)']),
      '',
      '# --- Round 1 copy+hotkey ---',
      ...(report.sections.round1CopyHotkey.ownerResolved || []),
      ...(report.sections.round1CopyHotkey.coreStarted || []),
      ...(report.sections.round1CopyHotkey.actionDone || []),
      '',
      '# --- Round 2 upload ---',
      ...(report.sections.round2Upload.lines.length ? report.sections.round2Upload.lines : ['# (missing)']),
      '',
      '# --- Stop ---',
      ...(report.sections.stop.stopLines.length ? report.sections.stop.stopLines : ['# (missing)']),
      '',
      '# --- Full closed-loop harvest ---',
      ...closedLoopLines,
      '',
      `# timestamp_log_lines=${timestampCount}`,
    ].join('\n');

    console.log('\n=== CLOSED_LOOP_EVERY_ROUND VERIFY DONE ===\n');
    console.log(JSON.stringify({ summary, report }, null, 2));
    console.log('\n=== CLOSED_LOOP_EVERY_ROUND EXPORT TEXT BEGIN ===\n');
    console.log(exportText);
    console.log('\n=== CLOSED_LOOP_EVERY_ROUND EXPORT TEXT END ===\n');

    try {
      if (typeof copy === 'function') {
        copy(exportText);
        console.log('[CL_EVERY_ROUND_VERIFY] copy() invoked');
      }
    } catch (copyErr) {
      console.warn('[CL_EVERY_ROUND_VERIFY] copy() unavailable', copyErr);
    }

    try {
      const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').slice(0, 15);
      a.download = `closed_loop_every_round_runtime_${stamp}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      console.log('[CL_EVERY_ROUND_VERIFY] download triggered');
    } catch (dlErr) {
      console.error('[CL_EVERY_ROUND_VERIFY] download failed', dlErr);
    }

    return { summary, report };
  } catch (err) {
    console.error(`${TAG} FAILED`, err);
    throw err;
  }
})();
