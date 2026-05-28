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

  function getDefaultVerifyAfterDoneSignalPromptTemplate() {
    return [
      '这是一次“完成状态确认”，不是重新执行任务。',
      '',
      '请不要重新回答题目，不要重新生成代码，不要重新展开原任务内容。',
      '你只需要根据上一次助手回复，判断它是否已经完成当前任务要求。',
      '',
      '当前任务标题：{{taskTitle}}',
      '任务简述：{{taskBrief}}',
      '',
      '上一次助手回复：',
      '{{lastReply}}',
      '',
      '判断要求：',
      '1. 如果上一次助手回复已经完整完成任务，并且没有明显遗漏，只回复：{{doneSignal}}',
      '2. 如果上一次助手回复还没有完成，请只继续输出缺失的剩余内容。',
      '3. 不要重复已经回答过的内容。',
      '4. 不要从头重新回答整个任务。',
      '5. 不要把原始题目重新列出来。',
    ].join('\n');
  }
