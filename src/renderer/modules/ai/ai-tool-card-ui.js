/**
 * AI Agent 工具卡片 UI 渲染器
 * 负责工具卡片渲染、工具描述/摘要构建
 * 样式渲染器拆分至：ai-tool-style-inline / text / badge
 */

const { createInlineStyleRenderer } = require('./ai-tool-style-inline');
const { createTextStyleRenderer } = require('./ai-tool-style-text');
const { createBadgeStyleRenderer } = require('./ai-tool-style-badge');

/**
 * 创建工具卡片 UI 工厂
 * @param {Object} options
 * @param {Document} options.documentRef - 文档引用
 * @param {Function} options.getPageList - 获取页面列表函数
 */
const TOOL_ICONS = {
  search_page:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  get_page_info:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  click_element:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/><path d="m14 4.1.8 2.9"/><path d="m4.1 14 2.9.8"/></svg>',
  input_text:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/></svg>',
  add_todo:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>',
  add_todos:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="10"/></svg>',
  list_todos:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>',
  complete_todo:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  complete_todos:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/><path d="M3 12h.01"/></svg>',
  remove_todo:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  end_session:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>'
};

const TOOL_COLORS = {
  search_page: '#4285f4',
  get_page_info: '#a855f7',
  click_element: '#a855f7',
  input_text: '#a855f7',
  add_todo: '#22c55e',
  add_todos: '#22c55e',
  list_todos: '#22c55e',
  complete_todo: '#22c55e',
  complete_todos: '#22c55e',
  remove_todo: '#ef4444',
  end_session: '#64748b'
};

const STATUS_ICONS = {
  success:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  pending:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>'
};

function getToolIcon(toolName) {
  return TOOL_ICONS[toolName] || '';
}

function getToolColor(toolName) {
  return TOOL_COLORS[toolName] || '#64748b';
}

function getStatusIcon(status) {
  return STATUS_ICONS[status] || '';
}

function truncateText(text, maxLength) {
  const value = String(text || '');
  if (!maxLength || value.length <= maxLength) return value;
  return value.substring(0, maxLength) + '...';
}

/**
 * 根据工具名和参数构建结构化参数列表
 */
function buildToolParamRows(toolName, args) {
  const rows = [];
  const a = args || {};

  switch (toolName) {
    case 'search_page': {
      // 搜索内容已在 description 中显示，不再重复
      break;
    }
    case 'get_page_info': {
      // 页面信息已在 description 中显示，不再重复
      break;
    }
    case 'click_element': {
      // 点击目标已在 description 中显示，不再重复
      break;
    }
    case 'input_text': {
      if (a.selector) rows.push({ label: '目标选择器', value: a.selector, icon: 'selector' });
      if (a.text) rows.push({ label: '输入内容', value: a.text, icon: 'text' });
      if (a.tab_id) rows.push({ label: '目标页面', value: a.tab_id, icon: 'page' });
      else rows.push({ label: '目标页面', value: '当前页面', icon: 'page' });
      break;
    }
    case 'add_todo':
    case 'add_todos':
    case 'list_todos':
    case 'complete_todo':
    case 'complete_todos':
    case 'remove_todo':
    case 'end_session': {
      // 待办系列和结束工具：description 已包含关键信息，不再重复参数行
      break;
    }
    default:
      break;
  }

  // 结果信息已在 description 中显示，不再追加参数行

  return rows;
}

// 需要描述文字8字截断+hover完整提示的工具
const TRUNCATE_DESC_TOOLS = new Set([
  'search_page',
  'get_page_info',
  'click_element',
  'add_todo',
  'add_todos',
  'list_todos',
  'complete_todo',
  'complete_todos',
  'remove_todo'
]);
const DESC_TRUNCATE_LEN = 8;

function createToolCardUI(options) {
  const { documentRef, getPageList, store } = options;

  function getCardStyle() {
    return (store && store.get('settings.toolCardStyle')) || 'inline';
  }

  function renderToolCard(target, cardOptions) {
    if (!target) return;
    if (!documentRef) {
      target.classList.remove('streaming');
      target.innerText = cardOptions.description || '';
      return;
    }

    const { title, description, status, toolName = '', args } = cardOptions;
    target.classList.remove('streaming', 'ai');
    target.textContent = '';

    const style = getCardStyle();
    const color = getToolColor(toolName);
    const displayTitle = title || getToolTitle(toolName);
    const paramRows = buildToolParamRows(toolName, args);

    // 待办系列工具使用向下展开的垂直布局
    if (isTodoTool(toolName)) {
      renderTodoStyle(target, displayTitle, description, status, toolName, color);
    } else if (style === 'text') {
      renderTextStyle(target, displayTitle, description, status, toolName, color, paramRows);
    } else if (style === 'badge') {
      renderBadgeStyle(target, displayTitle, description, status, toolName, color, paramRows);
    } else {
      renderInlineStyle(target, displayTitle, description, status, toolName, color, paramRows);
    }
  }

  // 判断是否为待办工具
  function isTodoTool(toolName) {
    return [
      'add_todo',
      'add_todos',
      'list_todos',
      'complete_todo',
      'complete_todos',
      'remove_todo'
    ].includes(toolName);
  }

  // 创建带截断+tooltip的描述元素
  function createDescElement(text, toolName) {
    const el = documentRef.createElement('span');
    if (TRUNCATE_DESC_TOOLS.has(toolName) && text && text.length > DESC_TRUNCATE_LEN) {
      el.textContent = truncateText(text, DESC_TRUNCATE_LEN);
      el.title = text;
    } else {
      el.textContent = text;
    }
    return el;
  }

  // 创建待办项图标：未完成虚线圆带序号，完成打勾，未开始红叉
  function createTodoIcon(num, isCompleted, isFailed) {
    const size = 14;
    const fillColor = isFailed
      ? 'rgba(239, 68, 68, 0.1)'
      : isCompleted
        ? 'rgba(34, 197, 94, 0.1)'
        : 'transparent';

    if (isCompleted) {
      // 完成：绿色实心圆带打勾
      return `<svg width="${size}" height="${size}" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" fill="${fillColor}" stroke="#22c55e" stroke-width="2"/>
        <path d="M6 10l3 3 5-5" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }
    if (isFailed) {
      // 失败/未开始：红色实心圆带叉
      return `<svg width="${size}" height="${size}" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" fill="${fillColor}" stroke="#ef4444" stroke-width="2"/>
        <path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
    }
    // 未完成：虚线圆带序号
    return `<svg width="${size}" height="${size}" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="9" fill="transparent" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="3,2"/>
      <text x="10" y="14" text-anchor="middle" font-size="10" fill="#6b7280" font-family="system-ui, -apple-system, sans-serif">${num}</text>
    </svg>`;
  }

  // 解析待办列表文本，提取结构化的待办项
  function parseTodoList(text) {
    if (!text) return [];
    const lines = text.split('\n').filter(l => l.trim());
    return lines.map(line => {
      // 匹配格式: "1. [x] (high) 标题" 或 "1. [ ] (medium) 标题"
      const match = line.match(/^(\d+)\.\s*\[([x\s])\]\s*(?:\(([^)]+)\))?\s*(.+)$/);
      if (match) {
        return {
          num: match[1],
          completed: match[2] === 'x',
          priority: match[3] || '',
          title: match[4]
        };
      }
      return { raw: line };
    });
  }

  // 待办工具垂直布局：图标+标题在上，详情列表向下展开
  function renderTodoStyle(target, title, description, status, toolName, color) {
    target.classList.add('tool-card', 'tool-card-style-todo');

    // 头部行：图标 + 标题 + 状态
    const header = documentRef.createElement('div');
    header.className = 'tc-todo-header';

    if (status) {
      const statusEl = documentRef.createElement('span');
      statusEl.className = `tc-todo-status-icon ${status}`;
      statusEl.innerHTML = getStatusIcon(status);
      header.appendChild(statusEl);
    }

    const icon = documentRef.createElement('span');
    icon.className = 'tc-todo-icon';
    icon.style.color = color;
    icon.innerHTML = getToolIcon(toolName) || '';
    header.appendChild(icon);

    const titleEl = documentRef.createElement('span');
    titleEl.className = 'tc-todo-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);

    target.appendChild(header);

    // 详情区域：向下展开显示完整描述/列表
    const detail = documentRef.createElement('div');
    detail.className = 'tc-todo-detail';

    // 提取简短状态描述（去掉后面的列表部分）
    const fullDesc = description || '';
    const lines = fullDesc.split('\n');
    const shortDesc = lines[0] || '';
    const listContent = lines.slice(1).join('\n');

    // 简短描述
    const descEl = documentRef.createElement('div');
    descEl.className = 'tc-todo-short-desc';
    descEl.textContent = shortDesc;
    detail.appendChild(descEl);

    // 如果有待办列表，使用美化渲染
    if (listContent) {
      const listContainer = documentRef.createElement('div');
      listContainer.className = 'tc-todo-list-container';

      const items = parseTodoList(listContent);
      items.forEach(item => {
        const itemEl = documentRef.createElement('div');
        itemEl.className = 'tc-todo-item';

        if (item.raw) {
          // 解析失败，直接显示文本
          itemEl.textContent = item.raw;
        } else {
          // 图标
          const iconEl = documentRef.createElement('span');
          iconEl.className = 'tc-todo-item-icon';
          iconEl.innerHTML = createTodoIcon(item.num, item.completed, false);
          itemEl.appendChild(iconEl);

          // 内容区域
          const contentEl = documentRef.createElement('div');
          contentEl.className = 'tc-todo-item-content';

          // 优先级标签
          if (item.priority) {
            const priEl = documentRef.createElement('span');
            priEl.className = `tc-todo-priority tc-todo-priority-${item.priority}`;
            priEl.textContent = item.priority;
            contentEl.appendChild(priEl);
          }

          // 标题
          const titleSpan = documentRef.createElement('span');
          titleSpan.className = 'tc-todo-item-title';
          titleSpan.textContent = item.title;
          contentEl.appendChild(titleSpan);

          itemEl.appendChild(contentEl);
        }

        listContainer.appendChild(itemEl);
      });

      detail.appendChild(listContainer);
    }

    target.appendChild(detail);
  }

  function buildParamSummary(paramRows) {
    if (!paramRows || paramRows.length === 0) return '';
    return paramRows.map(r => `${r.label}: ${r.value}`).join(' · ');
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // 创建样式渲染器实例
  const styleDeps = {
    documentRef,
    getStatusIcon,
    getToolIcon,
    createDescElement,
    buildParamSummary
  };
  const { renderInlineStyle } = createInlineStyleRenderer(styleDeps);
  const { renderTextStyle } = createTextStyleRenderer(styleDeps);
  const { renderBadgeStyle } = createBadgeStyleRenderer({ ...styleDeps, hexToRgba });

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
      case 'search_page': {
        return args.query || '未提供搜索词';
      }
      case 'get_page_info': {
        const pageHint = buildPageHintFromArgs(args);
        return pageHint === '当前页面' ? '当前页面' : pageHint.replace(/^页面:\s*/, '');
      }
      case 'click_element': {
        const selector = args.selector || '';
        const pageHint = buildPageHintFromArgs(args);
        const pageDisplay = pageHint === '当前页面' ? '' : pageHint.replace(/^页面:\s*/, '');
        const parts = [selector, pageDisplay].filter(Boolean);
        return parts.join(' · ') || '准备点击';
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
      const title = toolResult?.title || '';
      const tabId = toolResult?.tabId || '';
      // 去掉"页面:"前缀，直接显示页面标题
      const hint = title || (tabId ? `tab_id: ${tabId}` : '');
      return {
        status: 'success',
        text: hint || '已打开',
        tabId
      };
    }

    if (toolName === 'get_page_info') {
      const pageHint = buildPageHintFromResult(toolResult, toolCall);
      const failed = toolResult && toolResult.success === false;
      const errorText = toolResult && toolResult.error ? toolResult.error : '获取失败';
      // 去掉"页面:"前缀
      const display = failed ? errorText : pageHint.replace(/^页面:\s*/, '') || '已获取';
      return {
        status: failed ? 'error' : 'success',
        text: display
      };
    }

    if (toolResult && toolResult.success === false) {
      return {
        status: 'error',
        text: toolResult.error || '执行失败'
      };
    }

    if (toolName === 'click_element') {
      // 去掉"目标:"前缀，直接跟标签名；去掉"页面:"前缀
      const tagName = toolResult && toolResult.tagName ? toolResult.tagName.toLowerCase() : '';
      const role = toolResult && toolResult.role ? `role=${toolResult.role}` : '';
      const type = toolResult && toolResult.type ? `type=${toolResult.type}` : '';
      const pageHint = buildPageHintFromResult(toolResult, toolCall);
      const pageDisplay = pageHint.replace(/^页面:\s*/, '');
      const cancelled = toolResult && toolResult.cancelled ? '事件被取消' : '';
      const details = [tagName, role, type, cancelled, pageDisplay].filter(Boolean).join('，');
      return {
        status: 'success',
        text: details || '已完成'
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
    renderToolCard,
    getToolStatusLabel,
    getToolTitle,
    getToolIcon,
    getToolColor,
    getStatusIcon,
    truncateText,
    resolvePageLabel,
    buildPageHintFromArgs,
    buildPageHintFromResult,
    buildToolCallDescription,
    buildToolResultSummary,
    buildToolParamRows
  };
}

module.exports = {
  createToolCardUI
};
