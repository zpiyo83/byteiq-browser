/**
 * AI 页面内容提取模块
 * 负责从 webview 中提取页面内容（标题、正文、控件等）
 */

// 页面内容提取脚本（参考 Playwright 的可见性检查、选择器构建、控件状态采集）
const EXTRACT_PAGE_CONTENT_SCRIPT = `
(function() {
  const title = document.title || '';
  let mainContent = '';

  const mainSelectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.content',
    '#content',
    '.post',
    '.article',
    '.entry-content'
  ];

  let mainElement = null;
  for (const selector of mainSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      mainElement = el;
      break;
    }
  }

  if (!mainElement) {
    mainElement = document.body;
  }

  function extractText(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'svg', 'iframe', 'code', 'pre'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          const text = node.textContent.trim();
          if (text.length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const texts = [];
    let node;
    while (node = walker.nextNode()) {
      texts.push(node.textContent.trim());
    }
    return texts.join('\\n');
  }

  mainContent = extractText(mainElement);

  const maxLength = 15000;
  if (mainContent.length > maxLength) {
    mainContent = mainContent.substring(0, maxLength) + '...';
  }

  const meta = {
    description: document.querySelector('meta[name="description"]')?.content || '',
    keywords: document.querySelector('meta[name="keywords"]')?.content || '',
    author: document.querySelector('meta[name="author"]')?.content || ''
  };

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\\\]/g, '\\\\$&');
  }

  function safeText(value, limit) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (!limit || text.length <= limit) return text;
    return text.substring(0, limit) + '...';
  }

  // 增强可见性检查（参考 Playwright 的 actionability checks）
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  // 检查元素是否可交互（不仅限于 visible，还包括在视口内）
  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
      rect.bottom > 0 &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
      rect.right > 0
    );
  }

  // 构建精确的 CSS 选择器（参考 Playwright 的选择器优先级策略）
  function buildSelector(el) {
    const tag = el.tagName.toLowerCase();

    // 1. ID 选择器（最高优先级）
    if (el.id) {
      const idSel = '#' + cssEscape(el.id);
      // 验证 ID 在文档中唯一
      if (document.querySelectorAll(idSel).length === 1) return idSel;
    }

    // 2. data-testid
    const dataTestId = el.getAttribute('data-testid');
    if (dataTestId) {
      return tag + '[data-testid="' + cssEscape(dataTestId) + '"]';
    }

    // 3. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      return tag + '[aria-label="' + cssEscape(ariaLabel) + '"]';
    }

    // 4. name 属性
    const name = el.getAttribute('name');
    if (name) {
      return tag + '[name="' + cssEscape(name) + '"]';
    }

    // 5. placeholder（input/textarea）
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && (tag === 'input' || tag === 'textarea')) {
      return tag + '[placeholder="' + cssEscape(placeholder) + '"]';
    }

    // 6. role 属性
    const role = el.getAttribute('role');
    if (role) {
      return tag + '[role="' + cssEscape(role) + '"]';
    }

    // 7. type 属性（input）
    const type = el.getAttribute('type');
    if (type && tag === 'input') {
      return tag + '[type="' + cssEscape(type) + '"]';
    }

    // 8. 尝试用 :nth-child 路径构建唯一选择器
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }
      path.unshift(selector);
      const fullPath = path.join(' > ');
      if (document.querySelectorAll(fullPath).length === 1) {
        return fullPath;
      }
      current = current.parentElement;
    }

    // 9. 降级：返回标签名
    return tag;
  }

  // 查找关联的 label 文本
  function findLabelText(el) {
    // 通过 id 关联的 label
    if (el.id) {
      const label = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (label) return safeText(label.innerText, 80);
    }
    // 被包裹在 label 内
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.cloneNode(true);
      // 移除子表单元素的文本
      labelText.querySelectorAll('input, textarea, select, button').forEach(
        function(child) { child.remove(); }
      );
      return safeText(labelText.innerText, 80);
    }
    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\\s+/);
      const texts = parts.map(function(id) {
        const ref = document.getElementById(id);
        return ref ? ref.textContent.trim() : '';
      }).filter(Boolean);
      if (texts.length) return safeText(texts.join(' '), 80);
    }
    return '';
  }

  function collectElements(selector, maxCount) {
    const result = [];
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (!isVisible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const text = safeText(
        el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title'),
        80
      ) || findLabelText(el);
      result.push({
        tag,
        type: el.getAttribute('type') || '',
        text,
        id: el.id || '',
        name: el.getAttribute('name') || '',
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        placeholder: el.getAttribute('placeholder') || '',
        selector: buildSelector(el),
        disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        inViewport: isInViewport(el)
      });
      if (result.length >= maxCount) break;
    }
    return result;
  }

  const controls = {
    buttons: collectElements(
      'button, [role="button"], input[type="button"], input[type="submit"], summary, [role="link"]',
      30
    ),
    inputs: collectElements(
      'input:not([type="button"]):not([type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
      30
    ),
    links: collectElements('a[href]', 30)
  };

  return {
    url: window.location.href,
    title: title,
    content: mainContent,
    meta: meta,
    controls: controls
  };
})();
`;

function isWebviewNotReadyError(error) {
  const msg = error && error.message ? String(error.message) : '';
  return (
    msg.includes('WebView must be attached to the DOM') ||
    msg.includes('dom-ready event emitted before this method can be called') ||
    msg.includes('dom-ready')
  );
}

async function extractPageContent(webview) {
  if (!webview || webview.tagName !== 'WEBVIEW') {
    return null;
  }

  // 带超时的 Promise 包装，防止 executeJavaScript 永不 resolve 导致 UI 卡死
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
      )
    ]);
  }

  try {
    // 等待 webview 挂载到 DOM（缩短超时避免长时间阻塞）
    if (!webview.isConnected) {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          if (webview.isConnected) {
            clearInterval(timer);
            resolve();
            return;
          }
          if (Date.now() - start > 5000) {
            clearInterval(timer);
            reject(new Error('Webview attach timeout'));
          }
        }, 50);
      });
    }

    // 核心策略：不再试图预测 dom-ready，直接尝试 executeJavaScript，
    // 如果报 WebView 未就绪错误则延迟重试
    const maxAttempts = 3;
    const delays = [300, 800, 1500];
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const content = await withTimeout(
          webview.executeJavaScript(EXTRACT_PAGE_CONTENT_SCRIPT),
          8000
        );
        if (webview.dataset) {
          webview.dataset.domReady = 'true';
        }
        return content;
      } catch (error) {
        const msg = error && error.message ? String(error.message) : '';
        if (
          (isWebviewNotReadyError(error) || msg.includes('timed out')) &&
          attempt < maxAttempts - 1
        ) {
          console.warn(
            `[ai-page-extractor] extractPageContent attempt ${attempt + 1} failed, ` +
              `retrying in ${delays[attempt]}ms...`
          );
          await new Promise(r => setTimeout(r, delays[attempt]));
          continue;
        }
        throw error;
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to extract page content:', error);
    return null;
  }
}

module.exports = {
  EXTRACT_PAGE_CONTENT_SCRIPT,
  extractPageContent,
  isWebviewNotReadyError
};
