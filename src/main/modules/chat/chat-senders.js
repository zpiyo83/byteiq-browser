/**
 * AI 对话请求发送模块
 * 发送流式/非流式对话请求
 */

const https = require('https');
const http = require('http');
const {
  buildOpenAIChatRequest,
  buildOpenAIResponseRequest,
  buildAnthropicRequest,
  getHeaders,
  getStreamingHeaders,
  getRequestPath
} = require('./request-builders');
const {
  parseStreamChunk,
  parseResponsesStreamEvent,
  buildChatLikeResponseFromResponsesStream,
  parseChatCompletionsStreamEvent,
  buildChatLikeResponseFromChatStream,
  normalizeToolsForResponses
} = require('./stream-parsers');

function sendResponsesStreamForAgent(messages, config, onTextChunk) {
  return new Promise((resolve, reject) => {
    const { endpoint, apiKey, model, timeout, tools } = config;

    if (!endpoint || !apiKey) {
      reject(new Error('AI endpoint and API key are required'));
      return;
    }

    const requestBody = buildOpenAIResponseRequest(messages, model, true);
    requestBody.stream = true;
    if (tools && tools.length > 0) {
      requestBody.tools = normalizeToolsForResponses(tools);
      requestBody.tool_choice = 'auto';
    }

    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: getRequestPath(endpoint, 'openai-response'),
      method: 'POST',
      headers: getStreamingHeaders('openai-response', apiKey),
      timeout: timeout || 120000
    };

    const state = {
      text: '',
      toolCallsByItemId: new Map()
    };

    const req = httpModule.request(options, res => {
      res.setEncoding('utf8');
      let buffer = '';
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
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') continue;
          if (!trimmed.startsWith('data:')) continue;

          try {
            const jsonStr = trimmed.startsWith('data: ')
              ? trimmed.slice(6)
              : trimmed.slice(5).trim();
            const payload = JSON.parse(jsonStr);
            parseResponsesStreamEvent(payload, state);
            if (onTextChunk && state.text) {
              onTextChunk(state.text, '');
            }
          } catch {
            continue;
          }
        }
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (buffer) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data:')) {
              try {
                const jsonStr = trimmed.startsWith('data: ')
                  ? trimmed.slice(6)
                  : trimmed.slice(5).trim();
                const payload = JSON.parse(jsonStr);
                parseResponsesStreamEvent(payload, state);
                if (onTextChunk && state.text) {
                  onTextChunk(state.text, '');
                }
              } catch {
                // ignore trailing parse failure
              }
            }
          }

          const responseData = buildChatLikeResponseFromResponsesStream(state);
          resolve(JSON.stringify(responseData));
        } else {
          const message = errorData || buffer;
          reject(new Error(`HTTP ${res.statusCode}: ${message}`));
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

function sendChatCompletionsStreamForAgent(messages, config, onTextChunk) {
  return new Promise((resolve, reject) => {
    const { endpoint, apiKey, model, timeout, tools } = config;

    if (!endpoint || !apiKey) {
      reject(new Error('AI endpoint and API key are required'));
      return;
    }

    const requestBody = buildOpenAIChatRequest(messages, model, true);
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: getRequestPath(endpoint, 'openai-chat'),
      method: 'POST',
      headers: getStreamingHeaders('openai-chat', apiKey),
      timeout: timeout || 120000
    };

    const state = {
      text: '',
      reasoningContent: '',
      toolCallsByIndex: new Map()
    };

    const req = httpModule.request(options, res => {
      res.setEncoding('utf8');
      let buffer = '';
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
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') continue;
          if (!trimmed.startsWith('data:')) continue;

          try {
            const jsonStr = trimmed.startsWith('data: ')
              ? trimmed.slice(6)
              : trimmed.slice(5).trim();
            const payload = JSON.parse(jsonStr);
            parseChatCompletionsStreamEvent(payload, state);
            if (onTextChunk && (state.text || state.reasoningContent)) {
              onTextChunk(state.text, state.reasoningContent);
            }
          } catch {
            continue;
          }
        }
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (buffer) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data:')) {
              try {
                const jsonStr = trimmed.startsWith('data: ')
                  ? trimmed.slice(6)
                  : trimmed.slice(5).trim();
                const payload = JSON.parse(jsonStr);
                parseChatCompletionsStreamEvent(payload, state);
                if (onTextChunk && (state.text || state.reasoningContent)) {
                  onTextChunk(state.text, state.reasoningContent);
                }
              } catch {
                // ignore trailing parse failure
              }
            }
          }

          const responseData = buildChatLikeResponseFromChatStream(state);
          resolve(JSON.stringify(responseData));
        } else {
          const message = errorData || buffer;
          reject(new Error(`HTTP ${res.statusCode}: ${message}`));
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
 * 发送流式对话请求
 * @param {Array} messages - 对话消息数组
 * @param {object} config - AI 配置
 * @param {function} onChunk - 收到内容块时的回调
 * @param {function} registerRequest - 注册请求以便取消
 * @returns {Promise<string>} - 完整的响应内容
 */
function sendStreamingChatRequest(messages, config, onChunk, registerRequest) {
  return new Promise((resolve, reject) => {
    const { endpoint, apiKey, requestType, model, timeout } = config;

    if (!endpoint || !apiKey) {
      reject(new Error('AI endpoint and API key are required'));
      return;
    }

    // 构建请求体
    let requestBody;
    switch (requestType) {
      case 'anthropic':
        requestBody = buildAnthropicRequest(messages, model);
        requestBody.stream = true;
        break;
      case 'openai-response':
        requestBody = buildOpenAIResponseRequest(messages, model, true);
        break;
      case 'openai-chat':
      default:
        requestBody = buildOpenAIChatRequest(messages, model, true);
    }

    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: getRequestPath(endpoint, requestType),
      method: 'POST',
      headers: getStreamingHeaders(requestType, apiKey),
      timeout: timeout || 120000
    };

    const req = httpModule.request(options, res => {
      res.setEncoding('utf8');
      let buffer = '';
      let fullContent = '';
      let fullReasoningContent = '';
      let errorData = '';

      res.on('data', chunk => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          errorData += chunk;
          return;
        }

        buffer += chunk;

        // 按行分割处理SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const parsed = parseStreamChunk(line, requestType);
          if (parsed !== null) {
            if (parsed.content) {
              fullContent += parsed.content;
            }
            if (parsed.reasoningContent) {
              fullReasoningContent += parsed.reasoningContent;
            }
            if (onChunk) {
              onChunk(parsed.content, fullContent, fullReasoningContent);
            }
          }
        }
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 处理最后的缓冲区
          if (buffer) {
            const parsed = parseStreamChunk(buffer, requestType);
            if (parsed !== null) {
              if (parsed.content) {
                fullContent += parsed.content;
              }
              if (parsed.reasoningContent) {
                fullReasoningContent += parsed.reasoningContent;
              }
              if (onChunk) {
                onChunk(parsed.content, fullContent, fullReasoningContent);
              }
            }
          }
          resolve({ content: fullContent, reasoningContent: fullReasoningContent });
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
 * 发送非流式对话请求
 */
function sendChatRequest(messages, config) {
  return new Promise((resolve, reject) => {
    const { endpoint, apiKey, requestType, model, timeout, tools } = config;

    if (!endpoint || !apiKey) {
      reject(new Error('AI endpoint and API key are required'));
      return;
    }

    if (requestType === 'openai-response') {
      sendResponsesStreamForAgent(messages, {
        endpoint,
        apiKey,
        model,
        timeout,
        tools
      })
        .then(resolve)
        .catch(reject);
      return;
    }

    if (requestType === 'openai-chat' && tools && tools.length > 0) {
      sendChatCompletionsStreamForAgent(messages, {
        endpoint,
        apiKey,
        model,
        timeout,
        tools
      })
        .then(resolve)
        .catch(reject);
      return;
    }

    // 构建请求体 (非流式)
    let requestBody;
    switch (requestType) {
      case 'anthropic':
        requestBody = buildAnthropicRequest(messages, model);
        break;
      case 'openai-response':
        requestBody = buildOpenAIResponseRequest(messages, model, false);
        break;
      case 'openai-chat':
      default:
        requestBody = buildOpenAIChatRequest(messages, model, false);
        break;
    }

    // 如果有工具定义，添加到请求体
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: getRequestPath(endpoint, requestType),
      method: 'POST',
      headers: getHeaders(requestType, apiKey),
      timeout: timeout || 120000
    };

    const req = httpModule.request(options, res => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 返回完整响应数据，让调用者解析工具调用
          resolve(data);
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

module.exports = {
  sendResponsesStreamForAgent,
  sendChatCompletionsStreamForAgent,
  sendStreamingChatRequest,
  sendChatRequest
};
