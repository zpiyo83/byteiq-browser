/**
 * AI Agent 工具卡片 UI 渲染器
 * 负责工具卡片渲染、工具描述/摘要构建
 */

/**
 * 创建工具卡片 UI 工厂
 * @param {Object} options
 * @param {Document} options.documentRef - 文档引用
 * @param {Function} options.getPageList - 获取页面列表函数
 */
function createToolCardUI(options) {
  const { documentRef, getPageList } = options;

  function renderToolCard(target, cardOptions) {
    if (!target) return;
    if (!documentRef) {
      target.classList.remove('streaming');
      target.innerText = cardOptions.description || '';
      return;
    }

    const { title, description, status } = cardOptions;
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

  return {
    renderToolCard,
    getToolStatusLabel,
    getToolTitle,
    truncateText,
    resolvePageLabel,
    buildPageHintFromArgs,
    buildPageHintFromResult,
    buildToolCallDescription,
    buildToolResultSummary
  };
}

module.exports = {
  createToolCardUI
};
