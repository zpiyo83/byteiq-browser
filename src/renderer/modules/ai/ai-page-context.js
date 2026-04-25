/**
 * AI 页面上下文管理模块
 * 负责页面信息获取、状态指示器、上下文栏、标签页变化处理
 */

const { extractPageContent, extractAndSetPageContext } = require('./ai-context-utils');
const sidebarEvents = require('./ai-sidebar-events');

/**
 * 创建页面上下文管理器
 * @param {object} deps - 依赖注入
 * @returns {object} 页面上下文相关方法
 */
function createAiPageContext(deps) {
  const {
    documentRef,
    getActiveTabId,
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

  // 内容提取防抖定时器
  let extractDebounceTimer = null;
  const EXTRACT_DEBOUNCE_MS = 800;

  /**
   * 获取当前页面实时信息（轻量级，不提取完整内容）
   */
  function getCurrentPageInfo() {
    const tabId = getActiveTabId();
    const webview = tabId ? documentRef.getElementById(`webview-${tabId}`) : null;
    if (!webview || webview.tagName !== 'WEBVIEW') return null;
    let loading = false;
    let title = '';
    let url = '';
    try {
      loading = typeof webview.isLoading === 'function' ? webview.isLoading() : false;
      url = typeof webview.getURL === 'function' ? webview.getURL() : '';
      title = webview.getTitle?.() || '';
    } catch {
      // webview 尚未 dom-ready，isLoading/getURL/getTitle 不可用
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

    // Ask模式：防抖提取页面上下文，避免频繁触发阻塞主线程
    if (currentMode !== 'agent') {
      // 清除上一次防抖定时器
      if (extractDebounceTimer) {
        clearTimeout(extractDebounceTimer);
        extractDebounceTimer = null;
      }

      extractDebounceTimer = setTimeout(() => {
        extractDebounceTimer = null;

        // 拖动期间跳过内容提取，避免与拖动动画竞争主线程
        const isResizing = sidebarEvents._sidebarResizingGetter
          ? sidebarEvents._sidebarResizingGetter()
          : false;
        if (isResizing) return;

        const webview = documentRef.getElementById(`webview-${tabId}`);
        let isReady = false;
        try {
          isReady = webview && webview.tagName === 'WEBVIEW' && !webview.isLoading();
        } catch {
          // webview 尚未 dom-ready
        }
        if (isReady) {
          extractAndSetPageContext({
            webview,
            getCurrentSession,
            updateSession,
            updateContextBar,
            renderSessionsList,
            extractPageContentFn: extractPageContent
          }).catch(err => console.error('Auto-extract page context failed:', err));
        }
      }, EXTRACT_DEBOUNCE_MS);
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
    try {
      if (webview.isLoading && webview.isLoading()) {
        return;
      }
    } catch {
      // webview 尚未 dom-ready，isLoading 不可用
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
      renderSessionChat,
      syncSessionMessagesToAgent
    } = deps;

    await getOrCreateSessionIdForTab(tabId);
    const activeSessionId = readTabToSessionFromStore()[tabId];
    setActiveSessionId(activeSessionId);
    await renderSessionsList();
    const session = await getCurrentSession();
    await renderSessionChat(session);
    // 同步消息到 agentRunner
    if (syncSessionMessagesToAgent && activeSessionId) {
      await syncSessionMessagesToAgent(activeSessionId);
    }

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
