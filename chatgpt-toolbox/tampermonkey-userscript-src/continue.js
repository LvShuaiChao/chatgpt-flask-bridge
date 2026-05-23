    async function copyHotkeyAndContinueOnce(source = 'button') {
      const sourceText = String(source || '');
      const isLoopMode = sourceText.startsWith('loop-') || copyHotkeyContinueLoopRunning === true;
      const btn = rootElRef ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef) : null;
      if (copyHotkeyContinueTaskRunning) {
        const runningMs = Date.now() - Number(copyHotkeyContinueTaskStartedAt || 0);
        if (runningMs <= 90000) {
          if (isLoopMode) {
            ToolboxShell.appendLog(
              `[COPY_HOTKEY_CONTINUE][loop-force-release] runningMs=${runningMs} source=${sourceText}`,
            );
            copyHotkeyContinueTaskRunning = false;
            copyHotkeyContinueTaskStartedAt = 0;
          } else {
            ToolboxShell.appendLog(
              `[COPY_HOTKEY_CONTINUE][skip] reason=task-running runningMs=${runningMs}`,
            );
            return {
              ok: false,
              reason: 'task-running',
              source: sourceText,
              loopMode: isLoopMode,
            };
          }
        } else {
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][stale-release] runningMs=${runningMs}`,
          );
          copyHotkeyContinueTaskRunning = false;
          copyHotkeyContinueTaskStartedAt = 0;
        }
      }
      copyHotkeyContinueTaskRunning = true;
      copyHotkeyContinueTaskStartedAt = Date.now();
      try {
        if (btn && !isLoopMode) {
          btn.dataset.busy = '1';
          btn.disabled = true;
          btn.textContent = '等待回复...';
        }
        if (!isLoopMode) {
          setStatus('正在等待回答完成，然后复制并发送快捷键', 'running');
        }
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE][start] source=${sourceText || '-'}`,
        );

        logCopyHotkeyContinueStep(sourceText, 'wait-reply');
        const waitResult = await waitAssistantStableForCopyContinue(source);
        if (!waitResult || !waitResult.ok) {
          const reason = waitResult && waitResult.reason ? waitResult.reason : 'wait-assistant-failed';
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][abort] reason=${reason}`,
          );
          if (!isLoopMode) {
            setStatus(`复制+快捷键+继续失败：${reason}`, 'warn');
          }
          return {
            ok: false,
            reason: reason || 'wait-assistant-failed',
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        if (!waitResult.text || !String(waitResult.text).trim()) {
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][abort] reason=empty-assistant-text');
          if (!isLoopMode) {
            setStatus('复制+快捷键+继续失败：最后回复为空', 'warn');
          }
          return {
            ok: false,
            reason: 'empty-assistant-text',
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        const assistantMessageKey = buildAssistantMessageKeyFromRecord(
          waitResult.record,
          waitResult.text,
        ) || getLastAssistantMessageKeySafe();

        logCopyHotkeyContinueStep(sourceText, 'copy-last-reply');
        if (btn && !isLoopMode) {
          btn.textContent = '复制中...';
        }
        if (typeof copyTextToClipboard !== 'function') {
          if (!isLoopMode) {
            setStatus('复制失败：剪贴板 API 不可用', 'error');
          }
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][abort] reason=copyTextToClipboard-missing');
          return {
            ok: false,
            reason: 'copyTextToClipboard-missing',
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        try {
          await copyTextToClipboard(waitResult.text);
        } catch (copyError) {
          const errText = formatToolboxError(copyError);
          console.error('[COPY_HOTKEY_CONTINUE][COPY_FAILED]', {
            source: sourceText,
            loopMode: isLoopMode,
            error_type: copyError && copyError.name,
            error: errText,
            stack: copyError && copyError.stack,
          });
          ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][failed] reason=copy-failed detail=${errText}`);
          if (!isLoopMode) {
            setStatus(`复制+快捷键+继续失败：${errText}`, 'error');
          }
          return {
            ok: false,
            reason: 'copy-failed',
            detail: errText,
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE][copied] chars=${String(waitResult.text || '').length}`,
        );
        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(sourceText || '-', 'copyHotkeyContinue');
        }

        logCopyHotkeyContinueStep(sourceText, 'send-hotkey');
        if (btn && !isLoopMode) {
          btn.textContent = '发送快捷键...';
        }
        const hotkeyOk = await triggerSendHotkeyOnce();
        if (!hotkeyOk) {
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][failed] reason=hotkey-failed');
          if (!isLoopMode) {
            setStatus('复制成功，但 Ctrl+Alt+I 执行失败', 'error');
          }
          return {
            ok: false,
            reason: 'hotkey-failed',
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        await sleep(300);

        logCopyHotkeyContinueStep(sourceText, 'send-continue');
        if (btn && !isLoopMode) {
          btn.textContent = '发送继续...';
        }
        const continueSource = isLoopMode ? sourceText : 'copy-hotkey-continue-once';
        const continueResult = await sendContinueMessageOnly(continueSource);
        if (!continueResult || !continueResult.ok) {
          const detail = continueResult && continueResult.reason ? continueResult.reason : '';
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][failed] reason=continue-send-failed detail=${detail || '-'}`,
          );
          if (!isLoopMode) {
            setStatus('复制和快捷键已完成，但发送"继续"失败', 'error');
          }
          return {
            ok: false,
            reason: 'continue-send-failed',
            detail,
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][done] copied=1 hotkey=1 continue=1');
        if (!isLoopMode) {
          setStatus('已复制最后回复，已发送 Ctrl+Alt+I，并发送继续', 'success');
          if (btn) {
            setButtonTemporaryOk(btn);
          }
        }
        return {
          ok: true,
          source: sourceText,
          loopMode: isLoopMode,
          copied_text: String(waitResult.text || ''),
          assistantMessageKey,
          continueSent: true,
          continueReason: continueResult && continueResult.reason ? continueResult.reason : '',
          hotkeySent: true,
          copied: true,
        };
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[COPY_HOTKEY_CONTINUE][ERROR]', {
          source: sourceText,
          loopMode: isLoopMode,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][failed] source=${sourceText} error=${errText}`);
        if (!isLoopMode) {
          setStatus(`复制+快捷键+继续失败：${errText}`, 'error');
          if (btn) {
            setButtonTemporaryError(btn, '执行失败', 1200);
          }
        }
        return {
          ok: false,
          reason: 'exception',
          detail: errText,
          source: sourceText,
          loopMode: isLoopMode,
        };
      } finally {
        copyHotkeyContinueTaskRunning = false;
        copyHotkeyContinueTaskStartedAt = 0;

        if (!isLoopMode) {
          if (btn) {
            btn.dataset.busy = '0';
            btn.disabled = false;
            btn.textContent = '复制+快捷键+继续';
          }
          renderUploadButtonsOnly();
        } else {
          safeAppendLog(`[COPY_HOTKEY_CONTINUE][KEEP_LOOP_STATE] source=${sourceText}`);
          console.warn('[COPY_HOTKEY_CONTINUE][KEEP_LOOP_STATE]', {
            source: sourceText,
            running: copyHotkeyContinueLoopRunning,
          });
        }
      }
    }

    async function waitAssistantCycleAfterContinue(source, previousKey) {
      const sourceText = String(source || '');
      const prevKey = String(previousKey || '');
      const startedAt = Date.now();
      const maxWaitMs = 180000;
      let sawBusy = false;

      safeAppendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-start] source=${sourceText} previousKey=${prevKey || '-'}`,
      );

      while (Date.now() - startedAt < maxWaitMs) {
        if (copyHotkeyContinueLoopStopRequested) {
          safeAppendLog('[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-stop-requested]');
          return false;
        }

        let busy = false;

        try {
          busy = (
            typeof ComposerApi !== 'undefined'
            && ComposerApi
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy()
          );
        } catch (error) {
          console.error('[COPY_HOTKEY_CONTINUE_LOOP][busy-check-failed]', {
            source: sourceText,
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          busy = false;
        }

        if (busy) {
          sawBusy = true;
        }

        const nextKey = getLastAssistantMessageKeySafe();

        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-poll] previousKey=${prevKey || '-'} nextKey=${nextKey || '-'} same=${nextKey && nextKey === prevKey ? '1' : '0'} busy=${busy ? '1' : '0'} sawBusy=${sawBusy ? '1' : '0'}`,
        );

        if (nextKey && prevKey && nextKey !== prevKey && !busy) {
          await sleep(600);
          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-done-by-poll] previousKey=${prevKey} nextKey=${nextKey}`,
          );
          return true;
        }

        if (sawBusy && !busy) {
          await sleep(800);
          const keyAfterIdle = getLastAssistantMessageKeySafe();
          if (!prevKey || keyAfterIdle !== prevKey) {
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-done] previousKey=${prevKey || '-'} nextKey=${keyAfterIdle || '-'}`,
            );
            return true;
          }
        }

        await sleep(1500);
      }

      safeAppendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-timeout] source=${sourceText} previousKey=${prevKey || '-'} maxWaitMs=${maxWaitMs}`,
      );
      setStatus('连续复制+快捷键+继续：等待下一轮回答超时', 'warn');
      return false;
    }

