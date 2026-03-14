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
    t,
    buildSystemPrompt,
    setInputEnabled
  } = options;

  let isAgentProcessing = false;
  let agentMessageHistory = [];

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
          aiMsgElement.innerText = `[调用工具: ${result.toolCalls.map(tl => tl.name).join(', ')}]`;

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

            addChatMessage(`[工具 ${toolCall.name} 结果]: ${JSON.stringify(toolResult)}`, 'ai');
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
