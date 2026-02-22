/**
 * AI 翻译引擎模块
 * 支持 OpenAI Chat 兼容格式、OpenAI Response 格式、Anthropic 格式
 */

const https = require('https');
const http = require('http');

// 翻译配置常量
const TRANSLATION_CONFIG = {
  MAX_TEXTS_PER_REQUEST: 500, // 每次请求最多文本块数
  MAX_CHARS_PER_REQUEST: 50000, // 每次请求最大字符数
  REQUEST_TIMEOUT: 120000 // 请求超时时间（毫秒）
};

/**
 * 构建 OpenAI Chat 兼��格式的请求体
 */
function buildOpenAIChatRequest(texts, targetLanguage, model = 'gpt-3.5-turbo', stream = false) {
  const textsJson = JSON.stringify(texts);
  return {
    model,
    messages: [
      {
        role: 'system',
        content: `You are a professional translator. Translate the following JSON array of texts to ${targetLanguage}. Return ONLY a valid JSON array with the same number of elements, maintaining the original order. Do not add any explanation or markdown formatting.`
      },
      {
        role: 'user',
        content: textsJson
      }
    ],
    max_tokens: 8192,
    temperature: 0.3,
    stream
  };
}

/**
 * 构建 OpenAI Response 格式的请求体
 */
function buildOpenAIResponseRequest(texts, targetLanguage, model = 'gpt-4') {
  const textsJson = JSON.stringify(texts);
  return {
    model,
    input: `Translate the following JSON array of texts to ${targetLanguage}. Return ONLY a valid JSON array with the same number of elements, maintaining the original order.\n\n${textsJson}`
  };
}

/**
 * 构建 Anthropic 格式的请求体
 */
function buildAnthropicRequest(texts, targetLanguage, model = 'claude-3-sonnet-20240229') {
  const textsJson = JSON.stringify(texts);
  return {
    model,
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `Translate the following JSON array of texts to ${targetLanguage}. Return ONLY a valid JSON array with the same number of elements, maintaining the original order. Do not add any explanation or markdown formatting.\n\n${textsJson}`
      }
    ]
  };
}

/**
 * 解析 API 响应
 */
function parseAPIResponse(data, requestType) {
  try {
    const parsed = JSON.parse(data);

    switch (requestType) {
      case 'openai-chat':
      case 'openai-response':
        // OpenAI 格式: choices[0].message.content 或 output
        if (parsed.choices && parsed.choices[0]?.message?.content) {
          return JSON.parse(parsed.choices[0].message.content);
        }
        if (parsed.output) {
          return JSON.parse(parsed.output);
        }
        throw new Error('Invalid OpenAI response format');

      case 'anthropic':
        // Anthropic 格式: content[0].text
        if (parsed.content && parsed.content[0]?.text) {
          return JSON.parse(parsed.content[0].text);
        }
        throw new Error('Invalid Anthropic response format');

      default:
        throw new Error(`Unknown request type: ${requestType}`);
    }
  } catch (error) {
    throw new Error(`Failed to parse translation response: ${error.message}`);
  }
}

/**
 * 获取请求头
 */
function getHeaders(requestType, apiKey) {
  const headers = {
    'Content-Type': 'application/json'
  };

  switch (requestType) {
    case 'openai-chat':
    case 'openai-response':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
  }

  return headers;
}

function getStreamingHeaders(requestType, apiKey) {
  return {
    ...getHeaders(requestType, apiKey),
    Accept: 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache'
  };
}

/**
 * 获取请求路径
 */
function getRequestPath(endpoint, requestType) {
  const url = new URL(endpoint);
  const path = url.pathname;

  // 如果端点已经包含完整路径，直接使用
  if (
    path.includes('/chat/completions') ||
    path.includes('/responses') ||
    path.includes('/messages')
  ) {
    return path + url.search;
  }

  // 否则根据类型添加路径
  switch (requestType) {
    case 'openai-chat':
      return '/v1/chat/completions';
    case 'openai-response':
      return '/v1/responses';
    case 'anthropic':
      return '/v1/messages';
    default:
      return '/v1/chat/completions';
  }
}

/**
 * 发送 HTTP 请求
 */
function sendRequest(endpoint, requestBody, requestType, apiKey, timeout) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: getRequestPath(endpoint, requestType),
      method: 'POST',
      headers: getHeaders(requestType, apiKey),
      timeout: timeout || TRANSLATION_CONFIG.REQUEST_TIMEOUT
    };

    const req = httpModule.request(options, res => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const result = parseAPIResponse(data, requestType);
            resolve(result);
          } catch (error) {
            reject(new Error(`Parse error: ${error.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(requestBody));
    req.end();
  });
}

/**
 * 翻译文本数组
 * @param {string[]} texts - 待翻译文本数组
 * @param {string} targetLanguage - 目标语言
 * @param {object} config - AI 配置
 * @returns {Promise<string[]>} - 翻译结果数组
 */
async function translateTexts(texts, targetLanguage, config) {
  const { endpoint, apiKey, requestType, model, timeout } = config;

  if (!endpoint || !apiKey) {
    throw new Error('AI endpoint and API key are required');
  }

  // 构建请求体
  let requestBody;
  switch (requestType) {
    case 'openai-chat':
      requestBody = buildOpenAIChatRequest(texts, targetLanguage, model);
      break;
    case 'openai-response':
      requestBody = buildOpenAIResponseRequest(texts, targetLanguage, model);
      break;
    case 'anthropic':
      requestBody = buildAnthropicRequest(texts, targetLanguage, model);
      break;
    default:
      requestBody = buildOpenAIChatRequest(texts, targetLanguage, model);
  }

  return sendRequest(endpoint, requestBody, requestType, apiKey, timeout);
}

/**
 * 文本分块
 * @param {string[]} texts - 待翻译文本数组
 * @param {object} options - 可选配置
 * @param {number} options.maxTexts - 每块最大文本数
 * @param {number} options.maxChars - 每块最大字符数
 * @returns {Array<{texts: string[], startIndex: number}>} - 分块后的文本数组
 */
function chunkTexts(texts, options = {}) {
  const maxTexts = options.maxTexts || TRANSLATION_CONFIG.MAX_TEXTS_PER_REQUEST;
  const maxChars = options.maxChars || TRANSLATION_CONFIG.MAX_CHARS_PER_REQUEST;

  const chunks = [];
  let currentChunk = [];
  let currentChars = 0;
  let startIndex = 0;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const textLength = text.length;

    // 检查是否需要开始新块
    if (currentChunk.length >= maxTexts || currentChars + textLength > maxChars) {
      if (currentChunk.length > 0) {
        chunks.push({ texts: currentChunk, startIndex });
        currentChunk = [];
        currentChars = 0;
        startIndex = i;
      }
    }

    currentChunk.push(text);
    currentChars += textLength;
  }

  // 添加最后一个块
  if (currentChunk.length > 0) {
    chunks.push({ texts: currentChunk, startIndex });
  }

  return chunks;
}

/**
 * 解析流式响应的单个数据块
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
    // 移除 "data: " 前缀
    const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5).trim();
    const parsed = JSON.parse(jsonStr);

    switch (requestType) {
      case 'openai-chat':
        // OpenAI 流式格式: choices[0].delta.content
        if (parsed.choices && parsed.choices[0]?.delta?.content) {
          return parsed.choices[0].delta.content;
        }
        return null;

      case 'openai-response':
        // OpenAI Responses API 流式格式:
        // type: 'response.output_text.delta' -> delta
        // type: 'response.output_text.done' -> text
        if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
          return parsed.delta;
        }
        if (parsed.type === 'response.output_text.done' && typeof parsed.text === 'string') {
          return parsed.text;
        }
        return null;

      case 'anthropic':
        // Anthropic 流式格式: delta.text
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
  // 尝试解析部分JSON数组
  const completed = [];
  let remaining = content;

  // 查找已完成的双引号包裹的字符串元素
  // JSON数组格式: ["text1", "text2", ...]
  const trimmed = content.trim();

  // 如果不以 [ 开头，等待
  if (!trimmed.startsWith('[')) {
    return { completed: [], remaining: content };
  }

  // 尝试逐个提取字符串元素
  let pos = 1; // 跳过 [
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
      // 完成一个字符串元素
      try {
        const element = JSON.parse(currentElement);
        completed.push(element);
        currentElement = '';

        // 跳过可能的逗号和空格
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
      // 数组结束
      break;
    }

    pos++;
  }

  // 如果找到了完整元素，更新remaining
  if (completed.length > 0) {
    // 计算已解析部分在原字符串中的位置
    remaining = trimmed.substring(pos);
  }

  return { completed, remaining };
}

/**
 * 发送流式 HTTP 请求
 * @param {string} endpoint - API端点
 * @param {object} requestBody - 请求体
 * @param {string} requestType - 请求类型
 * @param {string} apiKey - API密钥
 * @param {number} timeout - 超时时间
 * @param {function} onProgress - 进度回调 (completedTexts, allTexts)
 * @param {number} expectedCount - 预期的翻译结果数量
 */
function sendStreamingRequest(
  endpoint,
  requestBody,
  requestType,
  apiKey,
  timeout,
  onProgress,
  expectedCount,
  registerRequest
) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: getRequestPath(endpoint, requestType),
      method: 'POST',
      headers: getStreamingHeaders(requestType, apiKey),
      timeout: timeout || TRANSLATION_CONFIG.REQUEST_TIMEOUT
    };

    const req = httpModule.request(options, res => {
      res.setEncoding('utf8');
      let buffer = '';
      let contentBuffer = ''; // 累积的内容
      let completedTexts = [];
      let lastReportedCount = 0;
      let errorData = '';

      res.on('data', chunk => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          errorData += chunk;
          return;
        }

        buffer += chunk;

        // 按行分割处理SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后一个不完整的行

        for (const line of lines) {
          const content = parseStreamChunk(line, requestType);
          if (content !== null) {
            contentBuffer += content;

            // 尝试提取已完成的元素
            const result = extractCompletedElements(contentBuffer, expectedCount);

            if (result.completed.length > lastReportedCount) {
              // 有新完成的元素
              const newStartIndex = lastReportedCount;
              const newCompleted = result.completed.slice(lastReportedCount);
              completedTexts = result.completed;
              lastReportedCount = result.completed.length;

              // 调用进度回调，传递新完成的元素
              if (onProgress && newCompleted.length > 0) {
                onProgress(newCompleted, completedTexts, newStartIndex);
              }
            }
          }
        }
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 处理最后的缓冲区
          if (buffer) {
            const content = parseStreamChunk(buffer, requestType);
            if (content !== null) {
              contentBuffer += content;
            }
          }

          // 最终解析
          try {
            // 尝试解析完整的JSON
            const finalResult = JSON.parse(contentBuffer);
            if (Array.isArray(finalResult)) {
              resolve(finalResult);
            } else {
              // 如果解析成功但不是数组，尝试提取元素
              const result = extractCompletedElements(contentBuffer, expectedCount);
              resolve(result.completed);
            }
          } catch {
            // 解析失败，使用已提取的元素
            resolve(completedTexts);
          }
        } else {
          const message = errorData || buffer;
          reject(new Error(`HTTP ${res.statusCode}: ${message}`));
        }
      });
    });

    if (typeof registerRequest === 'function') {
      registerRequest(req);
    }

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(requestBody));
    req.end();
  });
}

/**
 * 流式翻译文本数组
 * @param {string[]} texts - 待翻译文本数组
 * @param {string} targetLanguage - 目标语言
 * @param {object} config - AI 配置
 * @param {function} onProgress - 进度回调
 * @returns {Promise<string[]>} - 翻译结果数组
 */
async function translateTextsStreaming(texts, targetLanguage, config, onProgress) {
  const { endpoint, apiKey, requestType, model, timeout, registerRequest } = config;

  if (!endpoint || !apiKey) {
    throw new Error('AI endpoint and API key are required');
  }

  // 构建流式请求体
  let requestBody;
  switch (requestType) {
    case 'openai-chat':
      requestBody = buildOpenAIChatRequest(texts, targetLanguage, model, true);
      break;
    case 'openai-response':
      requestBody = buildOpenAIResponseRequest(texts, targetLanguage, model);
      requestBody.stream = true;
      break;
    case 'anthropic':
      requestBody = buildAnthropicRequest(texts, targetLanguage, model);
      requestBody.stream = true;
      break;
    default:
      requestBody = buildOpenAIChatRequest(texts, targetLanguage, model, true);
  }

  return sendStreamingRequest(
    endpoint,
    requestBody,
    requestType,
    apiKey,
    timeout,
    onProgress,
    texts.length,
    registerRequest
  );
}

module.exports = {
  translateTexts,
  translateTextsStreaming,
  chunkTexts,
  TRANSLATION_CONFIG
};
