/**
 * 后台任务静默执行器
 * 复用 Agent 的 IPC 调用逻辑，但跳过所有 UI 渲染和历史保存
 */

const { getAiToolsSchema, buildToolsSystemPrompt } = require('../tools/ai-tools-registry');
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
    onTaskError
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
   * 运行后台任务
   * @param {string} userText - 用户输入文本
   * @returns {Promise<void>}
   */
  async function runBackgroundTask(userText) {
    // 创建任务记录
    const task = taskManager.createTask(userText);

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
              await handleBgToolCalls(processedResult, agentMessageHistory, task);
              continue;
            }
          }

          // 纯文本回复
          agentMessageHistory.push({ role: 'assistant', content: result.content });

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
            // 将最后的文本作为结果
            taskManager.completeTask(task.id, result.content);
            break;
          }
          continue;
        }

        if (result.type === 'tool_calls') {
          textOnlyCount = 0;
          previousMessages.clear();
          await handleBgToolCalls(result, agentMessageHistory, task);

          if (task.status !== 'running') break;
        }
      }
    } catch (error) {
      console.error('[bg-task-runner] Error:', error);

      // token 超限错误：自动截断历史重试一次
      const errMsg = error && error.message ? String(error.message) : '';
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
        // 重试
        maxIterations = Math.min(maxIterations, 10);
        // 不标记失败，继续循环
      } else {
        taskManager.failTask(task.id, errMsg);
        if (typeof onTaskError === 'function') {
          onTaskError(task, errMsg);
        }
      }
    } finally {
      // 清理资源
      taskManager.cleanupTask(task.id, documentRef);

      // 如果任务仍在运行（循环正常结束但未标记完成），标记完成
      if (task.status === 'running') {
        taskManager.completeTask(task.id, task.result || '');
      }

      if (typeof onTaskComplete === 'function') {
        onTaskComplete(task);
      }
    }
  }

  /**
   * 处理后台任务的 tool_calls
   */
  async function handleBgToolCalls(result, agentMessageHistory, task) {
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

      // 静默执行工具
      const toolResult = await executeToolSilent(toolCall, task.id);

      if (toolCall.name === 'end_session') {
        const summaryText = toolCall.arguments?.summary || toolResult?.summary || '';
        agentMessageHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: summaryText
        });
        taskManager.completeTask(task.id, summaryText);
        return;
      }

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
    runBackgroundTask
  };
}

module.exports = {
  createBgTaskRunner
};
