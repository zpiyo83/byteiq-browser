/**
 * AI 对话模块
 * 支持流式对话响应
 */

const https = require('https');
const http = require('http');

/**
 * 构建 OpenAI Chat 格式的对话请求体
 */
function buildOpenAIChatRequest(messages, model = 'gpt-3.5-turbo', stream = true) {
  return {
    model,
    messages,
    max_tokens: 4096,
    temperature: 0.7,
    stream
  };
}

/**
 * 构建 Anthropic 格式的对话请求体
 */
function buildAnthropicRequest(messages, model = 'claude-3-sonnet-20240229') {
  // Anthropic 需要 system 消息单独传递
  let systemPrompt = '';
  const filteredMessages = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else {
      filteredMessages.push(msg);
    }
  }

  const requestBody = {
    model,
    max_tokens: 4096,
    messages: filteredMessages
  };

  if (systemPrompt) {
    requestBody.system = systemPrompt;
  }

  return requestBody;
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

/**
 * 获取流式请求头
 */
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
  if (path.includes('/chat/completions') || path.includes('/messages')) {
    return path + url.search;
  }

  // 否则根据类型添加路径
  switch (requestType) {
    case 'openai-chat':
      return '/v1/chat/completions';
    case 'anthropic':
      return '/v1/messages';
    default:
      return '/v1/chat/completions';
  }
}

/**
 * 解析流式响应的单个数据块
 */
function parseStreamChunk(line, requestType) {
  if (!line) return null;

  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed === 'data: [DONE]' || trimmed === '[DONE]') return null;

  if (!trimmed.startsWith('data:')) return null;

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

      case 'anthropic':
        // Anthropic 流式格式
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
          const content = parseStreamChunk(line, requestType);
          if (content !== null) {
            fullContent += content;
            if (onChunk) {
              onChunk(content, fullContent);
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
              fullContent += content;
              if (onChunk) {
                onChunk(content, fullContent);
              }
            }
          }
          resolve(fullContent);
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
    const { endpoint, apiKey, requestType, model, timeout } = config;

    if (!endpoint || !apiKey) {
      reject(new Error('AI endpoint and API key are required'));
      return;
    }

    // 构建请求体 (非流式)
    let requestBody;
    switch (requestType) {
      case 'anthropic':
        requestBody = buildAnthropicRequest(messages, model);
        break;
      case 'openai-chat':
      default:
        requestBody = buildOpenAIChatRequest(messages, model, false);
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
          try {
            const parsed = JSON.parse(data);
            let content;

            switch (requestType) {
              case 'openai-chat':
                content = parsed.choices?.[0]?.message?.content || '';
                break;
              case 'anthropic':
                content = parsed.content?.[0]?.text || '';
                break;
              default:
                content = parsed.choices?.[0]?.message?.content || '';
            }

            resolve(content);
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

module.exports = {
  sendStreamingChatRequest,
  sendChatRequest
};
