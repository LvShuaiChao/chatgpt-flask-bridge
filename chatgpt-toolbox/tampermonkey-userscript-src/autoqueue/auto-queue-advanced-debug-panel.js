  /********************************************************************
   * AutoQueueAdvancedDebugPanel：自动队列高级调试面板 HTML 渲染
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责高级调试面板的分组、行渲染、JSON 展示。
   * 3. 不负责按钮插入、不负责按钮绑定、不负责状态采集、不负责发送/上传/闭环。
   ********************************************************************/
  const AutoQueueAdvancedDebugPanel = (() => {
    function create(deps = {}) {
      const escapeHtml = deps.escapeHtml;
      const appendLog = deps.appendLog;
      function escapeHtmlSafe(value) {
        if (typeof escapeHtml === 'function') {
          return escapeHtml(value);
        }
        console.error('[AUTOQ_ADV_DEBUG_PANEL][ESCAPE_HTML_FALLBACK] escapeHtml missing');
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
      function appendLogSafe(line) {
        const text = String(line || '').trim();
        if (!text) {
          return;
        }
        if (typeof appendLog === 'function') {
          appendLog(text);
          return;
        }
        if (
          typeof ToolboxShell !== 'undefined'
          && ToolboxShell
          && typeof ToolboxShell.appendLog === 'function'
        ) {
          ToolboxShell.appendLog(text);
          return;
        }
        console.log(text);
      }
    function renderAutoQueueAdvancedDebugSection(title, rows) {
      const validRows = (rows || []).filter((row) => row && row.label);
      if (!validRows.length) {
        return '';
      }
      return `
        <div class="xz-autoq-debug-section">
          <div class="xz-autoq-debug-section-title">${escapeHtmlSafe(title)}</div>
          <div class="xz-autoq-debug-section-body">
            ${validRows.map((row) => `
              <div class="xz-autoq-debug-row">
                <span class="xz-autoq-debug-key">${escapeHtmlSafe(row.label)}</span>
                <span class="xz-autoq-debug-value">${escapeHtmlSafe(row.value === undefined || row.value === null || row.value === '' ? '-' : String(row.value))}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    function describeElementDebugRow(prefix, info) {
      if (!info || !info.found) {
        return { label: prefix, value: '未找到' };
      }
      const parts = [
        info.visible === false ? '不可见' : '可见',
        info.disabled ? '禁用' : '可用',
      ];
      if (info.text) {
        parts.push(`文本=${info.text}`);
      }
      return { label: prefix, value: parts.join(' | ') };
    }

    function buildGroupedAdvancedDebugPanelHtml(snapshot) {
      const page = snapshot.page && typeof snapshot.page === 'object' ? snapshot.page : {};
      const composer = snapshot.composer && typeof snapshot.composer === 'object' ? snapshot.composer : {};
      const buttons = snapshot.buttons && typeof snapshot.buttons === 'object' ? snapshot.buttons : {};
      const autoQueue = snapshot.autoQueue && typeof snapshot.autoQueue === 'object' ? snapshot.autoQueue : {};
      const upload = snapshot.upload && typeof snapshot.upload === 'object' ? snapshot.upload : {};
      const reply = snapshot.reply && typeof snapshot.reply === 'object' ? snapshot.reply : {};
      const terminal = snapshot.terminal && typeof snapshot.terminal === 'object' ? snapshot.terminal : {};
      const timers = snapshot.timers && typeof snapshot.timers === 'object' ? snapshot.timers : {};
      const chatgptButtons = buttons.chatgpt && typeof buttons.chatgpt === 'object' ? buttons.chatgpt : {};

      const pageVisible = page.visibilityState === 'visible' && !document.hidden;
      const pageThrottled = document.hidden || page.visibilityState === 'hidden' || !page.hasFocus;

      const layoutInfo = snapshot.layout && typeof snapshot.layout === 'object'
        ? snapshot.layout
        : {};
      const layoutRows = Object.keys(layoutInfo).map((key) => ({
        label: key,
        value: layoutInfo[key] == null ? '-' : String(layoutInfo[key]),
      }));

      const sections = [
        renderAutoQueueAdvancedDebugSection('布局诊断', layoutRows.length > 0 ? layoutRows : [
          { label: '状态', value: '暂无布局数据' },
        ]),
        renderAutoQueueAdvancedDebugSection('页面状态', [
          { label: '页面是否可见', value: pageVisible ? '是' : '否' },
          { label: '窗口是否聚焦', value: page.hasFocus ? '是' : '否' },
          { label: '页面 ID', value: page.pageDisplayId || page.conversationId || '-' },
          { label: '会话 ID', value: page.conversationId || '-' },
          { label: '浏览器节流状态', value: pageThrottled ? '疑似被节流' : '正常' },
          { label: '文档状态', value: page.readyState || '-' },
        ]),
        renderAutoQueueAdvancedDebugSection('输入区状态', [
          { label: '是否找到输入框', value: composer.composerFound ? '是' : '否' },
          { label: '输入框是否可编辑', value: composer.composerDisabled ? '否' : '是' },
          { label: '当前输入字符数', value: composer.composerTextLength },
          { label: '是否找到发送按钮', value: chatgptButtons.sendButton && chatgptButtons.sendButton.found ? '是' : '否' },
          { label: '发送按钮是否可点击', value: composer.canSend ? '是' : '否' },
          { label: '是否正在生成', value: composer.isGenerating ? '是' : '否' },
        ]),
        renderAutoQueueAdvancedDebugSection('上传状态', [
          { label: '本地待上传数量', value: upload.pendingUploadFileCount },
          { label: '已上传数量', value: upload.attached },
          { label: '当前附件状态', value: upload.composerAttachmentCount },
          { label: '最近一次上传失败原因', value: upload.lastUploadError || upload.lastUploadSource },
          { label: '是否正在上传', value: upload.isUploading ? '是' : '否' },
          { label: '自动队列上传状态', value: upload.autoQueueUploadStatus },
        ]),
        renderAutoQueueAdvancedDebugSection('回复等待状态', [
          { label: '是否正在等待回复', value: autoQueue.waitingForReply ? '是' : '否' },
          { label: '最近一次终止符', value: terminal.lastTerminalSignalText },
          { label: '是否命中停止符', value: terminal.terminalConfirmPassed ? '是' : '否' },
          { label: '二次验证状态', value: terminal.doneSignalVerificationRunning ? '进行中' : '未进行' },
          { label: '回复识别类型', value: reply.replyStateType || reply.classifyStatus },
          { label: '当前回复耗时', value: timers.waitReplyElapsedMs ? `${Math.round(timers.waitReplyElapsedMs / 1000)} 秒` : '-' },
        ]),
        renderAutoQueueAdvancedDebugSection('任务状态', [
          { label: '当前任务名', value: autoQueue.currentTaskTitle },
          { label: '当前任务序号', value: autoQueue.currentIndex != null ? autoQueue.currentIndex + 1 : '-' },
          { label: '当前任务是否允许继续', value: autoQueue.isRunning && !autoQueue.isStopping ? '是' : '否' },
          { label: '停止原因', value: autoQueue.lastStop && autoQueue.lastStop.reason ? autoQueue.lastStop.reason : autoQueue.displayReason },
          { label: '下一条任务策略', value: reply.nextAction || autoQueue.pendingSendKind },
          { label: '当前步骤', value: autoQueue.currentStep },
        ]),
        renderAutoQueueAdvancedDebugSection('计时器状态', [
          { label: '主循环是否运行', value: autoQueue.isRunning ? '是' : '否' },
          { label: '最近 tick 时间', value: snapshot.time },
          { label: '批量已运行', value: timers.batchElapsedMs ? `${Math.round(timers.batchElapsedMs / 1000)} 秒` : '-' },
          { label: '当前任务已运行', value: timers.currentTaskElapsedMs ? `${Math.round(timers.currentTaskElapsedMs / 1000)} 秒` : '-' },
          { label: '是否疑似卡死', value: timers.waitReplyElapsedMs > 300000 ? '是' : '否' },
        ]),
        renderAutoQueueAdvancedDebugSection('按钮检测', [
          describeElementDebugRow('发送按钮', chatgptButtons.sendButton),
          describeElementDebugRow('停止按钮', chatgptButtons.stopButton),
          describeElementDebugRow('继续按钮', chatgptButtons.continueButton),
          describeElementDebugRow('附加按钮', chatgptButtons.attachButton),
          describeElementDebugRow('文件输入', chatgptButtons.fileInput),
        ]),
      ].filter(Boolean).join('');

      let rawJson = '';
      try {
        rawJson = JSON.stringify(snapshot, null, 2);
      } catch (error) {
        const errText = error && error.stack ? error.stack : String(error);
        console.error('[ChatGPT toolbox] advanced debug JSON stringify failed', error);
        appendLogSafe(`[AUTOQ][ADV_DEBUG][RENDER_FAILED] error=${errText}`);
        rawJson = String(snapshot);
      }

      return `
        <div class="xz-autoq-advanced-debug-meta">更新时间：${escapeHtmlSafe(snapshot.time || '-')} | 来源：${escapeHtmlSafe(snapshot.source || '-')}</div>
        ${sections}
        <details class="xz-autoq-debug-raw">
          <summary>原始状态 JSON</summary>
          <pre>${escapeHtmlSafe(rawJson)}</pre>
        </details>
      `;
    }

      return Object.freeze({
        renderAutoQueueAdvancedDebugSection,
        describeElementDebugRow,
        buildGroupedAdvancedDebugPanelHtml,
      });
    }
    return Object.freeze({
      create,
    });
  })();
  globalThis.AutoQueueAdvancedDebugPanel = AutoQueueAdvancedDebugPanel;


