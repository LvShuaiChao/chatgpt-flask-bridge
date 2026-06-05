  /********************************************************************
   * ComposerAttachmentReconcile：上传前 Composer 附件对齐
   *
   * Owner：
   * - 上传前判断 Composer 是否已有附件
   * - 判断已有附件是否与当前待上传文件一致
   * - 判断是否需要保留用户手动添加的附件
   * - 必要时调用 legacy removeAllVisibleComposerAttachmentsForFreshUpload 清理旧附件
   ********************************************************************/
  const ComposerAttachmentReconcile = (() => {
    function create(deps) {
      const safeDeps = deps && typeof deps === 'object' ? deps : {};
      const log = typeof safeDeps.log === 'function'
        ? safeDeps.log
        : (message) => console.warn(String(message || ''));
      const getComposerUploadPayloadSnapshot = safeDeps.getComposerUploadPayloadSnapshot;
      const getComposerAttachmentNamesForUploadReconcile = safeDeps.getComposerAttachmentNamesForUploadReconcile;
      const removeAllVisibleComposerAttachmentsForFreshUpload = safeDeps.removeAllVisibleComposerAttachmentsForFreshUpload;

      function appendLog(message) {
        log(String(message || ''));
      }

      function normalizeUploadCompareName(value) {
        return String(value || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');
      }

      function areComposerAttachmentsSameAsUploadFiles(composerNames, files) {
        const composerList = Array.from(new Set(
          (Array.isArray(composerNames) ? composerNames : [])
            .map((name) => normalizeUploadCompareName(name))
            .filter(Boolean),
        )).sort();
        const fileList = Array.from(new Set(
          (Array.isArray(files) ? files : [])
            .map((file) => normalizeUploadCompareName(file && file.name ? file.name : ''))
            .filter(Boolean),
        )).sort();
        if (composerList.length !== fileList.length) {
          return false;
        }
        for (let i = 0; i < fileList.length; i += 1) {
          if (composerList[i] !== fileList[i]) {
            return false;
          }
        }
        return true;
      }

      function shouldPreserveExistingComposerAttachmentsBeforeUpload(source, options = {}) {
        const opts = options && typeof options === 'object' ? options : {};
        const sourceLower = String(source || '').trim().toLowerCase();
        if (
          opts.clearComposerBeforeUpload === true
          || opts.forceFreshComposer === true
          || opts.freshUpload === true
        ) {
          return false;
        }
        if (
          opts.preserveComposerAttachments === false
          || opts.preserveExistingComposerAttachments === false
        ) {
          return false;
        }
        if (
          opts.preserveComposerAttachments === true
          || opts.preserveExistingComposerAttachments === true
        ) {
          return true;
        }
        return sourceLower.startsWith('upload-manual:')
          || sourceLower === 'manual-start-upload'
          || sourceLower === 'button'
          || sourceLower.includes('manual-start-upload')
          || sourceLower.includes('multi-upload-start-button')
          || sourceLower.includes('start-upload')
          || sourceLower.includes('shortcut-start-upload')
          || sourceLower.includes('handle-start-upload');
      }

      function buildEmptySnapshot(source) {
        return {
          source: String(source || 'unknown'),
          rawCount: 0,
          normalizedCount: 0,
          readyCount: 0,
          uploadingCount: 0,
          hasAny: false,
          hasReady: false,
          method: 'composer-reconcile-fallback-empty',
        };
      }

      function readComposerSnapshot(source) {
        if (typeof getComposerUploadPayloadSnapshot !== 'function') {
          appendLog(
            `[UPLOAD_RECONCILE][SNAPSHOT_PROVIDER_MISSING] source=${String(source || '-')}`,
          );
          return buildEmptySnapshot(source);
        }
        const snapshot = getComposerUploadPayloadSnapshot(source) || {};
        return {
          source: snapshot.source || String(source || 'unknown'),
          rawCount: Number(snapshot.rawCount || 0),
          normalizedCount: Number(snapshot.normalizedCount || 0),
          readyCount: Number(snapshot.readyCount || 0),
          uploadingCount: Number(snapshot.uploadingCount || 0),
          hasAny: snapshot.hasAny === true,
          hasReady: snapshot.hasReady === true,
          method: snapshot.method || 'unknown',
        };
      }

      function readComposerNames(source) {
        if (typeof getComposerAttachmentNamesForUploadReconcile !== 'function') {
          appendLog(
            `[UPLOAD_RECONCILE][NAMES_PROVIDER_MISSING] source=${String(source || '-')}`,
          );
          return [];
        }
        const names = getComposerAttachmentNamesForUploadReconcile(source);
        return Array.from(new Set(
          (Array.isArray(names) ? names : [])
            .map((name) => String(name || '').trim())
            .filter(Boolean),
        ));
      }

      async function reconcileComposerAttachmentsBeforeFreshUpload(files, options = {}) {
        const opts = options && typeof options === 'object' ? options : {};
        const source = String(opts.source || 'fresh-upload').trim() || 'fresh-upload';
        const uploadOnly = opts.uploadOnly === true;
        const filesList = Array.isArray(files) ? files.filter(Boolean) : [];
        const beforeSnapshot = readComposerSnapshot(`fresh-upload-reconcile-before:${source}`);
        const composerNames = readComposerNames(`fresh-upload-reconcile-before:${source}`);
        const fileNames = filesList
          .map((file) => (file && file.name ? String(file.name) : ''))
          .filter(Boolean);
        const same = areComposerAttachmentsSameAsUploadFiles(composerNames, filesList);
        const preserveExistingComposerAttachments = shouldPreserveExistingComposerAttachmentsBeforeUpload(
          source,
          opts,
        );
        appendLog(
          `[UPLOAD_RECONCILE][CHECK] source=${source} uploadOnly=${uploadOnly ? 1 : 0} queueFiles=${filesList.length} composerRaw=${beforeSnapshot.rawCount} composerNormalized=${beforeSnapshot.normalizedCount} composerReady=${beforeSnapshot.readyCount} same=${same ? 1 : 0} preserveExisting=${preserveExistingComposerAttachments ? 1 : 0} fileNames=${fileNames.join('|') || '-'} composerNames=${composerNames.join('|') || '-'}`,
        );
        if (!filesList.length) {
          return {
            ok: true,
            cleaned: false,
            reason: 'no-files',
          };
        }
        if (beforeSnapshot.normalizedCount <= 0 && beforeSnapshot.readyCount <= 0) {
          return {
            ok: true,
            cleaned: false,
            reason: 'composer-empty',
          };
        }
        if (same) {
          return {
            ok: true,
            cleaned: false,
            reason: 'same-as-current-upload-files',
          };
        }
        if (preserveExistingComposerAttachments) {
          appendLog(
            `[UPLOAD_RECONCILE][PRESERVE_EXISTING_COMPOSER_ATTACHMENTS] source=${source} uploadOnly=${uploadOnly ? 1 : 0} existing=${beforeSnapshot.normalizedCount} queueFiles=${filesList.length} action=append-only`,
          );
          return {
            ok: true,
            cleaned: false,
            preserved: true,
            reason: 'preserve-existing-composer-attachments',
          };
        }
        if (typeof removeAllVisibleComposerAttachmentsForFreshUpload !== 'function') {
          appendLog(
            `[UPLOAD_RECONCILE][BLOCKED] source=${source} reason=remove-provider-missing before=${beforeSnapshot.normalizedCount} after=- queueFiles=${filesList.length}`,
          );
          return {
            ok: false,
            cleaned: false,
            reason: 'composer-stale-attachments-clear-failed',
            detail: 'remove-provider-missing',
          };
        }
        const clearResult = await removeAllVisibleComposerAttachmentsForFreshUpload(source);
        if (!clearResult || clearResult.ok !== true) {
          appendLog(
            `[UPLOAD_RECONCILE][BLOCKED] source=${source} reason=${clearResult && clearResult.reason ? clearResult.reason : 'clear-failed'} before=${clearResult && clearResult.beforeCount != null ? clearResult.beforeCount : beforeSnapshot.normalizedCount} after=${clearResult && clearResult.afterCount != null ? clearResult.afterCount : '-'} queueFiles=${filesList.length}`,
          );
          if (opts.allowProceedOnClearFailure === true) {
            appendLog(
              `[UPLOAD_RECONCILE][DEGRADED_CONTINUE] source=${source} reason=clear-failed action=continue-without-upload`,
            );
            return {
              ok: true,
              cleaned: false,
              skipped: true,
              degraded: true,
              reason: 'stale-clear-failed-degraded',
            };
          }
          return {
            ok: false,
            cleaned: false,
            reason: 'composer-stale-attachments-clear-failed',
            detail: clearResult && clearResult.reason ? clearResult.reason : 'clear-failed',
          };
        }
        return {
          ok: true,
          cleaned: true,
          reason: 'stale-composer-attachments-cleared',
        };
      }

      return {
        normalizeUploadCompareName,
        areComposerAttachmentsSameAsUploadFiles,
        shouldPreserveExistingComposerAttachmentsBeforeUpload,
        reconcileComposerAttachmentsBeforeFreshUpload,
      };
    }

    return { create };
  })();
