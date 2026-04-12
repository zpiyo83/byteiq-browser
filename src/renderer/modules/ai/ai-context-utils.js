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

  try {
    // 等待 webview 挂载到 DOM
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

    // 核心策略：不再试图预测 dom-ready，直接尝试 executeJavaScript，
    // 如果报 WebView 未就绪错误则延迟重试
    const maxAttempts = 5;
    const delays = [300, 500, 1000, 2000, 3000];
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const content = await webview.executeJavaScript(EXTRACT_PAGE_CONTENT_SCRIPT);
        if (webview.dataset) {
          webview.dataset.domReady = 'true';
        }
        return content;
      } catch (error) {
        if (isWebviewNotReadyError(error) && attempt < maxAttempts - 1) {
          console.warn(
            `[ai-context-utils] extractPageContent attempt ${attempt + 1} not ready, ` +
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
  const {
    mode,
    pageContext,
    pageList,
    includePageContext = true,
    currentPageInfo,
    taskState,
    t
  } = options;
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

  // 动态注入当前页面信息（优先于缓存的pageContext）
  if (currentPageInfo) {
    systemPrompt += '\n\n[当前页面状态]';
    systemPrompt += `\n标题: ${currentPageInfo.title || '未知'}`;
    systemPrompt += `\nURL: ${currentPageInfo.url || '未知'}`;
    if (currentPageInfo.loading) {
      systemPrompt += '\n状态: 页面加载中...';
    }
  } else if (includePageContext && pageContext && pageContext.content) {
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

  // Agent任务状态追踪
  if (mode === 'agent' && taskState) {
    systemPrompt += '\n\n[任务状态]';
    if (taskState.goal) {
      systemPrompt += `\n目标: ${taskState.goal}`;
    }
    if (Array.isArray(taskState.completedSteps) && taskState.completedSteps.length > 0) {
      systemPrompt += `\n已完成步骤:\n${taskState.completedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    }
    if (taskState.currentPage) {
      systemPrompt += `\n当前所在页面: ${taskState.currentPage}`;
    }
    if (taskState.lastAction) {
      systemPrompt += `\n上一步操作: ${taskState.lastAction}`;
    }
  }

  return systemPrompt;
}

// P1 优化：对链接进行智能分类，优先返回官网入口
function classifyAndSortLinks(links) {
  if (!Array.isArray(links) || links.length === 0) {
    return { official: [], content: [] };
  }

  const official = [];
  const content = [];

  for (const link of links) {
    try {
      const url = new URL(link.href || link.selector || '');
      const pathname = url.pathname;

      // 判断是否为主域名链接（官网入口）
      // 特征：路径为 / 或很短，没有查询参数
      if (pathname === '/' && !url.search) {
        official.push(link);
      } else {
        content.push(link);
      }
    } catch {
      content.push(link);
    }
  }

  return { official, content };
}

function buildControlsSummary(controls) {
  if (!controls) return '';
  const limit = 8;
  const lines = [];

  // P1 优化：链接优先级处理
  let linksToShow = controls.links || [];
  if (Array.isArray(linksToShow) && linksToShow.length > 0) {
    const { official, content } = classifyAndSortLinks(linksToShow);
    // 优先展示官网入口，然后是内容页
    linksToShow = [...official, ...content];
  }

  const sections = [
    { label: '按钮', items: controls.buttons },
    { label: '输入框', items: controls.inputs },
    { label: '链接（官网优先）', items: linksToShow }
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
