/**
 * AI 历史消息格式化模块
 * 负责历史消息的格式化、还原、配对校验
 * 统一 Ask/Agent 两种模式的消息格式化逻辑，消除重复代码
 */

/**
 * 确保 tool 消息与 assistant+tool_calls 消息配对完整
 * 截断/重组操作可能打破配对，导致 API 400 错误
 * 规则：1) 每个 tool 消息必须有匹配的 assistant+tool_calls
 *       2) assistant+tool_calls 的每个 call_id 必须有对应的 tool 结果
 */
function ensureToolMessagePairing(messages) {
  if (!messages || messages.length <= 1) return messages;

  // 收集所有 assistant+tool_calls 声明的 call id
  const declaredCallIds = new Set();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const call of msg.tool_calls) {
        declaredCallIds.add(call.id);
      }
    }
  }

  // 收集所有有效 tool 消息的 call id
  const presentResultIds = new Set();
  for (const msg of messages) {
    if (msg.role === 'tool' && declaredCallIds.has(msg.tool_call_id)) {
      presentResultIds.add(msg.tool_call_id);
    }
  }

  // 过滤消息：移除孤立项
  return messages.filter(msg => {
    if (msg.role === 'tool') {
      // tool 消息必须有匹配的 assistant+tool_calls
      return declaredCallIds.has(msg.tool_call_id);
    }
    if (msg.role === 'assistant' && msg.tool_calls) {
      // assistant+tool_calls 的所有 call 都必须有对应的 tool 结果
      // 否则 API 也会报错；降级为普通 assistant 消息
      const allHaveResults = msg.tool_calls.every(call => presentResultIds.has(call.id));
      if (!allHaveResults) {
        // 降级：移除 tool_calls，保留文本内容
        delete msg.tool_calls;
        if (!msg.content) msg.content = '';
      }
      return true;
    }
    return true;
  });
}

/**
 * 去除思考标记（仅用于普通消息的API发送）
 * @param {string} content - 消息内容
 * @returns {string} 去除思考标记后的内容
 */
function stripThinkTags(content) {
  if (typeof content !== 'string') return content;
  return content.replace(/<!--think-->[\s\S]*?<!--endthink-->/g, '').trim();
}

/**
 * 恢复 thinking 内容到消息中
 * @param {string} thinkingContent - 思考内容
 * @param {string} actionContent - 行动/正文内容
 * @returns {string} 恢复后的完整内容
 */
function recoverThinkingContent(thinkingContent, actionContent) {
  if (thinkingContent) {
    return `<!--think-->${thinkingContent}<!--endthink-->${actionContent}`;
  }
  return actionContent;
}

/**
 * 格式化历史消息，还原 tool/assistant(tool_calls) 字段
 * 恢复 thinking 内容以保持完整上下文
 * @param {Array} rawHistory - 从 IndexedDB 加载的原始历史消息
 * @returns {Array} 格式化后的消息数组
 */
function formatHistoryMessages(rawHistory) {
  const formatted = rawHistory
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.metadata?.toolCallId || '',
          content: m.content || ''
        };
      }
      if (m.role === 'assistant' && m.metadata?.toolCalls && m.metadata.toolCalls.length > 0) {
        // 恢复 thinking 内容到消息中，防止上下文丢失
        const thinkingContent = m.metadata?.thinkingContent || '';
        const actionContent = m.metadata?.actionContent || '';
        const recoveredContent = recoverThinkingContent(thinkingContent, actionContent);

        return {
          role: 'assistant',
          content: recoveredContent || null,
          tool_calls: m.metadata.toolCalls.map(call => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments || {})
            }
          }))
        };
      }
      // 普通消息：去除思考标记（仅用于UI显示，API不需要）
      const content = stripThinkTags(m.content);
      return { role: m.role, content };
    });

  return ensureToolMessagePairing(formatted);
}

module.exports = {
  ensureToolMessagePairing,
  formatHistoryMessages,
  stripThinkTags,
  recoverThinkingContent
};
