/**
 * AI 聊天处理模块
 * 负责发送聊天请求、Ask/Agent模式处理、流式监听
 */

const { buildSystemPrompt } = require('./ai-context-utils');

/**
 * 创建聊天处理器
 * @param {object} deps - 依赖注入
 * @returns {object} 聊天处理相关方法
 */
function createAiChatHandler(deps) {
  const {
    ipcRenderer,
    historyStorage,
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    setInputEnabled,
    getCurrentSession,
    updateSession,
    renderSessionsList,
    getCurrentPageInfo,
    t,
    agentRunner,
    todoManager
  } = deps;

  // 当前流式响应状态
  let currentStreamingElement = null;
  let currentTaskId = null;
  let isStreaming = false;

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
        // 保存AI回复到IndexedDB（分离 thinking 内容到 metadata）
        if (sessionId) {
          const savedContent = result.reasoningContent
            ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content}`
            : result.content;
          await historyStorage.addMessage(sessionId, {
            role: 'assistant',
            content: savedContent,
            metadata: {
              thinkingContent: result.reasoningContent || '',
              actionContent: result.content || ''
            }
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
   * Ask模式处理 - 普通对话，无工具调用
   */
  async function handleAskMode(session, userText) {
    // 更新session元数据
    await updateSession(session.id, { updatedAt: Date.now() });
    renderSessionsList();

    const { extractAndSetPageContext, getActiveTabId, documentRef, updateContextBar } = deps;

    const tabId = getActiveTabId();
    const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
    let isReady = false;
    try {
      isReady = webview && webview.tagName === 'WEBVIEW' && !webview.isLoading();
    } catch {
      // webview 尚未 dom-ready
    }
    if (isReady) {
      await extractAndSetPageContext({
        tabId,
        webview,
        getCurrentSession,
        updateSession,
        updateContextBar,
        renderSessionsList,
        extractPageContentFn: deps.extractPageContent,
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
      const todoPrompt =
        todoManager && typeof todoManager.buildTodoPrompt === 'function'
          ? todoManager.buildTodoPrompt()
          : '';
      // 还原历史消息格式，确保tool和assistant(tool_calls)字段正确
      // 关键：恢复 thinking 内容以保持完整的上下文（防止AI遗忘）
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
            // 💡 修复：恢复 thinking 内容到消息中，防止上下文丢失
            const thinkingContent = m.metadata?.thinkingContent || '';
            const actionContent = m.metadata?.actionContent || '';
            const recoveredContent = thinkingContent
              ? `<!--think-->${thinkingContent}<!--endthink-->${actionContent}`
              : actionContent;

            return {
              role: 'assistant',
              content: recoveredContent || null,
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
        { role: 'system', content: systemPrompt + todoPrompt },
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
    await agentRunner.runAgentConversation(session, userText);
  }

  /**
   * 处理用户发送消息
   */
  async function handleAISend(aiInput, currentMode) {
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
      await handleAgentMode(session, text);
    } else {
      await handleAskMode(session, text);
    }
  }

  return {
    setupStreamingListener,
    sendChatRequest,
    handleAskMode,
    handleAgentMode,
    handleAISend,
    get isStreaming() {
      return isStreaming;
    }
  };
}

module.exports = { createAiChatHandler };
