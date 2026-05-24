  /********************************************************************
   * 完成信号：文本清洗与判定（upload / auto-queue / state 共用）
   ********************************************************************/

  function cleanAssistantTextForDoneSignal(text) {
    const raw = String(text || '').trim();
    if (
      typeof ChatMessageExtractor !== 'undefined'
      && ChatMessageExtractor
      && typeof ChatMessageExtractor.cleanMessageText === 'function'
    ) {
      return String(ChatMessageExtractor.cleanMessageText(raw) || '').trim();
    }
    return raw;
  }

  function mapAnalyzeDoneSignalResult(result, configuredStopSignal) {
    return {
      matched: !!result.matched,
      corrupted: !!result.corrupted,
      lineCount: result.lineCount ?? 0,
      configuredStopSignal: result.configuredSignal || configuredStopSignal,
      allowedSignals: result.allowedSignals || [],
      reason: result.reason || (result.matched ? 'strict-exact-single-line-match' : 'not-single-line-stop-signal'),
    };
  }

  function analyzeAssistantDoneSignalText(text, options = {}) {
    const configuredStopSignal = String((options && options.doneSignal) || '').trim();
    if (typeof analyzeDoneSignalText === 'function') {
      return mapAnalyzeDoneSignalResult(
        analyzeDoneSignalText(text, { doneSignal: configuredStopSignal }),
        configuredStopSignal,
      );
    }
    return {
      matched: hasAssistantDoneSignalInText(text, { doneSignal: configuredStopSignal }),
      corrupted: false,
      lineCount: 0,
      configuredStopSignal,
      allowedSignals: configuredStopSignal ? [configuredStopSignal] : [],
      reason: 'analyzeDoneSignalText-missing',
    };
  }

  function hasAssistantDoneSignalInText(text, options = {}) {
    if (typeof analyzeDoneSignalText === 'function') {
      return Boolean(analyzeDoneSignalText(text, options).matched);
    }
    const checked = cleanAssistantTextForDoneSignal(text)
      .replace(/\r\n/g, '\n')
      .trim();
    const signal = String((options && options.doneSignal) || '').trim();
    if (!signal || !checked) {
      return false;
    }
    return checked === signal || checked.includes(signal);
  }
