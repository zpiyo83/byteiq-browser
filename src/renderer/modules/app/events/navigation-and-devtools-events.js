function bindNavigationAndDevtoolsEvents(options) {
  const {
    backBtn,
    browserManager,
    clearUrlBtn,
    devtoolsBtn,
    documentRef,
    forwardBtn,
    goBtn,
    homeBtn,
    ipcRenderer,
    newTabBtn,
    refreshBtn,
    store,
    tabManager,
    tabsBar,
    urlInput,
    webviewsContainer,
    windowRef
  } = options;

  const document = documentRef;
  const window = windowRef;

  urlInput.addEventListener('click', () => {
    urlInput.select();
  });

  urlInput.addEventListener('input', () => {
    clearUrlBtn.style.display = urlInput.value ? 'block' : 'none';
  });

  clearUrlBtn.addEventListener('click', () => {
    urlInput.value = '';
    urlInput.focus();
    clearUrlBtn.style.display = 'none';
  });

  goBtn.addEventListener('click', () => {
    if (urlInput.value) browserManager.navigateTo(urlInput.value);
  });

  urlInput.addEventListener('keypress', e => {
    if (e.key === 'Enter' && urlInput.value) {
      browserManager.navigateTo(urlInput.value);
    }
  });

  backBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW' && wv.canGoBack()) {
      wv.goBack();
    }
  });

  forwardBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW' && wv.canGoForward()) {
      wv.goForward();
    }
  });

  refreshBtn.addEventListener('click', () => {
    browserManager.refreshCurrentPage();
  });

  homeBtn.addEventListener('click', () => {
    const startupUrl = store.get('settings.startupUrl', '').trim();
    if (startupUrl) {
      browserManager.navigateTo(startupUrl);
      return;
    }

    const engine = store.get('settings.searchEngine', 'bing');
    const homePages = {
      baidu: 'https://www.baidu.com',
      bing: 'https://www.bing.com',
      google: 'https://www.google.com'
    };
    browserManager.navigateTo(homePages[engine] || homePages.bing);
  });

  devtoolsBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      const devtoolsSidebar = document.getElementById('devtools-sidebar');
      const mainContainer = document.querySelector('.main-container');
      const isActive = devtoolsSidebar.classList.contains('active');

      if (isActive) {
        // 关闭开发者工具
        ipcRenderer.send('toggle-devtools-sidebar', {});
        devtoolsSidebar.classList.remove('active');
        devtoolsSidebar.style.width = '0';
        mainContainer.classList.remove('devtools-open');
      } else {
        // 打开开发者工具
        const webContentsId = wv.getWebContentsId();
        ipcRenderer.send('toggle-devtools-sidebar', {
          webContentsId,
          width: 400
        });
        devtoolsSidebar.classList.add('active');
        devtoolsSidebar.style.width = '400px';
        mainContainer.classList.add('devtools-open');
      }
    }
  });

  // 关闭开发者工具按钮
  const closeDevtoolsBtn = document.getElementById('close-devtools-btn');
  if (closeDevtoolsBtn) {
    closeDevtoolsBtn.addEventListener('click', () => {
      const devtoolsSidebar = document.getElementById('devtools-sidebar');
      const mainContainer = document.querySelector('.main-container');
      ipcRenderer.send('toggle-devtools-sidebar', {});
      devtoolsSidebar.classList.remove('active');
      devtoolsSidebar.style.width = '0';
      mainContainer.classList.remove('devtools-open');
    });
  }

  // 开发者工具侧边栏拖动调整宽度
  const devtoolsResizeHandle = document.getElementById('devtools-resize-handle');
  const devtoolsSidebar = document.getElementById('devtools-sidebar');

  if (devtoolsResizeHandle && devtoolsSidebar) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    devtoolsResizeHandle.addEventListener('mousedown', e => {
      isResizing = true;
      startX = e.clientX;
      startWidth = devtoolsSidebar.offsetWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', e => {
      if (!isResizing) return;

      const deltaX = startX - e.clientX;
      const newWidth = Math.max(250, Math.min(800, startWidth + deltaX));

      devtoolsSidebar.style.width = newWidth + 'px';
      webviewsContainer.style.marginRight = newWidth + 'px';
      ipcRenderer.send('resize-devtools-sidebar', { width: newWidth });
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // 监听窗口大小变化
  window.addEventListener('resize', () => {
    ipcRenderer.send('window-resized', {
      width: window.innerWidth,
      height: window.innerHeight
    });
  });

  // 监听开发者工具状态
  ipcRenderer.on('devtools-sidebar-closed', () => {
    const devtoolsSidebar = document.getElementById('devtools-sidebar');
    const mainContainer = document.querySelector('.main-container');
    if (devtoolsSidebar) {
      devtoolsSidebar.classList.remove('active');
      devtoolsSidebar.style.width = '0';
    }
    if (mainContainer) {
      mainContainer.classList.remove('devtools-open');
    }
  });

  newTabBtn.addEventListener('click', () => tabManager.createTab());
  tabsBar.addEventListener('dblclick', e => {
    if (e.target === tabsBar) {
      tabManager.createTab();
    }
  });

  tabManager.restoreSession();

  const activeTabId = tabManager.getActiveTabId();
  const activeTabEl = activeTabId ? document.getElementById(`tab-${activeTabId}`) : null;
  const hasWebview = webviewsContainer && webviewsContainer.querySelector(':scope > *');
  if (!activeTabEl || !hasWebview) {
    const newId = tabManager.createTab();
    if (newId) {
      tabManager.switchTab(newId);
    }
  }

  // 添加快捷键提示到工具栏按钮
  function addShortcutHints() {
    const shortcuts = {
      'back-btn': 'Alt+←',
      'forward-btn': 'Alt+→',
      'refresh-btn': 'Ctrl+R / F5',
      'home-btn': 'Alt+Home',
      'url-input': 'Ctrl+L',
      'history-btn': 'Ctrl+H',
      'bookmarks-list-btn': 'Ctrl+B',
      'downloads-btn': 'Ctrl+J',
      'new-tab-btn': 'Ctrl+T'
    };

    Object.entries(shortcuts).forEach(([id, shortcut]) => {
      const el = document.getElementById(id);
      if (el) {
        const currentTitle = el.getAttribute('title') || '';
        if (!currentTitle.includes(shortcut)) {
          el.setAttribute('title', currentTitle ? `${currentTitle} (${shortcut})` : shortcut);
        }
      }
    });

    // 为新建标签页按钮添加提示
    const newTabBtnEl = document.getElementById('new-tab-btn');
    if (newTabBtnEl) {
      newTabBtnEl.setAttribute('title', '新建标签页 (Ctrl+T)');
    }
  }

  addShortcutHints();
}

module.exports = {
  bindNavigationAndDevtoolsEvents
};
