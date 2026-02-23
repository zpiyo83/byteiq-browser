function bindSettingsAndPanelEvents(options) {
  const {
    aiApiKeyInput,
    aiEndpointInput,
    aiModelIdInput,
    aiRequestTypeSelect,
    bookmarkBtn,
    bookmarksList,
    bookmarksListBtn,
    bookmarksPanel,
    bookmarksSearchInput,
    browserManager,
    clearDataBtn,
    darkModeToggle,
    documentRef,
    downloadsBtn,
    downloadsManager,
    exportDataBtn,
    extensionsManager,
    historyBtn,
    historyList,
    historyPanel,
    historySearchInput,
    incognitoToggleBtn,
    ipcRenderer,
    listPanelManager,
    modalManager,
    moreMenuBtn,
    moreMenuDropdown,
    overlayBackdrop,
    overlayManager,
    restoreSessionToggle,
    searchEngineSelect,
    setLocale,
    settingsPanel,
    settingsBtn,
    startupUrlInput,
    store,
    tabManager,
    translationApiEnabledToggle,
    translationApiKeyInput,
    translationConcurrencyCountInput,
    translationConcurrencyToggle,
    translationDynamicEnabledToggle,
    translationEndpointInput,
    translationMaxCharsInput,
    translationMaxTextsInput,
    translationModelIdInput,
    translationRequestTypeSelect,
    translationStreamingToggle,
    translationTargetLanguageSelect,
    translationTimeoutInput,
    updateBookmarkIcon,
    updateZoomUI,
    zoomInBtn,
    zoomLevelText,
    zoomOutBtn,
    zoomResetBtn
  } = options;

  const document = documentRef;

  const langSelect = document.getElementById('lang-select');
  if (langSelect) {
    langSelect.value = store.get('settings.language', 'zh-CN');
    langSelect.addEventListener('change', () => {
      setLocale(langSelect.value);
    });
  }

  // 更多按钮下拉菜单事件处理
  if (moreMenuBtn && moreMenuDropdown) {
    moreMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      moreMenuDropdown.classList.toggle('show');
    });

    // 点击下拉菜单外部时关闭
    document.addEventListener('click', () => {
      moreMenuDropdown.classList.remove('show');
    });

    // 阻止点击下拉菜单内部时关闭
    moreMenuDropdown.addEventListener('click', e => {
      e.stopPropagation();
    });

    // 下拉菜单内的按钮点击事件
    const historyBtnInMenu = moreMenuDropdown.querySelector('#history-btn');
    const bookmarksBtnInMenu = moreMenuDropdown.querySelector('#bookmarks-list-btn');
    const devtoolsBtnInMenu = moreMenuDropdown.querySelector('#devtools-btn');
    const settingsBtnInMenu = moreMenuDropdown.querySelector('#settings-btn');
    const downloadsBtnInMenu = moreMenuDropdown.querySelector('#downloads-btn');

    if (historyBtnInMenu) {
      historyBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        listPanelManager.showPanel(
          historyPanel,
          historyList,
          'history',
          historySearchInput?.value || ''
        );
        overlayManager.openOverlay(historyPanel);
      });
    }

    if (bookmarksBtnInMenu) {
      bookmarksBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        listPanelManager.showPanel(
          bookmarksPanel,
          bookmarksList,
          'bookmarks',
          bookmarksSearchInput?.value || ''
        );
        overlayManager.openOverlay(bookmarksPanel);
      });
    }

    if (devtoolsBtnInMenu) {
      devtoolsBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
        if (wv) wv.openDevTools();
      });
    }

    if (settingsBtnInMenu) {
      settingsBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        searchEngineSelect.value = store.get('settings.searchEngine', 'bing');
        startupUrlInput.value = store.get('settings.startupUrl', '');
        if (restoreSessionToggle) {
          restoreSessionToggle.checked = store.get('settings.restoreSession', true);
        }
        if (langSelect) {
          langSelect.value = store.get('settings.language', 'zh-CN');
        }
        // 加载 AI 设置
        aiEndpointInput.value = store.get('settings.aiEndpoint', '');
        aiApiKeyInput.value = store.get('settings.aiApiKey', '');
        aiRequestTypeSelect.value = store.get('settings.aiRequestType', 'openai-chat');
        if (aiModelIdInput) {
          aiModelIdInput.value = store.get('settings.aiModelId', 'gpt-3.5-turbo');
        }
        // 加载翻译设置
        if (translationApiEnabledToggle) {
          translationApiEnabledToggle.checked = store.get('settings.translationApiEnabled', false);
        }
        if (translationEndpointInput) {
          translationEndpointInput.value = store.get('settings.translationEndpoint', '');
        }
        if (translationApiKeyInput) {
          translationApiKeyInput.value = store.get('settings.translationApiKey', '');
        }
        if (translationRequestTypeSelect) {
          translationRequestTypeSelect.value = store.get(
            'settings.translationRequestType',
            'openai-chat'
          );
        }
        if (translationModelIdInput) {
          translationModelIdInput.value = store.get('settings.translationModelId', 'gpt-3.5-turbo');
        }
        if (translationTargetLanguageSelect) {
          translationTargetLanguageSelect.value = store.get(
            'settings.translationTargetLanguage',
            '简体中文'
          );
        }
        if (translationDynamicEnabledToggle) {
          translationDynamicEnabledToggle.checked = store.get(
            'settings.translationDynamicEnabled',
            true
          );
        }
        // 加载翻译高级选项
        if (translationStreamingToggle) {
          translationStreamingToggle.checked = store.get('settings.translationStreaming', true);
        }
        if (translationConcurrencyToggle) {
          translationConcurrencyToggle.checked = store.get(
            'settings.translationConcurrencyEnabled',
            false
          );
        }
        if (translationConcurrencyCountInput) {
          translationConcurrencyCountInput.value = store.get('settings.translationConcurrency', 2);
        }
        if (translationMaxTextsInput) {
          translationMaxTextsInput.value = store.get('settings.translationMaxTexts', 500);
        }
        if (translationMaxCharsInput) {
          translationMaxCharsInput.value = store.get('settings.translationMaxChars', 50000);
        }
        if (translationTimeoutInput) {
          translationTimeoutInput.value = store.get('settings.translationTimeout', 120);
        }
        // 获取版本信息
        ipcRenderer.invoke('get-version-info').then(versions => {
          const appVersionEl = document.getElementById('about-app-version');
          const electronVersionEl = document.getElementById('about-electron-version');
          const chromiumVersionEl = document.getElementById('about-chromium-version');
          const nodeVersionEl = document.getElementById('about-node-version');
          const v8VersionEl = document.getElementById('about-v8-version');
          if (appVersionEl) appVersionEl.textContent = versions.appVersion;
          if (electronVersionEl) electronVersionEl.textContent = versions.electronVersion;
          if (chromiumVersionEl) chromiumVersionEl.textContent = versions.chromiumVersion;
          if (nodeVersionEl) nodeVersionEl.textContent = versions.nodeVersion;
          if (v8VersionEl) v8VersionEl.textContent = versions.v8Version;
        });
        extensionsManager.refresh();
        overlayManager.openOverlay(settingsPanel);
      });
    }

    if (downloadsBtnInMenu) {
      downloadsBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        downloadsManager.openDownloadsPanel();
      });
    }
  }

  if (restoreSessionToggle) {
    restoreSessionToggle.checked = store.get('settings.restoreSession', true);
    restoreSessionToggle.addEventListener('change', () => {
      store.set('settings.restoreSession', restoreSessionToggle.checked);
    });
  }

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
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.getAttribute('data-section');
      if (!section) return;

      // Update nav items
      document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update sections
      document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
      const targetSection = document.getElementById(`settings-${section}`);
      if (targetSection) {
        targetSection.classList.add('active');
      }
    });
  });

  if (historySearchInput) {
    historySearchInput.addEventListener('input', () => {
      listPanelManager.showPanel(historyPanel, historyList, 'history', historySearchInput.value);
    });
  }

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

  incognitoToggleBtn.addEventListener('click', () => {
    browserManager.toggleIncognito();
  });

  if (darkModeToggle) {
    darkModeToggle.addEventListener('change', () => {
      const isDark = darkModeToggle.checked;
      document.body.classList.toggle('dark-mode', isDark);
      store.set('settings.darkMode', isDark);
    });

    if (store.get('settings.darkMode')) {
      document.body.classList.add('dark-mode');
      darkModeToggle.checked = true;
    }
  }

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

  searchEngineSelect.addEventListener('change', () => {
    store.set('settings.searchEngine', searchEngineSelect.value);
  });

  startupUrlInput.addEventListener('change', () => {
    store.set('settings.startupUrl', startupUrlInput.value);
  });

  aiEndpointInput.addEventListener('change', () => {
    store.set('settings.aiEndpoint', aiEndpointInput.value);
  });

  aiApiKeyInput.addEventListener('change', () => {
    store.set('settings.aiApiKey', aiApiKeyInput.value);
  });

  aiRequestTypeSelect.addEventListener('change', () => {
    store.set('settings.aiRequestType', aiRequestTypeSelect.value);
  });

  if (aiModelIdInput) {
    aiModelIdInput.addEventListener('change', () => {
      store.set('settings.aiModelId', aiModelIdInput.value);
    });
  }

  if (translationTargetLanguageSelect) {
    translationTargetLanguageSelect.addEventListener('change', () => {
      store.set('settings.translationTargetLanguage', translationTargetLanguageSelect.value);
    });
  }

  if (translationDynamicEnabledToggle) {
    translationDynamicEnabledToggle.addEventListener('change', () => {
      store.set('settings.translationDynamicEnabled', translationDynamicEnabledToggle.checked);
    });
  }

  // 翻译设置事件绑定
  if (translationApiEnabledToggle) {
    translationApiEnabledToggle.addEventListener('change', () => {
      store.set('settings.translationApiEnabled', translationApiEnabledToggle.checked);
    });
  }

  if (translationEndpointInput) {
    translationEndpointInput.addEventListener('change', () => {
      store.set('settings.translationEndpoint', translationEndpointInput.value);
    });
  }

  if (translationApiKeyInput) {
    translationApiKeyInput.addEventListener('change', () => {
      store.set('settings.translationApiKey', translationApiKeyInput.value);
    });
  }

  if (translationRequestTypeSelect) {
    translationRequestTypeSelect.addEventListener('change', () => {
      store.set('settings.translationRequestType', translationRequestTypeSelect.value);
    });
  }

  if (translationModelIdInput) {
    translationModelIdInput.addEventListener('change', () => {
      store.set('settings.translationModelId', translationModelIdInput.value);
    });
  }

  // 翻译高级选项事件绑定
  if (translationStreamingToggle) {
    translationStreamingToggle.addEventListener('change', () => {
      store.set('settings.translationStreaming', translationStreamingToggle.checked);
    });
  }

  if (translationConcurrencyToggle) {
    translationConcurrencyToggle.addEventListener('change', () => {
      store.set('settings.translationConcurrencyEnabled', translationConcurrencyToggle.checked);
    });
  }

  if (translationConcurrencyCountInput) {
    translationConcurrencyCountInput.addEventListener('change', () => {
      const value = Math.max(
        1,
        Math.min(10, parseInt(translationConcurrencyCountInput.value) || 2)
      );
      translationConcurrencyCountInput.value = value;
      store.set('settings.translationConcurrency', value);
    });
  }

  if (translationMaxTextsInput) {
    translationMaxTextsInput.addEventListener('change', () => {
      const value = Math.max(10, Math.min(1000, parseInt(translationMaxTextsInput.value) || 500));
      translationMaxTextsInput.value = value;
      store.set('settings.translationMaxTexts', value);
    });
  }

  if (translationMaxCharsInput) {
    translationMaxCharsInput.addEventListener('change', () => {
      const value = Math.max(
        1000,
        Math.min(100000, parseInt(translationMaxCharsInput.value) || 50000)
      );
      translationMaxCharsInput.value = value;
      store.set('settings.translationMaxChars', value);
    });
  }

  if (translationTimeoutInput) {
    translationTimeoutInput.addEventListener('change', () => {
      const value = Math.max(30, Math.min(300, parseInt(translationTimeoutInput.value) || 120));
      translationTimeoutInput.value = value;
      store.set('settings.translationTimeout', value);
    });
  }

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

module.exports = {
  bindSettingsAndPanelEvents
};
