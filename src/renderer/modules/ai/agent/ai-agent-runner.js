/**
 * AI Agent 模式执行器
 */

const { getAiToolsSchema, buildToolsSystemPrompt } = require('../tools/ai-tools-registry');
const {
  parseToolCallsFromText,
  removeToolCallTextFromContent
} = require('../tools/ai-tool-call-parser');
const { getModelContextSize } = require('../context/ai-model-context-config');
const { createToolCardUI } = require('../tools/ai-tool-card-ui');
const { createAgentPromptBuilder } = require('./ai-agent-prompt-builder');
const { formatHistoryMessages } = require('../context/ai-history-formatter');
const { injectToolsPrompt } = require('./ai-agent-utils');
const { createToolLoopHandler } = require('./ai-agent-tool-loop');

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
    contextIsolation,
    getBgTaskRunner, // 新增: 获取后台任务执行器
    onBgTaskResultReady // 新增: 后台任务结果准备就绪回调
  } = options;

  let isAgentProcessing = false;
  let agentMessageHistory = [];

  // 当前 Agent 操作的守卫（用于会话隔离）
  let currentOperationGuard = null;

  // 后台任务结果队列: 存储已完成但未注入的后台任务结果
  const pendingBgTaskResults = [];

  // 当前是否有正在输出的请求
  let isStreamingActive = false;

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

  // 创建工具循环处理器实例
  const toolLoopHandler = createToolLoopHandler({
    toolCardUI,
    toolsExecutor,
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    autoCollapseThinkingDropdown,
    historyStorage,
    contextIsolation,
    updateTaskState,
    getTaskState,
    getCurrentPageInfo,
    bindTabToSession,
    documentRef,
    handleBgTaskResult, // 新增: 处理后台任务结果的回调
    handleWaitSeconds // 新增: 处理等待秒数的回调
  });

  /**
   * 处理后台任务结果注入
   * @param {Object} task - 后台任务对象
   */
  function handleBgTaskResult(task) {
    if (!task || task.status !== 'completed') return;

    // 无论是否正在输出,都立即注入结果到历史消息
    // 这样确保下一轮请求时AI能看到后台任务结果
    injectBgTaskResultToHistory(task);

    // 如果当前正在输出,将渲染加入队列,等请求结束后处理
    if (isStreamingActive) {
      pendingBgTaskResults.push(task);
    } else {
      // 当前没有输出,立即渲染完成卡片
      renderBgTaskCompleteCard(task);
    }
  }

  /**
   * 渲染后台任务完成卡片
   * @param {Object} task - 后台任务对象
   */
  function renderBgTaskCompleteCard(task) {
    const target = addChatMessage('', 'ai');
    toolCardUI.renderToolCard(target, {
      title: '后台任务已完成',
      description: `任务 #${task.id}: ${task.name}`,
      status: 'success',
      toolName: 'background_task_complete',
      result: task.result,
      taskId: task.id
    });
  }

  /**
   * 将后台任务结果注入到消息历史
   * @param {Object} task - 后台任务对象
   */
  function injectBgTaskResultToHistory(task) {
    if (!agentMessageHistory || agentMessageHistory.length === 0) return;

    // 构建完整的系统通知,包含任务结果详情
    const resultContent = task.result || '无结果';

    // 如果有工具调用历史,提取关键信息
    let toolSummary = '';
    if (task.toolCallHistory && task.toolCallHistory.length > 0) {
      const toolNames = task.toolCallHistory
        .map(tc => tc.title || tc.toolName)
        .filter(name => name)
        .join(' → ');
      if (toolNames) {
        toolSummary = `\n执行步骤: ${toolNames}`;
      }
    }

    // 添加系统消息提示后台任务已完成
    const systemNotice = {
      role: 'system',
      content: `[系统通知] 后台任务 #${task.id} 已完成。
任务: ${task.name}
结果: ${resultContent}${toolSummary}

请根据任务结果继续处理。`
    };

    // 在最后的用户消息前插入系统通知
    const lastUserMsgIndex = agentMessageHistory.findIndex(
      (msg, idx) => msg.role === 'user' && idx === agentMessageHistory.length - 1
    );

    if (lastUserMsgIndex !== -1) {
      agentMessageHistory.splice(lastUserMsgIndex, 0, systemNotice);
    } else {
      agentMessageHistory.push(systemNotice);
    }
  }

  /**
   * 处理等待秒数
   * @param {number} seconds - 等待秒数
   */
  async function handleWaitSeconds(seconds) {
    if (!seconds || seconds < 1 || seconds > 300) return;

    // 渲染等待卡片
    const target = addChatMessage('', 'ai');
    toolCardUI.renderToolCard(target, {
      title: '等待',
      description: `等待 ${seconds} 秒后继续`,
      status: 'running',
      toolName: 'wait_seconds'
    });

    // 等待指定秒数
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));

    // 更新卡片状态为完成
    toolCardUI.renderToolCard(target, {
      title: '等待',
      description: `已等待 ${seconds} 秒`,
      status: 'success',
      toolName: 'wait_seconds'
    });
  }

  /**
   * 处理所有待注入的后台任务结果
   */
  function processPendingBgTaskResults() {
    if (pendingBgTaskResults.length === 0) return;

    // 按任务完成时间排序
    pendingBgTaskResults.sort((a, b) => a.completedAt - b.completedAt);

    // 渲染所有完成卡片（结果已在 handleBgTaskResult 中注入）
    pendingBgTaskResults.forEach(task => {
      renderBgTaskCompleteCard(task);
    });

    // 清空队列
    pendingBgTaskResults.length = 0;
  }

  // 注册后台任务结果回调
  if (typeof onBgTaskResultReady === 'function') {
    onBgTaskResultReady(handleBgTaskResult);
  }

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
      const capturedTaskId = agentStreamingTaskId;
      requestAnimationFrame(() => {
        if (
          pendingUpdate !== null &&
          agentStreamingElement &&
          agentStreamingTaskId === capturedTaskId
        ) {
          updateStreamingMessage(agentStreamingElement, pendingUpdate);
        }
        frameScheduled = false;
      });
    });
  }

  async function sendAgentRequest(messages, streamingElement) {
    // 注册请求操作守卫,用于会话隔离
    const operationGuard = contextIsolation?.registerOperation?.('agent-request');

    agentStreamingTaskId = `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    agentStreamingElement = streamingElement;
    isStreamingActive = true; // 标记流式输出开始
    setInputEnabled(false);
    try {
      // 检查会话是否仍然活跃
      if (operationGuard && !operationGuard.guard()) {
        throw new Error('Session no longer active');
      }

      const nativeToolCall = true;
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
      isStreamingActive = false; // 标记流式输出结束
      // 处理待注入的后台任务结果
      processPendingBgTaskResults();
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
    const formattedHistory = formatHistoryMessages(rawHistory);

    // 截断历史消息，保留最近的消息防止 token 超限
    const contextSize = getModelContextSize(store);
    const maxHistoryMessages = Math.max(8, Math.floor((contextSize * 0.6) / 500));
    const truncatedHistory = promptBuilder.truncateHistorySmart(
      formattedHistory,
      maxHistoryMessages
    );

    // 增强系统提示词：注入已访问网站清单
    const enhancedSystemPrompt = promptBuilder.enhanceSystemPromptWithPages(systemPrompt);

    // 在用户消息后追加本轮对话的todo内容
    const todoBrief =
      todoManager && typeof todoManager.buildTodoPrompt === 'function'
        ? todoManager.buildTodoPrompt()
        : '';
    const userContent = todoBrief ? `${userText}\n\n---\n本轮对话待办内容：${todoBrief}` : userText;

    agentMessageHistory = [
      { role: 'system', content: enhancedSystemPrompt },
      ...truncatedHistory,
      { role: 'user', content: userContent }
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
          // 当模型不支持 tools API 时（usedToolsFallback），
          // 尝试从文本中解析工具调用
          if (result.usedToolsFallback && result.content) {
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

          const { shouldBreak } = await toolLoopHandler.handleToolCalls({
            result,
            aiMsgElement,
            session,
            agentMessageHistory
          });

          if (shouldBreak) {
            isAgentProcessing = false;
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
