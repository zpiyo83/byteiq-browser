/**
 * AI Agent 工具卡片 - 纯净文本样式渲染器
 * V3 纯净文本：色点 + 一行文字 + 状态小标签
 */

/**
 * 创建纯净文本样式渲染器
 * @param {Object} deps
 * @param {Document} deps.documentRef - 文档引用
 * @param {Function} deps.getStatusIcon - 获取状态图标
 * @param {Function} deps.createDescElement - 创建带截断+tooltip的描述元素
 * @param {Function} deps.buildParamSummary - 构建参数摘要
 */
function createTextStyleRenderer(deps) {
  const { documentRef, getStatusIcon, createDescElement, buildParamSummary } = deps;

  /**
   * 渲染纯净文本样式
   * @param {HTMLElement} target - 目标容器
   * @param {string} title - 工具标题
   * @param {string} description - 描述文字
   * @param {string} status - 状态 (success/error/pending)
   * @param {string} toolName - 工具名
   * @param {string} color - 主题色
   * @param {Array} paramRows - 参数行列表
   */
  function renderTextStyle(target, title, description, status, toolName, color, paramRows) {
    target.classList.add('tool-card', 'tool-card-style-text');

    const statusIcon = documentRef.createElement('span');
    statusIcon.className = `tc-text-status-icon ${status || 'success'}`;
    statusIcon.innerHTML = getStatusIcon(status || 'success');
    if ((status || 'success') !== 'pending') statusIcon.style.color = color;
    target.appendChild(statusIcon);

    const textWrap = documentRef.createElement('div');
    textWrap.className = 'tc-text-wrap';

    const titleEl = documentRef.createElement('strong');
    titleEl.textContent = title;
    textWrap.appendChild(titleEl);

    const detail = description || buildParamSummary(paramRows);
    if (detail) {
      textWrap.appendChild(documentRef.createTextNode(' — '));
      const descEl = createDescElement(detail, toolName);
      textWrap.appendChild(descEl);
    }

    target.appendChild(textWrap);
  }

  return { renderTextStyle };
}

module.exports = { createTextStyleRenderer };
