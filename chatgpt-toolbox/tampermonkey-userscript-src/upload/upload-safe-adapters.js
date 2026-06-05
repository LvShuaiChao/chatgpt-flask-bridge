  /********************************************************************
   * UploadSafeAdapters：UploadModule 通用安全适配器
   *
   * 说明：
   * 1. 从 upload-module.js 拆出。
   * 2. 保留原函数名，避免改动调用方。
   * 3. 本文件只放通用工具适配，不放上传流程、不放闭环、不放按钮状态机。
   ********************************************************************/

    function formatUploadErrorStack(error) {
      if (!error || !error.stack) {
        return '-';
      }
      return String(error.stack).split('\n').slice(0, 3).join(' | ');
    }

    function getStableButtonText(button, viewState = {}) {
      if (typeof ButtonState !== 'undefined' && typeof ButtonState.getStableButtonText === 'function') {
        return ButtonState.getStableButtonText(button, viewState);
      }
      if (!button) {
        return '';
      }
      const keepStableLabel = button.dataset && button.dataset.keepStableLabel === '1';
      if (!keepStableLabel) {
        return String(viewState && viewState.text || button.textContent || '').trim();
      }
      const datasetLabel = String(button.dataset.idleLabel || '').trim();
      if (datasetLabel) {
        return datasetLabel;
      }
      const ariaLabel = String(button.getAttribute('aria-label') || '').trim();
      if (ariaLabel) {
        button.dataset.idleLabel = ariaLabel;
        return ariaLabel;
      }
      const currentText = String(button.textContent || '').trim();
      if (currentText) {
        button.dataset.idleLabel = currentText;
        return currentText;
      }
      return String(viewState && viewState.text || '').trim();
    }

    function markUploadActionButtonStableLabel(button, label) {
      if (typeof ButtonState !== 'undefined' && typeof ButtonState.markButtonStableLabel === 'function') {
        ButtonState.markButtonStableLabel(button, label);
        return;
      }
      if (!button) {
        return;
      }
      const normalized = String(label || button.textContent || '').trim();
      if (!normalized) {
        return;
      }
      button.dataset.idleLabel = normalized;
      button.dataset.keepStableLabel = '1';
    }

    function safeFormatFileSize(size, source = '') {
      const formatter = (
        (typeof globalThis !== 'undefined' && typeof globalThis.formatFileSize === 'function' && globalThis.formatFileSize)
        || (
          typeof globalThis !== 'undefined'
          && globalThis.ToolboxUtils
          && typeof globalThis.ToolboxUtils.formatFileSize === 'function'
            ? globalThis.ToolboxUtils.formatFileSize
            : null
        )
        || (typeof formatBytes === 'function' ? formatBytes : null)
      );
      if (formatter) {
        return formatter(size);
      }

      const bytes = Number(size);
      if (!Number.isFinite(bytes) || bytes < 0) {
        return '0 B';
      }
      if (bytes < 1024) {
        return `${Math.round(bytes)} B`;
      }
      const kb = bytes / 1024;
      if (kb < 1024) {
        return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
      }
      const mb = kb / 1024;
      const text = `${mb.toFixed(1)} MB`;
      if (
        typeof ToolboxShell !== 'undefined'
        && ToolboxShell
        && typeof ToolboxShell.appendLog === 'function'
      ) {
        ToolboxShell.appendLog(
          `[UPLOAD][FORMAT_FILE_SIZE_FALLBACK] source=${source || '-'} size=${size} text=${text}`,
        );
      }
      return text;
    }

    function safeDownloadJson(filename, data, source = '') {
      const downloader = (
        (typeof globalThis !== 'undefined' && typeof globalThis.downloadJson === 'function' && globalThis.downloadJson)
        || (
          typeof globalThis !== 'undefined'
          && globalThis.ToolboxUtils
          && typeof globalThis.ToolboxUtils.downloadJson === 'function'
            ? globalThis.ToolboxUtils.downloadJson
            : null
        )
        || (typeof downloadJsonFile === 'function' ? downloadJsonFile : null)
      );
      if (downloader) {
        return downloader(filename, data);
      }

      const safeFilename = String(filename || 'download.json').trim() || 'download.json';
      if (
        typeof ToolboxShell !== 'undefined'
        && ToolboxShell
        && typeof ToolboxShell.appendLog === 'function'
      ) {
        ToolboxShell.appendLog(
          `[UPLOAD][DOWNLOAD_JSON_FALLBACK] source=${source || '-'} filename=${safeFilename}`,
        );
      }
      const jsonText = JSON.stringify(data == null ? {} : data, null, 2);
      const blob = new Blob([jsonText], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = safeFilename.endsWith('.json') ? safeFilename : `${safeFilename}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (error) {
        console.error('[UPLOAD][DOWNLOAD_JSON_FALLBACK_FAILED]', error);
        if (
          typeof ToolboxShell !== 'undefined'
          && ToolboxShell
          && typeof ToolboxShell.appendLog === 'function'
        ) {
          ToolboxShell.appendLog(
            `[UPLOAD][DOWNLOAD_JSON_FALLBACK_FAILED] source=${source || '-'} filename=${safeFilename} error=${error && error.message ? error.message : String(error)} stack=${formatUploadErrorStack(error)}`,
          );
        }
        throw error;
      } finally {
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
      }
    }

    function safeReadJsonFile(event, options = {}, source = '') {
      const reader = (
        (typeof globalThis !== 'undefined' && typeof globalThis.readJsonFile === 'function' && globalThis.readJsonFile)
        || (
          typeof globalThis !== 'undefined'
          && globalThis.ToolboxUtils
          && typeof globalThis.ToolboxUtils.readJsonFile === 'function'
            ? globalThis.ToolboxUtils.readJsonFile
            : null
        )
        || (typeof readJsonFileFromInput === 'function' ? readJsonFileFromInput : null)
      );
      if (reader) {
        return reader(event, options);
      }

      const tag = options.tag || `[UPLOAD][READ_JSON_FALLBACK] source=${source || '-'}`;
      const file = event && event.target && event.target.files
        ? event.target.files[0]
        : null;

      if (!file) {
        return Promise.resolve(null);
      }

      if (
        typeof ToolboxShell !== 'undefined'
        && ToolboxShell
        && typeof ToolboxShell.appendLog === 'function'
      ) {
        ToolboxShell.appendLog(tag);
      }

      return new Promise((resolve, reject) => {
        const fileReader = new FileReader();

        fileReader.onload = () => {
          try {
            const raw = String(fileReader.result || '');
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(error);
          } finally {
            if (event.target) {
              event.target.value = '';
            }
          }
        };

        fileReader.onerror = () => {
          const error = fileReader.error || new Error('FileReader read failed');
          if (event.target) {
            event.target.value = '';
          }
          reject(error);
        };

        fileReader.readAsText(file, options.encoding || 'utf-8');
      }).catch((error) => {
        console.error('[UPLOAD][READ_JSON_FALLBACK_FAILED]', error);
        if (
          typeof ToolboxShell !== 'undefined'
          && ToolboxShell
          && typeof ToolboxShell.appendLog === 'function'
        ) {
          ToolboxShell.appendLog(
            `[UPLOAD][READ_JSON_FALLBACK_FAILED] source=${source || '-'} file=${file.name || '-'} error=${error && error.message ? error.message : String(error)} stack=${formatUploadErrorStack(error)}`,
          );
        }
        throw error;
      });
    }

    function auditUploadModuleDependencies(source = '') {
      const missing = [];
      const hasFormatFileSize = (
        (typeof globalThis !== 'undefined' && typeof globalThis.formatFileSize === 'function')
        || (
          typeof globalThis !== 'undefined'
          && globalThis.ToolboxUtils
          && typeof globalThis.ToolboxUtils.formatFileSize === 'function'
        )
        || typeof safeFormatFileSize === 'function'
      );
      const hasDownloadJson = (
        (typeof globalThis !== 'undefined' && typeof globalThis.downloadJson === 'function')
        || (
          typeof globalThis !== 'undefined'
          && globalThis.ToolboxUtils
          && typeof globalThis.ToolboxUtils.downloadJson === 'function'
        )
        || typeof safeDownloadJson === 'function'
      );
      if (!hasFormatFileSize) {
        missing.push('formatFileSize');
      }
      if (!hasDownloadJson) {
        missing.push('downloadJson');
      }
      if (
        typeof ToolboxShell !== 'undefined'
        && ToolboxShell
        && typeof ToolboxShell.appendLog === 'function'
      ) {
        ToolboxShell.appendLog(
          `[UPLOAD_MODULE][DEPENDENCY_AUDIT] source=${source || '-'} missing=${missing.join('|') || '-'} hasSafeFormat=${typeof safeFormatFileSize === 'function' ? 1 : 0} hasSafeDownload=${typeof safeDownloadJson === 'function' ? 1 : 0}`,
        );
      }
      return {
        ok: missing.length === 0 || (typeof safeFormatFileSize === 'function' && typeof safeDownloadJson === 'function'),
        missing,
      };
    }


