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
    if (typeof hasBatchTaskDoneSignal === 'function' && hasBatchTaskDoneSignal(text)) {
      return true;
    }
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

  function getDefaultVerifyAfterDoneSignalPromptTemplate() {
    return [
      '这是一次“完成状态二次确认”，不是重新执行任务。',
      '已重新上传当前项目文件/附件，请结合附件、完整原始任务内容和上一轮助手回复判断当前任务是否真的已经完整完成。',
      '',
      '任务标题：',
      '{{taskTitle}}',
      '',
      '任务简述：{{taskBrief}}',
      '',
      '完整原始任务内容：',
      '{{taskContent}}',
      '',
      '上一轮助手回复：',
      '{{lastReply}}',
      '',
      '判断规则：',
      '1. 如果你确认任务已经完整完成，并且没有任何遗漏，只输出：{{doneSignal}}',
      '2. 如果仍有遗漏，不要输出终止符，直接继续补充缺失内容。',
      '3. 不要重复已经回答过的内容。',
      '4. 不要从头重新执行整个任务。',
      '5. 不要把原始任务完整重打一遍。',
    ].join('\n');
  }
