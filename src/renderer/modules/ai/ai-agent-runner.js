/**
 * AI Agent 模式执行器
 */

const { getAiToolsSchema } = require('./ai-tools-registry');
const { renderMarkdownToElement } = require('./ai-markdown-renderer');

function createAiAgentRunner(options) {
  const {
    ipcRenderer,
    toolsExecutor,
    historyStorage,
    store,
    onIteration,
    updateSession,
    renderSessionsList,
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    autoCollapseThinkingDropdown,
    documentRef,
    t,
    buildSystemPrompt,
    setInputEnabled,
    getPageList,
    getCurrentPageInfo,
    updateTaskState,
    resetTaskState,
    getTaskState
  } = options;

  let isAgentProcessing = false;
  let agentMessageHistory = [];

  // Agent 流式显示状态
  let agentStreamingElement = null;
  let agentStreamingTaskId = null;

  /**
   * 监听 Agent 流式响应
   */
  function setupAgentStreamingListener() {
    ipcRenderer.on('ai-agent-streaming', (_event, data) => {
      if (!agentStreamingElement) return;
      if (data.taskId !== agentStreamingTaskId) return;

      const fullText = data.reasoningContent
        ? `<!--think-->${data.reasoningContent}<!--endthink-->${data.accumulated}`
        : data.accumulated;
      updateStreamingMessage(agentStreamingElement, fullText);
    });
  }

  function renderToolCard(target, options) {
    if (!target) return;
    if (!documentRef) {
      target.classList.remove('streaming');
      target.innerText = options.description || '';
      return;
    }

    const { title, description, status } = options;
    target.classList.remove('streaming');
    target.classList.add('tool-card');
    target.innerHTML = '';

    const header = documentRef.createElement('div');
    header.className = 'tool-card-header';

    const titleEl = documentRef.createElement('div');
    titleEl.className = 'tool-card-title';
    titleEl.textContent = `工具：${title}`;
    header.appendChild(titleEl);

    if (status) {
      const statusEl = documentRef.createElement('span');
      statusEl.className = `tool-card-status ${status}`;
      statusEl.textContent = getToolStatusLabel(status);
      header.appendChild(statusEl);
    }

    const descEl = documentRef.createElement('div');
    descEl.className = 'tool-card-desc';
    descEl.textContent = description || '';

    target.appendChild(header);
    target.appendChild(descEl);
  }

  function getToolStatusLabel(status) {
    switch (status) {
      case 'success':
        return '已完成';
      case 'error':
        return '失败';
      case 'pending':
        return '执行中';
      default:
        return '状态';
    }
  }

  function getToolTitle(toolName) {
    switch (toolName) {
      case 'get_page_info':
        return '获取页面信息';
      case 'click_element':
        return '点击元素';
      case 'input_text':
        return '输入文本';
      case 'search_page':
        return '搜索页面';
      case 'end_session':
        return '结束会话';
      default:
        return toolName || '工具';
    }
  }

  function truncateText(text, maxLength) {
    const value = String(text || '');
    if (!maxLength || value.length <= maxLength) return value;
    return value.substring(0, maxLength) + '...';
  }

  function resolvePageLabel(tabId) {
    if (!tabId || typeof getPageList !== 'function') return '';
    const pages = getPageList() || [];
    const match = pages.find(page => page.id === tabId);
    if (!match) return '';
    return match.title || match.url || '';
  }

  function buildPageHintFromArgs(args) {
    if (!args || !args.tab_id) return '当前页面';
    const label = resolvePageLabel(args.tab_id);
    if (label) {
      return `页面: ${label}`;
    }
    return `tab_id: ${args.tab_id}`;
  }

  function buildPageHintFromResult(toolResult, toolCall) {
    if (toolResult?.title) {
      return `页面: ${toolResult.title}`;
    }
    if (toolResult?.url) {
      return `页面: ${toolResult.url}`;
    }
    if (toolResult?.tabId) {
      const label = resolvePageLabel(toolResult.tabId);
      if (label) return `页面: ${label}`;
      return `tab_id: ${toolResult.tabId}`;
    }
    const callTabId = toolCall?.arguments?.tab_id;
    if (callTabId) {
      const label = resolvePageLabel(callTabId);
      if (label) return `页面: ${label}`;
      return `tab_id: ${callTabId}`;
    }
    return '';
  }

  function buildToolCallDescription(toolCall) {
    if (!toolCall) return '准备执行工具';
    const args = toolCall.arguments || {};
    switch (toolCall.name) {
      case 'search_page': {
        const query = args.query ? `搜索: ${truncateText(args.query, 40)}` : '未提供搜索词';
        return `准备搜索，${query}`;
      }
      case 'get_page_info':
        return `获取页面信息（标题、URL、摘要、控件），${buildPageHintFromArgs(args)}`;
      case 'click_element': {
        const selector = args.selector ? `selector: ${args.selector}` : '未提供selector';
        const pageHint = buildPageHintFromArgs(args);
        return `准备点击元素，${selector}，${pageHint}`;
      }
      case 'input_text': {
        const selector = args.selector ? `selector: ${args.selector}` : '未提供selector';
        const text = args.text ? `输入: ${truncateText(args.text, 32)}` : '未提供文本';
        const pageHint = buildPageHintFromArgs(args);
        return `准备输入文本，${selector}，${text}，${pageHint}`;
      }
      case 'end_session':
        return '准备结束当前会话';
      default:
        return '准备执行工具';
    }
  }

  function buildToolResultSummary(toolCall, toolResult) {
    const toolName = toolCall ? toolCall.name : '';
    if (toolName === 'search_page') {
      const pageHint = buildPageHintFromResult(toolResult, toolCall);
      const failed = toolResult && toolResult.success === false;
      if (failed) {
        return { status: 'error', text: toolResult.error || '搜索页面打开失败' };
      }
      const title = toolResult?.title || '';
      const tabId = toolResult?.tabId || '';
      const hint = title || pageHint || (tabId ? `tab_id: ${tabId}` : '');
      return {
        status: 'success',
        text: hint ? `已打开搜索页面，${hint}` : '已打开搜索页面',
        tabId
      };
    }

    if (toolName === 'get_page_info') {
      const pageHint = buildPageHintFromResult(toolResult, toolCall);
      const failed = toolResult && toolResult.success === false;
      const errorText = toolResult && toolResult.error ? toolResult.error : '获取页面信息失败';
      const successText = pageHint ? `已获取页面信息，${pageHint}` : '已获取页面信息';
      return {
        status: failed ? 'error' : 'success',
        text: failed ? errorText : successText
      };
    }

    if (toolResult && toolResult.success === false) {
      return {
        status: 'error',
        text: toolResult.error || '工具执行失败'
      };
    }

    if (toolName === 'click_element') {
      const tagName =
        toolResult && toolResult.tagName ? `目标: ${toolResult.tagName.toLowerCase()}` : '';
      const role = toolResult && toolResult.role ? `role=${toolResult.role}` : '';
      const type = toolResult && toolResult.type ? `type=${toolResult.type}` : '';
      const pageHint = buildPageHintFromResult(toolResult, toolCall);
      const cancelled = toolResult && toolResult.cancelled ? '事件被取消' : '';
      const details = [tagName, role, type, cancelled, pageHint].filter(Boolean).join('，');
      return {
        status: 'success',
        text: details ? `点击成功，${details}` : '点击成功'
      };
    }

    if (toolName === 'input_text') {
      const pageHint = buildPageHintFromResult(toolResult, toolCall);
      return {
        status: 'success',
        text: pageHint ? `已输入文本，${pageHint}` : '已输入文本'
      };
    }

    return {
      status: 'success',
      text: '工具已执行'
    };
  }

  async function sendAgentRequest(messages, streamingElement) {
    agentStreamingTaskId = `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    agentStreamingElement = streamingElement;
    setInputEnabled(false);
    try {
      const tools = getAiToolsSchema();
      const result = await ipcRenderer.invoke('ai-agent', {
        messages,
        tools,
        taskId: agentStreamingTaskId
      });

      return result;
    } finally {
      agentStreamingElement = null;
      agentStreamingTaskId = null;
      setInputEnabled(true);
    }
  }

  async function runAgentConversation(session, userText) {
    isAgentProcessing = true;

    // 初始化任务状态
    if (typeof resetTaskState === 'function') resetTaskState();
    if (typeof updateTaskState === 'function') {
      const initPageInfo = typeof getCurrentPageInfo === 'function' ? getCurrentPageInfo() : null;
      updateTaskState({
        goal: userText,
        completedSteps: [],
        currentPage: initPageInfo ? `${initPageInfo.title || initPageInfo.url}` : '未知',
        lastAction: '用户发起任务'
      });
    }

    const systemPrompt =
      buildSystemPrompt({
        mode: 'agent',
        pageContext: session.pageContext,
        pageList: typeof getPageList === 'function' ? getPageList() : [],
        includePageContext: false,
        currentPageInfo: typeof getCurrentPageInfo === 'function' ? getCurrentPageInfo() : null,
        taskState: typeof getTaskState === 'function' ? getTaskState() : null,
        t
      }) +
      '\n\n你是Agent模式，可以使用工具来帮助用户完成任务。' +
      '\n\n可用工具：' +
      '\n- search_page(query): 新建标签页搜索关键词，返回页面信息和tab_id。当需要在网上查找信息时使用。' +
      '\n- get_page_info(tab_id?): 获取指定页面的URL、标题、摘要和可交互元素列表。默认当前标签页。' +
      '\n- click_element(selector, tab_id?): 点击页面元素。selector必须来自get_page_info返回的controls。' +
      '\n- input_text(selector, text, tab_id?): 在输入框中输入文本。selector必须来自get_page_info返回的controls。' +
      '\n- end_session(summary): 结束会话，summary为最终总结（支持Markdown），将直接展示给用户。' +
      '\n\n操作规范：' +
      '\n1. 需要搜索信息时，先调用search_page打开搜索结果页面。' +
      '\n2. 需要点击或输入前，先调用get_page_info获取页面信息与controls。' +
      '\n3. 操作非当前页面时，在工具参数中提供tab_id以指定目标页面。' +
      '\n4. 仅使用controls中提供的selector或用户明确给出的selector，不要凭空猜测。' +
      '\n5. 点击工具会默认等待5秒后检查页面状态，最长100秒；不要在回复里输出"等待X秒"。' +
      '\n6. 每次工具调用后，根据结果决定下一步。任务完成后调用end_session并提供总结。' +
      '\n7. 优先使用search_page查找信息，而非要求用户提供。' +
      '\n8. 如果搜索结果页面需要进一步操作，使用get_page_info获取controls后再点击。';

    // 还原历史消息格式，确保tool和assistant(tool_calls)字段正确
    const rawHistory = await historyStorage.getMessages(session.id, { limit: 50 });
    const formattedHistory = rawHistory
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

    // 截断历史消息，保留最近的消息防止 token 超限
    // 根据上下文大小动态计算：每条消息约 500 token，保留 60% 给历史
    const contextSize = store ? store.get('settings.aiContextSize', 8192) : 8192;
    const maxHistoryMessages = Math.max(6, Math.floor((contextSize * 0.6) / 500));
    const truncatedHistory =
      formattedHistory.length > maxHistoryMessages
        ? formattedHistory.slice(-maxHistoryMessages)
        : formattedHistory;

    agentMessageHistory = [
      { role: 'system', content: systemPrompt },
      ...truncatedHistory,
      { role: 'user', content: userText }
    ];

    let maxIterations = 30;
    let textOnlyCount = 0;
    // 使用Set存储处理后的消息内容，用于快速检测重复
    // 存储的是trim().toLowerCase()处理后的内容，以忽略大小写和前后空格的差异
    const previousMessages = new Set();
    const completionKeywords = [
      '任务完成',
      '总结如下',
      '已完成',
      '结束',
      '完毕',
      '完成了',
      'summary',
      'completed',
      'finished',
      'end'
    ];
    while (isAgentProcessing && maxIterations > 0) {
      maxIterations--;

      // 动态截断：保留 system prompt + 最近的消息，防止 token 超限
      const maxLiveMessages = Math.max(10, Math.floor((contextSize * 0.8) / 500));
      if (agentMessageHistory.length > maxLiveMessages) {
        const systemMsg = agentMessageHistory[0];
        const recentMessages = agentMessageHistory.slice(-(maxLiveMessages - 5));
        agentMessageHistory = [systemMsg, ...recentMessages];
      }

      const aiMsgElement = addChatMessage('', 'ai', true);

      try {
        const result = await sendAgentRequest(agentMessageHistory, aiMsgElement);
        finishStreamingMessage(aiMsgElement);

        if (!result?.success) {
          throw new Error(result?.error || 'Agent request failed');
        }

        if (result.type === 'message') {
          // 渲染思考内容和正文
          const fullText = result.reasoningContent
            ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content}`
            : result.content;
          updateStreamingMessage(aiMsgElement, fullText);
          finishStreamingMessage(aiMsgElement);
          agentMessageHistory.push({ role: 'assistant', content: result.content });
          // 保存思考内容到历史（使用标记以便还原时渲染思考下拉框）
          const savedContent = result.reasoningContent
            ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content}`
            : result.content;
          await historyStorage.addMessage(session.id, {
            role: 'assistant',
            content: savedContent
          });
          // 纯文本回复不自动结束，继续循环等待AI决定是否调用end_session
          // 但如果AI连续返回纯文本且满足以下条件之一，则视为任务完成：
          // 1. 内容为空
          // 2. 内容与之前的回复重复
          // 3. 内容包含完成关键词
          // 4. 连续5次返回纯文本
          if (!result.content || result.content.trim().length === 0) {
            break;
          }

          const content = result.content.trim().toLowerCase();

          // 检查内容是否与历史消息重复
          const isDuplicate = previousMessages.has(content);
          previousMessages.add(content);

          // 检查内容是否包含完成关键词
          const containsCompletionKeyword = completionKeywords.some(keyword =>
            content.includes(keyword.toLowerCase())
          );

          textOnlyCount++;

          // 智能终止策略
          if (isDuplicate || containsCompletionKeyword || textOnlyCount >= 5) {
            break;
          }
          continue;
        }

        if (result.type === 'tool_calls') {
          // 重置纯文本回复计数器和历史消息集合，因为AI调用了工具
          textOnlyCount = 0;
          previousMessages.clear();
          // 渲染思考内容（如果有）
          let firstToolTarget = aiMsgElement;
          const fullText = result.reasoningContent
            ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content || ''}`
            : result.content || '';
          if (fullText) {
            updateStreamingMessage(aiMsgElement, fullText);
            finishStreamingMessage(aiMsgElement);
            firstToolTarget = null;
          }

          if (typeof autoCollapseThinkingDropdown === 'function') {
            autoCollapseThinkingDropdown(aiMsgElement);
          }

          if (
            firstToolTarget &&
            (firstToolTarget.querySelector('.think-dropdown') ||
              firstToolTarget.querySelector('.message-content') ||
              String(firstToolTarget.textContent || '').trim().length > 0)
          ) {
            firstToolTarget = null;
          }

          const toolMessages = new Map();
          result.toolCalls.forEach((toolCall, index) => {
            if (toolCall.name === 'end_session') {
              toolMessages.set(toolCall.id, null);
              return;
            }
            const target =
              index === 0 && firstToolTarget ? firstToolTarget : addChatMessage('', 'ai');
            toolMessages.set(toolCall.id, target);
            renderToolCard(target, {
              title: getToolTitle(toolCall.name),
              description: buildToolCallDescription(toolCall),
              status: 'pending'
            });
          });

          const openAiToolCalls = result.toolCalls.map(call => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments || {})
            }
          }));

          agentMessageHistory.push({
            role: 'assistant',
            content: null,
            tool_calls: openAiToolCalls
          });

          // 保存带工具调用的助手消息到历史
          const assistantSavedContent = result.reasoningContent
            ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content || ''}`
            : result.content || '';
          await historyStorage.addMessage(session.id, {
            role: 'assistant',
            content: assistantSavedContent,
            metadata: {
              toolCalls: result.toolCalls.map(call => ({
                id: call.id,
                name: call.name,
                arguments: call.arguments
              }))
            }
          });

          for (const toolCall of result.toolCalls) {
            const toolResult = await toolsExecutor.execute(toolCall);
            const target = toolMessages.get(toolCall.id) || addChatMessage('', 'ai');

            if (toolCall.name === 'end_session') {
              // 将 summary 以 Markdown 渲染到消息区域，不显示工具卡片
              const summaryText = toolCall.arguments?.summary || toolResult?.summary || '';
              if (summaryText) {
                const summaryMsg = addChatMessage('', 'ai');
                const contentDiv = documentRef.createElement('div');
                contentDiv.className = 'message-content';
                renderMarkdownToElement(contentDiv, summaryText, documentRef);
                summaryMsg.appendChild(contentDiv);
              }
              // 保存结束会话工具结果到历史
              await historyStorage.addMessage(session.id, {
                role: 'tool',
                content: JSON.stringify(toolResult),
                metadata: {
                  toolCallId: toolCall.id,
                  toolName: toolCall.name,
                  status: 'success',
                  description: summaryText || '会话已结束'
                }
              });
              isAgentProcessing = false;
              break;
            }

            agentMessageHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult)
            });

            const summary = buildToolResultSummary(toolCall, toolResult);
            renderToolCard(target, {
              title: getToolTitle(toolCall.name),
              description: summary.text,
              status: summary.status
            });
            // 更新任务状态追踪
            if (typeof updateTaskState === 'function') {
              const steps =
                typeof getTaskState === 'function' && getTaskState()
                  ? getTaskState().completedSteps || []
                  : [];
              steps.push(`${getToolTitle(toolCall.name)}: ${summary.text}`);
              const currentPageInfo =
                typeof getCurrentPageInfo === 'function' ? getCurrentPageInfo() : null;
              updateTaskState({
                completedSteps: steps,
                currentPage: currentPageInfo
                  ? `${currentPageInfo.title || currentPageInfo.url}`
                  : getTaskState()?.currentPage || '未知',
                lastAction: summary.text
              });
            }
            // 保存工具结果到历史
            await historyStorage.addMessage(session.id, {
              role: 'tool',
              content: JSON.stringify(toolResult),
              metadata: {
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                status: summary.status,
                description: summary.text
              }
            });
          }

          if (!isAgentProcessing) break;
        }

        await updateSession(session.id, { updatedAt: Date.now() });
        renderSessionsList();
        if (typeof onIteration === 'function') onIteration();
      } catch (error) {
        console.error('Agent error:', error);
        const errMsg = error && error.message ? String(error.message) : '';

        // token 超限错误：自动截断历史重试一次
        if (
          (errMsg.includes('context_length') ||
            errMsg.includes('max_tokens') ||
            errMsg.includes('token limit') ||
            errMsg.includes('too many tokens') ||
            errMsg.includes('maximum context') ||
            errMsg.includes('context window')) &&
          agentMessageHistory.length > 6
        ) {
          console.warn('[agent] Token limit exceeded, truncating history and retrying...');
          const systemMsg = agentMessageHistory[0];
          const minKeep = Math.max(4, Math.floor((contextSize * 0.3) / 500));
          const recentMessages = agentMessageHistory.slice(-minKeep);
          agentMessageHistory = [systemMsg, ...recentMessages];
          // 移除失败的空消息元素
          if (aiMsgElement && aiMsgElement.parentNode) {
            aiMsgElement.parentNode.removeChild(aiMsgElement);
          }
          continue;
        }

        aiMsgElement.innerText = `${t('ai.error') || '发生错误'}: ${errMsg}`;
        finishStreamingMessage(aiMsgElement);
        isAgentProcessing = false;
      }
    }

    isAgentProcessing = false;
  }

  return {
    runAgentConversation,
    setupAgentStreamingListener,
    isProcessing: () => isAgentProcessing,
    getMessageHistory: () => agentMessageHistory
  };
}

module.exports = {
  createAiAgentRunner
};
