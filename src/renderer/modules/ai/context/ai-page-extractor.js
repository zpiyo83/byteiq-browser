/**
 * AI 页面内容提取模块
 * 负责从 webview 中提取页面内容（标题、正文、控件等）
 */

// 页面内容提取脚本
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

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function buildSelector(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return '#' + cssEscape(el.id);

    const dataTestId = el.getAttribute('data-testid');
    if (dataTestId) {
      return tag + '[data-testid="' + cssEscape(dataTestId) + '"]';
    }

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      return tag + '[aria-label="' + cssEscape(ariaLabel) + '"]';
    }

    const name = el.getAttribute('name');
    if (name) {
      return tag + '[name="' + cssEscape(name) + '"]';
    }

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && (tag === 'input' || tag === 'textarea')) {
      return tag + '[placeholder="' + cssEscape(placeholder) + '"]';
    }

    const type = el.getAttribute('type');
    if (type && tag === 'input') {
      return tag + '[type="' + cssEscape(type) + '"]';
    }

    return tag;
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
      );
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
        selector: buildSelector(el)
      });
      if (result.length >= maxCount) break;
    }
    return result;
  }

  const controls = {
    buttons: collectElements(
      'button, [role="button"], input[type="button"], input[type="submit"]',
      30
    ),
    inputs: collectElements(
      'input:not([type="button"]):not([type="submit"]), textarea, select',
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
