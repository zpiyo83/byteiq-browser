/**
 * AI Agent 工具卡片描述/摘要构建器
 * 负责工具调用描述和结果摘要的构建逻辑
 */

const { truncateText } = require('./ai-tool-card-constants');

/**
 * 创建描述构建器工厂
 * @param {Object} deps
 * @param {Function} deps.getPageList - 获取页面列表函数
 */
function createDescBuilder(deps) {
  const { getPageList } = deps;

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
    if (!toolCall) return '准备执行';
    const args = toolCall.arguments || {};
    switch (toolCall.name) {
      case 'search_page':
      case 'get_page_info':
      case 'click_element': {
        // 仅显示工具标题，不展示参数
        return '';
      }
      case 'input_text': {
        const selector = args.selector || '';
        const text = args.text ? truncateText(args.text, 32) : '';
        const pageHint = buildPageHintFromArgs(args);
        const parts = [selector, text, pageHint].filter(Boolean);
        return parts.join('，') || '准备输入';
      }
      case 'add_todo': {
        const title = args.title ? truncateText(args.title, 48) : '';
        const priority = args.priority || '';
        const parts = [title, priority].filter(Boolean);
        return parts.join(' · ') || '添加待办';
      }
      case 'add_todos': {
        const count = args.items ? args.items.length : 0;
        return `${count} 项`;
      }
      case 'list_todos': {
        const filter = args.filter || 'pending';
        return filter;
      }
      case 'complete_todo': {
        return args.todo_id || '';
      }
      case 'complete_todos': {
        return args.todo_ids ? args.todo_ids.join(', ') : '';
      }
      case 'remove_todo': {
        return args.todo_id || '';
      }
      case 'end_session':
        return '结束会话';
      default:
        return '准备执行';
    }
  }

  function buildToolResultSummary(toolCall, toolResult) {
    const toolName = toolCall ? toolCall.name : '';
    if (toolName === 'search_page') {
      const failed = toolResult && toolResult.success === false;
      if (failed) {
        return { status: 'error', text: toolResult.error || '搜索页面打开失败' };
      }
      const tabId = toolResult?.tabId || '';
      return {
        status: 'success',
        text: '',
        tabId
      };
    }

    if (toolName === 'get_page_info') {
      const failed = toolResult && toolResult.success === false;
      const errorText = toolResult && toolResult.error ? toolResult.error : '获取失败';
      // 仅显示状态，不展示页面标题
      return {
        status: failed ? 'error' : 'success',
        text: failed ? errorText : ''
      };
    }

    if (toolResult && toolResult.success === false) {
      return {
        status: 'error',
        text: toolResult.error || '执行失败'
      };
    }

    if (toolName === 'click_element') {
      return {
        status: 'success',
        text: ''
      };
    }

    if (toolName === 'input_text') {
      const pageHint = buildPageHintFromResult(toolResult, toolCall);
      return {
        status: 'success',
        text: pageHint || '已完成'
      };
    }

    // 待办系列工具：向下显示待办列表
    if (toolName === 'add_todo') {
      const listText = toolResult.currentList ? `\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '已添加'}${listText}`
      };
    }

    if (toolName === 'add_todos') {
      const listText = toolResult.currentList ? `\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '已添加'}${listText}`
      };
    }

    if (toolName === 'list_todos') {
      const display = toolResult.display || '暂无';
      return {
        status: 'success',
        text: display
      };
    }

    if (toolName === 'complete_todo') {
      const listText = toolResult.currentList ? `\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '已完成'}${listText}`
      };
    }

    if (toolName === 'complete_todos') {
      const listText = toolResult.currentList ? `\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '已完成'}${listText}`
      };
    }

    if (toolName === 'remove_todo') {
      const listText = toolResult.currentList ? `\n${toolResult.currentList}` : '';
      return {
        status: 'success',
        text: `${toolResult.message || '已删除'}${listText}`
      };
    }

    return {
      status: 'success',
      text: '已完成'
    };
  }

  return {
    resolvePageLabel,
    buildPageHintFromArgs,
    buildPageHintFromResult,
    buildToolCallDescription,
    buildToolResultSummary
  };
}

module.exports = {
  createDescBuilder
};
