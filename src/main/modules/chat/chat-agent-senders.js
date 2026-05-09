/**
 * AI Agent 专用流式请求发送模块
 * 包含 Agent 模式使用的 OpenAI Response 和 Chat Completions 流式发送函数
 */

const https = require('https');
const http = require('http');
const {
  buildOpenAIResponseRequest,
  buildOpenAIChatRequest,
  getStreamingHeaders,
  getRequestPath
} = require('./request-builders');
const {
  parseResponsesStreamEvent,
  buildChatLikeResponseFromResponsesStream,
  parseChatCompletionsStreamEvent,
  buildChatLikeResponseFromChatStream,
  normalizeToolsForResponses,
  normalizeToolsForChatCompletions
} = require('./stream-parsers');

function sendResponsesStreamForAgent(messages, config, onTextChunk, registerRequest) {
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

function sendChatCompletionsStreamForAgent(messages, config, onTextChunk, registerRequest) {
  return new Promise((resolve, reject) => {
    const { endpoint, apiKey, model, timeout, tools } = config;

    if (!endpoint || !apiKey) {
      reject(new Error('AI endpoint and API key are required'));
      return;
    }

    const requestBody = buildOpenAIChatRequest(messages, model, true);
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

    // 性能优化：IPC 节流缓冲（每 50ms 发送一次）
    let lastFlushText = '';
    let lastFlushReasoningContent = '';
    let throttleTimer = null;
    const THROTTLE_INTERVAL = 50; // ms

    function flushPendingText() {
      if (onTextChunk && (state.text || state.reasoningContent)) {
        onTextChunk(state.text, state.reasoningContent);
        lastFlushText = state.text;
        lastFlushReasoningContent = state.reasoningContent;
      }
      throttleTimer = null;
    }

    function scheduleTextFlush() {
      if (throttleTimer) return;
      throttleTimer = setTimeout(flushPendingText, THROTTLE_INTERVAL);
    }

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

            // 优化：收集新数据，定期批量发送 IPC 消息
            if (
              state.text !== lastFlushText ||
              state.reasoningContent !== lastFlushReasoningContent
            ) {
              scheduleTextFlush();
            }
          } catch {
            continue;
          }
        }
      });

      res.on('end', () => {
        // 清理定时器并发送剩余的数据
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        flushPendingText(); // 确保发送最后的数据

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
                // 最后一块数据，直接发送
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

module.exports = {
  sendResponsesStreamForAgent,
  sendChatCompletionsStreamForAgent
};
