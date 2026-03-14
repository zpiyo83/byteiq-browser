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

  return {
    url: window.location.href,
    title: title,
    content: mainContent,
    meta: meta
  };
})();
`;

async function extractPageContent(webview) {
  if (!webview || webview.tagName !== 'WEBVIEW') {
    return null;
  }

  try {
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
  const { mode, pageContext, t } = options;
  const base =
    t('ai.systemPrompt') ||
    '你是一个有帮助的AI助手。你可以帮助用户总结网页内容、回答问题和提供信息。';

  let modePrompt = '';
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

  if (pageContext && pageContext.content) {
    systemPrompt += '\n\n' + (t('ai.pageContext') || '当前页面信息：');
    systemPrompt += `\n标题: ${pageContext.title}`;
    systemPrompt += `\nURL: ${pageContext.url}`;
    if (pageContext.meta?.description) {
      systemPrompt += `\n描述: ${pageContext.meta.description}`;
    }
    systemPrompt += `\n\n页面内容:\n${pageContext.content}`;
  }

  return systemPrompt;
}

async function extractAndSetPageContext(options) {
  const {
    tabId,
    webview,
    getCurrentSession,
    updateSession,
    updateContextBar,
    renderSessionsList,
    extractPageContentFn
  } = options;

  const session = await getCurrentSession();
  const previousUrl = session?.pageContext?.url;
  const pageContext = await extractPageContentFn(webview);

  if (pageContext && pageContext.url !== previousUrl && session) {
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
  extractAndSetPageContext
};
