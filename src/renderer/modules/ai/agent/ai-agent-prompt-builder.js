/**
 * AI Agent 提示词构建器 - 兼容性层
 * 重新导出新的统一 prompt 构建器，保持向后兼容
 */

const { createPromptBuilder } = require('../context/ai-prompt-builder');
const {
  formatHistoryMessages,
  ensureToolMessagePairing
} = require('../context/ai-history-formatter');

/**
 * 创建 Agent 提示词构建器（兼容旧接口）
 * @param {object} options - 选项
 * @returns {object} 兼容旧接口的构建器实例
 */
function createAgentPromptBuilder(options) {
  const { todoManager, getPageList, getCurrentPageInfo, getTaskState, t, buildSystemPrompt } =
    options;

  // 创建新的统一构建器实例
  const unifiedBuilder = createPromptBuilder({
    todoManager,
    getPageList,
    getCurrentPageInfo,
    getTaskState,
    t
  });

  // 返回兼容旧接口的对象
  return {
    // Agent 模式专用方法（直接代理到新构建器）
    buildAgentSystemPrompt: unifiedBuilder.buildAgentSystemPrompt,

    // 历史消息格式化（代理到 history-formatter）
    formatHistoryMessages,

    // 截断方法（代理到新构建器）
    truncateHistorySmart: unifiedBuilder.truncateHistorySmart,
    truncateLiveHistory: unifiedBuilder.truncateLiveHistory,

    // 增强页面列表（代理到新构建器）
    enhanceSystemPromptWithPages: unifiedBuilder.enhanceWithPages,

    // 刷新 todo（代理到新构建器）
    refreshTodoInSystemPrompt: unifiedBuilder.refreshTodoInSystemPrompt,

    // 配对校验（代理到 history-formatter）
    ensureToolMessagePairing
  };
}

// 重新导出以保持兼容
module.exports = {
  createAgentPromptBuilder,
  ensureToolMessagePairing // 直接从 history-formatter 导出
};
