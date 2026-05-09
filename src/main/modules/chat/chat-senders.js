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
const { parseStreamChunk, normalizeToolsForChatCompletions } = require('./stream-parsers');
const {
  sendResponsesStreamForAgent,
  sendChatCompletionsStreamForAgent
} = require('./chat-agent-senders');

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

    // 性能优化：IPC 节流缓冲（每 50ms 发送一次，而不是每条数据块发送一次）
    let pendingChunks = [];
    let throttleTimer = null;
    const THROTTLE_INTERVAL = 50; // ms

    function flushPendingChunks() {
      if (pendingChunks.length > 0 && onChunk) {
        // 合并所有待发送的数据块
        let combinedContent = '';
        let lastFullContent = '';
        let lastReasoningContent = '';

        for (const { content, fullContent, reasoningContent } of pendingChunks) {
          combinedContent += content;
          lastFullContent = fullContent;
          lastReasoningContent = reasoningContent;
        }

        // 一次性发送合并后的数据
        onChunk(combinedContent, lastFullContent, lastReasoningContent);
        pendingChunks = [];
      }
      throttleTimer = null;
    }

    function scheduleChunkFlush() {
      if (throttleTimer) return;
      throttleTimer = setTimeout(flushPendingChunks, THROTTLE_INTERVAL);
    }

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

            // 优化：收集数据块，定期批量发送 IPC 消息
            if (parsed.content || parsed.reasoningContent) {
              pendingChunks.push({
                content: parsed.content,
                fullContent,
                reasoningContent: fullReasoningContent
              });
              scheduleChunkFlush();
            }
          }
        }
      });

      res.on('end', () => {
        // 清理定时器并发送剩余的数据
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        flushPendingChunks(); // 确保发送最后的数据块

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
              // 最后一块数据，直接发送而不缓冲
              if (onChunk && (parsed.content || parsed.reasoningContent)) {
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

    req.on('error', err => {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      reject(err);
    });
    req.on('timeout', () => {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
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
function sendChatRequest(messages, config, registerRequest) {
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
    // 注意：openai-response 类型已在上方通过 sendResponsesStreamForAgent 处理
    let requestBody;
    switch (requestType) {
      case 'anthropic':
        requestBody = buildAnthropicRequest(messages, model);
        break;
      case 'openai-chat':
      default:
        requestBody = buildOpenAIChatRequest(messages, model, false);
        break;
    }

    // 如果有工具定义，添加到请求体（清理非标准属性）
    if (tools && tools.length > 0) {
      requestBody.tools = normalizeToolsForChatCompletions(tools);
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

module.exports = {
  sendResponsesStreamForAgent,
  sendChatCompletionsStreamForAgent,
  sendStreamingChatRequest,
  sendChatRequest
};
