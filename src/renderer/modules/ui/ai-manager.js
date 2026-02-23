/**
 * AI 助手管理器
 * 负责AI对话、页面内容提取功能
 */

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
    ipcRenderer
  } = options;

  // 上下文状态栏元素
  const contextBar = documentRef.getElementById('ai-context-bar');
  const contextText = documentRef.getElementById('ai-context-text');
  const contextClearBtn = documentRef.getElementById('ai-context-clear-btn');

  // 按标签页存储对话历史
  const conversationsByTab = new Map(); // tabId -> { messages: [], pageContext: null }

  // 当前流式响应状态
  let currentStreamingMessage = null;
  let currentStreamingElement = null;
  let currentTaskId = null;
  let isStreaming = false;

  /**
   * 获取当前标签页的对话历史
   */
  function getCurrentConversation() {
    const tabId = getActiveTabId();
    if (!conversationsByTab.has(tabId)) {
      conversationsByTab.set(tabId, {
        messages: [],
        pageContext: null
      });
    }
    return conversationsByTab.get(tabId);
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
  function clearCurrentContext() {
    const conversation = getCurrentConversation();
    conversation.pageContext = null;
    conversation.messages = [];
    contextBar.style.display = 'none';
    clearChatArea();
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

  /**
   * 构建系统提示
   */
  function buildSystemPrompt(pageContext) {
    let systemPrompt =
      t('ai.systemPrompt') ||
      '你是一个有帮助的AI助手。你可以帮助用户总结网页内容、回答问题和提供信息。';

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

    // 提取页面内容
    await extractAndSetPageContext(tabId, webview);
  }

  /**
   * 提取并设置页面上下文
   */
  async function extractAndSetPageContext(tabId, webview) {
    const conversation = getCurrentConversation();
    const previousUrl = conversation.pageContext?.url;

    // 提取页面内容
    const pageContext = await extractPageContent(webview);

    if (pageContext && pageContext.url !== previousUrl) {
      conversation.pageContext = pageContext;
      conversation.messages = []; // 重置对话历史

      // 更新上下文状态栏
      updateContextBar(pageContext);
    }
  }

  /**
   * 发送对话请求
   */
  async function sendChatRequest(messages, conversation, streamingElement = null) {
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
        // 添加AI响应到对话历史
        conversation.messages.push({
          role: 'assistant',
          content: result.content
        });

        if (streamingElement) {
          streamingElement.classList.remove('streaming');
        } else {
          addChatMessage(result.content, 'ai');
        }
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

    const conversation = getCurrentConversation();

    // 添加用户消息
    addChatMessage(text, 'user');
    aiInput.value = '';

    // 构建消息
    const systemPrompt = buildSystemPrompt(conversation.pageContext);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation.messages.filter(m => m.role !== 'system'),
      { role: 'user', content: text }
    ];

    // 添加到对话历史
    conversation.messages.push({ role: 'user', content: text });

    // 创建流式消息元素
    const streamingMsg = addChatMessage('', 'ai', true);

    try {
      await sendChatRequest(messages, conversation, streamingMsg);
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
    conversationsByTab.delete(tabId);
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    toggleAiBtn.style.display = 'flex';

    // 切换AI侧边栏
    toggleAiBtn.addEventListener('click', async () => {
      const wasCollapsed = aiSidebar.classList.contains('collapsed');
      aiSidebar.classList.toggle('collapsed');

      // 如果刚刚打开，提取当前页面内容
      if (wasCollapsed) {
        const tabId = getActiveTabId();
        const webview = documentRef.getElementById(`webview-${tabId}`);
        if (webview && webview.tagName === 'WEBVIEW') {
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

    // 清除上下文按钮
    if (contextClearBtn) {
      contextClearBtn.addEventListener('click', clearCurrentContext);
    }

    // 设置流式响应监听
    setupStreamingListener();
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
