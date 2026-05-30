  /********************************************************************
   * ClosedLoopWaitVisual：闭环按钮等待/倒计时视觉（factory 注入 state）
   ********************************************************************/

  const ClosedLoopWaitVisual = (() => {
    function create(deps) {
      const {
        state,
        log,
        renderClosedLoopButtons,
        renderUploadButtonsOnly,
        setLoopPhase,
      } = deps;

      function getSnapshot() {
        const running = state.running === true;
        const waitKind = state.waitKind || 'idle';
        const phase = String(state.phase || 'idle').trim();
        const now = Date.now();

        let replyWaitElapsedMs = 0;
        let nextStepRemainingMs = 0;
        let postReplyDelayRemainingMs = 0;

        if (
          running
          && (
            phase === 'waiting_reply'
            || waitKind === 'reply'
          )
          && state.waitStartedAt > 0
        ) {
          replyWaitElapsedMs = Math.max(0, now - state.waitStartedAt);
        }

        if (
          running
          && (
            phase === 'post_reply_delay'
            || waitKind === 'next-step'
          )
          && state.postReplyDelayUntilMs > 0
        ) {
          postReplyDelayRemainingMs = Math.max(0, state.postReplyDelayUntilMs - now);
        } else if (running && waitKind === 'next-step' && state.nextStepCountdownEndAt > 0) {
          nextStepRemainingMs = Math.max(0, state.nextStepCountdownEndAt - now);
          postReplyDelayRemainingMs = nextStepRemainingMs;
        }

        return {
          running,
          waitKind,
          phase,
          replyWaitElapsedMs,
          nextStepDelayMs: Math.max(0, Number(state.nextStepDelayMs || 0)),
          nextStepRemainingMs,
          postReplyDelayRemainingMs,
          postReplyDelayUntilMs: Math.max(0, Number(state.postReplyDelayUntilMs || 0)),
        };
      }

      function endNextStepWait(reason = 'unknown') {
        if (state.waitKind !== 'next-step') {
          return;
        }
        const src = String(reason || 'unknown').trim() || 'unknown';
        const runId = state.runId || '-';
        const round = state.round || 0;
        log(
          `[CLOSED_LOOP][WAIT_VISUAL_COUNTDOWN_END] runId=${runId} round=${round} reason=${src}`,
        );
        if (state.countdownTickTimer) {
          clearInterval(state.countdownTickTimer);
          state.countdownTickTimer = 0;
        }
        state.waitKind = 'idle';
        state.waitStartedAt = 0;
        state.nextStepDelayMs = 0;
        state.nextStepCountdownEndAt = 0;
        state.postReplyDelayRunning = false;
        state.postReplyDelayUntilMs = 0;
      }

      function endReplyWait(reason = 'unknown') {
        if (state.waitKind !== 'reply') {
          return;
        }
        const src = String(reason || 'unknown').trim() || 'unknown';
        state.waitKind = 'idle';
        state.waitStartedAt = 0;
        log(
          `[CLOSED_LOOP][REPLY_WAIT_END] reason=${src} runId=${state.runId || '-'} round=${state.round || 0}`,
        );
      }

      function clearWaitState(reason = 'unknown') {
        const src = String(reason || 'unknown').trim() || 'unknown';
        if (state.waitKind === 'next-step') {
          endNextStepWait(`clear:${src}`);
          return;
        }
        if (state.countdownTickTimer) {
          clearInterval(state.countdownTickTimer);
          state.countdownTickTimer = 0;
        }
        state.waitKind = 'idle';
        state.waitStartedAt = 0;
        state.nextStepDelayMs = 0;
        state.nextStepCountdownEndAt = 0;
        state.lastReplyWaitLogSec = -1;
        state.postReplyDelayRunning = false;
        state.postReplyDelayUntilMs = 0;
      }

      function startCountdownTick(reason = 'closed-loop-button-countdown') {
        void reason;
        if (state.countdownTickTimer) {
          clearInterval(state.countdownTickTimer);
          state.countdownTickTimer = 0;
        }

        state.countdownTickTimer = setInterval(() => {
          if (state.running !== true) {
            clearInterval(state.countdownTickTimer);
            state.countdownTickTimer = 0;
            return;
          }

          const phase = String(state.phase || 'idle').trim();
          if (
            state.waitKind !== 'reply'
            && state.waitKind !== 'next-step'
            && phase !== 'waiting_reply'
            && phase !== 'post_reply_delay'
          ) {
            clearInterval(state.countdownTickTimer);
            state.countdownTickTimer = 0;
            return;
          }

          if (
            state.waitKind === 'next-step'
            || phase === 'post_reply_delay'
          ) {
            const remainingMs = Math.max(
              0,
              Number(state.postReplyDelayUntilMs || state.nextStepCountdownEndAt || 0) - Date.now(),
            );
            const sec = Math.max(0, Math.ceil(remainingMs / 1000));
            log(
              `[CLOSED_LOOP][WAIT_VISUAL_COUNTDOWN_TICK] remainingMs=${remainingMs} runId=${state.runId || '-'} round=${state.round || 0}`,
            );
            log(
              `停止闭环继续（等待 ${sec}s）`,
            );
          } else if (
            state.waitKind === 'reply'
            || phase === 'waiting_reply'
          ) {
            const elapsedMs = Math.max(
              0,
              Date.now() - Number(state.waitStartedAt || 0),
            );
            const sec = Math.floor(elapsedMs / 1000);
            if (sec !== state.lastReplyWaitLogSec) {
              state.lastReplyWaitLogSec = sec;
              log(`停止闭环继续（回复中 ${sec}s）`);
            }
          }

          if (typeof renderClosedLoopButtons === 'function') {
            renderClosedLoopButtons();
          }
        }, 500);
      }

      function beginReplyWait(reason = 'unknown') {
        if (state.running !== true) {
          return;
        }
        const src = String(reason || 'unknown').trim() || 'unknown';
        state.phase = 'waiting_reply';
        state.waitKind = 'reply';
        state.waitStartedAt = Date.now();
        state.nextStepDelayMs = 0;
        state.nextStepCountdownEndAt = 0;
        log(
          `[CLOSED_LOOP][WAIT_VISUAL_REPLY_START] reason=${src} runId=${state.runId || '-'} round=${state.round || 0}`,
        );
        startCountdownTick(`reply-${src}`);
        if (typeof renderClosedLoopButtons === 'function') {
          renderClosedLoopButtons();
        }
      }

      function beginNextStepWait(delayMs, reason = 'unknown') {
        if (state.running !== true) {
          return;
        }
        const src = String(reason || 'unknown').trim() || 'unknown';
        const waitMs = Math.max(0, Number(delayMs || 0));
        const runId = state.runId || '-';
        const round = state.round || 0;
        state.phase = 'post_reply_delay';
        state.waitKind = 'next-step';
        state.waitStartedAt = Date.now();
        state.nextStepDelayMs = waitMs;
        state.nextStepCountdownEndAt = Date.now() + waitMs;
        state.postReplyDelayRunning = true;
        state.postReplyDelayUntilMs = Date.now() + waitMs;
        if (typeof setLoopPhase === 'function') {
          setLoopPhase('post_reply_delay', `next-step:${src}`, {
            cycleIndex: round,
            currentSubtask: 'post-reply-delay',
          });
        }
        log(
          `[CLOSED_LOOP][WAIT_VISUAL_COUNTDOWN_START] delayMs=${waitMs} runId=${runId} round=${round} reason=${src}`,
        );
        const initialSec = Math.max(0, Math.ceil(waitMs / 1000));
        log(`停止闭环继续（等待 ${initialSec}s）`);
        startCountdownTick(`next-step-${src}`);
        if (typeof renderClosedLoopButtons === 'function') {
          renderClosedLoopButtons();
        }
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
