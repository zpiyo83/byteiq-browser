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
const { createAiContextIsolation } = require('../ai/ai-context-isolation');
const { createAiTodoManager } = require('../ai/ai-todo-manager');
const { createAiToolbar } = require('../ai/ai-toolbar');
const { createContextMenu } = require('./ai-context-pie');
const { createContextCompress } = require('./ai-context-compress');
const { createEventManager } = require('./ai-manager-events');

const path = require('path');

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
  const webviewsContainer = documentRef.getElementById('webviews-container');

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
  const contextIsolation = createAiContextIsolation();

  const sessionService = createAiSessionService({
    historyStorage,
    store,
    t,
    getActiveTabId,
    contextIsolation
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

  const todoManager = createAiTodoManager({
    store,
    getActiveSessionId
  });

  const toolsExecutor = createAiToolsExecutor({
    documentRef,
    getActiveTabId,
    extractPageContent,
    openTab: tabManager ? tabManager.createTab : null,
    formatUrl,
    switchTab: tabManager ? tabManager.switchTab : null,
    bindTabToSession: sessionService.bindTabToSession,
    getTodoManager: () => todoManager,
    store
  });

  const BYTEIQ_LOGO_SRC = `file://${path.join(__dirname, '../../../../assets/img/byteiq.png')}`;

  function pickRandomInviteText() {
    const locale = store ? store.get('settings.language', 'zh-CN') : 'zh-CN';
    const lang = (locale || '').toLowerCase();
    const key = lang.startsWith('zh') ? 'ai.agentInvites.zh' : 'ai.agentInvites.en';
    const list = t(key);
    if (!Array.isArray(list) || list.length === 0) {
      return t('ai.welcome');
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function renderAgentEmptyState() {
    const wrapper = documentRef.createElement('div');
    wrapper.className = 'ai-agent-empty-state';

    const img = documentRef.createElement('img');
    img.className = 'ai-agent-empty-logo';
    img.alt = 'ByteIQ';
    img.src = BYTEIQ_LOGO_SRC;

    const text = documentRef.createElement('div');
    text.className = 'ai-agent-empty-text';
    text.textContent = pickRandomInviteText();

    wrapper.appendChild(img);
    wrapper.appendChild(text);
    return wrapper;
  }

  const messageUI = createAiMessageUI({
    aiChatArea,
    documentRef,
    t,
    renderEmptyState: () => renderAgentEmptyState()
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

  const SEND_ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-hidden="true"><path fill="currentColor" d="M2.01,21L23,12L2.01,3L2,10L17,12L2,14L2.01,21Z"/></svg>';
  const STOP_ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-hidden="true"><path fill="currentColor" d="M18,18H6V6H18V18Z"/></svg>';

  const modeSelect = documentRef.getElementById('ai-mode-select');
  let currentMode = 'ask';
  let pendingAttachments = [];

  function setCurrentMode(nextMode) {
    if (!['ask', 'agent'].includes(nextMode)) return;
    currentMode = nextMode;
    if (modeSelect) {
      modeSelect.value = nextMode;
      modeSelect.style.display = 'none';
    }
    if (toolbar && typeof toolbar.closeAllMenus === 'function') {
      toolbar.closeAllMenus();
    }
    if (currentMode === 'agent') {
      contextBar.style.display = 'none';
      return;
    }
    (async () => {
      const session = await getCurrentSession();
      updateContextBar(session?.pageContext);
    })();
  }

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

  if (modeSelect) {
    modeSelect.style.display = 'none';
    modeSelect.addEventListener('change', async e => {
      setCurrentMode(e.target.value);
    });
  }

  const toolbar = createAiToolbar({
    documentRef,
    getCurrentMode: () => currentMode,
    setCurrentMode,
    showToast,
    store,
    onFilesSelected: files => {
      pendingAttachments = files || [];
    }
  });

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
      return { id: tab.id, title, url, active: tab.active, index: index + 1 };
    });
  }

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
    renderSessionChat: (...args) => renderSessionChat(...args),
    syncSessionMessagesToAgent: sessionId => syncSessionMessagesToAgent(sessionId)
  });

  function setInputEnabled(enabled) {
    if (enabled) {
      aiSendBtn.disabled = false;
      aiInput.disabled = false;
      aiSendBtn.innerHTML = SEND_ICON;
      aiSendBtn.classList.remove('stop-btn');
      aiSendBtn.classList.add('send-btn');
      aiInput.focus();
    } else {
      aiInput.disabled = true;
      if (currentMode === 'agent' && agentRunner.isProcessing()) {
        aiSendBtn.disabled = false;
        aiSendBtn.innerHTML = STOP_ICON;
        aiSendBtn.classList.remove('send-btn');
        aiSendBtn.classList.add('stop-btn');
      } else {
        aiSendBtn.disabled = true;
        aiSendBtn.innerHTML = SEND_ICON;
        aiSendBtn.classList.remove('stop-btn');
        aiSendBtn.classList.add('send-btn');
      }
    }
  }

  const agentRunner = createAiAgentRunner({
    ipcRenderer,
    toolsExecutor,
    historyStorage,
    store,
    onIteration: () => contextMenu.updateContextPie(),
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
    getTaskState: () => taskState,
    bindTabToSession: sessionService.bindTabToSession,
    externalTodoManager: todoManager,
    contextIsolation
  });

  const contextMenu = createContextMenu({ store, documentRef, agentRunner });

  const contextCompress = createContextCompress({
    ipcRenderer,
    documentRef,
    agentRunner,
    historyStorage,
    showToast,
    getCurrentSession,
    renderSessionChat: session => renderSessionChat(session),
    estimateHistoryTokens: contextMenu.estimateHistoryTokens,
    updateContextPie: contextMenu.updateContextPie
  });

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
    updateContextBar: ctx => updateContextBar(ctx),
    todoManager,
    contextIsolation
  });

  contextIsolation.onBeforeSwitch(async (_fromId, _toId) => {
    if (agentRunner && typeof agentRunner.abort === 'function') agentRunner.abort();
    if (chatHandler && typeof chatHandler.cancelStreaming === 'function')
      chatHandler.cancelStreaming();
  });

  contextIsolation.onAfterSwitch(async (_toId, _fromId) => {
    if (agentRunner && typeof agentRunner.resetState === 'function') agentRunner.resetState();
    if (chatHandler && typeof chatHandler.resetState === 'function') chatHandler.resetState();
  });

  async function syncSessionMessagesToAgent(sessionId) {
    if (!sessionId) return;
    const dbMessages = await historyStorage.getMessages(sessionId, { limit: 1000 });
    if (dbMessages && dbMessages.length > 0) {
      const syncMessages = dbMessages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {})
      }));
      agentRunner.setMessageHistory(syncMessages);
    } else {
      agentRunner.setMessageHistory([]);
    }
  }

  async function switchToSession(sessionId) {
    if (!sessionId) return;
    const currentContextId = contextIsolation.getActiveSessionId();
    if (currentContextId !== sessionId) {
      await contextIsolation.switchSession(sessionId);
    }
    await ensureSessionExists(sessionId);
    setActiveSessionId(sessionId);
    bindSessionToCurrentTab(sessionId);
    const session = await getSessionById(sessionId);
    await renderSessionsList();
    await renderSessionChat(session);
    await syncSessionMessagesToAgent(sessionId);
    updateContextBar(session?.pageContext);
    contextMenu.updateContextPie();
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
      if (!isReady) return;
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
    renderEmptyState: () => renderAgentEmptyState(),
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

  function updateContextBar(pageContext) {
    if (pageContext && pageContext.content) {
      const title = pageContext.title || pageContext.url;
      contextText.textContent = `${t('ai.contextLoaded') || '已加载'}: ${title}`;
      contextBar.style.display = 'flex';
    } else {
      contextBar.style.display = 'none';
    }
  }

  async function clearCurrentContext() {
    const session = await getCurrentSession();
    if (!session) return;
    await updateSession(session.id, { pageContext: null });
    await historyStorage.clearAll();
    contextBar.style.display = 'none';
    clearChatArea();
    await renderSessionsList();
  }

  // 创建事件管理器
  const eventManager = createEventManager({
    toggleAiBtn,
    newSessionBtn,
    aiSidebar,
    closeAiBtn,
    aiSendBtn,
    aiInput,
    currentModeRef: () => currentMode,
    agentRunner,
    chatHandler,
    contextMenu,
    contextCompress,
    contextClearBtn,
    documentRef,
    createSession,
    bindSessionToCurrentTab,
    switchToSession,
    showToast,
    t,
    syncWebviewMargin,
    getCurrentSession,
    renderSessionsList: (...args) => renderSessionsList(...args),
    renderSessionChat: (...args) => renderSessionChat(...args),
    extractAndSetPageContext,
    extractPageContent,
    updateContextBar,
    updateSession,
    clearCurrentContext,
    getActiveTabId,
    setInputEnabled,
    pendingAttachmentsRef: clear => {
      if (clear) {
        pendingAttachments = [];
      }
      return pendingAttachments;
    },
    bindHistoryPanelEvents,
    toolbar,
    bindAiSidebarResize,
    resizeHandle,
    bindAskSelectionEvent,
    scrollToBottom,
    buildSelectionContext,
    pageContext
  });

  async function bindEvents() {
    await eventManager.bindEvents();

    // 初始化
    const session = await getCurrentSession();
    await renderSessionsList();
    await renderSessionChat(session);
    if (session) {
      await syncSessionMessagesToAgent(session.id);
    }
    contextMenu.updateContextPie();
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
