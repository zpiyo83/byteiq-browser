/**
 * AI Agent 提示词构建器
 * 负责系统提示词构建、历史消息格式化与智能截断
 */

/**
 * 创建 Agent 提示词构建器
 * @param {Object} options
 * @param {Object} options.todoManager - 待办管理器
 * @param {Function} options.getPageList - 获取页面列表
 * @param {Function} options.getCurrentPageInfo - 获取当前页面信息
 * @param {Function} options.getTaskState - 获取任务状态
 * @param {Function} options.t - 翻译函数
 * @param {Function} options.buildSystemPrompt - 基础系统提示词构建函数
 */
function createAgentPromptBuilder(options) {
  const { todoManager, getPageList, getCurrentPageInfo, getTaskState, t, buildSystemPrompt } =
    options;

  /**
   * 构建 Agent 模式的系统提示词
   */
  function buildAgentSystemPrompt(session, _userText) {
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

    return systemPrompt;
  }

  /**
   * 格式化历史消息，还原 tool/assistant(tool_calls) 字段
   * 恢复 thinking 内容以保持完整上下文
   */
  function formatHistoryMessages(rawHistory) {
    return rawHistory
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
          // 恢复 thinking 内容到消息中，防止上下文丢失
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
  }

  /**
   * 智能截断历史消息，优先保留 todo 工具消息和最近消息
   */
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
    const todoMessages = [];
    const otherToolMessages = [];
    const otherMessages = [];

    // 分离消息：todo 工具、其他工具、普通消息
    for (const msg of formattedHistory) {
      if (msg.role === 'tool') {
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (content.includes('todo-') || content.includes('待办')) {
          todoMessages.push(msg);
        } else {
          otherToolMessages.push(msg);
        }
      } else if (msg.role === 'assistant' && msg.tool_calls) {
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
    return allKept.sort((a, b) => {
      const aIdx = formattedHistory.indexOf(a);
      const bIdx = formattedHistory.indexOf(b);
      return aIdx - bIdx;
    });
  }

  /**
   * 增强系统提示词：注入已访问网站清单
   */
  function enhanceSystemPromptWithPages(systemPrompt) {
    const pageList = typeof getPageList === 'function' ? getPageList() : [];
    const validPages = pageList.filter(p => p.url && p.title);

    if (validPages.length === 0) return systemPrompt;

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

    return (
      systemPrompt +
      '\n\n【当前打开的标签页】\n' +
      pagesInfo +
      `\n总计：${validPages.length} 个标签页` +
      '\n提示：访问已打开网站时，优先用 get_page_info(tab_id) 而非重新搜索'
    );
  }

  /**
   * 动态截断活跃历史消息（while循环内使用）
   * 优先保留 todo 工具消息、系统消息和最近消息
   */
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
        const hasTodoCall = msg.tool_calls.some(call => todoToolNames.has(call.function?.name));
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
    return [systemMsg, ...finalMessages];
  }

  /**
   * 动态刷新系统提示词中的 todo 部分
   */
  function refreshTodoInSystemPrompt(currentSystemContent) {
    const freshTodoPrompt =
      todoManager && typeof todoManager.buildTodoPrompt === 'function'
        ? todoManager.buildTodoPrompt()
        : '';
    // 替换 [To Do List - Highest Priority] 到下一个主要段落之间的内容
    const todoSectionRegex =
      /\n\n\[To Do List - Highest Priority\][\s\S]*?(?=\n\n你是Agent模式|\n\n【当前打开的标签页】|$)/;
    if (todoSectionRegex.test(currentSystemContent)) {
      return currentSystemContent.replace(todoSectionRegex, freshTodoPrompt);
    }
    return currentSystemContent;
  }

  return {
    buildAgentSystemPrompt,
    formatHistoryMessages,
    truncateHistorySmart,
    enhanceSystemPromptWithPages,
    truncateLiveHistory,
    refreshTodoInSystemPrompt
  };
}

module.exports = {
  createAgentPromptBuilder
};
