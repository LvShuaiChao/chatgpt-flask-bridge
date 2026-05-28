const TextNormalizer = (() => {
  function stripLabel(text) {
    return String(text || '')
      .replace(/ChatGPT\s*Instruments\s*/gi, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function collapseInstrumentsCalculatorReply(text) {
    const value = stripLabel(text);
    if (!value) {
      return '';
    }

    const lines = value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return '';
    }
    if (lines.length === 1) {
      return lines[0];
    }

    const equationLines = [];
    const exprLines = [];

    for (const line of lines) {
      if (/^(.+?)=(.+)$/.test(line)) {
        equationLines.push(line);
      } else {
        exprLines.push(line);
      }
    }

    if (equationLines.length === 1) {
      const eqLine = equationLines[0];
      const answerMatch = eqLine.match(/^(.+?)=(.+)$/);
      if (answerMatch) {
        const lhs = String(answerMatch[1] || '').replace(/\s+/g, '');
        for (const exprLine of exprLines) {
          const exprNorm = String(exprLine).replace(/\s+/g, '');
          if (lhs && exprNorm && lhs === exprNorm) {
            return eqLine.trim();
          }
        }
      }
    }

    if (lines.length === 2) {
      const [first, second] = lines;
      for (const [exprLine, answerLine] of [[first, second], [second, first]]) {
        const answerMatch = String(answerLine).match(/^(.+?)=(.+)$/);
        if (!answerMatch) {
          continue;
        }
        const lhs = String(answerMatch[1] || '').replace(/\s+/g, '');
        const exprNorm = String(exprLine).replace(/\s+/g, '');
        if (lhs && exprNorm && lhs === exprNorm) {
          return String(answerLine).trim();
        }
      }
    }

    return value;
  }

  function normalizeClipboardTextForCompare(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  return {
    stripLabel,
    collapseInstrumentsCalculatorReply,
    normalizeClipboardTextForCompare,
  };
})();
