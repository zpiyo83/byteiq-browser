function bindSettingsAndPanelEvents(options) {
  const {
    aiApiKeyInput,
    aiEndpointInput,
    aiRequestTypeSelect,
    aiTranslationConfig,
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
    overlayBackdrop,
    overlayManager,
    restoreSessionToggle,
    searchEngineSelect,
    setLocale,
    setTranslateToggleActive,
    settingsPanel,
    settingsBtn,
    startupUrlInput,
    store,
    tabManager,
    translateAiApiKeyInput,
    translateAiEndpointInput,
    translateAiModelInput,
    translateAiRequestTypeSelect,
    translateCurrentPageBtn,
    translateDisplayModeSelect,
    translateEnableToggle,
    translateEngineSelect,
    translateStreamingToggle,
    translateTargetLangSelect,
    translateToggleBtn,
    translationAdvancedToggle,
    translationManager,
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
  let bookmarks = store.get('bookmarks', []);
  const index = bookmarks.findIndex((item) => item.url === url);

  if (index > -1) {
    bookmarks.splice(index, 1);
  } else {
    bookmarks.unshift({ url, title, time: new Date().toISOString() });
  }

  store.set('bookmarks', bookmarks);
  updateBookmarkIcon(url);
});

historyBtn.addEventListener('click', () => {
  listPanelManager.showPanel(
    historyPanel,
    historyList,
    'history',
    historySearchInput?.value || ''
  );
  overlayManager.openOverlay(historyPanel);
});

bookmarksListBtn.addEventListener('click', () => {
  listPanelManager.showPanel(
    bookmarksPanel,
    bookmarksList,
    'bookmarks',
    bookmarksSearchInput?.value || ''
  );
  overlayManager.openOverlay(bookmarksPanel);
});

downloadsBtn.addEventListener('click', () => {
  downloadsManager.openDownloadsPanel();
});

settingsBtn.addEventListener('click', () => {
  searchEngineSelect.value = store.get('settings.searchEngine', 'bing');
  startupUrlInput.value = store.get('settings.startupUrl', '');
  if (restoreSessionToggle) {
    restoreSessionToggle.checked = store.get('settings.restoreSession', true);
  }
  if (langSelect) {
    langSelect.value = store.get('settings.language', 'zh-CN');
  }
  // 加载AI设置
  aiEndpointInput.value = store.get('settings.aiEndpoint', '');
  aiApiKeyInput.value = store.get('settings.aiApiKey', '');
  aiRequestTypeSelect.value = store.get('settings.aiRequestType', 'openai-chat');
  if (translationManager) {
    const translationSettings = translationManager.getSettings();
    if (translateEnableToggle) {
      translateEnableToggle.checked = translationSettings.enabled;
      setTranslateToggleActive(translationSettings.enabled);
    }
    if (translateEngineSelect) {
      translateEngineSelect.value = translationSettings.engine;
    }
    if (translateTargetLangSelect) {
      translateTargetLangSelect.value = translationSettings.targetLanguage;
    }
    if (translateDisplayModeSelect) {
      translateDisplayModeSelect.value = translationSettings.displayMode;
    }
    // 加载AI翻译配置
    if (translateAiEndpointInput) {
      translateAiEndpointInput.value = translationSettings.aiEndpoint || '';
    }
    if (translateAiApiKeyInput) {
      translateAiApiKeyInput.value = translationSettings.aiApiKey || '';
    }
    if (translateAiRequestTypeSelect) {
      translateAiRequestTypeSelect.value = translationSettings.aiRequestType || 'openai-chat';
    }
    if (translateAiModelInput) {
      translateAiModelInput.value = translationSettings.aiModel || '';
    }
    if (translateStreamingToggle) {
      translateStreamingToggle.checked = translationSettings.streaming !== false;
    }
    // 显示/隐藏AI翻译配置
    if (aiTranslationConfig) {
      aiTranslationConfig.style.display = translationSettings.engine === 'ai' ? 'block' : 'none';
    }
  }
  // 获取版本信息
  ipcRenderer.invoke('get-version-info').then((versions) => {
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

// Settings navigation
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
    listPanelManager.showPanel(
      historyPanel,
      historyList,
      'history',
      historySearchInput.value
    );
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
    wv.getZoomFactor((factor) => {
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
    wv.getZoomFactor((factor) => {
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

if (translateEnableToggle) {
  translateEnableToggle.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      enabled: translateEnableToggle.checked
    });
    setTranslateToggleActive(translateEnableToggle.checked);
  });
}

if (translateEngineSelect) {
  translateEngineSelect.addEventListener('change', () => {
    if (!translationManager) return;
    const engine = translateEngineSelect.value || 'bing';
    translationManager.saveSettings({
      engine
    });
    // 显示/隐藏AI翻译配置
    if (aiTranslationConfig) {
      aiTranslationConfig.style.display = engine === 'ai' ? 'block' : 'none';
    }
  });
}

if (translateTargetLangSelect) {
  translateTargetLangSelect.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      targetLanguage: translateTargetLangSelect.value || 'zh-Hans'
    });
  });
}

if (translateDisplayModeSelect) {
  translateDisplayModeSelect.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      displayMode: translateDisplayModeSelect.value || 'replace'
    });
  });
}

// AI翻译配置事件
if (translateAiEndpointInput) {
  translateAiEndpointInput.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      aiEndpoint: translateAiEndpointInput.value
    });
  });
}

if (translateAiApiKeyInput) {
  translateAiApiKeyInput.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      aiApiKey: translateAiApiKeyInput.value
    });
  });
}

if (translateAiRequestTypeSelect) {
  translateAiRequestTypeSelect.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      aiRequestType: translateAiRequestTypeSelect.value
    });
  });
}

if (translateAiModelInput) {
  translateAiModelInput.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      aiModel: translateAiModelInput.value
    });
  });
}

// 流式翻译开关
if (translateStreamingToggle) {
  translateStreamingToggle.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      streaming: translateStreamingToggle.checked
    });
  });
}

// 高级设置折叠
if (translationAdvancedToggle) {
  translationAdvancedToggle.addEventListener('click', () => {
    const parent = translationAdvancedToggle.closest('.advanced-settings');
    if (parent) {
      parent.classList.toggle('expanded');
    }
  });
}

if (translateCurrentPageBtn) {
  translateCurrentPageBtn.addEventListener('click', () => {
    if (!translationManager) return;
    translationManager.translateActiveWebview();
  });
}

if (translateToggleBtn) {
  translateToggleBtn.addEventListener('click', () => {
    if (!translationManager) return;
    const currentEnabled = translationManager.getSettings().enabled;
    const nextEnabled = !currentEnabled;
    translationManager.saveSettings({
      enabled: nextEnabled
    });
    if (translateEnableToggle) {
      translateEnableToggle.checked = nextEnabled;
    }
    setTranslateToggleActive(nextEnabled);
    if (nextEnabled) {
      translationManager.translateActiveWebview();
    } else {
      // 关闭翻译时恢复原文
      const webview = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
      if (webview && webview.tagName === 'WEBVIEW') {
        translationManager.restoreOriginalText(webview);
      }
    }
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

document.querySelectorAll('.close-overlay').forEach((btn) => {
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
