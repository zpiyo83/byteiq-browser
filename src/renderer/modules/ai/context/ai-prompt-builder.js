/**
 * AI 统一提示词构建器
 * 整合 Ask/Agent 两种模式的 prompt 构建，消除散落逻辑
 */

const { ensureToolMessagePairing } = require('./ai-history-formatter');

// ── 分段构建函数（纯函数） ──

function buildBasePrompt(mode, t) {
  const base =
    t('ai.systemPrompt') ||
    '你是一个有帮助的AI助手。你可以帮助用户总结网页内容、回答问题和提供信息。请用简洁清晰的语言回答用户问题。';
  const modeMap = {
    outline: t('ai.modeOutline') || '请输出结构化提纲与关键要点。',
    compare: t('ai.modeCompare') || '请进行对比/聚合分析，并给出结论。',
    translate_page: t('ai.modeTranslatePage') || '请将内容翻译/本地化为中文，保持准确与可读性。',
    code_docs: t('ai.modeCodeDocs') || '请以 API 文档/代码解读风格回答，给出关键接口与示例。',
    qa: t('ai.modeQa') || '请结合上下文回答用户问题，必要时引用原文。'
  };
  return `${base}\n\n${modeMap[mode] || modeMap.qa}`;
}

function buildPageContextSection({ pageContext, currentPageInfo, includePageContext = true, t }) {
  if (currentPageInfo) {
    let s = '\n\n[当前页面状态]';
    s += `\n标题: ${currentPageInfo.title || '未知'}`;
    s += `\nURL: ${currentPageInfo.url || '未知'}`;
    if (currentPageInfo.loading) s += '\n状态: 页面加载中...';
    return s;
  }
  if (includePageContext && pageContext && pageContext.content) {
    let s = '\n\n' + (t('ai.pageContext') || '当前页面信息：');
    s += `\n标题: ${pageContext.title}\nURL: ${pageContext.url}`;
    if (pageContext.meta?.description) s += `\n描述: ${pageContext.meta.description}`;
    s += `\n\n页面内容:\n${pageContext.content}`;
    return s;
  }
  return '';
}

function buildPagesSummarySection(pageList) {
  if (!Array.isArray(pageList) || pageList.length === 0) return '';
  const limit = 10;
  const lines = pageList.slice(0, limit).map((p, i) => {
    const title = String(p.title || p.url || '未命名页面');
    const url = p.url ? ` | ${p.url}` : '';
    const active = p.active ? ' [当前]' : '';
    const id = p.id ? ` | tab_id=${p.id}` : '';
    return `${i + 1}. ${title}${active}${url}${id}`;
  });
  if (pageList.length > limit) lines.push(`...还有${pageList.length - limit}个页面`);
  return '\n\n当前可用页面(每次请求更新):\n' + lines.join('\n');
}

function classifyAndSortLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return { official: [], content: [] };
  const official = [],
    content = [];
  for (const link of links) {
    try {
      const url = new URL(link.href || link.selector || '');
      (url.pathname === '/' && !url.search ? official : content).push(link);
    } catch {
      content.push(link);
    }
  }
  return { official, content };
}

function buildControlsSection(controls) {
  if (!controls) return '';
  const limit = 8,
    lines = [];
  let linksToShow = controls.links || [];
  if (Array.isArray(linksToShow) && linksToShow.length > 0) {
    const { official, content } = classifyAndSortLinks(linksToShow);
    linksToShow = [...official, ...content];
  }
  const sections = [
    { label: '按钮', items: controls.buttons },
    { label: '输入框', items: controls.inputs },
    { label: '链接（官网优先）', items: linksToShow }
  ];
  for (const sec of sections) {
    const items = Array.isArray(sec.items) ? sec.items.slice(0, limit) : [];
    if (items.length === 0) continue;
    lines.push(sec.label + ':');
    for (const item of items) {
      const parts = [];
      if (item.text) parts.push('text=' + item.text);
      if (item.ariaLabel) parts.push('aria=' + item.ariaLabel);
      if (item.id) parts.push('id=' + item.id);
      if (item.name) parts.push('name=' + item.name);
      if (item.placeholder) parts.push('placeholder=' + item.placeholder);
      if (item.selector) parts.push('selector=' + item.selector);
      if (parts.length > 0) lines.push(parts.join(' | '));
    }
  }
  return lines.length > 0 ? '\n\n可交互元素:\n' + lines.join('\n') : '';
}

function buildTodoStrategySection() {
  return (
    '\n\n[待办项管理策略]\n' +
    '如果用户提到任务、需要做某事或需要跟踪工作进度，使用以下工具策略：\n' +
    '• 开始任何复杂工作前：调用 list_todos("pending") 查看现有待办\n' +
    '• 识别到新任务：调用 add_todo(title, priority) 添加待办（low/medium/high）\n' +
    '• 一次添加多个任务：调用 add_todos([{title, priority?}]) 批量添加\n' +
    '• 完成任务步骤：调用 complete_todo(id) 标记完成（必须从 list_todos 提取 ID）\n' +
    '• 一次完成多个任务：调用 complete_todos([id1, id2, ...]) 批量完成\n' +
    '• 用户取消任务：调用 remove_todo(id) 删除待办（不可恢复，需谨慎）\n' +
    '• 确认状态：完成任务后调用 list_todos("pending") 再次确认\n' +
    '【标题规范】使用清晰的行动词，如「阅读XX文档」「完成XX代码」。\n' +
    '【优先级】high=紧急/有期限，medium=常规任务（默认），low=可选/优化。\n' +
    '【最佳实践】多步骤任务要逐步添加待办项，每完成一步立即标记，保持列表实时同步。'
  );
}

function buildCoreRulesSection() {
  return (
    '\n\n[核心规则 - 必须遵守]\n' +
    '1. 当用户的目标已达成、问题已解答、或所需信息已获取时，你必须立即调用 end_session 工具结束会话，并提供 summary 总结。\n' +
    '2. 绝对不要在完成任务后继续获取页面信息或执行多余操作，这会浪费资源并打扰用户。\n' +
    '3. 每次获取页面信息后，先判断是否已足够回答用户问题，如果足够则立即调用 end_session，而非继续获取更多信息。\n' +
    '4. end_session 是你最重要的工具之一，忘记调用它是最常见的错误。'
  );
}

function buildTaskStateSection(taskState) {
  if (!taskState) return '';
  let s = '\n\n[任务状态]';
  if (taskState.goal) s += `\n目标: ${taskState.goal}`;
  if (Array.isArray(taskState.completedSteps) && taskState.completedSteps.length > 0) {
    s += `\n已完成步骤:\n${taskState.completedSteps.map((st, i) => `${i + 1}. ${st}`).join('\n')}`;
  }
  if (taskState.currentPage) s += `\n当前所在页面: ${taskState.currentPage}`;
  if (taskState.lastAction) s += `\n上一步操作: ${taskState.lastAction}`;
  return s;
}

function buildAgentToolsSection() {
  return (
    '\n\n你是Agent模式，可以使用工具来帮助用户完成任务。\n\n可用工具：\n' +
    '- search_page(query): 新建标签页搜索关键词，返回页面信息和tab_id。\n' +
    '- get_page_info(tab_id?): 获取指定页面的URL、标题、摘要和可交互元素列表。\n' +
    '- click_element(selector, tab_id?): 点击页面元素。\n' +
    '- input_text(selector, text, tab_id?): 在输入框中输入文本。\n' +
    '- add_todo(title, priority?): 添加待办项。\n' +
    '- add_todos(items): 批量添加待办项。\n' +
    '- list_todos(filter?): 显示待办列表。\n' +
    '- complete_todo(todo_id): 完成指定ID的待办项。\n' +
    '- complete_todos(todo_ids): 批量完成待办项。\n' +
    '- remove_todo(todo_id): 删除指定ID的待办项。\n' +
    '- end_session(summary): 结束会话，summary为最终总结（支持Markdown）。'
  );
}

function buildAgentRulesSection() {
  return (
    '\n\n操作规范：\n' +
    '0. 【To Do 工具使用规则 - 最高优先级】\n' +
    '   a) 收到用户任务时，必须先调用add_todo或add_todos将任务步骤拆分为待办项\n' +
    '   b) 每完成一个步骤，必须调用complete_todo或complete_todos标记完成\n' +
    '   c) 用户提到"待办""任务""计划""要做的事""提醒"时，必须使用todo工具\n' +
    '   d) 用户询问"还有什么没做""任务进度"时，必须调用list_todos\n' +
    '   e) 不要用文字描述待办列表，必须调用list_todos工具来展示\n' +
    '1. 需要搜索信息时，先调用search_page打开搜索结果页面。\n' +
    '2. 需要点击或输入前，先调用get_page_info获取页面信息与controls。\n' +
    '3. 操作非当前页面时，在工具参数中提供tab_id以指定目标页面。\n' +
    '4. 仅使用controls中提供的selector或用户明确给出的selector，不要凭空猜测。\n' +
    '5. 点击工具会默认等待5秒后检查页面状态，最长100秒；不要在回复里输出"等待X秒"。\n' +
    '6. 每次工具调用后，根据结果决定下一步。任务完成后调用end_session并提供总结。\n' +
    '7. 优先使用search_page查找信息，而非要求用户提供。\n' +
    '8. 如果搜索结果页面需要进一步操作，使用get_page_info获取controls后再点击。\n' +
    '9. 【限制资源处理】如果用户说"只去X个网站""查前X条""只搜索Y次"，必须理解这是硬性限制，达到后立即调用end_session。\n' +
    '10. 【搜索结果筛选】优先点击官网而非聚合页，避免重复点击已访问的网站。\n' +
    '11. 【重复检测与去重】记住已访问URL，优先复用已打开标签页。\n' +
    '12. 【进度意识】复杂任务中主动汇报进展，工具调用超过8次且无明显进展时重新评估策略。\n' +
    '13. 【任务完成判断】达到限制/无法继续/用户要求/工具失败超3次时立即调用end_session。'
  );
}

function buildSelectionContext(options) {
  const { text, getActiveTabId, documentRef } = options;
  let { t } = options;
  if (typeof t !== 'function') {
    t = key => key;
  }
  const content = String(text || '').trim();
  if (!content) return null;
  const tabId = getActiveTabId();
  const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
  return {
    url: webview && typeof webview.getURL === 'function' ? webview.getURL() : '',
    title: t('ai.selectionTitle') || '选区内容',
    content,
    meta: { description: '' }
  };
}

// ── 主构建器 ──

const TODO_SECTION_MARKER = '<!--TODO_SECTION-->';

function createPromptBuilder(options) {
  const { todoManager, getPageList, getCurrentPageInfo, getTaskState, t } = options;

  function safeT(fn) {
    return typeof fn === 'function' ? fn : key => key;
  }

  function buildAskSystemPrompt(session) {
    const tFn = safeT(t);
    let prompt = buildBasePrompt(session.mode || 'qa', tFn);
    prompt += buildPageContextSection({
      pageContext: session.pageContext,
      currentPageInfo: typeof getCurrentPageInfo === 'function' ? getCurrentPageInfo() : null,
      includePageContext: true,
      t: tFn
    });
    return prompt;
  }

  function buildAgentSystemPrompt(session, _userText) {
    const tFn = safeT(t);
    const todoPrompt =
      todoManager && typeof todoManager.buildTodoPrompt === 'function'
        ? todoManager.buildTodoPrompt()
        : '';
    let prompt = buildBasePrompt('qa', tFn);
    prompt += buildPageContextSection({
      pageContext: session.pageContext,
      currentPageInfo: typeof getCurrentPageInfo === 'function' ? getCurrentPageInfo() : null,
      includePageContext: false,
      t: tFn
    });
    const pageList = typeof getPageList === 'function' ? getPageList() : [];
    prompt += buildPagesSummarySection(pageList);
    if (session.pageContext?.controls) {
      prompt += buildControlsSection(session.pageContext.controls);
    }
    prompt += '\n\n' + TODO_SECTION_MARKER + '\n' + todoPrompt;
    prompt += buildAgentToolsSection();
    prompt += buildAgentRulesSection();
    prompt += buildTodoStrategySection();
    prompt += buildCoreRulesSection();
    const taskState = typeof getTaskState === 'function' ? getTaskState() : null;
    prompt += buildTaskStateSection(taskState);
    return prompt;
  }

  function refreshTodoInSystemPrompt(currentSystemContent) {
    const freshTodoPrompt =
      todoManager && typeof todoManager.buildTodoPrompt === 'function'
        ? todoManager.buildTodoPrompt()
        : '';
    const markerIdx = currentSystemContent.indexOf(TODO_SECTION_MARKER);
    if (markerIdx === -1) return currentSystemContent;
    const before = currentSystemContent.substring(0, markerIdx);
    const afterMarker = markerIdx + TODO_SECTION_MARKER.length;
    const todoEnd = currentSystemContent.indexOf('\n\n', afterMarker);
    if (todoEnd === -1) return before + TODO_SECTION_MARKER + '\n' + freshTodoPrompt;
    return (
      before +
      TODO_SECTION_MARKER +
      '\n' +
      freshTodoPrompt +
      currentSystemContent.substring(todoEnd)
    );
  }

  function enhanceWithPages(systemPrompt) {
    const pageList = typeof getPageList === 'function' ? getPageList() : [];
    const validPages = pageList.filter(p => p.url && p.title);
    if (validPages.length === 0) return systemPrompt;
    const pagesInfo = validPages
      .map((p, i) => {
        try {
          return `${i + 1}. ${p.title} (${new URL(p.url).hostname})`;
        } catch {
          return `${i + 1}. ${p.title}`;
        }
      })
      .join('\n');
    return (
      systemPrompt +
      '\n\n【当前打开的标签页】\n' +
      pagesInfo +
      `\n总计：${validPages.length} 个标签页\n提示：访问已打开网站时，优先用 get_page_info(tab_id) 而非重新搜索`
    );
  }

  function truncateHistorySmart(formattedHistory, maxHistoryMessages) {
    if (formattedHistory.length <= maxHistoryMessages) return formattedHistory;
    const todoToolNames = new Set([
      'add_todo',
      'add_todos',
      'list_todos',
      'complete_todo',
      'complete_todos',
      'remove_todo'
    ]);
    const todoMessages = [],
      otherToolMessages = [],
      otherMessages = [];
    for (const msg of formattedHistory) {
      if (msg.role === 'tool') {
        const c = typeof msg.content === 'string' ? msg.content : '';
        (c.includes('todo-') || c.includes('待办') ? todoMessages : otherToolMessages).push(msg);
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        msg.tool_calls.some(call => todoToolNames.has(call.function?.name))
          ? todoMessages.push(msg)
          : otherToolMessages.push(msg);
      } else {
        otherMessages.push(msg);
      }
    }
    const keepTool = Math.min(
      otherToolMessages.length,
      Math.max(2, Math.ceil(maxHistoryMessages * 0.3))
    );
    const keepOther = Math.max(2, maxHistoryMessages - todoMessages.length - keepTool);
    const allKept = [
      ...todoMessages,
      ...otherToolMessages.slice(-keepTool),
      ...otherMessages.slice(-keepOther)
    ];
    const sorted = allKept.sort(
      (a, b) => formattedHistory.indexOf(a) - formattedHistory.indexOf(b)
    );
    return ensureToolMessagePairing(sorted);
  }

  function truncateLiveHistory(agentMessageHistory, maxLiveMessages) {
    if (agentMessageHistory.length <= maxLiveMessages) return agentMessageHistory;
    const systemMsg = agentMessageHistory[0];
    const todoToolNames = new Set([
      'add_todo',
      'add_todos',
      'list_todos',
      'complete_todo',
      'complete_todos',
      'remove_todo'
    ]);
    const todoMessages = [],
      otherToolMessages = [];
    for (let i = 1; i < agentMessageHistory.length; i++) {
      const msg = agentMessageHistory[i];
      if (msg.role === 'tool') {
        const c = typeof msg.content === 'string' ? msg.content : '';
        (c.includes('todo-') || c.includes('待办') ? todoMessages : otherToolMessages).push(msg);
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        msg.tool_calls.some(call => todoToolNames.has(call.function?.name))
          ? todoMessages.push(msg)
          : otherToolMessages.push(msg);
      }
    }
    const recentMessages = [];
    for (let i = agentMessageHistory.length - 1; i >= 1; i--) {
      const msg = agentMessageHistory[i];
      if ((msg.role === 'user' || msg.role === 'assistant') && !msg.tool_calls) {
        recentMessages.unshift(msg);
        if (recentMessages.length >= Math.ceil(maxLiveMessages * 0.3)) break;
      }
    }
    const keepTool = Math.min(
      otherToolMessages.length,
      Math.max(2, Math.ceil(maxLiveMessages * 0.3))
    );
    const combined = [...todoMessages, ...otherToolMessages.slice(-keepTool), ...recentMessages];
    const unique = [],
      seen = new Set();
    for (const msg of combined) {
      const key = JSON.stringify([
        msg.role,
        msg.tool_calls?.map(tc => `${tc.function.name}:${tc.function.arguments}`) ||
          msg.content?.substring(0, 100)
      ]);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(msg);
      }
    }
    return ensureToolMessagePairing([
      systemMsg,
      ...unique.slice(-Math.max(5, maxLiveMessages - 2))
    ]);
  }

  return {
    buildAskSystemPrompt,
    buildAgentSystemPrompt,
    refreshTodoInSystemPrompt,
    enhanceWithPages,
    truncateHistorySmart,
    truncateLiveHistory
  };
}

module.exports = {
  createPromptBuilder,
  buildBasePrompt,
  buildPageContextSection,
  buildPagesSummarySection,
  buildControlsSection,
  buildTodoStrategySection,
  buildCoreRulesSection,
  buildTaskStateSection,
  buildAgentToolsSection,
  buildAgentRulesSection,
  buildSelectionContext,
  TODO_SECTION_MARKER
};
