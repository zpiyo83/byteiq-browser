/**
 * 翻译流式解析模块
 * 解析流式响应数据块、提取已完成的JSON数组元素
 */

/**
 * 解析流式响应的单个数据块
 * @returns {string|null} 内容片段
 */
function parseStreamChunk(line, requestType) {
  if (!line) {
    return null;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
    return null;
  }

  if (!trimmed.startsWith('data:')) {
    return null;
  }

  try {
    const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5).trim();
    const parsed = JSON.parse(jsonStr);

    switch (requestType) {
      case 'openai-chat':
        if (parsed.choices && parsed.choices[0]?.delta?.content) {
          return parsed.choices[0].delta.content;
        }
        return null;

      case 'openai-response':
        if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
          return parsed.delta;
        }
        if (parsed.type === 'response.output_text.done' && typeof parsed.text === 'string') {
          return parsed.text;
        }
        return null;

      case 'anthropic':
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          return parsed.delta.text;
        }
        return null;

      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * 尝试从累积的内容中提取已完成的JSON数组元素
 * @param {string} content - 累积的内容
 * @param {number} _expectedCount - 预期的元素数量（保留供未来使用）
 * @returns {{completed: string[], remaining: string}} - 已完成的元素和剩余内容
 */
function extractCompletedElements(content, _expectedCount) {
  const completed = [];
  let remaining = content;

  const trimmed = content.trim();

  if (!trimmed.startsWith('[')) {
    return { completed: [], remaining: content };
  }

  let pos = 1;
  let inString = false;
  let escape = false;
  let currentElement = '';

  while (pos < trimmed.length) {
    const char = trimmed[pos];

    if (escape) {
      currentElement += char;
      escape = false;
    } else if (char === '\\') {
      currentElement += char;
      escape = true;
    } else if (char === '"' && !inString) {
      inString = true;
      currentElement += char;
    } else if (char === '"' && inString) {
      inString = false;
      currentElement += char;
      try {
        const element = JSON.parse(currentElement);
        completed.push(element);
        currentElement = '';

        pos++;
        while (
          pos < trimmed.length &&
          (trimmed[pos] === ',' || trimmed[pos] === ' ' || trimmed[pos] === '\n')
        ) {
          pos++;
        }
        continue;
      } catch {
        // 解析失败，继续累积
      }
    } else if (inString) {
      currentElement += char;
    } else if (char === ']') {
      break;
    }

    pos++;
  }

  if (completed.length > 0) {
    remaining = trimmed.substring(pos);
  }

  return { completed, remaining };
}

module.exports = {
  parseStreamChunk,
  extractCompletedElements
};
