/**
 * 浏览器设置事件绑定模块
 * 负责搜索引擎、暗色模式、缩放、书签、数据管理等事件绑定
 */

/**
 * 绑定浏览器设置相关事件
 * @param {object} deps - 依赖
 */
function bindBrowserSettingsEvents(deps) {
  const {
    bookmarkBtn,
    bookmarksList,
    bookmarksPanel,
    bookmarksSearchInput,
    browserManager,
    clearDataBtn,
    darkModeToggle,
    documentRef,
    exportDataBtn,
    historyList,
    historyPanel,
    historyPanelManager,
    historySearchInput,
    incognitoToggleBtn,
    listPanelManager,
    modalManager,
    overlayBackdrop,
    overlayManager,
    restoreSessionToggle,
    searchEngineSelect,
    setLocale,
    startupUrlInput,
    store,
    tabManager,
    updateBookmarkIcon,
    updateZoomUI,
    zoomInBtn,
    zoomOutBtn,
    zoomResetBtn
  } = deps;

  const document = documentRef;

  // 语言选择
  const langSelect = document.getElementById('lang-select');
  if (langSelect) {
    langSelect.value = store.get('settings.language', 'zh-CN');
    langSelect.addEventListener('change', () => {
      setLocale(langSelect.value);
    });
  }

  // 恢复会话
  if (restoreSessionToggle) {
    restoreSessionToggle.checked = store.get('settings.restoreSession', false);
    restoreSessionToggle.addEventListener('change', () => {
      store.set('settings.restoreSession', restoreSessionToggle.checked);
    });
  }

  // 书签按钮
  bookmarkBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (!wv || wv.tagName !== 'WEBVIEW') return;

    const url = wv.getURL();
    const title = wv.getTitle();
    const bookmarks = store.get('bookmarks', []);
    const index = bookmarks.findIndex(item => item.url === url);

    if (index > -1) {
      bookmarks.splice(index, 1);
    } else {
      bookmarks.unshift({ url, title, time: new Date().toISOString() });
    }

    store.set('bookmarks', bookmarks);
    updateBookmarkIcon(url);
  });

  // 设置面板导航
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.getAttribute('data-section');
      if (!section) return;

      document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.settings-section').forEach(s => {
        s.classList.remove('active');
        s.style.animation = 'none';
        s.offsetHeight;
        s.style.animation = '';
      });
      const targetSection = document.getElementById(`settings-${section}`);
      if (targetSection) {
        targetSection.classList.add('active');
      }
    });
  });

  // 历史搜索
  if (historySearchInput) {
    historySearchInput.addEventListener('input', () => {
      historyPanelManager.showPanel(historyPanel, historyList, historySearchInput.value);
    });
  }

  // 书签搜索
  if (bookmarksSearchInput) {
    bookmarksSearchInput.addEventListener('input', () => {
      listPanelManager.showPanel(
        bookmarksPanel,
        bookmarksList,
        'bookmarks',
        bookmarksSearchInput.value
      );
    });
  }

  // 隐身模式
  incognitoToggleBtn.addEventListener('click', () => {
    browserManager.toggleIncognito();
  });

  // 暗色模式
  if (darkModeToggle) {
    const savedDarkMode = store.get('settings.darkMode');
    darkModeToggle.checked = savedDarkMode === true;

    darkModeToggle.addEventListener('change', () => {
      const isDark = darkModeToggle.checked;
      document.body.classList.toggle('dark-mode', isDark);
      store.set('settings.darkMode', isDark === true);
    });
  }

  // 缩放控制
  zoomInBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      wv.getZoomFactor(factor => {
        const newFactor = factor + 0.1;
        wv.setZoomFactor(newFactor);
        updateZoomUI(newFactor);
        browserManager.setZoomForUrl(wv.getURL(), newFactor);
      });
    }
  });

  zoomOutBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      wv.getZoomFactor(factor => {
        const newFactor = Math.max(0.2, factor - 0.1);
        wv.setZoomFactor(newFactor);
        updateZoomUI(newFactor);
        browserManager.setZoomForUrl(wv.getURL(), newFactor);
      });
    }
  });

  zoomResetBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      wv.setZoomFactor(1.0);
      updateZoomUI(1.0);
      browserManager.setZoomForUrl(wv.getURL(), 1.0);
    }
  });

  // 搜索引擎
  searchEngineSelect.addEventListener('change', () => {
    store.set('settings.searchEngine', searchEngineSelect.value);
  });

  // 启动URL
  startupUrlInput.addEventListener('change', () => {
    store.set('settings.startupUrl', startupUrlInput.value);
  });

  // 清除数据
  clearDataBtn.addEventListener('click', async () => {
    const confirmed = await modalManager.confirmDelete(
      '确定要清除所有浏览数据吗？此操作不可撤销。',
      '清除数据'
    );
    if (confirmed) {
      store.set('history', []);
      store.set('bookmarks', []);
      await modalManager.success('数据已清除', '完成');
    }
  });

  // 导出数据
  exportDataBtn.addEventListener('click', () => {
    const data = {
      bookmarks: store.get('bookmarks', []),
      history: store.get('history', []),
      settings: store.get('settings', {})
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `byteiq-browser-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 关闭覆盖层
  document.querySelectorAll('.close-overlay').forEach(btn => {
    btn.addEventListener('click', () => {
      overlayManager.closeAllOverlays();
    });
  });

  if (overlayBackdrop) {
    overlayBackdrop.addEventListener('click', () => {
      overlayManager.closeAllOverlays();
    });
  }
}

module.exports = { bindBrowserSettingsEvents };
