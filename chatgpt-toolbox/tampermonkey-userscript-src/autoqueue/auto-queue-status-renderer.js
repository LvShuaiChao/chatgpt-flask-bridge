  /********************************************************************
   * AutoQueueStatusRenderer：自动队列状态项格式化与 HTML 渲染
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责状态项数值格式化、tone 判断、状态项 HTML 拼接。
   * 3. 不负责发送、不负责上传、不负责闭环、不负责按钮点击、不负责运行状态判定。
   ********************************************************************/
  const AutoQueueStatusRenderer = (() => {
    function create(deps = {}) {
      const escapeHtml = deps.escapeHtml;

      function escapeHtmlSafe(value) {
        if (typeof escapeHtml === 'function') {
          return escapeHtml(value);
        }
        console.error('[AUTOQ_STATUS_RENDERER][ESCAPE_HTML_FALLBACK] escapeHtml missing');
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

    function formatStatusFraction(numerator, denominator) {
      if (denominator == null || denominator === '' || Number.isNaN(Number(denominator))) {
        return '-';
      }
      return `${Number(numerator) || 0} / ${Number(denominator) || 0}`;
    }

    function formatQuotaDisplayText(display) {
      if (!display || display === '-') {
        return '-';
      }
      return String(display).replace(/(\d+)\s*\/\s*(\d+)/, '$1 / $2');
    }

    function resolveAutoqStatusValueTone(value, options = {}) {
      if (options.tone) {
        return options.tone;
      }
      if (options.muted) {
        return 'is-muted';
      }

      const text = String(value || '');
      const lower = text.toLowerCase();

      if (!text || text === '-') {
        return '';
      }
      if (/可发送|可上传|已完成|成功/.test(text)) {
        return 'is-ok';
      }
      if (/no-more-content|no_more_content|soft.done|无更多可输出/.test(lower)) {
        return 'is-warn';
      }
      if (/failed|失败|clipboard_read_verify_failed|missing|error|blocked/.test(lower)) {
        return 'is-error';
      }
      if (/等待发送|运行中|等待回复|发送中|上传中|回答中|复核中|发送重试|等待终止|已发送等待/.test(text)) {
        return 'is-warn';
      }
      if (/已停止|停止/.test(text) && options.allowStopWarn) {
        return 'is-warn';
      }
      return '';
    }

    function renderAutoqStatusItem(label, value, options = {}) {
      const safeLabel = escapeHtmlSafe(label);
      const safeValue = escapeHtmlSafe(value == null || value === '' ? '-' : String(value));
      const rawValue = value == null || value === '' ? '-' : String(value);
      const tone = resolveAutoqStatusValueTone(rawValue, options);
      const valueClass = tone
        ? `cgpt-autoq-status-value ${tone}`
        : 'cgpt-autoq-status-value';
      const valueId = options.id ? ` id="${options.id}"` : '';
      const extraClass = options.className || options.extraClass || '';
      const itemClass = extraClass
        ? `cgpt-autoq-status-item ${extraClass}`
        : 'cgpt-autoq-status-item';

      return `
        <div class="${itemClass}" title="${safeLabel}：${safeValue}">
          <span class="cgpt-autoq-status-label">${safeLabel}</span>
          <span class="${valueClass}"${valueId}>${safeValue}</span>
        </div>`;
    }

    function renderAutoqStatusItems(items) {
      return items.map((item) => renderAutoqStatusItem(
        item.label,
        item.value,
        {
          className: item.className || '',
          tone: item.tone,
          muted: item.muted,
          allowStopWarn: item.allowStopWarn,
          id: item.id,
        },
      )).join('');
    }


      return Object.freeze({
        formatStatusFraction,
        formatQuotaDisplayText,
        resolveAutoqStatusValueTone,
        renderAutoqStatusItem,
        renderAutoqStatusItems,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueStatusRenderer = AutoQueueStatusRenderer;


