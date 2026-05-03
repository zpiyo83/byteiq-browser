/**
 * AI Agent 模式执行器
 */

const { getAiToolsSchema, buildToolsSystemPrompt } = require('../tools/ai-tools-registry');
const { renderMarkdownToElement } = require('../chat/ai-markdown-renderer');
const {
  parseToolCallsFromText,
  removeToolCallTextFromContent
} = require('../tools/ai-tool-call-parser');
const { createToolCardUI } = require('../tools/ai-tool-card-ui');
const { createAgentPromptBuilder } = require('./ai-agent-prompt-builder');

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
    getTaskState,
    bindTabToSession,
    externalTodoManager,
    contextIsolation
  } = options;

  let isAgentProcessing = false;
  let agentMessageHistory = [];

  // 工具结果内容截断阈值（字符数），超过此长度的内容只保留摘要
  const TOOL_RESULT_MAX_CHARS = 3000;

  // 需要截断的工具名集合（返回大量页面内容的工具）
  const LARGE_RESULT_TOOLS = new Set(['get_page_info', 'search_page']);

  /**
   * 截断工具结果内容，防止内存膨胀和 IPC 传输过大
   * 对于 get_page_info/search_page 等大结果工具，只保留摘要信息
   * @param {string} toolName - 工具名
   * @param {*} toolResult - 工具执行结果
   * @returns {{ content: string, summary: string }} 截断后的内容和摘要
   */
  function truncateToolResult(toolName, toolResult) {
    const fullContent = JSON.stringify(toolResult);

    // 非大结果工具：仅做长度截断
    if (!LARGE_RESULT_TOOLS.has(toolName)) {
      if (fullContent.length <= TOOL_RESULT_MAX_CHARS) {
        return { content: fullContent, summary: fullContent };
      }
      return {
        content: fullContent.substring(0, TOOL_RESULT_MAX_CHARS) + '...[truncated]',
        summary: fullContent.substring(0, TOOL_RESULT_MAX_CHARS) + '...[truncated]'
      };
    }

    // 大结果工具：提取摘要字段，丢弃页面正文和控件列表
    const summary = {
      success: toolResult?.success,
      error: toolResult?.error || '',
      tabId: toolResult?.tabId || '',
      url: toolResult?.url || '',
      title: toolResult?.title || '',
      message: toolResult?.message || ''
    };

    // 如果有 meta 信息，保留简短版本
    if (toolResult?.meta) {
      summary.meta = {
        description: (toolResult.meta.description || '').substring(0, 200),
        keywords: (toolResult.meta.keywords || '').substring(0, 100)
      };
    }

    // 如果有 content，只保留前 500 字符
    if (toolResult?.content && typeof toolResult.content === 'string') {
      summary.contentPreview = toolResult.content.substring(0, 500);
      if (toolResult.content.length > 500) {
        summary.contentPreview += '...[truncated]';
      }
      summary.contentLength = toolResult.content.length;
    }

    // 如果有 controls，只保留数量统计
    if (toolResult?.controls) {
      summary.controlsCount = {
        buttons: toolResult.controls.buttons?.length || 0,
        inputs: toolResult.controls.inputs?.length || 0,
        links: toolResult.controls.links?.length || 0
      };
    }

    const summaryStr = JSON.stringify(summary);
    return { content: summaryStr, summary: summaryStr };
  }

  // 将工具提示词注入到 messages 中（合并到已有的 system 消息或新建）
  function injectToolsPrompt(messages, toolsPrompt) {
    const result = [...messages];
    if (result.length > 0 && result[0].role === 'system') {
      result[0] = { ...result[0], content: result[0].content + '\n\n' + toolsPrompt };
    } else {
      result.unshift({ role: 'system', content: toolsPrompt });
    }
    return result;
  }

  // 当前 Agent 操作的守卫（用于会话隔离）
  let currentOperationGuard = null;

  // Todo 管理器
  const todoManager = externalTodoManager;

  // Agent 流式显示状态
  let agentStreamingElement = null;
  let agentStreamingTaskId = null;

  // 创建工具卡片 UI 实例
  const toolCardUI = createToolCardUI({ documentRef, getPageList, store });

  // 创建提示词构建器实例
  const promptBuilder = createAgentPromptBuilder({
    todoManager,
    getPageList,
    getCurrentPageInfo,
    getTaskState,
    t,
    buildSystemPrompt
  });

  /**
   * 监听 Agent 流式响应
   * 优化：使用 requestAnimationFrame 批处理 DOM 更新（同 ai-chat-handler）
   */
  function setupAgentStreamingListener() {
    let pendingUpdate = null;
    let frameScheduled = false;

    ipcRenderer.on('ai-agent-streaming', (_event, data) => {
      if (!agentStreamingElement) return;
      if (data.taskId !== agentStreamingTaskId) return;

      // 只在有正文内容时才添加endthink标签，思考进行中不添加
      // 让StreamingThinkParser正确识别isThinking状态以自动展开思考下拉框
      const fullText = data.reasoningContent
        ? data.accumulated
          ? `<!--think-->${data.reasoningContent}<!--endthink-->${data.accumulated}`
          : `<!--think-->${data.reasoningContent}`
        : data.accumulated;

      // 批处理 DOM 更新以减少重排
      pendingUpdate = fullText;
      if (frameScheduled) return;

      frameScheduled = true;
      requestAnimationFrame(() => {
        if (pendingUpdate !== null && agentStreamingElement) {
          updateStreamingMessage(agentStreamingElement, pendingUpdate);
        }
        frameScheduled = false;
      });
    });
  }

  async function sendAgentRequest(messages, streamingElement) {
    // 注册请求操作守卫，用于会话隔离
    const operationGuard = contextIsolation?.registerOperation?.('agent-request');

    agentStreamingTaskId = `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    agentStreamingElement = streamingElement;
    setInputEnabled(false);
    try {
      // 检查会话是否仍然活跃
      if (operationGuard && !operationGuard.guard()) {
        throw new Error('Session no longer active');
      }

      const nativeToolCall = store.get('settings.nativeToolCall', true);
      let tools = null;
      let finalMessages = messages;

      if (nativeToolCall) {
        // 原生工具调用：工具注入 API 的 tools 参数
        tools = getAiToolsSchema(store);
      } else {
        // 非原生模式：工具转为系统提示词注入 messages
        const toolsPrompt = buildToolsSystemPrompt(store);
        if (toolsPrompt) {
          finalMessages = injectToolsPrompt(messages, toolsPrompt);
        }
      }

      const result = await ipcRenderer.invoke('ai-agent', {
        messages: finalMessages,
        tools,
        taskId: agentStreamingTaskId
      });

      // 返回前再次检查守卫
      if (operationGuard && !operationGuard.guard()) {
        throw new Error('Session no longer active');
      }

      return result;
    } finally {
      // 不在此处清空 agentStreamingElement，避免最后几帧流式数据丢失
      // （rAF回调可能还没执行，清空后会导致updateStreamingMessage被跳过）
      // agentStreamingElement 会在下一轮迭代 sendAgentRequest 调用时自动覆盖，
      // 或在 runAgentConversation 循环结束后统一清空
      agentStreamingTaskId = null;
      // 注意：此处不调用 setInputEnabled(true)
      // agent 模式下 while 循环会多次调用 sendAgentRequest，
      // 输入框应在 runAgentConversation 整体结束时才启用
      // 清理操作守卫
      if (operationGuard && typeof operationGuard.dispose === 'function') {
        operationGuard.dispose();
      }
    }
  }

  async function runAgentConversation(session, userText) {
    // 注册操作守卫，用于会话隔离
    currentOperationGuard = contextIsolation?.registerOperation?.('agent-loop');

    isAgentProcessing = true;

    // 锁定 todoManager 的 session ID，避免 agent 运行期间标签页切换导致 session 变化
    if (todoManager && typeof todoManager.lockSession === 'function') {
      todoManager.lockSession(session.id);
    }

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

    // 构建系统提示词
    const systemPrompt = promptBuilder.buildAgentSystemPrompt(session, userText);

    // 还原历史消息格式，确保tool和assistant(tool_calls)字段正确
    const rawHistory = await historyStorage.getMessages(session.id, { limit: 50 });
    const formattedHistory = promptBuilder.formatHistoryMessages(rawHistory);

    // 截断历史消息，保留最近的消息防止 token 超限
    const contextSize = store ? store.get('settings.aiContextSize', 8192) : 8192;
    const maxHistoryMessages = Math.max(8, Math.floor((contextSize * 0.6) / 500));
    const truncatedHistory = promptBuilder.truncateHistorySmart(
      formattedHistory,
      maxHistoryMessages
    );

    // 增强系统提示词：注入已访问网站清单
    const enhancedSystemPrompt = promptBuilder.enhanceSystemPromptWithPages(systemPrompt);

    agentMessageHistory = [
      { role: 'system', content: enhancedSystemPrompt },
      ...truncatedHistory,
      { role: 'user', content: userText }
    ];

    let maxIterations = 30;
    let textOnlyCount = 0;
    // 使用Set存储处理后的消息内容，用于快速检测重复
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
    let aiMsgElement = null;
    try {
      while (isAgentProcessing && maxIterations > 0) {
        maxIterations--;

        // 会话隔离守卫检查：如果会话已变更，立即退出循环
        if (currentOperationGuard && !currentOperationGuard.guard()) {
          console.warn('[ai-agent-runner] Session changed, breaking agent loop');
          break;
        }

        // 动态刷新系统提示词中的 todo 部分
        if (agentMessageHistory.length > 0 && agentMessageHistory[0].role === 'system') {
          agentMessageHistory[0].content = promptBuilder.refreshTodoInSystemPrompt(
            agentMessageHistory[0].content
          );
        }

        // 智能动态截断
        const maxLiveMessages = Math.max(12, Math.floor((contextSize * 0.8) / 500));
        agentMessageHistory = promptBuilder.truncateLiveHistory(
          agentMessageHistory,
          maxLiveMessages
        );

        aiMsgElement = addChatMessage('', 'ai', true);

        let result = await sendAgentRequest(agentMessageHistory, aiMsgElement);

        if (!result?.success) {
          finishStreamingMessage(aiMsgElement);
          throw new Error(result?.error || 'Agent request failed');
        }

        if (result.type === 'message') {
          // 当模型不支持 tools API 时（usedToolsFallback），或用户主动关闭原生工具调用时，
          // 尝试从文本中解析工具调用
          const nativeToolCall = store.get('settings.nativeToolCall', true);
          if ((result.usedToolsFallback || !nativeToolCall) && result.content) {
            const parsedToolCalls = parseToolCallsFromText(result.content);
            if (parsedToolCalls && parsedToolCalls.length > 0) {
              result = {
                success: true,
                type: 'tool_calls',
                toolCalls: parsedToolCalls,
                reasoningContent: result.reasoningContent || '',
                content: removeToolCallTextFromContent(result.content),
                taskId: result.taskId
              };
            }
          }

          // 如果经过上面的解析后仍然是 message 类型，正常渲染
          if (result.type === 'message') {
            const fullText = result.reasoningContent
              ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content}`
              : result.content;
            updateStreamingMessage(aiMsgElement, fullText);
            finishStreamingMessage(aiMsgElement);
            agentMessageHistory.push({ role: 'assistant', content: result.content });
            // 保存思考内容到历史
            const savedContent = result.reasoningContent
              ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content}`
              : result.content;
            if (contextIsolation?.isSessionActive?.(session.id)) {
              await historyStorage.addMessage(session.id, {
                role: 'assistant',
                content: savedContent
              });
            }
            // 纯文本回复不自动结束，继续循环等待AI决定是否调用end_session
            if (!result.content || result.content.trim().length === 0) {
              break;
            }

            const content = result.content.trim().toLowerCase();
            const isDuplicate = previousMessages.has(content);
            previousMessages.add(content);
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
        }

        if (result.type === 'tool_calls') {
          // 重置纯文本回复计数器和历史消息集合
          textOnlyCount = 0;
          previousMessages.clear();

          // 流式监听器已经把 AI 的思考+文字渲染到 aiMsgElement
          const hasStreamedContent =
            aiMsgElement.querySelector('.message-content') ||
            aiMsgElement.querySelector('.think-dropdown');
          if (hasStreamedContent) {
            finishStreamingMessage(aiMsgElement);
          } else if (result.content || result.reasoningContent) {
            const fullText = result.reasoningContent
              ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content || ''}`
              : result.content || '';
            updateStreamingMessage(aiMsgElement, fullText);
            finishStreamingMessage(aiMsgElement);
          } else {
            if (aiMsgElement.parentNode) {
              aiMsgElement.parentNode.removeChild(aiMsgElement);
            }
          }

          if (typeof autoCollapseThinkingDropdown === 'function' && hasStreamedContent) {
            autoCollapseThinkingDropdown(aiMsgElement);
          }

          const toolMessages = new Map();
          result.toolCalls.forEach(toolCall => {
            if (toolCall.name === 'end_session') {
              toolMessages.set(toolCall.id, null);
              return;
            }
            const target = addChatMessage('', 'ai');
            toolMessages.set(toolCall.id, target);
            toolCardUI.renderToolCard(target, {
              title: toolCardUI.getToolTitle(toolCall.name),
              description: toolCardUI.buildToolCallDescription(toolCall),
              status: 'pending',
              toolName: toolCall.name,
              args: toolCall.arguments
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
          if (contextIsolation?.isSessionActive?.(session.id)) {
            await historyStorage.addMessage(session.id, {
              role: 'assistant',
              content: assistantSavedContent,
              metadata: {
                thinkingContent: result.reasoningContent || '',
                actionContent: result.content || '',
                toolCalls: result.toolCalls.map(call => ({
                  id: call.id,
                  name: call.name,
                  arguments: call.arguments
                }))
              }
            });
          }

          for (let ti = 0; ti < result.toolCalls.length; ti++) {
            const toolCall = result.toolCalls[ti];

            // 工具间间隔 3 秒（首个工具无延迟）
            if (ti > 0) {
              await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // 执行前更新卡片状态为 running（旋转动画）
            const runningTarget = toolMessages.get(toolCall.id);
            if (runningTarget && toolCall.name !== 'end_session') {
              toolCardUI.renderToolCard(runningTarget, {
                title: toolCardUI.getToolTitle(toolCall.name),
                description: toolCardUI.buildToolCallDescription(toolCall),
                status: 'running',
                toolName: toolCall.name,
                args: toolCall.arguments
              });
            }

            const toolResult = await toolsExecutor.execute(toolCall);

            // 对于 search_page 工具，将新创建的标签页绑定到当前会话
            if (
              toolCall.name === 'search_page' &&
              toolResult?.success &&
              toolResult?.tabId &&
              session?.id &&
              typeof bindTabToSession === 'function'
            ) {
              try {
                bindTabToSession(toolResult.tabId, session.id);
              } catch (error) {
                console.warn('[ai-agent-runner] Failed to bind tab to session:', error);
              }
            }

            const target = toolMessages.get(toolCall.id) || addChatMessage('', 'ai');

            if (toolCall.name === 'end_session') {
              // 将 summary 以 Markdown 渲染到消息区域
              const summaryText = toolCall.arguments?.summary || toolResult?.summary || '';
              if (summaryText) {
                const summaryMsg = addChatMessage('', 'ai');
                const contentDiv = documentRef.createElement('div');
                contentDiv.className = 'message-content';
                renderMarkdownToElement(contentDiv, summaryText, documentRef);
                summaryMsg.appendChild(contentDiv);
              }
              if (contextIsolation?.isSessionActive?.(session.id)) {
                const endTruncated = truncateToolResult(toolCall.name, toolResult);
                await historyStorage.addMessage(session.id, {
                  role: 'tool',
                  content: endTruncated.summary,
                  metadata: {
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    status: 'success',
                    description: summaryText || '会话已结束'
                  }
                });
              }
              isAgentProcessing = false;
              break;
            }

            const truncated = truncateToolResult(toolCall.name, toolResult);
            agentMessageHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: truncated.content
            });

            const summary = toolCardUI.buildToolResultSummary(toolCall, toolResult);
            toolCardUI.renderToolCard(target, {
              title: toolCardUI.getToolTitle(toolCall.name),
              description: summary.text,
              status: summary.status,
              toolName: toolCall.name,
              args: toolCall.arguments,
              toolResult
            });
            // 更新任务状态追踪
            if (typeof updateTaskState === 'function') {
              const steps =
                typeof getTaskState === 'function' && getTaskState()
                  ? getTaskState().completedSteps || []
                  : [];
              steps.push(`${toolCardUI.getToolTitle(toolCall.name)}: ${summary.text}`);
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
            // 保存工具结果到历史（使用截断后的内容防止存储膨胀）
            if (contextIsolation?.isSessionActive?.(session.id)) {
              await historyStorage.addMessage(session.id, {
                role: 'tool',
                content: truncated.summary,
                metadata: {
                  toolCallId: toolCall.id,
                  toolName: toolCall.name,
                  status: summary.status,
                  description: summary.text
                }
              });
            }
          }

          if (!isAgentProcessing) break;
        }

        await updateSession(session.id, { updatedAt: Date.now() });
        renderSessionsList();
        if (typeof onIteration === 'function') onIteration();
      }
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
        if (aiMsgElement && aiMsgElement.parentNode) {
          aiMsgElement.parentNode.removeChild(aiMsgElement);
        }
      } else {
        if (aiMsgElement) {
          aiMsgElement.innerText = `${t('ai.error') || '发生错误'}: ${errMsg}`;
          finishStreamingMessage(aiMsgElement);
        }
      }

      isAgentProcessing = false;
    } finally {
      // 清理操作守卫
      if (currentOperationGuard && typeof currentOperationGuard.dispose === 'function') {
        currentOperationGuard.dispose();
      }
      currentOperationGuard = null;
      // 清理流式渲染状态（sendAgentRequest不再清空agentStreamingElement，此处统一清空）
      agentStreamingElement = null;
      agentStreamingTaskId = null;
      // agent 循环整体结束后才启用输入框
      setInputEnabled(true);
    }

    isAgentProcessing = false;

    // 解锁 todoManager 的 session ID
    if (todoManager && typeof todoManager.unlockSession === 'function') {
      todoManager.unlockSession();
    }
  }

  function abort() {
    if (!isAgentProcessing) return;
    // 通知主进程取消当前 Agent 请求
    if (agentStreamingTaskId) {
      ipcRenderer.send('cancel-ai-agent', { taskId: agentStreamingTaskId });
    }
    isAgentProcessing = false;

    // 清理流式渲染状态
    agentStreamingElement = null;
    agentStreamingTaskId = null;

    // 清理操作守卫
    if (currentOperationGuard && typeof currentOperationGuard.dispose === 'function') {
      currentOperationGuard.dispose();
      currentOperationGuard = null;
    }

    // 解锁 todoManager 的 session ID
    if (todoManager && typeof todoManager.unlockSession === 'function') {
      todoManager.unlockSession();
    }
  }

  function resetState() {
    // 中止当前处理
    abort();
    // 重置操作守卫（abort 中也会清理，这里确保双重保险）
    if (currentOperationGuard && typeof currentOperationGuard.dispose === 'function') {
      currentOperationGuard.dispose();
    }
    currentOperationGuard = null;
  }

  return {
    runAgentConversation,
    setupAgentStreamingListener,
    isProcessing: () => isAgentProcessing,
    getMessageHistory: () => agentMessageHistory,
    setMessageHistory: msgs => {
      agentMessageHistory = msgs;
    },
    abort,
    resetState
  };
}

module.exports = {
  createAiAgentRunner
};
