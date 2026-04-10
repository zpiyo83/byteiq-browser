/**
 * AI 页面上下文管理模块
 * 负责页面信息获取、状态指示器、上下文栏、标签页变化处理
 */

const { extractPageContent, extractAndSetPageContext } = require('./ai-context-utils');

/**
 * 创建页面上下文管理器
 * @param {object} deps - 依赖注入
 * @returns {object} 页面上下文相关方法
 */
function createAiPageContext(deps) {
  const {
    documentRef,
    getActiveTabId,
    t,
    getCurrentSession,
    updateSession,
    updateContextBar,
    renderSessionsList,
    aiSidebar
  } = deps;

  // 页面状态指示器元素
  const pageStatusBar = documentRef.getElementById('ai-page-status');
  const pageStatusText = documentRef.getElementById('ai-page-status-text');

  // 当前页面信息缓存
  let lastKnownPageInfo = null;

  /**
   * 获取当前页面实时信息（轻量级，不提取完整内容）
   */
  function getCurrentPageInfo() {
    const tabId = getActiveTabId();
    const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
    if (!webview || webview.tagName !== 'WEBVIEW') return null;
    const loading = typeof webview.isLoading === 'function' ? webview.isLoading() : false;
    let title = '';
    let url = '';
    try {
      url = typeof webview.getURL === 'function' ? webview.getURL() : '';
      title = webview.getTitle?.() || '';
    } catch {
      // webview尚未加载完成
    }
    return { title, url, loading, tabId };
  }

  /**
   * 更新页面状态指示器UI
   */
  function updatePageStatusUI(pageInfo) {
    if (!pageStatusBar || !pageStatusText) return;
    if (!pageInfo || !pageInfo.url) {
      pageStatusBar.style.display = 'none';
      return;
    }
    const shortTitle = pageInfo.title || pageInfo.url;
    pageStatusText.textContent = pageInfo.loading ? `加载中: ${shortTitle}` : shortTitle;
    pageStatusBar.style.display = 'flex';
  }

  /**
   * 页面变化时的处理：更新状态指示器和AI上下文
   */
  function onPageChanged(tabId, _url, currentMode) {
    const pageInfo = getCurrentPageInfo();
    if (!pageInfo) return;

    // 检测页面是否变化
    const changed = lastKnownPageInfo && lastKnownPageInfo.url !== pageInfo.url;
    lastKnownPageInfo = pageInfo;

    updatePageStatusUI(pageInfo);

    // 页面变化时闪烁提示
    if (changed && pageStatusBar) {
      pageStatusBar.classList.add('changed');
      setTimeout(() => pageStatusBar.classList.remove('changed'), 600);
    }

    // Ask模式：自动更新session的pageContext（延迟提取，避免阻塞导航）
    if (currentMode !== 'agent') {
      const webview = documentRef.getElementById(`webview-${tabId}`);
      if (webview && webview.tagName === 'WEBVIEW' && !webview.isLoading()) {
        extractAndSetPageContext({
          webview,
          getCurrentSession,
          updateSession,
          updateContextBar,
          renderSessionsList,
          extractPageContentFn: extractPageContent
        }).catch(err => console.error('Auto-extract page context failed:', err));
      }
    }
  }

  /**
   * 当标签页切换时自动提取内容
   */
  async function onTabChanged(tabId, currentMode) {
    if (!tabId) return;

    const webview = documentRef.getElementById(`webview-${tabId}`);
    if (!webview || webview.tagName !== 'WEBVIEW') {
      return;
    }

    // 等待页面加载完成
    if (webview.isLoading && webview.isLoading()) {
      return;
    }

    // 检查AI侧边栏是否打开
    if (aiSidebar.classList.contains('collapsed')) {
      return;
    }

    const {
      getOrCreateSessionIdForTab,
      setActiveSessionId,
      readTabToSessionFromStore,
      renderSessionChat
    } = deps;

    await getOrCreateSessionIdForTab(tabId);
    setActiveSessionId(readTabToSessionFromStore()[tabId]);
    await renderSessionsList();
    const session = await getCurrentSession();
    await renderSessionChat(session);

    // 提取页面内容
    if (currentMode !== 'agent') {
      await extractAndSetPageContext({
        tabId,
        webview,
        getCurrentSession,
        updateSession,
        updateContextBar,
        renderSessionsList,
        extractPageContentFn: extractPageContent
      });
    }
  }

  /**
   * 初始化页面状态指示器
   */
  function initPageStatus() {
    const pageInfo = getCurrentPageInfo();
    if (pageInfo) {
      lastKnownPageInfo = pageInfo;
      updatePageStatusUI(pageInfo);
    }
  }

  return {
    getCurrentPageInfo,
    updatePageStatusUI,
    onPageChanged,
    onTabChanged,
    initPageStatus,
    get lastKnownPageInfo() {
      return lastKnownPageInfo;
    }
  };
}

module.exports = { createAiPageContext };
