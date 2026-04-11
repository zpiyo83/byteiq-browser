/**
 * AI 助手管理器入口
 * 负责编排子模块，绑定事件
 */

const { getAIHistoryStorage } = require('../storage/ai-history-storage');
const { createAiToolsExecutor } = require('../ai/ai-tools-executor');
const { createAiSessionService } = require('../ai/ai-session-service');
const { createAiMessageUI } = require('../ai/ai-message-ui');
const { createAiHistoryUI } = require('../ai/ai-history-ui');
const { bindAiSidebarResize, bindAskSelectionEvent } = require('../ai/ai-sidebar-events');
const {
  extractPageContent,
  buildSelectionContext,
  buildSystemPrompt,
  extractAndSetPageContext
} = require('../ai/ai-context-utils');
const { createAiAgentRunner } = require('../ai/ai-agent-runner');
const { createAiPageContext } = require('../ai/ai-page-context');
const { createAiChatHandler } = require('../ai/ai-chat-handler');

function createAiManager(options) {
  const {
    aiChatArea,
    aiInput,
    aiSendBtn,
    aiSidebar,
    closeAiBtn,
    documentRef,
    getActiveTabId,
    t,
    toggleAiBtn,
    ipcRenderer,
    store,
    showToast,
    tabManager,
    formatUrl
  } = options;

  // 上下文状态栏元素
  const contextBar = documentRef.getElementById('ai-context-bar');
  const contextText = documentRef.getElementById('ai-context-text');
  const contextClearBtn = documentRef.getElementById('ai-context-clear-btn');

  // 工具栏与历史面板
  const newSessionBtn = documentRef.getElementById('ai-new-session-btn');
  const historyBtn = documentRef.getElementById('ai-history-btn');
  const historyPopup = documentRef.getElementById('ai-history-popup');
  const historyListEl = documentRef.getElementById('ai-history-list');
  const closeHistoryBtn = documentRef.getElementById('ai-close-history-btn');
  const resizeHandle = documentRef.getElementById('ai-resize-handle');

  const historyStorage = getAIHistoryStorage();

  const toolsExecutor = createAiToolsExecutor({
    documentRef,
    getActiveTabId,
    extractPageContent,
    openTab: tabManager ? tabManager.createTab : null,
    formatUrl,
    switchTab: tabManager ? tabManager.switchTab : null
  });

  const sessionService = createAiSessionService({
    historyStorage,
    store,
    t,
    getActiveTabId
  });

  const {
    getSortedSessions,
    getCurrentSession,
    getSessionById,
    ensureSessionExists,
    updateSession,
    getOrCreateSessionIdForTab,
    bindSessionToCurrentTab,
    unbindSessionFromTab,
    unbindSessionFromAllTabs,
    getActiveSessionId,
    setActiveSessionId,
    readTabToSessionFromStore,
    createSession,
    clearTabConversation
  } = sessionService;

  const messageUI = createAiMessageUI({
    aiChatArea,
    documentRef,
    t
  });

  const {
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    scrollToBottom,
    clearChatArea
  } = messageUI;
  let renderSessionsList = async () => {};
  let renderSessionChat = async () => {};

  function setInputEnabled(enabled) {
    aiSendBtn.disabled = !enabled;
    aiInput.disabled = !enabled;
    if (enabled) {
      aiInput.focus();
    }
  }

  // AI 模式选择
  const modeSelect = documentRef.getElementById('ai-mode-select');
  let currentMode = 'ask'; // 'ask' 或 'agent'

  // Agent任务状态追踪
  let taskState = null;

  function updateTaskState(patch) {
    if (!taskState) {
      taskState = { goal: '', completedSteps: [], currentPage: '', lastAction: '' };
    }
    Object.assign(taskState, patch);
  }

  function resetTaskState() {
    taskState = null;
  }

  // 模式切换事件监听
  if (modeSelect) {
    modeSelect.addEventListener('change', async e => {
      currentMode = e.target.value;
      if (currentMode === 'agent') {
        contextBar.style.display = 'none';
        return;
      }
      const session = await getCurrentSession();
      updateContextBar(session?.pageContext);
    });
  }

  function getPageListSnapshot() {
    if (!tabManager || typeof tabManager.getTabsSnapshot !== 'function') {
      return [];
    }
    const tabs = tabManager.getTabsSnapshot();
    return tabs.map((tab, index) => {
      const webview = documentRef.getElementById(`webview-${tab.id}`);
      const url = tab.url || (webview && webview.tagName === 'WEBVIEW' ? webview.getURL() : '');
      const title = tab.title || url || t('tabs.newTab');
      return {
        id: tab.id,
        title,
        url,
        active: tab.active,
        index: index + 1
      };
    });
  }

  // 创建页面上下文管理器
  const pageContext = createAiPageContext({
    documentRef,
    getActiveTabId,
    t,
    getCurrentSession,
    updateSession,
    updateContextBar: ctx => updateContextBar(ctx),
    renderSessionsList: (...args) => renderSessionsList(...args),
    aiSidebar,
    getOrCreateSessionIdForTab,
    setActiveSessionId,
    readTabToSessionFromStore,
    renderSessionChat: (...args) => renderSessionChat(...args)
  });

  const agentRunner = createAiAgentRunner({
    ipcRenderer,
    toolsExecutor,
    historyStorage,
    updateSession,
    renderSessionsList: (...args) => renderSessionsList(...args),
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    documentRef,
    t,
    buildSystemPrompt,
    setInputEnabled,
    getPageList: getPageListSnapshot,
    getCurrentPageInfo: pageContext.getCurrentPageInfo,
    updateTaskState,
    resetTaskState,
    getTaskState: () => taskState
  });

  // 创建聊天处理器
  const chatHandler = createAiChatHandler({
    ipcRenderer,
    historyStorage,
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    setInputEnabled,
    getCurrentSession,
    updateSession,
    renderSessionsList,
    getCurrentPageInfo: pageContext.getCurrentPageInfo,
    t,
    agentRunner,
    extractAndSetPageContext,
    extractPageContent,
    getActiveTabId,
    documentRef,
    updateContextBar: ctx => updateContextBar(ctx)
  });

  async function switchToSession(sessionId) {
    if (!sessionId) return;
    await ensureSessionExists(sessionId);
    setActiveSessionId(sessionId);
    bindSessionToCurrentTab(sessionId);
    const session = await getSessionById(sessionId);
    await renderSessionsList();
    await renderSessionChat(session);
    updateContextBar(session?.pageContext);
    if (currentMode === 'agent') {
      contextBar.style.display = 'none';
    }

    const tabId = getActiveTabId();
    const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
    if (
      currentMode !== 'agent' &&
      webview &&
      webview.tagName === 'WEBVIEW' &&
      !webview.isLoading()
    ) {
      await extractAndSetPageContext({
        tabId,
        webview,
        getCurrentSession,
        updateSession,
        updateContextBar,
        renderSessionsList,
        extractPageContentFn: extractPageContent
      });
    }
  }

  const historyUI = createAiHistoryUI({
    documentRef,
    historyListEl,
    historyPopup,
    historyBtn,
    closeHistoryBtn,
    historyStorage,
    t,
    getSortedSessions,
    getActiveSessionId,
    getCurrentSession,
    getActiveTabId,
    updateSession,
    unbindSessionFromTab,
    unbindSessionFromAllTabs,
    setActiveSessionId,
    onSelectSession: switchToSession,
    addChatMessage,
    aiChatArea
  });
  renderSessionsList = historyUI.renderSessionsList;
  renderSessionChat = historyUI.renderSessionChat;
  const { bindHistoryPanelEvents } = historyUI;

  /**
   * 更新上下文状态栏
   */
  function updateContextBar(pageContext) {
    if (pageContext && pageContext.content) {
      const title = pageContext.title || pageContext.url;
      contextText.textContent = `${t('ai.contextLoaded') || '已加载'}: ${title}`;
      contextBar.style.display = 'flex';
    } else {
      contextBar.style.display = 'none';
    }
  }

  /**
   * 清除当前上下文
   */
  async function clearCurrentContext() {
    const session = await getCurrentSession();
    if (!session) return;
    await updateSession(session.id, {
      pageContext: null
    });
    await historyStorage.clearAll();
    contextBar.style.display = 'none';
    clearChatArea();
    await renderSessionsList();
  }

  /**
   * 绑定事件
   */
  async function bindEvents() {
    toggleAiBtn.style.display = 'flex';

    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', async () => {
        const session = await createSession();
        bindSessionToCurrentTab(session.id);
        await switchToSession(session.id);
        if (showToast) {
          showToast(t('ai.sessionCreated') || '已新建会话', 'info');
        }
      });
    }

    // 切换AI侧边栏
    toggleAiBtn.addEventListener('click', async () => {
      const wasCollapsed = aiSidebar.classList.contains('collapsed');
      aiSidebar.classList.toggle('collapsed');

      if (wasCollapsed) {
        const tabId = getActiveTabId();
        const webview = documentRef.getElementById(`webview-${tabId}`);
        if (webview && webview.tagName === 'WEBVIEW') {
          const session = await getCurrentSession();
          await renderSessionsList();
          await renderSessionChat(session);
          if (currentMode !== 'agent') {
            await extractAndSetPageContext({
              tabId,
              webview,
              getCurrentSession,
              updateSession,
              updateContextBar,
              renderSessionsList,
              extractPageContentFn: extractPageContent
            });
          }
        }
      }
    });

    // 关闭按钮
    closeAiBtn.addEventListener('click', () => {
      aiSidebar.classList.add('collapsed');
    });

    // 发送按钮
    aiSendBtn.addEventListener('click', () => chatHandler.handleAISend(aiInput, currentMode));

    // 回车发送
    aiInput.addEventListener('keypress', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatHandler.handleAISend(aiInput, currentMode);
      }
    });

    // 设置流式响应监听
    chatHandler.setupStreamingListener();
    agentRunner.setupAgentStreamingListener();

    // 清除上下文按钮
    if (contextClearBtn) {
      contextClearBtn.addEventListener('click', clearCurrentContext);
    }

    bindHistoryPanelEvents();

    bindAiSidebarResize({
      documentRef,
      resizeHandle,
      aiSidebar
    });

    bindAskSelectionEvent({
      windowRef: window,
      aiSidebar,
      aiInput,
      getActiveTabId,
      documentRef,
      t,
      showToast,
      getCurrentSession,
      updateSession,
      updateContextBar,
      renderSessionsList,
      renderSessionChat,
      scrollToBottom,
      buildSelectionContext
    });

    // 初始化页面状态指示器
    pageContext.initPageStatus();

    // 初始化
    const session = await getCurrentSession();
    await renderSessionsList();
    await renderSessionChat(session);
  }

  return {
    bindEvents,
    onTabChanged: tabId => pageContext.onTabChanged(tabId, currentMode),
    onPageChanged: (tabId, url) => pageContext.onPageChanged(tabId, url, currentMode),
    clearTabConversation
  };
}

module.exports = {
  createAiManager
};
