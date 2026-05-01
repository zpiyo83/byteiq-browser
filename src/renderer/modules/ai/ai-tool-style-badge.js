/**
 * AI Agent 工具卡片 - 徽章标签样式渲染器
 * V4 徽章标签：工具名彩色徽章 + 描述文字跟随
 */

/**
 * 创建徽章标签样式渲染器
 * @param {Object} deps
 * @param {Document} deps.documentRef - 文档引用
 * @param {Function} deps.getStatusIcon - 获取状态图标
 * @param {Function} deps.getToolIcon - 获取工具图标
 * @param {Function} deps.createDescElement - 创建带截断+tooltip的描述元素
 * @param {Function} deps.buildParamSummary - 构建参数摘要
 * @param {Function} deps.hexToRgba - 十六进制颜色转rgba
 */
function createBadgeStyleRenderer(deps) {
  const {
    documentRef,
    getStatusIcon,
    getToolIcon,
    createDescElement,
    buildParamSummary,
    hexToRgba
  } = deps;

  /**
   * 渲染徽章标签样式
   * @param {HTMLElement} target - 目标容器
   * @param {string} title - 工具标题
   * @param {string} description - 描述文字
   * @param {string} status - 状态 (success/error/pending)
   * @param {string} toolName - 工具名
   * @param {string} color - 主题色
   * @param {Array} paramRows - 参数行列表
   */
  function renderBadgeStyle(target, title, description, status, toolName, color, paramRows) {
    target.classList.add('tool-card', 'tool-card-style-badge');

    if (status) {
      const statusEl = documentRef.createElement('span');
      statusEl.className = `tc-badge-status-icon ${status}`;
      statusEl.innerHTML = getStatusIcon(status);
      target.appendChild(statusEl);
    }

    const badge = documentRef.createElement('span');
    badge.className = `tc-badge ${status || 'success'}`;
    badge.style.color = color;
    badge.style.background = hexToRgba(color, 0.08);
    badge.style.borderColor = hexToRgba(color, 0.15);
    badge.innerHTML = `${getToolIcon(toolName) || ''} <span>${title}</span>`;
    target.appendChild(badge);

    const descText = description || buildParamSummary(paramRows);
    const descEl = createDescElement(descText, toolName);
    descEl.className = 'tc-badge-desc';
    target.appendChild(descEl);
  }

  return { renderBadgeStyle };
}

module.exports = { createBadgeStyleRenderer };
