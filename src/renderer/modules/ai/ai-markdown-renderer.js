/**
 * AI Markdown 渲染器
 * 安全地将 Markdown 文本渲染为 HTML，防止 XSS 攻击
 */

let markedInstance = null;
try {
  const Marked = require('marked').Marked;
  markedInstance = new Marked({ breaks: true, gfm: true });
} catch {
  // marked 不可用时回退到纯文本
}

// 需要移除的危险标签
const DANGEROUS_TAGS = new Set([
  'script',
  'iframe',
  'embed',
  'object',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'style'
]);

// 危险属性正则
const DANGEROUS_ATTR_RE = /^on/i;
const JAVASCRIPT_URL_RE = /^\s*javascript\s*:/i;

/**
 * 清理 DOM 元素中的危险内容（防 XSS）
 * @param {HTMLElement} root - 要清理的根元素
 */
function sanitizeElement(root) {
  if (!root) return;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const children = current.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      if (DANGEROUS_TAGS.has(tag)) {
        child.remove();
        continue;
      }
      // 清理危险属性
      const attrs = child.attributes;
      for (let j = attrs.length - 1; j >= 0; j--) {
        const name = attrs[j].name.toLowerCase();
        const value = attrs[j].value || '';
        if (DANGEROUS_ATTR_RE.test(name)) {
          child.removeAttribute(attrs[j].name);
        } else if (
          (name === 'href' || name === 'src' || name === 'xlink:href') &&
          JAVASCRIPT_URL_RE.test(value)
        ) {
          child.removeAttribute(attrs[j].name);
        }
      }
      stack.push(child);
    }
  }
}

/**
 * 将 Markdown 文本转换为 HTML 字符串
 * @param {string} text - Markdown 文本
 * @returns {string} HTML 字符串
 */
function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return text || '';
  if (!markedInstance) return text;
  try {
    return markedInstance.parse(text);
  } catch {
    return text;
  }
}

/**
 * 将 Markdown 渲染到 DOM 元素中（带安全清理）
 * @param {HTMLElement} element - 目标元素
 * @param {string} text - Markdown 文本
 * @param {Document} doc - document 引用，用于 DOM 操作
 */
function renderMarkdownToElement(element, text, doc) {
  if (!element) return;
  if (!text || typeof text !== 'string') {
    element.textContent = text || '';
    return;
  }
  if (!markedInstance || !doc) {
    element.textContent = text;
    return;
  }
  try {
    const html = renderMarkdown(text);
    element.innerHTML = html;
    element.classList.add('markdown-body');
    sanitizeElement(element);
  } catch {
    // 渲染失败时回退到纯文本
    element.textContent = text;
  }
}

module.exports = {
  renderMarkdown,
  renderMarkdownToElement,
  sanitizeElement
};
