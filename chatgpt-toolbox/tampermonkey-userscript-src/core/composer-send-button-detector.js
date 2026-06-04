  /**
   * REFACTOR_STATUS:
   * 当前文件是拆分重构候选模块。
   * 当前阶段不要默认加入 .build-order.json。
   * 只有完成 canonical owner 切换后，才能进入 build order。
   * 在进入 build order 前，真实运行逻辑仍以 main.js / upload-module.js 中的 legacy 实现为准。
   */

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
