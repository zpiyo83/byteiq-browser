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

  // 上下文饼图元素
  const pieUsed = documentRef.getElementById('ai-pie-used');
  const ttUsed = documentRef.getElementById('tt-used');
  const ttUsedK = documentRef.getElementById('tt-used-k');
  const ttRemainK = documentRef.getElementById('tt-remain-k');
  const ttSystem = documentRef.getElementById('tt-system');
  const ttHistory = documentRef.getElementById('tt-history');

  // 简易 token 估算：中文约 1.5 token/字，英文约 1.3 token/4字符
  function estimateTokens(text) {
    if (!text) return 0;
    const str = typeof text === 'string' ? text : JSON.stringify(text);
    let tokens = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      // CJK 字符
      if (code >= 0x4e00 && code <= 0x9fff) {
        tokens += 1.5;
      } else {
        tokens += 0.25;
      }
    }
    return Math.ceil(tokens);
  }

  // 估算消息历史的 token 用量
  function estimateHistoryTokens(messages) {
    if (!Array.isArray(messages)) return { total: 0, system: 0, history: 0 };
    let system = 0;
    let history = 0;
    for (const msg of messages) {
      const msgTokens =
        estimateTokens(msg.content) +
        estimateTokens(JSON.stringify(msg.tool_calls || msg.tool_call_id || ''));
      if (msg.role === 'system') {
        system += msgTokens;
      } else {
        history += msgTokens;
      }
    }
    return { total: system + history, system, history };
  }

  // 更新上下文饼图
  function updateContextPie() {
    if (!pieUsed) return;
    const contextSize = store ? store.get('settings.aiContextSize', 8192) : 8192;
    const messages = agentRunner.getMessageHistory();
    const { total, system, history } = estimateHistoryTokens(messages);
    const pct = Math.min(100, Math.round((total / contextSize) * 100));

    // 更新饼图 SVG
    pieUsed.setAttribute('stroke-dasharray', `${pct} ${100 - pct}`);

    // 根据使用率变色
    if (pct > 90) {
      pieUsed.setAttribute('stroke', '#ef4444');
    } else if (pct > 70) {
      pieUsed.setAttribute('stroke', '#f59e0b');
    } else {
      pieUsed.setAttribute('stroke', '#4285f4');
    }

    // 更新 tooltip
    if (ttUsed) ttUsed.textContent = `${pct}%`;
    if (ttUsedK) ttUsedK.textContent = `${(total / 1000).toFixed(1)}K`;
    if (ttRemainK)
      ttRemainK.textContent = `${(Math.max(0, contextSize - total) / 1000).toFixed(1)}K`;
    if (ttSystem) ttSystem.textContent = `${system}`;
    if (ttHistory) ttHistory.textContent = `${history}`;
  }

  // 工具栏与历史面板
  const newSessionBtn = documentRef.getElementById('ai-new-session-btn');
  const historyBtn = documentRef.getElementById('ai-history-btn');
  const historyPopup = documentRef.getElementById('ai-history-popup');
  const historyListEl = documentRef.getElementById('ai-history-list');
  const closeHistoryBtn = documentRef.getElementById('ai-close-history-btn');
  const resizeHandle = documentRef.getElementById('ai-resize-handle');
  const webviewsContainer = documentRef.getElementById('webviews-container');

  // 同步webview容器边距，避免webview覆盖侧边栏
  function syncWebviewMargin() {
    if (!webviewsContainer) return;
    if (aiSidebar.classList.contains('collapsed')) {
      webviewsContainer.style.marginRight = '';
    } else {
      const width = aiSidebar.offsetWidth || 360;
      webviewsContainer.style.marginRight = `${width}px`;
    }
  }

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
    autoCollapseThinkingDropdown,
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
      let url = tab.url || '';
      if (!url && webview && webview.tagName === 'WEBVIEW') {
        try {
          url = webview.getURL();
        } catch {
          // webview 尚未 dom-ready
        }
      }
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
    store,
    onIteration: updateContextPie,
    updateSession,
    renderSessionsList: (...args) => renderSessionsList(...args),
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    autoCollapseThinkingDropdown,
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
    if (currentMode !== 'agent' && webview && webview.tagName === 'WEBVIEW') {
      let isReady = false;
      try {
        isReady = !webview.isLoading();
      } catch {
        // webview 尚未 dom-ready
      }
      if (!isReady) {
        return;
      }
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
      syncWebviewMargin();

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
      syncWebviewMargin();
    });

    // 发送按钮
    aiSendBtn.addEventListener('click', async () => {
      await chatHandler.handleAISend(aiInput, currentMode);
      updateContextPie();
    });

    // 回车发送
    aiInput.addEventListener('keypress', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        (async () => {
          await chatHandler.handleAISend(aiInput, currentMode);
          updateContextPie();
        })();
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
