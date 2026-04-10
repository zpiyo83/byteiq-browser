/**
 * AI 对话流式解析模块
 * 解析不同格式的流式响应数据块
 */

/**
 * 解析流式响应的单个数据块
 * @returns {{ content: string, reasoningContent: string } | null}
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
      case 'openai-chat': {
        // OpenAI 流式格式: choices[0].delta.content
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) return null;

        const result = { content: '', reasoningContent: '' };
        if (typeof delta.content === 'string') {
          result.content = delta.content;
        }
        // 支持 reasoning_content / thinking / reasoning 字段（部分模型）
        if (typeof delta.reasoning_content === 'string') {
          result.reasoningContent = delta.reasoning_content;
        } else if (typeof delta.thinking === 'string') {
          result.reasoningContent = delta.thinking;
        } else if (typeof delta.reasoning === 'string') {
          result.reasoningContent = delta.reasoning;
        }

        if (result.content || result.reasoningContent) {
          return result;
        }
        return null;
      }

      case 'openai-response':
        // OpenAI Responses API 流式格式:
        // type: 'response.output_text.delta' -> delta
        // type: 'response.output_text.done' -> text
        if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
          return { content: parsed.delta, reasoningContent: '' };
        }
        if (parsed.type === 'response.output_text.done' && typeof parsed.text === 'string') {
          return { content: parsed.text, reasoningContent: '' };
        }
        return null;

      case 'anthropic':
        // Anthropic 流式格式
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          return { content: parsed.delta.text, reasoningContent: '' };
        }
        return null;

      default:
        return null;
    }
  } catch {
    return null;
  }
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

  // 支持 reasoning_content / thinking / reasoning 字段（部分模型）
  const reasoningDelta =
    typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.thinking === 'string'
        ? delta.thinking
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : '';
  if (reasoningDelta) {
    state.reasoningContent = state.reasoningContent || '';
    state.reasoningContent += reasoningDelta;
  }

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
            tool_calls: toolCalls,
            reasoning_content: state.reasoningContent || ''
          }
        }
      ]
    };
  }

  return {
    choices: [
      {
        message: {
          content: state.text || '',
          reasoning_content: state.reasoningContent || ''
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

module.exports = {
  parseStreamChunk,
  parseResponsesStreamEvent,
  buildChatLikeResponseFromResponsesStream,
  parseChatCompletionsStreamEvent,
  buildChatLikeResponseFromChatStream,
  normalizeToolsForResponses
};
