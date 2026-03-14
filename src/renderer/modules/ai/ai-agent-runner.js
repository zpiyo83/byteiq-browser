/**
 * AI Agent 模式执行器
 */

const { getAiToolsSchema } = require('./ai-tools-registry');

function createAiAgentRunner(options) {
  const {
    ipcRenderer,
    toolsExecutor,
    historyStorage,
    updateSession,
    renderSessionsList,
    addChatMessage,
    documentRef,
    t,
    buildSystemPrompt,
    setInputEnabled,
    getPageList
  } = options;

  let isAgentProcessing = false;
  let agentMessageHistory = [];

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

  async function sendAgentRequest(messages) {
    setInputEnabled(false);
    try {
      const tools = getAiToolsSchema();
      const result = await ipcRenderer.invoke('ai-agent', {
        messages,
        tools,
        taskId: `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`
      });

      return result;
    } finally {
      setInputEnabled(true);
    }
  }

  async function runAgentConversation(session, userText) {
    isAgentProcessing = true;

    const systemPrompt =
      buildSystemPrompt({
        mode: 'agent',
        pageContext: session.pageContext,
        pageList: typeof getPageList === 'function' ? getPageList() : [],
        includePageContext: false,
        t
      }) +
      '\n\n你是Agent模式，可以使用工具来帮助用户。可用工具：get_page_info（获取页面' +
      '信息）、click_element（点击元素）、input_text（输入文本）、end_session（结束会话）。' +
      '当你需要结束任务时，请调用end_session工具。' +
      '\n\n操作规范：' +
      '\n1. 需要点击或输入前，先调用get_page_info获取页面信息与controls。' +
      '\n2. get_page_info支持tab_id参数，可选择具体页面。' +
      '\n3. 如果不是当前页面，请在工具参数中提供tab_id以切换到目标页面。' +
      '\n4. 仅使用controls中提供的selector或用户明确给出的selector。' +
      '\n5. 不要凭空猜测按钮名称或选择器；找不到就重新获取或向用户确认。' +
      '\n6. 点击工具会默认等待5秒后检查页面状态，最长100秒；不要在回复里输出“等待X秒”。' +
      '\n7. 每次工具调用后，根据结果决定下一步。完成后调用end_session。';

    agentMessageHistory = [
      { role: 'system', content: systemPrompt },
      ...(await historyStorage.getMessages(session.id, { limit: 50 })),
      { role: 'user', content: userText }
    ];

    let maxIterations = 10;
    while (isAgentProcessing && maxIterations > 0) {
      maxIterations--;

      const aiMsgElement = addChatMessage('', 'ai', true);

      try {
        const result = await sendAgentRequest(agentMessageHistory);
        aiMsgElement.classList.remove('streaming');

        if (!result?.success) {
          throw new Error(result?.error || 'Agent request failed');
        }

        if (result.type === 'message') {
          aiMsgElement.innerText = result.content;
          agentMessageHistory.push({ role: 'assistant', content: result.content });
          await historyStorage.addMessage(session.id, {
            role: 'assistant',
            content: result.content
          });
          break;
        }

        if (result.type === 'tool_calls') {
          const toolMessages = new Map();
          result.toolCalls.forEach((toolCall, index) => {
            const target = index === 0 ? aiMsgElement : addChatMessage('', 'ai');
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

          for (const toolCall of result.toolCalls) {
            const toolResult = await toolsExecutor.execute(toolCall);
            const target = toolMessages.get(toolCall.id) || addChatMessage('', 'ai');

            if (toolCall.name === 'end_session') {
              renderToolCard(target, {
                title: getToolTitle(toolCall.name),
                description: '会话已结束',
                status: 'success'
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
          }

          if (!isAgentProcessing) break;
        }

        await updateSession(session.id, { updatedAt: Date.now() });
        renderSessionsList();
      } catch (error) {
        console.error('Agent error:', error);
        aiMsgElement.innerText = `${t('ai.error') || '发生错误'}: ${error.message}`;
        aiMsgElement.classList.remove('streaming');
        isAgentProcessing = false;
      }
    }

    isAgentProcessing = false;
  }

  return {
    runAgentConversation,
    isProcessing: () => isAgentProcessing
  };
}

module.exports = {
  createAiAgentRunner
};
