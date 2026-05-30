  /********************************************************************
   * ComposerSendButtonDetector：发送按钮检测（委托 ComposerApi / main）
   ********************************************************************/

  const ComposerSendButtonDetector = (() => {
    function create(deps) {
      const {
        log,
        legacyFindSendButton,
        legacyIsRealSendButton,
        legacyIsLikelyComposerSendButton,
        legacyDescribeSendButton,
      } = deps;

      function appendDetectorLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function findSendButton(options) {
        if (typeof legacyFindSendButton === 'function') {
          const button = legacyFindSendButton(options);
          if (button) {
            appendDetectorLog('[SEND_BUTTON_DETECTOR][FOUND]');
          } else {
            appendDetectorLog('[SEND_BUTTON_DETECTOR][MISSING]');
          }
          return button;
        }

        if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.findSendButton === 'function') {
          const button = ComposerApi.findSendButton(options);
          if (button) {
            appendDetectorLog('[SEND_BUTTON_DETECTOR][FOUND]');
          } else {
            appendDetectorLog('[SEND_BUTTON_DETECTOR][MISSING]');
          }
          return button;
        }

        appendDetectorLog('[SEND_BUTTON_DETECTOR][MISSING]');
        return null;
      }

      return {
        findSendButton,
        isRealSendButton: legacyIsRealSendButton,
        isLikelyComposerSendButton: legacyIsLikelyComposerSendButton,
        describeSendButton: legacyDescribeSendButton,
      };
    }

    return { create };
  })();
