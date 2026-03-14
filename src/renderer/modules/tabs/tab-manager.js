// 创建标签页管理器工厂函数
const { createTabHistoryManager } = require('./tab-history');
const { createTabOrderManager } = require('./tab-order');
const { createTabWebviewEvents } = require('./tab-webview-events');

function createTabManager(options) {
  const {
    documentRef,
    ipcRenderer,
    initI18n,
    store,
    t,
    tabsBar,
    newTabBtn,
    webviewsContainer,
    newTabTemplate,
    progressBar,
    urlInput,
    findResults,
    showToast,
    formatUrl,
    applyStoredZoom,
    getIncognito,
    onWebviewDidStopLoading,
    onWebviewUrlChanged,
    onActiveWebviewChanged,
    onTabClosed,
    updateBookmarkIcon
  } = options;

  // 标签页数据数组
  const tabs = [];
  let activeTabId = null; // 当前活跃标签页ID
  let isRestoringSession = false; // 是否正在恢复会话
  const lastClosedTabs = []; // 最近关闭的标签页列表
  let navigateToHandler = null; // 导航处理器
  const tabOrderManager = createTabOrderManager({
    documentRef,
    tabsBar,
    newTabBtn
  });
  const { renderTabOrder, getOrderedTabIds } = tabOrderManager;
  const { saveHistory } = createTabHistoryManager(store);
  const { setupWebviewEvents } = createTabWebviewEvents({
    documentRef,
    ipcRenderer,
    progressBar,
    urlInput,
    findResults,
    showToast,
    applyStoredZoom,
    updateBookmarkIcon,
    onWebviewDidStopLoading,
    onWebviewUrlChanged,
    setTabLoading,
    updateTabUrl,
    setTabIcon,
    getTabById,
    saveHistory,
    getActiveTabId
  });

  // 设置导航处理器
  function setNavigateTo(handler) {
    navigateToHandler = handler;
  }

  // 获取当前活跃标签页ID
  function getActiveTabId() {
    return activeTabId;
  }

  // 根据ID获取标签页
  function getTabById(id) {
    return tabs.find(tab => tab.id === id);
  }

  function getTabsSnapshot() {
    const orderedIds = getOrderedTabIds();
    const orderedTabs = orderedIds.length
      ? orderedIds.map(id => getTabById(id)).filter(Boolean)
      : tabs.slice();

    return orderedTabs.map(tab => ({
      id: tab.id,
      title: tab.title || '',
      url: tab.url || '',
      pinned: !!tab.pinned,
      loading: !!tab.loading,
      active: tab.id === activeTabId
    }));
  }

  // 更新标签页URL
  function updateTabUrl(id, url) {
    const tab = getTabById(id);
    if (!tab) return;
    tab.url = url;
    saveSession();
  }

  // 保存会话数据
  function saveSession() {
    if (isRestoringSession) return;
    const sessionTabs = tabs.map(tab => ({
      url: tab.url || '',
      pinned: !!tab.pinned
    }));
    const activeIndex = tabs.findIndex(tab => tab.id === activeTabId);
    store.set('session.tabs', sessionTabs);
    store.set('session.activeIndex', activeIndex);
  }

  function restoreSession() {
    const shouldRestore = store.get('settings.restoreSession', true);
    if (!shouldRestore) {
      createTab();
      return;
    }

    const sessionTabs = store.get('session.tabs', []);
    if (!Array.isArray(sessionTabs) || sessionTabs.length === 0) {
      createTab();
      return;
    }

    isRestoringSession = true;
    sessionTabs.forEach(tabInfo => {
      const tabUrl = typeof tabInfo === 'string' ? tabInfo : tabInfo.url;
      const pinned = typeof tabInfo === 'object' && tabInfo.pinned;
      createTab(tabUrl || null, {
        activate: false,
        useStartup: false,
        skipSession: true,
        pinned
      });
    });

    const activeIndex = store.get('session.activeIndex', 0);
    const targetTab = tabs[activeIndex] || tabs[0];
    if (targetTab) {
      switchTab(targetTab.id);
    }
    isRestoringSession = false;
    saveSession();
  }

  function setTabPinned(id, pinned) {
    const tab = getTabById(id);
    if (!tab) return;
    tab.pinned = pinned;

    const tabEl = documentRef.getElementById(`tab-${id}`);
    if (tabEl) {
      tabEl.classList.toggle('pinned', pinned);
    }
    renderTabOrder(tabs);
    saveSession();
  }

  function setTabLoading(id, isLoading) {
    const tab = getTabById(id);
    if (tab) {
      tab.loading = isLoading;
    }
    const tabEl = documentRef.getElementById(`tab-${id}`);
    if (tabEl) {
      tabEl.classList.toggle('loading', isLoading);
    }
  }

  function setTabIcon(id, iconUrl) {
    const tabEl = documentRef.getElementById(`tab-${id}`);
    if (!tabEl) return;
    const iconEl = tabEl.querySelector('.tab-icon');
    if (!iconEl) return;

    if (iconUrl) {
      iconEl.src = iconUrl;
      iconEl.classList.add('visible');
    } else {
      iconEl.removeAttribute('src');
      iconEl.classList.remove('visible');
    }
  }

  function duplicateTab(id) {
    const wv = documentRef.getElementById(`webview-${id}`);
    const url = wv && wv.tagName === 'WEBVIEW' ? wv.getURL() : '';
    createTab(url || null);
  }

  function closeOtherTabs(id) {
    const idsToClose = tabs.map(tab => tab.id).filter(tabId => tabId !== id);
    idsToClose.forEach(tabId => closeTab(tabId));
  }

  function closeTabsToRight(id) {
    const orderedIds = getOrderedTabIds();
    const index = orderedIds.indexOf(id);
    if (index === -1) return;
    const idsToClose = orderedIds.slice(index + 1);
    idsToClose.forEach(tabId => closeTab(tabId));
  }

  function createTab(url = null, options = {}) {
    const { activate = true, useStartup = true, skipSession = false, pinned = false } = options;
    const startupUrl = useStartup ? store.get('settings.startupUrl', '') : '';
    const targetUrl = url || startupUrl || null;
    const formattedUrl = targetUrl ? formatUrl(targetUrl) : null;

    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const tab = {
      id,
      url: formattedUrl,
      title: t('tabs.newTab'),
      pinned: !!pinned,
      loading: false
    };

    tabs.push(tab);

    const tabEl = documentRef.createElement('div');
    tabEl.className = 'tab';
    tabEl.id = `tab-${id}`;
    tabEl.innerHTML = `
        <span class="tab-content">
            <img class="tab-icon" alt="">
            <span class="tab-spinner"></span>
            <span class="tab-title">${tab.title}</span>
        </span>
        <span class="close-tab">x</span>
    `;
    tabEl.classList.toggle('pinned', tab.pinned);
    tabEl.addEventListener('click', e => {
      if (e.target.classList.contains('close-tab')) {
        closeTab(id);
      } else {
        switchTab(id);
      }
    });
    tabEl.addEventListener('auxclick', e => {
      if (e.button === 1) {
        closeTab(id);
      }
    });

    if (newTabBtn) {
      tabsBar.insertBefore(tabEl, newTabBtn);
    } else {
      tabsBar.appendChild(tabEl);
    }

    renderTabOrder(tabs);

    if (formattedUrl) {
      const webview = documentRef.createElement('webview');
      webview.id = `webview-${id}`;
      webview.src = formattedUrl;
      webview.setAttribute('allowpopups', '');

      if (getIncognito()) {
        webview.setAttribute('partition', 'incognito');
      }

      webviewsContainer.appendChild(webview);
      setupWebviewEvents(webview, id);
    } else if (newTabTemplate && newTabTemplate.content) {
      const content = newTabTemplate.content.cloneNode(true);
      const container = documentRef.createElement('div');
      container.className = 'webview-mock';
      container.id = `webview-${id}`;
      container.appendChild(content);

      const searchInput = container.querySelector('.tab-search-input');
      if (searchInput) {
        searchInput.addEventListener('keypress', e => {
          if (e.key === 'Enter') {
            const query = searchInput.value;
            if (query && typeof navigateToHandler === 'function') {
              navigateToHandler(query, id);
            }
          }
        });
      }

      webviewsContainer.appendChild(container);

      if (typeof initI18n === 'function') {
        initI18n(container);
      }
    } else {
      // newTabTemplate 不存在时创建简单的占位容器
      console.warn('[tab-manager] newTabTemplate not found, creating placeholder');
      const container = documentRef.createElement('div');
      container.className = 'webview-mock';
      container.id = `webview-${id}`;
      container.innerHTML = '<div style="padding:20px;text-align:center;">新标签页</div>';
      webviewsContainer.appendChild(container);
    }

    if (activate) {
      switchTab(id);
    }
    if (!skipSession) {
      saveSession();
    }
    return id;
  }

  function switchTab(id) {
    activeTabId = id;

    documentRef.querySelectorAll('.tab').forEach(tabEl => {
      tabEl.classList.remove('active');
    });
    const activeTabEl = documentRef.getElementById(`tab-${id}`);
    if (activeTabEl) activeTabEl.classList.add('active');

    documentRef.querySelectorAll('#webviews-container > *').forEach(wv => {
      wv.classList.remove('active');
    });

    const activeWebview = documentRef.getElementById(`webview-${id}`);
    if (activeWebview) {
      activeWebview.classList.add('active');
      onActiveWebviewChanged(activeWebview);
    }
    saveSession();
  }

  function closeTab(id) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index === -1) return;

    const tabData = tabs[index];
    const wv = documentRef.getElementById(`webview-${id}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      lastClosedTabs.push({ url: wv.getURL(), title: tabData.title });
      if (lastClosedTabs.length > 10) lastClosedTabs.shift();
    }

    tabs.splice(index, 1);

    const tabEl = documentRef.getElementById(`tab-${id}`);
    if (tabEl) tabEl.remove();

    const webviewEl = documentRef.getElementById(`webview-${id}`);
    if (webviewEl) webviewEl.remove();

    // 调用标签页关闭回调
    if (typeof onTabClosed === 'function') {
      onTabClosed(id);
    }

    if (activeTabId === id) {
      if (tabs.length > 0) {
        const nextTab = tabs[Math.max(0, index - 1)];
        switchTab(nextTab.id);
      } else {
        createTab();
      }
    }
    renderTabOrder(tabs);
    saveSession();
  }

  function restoreLastTab() {
    if (lastClosedTabs.length > 0) {
      const last = lastClosedTabs.pop();
      createTab(last.url);
      showToast(t('toast.tabRestored') || '标签页已恢复', 'success');
    } else {
      showToast(t('toast.noClosedTabs') || '没有可恢复的标签页', 'warning');
    }
  }

  function switchToNextTab() {
    const orderedIds = getOrderedTabIds();
    if (orderedIds.length <= 1) return;

    const currentIndex = orderedIds.indexOf(activeTabId);
    const nextIndex = (currentIndex + 1) % orderedIds.length;
    switchTab(orderedIds[nextIndex]);
  }

  function switchToPrevTab() {
    const orderedIds = getOrderedTabIds();
    if (orderedIds.length <= 1) return;

    const currentIndex = orderedIds.indexOf(activeTabId);
    const prevIndex = (currentIndex - 1 + orderedIds.length) % orderedIds.length;
    switchTab(orderedIds[prevIndex]);
  }

  function bindIpc() {
    ipcRenderer.on('open-new-tab', (event, url) => {
      if (url) {
        createTab(url);
      }
    });
  }

  return {
    bindIpc,
    closeOtherTabs,
    closeTab,
    closeTabsToRight,
    createTab,
    duplicateTab,
    getActiveTabId,
    getTabsSnapshot,
    getTabById,
    restoreLastTab,
    restoreSession,
    saveSession,
    setNavigateTo,
    setTabPinned,
    setupWebviewEvents,
    switchTab,
    switchToNextTab,
    switchToPrevTab,
    updateTabUrl
  };
}

module.exports = {
  createTabManager
};
