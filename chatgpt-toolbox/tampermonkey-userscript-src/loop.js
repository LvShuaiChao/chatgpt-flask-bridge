    async function toggleCopyHotkeyContinueLoop(source = 'button') {
      const btn = rootElRef ? qs(UploadSelectors.copyHotkeyContinueLoopBtn, rootElRef) : null;
      if (copyHotkeyContinueLoopRunning) {
        copyHotkeyContinueLoopStopRequested = true;
        setStatus('正在停止连续复制+快捷键+继续...', 'warn');
        ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE_LOOP][stop-requested]');
        if (btn) {
          btn.textContent = '停止中...';
          btn.disabled = true;
        }
        return true;
      }
      copyHotkeyContinueLoopRunning = true;
      copyHotkeyContinueLoopStopRequested = false;
      copyHotkeyContinueLoopCount = 0;
      copyHotkeyContinueLoopStartedAt = Date.now();
      if (btn) {
        btn.dataset.running = '1';
        btn.textContent = '停止连续';
      }
      setStatus('连续复制+快捷键+继续已启动', 'running');
      renderUploadButtonsOnly();
      safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][start] source=${String(source || '-')}`);
      let loopStopReason = 'natural-end';
      try {
        while (!copyHotkeyContinueLoopStopRequested) {
          copyHotkeyContinueLoopCount += 1;
          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][cycle-start] index=${copyHotkeyContinueLoopCount}`,
          );
          const result = await copyHotkeyAndContinueOnce(`loop-${copyHotkeyContinueLoopCount}`);

          if (!result || result.ok === false) {
            const reason = result && result.reason ? result.reason : 'once-failed';
            const detail = result && result.detail ? result.detail : '';

            loopStopReason = `cycle-stop:${reason}`;

            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][cycle-stop] reason=${reason} detail=${detail || '-'} index=${copyHotkeyContinueLoopCount}`,
            );

            console.warn('[COPY_HOTKEY_CONTINUE_LOOP][CYCLE_STOP]', {
              reason,
              detail,
              index: copyHotkeyContinueLoopCount,
              result,
            });

            break;
          }

          if (copyHotkeyContinueLoopStopRequested) {
            loopStopReason = 'user-stop';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][cycle-stop] reason=user-stop index=${copyHotkeyContinueLoopCount}`,
            );
            break;
          }

          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][before-wait-next] index=${copyHotkeyContinueLoopCount} key=${result.assistantMessageKey || '-'} reason=${result.continueReason || '-'}`,
          );

          const waited = await waitAssistantCycleAfterContinue(
            `loop-${copyHotkeyContinueLoopCount}`,
            result.assistantMessageKey || '',
          );
          if (!waited) {
            loopStopReason = copyHotkeyContinueLoopStopRequested
              ? 'user-stop'
              : 'wait-next-reply-failed';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyContinueLoopCount}`,
            );
            if (loopStopReason === 'wait-next-reply-failed') {
              console.warn('[COPY_HOTKEY_CONTINUE_LOOP][WAIT_NEXT_FAILED]', {
                index: copyHotkeyContinueLoopCount,
                previousKey: result.assistantMessageKey || '',
              });
            }
            break;
          }
        }
      } catch (error) {
        const errText = formatToolboxError(error);
        loopStopReason = `exception:${errText}`;
        console.error('[COPY_HOTKEY_CONTINUE_LOOP][FAILED]', {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][failed] error=${errText}`);
        setStatus(`连续复制+快捷键+继续失败：${errText}`, 'error');
      } finally {
        const stoppedByUser = copyHotkeyContinueLoopStopRequested;
        copyHotkeyContinueLoopRunning = false;
        copyHotkeyContinueLoopStopRequested = false;
        if (btn) {
          btn.dataset.running = '0';
        }
        if (stoppedByUser && loopStopReason === 'natural-end') {
          loopStopReason = 'user-stop';
        }
        setStatus(
          stoppedByUser
            ? `连续复制+快捷键+继续已停止，共执行 ${copyHotkeyContinueLoopCount} 轮`
            : `连续复制+快捷键+继续已结束，共执行 ${copyHotkeyContinueLoopCount} 轮`,
          stoppedByUser ? 'warn' : 'success',
        );
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][finally] reason=${loopStopReason}`);
        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][done] cycles=${copyHotkeyContinueLoopCount} stoppedByUser=${stoppedByUser ? '1' : '0'} reason=${loopStopReason}`,
        );
        renderUploadButtonsOnly();
      }
      return true;
    }

