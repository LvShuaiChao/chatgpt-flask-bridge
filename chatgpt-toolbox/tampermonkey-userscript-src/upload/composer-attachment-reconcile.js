  /********************************************************************
   * ComposerAttachmentReconcile：上传前 Composer 附件对齐
   ********************************************************************/

  const ComposerAttachmentReconcile = (() => {
    function create(deps) {
      const {
        log,
        getComposerAttachmentState,
        getVisibleComposerAttachmentNames,
        removeAllVisibleComposerAttachments,
        legacyReconcileComposerAttachmentsBeforeFreshUpload,
        pendingItemsToUploadFiles,
      } = deps;

      function appendReconcileLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function normalizeNameList(names) {
        return (Array.isArray(names) ? names : [])
          .map((name) => String(name || '').trim())
          .filter(Boolean)
          .sort();
      }

      function namesEqual(a, b) {
        const left = normalizeNameList(a);
        const right = normalizeNameList(b);
        if (left.length !== right.length) {
          return false;
        }
        for (let i = 0; i < left.length; i += 1) {
          if (left[i] !== right[i]) {
            return false;
          }
        }
        return true;
      }

      async function reconcileBeforeFreshUpload(options) {
        const source = options && options.source ? options.source : '-';
        const pendingItems = options && Array.isArray(options.pendingItems) ? options.pendingItems : [];

        const composerState = typeof getComposerAttachmentState === 'function'
          ? getComposerAttachmentState('composer-reconcile')
          : null;

        const composerCount = composerState && Number.isFinite(Number(composerState.count))
          ? Number(composerState.count)
          : 0;

        const composerNames = typeof getVisibleComposerAttachmentNames === 'function'
          ? normalizeNameList(getVisibleComposerAttachmentNames())
          : [];

        const queueNames = normalizeNameList(pendingItems.map((item) => item && item.name));

        appendReconcileLog(
          `[COMPOSER_RECONCILE][CHECK] source=${source} composerCount=${composerCount} composerNames=${composerNames.join('|') || '-'} queueNames=${queueNames.join('|') || '-'}`,
        );

        if (composerCount <= 0) {
          return {
            ok: true,
            action: 'none',
            reason: 'composer_empty',
          };
        }

        if (!queueNames.length) {
          appendReconcileLog(
            `[COMPOSER_RECONCILE][PRESERVE_USER_ATTACHMENT] source=${source} reason=no_queue_items composerCount=${composerCount}`,
          );
          return {
            ok: true,
            action: 'preserve',
            reason: 'no_queue_items',
          };
        }

        if (!namesEqual(composerNames, queueNames)) {
          appendReconcileLog(
            `[COMPOSER_RECONCILE][PRESERVE_USER_ATTACHMENT] source=${source} reason=name_mismatch composerNames=${composerNames.join('|') || '-'} queueNames=${queueNames.join('|') || '-'}`,
          );
          return {
            ok: true,
            action: 'preserve',
            reason: 'name_mismatch',
          };
        }

        if (typeof legacyReconcileComposerAttachmentsBeforeFreshUpload === 'function') {
          const files = typeof pendingItemsToUploadFiles === 'function'
            ? pendingItemsToUploadFiles(pendingItems)
            : pendingItems;
          return legacyReconcileComposerAttachmentsBeforeFreshUpload(files, {
            ...(options && typeof options === 'object' ? options : {}),
            source,
          });
        }

        if (typeof removeAllVisibleComposerAttachments === 'function') {
          appendReconcileLog(
            `[COMPOSER_RECONCILE][REMOVE_VISIBLE_ATTACHMENT] source=${source} reason=same_as_queue count=${composerCount}`,
          );
          await removeAllVisibleComposerAttachments('composer-reconcile:same-as-queue');
        }

        return {
          ok: true,
          action: 'removed_existing_queue_attachments',
          reason: 'same_as_queue',
        };
      }

      return {
        reconcileBeforeFreshUpload,
        normalizeNameList,
        namesEqual,
      };
    }

    return { create };
  })();
