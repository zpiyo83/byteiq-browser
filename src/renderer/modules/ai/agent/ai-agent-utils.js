/**
 * AI Agent 工具函数
 * 包含工具结果截断、工具提示词注入等通用逻辑
 */

// 工具结果内容截断阈值（字符数），超过此长度的内容只保留摘要
const TOOL_RESULT_MAX_CHARS = 3000;

// 需要截断的工具名集合（返回大量页面内容的工具）
const LARGE_RESULT_TOOLS = new Set(['get_page_info', 'search_page']);

/**
 * 截断工具结果内容，防止内存膨胀和 IPC 传输过大
 * 对于 get_page_info/search_page 等大结果工具，只保留摘要信息
 * @param {string} toolName - 工具名
 * @param {*} toolResult - 工具执行结果
 * @returns {{ content: string, summary: string }} 截断后的内容和摘要
 */
function truncateToolResult(toolName, toolResult) {
  const fullContent = JSON.stringify(toolResult);

  // 非大结果工具：仅做长度截断
  if (!LARGE_RESULT_TOOLS.has(toolName)) {
    if (fullContent.length <= TOOL_RESULT_MAX_CHARS) {
      return { content: fullContent, summary: fullContent };
    }
    return {
      content: fullContent.substring(0, TOOL_RESULT_MAX_CHARS) + '...[truncated]',
      summary: fullContent.substring(0, TOOL_RESULT_MAX_CHARS) + '...[truncated]'
    };
  }

  // 大结果工具：提取摘要字段，丢弃页面正文和控件列表
  const summary = {
    success: toolResult?.success,
    error: toolResult?.error || '',
    tabId: toolResult?.tabId || '',
    url: toolResult?.url || '',
    title: toolResult?.title || '',
    message: toolResult?.message || ''
  };

  // 如果有 meta 信息，保留简短版本
  if (toolResult?.meta) {
    summary.meta = {
      description: (toolResult.meta.description || '').substring(0, 200),
      keywords: (toolResult.meta.keywords || '').substring(0, 100)
    };
  }

  // 如果有 content，只保留前 500 字符
  if (toolResult?.content && typeof toolResult.content === 'string') {
    summary.contentPreview = toolResult.content.substring(0, 500);
    if (toolResult.content.length > 500) {
      summary.contentPreview += '...[truncated]';
    }
    summary.contentLength = toolResult.content.length;
  }

  // 如果有 controls，只保留数量统计
  if (toolResult?.controls) {
    summary.controlsCount = {
      buttons: toolResult.controls.buttons?.length || 0,
      inputs: toolResult.controls.inputs?.length || 0,
      links: toolResult.controls.links?.length || 0
    };
  }

  const summaryStr = JSON.stringify(summary);
  return { content: summaryStr, summary: summaryStr };
}

/**
 * 将工具提示词注入到 messages 中（合并到已有的 system 消息或新建）
 * @param {Array} messages - 消息数组
 * @param {string} toolsPrompt - 工具提示词
 * @returns {Array} 注入后的消息数组
 */
function injectToolsPrompt(messages, toolsPrompt) {
  const result = [...messages];
  if (result.length > 0 && result[0].role === 'system') {
    result[0] = { ...result[0], content: result[0].content + '\n\n' + toolsPrompt };
  } else {
    result.unshift({ role: 'system', content: toolsPrompt });
  }
  return result;
}

module.exports = {
  TOOL_RESULT_MAX_CHARS,
  LARGE_RESULT_TOOLS,
  truncateToolResult,
  injectToolsPrompt
};
