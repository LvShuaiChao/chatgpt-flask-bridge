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
        if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.getComposer === 'function') {
          return ComposerApi.getComposer();
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

      function setComposerText(text, reason) {
        if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.setComposerValue === 'function') {
          const ok = ComposerApi.setComposerValue(String(text || ''), reason);
          appendComposerLog(`[COMPOSER_API][SET_OK] reason=${reason || '-'} len=${String(text || '').length} via=ComposerApi`);
          return ok;
        }

        const root = getComposerRoot();
        if (!root) {
          appendComposerLog(`[COMPOSER_API][SET_FAIL] reason=${reason || '-'} detail=root_missing`);
          return false;
        }

        root.focus();
        root.textContent = String(text || '');
        root.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: String(text || ''),
        }));

        appendComposerLog(`[COMPOSER_API][SET_OK] reason=${reason || '-'} len=${String(text || '').length}`);
        return true;
      }

      return {
        getComposerRoot,
        getComposerText,
        setComposerText,
      };
    }

    return { create };
  })();
