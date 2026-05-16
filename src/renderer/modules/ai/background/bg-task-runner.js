/**
 * 后台任务静默执行器
 * 复用 Agent 的 IPC 调用逻辑，但跳过所有 UI 渲染和历史保存
 */

const { getAiToolsSchema, buildToolsSystemPrompt } = require('../tools/ai-tools-registry');
const { getToolTitle } = require('../tools/ai-tool-card-constants');
const {
  parseToolCallsFromText,
  removeToolCallTextFromContent
} = require('../tools/ai-tool-call-parser');
const { getModelContextSize } = require('../context/ai-model-context-config');
const { injectToolsPrompt } = require('../agent/ai-agent-utils');
const { createAgentPromptBuilder } = require('../agent/ai-agent-prompt-builder');

/**
 * 创建后台任务执行器
 * @param {Object} options - 依赖注入
 * @returns {Object} 执行器实例
 */
function createBgTaskRunner(options) {
  const {
    ipcRenderer,
    store,
    taskManager,
    documentRef,
    t,
    buildSystemPrompt,
    onTaskComplete,
    onTaskError,
    onTaskResultReady // 新增: 后台任务结果准备好回调
  } = options;

  // 创建提示词构建器（复用 agent 的逻辑）
  const promptBuilder = createAgentPromptBuilder({
    todoManager: null,
    getPageList: () => [],
    getCurrentPageInfo: () => null,
    getTaskState: () => null,
    t,
    buildSystemPrompt
  });

  /**
   * 创建隐藏 webview
   * @param {string} url - 要加载的 URL
   * @param {string} taskId - 关联的任务 ID
   * @returns {{ webviewId: string, webview: Element }}
   */
  function createHiddenWebview(url, taskId) {
    const container = documentRef.getElementById('bg-webviews-container');
    if (!container) {
      console.warn('[bg-task-runner] bg-webviews-container not found');
      return { webviewId: '', webview: null };
    }

    const webviewId = `bg-wv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const webview = documentRef.createElement('webview');
    webview.id = webviewId;
    webview.setAttribute('src', url);
    webview.setAttribute('allowpopups', '');
    webview.style.width = '1280px';
    webview.style.height = '800px';
    container.appendChild(webview);

    // 注册到任务管理器
    if (taskManager && taskId) {
      taskManager.registerHiddenWebview(taskId, webviewId);
    }

    return { webviewId, webview };
  }

  /**
   * 等待隐藏 webview 加载完成
   * @param {Element} webview - webview 元素
   * @param {number} timeout - 超时毫秒
   * @returns {Promise<boolean>}
   */
  function waitForWebviewLoad(webview, timeout = 30000) {
    return new Promise(resolve => {
      if (!webview) {
        resolve(false);
        return;
      }

      // 如果已经加载完成
      try {
        if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
          resolve(true);
          return;
        }
      } catch {
        // webview 尚未初始化
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(false);
      }, timeout);

      function cleanup() {
        clearTimeout(timer);
        webview.removeEventListener('did-stop-loading', onLoaded);
        webview.removeEventListener('did-fail-load', onFailed);
      }

      function onLoaded() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      }

      function onFailed() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(false);
      }

      webview.addEventListener('did-stop-loading', onLoaded);
      webview.addEventListener('did-fail-load', onFailed);
    });
  }

  /**
   * 在隐藏 webview 中执行工具
   * @param {Object} toolCall - 工具调用对象
   * @param {string} taskId - 任务 ID
   * @returns {Promise<Object>} 工具执行结果
   */
  async function executeToolSilent(toolCall, taskId) {
    const args = toolCall.arguments || {};

    switch (toolCall.name) {
      case 'search_page': {
        const query = args.query;
        if (!query) return { success: false, error: 'Missing search query' };

        // 创建隐藏 webview 而非标签页
        let searchUrl;
        if (query.startsWith('http')) {
          searchUrl = query;
        } else {
          const engine = store.get('settings.searchEngine', 'bing');
          let searchBase = 'https://www.bing.com/search?q=';
          if (engine === 'google') searchBase = 'https://www.google.com/search?q=';
          if (engine === 'baidu') searchBase = 'https://www.baidu.com/s?wd=';
          searchUrl = searchBase + encodeURIComponent(query);
        }
        const { webviewId, webview } = createHiddenWebview(searchUrl, taskId);
        if (!webview) {
          return { success: false, error: 'Failed to create hidden webview' };
        }

        let loaded = await waitForWebviewLoad(webview);
        // 首次加载失败时重试一次（重新加载）
        if (!loaded) {
          try {
            if (typeof webview.reload === 'function') {
              webview.reload();
              loaded = await waitForWebviewLoad(webview);
            }
          } catch {
            // 忽略重试错误
          }
        }
        if (!loaded) {
          return { success: false, error: 'Hidden webview failed to load' };
        }

        return {
          success: true,
          tabId: webviewId,
          message: `已在后台打开搜索页面，请使用 get_page_info(tab_id="${webviewId}") 获取内容。`
        };
      }

      case 'get_page_info': {
        const tabId = args.tab_id || '';
        const webview = tabId ? documentRef.getElementById(tabId) : null;
        if (!webview) {
          return { success: false, error: 'Target webview not found' };
        }
        const { extractPageContent } = require('../context/ai-context-utils');
        const pageInfo = await extractPageContent(webview);
        if (!pageInfo) {
          return { success: false, error: 'Failed to get page info' };
        }
        return { ...pageInfo, tabId };
      }

      case 'click_element': {
        const tabId = args.tab_id || '';
        const selector = args.selector || '';
        const webview = tabId ? documentRef.getElementById(tabId) : null;
        if (!webview) {
          return { success: false, error: 'Target webview not found' };
        }
        const { clickElement } = require('../agent/ai-webview-bridge');
        const result = await clickElement(webview, { selector: String(selector) });
        if (result.success) {
          try {
            const { extractPageContent } = require('../context/ai-context-utils');
            const pageInfo = await extractPageContent(webview);
            if (pageInfo) {
              return {
                ...result,
                tabId,
                pageInfo: {
                  url: pageInfo.url || '',
                  title: pageInfo.title || '',
                  content: pageInfo.content ? pageInfo.content.substring(0, 2000) : ''
                }
              };
            }
          } catch {
            // 忽略提取错误
          }
        }
        return { ...result, tabId };
      }

      case 'input_text': {
        const tabId = args.tab_id || '';
        const selector = args.selector || '';
        const text = args.text || '';
        const webview = tabId ? documentRef.getElementById(tabId) : null;
        if (!webview) {
          return { success: false, error: 'Target webview not found' };
        }
        const { inputText } = require('../agent/ai-webview-bridge');
        const result = await inputText(webview, { selector: String(selector), text: String(text) });
        return { ...result, tabId };
      }

      case 'close_tab': {
        const tabId = args.tab_id || '';
        if (!tabId) {
          return { success: false, error: 'No tab to close in background mode' };
        }
        const webview = documentRef.getElementById(tabId);
        if (webview && webview.parentNode) {
          try {
            if (typeof webview.close === 'function') webview.close();
          } catch {
            // 忽略
          }
          webview.parentNode.removeChild(webview);
        }
        return { success: true, tabId, message: '已关闭后台标签页' };
      }

      case 'end_session': {
        return { success: true, ended: true, summary: args.summary || '' };
      }

      // todo 类工具在后台任务中不执行，返回提示
      case 'add_todo':
      case 'add_todos':
      case 'list_todos':
      case 'complete_todo':
      case 'complete_todos':
      case 'remove_todo':
        return {
          success: true,
          message: '后台任务模式下不支持待办工具，请忽略待办操作。',
          allTodos: []
        };

      default:
        return { success: false, error: `Unknown tool: ${toolCall.name}` };
    }
  }

  /**
   * 发送 Agent 请求（复用 IPC 通道）
   */
  async function sendBgAgentRequest(messages, _taskId) {
    const agentStreamingTaskId = `bg-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const nativeToolCall = true;
    let tools = null;
    let finalMessages = messages;

    if (nativeToolCall) {
      tools = getAiToolsSchema(store);
    } else {
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

    return result;
  }

  /**
   * 带中断检查的等待
   * @param {Object} abortController - abort 控制器
   * @param {number} ms - 等待毫秒数
   */
  async function waitWithAbortCheck(abortController, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !abortController.aborted) {
      const remaining = end - Date.now();
      await new Promise(r => setTimeout(r, Math.min(500, remaining)));
    }
  }

  // 等待队列: 存储前台模型等待的后台任务
  const waitingTasks = new Map(); // taskId -> { resolve, timeout, timer }

  /**
   * 注册等待任务
   * @param {string} taskId - 任务 ID
   * @param {number} timeout - 超时毫秒数
   * @returns {Promise<Object>} 返回任务结果
   */
  function registerWaitingTask(taskId, timeout = 300000) {
    return new Promise((resolve, _reject) => {
      const timer = setTimeout(() => {
        // 超时自动继续
        waitingTasks.delete(taskId);
        resolve({
          success: true,
          timedOut: true,
          message: `后台任务 #${taskId} 执行超过 ${Math.floor(timeout / 1000)} 秒,已自动转为继续模式`
        });
      }, timeout);

      waitingTasks.set(taskId, {
        resolve,
        timeout,
        timer
      });
    });
  }

  /**
   * 处理等待任务完成
   * @param {Object} task - 完成的任务对象
   */
  function handleWaitingTaskComplete(task) {
    const waiting = waitingTasks.get(task.id);
    if (waiting) {
      // 清除超时定时器
      if (waiting.timer) {
        clearTimeout(waiting.timer);
      }
      waitingTasks.delete(task.id);

      // 立即 resolve 等待的 Promise，返回完整的任务结果
      waiting.resolve({
        success: true,
        taskId: task.id,
        result: task.result || '',
        status: task.status,
        toolCallHistory: task.toolCallHistory || [],
        resumeMetadata: task.resumeMetadata || null,
        timedOut: false,
        message: `后台任务 #${task.id} 已完成: ${task.result || '无结果'}`
      });
    }
  }

  /**
   * 运行后台任务（含自动重试）
   * 重试策略：第1次5s，第2次10s，每次+5s，最多5次
   * @param {string} userText - 用户输入文本
   * @param {boolean} isWaiting - 是否为前台模型等待的任务
   * @returns {Promise<Object>} 任务对象或等待结果
   */
  async function runBackgroundTask(userText, isWaiting = false) {
    // 创建任务记录
    const task = taskManager.createTask(userText);

    // 如果是等待模式,注册等待 Promise
    if (isWaiting) {
      // 异步启动后台任务,不阻塞等待 Promise
      executeBackgroundTaskInternal(task, userText).catch(error => {
        console.error('[bg-task-runner] Background task error:', error);
      });

      // 返回等待 Promise (超时5分钟)
      return registerWaitingTask(task.id, 300000);
    }

    // 继续模式: 直接返回任务对象
    executeBackgroundTaskInternal(task, userText).catch(error => {
      console.error('[bg-task-runner] Background task error:', error);
    });

    return task;
  }

  /**
   * 后台任务内部执行逻辑（原 runBackgroundTask 的实现）
   * @param {Object} task - 任务对象
   * @param {string} userText - 用户输入文本
   */
  async function executeBackgroundTaskInternal(task, userText) {
    // 创建 abort controller
    const abortController = {
      aborted: false,
      abort: () => {
        abortController.aborted = true;
      }
    };
    task.abortController = abortController;

    // 构建系统提示词
    const systemPrompt = promptBuilder.buildAgentSystemPrompt(
      { mode: 'agent', pageContext: null },
      userText
    );

    // 增强系统提示词
    const enhancedSystemPrompt = promptBuilder.enhanceSystemPromptWithPages(systemPrompt);

    let agentMessageHistory = [
      { role: 'system', content: enhancedSystemPrompt },
      { role: 'user', content: userText }
    ];

    const contextSize = getModelContextSize(store);

    // 保存模型和上下文长度到恢复元数据
    const currentModel = store.get('settings.aiModel', 'unknown');
    taskManager.updateResumeMetadata(task.id, {
      model: currentModel,
      contextSize: contextSize
    });

    const MAX_RETRIES = 5;
    const BASE_RETRY_DELAY = 5000;
    let retryCount = 0;
    let succeeded = false;

    // 用于收集最后的思考内容和总结
    let lastThinkingContent = '';
    let finalSummary = '';

    while (!succeeded && retryCount <= MAX_RETRIES && !abortController.aborted) {
      let maxIterations = 30;
      let textOnlyCount = 0;
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

      try {
        while (!abortController.aborted && maxIterations > 0) {
          maxIterations--;

          // 智能动态截断
          const maxLiveMessages = Math.max(12, Math.floor((contextSize * 0.8) / 500));
          agentMessageHistory = promptBuilder.truncateLiveHistory(
            agentMessageHistory,
            maxLiveMessages
          );

          const result = await sendBgAgentRequest(agentMessageHistory, task.id);

          if (!result?.success) {
            throw new Error(result?.error || 'Background agent request failed');
          }

          if (result.type === 'message') {
            // 文本解析工具调用（fallback 模式）
            if (result.usedToolsFallback && result.content) {
              const parsedToolCalls = parseToolCallsFromText(result.content);
              if (parsedToolCalls && parsedToolCalls.length > 0) {
                const processedResult = {
                  success: true,
                  type: 'tool_calls',
                  toolCalls: parsedToolCalls,
                  reasoningContent: result.reasoningContent || '',
                  content: removeToolCallTextFromContent(result.content),
                  taskId: result.taskId
                };
                // 跳转到 tool_calls 处理
                await handleBgToolCalls(
                  processedResult,
                  agentMessageHistory,
                  task,
                  lastThinkingContent
                );
                continue;
              }
            }

            // 纯文本回复
            agentMessageHistory.push({ role: 'assistant', content: result.content });

            if (!result.content || result.content.trim().length === 0) {
              break;
            }

            // 收集思考内容（用于恢复时显示）
            if (result.reasoningContent) {
              lastThinkingContent = result.reasoningContent;
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
              // 将最后的文本作为结果，并保存恢复元数据
              finalSummary = result.content;
              taskManager.updateResumeMetadata(task.id, {
                finalSummary: finalSummary,
                thinkingContent: lastThinkingContent,
                messageHistory: agentMessageHistory.slice(-6) // 保留最后几条消息作为上下文
              });
              taskManager.completeTask(task.id, result.content);
              break;
            }
            continue;
          }

          if (result.type === 'tool_calls') {
            textOnlyCount = 0;
            previousMessages.clear();
            await handleBgToolCalls(result, agentMessageHistory, task, lastThinkingContent);

            if (task.status !== 'running') break;
          }
        }

        // 循环正常结束视为成功
        succeeded = true;
      } catch (error) {
        console.error('[bg-task-runner] Error:', error);

        const errMsg = error && error.message ? String(error.message) : '未知错误';

        // token 超限错误：自动截断历史重试（不计入重试次数）
        if (
          (errMsg.includes('context_length') ||
            errMsg.includes('max_tokens') ||
            errMsg.includes('token limit') ||
            errMsg.includes('too many tokens') ||
            errMsg.includes('maximum context') ||
            errMsg.includes('context window')) &&
          agentMessageHistory.length > 6
        ) {
          const systemMsg = agentMessageHistory[0];
          const minKeep = Math.max(4, Math.floor((contextSize * 0.3) / 500));
          const recentMessages = agentMessageHistory.slice(-minKeep);
          agentMessageHistory = [systemMsg, ...recentMessages];
          // 不标记失败，继续外层循环重跑
          continue;
        }

        // 其他错误：判断是否可重试
        if (retryCount < MAX_RETRIES && !abortController.aborted) {
          retryCount++;
          const delay = BASE_RETRY_DELAY * retryCount;

          // 设置重试等待状态
          taskManager.setRetrying(task.id, retryCount, delay);

          // 等待重试延迟
          await waitWithAbortCheck(abortController, delay);

          if (abortController.aborted) break;

          // 重置为运行中，继续外层循环
          taskManager.resetToRunning(task.id);
          continue;
        }

        // 重试次数耗尽或已取消，标记最终失败
        const retryInfo = retryCount > 0 ? `（已重试${retryCount}次）` : '';
        taskManager.failTask(task.id, errMsg + retryInfo);
        if (typeof onTaskError === 'function') {
          onTaskError(task, errMsg);
        }
        break;
      }
    }

    // 清理资源
    taskManager.cleanupTask(task.id, documentRef);

    // 如果任务仍在运行（循环正常结束但未标记完成），标记完成
    if (task.status === 'running') {
      taskManager.completeTask(task.id, task.result || '');
    }

    // 刷新任务对象
    const finalTask = taskManager.getTaskById(task.id);

    // 触发结果准备就绪回调（用于通知前台模型，注入结果到历史）
    if (typeof onTaskResultReady === 'function') {
      onTaskResultReady(finalTask);
    }

    // 检查是否是前台模型等待的任务（在结果注入后再解除等待）
    handleWaitingTaskComplete(finalTask);

    // 触发任务完成回调
    if (typeof onTaskComplete === 'function') {
      onTaskComplete(finalTask);
    }
  }

  /**
   * 处理后台任务的 tool_calls
   */
  async function handleBgToolCalls(result, agentMessageHistory, task, lastThinkingContent) {
    // 构建 OpenAI 格式的 tool_calls
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

    for (let ti = 0; ti < result.toolCalls.length; ti++) {
      const toolCall = result.toolCalls[ti];

      // 工具间间隔 3 秒
      if (ti > 0) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // 更新工具标签为 running 状态
      taskManager.updateLatestToolCall(task.id, {
        toolName: toolCall.name,
        status: 'running',
        title: getToolTitle(toolCall.name)
      });

      // 静默执行工具
      const toolResult = await executeToolSilent(toolCall, task.id);

      // 更新工具标签为完成/失败状态
      const toolStatus = toolResult && toolResult.success === false ? 'error' : 'success';
      taskManager.updateLatestToolCall(task.id, {
        toolName: toolCall.name,
        status: toolStatus,
        title: getToolTitle(toolCall.name)
      });

      if (toolCall.name === 'end_session') {
        const summaryText = toolCall.arguments?.summary || toolResult?.summary || '';
        agentMessageHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: summaryText
        });
        // 保存最终的恢复元数据
        taskManager.updateResumeMetadata(task.id, {
          finalSummary: summaryText,
          thinkingContent: result.reasoningContent || lastThinkingContent,
          messageHistory: agentMessageHistory.slice(-6)
        });
        taskManager.completeTask(task.id, summaryText);
        return;
      }

      // 添加工具调用到历史记录（用于恢复时渲染）
      taskManager.addToolCallToHistory(task.id, {
        toolName: toolCall.name,
        status: toolStatus,
        title: getToolTitle(toolCall.name),
        arguments: toolCall.arguments || {},
        result: toolResult
      });

      // 截断工具结果防止 token 膨胀
      const { truncateToolResult } = require('../agent/ai-agent-utils');
      const truncated = truncateToolResult(toolCall.name, toolResult);

      agentMessageHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: truncated.content
      });
    }
  }

  return {
    runBackgroundTask,
    executeBackgroundTaskInternal,
    handleWaitingTaskComplete,
    getWaitingTaskCount: () => waitingTasks.size
  };
}

module.exports = {
  createBgTaskRunner
};
