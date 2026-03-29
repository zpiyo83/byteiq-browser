/**
 * AI 上下文与提示词工具
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

async function extractPageContent(webview) {
  if (!webview || webview.tagName !== 'WEBVIEW') {
    return null;
  }

  try {
    if (!webview.isConnected) {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          if (webview.isConnected) {
            clearInterval(timer);
            resolve();
            return;
          }
          if (Date.now() - start > 100000) {
            clearInterval(timer);
            reject(new Error('Webview attach timeout'));
          }
        }, 50);
      });
    }

    if (webview.dataset && webview.dataset.domReady !== 'true') {
      if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
        webview.dataset.domReady = 'true';
      } else {
        await new Promise((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            webview.removeEventListener('dom-ready', onReady);
            reject(new Error('Webview dom-ready timeout'));
          }, 100000);

          function onReady() {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (webview.dataset) {
              webview.dataset.domReady = 'true';
            }
            webview.removeEventListener('dom-ready', onReady);
            resolve();
          }

          webview.addEventListener('dom-ready', onReady);
        });
      }
    }
    const content = await webview.executeJavaScript(EXTRACT_PAGE_CONTENT_SCRIPT);
    return content;
  } catch (error) {
    console.error('Failed to extract page content:', error);
    return null;
  }
}

function buildSelectionContext(options) {
  const { text, getActiveTabId, documentRef, t } = options;
  const content = String(text || '').trim();
  if (!content) return null;
  const tabId = getActiveTabId();
  const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
  return {
    url: webview && typeof webview.getURL === 'function' ? webview.getURL() : '',
    title: t('ai.selectionTitle') || '选区内容',
    content,
    meta: {
      description: ''
    }
  };
}

function buildSystemPrompt(options) {
  const { mode, pageContext, pageList, includePageContext = true, t } = options;
  const base =
    t('ai.systemPrompt') ||
    '你是一个有帮助的AI助手。你可以帮助用户总结网页内容、回答问题和提供信息。';

  let modePrompt;
  switch (mode) {
  case 'outline':
    modePrompt = t('ai.modeOutline') || '请输出结构化提纲与关键要点。';
    break;
  case 'compare':
    modePrompt = t('ai.modeCompare') || '请进行对比/聚合分析，并给出结论。';
    break;
  case 'translate_page':
    modePrompt = t('ai.modeTranslatePage') || '请将内容翻译/本地化为中文，保持准确与可读性。';
    break;
  case 'code_docs':
    modePrompt = t('ai.modeCodeDocs') || '请以 API 文档/代码解读风格回答，给出关键接口与示例。';
    break;
  case 'qa':
  default:
    modePrompt = t('ai.modeQa') || '请结合上下文回答用户问题，必要时引用原文。';
    break;
  }

  let systemPrompt = `${base}\n\n${modePrompt}`;

  if (includePageContext && pageContext && pageContext.content) {
    systemPrompt += '\n\n' + (t('ai.pageContext') || '当前页面信息：');
    systemPrompt += `\n标题: ${pageContext.title}`;
    systemPrompt += `\nURL: ${pageContext.url}`;
    if (pageContext.meta?.description) {
      systemPrompt += `\n描述: ${pageContext.meta.description}`;
    }
    systemPrompt += `\n\n页面内容:\n${pageContext.content}`;
  }

  if (mode === 'agent' && Array.isArray(pageList)) {
    const pagesSummary = buildPagesSummary(pageList);
    if (pagesSummary) {
      systemPrompt += '\n\n当前可用页面(每次请求更新):\n' + pagesSummary;
    }
  }

  if (mode === 'agent' && includePageContext && pageContext?.controls) {
    const controlsSummary = buildControlsSummary(pageContext.controls);
    if (controlsSummary) {
      systemPrompt += '\n\n可交互元素:\n' + controlsSummary;
    }
  }

  return systemPrompt;
}

function buildControlsSummary(controls) {
  if (!controls) return '';
  const limit = 8;
  const lines = [];
  const sections = [
    { label: '按钮', items: controls.buttons },
    { label: '输入框', items: controls.inputs },
    { label: '链接', items: controls.links }
  ];

  for (const section of sections) {
    const items = Array.isArray(section.items) ? section.items.slice(0, limit) : [];
    if (items.length === 0) continue;
    lines.push(section.label + ':');
    for (const item of items) {
      const parts = [];
      if (item.text) parts.push('text=' + item.text);
      if (item.ariaLabel) parts.push('aria=' + item.ariaLabel);
      if (item.id) parts.push('id=' + item.id);
      if (item.name) parts.push('name=' + item.name);
      if (item.placeholder) parts.push('placeholder=' + item.placeholder);
      if (item.selector) parts.push('selector=' + item.selector);
      if (parts.length > 0) {
        lines.push(parts.join(' | '));
      }
    }
  }

  return lines.join('\n');
}

function buildPagesSummary(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return '';
  const limit = 10;
  const lines = [];
  const slice = pages.slice(0, limit);

  for (const page of slice) {
    const title = String(page.title || page.url || '未命名页面');
    const url = page.url ? ` | ${page.url}` : '';
    const active = page.active ? ' [当前]' : '';
    const id = page.id ? ` | tab_id=${page.id}` : '';
    lines.push(`${title}${active}${url}${id}`);
  }

  if (pages.length > limit) {
    lines.push(`...还有${pages.length - limit}个页面`);
  }

  return lines.join('\n');
}

async function extractAndSetPageContext(options) {
  const {
    webview,
    getCurrentSession,
    updateSession,
    updateContextBar,
    renderSessionsList,
    extractPageContentFn,
    force = false
  } = options;

  const session = await getCurrentSession();
  const previousUrl = session?.pageContext?.url;
  const pageContext = await extractPageContentFn(webview);

  if (pageContext && session && (force || pageContext.url !== previousUrl)) {
    await updateSession(session.id, { pageContext });
    updateContextBar(pageContext);
    await renderSessionsList();
  }
}

module.exports = {
  EXTRACT_PAGE_CONTENT_SCRIPT,
  extractPageContent,
  buildSelectionContext,
  buildSystemPrompt,
  buildPagesSummary,
  extractAndSetPageContext
};
