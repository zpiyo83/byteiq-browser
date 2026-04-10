/**
 * AI Markdown 渲染器
 * 轻量级内联实现，不依赖外部库，兼容 Electron 渲染进程
 * 支持：标题、粗体、斜体、代码块、行内代码、列表、引用、链接、表格、分隔线
 */

// HTML 转义
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 将 Markdown 文本转换为 HTML 字符串
 * @param {string} text - Markdown 文本
 * @returns {string} HTML 字符串
 */
function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return text || '';

  // 先转义 HTML，防止 XSS
  let html = escapeHtml(text);

  // 1. 围栏代码块 ```...``` （必须最先处理，内部不再解析）
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const langAttr = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${langAttr}>${code.trim()}</code></pre>`);
    return `<!--CB${idx}-->`;
  });

  // 2. 行内代码 `...`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 3. 标题 # ~ ######
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes, content) => {
    const level = hashes.length;
    return `<h${level}>${content}</h${level}>`;
  });

  // 4. 粗体 **...** 或 __...__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // 5. 斜体 *...* 或 _..._（避免与粗体冲突，用单字符匹配）
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

  // 6. 删除线 ~~...~~
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 7. 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText, url) => {
    // 阻止 javascript: 协议
    const safeUrl = /^\s*javascript\s*:/i.test(url) ? '#' : url;
    return `<a href="${safeUrl}">${linkText}</a>`;
  });

  // 8. 图片 ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    const safeUrl = /^\s*javascript\s*:/i.test(url) ? '#' : url;
    return `<img src="${safeUrl}" alt="${alt}">`;
  });

  // 9. 分隔线 --- 或 *** 或 ___
  html = html.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr>');

  // 10. 引用块 > ...
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  // 合并连续引用
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // 11. 无序列表 - 或 * 开头
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // 12. 有序列表 1. 开头
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  // 用 <ol> 包裹（与无序列表区分：紧跟数字后的 li）
  html = html.replace(
    /(<li>(?:(?!<ul>|<ol>).)*<\/li>\n?(?:<li>(?:(?!<ul>|<ol>).)*<\/li>\n?)*)/g,
    (_m, content) => {
      // 如果已经被 <ul> 包裹则跳过
      return content.startsWith('<ul>') ? content : `<ol>${content}</ol>`;
    }
  );

  // 13. 表格
  html = html.replace(
    /(?:\|?([^\n]+)\|?\n)(?:\|?[\s:?\-:?\-:?\s]+\|?\n)((?:\|?[^\n]+\|?\n?)*)/g,
    (_m, headerRow, bodyRows) => {
      const headers = headerRow.split('|').filter(c => c.trim());
      const thCells = headers.map(h => `<th>${h.trim()}</th>`).join('');
      let bodyHtml = '';
      if (bodyRows) {
        const rows = bodyRows.trim().split('\n');
        for (const row of rows) {
          const cells = row.split('|').filter(c => c.trim());
          const tdCells = cells.map(c => `<td>${c.trim()}</td>`).join('');
          if (tdCells) bodyHtml += `<tr>${tdCells}</tr>`;
        }
      }
      return `<table><thead><tr>${thCells}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
    }
  );

  // 14. 段落：将连续非标签行包裹为 <p>
  html = html.replace(/^(?!<[a-z/]|$)(.+)$/gm, '<p>$1</p>');
  // 合并连续 <p>
  html = html.replace(/<\/p>\n<p>/g, '<br>');

  // 15. 换行：两个空格+换行 → <br>，或 GFM 换行
  html = html.replace(/ {2}\n/g, '<br>');

  // 16. 还原代码块占位
  html = html.replace(/<!--CB(\d+)-->/g, (_m, idx) => {
    return codeBlocks[parseInt(idx, 10)] || '';
  });

  return html;
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
 * 将 Markdown 渲染到 DOM 元素中（带安全清理）
 * @param {HTMLElement} element - 目标元素
 * @param {string} text - Markdown 文本
 * @param {Document} doc - document 引用，用于 DOM 操作
 */
function renderMarkdownToElement(element, text, _doc) {
  if (!element) return;
  if (!text || typeof text !== 'string') {
    element.textContent = text || '';
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
