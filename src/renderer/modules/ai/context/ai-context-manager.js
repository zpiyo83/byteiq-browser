/**
 * AI 上下文管线编排器
 * 统一编排上下文生命周期：extract → store → build prompt → format history → assemble messages
 */

const { extractPageContent } = require('./ai-page-extractor');
const { formatHistoryMessages, ensureToolMessagePairing } = require('./ai-history-formatter');

/**
 * 提取并设置页面上下文到 session
 */
async function extractAndSetPageContext(options) {
  const {
    webview,
    getCurrentSession,
    updateSession,
    updateContextBar,
    renderSessionsList,
    extractPageContentFn = extractPageContent,
    force = false
  } = options;

  const session = await getCurrentSession();
  const previousUrl = session?.pageContext?.url;
  const pageContext = await extractPageContentFn(webview);

  if (pageContext && session && (force || pageContext.url !== previousUrl)) {
    await updateSession(session.id, { pageContext });
    updateContextBar(pageContext);
    await renderSessionsList();
  }
}

/**
 * 创建上下文管理器
 * @param {object} options
 * @param {object} options.promptBuilder - createPromptBuilder 返回的实例
 * @param {object} options.historyStorage - 历史消息存储
 * @param {object} options.store - 配置存储
 */
function createAiContextManager(options) {
  const { promptBuilder, historyStorage, store } = options;

  /**
   * 为 Ask 模式组装完整消息列表
   * @param {object} session - 当前会话
   * @param {string} userText - 用户输入
   * @returns {Promise<Array>} 组装好的 messages 数组
   */
  async function buildMessagesForAsk(session, userText) {
    const systemPrompt = promptBuilder.buildAskSystemPrompt(session);
    const rawHistory = await historyStorage.getMessages(session.id, { limit: 100 });
    const formattedHistory = formatHistoryMessages(rawHistory);
    return [
      { role: 'system', content: systemPrompt },
      ...ensureToolMessagePairing(formattedHistory),
      { role: 'user', content: userText }
    ];
  }

  /**
   * 为 Agent 模式组装初始消息列表
   * @param {object} session - 当前会话
   * @param {string} userText - 用户输入
   * @returns {Promise<{ messages: Array, systemPrompt: string }>} 初始消息和系统提示词
   */
  async function buildMessagesForAgent(session, userText) {
    const systemPrompt = promptBuilder.buildAgentSystemPrompt(session, userText);

    // 还原历史消息格式
    const rawHistory = await historyStorage.getMessages(session.id, { limit: 50 });
    const formattedHistory = formatHistoryMessages(rawHistory);

    // 截断历史消息
    const contextSize = store ? store.get('settings.aiContextSize', 8192) : 8192;
    const maxHistoryMessages = Math.max(8, Math.floor((contextSize * 0.6) / 500));
    const truncatedHistory = promptBuilder.truncateHistorySmart(
      formattedHistory,
      maxHistoryMessages
    );

    // 增强系统提示词
    const enhancedSystemPrompt = promptBuilder.enhanceWithPages(systemPrompt);

    return {
      messages: [
        { role: 'system', content: enhancedSystemPrompt },
        ...truncatedHistory,
        { role: 'user', content: userText }
      ],
      systemPrompt: enhancedSystemPrompt
    };
  }

  return {
    extractAndSetPageContext,
    buildMessagesForAsk,
    buildMessagesForAgent
  };
}

module.exports = {
  createAiContextManager,
  extractAndSetPageContext
};
