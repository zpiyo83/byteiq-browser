/**
 * AI 对话请求构建模块
 * 构建不同格式的对话请求体、请求头、请求路径
 */

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

module.exports = {
  buildOpenAIChatRequest,
  buildOpenAIResponseRequest,
  buildAnthropicRequest,
  getHeaders,
  getStreamingHeaders,
  getRequestPath,
  buildResponsesInputFromMessages
};
