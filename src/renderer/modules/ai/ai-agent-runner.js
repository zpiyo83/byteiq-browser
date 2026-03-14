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
    setInputEnabled
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

  function buildToolResultSummary(toolName, toolResult) {
    if (toolName === 'get_page_info') {
      return {
        status: toolResult && toolResult.success === false ? 'error' : 'success',
        text: toolResult && toolResult.success === false
          ? (toolResult.error || '获取页面信息失败')
          : '已获取页面信息'
      };
    }

    if (toolResult && toolResult.success === false) {
      return {
        status: 'error',
        text: toolResult.error || '工具执行失败'
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

    const systemPrompt = buildSystemPrompt({
      mode: 'agent',
      pageContext: session.pageContext,
      t
    }) +
      '\n\n你是Agent模式，可以使用工具来帮助用户。可用工具：get_page_info（获取页面' +
      '信息）、click_element（点击元素）、input_text（输入文本）、end_session（结束' +
      '会话）。当你需要结束任务时，请调用end_session工具。' +
      '\n\n操作规范：' +
      '\n1. 需要点击或输入前，先调用get_page_info获取页面信息与controls。' +
      '\n2. 仅使用controls中提供的selector或用户明确给出的selector。' +
      '\n3. 不要凭空猜测按钮名称或选择器；找不到就重新获取或向用户确认。' +
      '\n4. 每次工具调用后，根据结果决定下一步。完成后调用end_session。';

    agentMessageHistory = [
      { role: 'system', content: systemPrompt },
      ...await historyStorage.getMessages(session.id, { limit: 50 }),
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
          const toolNames = result.toolCalls.map(tl => tl.name).join('、');
          renderToolCard(aiMsgElement, {
            title: toolNames,
            description: `准备调用工具：${toolNames}`,
            status: 'pending'
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

            if (toolCall.name === 'end_session') {
              isAgentProcessing = false;
              addChatMessage(t('ai.sessionEnded') || '会话已结束', 'ai');
              break;
            }

            agentMessageHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult)
            });

            const summary = buildToolResultSummary(toolCall.name, toolResult);
            const resultMessage = addChatMessage('', 'ai');
            renderToolCard(resultMessage, {
              title: toolCall.name,
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
