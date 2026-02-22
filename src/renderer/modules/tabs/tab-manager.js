// 创建标签页管理器工厂函数
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
    onActiveWebviewChanged,
    updateBookmarkIcon
  } = options;

  // 标签页数据数组
  const tabs = [];
  let activeTabId = null; // 当前活跃标签页ID
  let isRestoringSession = false; // 是否正在恢复会话
  const lastClosedTabs = []; // 最近关闭的标签页列表
  let navigateToHandler = null; // 导航处理器

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

  function renderTabOrder() {
    const pinnedTabs = tabs.filter(tab => tab.pinned);
    const normalTabs = tabs.filter(tab => !tab.pinned);
    const orderedTabs = pinnedTabs.concat(normalTabs);

    orderedTabs.forEach((tab, index) => {
      const tabEl = documentRef.getElementById(`tab-${tab.id}`);
      if (tabEl) {
        tabEl.style.order = index;
      }
    });

    if (newTabBtn) {
      newTabBtn.style.order = orderedTabs.length + 1;
    }
  }

  function setTabPinned(id, pinned) {
    const tab = getTabById(id);
    if (!tab) return;
    tab.pinned = pinned;

    const tabEl = documentRef.getElementById(`tab-${id}`);
    if (tabEl) {
      tabEl.classList.toggle('pinned', pinned);
    }
    renderTabOrder();
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

  function getOrderedTabIds() {
    return Array.from(tabsBar.querySelectorAll('.tab')).map(tabEl => {
      return tabEl.id.replace('tab-', '');
    });
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

    renderTabOrder();

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

  function setupWebviewEvents(webview, id) {
    webview.addEventListener('did-start-loading', () => {
      setTabLoading(id, true);
      if (id === activeTabId) {
        progressBar.style.opacity = '1';
        progressBar.style.width = '30%';
        progressBar.classList.add('loading');
      }
    });

    webview.addEventListener('did-stop-loading', () => {
      setTabLoading(id, false);
      if (id === activeTabId) {
        urlInput.value = webview.getURL();
        progressBar.classList.remove('loading');
        progressBar.style.width = '100%';
        setTimeout(() => {
          progressBar.style.opacity = '0';
          setTimeout(() => {
            progressBar.style.width = '0%';
          }, 200);
        }, 300);
      }
      updateTabUrl(id, webview.getURL());
      applyStoredZoom(webview);
      updateBookmarkIcon(webview.getURL());
      if (typeof onWebviewDidStopLoading === 'function') {
        onWebviewDidStopLoading(webview, id);
      }
    });

    webview.addEventListener('found-in-page', e => {
      const result = e.result;
      if (result.matches !== undefined) {
        findResults.innerText = `${result.activeMatchOrdinal || 0}/${result.matches}`;
      }
    });

    webview.addEventListener('page-favicon-updated', e => {
      const icon = e.favicons && e.favicons.length > 0 ? e.favicons[0] : '';
      setTabIcon(id, icon);
    });

    webview.addEventListener('page-title-updated', e => {
      const tabEl = documentRef.getElementById(`tab-${id}`);
      if (tabEl) {
        tabEl.querySelector('.tab-title').innerText = e.title;
      }
      const tab = getTabById(id);
      if (tab) {
        tab.title = e.title;
      }
      saveHistory(webview.getURL(), e.title);
    });

    webview.addEventListener('did-navigate', e => {
      updateTabUrl(id, e.url);
      applyStoredZoom(webview);
    });

    webview.addEventListener('did-navigate-in-page', e => {
      updateTabUrl(id, e.url);
    });

    webview.addEventListener('did-fail-load', e => {
      if (e.errorCode === -3) return; // 忽略用户取消的请求

      console.error('Failed to load:', e);

      if (e.validatedURL && e.validatedURL.startsWith('chrome-extension://')) {
        ipcRenderer.send('extensions-log', {
          sourceId: e.validatedURL,
          level: 'error',
          message: `did-fail-load(${e.errorCode}) ${e.errorDescription || ''}`,
          detail: `url=${e.validatedURL}`
        });
      }

      // 根据错误代码提供友好的错误信息
      const errorMessages = {
        '-1': '无法连接到服务器',
        '-2': '服务器返回了无效响应',
        '-3': '请求被取消',
        '-4': '连接失败',
        '-5': '域名解析失败，请检查网址是否正确',
        '-6': '连接被拒绝',
        '-7': '连接超时，请检查网络连接',
        '-8': '连接已重置',
        '-9': '内容编码错误',
        '-10': '安全证书错误',
        '-11': '不安全的连接',
        '-12': '服务器要求身份验证',
        '-13': '访问被拒绝',
        '-14': '页面资源过大',
        '-15': '重定向次数过多',
        '-16': '不支持的协议',
        '-17': '上传失败',
        '-18': '下载失败',
        '-19': '网络已断开',
        '-20': '服务器不可用',
        '-21': '服务器错误',
        '-22': 'SSL握手失败',
        '-23': 'SSL证书无效',
        '-24': 'SSL证书过期',
        '-25': 'SSL证书域名不匹配',
        '-26': '文件未找到',
        '-27': '无效的URL',
        '-28': '请求被阻止',
        '-29': 'URL已重定向',
        '-30': '连接已关闭',
        '-31': '网络连接已更改',
        '-32': '页面被阻止',
        '-33': '恶意软件警告',
        '-34': '安全浏览威胁',
        '-35': '不安全的内容'
      };

      const errorMsg = errorMessages[String(e.errorCode)] || e.errorDescription || '未知错误';
      showToast(`页面加载失败: ${errorMsg}`, 'error');
    });

    webview.addEventListener('new-window', e => {
      e.preventDefault();
    });

    webview.addEventListener('console-message', e => {
      if (!e || !e.sourceId || !String(e.sourceId).startsWith('chrome-extension://')) {
        return;
      }

      ipcRenderer.send('extensions-log', {
        sourceId: e.sourceId,
        level: e.level === 2 ? 'error' : e.level === 1 ? 'warn' : 'log',
        message: e.message,
        detail: `line=${e.line || 0}`
      });
    });
  }

  function saveHistory(url, title) {
    if (!url || url === 'about:blank' || url.startsWith('data:')) return;
    let history = store.get('history', []);
    if (history.length > 0 && history[0].url === url) return;

    history.unshift({
      url,
      title,
      time: new Date().toISOString()
    });

    if (history.length > 1000) history = history.slice(0, 1000);
    store.set('history', history);
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

    if (activeTabId === id) {
      if (tabs.length > 0) {
        const nextTab = tabs[Math.max(0, index - 1)];
        switchTab(nextTab.id);
      } else {
        createTab();
      }
    }
    renderTabOrder();
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
