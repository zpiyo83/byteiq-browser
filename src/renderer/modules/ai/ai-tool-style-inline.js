/**
 * AI Agent 工具卡片 - 极简行内样式渲染器
 * V2 极简行内：图标 + 标题 + 分隔符 + 描述 + 状态
 */

/**
 * 创建行内样式渲染器
 * @param {Object} deps
 * @param {Document} deps.documentRef - 文档引用
 * @param {Function} deps.getStatusIcon - 获取状态图标
 * @param {Function} deps.getToolIcon - 获取工具图标
 * @param {Function} deps.createDescElement - 创建带截断+tooltip的描述元素
 * @param {Function} deps.buildParamSummary - 构建参数摘要
 */
function createInlineStyleRenderer(deps) {
  const { documentRef, getStatusIcon, getToolIcon, createDescElement, buildParamSummary } = deps;

  /**
   * 渲染极简行内样式
   * @param {HTMLElement} target - 目标容器
   * @param {string} title - 工具标题
   * @param {string} description - 描述文字
   * @param {string} status - 状态 (success/error/pending)
   * @param {string} toolName - 工具名
   * @param {string} color - 主题色
   * @param {Array} paramRows - 参数行列表
   */
  function renderInlineStyle(target, title, description, status, toolName, color, paramRows) {
    target.classList.add('tool-card', 'tool-card-style-inline');

    const main = documentRef.createElement('div');
    main.className = 'tc-inline-main';

    if (status) {
      const statusEl = documentRef.createElement('span');
      statusEl.className = `tc-inline-status-icon ${status}`;
      statusEl.innerHTML = getStatusIcon(status);
      main.appendChild(statusEl);
    }

    const icon = documentRef.createElement('div');
    icon.className = 'tc-inline-icon';
    icon.style.color = color;
    icon.innerHTML = getToolIcon(toolName) || '';
    main.appendChild(icon);

    const titleEl = documentRef.createElement('span');
    titleEl.className = 'tc-inline-title';
    titleEl.textContent = title;
    main.appendChild(titleEl);

    const sep = documentRef.createElement('span');
    sep.className = 'tc-inline-sep';
    sep.textContent = '·';
    main.appendChild(sep);

    const descText = description || buildParamSummary(paramRows);
    const descEl = createDescElement(descText, toolName);
    descEl.className = 'tc-inline-desc';
    main.appendChild(descEl);

    target.appendChild(main);
  }

  return { renderInlineStyle };
}

module.exports = { createInlineStyleRenderer };
