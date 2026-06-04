  /**
   * REFACTOR_STATUS:
   * 当前文件是拆分重构候选模块。
   * 当前阶段不要默认加入 .build-order.json。
   * 只有完成 canonical owner 切换后，才能进入 build order。
   * 在进入 build order 前，真实运行逻辑仍以 main.js / upload-module.js 中的 legacy 实现为准。
   */

  /********************************************************************
   * ComposerApiModule：Composer 读写扩展（main.js 内 ComposerApi 仍为权威实现）
   ********************************************************************/

  const ComposerApiModule = (() => {
    function create(deps) {
      const { log } = deps;

      function appendComposerLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function getComposerRoot() {
        if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.getComposerRoot === 'function') {
          return ComposerApi.getComposerRoot();
        }
        const root = document.querySelector('[contenteditable="true"]');
        if (!root) {
          appendComposerLog('[COMPOSER_API][ROOT_MISSING]');
        }
        return root;
      }

      function getComposerText() {
        if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.getComposerText === 'function') {
          return ComposerApi.getComposerText();
        }
        const root = getComposerRoot();
        if (!root) {
          return '';
        }
        return String(root.innerText || root.textContent || '');
      }

      function candidateSetComposerText(text, reason) {
        // legacy delegate: main.js ComposerApi.setComposerValue remains canonical.
        if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.setComposerValue === 'function') {
          const ok = ComposerApi.setComposerValue(String(text || ''), reason);
          appendComposerLog(`[COMPOSER_API][SET_OK] candidate=1 reason=${reason || '-'} len=${String(text || '').length} via=ComposerApi`);
          return ok;
        }

        const root = getComposerRoot();
        if (!root) {
          appendComposerLog(`[COMPOSER_API][SET_FAIL] candidate=1 reason=${reason || '-'} detail=root_missing`);
          return false;
        }

        root.focus();
        root.textContent = String(text || '');
        root.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: String(text || ''),
        }));

        appendComposerLog(`[COMPOSER_API][SET_OK] candidate=1 reason=${reason || '-'} len=${String(text || '').length}`);
        return true;
      }

      return {
        getComposerRoot,
        getComposerText,
        candidateSetComposerText,
      };
    }

    return { create };
  })();
