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

const path = require('path');
const fs = require('fs');

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
  const contextPie = documentRef.getElementById('ai-context-pie');
  const contextTooltip = documentRef.getElementById('ai-context-tooltip');
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
    // 优先从 store 读取最新值，确保与设置同步
    let contextSize = 8192;
    if (store) {
      contextSize = store.get('settings.aiContextSize', 8192);
    }
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
    const ttTotalK = documentRef.getElementById('tt-total-k');
    if (ttUsed) ttUsed.textContent = `${pct}%`;
    if (ttUsedK) ttUsedK.textContent = `${(total / 1000).toFixed(1)}K`;
    if (ttTotalK) ttTotalK.textContent = `${(contextSize / 1000).toFixed(1)}K`;
    if (ttRemainK)
      ttRemainK.textContent = `${(Math.max(0, contextSize - total) / 1000).toFixed(1)}K`;
    if (ttSystem) ttSystem.textContent = `${system}`;
    if (ttHistory) ttHistory.textContent = `${history}`;
  }

  // 从 IndexedDB 加载会话消息并同步到 agentRunner
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

  // 压缩上下文：将当前对话历史发送给 AI 进行摘要压缩
  async function compressContext() {
    const overlay = documentRef.getElementById('ai-compress-overlay');
    const content = documentRef.getElementById('ai-compress-content');
    const status = documentRef.getElementById('ai-compress-status');
    if (!overlay || !content || !status) return;

    // 获取当前消息历史
    const messages = agentRunner.getMessageHistory();
    if (!messages || messages.length <= 1) {
      showToast('没有足够的对话历史可以压缩', 'warning');
      return;
    }

    // 计算压缩前的 token 数
    const { total: beforeTokens } = estimateHistoryTokens(messages);

    // 显示弹窗
    overlay.style.display = 'flex';
    content.textContent = '';
    status.className = 'ai-compress-status';
    status.innerHTML = '<div class="ai-compress-spinner"></div><span>正在压缩...</span>';

    // 构造压缩 prompt
    const compressMessages = [
      {
        role: 'system',
        content:
          '你是一个对话压缩助手。请将以下对话历史压缩为简洁的摘要，保留所有关键信息、决策和结论。' +
          '直接输出压缩后的摘要文本，不要添加额外说明。' +
          '摘要应该足够详细，使得 AI 在后续对话中能够理解之前的上下文。'
      },
      {
        role: 'user',
        content:
          '请压缩以下对话历史：\n\n' +
          messages
            .filter(m => m.role !== 'system')
            .map(m => {
              const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : '工具';
              const text =
                typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
              return `[${role}]: ${text}`;
            })
            .join('\n\n')
      }
    ];

    // 使用独立的 taskId 跟踪压缩请求
    const compressTaskId = `compress-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let accumulated = '';

    // 临时监听压缩流式响应
    const onStreaming = (_event, data) => {
      if (data.taskId !== compressTaskId) return;
      accumulated = data.accumulated || accumulated + (data.chunk || '');
      // 使用 requestAnimationFrame 确保 DOM 更新立即渲染
      requestAnimationFrame(() => {
        content.textContent = accumulated;
        content.scrollTop = content.scrollHeight;
      });
    };
    ipcRenderer.on('ai-chat-streaming', onStreaming);

    try {
      const result = await ipcRenderer.invoke('ai-chat', {
        messages: compressMessages,
        taskId: compressTaskId
      });

      // 移除临时监听
      ipcRenderer.removeListener('ai-chat-streaming', onStreaming);

      if (result.success) {
        const compressedContent = result.content || accumulated;

        // 确保弹窗中显示最终的压缩结果（流式可能未触发或未收到）
        if (compressedContent && content.textContent !== compressedContent) {
          content.textContent = compressedContent;
          content.scrollTop = content.scrollHeight;
        }

        // 计算压缩后的 token 数
        const compressedMessages = [
          messages[0], // 保留 system prompt
          { role: 'user', content: '[上下文摘要]' },
          { role: 'assistant', content: compressedContent }
        ];
        const { total: afterTokens } = estimateHistoryTokens(compressedMessages);
        const saved = beforeTokens - afterTokens;

        // 更新 agentRunner 的消息历史
        agentRunner.setMessageHistory(compressedMessages);

        // 更新 IndexedDB 中的消息
        const session = await getCurrentSession();
        if (session) {
          // 清除旧消息
          await historyStorage.clearMessages(session.id);
          // 保存压缩后的消息
          for (const msg of compressedMessages) {
            await historyStorage.addMessage(session.id, {
              role: msg.role,
              content: msg.content,
              metadata: msg.role === 'assistant' ? { compressed: true } : {}
            });
          }
        }

        // 重新渲染聊天区域
        await renderSessionChat(session);

        // 更新饼图
        updateContextPie();

        // 显示完成状态
        status.className = 'ai-compress-status completed';
        const savedK = (saved / 1000).toFixed(1);
        status.innerHTML = `<span>✓ 已完成压缩，节省 ${savedK}K tokens</span>`;

        // 2秒后自动关闭弹窗
        setTimeout(() => {
          overlay.style.display = 'none';
        }, 2000);
      } else {
        throw new Error(result.error || '压缩失败');
      }
    } catch (err) {
      ipcRenderer.removeListener('ai-chat-streaming', onStreaming);
      status.className = 'ai-compress-status';
      status.innerHTML = `<span style="color: #ef4444">压缩失败: ${err.message}</span>`;
      // 3秒后关闭
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 3000);
    }
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

  // 创建上下文隔离管理器
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
    renderEmptyState: () => {
      // 询问模式和代理模式现在共用同一套 Logo + 随机邀请词的设计
      return renderAgentEmptyState();
    }
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

  // 发送按钮的 SVG 图标
  const SEND_ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-hidden="true"><path fill="currentColor" d="M2.01,21L23,12L2.01,3L2,10L17,12L2,14L2.01,21Z"/></svg>';
  const STOP_ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-hidden="true"><path fill="currentColor" d="M18,18H6V6H18V18Z"/></svg>';

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
      // agent 模式下禁用时显示中断图标
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

  // AI 模式选择
  const modeSelect = documentRef.getElementById('ai-mode-select');
  let currentMode = 'ask'; // 'ask' 或 'agent'

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
    renderSessionChat: (...args) => renderSessionChat(...args),
    syncSessionMessagesToAgent
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
    getTaskState: () => taskState,
    bindTabToSession: sessionService.bindTabToSession,
    externalTodoManager: todoManager,
    contextIsolation
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
    updateContextBar: ctx => updateContextBar(ctx),
    todoManager,
    contextIsolation
  });

  // 注册上下文隔离生命周期钩子：会话切换前中止进行中的操作
  contextIsolation.onBeforeSwitch(async (_fromId, _toId) => {
    if (agentRunner && typeof agentRunner.abort === 'function') {
      agentRunner.abort();
    }
    if (chatHandler && typeof chatHandler.cancelStreaming === 'function') {
      chatHandler.cancelStreaming();
    }
  });

  // 注册上下文隔离生命周期钩子：会话切换后重置模块状态
  contextIsolation.onAfterSwitch(async (_toId, _fromId) => {
    if (agentRunner && typeof agentRunner.resetState === 'function') {
      agentRunner.resetState();
    }
    if (chatHandler && typeof chatHandler.resetState === 'function') {
      chatHandler.resetState();
    }
  });

  async function switchToSession(sessionId) {
    if (!sessionId) return;
    // 触发上下文隔离切换（会中止旧会话的操作、清理缓存、触发钩子）
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
    // 从 IndexedDB 加载消息并同步到 agentRunner，确保上下文正确
    await syncSessionMessagesToAgent(sessionId);
    updateContextBar(session?.pageContext);
    updateContextPie();
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
    renderEmptyState: () => {
      return renderAgentEmptyState();
    },
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

    // 发送按钮（agent 模式下可切换为中断按钮）
    aiSendBtn.addEventListener('click', async () => {
      if (currentMode === 'agent' && agentRunner.isProcessing()) {
        agentRunner.abort();
        setInputEnabled(true);
        return;
      }
      if (pendingAttachments.length > 0) {
        const enriched = buildAttachmentPrompt(pendingAttachments, aiInput.value);
        aiInput.value = enriched;
        pendingAttachments = [];
      }
      await chatHandler.handleAISend(aiInput, currentMode);
      updateContextPie();
    });

    // 回车发送
    aiInput.addEventListener('keypress', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        (async () => {
          if (pendingAttachments.length > 0) {
            const enriched = buildAttachmentPrompt(pendingAttachments, aiInput.value);
            aiInput.value = enriched;
            pendingAttachments = [];
          }
          await chatHandler.handleAISend(aiInput, currentMode);
          updateContextPie();
        })();
      }
    });

    // 设置流式响应监听
    chatHandler.setupStreamingListener();
    agentRunner.setupAgentStreamingListener();

    // 上下文大小设置变化时同步更新饼图
    const contextSizeInput = documentRef.getElementById('ai-context-size-input');
    if (contextSizeInput) {
      contextSizeInput.addEventListener('input', updateContextPie);
      contextSizeInput.addEventListener('change', updateContextPie);
    }

    // 清除上下文按钮
    if (contextClearBtn) {
      contextClearBtn.addEventListener('click', clearCurrentContext);
    }

    // 饼图 tooltip 显示/隐藏（JS 控制，避免鼠标移入 tooltip 时消失）
    let tooltipTimer = null;
    if (contextPie && contextTooltip) {
      const showTooltip = () => {
        clearTimeout(tooltipTimer);
        contextTooltip.style.display = 'block';
      };
      const hideTooltip = () => {
        tooltipTimer = setTimeout(() => {
          contextTooltip.style.display = 'none';
        }, 150);
      };
      contextPie.addEventListener('mouseenter', showTooltip);
      contextPie.addEventListener('mouseleave', hideTooltip);
      contextTooltip.addEventListener('mouseenter', showTooltip);
      contextTooltip.addEventListener('mouseleave', hideTooltip);
    }

    // 压缩上下文按钮
    const compressBtn = documentRef.getElementById('ai-compress-context-btn');
    if (compressBtn) {
      compressBtn.addEventListener('click', e => {
        e.stopPropagation();
        compressContext();
      });
    }

    bindHistoryPanelEvents();

    toolbar.init();

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
    // 初始化时同步消息到 agentRunner
    if (session) {
      await syncSessionMessagesToAgent(session.id);
    }
    updateContextPie();
  }

  return {
    bindEvents,
    onTabChanged: tabId => pageContext.onTabChanged(tabId, currentMode),
    onPageChanged: (tabId, url) => pageContext.onPageChanged(tabId, url, currentMode),
    clearTabConversation
  };
}

function buildAttachmentPrompt(files, userText) {
  const safeText = (userText || '').trim();
  const list = Array.isArray(files) ? files : [];

  const lines = [];
  lines.push('【附件】');

  for (const file of list) {
    if (!file) continue;
    const name = file.name || 'unknown';
    const filePath = file.path || '';
    const size = typeof file.size === 'number' ? file.size : 0;
    lines.push(`- ${name}${size ? ` (${Math.round(size / 1024)}KB)` : ''}`);

    const isTextLike =
      (file.type && file.type.startsWith('text/')) ||
      /\.(md|txt|json|js|ts|css|html|xml|yaml|yml|csv)$/i.test(name);

    if (filePath && isTextLike && size > 0 && size <= 200 * 1024) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const snippet = content.length > 2000 ? `${content.slice(0, 2000)}\n...` : content;
        lines.push('```');
        lines.push(snippet);
        lines.push('```');
      } catch {
        // ignore
      }
    }
  }

  if (safeText) {
    lines.push('');
    lines.push('【问题】');
    lines.push(safeText);
  }

  return lines.join('\n');
}

module.exports = {
  createAiManager
};
