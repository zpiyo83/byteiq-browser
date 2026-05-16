/**
 * AI Agent 工具卡片常量与纯工具函数
 * 包含图标、颜色、状态图标映射及通用工具函数
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
  close_tab:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  end_session:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>',
  dispatch_background_task:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="4"/></svg>',
  wait_seconds:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  background_task_complete:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
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
  close_tab: '#ef4444',
  end_session: '#64748b',
  dispatch_background_task: '#3b82f6',
  wait_seconds: '#f59e0b',
  background_task_complete: '#10b981'
};

const STATUS_ICONS = {
  success:
    '<svg class="tool-checkmark-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path class="tool-checkmark-check" d="M20 6 9 17l-5-5"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  pending:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>',
  running:
    '<svg class="tool-running-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"/><path d="M22 12a10 10 0 0 1-10 10" opacity=".35"/><path d="M12 22a10 10 0 0 1-10-10" opacity=".1"/></svg>'
};

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
  'remove_todo',
  'close_tab'
]);
const DESC_TRUNCATE_LEN = 8;

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
    case 'close_tab':
    case 'end_session': {
      // 关闭标签页和结束工具：description 已包含关键信息，不再重复参数行
      break;
    }
    case 'dispatch_background_task': {
      if (a.task_query)
        rows.push({
          label: '任务内容',
          value: truncateText(a.task_query, 50),
          icon: 'task'
        });
      if (a.wait_mode) rows.push({ label: '等待模式', value: a.wait_mode, icon: 'mode' });
      break;
    }
    case 'wait_seconds': {
      if (a.seconds) rows.push({ label: '等待时间', value: `${a.seconds}秒`, icon: 'time' });
      break;
    }
    default:
      break;
  }

  // 结果信息已在 description 中显示，不再追加参数行

  return rows;
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

function getToolStatusLabel(status) {
  switch (status) {
    case 'success':
      return '已完成';
    case 'error':
      return '失败';
    case 'running':
      return '执行中';
    case 'pending':
      return '等待中';
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
    case 'close_tab':
      return '关闭标签页';
    case 'end_session':
      return '结束会话';
    case 'dispatch_background_task':
      return '派发后台任务';
    case 'wait_seconds':
      return '等待';
    case 'background_task_complete':
      return '后台任务已完成';
    default:
      return toolName || '工具';
  }
}

module.exports = {
  TOOL_ICONS,
  TOOL_COLORS,
  STATUS_ICONS,
  TRUNCATE_DESC_TOOLS,
  DESC_TRUNCATE_LEN,
  getToolIcon,
  getToolColor,
  getStatusIcon,
  truncateText,
  buildToolParamRows,
  isTodoTool,
  getToolStatusLabel,
  getToolTitle
};
