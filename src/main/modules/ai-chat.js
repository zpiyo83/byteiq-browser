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
 * 构建 OpenAI Response 格式的对话请求体
 */
function buildOpenAIResponseRequest(messages, model = 'gpt-4', stream = true) {
  // 将 messages 转换为 Responses API 的 input items 格式
  const { items, instructions } = buildResponsesInputFromMessages(messages);

  const requestBody = {
    model,
    input: items,
    max_output_tokens: 4096
  };

  if (instructions) {
    requestBody.instructions = instructions;
  }

  if (stream) {
    requestBody.stream = true;
  }

  return requestBody;
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

function buildResponsesInputFromMessages(messages) {
  const items = [];
  const systemParts = [];
  const list = Array.isArray(messages) ? messages : [];

  for (const message of list) {
    if (!message) continue;

    if (message.role === 'system') {
      if (message.content != null) {
        if (typeof message.content === 'string') {
          systemParts.push(message.content);
        } else {
          systemParts.push(JSON.stringify(message.content));
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      if (message.tool_call_id) {
        items.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: message.content == null ? '' : String(message.content)
        });
      }
      continue;
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      for (const call of message.tool_calls) {
        const callId = call.id || call.call_id || '';
        const func = call.function || {};
        const name = call.name || func.name || '';
        const args = call.arguments || func.arguments || {};
        if (!callId || !name) continue;
        items.push({
          type: 'function_call',
          call_id: callId,
          name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args)
        });
      }

      if (message.content) {
        items.push({
          type: 'message',
          role: message.role || 'assistant',
          content: String(message.content)
        });
      }
      continue;
    }

    const content = message.content == null ? '' : String(message.content);
    items.push({
      type: 'message',
      role: message.role || 'user',
      content
    });
  }

  return {
    items,
    instructions: systemParts.length > 0 ? systemParts.join('\n\n') : ''
  };
}

function parseResponsesStreamEvent(payload, state) {
  if (!payload || typeof payload !== 'object') return;

  switch (payload.type) {
    case 'response.output_text.delta':
      if (typeof payload.delta === 'string') {
        state.text += payload.delta;
      }
      break;
    case 'response.output_text.done':
      if (!state.text && typeof payload.text === 'string') {
        state.text = payload.text;
      }
      break;
    case 'response.output_item.added': {
      const item = payload.item;
      if (!item || item.type !== 'function_call') return;
      const itemId = item.id || item.item_id || item.call_id;
      if (!itemId) return;
      const entry = state.toolCallsByItemId.get(itemId) || {
        id: item.call_id || item.id || itemId,
        name: '',
        arguments: ''
      };
      entry.id = item.call_id || entry.id;
      entry.name = item.name || entry.name;
      if (typeof item.arguments === 'string' && item.arguments) {
        entry.arguments = item.arguments;
      }
      state.toolCallsByItemId.set(itemId, entry);
      break;
    }
    case 'response.function_call_arguments.delta': {
      const itemId = payload.item_id || payload.id || payload.call_id;
      if (!itemId || typeof payload.delta !== 'string') return;
      const entry = state.toolCallsByItemId.get(itemId) || {
        id: itemId,
        name: '',
        arguments: ''
      };
      entry.arguments += payload.delta;
      state.toolCallsByItemId.set(itemId, entry);
      break;
    }
    case 'response.function_call_arguments.done': {
      const itemId = payload.item_id || payload.id || payload.call_id;
      if (!itemId) return;
      const entry = state.toolCallsByItemId.get(itemId) || {
        id: itemId,
        name: '',
        arguments: ''
      };
      if (typeof payload.arguments === 'string') {
        entry.arguments = payload.arguments;
      }
      state.toolCallsByItemId.set(itemId, entry);
      break;
    }
    case 'response.output_item.done': {
      const item = payload.item;
      if (!item || item.type !== 'function_call') return;
      const itemId = item.id || item.item_id || item.call_id;
      if (!itemId) return;
      const entry = state.toolCallsByItemId.get(itemId) || {
        id: item.call_id || item.id || itemId,
        name: '',
        arguments: ''
      };
      entry.id = item.call_id || entry.id;
      entry.name = item.name || entry.name;
      if (typeof item.arguments === 'string' && item.arguments) {
        entry.arguments = item.arguments;
      }
      state.toolCallsByItemId.set(itemId, entry);
      break;
    }
    default:
      break;
  }
}

function buildChatLikeResponseFromResponsesStream(state) {
  const toolCalls = Array.from(state.toolCallsByItemId.values()).filter(call => call.name);

  if (toolCalls.length > 0) {
    return {
      choices: [
        {
          message: {
            content: null,
            tool_calls: toolCalls.map(call => ({
              id: call.id,
              type: 'function',
              function: {
                name: call.name,
                arguments: call.arguments || '{}'
              }
            }))
          }
        }
      ]
    };
  }

  return {
    choices: [
      {
        message: {
          content: state.text || ''
        }
      }
    ]
  };
}

function parseChatCompletionsStreamEvent(payload, state) {
  const choice = payload?.choices?.[0];
  const delta = choice?.delta;
  if (!delta) return;

  if (typeof delta.content === 'string') {
    state.text += delta.content;
  }

  if (Array.isArray(delta.tool_calls)) {
    for (let i = 0; i < delta.tool_calls.length; i++) {
      const call = delta.tool_calls[i];
      const index = typeof call.index === 'number' ? call.index : i;
      const entry = state.toolCallsByIndex.get(index) || {
        id: call.id || '',
        type: call.type || 'function',
        function: {
          name: '',
          arguments: ''
        }
      };

      if (call.id) entry.id = call.id;
      if (call.type) entry.type = call.type;

      if (call.function?.name) {
        entry.function.name = call.function.name;
      }

      if (typeof call.function?.arguments === 'string') {
        entry.function.arguments += call.function.arguments;
      }

      state.toolCallsByIndex.set(index, entry);
    }
  }
}

function buildChatLikeResponseFromChatStream(state) {
  const toolCalls = Array.from(state.toolCallsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(entry => entry[1])
    .filter(call => call.function?.name);

  if (toolCalls.length > 0) {
    return {
      choices: [
        {
          message: {
            content: null,
            tool_calls: toolCalls
          }
        }
      ]
    };
  }

  return {
    choices: [
      {
        message: {
          content: state.text || ''
        }
      }
    ]
  };
}

function normalizeToolsForResponses(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map(tool => {
    if (tool && tool.type === 'function') {
      if (tool.name && tool.parameters) {
        return tool;
      }
      if (tool.function && tool.function.name) {
        return {
          type: 'function',
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: tool.function.parameters || { type: 'object', properties: {} }
        };
      }
    }
    return tool;
  });
}

function sendResponsesStreamForAgent(messages, config) {
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

function sendChatCompletionsStreamForAgent(messages, config) {
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
  sendStreamingChatRequest,
  sendChatRequest
};
