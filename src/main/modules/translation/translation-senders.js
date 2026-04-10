/**
 * 翻译请求发送模块
 * 发送非流式/流式翻译请求、文本分块
 */

const https = require('https');
const http = require('http');
const {
  TRANSLATION_CONFIG,
  buildOpenAIChatRequest,
  buildOpenAIResponseRequest,
  buildAnthropicRequest,
  parseAPIResponse,
  getHeaders,
  getStreamingHeaders,
  getRequestPath
} = require('./translation-request-builders');
const { parseStreamChunk, extractCompletedElements } = require('./translation-stream-parsers');

/**
 * 发送非流式 HTTP 请求
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
 * 发送流式 HTTP 请求
 * @param {string} endpoint - API端点
 * @param {object} requestBody - 请求体
 * @param {string} requestType - 请求类型
 * @param {string} apiKey - API密钥
 * @param {number} timeout - 超时时间
 * @param {function} onProgress - 进度回调 (completedTexts, allTexts)
 * @param {number} expectedCount - 预期的翻译结果数量
 * @param {function} registerRequest - 注册请求以便取消
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
      let contentBuffer = '';
      let completedTexts = [];
      let lastReportedCount = 0;
      let errorData = '';

      res.on('data', chunk => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          errorData += chunk;
          return;
        }

        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const content = parseStreamChunk(line, requestType);
          if (content !== null) {
            contentBuffer += content;

            const result = extractCompletedElements(contentBuffer, expectedCount);

            if (result.completed.length > lastReportedCount) {
              const newStartIndex = lastReportedCount;
              const newCompleted = result.completed.slice(lastReportedCount);
              completedTexts = result.completed;
              lastReportedCount = result.completed.length;

              if (onProgress && newCompleted.length > 0) {
                onProgress(newCompleted, completedTexts, newStartIndex);
              }
            }
          }
        }
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (buffer) {
            const content = parseStreamChunk(buffer, requestType);
            if (content !== null) {
              contentBuffer += content;
            }
          }

          try {
            const finalResult = JSON.parse(contentBuffer);
            if (Array.isArray(finalResult)) {
              resolve(finalResult);
            } else {
              const result = extractCompletedElements(contentBuffer, expectedCount);
              resolve(result.completed);
            }
          } catch {
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
 * 翻译文本数组（非流式）
 */
async function translateTexts(texts, targetLanguage, config) {
  const { endpoint, apiKey, requestType, model, timeout } = config;

  if (!endpoint || !apiKey) {
    throw new Error('AI endpoint and API key are required');
  }

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

  if (currentChunk.length > 0) {
    chunks.push({ texts: currentChunk, startIndex });
  }

  return chunks;
}

/**
 * 流式翻译文本数组
 */
async function translateTextsStreaming(texts, targetLanguage, config, onProgress) {
  const { endpoint, apiKey, requestType, model, timeout, registerRequest } = config;

  if (!endpoint || !apiKey) {
    throw new Error('AI endpoint and API key are required');
  }

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
  sendStreamingRequest,
  sendRequest,
  TRANSLATION_CONFIG
};
