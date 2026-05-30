  /********************************************************************
   * ToolboxUtils：跨模块通用工具（文件大小、JSON 导出/导入）
   ********************************************************************/

  function formatFileSize(size) {
    if (typeof formatBytes === 'function') {
      return formatBytes(size);
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
    if (mb < 1024) {
      return `${mb.toFixed(mb >= 10 ? 1 : 1)} MB`;
    }
    const gb = mb / 1024;
    return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  }

  function downloadJson(filename, data) {
    if (typeof downloadJsonFile === 'function') {
      downloadJsonFile(filename, data);
      return;
    }

    const safeFilename = String(filename || 'download.json').trim() || 'download.json';
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
      console.error('[UTILS][downloadJson] failed', error);
      if (
        typeof ToolboxShell !== 'undefined'
        && ToolboxShell
        && typeof ToolboxShell.appendLog === 'function'
      ) {
        ToolboxShell.appendLog(
          `[UTILS][downloadJson][FAILED] filename=${safeFilename} error=${error && error.message ? error.message : String(error)}`,
        );
      }
      throw error;
    } finally {
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    }
  }

  function readJsonFile(event, options = {}) {
    if (typeof readJsonFileFromInput === 'function') {
      return readJsonFileFromInput(event, options);
    }

    const tag = options.tag || '[JSON_IMPORT]';
    const file = event && event.target && event.target.files
      ? event.target.files[0]
      : null;

    if (!file) {
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          const raw = String(reader.result || '');
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        } finally {
          if (event.target) {
            event.target.value = '';
          }
        }
      };

      reader.onerror = () => {
        const error = reader.error || new Error('FileReader read failed');
        if (event.target) {
          event.target.value = '';
        }
        reject(error);
      };

      reader.readAsText(file, options.encoding || 'utf-8');
    }).catch((error) => {
      console.error(`[UTILS][readJsonFile] ${tag} read failed`, error);
      if (
        typeof ToolboxShell !== 'undefined'
        && ToolboxShell
        && typeof ToolboxShell.appendLog === 'function'
      ) {
        ToolboxShell.appendLog(
          `[UTILS][readJsonFile][FAILED] tag=${tag} file=${file.name || '-'} error=${error && error.message ? error.message : String(error)}`,
        );
      }
      throw error;
    });
  }

  const ToolboxUtils = globalThis.ToolboxUtils || {};
  ToolboxUtils.formatFileSize = ToolboxUtils.formatFileSize || formatFileSize;
  ToolboxUtils.downloadJson = ToolboxUtils.downloadJson || downloadJson;
  ToolboxUtils.readJsonFile = ToolboxUtils.readJsonFile || readJsonFile;
  globalThis.ToolboxUtils = ToolboxUtils;

  globalThis.formatFileSize = globalThis.formatFileSize || ToolboxUtils.formatFileSize;
  globalThis.downloadJson = globalThis.downloadJson || ToolboxUtils.downloadJson;
  globalThis.readJsonFile = globalThis.readJsonFile || ToolboxUtils.readJsonFile;
