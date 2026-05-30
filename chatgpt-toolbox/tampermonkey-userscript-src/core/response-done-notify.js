  /********************************************************************
   * ResponseDoneNotifyModule：「回复完成」未读提醒（一次性，可确认清除）
   ********************************************************************/

  const ResponseDoneNotifyModule = (() => {
    let responseDoneNotifyActive = false;
    let responseDoneBlinkTimer = 0;
    let lastUserInteractionAt = 0;
    let acknowledgeEventsBound = false;

    function appendNotifyLog(line) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
        return;
      }
      console.log(line);
    }

    function touchUserInteraction() {
      lastUserInteractionAt = Date.now();
    }

    function hasResponseDoneNotifyTitlePrefix(titleText) {
      const text = String(titleText || '').trim();

      if (!text) {
        return false;
      }

      return (
        /^(?:🔴\s*)?\[回复完成\]\s+/u.test(text)
        || /^(?:🔴\s*)?【回复完成】\s*/u.test(text)
        || /^🔔\s*回复完成\s*[-:：]\s*/u.test(text)
      );
    }

    function getResponseDoneNotifyActiveSource() {
      if (responseDoneNotifyActive) {
        return 'module-state';
      }

      if (responseDoneBlinkTimer) {
        return 'blink-timer';
      }

      if (
        typeof TitlePrefixModule !== 'undefined'
        && typeof TitlePrefixModule.getToolboxTabTitleState === 'function'
      ) {
        const tabState = String(TitlePrefixModule.getToolboxTabTitleState() || '').trim().toLowerCase();
        if (tabState === 'reply_done') {
          return 'title-state';
        }
      }

      if (hasResponseDoneNotifyTitlePrefix(document.title)) {
        return 'title-prefix';
      }

      return '';
    }

    function isNotifyActive() {
      return !!getResponseDoneNotifyActiveSource();
    }

    function stopTitleBlinkTimer() {
      if (responseDoneBlinkTimer) {
        window.clearInterval(responseDoneBlinkTimer);
        responseDoneBlinkTimer = 0;
      }
    }

    function restoreTitleAndFavicon(reason) {
      if (typeof TitlePrefixModule !== 'undefined') {
        if (typeof TitlePrefixModule.stopReplyDoneFlash === 'function') {
          TitlePrefixModule.stopReplyDoneFlash(reason || 'response-done-ack');
        } else if (typeof TitlePrefixModule.setToolboxTabTitleState === 'function') {
          TitlePrefixModule.setToolboxTabTitleState('idle', reason || 'response-done-ack');
        }
      }

      const restoredTitle = String(document.title || '').trim() || '-';
      appendNotifyLog(`[RESPONSE_DONE_NOTIFY][TITLE_RESTORE] title=${restoredTitle}`);
      appendNotifyLog('[RESPONSE_DONE_NOTIFY][FAVICON_RESTORE] ok=1');
    }

    function refreshHeaderStatusAfterAck(reason) {
      const renderReason = `response-done-ack:${reason || '-'}`;
      if (typeof renderToolboxHeaderStatus === 'function') {
        renderToolboxHeaderStatus(`${renderReason}:force`);
      }
      if (typeof refreshToolboxPageStatusDisplay === 'function') {
        refreshToolboxPageStatusDisplay(renderReason);
      }
    }

    function acknowledgeResponseDoneNotification(reason = '-') {
      const reasonText = String(reason || '-').trim() || '-';
      const activeSource = getResponseDoneNotifyActiveSource();
      const active = !!activeSource || !!responseDoneBlinkTimer;

      if (!active) {
        return false;
      }

      responseDoneNotifyActive = false;
      stopTitleBlinkTimer();

      if (typeof ToolboxShell !== 'undefined'
        && typeof ToolboxShell.stopHeaderTitleFlash === 'function') {
        ToolboxShell.stopHeaderTitleFlash(`response-done-ack:${reasonText}`);
      }

      restoreTitleAndFavicon(reasonText);
      refreshHeaderStatusAfterAck(reasonText);

      appendNotifyLog(
        `[RESPONSE_DONE_NOTIFY][ACK] reason=${reasonText} source=${activeSource || '-'} focus=${document.hasFocus() ? 1 : 0} visibility=${document.visibilityState || '-'}`,
      );
      return true;
    }

    function startTitleBlinkIfNeeded(reason) {
      stopTitleBlinkTimer();
      if (typeof TitlePrefixModule === 'undefined') {
        return;
      }
      if (typeof TitlePrefixModule.setToolboxTabTitleState === 'function') {
        TitlePrefixModule.setToolboxTabTitleState('reply_done', reason || 'response-done-notify');
      } else if (typeof TitlePrefixModule.startReplyDoneFlash === 'function') {
        TitlePrefixModule.startReplyDoneFlash(reason || 'response-done-notify');
      }

      let blinkOn = true;
      responseDoneBlinkTimer = window.setInterval(() => {
        if (!responseDoneNotifyActive) {
          stopTitleBlinkTimer();
          return;
        }
        blinkOn = !blinkOn;
        if (typeof TitlePrefixModule.setToolboxTabTitleState === 'function') {
          TitlePrefixModule.setToolboxTabTitleState(
            blinkOn ? 'reply_done' : 'idle',
            `response-done-blink:${reason || '-'}`,
          );
        }
      }, 900);
    }

    function startResponseDoneNotify(reason = '-') {
      const reasonText = String(reason || '-').trim() || '-';
      const recentlyInteracted = Date.now() - lastUserInteractionAt < 1500;
      const alreadyViewing = document.visibilityState === 'visible' && document.hasFocus();
      if (alreadyViewing && recentlyInteracted) {
        appendNotifyLog(`[RESPONSE_DONE_NOTIFY][SKIP] reason=user-already-viewing trigger=${reasonText}`);
        return false;
      }

      responseDoneNotifyActive = true;
      startTitleBlinkIfNeeded(reasonText);

      if (typeof ToolboxShell !== 'undefined'
        && typeof ToolboxShell.flashHeaderTitleOnce === 'function') {
        ToolboxShell.flashHeaderTitleOnce('回复完成', { notifyOnly: true });
      }

      if (typeof renderToolboxHeaderStatus === 'function') {
        renderToolboxHeaderStatus(`response-done-notify-start:${reasonText}`);
      }

      appendNotifyLog(`[RESPONSE_DONE_NOTIFY][START] reason=${reasonText}`);
      return true;
    }

    function bindResponseDoneAcknowledgeEvents() {
      if (acknowledgeEventsBound) {
        return;
      }
      if (typeof window !== 'undefined' && window.__CGPT_RESPONSE_DONE_ACK_BOUND) {
        acknowledgeEventsBound = true;
        return;
      }

      const ackByFocus = () => {
        if (document.visibilityState === 'visible' && document.hasFocus()) {
          acknowledgeResponseDoneNotification('window-focus-visible');
        }
      };

      window.addEventListener('focus', ackByFocus, true);
      window.addEventListener('pageshow', ackByFocus, true);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          acknowledgeResponseDoneNotification('visibility-visible');
        }
      }, true);

      const userEvents = [
        'pointerdown',
        'mousedown',
        'click',
        'keydown',
        'wheel',
        'touchstart',
      ];

      for (const eventName of userEvents) {
        document.addEventListener(eventName, () => {
          touchUserInteraction();
          acknowledgeResponseDoneNotification(`user-${eventName}`);
        }, true);
      }

      acknowledgeEventsBound = true;
      if (typeof window !== 'undefined') {
        window.__CGPT_RESPONSE_DONE_ACK_BOUND = true;
      }
      appendNotifyLog('[RESPONSE_DONE_NOTIFY][BIND] ok=1');
    }

    function init() {
      bindResponseDoneAcknowledgeEvents();
    }

    return {
      init,
      isNotifyActive,
      touchUserInteraction,
      startResponseDoneNotify,
      acknowledgeResponseDoneNotification,
      bindResponseDoneAcknowledgeEvents,
    };
  })();
