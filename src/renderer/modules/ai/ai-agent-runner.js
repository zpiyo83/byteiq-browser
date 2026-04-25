/**
 * AI Agent 模式执行器
 */

const { getAiToolsSchema } = require('./ai-tools-registry');
const { renderMarkdownToElement } = require('./ai-markdown-renderer');

// 已注册的工具名集合，用于文本解析时校验
const KNOWN_TOOL_NAMES = new Set([
  'get_page_info',
  'click_element',
  'input_text',
  'search_page',
  'add_todo',
  'add_todos',
  'list_todos',
  'complete_todo',
  'complete_todos',
  'remove_todo',
  'end_session'
]);

/**
 * 从模型文本输出中解析工具调用（兼容不支持 tools API 的模型）
 * 支持的格式：
 * 1. Qwen/Hermes 格式: <tool_call>\n{"name":"xxx","arguments":{...}}\n</tool_call>
 * 2. 函数调用格式: ```json\n{"name":"xxx","arguments":{...}}\n```
 * 3. 简单 JSON 行: {"name":"xxx","arguments":{...}}
 */
function parseToolCallsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const calls = [];
  let callIdCounter = 0;

  // 格式1: <tool_call>...</tool_call> (Qwen/Hermes)
  const hermesRegex = /<tool_call>\s*\n?([\s\S]*?)\n?\s*<\/tool_call>/g;
  let match;
  while ((match = hermesRegex.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    const parsed = tryParseToolCallJson(jsonStr);
    if (parsed) {
      parsed.id = `parsed_${++callIdCounter}_${Date.now()}`;
      calls.push(parsed);
    }
  }
  if (calls.length > 0) return calls;

  // 格式2: ```json ... ``` 包含工具调用
  const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    const parsed = tryParseToolCallJson(jsonStr);
    if (parsed) {
      parsed.id = `parsed_${++callIdCounter}_${Date.now()}`;
      calls.push(parsed);
    }
  }
  if (calls.length > 0) return calls;

  // 格式3: 独立 JSON 行（name + arguments）
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = tryParseToolCallJson(trimmed);
      if (parsed) {
        parsed.id = `parsed_${++callIdCounter}_${Date.now()}`;
        calls.push(parsed);
      }
    }
  }

  return calls;
}

/**
 * 尝试将 JSON 字符串解析为工具调用
 */
function tryParseToolCallJson(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
    // 支持多种字段名
    const name = obj.name || obj.function_name || obj.tool_name || '';
    const args = obj.arguments || obj.args || obj.parameters || obj.params || {};
    if (name && KNOWN_TOOL_NAMES.has(name)) {
      return { name, arguments: typeof args === 'object' ? args : {} };
    }
  } catch {
    // 忽略解析失败
  }
  return null;
}

/**
 * 从文本内容中移除工具调用标记，只保留正文
 */
function removeToolCallTextFromContent(text) {
  if (!text) return text;
  // 移除 <tool_call>...</tool_call> 块
  let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  // 移除包含工具调用的 ```json ... ``` 块
  cleaned = cleaned.replace(/```json\s*\n\s*\{[\s\S]*?"name"\s*:[\s\S]*?\}\s*\n```/g, '');
  // 移除独立的工具调用 JSON 行
  cleaned = cleaned
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const obj = JSON.parse(trimmed);
          if (obj.name && KNOWN_TOOL_NAMES.has(obj.name)) return false;
        } catch {
          /* 保留 */
        }
      }
      return true;
    })
    .join('\n');
  return cleaned.trim();
}

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

  // 当前 Agent 操作的守卫（用于会话隔离）
  let currentOperationGuard = null;

  // Todo 管理器
  const todoManager = externalTodoManager;

  // Agent 流式显示状态
  let agentStreamingElement = null;
  let agentStreamingTaskId = null;

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

      const fullText = data.reasoningContent
        ? `<!--think-->${data.reasoningContent}<!--endthink-->${data.accumulated}`
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

    // 确保目标元素为空（移除流式指示圆点和其他内容）
    // 但要保留 class，以保持消息样式
    target.textContent = '';

    const header = documentRef.createElement('div');
    header.className = 'tool-card-header';

    const titleEl = documentRef.createElement('div');
    titleEl.className = 'tool-card-title';
    titleEl.textContent = title;
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
      case 'add_todo':
        return '添加待办项';
      case 'add_todos':
        return '批量添加待办项';
      case 'list_todos':
        return '显示待办列表';
      case 'complete_todo':
        return '完成待办项';
      case 'complete_todos':
        return '批量完成待办项';
      case 'remove_todo':
        return '删除待办项';
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
      case 'add_todo': {
        const title = args.title ? truncateText(args.title, 48) : '未提供标题';
        const priority = args.priority ? `优先级: ${args.priority}` : '';
        return `准备添加待办项，${title}，${priority}`.trim();
      }
      case 'add_todos': {
        const count = args.items ? args.items.length : 0;
        return `准备批量添加 ${count} 个待办项`;
      }
      case 'list_todos': {
        const filter = args.filter ? `${args.filter}` : 'pending';
        return `准备显示待办列表（${filter}）`;
      }
      case 'complete_todo': {
        const id = args.todo_id ? args.todo_id : '未提供ID';
        return `准备标记待办项为完成，ID: ${id}`;
      }
      case 'complete_todos': {
        const ids = args.todo_ids ? args.todo_ids.join(', ') : '未提供ID';
        return `准备批量完成待办项，ID: ${ids}`;
      }
      case 'remove_todo': {
        const id = args.todo_id ? args.todo_id : '未提供ID';
        return `准备删除待办项，ID: ${id}`;
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

    if (toolName === 'add_todo') {
      const listText = toolResult.currentList ? `\n当前待办列表：\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '待办项已添加'}${listText}`
      };
    }

    if (toolName === 'add_todos') {
      const listText = toolResult.currentList ? `\n当前待办列表：\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '待办项已批量添加'}${listText}`
      };
    }

    if (toolName === 'list_todos') {
      const display = toolResult.display || '暂无待办项';
      return {
        status: 'success',
        text: `待办列表：\n${display}`
      };
    }

    if (toolName === 'complete_todo') {
      const listText = toolResult.currentList ? `\n当前待办列表：\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '待办项已标记为完成'}${listText}`
      };
    }

    if (toolName === 'complete_todos') {
      const listText = toolResult.currentList ? `\n当前待办列表：\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '待办项已批量完成'}${listText}`
      };
    }

    if (toolName === 'remove_todo') {
      const listText = toolResult.currentList ? `\n当前待办列表：\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '待办项已删除'}${listText}`
      };
    }

    return {
      status: 'success',
      text: '工具已执行'
    };
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

      const tools = getAiToolsSchema(store);
      const result = await ipcRenderer.invoke('ai-agent', {
        messages,
        tools,
        taskId: agentStreamingTaskId
      });

      // 返回前再次检查守卫
      if (operationGuard && !operationGuard.guard()) {
        throw new Error('Session no longer active');
      }

      return result;
    } finally {
      agentStreamingElement = null;
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

    const todoPrompt =
      todoManager && typeof todoManager.buildTodoPrompt === 'function'
        ? todoManager.buildTodoPrompt()
        : '';
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
      todoPrompt +
      '\n\n你是Agent模式，可以使用工具来帮助用户完成任务。' +
      '\n\n可用工具：' +
      '\n- search_page(query): 新建标签页搜索关键词，返回页面信息和tab_id。当需要在网上查找信息时使用。' +
      '\n- get_page_info(tab_id?): 获取指定页面的URL、标题、摘要和可交互元素列表。默认当前标签页。' +
      '\n- click_element(selector, tab_id?): 点击页面元素。selector必须来自get_page_info返回的controls。' +
      '\n- input_text(selector, text, tab_id?): 在输入框中输入文本。selector必须来自get_page_info返回的controls。' +
      '\n- add_todo(title, priority?): 添加待办项。priority可选：low/medium/high。' +
      '\n- add_todos(items): 批量添加待办项。items为[{title, priority?}]数组，一次添加多个。' +
      '\n- list_todos(filter?): 显示待办列表。filter可选：all/pending/completed。' +
      '\n- complete_todo(todo_id): 完成指定ID的待办项。' +
      '\n- complete_todos(todo_ids): 批量完成待办项。todo_ids为ID数组，一次完成多个。' +
      '\n- remove_todo(todo_id): 删除指定ID的待办项。' +
      '\n- end_session(summary): 结束会话，summary为最终总结（支持Markdown），将直接展示给用户。' +
      '\n\n操作规范：' +
      '\n0. 【To Do 工具使用规则 - 最高优先级】' +
      '\n   a) 收到用户任务时，必须先调用add_todo或add_todos将任务步骤拆分为待办项' +
      '\n   b) 每完成一个步骤，必须调用complete_todo或complete_todos标记完成' +
      '\n   c) 用户提到"待办""任务""计划""要做的事""提醒"时，必须使用todo工具' +
      '\n   d) 用户询问"还有什么没做""任务进度"时，必须调用list_todos' +
      '\n   e) 不要用文字描述待办列表，必须调用list_todos工具来展示' +
      '\n1. 需要搜索信息时，先调用search_page打开搜索结果页面。' +
      '\n2. 需要点击或输入前，先调用get_page_info获取页面信息与controls。' +
      '\n3. 操作非当前页面时，在工具参数中提供tab_id以指定目标页面。' +
      '\n4. 仅使用controls中提供的selector或用户明确给出的selector，不要凭空猜测。' +
      '\n5. 点击工具会默认等待5秒后检查页面状态，最长100秒；不要在回复里输出"等待X秒"。' +
      '\n6. 每次工具调用后，根据结果决定下一步。任务完成后调用end_session并提供总结。' +
      '\n7. 优先使用search_page查找信息，而非要求用户提供。' +
      '\n8. 如果搜索结果页面需要进一步操作，使用get_page_info获取controls后再点击。' +
      '\n9. 【限制资源处理】如果用户说"只去X个网站""查前X条""只搜索Y次"，必须：' +
      '\n   a) 理解这是硬性限制，不能超过' +
      '\n   b) 从当前打开的标签页统计，不要盲目创建新标签页' +
      '\n   c) 达到限制后立即调用end_session，不要继续操作' +
      '\n10. 【搜索结果筛选】get_page_info获取搜索页面后：' +
      '\n   a) 从controls.links中找"官网入口"（通常是主域名的纯文本链接）' +
      '\n   b) 优先点击官网而非聚合页或新闻源' +
      '\n   c) 避免重复点击已访问的网站' +
      '\n11. 【重复检测与去重】对同一网站或搜索词：' +
      '\n   a) 记住已搜索和已访问的网站URL' +
      '\n   b) 如果要访问同一网站第2次，先用get_page_info检查其tab_id是否已存在' +
      '\n   c) 优先复用已打开的标签页，减少search_page调用' +
      '\n12. 【进度意识】复杂任务（多步骤/多资源）中：' +
      '\n   a) 在思考内容中计算进度："已访问 2/3 网站"或"完成 5/10 步骤"' +
      '\n   b) 主动让用户知道进展，而不是沉默地工作' +
      '\n   c) 如果工具调用超过8次且无明显进展，重新评估策略' +
      '\n13. 【任务完成判断】以下情况应立即调用end_session：' +
      '\n   a) 已达到用户指定的数量限制（网站数、条数、次数等）' +
      '\n   b) 无法继续获取新内容（如重复的搜索结果）' +
      '\n   c) 用户明确要求完成' +
      '\n   d) 工具执行失败超过3次且无法恢复';

    // 还原历史消息格式，确保tool和assistant(tool_calls)字段正确
    // 关键：恢复 thinking 内容以保持完整的上下文（防止AI遗忘）
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
        if (m.role === 'assistant' && m.metadata?.toolCalls && m.metadata.toolCalls.length > 0) {
          // 修复：恢复 thinking 内容到消息中，防止上下文丢失
          // 虽然API格式需要 content=null，但我们通过注入 thinking 标记来保留推理过程
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

    // 截断历史消息，保留最近的消息防止 token 超限
    // 根据上下文大小动态计算：每条消息约 500 token，保留 60% 给历史
    const contextSize = store ? store.get('settings.aiContextSize', 8192) : 8192;
    const maxHistoryMessages = Math.max(8, Math.floor((contextSize * 0.6) / 500));

    // 智能截断：优先保留 todo 工具消息和最近的用户/助手消息
    // 这样 AI 不会忘记已调用的工具（如已搜索过的关键词），避免重复
    // 同时确保 todo ID 信息不丢失，避免 complete_todo 失败
    let truncatedHistory = formattedHistory;
    if (formattedHistory.length > maxHistoryMessages) {
      const todoToolNames = new Set([
        'add_todo',
        'add_todos',
        'list_todos',
        'complete_todo',
        'complete_todos',
        'remove_todo'
      ]);
      const todoMessages = [];
      const otherToolMessages = [];
      const otherMessages = [];

      // 分离消息：todo 工具、其他工具、普通消息
      for (const msg of formattedHistory) {
        if (msg.role === 'tool') {
          // 工具结果消息无法直接判断工具名，放入 otherToolMessages
          // 但 todo 工具结果的 content 中包含 todo- 短 ID，可启发式识别
          const content = typeof msg.content === 'string' ? msg.content : '';
          if (content.includes('todo-') || content.includes('待办')) {
            todoMessages.push(msg);
          } else {
            otherToolMessages.push(msg);
          }
        } else if (msg.role === 'assistant' && msg.tool_calls) {
          // 检查 assistant 消息中是否包含 todo 工具调用
          const hasTodoCall = msg.tool_calls.some(call => todoToolNames.has(call.function?.name));
          if (hasTodoCall) {
            todoMessages.push(msg);
          } else {
            otherToolMessages.push(msg);
          }
        } else {
          otherMessages.push(msg);
        }
      }

      // 保留策略：todo 消息全部保留 + 最近的工具消息 + 最近的其他消息
      const keepOtherToolCount = Math.min(
        otherToolMessages.length,
        Math.max(2, Math.ceil(maxHistoryMessages * 0.3))
      );
      const keepOtherCount = Math.max(
        2,
        maxHistoryMessages - todoMessages.length - keepOtherToolCount
      );

      const recentOtherToolMessages = otherToolMessages.slice(-keepOtherToolCount);
      const recentOtherMessages = otherMessages.slice(-keepOtherCount);

      // 合并并排序（保持时间顺序）
      const allKept = [...todoMessages, ...recentOtherToolMessages, ...recentOtherMessages];
      truncatedHistory = allKept.sort((a, b) => {
        const aIdx = formattedHistory.indexOf(a);
        const bIdx = formattedHistory.indexOf(b);
        return aIdx - bIdx;
      });
    }

    // P1 优化：注入已访问网站清单到系统提示词
    const pageList = typeof getPageList === 'function' ? getPageList() : [];
    const validPages = pageList.filter(p => p.url && p.title);

    let enhancedSystemPrompt = systemPrompt;
    if (validPages.length > 0) {
      const pagesInfo = validPages
        .map((p, i) => {
          try {
            const hostname = new URL(p.url).hostname;
            return `${i + 1}. ${p.title} (${hostname})`;
          } catch {
            return `${i + 1}. ${p.title}`;
          }
        })
        .join('\n');

      enhancedSystemPrompt +=
        '\n\n【当前打开的标签页】\n' +
        pagesInfo +
        `\n总计：${validPages.length} 个标签页` +
        '\n提示：访问已打开网站时，优先用 get_page_info(tab_id) 而非重新搜索';
    }

    agentMessageHistory = [
      { role: 'system', content: enhancedSystemPrompt },
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
    let aiMsgElement = null;
    try {
      while (isAgentProcessing && maxIterations > 0) {
        maxIterations--;

        // 会话隔离守卫检查：如果会话已变更，立即退出循环
        if (currentOperationGuard && !currentOperationGuard.guard()) {
          console.warn('[ai-agent-runner] Session changed, breaking agent loop');
          break;
        }

        // 动态刷新系统提示词中的 todo 部分，确保 AI 始终看到最新的 todo 状态
        // 解决：add_todo 后系统提示词仍显示空列表，导致 AI 认为 todo 不存在
        if (agentMessageHistory.length > 0 && agentMessageHistory[0].role === 'system') {
          const freshTodoPrompt =
            todoManager && typeof todoManager.buildTodoPrompt === 'function'
              ? todoManager.buildTodoPrompt()
              : '';
          const currentSystemContent = agentMessageHistory[0].content;
          // 替换 [To Do List - Highest Priority] 到下一个主要段落之间的内容
          const todoSectionRegex =
            /\n\n\[To Do List - Highest Priority\][\s\S]*?(?=\n\n你是Agent模式|\n\n【当前打开的标签页】|$)/;
          if (todoSectionRegex.test(currentSystemContent)) {
            agentMessageHistory[0].content = currentSystemContent.replace(
              todoSectionRegex,
              freshTodoPrompt
            );
          }
        }

        // 智能动态截断：优先保留 todo 工具消息、系统消息和最近消息，防止 token 超限
        const maxLiveMessages = Math.max(12, Math.floor((contextSize * 0.8) / 500));
        if (agentMessageHistory.length > maxLiveMessages) {
          const systemMsg = agentMessageHistory[0];
          const todoToolNames = new Set([
            'add_todo',
            'add_todos',
            'list_todos',
            'complete_todo',
            'complete_todos',
            'remove_todo'
          ]);
          const todoMessages = [];
          const otherToolMessages = [];

          // 分离工具消息：todo 工具 vs 其他工具
          for (let i = 1; i < agentMessageHistory.length; i++) {
            const msg = agentMessageHistory[i];
            if (msg.role === 'tool') {
              const content = typeof msg.content === 'string' ? msg.content : '';
              if (content.includes('todo-') || content.includes('待办')) {
                todoMessages.push(msg);
              } else {
                otherToolMessages.push(msg);
              }
            } else if (msg.role === 'assistant' && msg.tool_calls) {
              const hasTodoCall = msg.tool_calls.some(call =>
                todoToolNames.has(call.function?.name)
              );
              if (hasTodoCall) {
                todoMessages.push(msg);
              } else {
                otherToolMessages.push(msg);
              }
            }
          }

          // 保留最近的非工具消息
          const recentMessages = [];
          for (let i = agentMessageHistory.length - 1; i >= 1; i--) {
            const msg = agentMessageHistory[i];
            if ((msg.role === 'user' || msg.role === 'assistant') && !msg.tool_calls) {
              recentMessages.unshift(msg);
              if (recentMessages.length >= Math.ceil(maxLiveMessages * 0.3)) break;
            }
          }

          // 保留策略：todo 消息全部保留 + 最近的工具消息 + 最近的其他消息
          const keepOtherToolCount = Math.min(
            otherToolMessages.length,
            Math.max(2, Math.ceil(maxLiveMessages * 0.3))
          );
          const recentOtherToolMessages = otherToolMessages.slice(-keepOtherToolCount);

          // 去重合并
          const combined = [...todoMessages, ...recentOtherToolMessages, ...recentMessages];
          const unique = [];
          const seen = new Set();
          for (const msg of combined) {
            const key = JSON.stringify([
              msg.role,
              msg.tool_calls?.map(t => `${t.function.name}:${t.function.arguments}`) ||
                msg.content?.substring(0, 100)
            ]);
            if (!seen.has(key)) {
              seen.add(key);
              unique.push(msg);
            }
          }

          // 最终截断，保留至少5条消息
          const finalMessages = unique.slice(-Math.max(5, maxLiveMessages - 2));
          agentMessageHistory = [systemMsg, ...finalMessages];
        }

        aiMsgElement = addChatMessage('', 'ai', true);

        let result = await sendAgentRequest(agentMessageHistory, aiMsgElement);

        if (!result?.success) {
          finishStreamingMessage(aiMsgElement);
          throw new Error(result?.error || 'Agent request failed');
        }

        if (result.type === 'message') {
          // 当模型不支持 tools API 时（usedToolsFallback），尝试从文本中解析工具调用
          if (result.usedToolsFallback && result.content) {
            const parsedToolCalls = parseToolCallsFromText(result.content);
            if (parsedToolCalls && parsedToolCalls.length > 0) {
              // 将解析出的工具调用转换为与 API 返回相同的格式
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
            // 保存思考内容到历史（使用标记以便还原时渲染思考下拉框）
            const savedContent = result.reasoningContent
              ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content}`
              : result.content;
            // 仅在会话活跃时保存
            if (contextIsolation?.isSessionActive?.(session.id)) {
              await historyStorage.addMessage(session.id, {
                role: 'assistant',
                content: savedContent
              });
            }
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
        }

        if (result.type === 'tool_calls') {
          // 重置纯文本回复计数器和历史消息集合，因为AI调用了工具
          textOnlyCount = 0;
          previousMessages.clear();

          // 流式监听器已经把 AI 的思考+文字渲染到 aiMsgElement
          // 只需完成流式状态，不再用 updateStreamingMessage 覆盖（会导致 AI 说话内容丢失）
          // 如果 AI 没有通过流式渲染任何内容（content 为空且无思考），补充渲染
          const hasStreamedContent =
            aiMsgElement.querySelector('.message-content') ||
            aiMsgElement.querySelector('.think-dropdown');
          if (hasStreamedContent) {
            // 流式已渲染内容，只需完成流式状态
            finishStreamingMessage(aiMsgElement);
          } else if (result.content || result.reasoningContent) {
            // 无流式内容但有结果内容，补充渲染
            const fullText = result.reasoningContent
              ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content || ''}`
              : result.content || '';
            updateStreamingMessage(aiMsgElement, fullText);
            finishStreamingMessage(aiMsgElement);
          } else {
            // 无内容，移除空的消息元素
            if (aiMsgElement.parentNode) {
              aiMsgElement.parentNode.removeChild(aiMsgElement);
            }
          }

          if (typeof autoCollapseThinkingDropdown === 'function' && hasStreamedContent) {
            autoCollapseThinkingDropdown(aiMsgElement);
          }

          // 判断流式元素是否已有内容（来自流式监听器渲染的文字）
          // 工具卡片总是创建新的消息元素，避免覆盖思考内容或已渲染的文字
          // 这样可以保证思考框和工具卡片分离显示，不会相互遮挡

          const toolMessages = new Map();
          result.toolCalls.forEach(toolCall => {
            if (toolCall.name === 'end_session') {
              toolMessages.set(toolCall.id, null);
              return;
            }
            // 强制为每个工具创建新消息，不复用 aiMsgElement
            const target = addChatMessage('', 'ai');
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
          // 注意：content 包含 thinking 标记只用于UI显示和调试
          // metadata.thinkingContent 用于重新加载时恢复完整推理过程
          const assistantSavedContent = result.reasoningContent
            ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content || ''}`
            : result.content || '';
          // 仅在会话活跃时保存
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

          for (const toolCall of result.toolCalls) {
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
              // 将 summary 以 Markdown 渲染到消息区域，不显示工具卡片
              const summaryText = toolCall.arguments?.summary || toolResult?.summary || '';
              if (summaryText) {
                const summaryMsg = addChatMessage('', 'ai');
                const contentDiv = documentRef.createElement('div');
                contentDiv.className = 'message-content';
                renderMarkdownToElement(contentDiv, summaryText, documentRef);
                summaryMsg.appendChild(contentDiv);
              }
              // 保存结束会话工具结果到历史（仅在会话活跃时）
              if (contextIsolation?.isSessionActive?.(session.id)) {
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
              }
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
            // 保存工具结果到历史（仅在会话活跃时）
            if (contextIsolation?.isSessionActive?.(session.id)) {
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
        // 移除失败的空消息元素
        if (aiMsgElement && aiMsgElement.parentNode) {
          aiMsgElement.parentNode.removeChild(aiMsgElement);
        }
        // 注意：外层 try-catch 中不能 continue while 循环
        // token 超限时直接重试需要重新进入 runAgentConversation
      } else {
        // 非token超限错误：显示错误信息
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
