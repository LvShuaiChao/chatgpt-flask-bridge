  /********************************************************************
   * ClosedLoopWaitVisual：闭环按钮等待/倒计时视觉（factory 注入 state）
   ********************************************************************/
  const ClosedLoopWaitVisual = (() => {
    function create(deps) {
      const safeDeps = deps && typeof deps === 'object' ? deps : {};
      const state = safeDeps.state;
      const log = typeof safeDeps.log === 'function'
        ? safeDeps.log
        : (message) => console.warn(String(message || ''));
      const renderClosedLoopButtons = safeDeps.renderClosedLoopButtons;
      const renderUploadButtonsOnly = safeDeps.renderUploadButtonsOnly;
      const setLoopPhase = safeDeps.setLoopPhase;
      const phases = safeDeps.phases && typeof safeDeps.phases === 'object'
        ? safeDeps.phases
        : {};
      const getOwnerAction = safeDeps.getOwnerAction;

      function getState() {
        if (!state || typeof state !== 'object') {
          log('[CLOSED_LOOP][WAIT_VISUAL_STATE_MISSING]');
          return {};
        }
        return state;
      }

      function toNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
      }

      function positiveMs(value) {
        return Math.max(0, toNumber(value, 0));
      }

      function clearTimer(s) {
        if (s.countdownTickTimer) {
          clearInterval(s.countdownTickTimer);
          s.countdownTickTimer = 0;
        }
      }

      function normalizeReason(reason) {
        return String(reason || 'unknown').trim() || 'unknown';
      }

      function getPhaseName(name, fallback) {
        const value = phases && phases[name] ? phases[name] : fallback;
        return String(value || fallback || '').trim();
      }

      function resolveIdleTextBase() {
        const s = getState();
        const ownerAction = typeof getOwnerAction === 'function'
          ? getOwnerAction()
          : String(s.ownerAction || s.action || 'closed-loop-with-hotkey').trim();
        if (
          typeof ClosedLoopButtonVm !== 'undefined'
          && ClosedLoopButtonVm
          && typeof ClosedLoopButtonVm.getClosedLoopIdleTextByAction === 'function'
        ) {
          return ClosedLoopButtonVm.getClosedLoopIdleTextByAction(
            ownerAction || 'closed-loop-with-hotkey',
            {},
          );
        }
        if (
          typeof UploadButtonVm !== 'undefined'
          && UploadButtonVm
          && typeof UploadButtonVm.getClosedLoopIdleTextByAction === 'function'
        ) {
          return UploadButtonVm.getClosedLoopIdleTextByAction(
            ownerAction || 'closed-loop-with-hotkey',
            {},
          );
        }
        return '停止闭环继续';
      }

      function renderButtons(reason) {
        if (typeof renderClosedLoopButtons === 'function') {
          renderClosedLoopButtons();
        }
        if (reason === 'upload-buttons' && typeof renderUploadButtonsOnly === 'function') {
          renderUploadButtonsOnly({
            immediate: true,
            force: true,
            buttonTasksReason: 'closed-loop-wait-visual',
          });
        }
      }

      function getSnapshot() {
        const s = getState();
        const running = s.running === true;
        const phase = String(s.phase || getPhaseName('IDLE', 'idle')).trim();
        let waitKind = s.waitKind || 'idle';
        const now = Date.now();
        let replyWaitElapsedMs = 0;
        let nextStepRemainingMs = 0;
        let postReplyDelayRemainingMs = 0;

        if (
          running
          && (
            phase === getPhaseName('WAITING_REPLY', 'waiting_reply')
            || phase === getPhaseName('WAIT_REPLY', 'wait_reply')
            || waitKind === 'reply'
          )
        ) {
          const startedAt = positiveMs(s.waitingReplySinceMs || s.waitStartedAt || 0);
          if (startedAt > 0) {
            waitKind = 'reply';
            replyWaitElapsedMs = Math.max(0, now - startedAt);
          }
        }

        const explicitDelayUntilMs = Math.max(
          positiveMs(s.postHotkeyDelayUntilMs),
          positiveMs(s.postReplyDelayUntilMs),
          positiveMs(s.recoverUntilMs),
          positiveMs(s.nextStepCountdownEndAt),
          positiveMs(s.waitUntilMs),
          positiveMs(s.nextStepAt),
          positiveMs(s.delayUntilAt),
        );

        if (
          running
          && (
            phase === getPhaseName('POST_HOTKEY_DELAY', 'post_hotkey_delay')
            || phase === getPhaseName('POST_REPLY_DELAY', 'post_reply_delay')
            || waitKind === 'next-step'
            || waitKind === 'post-hotkey'
            || waitKind === 'post_hotkey'
            || waitKind === 'recover'
          )
          && explicitDelayUntilMs > 0
        ) {
          if (waitKind === 'post_hotkey') {
            waitKind = 'post-hotkey';
          }
          nextStepRemainingMs = Math.max(0, explicitDelayUntilMs - now);
          postReplyDelayRemainingMs = nextStepRemainingMs;
        }

        return {
          running,
          waitKind,
          phase,
          replyWaitElapsedMs,
          nextStepDelayMs: positiveMs(s.nextStepDelayMs),
          nextStepRemainingMs,
          postReplyDelayRemainingMs,
          waitUntilMs: positiveMs(s.waitUntilMs),
          nextStepAt: positiveMs(s.nextStepAt),
          delayUntilAt: positiveMs(s.delayUntilAt),
          postHotkeyDelayUntilMs: positiveMs(s.postHotkeyDelayUntilMs),
          postReplyDelayUntilMs: positiveMs(s.postReplyDelayUntilMs),
          recoverUntilMs: positiveMs(s.recoverUntilMs),
        };
      }

      function startCountdownTick(reason = 'closed-loop-button-countdown') {
        const s = getState();
        clearTimer(s);
        const tickReason = normalizeReason(reason);
        s.countdownTickTimer = setInterval(() => {
          const current = getState();
          if (current.running !== true) {
            clearTimer(current);
            return;
          }
          const phase = String(current.phase || getPhaseName('IDLE', 'idle')).trim();
          const active = current.waitKind === 'reply'
            || current.waitKind === 'next-step'
            || current.waitKind === 'post-hotkey'
            || current.waitKind === 'post_hotkey'
            || current.waitKind === 'recover'
            || phase === getPhaseName('WAITING_REPLY', 'waiting_reply')
            || phase === getPhaseName('POST_HOTKEY_DELAY', 'post_hotkey_delay')
            || phase === getPhaseName('POST_REPLY_DELAY', 'post_reply_delay');
          if (!active) {
            clearTimer(current);
            return;
          }
          const snapshot = getSnapshot();
          const idleBase = resolveIdleTextBase();
          if (
            snapshot.waitKind === 'next-step'
            || snapshot.waitKind === 'post-hotkey'
            || snapshot.waitKind === 'post_hotkey'
            || snapshot.waitKind === 'recover'
            || phase === getPhaseName('POST_HOTKEY_DELAY', 'post_hotkey_delay')
            || phase === getPhaseName('POST_REPLY_DELAY', 'post_reply_delay')
          ) {
            const remainingMs = Math.max(
              0,
              snapshot.nextStepRemainingMs || snapshot.postReplyDelayRemainingMs || 0,
            );
            const secText = (remainingMs / 1000).toFixed(1);
            log(
              `[CLOSED_LOOP][WAIT_VISUAL_COUNTDOWN_TICK] remainingMs=${remainingMs} runId=${current.runId || '-'} round=${current.round || 0} reason=${tickReason}`,
            );
            log(`${idleBase}（等待下一轮 ${secText}s）`);
          } else if (snapshot.waitKind === 'reply') {
            const sec = Math.floor(Math.max(0, snapshot.replyWaitElapsedMs || 0) / 1000);
            if (sec !== current.lastReplyWaitLogSec) {
              current.lastReplyWaitLogSec = sec;
              log(`${idleBase}（回复中 ${sec}s）`);
            }
          }
          renderButtons('closed-loop-buttons');
        }, 500);
      }

      function beginReplyWait(reason = 'unknown') {
        const s = getState();
        if (s.running !== true) {
          return;
        }
        const src = normalizeReason(reason);
        const startedAt = Date.now();
        s.phase = getPhaseName('WAITING_REPLY', 'waiting_reply');
        s.waitKind = 'reply';
        s.waitStartedAt = startedAt;
        s.waitingReplySinceMs = startedAt;
        s.nextStepDelayMs = 0;
        s.nextStepCountdownEndAt = 0;
        s.postHotkeyDelayUntilMs = 0;
        s.postReplyDelayUntilMs = 0;
        s.waitUntilMs = 0;
        s.nextStepAt = 0;
        s.delayUntilAt = 0;
        log(
          `[CLOSED_LOOP][WAIT_VISUAL_REPLY_START] reason=${src} runId=${s.runId || '-'} round=${s.round || 0}`,
        );
        startCountdownTick(`reply-${src}`);
        renderButtons('closed-loop-buttons');
      }

      function endReplyWait(reason = 'unknown') {
        const s = getState();
        if (s.waitKind !== 'reply') {
          return;
        }
        const src = normalizeReason(reason);
        clearTimer(s);
        s.waitKind = 'idle';
        s.waitStartedAt = 0;
        s.waitingReplySinceMs = 0;
        s.lastReplyWaitLogSec = -1;
        log(
          `[CLOSED_LOOP][REPLY_WAIT_END] reason=${src} runId=${s.runId || '-'} round=${s.round || 0}`,
        );
        renderButtons('closed-loop-buttons');
      }

      function endNextStepWait(reason = 'unknown') {
        const s = getState();
        if (
          s.waitKind !== 'next-step'
          && s.waitKind !== 'post-hotkey'
          && s.waitKind !== 'post_hotkey'
          && s.waitKind !== 'recover'
        ) {
          return;
        }
        const src = normalizeReason(reason);
        const runId = s.runId || '-';
        const round = s.round || 0;
        log(
          `[CLOSED_LOOP][WAIT_VISUAL_COUNTDOWN_END] runId=${runId} round=${round} reason=${src}`,
        );
        clearTimer(s);
        s.waitKind = 'idle';
        s.waitStartedAt = 0;
        s.nextStepDelayMs = 0;
        s.nextStepCountdownEndAt = 0;
        s.postHotkeyDelayUntilMs = 0;
        s.postReplyDelayUntilMs = 0;
        s.waitUntilMs = 0;
        s.nextStepAt = 0;
        s.delayUntilAt = 0;
        s.recoverReason = '';
        s.recoverDelayMs = 0;
        s.recoverStartedAtMs = 0;
        s.recoverUntilMs = 0;
        renderButtons('closed-loop-buttons');
      }

      function clearWaitState(reason = 'unknown') {
        const s = getState();
        const src = normalizeReason(reason);
        if (
          s.waitKind === 'next-step'
          || s.waitKind === 'post-hotkey'
          || s.waitKind === 'post_hotkey'
          || s.waitKind === 'recover'
        ) {
          endNextStepWait(`clear:${src}`);
          return;
        }
        clearTimer(s);
        s.waitKind = 'idle';
        s.waitStartedAt = 0;
        s.waitingReplySinceMs = 0;
        s.recoverReason = '';
        s.recoverDelayMs = 0;
        s.recoverStartedAtMs = 0;
        s.recoverUntilMs = 0;
        s.nextStepDelayMs = 0;
        s.nextStepCountdownEndAt = 0;
        s.postHotkeyDelayUntilMs = 0;
        s.postReplyDelayUntilMs = 0;
        s.waitUntilMs = 0;
        s.nextStepAt = 0;
        s.delayUntilAt = 0;
        s.lastReplyWaitLogSec = -1;
        renderButtons('closed-loop-buttons');
      }

      function beginNextStepWait(delayMs, reason = 'unknown') {
        const s = getState();
        if (s.running !== true) {
          return;
        }
        const src = normalizeReason(reason);
        const waitMs = Math.max(0, toNumber(delayMs, 0));
        const runId = s.runId || '-';
        const round = s.round || 0;
        const waitUntilMs = Date.now() + waitMs;
        s.waitKind = 'post-hotkey';
        s.phase = getPhaseName('POST_HOTKEY_DELAY', 'post_hotkey_delay');
        s.waitStartedAt = Date.now();
        s.nextStepDelayMs = waitMs;
        s.nextStepCountdownEndAt = waitUntilMs;
        s.postHotkeyDelayUntilMs = waitUntilMs;
        s.postReplyDelayUntilMs = waitUntilMs;
        s.waitUntilMs = waitUntilMs;
        s.nextStepAt = waitUntilMs;
        s.delayUntilAt = waitUntilMs;
        if (typeof setLoopPhase === 'function') {
          setLoopPhase('post_hotkey_delay', `next-step:${src}`, {
            cycleIndex: round,
            currentSubtask: 'post-hotkey-delay',
          });
        }
        log(
          `[CLOSED_LOOP][WAIT_VISUAL_COUNTDOWN_START] delayMs=${waitMs} runId=${runId} round=${round} reason=${src}`,
        );
        const initialSec = (waitMs / 1000).toFixed(1);
        const idleBase = resolveIdleTextBase();
        log(`${idleBase}（等待下一轮 ${initialSec}s）`);
        startCountdownTick(`next-step-${src}`);
        renderButtons('closed-loop-buttons');
        if (typeof renderUploadButtonsOnly === 'function') {
          renderUploadButtonsOnly({
            immediate: true,
            force: true,
            buttonTasksReason: `post-reply-delay-start:${src}`,
          });
        }
      }

      return {
        getSnapshot,
        clearWaitState,
        startCountdownTick,
        beginReplyWait,
        endReplyWait,
        beginNextStepWait,
        endNextStepWait,
      };
    }

    return { create };
  })();


