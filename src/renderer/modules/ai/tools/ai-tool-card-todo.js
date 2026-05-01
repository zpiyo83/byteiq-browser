/**
 * AI Agent 待办工具卡片渲染器
 * 负责待办工具的垂直布局渲染（图标+列表展开）
 */

const { getStatusIcon, getToolIcon } = require('./ai-tool-card-constants');

/**
 * 创建待办项图标：未完成虚线圆带序号，完成打勾，未开始红叉
 */
function createTodoIcon(num, isCompleted, isFailed) {
  const size = 14;
  const fillColor = isFailed
    ? 'rgba(239, 68, 68, 0.1)'
    : isCompleted
      ? 'rgba(34, 197, 94, 0.1)'
      : 'transparent';

  if (isCompleted) {
    // 完成：渐进式描边动画
    return `<svg class="todo-checkmark-svg" width="${size}" height="${size}" viewBox="0 0 20 20">
      <circle class="todo-checkmark-circle" cx="10" cy="10" r="9" fill="none" stroke="#22c55e" stroke-width="2"/>
      <path class="todo-checkmark-check" d="M6 10l3 3 5-5" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
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

/**
 * 解析待办列表文本，提取结构化的待办项
 */
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

/**
 * 创建待办渲染器工厂
 * @param {Object} deps
 * @param {Document} deps.documentRef - 文档引用
 */
function createTodoRenderer(deps) {
  const { documentRef } = deps;

  /**
   * 待办工具垂直布局：图标+标题在上，详情列表向下展开
   */
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

  return { renderTodoStyle };
}

module.exports = {
  createTodoIcon,
  parseTodoList,
  createTodoRenderer
};
