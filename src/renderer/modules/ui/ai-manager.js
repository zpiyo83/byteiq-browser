/**
 * AI 助手管理器
 * 负责AI对话、页面内容提取功能
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

  // 页面状态指示器
  const pageStatusBar = documentRef.getElementById('ai-page-status');
  const pageStatusText = documentRef.getElementById('ai-page-status-text');

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

  // 当前流式响应状态
  let currentStreamingElement = null;
  let currentTaskId = null;
  let isStreaming = false;

  // AI 模式选择
  const modeSelect = documentRef.getElementById('ai-mode-select');
  let currentMode = 'ask'; // 'ask' 或 'agent'

  // Agent任务状态追踪
  let taskState = null;

  // 当前页面信息缓存（用于动态注入）
  let lastKnownPageInfo = null;

  /**
   * 获取当前页面实时信息（轻量级，不提取完整内容）
   */
  function getCurrentPageInfo() {
    const tabId = getActiveTabId();
    const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
    if (!webview || webview.tagName !== 'WEBVIEW') return null;
    const loading = typeof webview.isLoading === 'function' ? webview.isLoading() : false;
    let title = '';
    let url = '';
    try {
      url = typeof webview.getURL === 'function' ? webview.getURL() : '';
      title = webview.getTitle?.() || '';
    } catch {
      // webview尚未加载完成
    }
    return { title, url, loading, tabId };
  }

  /**
   * 更新页面状态指示器UI
   */
  function updatePageStatusUI(pageInfo) {
    if (!pageStatusBar || !pageStatusText) return;
    if (!pageInfo || !pageInfo.url) {
      pageStatusBar.style.display = 'none';
      return;
    }
    const shortTitle = pageInfo.title || pageInfo.url;
    pageStatusText.textContent = pageInfo.loading ? `加载中: ${shortTitle}` : shortTitle;
    pageStatusBar.style.display = 'flex';
  }

  /**
   * 页面变化时的处理：更新状态指示器和AI上下文
   */
  function onPageChanged(tabId, _url) {
    const pageInfo = getCurrentPageInfo();
    if (!pageInfo) return;

    // 检测页面是否变化
    const changed = lastKnownPageInfo && lastKnownPageInfo.url !== pageInfo.url;
    lastKnownPageInfo = pageInfo;

    updatePageStatusUI(pageInfo);

    // 页面变化时闪烁提示
    if (changed && pageStatusBar) {
      pageStatusBar.classList.add('changed');
      setTimeout(() => pageStatusBar.classList.remove('changed'), 600);
    }

    // Ask模式：自动更新session的pageContext（延迟提取，避免阻塞导航）
    if (currentMode !== 'agent') {
      const webview = documentRef.getElementById(`webview-${tabId}`);
      if (webview && webview.tagName === 'WEBVIEW' && !webview.isLoading()) {
        extractAndSetPageContext({
          webview,
          getCurrentSession,
          updateSession,
          updateContextBar,
          renderSessionsList,
          extractPageContentFn: extractPageContent
        }).catch(err => console.error('Auto-extract page context failed:', err));
      }
    }
  }

  /**
   * 更新Agent任务状态
   */
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
    getCurrentPageInfo,
    updateTaskState,
    resetTaskState,
    getTaskState: () => taskState
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
   * 监听流式响应
   */
  function setupStreamingListener() {
    ipcRenderer.on('ai-chat-streaming', (_event, data) => {
      if (!isStreaming || !currentStreamingElement) return;
      if (data.taskId !== currentTaskId) return;

      // 组合思考内容和正文内容用于显示
      const fullText = data.reasoningContent
        ? `<!--think-->${data.reasoningContent}<!--endthink-->${data.accumulated}`
        : data.accumulated;
      updateStreamingMessage(currentStreamingElement, fullText);
    });
  }

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
    // 清除所有消息
    await historyStorage.clearAll();
    contextBar.style.display = 'none';
    clearChatArea();
    await renderSessionsList();
  }

  /**
   * 当标签页切换时自动提取内容
   */
  async function onTabChanged(tabId) {
    if (!tabId) return;

    const webview = documentRef.getElementById(`webview-${tabId}`);
    if (!webview || webview.tagName !== 'WEBVIEW') {
      return;
    }

    // 等待页面加载完成
    if (webview.isLoading && webview.isLoading()) {
      return;
    }

    // 检查AI侧边栏是否打开
    if (aiSidebar.classList.contains('collapsed')) {
      return;
    }

    await getOrCreateSessionIdForTab(tabId);
    setActiveSessionId(readTabToSessionFromStore()[tabId]);
    await renderSessionsList();
    const session = await getCurrentSession();
    await renderSessionChat(session);

    // 提取页面内容
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

  /**
   * 发送对话请求
   */
  async function sendChatRequest(messages, sessionId, streamingElement = null) {
    currentTaskId = `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    isStreaming = true;
    currentStreamingElement = streamingElement;

    // 禁用发送按钮
    setInputEnabled(false);

    try {
      const result = await ipcRenderer.invoke('ai-chat', {
        messages,
        taskId: currentTaskId
      });

      if (result.success) {
        // 保存AI回复到IndexedDB（包含思考内容标记）
        if (sessionId) {
          const savedContent = result.reasoningContent
            ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content}`
            : result.content;
          await historyStorage.addMessage(sessionId, {
            role: 'assistant',
            content: savedContent
          });
          // 更新session时间
          await updateSession(sessionId, { updatedAt: Date.now() });
        }

        if (streamingElement) {
          finishStreamingMessage(streamingElement);
        } else {
          addChatMessage(result.content, 'ai');
        }

        renderSessionsList();
      } else if (result.cancelled) {
        if (streamingElement) {
          streamingElement.classList.add('cancelled');
          streamingElement.innerText = t('ai.cancelled') || '已取消';
        }
      } else {
        throw new Error(result.error);
      }
    } finally {
      isStreaming = false;
      currentStreamingElement = null;
      currentTaskId = null;

      // 恢复发送按钮
      setInputEnabled(true);
    }
  }

  /**
   * 处理用户发送消息
   */
  async function handleAISend() {
    const text = aiInput.value.trim();
    if (!text || isStreaming) return;

    const session = await getCurrentSession();
    if (!session) return;

    // 添加用户消息到UI
    addChatMessage(text, 'user');
    aiInput.value = '';

    // 保存用户消息到IndexedDB
    await historyStorage.addMessage(session.id, {
      role: 'user',
      content: text
    });

    // 首条消息自动生成会话标题
    const defaultTitle = t('ai.sessionUntitled') || '新会话';
    if (session.title === defaultTitle || session.title === '当前标签页') {
      const autoTitle = text.length > 30 ? text.slice(0, 30) + '...' : text;
      await updateSession(session.id, { title: autoTitle });
    }

    // 根据模式处理
    if (currentMode === 'agent') {
      // Agent模式：支持工具调用循环
      await handleAgentMode(session, text);
    } else {
      // Ask模式：普通对话
      await handleAskMode(session, text);
    }
  }

  /**
   * Ask模式处理 - 普通对话，无工具调用
   */
  async function handleAskMode(session, userText) {
    // 更新session元数据
    await updateSession(session.id, { updatedAt: Date.now() });
    renderSessionsList();

    const tabId = getActiveTabId();
    const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
    if (webview && webview.tagName === 'WEBVIEW' && !webview.isLoading()) {
      await extractAndSetPageContext({
        tabId,
        webview,
        getCurrentSession,
        updateSession,
        updateContextBar,
        renderSessionsList,
        extractPageContentFn: extractPageContent,
        force: true
      });
    }

    // 创建流式消息元素
    const streamingMsg = addChatMessage('', 'ai', true);

    try {
      // 从IndexedDB加载历史消息构建上下文
      const historyMessages = await historyStorage.getMessages(session.id, { limit: 100 });
      const systemPrompt = buildSystemPrompt({
        mode: session.mode || 'qa',
        pageContext: session.pageContext,
        currentPageInfo: getCurrentPageInfo(),
        t
      });
      // 还原历史消息格式，确保tool和assistant(tool_calls)字段正确
      const formattedHistory = historyMessages
        .filter(m => m.role !== 'system')
        .map(m => {
          if (m.role === 'tool') {
            return {
              role: 'tool',
              tool_call_id: m.metadata?.toolCallId || '',
              content: m.content || ''
            };
          }
          if (m.role === 'assistant' && m.metadata?.toolCalls) {
            return {
              role: 'assistant',
              content: null,
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
          const content =
            typeof m.content === 'string'
              ? m.content.replace(/<!--think-->[\s\S]*?<!--endthink-->/g, '').trim()
              : m.content;
          return { role: m.role, content };
        });
      const messages = [
        { role: 'system', content: systemPrompt },
        ...formattedHistory,
        { role: 'user', content: userText }
      ];

      await sendChatRequest(messages, session.id, streamingMsg);
    } catch (error) {
      console.error('Chat error:', error);
      streamingMsg.innerText = `${t('ai.error') || '发生错误'}: ${error.message}`;
      finishStreamingMessage(streamingMsg);
    }
  }

  /**
   * Agent模式处理 - 支持工具调用循环
   */
  async function handleAgentMode(session, userText) {
    // 初始化消息历史
    await agentRunner.runAgentConversation(session, userText);
  }

  /**
   * 发送Agent请求（支持工具调用）
   */

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

      // 如果刚刚打开，提取当前页面内容
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
    aiSendBtn.addEventListener('click', handleAISend);

    // 回车发送
    aiInput.addEventListener('keypress', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAISend();
      }
    });

    // 设置流式响应监听
    setupStreamingListener();

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
    const initPageInfo = getCurrentPageInfo();
    if (initPageInfo) {
      lastKnownPageInfo = initPageInfo;
      updatePageStatusUI(initPageInfo);
    }

    // 初始化
    const session = await getCurrentSession();
    await renderSessionsList();
    await renderSessionChat(session);
  }

  return {
    bindEvents,
    onTabChanged,
    onPageChanged,
    clearTabConversation
  };
}

module.exports = {
  createAiManager
};
