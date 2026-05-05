/**
 * AI 上下文工具 - 兼容性层
 * 重新导出拆分后的模块，保持向后兼容
 */

// 从拆分后的模块重新导出
const {
  EXTRACT_PAGE_CONTENT_SCRIPT,
  extractPageContent,
  isWebviewNotReadyError
} = require('./ai-page-extractor');

const { createPromptBuilder, buildSelectionContext } = require('./ai-prompt-builder');

const { extractAndSetPageContext } = require('./ai-context-manager');

// 为了向后兼容，创建一个默认的 promptBuilder 实例
// 注意：实际使用中应该通过 createPromptBuilder 创建实例
const defaultPromptBuilder = createPromptBuilder({
  todoManager: null,
  getPageList: () => [],
  getCurrentPageInfo: () => null,
  getTaskState: () => null,
  t: key => key
});

// 兼容旧 API
function buildSystemPrompt(options) {
  const {
    mode,
    pageContext,
    pageList,
    includePageContext = true,
    currentPageInfo,
    taskState,
    t
  } = options;
  const safeT = typeof t === 'function' ? t : key => key;

  // 根据模式调用对应的构建器
  if (mode === 'agent') {
    // Agent 模式使用专门的构建器
    const mockSession = { mode, pageContext };
    return defaultPromptBuilder.buildAgentSystemPrompt(mockSession, '');
  } else {
    // Ask 模式使用 Ask 构建器
    const mockSession = { mode, pageContext };
    let prompt = defaultPromptBuilder.buildAskSystemPrompt(mockSession);

    // 如果有页面列表，手动添加（Ask 模式通常不需要）
    if (Array.isArray(pageList) && pageList.length > 0) {
      prompt += defaultPromptBuilder.enhanceWithPages('');
    }

    // 如果有任务状态，手动添加（Ask 模式通常不需要）
    if (taskState) {
      if (taskState.goal) prompt += `\n\n目标: ${taskState.goal}`;
      if (Array.isArray(taskState.completedSteps) && taskState.completedSteps.length > 0) {
        prompt += `\n已完成步骤:\n${taskState.completedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
      }
      if (taskState.currentPage) prompt += `\n当前所在页面: ${taskState.currentPage}`;
      if (taskState.lastAction) prompt += `\n上一步操作: ${taskState.lastAction}`;
    }

    return prompt;
  }
}

// 兼容旧 API - 从 promptBuilder 中提取
function buildPagesSummary(pages) {
  // 使用 promptBuilder 的内部函数（通过重新实现保持兼容）
  if (!Array.isArray(pages) || pages.length === 0) return '';
  const limit = 10;
  const lines = pages.slice(0, limit).map((p, i) => {
    const title = String(p.title || p.url || '未命名页面');
    const url = p.url ? ` | ${p.url}` : '';
    const active = p.active ? ' [当前]' : '';
    const id = p.id ? ` | tab_id=${p.id}` : '';
    return `${i + 1}. ${title}${active}${url}${id}`;
  });
  if (pages.length > limit) lines.push(`...还有${pages.length - limit}个页面`);
  return lines.join('\n');
}

// 重新导出所有旧 API 以保持兼容
module.exports = {
  // 页面提取相关
  EXTRACT_PAGE_CONTENT_SCRIPT,
  extractPageContent,
  isWebviewNotReadyError,

  // Prompt 构建相关
  buildSystemPrompt,
  buildSelectionContext,
  buildPagesSummary,

  // 上下文管理相关
  extractAndSetPageContext,

  // 新的构建器（供新代码使用）
  createPromptBuilder
};
