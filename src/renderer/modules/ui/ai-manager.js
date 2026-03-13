/**
 * AI 助手管理器
 * 负责AI对话、页面内容提取功能
 */

const { getAIHistoryStorage } = require('../storage/ai-history-storage');

// 页面内容提取脚本
const EXTRACT_PAGE_CONTENT_SCRIPT = `
(function() {
  // 提取页面标题
  const title = document.title || '';

  // 提取主要内容
  let mainContent = '';

  // 尝试找到主要内容区域
  const mainSelectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.content',
    '#content',
    '.post',
    '.article',
    '.entry-content'
  ];

  let mainElement = null;
  for (const selector of mainSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      mainElement = el;
      break;
    }
  }

  // 如果没有找到主要内容区域，使用body
  if (!mainElement) {
    mainElement = document.body;
  }

  // 提取文本内容
  function extractText(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'svg', 'iframe', 'code', 'pre'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          const text = node.textContent.trim();
          if (text.length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const texts = [];
    let node;
    while (node = walker.nextNode()) {
      texts.push(node.textContent.trim());
    }
    return texts.join('\\n');
  }

  mainContent = extractText(mainElement);

  // 限制内容长度，避免过大
  const maxLength = 15000;
  if (mainContent.length > maxLength) {
    mainContent = mainContent.substring(0, maxLength) + '...';
  }

  // 提取元信息
  const meta = {
    description: document.querySelector('meta[name="description"]')?.content || '',
    keywords: document.querySelector('meta[name="keywords"]')?.content || '',
    author: document.querySelector('meta[name="author"]')?.content || ''
  };

  return {
    url: window.location.href,
    title: title,
    content: mainContent,
    meta: meta
  };
})();
`;

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
    showToast
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
  let storageInitialized = false;

  // 初始化存储
  async function initStorage() {
    if (storageInitialized) return;
    try {
      await historyStorage.init();
      storageInitialized = true;
    } catch (error) {
      console.error('Failed to initialize AI history storage:', error);
    }
  }

  const STORE_KEYS = {
    tabToSession: 'ai.tabToSession',
    activeSessionId: 'ai.activeSessionId'
  };

  function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  async function readSessionsFromStore() {
    await initStorage();
    const sessions = await historyStorage.getSessions({ includeDeleted: true, limit: 1000 });
    return sessions.reduce((acc, session) => {
      acc[session.id] = session;
      return acc;
    }, {});
  }

  async function writeSessionsToStore(nextSessions) {
    // IndexedDB已实时更新，无需额外操作
  }

  function readTabToSessionFromStore() {
    return store?.get(STORE_KEYS.tabToSession, {}) || {};
  }

  function writeTabToSessionToStore(nextMap) {
    if (!store) return;
    store.set(STORE_KEYS.tabToSession, nextMap);
  }

  function getActiveSessionId() {
    return store?.get(STORE_KEYS.activeSessionId, '') || '';
  }

  function setActiveSessionId(sessionId) {
    if (!store) return;
    store.set(STORE_KEYS.activeSessionId, sessionId);
  }

  async function ensureSessionExists(sessionId) {
    await initStorage();
    const session = await historyStorage.getSession(sessionId);
    if (session) return session;

    const newSession = await historyStorage.createSession({
      id: sessionId,
      title: t('ai.sessionUntitled') || '新会话',
      pinned: false,
      deleted: false,
      mode: 'qa',
      pageContext: null
    });
    return newSession;
  }

  async function createSession({ title, mode } = {}) {
    await initStorage();
    return historyStorage.createSession({
      title: title || t('ai.sessionUntitled') || '新会话',
      pinned: false,
      deleted: false,
      mode: mode || 'qa',
      pageContext: null
    });
  }

  async function getSessionById(sessionId) {
    await initStorage();
    return historyStorage.getSession(sessionId);
  }

  async function updateSession(sessionId, patch) {
    await initStorage();
    return historyStorage.updateSession(sessionId, patch);
  }

  async function getOrCreateSessionIdForTab(tabId) {
    const tabToSession = readTabToSessionFromStore();
    if (tabToSession[tabId]) {
      await ensureSessionExists(tabToSession[tabId]);
      return tabToSession[tabId];
    }

    const session = await createSession({ title: t('ai.sessionForTab') || '当前标签页' });
    tabToSession[tabId] = session.id;
    writeTabToSessionToStore(tabToSession);
    return session.id;
  }

  async function getCurrentSession() {
    const tabId = getActiveTabId();
    if (!tabId) {
      const activeId = getActiveSessionId();
      if (activeId) {
        await ensureSessionExists(activeId);
        return getSessionById(activeId);
      }
      const session = await createSession();
      setActiveSessionId(session.id);
      return session;
    }

    const sessionId = await getOrCreateSessionIdForTab(tabId);
    setActiveSessionId(sessionId);
    return getSessionById(sessionId);
  }

  async function getSortedSessions() {
    await initStorage();
    const sessions = await historyStorage.getSessions({ includeDeleted: true, limit: 1000 });
    sessions.sort((a, b) => {
      if (!!a.deleted !== !!b.deleted) return a.deleted ? 1 : -1;
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return sessions;
  }

  function unbindSessionFromTab(tabId, sessionId) {
    if (!tabId) return;
    const tabToSession = readTabToSessionFromStore();
    if (tabToSession[tabId] === sessionId) {
      delete tabToSession[tabId];
      writeTabToSessionToStore(tabToSession);
    }
  }

  function bindSessionToCurrentTab(sessionId) {
    const tabId = getActiveTabId();
    if (!tabId) return;
    const tabToSession = readTabToSessionFromStore();
    tabToSession[tabId] = sessionId;
    writeTabToSessionToStore(tabToSession);
  }

  // 当前流式响应状态
  let currentStreamingMessage = null;
  let currentStreamingElement = null;
  let currentTaskId = null;
  let isStreaming = false;

  async function renderSessionsList() {
    if (!historyListEl) return;
    const sessions = await getSortedSessions();
    const activeSessionId = getActiveSessionId();

    historyListEl.innerHTML = '';
    for (const session of sessions) {
      const item = documentRef.createElement('div');
      item.className = 'ai-history-item';
      if (session.deleted) {
        item.classList.add('deleted');
      }
      if (session.id === activeSessionId) {
        item.classList.add('active');
      }
      item.dataset.sessionId = session.id;

      const content = documentRef.createElement('div');
      content.className = 'ai-history-item-content';

      const title = documentRef.createElement('div');
      title.className = 'ai-history-item-title';
      title.textContent = session.title || t('ai.sessionUntitled') || '新会话';

      const meta = documentRef.createElement('div');
      meta.className = 'ai-history-item-meta';
      meta.textContent = session.pinned ? t('ai.pinned') || '置顶' : t('ai.mode') || '模式';

      content.appendChild(title);
      content.appendChild(meta);

      const deleteBtn = documentRef.createElement('button');
      deleteBtn.className = 'ai-history-item-delete';
      deleteBtn.title = session.deleted
        ? t('ai.restoreSession') || '恢复会话'
        : t('ai.deleteSession') || '删除会话';
      // 根据删除状态显示不同图标
      if (session.deleted) {
        deleteBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z"/></svg>';
      } else {
        deleteBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>';
      }

      // 左键点击：删除/恢复
      deleteBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const shouldDelete = !session.deleted;
        await updateSession(session.id, {
          deleted: shouldDelete,
          pinned: shouldDelete ? false : session.pinned
        });
        const tabId = getActiveTabId();
        if (shouldDelete) {
          unbindSessionFromTab(tabId, session.id);
          if (getActiveSessionId() === session.id) {
            setActiveSessionId('');
            const next = await getCurrentSession();
            await renderSessionChat(next);
          }
        }
        await renderSessionsList();
        if (showToast) {
          showToast(
            shouldDelete
              ? t('ai.sessionDeleted') || '会话已删除'
              : t('ai.sessionRestored') || '会话已恢复',
            'info'
          );
        }
      });

      // 右键点击：永久删除（仅对已删除的会话）
      deleteBtn.addEventListener('contextmenu', async e => {
        e.preventDefault();
        e.stopPropagation();
        if (!session.deleted) {
          // 先软删除
          await updateSession(session.id, { deleted: true, pinned: false });
          const tabId = getActiveTabId();
          unbindSessionFromTab(tabId, session.id);
          if (getActiveSessionId() === session.id) {
            setActiveSessionId('');
            const next = await getCurrentSession();
            await renderSessionChat(next);
          }
          await renderSessionsList();
          if (showToast) {
            showToast(t('ai.sessionDeleted') || '会话已删除，右键可永久删除', 'info');
          }
        } else {
          // 永久删除
          if (
            window.confirm(
              t('ai.confirmPermanentDelete') || '确定要永久删除此会话吗？此操作不可撤销。'
            )
          ) {
            await historyStorage.permanentlyDeleteSession(session.id);
            await renderSessionsList();
            if (showToast) {
              showToast(t('ai.sessionPermanentlyDeleted') || '会话已永久删除', 'info');
            }
          }
        }
      });

      item.appendChild(content);
      item.appendChild(deleteBtn);

      item.addEventListener('click', async () => {
        if (session.deleted) {
          await updateSession(session.id, { deleted: false });
          await renderSessionsList();
          return;
        }
        await switchToSession(session.id);
        historyPopup?.classList.remove('visible');
      });

      item.addEventListener('dblclick', async e => {
        e.preventDefault();
        const nextTitle = window.prompt(t('ai.renameSession') || '重命名会话', session.title || '');
        if (typeof nextTitle !== 'string') return;
        const trimmed = nextTitle.trim();
        if (!trimmed) return;
        await updateSession(session.id, { title: trimmed });
        await renderSessionsList();
      });

      item.addEventListener('contextmenu', async e => {
        e.preventDefault();
        const shouldPin = !session.pinned;
        await updateSession(session.id, { pinned: shouldPin });
        await renderSessionsList();
      });

      historyListEl.appendChild(item);
    }
  }

  async function renderSessionChat(session) {
    if (!session) return;
    aiChatArea.innerHTML = '';

    // 从IndexedDB加载消息
    const messages = await historyStorage.getMessages(session.id, { limit: 1000 });

    if (!messages || messages.length === 0) {
      const welcomeMsg = documentRef.createElement('div');
      welcomeMsg.className = 'chat-message ai';
      welcomeMsg.innerHTML = `<span>${t('ai.welcome')}</span>`;
      aiChatArea.appendChild(welcomeMsg);
      return;
    }

    for (const msg of messages) {
      if (!msg || !msg.role || typeof msg.content !== 'string') continue;
      if (msg.role === 'user') {
        addChatMessage(msg.content, 'user');
      } else if (msg.role === 'assistant') {
        addChatMessage(msg.content, 'ai');
      }
    }
  }

  async function switchToSession(sessionId) {
    if (!sessionId) return;
    await ensureSessionExists(sessionId);
    setActiveSessionId(sessionId);
    bindSessionToCurrentTab(sessionId);
    const session = await getSessionById(sessionId);
    await renderSessionsList();
    await renderSessionChat(session);
    updateContextBar(session?.pageContext);

    const tabId = getActiveTabId();
    const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
    if (webview && webview.tagName === 'WEBVIEW' && !webview.isLoading()) {
      await extractAndSetPageContext(tabId, webview);
    }
  }

  /**
   * 添加聊天消息到UI
   */
  function addChatMessage(text, sender, isStreaming = false) {
    const msg = documentRef.createElement('div');
    msg.className = `chat-message ${sender}`;
    if (isStreaming) {
      msg.classList.add('streaming');
    }

    // 处理换行
    msg.innerText = text;

    aiChatArea.appendChild(msg);
    scrollToBottom();

    return msg;
  }

  /**
   * 更新流式消息内容
   */
  function updateStreamingMessage(element, text) {
    if (element) {
      element.innerText = text;
      scrollToBottom();
    }
  }

  /**
   * 滚动到底部
   */
  function scrollToBottom() {
    aiChatArea.scrollTop = aiChatArea.scrollHeight;
  }

  /**
   * 清空聊天区域
   */
  function clearChatArea() {
    aiChatArea.innerHTML = '';
    // 添加欢迎消息
    const welcomeMsg = documentRef.createElement('div');
    welcomeMsg.className = 'chat-message ai';
    welcomeMsg.innerHTML = `<span>${t('ai.welcome')}</span>`;
    aiChatArea.appendChild(welcomeMsg);
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
   * 提取页面内容
   */
  async function extractPageContent(webview) {
    if (!webview || webview.tagName !== 'WEBVIEW') {
      return null;
    }

    try {
      const content = await webview.executeJavaScript(EXTRACT_PAGE_CONTENT_SCRIPT);
      return content;
    } catch (error) {
      console.error('Failed to extract page content:', error);
      return null;
    }
  }

  function buildSelectionContext(text) {
    const content = String(text || '').trim();
    if (!content) return null;
    const tabId = getActiveTabId();
    const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
    return {
      url: webview && typeof webview.getURL === 'function' ? webview.getURL() : '',
      title: t('ai.selectionTitle') || '选区内容',
      content,
      meta: {
        description: ''
      }
    };
  }

  /**
   * 构建系统提示
   */
  function buildSystemPrompt({ mode, pageContext }) {
    const base =
      t('ai.systemPrompt') ||
      '你是一个有帮助的AI助手。你可以帮助用户总结网页内容、回答问题和提供信息。';

    let modePrompt = '';
    switch (mode) {
      case 'outline':
        modePrompt = t('ai.modeOutline') || '请输出结构化提纲与关键要点。';
        break;
      case 'compare':
        modePrompt = t('ai.modeCompare') || '请进行对比/聚合分析，并给出结论。';
        break;
      case 'translate_page':
        modePrompt = t('ai.modeTranslatePage') || '请将内容翻译/本地化为中文，保持准确与可读性。';
        break;
      case 'code_docs':
        modePrompt = t('ai.modeCodeDocs') || '请以 API 文档/代码解读风格回答，给出关键接口与示例。';
        break;
      case 'qa':
      default:
        modePrompt = t('ai.modeQa') || '请结合上下文回答用户问题，必要时引用原文。';
        break;
    }

    let systemPrompt = `${base}\n\n${modePrompt}`;

    if (pageContext && pageContext.content) {
      systemPrompt += '\n\n' + (t('ai.pageContext') || '当前页面信息：');
      systemPrompt += `\n标题: ${pageContext.title}`;
      systemPrompt += `\nURL: ${pageContext.url}`;
      if (pageContext.meta?.description) {
        systemPrompt += `\n描述: ${pageContext.meta.description}`;
      }
      systemPrompt += `\n\n页面内容:\n${pageContext.content}`;
    }

    return systemPrompt;
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
    await extractAndSetPageContext(tabId, webview);
  }

  /**
   * 提取并设置页面上下文
   */
  async function extractAndSetPageContext(tabId, webview) {
    const session = await getCurrentSession();
    const previousUrl = session?.pageContext?.url;

    // 提取页面内容
    const pageContext = await extractPageContent(webview);

    if (pageContext && pageContext.url !== previousUrl && session) {
      await updateSession(session.id, { pageContext });
      updateContextBar(pageContext);
      await renderSessionsList();
    }
  }

  /**
   * 发送对话请求
   */
  async function sendChatRequest(messages, sessionId, streamingElement = null) {
    currentTaskId = `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    isStreaming = true;
    currentStreamingElement = streamingElement;
    currentStreamingMessage = '';

    // 禁用发送按钮
    aiSendBtn.disabled = true;
    aiInput.disabled = true;

    try {
      const result = await ipcRenderer.invoke('ai-chat', {
        messages,
        taskId: currentTaskId
      });

      if (result.success) {
        // 保存AI回复到IndexedDB
        if (sessionId) {
          await historyStorage.addMessage(sessionId, {
            role: 'assistant',
            content: result.content
          });
          // 更新session时间
          await updateSession(sessionId, { updatedAt: Date.now() });
        }

        if (streamingElement) {
          streamingElement.classList.remove('streaming');
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
      currentStreamingMessage = null;
      currentTaskId = null;

      // 恢复发送按钮
      aiSendBtn.disabled = false;
      aiInput.disabled = false;
      aiInput.focus();
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

    // 从IndexedDB加载历史消息构建上下文
    const historyMessages = await historyStorage.getMessages(session.id, { limit: 100 });
    const systemPrompt = buildSystemPrompt({
      mode: session.mode || 'qa',
      pageContext: session.pageContext
    });
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.filter(m => m.role !== 'system'),
      { role: 'user', content: text }
    ];

    // 保存用户消息到IndexedDB
    await historyStorage.addMessage(session.id, {
      role: 'user',
      content: text
    });

    // 更新session元数据
    await updateSession(session.id, { updatedAt: Date.now() });
    renderSessionsList();

    // 创建流式消息元素
    const streamingMsg = addChatMessage('', 'ai', true);

    try {
      await sendChatRequest(messages, session.id, streamingMsg);
    } catch (error) {
      console.error('Chat error:', error);
      streamingMsg.innerText = `${t('ai.error') || '发生错误'}: ${error.message}`;
      streamingMsg.classList.remove('streaming');
    }
  }

  /**
   * 监听流式响应
   */
  function setupStreamingListener() {
    ipcRenderer.on('ai-chat-streaming', (_event, data) => {
      if (!isStreaming || !currentStreamingElement) return;
      if (data.taskId !== currentTaskId) return;

      currentStreamingMessage = data.accumulated;
      updateStreamingMessage(currentStreamingElement, currentStreamingMessage);
    });
  }

  /**
   * 清理标签页的对话历史
   */
  function clearTabConversation(tabId) {
    if (!tabId || !store) return;
    const tabToSession = readTabToSessionFromStore();
    delete tabToSession[tabId];
    writeTabToSessionToStore(tabToSession);
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

      // 如果刚刚打开，提取当前页面内容
      if (wasCollapsed) {
        const tabId = getActiveTabId();
        const webview = documentRef.getElementById(`webview-${tabId}`);
        if (webview && webview.tagName === 'WEBVIEW') {
          const session = await getCurrentSession();
          await renderSessionsList();
          await renderSessionChat(session);
          await extractAndSetPageContext(tabId, webview);
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

    // 历史按钮点击显示/隐藏历史面板
    if (historyBtn) {
      historyBtn.addEventListener('click', async () => {
        historyPopup?.classList.toggle('visible');
        if (historyPopup?.classList.contains('visible')) {
          await renderSessionsList();
        }
      });
    }

    // 关闭历史面板按钮
    if (closeHistoryBtn) {
      closeHistoryBtn.addEventListener('click', () => {
        historyPopup?.classList.remove('visible');
      });
    }

    // 点击历史面板外部关闭
    documentRef.addEventListener('click', e => {
      if (historyPopup?.classList.contains('visible')) {
        if (!historyPopup.contains(e.target) && e.target !== historyBtn) {
          historyPopup.classList.remove('visible');
        }
      }
    });

    // 拖拽调节宽度
    if (resizeHandle) {
      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      resizeHandle.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        startWidth = aiSidebar.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        document.body.style.pointerEvents = 'none';
      });

      const handleMouseMove = e => {
        if (!isResizing) return;
        const diff = startX - e.clientX;
        const newWidth = Math.min(600, Math.max(280, startWidth + diff));
        aiSidebar.style.width = `${newWidth}px`;
      };

      const handleMouseUp = () => {
        if (isResizing) {
          isResizing = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.body.style.pointerEvents = '';
        }
      };

      documentRef.addEventListener('mousemove', handleMouseMove);
      documentRef.addEventListener('mouseup', handleMouseUp);
    }

    window.addEventListener('ai-ask-selection', async e => {
      const text = e?.detail?.text || '';
      const selectionContext = buildSelectionContext(text);
      if (!selectionContext) {
        if (showToast) {
          showToast(t('ai.noSelection') || '未检测到选区文本', 'info');
        }
        return;
      }

      const wasCollapsed = aiSidebar.classList.contains('collapsed');
      aiSidebar.classList.remove('collapsed');

      const session = await getCurrentSession();
      if (session) {
        await updateSession(session.id, { pageContext: selectionContext });
      }
      updateContextBar(selectionContext);

      await renderSessionsList();
      await renderSessionChat(await getCurrentSession());

      if (wasCollapsed) {
        scrollToBottom();
      }

      if (aiInput) {
        aiInput.value =
          t('ai.defaultAskSelection') || '请解释并总结这段选区内容，并回答其中关键问题。';
        aiInput.focus();
      }
    });

    // 初始化
    const session = await getCurrentSession();
    await renderSessionsList();
    await renderSessionChat(session);
  }

  return {
    bindEvents,
    onTabChanged,
    clearTabConversation,
    extractAndSetPageContext
  };
}

module.exports = {
  createAiManager
};
